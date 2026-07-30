'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button } from '@/components/ui/primitives';

/**
 * Approve / publish buttons for the review queue.
 *
 * The buttons a reviewer sees are decided server-side and passed in; this
 * component only ever calls the workflow endpoints, which re-check the role.
 */
export function ReviewActions({
  opportunityId,
  workflowStatus,
  canApprove,
  canPublish,
}: {
  opportunityId: string;
  workflowStatus: string;
  canApprove: boolean;
  canPublish: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function act(action: 'approve' | 'publish') {
    setBusy(action);
    setError(null);
    try {
      const response = await fetch(
        `/api/v1/admin/opportunities/${opportunityId}/${action}`,
        { method: 'POST' },
      );
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        setError(payload?.error?.message ?? `Could not ${action} the record.`);
        return;
      }
      router.refresh();
    } catch {
      setError(`Could not ${action} the record. Try again.`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="flex gap-1.5">
        {canApprove && workflowStatus === 'internal_review' ? (
          <Button
            variant="secondary"
            className="px-3 py-1.5 text-xs"
            disabled={busy !== null}
            onClick={() => act('approve')}
          >
            {busy === 'approve' ? 'Approving…' : 'Approve'}
          </Button>
        ) : null}
        {canPublish &&
        (workflowStatus === 'approved' || workflowStatus === 'scheduled') ? (
          <Button
            className="px-3 py-1.5 text-xs"
            disabled={busy !== null}
            onClick={() => act('publish')}
          >
            {busy === 'publish' ? 'Publishing…' : 'Publish'}
          </Button>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="max-w-[200px] text-right text-xs text-red-800">
          {error}
        </p>
      ) : null}
    </div>
  );
}
