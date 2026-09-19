import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import webpush from 'web-push';
import { PrismaService } from '../prisma/prisma.service';

export interface WebPushSubscriptionDto {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/**
 * Real Web Push delivery — what `QueueService.maybeNotify` used to only
 * simulate. No paid gateway: Web Push rides free through the browser
 * vendor's own push service (Chrome via Google, Firefox via Mozilla, etc.),
 * authenticated by this app's own VAPID key pair rather than an account with
 * a third party.
 */
@Injectable()
export class PushService implements OnModuleInit {
  private readonly logger = new Logger(PushService.name);
  private configured = false;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    const publicKey = process.env.VAPID_PUBLIC_KEY;
    const privateKey = process.env.VAPID_PRIVATE_KEY;
    const subject = process.env.VAPID_SUBJECT;
    if (!publicKey || !privateKey || !subject) {
      this.logger.warn('VAPID keys not configured — push notifications will be simulated only.');
      return;
    }
    webpush.setVapidDetails(subject, publicKey, privateKey);
    this.configured = true;
  }

  /** Re-subscribing the same browser (same endpoint) just updates its keys. */
  async subscribe(tokenId: string, sub: WebPushSubscriptionDto) {
    await this.prisma.pushSubscription.upsert({
      where: { endpoint: sub.endpoint },
      create: { tokenId, endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth },
      update: { tokenId, p256dh: sub.keys.p256dh, auth: sub.keys.auth },
    });
  }

  /**
   * Sends to every subscription registered for this token (normally one —
   * whichever browser tapped "Notify me"). Returns whether at least one send
   * succeeded, so the caller can record a real delivery outcome instead of
   * always writing SIMULATED. A 404/410 means the browser itself discarded
   * the subscription (uninstalled, permissions revoked, expired) — that
   * subscription is deleted rather than retried forever.
   */
  async send(tokenId: string, payload: { title: string; body: string }): Promise<boolean> {
    if (!this.configured) return false;

    const subs = await this.prisma.pushSubscription.findMany({ where: { tokenId } });
    if (subs.length === 0) return false;

    const results = await Promise.all(
      subs.map(async (sub) => {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            JSON.stringify(payload),
          );
          return true;
        } catch (err) {
          const statusCode = (err as { statusCode?: number }).statusCode;
          if (statusCode === 404 || statusCode === 410) {
            await this.prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => {});
          } else {
            this.logger.warn(`Push send failed for token ${tokenId}: ${(err as Error).message}`);
          }
          return false;
        }
      }),
    );

    return results.some(Boolean);
  }
}
