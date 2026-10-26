import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readJsonBody } from '@/lib/http/request-body';
import { ok, withErrorHandling } from '@/lib/http/responses';

const { reportError } = vi.hoisted(() => ({ reportError: vi.fn() }));
vi.mock('@/lib/observability/report-error', () => ({ reportError }));

const bodyRequest = (body?: string) =>
  new Request('https://ledger.example/api/test', { method: 'POST', body });
const parseRoute = (allowEmpty = false) =>
  withErrorHandling(async (request) =>
    ok(await readJsonBody(request, { allowEmpty })),
  );

describe('safe JSON parsing boundary', () => {
  beforeEach(() => vi.clearAllMocks());

  it.each(['', ' ', '{', 'private-member-text'])(
    'refuses malformed input %j without reporting it',
    async (body) => {
      const response = await parseRoute()(
        bodyRequest(body),
        undefined as never,
      );
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: {
          code: 'bad_request',
          message: 'Request body must contain valid JSON.',
        },
      });
      expect(reportError).not.toHaveBeenCalled();
    },
  );

  it('allows only an actually empty body when defaults are intended', async () => {
    const empty = await parseRoute(true)(bodyRequest(), undefined as never);
    expect(empty.status).toBe(200);
    expect(await empty.json()).toEqual({ data: {} });
    const whitespace = await parseRoute(true)(
      bodyRequest(' '),
      undefined as never,
    );
    expect(whitespace.status).toBe(400);
  });

  it.each(['null', 'false', '123', '[]', '{"filters":{}}'])(
    'leaves valid JSON %s to the route schema',
    async (body) => {
      expect(await readJsonBody(bodyRequest(body))).toEqual(JSON.parse(body));
    },
  );

  it('still reports an internal SyntaxError after a valid body was read', async () => {
    const error = new SyntaxError('Server configuration was invalid');
    const handler = withErrorHandling(async (request) => {
      await readJsonBody(request);
      throw error;
    });
    const response = await handler(bodyRequest('{}'), undefined as never);
    expect(response.status).toBe(500);
    expect(reportError).toHaveBeenCalledWith(
      error,
      expect.objectContaining({ scope: 'api' }),
    );
    expect(await response.text()).not.toContain(error.message);
  });

  it('does not misclassify a stream read failure as bad JSON', async () => {
    const request = bodyRequest('{}');
    const error = new TypeError('Request stream failed');
    vi.spyOn(request, 'text').mockRejectedValue(error);
    const response = await parseRoute()(request, undefined as never);
    expect(response.status).toBe(500);
    expect(reportError).toHaveBeenCalledWith(error, expect.anything());
  });
});
