interface ParsedSentryDsn {
  endpoint: string;
  publicKey: string;
  /** Public representation: never forward the deprecated password component. */
  dsn: string;
}

/** Shared by delivery and preflight. Valid syntax does not prove ingestion. */
export function parseSentryDsn(dsn: string): ParsedSentryDsn | null {
  // URL silently strips some whitespace and normalizes backslashes. Reject
  // those configuration mistakes rather than sending to a different address.
  if (!dsn || /[\s\\]/.test(dsn)) return null;
  try {
    const url = new URL(dsn);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      !url.hostname ||
      !/^[\w-]+$/.test(url.username) ||
      url.search ||
      url.hash
    ) {
      return null;
    }
    const segments = url.pathname.split('/');
    const projectId = segments.pop();
    if (!projectId || !/^\d+$/.test(projectId)) return null;
    const prefix = segments.join('/');
    url.password = '';
    return {
      endpoint: `${url.origin}${prefix}/api/${projectId}/envelope/`,
      publicKey: url.username,
      dsn: url.toString(),
    };
  } catch {
    return null;
  }
}
