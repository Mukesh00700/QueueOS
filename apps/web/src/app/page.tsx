'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import {
  Activity,
  ArrowRight,
  LayoutDashboard,
  Monitor,
  QrCode,
  Sparkles,
} from 'lucide-react';
import { getVertical } from '@queueos/core';
import { api, ApiError, type BranchSummary } from '@/lib/api';
import { Card, Pill, Skeleton } from '@/components/ui';

/**
 * The launcher.
 *
 * `GET /branches` is staff-only and scoped to the caller's own organization
 * (see decision.md, 2026-09-08) — it used to list every business on the
 * platform, which doesn't belong on a public page. An unauthenticated
 * visitor sees a sign-in prompt instead of a directory; a signed-in owner or
 * manager sees only their own branches.
 */
export default function LauncherPage() {
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [branches, setBranches] = useState<BranchSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Distinguishes "the API process isn't running" (genuinely fix with `npm
  // run dev`) from "signed in, but this account isn't Admin/Owner" (`/branches`
  // is staff-management-only — a floor-staff account was never meant to land
  // here at all, it should have a direct link to its own counter instead).
  const [errorKind, setErrorKind] = useState<'connection' | 'forbidden' | 'other'>('connection');

  useEffect(() => {
    api
      .me()
      .then(() => {
        setSignedIn(true);
        return api.branches();
      })
      .then((b) => setBranches(b ?? null))
      .catch((e) => {
        if (e instanceof ApiError && e.status === 401) {
          setSignedIn(false);
        } else if (e instanceof ApiError && e.status === 403) {
          setError("You're signed in, but this account doesn't have branch access.");
          setErrorKind('forbidden');
        } else if (e instanceof ApiError) {
          setError(e.message);
          setErrorKind('other');
        } else {
          setError('Could not reach the API');
          setErrorKind('connection');
        }
      });
  }, []);

  return (
    <div className="min-h-screen bg-surface text-fg">
      <div className="mx-auto max-w-6xl px-6 py-16">
        <header className="flex flex-col items-start gap-6">
          <div className="flex items-center gap-3">
            <div className="grid h-11 w-11 place-items-center rounded-2xl bg-accent text-white">
              <Activity size={22} strokeWidth={2.5} />
            </div>
            <div>
              <p className="text-xl font-bold tracking-tight">QueueOS</p>
              <p className="text-xs text-muted">Intelligent Queue Operating System</p>
            </div>
            <Pill tone="ai">
              <Sparkles size={11} /> AI
            </Pill>
          </div>

          <div className="max-w-2xl">
            <h1 className="text-4xl font-extrabold leading-[1.1] tracking-tight sm:text-5xl">
              Don&apos;t wait.
              <br />
              <span className="text-accent">Live your life</span> while AI manages your place.
            </h1>
            <p className="mt-4 text-base text-muted">
              Every screen below runs on one codebase. The words, the colours and the journey
              stages come from the branch&apos;s vertical profile — nothing is hardcoded per
              industry.
            </p>
          </div>

          {signedIn === false ? (
            <div className="flex items-center gap-3">
              <Link
                href="/register"
                className="inline-flex h-11 items-center justify-center rounded-xl bg-accent px-5 text-sm font-medium text-accent-fg hover:brightness-110"
              >
                Register your business
              </Link>
              <Link
                href="/login"
                className="inline-flex h-11 items-center justify-center rounded-xl border border-line px-5 text-sm font-medium hover:border-line-strong"
              >
                Sign in
              </Link>
            </div>
          ) : null}
        </header>

        {signedIn === false ? null : (
          <section className="mt-14">
            <div className="mb-4 flex items-baseline justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">Branches</h2>
              {branches ? (
                <span className="text-xs text-subtle">{branches.length} live</span>
              ) : null}
            </div>

            {error ? (
              <Card className="p-6">
                <p className="text-sm font-medium text-danger">{error}</p>
                {errorKind === 'connection' ? (
                  <p className="mt-1 text-xs text-muted">
                    Start the API with <code className="text-fg">npm run dev</code> and reload.
                  </p>
                ) : errorKind === 'forbidden' ? (
                  <p className="mt-1 text-xs text-muted">
                    Floor staff (counter, reception) don&apos;t browse branches here. If you
                    haven&apos;t been assigned a counter yet, ask your manager to assign you one
                    from Setup → Counters — signing in will then send you straight there.{' '}
                    <Link href="/login" className="font-medium text-accent hover:underline">
                      Sign in with a different account
                    </Link>
                    .
                  </p>
                ) : null}
              </Card>
            ) : !branches ? (
              <div className="grid gap-4 sm:grid-cols-2">
                {[0, 1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-36" />
                ))}
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                {branches.map((branch) => (
                  <BranchCard key={branch.id} branch={branch} />
                ))}
              </div>
            )}
          </section>
        )}

        <footer className="mt-16 flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-line pt-6 text-xs text-muted">
          <span className="flex items-center gap-1.5">
            <LayoutDashboard size={13} /> Operator dashboard
          </span>
          <span className="flex items-center gap-1.5">
            <QrCode size={13} /> Self check-in kiosk
          </span>
          <span className="flex items-center gap-1.5">
            <Monitor size={13} /> Lobby TV display
          </span>
          <Link href="/login" className="ml-auto font-medium text-accent hover:underline">
            Staff sign in
          </Link>
        </footer>
      </div>
    </div>
  );
}

function BranchCard({ branch }: { branch: BranchSummary }) {
  const vertical = getVertical(branch.vertical);

  return (
    <Link href={`/dashboard/${branch.id}`} className="group">
      <Card
        className="relative overflow-hidden p-5 transition-all hover:-translate-y-0.5 hover:shadow-[var(--shadow-raised)]"
        style={{ borderColor: `rgb(${vertical.theme.tint} / 0.25)` }}
      >
        <div
          className="pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full opacity-20 blur-2xl transition-opacity group-hover:opacity-35"
          style={{ background: vertical.theme.accent }}
        />
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-base font-semibold">{branch.organizationName}</p>
            <p className="truncate text-sm text-muted">{branch.name}</p>
          </div>
          <span
            className="shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium"
            style={{
              background: `rgb(${vertical.theme.tint} / 0.12)`,
              color: vertical.theme.accent,
            }}
          >
            {vertical.label}
          </span>
        </div>

        <p className="mt-3 text-xs text-muted">{vertical.tagline}</p>

        <div className="mt-5 flex items-center justify-between">
          <span className="tnum text-sm text-muted">
            {branch.queueCount} {branch.queueCount === 1
              ? vertical.terminology.queue.toLowerCase()
              : vertical.terminology.queuePlural.toLowerCase()}
          </span>
          <span
            className="flex items-center gap-1 text-sm font-medium"
            style={{ color: vertical.theme.accent }}
          >
            Open
            <ArrowRight size={14} className="transition-transform group-hover:translate-x-0.5" />
          </span>
        </div>
      </Card>
    </Link>
  );
}
