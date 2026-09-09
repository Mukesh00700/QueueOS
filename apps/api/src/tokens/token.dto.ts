import { z } from 'zod';
import { CHECKIN_SOURCES, PRIORITIES } from '@queueos/core';

export const transferTokenSchema = z.object({
  targetQueueId: z.string().trim().min(1),
});

export type TransferTokenDto = z.infer<typeof transferTokenSchema>;

export const changePrioritySchema = z.object({
  priority: z.enum(PRIORITIES),
  reason: z.string().trim().min(1).max(300),
});

export type ChangePriorityDto = z.infer<typeof changePrioritySchema>;

export const joinQueueSchema = z.object({
  name: z.string().trim().min(1).max(80),
  // Loose on purpose: this has to accept international formats and whatever a
  // kiosk keypad produces. Normalisation belongs in the notification gateway.
  phone: z.string().trim().min(6).max(20),
  email: z.string().trim().email().optional(),
  priority: z.enum(PRIORITIES).optional(),
  source: z.enum(CHECKIN_SOURCES).optional(),
  serviceTypeId: z.string().optional(),
  isSeniorCitizen: z.boolean().optional(),
  needsAssistance: z.boolean().optional(),
  notes: z.string().max(500).optional(),
});

export type JoinQueueDto = z.infer<typeof joinQueueSchema>;

export const feedbackSchema = z.object({
  rating: z.number().int().min(1).max(5),
  comment: z.string().max(1000).optional(),
});

export type FeedbackDto = z.infer<typeof feedbackSchema>;
