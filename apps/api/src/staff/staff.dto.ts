import { z } from 'zod';

/**
 * Assignable via this endpoint. Excludes CUSTOMER (not a staff role at all)
 * and SUPER_ADMIN — no capability is ever built around that rank; see
 * packages/core/src/enums.ts.
 */
export const ASSIGNABLE_ROLES = [
  'OWNER',
  'ADMIN',
  'RECEPTION',
  'COUNTER_STAFF',
  'PROVIDER',
  'CASHIER',
] as const;

export const createStaffSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8).max(100),
  role: z.enum(ASSIGNABLE_ROLES),
  branchId: z.string().trim().min(1).optional(),
});

export type CreateStaffDto = z.infer<typeof createStaffSchema>;

export const updateStaffSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  role: z.enum(ASSIGNABLE_ROLES).optional(),
  branchId: z.string().trim().min(1).nullable().optional(),
  active: z.boolean().optional(),
});

export type UpdateStaffDto = z.infer<typeof updateStaffSchema>;

export const resetPasswordSchema = z.object({
  password: z.string().min(8).max(100),
});

export type ResetPasswordDto = z.infer<typeof resetPasswordSchema>;
