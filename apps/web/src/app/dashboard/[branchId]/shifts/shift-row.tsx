import { Pill } from '@/components/ui';
import type { ShiftRow } from '@/lib/api';
import { formatDate, timeAgo } from '@/lib/utils';

/** Local calendar day a shift closed on — used to group history by day. */
export function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const METHOD_LABELS: Record<string, string> = { CARD: 'Card', UPI: 'UPI', WALLET: 'Wallet' };

/** "Card ₹120.00 · UPI ₹45.00" — methods that took nothing this window are left out. */
export function nonCashSummary(nonCash: Record<string, number>): string {
  return Object.entries(nonCash)
    .filter(([, amount]) => amount > 0.004)
    .map(([method, amount]) => `${METHOD_LABELS[method] ?? method} ₹${amount.toFixed(2)}`)
    .join(' · ');
}

export function mergeNonCash(rows: Pick<ShiftRow, 'nonCash'>[]): Record<string, number> {
  const merged: Record<string, number> = {};
  for (const row of rows) {
    for (const [method, amount] of Object.entries(row.nonCash)) {
      merged[method] = (merged[method] ?? 0) + amount;
    }
  }
  return merged;
}

export function ShiftHistoryRow({ shift }: { shift: ShiftRow }) {
  const variance = shift.variance ?? 0;
  const settled = Math.abs(variance) < 0.01;
  const nonCash = nonCashSummary(shift.nonCash);
  return (
    <div className="flex items-center justify-between gap-4 px-5 py-4">
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold">
          {shift.closedAt ? formatDate(new Date(shift.closedAt)) : '—'}
        </p>
        <p className="truncate text-xs text-muted">
          {shift.closedAt ? timeAgo(shift.closedAt) : ''} · float ₹{shift.openingCash.toFixed(2)}
        </p>
        {nonCash ? <p className="truncate text-xs text-subtle">{nonCash}</p> : null}
      </div>
      <div className="flex shrink-0 items-center gap-3 text-right">
        <div>
          <p className="text-xs text-subtle">Expected ₹{shift.expectedCash.toFixed(2)}</p>
          <p className="text-xs text-subtle">Counted ₹{(shift.countedCash ?? 0).toFixed(2)}</p>
        </div>
        <Pill tone={settled ? 'success' : variance > 0 ? 'accent' : 'danger'}>
          {settled ? 'Settled' : `${variance > 0 ? '+' : '−'}₹${Math.abs(variance).toFixed(2)}`}
        </Pill>
      </div>
    </div>
  );
}
