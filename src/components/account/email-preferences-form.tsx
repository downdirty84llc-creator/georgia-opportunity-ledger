'use client';

import Link from 'next/link';
import { useState } from 'react';

import { Button, Card, Pill } from '@/components/ui/primitives';

interface AlertPreference {
  id: string;
  alert_type: string;
  enabled: boolean;
  frequency: string;
}

/**
 * Alert types a member can control, in the order they matter to them rather
 * than the order they appear in the enum.
 */
const ALERT_TYPES: ReadonlyArray<{
  type: string;
  label: string;
  description: string;
  requires?: 'premium' | 'weekly';
}> = [
  {
    type: 'high_score',
    label: 'New matching records',
    description:
      'Sent as soon as a record matching your filters is published.',
    requires: 'premium',
  },
  {
    type: 'material_update',
    label: 'Material changes',
    description:
      'A deadline moves, an amount changes, eligibility is rewritten, or a closed record reopens.',
    requires: 'premium',
  },
  {
    type: 'closing_soon',
    label: 'Deadline reminders',
    description:
      'Fourteen, seven and two days before a deadline on a record you have saved.',
  },
  {
    type: 'weekly_report',
    label: 'The weekly report',
    description: 'Published every Thursday, weighted to your counties.',
    requires: 'weekly',
  },
  {
    type: 'premium_briefing',
    label: 'Premium briefing',
    description: 'The deeper periodic briefing for Premium members.',
    requires: 'premium',
  },
];

export function EmailPreferencesForm({
  emailAlertsEnabled,
  marketingEmailEnabled,
  alertPreferences,
  immediateAlertsEntitled,
  weeklyReportsEntitled,
  prefillUnsubscribe,
}: {
  emailAlertsEnabled: boolean;
  marketingEmailEnabled: boolean;
  alertPreferences: readonly AlertPreference[];
  immediateAlertsEntitled: boolean;
  weeklyReportsEntitled: boolean;
  prefillUnsubscribe: boolean;
}) {
  // Arriving from an email footer's unsubscribe link pre-sets everything off,
  // so the member's intent is one click from done rather than a form to fill.
  const [alerts, setAlerts] = useState(
    prefillUnsubscribe ? false : emailAlertsEnabled,
  );
  const [marketing, setMarketing] = useState(
    prefillUnsubscribe ? false : marketingEmailEnabled,
  );

  const [disabledTypes, setDisabledTypes] = useState<Set<string>>(() => {
    const initial = new Set<string>();
    for (const preference of alertPreferences) {
      if (!preference.enabled) initial.add(preference.alert_type);
    }
    if (prefillUnsubscribe) {
      for (const entry of ALERT_TYPES) initial.add(entry.type);
    }
    return initial;
  });

  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>(
    'idle',
  );
  const [message, setMessage] = useState('');

  function toggleType(type: string) {
    setDisabledTypes((current) => {
      const next = new Set(current);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setStatus('saving');
    setMessage('');

    try {
      const response = await fetch('/api/v1/alert-preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          emailAlertsEnabled: alerts,
          marketingEmailEnabled: marketing,
          alertTypes: ALERT_TYPES.map((entry) => ({
            alertType: entry.type,
            enabled: !disabledTypes.has(entry.type),
          })),
        }),
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        setStatus('error');
        setMessage(
          payload?.error?.message ?? 'Your preferences could not be saved.',
        );
        return;
      }

      setStatus('saved');
      setMessage(
        alerts || marketing
          ? 'Email preferences saved.'
          : 'Saved. You will receive only essential account and billing email.',
      );
    } catch {
      setStatus('error');
      setMessage('Your preferences could not be saved. Try again.');
    }
  }

  return (
    <form onSubmit={save} className="space-y-6">
      {prefillUnsubscribe ? (
        <p className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          We have pre-set everything to off. Press save to confirm, or turn back
          on just the messages you do want.
        </p>
      ) : null}

      <Card>
        <h2 className="text-base font-semibold">Master switches</h2>
        <div className="mt-4 space-y-4">
          <label className="flex items-start gap-3 text-sm">
            <input
              type="checkbox"
              checked={alerts}
              onChange={(event) => setAlerts(event.target.checked)}
              className="mt-0.5 rounded border-ink-300"
            />
            <span>
              <span className="font-medium">Alert and report email.</span>
              <span className="block text-ink-600">
                Everything below. Turning this off stops all of it at once.
              </span>
            </span>
          </label>

          <label className="flex items-start gap-3 text-sm">
            <input
              type="checkbox"
              checked={marketing}
              onChange={(event) => setMarketing(event.target.checked)}
              className="mt-0.5 rounded border-ink-300"
            />
            <span>
              <span className="font-medium">Product and marketing email.</span>
              <span className="block text-ink-600">
                Off by default, and never required to use the service.
              </span>
            </span>
          </label>
        </div>
      </Card>

      <Card>
        <h2 className="text-base font-semibold">Individual alerts</h2>
        <p className="mt-1 text-sm text-ink-600">
          {alerts
            ? 'Fine-grained control over what is worth interrupting you for.'
            : 'These are all paused while alert email is switched off above.'}
        </p>

        <ul className="mt-4 space-y-4">
          {ALERT_TYPES.map((entry) => {
            const entitled =
              entry.requires === 'premium'
                ? immediateAlertsEntitled
                : entry.requires === 'weekly'
                  ? weeklyReportsEntitled
                  : true;

            return (
              <li key={entry.type}>
                <label className="flex items-start gap-3 text-sm">
                  <input
                    type="checkbox"
                    checked={!disabledTypes.has(entry.type)}
                    disabled={!alerts}
                    onChange={() => toggleType(entry.type)}
                    className="mt-0.5 rounded border-ink-300"
                  />
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-2 font-medium">
                      {entry.label}
                      {!entitled ? (
                        <Pill tone="muted">
                          {entry.requires === 'premium' ? 'Premium' : 'Weekly'}
                        </Pill>
                      ) : null}
                    </span>
                    <span className="block text-ink-600">
                      {entry.description}
                    </span>
                    {!entitled ? (
                      <Link
                        href="/pricing"
                        className="mt-1 inline-block text-xs font-medium underline"
                      >
                        Included with a higher plan
                      </Link>
                    ) : null}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      </Card>

      <p className="text-sm text-ink-600">
        Whatever you choose here, we will still send essential account and
        billing messages: a failed payment, a password reset, a change to these
        terms. Those are not marketing and cannot be switched off while the
        account is open. See the{' '}
        <Link href="/legal/privacy" className="underline">
          privacy policy
        </Link>
        .
      </p>

      {message ? (
        <p
          role={status === 'error' ? 'alert' : 'status'}
          className={
            status === 'error'
              ? 'rounded-lg bg-red-50 px-4 py-3 text-sm text-red-900'
              : 'rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-900'
          }
        >
          {message}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={status === 'saving'}>
          {status === 'saving' ? 'Saving…' : 'Save email preferences'}
        </Button>
        <Link href="/account" className="text-sm font-medium underline">
          Back to account
        </Link>
      </div>
    </form>
  );
}
