import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { BillingReviewForm } from '@/components/admin/billing-review-form';
import { Card, SectionHeading } from '@/components/ui/primitives';
import { getViewer } from '@/lib/auth/session';
import type { BillingRiskContext } from '@/lib/billing/risk';
import { createServerSupabaseClient } from '@/lib/db/server';
import { formatDate } from '@/lib/format';

export const metadata: Metadata = {
  title: 'Billing reviews',
  robots: { index: false, follow: false },
};
export const dynamic = 'force-dynamic';

interface ReviewRow {
  id: string;
  stripe_event_id: string;
  event_type: string;
  created_at: string;
  processed: boolean;
  review_context: BillingRiskContext | null;
  reviewed_at: string | null;
  review_note: string | null;
  review_outcome: string | null;
}

export default async function BillingReviewsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; page?: string }>;
}) {
  const viewer = await getViewer();
  if (!['billing_manager', 'super_administrator'].includes(viewer.role))
    redirect('/admin');
  const params = await searchParams;
  const reviewed = params.status === 'reviewed';
  const page = /^\d{1,5}$/.test(params.page ?? '')
    ? Math.max(1, Number(params.page))
    : 1;
  const db = await createServerSupabaseClient();
  let query = db
    .from('billing_events')
    .select(
      'id,stripe_event_id,event_type,created_at,processed,review_context,reviewed_at,review_note,review_outcome',
      { count: 'exact' },
    )
    .eq('review_required', true);
  query = reviewed
    ? query.not('reviewed_at', 'is', null)
    : query.is('reviewed_at', null);
  const { data, count, error } = await query
    .order('created_at', { ascending: !reviewed })
    .order('id')
    .range((page - 1) * 25, page * 25 - 1);
  if (error) throw new Error('Billing review queue is unavailable.');
  const rows = (data ?? []) as ReviewRow[];
  const pageUrl = (next: number) =>
    `/admin/billing?status=${reviewed ? 'reviewed' : 'pending'}&page=${next}`;
  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      <SectionHeading
        eyebrow="Administration"
        title="Billing reviews"
        description="Review refunds, disputes and early fraud warnings. Check Stripe for the current case status and any response deadline before recording your decision."
      />
      <nav
        aria-label="Billing review status"
        className="mb-6 flex gap-6 text-sm"
      >
        <Link
          href="/admin/billing"
          aria-current={!reviewed ? 'page' : undefined}
          className="underline"
        >
          Pending reviews
        </Link>
        <Link
          href="/admin/billing?status=reviewed"
          aria-current={reviewed ? 'page' : undefined}
          className="underline"
        >
          Completed reviews
        </Link>
      </nav>
      <p className="mb-4 text-sm">
        {count ?? 0} {reviewed ? 'completed' : 'pending'} review
        {count === 1 ? '' : 's'}.
      </p>
      {!rows.length ? (
        <Card>
          <p>
            {reviewed
              ? 'No completed reviews on this page.'
              : 'No pending reviews on this page.'}
          </p>
        </Card>
      ) : null}
      <div className="space-y-6">
        {rows.map((row) => {
          const context = row.review_context;
          const dashboard =
            context?.livemode === false
              ? 'https://dashboard.stripe.com/test'
              : 'https://dashboard.stripe.com';
          const money =
            context?.amount != null && context.currency
              ? new Intl.NumberFormat('en-US', {
                  style: 'currency',
                  currency: context.currency,
                })
              : null;
          return (
            <Card key={row.id} className="min-w-0 break-words">
              <h2 className="text-lg font-semibold">
                {context?.detail ?? row.event_type}
              </h2>
              <p className="mt-1 text-sm text-ink-600">
                Received {formatDate(row.created_at)}
                {context?.livemode === false ? ' · Test event' : ''}
              </p>
              {money && context ? (
                <p className="mt-2">
                  Amount:{' '}
                  {money.format(
                    context.amount! /
                      10 **
                        (money.resolvedOptions().maximumFractionDigits ?? 2),
                  )}
                </p>
              ) : null}
              {context?.dueAt ? (
                <p className="mt-2 font-medium">
                  Response deadline at receipt:{' '}
                  {new Date(context.dueAt * 1000).toLocaleString('en-US', {
                    timeZone: 'America/New_York',
                  })}{' '}
                  Eastern. Confirm the current deadline in Stripe.
                </p>
              ) : null}
              <p className="mt-2 text-sm">
                {context?.resolution === 'matched'
                  ? 'Subscription records matched to the payment.'
                  : 'Account matching needs manual review in Stripe.'}
              </p>
              {context?.customerIds.length ? (
                <p className="mt-2 text-sm">
                  Customers: {context.customerIds.join(', ')}
                </p>
              ) : null}
              {context?.subscriptionIds.length ? (
                <p className="mt-2 text-sm">
                  Subscriptions: {context.subscriptionIds.join(', ')}
                </p>
              ) : null}
              <a
                href={`${dashboard}/events/${encodeURIComponent(row.stripe_event_id)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 inline-block text-sm underline"
              >
                Open event in Stripe (new tab)
              </a>
              {row.reviewed_at ? (
                <div className="mt-4 border-t border-ink-200 pt-4">
                  <p className="text-sm font-medium">
                    Reviewed {formatDate(row.reviewed_at)} ·{' '}
                    {row.review_outcome === 'handled_in_stripe'
                      ? 'Handled in Stripe'
                      : 'No account change needed'}
                  </p>
                  <p className="mt-2 whitespace-pre-wrap text-sm">
                    {row.review_note}
                  </p>
                </div>
              ) : row.processed ? (
                <BillingReviewForm eventId={row.id} />
              ) : (
                <p role="status" className="mt-4 text-sm text-amber-800">
                  Processing is incomplete. Check webhook delivery errors in
                  Stripe and retry the event before recording a review.
                </p>
              )}
            </Card>
          );
        })}
      </div>
      <nav aria-label="Review pages" className="mt-6 flex gap-6 text-sm">
        {page > 1 ? (
          <Link className="underline" href={pageUrl(page - 1)}>
            Previous page
          </Link>
        ) : null}
        {page * 25 < (count ?? 0) ? (
          <Link className="underline" href={pageUrl(page + 1)}>
            Next page
          </Link>
        ) : null}
      </nav>
    </div>
  );
}
