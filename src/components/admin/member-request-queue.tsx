import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Card } from '@/components/ui/primitives';
import { MemberRequestForm } from '@/components/admin/member-request-form';
import {
  REQUEST_CONFIG,
  canReviewRequests,
  type RequestKind,
} from '@/lib/admin/member-requests';
import { getViewer } from '@/lib/auth/session';
import { createServerSupabaseClient } from '@/lib/db/server';
import { formatDate } from '@/lib/format';

interface RequestRow {
  id: string;
  created_at: string;
  updated_at: string;
  status: string;
  resolution_notes: string | null;
  subject?: string;
  message?: string;
  category?: string;
  priority?: string;
  description?: string;
  user_id?: string | null;
  submitted_by_user_id?: string | null;
  opportunity_id?: string | null;
  report_id?: string | null;
  supporting_url?: string | null;
}
function sourceLink(value: string | null | undefined) {
  try {
    const url = new URL(value ?? '');
    return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}
export async function MemberRequestQueue({
  kind,
  searchParams,
}: {
  kind: RequestKind;
  searchParams: Promise<{ status?: string; page?: string }>;
}) {
  const viewer = await getViewer();
  if (!canReviewRequests(kind, viewer.role)) redirect('/admin');
  const config = REQUEST_CONFIG[kind];
  const params = await searchParams;
  const complete = params.status === 'complete';
  const page = /^\d{1,5}$/.test(params.page ?? '')
    ? Math.max(1, Number(params.page))
    : 1;
  const db = await createServerSupabaseClient();
  let query = db
    .from(config.table)
    .select(
      kind === 'support'
        ? 'id,created_at,updated_at,status,resolution_notes,subject,message,category,priority,user_id'
        : 'id,created_at,updated_at,status,resolution_notes,description,submitted_by_user_id,opportunity_id,report_id,supporting_url',
      { count: 'exact' },
    );
  query = complete
    ? query.in('status', [...config.complete])
    : query.not('status', 'in', `(${config.complete.join(',')})`);
  const { data, count, error } = await query
    .order('created_at', { ascending: !complete })
    .order('id')
    .range((page - 1) * 25, page * 25 - 1);
  if (error) throw new Error(`${config.title} queue is unavailable.`);
  const rows = (data ?? []) as RequestRow[];
  const contacts = new Map<string, string>();
  if (rows.length) {
    const result = await db.rpc('member_request_contacts', {
      p_kind: kind,
      p_ids: rows.map((row) => row.id),
    });
    if (result.error) throw new Error('Requester contacts are unavailable.');
    for (const contact of result.data ?? [])
      contacts.set(contact.request_id, contact.email);
  }
  const pageUrl = (next: number) =>
    `/admin/${kind}?status=${complete ? 'complete' : 'pending'}&page=${next}`;
  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      <h1 className="text-2xl">{config.title}</h1>
      <p className="mt-2 text-sm text-ink-600">
        Review member requests and record the outcome. Follow up through the
        support mailbox when a reply is needed.
      </p>
      <nav
        aria-label={`${config.title} status`}
        className="my-6 flex gap-6 text-sm"
      >
        <Link
          className="underline"
          href={`/admin/${kind}`}
          aria-current={!complete ? 'page' : undefined}
        >
          Pending requests
        </Link>
        <Link
          className="underline"
          href={`/admin/${kind}?status=complete`}
          aria-current={complete ? 'page' : undefined}
        >
          Completed requests
        </Link>
      </nav>
      <p className="mb-4 text-sm">
        {count ?? 0} {complete ? 'completed' : 'pending'} requests.
      </p>
      {!rows.length ? (
        <Card>
          <p>No requests on this page.</p>
        </Card>
      ) : null}
      <div className="space-y-6">
        {rows.map((row) => {
          const source = sourceLink(row.supporting_url);
          return (
            <Card key={row.id} className="min-w-0 break-words">
              <h2 className="text-lg font-semibold">
                {row.subject ?? 'Correction request'}
              </h2>
              <p className="mt-1 text-sm text-ink-600">
                Received {formatDate(row.created_at)} ·{' '}
                {row.status.replace(/_/g, ' ')}
                {row.priority
                  ? ` · ${row.priority} priority · ${row.category?.replace(/_/g, ' ')}`
                  : ''}
              </p>
              <p className="mt-2 text-xs text-ink-600">
                Request {row.id} · Member{' '}
                {row.user_id ?? row.submitted_by_user_id ?? 'deleted account'}
              </p>
              <p className="mt-2 text-sm">
                Reply address:{' '}
                {contacts.get(row.id) ?? 'Unavailable (account deleted)'}
              </p>
              <p className="mt-4 whitespace-pre-wrap">
                {row.message ?? row.description}
              </p>
              <div className="mt-3 flex flex-wrap gap-4 text-sm">
                {row.opportunity_id ? (
                  <Link
                    className="underline"
                    href={`/admin/opportunities/${row.opportunity_id}`}
                  >
                    Open linked opportunity
                  </Link>
                ) : null}
                {row.report_id ? (
                  <Link
                    className="underline"
                    href={`/admin/reports/${row.report_id}`}
                  >
                    Open linked report
                  </Link>
                ) : null}
                {source ? (
                  <a
                    className="underline"
                    href={source}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Supporting source (new tab)
                  </a>
                ) : null}
              </div>
              <MemberRequestForm
                key={`${row.id}:${row.updated_at}`}
                kind={kind}
                id={row.id}
                status={row.status}
                updatedAt={row.updated_at}
                note={row.resolution_notes}
              />
            </Card>
          );
        })}
      </div>
      <nav
        aria-label="Request pages"
        className="mt-6 flex justify-between text-sm"
      >
        {page > 1 ? (
          <Link className="underline" href={pageUrl(page - 1)}>
            Previous page
          </Link>
        ) : (
          <span />
        )}
        <span>Page {page}</span>
        {page * 25 < (count ?? 0) ? (
          <Link className="underline" href={pageUrl(page + 1)}>
            Next page
          </Link>
        ) : (
          <span />
        )}
      </nav>
    </div>
  );
}
