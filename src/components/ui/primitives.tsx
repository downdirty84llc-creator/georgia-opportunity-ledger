import Link from 'next/link';
import type { ReactNode } from 'react';

import {
  classificationLabel,
  type ScoreClassification,
} from '@/lib/scoring/score';

/**
 * Shared UI primitives.
 *
 * Two accessibility rules are enforced here rather than left to each caller:
 * status is never carried by colour alone (every badge has a word in it), and
 * every icon-like element carries text. Spec 22 requires both.
 */

export function cx(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(' ');
}

// --- Buttons ---------------------------------------------------------------

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

const BUTTON_STYLES: Record<ButtonVariant, string> = {
  primary:
    'bg-ink-900 text-white hover:bg-ink-800 disabled:bg-ink-300 disabled:text-ink-100',
  secondary:
    'border border-ink-300 bg-white text-ink-900 hover:border-ink-400 hover:bg-ink-50',
  ghost: 'text-ink-700 hover:bg-ink-100 hover:text-ink-900',
  danger: 'bg-signal-immediate text-white hover:bg-red-800',
};

const BUTTON_BASE =
  'inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 ' +
  'text-sm font-semibold transition-colors disabled:cursor-not-allowed';

export function Button({
  variant = 'primary',
  className,
  type = 'button',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return (
    <button
      type={type}
      className={cx(BUTTON_BASE, BUTTON_STYLES[variant], className)}
      {...props}
    />
  );
}

export function ButtonLink({
  href,
  variant = 'primary',
  className,
  children,
  ...props
}: {
  href: string;
  variant?: ButtonVariant;
  className?: string;
  children: ReactNode;
} & Omit<React.ComponentProps<typeof Link>, 'href' | 'className'>) {
  return (
    <Link
      href={href}
      className={cx(BUTTON_BASE, BUTTON_STYLES[variant], className)}
      {...props}
    >
      {children}
    </Link>
  );
}

// --- Surfaces --------------------------------------------------------------

export function Card({
  children,
  className,
  as: Component = 'div',
}: {
  children: ReactNode;
  className?: string;
  as?: 'div' | 'article' | 'section' | 'li';
}) {
  return (
    <Component className={cx('surface p-5', className)}>{children}</Component>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        {eyebrow ? (
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-ink-500">
            {eyebrow}
          </p>
        ) : null}
        <h2 className="mt-1 text-xl sm:text-2xl">{title}</h2>
        {description ? (
          <p className="mt-2 max-w-prose text-sm text-ink-600">{description}</p>
        ) : null}
      </div>
      {action}
    </div>
  );
}

// --- Badges ----------------------------------------------------------------

const CLASSIFICATION_STYLES: Record<ScoreClassification, string> = {
  immediate_action: 'bg-red-50 text-signal-immediate ring-red-200',
  strong_opportunity: 'bg-orange-50 text-signal-strong ring-orange-200',
  worth_investigating: 'bg-amber-50 text-signal-investigate ring-amber-200',
  limited_or_specialized: 'bg-lime-50 text-signal-limited ring-lime-200',
  information_only: 'bg-slate-100 text-signal-info ring-slate-200',
};

export function ScoreBadge({
  score,
  classification,
  size = 'md',
}: {
  score: number;
  classification: ScoreClassification;
  size?: 'sm' | 'md';
}) {
  const label = classificationLabel(classification);
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1.5 rounded-full font-semibold ring-1',
        CLASSIFICATION_STYLES[classification],
        size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-sm',
      )}
    >
      <span aria-hidden="true">{score}</span>
      {/* The number alone would be meaningless to a screen reader, and the
          colour alone would be meaningless to anyone. */}
      <span className="sr-only">Scored {score} out of 100.</span>
      <span className="font-medium">{label}</span>
    </span>
  );
}

export function Pill({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'warning' | 'positive' | 'muted';
}) {
  const tones = {
    neutral: 'bg-ink-100 text-ink-700',
    warning: 'bg-amber-100 text-amber-900',
    positive: 'bg-emerald-100 text-emerald-900',
    muted: 'bg-ink-50 text-ink-500',
  } as const;
  return (
    <span
      className={cx(
        'inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium',
        tones[tone],
      )}
    >
      {children}
    </span>
  );
}

export function SampleDataBadge() {
  return (
    <span className="inline-flex items-center rounded-md bg-purple-100 px-2 py-0.5 text-xs font-semibold text-purple-900">
      Sample data
    </span>
  );
}

// --- Locked state ----------------------------------------------------------

/**
 * The locked panel names what is hidden, why, and which plan unlocks it
 * (spec 14.3). A blurred teaser with no explanation is the pattern this is
 * written to avoid.
 */
export function LockedPanel({
  title,
  message,
  requiredPlan,
  sections,
}: {
  title: string;
  message: string;
  requiredPlan?: string;
  sections?: readonly string[];
}) {
  return (
    <div className="rounded-xl border border-dashed border-ink-300 bg-ink-50/70 p-6">
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-ink-200 text-ink-700"
        >
          ★
        </span>
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-ink-900">{title}</h3>
          <p className="mt-1 text-sm text-ink-600">{message}</p>

          {sections && sections.length > 0 ? (
            <>
              <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-ink-500">
                Included at the higher tier
              </p>
              <ul className="mt-2 grid gap-1 text-sm text-ink-700 sm:grid-cols-2">
                {sections.map((section) => (
                  <li key={section} className="flex items-center gap-2">
                    <span aria-hidden="true" className="text-ink-400">
                      •
                    </span>
                    {section}
                  </li>
                ))}
              </ul>
            </>
          ) : null}

          <div className="mt-5 flex flex-wrap gap-3">
            <ButtonLink href="/pricing">
              {requiredPlan ? `Compare plans` : 'See membership options'}
            </ButtonLink>
            <ButtonLink href="/how-it-works" variant="secondary">
              How the ledger works
            </ButtonLink>
          </div>
        </div>
      </div>
    </div>
  );
}

// --- Empty state -----------------------------------------------------------

export function EmptyState({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <div className="surface p-10 text-center">
      <h3 className="text-lg font-semibold">{title}</h3>
      <p className="mx-auto mt-2 max-w-prose text-sm text-ink-600">
        {description}
      </p>
      {children ? (
        <div className="mt-5 flex flex-wrap justify-center gap-3">{children}</div>
      ) : null}
    </div>
  );
}

// --- Data display ----------------------------------------------------------

export function DataRow({
  label,
  value,
}: {
  label: string;
  value: ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-ink-100 py-2 last:border-0">
      <dt className="text-sm text-ink-600">{label}</dt>
      <dd className="text-right text-sm font-medium text-ink-900">{value}</dd>
    </div>
  );
}

/**
 * A horizontal meter. The value is announced through the text label, not
 * inferred from the bar, so it works without sight and without colour.
 */
export function Meter({
  label,
  value,
  max,
}: {
  label: string;
  value: number;
  max: number;
}) {
  const percentage = max === 0 ? 0 : Math.round((value / max) * 100);
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="text-ink-700">{label}</span>
        <span className="font-medium text-ink-900 tabular-nums">
          {value}
          <span className="text-ink-400"> / {max}</span>
        </span>
      </div>
      <div
        role="meter"
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-label={`${label}: ${value} of ${max}`}
        className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-ink-100"
      >
        <div
          className="h-full rounded-full bg-ink-700"
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}
