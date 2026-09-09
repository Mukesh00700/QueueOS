'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { Activity } from 'lucide-react';
import { cn } from '@/lib/utils';

const TABS = [
  { label: 'Branches', href: '/setup/branches' },
  { label: 'Staff', href: '/setup/staff' },
];

/**
 * Lightweight shell for the business-setup area. Deliberately not the
 * per-branch AppShell (sidebar, live queue nav, AI panel) — setup pages are
 * org-wide CRUD, not a branch mission-control screen, so a simple header with
 * a couple of tabs is the right amount of chrome rather than retrofitting a
 * branch-scoped shell to work without a branch.
 */
export function SetupShell({ title, children }: { title: string; children: ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="min-h-screen bg-surface text-fg">
      <header className="sticky top-0 z-20 flex h-16 items-center gap-4 border-b border-line bg-card/80 px-6 backdrop-blur-xl">
        <Link href="/" className="flex items-center gap-2.5 shrink-0">
          <div className="grid h-8 w-8 place-items-center rounded-lg bg-accent text-white">
            <Activity size={16} strokeWidth={2.5} />
          </div>
          <span className="font-bold tracking-tight">QueueOS</span>
        </Link>
        <span className="text-subtle">/</span>
        <h1 className="text-sm font-semibold">{title}</h1>

        <nav className="ml-auto flex items-center gap-1 text-sm">
          {TABS.map((tab) => (
            <Link
              key={tab.href}
              href={tab.href}
              className={cn(
                'rounded-lg px-3 py-1.5 transition-colors',
                pathname.startsWith(tab.href)
                  ? 'bg-accent/10 font-medium text-accent'
                  : 'text-muted hover:bg-raised hover:text-fg',
              )}
            >
              {tab.label}
            </Link>
          ))}
        </nav>
      </header>

      <main className="mx-auto max-w-5xl space-y-6 p-6">{children}</main>
    </div>
  );
}
