'use client';
import { useEffect, useState } from 'react';
import { Button, Card } from '@/components/ui/primitives';

export function EmailTestPanel({
  reportId,
  email,
}: {
  reportId: string | null;
  email: string;
}) {
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [message, setMessage] = useState('');
  const [independent, setIndependent] = useState<boolean | null>(null);
  useEffect(() => {
    let active = true;
    fetch('/api/v1/admin/email-test', { cache: 'no-store' })
      .then(async (response) => {
        const body = await response.json();
        if (!active) return;
        if (response.ok) setIndependent(body.data.dedicatedUnsubscribeSecret);
        else {
          setIndependent(false);
          setMessage(
            body.error?.message ?? 'Email configuration could not be checked.',
          );
        }
      })
      .catch(() => {
        if (active) setMessage('Email configuration could not be checked.');
      });
    return () => {
      active = false;
    };
  }, []);
  async function send() {
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch('/api/v1/admin/email-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reportId }),
      });
      const body = await response.json();
      if (!response.ok) {
        setMessage(
          body.error?.message ??
            'Email test failed. Check the inbox before retrying.',
        );
        return;
      }
      setSubmitted(true);
      setMessage(
        `Test submitted to ${body.data.recipient}. Provider reference: ${body.data.providerMessageId}. Confirm inbox delivery separately.`,
      );
    } catch {
      setMessage(
        'Submission could not be confirmed. Check the inbox before retrying.',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card>
      <h1 className="text-2xl font-semibold">Email delivery check</h1>
      <p className="mt-3">
        Send one report test to your own confirmed inbox: {email}.
      </p>
      <p className="mt-2 text-sm">
        The email includes a signed unsubscribe link. It changes no subscription
        or payment setting. Use the link only when you intend to test turning
        off your alerts.
      </p>
      <p className="mt-3 text-sm">
        Independent unsubscribe secret:{' '}
        {independent === null
          ? 'Checking…'
          : independent
            ? 'Configured'
            : 'Needs configuration'}
      </p>
      <Button
        className="mt-4"
        disabled={busy || submitted || !reportId || independent !== true}
        onClick={send}
      >
        {busy
          ? 'Submitting…'
          : submitted
            ? 'Test submitted'
            : 'Send test to my inbox'}
      </Button>
      {!reportId ? (
        <p className="mt-2 text-sm">
          Publish a report before sending this test.
        </p>
      ) : null}
      {message ? (
        <p role="status" className="mt-3 text-sm">
          {message}
        </p>
      ) : null}
    </Card>
  );
}
