'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { QRCodeSVG } from 'qrcode.react';
import { Activity, ArrowLeft, Printer } from 'lucide-react';
import { getVertical } from '@queueos/core';
import { api, ApiError, type CheckinInfo } from '@/lib/api';
import { Button, Card, Skeleton } from '@/components/ui';

/**
 * A poster, not a screen — pulled up once by staff to print and tape up at
 * the venue. Public like the check-in page itself is: whoever's holding a
 * phone camera to it was never going to be logged in.
 */
export default function CheckinQrPage({ params }: { params: Promise<{ branchId: string }> }) {
  const { branchId } = use(params);
  const [data, setData] = useState<CheckinInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState('');

  useEffect(() => {
    // The QR has to encode wherever the browser scanning it can actually
    // reach this app — never a hardcoded/API origin, and never known until
    // the page is running in a real browser.
    setUrl(`${window.location.origin}/checkin/${branchId}`);
  }, [branchId]);

  useEffect(() => {
    api
      .checkinInfo(branchId)
      .then(setData)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load this branch'));
  }, [branchId]);

  if (error) {
    return (
      <div className="grid min-h-screen place-items-center bg-surface p-6">
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
      <div className="mx-auto max-w-sm space-y-4 p-6">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-80" />
      </div>
    );
  }

  const vertical = getVertical(data.vertical);

  return (
    <div className="min-h-screen bg-surface text-fg">
      <div className="mx-auto max-w-md px-6 py-10 print:py-0">
        <div className="flex items-center justify-between print:hidden">
          <Link href={`/checkin/${branchId}`} className="flex items-center gap-1.5 text-sm text-muted hover:text-fg">
            <ArrowLeft size={14} /> Back to check-in
          </Link>
          <Button variant="secondary" size="sm" onClick={() => window.print()}>
            <Printer size={14} /> Print
          </Button>
        </div>

        <Card className="mt-6 overflow-hidden p-8 text-center print:border-none print:p-0 print:shadow-none">
          <div className="flex items-center justify-center gap-2">
            <div
              className="grid h-9 w-9 place-items-center rounded-xl text-white"
              style={{ background: vertical.theme.accent }}
            >
              <Activity size={18} strokeWidth={2.5} />
            </div>
            <div className="text-left">
              <p className="text-sm font-semibold leading-tight">{data.organizationName}</p>
              <p className="text-xs text-muted leading-tight">{data.branchName}</p>
            </div>
          </div>

          <h1 className="mt-6 text-xl font-bold tracking-tight">Scan to join the line</h1>
          <p className="mt-1 text-sm text-muted">
            Point your phone&apos;s camera at the code below — no app, no account.
          </p>

          <div className="mt-6 flex justify-center">
            {url ? (
              <div className="rounded-2xl border border-line bg-white p-5">
                <QRCodeSVG value={url} size={220} level="M" />
              </div>
            ) : (
              <Skeleton className="h-[260px] w-[260px]" />
            )}
          </div>

          <p className="mt-6 break-all text-xs text-subtle">{url}</p>
        </Card>
      </div>
    </div>
  );
}
