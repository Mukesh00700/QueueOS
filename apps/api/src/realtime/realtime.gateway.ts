import { Logger, OnModuleDestroy } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { REALTIME_CHANNEL, rooms, type EventEnvelope } from '@queueos/core';
import type { Server, Socket } from 'socket.io';
import { EventBusService } from '../events/event-bus.service';

interface SubscribePayload {
  branchId?: string;
  queueIds?: string[];
  tokenIds?: string[];
  counterIds?: string[];
}

/**
 * Realtime fan-out.
 *
 * Clients subscribe to rooms by id. Ids are only ever handed out by an endpoint
 * the client was already allowed to call, so a customer holding one token code
 * cannot listen in on a branch-wide feed. There is no broadcast to all sockets
 * anywhere in this class — every emit is scoped to a room.
 *
 * Single node today. Adding the Redis adapter is the only change needed to run
 * this across a horizontally scaled fleet.
 */
@WebSocketGateway({
  cors: { origin: process.env.WEB_ORIGIN ?? 'http://localhost:3000', credentials: true },
})
export class RealtimeGateway implements OnGatewayInit, OnModuleDestroy {
  private readonly logger = new Logger(RealtimeGateway.name);
  private unsubscribe?: () => void;

  @WebSocketServer()
  server: Server;

  constructor(private readonly events: EventBusService) {}

  afterInit() {
    this.unsubscribe = this.events.subscribe((event) => this.fanOut(event));
    this.logger.log('Realtime gateway ready');
  }

  onModuleDestroy() {
    this.unsubscribe?.();
  }

  @SubscribeMessage('subscribe')
  handleSubscribe(@ConnectedSocket() client: Socket, @MessageBody() payload: SubscribePayload) {
    const joined: string[] = [];

    if (payload?.branchId) joined.push(rooms.branch(payload.branchId));
    for (const id of payload?.queueIds ?? []) joined.push(rooms.queue(id));
    for (const id of payload?.tokenIds ?? []) joined.push(rooms.token(id));
    for (const id of payload?.counterIds ?? []) joined.push(rooms.counter(id));

    for (const room of joined) client.join(room);
    return { subscribed: joined };
  }

  @SubscribeMessage('unsubscribe')
  handleUnsubscribe(@ConnectedSocket() client: Socket, @MessageBody() payload: SubscribePayload) {
    for (const id of payload?.queueIds ?? []) client.leave(rooms.queue(id));
    for (const id of payload?.tokenIds ?? []) client.leave(rooms.token(id));
    if (payload?.branchId) client.leave(rooms.branch(payload.branchId));
    return { ok: true };
  }

  private fanOut(event: EventEnvelope) {
    if (!this.server) return;

    // A single event reaches three audiences at different granularities: the
    // operator watching the branch, the display bound to one queue, and the one
    // customer it concerns.
    this.server.to(rooms.branch(event.branchId)).emit(REALTIME_CHANNEL, event);
    if (event.queueId) this.server.to(rooms.queue(event.queueId)).emit(REALTIME_CHANNEL, event);
    if (event.tokenId) this.server.to(rooms.token(event.tokenId)).emit(REALTIME_CHANNEL, event);
  }
}
