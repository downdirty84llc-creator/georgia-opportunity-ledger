import type { Metadata } from 'next';
import Link from 'next/link';

import { Card, Pill, SectionHeading } from '@/components/ui/primitives';
import { getSessionContext } from '@/lib/auth/session';
import { createServerSupabaseClient } from '@/lib/db/server';
import { formatDate, formatMoney, titleCase } from '@/lib/format';

export const metadata: Metadata = { title: 'Admin dashboard' };
export const dynamic = 'force-dynamic';

/** Counts rows matching a prepared query, treating a null count as zero. */
async function countRows(
  query: PromiseLike<{ count: number | null }>,
): Promise<number> {
  const { count } = await query;
  return count ?? 0;
}

export default async function AdminDashboardPage() {
  const { viewer } = await getSessionContext();
  const supabase = await createServerSupabaseClient();

  const now = new Date();
  const inSevenDays = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const head = (table: string) =>
    supabase.from(table).select('id', { count: 'exact', head: true });

  const [
    drafts,
    awaitingReview,
    approved,
    verificationOverdue,
    closingWeek,
    reportsAwaiting,
    failedPayments,
    activeSubscribers,
    recentAudit,
    subscriptions,
    jobRuns,
  ] = await Promise.all([
    countRows(
      head('opportunities').in('workflow_status', [
        'draft',
        'source_collected',
        'verification_pending',
        'analysis_pending',
      ]),
    ),
    countRows(head('opportunities').eq('workflow_status', 'internal_review')),
    countRows(
      head('opportunities').in('workflow_status', ['approved', 'scheduled']),
    ),
    countRows(
      head('opportunities')
        .eq('workflow_status', 'published')
        .lte('reverification_due_at', now.toISOString()),
    ),
    countRows(
      head('opportunities')
        .eq('workflow_status', 'published')
        .eq('is_expired', false)
        .lte('closing_date', inSevenDays.toISOString()),
    ),
    countRows(
      head('reports').in('status', ['draft', 'internal_review', 'approved']),
    ),
    countRows(
      head('subscriptions').in('status', ['past_due', 'unpaid', 'incomplete']),
    ),
    countRows(head('subscriptions').in('status', ['active', 'trialing'])),
    supabase
      .from('audit_logs')
      .select('id, action, entity_type, entity_id, created_at')
      .order('created_at', { ascending: false })
      .limit(12),
    supabase
      .from('subscriptions')
      .select(
        'status, subscription_plans ( code, monthly_price, annual_price )',
      )
      .in('status', ['active', 'trialing']),
    supabase
      .from('job_runs')
      .select(
        'id, job_name, status, started_at, records_processed, records_failed',
      )
      .order('started_at', { ascending: false })
      .limit(10),
  ]);

  // Monthly recurring revenue, normalising annual plans to a monthly figure.
  const mrr = (subscriptions.data ?? []).reduce((total, row) => {
    const plan = Array.isArray(row.subscription_plans)
      ? row.subscription_plans[0]
      : row.subscription_plans;
    if (!plan) return total;
    return total + Number(plan.monthly_price ?? 0);
  }, 0);

  const metrics = [
    {
      label: 'Drafts in progress',
      value: drafts,
      href: '/admin/opportunities?workflowStatus=draft',
    },
    {
      label: 'Awaiting review',
      value: awaitingReview,
      href: '/admin/review-queue',
    },
    {
      label: 'Approved, not published',
      value: approved,
      href: '/admin/opportunities?workflowStatus=approved',
    },
    {
      label: 'Verification overdue',
      value: verificationOverdue,
      href: '/admin/opportunities',
    },
    {
      label: 'Closing within 7 days',
      value: closingWeek,
      href: '/admin/opportunities',
    },
    {
      label: 'Reports awaiting approval',
      value: reportsAwaiting,
      href: '/admin/reports',
    },
    { label: 'Failed payments', value: failedPayments, href: '/admin' },
    { label: 'Active subscribers', value: activeSubscribers, href: '/admin' },
  ];

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
      <h1 className="text-2xl sm:text-3xl">Admin dashboard</h1>
      <p className="mt-1 text-sm text-ink-600">
        Signed in as {titleCase(viewer.role)}.
      </p>

      <section className="mt-8">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {metrics.map((metric) => (
            <Link
              key={metric.label}
              href={metric.href}
              className="surface p-4 transition-colors hover:border-ink-400"
            >
              <p className="text-2xl font-semibold tabular-nums">
                {metric.value}
              </p>
              <p className="mt-1 text-sm text-ink-600">{metric.label}</p>
            </Link>
          ))}
        </div>
      </section>

      <div className="mt-10 grid gap-8 lg:grid-cols-2">
        <section>
          <SectionHeading
            title="Revenue"
            description="Normalised from active and trialing subscriptions."
          />
          <Card>
            <dl className="space-y-3">
              <div className="flex items-baseline justify-between">
                <dt className="text-sm text-ink-600">
                  Monthly recurring revenue
                </dt>
                <dd className="text-xl font-semibold tabular-nums">
                  {formatMoney(mrr)}
                </dd>
              </div>
              <div className="flex items-baseline justify-between">
                <dt className="text-sm text-ink-600">Active subscribers</dt>
                <dd className="text-xl font-semibold tabular-nums">
                  {activeSubscribers}
                </dd>
              </div>
              <div className="flex items-baseline justify-between">
                <dt className="text-sm text-ink-600">
                  Payments needing attention
                </dt>
                <dd className="text-xl font-semibold tabular-nums">
                  {failedPayments}
                </dd>
              </div>
            </dl>
          </Card>
        </section>

        <section>
          <SectionHeading
            title="Background jobs"
            description="The most recent run of each scheduled job."
          />
          <div className="surface overflow-x-auto">
            <table className="min-w-[420px] text-sm">
              <thead>
                <tr className="border-b border-ink-200 bg-ink-50 text-left">
                  <th scope="col" className="px-3 py-2 font-semibold">
                    Job
                  </th>
                  <th scope="col" className="px-3 py-2 font-semibold">
                    Status
                  </th>
                  <th scope="col" className="px-3 py-2 font-semibold">
                    Processed
                  </th>
                  <th scope="col" className="px-3 py-2 font-semibold">
                    Started
                  </th>
                </tr>
              </thead>
              <tbody>
                {(jobRuns.data ?? []).map((run) => (
                  <tr
                    key={run.id}
                    className="border-b border-ink-100 last:border-0"
                  >
                    <td className="px-3 py-2">{run.job_name}</td>
                    <td className="px-3 py-2">
                      <Pill
                        tone={
                          run.status === 'failed'
                            ? 'warning'
                            : run.status === 'succeeded'
                              ? 'positive'
                              : 'muted'
                        }
                      >
                        {titleCase(run.status)}
                      </Pill>
                    </td>
                    <td className="px-3 py-2 tabular-nums">
                      {run.records_processed}
                      {run.records_failed > 0 ? (
                        <span className="text-red-700">
                          {' '}
                          ({run.records_failed} failed)
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-ink-500">
                      {formatDate(run.started_at)}
                    </td>
                  </tr>
                ))}
                {(jobRuns.data ?? []).length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-3 py-4 text-ink-500">
                      No job runs recorded yet.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <section className="mt-10">
        <SectionHeading
          title="Recent audit events"
          description="Append-only. Publishing, score changes, access changes, overrides, refunds, suspensions, role changes and deletions all land here."
        />
        <div className="surface overflow-x-auto">
          <table className="min-w-[560px] text-sm">
            <thead>
              <tr className="border-b border-ink-200 bg-ink-50 text-left">
                <th scope="col" className="px-3 py-2 font-semibold">
                  Action
                </th>
                <th scope="col" className="px-3 py-2 font-semibold">
                  Entity
                </th>
                <th scope="col" className="px-3 py-2 font-semibold">
                  When
                </th>
              </tr>
            </thead>
            <tbody>
              {(recentAudit.data ?? []).map((entry) => (
                <tr
                  key={entry.id}
                  className="border-b border-ink-100 last:border-0"
                >
                  <td className="px-3 py-2 font-medium">{entry.action}</td>
                  <td className="px-3 py-2 text-ink-600">
                    {entry.entity_type}
                  </td>
                  <td className="px-3 py-2 text-ink-500">
                    {formatDate(entry.created_at)}
                  </td>
                </tr>
              ))}
              {(recentAudit.data ?? []).length === 0 ? (
                <tr>
                  <td colSpan={3} className="px-3 py-4 text-ink-500">
                    No audit events yet. Only a super administrator can read
                    this table.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
