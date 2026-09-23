import { z } from 'zod';

export const openShiftSchema = z.object({
  openingCash: z.number().min(0).max(10_000_000).default(0),
});

export type OpenShiftDto = z.infer<typeof openShiftSchema>;

export const closeShiftSchema = z.object({
  countedCash: z.number().min(0).max(10_000_000),
});

export type CloseShiftDto = z.infer<typeof closeShiftSchema>;
