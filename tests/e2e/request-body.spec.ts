import { expect, test } from '@playwright/test';

// Invalid JSON is refused before account actions. These checks use no member
// credentials and cannot create an account, send recovery mail or change a password.
for (const [path, method] of [
  ['/api/v1/auth/login', 'POST'],
  ['/api/v1/auth/register', 'POST'],
  ['/api/v1/auth/password-reset', 'POST'],
  ['/api/v1/auth/password-reset', 'PUT'],
] as const) {
  test(`${method} ${path} rejects malformed JSON safely`, async ({
    request,
  }) => {
    const response = await request.fetch(path, {
      method,
      headers: {
        'Content-Type': 'application/json',
      },
      // Pass bytes: Playwright JSON-encodes a string with this content type.
      data: Buffer.from('synthetic-request-validation'),
    });
    expect(response.status()).toBe(400);
    expect(await response.json()).toEqual({
      error: {
        code: 'bad_request',
        message: 'Request body must contain valid JSON.',
      },
    });
  });
}

test('anonymous malformed publish requests remain forbidden', async ({
  request,
}) => {
  const response = await request.post(
    '/api/v1/admin/reports/00000000-0000-4000-8000-000000000000/publish',
    {
      headers: { 'Content-Type': 'application/json' },
      data: Buffer.from('{"scheduledAt":'),
    },
  );
  expect(response.status()).toBe(403);
});
