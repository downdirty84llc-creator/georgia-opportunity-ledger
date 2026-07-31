import type { Metadata } from 'next';

import { EmptyState } from '@/components/ui/primitives';
import { getSessionContext } from '@/lib/auth/session';
import { createServerSupabaseClient } from '@/lib/db/server';
import { formatDate } from '@/lib/format';

export const metadata: Metadata = { title: 'Audit log — admin' };
export const dynamic = 'force-dynamic';

export default async function AdminAuditPage() {
  const { viewer } = await getSessionContext();
  const supabase = await createServerSupabaseClient();

  // Row-level security limits this table to super administrators; other staff
  // roles see an empty result rather than an error.
  const { data } = await supabase
    .from('audit_logs')
    .select(
      `id, action, entity_type, entity_id, previous_values, new_values,
       actor_user_id, created_at`,
    )
    .order('created_at', { ascending: false })
    .limit(200);

  const rows = data ?? [];

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
      <h1 className="text-2xl sm:text-3xl">Audit log</h1>
      <p className="mt-1 text-sm text-ink-600">
        Append-only. No interface exists — at any permission level — that can
        edit or remove an entry.
      </p>

      {rows.length === 0 ? (
        <div className="mt-8">
          <EmptyState
            title={
              viewer.role === 'super_administrator'
                ? 'No audit events yet'
                : 'Restricted to super administrators'
            }
            description={
              viewer.role === 'super_administrator'
                ? 'Events appear here as records are published, scores change, and accounts are administered.'
                : 'Your role can see that the log exists, but only a super administrator can read it.'
            }
          />
        </div>
      ) : (
        <div className="surface mt-8 overflow-x-auto">
          <table className="min-w-[820px] text-sm">
            <thead>
              <tr className="border-b border-ink-200 bg-ink-50 text-left">
                <th scope="col" className="px-4 py-3 font-semibold">
                  Action
                </th>
                <th scope="col" className="px-4 py-3 font-semibold">
                  Entity
                </th>
                <th scope="col" className="px-4 py-3 font-semibold">
                  Change
                </th>
                <th scope="col" className="px-4 py-3 font-semibold">
                  When
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.id}
                  className="border-b border-ink-100 align-top last:border-0"
                >
                  <td className="px-4 py-3 font-medium">{row.action}</td>
                  <td className="px-4 py-3 text-ink-600">
                    {row.entity_type}
                    {row.entity_id ? (
                      <span className="block font-mono text-xs text-ink-500">
                        {String(row.entity_id).slice(0, 8)}…
                      </span>
                    ) : null}
                  </td>
                  <td className="max-w-[380px] px-4 py-3">
                    <code className="block overflow-x-auto whitespace-pre-wrap break-all text-xs text-ink-600">
                      {JSON.stringify(
                        row.new_values ?? row.previous_values ?? {},
                      )}
                    </code>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-ink-500">
                    {formatDate(row.created_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
