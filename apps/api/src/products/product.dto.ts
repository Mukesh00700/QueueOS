import { z } from 'zod';
import { GST_RATES } from '@queueos/core';

export const createProductSchema = z.object({
  name: z.string().trim().min(1).max(120),
  category: z.string().trim().min(1).max(60),
  price: z.number().nonnegative().max(10_000_000),
  hsnSac: z.string().trim().max(20).optional(),
  gstRate: z
    .number()
    .refine((v) => (GST_RATES as readonly number[]).includes(v), { message: 'Invalid GST rate' })
    .optional(),
  trackStock: z.boolean().optional(),
});

export type CreateProductDto = z.infer<typeof createProductSchema>;

export const updateProductSchema = createProductSchema.partial().extend({
  active: z.boolean().optional(),
});

export type UpdateProductDto = z.infer<typeof updateProductSchema>;
