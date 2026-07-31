'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

import { Button, Card, Pill, ScoreBadge, cx } from '@/components/ui/primitives';
import { ACCESS_RANK, planCodeForRank } from '@/lib/access/ranks';
import { formatDate, formatDeadline, titleCase } from '@/lib/format';
import type { ScoreClassification } from '@/lib/scoring/score';

export interface CandidateRecord {
  id: string;
  title: string;
  category: string;
  score: number;
  classification: ScoreClassification;
  county: string | null;
  closingDate: string | null;
  minimumAccessRank: number;
}

export interface ReportSectionDraft {
  sectionType: string;
  title: string;
  content: string;
  minimumAccessRank: number;
}

export interface ReportEntryDraft {
  opportunityId: string;
  editorCommentary: string;
  minimumAccessRank: number;
}

const SECTION_TYPES = [
  'executive_summary',
  'market_commentary',
  'property_highlights',
  'funding_highlights',
  'pricing_indicators',
  'deadline_calendar',
  'methodology',
  'disclaimer',
  'custom',
] as const;

const RANK_OPTIONS = [
  { rank: ACCESS_RANK.free, label: 'Free' },
  { rank: ACCESS_RANK.weekly, label: 'Weekly' },
  { rank: ACCESS_RANK.detailed, label: 'Detailed' },
  { rank: ACCESS_RANK.premium, label: 'Premium' },
];

const AUTOSAVE_DELAY_MS = 1800;

/**
 * The report composer (spec 15.4).
 *
 * Ordering uses explicit move-up / move-down controls rather than pointer drag.
 * Drag-and-drop is the nicer demo, but it is unusable from a keyboard and
 * awkward on a phone; buttons reorder the same list, are announced correctly by
 * a screen reader, and cannot drop a record in the wrong place by accident.
 */
export function ReportBuilder({
  reportId,
  slug,
  status,
  initial,
  candidates,
  hasPdf,
}: {
  reportId: string;
  slug: string;
  status: string;
  initial: {
    title: string;
    reportType: string;
    periodStart: string;
    periodEnd: string;
    minimumAccessRank: number;
    executiveSummary: string;
    marketCommentary: string;
    scheduledAt: string;
    sections: ReportSectionDraft[];
    opportunities: ReportEntryDraft[];
  };
  candidates: readonly CandidateRecord[];
  hasPdf: boolean;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState(initial);
  const [query, setQuery] = useState('');
  const [saveState, setSaveState] = useState<
    'idle' | 'dirty' | 'saving' | 'saved' | 'error'
  >('idle');
  const [saveMessage, setSaveMessage] = useState('');
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionIsError, setActionIsError] = useState(false);
  const [previewRank, setPreviewRank] = useState<number>(ACCESS_RANK.weekly);
  const [distribute, setDistribute] = useState(false);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firstRender = useRef(true);

  const byId = new Map(candidates.map((record) => [record.id, record]));
  const selectedIds = new Set(
    draft.opportunities.map((entry) => entry.opportunityId),
  );

  const searchResults = candidates
    .filter((record) => !selectedIds.has(record.id))
    .filter((record) =>
      query.trim()
        ? record.title.toLowerCase().includes(query.trim().toLowerCase()) ||
          (record.county ?? '')
            .toLowerCase()
            .includes(query.trim().toLowerCase())
        : true,
    )
    .slice(0, 12);

  const persist = useCallback(
    async (current: typeof initial) => {
      setSaveState('saving');
      setSaveMessage('');
      try {
        const response = await fetch(`/api/v1/admin/reports/${reportId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: current.title,
            reportType: current.reportType,
            periodStart: current.periodStart || null,
            periodEnd: current.periodEnd || null,
            minimumAccessRank: current.minimumAccessRank,
            executiveSummary: current.executiveSummary || null,
            marketCommentary: current.marketCommentary || null,
            scheduledAt: current.scheduledAt || null,
            sections: current.sections,
            opportunities: current.opportunities,
          }),
        });

        const payload = await response.json().catch(() => null);
        if (!response.ok) {
          setSaveState('error');
          setSaveMessage(
            payload?.error?.message ?? 'Changes could not be saved.',
          );
          return;
        }
        setSaveState('saved');
      } catch {
        setSaveState('error');
        setSaveMessage('Changes could not be saved. Try again.');
      }
    },
    [reportId],
  );

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    setSaveState('dirty');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void persist(draft), AUTOSAVE_DELAY_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [draft, persist]);

  function move<T>(list: T[], from: number, to: number): T[] {
    if (to < 0 || to >= list.length) return list;
    const next = [...list];
    const [item] = next.splice(from, 1);
    if (item !== undefined) next.splice(to, 0, item);
    return next;
  }

  async function runAction(
    path: string,
    label: string,
    body?: Record<string, unknown>,
  ) {
    if (timer.current) clearTimeout(timer.current);
    await persist(draft);
    setActionMessage(null);
    setActionIsError(false);

    try {
      const response = await fetch(
        `/api/v1/admin/reports/${reportId}/${path}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body ?? {}),
        },
      );
      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        setActionIsError(true);
        setActionMessage(
          payload?.error?.message ?? `Could not ${label.toLowerCase()}.`,
        );
        return;
      }

      setActionMessage(payload?.data?.message ?? `${label} succeeded.`);
      router.refresh();
    } catch {
      setActionIsError(true);
      setActionMessage(`Could not ${label.toLowerCase()}. Try again.`);
    }
  }

  const inputClass =
    'mt-1 w-full rounded-lg border border-ink-300 px-3 py-2 text-sm';
  const labelClass = 'block text-sm font-medium';

  const visibleToPreview = draft.opportunities.filter(
    (entry) => previewRank >= entry.minimumAccessRank,
  );

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <nav aria-label="Breadcrumb" className="text-sm text-ink-500">
            <Link href="/admin/reports" className="hover:underline">
              Reports
            </Link>
            <span aria-hidden="true"> / </span>
            <span className="text-ink-800">Compose</span>
          </nav>
          <h1 className="mt-1 text-2xl sm:text-3xl">
            {draft.title || 'Untitled report'}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Pill tone={status === 'published' ? 'positive' : 'muted'}>
              {titleCase(status)}
            </Pill>
            <span
              role="status"
              className={cx(
                'text-xs',
                saveState === 'error' ? 'text-red-700' : 'text-ink-500',
              )}
            >
              {saveState === 'dirty'
                ? 'Unsaved changes…'
                : saveState === 'saving'
                  ? 'Saving…'
                  : saveState === 'error'
                    ? 'Not saved'
                    : 'All changes saved'}
            </span>
          </div>
        </div>
        <Link
          href={`/reports/${slug}`}
          className="text-sm font-medium underline"
        >
          View as a member
        </Link>
      </div>

      {saveMessage ? (
        <p
          role="alert"
          className="mt-5 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900"
        >
          {saveMessage}
        </p>
      ) : null}

      <div className="mt-6 grid gap-6 lg:grid-cols-[320px,1fr,300px]">
        {/* ---- Left: record picker ------------------------------------- */}
        <div className="space-y-4">
          <Card>
            <h2 className="text-base font-semibold">Add records</h2>
            <label htmlFor="record-search" className="sr-only">
              Search published records
            </label>
            <input
              id="record-search"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search published records…"
              className={inputClass}
            />

            <ul className="mt-3 space-y-2">
              {searchResults.map((record) => (
                <li key={record.id}>
                  <button
                    type="button"
                    onClick={() =>
                      setDraft({
                        ...draft,
                        opportunities: [
                          ...draft.opportunities,
                          {
                            opportunityId: record.id,
                            editorCommentary: '',
                            minimumAccessRank: Math.max(
                              record.minimumAccessRank,
                              draft.minimumAccessRank,
                            ),
                          },
                        ],
                      })
                    }
                    className="w-full rounded-lg border border-ink-200 p-3 text-left hover:border-ink-400"
                  >
                    <span className="block text-sm font-medium">
                      {record.title}
                    </span>
                    <span className="mt-1 flex items-center justify-between text-xs text-ink-500">
                      <span>{record.county ?? 'Georgia'}</span>
                      <span className="tabular-nums">{record.score}</span>
                    </span>
                  </button>
                </li>
              ))}
              {searchResults.length === 0 ? (
                <li className="text-sm text-ink-500">
                  {query
                    ? `Nothing published matches “${query}”.`
                    : 'Every published record is already in this report.'}
                </li>
              ) : null}
            </ul>
          </Card>
        </div>

        {/* ---- Middle: composition ------------------------------------- */}
        <div className="space-y-6">
          <Card>
            <h2 className="text-base font-semibold">Report details</h2>
            <div className="mt-4 space-y-4">
              <div>
                <label htmlFor="report-title" className={labelClass}>
                  Title
                </label>
                <input
                  id="report-title"
                  value={draft.title}
                  onChange={(event) =>
                    setDraft({ ...draft, title: event.target.value })
                  }
                  className={inputClass}
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                <div>
                  <label htmlFor="report-type" className={labelClass}>
                    Type
                  </label>
                  <select
                    id="report-type"
                    value={draft.reportType}
                    onChange={(event) =>
                      setDraft({ ...draft, reportType: event.target.value })
                    }
                    className={inputClass}
                  >
                    {[
                      'weekly',
                      'monthly',
                      'special',
                      'pricing',
                      'premium_briefing',
                      'sample',
                    ].map((value) => (
                      <option key={value} value={value}>
                        {titleCase(value)}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="period-start" className={labelClass}>
                    Period from
                  </label>
                  <input
                    id="period-start"
                    type="date"
                    value={draft.periodStart}
                    onChange={(event) =>
                      setDraft({ ...draft, periodStart: event.target.value })
                    }
                    className={inputClass}
                  />
                </div>
                <div>
                  <label htmlFor="period-end" className={labelClass}>
                    Period to
                  </label>
                  <input
                    id="period-end"
                    type="date"
                    value={draft.periodEnd}
                    onChange={(event) =>
                      setDraft({ ...draft, periodEnd: event.target.value })
                    }
                    className={inputClass}
                  />
                </div>
              </div>

              <div>
                <label htmlFor="executive-summary" className={labelClass}>
                  Executive summary
                </label>
                <textarea
                  id="executive-summary"
                  rows={6}
                  value={draft.executiveSummary}
                  onChange={(event) =>
                    setDraft({ ...draft, executiveSummary: event.target.value })
                  }
                  className={inputClass}
                />
                <p className="mt-1 text-xs text-ink-500">
                  Required before publishing. The first 400 characters become
                  the email headline.
                </p>
              </div>

              <div>
                <label htmlFor="market-commentary" className={labelClass}>
                  Market commentary
                </label>
                <textarea
                  id="market-commentary"
                  rows={6}
                  value={draft.marketCommentary}
                  onChange={(event) =>
                    setDraft({ ...draft, marketCommentary: event.target.value })
                  }
                  className={inputClass}
                />
              </div>
            </div>
          </Card>

          {/* Selected records */}
          <Card>
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold">
                Records in this report
              </h2>
              <span className="text-sm text-ink-500">
                {draft.opportunities.length}
              </span>
            </div>

            {draft.opportunities.length === 0 ? (
              <p className="mt-3 text-sm text-ink-600">
                None yet. Search on the left and click a record to add it.
              </p>
            ) : (
              <ol className="mt-4 space-y-3">
                {draft.opportunities.map((entry, index) => {
                  const record = byId.get(entry.opportunityId);
                  return (
                    <li
                      key={entry.opportunityId}
                      className="rounded-lg border border-ink-200 p-3"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm font-medium">
                            {record?.title ?? 'Record unavailable'}
                          </p>
                          <p className="mt-0.5 text-xs text-ink-500">
                            {record?.county ?? 'Georgia'} ·{' '}
                            {formatDeadline(record?.closingDate)}
                          </p>
                        </div>
                        {record ? (
                          <ScoreBadge
                            score={record.score}
                            classification={record.classification}
                            size="sm"
                          />
                        ) : null}
                      </div>

                      <div className="mt-3">
                        <label
                          htmlFor={`commentary-${entry.opportunityId}`}
                          className="text-xs font-medium"
                        >
                          Editor commentary
                        </label>
                        <textarea
                          id={`commentary-${entry.opportunityId}`}
                          rows={2}
                          value={entry.editorCommentary}
                          onChange={(event) => {
                            const next = [...draft.opportunities];
                            next[index] = {
                              ...entry,
                              editorCommentary: event.target.value,
                            };
                            setDraft({ ...draft, opportunities: next });
                          }}
                          className="mt-1 w-full rounded-lg border border-ink-300 px-3 py-2 text-sm"
                          placeholder="Why this made the report, and what to check first."
                        />
                      </div>

                      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <label
                            htmlFor={`rank-${entry.opportunityId}`}
                            className="text-xs text-ink-600"
                          >
                            Visible to
                          </label>
                          <select
                            id={`rank-${entry.opportunityId}`}
                            value={entry.minimumAccessRank}
                            onChange={(event) => {
                              const next = [...draft.opportunities];
                              next[index] = {
                                ...entry,
                                minimumAccessRank: Number(event.target.value),
                              };
                              setDraft({ ...draft, opportunities: next });
                            }}
                            className="rounded-lg border border-ink-300 px-2 py-1 text-xs"
                          >
                            {RANK_OPTIONS.map((option) => (
                              <option key={option.rank} value={option.rank}>
                                {option.label} and above
                              </option>
                            ))}
                          </select>
                        </div>

                        <div className="flex gap-1">
                          <button
                            type="button"
                            disabled={index === 0}
                            onClick={() =>
                              setDraft({
                                ...draft,
                                opportunities: move(
                                  draft.opportunities,
                                  index,
                                  index - 1,
                                ),
                              })
                            }
                            className="rounded border border-ink-300 px-2 py-1 text-xs disabled:opacity-40"
                          >
                            Up<span className="sr-only"> — move earlier</span>
                          </button>
                          <button
                            type="button"
                            disabled={index === draft.opportunities.length - 1}
                            onClick={() =>
                              setDraft({
                                ...draft,
                                opportunities: move(
                                  draft.opportunities,
                                  index,
                                  index + 1,
                                ),
                              })
                            }
                            className="rounded border border-ink-300 px-2 py-1 text-xs disabled:opacity-40"
                          >
                            Down<span className="sr-only"> — move later</span>
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setDraft({
                                ...draft,
                                opportunities: draft.opportunities.filter(
                                  (_, position) => position !== index,
                                ),
                              })
                            }
                            className="rounded border border-ink-300 px-2 py-1 text-xs text-red-800"
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </Card>

          {/* Sections */}
          <Card>
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold">Sections</h2>
              <Button
                variant="secondary"
                className="px-3 py-1.5 text-xs"
                onClick={() =>
                  setDraft({
                    ...draft,
                    sections: [
                      ...draft.sections,
                      {
                        sectionType: 'custom',
                        title: 'New section',
                        content: '',
                        minimumAccessRank: draft.minimumAccessRank,
                      },
                    ],
                  })
                }
              >
                Add section
              </Button>
            </div>

            {draft.sections.length === 0 ? (
              <p className="mt-3 text-sm text-ink-600">
                No extra sections. The executive summary, market commentary and
                record list are always included.
              </p>
            ) : (
              <ol className="mt-4 space-y-3">
                {draft.sections.map((section, index) => (
                  <li
                    key={index}
                    className="rounded-lg border border-ink-200 p-3"
                  >
                    <div className="grid gap-3 sm:grid-cols-[1fr,180px]">
                      <div>
                        <label
                          htmlFor={`section-title-${index}`}
                          className="text-xs font-medium"
                        >
                          Title
                        </label>
                        <input
                          id={`section-title-${index}`}
                          value={section.title}
                          onChange={(event) => {
                            const next = [...draft.sections];
                            next[index] = {
                              ...section,
                              title: event.target.value,
                            };
                            setDraft({ ...draft, sections: next });
                          }}
                          className="mt-1 w-full rounded-lg border border-ink-300 px-3 py-2 text-sm"
                        />
                      </div>
                      <div>
                        <label
                          htmlFor={`section-type-${index}`}
                          className="text-xs font-medium"
                        >
                          Type
                        </label>
                        <select
                          id={`section-type-${index}`}
                          value={section.sectionType}
                          onChange={(event) => {
                            const next = [...draft.sections];
                            next[index] = {
                              ...section,
                              sectionType: event.target.value,
                            };
                            setDraft({ ...draft, sections: next });
                          }}
                          className="mt-1 w-full rounded-lg border border-ink-300 px-3 py-2 text-sm"
                        >
                          {SECTION_TYPES.map((value) => (
                            <option key={value} value={value}>
                              {titleCase(value)}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <label
                      htmlFor={`section-content-${index}`}
                      className="mt-3 block text-xs font-medium"
                    >
                      Content
                    </label>
                    <textarea
                      id={`section-content-${index}`}
                      rows={4}
                      value={section.content}
                      onChange={(event) => {
                        const next = [...draft.sections];
                        next[index] = {
                          ...section,
                          content: event.target.value,
                        };
                        setDraft({ ...draft, sections: next });
                      }}
                      className="mt-1 w-full rounded-lg border border-ink-300 px-3 py-2 text-sm"
                    />

                    <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <label
                          htmlFor={`section-rank-${index}`}
                          className="text-xs text-ink-600"
                        >
                          Visible to
                        </label>
                        <select
                          id={`section-rank-${index}`}
                          value={section.minimumAccessRank}
                          onChange={(event) => {
                            const next = [...draft.sections];
                            next[index] = {
                              ...section,
                              minimumAccessRank: Number(event.target.value),
                            };
                            setDraft({ ...draft, sections: next });
                          }}
                          className="rounded-lg border border-ink-300 px-2 py-1 text-xs"
                        >
                          {RANK_OPTIONS.map((option) => (
                            <option key={option.rank} value={option.rank}>
                              {option.label} and above
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="flex gap-1">
                        <button
                          type="button"
                          disabled={index === 0}
                          onClick={() =>
                            setDraft({
                              ...draft,
                              sections: move(draft.sections, index, index - 1),
                            })
                          }
                          className="rounded border border-ink-300 px-2 py-1 text-xs disabled:opacity-40"
                        >
                          Up
                        </button>
                        <button
                          type="button"
                          disabled={index === draft.sections.length - 1}
                          onClick={() =>
                            setDraft({
                              ...draft,
                              sections: move(draft.sections, index, index + 1),
                            })
                          }
                          className="rounded border border-ink-300 px-2 py-1 text-xs disabled:opacity-40"
                        >
                          Down
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setDraft({
                              ...draft,
                              sections: draft.sections.filter(
                                (_, position) => position !== index,
                              ),
                            })
                          }
                          className="rounded border border-ink-300 px-2 py-1 text-xs text-red-800"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>

        {/* ---- Right: preview, settings, actions ------------------------ */}
        <div className="space-y-4 lg:sticky lg:top-6 lg:self-start">
          <Card>
            <h2 className="text-base font-semibold">Access preview</h2>
            <div
              role="group"
              aria-label="Preview tier"
              className="mt-3 flex flex-wrap gap-1.5"
            >
              {RANK_OPTIONS.map((option) => (
                <button
                  key={option.rank}
                  type="button"
                  aria-pressed={previewRank === option.rank}
                  onClick={() => setPreviewRank(option.rank)}
                  className={cx(
                    'rounded-full border px-2.5 py-1 text-xs',
                    previewRank === option.rank
                      ? 'border-ink-900 bg-ink-900 text-white'
                      : 'border-ink-300 hover:bg-ink-50',
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <p className="mt-3 text-sm text-ink-700">
              A {titleCase(planCodeForRank(previewRank))} member sees{' '}
              <strong>{visibleToPreview.length}</strong> of{' '}
              {draft.opportunities.length} records and{' '}
              <strong>
                {
                  draft.sections.filter(
                    (section) => previewRank >= section.minimumAccessRank,
                  ).length
                }
              </strong>{' '}
              of {draft.sections.length} sections.
            </p>
            {previewRank < draft.minimumAccessRank ? (
              <p className="mt-2 rounded bg-amber-50 px-2 py-1.5 text-xs text-amber-900">
                This tier cannot open the report at all — the report&rsquo;s own
                minimum is {titleCase(planCodeForRank(draft.minimumAccessRank))}
                .
              </p>
            ) : null}
          </Card>

          <Card>
            <h2 className="text-base font-semibold">Settings</h2>
            <div className="mt-3 space-y-3">
              <div>
                <label htmlFor="report-rank" className={labelClass}>
                  Minimum tier
                </label>
                <select
                  id="report-rank"
                  value={draft.minimumAccessRank}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      minimumAccessRank: Number(event.target.value),
                    })
                  }
                  className={inputClass}
                >
                  {RANK_OPTIONS.map((option) => (
                    <option key={option.rank} value={option.rank}>
                      {option.label} and above
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="scheduled-at" className={labelClass}>
                  Schedule
                </label>
                <input
                  id="scheduled-at"
                  type="datetime-local"
                  value={draft.scheduledAt}
                  onChange={(event) =>
                    setDraft({ ...draft, scheduledAt: event.target.value })
                  }
                  className={inputClass}
                />
                <p className="mt-1 text-xs text-ink-500">
                  Leave empty to publish now.
                </p>
              </div>

              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={distribute}
                  onChange={(event) => setDistribute(event.target.checked)}
                  className="mt-0.5 rounded border-ink-300"
                />
                <span>
                  Email this to members when published.
                  <span className="block text-xs text-ink-500">
                    The weekly distribution job sends it, personalised per
                    member and deduplicated so nobody gets it twice.
                  </span>
                </span>
              </label>
            </div>
          </Card>

          {actionMessage ? (
            <p
              role={actionIsError ? 'alert' : 'status'}
              className={
                actionIsError
                  ? 'rounded-lg bg-red-50 px-3 py-2 text-sm text-red-900'
                  : 'rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-900'
              }
            >
              {actionMessage}
            </p>
          ) : null}

          <div className="space-y-2">
            <Button
              className="w-full"
              onClick={() =>
                runAction('publish', 'Publish', {
                  distributeByEmail: distribute,
                  scheduledAt: draft.scheduledAt || undefined,
                })
              }
            >
              {draft.scheduledAt ? 'Schedule report' : 'Publish report'}
            </Button>
            <Button
              variant="secondary"
              className="w-full"
              onClick={() => runAction('generate-pdf', 'Generate PDF')}
            >
              {hasPdf ? 'Regenerate PDF' : 'Generate PDF'}
            </Button>
          </div>

          <p className="text-xs text-ink-500">
            Publishing writes an audit entry naming you. A published report can
            be regenerated but its publication is on the record.
          </p>
        </div>
      </div>

      <p className="mt-8 border-t border-ink-200 pt-5 text-xs text-ink-500">
        Last saved {formatDate(new Date())} · Report {slug}
      </p>
    </div>
  );
}
