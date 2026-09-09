'use client';

import { motion } from 'framer-motion';
import { forwardRef, useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * Hand-written primitives rather than the shadcn CLI. Same Radix-free
 * structure and the same class conventions, but with the design tokens from
 * globals.css baked in, so a Card is correct in light, dark and all six
 * vertical accents without per-screen overrides.
 */

export function Card({
  className,
  children,
  ...props
}: { className?: string; children: ReactNode } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'rounded-2xl border border-line bg-card',
        'shadow-[var(--shadow-card)]',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  subtitle,
  action,
  icon,
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex items-start justify-between gap-4 px-5 pt-5 pb-3', className)}>
      <div className="flex items-center gap-2.5 min-w-0">
        {icon ? <span className="text-muted shrink-0">{icon}</span> : null}
        <div className="min-w-0">
          <h3 className="text-[15px] font-semibold leading-tight truncate">{title}</h3>
          {subtitle ? <p className="text-xs text-muted mt-0.5">{subtitle}</p> : null}
        </div>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'success' | 'warning' | 'danger' | 'ai';
type ButtonSize = 'sm' | 'md' | 'lg' | 'xl';

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-accent-fg hover:brightness-110 active:brightness-95',
  secondary: 'bg-raised text-fg border border-line hover:border-line-strong',
  ghost: 'text-muted hover:text-fg hover:bg-raised',
  success: 'bg-success text-white hover:brightness-110',
  warning: 'bg-warning text-white hover:brightness-110',
  danger: 'bg-danger text-white hover:brightness-110',
  ai: 'bg-ai text-white hover:brightness-110',
};

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-xs rounded-lg gap-1.5',
  md: 'h-10 px-4 text-sm rounded-xl gap-2',
  lg: 'h-12 px-5 text-base rounded-xl gap-2',
  // Counter tablets are used standing up, often in a hurry.
  xl: 'h-20 px-6 text-xl font-semibold rounded-2xl gap-3',
};

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: ButtonVariant;
    size?: ButtonSize;
    loading?: boolean;
  }
>(function Button(
  { className, variant = 'primary', size = 'md', loading, children, disabled, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        'inline-flex items-center justify-center font-medium transition-all duration-150',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface',
        'disabled:opacity-45 disabled:cursor-not-allowed disabled:hover:brightness-100',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    >
      {loading ? <Spinner /> : null}
      {children}
    </button>
  );
});

function Spinner() {
  return (
    <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
  );
}

type PillTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'ai';

const PILL_TONES: Record<PillTone, string> = {
  neutral: 'bg-raised text-muted border-line',
  accent: 'bg-accent/10 text-accent border-accent/20',
  success: 'bg-success/10 text-success border-success/20',
  warning: 'bg-warning/10 text-warning border-warning/20',
  danger: 'bg-danger/10 text-danger border-danger/20',
  ai: 'bg-ai/10 text-ai border-ai/20',
};

export function Pill({
  tone = 'neutral',
  children,
  className,
  dot,
}: {
  tone?: PillTone;
  children: ReactNode;
  className?: string;
  dot?: boolean;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium leading-none',
        PILL_TONES[tone],
        className,
      )}
    >
      {dot ? <span className="live-dot h-1.5 w-1.5 rounded-full bg-current" /> : null}
      {children}
    </span>
  );
}

/**
 * Counts from the previous value to the new one.
 *
 * Queue numbers change constantly and a hard swap reads as a page reload. The
 * roll makes it obvious that one specific figure moved, which is the whole
 * point of a live dashboard.
 */
export function AnimatedNumber({
  value,
  className,
  duration = 500,
}: {
  value: number;
  className?: string;
  duration?: number;
}) {
  const [display, setDisplay] = useState(value);
  const fromRef = useRef(value);
  const frameRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    const from = fromRef.current;
    if (from === value) return;

    const start = performance.now();
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / duration);
      // Ease-out cubic: fast initial movement, gentle settle.
      const eased = 1 - (1 - progress) ** 3;
      setDisplay(Math.round(from + (value - from) * eased));
      if (progress < 1) frameRef.current = requestAnimationFrame(tick);
      else fromRef.current = value;
    };

    frameRef.current = requestAnimationFrame(tick);
    return () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
      fromRef.current = value;
    };
  }, [value, duration]);

  return <span className={cn('tnum', className)}>{display}</span>;
}

/** Circular progress used for ETA and confidence. */
export function ProgressRing({
  progress,
  size = 160,
  stroke = 10,
  color = 'var(--accent)',
  trackClassName,
  children,
}: {
  /** 0-1 */
  progress: number;
  size?: number;
  stroke?: number;
  color?: string;
  trackClassName?: string;
  children?: ReactNode;
}) {
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(1, progress));

  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          className={cn('stroke-line', trackClassName)}
        />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          initial={false}
          animate={{ strokeDashoffset: circumference * (1 - clamped) }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">{children}</div>
    </div>
  );
}

export function Select({
  className,
  children,
  ...props
}: { className?: string; children: ReactNode } & React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        'h-11 w-full rounded-xl border border-line bg-raised px-3.5 text-sm outline-none transition-colors focus:border-accent',
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-lg bg-line', className)} />;
}

export function EmptyState({ icon, title, detail }: { icon?: ReactNode; title: string; detail?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
      {icon ? <div className="text-subtle">{icon}</div> : null}
      <p className="text-sm font-medium text-muted">{title}</p>
      {detail ? <p className="text-xs text-subtle max-w-xs">{detail}</p> : null}
    </div>
  );
}
