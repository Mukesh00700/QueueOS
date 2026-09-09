'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { use, useEffect, useState } from 'react';
import { Monitor, QrCode } from 'lucide-react';
import { api, type BranchOverview } from '@/lib/api';
import { useLive } from '@/lib/use-live';
import { useTheme } from '@/lib/theme';
import { greeting } from '@/lib/utils';
import { AppShell } from '@/components/app-shell';
import { Button, Card, Skeleton } from '@/components/ui';
import {
  ActivityFeed,
  AiPanel,
  CounterStrip,
  InsightList,
  KpiRow,
  QueueGrid,
  TimelineChart,
} from '@/components/dashboard';

export default function DashboardPage({ params }: { params: Promise<{ branchId: string }> }) {
  const { branchId } = use(params);
  const router = useRouter();

  // The dashboard carries customer names, activity and revenue-adjacent
  // stats — nothing here renders before the auth check settles, matching the
  // counter tablet's pattern (see decision.md, 2026-09-06).
  const [authed, setAuthed] = useState<boolean | null>(null);
  useEffect(() => {
    api
      .me()
      .then(() => setAuthed(true))
      .catch(() => {
        setAuthed(false);
        router.replace(`/login?next=/dashboard/${branchId}`);
      });
  }, [branchId, router]);

  const { data, error, live } = useLive(branchId, () => api.overview(branchId), { branchId });

  if (authed !== true) {
    return <div className="min-h-screen bg-surface" />;
  }
  if (error) {
    return (
      <div className="grid min-h-screen place-items-center bg-surface p-6 text-fg">
        <Card className="max-w-sm p-6 text-center">
          <p className="text-sm font-medium text-danger">{error}</p>
          <Link href="/" className="mt-3 inline-block text-xs font-medium text-accent hover:underline">
            Back to branches
          </Link>
        </Card>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-screen bg-surface p-6">
        <div className="mx-auto max-w-7xl space-y-4">
          <Skeleton className="h-16" />
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-28" />
            ))}
          </div>
          <Skeleton className="h-64" />
        </div>
      </div>
    );
  }

  return <DashboardBody branchId={branchId} data={data} live={live} />;
}

function DashboardBody({
  branchId,
  data,
  live,
}: {
  branchId: string;
  data: BranchOverview;
  live: boolean;
}) {
  const { t, setVertical } = useTheme();
  const { stats, queues, timeline, activity, insights, forecast, counters } = data;

  useEffect(() => {
    setVertical(stats.vertical);
  }, [stats.vertical, setVertical]);

  return (
    <AppShell
      branchId={branchId}
      organizationName={stats.organizationName}
      branchName={stats.branchName}
      queueCount={queues.length}
      live={live}
      right={
        <>
          <Link href={`/checkin/${branchId}`}>
            <Button variant="secondary" size="sm">
              <QrCode size={14} /> Check-in
            </Button>
          </Link>
          {queues[0] ? (
            <Link href={`/display/${queues[0].id}`} target="_blank">
              <Button variant="ghost" size="sm">
                <Monitor size={14} /> Display
              </Button>
            </Link>
          ) : null}
        </>
      }
    >
      <div className="mx-auto max-w-[1600px] space-y-6 p-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{greeting()}</h1>
          <p className="mt-1 text-sm text-muted">
            {stats.branchName} · {stats.activeQueue} {t.customerPlural.toLowerCase()} in line right now
          </p>
        </div>

        <KpiRow stats={stats} t={t} />

        <section id="queues" className="scroll-mt-20 space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">
            Live {t.queuePlural}
          </h2>
          <QueueGrid queues={queues} t={t} />
        </section>

        <div id="ai" className="grid scroll-mt-20 gap-6 xl:grid-cols-2">
          <AiPanel forecast={forecast} t={t} />
          <InsightList insights={insights} />
        </div>

        <div id="analytics" className="grid scroll-mt-20 gap-6 xl:grid-cols-[2fr_1fr]">
          <TimelineChart points={timeline} />
          <ActivityFeed activity={activity} />
        </div>

        <div id="settings" className="scroll-mt-20">
          <CounterStrip counters={counters} t={t} />
        </div>
      </div>
    </AppShell>
  );
}
