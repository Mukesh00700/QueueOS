import { z } from 'zod';
import { PAYMENT_METHODS } from '@queueos/core';

export const recordPaymentSchema = z.object({
  amount: z.number().positive().max(10_000_000),
  method: z.enum(PAYMENT_METHODS),
});

export type RecordPaymentDto = z.infer<typeof recordPaymentSchema>;

export const createCounterSchema = z.object({
  name: z.string().trim().min(1).max(60),
  queueId: z.string().trim().min(1).optional(),
});

export type CreateCounterDto = z.infer<typeof createCounterSchema>;

export const updateCounterSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  queueId: z.string().trim().min(1).nullable().optional(),
  staffUserId: z.string().trim().min(1).nullable().optional(),
});

export type UpdateCounterDto = z.infer<typeof updateCounterSchema>;
