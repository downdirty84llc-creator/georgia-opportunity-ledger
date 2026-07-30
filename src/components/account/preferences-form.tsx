'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';

import { Button, Card, cx } from '@/components/ui/primitives';
import { PROPERTY_TYPES, FUNDING_TYPES } from '@/lib/search/filters';
import { titleCase } from '@/lib/format';

interface Option {
  id: string;
  name: string;
  slug: string;
}

type Preferences = Record<string, unknown>;

const USER_TYPES = [
  ['business_owner', 'Business owner'],
  ['investor', 'Investor'],
  ['contractor', 'Contractor'],
  ['developer', 'Developer'],
  ['adviser', 'Adviser'],
  ['commercial_property_professional', 'Commercial property professional'],
  ['other', 'Something else'],
] as const;

const FREQUENCIES = [
  ['immediate', 'As it happens'],
  ['daily', 'Daily digest'],
  ['weekly', 'Weekly'],
  ['biweekly', 'Every two weeks'],
  ['monthly', 'Monthly'],
  ['never', 'Never'],
] as const;

/**
 * The preferences surface.
 *
 * County selection is a searchable multi-select rather than a 159-item list of
 * checkboxes: the whole state fits in the database, but not on a phone screen.
 */
export function PreferencesForm({
  initial,
  counties,
  industries,
  immediateAlertsEntitled,
}: {
  initial: Preferences;
  counties: readonly Option[];
  industries: readonly Option[];
  immediateAlertsEntitled: boolean;
}) {
  const [form, setForm] = useState({
    primaryUserType: (initial.primary_user_type as string | null) ?? '',
    capitalRangeMin: (initial.capital_range_min as number | null) ?? '',
    capitalRangeMax: (initial.capital_range_max as number | null) ?? '',
    preferredFrequency: (initial.preferred_frequency as string) ?? 'weekly',
    emailAlertsEnabled: (initial.email_alerts_enabled as boolean) ?? true,
    marketingEmailEnabled: (initial.marketing_email_enabled as boolean) ?? false,
    timezone: (initial.timezone as string) ?? 'America/New_York',
    minimumScore: (initial.minimum_score as number) ?? 0,
  });

  const [countyIds, setCountyIds] = useState<string[]>(
    (initial.preferred_county_ids as string[] | null) ?? [],
  );
  const [industryIds, setIndustryIds] = useState<string[]>(
    (initial.preferred_industry_ids as string[] | null) ?? [],
  );
  const [propertyTypes, setPropertyTypes] = useState<string[]>(
    (initial.preferred_property_types as string[] | null) ?? [],
  );
  const [fundingTypes, setFundingTypes] = useState<string[]>(
    (initial.preferred_funding_types as string[] | null) ?? [],
  );

  const [countyQuery, setCountyQuery] = useState('');
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>(
    'idle',
  );
  const [message, setMessage] = useState('');

  const visibleCounties = useMemo(() => {
    const query = countyQuery.trim().toLowerCase();
    if (!query) return counties.slice(0, 24);
    return counties
      .filter((county) => county.name.toLowerCase().includes(query))
      .slice(0, 24);
  }, [counties, countyQuery]);

  const selectedCounties = useMemo(
    () => counties.filter((county) => countyIds.includes(county.id)),
    [counties, countyIds],
  );

  function toggle(
    list: string[],
    setList: (next: string[]) => void,
    value: string,
  ) {
    setList(
      list.includes(value)
        ? list.filter((item) => item !== value)
        : [...list, value],
    );
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setStatus('saving');
    setMessage('');

    try {
      const response = await fetch('/api/v1/preferences', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          primaryUserType: form.primaryUserType || null,
          capitalRangeMin:
            form.capitalRangeMin === '' ? null : Number(form.capitalRangeMin),
          capitalRangeMax:
            form.capitalRangeMax === '' ? null : Number(form.capitalRangeMax),
          preferredFrequency: form.preferredFrequency,
          emailAlertsEnabled: form.emailAlertsEnabled,
          marketingEmailEnabled: form.marketingEmailEnabled,
          timezone: form.timezone,
          minimumScore: Number(form.minimumScore),
          preferredCountyIds: countyIds,
          preferredIndustryIds: industryIds,
          preferredPropertyTypes: propertyTypes,
          preferredFundingTypes: fundingTypes,
          onboardingComplete: true,
        }),
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        setStatus('error');
        const issues = payload?.error?.details?.issues as
          | Array<{ message: string }>
          | undefined;
        setMessage(
          issues?.map((issue) => issue.message).join(' ') ??
            payload?.error?.message ??
            'Your preferences could not be saved.',
        );
        return;
      }

      setStatus('saved');
      setMessage('Preferences saved.');
    } catch {
      setStatus('error');
      setMessage('Your preferences could not be saved. Try again.');
    }
  }

  return (
    <form onSubmit={save} className="space-y-6">
      <Card>
        <h2 className="text-base font-semibold">About you</h2>
        <div className="mt-4 space-y-4">
          <div>
            <label htmlFor="primaryUserType" className="block text-sm font-medium">
              I am a
            </label>
            <select
              id="primaryUserType"
              value={form.primaryUserType}
              onChange={(event) =>
                setForm({ ...form, primaryUserType: event.target.value })
              }
              className="mt-1 w-full rounded-lg border border-ink-300 px-3 py-2 text-sm"
            >
              <option value="">Not set</option>
              {USER_TYPES.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>

          <fieldset>
            <legend className="text-sm font-medium">
              Capital I can realistically deploy
            </legend>
            <p className="mt-1 text-xs text-ink-500">
              Used to rank records, never to exclude them. A record with no
              stated capital requirement is always shown.
            </p>
            <div className="mt-2 grid gap-3 sm:grid-cols-2">
              <div>
                <label
                  htmlFor="capitalRangeMin"
                  className="block text-xs text-ink-600"
                >
                  From
                </label>
                <input
                  id="capitalRangeMin"
                  type="number"
                  min={0}
                  step={10000}
                  value={form.capitalRangeMin}
                  onChange={(event) =>
                    setForm({ ...form, capitalRangeMin: event.target.value })
                  }
                  className="mt-1 w-full rounded-lg border border-ink-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label
                  htmlFor="capitalRangeMax"
                  className="block text-xs text-ink-600"
                >
                  Up to
                </label>
                <input
                  id="capitalRangeMax"
                  type="number"
                  min={0}
                  step={10000}
                  value={form.capitalRangeMax}
                  onChange={(event) =>
                    setForm({ ...form, capitalRangeMax: event.target.value })
                  }
                  className="mt-1 w-full rounded-lg border border-ink-300 px-3 py-2 text-sm"
                />
              </div>
            </div>
          </fieldset>
        </div>
      </Card>

      <Card>
        <h2 className="text-base font-semibold">Counties you follow</h2>
        <p className="mt-1 text-sm text-ink-600">
          Leave empty to follow the whole state.{' '}
          {selectedCounties.length > 0
            ? `${selectedCounties.length} selected.`
            : 'None selected.'}
        </p>

        {selectedCounties.length > 0 ? (
          <ul className="mt-3 flex flex-wrap gap-2">
            {selectedCounties.map((county) => (
              <li key={county.id}>
                <button
                  type="button"
                  onClick={() => toggle(countyIds, setCountyIds, county.id)}
                  className="inline-flex items-center gap-1.5 rounded-full bg-ink-900 px-3 py-1 text-xs font-medium text-white"
                >
                  {county.name}
                  <span aria-hidden="true">×</span>
                  <span className="sr-only">Remove {county.name} County</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        <label htmlFor="countySearch" className="mt-4 block text-sm font-medium">
          Find a county
        </label>
        <input
          id="countySearch"
          type="search"
          value={countyQuery}
          onChange={(event) => setCountyQuery(event.target.value)}
          placeholder="Chatham, Fulton, Whitfield…"
          className="mt-1 w-full rounded-lg border border-ink-300 px-3 py-2 text-sm"
        />

        <ul className="mt-3 flex flex-wrap gap-2">
          {visibleCounties.map((county) => {
            const selected = countyIds.includes(county.id);
            return (
              <li key={county.id}>
                <button
                  type="button"
                  aria-pressed={selected}
                  onClick={() => toggle(countyIds, setCountyIds, county.id)}
                  className={cx(
                    'rounded-full border px-3 py-1 text-xs',
                    selected
                      ? 'border-ink-900 bg-ink-900 text-white'
                      : 'border-ink-300 hover:bg-ink-50',
                  )}
                >
                  {county.name}
                </button>
              </li>
            );
          })}
        </ul>
        {countyQuery && visibleCounties.length === 0 ? (
          <p className="mt-3 text-sm text-ink-500">
            No county matches “{countyQuery}”.
          </p>
        ) : null}
      </Card>

      <Card>
        <h2 className="text-base font-semibold">What interests you</h2>

        <fieldset className="mt-4">
          <legend className="text-sm font-medium">Industries</legend>
          <ul className="mt-2 flex flex-wrap gap-2">
            {industries.map((industry) => {
              const selected = industryIds.includes(industry.id);
              return (
                <li key={industry.id}>
                  <button
                    type="button"
                    aria-pressed={selected}
                    onClick={() => toggle(industryIds, setIndustryIds, industry.id)}
                    className={cx(
                      'rounded-full border px-3 py-1 text-xs',
                      selected
                        ? 'border-ink-900 bg-ink-900 text-white'
                        : 'border-ink-300 hover:bg-ink-50',
                    )}
                  >
                    {industry.name}
                  </button>
                </li>
              );
            })}
          </ul>
        </fieldset>

        <fieldset className="mt-5">
          <legend className="text-sm font-medium">Property types</legend>
          <ul className="mt-2 flex flex-wrap gap-2">
            {PROPERTY_TYPES.map((type) => {
              const selected = propertyTypes.includes(type);
              return (
                <li key={type}>
                  <button
                    type="button"
                    aria-pressed={selected}
                    onClick={() => toggle(propertyTypes, setPropertyTypes, type)}
                    className={cx(
                      'rounded-full border px-3 py-1 text-xs',
                      selected
                        ? 'border-ink-900 bg-ink-900 text-white'
                        : 'border-ink-300 hover:bg-ink-50',
                    )}
                  >
                    {titleCase(type)}
                  </button>
                </li>
              );
            })}
          </ul>
        </fieldset>

        <fieldset className="mt-5">
          <legend className="text-sm font-medium">Funding types</legend>
          <ul className="mt-2 flex flex-wrap gap-2">
            {FUNDING_TYPES.map((type) => {
              const selected = fundingTypes.includes(type);
              return (
                <li key={type}>
                  <button
                    type="button"
                    aria-pressed={selected}
                    onClick={() => toggle(fundingTypes, setFundingTypes, type)}
                    className={cx(
                      'rounded-full border px-3 py-1 text-xs',
                      selected
                        ? 'border-ink-900 bg-ink-900 text-white'
                        : 'border-ink-300 hover:bg-ink-50',
                    )}
                  >
                    {titleCase(type)}
                  </button>
                </li>
              );
            })}
          </ul>
        </fieldset>
      </Card>

      <Card>
        <h2 className="text-base font-semibold">Alerts and email</h2>
        <div className="mt-4 space-y-4">
          <div>
            <label htmlFor="minimumScore" className="block text-sm font-medium">
              Only alert me about records scoring at least{' '}
              <span className="tabular-nums">{form.minimumScore}</span>
            </label>
            <input
              id="minimumScore"
              type="range"
              min={0}
              max={100}
              step={5}
              value={form.minimumScore}
              onChange={(event) =>
                setForm({ ...form, minimumScore: Number(event.target.value) })
              }
              className="mt-2 w-full"
            />
            <p className="mt-1 text-xs text-ink-500">
              0 means everything that matches your filters. 70 and above is
              &ldquo;Strong Opportunity&rdquo; or better.
            </p>
          </div>

          <div>
            <label
              htmlFor="preferredFrequency"
              className="block text-sm font-medium"
            >
              Report frequency
            </label>
            <select
              id="preferredFrequency"
              value={form.preferredFrequency}
              onChange={(event) =>
                setForm({ ...form, preferredFrequency: event.target.value })
              }
              className="mt-1 w-full rounded-lg border border-ink-300 px-3 py-2 text-sm"
            >
              {FREQUENCIES.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>

          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.emailAlertsEnabled}
              onChange={(event) =>
                setForm({ ...form, emailAlertsEnabled: event.target.checked })
              }
              className="mt-0.5 rounded border-ink-300"
            />
            <span>
              Send me alert and deadline emails.
              {!immediateAlertsEntitled ? (
                <span className="block text-xs text-ink-500">
                  Immediate alerts are a Premium capability; deadline reminders
                  for records you have saved are included with your plan.
                </span>
              ) : null}
            </span>
          </label>

          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.marketingEmailEnabled}
              onChange={(event) =>
                setForm({ ...form, marketingEmailEnabled: event.target.checked })
              }
              className="mt-0.5 rounded border-ink-300"
            />
            <span>
              Send me occasional product and marketing email. Off by default,
              and never required.
            </span>
          </label>

          <div>
            <label htmlFor="timezone" className="block text-sm font-medium">
              Time zone
            </label>
            <input
              id="timezone"
              value={form.timezone}
              onChange={(event) =>
                setForm({ ...form, timezone: event.target.value })
              }
              className="mt-1 w-full rounded-lg border border-ink-300 px-3 py-2 text-sm"
            />
            <p className="mt-1 text-xs text-ink-500">
              Deadlines are shown in this zone. Most Georgia members want
              America/New_York.
            </p>
          </div>
        </div>
      </Card>

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
          {status === 'saving' ? 'Saving…' : 'Save preferences'}
        </Button>
        <Link href="/account" className="text-sm font-medium underline">
          Back to account
        </Link>
      </div>
    </form>
  );
}
