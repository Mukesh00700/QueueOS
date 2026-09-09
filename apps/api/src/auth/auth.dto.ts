import { z } from 'zod';
import { VERTICAL_IDS } from '@queueos/core';

export const registerSchema = z.object({
  businessName: z.string().trim().min(1).max(120),
  vertical: z.enum(VERTICAL_IDS),
  /// FlowTemplate id from @queueos/core — how many stages, what order. An
  /// unrecognized id falls back to the single-queue template.
  flowTemplate: z.string().trim().min(1).max(60).optional(),
  ownerName: z.string().trim().min(1).max(120),
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8).max(100),
});

export type RegisterDto = z.infer<typeof registerSchema>;
