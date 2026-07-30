-- ---------------------------------------------------------------------------
-- 0001 — Extensions and enumerated types
--
-- Every enum in the product specification is declared here so that later
-- migrations can reference them without ordering hazards. All timestamps in the
-- system are `timestamptz` and are stored in UTC.
-- ---------------------------------------------------------------------------

create extension if not exists "pgcrypto" with schema extensions;
create extension if not exists "pg_trgm" with schema extensions;
create extension if not exists "btree_gin" with schema extensions;

-- Optional: enables radius / bounding-box search on opportunities. The schema
-- degrades gracefully when PostGIS is unavailable (see 0013 for the fallback
-- lat/long btree index).
do $$
begin
  create extension if not exists "postgis" with schema extensions;
exception
  when others then
    raise notice 'PostGIS unavailable; geospatial search will use lat/long btree indexes';
end;
$$;

-- --- People ----------------------------------------------------------------

create type public.user_role as enum (
  'visitor',
  'member',
  'researcher',
  'reviewer',
  'editor',
  'support_representative',
  'billing_manager',
  'super_administrator'
);

create type public.account_status as enum ('active', 'suspended', 'closed');

create type public.primary_user_type as enum (
  'business_owner',
  'investor',
  'contractor',
  'developer',
  'adviser',
  'commercial_property_professional',
  'other'
);

create type public.delivery_frequency as enum (
  'immediate',
  'daily',
  'weekly',
  'biweekly',
  'monthly',
  'never'
);

-- --- Billing ---------------------------------------------------------------

create type public.billing_interval as enum ('monthly', 'annual');

create type public.subscription_status as enum (
  'free',
  'trialing',
  'active',
  'past_due',
  'unpaid',
  'paused',
  'canceled',
  'incomplete',
  'expired'
);

-- --- Sources ---------------------------------------------------------------

create type public.source_type as enum (
  'government',
  'public_record',
  'authorized_listing',
  'licensed_data',
  'manual_research',
  'economic_data',
  'development_authority',
  'financial_institution',
  'restricted_source'
);

create type public.update_frequency as enum (
  'realtime',
  'daily',
  'weekly',
  'biweekly',
  'monthly',
  'quarterly',
  'annually',
  'irregular'
);

create type public.scraping_review_status as enum (
  'not_reviewed',
  'permitted',
  'permitted_with_limits',
  'manual_only',
  'prohibited'
);

create type public.source_check_status as enum (
  'ok',
  'changed',
  'unreachable',
  'access_denied',
  'terms_changed',
  'retired'
);

-- --- Opportunities ---------------------------------------------------------

create type public.opportunity_category as enum (
  'commercial_property',
  'business_funding',
  'procurement',
  'tax_incentive',
  'market_intelligence',
  'development_project',
  'other'
);

create type public.opportunity_status as enum (
  'open',
  'upcoming',
  'closing_soon',
  'under_review',
  'updated',
  'closed',
  'expired',
  'withdrawn',
  'information_only'
);

create type public.workflow_status as enum (
  'draft',
  'source_collected',
  'verification_pending',
  'analysis_pending',
  'internal_review',
  'approved',
  'scheduled',
  'published',
  'updated',
  'expired',
  'archived'
);

create type public.score_classification as enum (
  'immediate_action',
  'strong_opportunity',
  'worth_investigating',
  'limited_or_specialized',
  'information_only'
);

create type public.verification_status as enum (
  'unverified',
  'pending',
  'verified',
  'reverification_due',
  'failed',
  'retired'
);

-- --- Property --------------------------------------------------------------

create type public.property_type as enum (
  'industrial',
  'warehouse',
  'flex',
  'retail',
  'office',
  'land',
  'mixed_use',
  'hospitality',
  'multifamily',
  'special_purpose',
  'other'
);

create type public.sale_type as enum (
  'standard_listing',
  'auction',
  'tax_sale',
  'sheriff_sale',
  'foreclosure',
  'bank_owned',
  'government_sale',
  'development_authority',
  'distressed_sale',
  'off_market_indication'
);

-- --- Funding ---------------------------------------------------------------

create type public.funding_type as enum (
  'grant',
  'direct_loan',
  'guaranteed_loan',
  'microloan',
  'tax_credit',
  'tax_incentive',
  'equity_program',
  'competition',
  'government_contract',
  'procurement_opportunity',
  'technical_assistance',
  'workforce_funding',
  'export_assistance',
  'other'
);

create type public.application_complexity as enum (
  'low',
  'moderate',
  'high',
  'very_high'
);

-- --- Market data -----------------------------------------------------------

create type public.market_category as enum (
  'construction_cost',
  'materials',
  'commercial_rent',
  'vacancy',
  'interest_rate',
  'lending',
  'labor',
  'fuel',
  'freight',
  'utility',
  'insurance',
  'permit_activity',
  'economic_development'
);

create type public.trend_direction as enum ('up', 'down', 'flat', 'volatile');

-- --- Member activity -------------------------------------------------------

create type public.saved_status as enum (
  'reviewing',
  'contacted_source',
  'documents_requested',
  'lender_review',
  'legal_review',
  'site_visit',
  'application_started',
  'bid_planned',
  'not_pursuing',
  'completed'
);

create type public.alert_type as enum (
  'high_score',
  'material_update',
  'closing_soon',
  'saved_search_match',
  'weekly_report',
  'premium_briefing',
  'deadline_reminder',
  'account',
  'billing'
);

create type public.delivery_method as enum ('email', 'in_app', 'sms', 'webhook');

create type public.delivery_status as enum (
  'queued',
  'sent',
  'delivered',
  'opened',
  'bounced',
  'complained',
  'failed',
  'suppressed'
);

create type public.notification_type as enum (
  'opportunity_alert',
  'material_update',
  'deadline_reminder',
  'report_published',
  'saved_search_match',
  'account_notice',
  'billing_notice',
  'correction_published'
);

-- --- Reports ---------------------------------------------------------------

create type public.report_type as enum (
  'weekly',
  'monthly',
  'special',
  'pricing',
  'premium_briefing',
  'sample'
);

create type public.report_status as enum (
  'draft',
  'internal_review',
  'approved',
  'scheduled',
  'published',
  'archived'
);

create type public.report_section_type as enum (
  'executive_summary',
  'market_commentary',
  'property_highlights',
  'funding_highlights',
  'pricing_indicators',
  'deadline_calendar',
  'methodology',
  'disclaimer',
  'custom'
);

-- --- Support ---------------------------------------------------------------

create type public.support_category as enum (
  'account',
  'billing',
  'technical',
  'content_question',
  'data_correction',
  'accessibility',
  'privacy_request',
  'other'
);

create type public.support_priority as enum ('low', 'normal', 'high', 'urgent');

create type public.support_status as enum (
  'open',
  'awaiting_customer',
  'awaiting_internal',
  'resolved',
  'closed'
);

create type public.correction_status as enum (
  'submitted',
  'under_review',
  'accepted',
  'rejected',
  'published'
);

-- --- Exports and jobs ------------------------------------------------------

create type public.export_status as enum (
  'queued',
  'processing',
  'ready',
  'failed',
  'expired'
);

create type public.export_format as enum ('csv', 'xlsx', 'pdf');

create type public.job_status as enum (
  'queued',
  'running',
  'succeeded',
  'failed',
  'skipped'
);
