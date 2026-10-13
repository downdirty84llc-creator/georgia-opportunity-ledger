import { createAdminClient } from '@/lib/db/admin';
import { BillingConflict } from '@/lib/billing/plan-change';

interface Operation {
  id: string;
  lease_token: string;
  created_at: string;
}

/** Call only after authenticating the member; userId must come from the session. */
export async function billingOperation<T>(
  userId: string,
  kind: 'checkout' | 'change_plan' | 'cancel',
  payload: Record<string, unknown>,
  handler: (operation: Operation) => Promise<T>,
): Promise<T> {
  const db = createAdminClient();
  const { data, error } = await db.rpc('begin_billing_operation', {
    p_user_id: userId,
    p_kind: kind,
    p_payload: payload,
  });
  if (error) {
    if (error.code === 'P0001') throw new BillingConflict(error.message);
    throw new Error(error.message);
  }
  const operation = data as Operation;
  if (!operation?.id) throw new Error('Could not reserve billing operation');
  const finish = async (state: string, result: unknown) => {
    const response = await db.rpc('finish_billing_operation', {
      p_id: operation.id,
      p_token: operation.lease_token,
      p_state: state,
      p_result: result,
    });
    if (response.error || response.data !== true)
      throw new Error('Could not record billing operation outcome');
  };
  try {
    const result = await handler(operation);
    await finish('succeeded', result);
    return result;
  } catch (error) {
    // Only an explicit business refusal is known not to have mutated Stripe.
    // Network errors and crashes retain the operation and all idempotency keys.
    await finish(error instanceof BillingConflict ? 'failed' : 'pending', {
      message:
        error instanceof Error ? error.message : 'Provider request failed',
    });
    throw error;
  }
}
