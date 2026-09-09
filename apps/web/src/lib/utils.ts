import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatClock(date: Date): string {
  return date.toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

export function formatDate(date: Date): string {
  return date.toLocaleDateString('en-IN', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

export function timeAgo(iso: string): string {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 45) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

export function greeting(date = new Date()): string {
  const h = date.getHours();
  if (h < 12) return 'Good Morning';
  if (h < 17) return 'Good Afternoon';
  return 'Good Evening';
}

/**
 * Queue pressure, expressed as the tail wait in minutes. Used for the heat map
 * and status pills so "busy" means the same thing on every screen.
 */
export function queueHeat(
  waiting: number,
  openCounters: number,
  averageServiceMinutes: number,
): { level: 'fast' | 'busy' | 'critical'; tailMinutes: number } {
  const tailMinutes = Math.round((waiting / Math.max(1, openCounters)) * averageServiceMinutes);
  if (tailMinutes <= 15) return { level: 'fast', tailMinutes };
  if (tailMinutes <= 40) return { level: 'busy', tailMinutes };
  return { level: 'critical', tailMinutes };
}

export const HEAT_COLORS = {
  fast: { text: 'text-success', bg: 'bg-success/10', ring: 'ring-success/30', raw: 'var(--success)' },
  busy: { text: 'text-warning', bg: 'bg-warning/10', ring: 'ring-warning/30', raw: 'var(--warning)' },
  critical: { text: 'text-danger', bg: 'bg-danger/10', ring: 'ring-danger/30', raw: 'var(--danger)' },
} as const;
