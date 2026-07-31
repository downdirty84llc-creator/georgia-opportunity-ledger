'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { Button, Card, Pill } from '@/components/ui/primitives';

export interface StaffRow {
  userId: string;
  email: string | null;
  displayName: string | null;
  role: string;
  accountStatus: string;
  mfaRequired: boolean;
  verifiedFactors: number;
  unverifiedFactors: number;
  lastEnrolledAt: string | null;
}

const ROLE_LABELS: Record<string, string> = {
  researcher: 'Researcher',
  reviewer: 'Reviewer',
  editor: 'Editor',
  support_representative: 'Support representative',
  billing_manager: 'Billing manager',
  super_administrator: 'Super administrator',
};

function describe(row: StaffRow): string {
  return row.displayName ?? row.email ?? row.userId;
}

export function StaffMfaTable({
  staff,
  actorId,
}: {
  staff: StaffRow[];
  actorId: string;
}) {
  const router = useRouter();
  const [openFor, setOpenFor] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function submit(row: StaffRow) {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/v1/admin/staff/${row.userId}/reset-mfa`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ reason }),
        },
      );
      const body: {
        data?: { message?: string };
        error?: { message?: string };
      } = await response.json();

      if (!response.ok) {
        setError(body.error?.message ?? 'The reset did not go through.');
        return;
      }

      setNotice(
        `${describe(row)}: ${body.data?.message ?? 'Enrolment cleared.'}`,
      );
      setOpenFor(null);
      setReason('');
      router.refresh();
    } catch {
      setError('Could not reach the server. Nothing was changed.');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-4">
      {notice ? (
        <p
          role="status"
          className="rounded-md border border-green-700 bg-green-50 px-4 py-3 text-sm text-green-900"
        >
          {notice}
        </p>
      ) : null}

      {staff.map((row) => {
        const isSelf = row.userId === actorId;
        const enrolled = row.verifiedFactors > 0;

        return (
          <Card key={row.userId}>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="font-medium">{describe(row)}</p>
                <p className="text-sm text-ink-600">
                  {ROLE_LABELS[row.role] ?? row.role}
                  {row.email && row.displayName ? ` · ${row.email}` : ''}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Pill tone={enrolled ? 'positive' : 'warning'}>
                    {enrolled
                      ? `${row.verifiedFactors} factor${row.verifiedFactors === 1 ? '' : 's'} enrolled`
                      : 'No second factor'}
                  </Pill>
                  {row.unverifiedFactors > 0 ? (
                    <Pill tone="warning">
                      {row.unverifiedFactors} unfinished enrolment
                    </Pill>
                  ) : null}
                  {row.accountStatus !== 'active' ? (
                    <Pill tone="warning">Account {row.accountStatus}</Pill>
                  ) : null}
                </div>
              </div>

              <div className="text-right">
                {isSelf ? (
                  <p className="max-w-[16rem] text-sm text-ink-600">
                    You cannot reset your own enrolment — ask another super
                    administrator.
                  </p>
                ) : enrolled || row.unverifiedFactors > 0 ? (
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setOpenFor(openFor === row.userId ? null : row.userId);
                      setReason('');
                      setError(null);
                    }}
                    aria-expanded={openFor === row.userId}
                  >
                    Reset two-factor
                  </Button>
                ) : (
                  <p className="max-w-[16rem] text-sm text-ink-600">
                    Nothing to clear. They will be asked to enrol on their next
                    visit to the admin area.
                  </p>
                )}
              </div>
            </div>

            {openFor === row.userId ? (
              <div className="mt-4 border-t border-ink-200 pt-4">
                <p className="text-sm text-ink-700">
                  This removes every enrolled factor on {describe(row)}&rsquo;s
                  account. They keep member access and their password is
                  untouched. Confirm their identity by a route other than email
                  before you do this — email is the thing a second factor is
                  protecting.
                </p>

                <label
                  htmlFor={`reason-${row.userId}`}
                  className="mt-4 block text-sm font-medium"
                >
                  Why, and how you confirmed it was them
                </label>
                <textarea
                  id={`reason-${row.userId}`}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  rows={3}
                  required
                  minLength={10}
                  maxLength={500}
                  className="mt-1 w-full rounded-md border border-ink-300 px-3 py-2 text-sm"
                  placeholder="Lost phone; confirmed by video call on 30 July."
                />
                <p className="mt-1 text-xs text-ink-500">
                  Stored on the audit entry alongside your name and the factors
                  removed.
                </p>

                {error ? (
                  <p
                    role="alert"
                    className="mt-3 rounded-md border border-red-700 bg-red-50 px-3 py-2 text-sm text-red-900"
                  >
                    {error}
                  </p>
                ) : null}

                <div className="mt-4 flex gap-3">
                  <Button
                    onClick={() => void submit(row)}
                    disabled={pending || reason.trim().length < 10}
                  >
                    {pending ? 'Clearing…' : 'Clear enrolment'}
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => setOpenFor(null)}
                    disabled={pending}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : null}
          </Card>
        );
      })}
    </div>
  );
}
