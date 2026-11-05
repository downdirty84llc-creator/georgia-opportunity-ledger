import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({
  construct: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  existing: vi.fn(),
  failReview: false,
}));
vi.mock('@/lib/billing/stripe', () => ({
  stripe: () => ({ webhooks: { constructEvent: m.construct } }),
}));
vi.mock('@/lib/env', () => ({
  serverEnv: () => ({ stripeWebhookSecret: 'test-only' }),
}));
vi.mock('@/lib/db/admin', () => ({
  createAdminClient: () => ({
    from: () => ({
      insert: m.insert,
      select: () => ({ eq: () => ({ maybeSingle: m.existing }) }),
      update: m.update,
    }),
  }),
}));
import { POST } from '@/app/api/v1/webhooks/stripe/route';
const request = () =>
  new Request('https://ledger.example/api/v1/webhooks/stripe', {
    method: 'POST',
    headers: { 'stripe-signature': 'test-signature' },
    body: '{}',
  });
beforeEach(() => {
  vi.clearAllMocks();
  m.failReview = false;
  m.construct.mockReturnValue({
    id: 'evt_risk',
    type: 'charge.refunded',
    livemode: false,
    data: {
      object: {
        object: 'charge',
        id: 'ch_risk',
        payment_intent: null,
        customer: 'cus_risk',
        refunded: true,
        amount_refunded: 1500,
        currency: 'usd',
      },
    },
  });
  m.insert.mockResolvedValue({ error: null });
  m.existing.mockResolvedValue({
    data: { processed: false, attempt_count: 2 },
    error: null,
  });
  m.update.mockImplementation((values: Record<string, unknown>) => ({
    eq: async () => ({
      error:
        m.failReview && values.review_context
          ? { message: 'save failed' }
          : null,
    }),
  }));
});
describe('risk webhook delivery', () => {
  it('marks the incoming event for review and completes processing', async () => {
    expect((await POST(request())).status).toBe(200);
    expect(m.insert).toHaveBeenCalledWith(
      expect.objectContaining({ review_required: true, processed: false }),
    );
    expect(m.update).toHaveBeenCalledWith(
      expect.objectContaining({
        review_context: expect.objectContaining({ detail: 'Full refund' }),
      }),
    );
    expect(m.update).toHaveBeenCalledWith(
      expect.objectContaining({ processed: true, processing_error: null }),
    );
  });
  it('returns 500 on review failure then reprocesses the same recorded event', async () => {
    m.failReview = true;
    expect((await POST(request())).status).toBe(500);
    expect(m.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ processed: true }),
    );
    m.failReview = false;
    m.insert.mockResolvedValue({ error: { code: '23505' } });
    expect((await POST(request())).status).toBe(200);
    expect(m.update).toHaveBeenCalledWith(
      expect.objectContaining({ processed: true, processing_error: null }),
    );
  });
  it('acknowledges completed duplicates without rewriting the review', async () => {
    m.insert.mockResolvedValue({ error: { code: '23505' } });
    m.existing.mockResolvedValue({ data: { processed: true }, error: null });
    expect(await (await POST(request())).json()).toEqual({
      received: true,
      duplicate: true,
    });
    expect(m.update).not.toHaveBeenCalled();
  });
});
