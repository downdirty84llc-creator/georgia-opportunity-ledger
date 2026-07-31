-- ---------------------------------------------------------------------------
-- 0023 — Record the Stripe product behind each plan
--
-- The price ids were enough to start a checkout, but not enough to answer
-- "which plan is this?" when a webhook arrives carrying only a product. Prices
-- are also immutable in Stripe: changing an amount means minting a new price,
-- at which point the product id is the only stable link between a Stripe
-- object and a row in this table.
--
-- Populated per environment by `npm run stripe:setup`, never committed — a
-- price or product id is only meaningful in the mode that minted it.
-- ---------------------------------------------------------------------------

alter table public.subscription_plans
  add column if not exists stripe_product_id text;

comment on column public.subscription_plans.stripe_product_id is
  'Stripe product id for this plan in the current environment''s mode. Test '
  'and live ids differ; run scripts/stripe-setup.ts per environment.';

-- One plan per Stripe product. Without this, two plans could point at the same
-- product and a webhook lookup would be ambiguous in a way nothing else checks.
create unique index if not exists subscription_plans_stripe_product_idx
  on public.subscription_plans (stripe_product_id)
  where stripe_product_id is not null;
