import { z } from 'zod';
import { PAYMENT_METHODS } from '@queueos/core';

/**
 * One or more tender lines — split tender is just this array carrying more
 * than one entry, not a separate flow. `Payment.invoiceId` was never
 * unique specifically so one invoice could carry several of these.
 */
export const recordPaymentSchema = z.object({
  tenders: z
    .array(
      z.object({
        amount: z.number().positive().max(10_000_000),
        method: z.enum(PAYMENT_METHODS),
      }),
    )
    .min(1)
    .max(4),
});

export type RecordPaymentDto = z.infer<typeof recordPaymentSchema>;

export const discountSchema = z
  .object({
    type: z.enum(['FLAT', 'PERCENT']),
    value: z.number().positive().max(10_000_000),
    reason: z.string().trim().min(1).max(200),
  })
  .refine((d) => d.type !== 'PERCENT' || d.value <= 100, {
    message: 'A percentage discount cannot exceed 100%',
    path: ['value'],
  });

export type DiscountDto = z.infer<typeof discountSchema>;

export const addOrderItemSchema = z.object({
  productId: z.string().trim().min(1),
  quantity: z.number().int().min(1).max(999).default(1),
});

export type AddOrderItemDto = z.infer<typeof addOrderItemSchema>;

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
