import { randomBytes } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { PRIORITY_WEIGHT, type Priority } from '@queueos/core';

/**
 * Ordering.
 *
 * A token's place in line is a single float, `sortKey`, ascending. It is
 * derived from join time minus a credit earned by priority band. Expressing
 * priority as a time credit rather than a separate sort column keeps the queue
 * explainable — "emergency cases are treated as if they arrived ten hours ago"
 * is something a receptionist can say to a waiting room, and a NORMAL token
 * never gets silently starved by a steady trickle of VIPs the way a strict
 * multi-band sort would.
 */
const PRIORITY_CREDIT_MS = 6 * 60_000;

export function sortKeyFor(joinedAt: Date, priority: Priority): number {
  return joinedAt.getTime() - PRIORITY_WEIGHT[priority] * PRIORITY_CREDIT_MS;
}

/**
 * The one true ordering of a line.
 *
 * `sortKey` alone is not a total order: two people can join in the same
 * millisecond, and the recall penalty bisects neighbouring keys, which collapses
 * to an exact tie when those neighbours are already equal. Ties left unbroken
 * mean the database may return them in any order, so a screen listing the queue
 * and a screen counting someone's place can disagree — which is exactly how a
 * token showed as 5th on the customer's phone and 7th on the staff board.
 *
 * Every query that walks the line must use this, so there is only ever one
 * answer to "who is in front of whom" — including the query that decides who
 * NEXT calls, which must agree with the up-next list the operator is reading.
 */
export const IN_LINE_ORDER: Prisma.TokenOrderByWithRelationInput[] = [
  { sortKey: 'asc' },
  { id: 'asc' },
];

/**
 * Public token code. Used in the customer URL, so it must not be guessable —
 * a sequential id would let anyone enumerate other people's queue positions
 * and personal details.
 */
export function generateTokenCode(): string {
  return randomBytes(9).toString('base64url');
}

/** Formats the number shown on the board and TV display. */
export function formatDisplayCode(prefix: string, displayNumber: number): string {
  return `${prefix}${displayNumber}`;
}

export function minutesBetween(from: Date, to: Date): number {
  return Math.max(0, (to.getTime() - from.getTime()) / 60_000);
}

export function roundTo(n: number, decimals = 2): number {
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
}
