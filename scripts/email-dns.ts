import { resolveTxt } from 'node:dns/promises';

interface EmailDnsOptions {
  from: string;
  provider: string;
  returnPathDomain?: string;
}

type ResolveTxt = (hostname: string) => Promise<string[][]>;
type DnsCheck = { status: 'pass' | 'fail' | 'unknown'; detail: string };

export async function emailDnsCheck(
  options: EmailDnsOptions,
  resolver: ResolveTxt = resolveTxt,
): Promise<DnsCheck> {
  const normalize = (value: string) =>
    value.trim().toLowerCase().replace(/\.$/, '');
  const domain = normalize(options.from.match(/@([^>\s]+)/)?.[1] ?? '');
  if (!domain) {
    return { status: 'unknown', detail: 'no sending domain in EMAIL_FROM' };
  }

  // SPF belongs to the SMTP envelope's return-path domain, not necessarily
  // the visible From domain. Resend defaults to send.<verified domain>.
  // resolveTxt follows CNAMEs, including Resend's provider-managed records.
  // https://resend.com/docs/dashboard/domains/custom-return-path
  const spfDomain =
    normalize(options.returnPathDomain ?? '') ||
    (options.provider === 'resend' ? `send.${domain}` : '');
  if (!spfDomain) {
    return {
      status: 'unknown',
      detail:
        "Set EMAIL_RETURN_PATH_DOMAIN to the provider's SMTP envelope domain; root-domain SPF is not a substitute.",
    };
  }
  const dmarcDomain = `_dmarc.${domain}`;

  type Lookup =
    { known: true; values: string[] } | { known: false; reason: string };
  const lookup = async (name: string): Promise<Lookup> => {
    try {
      const records = await resolver(name);
      return { known: true, values: records.map((parts) => parts.join('')) };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException | null)?.code ?? 'UNKNOWN';
      // Only an authoritative absence is missing. Timeouts, refused queries
      // and server failures mean this run cannot determine DNS readiness.
      if (code === 'ENOTFOUND' || code === 'ENODATA') {
        return { known: true, values: [] };
      }
      return { known: false, reason: code };
    }
  };

  const [spf, dmarc] = await Promise.all([
    lookup(spfDomain),
    lookup(dmarcDomain),
  ]);
  if (!spf.known || !dmarc.known) {
    const reasons = [
      !spf.known && `${spfDomain} (${spf.reason})`,
      !dmarc.known && `${dmarcDomain} (${dmarc.reason})`,
    ].filter(Boolean);
    return {
      status: 'unknown',
      detail: `DNS did not answer for ${reasons.join(', ')} — not a verdict on the records`,
    };
  }
  const spfRecords = spf.values.filter((value) =>
    /^v=spf1(?:\s|$)/i.test(value),
  );
  const dmarcRecords = dmarc.values.filter((value) =>
    /^v=DMARC1(?:;|$)/.test(value),
  );
  const problems = [
    spfRecords.length === 0 && `missing SPF at ${spfDomain}`,
    spfRecords.length > 1 && `multiple SPF records at ${spfDomain}`,
    dmarcRecords.length === 0 && `missing DMARC at ${dmarcDomain}`,
    dmarcRecords.length > 1 && `multiple DMARC records at ${dmarcDomain}`,
  ].filter(Boolean);
  return {
    status: problems.length ? 'fail' : 'pass',
    detail: problems.length
      ? problems.join('; ')
      : `SPF present at ${spfDomain}; DMARC present at ${dmarcDomain}. Record presence only; DKIM and delivery are not verified.`,
  };
}
