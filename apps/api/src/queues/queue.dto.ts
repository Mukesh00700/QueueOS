import { z } from 'zod';
import { STAGE_TYPES } from '@queueos/core';

export const createQueueSchema = z.object({
  name: z.string().trim().min(1).max(80),
  department: z.string().trim().max(80).optional(),
  tokenPrefix: z.string().trim().min(1).max(4).optional(),
  baselineServiceMinutes: z.number().int().min(1).max(240).optional(),
  recallGraceMinutes: z.number().int().min(1).max(60).optional(),
  recallPenaltyPositions: z.number().int().min(0).max(50).optional(),
  displayOrder: z.number().int().min(0).optional(),
  stageType: z.enum(STAGE_TYPES).optional(),
  nextQueueId: z.string().trim().min(1).optional(),
  hasVisibleQueue: z.boolean().optional(),
});

export type CreateQueueDto = z.infer<typeof createQueueSchema>;

export const updateQueueSchema = createQueueSchema.partial().extend({
  // Distinct from the other fields: needs a `null` to mean "clear the link,"
  // which `.partial()` alone can't express (it only adds `undefined`).
  nextQueueId: z.string().trim().min(1).nullable().optional(),
});

export type UpdateQueueDto = z.infer<typeof updateQueueSchema>;

export const createServiceTypeSchema = z.object({
  name: z.string().trim().min(1).max(80),
  durationMinutes: z.number().int().min(1).max(480).optional(),
});

export type CreateServiceTypeDto = z.infer<typeof createServiceTypeSchema>;

export const updateServiceTypeSchema = createServiceTypeSchema.partial();

export type UpdateServiceTypeDto = z.infer<typeof updateServiceTypeSchema>;
