import type { QueueSnapshot } from '@queueos/core';

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

const TOKEN_KEY = 'queueos.token';

export function getStoredToken(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

export function setStoredToken(token: string | null) {
  if (typeof window === 'undefined') return;
  if (token) window.localStorage.setItem(TOKEN_KEY, token);
  else window.localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getStoredToken();
  const res = await fetch(`${API_URL}/api${path}`, {
    ...init,
    cache: 'no-store',
    headers: {
      // Only declared when there is something to parse: Fastify rejects a
      // request that announces JSON and then sends an empty body, which is
      // exactly what the counter's action buttons (next, complete, recall) do.
      ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });

  if (!res.ok) {
    // A stale or corrupted token surfaces as a 401 everywhere; clearing it here,
    // once, means the next navigation naturally lands on the login screen
    // instead of every caller having to special-case this status itself.
    if (res.status === 401) setStoredToken(null);

    // Surface the API's own message where there is one — "This queue is closed"
    // is far more useful to a receptionist than "Request failed".
    let message = res.statusText;
    try {
      const body = await res.json();
      message = body.message ?? message;
      if (Array.isArray(body.issues) && body.issues.length > 0) {
        message = body.issues.map((i: { path: string; message: string }) => `${i.path}: ${i.message}`).join(', ');
      }
    } catch {
      /* response had no JSON body */
    }
    throw new ApiError(message, res.status);
  }

  return res.json() as Promise<T>;
}

// --- Types mirroring the API responses --------------------------------------

export interface BranchSummary {
  id: string;
  name: string;
  code: string;
  organizationId: string;
  organizationName: string;
  vertical: string;
  queueCount: number;
}

export interface BranchStats {
  branchId: string;
  branchName: string;
  organizationName: string;
  vertical: string;
  activeQueue: number;
  averageWaitMinutes: number;
  servedToday: number;
  noShowsToday: number;
}

export interface Insight {
  id: string;
  severity: 'info' | 'warning' | 'critical';
  title: string;
  detail: string;
  action: string | null;
  queueId: string | null;
}

export interface Forecast {
  expectedWalkIns: number;
  peakHour: number;
  peakHourLabel: string;
  confidence: number;
  longestQueue: { id: string; name: string; waiting: number } | null;
  expectedDelayMinutes: number;
  recommendedExtraStaff: number;
  capacityPerHour: number;
  observedArrivalsPerHour: number;
}

export interface ActivityEntry {
  id: string;
  name: string;
  queueId: string | null;
  tokenId: string | null;
  occurredAt: string;
  payload: Record<string, unknown>;
}

export interface TimelinePoint {
  hour: number;
  label: string;
  arrivals: number;
  averageWait: number;
}

export interface CounterRow {
  id: string;
  name: string;
  status: string;
  providerName: string | null;
  queueId: string | null;
  queue?: { id: string; name: string } | null;
}

export interface CheckinInfo {
  organizationName: string;
  branchName: string;
  vertical: string;
  queues: QueueSnapshot[];
}

export interface BranchOverview {
  stats: BranchStats;
  queues: QueueSnapshot[];
  timeline: TimelinePoint[];
  activity: ActivityEntry[];
  insights: Insight[];
  forecast: Forecast;
  counters: CounterRow[];
}

export interface TokenStatusResponse {
  code: string;
  displayCode: string;
  displayNumber: number;
  status: string;
  priority: string;
  peopleAhead: number;
  position: number | null;
  eta: {
    minutes: number;
    confidence: number;
    rangeMinutes: [number, number];
    delayRisk: number;
    factors: string[];
    message: string;
  } | null;
  counterName: string | null;
  providerName: string | null;
  recallExpiresAt: string | null;
  recallAttempts: number;
  customerName: string | null;
  joinedAt: string;
  calledAt: string | null;
  completedAt: string | null;
  queue: { id: string; name: string; department: string | null; status: string };
  branch: { id: string; name: string; organizationName: string };
  vertical: string;
  nowServing: { displayCode: string; counterName: string | null } | null;
}

export interface CounterView {
  counter: { id: string; name: string; status: string; providerName: string | null };
  queue: QueueSnapshot;
  stageType: string;
  vertical: string;
  current: TokenSnapshotDto | null;
  upNext: TokenSnapshotDto[];
}

export interface TokenSnapshotDto {
  id: string;
  code: string;
  displayNumber: number;
  status: string;
  priority: string;
  position: number | null;
  peopleAhead: number | null;
  etaMinutes: number | null;
  etaConfidence: number | null;
  counterId: string | null;
  counterName: string | null;
  providerName: string | null;
  customerName: string | null;
  joinedAt: string;
  calledAt: string | null;
  servedAt: string | null;
  completedAt: string | null;
}

export interface QueueDisplay {
  queue: QueueSnapshot;
  department: string | null;
  branch: { id: string; name: string; organizationName: string };
  vertical: string;
}

export interface BranchDetail {
  id: string;
  organizationId: string;
  name: string;
  code: string;
  vertical: string | null;
  timezone: string;
  address: string | null;
  openTime: string;
  closeTime: string;
}

export interface QueueDetail {
  id: string;
  branchId: string;
  name: string;
  department: string | null;
  status: string;
  tokenPrefix: string;
  baselineServiceMinutes: number;
  recallGraceMinutes: number;
  recallPenaltyPositions: number;
  displayOrder: number;
  stageType: string;
  nextQueueId: string | null;
  hasVisibleQueue: boolean;
}

export interface QueueInput {
  name: string;
  department?: string;
  tokenPrefix?: string;
  baselineServiceMinutes?: number;
  recallGraceMinutes?: number;
  recallPenaltyPositions?: number;
  stageType?: string;
  nextQueueId?: string | null;
  hasVisibleQueue?: boolean;
  displayOrder?: number;
}

export interface ServiceTypeRow {
  id: string;
  queueId: string;
  name: string;
  durationMinutes: number;
}

export interface ServiceTypeInput {
  name: string;
  durationMinutes?: number;
}

export interface BranchInput {
  name: string;
  code: string;
  vertical?: string;
  timezone?: string;
  address?: string;
  openTime?: string;
  closeTime?: string;
  flowTemplate?: string;
}

export interface StaffRow {
  id: string;
  organizationId: string;
  branchId: string | null;
  name: string;
  email: string;
  role: string;
  active: boolean;
  createdAt: string;
}

export interface StaffInput {
  name: string;
  email: string;
  password: string;
  role: string;
  branchId?: string;
}

export const ASSIGNABLE_ROLES = [
  'OWNER',
  'ADMIN',
  'RECEPTION',
  'COUNTER_STAFF',
  'PROVIDER',
  'CASHIER',
] as const;

export interface AuthUser {
  sub: string;
  email: string;
  name: string;
  role: string;
  organizationId: string;
  branchId: string | null;
}

// --- Endpoints --------------------------------------------------------------

export const api = {
  branches: () => request<BranchSummary[]>('/branches'),
  createBranch: (body: BranchInput) =>
    request<BranchDetail>('/branches', { method: 'POST', body: JSON.stringify(body) }),
  updateBranch: (branchId: string, body: Partial<BranchInput>) =>
    request<BranchDetail>(`/branches/${branchId}`, { method: 'PATCH', body: JSON.stringify(body) }),
  overview: (branchId: string) => request<BranchOverview>(`/branches/${branchId}/overview`),
  checkinInfo: (branchId: string) => request<CheckinInfo>(`/branches/${branchId}/checkin-info`),
  branchQueues: (branchId: string) => request<QueueSnapshot[]>(`/branches/${branchId}/queues`),
  branchQueueConfig: (branchId: string) => request<QueueDetail[]>(`/branches/${branchId}/queue-config`),
  createCounter: (branchId: string, body: { name: string; queueId?: string }) =>
    request<CounterRow>(`/branches/${branchId}/counters`, { method: 'POST', body: JSON.stringify(body) }),
  updateCounter: (counterId: string, body: Partial<{ name: string; queueId: string | null; staffUserId: string | null }>) =>
    request<CounterRow>(`/counters/${counterId}`, { method: 'PATCH', body: JSON.stringify(body) }),
  branchCounters: (branchId: string) => request<CounterRow[]>(`/branches/${branchId}/counters`),
  activity: (branchId: string, limit = 25) =>
    request<ActivityEntry[]>(`/branches/${branchId}/activity?limit=${limit}`),

  queue: (queueId: string) => request<QueueSnapshot>(`/queues/${queueId}`),
  queueDisplay: (queueId: string) => request<QueueDisplay>(`/queues/${queueId}/display`),
  setQueueStatus: (queueId: string, status: 'OPEN' | 'PAUSED' | 'CLOSED') =>
    request<QueueSnapshot>(`/queues/${queueId}/status`, {
      method: 'POST',
      body: JSON.stringify({ status }),
    }),
  createQueue: (branchId: string, body: QueueInput) =>
    request<QueueDetail>(`/branches/${branchId}/queues`, { method: 'POST', body: JSON.stringify(body) }),
  updateQueue: (queueId: string, body: Partial<QueueInput>) =>
    request<QueueDetail>(`/queues/${queueId}`, { method: 'PATCH', body: JSON.stringify(body) }),

  serviceTypes: (queueId: string) => request<ServiceTypeRow[]>(`/queues/${queueId}/service-types`),
  createServiceType: (queueId: string, body: ServiceTypeInput) =>
    request<ServiceTypeRow>(`/queues/${queueId}/service-types`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  updateServiceType: (queueId: string, serviceTypeId: string, body: Partial<ServiceTypeInput>) =>
    request<ServiceTypeRow>(`/queues/${queueId}/service-types/${serviceTypeId}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  deleteServiceType: (queueId: string, serviceTypeId: string) =>
    request<{ ok: boolean }>(`/queues/${queueId}/service-types/${serviceTypeId}`, { method: 'DELETE' }),

  transferToken: (tokenId: string, targetQueueId: string) =>
    request<TokenStatusResponse>(`/tokens/${tokenId}/transfer`, {
      method: 'POST',
      body: JSON.stringify({ targetQueueId }),
    }),
  changeTokenPriority: (tokenId: string, priority: string, reason: string) =>
    request<TokenStatusResponse>(`/tokens/${tokenId}/priority`, {
      method: 'POST',
      body: JSON.stringify({ priority, reason }),
    }),

  join: (queueId: string, body: Record<string, unknown>) =>
    request<TokenStatusResponse>(`/queues/${queueId}/tokens`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  token: (code: string) => request<TokenStatusResponse>(`/t/${code}`),
  confirmRecall: (code: string) =>
    request<TokenStatusResponse>(`/t/${code}/confirm-recall`, { method: 'POST' }),
  cancelToken: (code: string) =>
    request<TokenStatusResponse>(`/t/${code}/cancel`, { method: 'POST' }),
  feedback: (code: string, rating: number, comment?: string) =>
    request<{ ok: boolean }>(`/t/${code}/feedback`, {
      method: 'POST',
      body: JSON.stringify({ rating, comment }),
    }),

  counter: (counterId: string) => request<CounterView>(`/counters/${counterId}`),
  counterAction: (counterId: string, action: 'next' | 'recall' | 'skip' | 'complete') =>
    request<CounterView>(`/counters/${counterId}/${action}`, { method: 'POST' }),
  callSpecific: (counterId: string, tokenId: string) =>
    request<CounterView>(`/counters/${counterId}/call/${tokenId}`, { method: 'POST' }),
  recordPayment: (counterId: string, amount: number, method: string) =>
    request<CounterView>(`/counters/${counterId}/record-payment`, {
      method: 'POST',
      body: JSON.stringify({ amount, method }),
    }),

  staff: () => request<StaffRow[]>('/staff'),
  createStaff: (body: StaffInput) => request<StaffRow>('/staff', { method: 'POST', body: JSON.stringify(body) }),
  updateStaff: (id: string, body: Partial<{ name: string; role: string; branchId: string | null; active: boolean }>) =>
    request<StaffRow>(`/staff/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  resetStaffPassword: (id: string, password: string) =>
    request<{ ok: boolean }>(`/staff/${id}/reset-password`, { method: 'POST', body: JSON.stringify({ password }) }),

  login: (email: string, password: string) =>
    request<{ accessToken: string; user: AuthUser }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  register: (body: {
    businessName: string;
    vertical: string;
    flowTemplate: string;
    ownerName: string;
    email: string;
    password: string;
  }) =>
    request<{ accessToken: string; user: AuthUser }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  me: () => request<AuthUser>('/auth/me'),
};
