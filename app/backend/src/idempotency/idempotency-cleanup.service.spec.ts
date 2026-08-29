import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { IdempotencyCleanupService } from './idempotency-cleanup.service';
import { PrismaService } from '../prisma/prisma.service';
import { MetricsService } from '../observability/metrics/metrics.service';
import { RetentionPolicyService } from '../retention-policy/retention-policy.service';

describe('IdempotencyCleanupService', () => {
  let service: IdempotencyCleanupService;
  let prisma: {
    idempotencyKey: {
      findMany: jest.Mock;
      deleteMany: jest.Mock;
    };
  };
  let metricsService: {
    incrementCounter: jest.Mock;
    recordHistogram: jest.Mock;
  };
  let retentionPolicyService: jest.Mocked<RetentionPolicyService>;

  beforeEach(async () => {
    prisma = {
      idempotencyKey: {
        findMany: jest.fn(),
        deleteMany: jest.fn(),
      },
    };

    metricsService = {
      incrementCounter: jest.fn(),
      recordHistogram: jest.fn(),
    };

    retentionPolicyService = {
      executePurge: jest.fn(),
      getSupportedEntities: jest.fn(),
    } as unknown as jest.Mocked<RetentionPolicyService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IdempotencyCleanupService,
        { provide: PrismaService, useValue: prisma },
        { provide: MetricsService, useValue: metricsService },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, defaultValue?: unknown) => {
              const config: Record<string, unknown> = {
                IDEMPOTENCY_CLEANUP_BATCH_SIZE: 10,
                IDEMPOTENCY_CLEANUP_MAX_BATCHES: 5,
                IDEMPOTENCY_RETENTION_HOURS: 168,
              };
              return config[key] ?? defaultValue;
            }),
          },
        },
        {
          provide: RetentionPolicyService,
          useValue: retentionPolicyService,
        },
      ],
    }).compile();

    service = module.get<IdempotencyCleanupService>(IdempotencyCleanupService);
  });

  describe('executeCleanup', () => {
    it('should purge expired records in bounded batches', async () => {
      // First batch returns 2 records, second batch returns 0
      prisma.idempotencyKey.findMany
        .mockResolvedValueOnce([
          { id: '1' },
          { id: '2' },
        ])
        .mockResolvedValueOnce([]);

      prisma.idempotencyKey.deleteMany.mockResolvedValue({ count: 2 });

      const result = await service.executeCleanup();

      expect(result.totalPurged).toBe(2);
      expect(result.batchesExecuted).toBe(2);
      expect(prisma.idempotencyKey.findMany).toHaveBeenCalledTimes(2);
      expect(prisma.idempotencyKey.deleteMany).toHaveBeenCalledTimes(1);
      expect(prisma.idempotencyKey.deleteMany).toHaveBeenCalledWith({
        where: { id: { in: ['1', '2'] } },
      });
    });

    it('should return zero purged when no expired records exist', async () => {
      prisma.idempotencyKey.findMany.mockResolvedValue([]);

      const result = await service.executeCleanup();

      expect(result.totalPurged).toBe(0);
      expect(result.batchesExecuted).toBe(1);
      expect(prisma.idempotencyKey.deleteMany).not.toHaveBeenCalled();
    });

    it('should emit metrics for purge count', async () => {
      prisma.idempotencyKey.findMany
        .mockResolvedValueOnce([{ id: '1' }])
        .mockResolvedValueOnce([]);

      prisma.idempotencyKey.deleteMany.mockResolvedValue({ count: 1 });

      await service.executeCleanup();

      expect(metricsService.incrementCounter).toHaveBeenCalledWith(
        'idempotency_cleanup_records_purged',
        { count: '1' },
      );
      expect(metricsService.recordHistogram).toHaveBeenCalledWith(
        'idempotency_cleanup_duration_seconds',
        expect.any(Number),
      );
    });

    it('should process multiple batches', async () => {
      // Batch 1: 5 records, Batch 2: 3 records, Batch 3: 0
      prisma.idempotencyKey.findMany
        .mockResolvedValueOnce([
          { id: '1' },
          { id: '2' },
          { id: '3' },
          { id: '4' },
          { id: '5' },
        ])
        .mockResolvedValueOnce([
          { id: '6' },
          { id: '7' },
          { id: '8' },
        ])
        .mockResolvedValueOnce([]);

      prisma.idempotencyKey.deleteMany
        .mockResolvedValueOnce({ count: 5 })
        .mockResolvedValueOnce({ count: 3 });

      const result = await service.executeCleanup();

      expect(result.totalPurged).toBe(8);
      expect(result.batchesExecuted).toBe(3);
      expect(prisma.idempotencyKey.deleteMany).toHaveBeenCalledTimes(2);
    });

    it('should handle database errors gracefully', async () => {
      prisma.idempotencyKey.findMany.mockRejectedValue(
        new Error('Database connection failed'),
      );

      await expect(service.executeCleanup()).rejects.toThrow(
        'Database connection failed',
      );

      expect(metricsService.incrementCounter).toHaveBeenCalledWith(
        'idempotency_cleanup_failed',
        { error: 'Database connection failed' },
      );
    });

    it('should use configurable batch size', async () => {
      prisma.idempotencyKey.findMany.mockResolvedValue([]);
      prisma.idempotencyKey.findMany.mockResolvedValue([]);

      await service.executeCleanup();

      expect(prisma.idempotencyKey.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 10, // Configured batch size
        }),
      );
    });

    it('should respect maxBatches limit', async () => {
      // Each batch always returns records - should stop at maxBatches
      prisma.idempotencyKey.findMany.mockResolvedValue([
        { id: '1' },
        { id: '2' },
        { id: '3' },
        { id: '4' },
        { id: '5' },
      ]);
      prisma.idempotencyKey.deleteMany.mockResolvedValue({ count: 5 });

      const result = await service.executeCleanup();

      // Max batches is 5
      expect(result.batchesExecuted).toBe(5);
      expect(result.totalPurged).toBe(25);
    });
  });

  describe('getRetentionHours', () => {
    it('should return configured retention hours', () => {
      expect(service.getRetentionHours()).toBe(168);
    });
  });

  describe('safe to execute repeatedly', () => {
    it('should not fail on second execution with no records', async () => {
      prisma.idempotencyKey.findMany.mockResolvedValue([]);

      const result1 = await service.executeCleanup();
      const result2 = await service.executeCleanup();

      expect(result1.totalPurged).toBe(0);
      expect(result2.totalPurged).toBe(0);
    });
  });
});
