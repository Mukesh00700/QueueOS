import { z } from 'zod';

export const kitchenStatusSchema = z.object({
  status: z.enum(['QUEUED', 'PREPARING', 'READY']),
});

export type KitchenStatusDto = z.infer<typeof kitchenStatusSchema>;
