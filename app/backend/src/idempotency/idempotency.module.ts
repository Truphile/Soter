import { Module } from '@nestjs/common';
import { IdempotencyCleanupService } from './idempotency-cleanup.service';
import { IdempotencyCleanupScheduler } from './idempotency-cleanup.scheduler';
import { PrismaModule } from '../prisma/prisma.module';
import { ObservabilityModule } from '../observability/observability.module';
import { RetentionPolicyModule } from '../retention-policy/retention-policy.module';

@Module({
  imports: [PrismaModule, ObservabilityModule, RetentionPolicyModule],
  providers: [IdempotencyCleanupService, IdempotencyCleanupScheduler],
  exports: [IdempotencyCleanupService],
})
export class IdempotencyModule {}
