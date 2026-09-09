import { z } from 'zod';
import { VERTICAL_IDS } from '@queueos/core';

const timeString = z
  .string()
  .trim()
  .regex(/^\d{2}:\d{2}$/, 'Expected HH:MM');

export const createBranchSchema = z.object({
  name: z.string().trim().min(1).max(120),
  code: z.string().trim().min(1).max(20),
  vertical: z.enum(VERTICAL_IDS).optional(),
  timezone: z.string().trim().min(1).max(60).optional(),
  address: z.string().trim().max(300).optional(),
  openTime: timeString.optional(),
  closeTime: timeString.optional(),
  /// FlowTemplate id from @queueos/core. Omitted entirely (not just unset)
  /// means "no flow" — the branch gets zero queues, exactly like every
  /// branch created before this field existed; staff add queues manually.
  flowTemplate: z.string().trim().min(1).max(60).optional(),
});

export type CreateBranchDto = z.infer<typeof createBranchSchema>;

export const updateBranchSchema = createBranchSchema.partial();

export type UpdateBranchDto = z.infer<typeof updateBranchSchema>;
