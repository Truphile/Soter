import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { IdempotencyCleanupService } from './idempotency-cleanup.service';

@Injectable()
export class IdempotencyCleanupScheduler {
  private readonly logger = new Logger(IdempotencyCleanupScheduler.name);
  private isRunning = false;

  constructor(
    private readonly cleanupService: IdempotencyCleanupService,
  ) {}

  /**
   * Scheduled cleanup of expired idempotency records.
   * Runs every hour. Skips execution if a previous cleanup is still running.
   */
  @Cron(CronExpression.EVERY_HOUR, {
    name: 'idempotency-cleanup',
    timeZone: 'UTC',
  })
  async handleCleanup() {
    if (this.isRunning) {
      this.logger.debug('Previous cleanup still in progress, skipping');
      return;
    }

    this.isRunning = true;

    try {
      const result = await this.cleanupService.executeCleanup();

      this.logger.log('Scheduled idempotency cleanup finished', {
        totalPurged: result.totalPurged,
        batchesExecuted: result.batchesExecuted,
        duration: result.duration,
      });
    } catch (error) {
      this.logger.error(
        `Scheduled idempotency cleanup failed: ${(error as Error).message}`,
      );
    } finally {
      this.isRunning = false;
    }
  }
}
