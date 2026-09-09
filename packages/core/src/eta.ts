/**
 * ETA model.
 *
 * The product promise is "exactly when should I leave your seat", so this has
 * to do better than `peopleAhead * averageServiceTime`. The model is a
 * deterministic queueing estimate rather than a learned one — it runs in under
 * a millisecond, is explainable to an operator, and produces the feature vector
 * that a gradient-boosted model would later be trained on.
 *
 * It is a pure function on purpose: the API computes the authoritative value,
 * and the web client re-runs the identical code between socket pushes so the
 * countdown ticks smoothly instead of jumping.
 */

export interface ServiceStats {
  /** Rolling mean service duration in minutes for this queue. */
  meanMinutes: number;
  /** Rolling standard deviation in minutes. Drives the confidence band. */
  stdDevMinutes: number;
  /** How many completed services the stats are based on. */
  sampleSize: number;
}

export interface EtaInput {
  /** Active tokens ahead of this one, after priority ordering. */
  peopleAhead: number;
  /** Counters currently able to take someone. Never trusted below 1. */
  openCounters: number;
  stats: ServiceStats;
  /**
   * Minutes already elapsed on services in progress. Someone 8 minutes into a
   * 10 minute consultation should not be counted as a full service ahead of you.
   */
  inProgressElapsedMinutes?: number[];
  /**
   * Tokens ahead that are in RECALL_PENDING. They usually resolve to a no-show,
   * so they are counted at a fraction of a full service.
   */
  recallPendingAhead?: number;
  /** Multiplier from the historical hour-of-week load curve. 1.0 is neutral. */
  loadFactor?: number;
  /** Queue is paused — ETA is unknowable, flagged rather than guessed. */
  paused?: boolean;
}

export interface EtaResult {
  /** Minutes until this token is expected to be called. */
  minutes: number;
  /** 0-1. Surfaced to the customer so they know how much to trust the number. */
  confidence: number;
  /** 0-1 probability the queue slips materially beyond the estimate. */
  delayRisk: number;
  /** Optimistic / pessimistic bounds, one standard deviation wide. */
  rangeMinutes: [number, number];
  /** Human-readable drivers, shown in the operator AI panel. */
  factors: string[];
}

/** A recall-pending token resolves to an actual service about a third of the time. */
const RECALL_SERVICE_WEIGHT = 0.35;

/** Below this many samples the mean is not yet trustworthy. */
const MIN_CONFIDENT_SAMPLES = 12;

export const DEFAULT_SERVICE_STATS: ServiceStats = {
  meanMinutes: 8,
  stdDevMinutes: 3,
  sampleSize: 0,
};

export function computeEta(input: EtaInput): EtaResult {
  const {
    peopleAhead,
    stats,
    inProgressElapsedMinutes = [],
    recallPendingAhead = 0,
    loadFactor = 1,
    paused = false,
  } = input;

  const openCounters = Math.max(1, input.openCounters);
  const mean = stats.meanMinutes > 0 ? stats.meanMinutes : DEFAULT_SERVICE_STATS.meanMinutes;
  const factors: string[] = [];

  // Services already underway only contribute their remaining time.
  const remainingInProgress = inProgressElapsedMinutes.reduce(
    (sum, elapsed) => sum + Math.max(0, mean - elapsed),
    0,
  );
  if (inProgressElapsedMinutes.length > 0) {
    factors.push(
      `${inProgressElapsedMinutes.length} in progress, ~${Math.round(remainingInProgress)} min left`,
    );
  }

  // Tokens strictly waiting, excluding the recall-pending ones counted below.
  const fullServicesAhead = Math.max(0, peopleAhead - recallPendingAhead);
  const weightedServicesAhead = fullServicesAhead + recallPendingAhead * RECALL_SERVICE_WEIGHT;

  if (recallPendingAhead > 0) {
    factors.push(`${recallPendingAhead} awaiting recall, likely to be skipped`);
  }

  // Work is spread across open counters; in-progress work is already assigned.
  const workMinutes = weightedServicesAhead * mean;
  const raw = workMinutes / openCounters + remainingInProgress / openCounters;

  const adjusted = raw * clamp(loadFactor, 0.6, 2);
  if (loadFactor > 1.15) {
    factors.push(`Peak load, +${Math.round((loadFactor - 1) * 100)}% service time`);
  } else if (loadFactor < 0.9) {
    factors.push(`Off-peak, service running faster than average`);
  }

  if (openCounters > 1) {
    factors.push(`${openCounters} ${input.openCounters === 1 ? 'counter' : 'counters'} open`);
  }

  const minutes = paused ? Math.round(adjusted) : Math.max(0, Math.round(adjusted));

  // Variance compounds across the people ahead of you, so uncertainty grows
  // with queue depth rather than staying flat.
  const depth = Math.max(1, weightedServicesAhead);
  const propagatedStdDev = (stats.stdDevMinutes * Math.sqrt(depth)) / openCounters;

  const sampleConfidence = clamp(stats.sampleSize / MIN_CONFIDENT_SAMPLES, 0.35, 1);
  const varianceConfidence =
    minutes <= 0 ? 1 : clamp(1 - propagatedStdDev / Math.max(minutes, mean), 0.3, 1);

  let confidence = clamp(sampleConfidence * varianceConfidence, 0.3, 0.99);
  if (paused) {
    confidence = Math.min(confidence, 0.4);
    factors.unshift('Queue is paused — estimate is provisional');
  }

  // Risk rises when the line is deep, the service time is erratic, or there is
  // only one counter absorbing all of it.
  const delayRisk = clamp(
    0.15 +
      (propagatedStdDev / Math.max(mean, 1)) * 0.25 +
      (weightedServicesAhead > openCounters * 8 ? 0.25 : 0) +
      (openCounters === 1 && weightedServicesAhead > 5 ? 0.15 : 0),
    0,
    0.95,
  );

  return {
    minutes,
    confidence: round2(confidence),
    delayRisk: round2(delayRisk),
    rangeMinutes: [
      Math.max(0, Math.round(minutes - propagatedStdDev)),
      Math.round(minutes + propagatedStdDev),
    ],
    factors,
  };
}

/**
 * Rolling stats from raw completed-service durations. Outliers past three
 * sigma are dropped — a counter left open over lunch would otherwise poison
 * the mean for the rest of the day.
 */
export function serviceStatsFrom(durationsMinutes: number[]): ServiceStats {
  const clean = durationsMinutes.filter((d) => Number.isFinite(d) && d > 0);
  if (clean.length === 0) return { ...DEFAULT_SERVICE_STATS };

  const mean0 = avg(clean);
  const sd0 = stdDev(clean, mean0);
  const trimmed = sd0 === 0 ? clean : clean.filter((d) => Math.abs(d - mean0) <= 3 * sd0);
  const source = trimmed.length > 0 ? trimmed : clean;

  const mean = avg(source);
  return {
    meanMinutes: round2(mean),
    stdDevMinutes: round2(stdDev(source, mean)),
    sampleSize: source.length,
  };
}

/**
 * Hour-of-day load curve. Until enough history exists to fit a real curve this
 * encodes the shape every walk-in service shares: a morning surge, a midday
 * peak, a lunch dip and an evening tail.
 */
export function loadFactorForHour(hour: number): number {
  const curve: Record<number, number> = {
    8: 0.85,
    9: 1.05,
    10: 1.2,
    11: 1.3,
    12: 1.15,
    13: 0.8,
    14: 0.9,
    15: 1.0,
    16: 1.1,
    17: 1.15,
    18: 1.05,
    19: 0.9,
  };
  return curve[hour] ?? 0.75;
}

/** The customer-facing sentence. Vague on purpose when confidence is low. */
export function describeEta(eta: EtaResult, tokenWord = 'turn'): string {
  if (eta.minutes <= 0) return `Your ${tokenWord} is now`;
  if (eta.minutes <= 2) return `Your ${tokenWord} is next`;
  if (eta.confidence < 0.5) {
    return `Your ${tokenWord} in roughly ${eta.rangeMinutes[0]}–${eta.rangeMinutes[1]} minutes`;
  }
  return `Your ${tokenWord} in about ${eta.minutes} minutes`;
}

/** Notification thresholds from the spec, in minutes remaining. */
export const ETA_ALERT_THRESHOLDS = [30, 15, 10, 5, 0];

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function avg(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function stdDev(values: number[], mean: number): number {
  if (values.length < 2) return 0;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
