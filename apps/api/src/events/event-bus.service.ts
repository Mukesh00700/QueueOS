import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter } from 'node:events';
import type { EventEnvelope, QueueEventName } from '@queueos/core';
import { PrismaService } from '../prisma/prisma.service';

export interface EmitInput {
  name: QueueEventName;
  organizationId: string;
  branchId: string;
  queueId?: string | null;
  tokenId?: string | null;
  actorId?: string | null;
  payload?: Record<string, unknown>;
}

/**
 * The single write path for domain events.
 *
 * Two things happen for every event: it is appended to the QueueEvent table
 * (audit trail, analytics source, and replay log) and it is published to
 * in-process subscribers, which today means the realtime gateway.
 *
 * This is the seam where Kafka goes. `publish` would become a producer call and
 * subscribers would become consumer groups; nothing upstream of this class
 * knows or cares about the transport.
 */
@Injectable()
export class EventBusService {
  private readonly logger = new Logger(EventBusService.name);
  private readonly emitter = new EventEmitter();

  constructor(private readonly prisma: PrismaService) {
    // A busy branch has many concurrent display, counter and customer sockets.
    this.emitter.setMaxListeners(100);
  }

  async publish(input: EmitInput): Promise<EventEnvelope> {
    const record = await this.prisma.queueEvent.create({
      data: {
        name: input.name,
        organizationId: input.organizationId,
        branchId: input.branchId,
        queueId: input.queueId ?? null,
        tokenId: input.tokenId ?? null,
        actorId: input.actorId ?? null,
        payload: JSON.stringify(input.payload ?? {}),
      },
    });

    const envelope: EventEnvelope = {
      id: record.id,
      name: input.name,
      organizationId: input.organizationId,
      branchId: input.branchId,
      queueId: input.queueId ?? null,
      tokenId: input.tokenId ?? null,
      occurredAt: record.occurredAt.toISOString(),
      actorId: input.actorId ?? null,
      payload: input.payload ?? {},
    };

    // Delivery must never break the state transition that produced the event.
    try {
      this.emitter.emit('event', envelope);
    } catch (err) {
      this.logger.error(`Subscriber threw handling ${input.name}`, err as Error);
    }

    return envelope;
  }

  subscribe(handler: (event: EventEnvelope) => void): () => void {
    this.emitter.on('event', handler);
    return () => this.emitter.off('event', handler);
  }

  /** Recent activity for the notification centre timeline. */
  async recent(branchId: string, limit = 25) {
    const rows = await this.prisma.queueEvent.findMany({
      where: { branchId },
      orderBy: { occurredAt: 'desc' },
      take: limit,
    });
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      queueId: r.queueId,
      tokenId: r.tokenId,
      occurredAt: r.occurredAt.toISOString(),
      payload: safeParse(r.payload),
    }));
  }
}

function safeParse(json: string): Record<string, unknown> {
  try {
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return {};
  }
}
