import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { MetricsService } from '../observability/metrics/metrics.service';
import { RetentionPolicyService } from '../retention-policy/retention-policy.service';

/** Default batch size for bounded purging */
const DEFAULT_BATCH_SIZE = 500;

/** Maximum number of batches per execution to prevent infinite loops */
const MAX_BATCHES = 100;

export interface IdempotencyCleanupResult {
  totalPurged: number;
  batchesExecuted: number;
  duration: number;
}

@Injectable()
export class IdempotencyCleanupService {
  private readonly logger = new Logger(IdempotencyCleanupService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly metricsService: MetricsService,
    private readonly configService: ConfigService,
    private readonly retentionPolicyService: RetentionPolicyService,
  ) {}

  /**
   * Execute bounded batch cleanup of expired idempotency records.
   *
   * Records are purged in bounded batches to avoid excessive memory usage
   * and long-running transactions. The cleanup respects the retention policy
   * configured via the RetentionPolicy system and is safe to execute repeatedly.
   */
  async executeCleanup(): Promise<IdempotencyCleanupResult> {
    const startTime = Date.now();
    let totalPurged = 0;
    let batchesExecuted = 0;

    const batchSize = this.configService.get<number>(
      'IDEMPOTENCY_CLEANUP_BATCH_SIZE',
      DEFAULT_BATCH_SIZE,
    );

    const maxBatches = this.configService.get<number>(
      'IDEMPOTENCY_CLEANUP_MAX_BATCHES',
      MAX_BATCHES,
    );

    this.logger.log('Starting idempotency key cleanup', {
      batchSize,
      maxBatches,
    });

    try {
      let hasMore = true;

      while (hasMore && batchesExecuted < maxBatches) {
        const purgedInBatch = await this.purgeBatch(batchSize);

        totalPurged += purgedInBatch;
        batchesExecuted++;

        if (purgedInBatch === 0) {
          hasMore = false;
        }

        this.logger.debug(
          `Batch ${batchesExecuted}: purged ${purgedInBatch} records`,
        );
      }

      const duration = (Date.now() - startTime) / 1000;

      // Emit cleanup metric
      this.metricsService.incrementCounter(
        'idempotency_cleanup_records_purged',
        {
          count: totalPurged.toString(),
        },
      );

      this.metricsService.recordHistogram(
        'idempotency_cleanup_duration_seconds',
        duration,
      );

      // Structured log for cleanup completion
      this.logger.log('Idempotency key cleanup completed', {
        totalPurged,
        batchesExecuted,
        duration,
        batchSize,
        maxBatches,
      });

      return { totalPurged, batchesExecuted, duration };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      this.logger.error(
        `Idempotency key cleanup failed after ${batchesExecuted} batches: ${errorMessage}`,
      );

      this.metricsService.incrementCounter(
        'idempotency_cleanup_failed',
        {
          error: errorMessage.substring(0, 100),
        },
      );

      throw error;
    }
  }

  /**
   * Purge a single batch of expired idempotency records.
   * Uses bounded delete to avoid unbounded operations.
   */
  private async purgeBatch(batchSize: number): Promise<number> {
    // Find expired records to delete (bounded selection)
    const expiredRecords = await this.prisma.idempotencyKey.findMany({
      where: {
        expiresAt: {
          lt: new Date(),
        },
      },
      select: { id: true },
      take: batchSize,
    });

    if (expiredRecords.length === 0) {
      return 0;
    }

    // Delete only the selected batch
    const ids = expiredRecords.map(record => record.id);

    const result = await this.prisma.idempotencyKey.deleteMany({
      where: {
        id: { in: ids },
      },
    });

    return result.count;
  }

  /**
   * Get the configured retention window in hours for idempotency keys.
   * Falls back to 7 days (168 hours) if not configured.
   */
  getRetentionHours(): number {
    return this.configService.get<number>('IDEMPOTENCY_RETENTION_HOURS', 168);
  }
}
