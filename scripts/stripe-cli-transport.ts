/** Test-only transport: uses an explicitly scoped Stripe CLI OAuth session. */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import assert from 'node:assert/strict';

const run = promisify(execFile);

export function stripeCliFetch(
  executable: string,
  config: string,
): typeof fetch {
  return async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.origin, 'https://api.stripe.com');
    const method = (init?.method ?? 'GET').toLowerCase();
    assert(['get', 'post', 'delete'].includes(method));
    const headers = new Headers(init?.headers);
    const args = [method, url.pathname, '--config', config, '--color', 'off'];
    if (method !== 'get') args.push('--confirm');
    const version = headers.get('stripe-version');
    if (version) args.push('--stripe-version', version);
    const idempotency = headers.get('idempotency-key');
    if (idempotency) args.push('--idempotency', idempotency);
    for (const [key, value] of url.searchParams)
      args.push('-d', `${key}=${value}`);
    for (const [key, value] of new URLSearchParams(String(init?.body ?? '')))
      args.push('-d', `${key}=${value}`);
    let stdout: string;
    try {
      ({ stdout } = await run(executable, args, {
        windowsHide: true,
        timeout: 30000,
        maxBuffer: 4 * 1024 * 1024,
      }));
    } catch (error) {
      stdout = (error as { stdout?: string }).stdout ?? '';
      if (!stdout.trim().startsWith('{'))
        throw new Error('Stripe CLI request failed');
    }
    const payload = JSON.parse(stdout);
    return new Response(JSON.stringify(payload), {
      status: payload.error ? 400 : 200,
      headers: { 'content-type': 'application/json' },
    });
  };
}
