import { createAdminClient } from '@/lib/db/admin';
import {
  mintUnsubscribeToken,
  type UnsubscribeScope,
} from '@/lib/email/unsubscribe';
import { unsubscribeTokenHash } from '@/lib/email/unsubscribe-registry';
import type { JobDefinition } from '@/lib/jobs/runner';

const SCOPES: readonly UnsubscribeScope[] = ['alerts', 'marketing', 'all'];
const PAGE_SIZE = 200;

/** Operator-invoked before a signing key is replaced; it never sends email. */
export const checkpointUnsubscribeTokensJob: JobDefinition = {
  name: 'checkpoint-unsubscribe-tokens',
  description:
    'Preserves existing unsubscribe links before a hosting or signing-key change.',
  handler: async (context) => {
    const client = createAdminClient();
    const signer = unsubscribeTokenHash(
      mintUnsubscribeToken('00000000-0000-0000-0000-000000000000'),
    );
    const previous = context.state ?? {};
    let after =
      previous.signer === signer &&
      previous.complete !== true &&
      typeof previous.after === 'string'
        ? previous.after
        : '';
    let processed = 0;
    const deadline = context.deadlineAt ?? Date.now() + 25_000;
    while (Date.now() < deadline - 5_000) {
      let query = client
        .from('profiles')
        .select('id')
        .order('id')
        .limit(PAGE_SIZE);
      if (after) query = query.gt('id', after);
      const { data, error } = await query;
      if (error) throw new Error('Could not load unsubscribe recovery page.');
      const profiles = (data ?? []) as { id: string }[];
      if (profiles.length) {
        const rows = profiles.flatMap(({ id }) =>
          SCOPES.map((scope) => ({
            token_hash: unsubscribeTokenHash(mintUnsubscribeToken(id, scope)),
            user_id: id,
            scope,
          })),
        );
        const { error: writeError } = await client
          .from('email_unsubscribe_tokens')
          .upsert(rows, { onConflict: 'token_hash', ignoreDuplicates: true });
        if (writeError)
          throw new Error('Could not checkpoint unsubscribe links.');
        after = profiles.at(-1)?.id ?? after;
        processed += profiles.length;
      }
      const complete = profiles.length < PAGE_SIZE;
      await context.checkpoint?.({ signer, after, complete });
      if (complete)
        return {
          processed,
          failed: 0,
          detail: { complete: true, scopesPerProfile: SCOPES.length },
        };
    }
    return {
      processed,
      failed: 0,
      detail: { complete: false, scopesPerProfile: SCOPES.length },
    };
  },
};
