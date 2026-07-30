'use client';

import { useState } from 'react';

import { Button, ButtonLink, Pill, cx } from '@/components/ui/primitives';
import type { PlanSummary } from '@/lib/public-data';

/**
 * Plan cards with a monthly/annual toggle.
 *
 * The annual saving is computed from the two prices rather than hard-coded, so
 * an operator changing a price in the database cannot leave a stale "save 20%"
 * claim on the page.
 */
export function PlanGrid({
  plans,
  isAuthenticated,
  currentPlanCode,
}: {
  plans: readonly PlanSummary[];
  isAuthenticated: boolean;
  currentPlanCode: string;
}) {
  const [interval, setInterval] = useState<'monthly' | 'annual'>('monthly');
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function startCheckout(planCode: string) {
    setPending(planCode);
    setError(null);
    try {
      const response = await fetch('/api/v1/billing/create-checkout-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planCode, interval }),
      });
      const payload = await response.json();
      if (!response.ok) {
        setError(payload?.error?.message ?? 'Checkout could not be started.');
        return;
      }
      if (payload?.data?.url) {
        window.location.href = payload.data.url;
      }
    } catch {
      setError('Checkout could not be started. Please try again.');
    } finally {
      setPending(null);
    }
  }

  return (
    <div>
      <div className="mb-8 flex justify-center">
        <div
          role="group"
          aria-label="Billing interval"
          className="inline-flex rounded-lg border border-ink-300 bg-white p-1"
        >
          {(['monthly', 'annual'] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setInterval(option)}
              aria-pressed={interval === option}
              className={cx(
                'rounded-md px-4 py-2 text-sm font-medium capitalize transition-colors',
                interval === option
                  ? 'bg-ink-900 text-white'
                  : 'text-ink-700 hover:bg-ink-100',
              )}
            >
              {option}
              {option === 'annual' ? (
                <span className="ml-2 text-xs font-normal opacity-80">
                  2 months free
                </span>
              ) : null}
            </button>
          ))}
        </div>
      </div>

      {error ? (
        <p
          role="alert"
          className="mx-auto mb-6 max-w-xl rounded-lg bg-red-50 px-4 py-3 text-sm text-red-900"
        >
          {error}
        </p>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-4">
        {plans.map((plan) => {
          const price =
            interval === 'annual' ? plan.annualPrice : plan.monthlyPrice;
          const isFree = plan.accessRank === 0;
          const isCurrent = plan.code === currentPlanCode;
          const monthlyEquivalent =
            interval === 'annual' && plan.annualPrice > 0
              ? plan.annualPrice / 12
              : null;
          const annualSaving =
            plan.monthlyPrice > 0 && plan.annualPrice > 0
              ? plan.monthlyPrice * 12 - plan.annualPrice
              : 0;

          return (
            <div
              key={plan.id}
              className={cx(
                'surface flex flex-col p-6',
                plan.isRecommended && 'ring-2 ring-ink-900',
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <h3 className="text-lg font-semibold">{plan.name}</h3>
                {plan.isRecommended ? <Pill tone="positive">Recommended</Pill> : null}
                {isCurrent ? <Pill>Your plan</Pill> : null}
              </div>

              <p className="mt-3">
                <span className="text-3xl font-semibold tabular-nums">
                  ${price}
                </span>
                <span className="text-sm text-ink-500">
                  {isFree ? '' : interval === 'annual' ? '/year' : '/month'}
                </span>
              </p>
              {monthlyEquivalent ? (
                <p className="mt-1 text-xs text-ink-500">
                  ${monthlyEquivalent.toFixed(2)} per month, billed annually
                  {annualSaving > 0 ? ` — saves $${annualSaving}` : ''}
                </p>
              ) : null}

              <p className="mt-4 flex-1 text-sm leading-relaxed text-ink-700">
                {plan.description}
              </p>

              <div className="mt-6">
                {isFree ? (
                  <ButtonLink
                    href={isAuthenticated ? '/dashboard' : '/register'}
                    variant="secondary"
                    className="w-full"
                  >
                    {isAuthenticated ? 'Go to dashboard' : 'Create a free account'}
                  </ButtonLink>
                ) : isCurrent ? (
                  <ButtonLink
                    href="/account/billing"
                    variant="secondary"
                    className="w-full"
                  >
                    Manage subscription
                  </ButtonLink>
                ) : isAuthenticated ? (
                  <Button
                    className="w-full"
                    disabled={pending !== null}
                    onClick={() => startCheckout(plan.code)}
                    variant={plan.isRecommended ? 'primary' : 'secondary'}
                  >
                    {pending === plan.code ? 'Opening checkout…' : `Choose ${plan.name}`}
                  </Button>
                ) : (
                  <ButtonLink
                    href={`/register?plan=${plan.code}&interval=${interval}`}
                    variant={plan.isRecommended ? 'primary' : 'secondary'}
                    className="w-full"
                  >
                    Choose {plan.name}
                  </ButtonLink>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
