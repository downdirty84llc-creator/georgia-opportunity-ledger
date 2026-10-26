/** Bouncer v2 transport. Fixed destinations; no customer filenames or raw errors. */
const API = 'https://api.usebouncer.dev';
const MAX_BYTES = 26_214_400;
const ID = /^scan_[A-Za-z0-9_-]{1,100}$/;
type ObjectValue = Record<string, unknown>;
function object(value: unknown): ObjectValue {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new BouncerError('invalid');
  return value as ObjectValue;
}

export class BouncerError extends Error {
  constructor(
    readonly code: 'quota' | 'auth' | 'missing' | 'invalid' | 'transport',
  ) {
    super(
      {
        quota: 'Scanner quota is exhausted; the attachment remains blocked.',
        auth: 'Scanner authentication failed; the attachment remains blocked.',
        missing: 'The saved scan is unavailable; operator review is required.',
        invalid:
          'Scanner returned an unusable response; the attachment remains blocked.',
        transport:
          'Scanner request did not complete; the attachment remains blocked.',
      }[code],
    );
  }
}

export interface BouncerTicket {
  id: string;
  uploadUrl: string;
  fields: Record<string, string>;
}
export interface BouncerFile {
  size: number;
  sha256: string;
}
export type BouncerResult = {
  verdict: 'pending' | 'clean' | 'infected' | 'failed';
  detail: string | null;
};
function validFile(file: BouncerFile) {
  if (
    !Number.isSafeInteger(file.size) ||
    file.size < 1 ||
    file.size > MAX_BYTES ||
    !/^[a-f0-9]{64}$/.test(file.sha256)
  )
    throw new BouncerError('invalid');
}
async function json(response: Response): Promise<ObjectValue> {
  if (!response.ok) {
    await response.body?.cancel();
    throw new BouncerError(
      response.status === 429
        ? 'quota'
        : response.status === 401 || response.status === 403
          ? 'auth'
          : response.status === 404
            ? 'missing'
            : 'transport',
    );
  }
  const reader = response.body?.getReader();
  if (!reader) throw new BouncerError('invalid');
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 16_384) {
      await reader.cancel();
      throw new BouncerError('invalid');
    }
    chunks.push(value);
  }
  const envelope = object(JSON.parse(Buffer.concat(chunks).toString('utf8')));
  if (envelope.status !== 'success') throw new BouncerError('invalid');
  return object(envelope.data);
}
function safeError(error: unknown): BouncerError {
  return error instanceof BouncerError ? error : new BouncerError('transport');
}
function headers(key: string) {
  if (!/^bnc_live_[A-Za-z0-9_-]+$/.test(key)) throw new BouncerError('auth');
  return { 'X-API-Key': key };
}
function uploadDestination(value: string): string {
  const url = new URL(value);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash ||
    url.pathname !== '/' ||
    !/^bouncer-[a-z0-9-]+\.s3(?:\.[a-z0-9-]+)?\.amazonaws\.com$/.test(
      url.hostname,
    )
  )
    throw new BouncerError('invalid');
  return url.href;
}

/** Ticket fields are credentials: keep only in memory until this upload ends. */
export async function createBouncerScan(
  key: string,
  file: BouncerFile,
  signal: AbortSignal,
): Promise<BouncerTicket> {
  try {
    validFile(file);
    const response = await fetch(`${API}/v2/scan`, {
      method: 'POST',
      signal,
      redirect: 'error',
      headers: { ...headers(key), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        file_name: 'attachment.bin',
        mime_type: 'application/octet-stream',
      }),
    });
    const data = await json(response);
    if (
      response.status !== 201 ||
      typeof data.scan_id !== 'string' ||
      !ID.test(data.scan_id) ||
      typeof data.max_file_size !== 'number' ||
      data.max_file_size < file.size
    )
      throw new BouncerError('invalid');
    const upload = object(data.upload);
    const uploadUrl = uploadDestination(String(upload.url));
    const fields = object(upload.fields);
    if (
      Object.keys(fields).length < 2 ||
      Object.keys(fields).length > 30 ||
      Object.entries(fields).some(
        ([name, value]) =>
          !name || name.toLowerCase() === 'file' || typeof value !== 'string',
      )
    )
      throw new BouncerError('invalid');
    return {
      id: data.scan_id,
      uploadUrl,
      fields: fields as Record<string, string>,
    };
  } catch (error) {
    throw safeError(error);
  }
}

export async function uploadBouncerFile(
  ticket: BouncerTicket,
  bytes: Uint8Array,
  signal: AbortSignal,
): Promise<void> {
  try {
    if (bytes.length < 1 || bytes.length > MAX_BYTES)
      throw new BouncerError('invalid');
    const form = new FormData();
    for (const [name, value] of Object.entries(ticket.fields))
      form.append(name, value);
    form.append(
      'file',
      new Blob([bytes as unknown as BlobPart], {
        type: 'application/octet-stream',
      }),
      'attachment.bin',
    );
    // No API key on storage requests, and never follow a credential-bearing redirect.
    const response = await fetch(uploadDestination(ticket.uploadUrl), {
      method: 'POST',
      body: form,
      signal,
      redirect: 'error',
    });
    await response.body?.cancel();
    if (response.status !== 204) throw new BouncerError('transport');
  } catch (error) {
    throw safeError(error);
  }
}

export async function pollBouncerScan(
  key: string,
  id: string,
  file: BouncerFile,
  signal: AbortSignal,
): Promise<BouncerResult> {
  try {
    validFile(file);
    if (!ID.test(id)) throw new BouncerError('invalid');
    const response = await fetch(`${API}/v2/scan/${id}`, {
      headers: headers(key),
      signal,
      redirect: 'error',
    });
    const data = await json(response);
    if (response.status !== 200) throw new BouncerError('invalid');
    if (data.scan_id !== id) throw new BouncerError('invalid');
    if (data.status === 'pending' || data.status === 'scanning')
      return {
        verdict: 'pending',
        detail: 'Waiting for the saved scanner result.',
      };
    if (data.status === 'failed')
      return {
        verdict: 'failed',
        detail:
          'The scanner could not process this file; operator review is required.',
      };
    if (data.status !== 'completed') throw new BouncerError('invalid');
    const scanned = object(data.file);
    if (scanned.sha256 !== file.sha256 || scanned.size !== file.size)
      throw new BouncerError('invalid');
    if (data.verdict === 'malicious')
      return {
        verdict: 'infected',
        detail: 'Bouncer detected malware in these exact bytes.',
      };
    if (data.verdict === 'suspicious')
      return {
        verdict: 'failed',
        detail:
          'Bouncer marked this file suspicious; operator review is required.',
      };
    if (data.verdict !== 'clean') throw new BouncerError('invalid');
    const engines = object(data.engines);
    if (
      object(engines.signature).result !== 'clean' ||
      object(engines.pattern).result !== 'clean' ||
      !Array.isArray(data.threats) ||
      data.threats.length !== 0
    )
      throw new BouncerError('invalid');
    return { verdict: 'clean', detail: null };
  } catch (error) {
    throw safeError(error);
  }
}
