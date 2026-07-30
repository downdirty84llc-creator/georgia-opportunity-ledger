import { classificationLabel, type ScoreClassification } from '@/lib/scoring/score';
import { publicEnv } from '@/lib/env';

/**
 * Transactional email templates (spec 16).
 *
 * Each template returns both HTML and plain text. The text version is not a
 * courtesy — it is what deliverability filters read, and what a screen reader
 * on a text-only client gets.
 *
 * Every message carries the manage-preferences and unsubscribe links required
 * by spec 21.
 */

const siteUrl = () => publicEnv.siteUrl.replace(/\/$/, '');

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

function layout(options: {
  title: string;
  preheader: string;
  bodyHtml: string;
  ctaLabel?: string;
  ctaUrl?: string;
}): string {
  const base = siteUrl();
  return `
<div style="margin:0;padding:0;background:#f5f7f7;">
  <span style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(
    options.preheader,
  )}</span>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
         style="background:#f5f7f7;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
             style="max-width:600px;background:#ffffff;border-radius:12px;
                    border:1px solid #e3e9e9;font-family:-apple-system,
                    BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;
                    color:#1a2424;">
        <tr><td style="padding:24px 28px 8px;">
          <p style="margin:0;font-size:13px;letter-spacing:0.08em;
                    text-transform:uppercase;color:#4f6b6b;">
            Georgia Opportunity Ledger
          </p>
          <h1 style="margin:8px 0 0;font-size:22px;line-height:1.3;">
            ${escapeHtml(options.title)}
          </h1>
        </td></tr>
        <tr><td style="padding:8px 28px 20px;font-size:15px;line-height:1.6;">
          ${options.bodyHtml}
        </td></tr>
        ${
          options.ctaUrl && options.ctaLabel
            ? `<tr><td style="padding:0 28px 28px;">
                 <a href="${options.ctaUrl}"
                    style="display:inline-block;background:#1a2424;color:#ffffff;
                           text-decoration:none;padding:12px 20px;border-radius:8px;
                           font-weight:600;font-size:15px;">
                   ${escapeHtml(options.ctaLabel)}
                 </a>
               </td></tr>`
            : ''
        }
        <tr><td style="padding:16px 28px 24px;border-top:1px solid #e3e9e9;
                       font-size:12px;line-height:1.6;color:#4f6b6b;">
          <p style="margin:0 0 8px;">
            Research and decision support only. Nothing here is investment,
            legal, brokerage or appraisal advice, and no eligibility, financing
            or return is guaranteed.
          </p>
          <p style="margin:0;">
            <a href="${base}/account/email-preferences" style="color:#4f6b6b;">
              Email preferences</a> &middot;
            <a href="${base}/account/email-preferences?unsubscribe=1"
               style="color:#4f6b6b;">Unsubscribe</a> &middot;
            <a href="${base}/legal/privacy" style="color:#4f6b6b;">Privacy</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</div>`.trim();
}

function textFooter(): string {
  const base = siteUrl();
  return [
    '',
    '---',
    'Research and decision support only. Not investment, legal, brokerage or',
    'appraisal advice. No eligibility, financing or return is guaranteed.',
    `Email preferences: ${base}/account/email-preferences`,
    `Unsubscribe: ${base}/account/email-preferences?unsubscribe=1`,
  ].join('\n');
}

export function welcomeEmail(input: {
  firstName: string | null;
  planName: string;
}): RenderedEmail {
  const base = siteUrl();
  const greeting = input.firstName ? `Welcome, ${input.firstName}.` : 'Welcome.';

  return {
    subject: 'Welcome to the Georgia Opportunity Ledger',
    html: layout({
      title: greeting,
      preheader: `Your ${input.planName} membership is active.`,
      bodyHtml: `
        <p style="margin:0 0 12px;">Your account is confirmed and your
        <strong>${escapeHtml(input.planName)}</strong> membership is active.</p>
        <p style="margin:0 0 12px;">Three things worth doing first:</p>
        <ol style="margin:0 0 12px;padding-left:20px;">
          <li style="margin-bottom:6px;">Tell us the counties and industries you
          care about, so your dashboard and alerts are about your market rather
          than the whole state.</li>
          <li style="margin-bottom:6px;">Look at the deadline calendar — most of
          what we track has a date attached.</li>
          <li>Read the methodology, so you know exactly what a score of 82
          means before you act on one.</li>
        </ol>`,
      ctaLabel: 'Set your preferences',
      ctaUrl: `${base}/account/preferences`,
    }),
    text: [
      greeting,
      '',
      `Your ${input.planName} membership is active.`,
      '',
      `Set your preferences: ${base}/account/preferences`,
      `Your dashboard: ${base}/dashboard`,
      `How scoring works: ${base}/how-it-works`,
      `Support: ${base}/support`,
      textFooter(),
    ].join('\n'),
  };
}

export function subscriptionConfirmationEmail(input: {
  planName: string;
  interval: 'monthly' | 'annual';
  renewalDate: string | null;
  amount: string;
}): RenderedEmail {
  const base = siteUrl();
  return {
    subject: `Your ${input.planName} subscription is active`,
    html: layout({
      title: `${input.planName} is active`,
      preheader: `Billed ${input.interval}. Renews ${input.renewalDate ?? 'automatically'}.`,
      bodyHtml: `
        <p style="margin:0 0 12px;">Thank you — your subscription is live.</p>
        <table role="presentation" cellpadding="0" cellspacing="0"
               style="width:100%;font-size:14px;border-collapse:collapse;">
          <tr><td style="padding:6px 0;color:#4f6b6b;">Plan</td>
              <td style="padding:6px 0;text-align:right;">
                ${escapeHtml(input.planName)}</td></tr>
          <tr><td style="padding:6px 0;color:#4f6b6b;">Billing interval</td>
              <td style="padding:6px 0;text-align:right;">
                ${escapeHtml(input.interval)}</td></tr>
          <tr><td style="padding:6px 0;color:#4f6b6b;">Amount</td>
              <td style="padding:6px 0;text-align:right;">
                ${escapeHtml(input.amount)}</td></tr>
          <tr><td style="padding:6px 0;color:#4f6b6b;">Renews</td>
              <td style="padding:6px 0;text-align:right;">
                ${escapeHtml(input.renewalDate ?? 'Automatically')}</td></tr>
        </table>
        <p style="margin:14px 0 0;">You can change plan, update your card or
        cancel at any time from the billing portal. Cancelling keeps your access
        until the end of the period you have already paid for.</p>`,
      ctaLabel: 'Manage billing',
      ctaUrl: `${base}/account/billing`,
    }),
    text: [
      `${input.planName} is active.`,
      '',
      `Plan: ${input.planName}`,
      `Billing interval: ${input.interval}`,
      `Amount: ${input.amount}`,
      `Renews: ${input.renewalDate ?? 'Automatically'}`,
      '',
      `Manage billing: ${base}/account/billing`,
      textFooter(),
    ].join('\n'),
  };
}

export interface AlertOpportunity {
  title: string;
  slug: string;
  score: number;
  classification: ScoreClassification;
  county: string | null;
  closingDate: string | null;
  whyItMatters: string;
  recommendedAction: string;
}

export function premiumAlertEmail(input: {
  firstName: string | null;
  opportunity: AlertOpportunity;
  reason: 'new' | 'updated';
}): RenderedEmail {
  const base = siteUrl();
  const { opportunity } = input;
  const url = `${base}/opportunities/${opportunity.slug}`;
  const label = classificationLabel(opportunity.classification);
  const deadline = opportunity.closingDate
    ? new Date(opportunity.closingDate).toISOString().slice(0, 10)
    : 'No stated deadline';

  return {
    subject:
      input.reason === 'updated'
        ? `Updated: ${opportunity.title}`
        : `${label} (${opportunity.score}): ${opportunity.title}`,
    html: layout({
      title: opportunity.title,
      preheader: `${label} — scored ${opportunity.score} of 100. Deadline ${deadline}.`,
      bodyHtml: `
        <p style="margin:0 0 12px;">
          <strong>${opportunity.score}/100 — ${escapeHtml(label)}</strong><br />
          <span style="color:#4f6b6b;">
            ${escapeHtml(opportunity.county ?? 'Georgia')} &middot;
            Deadline ${escapeHtml(deadline)}
          </span>
        </p>
        ${
          input.reason === 'updated'
            ? '<p style="margin:0 0 12px;padding:10px 12px;background:#fbe8e4;' +
              'border-radius:8px;">This record changed materially since it was ' +
              'published. The figures below are the current ones.</p>'
            : ''
        }
        <p style="margin:0 0 6px;"><strong>Why it matters</strong></p>
        <p style="margin:0 0 12px;">${escapeHtml(opportunity.whyItMatters)}</p>
        <p style="margin:0 0 6px;"><strong>Recommended next action</strong></p>
        <p style="margin:0 0 12px;">${escapeHtml(opportunity.recommendedAction)}</p>`,
      ctaLabel: 'Open the full record',
      ctaUrl: url,
    }),
    text: [
      opportunity.title,
      `${opportunity.score}/100 — ${label}`,
      `${opportunity.county ?? 'Georgia'} · Deadline ${deadline}`,
      '',
      'Why it matters:',
      opportunity.whyItMatters,
      '',
      'Recommended next action:',
      opportunity.recommendedAction,
      '',
      `Open the full record: ${url}`,
      textFooter(),
    ].join('\n'),
  };
}

export function deadlineReminderEmail(input: {
  firstName: string | null;
  daysRemaining: number;
  opportunities: ReadonlyArray<{
    title: string;
    slug: string;
    closingDate: string;
    score: number;
  }>;
}): RenderedEmail {
  const base = siteUrl();
  const when =
    input.daysRemaining === 0
      ? 'today'
      : input.daysRemaining === 1
        ? 'tomorrow'
        : `in ${input.daysRemaining} days`;

  const rows = input.opportunities
    .map(
      (item) => `
        <tr><td style="padding:10px 0;border-bottom:1px solid #e3e9e9;">
          <a href="${base}/opportunities/${item.slug}"
             style="color:#1a2424;font-weight:600;text-decoration:none;">
            ${escapeHtml(item.title)}</a><br />
          <span style="color:#4f6b6b;font-size:13px;">
            Closes ${escapeHtml(item.closingDate.slice(0, 10))} &middot;
            Scored ${item.score}/100</span>
        </td></tr>`,
    )
    .join('');

  const count = input.opportunities.length;

  return {
    subject: `${count} deadline${count === 1 ? '' : 's'} ${when}`,
    html: layout({
      title: `Closing ${when}`,
      preheader: `${count} saved opportunit${count === 1 ? 'y' : 'ies'} closing ${when}.`,
      bodyHtml: `
        <p style="margin:0 0 12px;">These records you are tracking close
        ${escapeHtml(when)}.</p>
        <table role="presentation" cellpadding="0" cellspacing="0"
               style="width:100%;border-collapse:collapse;">${rows}</table>`,
      ctaLabel: 'Open your calendar',
      ctaUrl: `${base}/calendar`,
    }),
    text: [
      `Closing ${when}`,
      '',
      ...input.opportunities.map(
        (item) =>
          `- ${item.title} (closes ${item.closingDate.slice(0, 10)}, scored ${item.score}/100)\n  ${base}/opportunities/${item.slug}`,
      ),
      '',
      `Your calendar: ${base}/calendar`,
      textFooter(),
    ].join('\n'),
  };
}

export function weeklyReportEmail(input: {
  firstName: string | null;
  reportTitle: string;
  reportSlug: string;
  periodLabel: string;
  headline: string;
  counties: readonly string[];
  highlights: ReadonlyArray<{
    title: string;
    slug: string;
    score: number;
    county: string | null;
  }>;
  lockedCount: number;
}): RenderedEmail {
  const base = siteUrl();
  const url = `${base}/reports/${input.reportSlug}`;

  const rows = input.highlights
    .map(
      (item) => `
        <tr><td style="padding:10px 0;border-bottom:1px solid #e3e9e9;">
          <a href="${base}/opportunities/${item.slug}"
             style="color:#1a2424;font-weight:600;text-decoration:none;">
            ${escapeHtml(item.title)}</a><br />
          <span style="color:#4f6b6b;font-size:13px;">
            ${escapeHtml(item.county ?? 'Georgia')} &middot; ${item.score}/100</span>
        </td></tr>`,
    )
    .join('');

  return {
    subject: `${input.reportTitle} — ${input.periodLabel}`,
    html: layout({
      title: input.reportTitle,
      preheader: input.headline,
      bodyHtml: `
        <p style="margin:0 0 12px;">${escapeHtml(input.headline)}</p>
        ${
          input.counties.length > 0
            ? `<p style="margin:0 0 12px;color:#4f6b6b;font-size:13px;">
                 Weighted toward your counties:
                 ${escapeHtml(input.counties.slice(0, 6).join(', '))}</p>`
            : ''
        }
        <table role="presentation" cellpadding="0" cellspacing="0"
               style="width:100%;border-collapse:collapse;">${rows}</table>
        ${
          input.lockedCount > 0
            ? `<p style="margin:14px 0 0;padding:10px 12px;background:#f5f7f7;
                  border-radius:8px;font-size:14px;">
                 ${input.lockedCount} further record${input.lockedCount === 1 ? '' : 's'}
                 in this report ${input.lockedCount === 1 ? 'is' : 'are'} above your
                 current plan.
                 <a href="${base}/pricing" style="color:#1a2424;">Compare plans</a>.
               </p>`
            : ''
        }`,
      ctaLabel: 'Read the full report',
      ctaUrl: url,
    }),
    text: [
      input.reportTitle,
      input.periodLabel,
      '',
      input.headline,
      '',
      ...input.highlights.map(
        (item) =>
          `- ${item.title} (${item.county ?? 'Georgia'}, ${item.score}/100)\n  ${base}/opportunities/${item.slug}`,
      ),
      '',
      input.lockedCount > 0
        ? `${input.lockedCount} further record(s) are above your current plan: ${base}/pricing`
        : '',
      `Read the full report: ${url}`,
      textFooter(),
    ]
      .filter(Boolean)
      .join('\n'),
  };
}
