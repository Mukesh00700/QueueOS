/**
 * Event contracts.
 *
 * Every queue state change emits one of these. Today they travel over an
 * in-process emitter and are persisted to the `QueueEvent` table; the payload
 * shapes are deliberately serialisable so the transport can be swapped for
 * Kafka or RabbitMQ without touching producers or consumers.
 */

import type { Priority, TokenStatus } from './enums';

export const QUEUE_EVENTS = [
  'TokenCreated',
  'CustomerCheckedIn',
  'QueueJoined',
  'QueueAdvanced',
  'ETAUpdated',
  'RecallInitiated',
  'RecallConfirmed',
  'CounterAssigned',
  'ServiceStarted',
  'ServiceCompleted',
  'CustomerNoShow',
  'QueuePaused',
  'QueueResumed',
  'FeedbackSubmitted',
  'TokenTransferred',
  'PriorityChanged',
] as const;

export type QueueEventName = (typeof QUEUE_EVENTS)[number];

/** Envelope every event shares. Enables tenant-scoped fan-out and replay. */
export interface EventEnvelope<TPayload = unknown> {
  id: string;
  name: QueueEventName;
  organizationId: string;
  branchId: string;
  queueId?: string | null;
  tokenId?: string | null;
  /** ISO-8601. */
  occurredAt: string;
  /** Staff user or system actor that caused the change. */
  actorId?: string | null;
  payload: TPayload;
}

export interface TokenSnapshot {
  id: string;
  code: string;
  displayNumber: number;
  status: TokenStatus;
  priority: Priority;
  position: number | null;
  peopleAhead: number | null;
  etaMinutes: number | null;
  etaConfidence: number | null;
  counterId: string | null;
  counterName: string | null;
  providerName: string | null;
  customerName: string | null;
  joinedAt: string;
  calledAt: string | null;
  servedAt: string | null;
  completedAt: string | null;
}

export interface QueueSnapshot {
  id: string;
  name: string;
  status: string;
  waiting: number;
  serving: number;
  completedToday: number;
  noShowToday: number;
  currentToken: TokenSnapshot | null;
  nextTokens: TokenSnapshot[];
  averageWaitMinutes: number;
  averageServiceMinutes: number;
  openCounters: number;
}

/**
 * Socket.IO room naming. Kept here so the server and client cannot drift.
 * Rooms are always tenant-prefixed — a client can never subscribe to a room it
 * did not receive an id for.
 */
export const rooms = {
  branch: (branchId: string) => `branch:${branchId}`,
  queue: (queueId: string) => `queue:${queueId}`,
  token: (tokenId: string) => `token:${tokenId}`,
  counter: (counterId: string) => `counter:${counterId}`,
};

/** Wire event name for the realtime channel. */
export const REALTIME_CHANNEL = 'queueos:event';
