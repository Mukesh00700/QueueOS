import { z } from 'zod';

export const createSupplierSchema = z.object({
  name: z.string().trim().min(1).max(120),
  phone: z.string().trim().max(20).optional(),
  email: z.string().trim().email().optional(),
  notes: z.string().trim().max(500).optional(),
});

export type CreateSupplierDto = z.infer<typeof createSupplierSchema>;

export const updateSupplierSchema = createSupplierSchema.partial();

export type UpdateSupplierDto = z.infer<typeof updateSupplierSchema>;

export const createPurchaseOrderSchema = z.object({
  branchId: z.string().trim().min(1),
  supplierId: z.string().trim().min(1),
  notes: z.string().trim().max(500).optional(),
  items: z
    .array(
      z.object({
        productId: z.string().trim().min(1),
        quantity: z.number().int().positive().max(100_000),
        unitCost: z.number().min(0).max(10_000_000),
      }),
    )
    .min(1)
    .max(50),
});

export type CreatePurchaseOrderDto = z.infer<typeof createPurchaseOrderSchema>;
