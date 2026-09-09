'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import {
  Activity,
  BarChart3,
  Brain,
  CalendarDays,
  ChevronLeft,
  FileText,
  LayoutDashboard,
  ListOrdered,
  LogOut,
  Moon,
  Search,
  Settings,
  Sun,
  Users,
} from 'lucide-react';
import { ROLE_RANK } from '@queueos/core';
import { useTheme } from '@/lib/theme';
import { api, setStoredToken } from '@/lib/api';
import { cn, formatClock, formatDate } from '@/lib/utils';
import { Pill } from '@/components/ui';

interface NavItem {
  label: string;
  href: string;
  icon: typeof LayoutDashboard;
  badge?: number;
}

export function AppShell({
  branchId,
  organizationName,
  branchName,
  queueCount,
  live,
  children,
  right,
}: {
  branchId: string;
  organizationName: string;
  branchName: string;
  queueCount?: number;
  live?: boolean;
  children: ReactNode;
  right?: ReactNode;
}) {
  const { mode, toggleMode, vertical } = useTheme();
  const pathname = usePathname();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const [role, setRole] = useState<string | null>(null);
  const [hash, setHash] = useState('');

  useEffect(() => {
    api.me().then((u) => setRole(u.role)).catch(() => {});
  }, []);

  // usePathname() never includes the fragment, so a #-anchored item can only
  // be told apart from its siblings by reading the hash directly.
  useEffect(() => {
    const update = () => setHash(window.location.hash);
    update();
    window.addEventListener('hashchange', update);
    return () => window.removeEventListener('hashchange', update);
  }, []);

  function logout() {
    setStoredToken(null);
    router.push('/login');
  }

  const canManage = role !== null && ROLE_RANK[role as keyof typeof ROLE_RANK] >= ROLE_RANK.ADMIN;

  const nav: NavItem[] = [
    { label: 'Dashboard', href: `/dashboard/${branchId}`, icon: LayoutDashboard },
    { label: vertical.terminology.queuePlural, href: `/dashboard/${branchId}#queues`, icon: ListOrdered, badge: queueCount },
    { label: 'Appointments', href: `/dashboard/${branchId}#appointments`, icon: CalendarDays },
    { label: vertical.terminology.customerPlural, href: `/dashboard/${branchId}#customers`, icon: Users },
    { label: 'AI Predictions', href: `/dashboard/${branchId}#ai`, icon: Brain },
    { label: 'Analytics', href: `/dashboard/${branchId}#analytics`, icon: BarChart3 },
    { label: 'Reports', href: `/dashboard/${branchId}#reports`, icon: FileText },
    // Only branch managers and above can configure branches/queues/staff — this
    // is the one nav item that leaves the per-branch dashboard entirely.
    ...(canManage ? [{ label: 'Setup', href: '/setup/branches', icon: Settings }] : []),
  ];

  return (
    <div className="min-h-screen bg-surface text-fg flex">
      <aside
        className={cn(
          'sticky top-0 h-screen shrink-0 border-r border-line bg-card flex flex-col transition-[width] duration-200',
          collapsed ? 'w-20' : 'w-[260px]',
        )}
      >
        <div className="flex items-center gap-2.5 px-5 h-16 border-b border-line">
          <div
            className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-white"
            style={{ background: 'var(--accent)' }}
          >
            <Activity size={18} strokeWidth={2.5} />
          </div>
          {!collapsed && (
            <div className="flex items-center gap-2 min-w-0">
              <span className="font-bold tracking-tight text-[17px]">QueueOS</span>
              <Pill tone="ai">AI</Pill>
            </div>
          )}
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-0.5">
          {nav.map((item) => {
            const [base, fragment] = item.href.split('#');
            const active = fragment ? pathname === base && hash === `#${fragment}` : pathname === base;
            return (
              <Link
                key={item.label}
                href={item.href}
                className={cn(
                  'group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors',
                  active
                    ? 'bg-accent/10 text-accent font-medium'
                    : 'text-muted hover:bg-raised hover:text-fg',
                  collapsed && 'justify-center px-0',
                )}
                title={collapsed ? item.label : undefined}
              >
                <item.icon size={18} className="shrink-0" />
                {!collapsed && (
                  <>
                    <span className="flex-1 truncate">{item.label}</span>
                    {item.badge ? (
                      <span className="tnum rounded-md bg-accent/15 px-1.5 py-0.5 text-[11px] font-semibold text-accent">
                        {item.badge}
                      </span>
                    ) : null}
                  </>
                )}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-line p-3 space-y-3">
          {!collapsed && (
            <Link
              href="/"
              className="block rounded-xl border border-line bg-raised px-3 py-3 hover:border-line-strong transition-colors"
            >
              <p className="text-sm font-semibold truncate">{organizationName}</p>
              <p className="text-xs text-muted truncate">{branchName}</p>
              <p className="mt-2 text-[11px] font-medium text-accent">Switch branch</p>
            </Link>
          )}
          <div
            className={cn(
              'flex items-center gap-2 text-[11px] text-muted',
              collapsed && 'justify-center',
            )}
          >
            <span
              className={cn('h-2 w-2 rounded-full', live ? 'bg-success live-dot' : 'bg-subtle')}
            />
            {!collapsed && <span>{live ? 'All systems operational' : 'Reconnecting…'}</span>}
          </div>
          <button
            onClick={() => setCollapsed((c) => !c)}
            className="flex w-full items-center justify-center rounded-lg py-1.5 text-muted hover:bg-raised hover:text-fg transition-colors"
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            <ChevronLeft size={16} className={cn('transition-transform', collapsed && 'rotate-180')} />
          </button>
        </div>
      </aside>

      <div className="flex-1 min-w-0 flex flex-col">
        <header className="sticky top-0 z-20 flex h-16 items-center gap-4 border-b border-line bg-card/80 px-6 backdrop-blur-xl">
          <div className="relative max-w-md flex-1">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-subtle" />
            <input
              placeholder="Search anything…"
              className="h-9 w-full rounded-xl border border-line bg-raised pl-9 pr-16 text-sm outline-none transition-colors placeholder:text-subtle focus:border-accent"
            />
            <kbd className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rounded border border-line px-1.5 py-0.5 text-[10px] text-subtle">
              ⌘K
            </kbd>
          </div>

          <div className="ml-auto flex items-center gap-3">
            <LiveClock />
            <button
              onClick={toggleMode}
              className="grid h-9 w-9 place-items-center rounded-xl text-muted transition-colors hover:bg-raised hover:text-fg"
              aria-label="Toggle theme"
            >
              {mode === 'light' ? <Moon size={17} /> : <Sun size={17} />}
            </button>
            <button
              onClick={logout}
              className="grid h-9 w-9 place-items-center rounded-xl text-muted transition-colors hover:bg-raised hover:text-danger"
              aria-label="Sign out"
              title="Sign out"
            >
              <LogOut size={17} />
            </button>
            {right}
          </div>
        </header>

        <main className="flex-1 min-w-0">{children}</main>
      </div>
    </div>
  );
}

function LiveClock() {
  const [now, setNow] = useState<Date | null>(null);

  // Starts null and fills in after mount: rendering a clock during SSR
  // guarantees a hydration mismatch, because the server's second is never the
  // client's second.
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  if (!now) return <div className="h-9 w-32" />;

  return (
    <div className="hidden text-right sm:block">
      <p className="tnum text-sm font-semibold leading-tight">{formatClock(now)}</p>
      <p className="text-[11px] text-muted leading-tight">{formatDate(now).split(',')[0]}</p>
    </div>
  );
}
