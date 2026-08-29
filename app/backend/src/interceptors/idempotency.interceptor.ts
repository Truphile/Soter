import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Observable, tap } from 'rxjs';
import { Request, Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Idempotency interceptor for preventing duplicate requests.
 *
 * This interceptor:
 * 1. Extracts the idempotency key from the `idempotency-key` request header
 * 2. Checks if the key has been used before (treats expired records as absent)
 * 3. If used and unexpired, returns the cached response
 * 4. If new or expired, processes the request and stores the response
 *
 * Usage: Add `@UseInterceptors(IdempotencyInterceptor)` to controllers
 *
 * Header: `idempotency-key` (consistent with the idempotency library)
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  private readonly logger = new Logger(IdempotencyInterceptor.name);

  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
  ) {}

  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<any>> {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();

    const idempotencyKey = request.headers['idempotency-key'] as string;

    // If no idempotency key, proceed normally
    if (!idempotencyKey) {
      return next.handle();
    }

    // Check if this key has already been processed
    const existingRecord = await this.prisma.idempotencyKey.findUnique({
      where: { key: idempotencyKey },
    });

    // Treat expired-but-not-yet-purged records as absent
    if (existingRecord && existingRecord.expiresAt > new Date()) {
      // Return cached response if key was already used and is still valid
      response
        .status(existingRecord.responseStatus)
        .json(JSON.parse(existingRecord.responseBody));
      return new Observable();
    }

    // Calculate expiry from configured retention window
    const retentionHours = this.configService.get<number>(
      'IDEMPOTENCY_RETENTION_HOURS',
      24,
    );
    const expiresAt = new Date(Date.now() + retentionHours * 60 * 60 * 1000);

    // Process the request and cache the response
    return next.handle().pipe(
      tap(data => {
        // Handle async operation without returning Promise to tap()
        void (async () => {
          try {
            // If an expired record existed, replace it with a fresh one
            if (existingRecord) {
              await this.prisma.idempotencyKey.update({
                where: { key: idempotencyKey },
                data: {
                  responseStatus: response.statusCode,
                  responseBody: JSON.stringify(data),
                  expiresAt,
                },
              });
            } else {
              await this.prisma.idempotencyKey.create({
                data: {
                  key: idempotencyKey,
                  responseStatus: response.statusCode,
                  responseBody: JSON.stringify(data),
                  expiresAt,
                },
              });
            }
          } catch (error) {
            // Log error but don't fail the request
            this.logger.error(
              `Failed to cache idempotency key: ${(error as Error).message}`,
            );
          }
        })();
      }),
    );
  }
}
