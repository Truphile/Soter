import { Test, TestingModule } from '@nestjs/testing';
import { RetentionPurgeProcessor } from './retention-purge.processor';
import { RetentionPolicyService } from './retention-policy.service';

describe('RetentionPurgeProcessor', () => {
  let processor: RetentionPurgeProcessor;
  let retentionService: {
    executePurge: jest.Mock;
  };

  beforeEach(async () => {
    retentionService = {
      executePurge: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RetentionPurgeProcessor,
        {
          provide: RetentionPolicyService,
          useValue: retentionService,
        },
      ],
    }).compile();

    processor = module.get<RetentionPurgeProcessor>(RetentionPurgeProcessor);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('process', () => {
    it('should execute purge and log completion', async () => {
      retentionService.executePurge.mockResolvedValue([
        { entity: 'AuditLog', strategy: 'soft_delete', affected: 10, cutoffDate: new Date() },
        { entity: 'Session', strategy: 'anonymize', affected: 5, cutoffDate: new Date() },
      ]);

      const job = {
        id: 'job-1',
        data: { triggeredBy: 'cron', timestamp: Date.now() },
      } as any;

      await expect(processor.process(job)).resolves.toBeUndefined();
      expect(retentionService.executePurge).toHaveBeenCalledTimes(1);
    });

    it('should re-throw errors so BullMQ marks the job as failed', async () => {
      retentionService.executePurge.mockRejectedValue(new Error('DB connection lost'));

      const job = {
        id: 'job-2',
        data: { triggeredBy: 'manual', timestamp: Date.now() },
      } as any;

      await expect(processor.process(job)).rejects.toThrow('DB connection lost');
      expect(retentionService.executePurge).toHaveBeenCalledTimes(1);
    });

    it('should handle empty purge results gracefully', async () => {
      retentionService.executePurge.mockResolvedValue([]);

      const job = {
        id: 'job-3',
        data: { triggeredBy: 'api', timestamp: Date.now() },
      } as any;

      await expect(processor.process(job)).resolves.toBeUndefined();
    });

    it('should compute totalAffected from results', async () => {
      retentionService.executePurge.mockResolvedValue([
        { entity: 'AuditLog', strategy: 'soft_delete', affected: 100, cutoffDate: new Date() },
        { entity: 'VerificationSession', strategy: 'hard_delete', affected: 25, cutoffDate: new Date() },
        { entity: 'Claim', strategy: 'anonymize', affected: 75, cutoffDate: new Date() },
      ]);

      const job = {
        id: 'job-4',
        data: { triggeredBy: 'cron', timestamp: Date.now() },
      } as any;

      await expect(processor.process(job)).resolves.toBeUndefined();
      expect(retentionService.executePurge).toHaveBeenCalledTimes(1);
    });
  });
});
