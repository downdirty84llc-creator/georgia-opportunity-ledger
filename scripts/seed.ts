/* eslint-disable no-console */
/**
 * Demo data seeder (spec 27).
 *
 * Run with `npm run db:seed` against a database that has already been migrated
 * and loaded with supabase/seed.sql (which supplies plans, geography,
 * industries, sources and indicators). This script adds the parts that need
 * the Auth admin API or realistic prose:
 *
 *   - one member for every subscription tier and one user for every staff role
 *   - twenty commercial-property and twenty funding sample opportunities
 *   - observations for the market indicators
 *   - three sample reports
 *
 * Everything written here is flagged `is_sample = true` so it can be excluded
 * from production analytics and badged in the UI. The script is idempotent:
 * users are matched by email and records by slug, so re-running updates rather
 * than duplicates.
 *
 * Refuses to run against production.
 */

import { createClient } from '@supabase/supabase-js';

import {
  buildScore,
  scoreAccessibility,
  scoreCapitalRequirement,
  scoreComplexity,
  scoreFinancialValue,
  scoreRisk,
  scoreSourceReliability,
  scoreTimeSensitivity,
  type ComplexityLevel,
  type RiskLevel,
} from '../src/lib/scoring/score';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ENVIRONMENT = process.env.NEXT_PUBLIC_ENVIRONMENT ?? 'development';

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error(
    'NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.',
  );
  process.exit(1);
}
if (ENVIRONMENT === 'production') {
  console.error('Refusing to load sample data into production.');
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const SEED_PASSWORD = process.env.SEED_PASSWORD ?? 'ledger-demo-password-2026';

// --- Users ------------------------------------------------------------------

interface SeedUser {
  email: string;
  firstName: string;
  lastName: string;
  role:
    | 'member'
    | 'researcher'
    | 'reviewer'
    | 'editor'
    | 'support_representative'
    | 'billing_manager'
    | 'super_administrator';
  planCode: 'free' | 'weekly' | 'detailed' | 'premium';
}

const SEED_USERS: SeedUser[] = [
  {
    email: 'free.member@example.com',
    firstName: 'Frankie',
    lastName: 'Free',
    role: 'member',
    planCode: 'free',
  },
  {
    email: 'weekly.member@example.com',
    firstName: 'Wendy',
    lastName: 'Weeks',
    role: 'member',
    planCode: 'weekly',
  },
  {
    email: 'detailed.member@example.com',
    firstName: 'Dana',
    lastName: 'Detail',
    role: 'member',
    planCode: 'detailed',
  },
  {
    email: 'premium.member@example.com',
    firstName: 'Priya',
    lastName: 'Prime',
    role: 'member',
    planCode: 'premium',
  },
  {
    email: 'researcher@example.com',
    firstName: 'Ravi',
    lastName: 'Records',
    role: 'researcher',
    planCode: 'free',
  },
  {
    email: 'reviewer@example.com',
    firstName: 'Renee',
    lastName: 'Review',
    role: 'reviewer',
    planCode: 'free',
  },
  {
    email: 'editor@example.com',
    firstName: 'Eddie',
    lastName: 'Editor',
    role: 'editor',
    planCode: 'free',
  },
  {
    email: 'support@example.com',
    firstName: 'Sam',
    lastName: 'Support',
    role: 'support_representative',
    planCode: 'free',
  },
  {
    email: 'billing@example.com',
    firstName: 'Blair',
    lastName: 'Billing',
    role: 'billing_manager',
    planCode: 'free',
  },
  {
    email: 'admin@example.com',
    firstName: 'Ada',
    lastName: 'Admin',
    role: 'super_administrator',
    planCode: 'free',
  },
];

async function findUserByEmail(email: string): Promise<string | null> {
  const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  return data?.users.find((user) => user.email === email)?.id ?? null;
}

async function seedUsers(): Promise<Map<string, string>> {
  const ids = new Map<string, string>();

  for (const user of SEED_USERS) {
    let id = await findUserByEmail(user.email);
    if (!id) {
      const { data, error } = await admin.auth.admin.createUser({
        email: user.email,
        password: SEED_PASSWORD,
        email_confirm: true,
        user_metadata: {
          first_name: user.firstName,
          last_name: user.lastName,
        },
      });
      if (error || !data.user) {
        console.error(`  ✗ could not create ${user.email}: ${error?.message}`);
        continue;
      }
      id = data.user.id;
    }
    ids.set(user.email, id);

    // The profile row is created by trigger; set role and mark as sample.
    const { error: profileError } = await admin
      .from('profiles')
      .update({
        role: user.role,
        is_sample: true,
        onboarding_complete: true,
        terms_accepted_at: new Date().toISOString(),
        privacy_accepted_at: new Date().toISOString(),
      })
      .eq('id', id);
    if (profileError) {
      console.error(`  ✗ profile for ${user.email}: ${profileError.message}`);
    }

    // Point the subscription at the right plan. No Stripe ids: these accounts
    // exercise access logic, not billing.
    const { data: plan } = await admin
      .from('subscription_plans')
      .select('id, access_rank')
      .eq('code', user.planCode)
      .single();

    if (plan) {
      const paid = plan.access_rank > 0;
      const { error: subscriptionError } = await admin
        .from('subscriptions')
        .update({
          plan_id: plan.id,
          status: paid ? 'active' : 'free',
          billing_interval: 'monthly',
          current_period_start: paid ? new Date().toISOString() : null,
          current_period_end: paid
            ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
            : null,
        })
        .eq('user_id', id);
      if (subscriptionError) {
        console.error(
          `  ✗ subscription for ${user.email}: ${subscriptionError.message}`,
        );
      }
    }

    console.log(`  ✓ ${user.email} (${user.role}, ${user.planCode})`);
  }

  return ids;
}

// --- Opportunities ----------------------------------------------------------

interface LookupTables {
  counties: Map<string, string>;
  cities: Map<string, string>;
  industries: Map<string, string>;
  sources: Map<string, string>;
  stateId: string;
}

async function loadLookups(): Promise<LookupTables> {
  const [counties, cities, industries, sources, state] = await Promise.all([
    admin.from('counties').select('id, slug'),
    admin.from('cities').select('id, slug'),
    admin.from('industries').select('id, slug'),
    admin.from('sources').select('id, name'),
    admin.from('states').select('id').eq('abbreviation', 'GA').single(),
  ]);

  return {
    counties: new Map((counties.data ?? []).map((row) => [row.slug, row.id])),
    cities: new Map((cities.data ?? []).map((row) => [row.slug, row.id])),
    industries: new Map(
      (industries.data ?? []).map((row) => [row.slug, row.id]),
    ),
    sources: new Map((sources.data ?? []).map((row) => [row.name, row.id])),
    stateId: state.data?.id ?? '',
  };
}

interface PropertySeed {
  slug: string;
  title: string;
  county: string;
  city?: string;
  summary: string;
  propertyType: string;
  saleType: string;
  askingPrice?: number;
  startingBid?: number;
  buildingSqft?: number;
  lotAcres?: number;
  zoning?: string;
  capitalMin: number;
  estimatedMin: number;
  estimatedMax: number;
  daysToClose: number | null;
  complexity: ComplexityLevel;
  risk: RiskLevel;
  riskSummary: string;
  nextAction: string;
  industry?: string;
}

// Twenty realistic-but-fictional commercial property examples (spec 27).
const PROPERTY_SEEDS: PropertySeed[] = [
  {
    slug: 'sample-macon-distribution-warehouse-tax-sale',
    title: 'SAMPLE: 84,000 sq ft distribution warehouse — Bibb County tax sale',
    county: 'bibb',
    city: 'macon',
    summary:
      'A mid-1980s tilt-wall distribution building on 6.1 acres near the I-75/I-16 interchange, listed for the county tax sale after three years of delinquency. Dock-high doors on two sides, 24-foot clear height, and rail spur access that has not been used since 2019. The delinquency amount is a fraction of assessed value, which is what makes tax sales worth watching — but Georgia redemption rules apply and possession is not immediate.',
    propertyType: 'warehouse',
    saleType: 'tax_sale',
    startingBid: 210_000,
    buildingSqft: 84_000,
    lotAcres: 6.1,
    zoning: 'I-2',
    capitalMin: 210_000,
    estimatedMin: 1_400_000,
    estimatedMax: 1_900_000,
    daysToClose: 21,
    complexity: 'high',
    risk: 'high',
    riskSummary:
      'Tax-sale title with a twelve-month redemption right: the delinquent owner can reclaim by paying the bid plus premium. Two recorded liens survive per the county docket. Roof age is unknown; budget for replacement. No interior access before sale.',
    nextAction:
      'Pull the full lien docket from the Bibb County Superior Court clerk, then order a title search before registering to bid. Registration closes ten days before the sale.',
    industry: 'logistics-and-warehousing',
  },
  {
    slug: 'sample-savannah-flex-portfolio-bank-owned',
    title:
      'SAMPLE: Three-building flex portfolio near Savannah port — bank owned',
    county: 'chatham',
    city: 'garden-city',
    summary:
      'A lender-owned portfolio of three small flex buildings totalling 41,000 sq ft, two miles from the Garden City terminal gates. Occupancy is 55% on short leases, which is the problem and the opportunity: port-adjacent flex space leases quickly when actively managed, and the seller is a bank that wants it gone this quarter.',
    propertyType: 'flex',
    saleType: 'bank_owned',
    askingPrice: 2_950_000,
    buildingSqft: 41_000,
    lotAcres: 4.2,
    zoning: 'PDI',
    capitalMin: 600_000,
    estimatedMin: 3_600_000,
    estimatedMax: 4_300_000,
    daysToClose: 45,
    complexity: 'moderate',
    risk: 'moderate',
    riskSummary:
      'Deferred maintenance on two roofs, and one tenant is month-to-month at 40% of the rent roll. Bank sale is as-is with a tight diligence window.',
    nextAction:
      'Request the rent roll and the two newest leases, then walk all three buildings with a roofing contractor before offering.',
    industry: 'logistics-and-warehousing',
  },
  {
    slug: 'sample-columbus-downtown-retail-development-authority',
    title: 'SAMPLE: Downtown Columbus retail block — development authority RFP',
    county: 'muscogee',
    city: 'columbus',
    summary:
      'The downtown development authority is seeking proposals for a city-owned block of four contiguous storefronts on Broadway, offered on a long ground lease with facade grant support. Proposals are scored on activation plan, local hiring and timeline rather than price alone — a genuine opening for an operator without acquisition capital.',
    propertyType: 'retail',
    saleType: 'development_authority',
    buildingSqft: 18_500,
    zoning: 'CBD',
    capitalMin: 150_000,
    estimatedMin: 900_000,
    estimatedMax: 1_500_000,
    daysToClose: 38,
    complexity: 'high',
    risk: 'moderate',
    riskSummary:
      'Ground lease, not fee ownership; the authority retains approval over use changes. Facade grant reimburses after completion, so construction is financed up front. Historic-district review adds time.',
    nextAction:
      'Attend the pre-proposal walkthrough (attendance is mandatory to bid) and request the draft ground-lease terms before writing the activation plan.',
    industry: 'retail-and-consumer',
  },
  {
    slug: 'sample-gainesville-poultry-processing-expansion-site',
    title: 'SAMPLE: 22-acre certified industrial site — Hall County',
    county: 'hall',
    city: 'gainesville',
    summary:
      'A state-certified shovel-ready industrial site with water, sewer and three-phase power at the boundary, marketed by the county development authority with a published incentive schedule tied to job creation. Flat topography, no wetlands on the Phase 1, and forty minutes from the poultry-processing cluster it logically serves.',
    propertyType: 'land',
    saleType: 'standard_listing',
    askingPrice: 1_650_000,
    lotAcres: 22,
    zoning: 'HI',
    capitalMin: 330_000,
    estimatedMin: 1_650_000,
    estimatedMax: 2_400_000,
    daysToClose: null,
    complexity: 'low',
    risk: 'low',
    riskSummary:
      'Little execution risk on the land itself; the risk is incentive-dependence — the published abatement schedule requires 50 jobs within three years, with clawback.',
    nextAction:
      'Request the certification file and the incentive term sheet from the development authority; both are public on request.',
    industry: 'food-and-beverage-production',
  },
  {
    slug: 'sample-augusta-medical-office-sheriff-sale',
    title: 'SAMPLE: Medical office condo, Augusta — sheriff sale',
    county: 'richmond',
    city: 'augusta',
    summary:
      'A 6,200 sq ft medical office condominium two blocks from the hospital district, going to sheriff sale on a foreclosure judgment. Built out for a four-provider practice with plumbing in six exam rooms. Sheriff sales convey faster than tax sales in Georgia, but the association arrears survive and must be cleared.',
    propertyType: 'office',
    saleType: 'sheriff_sale',
    startingBid: 385_000,
    buildingSqft: 6_200,
    zoning: 'P-1',
    capitalMin: 385_000,
    estimatedMin: 720_000,
    estimatedMax: 850_000,
    daysToClose: 14,
    complexity: 'moderate',
    risk: 'elevated',
    riskSummary:
      'Condo association arrears of record survive the sale. The judgment creditor may bid the debt. No interior inspection; the build-out condition is inferred from a 2024 listing.',
    nextAction:
      'Confirm the arrears figure with the association manager and set a hard maximum bid that clears title, arrears and a refit contingency.',
    industry: 'healthcare-and-life-sciences',
  },
  {
    slug: 'sample-valdosta-hotel-conversion-distressed',
    title: 'SAMPLE: 92-key exterior-corridor hotel, Valdosta — distressed sale',
    county: 'lowndes',
    city: 'valdosta',
    summary:
      'A 1990s exterior-corridor hotel on the I-75 corridor, offered by a special servicer below replacement cost. The realistic play is not hospitality: the floor plate suits workforce-housing conversion, and Valdosta has an adopted ordinance that permits it by right in this zone.',
    propertyType: 'hospitality',
    saleType: 'distressed_sale',
    askingPrice: 2_100_000,
    buildingSqft: 38_000,
    lotAcres: 2.8,
    zoning: 'C-H',
    capitalMin: 550_000,
    estimatedMin: 2_100_000,
    estimatedMax: 3_800_000,
    daysToClose: 60,
    complexity: 'very_high',
    risk: 'high',
    riskSummary:
      'Conversion cost is the whole question: plumbing risers, kitchens and code compliance routinely double naive budgets. Servicer sells as-is with no representations. Flagged franchise agreement must be terminated at cost.',
    nextAction:
      'Commission a conversion feasibility study before offering; the ordinance text and parking requirement are the first two documents to read.',
    industry: 'hospitality-and-tourism',
  },
  {
    slug: 'sample-albany-cold-storage-government-sale',
    title:
      'SAMPLE: Former USDA cold-storage facility, Albany — federal disposal',
    county: 'dougherty',
    city: 'albany',
    summary:
      'A federal surplus disposal of a 26,000 sq ft cold-storage and inspection facility, offered by online auction through the GSA process. Ammonia refrigeration decommissioned but racking and dock equipment remain. Federal disposals are slow and procedural, and that procedure is exactly why they clear below market.',
    propertyType: 'special_purpose',
    saleType: 'government_sale',
    startingBid: 425_000,
    buildingSqft: 26_000,
    lotAcres: 3.5,
    zoning: 'I-1',
    capitalMin: 425_000,
    estimatedMin: 900_000,
    estimatedMax: 1_300_000,
    daysToClose: 30,
    complexity: 'high',
    risk: 'moderate',
    riskSummary:
      'Refrigeration plant condition unknown; recommissioning ammonia systems requires certified contractors and regulatory notice. Federal deed carries a use covenant for five years.',
    nextAction:
      'Register on the auction platform early — registration verification takes days — and order a refrigeration survey during the inspection window.',
    industry: 'food-and-beverage-production',
  },
  {
    slug: 'sample-marietta-mixed-use-off-market',
    title:
      'SAMPLE: Marietta square-adjacent mixed-use building — off-market indication',
    county: 'cobb',
    city: 'marietta',
    summary:
      'An estate is preparing to sell a three-storey mixed-use building one block off Marietta Square: two retail bays, four apartments, all occupied. Not listed; the indication comes from the probate filing, which is public record. Off-market records are published here when the underlying document is public and verifiable.',
    propertyType: 'mixed_use',
    saleType: 'off_market_indication',
    buildingSqft: 12_400,
    zoning: 'CBD',
    capitalMin: 400_000,
    estimatedMin: 1_600_000,
    estimatedMax: 2_000_000,
    daysToClose: null,
    complexity: 'moderate',
    risk: 'moderate',
    riskSummary:
      'Probate timelines slip, and the executor has no obligation to sell to anyone. Rents are reportedly below market, which cuts both ways: upside, and sitting tenants.',
    nextAction:
      'Contact the estate’s counsel of record (named in the filing) with a credible, financeable expression of interest. Be early and be patient.',
    industry: 'retail-and-consumer',
  },
  {
    slug: 'sample-dalton-industrial-foreclosure',
    title: 'SAMPLE: 120,000 sq ft former flooring plant, Dalton — foreclosure',
    county: 'whitfield',
    city: 'dalton',
    summary:
      'A first-generation flooring manufacturing plant scheduled for non-judicial foreclosure. Heavy power (4,000A), sprinklered throughout, and ceiling heights that limit modern racking in half the footprint. Priced by the debt, not the market — the opening bid is the loan balance.',
    propertyType: 'industrial',
    saleType: 'foreclosure',
    startingBid: 1_850_000,
    buildingSqft: 120_000,
    lotAcres: 9.4,
    zoning: 'M-2',
    capitalMin: 1_850_000,
    estimatedMin: 3_000_000,
    estimatedMax: 4_200_000,
    daysToClose: 28,
    complexity: 'moderate',
    risk: 'elevated',
    riskSummary:
      'Foreclosure sales are cash on the courthouse steps with no diligence period after sale. Environmental history of flooring plants warrants a Phase 1 before, not after.',
    nextAction:
      'Order the Phase 1 now — there is just enough time before sale day — and confirm the payoff figure has not been cured.',
    industry: 'manufacturing',
  },
  {
    slug: 'sample-statesboro-student-housing-land-auction',
    title:
      'SAMPLE: 8.7 acres zoned multifamily near Georgia Southern — auction',
    county: 'bulloch',
    city: 'statesboro',
    summary:
      'An entitled multifamily site half a mile from campus, sold at absolute auction by a retiring owner — no reserve, which is rare for entitled land. Concept plan for 180 beds was approved in 2024 and remains valid if construction starts within the window.',
    propertyType: 'land',
    saleType: 'auction',
    lotAcres: 8.7,
    zoning: 'R-3',
    capitalMin: 250_000,
    estimatedMin: 850_000,
    estimatedMax: 1_400_000,
    daysToClose: 17,
    complexity: 'low',
    risk: 'moderate',
    riskSummary:
      'Absolute auction means it will sell — possibly above the number that makes the deal work. Entitlement expiry date must be verified with the city, not the auctioneer.',
    nextAction:
      'Verify the concept-plan expiry in writing with Statesboro planning, then set a walk-away number before auction day.',
    industry: 'construction-and-trades',
  },
  {
    slug: 'sample-brunswick-marine-industrial-lease-option',
    title:
      'SAMPLE: Waterfront marine-industrial yard, Brunswick — authority listing',
    county: 'glynn',
    city: 'brunswick',
    summary:
      'A ports-authority-adjacent marine industrial yard with 400 feet of bulkhead, offered on a long lease with option terms published in the authority minutes. Suits barge service, marine repair or heavy staging; deep-water access without deep-water acquisition cost.',
    propertyType: 'industrial',
    saleType: 'development_authority',
    lotAcres: 5.6,
    zoning: 'BI',
    capitalMin: 120_000,
    estimatedMin: 600_000,
    estimatedMax: 1_100_000,
    daysToClose: 44,
    complexity: 'moderate',
    risk: 'moderate',
    riskSummary:
      'Leasehold, with authority consent required for sublease. Bulkhead condition report is three years old. Flood insurance is a real operating cost here.',
    nextAction:
      'Request the current bulkhead inspection and the standard lease form from the authority before the proposal deadline.',
    industry: 'logistics-and-warehousing',
  },
  {
    slug: 'sample-mcdonough-last-mile-warehouse',
    title:
      'SAMPLE: 62,000 sq ft last-mile warehouse, Henry County — bank owned',
    county: 'henry',
    city: 'mcdonough',
    summary:
      'A 2007 rear-load warehouse on the south metro logistics corridor, bank-owned after a tenant default cascaded into the owner’s loan. Vacant, broom-clean, and in the tightest last-mile submarket in the state. The lender has priced it to move before year-end.',
    propertyType: 'warehouse',
    saleType: 'bank_owned',
    askingPrice: 4_650_000,
    buildingSqft: 62_000,
    lotAcres: 5.9,
    zoning: 'M-1',
    capitalMin: 950_000,
    estimatedMin: 5_400_000,
    estimatedMax: 6_200_000,
    daysToClose: 50,
    complexity: 'low',
    risk: 'low',
    riskSummary:
      'Straightforward asset; the risk is competition — clean metro Atlanta warehouses attract multiple offers even from lenders.',
    nextAction:
      'Get proof of funds ready before touring; this submarket rewards speed over negotiation.',
    industry: 'logistics-and-warehousing',
  },
  {
    slug: 'sample-athens-restaurant-building-tax-sale',
    title: 'SAMPLE: Freestanding restaurant building, Athens — tax sale',
    county: 'clarke',
    city: 'athens',
    summary:
      'A freestanding 4,100 sq ft restaurant building with a drive-through window and grease infrastructure, on the county tax-sale list. Closed since 2023. Hood systems and walk-ins reportedly intact, which is most of the cost of a restaurant fit-out.',
    propertyType: 'retail',
    saleType: 'tax_sale',
    startingBid: 96_000,
    buildingSqft: 4_100,
    zoning: 'C-G',
    capitalMin: 96_000,
    estimatedMin: 450_000,
    estimatedMax: 620_000,
    daysToClose: 24,
    complexity: 'moderate',
    risk: 'high',
    riskSummary:
      'Redemption right applies. Equipment condition is unverified and equipment may be subject to separate security interests that survive.',
    nextAction:
      'Search UCC filings against the prior operator before valuing any equipment in your bid.',
    industry: 'hospitality-and-tourism',
  },
  {
    slug: 'sample-rome-office-campus-reposition',
    title: 'SAMPLE: Suburban office campus, Rome — distressed listing',
    county: 'floyd',
    city: 'rome',
    summary:
      'A 48,000 sq ft two-building office campus at 30% occupancy, offered below assessed value by an out-of-state owner exiting Georgia. The occupancy is the discount; the county’s health-system expansion two exits away is the thesis for refilling it.',
    propertyType: 'office',
    saleType: 'distressed_sale',
    askingPrice: 1_750_000,
    buildingSqft: 48_000,
    lotAcres: 6.3,
    zoning: 'O-I',
    capitalMin: 450_000,
    estimatedMin: 2_200_000,
    estimatedMax: 3_100_000,
    daysToClose: null,
    complexity: 'moderate',
    risk: 'elevated',
    riskSummary:
      'Office demand outside the medical use case is genuinely weak. HVAC plant is original. Underwrite to the two signed tenants, not the pro forma.',
    nextAction:
      'Meet the health system’s real-estate office before diligence — if they will not take space here, the thesis fails.',
    industry: 'professional-services',
  },
  {
    slug: 'sample-carrollton-self-storage-site',
    title:
      'SAMPLE: Entitled self-storage site, Carroll County — standard listing',
    county: 'carroll',
    city: 'carrollton',
    summary:
      'A 3.4-acre pad with approved site plan for 62,000 sq ft of climate-controlled self-storage, utilities stubbed, detention built. The entitlement work — usually eighteen months of risk — is done and transferable.',
    propertyType: 'land',
    saleType: 'standard_listing',
    askingPrice: 780_000,
    lotAcres: 3.4,
    zoning: 'C-2',
    capitalMin: 780_000,
    estimatedMin: 780_000,
    estimatedMax: 1_100_000,
    daysToClose: null,
    complexity: 'low',
    risk: 'moderate',
    riskSummary:
      'Storage supply in the trade area has grown 20% in three years; the feasibility study on offer is seller-commissioned and should be re-run independently.',
    nextAction:
      'Commission an independent storage feasibility study; everything else about this site is straightforward.',
    industry: 'construction-and-trades',
  },
  {
    slug: 'sample-tucker-flex-owner-user-sba',
    title: 'SAMPLE: 12,800 sq ft flex building, Tucker — owner-user candidate',
    county: 'dekalb',
    city: 'tucker',
    summary:
      'A single-tenant flex building sized exactly for an owner-user under SBA 504: 10% down, fixed-rate debenture, and the mortgage payment lands near the market rent. Listed conventionally, but published here because the financing math is the opportunity.',
    propertyType: 'flex',
    saleType: 'standard_listing',
    askingPrice: 1_980_000,
    buildingSqft: 12_800,
    zoning: 'M',
    capitalMin: 200_000,
    estimatedMin: 1_980_000,
    estimatedMax: 2_200_000,
    daysToClose: null,
    complexity: 'low',
    risk: 'low',
    riskSummary:
      'Low risk for a qualifying owner-user; the 51% owner-occupancy rule is the binding constraint, and 504 timelines run 60–90 days.',
    nextAction:
      'Get prequalified with a 504-active lender before offering, and write the timeline into the contract.',
    industry: 'manufacturing',
  },
  {
    slug: 'sample-forsyth-monroe-county-land-assemblage',
    title:
      'SAMPLE: I-75 interchange land assemblage — Monroe County tax parcels',
    county: 'monroe',
    summary:
      'Three adjacent unimproved parcels at an I-75 interchange, each separately tax-delinquent and headed for the same sale date. Individually they are remnants; assembled, they are a 14-acre interchange site. Assemblage through tax sale is slow-motion work with redemption risk on each piece — priced accordingly.',
    propertyType: 'land',
    saleType: 'tax_sale',
    startingBid: 74_000,
    lotAcres: 14.2,
    zoning: 'C-2',
    capitalMin: 74_000,
    estimatedMin: 500_000,
    estimatedMax: 900_000,
    daysToClose: 35,
    complexity: 'high',
    risk: 'high',
    riskSummary:
      'Three separate redemption clocks; redeeming any one parcel breaks the assemblage. Value shown assumes all three close and clear, which takes a year minimum.',
    nextAction:
      'Bid all three or none. Model the outcome where the middle parcel redeems, because that is the one the owner will fight for.',
    industry: 'construction-and-trades',
  },
  {
    slug: 'sample-warner-robins-daycare-build-to-suit',
    title: 'SAMPLE: Approved daycare site near Robins AFB — authority land',
    county: 'houston',
    city: 'warner-robins',
    summary:
      'The development authority is offering a pad site pre-approved for child-care use, half a mile from a base gate, with a below-market land lease for a licensed operator. Childcare capacity is the stated bottleneck in the county’s workforce plan, and the authority is pricing land to fix it.',
    propertyType: 'special_purpose',
    saleType: 'development_authority',
    lotAcres: 1.8,
    zoning: 'PUD',
    capitalMin: 350_000,
    estimatedMin: 1_200_000,
    estimatedMax: 1_600_000,
    daysToClose: 52,
    complexity: 'moderate',
    risk: 'low',
    riskSummary:
      'Operator licensing is the gating item and takes months; the lease requires operations to begin within 24 months.',
    nextAction:
      'Start the state licensing pre-application in parallel with the authority proposal — sequencing them serially wastes the schedule.',
    industry: 'professional-services',
  },
  {
    slug: 'sample-canton-mountain-retail-strip',
    title: 'SAMPLE: Six-bay retail strip, Cherokee County — estate sale',
    county: 'cherokee',
    city: 'canton',
    summary:
      'A fully occupied 1990s strip on the corridor into downtown Canton, sold by an estate that has owned it since construction. Rents are 25–35% below the corridor average because the family never raised them. The value-add is administrative, not physical.',
    propertyType: 'retail',
    saleType: 'standard_listing',
    askingPrice: 2_400_000,
    buildingSqft: 14_600,
    zoning: 'GC',
    capitalMin: 600_000,
    estimatedMin: 2_900_000,
    estimatedMax: 3_300_000,
    daysToClose: null,
    complexity: 'low',
    risk: 'low',
    riskSummary:
      'Leases are handshake-era documents with weak assignment language; estoppels will take longer than usual. Tenant goodwill is real and worth preserving.',
    nextAction:
      'Read every lease before pricing the upside; the below-market rents are only upside if the leases actually roll.',
    industry: 'retail-and-consumer',
  },
  {
    slug: 'sample-pooler-truck-terminal-surplus',
    title: 'SAMPLE: 40-door cross-dock terminal, Pooler — corporate surplus',
    county: 'chatham',
    city: 'pooler',
    summary:
      'A national carrier is disposing of a 40-door cross-dock made redundant by consolidation. Cross-docks are nearly impossible to entitle new in this submarket, which makes existing ones strategic regardless of age. Sealed-bid process with a published deadline.',
    propertyType: 'industrial',
    saleType: 'standard_listing',
    askingPrice: 3_800_000,
    buildingSqft: 28_000,
    lotAcres: 8.9,
    zoning: 'I-1',
    capitalMin: 800_000,
    estimatedMin: 4_100_000,
    estimatedMax: 4_800_000,
    daysToClose: 26,
    complexity: 'moderate',
    risk: 'low',
    riskSummary:
      'Sealed bid with no second round: the first number must be the best number. Pavement condition on the truck court is the main capital item.',
    nextAction:
      'Bid on the strength of a pavement survey and comparable terminal trades, not the list price.',
    industry: 'logistics-and-warehousing',
  },
];

interface FundingSeed {
  slug: string;
  title: string;
  county?: string;
  summary: string;
  fundingType: string;
  organization: string;
  minAmount?: number;
  maxAmount?: number;
  ownerContribution?: number;
  complexity: ComplexityLevel;
  daysToDeadline: number | null;
  firstCome?: boolean;
  industry?: string;
  industryRestricted?: boolean;
  revenueRequirement?: boolean;
  timeInBusiness?: boolean;
  risk: RiskLevel;
  riskSummary: string;
  nextAction: string;
  eligibility: string;
  source: string;
}

// Twenty realistic-but-fictional funding examples (spec 27).
const FUNDING_SEEDS: FundingSeed[] = [
  {
    slug: 'sample-rural-georgia-manufacturing-equipment-grant',
    title: 'SAMPLE: Rural manufacturing equipment grant — up to $150,000',
    summary:
      'A state-administered matching grant for equipment purchases by manufacturers in rural counties, covering up to 30% of project cost. The match structure rewards businesses that were buying equipment anyway; the mistake applicants make is treating it as free money for speculative purchases the business case does not support.',
    fundingType: 'grant',
    organization: 'Georgia Department of Community Affairs',
    minAmount: 25_000,
    maxAmount: 150_000,
    ownerContribution: 70,
    complexity: 'moderate',
    daysToDeadline: 42,
    industry: 'manufacturing',
    industryRestricted: true,
    timeInBusiness: true,
    risk: 'low',
    riskSummary:
      'Reimbursement-based: you buy first and claim after. Job-creation reporting runs for two years post-award.',
    eligibility:
      'Manufacturers (NAICS 31–33) in designated rural counties, two or more years in operation, current on state taxes. Equipment must be new and installed in Georgia.',
    nextAction:
      'Confirm your county is on the designated rural list, then request the current application packet — the match percentage changed this cycle.',
    source: 'Georgia Department of Community Affairs',
  },
  {
    slug: 'sample-sba-504-owner-occupied-real-estate',
    title:
      'SAMPLE: SBA 504 loan — owner-occupied commercial real estate at 10% down',
    summary:
      'The 504 program remains the single most under-used tool for Georgia owner-users: 50% conventional first, 40% fixed-rate SBA debenture, 10% down. On a $2m building that is $200k down instead of $500k, with 25-year fixed pricing on the debenture piece. Evergreen program, no deadline — published here because the current debenture rate makes the maths unusually good.',
    fundingType: 'guaranteed_loan',
    organization: 'U.S. Small Business Administration',
    minAmount: 125_000,
    maxAmount: 5_500_000,
    ownerContribution: 10,
    complexity: 'moderate',
    daysToDeadline: null,
    risk: 'low',
    riskSummary:
      'Personal guarantee required; the 51% owner-occupancy rule is checked at closing and the timeline is 60–90 days, which sellers must accept in writing.',
    eligibility:
      'For-profit businesses with tangible net worth under $20m and average net income under $6.5m, occupying at least 51% of the property.',
    nextAction:
      'Talk to a Certified Development Company before you shop for buildings, not after you have one under contract.',
    source: 'U.S. Small Business Administration',
  },
  {
    slug: 'sample-georgia-job-tax-credit-tier-1',
    title:
      'SAMPLE: Georgia Job Tax Credit — up to $4,000 per job in Tier 1 counties',
    summary:
      'Georgia’s statutory job tax credit pays up to $4,000 per net new job per year for five years in the least-developed counties, claimable against 100% of state income tax liability and, in Tier 1, against payroll withholding. Two new jobs is the Tier 1 threshold — this is not a big-company program.',
    fundingType: 'tax_credit',
    organization: 'Georgia Department of Revenue',
    maxAmount: 4_000,
    complexity: 'low',
    daysToDeadline: null,
    risk: 'low',
    riskSummary:
      'Credits require maintaining the jobs; headcount dips claw back the credit for that year. The county tier list is re-ranked annually.',
    eligibility:
      'Businesses in manufacturing, warehousing, processing, telecommunications, broadcasting, tourism, or R&D creating net new full-time jobs. Threshold varies by county tier: 2 jobs in Tier 1, 25 in Tier 4.',
    nextAction:
      'Check your county’s current tier before the annual re-ranking, and file the NOI with your return — the credit is not automatic.',
    source: 'Georgia Department of Revenue',
  },
  {
    slug: 'sample-usda-rural-business-development-grant',
    title:
      'SAMPLE: USDA Rural Business Development Grant — technical assistance and equipment',
    summary:
      'Federal grants to support small rural businesses, typically flowing through a development authority or nonprofit sponsor rather than to the business directly. Individual awards in Georgia have run $50k–$300k. The sponsor requirement is the feature to understand: find the sponsor first, then shape the project.',
    fundingType: 'grant',
    organization: 'USDA Rural Development',
    minAmount: 50_000,
    maxAmount: 300_000,
    complexity: 'high',
    daysToDeadline: 65,
    risk: 'moderate',
    riskSummary:
      'Competitive nationally with one application window per year; missing it means waiting twelve months.',
    eligibility:
      'Projects benefiting small businesses (fewer than 50 employees, under $1m gross revenue) in rural areas under 50,000 population, applied for by an eligible sponsor entity.',
    nextAction:
      'Approach your county development authority about sponsorship at least a month before the federal deadline.',
    source: 'Grants.gov',
  },
  {
    slug: 'sample-georgia-quick-start-workforce-training',
    title: 'SAMPLE: Georgia Quick Start — free customised workforce training',
    summary:
      'Quick Start builds and delivers customised training for qualifying expansions at no cost — curriculum, instructors, and facilities. It is consistently ranked the top state training program in the country, and it is chronically under-requested by mid-sized companies who assume it is only for headline projects.',
    fundingType: 'workforce_funding',
    organization: 'Technical College System of Georgia',
    complexity: 'low',
    daysToDeadline: null,
    risk: 'low',
    riskSummary:
      'No clawback and no cost; the only real risk is planning hiring around a training start date that slips.',
    eligibility:
      'Companies creating net new jobs in Georgia in manufacturing, distribution, headquarters or technology operations. No minimum size in statute; practical minimum is around 15 new jobs.',
    nextAction:
      'Request a scoping meeting through the state’s economic development project manager for your region.',
    source: 'Georgia Department of Economic Development',
  },
  {
    slug: 'sample-sam-gov-grounds-maintenance-set-aside',
    title:
      'SAMPLE: Robins AFB grounds maintenance — small business set-aside, $1.8m ceiling',
    summary:
      'A five-year grounds-maintenance IDIQ at Robins Air Force Base, set aside for small business. Incumbent has held it for nine years, which is exactly when contracts turn over. Federal facilities maintenance is a realistic first federal contract for an established commercial landscaping firm — past performance transfers.',
    fundingType: 'government_contract',
    organization: 'U.S. Air Force',
    maxAmount: 1_800_000,
    complexity: 'high',
    daysToDeadline: 33,
    industry: 'construction-and-trades',
    industryRestricted: true,
    revenueRequirement: true,
    risk: 'moderate',
    riskSummary:
      'Bonding and certified payroll requirements; the pre-award survey checks equipment capacity. Losing bidders routinely fail on paperwork, not price.',
    eligibility:
      'Small business under the applicable NAICS size standard, SAM.gov registration, bonding capacity, and relevant past performance references.',
    nextAction:
      'Attend the site visit (mandatory), and have your SAM registration and reps-and-certs current before the Q&A cutoff.',
    source: 'SAM.gov Contract Opportunities',
  },
  {
    slug: 'sample-invest-atlanta-small-business-loan',
    title: 'SAMPLE: City small-business gap loan fund — 3% fixed, subordinate',
    summary:
      'A municipal gap-financing fund lending $50k–$250k subordinate to a bank first, at 3% fixed. Designed for the deal where the bank gets to 70% and the owner has 10%: this covers the gap without mezzanine pricing. Funds replenish as loans repay, so the window opens and closes through the year.',
    fundingType: 'direct_loan',
    organization: 'Municipal development authority',
    minAmount: 50_000,
    maxAmount: 250_000,
    ownerContribution: 10,
    complexity: 'moderate',
    daysToDeadline: null,
    firstCome: true,
    risk: 'low',
    riskSummary:
      'First-come while funded; the fund pausing intake mid-application is the common frustration.',
    eligibility:
      'Businesses inside the city limits with a committed bank first mortgage, fewer than 100 employees, and a shortfall the fund can close.',
    nextAction:
      'Get the bank term sheet first — the fund underwrites the gap, not the whole deal.',
    source: 'Georgia Department of Community Affairs',
  },
  {
    slug: 'sample-georgia-agr-processing-microloan',
    title: 'SAMPLE: Value-added agriculture microloan — up to $50,000',
    summary:
      'A revolving microloan fund for value-added agricultural processing: commercial kitchens, co-packing, cold chain, and farm-adjacent manufacturing. Underwriting weighs the processing plan over credit score, which makes it reachable for first-time food businesses that banks decline on history alone.',
    fundingType: 'microloan',
    organization: 'Agricultural development fund',
    minAmount: 5_000,
    maxAmount: 50_000,
    complexity: 'low',
    daysToDeadline: null,
    industry: 'agriculture-and-forestry',
    industryRestricted: true,
    risk: 'low',
    riskSummary:
      'Small dollars and short terms; equipment purchased serves as collateral.',
    eligibility:
      'Georgia businesses processing Georgia-grown agricultural products, licensed or actively pursuing licensure.',
    nextAction:
      'Have the health-department licensing path mapped before applying; it is the first underwriting question.',
    source: 'Georgia Department of Economic Development',
  },
  {
    slug: 'sample-cdbg-employment-incentive-program',
    title:
      'SAMPLE: CDBG Employment Incentive Program — up to $500,000 through your county',
    summary:
      'Federal community-development money a city or county can borrow-and-grant to a private employer creating jobs for low-to-moderate-income workers. The business does not apply; the local government does, on the business’s behalf. That structure defeats most applicants before they start — which is the opportunity for the ones who understand it.',
    fundingType: 'grant',
    organization: 'Georgia Department of Community Affairs',
    minAmount: 100_000,
    maxAmount: 500_000,
    complexity: 'very_high',
    daysToDeadline: 80,
    risk: 'moderate',
    riskSummary:
      'Job-creation commitments are contractual with the local government, and the LMI hiring documentation burden is real and audited.',
    eligibility:
      'Employers whose expansion creates jobs at least 51% of which will be held by low-to-moderate-income persons, in non-entitlement cities and counties.',
    nextAction:
      'Brief your county administrator with a one-page project summary; their willingness to sponsor is the entire gate.',
    source: 'Georgia Department of Community Affairs',
  },
  {
    slug: 'sample-port-tax-credit-bonus',
    title:
      'SAMPLE: Georgia Port Tax Credit Bonus — $1,250 per job on top of the job credit',
    summary:
      'Businesses that increase port traffic through Georgia’s ports by 10% qualify for an additional $1,250 per job on top of the standard job tax credit. Routinely missed by importers and exporters who qualify without knowing the credit exists — the traffic threshold is measured in TEUs or tons, and mid-sized shippers clear it.',
    fundingType: 'tax_credit',
    organization: 'Georgia Department of Revenue',
    maxAmount: 1_250,
    complexity: 'low',
    daysToDeadline: null,
    risk: 'low',
    riskSummary:
      'Documentation of port throughput must come from your carrier or forwarder records; reconstruction after the fact is painful.',
    eligibility:
      'Businesses qualifying for the base job tax credit that increased port traffic 10% year-over-year through a Georgia port.',
    nextAction:
      'Ask your freight forwarder for an annual TEU/tonnage report — that single document decides eligibility.',
    source: 'Georgia Department of Revenue',
  },
  {
    slug: 'sample-appalachian-regional-commission-grant',
    title: 'SAMPLE: ARC business development grant — North Georgia counties',
    summary:
      'The Appalachian Regional Commission funds business development projects in Georgia’s 37 ARC counties, typically through a local sponsor, with awards from $50k to $500k. The current funding cycle emphasises workforce and downtown economies, which suits main-street operators unusually well.',
    fundingType: 'grant',
    organization: 'Appalachian Regional Commission',
    minAmount: 50_000,
    maxAmount: 500_000,
    complexity: 'high',
    daysToDeadline: 55,
    risk: 'moderate',
    riskSummary:
      'Sponsor-driven, match-required, and reimbursement-based; cash-flow the project as if the grant arrives a year late, because it can.',
    eligibility:
      'Projects in Georgia’s ARC counties with a public or nonprofit sponsor and non-federal match, aligned to the current investment priorities.',
    nextAction:
      'Contact your regional commission’s ARC program manager for a pre-application consultation — they will tell you plainly whether the project fits this cycle.',
    source: 'Grants.gov',
  },
  {
    slug: 'sample-sba-7a-working-capital-acquisition',
    title: 'SAMPLE: SBA 7(a) — business acquisition financing to 90% LTV',
    summary:
      'The 7(a) program remains the default instrument for buying a small business in Georgia: up to $5m, 10% equity injections common, and seller notes can cover part of the injection. With a wave of retiring owners listing businesses, the constraint is rarely the loan — it is deal quality and buyer preparation.',
    fundingType: 'guaranteed_loan',
    organization: 'U.S. Small Business Administration',
    minAmount: 100_000,
    maxAmount: 5_000_000,
    ownerContribution: 10,
    complexity: 'moderate',
    daysToDeadline: null,
    risk: 'moderate',
    riskSummary:
      'Personal guarantee, and the acquired business’s cash flow must cover debt service at underwriting multiples — pro formas do not count.',
    eligibility:
      'Creditworthy buyers acquiring a for-profit U.S. small business, with relevant management experience and the equity injection documented.',
    nextAction:
      'Get a lender’s pre-flight review of the target’s last three tax returns before you sign a letter of intent.',
    source: 'U.S. Small Business Administration',
  },
  {
    slug: 'sample-film-tax-credit-service-vendors',
    title:
      'SAMPLE: Film industry vendor certification — access to production spending',
    summary:
      'Not a grant: a certification. Georgia’s production industry spends billions annually with certified local vendors, and the vendor list is where productions shop first. For caterers, equipment shops, transport firms and security companies, getting listed functions like a demand subsidy.',
    fundingType: 'technical_assistance',
    organization: 'Georgia Department of Economic Development',
    complexity: 'low',
    daysToDeadline: null,
    risk: 'low',
    riskSummary:
      'Production demand is cyclical and strike-sensitive; treat it as a revenue channel, not the business.',
    eligibility:
      'Georgia-based businesses providing goods or services relevant to film and television production.',
    nextAction:
      'Complete the vendor profile on the state film office directory and reference it in outreach to production offices.',
    source: 'Georgia Department of Economic Development',
  },
  {
    slug: 'sample-dot-disadvantaged-business-program',
    title:
      'SAMPLE: GDOT DBE certification — access to federal-aid contract goals',
    summary:
      'Federal-aid highway contracts in Georgia carry participation goals for certified Disadvantaged Business Enterprises. Certification is free, takes about 90 days, and prime contractors actively seek certified subs to meet goals — a structural demand advantage for qualifying trucking, materials and construction firms.',
    fundingType: 'procurement_opportunity',
    organization: 'Georgia Department of Transportation',
    complexity: 'moderate',
    daysToDeadline: null,
    risk: 'low',
    riskSummary:
      'Certification requires disclosing personal financials, and the personal-net-worth cap excludes some otherwise-eligible owners.',
    eligibility:
      'Small businesses at least 51% owned and controlled by socially and economically disadvantaged individuals, under the personal net worth cap.',
    nextAction:
      'Assemble three years of business and personal returns before starting the online application; incomplete files are what makes certification slow.',
    source: 'Georgia Department of Transportation',
  },
  {
    slug: 'sample-energy-efficiency-rural-usda-reap',
    title: 'SAMPLE: USDA REAP — 50% grant for rural energy improvements',
    summary:
      'The Rural Energy for America Program pays up to 50% of the cost of energy efficiency improvements and renewable systems for rural small businesses and agricultural producers — solar, refrigeration upgrades, HVAC, grain-drying. Quarterly competitions; smaller requests score surprisingly well.',
    fundingType: 'grant',
    organization: 'USDA Rural Development',
    minAmount: 1_500,
    maxAmount: 500_000,
    ownerContribution: 50,
    complexity: 'moderate',
    daysToDeadline: 47,
    industry: 'agriculture-and-forestry',
    risk: 'low',
    riskSummary:
      'Requires a professional energy assessment for larger requests, and the project cannot start before award.',
    eligibility:
      'Rural small businesses and agricultural producers; the technology list is broad but the rural-area map is the first check.',
    nextAction:
      'Verify your address on the USDA eligibility map, then get the energy audit quoted — it is the pacing item.',
    source: 'Grants.gov',
  },
  {
    slug: 'sample-veteran-business-outreach-microloan',
    title: 'SAMPLE: Veteran-owned business microloan and mentoring package',
    summary:
      'A community lender pairing microloans to $35k with structured mentoring for veteran-owned Georgia businesses. The mentoring is mandatory, which is the point: the fund’s losses run below industry average because the operating support is part of the credit.',
    fundingType: 'microloan',
    organization: 'Community development financial institution',
    minAmount: 5_000,
    maxAmount: 35_000,
    complexity: 'low',
    daysToDeadline: null,
    risk: 'low',
    riskSummary:
      'Small-dollar exposure; the time commitment to mentoring is real.',
    eligibility:
      'Georgia businesses majority-owned by veterans, reservists or military spouses, under two years old or under $250k revenue.',
    nextAction:
      'Book an intake session; the loan application opens after the first mentoring meeting, not before.',
    source: 'U.S. Small Business Administration',
  },
  {
    slug: 'sample-onegeorgia-equity-fund',
    title: 'SAMPLE: OneGeorgia EDGE fund — competitive-project gap closing',
    summary:
      'The state’s deal-closing fund for projects in rural counties where Georgia is competing against another state. Flows through the local government, and the trigger is a genuine competitive alternative — the application requires evidence the project could land elsewhere.',
    fundingType: 'grant',
    organization: 'OneGeorgia Authority',
    minAmount: 100_000,
    maxAmount: 1_000_000,
    complexity: 'very_high',
    daysToDeadline: null,
    risk: 'moderate',
    riskSummary:
      'Performance agreements with clawback follow the money; the competitive-alternative evidence is scrutinised.',
    eligibility:
      'Job-creating projects in eligible rural counties, applied for by the local government, with a documented out-of-state alternative.',
    nextAction:
      'This one starts with the state project manager, not a form — request a project meeting through your regional economic development office.',
    source: 'Georgia Department of Economic Development',
  },
  {
    slug: 'sample-childcare-capacity-expansion-grant',
    title:
      'SAMPLE: Child-care capacity expansion grants — equipment and buildout',
    summary:
      'State lottery-funded grants for licensed child-care providers expanding capacity: classroom buildout, playground equipment, kitchen upgrades. Awards to $75k with a fast, checklist-style application. Capacity is a stated state priority, which is when grant programs are easiest to win.',
    fundingType: 'grant',
    organization: 'Georgia Department of Early Care and Learning',
    minAmount: 5_000,
    maxAmount: 75_000,
    complexity: 'low',
    daysToDeadline: 28,
    firstCome: true,
    industryRestricted: true,
    risk: 'low',
    riskSummary:
      'Licensed-capacity increase must be documented post-award; funds are reimbursement-based.',
    eligibility:
      'Licensed Georgia child-care providers in good standing proposing a measurable capacity increase.',
    nextAction:
      'Confirm your licensing file is clean before applying — any open corrective action defers the application.',
    source: 'Georgia Department of Community Affairs',
  },
  {
    slug: 'sample-export-assistance-step-grant',
    title:
      'SAMPLE: STEP export grant — trade-show and market-entry reimbursement',
    summary:
      'Federal State Trade Expansion Program dollars, administered by the state, reimbursing small businesses for export development: international trade-show costs, translation, export compliance, and inbound-buyer hosting. Typical awards $5k–$15k — small money that reliably moves the needle for first-time exporters.',
    fundingType: 'export_assistance',
    organization: 'Georgia Department of Economic Development',
    minAmount: 2_500,
    maxAmount: 15_000,
    complexity: 'low',
    daysToDeadline: 39,
    firstCome: true,
    risk: 'low',
    riskSummary:
      'Reimbursement-only, with receipts; activities must be pre-approved to count.',
    eligibility:
      'Georgia small businesses (SBA size standards) that are export-ready with a product or service at least 51% U.S.-origin.',
    nextAction:
      'List the specific shows and markets before applying — pre-approval of named activities is what gets funded.',
    source: 'Georgia Department of Economic Development',
  },
  {
    slug: 'sample-broadband-ready-site-incentive',
    title:
      'SAMPLE: Broadband infrastructure procurement — county last-mile builds',
    summary:
      'Federally funded county broadband builds are being procured across middle and south Georgia, with contracts for construction, fibre splicing, drop installation and maintenance. Multi-year revenue for regional contractors, and most counties are struggling to attract enough qualified bidders.',
    fundingType: 'procurement_opportunity',
    organization: 'County governments (federally funded)',
    minAmount: 250_000,
    maxAmount: 5_000_000,
    complexity: 'high',
    daysToDeadline: 51,
    industry: 'construction-and-trades',
    industryRestricted: true,
    revenueRequirement: true,
    risk: 'moderate',
    riskSummary:
      'Federal labour and Build America requirements flow down; materials sourcing rules catch unprepared bidders.',
    eligibility:
      'Contractors with utility construction experience, bonding capacity, and the ability to document Build America compliance.',
    nextAction:
      'Register with the specific county portals — these do not all appear on state systems — and price the compliance overhead into the bid.',
    source:
      'Georgia Department of Administrative Services — Team Georgia Marketplace',
  },
];

function daysFromNow(days: number): Date {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

async function seedOpportunities(lookups: LookupTables): Promise<void> {
  for (const seed of PROPERTY_SEEDS) {
    const sourceName = 'Georgia Department of Community Affairs';
    const sourceId = lookups.sources.get(sourceName);
    if (!sourceId) continue;

    const closing =
      seed.daysToClose === null ? null : daysFromNow(seed.daysToClose);

    const score = buildScore({
      financialValue: scoreFinancialValue({
        estimatedValueMin: seed.estimatedMin,
        estimatedValueMax: seed.estimatedMax,
      }),
      accessibility: scoreAccessibility({
        geographicScope: 'single_county',
        industryRestricted: false,
      }),
      timeSensitivity: scoreTimeSensitivity({
        closingDate: closing,
        limitedInventory: seed.saleType !== 'standard_listing',
      }),
      sourceReliability: scoreSourceReliability('primary_government'),
      capitalRequirement: scoreCapitalRequirement({
        capitalRequiredMin: seed.capitalMin,
      }),
      complexity: scoreComplexity(seed.complexity),
      risk: scoreRisk(seed.risk),
    });

    const { data: opportunity, error } = await admin
      .from('opportunities')
      .upsert(
        {
          slug: seed.slug,
          title: seed.title,
          category: 'commercial_property',
          subtype: seed.saleType.replace(/_/g, ' '),
          summary: seed.summary,
          status: 'open',
          workflow_status: 'published',
          published_at: new Date().toISOString(),
          state_id: lookups.stateId,
          county_id: lookups.counties.get(seed.county) ?? null,
          city_id: seed.city ? (lookups.cities.get(seed.city) ?? null) : null,
          industry_id: seed.industry
            ? (lookups.industries.get(seed.industry) ?? null)
            : null,
          source_id: sourceId,
          original_source_url: 'https://www.dca.ga.gov/',
          date_discovered: new Date().toISOString().slice(0, 10),
          date_verified: new Date().toISOString().slice(0, 10),
          closing_date: closing?.toISOString() ?? null,
          estimated_value_min: seed.estimatedMin,
          estimated_value_max: seed.estimatedMax,
          capital_required_min: seed.capitalMin,
          risk_summary: seed.riskSummary,
          recommended_next_action: seed.nextAction,
          score: score.finalTotal,
          score_classification: score.classification,
          score_explanation: score.explanation,
          verification_status: 'verified',
          minimum_access_rank:
            score.finalTotal >= 80 ? 30 : score.finalTotal >= 60 ? 20 : 10,
          is_sample: true,
        },
        { onConflict: 'slug' },
      )
      .select('id')
      .single();

    if (error || !opportunity) {
      console.error(`  ✗ ${seed.slug}: ${error?.message}`);
      continue;
    }

    await admin.from('property_details').upsert(
      {
        opportunity_id: opportunity.id,
        property_type: seed.propertyType,
        sale_type: seed.saleType,
        asking_price: seed.askingPrice ?? null,
        starting_bid: seed.startingBid ?? null,
        building_size_sqft: seed.buildingSqft ?? null,
        lot_size_acres: seed.lotAcres ?? null,
        zoning: seed.zoning ?? null,
        auction_date:
          seed.saleType.includes('sale') || seed.saleType === 'auction'
            ? (closing?.toISOString() ?? null)
            : null,
      },
      { onConflict: 'opportunity_id' },
    );

    await admin.from('opportunity_score_components').upsert(
      {
        opportunity_id: opportunity.id,
        financial_value_score: score.components.financialValue,
        accessibility_score: score.components.accessibility,
        time_sensitivity_score: score.components.timeSensitivity,
        source_reliability_score: score.components.sourceReliability,
        capital_requirement_score: score.components.capitalRequirement,
        complexity_score: score.components.complexity,
        risk_score: score.components.risk,
        calculated_total: score.calculatedTotal,
        manual_adjustment: 0,
        final_total: score.finalTotal,
      },
      { onConflict: 'opportunity_id' },
    );

    console.log(`  ✓ property: ${seed.slug} (score ${score.finalTotal})`);
  }

  for (const seed of FUNDING_SEEDS) {
    const sourceId =
      lookups.sources.get(seed.source) ??
      lookups.sources.get('Georgia Department of Economic Development');
    if (!sourceId) continue;

    const closing =
      seed.daysToDeadline === null ? null : daysFromNow(seed.daysToDeadline);

    const score = buildScore({
      financialValue: scoreFinancialValue({
        estimatedValueMin: seed.minAmount ?? seed.maxAmount ?? null,
        estimatedValueMax: seed.maxAmount ?? null,
      }),
      accessibility: scoreAccessibility({
        geographicScope: 'statewide',
        industryRestricted: seed.industryRestricted ?? false,
        revenueRequirement: seed.revenueRequirement ?? false,
        timeInBusinessRequirement: seed.timeInBusiness ?? false,
        ownerContributionPercent: seed.ownerContribution ?? null,
      }),
      timeSensitivity: scoreTimeSensitivity({
        closingDate: closing,
        firstComeFirstServed: seed.firstCome ?? false,
      }),
      sourceReliability: scoreSourceReliability('primary_government'),
      capitalRequirement: scoreCapitalRequirement({
        capitalRequiredMin: seed.ownerContribution
          ? ((seed.minAmount ?? 0) * seed.ownerContribution) / 100
          : 0,
      }),
      complexity: scoreComplexity(seed.complexity),
      risk: scoreRisk(seed.risk),
    });

    const { data: opportunity, error } = await admin
      .from('opportunities')
      .upsert(
        {
          slug: seed.slug,
          title: seed.title,
          category: 'business_funding',
          subtype: seed.fundingType.replace(/_/g, ' '),
          summary: seed.summary,
          status: 'open',
          workflow_status: 'published',
          published_at: new Date().toISOString(),
          state_id: lookups.stateId,
          county_id: seed.county
            ? (lookups.counties.get(seed.county) ?? null)
            : null,
          industry_id: seed.industry
            ? (lookups.industries.get(seed.industry) ?? null)
            : null,
          source_id: sourceId,
          original_source_url: 'https://www.georgia.org/',
          date_discovered: new Date().toISOString().slice(0, 10),
          date_verified: new Date().toISOString().slice(0, 10),
          closing_date: closing?.toISOString() ?? null,
          estimated_value_min: seed.minAmount ?? null,
          estimated_value_max: seed.maxAmount ?? null,
          capital_required_min: seed.ownerContribution
            ? ((seed.minAmount ?? 0) * seed.ownerContribution) / 100
            : 0,
          eligibility_summary: seed.eligibility,
          risk_summary: seed.riskSummary,
          recommended_next_action: seed.nextAction,
          score: score.finalTotal,
          score_classification: score.classification,
          score_explanation: score.explanation,
          verification_status: 'verified',
          minimum_access_rank:
            score.finalTotal >= 80 ? 30 : score.finalTotal >= 60 ? 20 : 10,
          is_sample: true,
        },
        { onConflict: 'slug' },
      )
      .select('id')
      .single();

    if (error || !opportunity) {
      console.error(`  ✗ ${seed.slug}: ${error?.message}`);
      continue;
    }

    await admin.from('funding_details').upsert(
      {
        opportunity_id: opportunity.id,
        funding_type: seed.fundingType,
        funding_organization: seed.organization,
        minimum_amount: seed.minAmount ?? null,
        maximum_amount: seed.maxAmount ?? null,
        owner_contribution_percent: seed.ownerContribution ?? null,
        application_complexity: seed.complexity,
        application_deadline: closing?.toISOString() ?? null,
      },
      { onConflict: 'opportunity_id' },
    );

    await admin.from('opportunity_score_components').upsert(
      {
        opportunity_id: opportunity.id,
        financial_value_score: score.components.financialValue,
        accessibility_score: score.components.accessibility,
        time_sensitivity_score: score.components.timeSensitivity,
        source_reliability_score: score.components.sourceReliability,
        capital_requirement_score: score.components.capitalRequirement,
        complexity_score: score.components.complexity,
        risk_score: score.components.risk,
        calculated_total: score.calculatedTotal,
        manual_adjustment: 0,
        final_total: score.finalTotal,
      },
      { onConflict: 'opportunity_id' },
    );

    console.log(`  ✓ funding: ${seed.slug} (score ${score.finalTotal})`);
  }
}

// --- Indicator observations -------------------------------------------------

async function seedIndicatorValues(): Promise<void> {
  const { data: indicators } = await admin
    .from('market_indicators')
    .select('id, slug');

  // Six months of plausible observations per indicator. Values are labelled
  // sample data and never mixed with verified observations.
  const BASES: Record<string, { base: number; drift: number }> = {
    'construction-materials-price-index': { base: 138.2, drift: 0.4 },
    'structural-steel-mill-price': { base: 1720, drift: -8 },
    'ready-mix-concrete-price': { base: 172.5, drift: 0.9 },
    'atlanta-industrial-asking-rent': { base: 9.85, drift: 0.06 },
    'atlanta-industrial-vacancy': { base: 7.9, drift: 0.15 },
    'atlanta-office-vacancy': { base: 24.6, drift: 0.1 },
    'bank-prime-loan-rate': { base: 7.0, drift: -0.08 },
    'sba-504-debenture-rate': { base: 6.1, drift: -0.05 },
    'georgia-construction-employment': { base: 232.4, drift: 0.5 },
    'georgia-diesel-price': { base: 3.62, drift: 0.02 },
    'atlanta-building-permits': { base: 3400, drift: -35 },
    'commercial-property-insurance-index': { base: 161.0, drift: 1.2 },
  };

  for (const indicator of indicators ?? []) {
    const config = BASES[indicator.slug];
    if (!config) continue;

    for (let monthsAgo = 6; monthsAgo >= 1; monthsAgo -= 1) {
      const end = new Date();
      end.setUTCMonth(end.getUTCMonth() - monthsAgo + 1, 0);
      const start = new Date(end);
      start.setUTCDate(1);

      const value =
        config.base +
        config.drift * (6 - monthsAgo) * (1 + 0.15 * Math.sin(monthsAgo));

      await admin.from('market_indicator_values').upsert(
        {
          indicator_id: indicator.id,
          reporting_period_start: start.toISOString().slice(0, 10),
          reporting_period_end: end.toISOString().slice(0, 10),
          value: Math.round(value * 100) / 100,
          is_sample: true,
        },
        {
          onConflict:
            'indicator_id,reporting_period_start,reporting_period_end',
        },
      );
    }
    console.log(`  ✓ observations: ${indicator.slug}`);
  }
}

// --- Reports ----------------------------------------------------------------

async function seedReports(editorId: string | undefined): Promise<void> {
  const { data: topOpportunities } = await admin
    .from('opportunities')
    .select('id, score')
    .eq('is_sample', true)
    .order('score', { ascending: false })
    .limit(8);

  const reports = [
    {
      slug: 'sample-weekly-ledger',
      title: 'SAMPLE: The Weekly Ledger',
      report_type: 'weekly',
      minimum_access_rank: 10,
      is_sample: true,
      executive_summary:
        'This sample issue demonstrates the weekly format: what changed, what closes soon, and what it means for capital deciding where to land in Georgia this month. All records referenced are sample data.',
    },
    {
      slug: 'sample-pricing-quarterly',
      title: 'SAMPLE: Georgia Pricing Quarterly',
      report_type: 'pricing',
      minimum_access_rank: 20,
      is_sample: true,
      executive_summary:
        'A sample of the quarterly pricing review: construction inputs, rents, vacancy and lending conditions, with interpretation. Observations shown are illustrative.',
    },
    {
      slug: 'sample-premium-briefing',
      title: 'SAMPLE: Premium Briefing — Distressed Pipeline',
      report_type: 'premium_briefing',
      minimum_access_rank: 30,
      is_sample: true,
      executive_summary:
        'A sample premium briefing tracking the distressed and pre-foreclosure pipeline across the sample dataset, in the depth Premium members receive.',
    },
  ];

  for (const report of reports) {
    const { data: row, error } = await admin
      .from('reports')
      .upsert(
        {
          ...report,
          status: 'published',
          published_at: new Date().toISOString(),
          reporting_period_start: new Date(Date.now() - 7 * 86_400_000)
            .toISOString()
            .slice(0, 10),
          reporting_period_end: new Date().toISOString().slice(0, 10),
          created_by: editorId ?? null,
          approved_by: editorId ?? null,
        },
        { onConflict: 'slug' },
      )
      .select('id')
      .single();

    if (error || !row) {
      console.error(`  ✗ report ${report.slug}: ${error?.message}`);
      continue;
    }

    for (const [index, opportunity] of (topOpportunities ?? []).entries()) {
      await admin.from('report_opportunities').upsert(
        {
          report_id: row.id,
          opportunity_id: opportunity.id,
          display_order: index,
          minimum_access_rank: report.minimum_access_rank,
          editor_commentary:
            'Sample editor commentary: why this record made the report and what to check before acting.',
        },
        { onConflict: 'report_id,opportunity_id' },
      );
    }

    console.log(`  ✓ report: ${report.slug}`);
  }
}

// --- Main -------------------------------------------------------------------

async function main(): Promise<void> {
  console.log(`Seeding sample data into ${SUPABASE_URL} (${ENVIRONMENT})`);

  console.log('\nUsers:');
  const users = await seedUsers();

  console.log('\nOpportunities:');
  const lookups = await loadLookups();
  await seedOpportunities(lookups);

  console.log('\nMarket observations:');
  await seedIndicatorValues();

  console.log('\nReports:');
  await seedReports(users.get('editor@example.com'));

  console.log(
    '\nDone. Demo password for all seeded users: set via SEED_PASSWORD.',
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
