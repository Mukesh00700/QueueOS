import { z } from 'zod';
import { PAYMENT_METHODS } from '@queueos/core';

export const refundSchema = z.object({
  amount: z.number().positive().max(10_000_000),
  method: z.enum(PAYMENT_METHODS),
  reason: z.string().trim().min(1).max(300),
});

export type RefundDto = z.infer<typeof refundSchema>;
