'use client';

import { useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { REALTIME_CHANNEL, type EventEnvelope, type QueueEventName } from '@queueos/core';
import { API_URL } from './api';

interface Subscription {
  branchId?: string;
  queueIds?: string[];
  tokenIds?: string[];
}

/**
 * One socket per tab, shared across every hook instance.
 *
 * Each screen mounts several components that all care about live events; giving
 * each its own connection would open a dozen sockets per operator.
 */
let shared: Socket | null = null;
function getSocket(): Socket {
  if (!shared) {
    shared = io(API_URL, { transports: ['websocket', 'polling'] });
  }
  return shared;
}

/**
 * Subscribes to the branch/queue/token rooms and invokes `onEvent` for each
 * domain event. `onEvent` is held in a ref so a caller passing an inline arrow
 * function does not tear down and rebuild the subscription on every render.
 */
export function useRealtime(
  subscription: Subscription,
  onEvent: (event: EventEnvelope) => void,
) {
  const [connected, setConnected] = useState(false);
  const handlerRef = useRef(onEvent);
  handlerRef.current = onEvent;

  const key = JSON.stringify(subscription);

  useEffect(() => {
    const socket = getSocket();
    const sub: Subscription = JSON.parse(key);

    const subscribe = () => {
      setConnected(true);
      socket.emit('subscribe', sub);
    };

    if (socket.connected) subscribe();
    socket.on('connect', subscribe);
    socket.on('disconnect', () => setConnected(false));

    const listener = (event: EventEnvelope) => handlerRef.current(event);
    socket.on(REALTIME_CHANNEL, listener);

    return () => {
      socket.off(REALTIME_CHANNEL, listener);
      socket.off('connect', subscribe);
      socket.emit('unsubscribe', sub);
    };
  }, [key]);

  return { connected };
}

/** Events that change what is on screen and therefore warrant a refetch. */
export const REFRESH_EVENTS: QueueEventName[] = [
  'QueueJoined',
  'QueueAdvanced',
  'CounterAssigned',
  'ServiceStarted',
  'ServiceCompleted',
  'CustomerNoShow',
  'RecallInitiated',
  'RecallConfirmed',
  'QueuePaused',
  'QueueResumed',
];
