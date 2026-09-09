/**
 * Domain enums.
 *
 * These are const unions rather than TS `enum`s because the dev database is
 * SQLite, which Prisma does not support native enums on. Every enum-ish column
 * is a `String` in the schema and validated here instead. When the provider is
 * switched to PostgreSQL these can be promoted to real Prisma enums without any
 * application code changing.
 */

export const TOKEN_STATUSES = [
  'WAITING',
  'CALLED',
  'SERVING',
  'COMPLETED',
  'NO_SHOW',
  'RECALL_PENDING',
  'SKIPPED',
  'CANCELLED',
] as const;
export type TokenStatus = (typeof TOKEN_STATUSES)[number];

/** Statuses that still occupy a place in the line. */
export const ACTIVE_TOKEN_STATUSES: TokenStatus[] = [
  'WAITING',
  'CALLED',
  'SERVING',
  'RECALL_PENDING',
];

/** Statuses that mean the token has left the line for good. */
export const TERMINAL_TOKEN_STATUSES: TokenStatus[] = [
  'COMPLETED',
  'NO_SHOW',
  'CANCELLED',
];

export const QUEUE_STATUSES = ['OPEN', 'PAUSED', 'CLOSED'] as const;
export type QueueStatus = (typeof QUEUE_STATUSES)[number];

export const COUNTER_STATUSES = ['IDLE', 'SERVING', 'BREAK', 'CLOSED'] as const;
export type CounterStatus = (typeof COUNTER_STATUSES)[number];

/**
 * What kind of stage a queue represents in a branch's flow — see
 * queue-flow-design.md §3. A small, fixed taxonomy; new business shapes
 * compose from these rather than adding a type. CUSTOM is the default for
 * every queue that predates this concept or genuinely doesn't fit.
 */
export const STAGE_TYPES = [
  'ENTRY',
  'ORDERING',
  'CONSULTATION',
  'TRIAL',
  'PAYMENT',
  'PREPARATION',
  'SERVICE',
  'DEPARTMENT',
  'CUSTOM',
] as const;
export type StageType = (typeof STAGE_TYPES)[number];

/** Display label per stage type, for setup UI. */
export const STAGE_TYPE_LABELS: Record<StageType, string> = {
  ENTRY: 'Entry / Wait',
  ORDERING: 'Ordering',
  CONSULTATION: 'Consultation',
  TRIAL: 'Trial / Fitting',
  PAYMENT: 'Payment',
  PREPARATION: 'Preparation / Pickup',
  SERVICE: 'Service / Table',
  DEPARTMENT: 'Department',
  CUSTOM: 'Custom',
};

/**
 * Priority bands. Higher `weight` is served earlier; within a band tokens are
 * strictly FIFO by join time so the queue stays explainable to customers.
 */
export const PRIORITIES = ['NORMAL', 'PRIORITY', 'VIP', 'EMERGENCY'] as const;
export type Priority = (typeof PRIORITIES)[number];

export const PRIORITY_WEIGHT: Record<Priority, number> = {
  NORMAL: 0,
  PRIORITY: 10,
  VIP: 20,
  EMERGENCY: 100,
};

export const CHECKIN_SOURCES = [
  'QR',
  'KIOSK',
  'RECEPTION',
  'MOBILE_APP',
  'WEB',
  'WHATSAPP',
  'CHATBOT',
  'VOICE',
  'APPOINTMENT',
] as const;
export type CheckinSource = (typeof CHECKIN_SOURCES)[number];

/** How a Payment was collected. Minimal set — see build-plan.md Phase 8. */
export const PAYMENT_METHODS = ['CASH', 'CARD', 'UPI', 'WALLET'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** Standard Indian GST slabs, for the product catalogue's rate picker. */
export const GST_RATES = [0, 5, 12, 18, 28] as const;

export const NOTIFICATION_CHANNELS = [
  'PUSH',
  'SMS',
  'WHATSAPP',
  'EMAIL',
  'VOICE',
] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

/**
 * OWNER registers their own business and sees every branch under it — never
 * another organization's. ADMIN runs one specific branch. SUPER_ADMIN exists
 * only as a reserved rank: no capability is built around it anywhere in this
 * codebase, deliberately — see decision.md, 2026-09-07, on why no role is
 * allowed to see across businesses, including the platform operator.
 */
export const ROLES = [
  'SUPER_ADMIN',
  'OWNER',
  'ADMIN',
  'RECEPTION',
  'COUNTER_STAFF',
  'PROVIDER',
  'CASHIER',
  'CUSTOMER',
] as const;
export type Role = (typeof ROLES)[number];

/**
 * Role hierarchy used by the RBAC guard. A role satisfies a requirement if its
 * rank is greater than or equal to the required role's rank, except CUSTOMER
 * which is deliberately outside the staff hierarchy.
 */
export const ROLE_RANK: Record<Role, number> = {
  CUSTOMER: 0,
  COUNTER_STAFF: 10,
  CASHIER: 10,
  PROVIDER: 20,
  RECEPTION: 20,
  ADMIN: 40,
  OWNER: 60,
  SUPER_ADMIN: 100,
};
