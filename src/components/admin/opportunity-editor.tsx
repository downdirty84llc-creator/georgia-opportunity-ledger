'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  Button,
  Card,
  Meter,
  Pill,
  ScoreBadge,
  cx,
} from '@/components/ui/primitives';
import { ACCESS_RANK, planCodeForRank } from '@/lib/access/ranks';
import { titleCase } from '@/lib/format';
import {
  EDITOR_STEPS,
  FIELD_LABELS,
  SCORE_FIELDS,
  incompleteFields,
  stepIsComplete,
  type EditorDraft,
} from '@/lib/opportunities/editor-schema';
import { buildScore } from '@/lib/scoring/score';
import {
  FUNDING_TYPES,
  OPPORTUNITY_CATEGORIES,
  OPPORTUNITY_STATUSES,
  PROPERTY_TYPES,
  VERIFICATION_STATUSES,
} from '@/lib/search/filters';

interface Option {
  id: string;
  name: string;
}

const SALE_TYPES = [
  'standard_listing',
  'auction',
  'tax_sale',
  'sheriff_sale',
  'foreclosure',
  'bank_owned',
  'government_sale',
  'development_authority',
  'distressed_sale',
  'off_market_indication',
] as const;

const ACCESS_RANK_OPTIONS = [
  { rank: ACCESS_RANK.free, label: 'Free — visible to everyone' },
  { rank: ACCESS_RANK.weekly, label: 'Weekly and above' },
  { rank: ACCESS_RANK.detailed, label: 'Detailed and above' },
  { rank: ACCESS_RANK.premium, label: 'Premium only' },
];

const AUTOSAVE_DELAY_MS = 1500;

type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

/**
 * The seven-step opportunity editor (spec 15.2).
 *
 * Two things it does that a plain form does not:
 *
 * **Autosave with draft recovery.** Editorial work is long-form; losing twenty
 * minutes of analysis to a closed tab is the failure that makes people stop
 * using an admin tool. Changes are debounced to the server, and a local copy is
 * kept so an interrupted session can be recovered even if the network was the
 * thing that failed.
 *
 * **A publish gate that explains itself.** Rather than a disabled button, the
 * publication step lists exactly which fields are missing and which step each
 * one lives on, because "why can't I publish" is otherwise a support ticket.
 */
export function OpportunityEditor({
  opportunityId: initialId,
  initialDraft,
  workflowStatus: initialWorkflowStatus,
  counties,
  cities,
  industries,
  sources,
  stateId,
  canApprove,
  canPublish,
}: {
  opportunityId: string | null;
  initialDraft: EditorDraft;
  workflowStatus: string;
  counties: readonly Option[];
  cities: readonly Option[];
  industries: readonly Option[];
  sources: readonly Option[];
  stateId: string;
  canApprove: boolean;
  canPublish: boolean;
}) {
  const router = useRouter();
  const [opportunityId, setOpportunityId] = useState(initialId);
  const [workflowStatus, setWorkflowStatus] = useState(initialWorkflowStatus);
  const [draft, setDraft] = useState<EditorDraft>(initialDraft);
  const [stepIndex, setStepIndex] = useState(0);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [saveMessage, setSaveMessage] = useState('');
  const [recovered, setRecovered] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionIsError, setActionIsError] = useState(false);
  const [previewRank, setPreviewRank] = useState<number>(ACCESS_RANK.premium);

  const storageKey = `ledger:draft:${initialId ?? 'new'}`;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firstRender = useRef(true);

  const step = EDITOR_STEPS[stepIndex] ?? EDITOR_STEPS[0]!;
  const missing = useMemo(() => incompleteFields(draft), [draft]);

  const scoreResult = useMemo(
    () =>
      buildScore(draft.score, {
        manualAdjustment: draft.manualAdjustment,
        adjustmentReason: draft.adjustmentReason || null,
      }),
    [draft.score, draft.manualAdjustment, draft.adjustmentReason],
  );

  // --- Draft recovery ------------------------------------------------------

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(storageKey);
      if (!stored) return;
      const parsed = JSON.parse(stored) as {
        savedAt: string;
        draft: EditorDraft;
      };
      // Only offer recovery when the local copy differs from what the server
      // handed us; otherwise it is just noise.
      if (JSON.stringify(parsed.draft) !== JSON.stringify(initialDraft)) {
        setDraft(parsed.draft);
        setRecovered(true);
      }
    } catch {
      // A corrupt local draft is not worth surfacing; the server copy stands.
    }
    // Recovery runs once, on mount, against the draft the server supplied.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Autosave ------------------------------------------------------------

  const persist = useCallback(
    async (current: EditorDraft) => {
      setSaveState('saving');
      setSaveMessage('');

      const body: Record<string, unknown> = {
        title: current.title,
        category: current.category,
        subtype: current.subtype || 'general',
        summary: current.summary,
        status: current.status,
        stateId: current.stateId || stateId || null,
        countyId: current.countyId || null,
        cityId: current.cityId || null,
        industryId: current.industryId || null,
        streetAddress: current.streetAddress || null,
        originalSourceUrl: current.originalSourceUrl,
        verificationStatus: current.verificationStatus,
        internalNotes: current.internalNotes || null,
        isFeatured: current.isFeatured,
        riskSummary: current.riskSummary,
        recommendedNextAction: current.recommendedNextAction,
        eligibilitySummary: current.eligibilitySummary || null,
        restrictions: current.restrictions || null,
      };

      if (current.sourceId) body.sourceId = current.sourceId;
      if (current.dateVerified) body.dateVerified = current.dateVerified;
      if (current.openingDate) body.openingDate = current.openingDate;
      if (current.closingDate) body.closingDate = current.closingDate;
      if (current.scheduledAt) body.scheduledAt = current.scheduledAt;
      if (current.fullAnalysis) body.fullAnalysis = current.fullAnalysis;
      if (current.requiredDocuments) {
        body.requiredDocuments = current.requiredDocuments
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean);
      }

      const numeric = (value: string) =>
        value.trim() === '' ? null : Number(value);
      body.estimatedValueMin = numeric(current.estimatedValueMin);
      body.estimatedValueMax = numeric(current.estimatedValueMax);
      body.capitalRequiredMin = numeric(current.capitalRequiredMin);
      body.capitalRequiredMax = numeric(current.capitalRequiredMax);
      body.depositRequired = numeric(current.depositRequired);

      // Access rank and scoring are reviewer-level changes; only send them when
      // this user may make them, so a researcher's autosave is not rejected
      // wholesale for touching a field they cannot change.
      if (canApprove) {
        body.minimumAccessRank = current.minimumAccessRank;
        body.score = {
          ...current.score,
          manualAdjustment: current.manualAdjustment,
          adjustmentReason: current.adjustmentReason || undefined,
        };
      }

      if (current.category === 'commercial_property') {
        body.propertyDetails = {
          propertyType: current.propertyType,
          saleType: current.saleType,
          parcelNumber: current.parcelNumber || null,
          askingPrice: numeric(current.askingPrice),
          startingBid: numeric(current.startingBid),
          buildingSizeSqft: numeric(current.buildingSizeSqft),
          lotSizeAcres: numeric(current.lotSizeAcres),
          zoning: current.zoning || null,
          knownLiens: current.knownLiens || null,
        };
      }
      if (current.category === 'business_funding') {
        body.fundingDetails = {
          fundingType: current.fundingType,
          fundingOrganization: current.fundingOrganization || null,
          minimumAmount: numeric(current.minimumAmount),
          maximumAmount: numeric(current.maximumAmount),
          applicationComplexity: current.applicationComplexity,
          applicationUrl: current.applicationUrl || null,
        };
      }

      try {
        let id = opportunityId;

        // The first save of a new record creates the draft; everything after
        // patches it.
        if (!id) {
          if (
            !current.title ||
            !current.sourceId ||
            !current.originalSourceUrl
          ) {
            setSaveState('dirty');
            setSaveMessage(
              'Add a title, a primary source and a source URL to start saving.',
            );
            return;
          }

          const response = await fetch('/api/v1/admin/opportunities', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              title: current.title,
              category: current.category,
              subtype: current.subtype || 'general',
              summary:
                current.summary ||
                'Draft record. The executive summary has not been written yet.',
              sourceId: current.sourceId,
              originalSourceUrl: current.originalSourceUrl,
              stateId: current.stateId || stateId || undefined,
              countyId: current.countyId || undefined,
              cityId: current.cityId || undefined,
              industryId: current.industryId || undefined,
              minimumAccessRank: current.minimumAccessRank,
              riskSummary: current.riskSummary,
              recommendedNextAction: current.recommendedNextAction,
            }),
          });

          const payload = await response.json().catch(() => null);
          if (!response.ok) {
            setSaveState('error');
            setSaveMessage(
              payload?.error?.message ?? 'The draft could not be created.',
            );
            return;
          }

          id = payload.data.id as string;
          setOpportunityId(id);
          window.history.replaceState(null, '', `/admin/opportunities/${id}`);
        }

        const response = await fetch(`/api/v1/admin/opportunities/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });

        const payload = await response.json().catch(() => null);
        if (!response.ok) {
          setSaveState('error');
          const issues = payload?.error?.details?.issues as
            Array<{ path: string; message: string }> | undefined;
          setSaveMessage(
            issues
              ?.map((issue) => `${issue.path}: ${issue.message}`)
              .join('; ') ??
              payload?.error?.message ??
              'Changes could not be saved.',
          );
          return;
        }

        setSaveState('saved');
        setSaveMessage('');
        window.localStorage.removeItem(storageKey);
        setRecovered(false);
      } catch {
        setSaveState('error');
        setSaveMessage(
          'Changes could not be saved. Your work is kept in this browser until they are.',
        );
      }
    },
    [canApprove, opportunityId, stateId, storageKey],
  );

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }

    setSaveState('dirty');

    // Keep a local copy immediately — that is what survives a crashed tab.
    try {
      window.localStorage.setItem(
        storageKey,
        JSON.stringify({ savedAt: new Date().toISOString(), draft }),
      );
    } catch {
      // Storage can be full or disabled; the server save still runs.
    }

    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void persist(draft), AUTOSAVE_DELAY_MS);

    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [draft, persist, storageKey]);

  function update<K extends keyof EditorDraft>(key: K, value: EditorDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  // --- Workflow actions ----------------------------------------------------

  async function runAction(action: string, label: string) {
    if (timer.current) clearTimeout(timer.current);
    await persist(draft);

    if (!opportunityId) {
      setActionIsError(true);
      setActionMessage('Save the draft before moving it through the workflow.');
      return;
    }

    setActionMessage(null);
    setActionIsError(false);

    try {
      const response = await fetch(
        `/api/v1/admin/opportunities/${opportunityId}/${action}`,
        { method: 'POST' },
      );
      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        setActionIsError(true);
        const missingFields = payload?.error?.details?.missingFields as
          string[] | undefined;
        setActionMessage(
          missingFields?.length
            ? `Cannot publish yet — still missing: ${missingFields
                .map((field) => FIELD_LABELS[field] ?? field)
                .join(', ')}.`
            : (payload?.error?.message ?? `Could not ${label.toLowerCase()}.`),
        );
        return;
      }

      setWorkflowStatus(payload.data.workflow_status);
      setActionMessage(`${label} succeeded.`);
      router.refresh();
    } catch {
      setActionIsError(true);
      setActionMessage(`Could not ${label.toLowerCase()}. Try again.`);
    }
  }

  // --- Render --------------------------------------------------------------

  const saveIndicator = {
    idle: 'All changes saved',
    dirty: 'Unsaved changes…',
    saving: 'Saving…',
    saved: 'All changes saved',
    error: 'Not saved',
  }[saveState];

  const previewPlan = planCodeForRank(previewRank);
  const previewCanSeeRecord = previewRank >= draft.minimumAccessRank;
  const previewDetail =
    previewRank >= ACCESS_RANK.detailed
      ? 'complete'
      : previewRank >= ACCESS_RANK.weekly
        ? 'summary'
        : 'preview';

  const inputClass =
    'mt-1 w-full rounded-lg border border-ink-300 px-3 py-2 text-sm';
  const labelClass = 'block text-sm font-medium';

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <nav aria-label="Breadcrumb" className="text-sm text-ink-500">
            <Link href="/admin/opportunities" className="hover:underline">
              Opportunities
            </Link>
            <span aria-hidden="true"> / </span>
            <span className="text-ink-800">
              {opportunityId ? 'Edit record' : 'New record'}
            </span>
          </nav>
          <h1 className="mt-1 text-2xl sm:text-3xl">
            {draft.title || 'Untitled record'}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
            <Pill tone={workflowStatus === 'published' ? 'positive' : 'muted'}>
              {titleCase(workflowStatus)}
            </Pill>
            <span
              className={cx(
                'text-xs',
                saveState === 'error' ? 'text-red-700' : 'text-ink-500',
              )}
              role="status"
            >
              {saveIndicator}
            </span>
          </div>
        </div>
        <ScoreBadge
          score={scoreResult.finalTotal}
          classification={scoreResult.classification}
        />
      </div>

      {recovered ? (
        <p className="mt-5 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <strong className="font-semibold">Recovered unsaved work.</strong>{' '}
          This browser had changes that never reached the server. They are
          loaded below — keep editing to save them, or{' '}
          <button
            type="button"
            className="font-medium underline"
            onClick={() => {
              window.localStorage.removeItem(storageKey);
              setDraft(initialDraft);
              setRecovered(false);
            }}
          >
            discard them and reload the saved version
          </button>
          .
        </p>
      ) : null}

      {saveMessage ? (
        <p
          role="alert"
          className="mt-5 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900"
        >
          {saveMessage}
        </p>
      ) : null}

      {/* Step navigation */}
      <nav aria-label="Editor steps" className="mt-6">
        <ol className="flex flex-wrap gap-2">
          {EDITOR_STEPS.map((entry, index) => {
            const complete = stepIsComplete(draft, entry);
            const active = index === stepIndex;
            return (
              <li key={entry.id}>
                <button
                  type="button"
                  onClick={() => setStepIndex(index)}
                  aria-current={active ? 'step' : undefined}
                  className={cx(
                    'flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm',
                    active
                      ? 'border-ink-900 bg-ink-900 text-white'
                      : 'border-ink-300 hover:bg-ink-50',
                  )}
                >
                  <span className="font-mono text-xs opacity-70">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  {entry.title}
                  {entry.requiredFields.length > 0 ? (
                    <span
                      aria-hidden="true"
                      className={cx(
                        'text-xs',
                        complete
                          ? 'text-emerald-500'
                          : active
                            ? 'text-amber-300'
                            : 'text-amber-600',
                      )}
                    >
                      {complete ? '✓' : '•'}
                    </span>
                  ) : null}
                  <span className="sr-only">
                    {entry.requiredFields.length === 0
                      ? ''
                      : complete
                        ? ' (complete)'
                        : ' (incomplete)'}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      <p className="mt-4 max-w-prose text-sm text-ink-600">{step.purpose}</p>

      <div className="mt-6 space-y-6">
        {/* ---------------------------------------------------------------- */}
        {step.id === 'classification' ? (
          <Card>
            <div className="space-y-4">
              <div>
                <label htmlFor="title" className={labelClass}>
                  Title
                </label>
                <input
                  id="title"
                  value={draft.title}
                  onChange={(event) => update('title', event.target.value)}
                  className={inputClass}
                  placeholder="84,000 sq ft distribution warehouse — Bibb County tax sale"
                />
                <p className="mt-1 text-xs text-ink-500">
                  Lead with what it is and where. Members scan titles in a list.
                </p>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="category" className={labelClass}>
                    Category
                  </label>
                  <select
                    id="category"
                    value={draft.category}
                    onChange={(event) =>
                      update(
                        'category',
                        event.target.value as EditorDraft['category'],
                      )
                    }
                    className={inputClass}
                  >
                    {OPPORTUNITY_CATEGORIES.map((value) => (
                      <option key={value} value={value}>
                        {titleCase(value)}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="subtype" className={labelClass}>
                    Subtype
                  </label>
                  <input
                    id="subtype"
                    value={draft.subtype}
                    onChange={(event) => update('subtype', event.target.value)}
                    className={inputClass}
                    placeholder="tax sale, grant, procurement…"
                  />
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                <div>
                  <label htmlFor="countyId" className={labelClass}>
                    County
                  </label>
                  <select
                    id="countyId"
                    value={draft.countyId}
                    onChange={(event) => update('countyId', event.target.value)}
                    className={inputClass}
                  >
                    <option value="">Statewide</option>
                    {counties.map((county) => (
                      <option key={county.id} value={county.id}>
                        {county.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="cityId" className={labelClass}>
                    City
                  </label>
                  <select
                    id="cityId"
                    value={draft.cityId}
                    onChange={(event) => update('cityId', event.target.value)}
                    className={inputClass}
                  >
                    <option value="">Not city-specific</option>
                    {cities.map((city) => (
                      <option key={city.id} value={city.id}>
                        {city.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="industryId" className={labelClass}>
                    Industry
                  </label>
                  <select
                    id="industryId"
                    value={draft.industryId}
                    onChange={(event) =>
                      update('industryId', event.target.value)
                    }
                    className={inputClass}
                  >
                    <option value="">Not industry-specific</option>
                    {industries.map((industry) => (
                      <option key={industry.id} value={industry.id}>
                        {industry.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label htmlFor="streetAddress" className={labelClass}>
                  Street address
                </label>
                <input
                  id="streetAddress"
                  value={draft.streetAddress}
                  onChange={(event) =>
                    update('streetAddress', event.target.value)
                  }
                  className={inputClass}
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="status" className={labelClass}>
                    Status
                  </label>
                  <select
                    id="status"
                    value={draft.status}
                    onChange={(event) =>
                      update(
                        'status',
                        event.target.value as EditorDraft['status'],
                      )
                    }
                    className={inputClass}
                  >
                    {OPPORTUNITY_STATUSES.map((value) => (
                      <option key={value} value={value}>
                        {titleCase(value)}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="minimumAccessRank" className={labelClass}>
                    Who can see it
                  </label>
                  <select
                    id="minimumAccessRank"
                    value={draft.minimumAccessRank}
                    disabled={!canApprove}
                    onChange={(event) =>
                      update('minimumAccessRank', Number(event.target.value))
                    }
                    className={cx(
                      inputClass,
                      'disabled:bg-ink-50 disabled:text-ink-400',
                    )}
                  >
                    {ACCESS_RANK_OPTIONS.map((option) => (
                      <option key={option.rank} value={option.rank}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  {!canApprove ? (
                    <p className="mt-1 text-xs text-ink-500">
                      Only a reviewer or editor can change who may see a record.
                    </p>
                  ) : null}
                </div>
              </div>
            </div>
          </Card>
        ) : null}

        {/* ---------------------------------------------------------------- */}
        {step.id === 'source' ? (
          <Card>
            <div className="space-y-4">
              <div>
                <label htmlFor="sourceId" className={labelClass}>
                  Primary source
                </label>
                <select
                  id="sourceId"
                  value={draft.sourceId}
                  onChange={(event) => update('sourceId', event.target.value)}
                  className={inputClass}
                >
                  <option value="">Choose a source…</option>
                  {sources.map((source) => (
                    <option key={source.id} value={source.id}>
                      {source.name}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-ink-500">
                  The source&rsquo;s reliability rating feeds the score. Prefer
                  a primary government source where one exists.
                </p>
              </div>

              <div>
                <label htmlFor="originalSourceUrl" className={labelClass}>
                  Source URL
                </label>
                <input
                  id="originalSourceUrl"
                  type="url"
                  value={draft.originalSourceUrl}
                  onChange={(event) =>
                    update('originalSourceUrl', event.target.value)
                  }
                  className={inputClass}
                  placeholder="https://"
                />
                <p className="mt-1 text-xs text-ink-500">
                  The exact page this record was taken from, not the
                  organisation&rsquo;s home page.
                </p>
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                <div>
                  <label htmlFor="dateDiscovered" className={labelClass}>
                    Discovered
                  </label>
                  <input
                    id="dateDiscovered"
                    type="date"
                    value={draft.dateDiscovered}
                    onChange={(event) =>
                      update('dateDiscovered', event.target.value)
                    }
                    className={inputClass}
                  />
                </div>
                <div>
                  <label htmlFor="dateVerified" className={labelClass}>
                    Verified
                  </label>
                  <input
                    id="dateVerified"
                    type="date"
                    value={draft.dateVerified}
                    onChange={(event) =>
                      update('dateVerified', event.target.value)
                    }
                    className={inputClass}
                  />
                </div>
                <div>
                  <label htmlFor="verificationStatus" className={labelClass}>
                    Verification
                  </label>
                  <select
                    id="verificationStatus"
                    value={draft.verificationStatus}
                    onChange={(event) =>
                      update(
                        'verificationStatus',
                        event.target.value as EditorDraft['verificationStatus'],
                      )
                    }
                    className={inputClass}
                  >
                    {VERIFICATION_STATUSES.map((value) => (
                      <option key={value} value={value}>
                        {titleCase(value)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <p className="rounded-lg bg-ink-50 px-3 py-2 text-xs text-ink-600">
                Published records are reverified on a thirty-day cycle from the
                verification date. Deadline reminders are only sent for records
                whose verification status is &ldquo;verified&rdquo; — we do not
                push members toward a deadline we have not confirmed.
              </p>
            </div>
          </Card>
        ) : null}

        {/* ---------------------------------------------------------------- */}
        {step.id === 'financial' ? (
          <Card>
            <div className="space-y-4">
              <fieldset>
                <legend className={labelClass}>Estimated value</legend>
                <div className="mt-1 grid gap-3 sm:grid-cols-2">
                  <input
                    aria-label="Estimated value, from"
                    type="number"
                    min={0}
                    value={draft.estimatedValueMin}
                    onChange={(event) =>
                      update('estimatedValueMin', event.target.value)
                    }
                    className={inputClass}
                    placeholder="From"
                  />
                  <input
                    aria-label="Estimated value, up to"
                    type="number"
                    min={0}
                    value={draft.estimatedValueMax}
                    onChange={(event) =>
                      update('estimatedValueMax', event.target.value)
                    }
                    className={inputClass}
                    placeholder="Up to"
                  />
                </div>
                <p className="mt-1 text-xs text-ink-500">
                  A range is honest about what we know. Leave both empty rather
                  than guessing.
                </p>
              </fieldset>

              <fieldset>
                <legend className={labelClass}>Capital required</legend>
                <div className="mt-1 grid gap-3 sm:grid-cols-2">
                  <input
                    aria-label="Capital required, from"
                    type="number"
                    min={0}
                    value={draft.capitalRequiredMin}
                    onChange={(event) =>
                      update('capitalRequiredMin', event.target.value)
                    }
                    className={inputClass}
                    placeholder="From"
                  />
                  <input
                    aria-label="Capital required, up to"
                    type="number"
                    min={0}
                    value={draft.capitalRequiredMax}
                    onChange={(event) =>
                      update('capitalRequiredMax', event.target.value)
                    }
                    className={inputClass}
                    placeholder="Up to"
                  />
                </div>
              </fieldset>

              <div>
                <label htmlFor="depositRequired" className={labelClass}>
                  Deposit required
                </label>
                <input
                  id="depositRequired"
                  type="number"
                  min={0}
                  value={draft.depositRequired}
                  onChange={(event) =>
                    update('depositRequired', event.target.value)
                  }
                  className={inputClass}
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="openingDate" className={labelClass}>
                    Opens
                  </label>
                  <input
                    id="openingDate"
                    type="datetime-local"
                    value={draft.openingDate}
                    onChange={(event) =>
                      update('openingDate', event.target.value)
                    }
                    className={inputClass}
                  />
                </div>
                <div>
                  <label htmlFor="closingDate" className={labelClass}>
                    Closes
                  </label>
                  <input
                    id="closingDate"
                    type="datetime-local"
                    value={draft.closingDate}
                    onChange={(event) =>
                      update('closingDate', event.target.value)
                    }
                    className={inputClass}
                  />
                  <p className="mt-1 text-xs text-ink-500">
                    The date that actually binds. For an auction that is usually
                    the registration deadline, not the sale date.
                  </p>
                </div>
              </div>
            </div>
          </Card>
        ) : null}

        {/* ---------------------------------------------------------------- */}
        {step.id === 'details' ? (
          <Card>
            {draft.category === 'commercial_property' ? (
              <div className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label htmlFor="propertyType" className={labelClass}>
                      Property type
                    </label>
                    <select
                      id="propertyType"
                      value={draft.propertyType}
                      onChange={(event) =>
                        update(
                          'propertyType',
                          event.target.value as EditorDraft['propertyType'],
                        )
                      }
                      className={inputClass}
                    >
                      {PROPERTY_TYPES.map((value) => (
                        <option key={value} value={value}>
                          {titleCase(value)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="saleType" className={labelClass}>
                      Sale type
                    </label>
                    <select
                      id="saleType"
                      value={draft.saleType}
                      onChange={(event) =>
                        update('saleType', event.target.value)
                      }
                      className={inputClass}
                    >
                      {SALE_TYPES.map((value) => (
                        <option key={value} value={value}>
                          {titleCase(value)}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label htmlFor="parcelNumber" className={labelClass}>
                      Parcel number
                    </label>
                    <input
                      id="parcelNumber"
                      value={draft.parcelNumber}
                      onChange={(event) =>
                        update('parcelNumber', event.target.value)
                      }
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label htmlFor="zoning" className={labelClass}>
                      Zoning
                    </label>
                    <input
                      id="zoning"
                      value={draft.zoning}
                      onChange={(event) => update('zoning', event.target.value)}
                      className={inputClass}
                    />
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label htmlFor="askingPrice" className={labelClass}>
                      Asking price
                    </label>
                    <input
                      id="askingPrice"
                      type="number"
                      min={0}
                      value={draft.askingPrice}
                      onChange={(event) =>
                        update('askingPrice', event.target.value)
                      }
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label htmlFor="startingBid" className={labelClass}>
                      Starting bid
                    </label>
                    <input
                      id="startingBid"
                      type="number"
                      min={0}
                      value={draft.startingBid}
                      onChange={(event) =>
                        update('startingBid', event.target.value)
                      }
                      className={inputClass}
                    />
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label htmlFor="buildingSizeSqft" className={labelClass}>
                      Building size (sq ft)
                    </label>
                    <input
                      id="buildingSizeSqft"
                      type="number"
                      min={0}
                      value={draft.buildingSizeSqft}
                      onChange={(event) =>
                        update('buildingSizeSqft', event.target.value)
                      }
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label htmlFor="lotSizeAcres" className={labelClass}>
                      Lot size (acres)
                    </label>
                    <input
                      id="lotSizeAcres"
                      type="number"
                      min={0}
                      step="0.01"
                      value={draft.lotSizeAcres}
                      onChange={(event) =>
                        update('lotSizeAcres', event.target.value)
                      }
                      className={inputClass}
                    />
                  </div>
                </div>

                <div>
                  <label htmlFor="knownLiens" className={labelClass}>
                    Known liens and title notes
                  </label>
                  <textarea
                    id="knownLiens"
                    rows={3}
                    value={draft.knownLiens}
                    onChange={(event) =>
                      update('knownLiens', event.target.value)
                    }
                    className={inputClass}
                  />
                  <p className="mt-1 text-xs text-ink-500">
                    Say what the record shows and what it does not. &ldquo;No
                    liens found in the county docket as of 14 July&rdquo; is
                    useful; &ldquo;clear title&rdquo; is a claim we cannot make.
                  </p>
                </div>
              </div>
            ) : draft.category === 'business_funding' ? (
              <div className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label htmlFor="fundingType" className={labelClass}>
                      Funding type
                    </label>
                    <select
                      id="fundingType"
                      value={draft.fundingType}
                      onChange={(event) =>
                        update(
                          'fundingType',
                          event.target.value as EditorDraft['fundingType'],
                        )
                      }
                      className={inputClass}
                    >
                      {FUNDING_TYPES.map((value) => (
                        <option key={value} value={value}>
                          {titleCase(value)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label
                      htmlFor="applicationComplexity"
                      className={labelClass}
                    >
                      Application complexity
                    </label>
                    <select
                      id="applicationComplexity"
                      value={draft.applicationComplexity}
                      onChange={(event) =>
                        update(
                          'applicationComplexity',
                          event.target
                            .value as EditorDraft['applicationComplexity'],
                        )
                      }
                      className={inputClass}
                    >
                      {(['low', 'moderate', 'high', 'very_high'] as const).map(
                        (value) => (
                          <option key={value} value={value}>
                            {titleCase(value)}
                          </option>
                        ),
                      )}
                    </select>
                  </div>
                </div>

                <div>
                  <label htmlFor="fundingOrganization" className={labelClass}>
                    Administered by
                  </label>
                  <input
                    id="fundingOrganization"
                    value={draft.fundingOrganization}
                    onChange={(event) =>
                      update('fundingOrganization', event.target.value)
                    }
                    className={inputClass}
                  />
                </div>

                <div className="grid gap-4 sm:grid-cols-3">
                  <div>
                    <label htmlFor="minimumAmount" className={labelClass}>
                      Minimum award
                    </label>
                    <input
                      id="minimumAmount"
                      type="number"
                      min={0}
                      value={draft.minimumAmount}
                      onChange={(event) =>
                        update('minimumAmount', event.target.value)
                      }
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label htmlFor="maximumAmount" className={labelClass}>
                      Maximum award
                    </label>
                    <input
                      id="maximumAmount"
                      type="number"
                      min={0}
                      value={draft.maximumAmount}
                      onChange={(event) =>
                        update('maximumAmount', event.target.value)
                      }
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="ownerContributionPercent"
                      className={labelClass}
                    >
                      Owner contribution %
                    </label>
                    <input
                      id="ownerContributionPercent"
                      type="number"
                      min={0}
                      max={100}
                      value={draft.ownerContributionPercent}
                      onChange={(event) =>
                        update('ownerContributionPercent', event.target.value)
                      }
                      className={inputClass}
                    />
                  </div>
                </div>

                <div>
                  <label htmlFor="applicationUrl" className={labelClass}>
                    Application URL
                  </label>
                  <input
                    id="applicationUrl"
                    type="url"
                    value={draft.applicationUrl}
                    onChange={(event) =>
                      update('applicationUrl', event.target.value)
                    }
                    className={inputClass}
                    placeholder="https://"
                  />
                </div>
              </div>
            ) : (
              <p className="text-sm text-ink-600">
                This category has no additional detail fields. Choose{' '}
                <em>Commercial property</em> or <em>Business funding</em> on the
                classification step if you need them.
              </p>
            )}
          </Card>
        ) : null}

        {/* ---------------------------------------------------------------- */}
        {step.id === 'analysis' ? (
          <Card>
            <div className="space-y-4">
              <div>
                <label htmlFor="summary" className={labelClass}>
                  Executive summary
                </label>
                <textarea
                  id="summary"
                  rows={5}
                  value={draft.summary}
                  onChange={(event) => update('summary', event.target.value)}
                  className={inputClass}
                />
                <p className="mt-1 text-xs text-ink-500">
                  {draft.summary.length} characters. The first 180 become the
                  public teaser, so make the opening sentence carry the record.
                </p>
              </div>

              <div>
                <label htmlFor="fullAnalysis" className={labelClass}>
                  Full analysis
                </label>
                <textarea
                  id="fullAnalysis"
                  rows={10}
                  value={draft.fullAnalysis}
                  onChange={(event) =>
                    update('fullAnalysis', event.target.value)
                  }
                  className={inputClass}
                />
                <p className="mt-1 text-xs text-ink-500">
                  Blank lines separate paragraphs. This is the Detailed tier
                  content — say what a knowledgeable friend would say.
                </p>
              </div>

              <div>
                <label htmlFor="eligibilitySummary" className={labelClass}>
                  Eligibility
                </label>
                <textarea
                  id="eligibilitySummary"
                  rows={4}
                  value={draft.eligibilitySummary}
                  onChange={(event) =>
                    update('eligibilitySummary', event.target.value)
                  }
                  className={inputClass}
                />
              </div>

              <div>
                <label htmlFor="restrictions" className={labelClass}>
                  Restrictions
                </label>
                <textarea
                  id="restrictions"
                  rows={3}
                  value={draft.restrictions}
                  onChange={(event) =>
                    update('restrictions', event.target.value)
                  }
                  className={inputClass}
                />
              </div>

              <div>
                <label htmlFor="riskSummary" className={labelClass}>
                  Risk factors
                </label>
                <textarea
                  id="riskSummary"
                  rows={4}
                  value={draft.riskSummary}
                  onChange={(event) =>
                    update('riskSummary', event.target.value)
                  }
                  className={inputClass}
                />
                <p className="mt-1 text-xs text-ink-500">
                  Required before publication. If you cannot name a risk, you
                  have not read the source closely enough.
                </p>
              </div>

              <div>
                <label htmlFor="recommendedNextAction" className={labelClass}>
                  Recommended next action
                </label>
                <textarea
                  id="recommendedNextAction"
                  rows={3}
                  value={draft.recommendedNextAction}
                  onChange={(event) =>
                    update('recommendedNextAction', event.target.value)
                  }
                  className={inputClass}
                />
                <p className="mt-1 text-xs text-ink-500">
                  One concrete step a reader can take this week. Not
                  &ldquo;consider applying&rdquo;.
                </p>
              </div>

              <div>
                <label htmlFor="requiredDocuments" className={labelClass}>
                  Required documents
                </label>
                <textarea
                  id="requiredDocuments"
                  rows={4}
                  value={draft.requiredDocuments}
                  onChange={(event) =>
                    update('requiredDocuments', event.target.value)
                  }
                  className={inputClass}
                  placeholder={
                    'One per line\nThree years of tax returns\nProof of funds'
                  }
                />
              </div>
            </div>
          </Card>
        ) : null}

        {/* ---------------------------------------------------------------- */}
        {step.id === 'scoring' ? (
          <>
            <Card>
              {!canApprove ? (
                <p className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  Your role can propose a score here for a reviewer to consider,
                  but only a reviewer or editor can save one.
                </p>
              ) : null}

              <div className="space-y-5">
                {SCORE_FIELDS.map((field) => (
                  <div key={field.key}>
                    <label
                      htmlFor={`score-${field.key}`}
                      className="flex items-baseline justify-between text-sm"
                    >
                      <span className="font-medium">{field.label}</span>
                      <span className="tabular-nums text-ink-600">
                        {draft.score[field.key]} / {field.max}
                      </span>
                    </label>
                    <input
                      id={`score-${field.key}`}
                      type="range"
                      min={0}
                      max={field.max}
                      value={draft.score[field.key]}
                      onChange={(event) =>
                        update('score', {
                          ...draft.score,
                          [field.key]: Number(event.target.value),
                        })
                      }
                      className="mt-1 w-full"
                    />
                    <p className="mt-1 text-xs text-ink-500">{field.hint}</p>
                  </div>
                ))}
              </div>
            </Card>

            <Card>
              <h2 className="text-base font-semibold">Calculated score</h2>
              <div className="mt-3 space-y-3">
                {scoreResult.breakdown.map((row) => (
                  <Meter
                    key={row.key}
                    label={row.label}
                    value={row.awarded}
                    max={row.maximum}
                  />
                ))}
              </div>

              <div className="mt-5 border-t border-ink-100 pt-4">
                <label htmlFor="manualAdjustment" className={labelClass}>
                  Reviewer adjustment ({draft.manualAdjustment > 0 ? '+' : ''}
                  {draft.manualAdjustment})
                </label>
                <input
                  id="manualAdjustment"
                  type="range"
                  min={-25}
                  max={25}
                  value={draft.manualAdjustment}
                  disabled={!canApprove}
                  onChange={(event) =>
                    update('manualAdjustment', Number(event.target.value))
                  }
                  className="mt-1 w-full"
                />

                {draft.manualAdjustment !== 0 ? (
                  <div className="mt-3">
                    <label htmlFor="adjustmentReason" className={labelClass}>
                      Why? (required)
                    </label>
                    <textarea
                      id="adjustmentReason"
                      rows={2}
                      value={draft.adjustmentReason}
                      onChange={(event) =>
                        update('adjustmentReason', event.target.value)
                      }
                      className={inputClass}
                      placeholder="Site visit confirmed better condition than the listing suggests."
                    />
                    <p className="mt-1 text-xs text-ink-500">
                      Shown to Detailed and Premium members alongside the score,
                      and written to the audit log. An adjustment cannot be
                      saved without it.
                    </p>
                  </div>
                ) : null}

                <div className="mt-4 flex items-center justify-between rounded-lg bg-ink-50 px-3 py-2">
                  <span className="text-sm text-ink-700">
                    Calculated {scoreResult.calculatedTotal}, final
                  </span>
                  <ScoreBadge
                    score={scoreResult.finalTotal}
                    classification={scoreResult.classification}
                    size="sm"
                  />
                </div>

                <p className="mt-3 text-sm leading-relaxed text-ink-600">
                  {scoreResult.explanation}
                </p>
              </div>
            </Card>
          </>
        ) : null}

        {/* ---------------------------------------------------------------- */}
        {step.id === 'publication' ? (
          <>
            <Card>
              <h2 className="text-base font-semibold">Readiness</h2>
              {missing.length === 0 ? (
                <p className="mt-2 text-sm text-emerald-800">
                  Every required field is filled. This record can be submitted
                  for review.
                </p>
              ) : (
                <>
                  <p className="mt-2 text-sm text-ink-700">
                    {missing.length}{' '}
                    {missing.length === 1 ? 'field is' : 'fields are'} still
                    needed before this can be published:
                  </p>
                  <ul className="mt-3 space-y-1 text-sm">
                    {missing.map((field) => {
                      const owner = EDITOR_STEPS.findIndex((entry) =>
                        entry.requiredFields.includes(field),
                      );
                      return (
                        <li key={field} className="flex items-center gap-2">
                          <span aria-hidden="true" className="text-amber-600">
                            •
                          </span>
                          <span>{FIELD_LABELS[field] ?? field}</span>
                          {owner >= 0 ? (
                            <button
                              type="button"
                              onClick={() => setStepIndex(owner)}
                              className="text-xs font-medium underline"
                            >
                              go to {EDITOR_STEPS[owner]!.title}
                            </button>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                </>
              )}
            </Card>

            <Card>
              <h2 className="text-base font-semibold">Preview by tier</h2>
              <p className="mt-1 text-sm text-ink-600">
                What a member on each plan will actually see.
              </p>

              <div
                role="group"
                aria-label="Preview tier"
                className="mt-3 flex flex-wrap gap-2"
              >
                {ACCESS_RANK_OPTIONS.map((option) => (
                  <button
                    key={option.rank}
                    type="button"
                    aria-pressed={previewRank === option.rank}
                    onClick={() => setPreviewRank(option.rank)}
                    className={cx(
                      'rounded-full border px-3 py-1 text-xs',
                      previewRank === option.rank
                        ? 'border-ink-900 bg-ink-900 text-white'
                        : 'border-ink-300 hover:bg-ink-50',
                    )}
                  >
                    {titleCase(planCodeForRank(option.rank))}
                  </button>
                ))}
              </div>

              <div className="mt-4 rounded-lg border border-ink-200 p-4">
                <p className="text-xs uppercase tracking-wide text-ink-500">
                  As {titleCase(previewPlan)}
                </p>

                {!previewCanSeeRecord ? (
                  <p className="mt-2 text-sm text-ink-700">
                    Sees the title, county, score and deadline as a locked
                    teaser, with an upgrade prompt naming the tier that unlocks
                    it. The summary, financials and analysis are all withheld.
                  </p>
                ) : (
                  <div className="mt-2 space-y-2 text-sm">
                    <p className="font-semibold">
                      {draft.title || 'Untitled record'}
                    </p>
                    <p className="text-ink-700">
                      {previewDetail === 'preview'
                        ? `${draft.summary.slice(0, 180) || 'No summary yet.'}${draft.summary.length > 180 ? '…' : ''}`
                        : draft.summary || 'No summary yet.'}
                    </p>
                    <ul className="mt-2 space-y-1 text-xs text-ink-600">
                      <li>
                        Financial overview:{' '}
                        {previewDetail === 'preview' ? 'hidden' : 'shown'}
                      </li>
                      <li>
                        Full analysis and risk factors:{' '}
                        {previewDetail === 'complete' ? 'shown' : 'hidden'}
                      </li>
                      <li>
                        Score explanation:{' '}
                        {previewDetail === 'complete' ? 'shown' : 'hidden'}
                      </li>
                    </ul>
                  </div>
                )}
              </div>
            </Card>

            <Card>
              <h2 className="text-base font-semibold">Publication settings</h2>
              <div className="mt-4 space-y-4">
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={draft.isFeatured}
                    onChange={(event) =>
                      update('isFeatured', event.target.checked)
                    }
                    className="mt-0.5 rounded border-ink-300"
                  />
                  <span>
                    Feature this record on landing pages and the dashboard.
                  </span>
                </label>

                <div>
                  <label htmlFor="scheduledAt" className={labelClass}>
                    Schedule publication
                  </label>
                  <input
                    id="scheduledAt"
                    type="datetime-local"
                    value={draft.scheduledAt}
                    onChange={(event) =>
                      update('scheduledAt', event.target.value)
                    }
                    className={inputClass}
                  />
                  <p className="mt-1 text-xs text-ink-500">
                    Leave empty to publish immediately when approved. Scheduled
                    records go live via the publish-scheduled job, which runs
                    every fifteen minutes.
                  </p>
                </div>

                <div>
                  <label htmlFor="internalNotes" className={labelClass}>
                    Internal notes
                  </label>
                  <textarea
                    id="internalNotes"
                    rows={3}
                    value={draft.internalNotes}
                    onChange={(event) =>
                      update('internalNotes', event.target.value)
                    }
                    className={inputClass}
                  />
                  <p className="mt-1 text-xs text-ink-500">
                    Never shown to members. Use it for what the next reviewer
                    needs to know.
                  </p>
                </div>
              </div>
            </Card>

            {actionMessage ? (
              <p
                role={actionIsError ? 'alert' : 'status'}
                className={
                  actionIsError
                    ? 'rounded-lg bg-red-50 px-4 py-3 text-sm text-red-900'
                    : 'rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-900'
                }
              >
                {actionMessage}
              </p>
            ) : null}

            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                onClick={() => runAction('submit-review', 'Submit for review')}
              >
                Submit for review
              </Button>
              {canApprove ? (
                <Button
                  variant="secondary"
                  onClick={() => runAction('approve', 'Approve')}
                >
                  Approve
                </Button>
              ) : null}
              {canPublish ? (
                <Button onClick={() => runAction('publish', 'Publish')}>
                  Publish
                </Button>
              ) : null}
              <Button
                variant="ghost"
                onClick={() => runAction('reverify', 'Record verification')}
              >
                Record a fresh verification
              </Button>
            </div>
          </>
        ) : null}
      </div>

      {/* Step footer navigation */}
      <div className="mt-8 flex items-center justify-between border-t border-ink-200 pt-5">
        <Button
          variant="secondary"
          disabled={stepIndex === 0}
          onClick={() => setStepIndex((index) => Math.max(0, index - 1))}
        >
          Back
        </Button>
        <span className="text-sm text-ink-500">
          Step {stepIndex + 1} of {EDITOR_STEPS.length}
        </span>
        <Button
          disabled={stepIndex === EDITOR_STEPS.length - 1}
          onClick={() =>
            setStepIndex((index) =>
              Math.min(EDITOR_STEPS.length - 1, index + 1),
            )
          }
        >
          Next
        </Button>
      </div>
    </div>
  );
}
