'use client';

import {
  BellRing,
  Building2,
  CheckCircle2,
  ChefHat,
  Circle,
  ClipboardCheck,
  DoorOpen,
  FileCheck,
  Flame,
  Flower2,
  HeartPulse,
  ListOrdered,
  Receipt,
  Scissors,
  ShoppingBag,
  ShoppingCart,
  Sparkles,
  Stethoscope,
  Store,
  Users,
  type LucideIcon,
} from 'lucide-react';
import type { JourneyStage } from '@queueos/core';
import { cn } from '@/lib/utils';

/**
 * Vertical profiles reference icons by name so the profile data stays
 * serialisable and could later come from the database. This is the only place
 * that resolves those names to components.
 */
const ICONS: Record<string, LucideIcon> = {
  BellRing,
  Building2,
  CheckCircle2,
  ChefHat,
  ClipboardCheck,
  DoorOpen,
  FileCheck,
  Flame,
  Flower2,
  HeartPulse,
  ListOrdered,
  Receipt,
  Scissors,
  ShoppingBag,
  ShoppingCart,
  Sparkles,
  Stethoscope,
  Store,
  Users,
};

export function JourneyTrail({ stages, activeIndex }: { stages: JourneyStage[]; activeIndex: number }) {
  return (
    <ol className="space-y-0">
      {stages.map((stage, index) => {
        const Icon = ICONS[stage.icon] ?? Circle;
        const done = index < activeIndex;
        const active = index === activeIndex;
        const last = index === stages.length - 1;

        return (
          <li key={stage.id} className="flex gap-3">
            <div className="flex flex-col items-center">
              <span
                className={cn(
                  'grid h-8 w-8 shrink-0 place-items-center rounded-full border transition-colors',
                  done && 'border-success/30 bg-success/10 text-success',
                  active && 'border-accent bg-accent text-white',
                  !done && !active && 'border-line bg-raised text-subtle',
                )}
              >
                <Icon size={15} />
              </span>
              {!last ? (
                <span className={cn('w-px flex-1 min-h-6', done ? 'bg-success/30' : 'bg-line')} />
              ) : null}
            </div>
            <div className={cn('pb-5', last && 'pb-0')}>
              <p
                className={cn(
                  'text-sm leading-8',
                  active ? 'font-semibold text-fg' : done ? 'text-muted' : 'text-subtle',
                )}
              >
                {stage.label}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
