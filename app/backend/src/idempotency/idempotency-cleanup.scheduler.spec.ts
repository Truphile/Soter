import { Test, TestingModule } from '@nestjs/testing';
import { IdempotencyCleanupScheduler } from './idempotency-cleanup.scheduler';
import { IdempotencyCleanupService } from './idempotency-cleanup.service';

describe('IdempotencyCleanupScheduler', () => {
  let scheduler: IdempotencyCleanupScheduler;
  let cleanupService: {
    executeCleanup: jest.Mock;
  };

  beforeEach(async () => {
    cleanupService = {
      executeCleanup: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IdempotencyCleanupScheduler,
        {
          provide: IdempotencyCleanupService,
          useValue: cleanupService,
        },
      ],
    }).compile();

    scheduler = module.get<IdempotencyCleanupScheduler>(
      IdempotencyCleanupScheduler,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('handleCleanup', () => {
    it('should execute cleanup and log result', async () => {
      cleanupService.executeCleanup.mockResolvedValue({
        totalPurged: 42,
        batchesExecuted: 3,
        duration: 1.23,
      });

      await scheduler.handleCleanup();

      expect(cleanupService.executeCleanup).toHaveBeenCalledTimes(1);
    });

    it('should not run if already running (guard against concurrent execution)', async () => {
      // Start first execution
      const firstExecution = scheduler.handleCleanup();
      // Immediately start second — should be skipped
      const secondExecution = scheduler.handleCleanup();

      // Let both resolve
      cleanupService.executeCleanup.mockResolvedValue({
        totalPurged: 0,
        batchesExecuted: 0,
        duration: 0,
      });

      await firstExecution;
      await secondExecution;

      // Only one actual call should have been made
      expect(cleanupService.executeCleanup).toHaveBeenCalledTimes(1);
    });

    it('should handle cleanup failures gracefully without throwing', async () => {
      cleanupService.executeCleanup.mockRejectedValue(
        new Error('Database unavailable'),
      );

      // Should not throw — the scheduler catches and logs errors
      await expect(scheduler.handleCleanup()).resolves.toBeUndefined();
      expect(cleanupService.executeCleanup).toHaveBeenCalledTimes(1);
    });

    it('should allow re-execution after previous run completes', async () => {
      cleanupService.executeCleanup.mockResolvedValue({
        totalPurged: 10,
        batchesExecuted: 1,
        duration: 0.5,
      });

      await scheduler.handleCleanup();
      await scheduler.handleCleanup();

      expect(cleanupService.executeCleanup).toHaveBeenCalledTimes(2);
    });
  });
});
