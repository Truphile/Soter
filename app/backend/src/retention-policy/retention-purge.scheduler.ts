import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { RetentionPurgeJobData, RETENTION_PURGE_QUEUE } from './retention-purge.processor';

@Injectable()
export class RetentionPurgeScheduler {
  private readonly logger = new Logger(RetentionPurgeScheduler.name);
  private isRunning = false;

  constructor(
    @InjectQueue(RETENTION_PURGE_QUEUE)
    private readonly purgeQueue: Queue<RetentionPurgeJobData>,
  ) {}

  /**
   * Scheduled purge — runs daily at 02:00 UTC.
   * Skips if a previous purge job is still active in the queue.
   */
  @Cron('0 2 * * *', {
    name: 'retention-purge-daily',
    timeZone: 'UTC',
  })
  async schedulePurge() {
    if (this.isRunning) {
      this.logger.debug('Previous retention purge still in progress, skipping');
      return;
    }

    this.isRunning = true;

    try {
      // Check if there's already an active or waiting purge job
      const [activeJobs, waitingJobs] = await Promise.all([
        this.purgeQueue.getActive(),
        this.purgeQueue.getWaiting(),
      ]);

      const hasPending = [...activeJobs, ...waitingJobs].some(
        (job) => job.name === 'retention-purge',
      );

      if (hasPending) {
        this.logger.debug(
          'A retention purge job is already active or waiting — skipping enqueue',
        );
        return;
      }

      const job = await this.purgeQueue.add(
        'retention-purge',
        {
          triggeredBy: 'cron',
          timestamp: Date.now(),
        },
        {
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 30_000,
          },
          removeOnComplete: { age: 7 * 24 * 3600 },
          removeOnFail: { age: 14 * 24 * 3600 },
        },
      );

      this.logger.log(`Scheduled retention purge job ${job.id}`);
    } catch (error) {
      this.logger.error(
        `Failed to schedule retention purge: ${(error as Error).message}`,
      );
    } finally {
      this.isRunning = false;
    }
  }
}
