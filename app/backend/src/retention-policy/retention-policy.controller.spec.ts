import { Test, TestingModule } from '@nestjs/testing';
import { RetentionPolicyController } from './retention-policy.controller';
import { RetentionPolicyService } from './retention-policy.service';

describe('RetentionPolicyController', () => {
  let controller: RetentionPolicyController;
  let service: {
    create: jest.Mock;
    findAll: jest.Mock;
    findOne: jest.Mock;
    update: jest.Mock;
    remove: jest.Mock;
    executePurge: jest.Mock;
    seedDefaults: jest.Mock;
    getSupportedEntities: jest.Mock;
  };

  beforeEach(async () => {
    service = {
      create: jest.fn(),
      findAll: jest.fn(),
      findOne: jest.fn(),
      update: jest.fn(),
      remove: jest.fn(),
      executePurge: jest.fn(),
      seedDefaults: jest.fn(),
      getSupportedEntities: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [RetentionPolicyController],
      providers: [
        {
          provide: RetentionPolicyService,
          useValue: service,
        },
      ],
    }).compile();

    controller = module.get<RetentionPolicyController>(RetentionPolicyController);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('create', () => {
    it('should create a retention policy', async () => {
      const dto = {
        entity: 'AuditLog',
        retentionDays: 90,
        strategy: 'soft_delete' as const,
      };
      const expected = { id: 'pol-1', ...dto, enabled: true };
      service.create.mockResolvedValue(expected);

      const result = await controller.create(dto);
      expect(result).toEqual(expected);
      expect(service.create).toHaveBeenCalledWith(dto);
    });
  });

  describe('findAll', () => {
    it('should return all retention policies', async () => {
      const policies = [
        { id: '1', entity: 'AuditLog' },
        { id: '2', entity: 'Session' },
      ];
      service.findAll.mockResolvedValue(policies);

      const result = await controller.findAll();
      expect(result).toEqual(policies);
      expect(service.findAll).toHaveBeenCalled();
    });
  });

  describe('getSupportedEntities', () => {
    it('should return supported entities', () => {
      service.getSupportedEntities.mockReturnValue([
        'AuditLog',
        'Session',
        'Claim',
      ]);

      const result = controller.getSupportedEntities();
      expect(result).toEqual({
        entities: ['AuditLog', 'Session', 'Claim'],
      });
    });
  });

  describe('findOne', () => {
    it('should return a single policy by id', async () => {
      const policy = { id: 'pol-1', entity: 'AuditLog' };
      service.findOne.mockResolvedValue(policy);

      const result = await controller.findOne('pol-1');
      expect(result).toEqual(policy);
      expect(service.findOne).toHaveBeenCalledWith('pol-1');
    });
  });

  describe('update', () => {
    it('should update a policy', async () => {
      const dto = { retentionDays: 180 };
      const updated = { id: 'pol-1', retentionDays: 180 };
      service.update.mockResolvedValue(updated);

      const result = await controller.update('pol-1', dto);
      expect(result).toEqual(updated);
      expect(service.update).toHaveBeenCalledWith('pol-1', dto);
    });
  });

  describe('remove', () => {
    it('should delete a policy', async () => {
      const deleted = { id: 'pol-1' };
      service.remove.mockResolvedValue(deleted);

      const result = await controller.remove('pol-1');
      expect(result).toEqual(deleted);
      expect(service.remove).toHaveBeenCalledWith('pol-1');
    });
  });

  describe('executePurge', () => {
    it('should trigger purge and return summary', async () => {
      const results = [
        { entity: 'AuditLog', strategy: 'soft_delete', affected: 10, cutoffDate: new Date() },
        { entity: 'Session', strategy: 'anonymize', affected: 5, cutoffDate: new Date() },
      ];
      service.executePurge.mockResolvedValue(results);

      const result = await controller.executePurge();
      expect(result.message).toBe('Purge execution completed');
      expect(result.totalAffected).toBe(15);
      expect(result.results).toEqual(results);
    });

    it('should return zero totalAffected when nothing purged', async () => {
      service.executePurge.mockResolvedValue([]);

      const result = await controller.executePurge();
      expect(result.totalAffected).toBe(0);
    });
  });

  describe('seedDefaults', () => {
    it('should call seedDefaults on the service', async () => {
      service.seedDefaults.mockResolvedValue(undefined);

      const result = await controller.seedDefaults();
      expect(result.message).toBe('Default retention policies seeded');
      expect(service.seedDefaults).toHaveBeenCalled();
    });
  });
});
