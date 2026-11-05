import { createHash } from 'node:crypto';
import { createAdminClient } from '@/lib/db/admin';
import {
  parseUnsubscribeClaim,
  verifyUnsubscribeToken,
  type UnsubscribeClaim,
} from '@/lib/email/unsubscribe';

export function unsubscribeTokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function resolveUnsubscribeToken(
  token: string,
): Promise<UnsubscribeClaim | null> {
  const claim = parseUnsubscribeClaim(token);
  if (!claim) return null;
  if (verifyUnsubscribeToken(token)) return claim;
  const { data, error } = await createAdminClient()
    .from('email_unsubscribe_tokens')
    .select('user_id,scope')
    .eq('token_hash', unsubscribeTokenHash(token))
    .maybeSingle();
  if (error) throw new Error('Unsubscribe token recovery is unavailable.');
  if (data?.user_id !== claim.userId || data?.scope !== claim.scope)
    return null;
  return claim;
}

/** Complete this write before any external send or durable queue insertion. */
export async function rememberUnsubscribeToken(token: string): Promise<void> {
  const claim = await resolveUnsubscribeToken(token);
  if (!claim) throw new Error('Cannot send an invalid unsubscribe token.');
  const { error } = await createAdminClient()
    .from('email_unsubscribe_tokens')
    .upsert(
      {
        token_hash: unsubscribeTokenHash(token),
        user_id: claim.userId,
        scope: claim.scope,
      },
      { onConflict: 'token_hash', ignoreDuplicates: true },
    );
  if (error) throw new Error('Could not preserve the unsubscribe link.');
}
