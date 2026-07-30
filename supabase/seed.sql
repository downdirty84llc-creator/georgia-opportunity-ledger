-- ---------------------------------------------------------------------------
-- Reference data seed (spec 27)
--
-- Loaded by `supabase db reset`. This file contains only reference data:
-- subscription plans, geography, the industry taxonomy, real public sources,
-- and market-indicator definitions.
--
-- Demo members, demo administrators and sample opportunity records are created
-- by `npm run db:seed` (scripts/seed.ts), which needs the Auth admin API to
-- mint users. Everything it writes is flagged is_sample = true.
-- ---------------------------------------------------------------------------

-- === Subscription plans =====================================================
--
-- feature_configuration is the authoritative entitlement document. `null` in a
-- limit field means unlimited; 0 means the feature is unavailable.

insert into public.subscription_plans (
  id, code, name, description, monthly_price, annual_price, access_rank,
  display_order, is_recommended, feature_configuration
) values
(
  'a1000000-0000-4000-8000-000000000001'::uuid, 'free', 'Free Preview',
  'A weekly taste of the ledger: limited previews, one saved opportunity, and '
  'full access to our published methodology.',
  0, 0, 0, 1, false,
  jsonb_build_object(
    'savedOpportunityLimit', 1,
    'savedSearchLimit', 0,
    'csvExport', false,
    'immediateAlerts', false,
    'opportunityDetail', 'preview',
    'reportArchive', 'limited',
    'pricingDashboard', 'preview',
    'advancedFilters', false,
    'deadlineCalendar', false,
    'weeklyReports', false,
    'weeklyReminders', false,
    'customAlertPreferences', false,
    'premiumBriefing', false,
    'completeDatabaseAccess', false,
    'maxPageSize', 20
  )
),
(
  'a1000000-0000-4000-8000-000000000002'::uuid, 'weekly', 'Weekly Report',
  'The weekly report in full, with summary-level detail on every opportunity '
  'and a basic deadline calendar.',
  15, 150, 10, 2, false,
  jsonb_build_object(
    'savedOpportunityLimit', 25,
    'savedSearchLimit', 0,
    'csvExport', false,
    'immediateAlerts', false,
    'opportunityDetail', 'summary',
    'reportArchive', 'limited',
    'pricingDashboard', 'preview',
    'advancedFilters', false,
    'deadlineCalendar', true,
    'weeklyReports', true,
    'weeklyReminders', false,
    'customAlertPreferences', false,
    'premiumBriefing', false,
    'completeDatabaseAccess', false,
    'maxPageSize', 50
  )
),
(
  'a1000000-0000-4000-8000-000000000003'::uuid, 'detailed', 'Detailed Intelligence',
  'Complete analysis on every record: score explanations, risk factors, '
  'recommended next actions, the full archive, and the pricing dashboard.',
  39, 390, 20, 3, true,
  jsonb_build_object(
    'savedOpportunityLimit', null,
    'savedSearchLimit', 0,
    'csvExport', false,
    'immediateAlerts', false,
    'opportunityDetail', 'complete',
    'reportArchive', 'full',
    'pricingDashboard', 'complete',
    'advancedFilters', true,
    'deadlineCalendar', true,
    'weeklyReports', true,
    'weeklyReminders', true,
    'customAlertPreferences', false,
    'premiumBriefing', false,
    'completeDatabaseAccess', false,
    'maxPageSize', 50
  )
),
(
  'a1000000-0000-4000-8000-000000000004'::uuid, 'premium',
  'Premium Alerts and Database',
  'The complete property and funding database, immediate alerts on matching '
  'records, unlimited saved searches, CSV export, and the premium briefing.',
  99, 990, 30, 4, false,
  jsonb_build_object(
    'savedOpportunityLimit', null,
    'savedSearchLimit', null,
    'csvExport', true,
    'immediateAlerts', true,
    'opportunityDetail', 'complete',
    'reportArchive', 'full',
    'pricingDashboard', 'complete',
    'advancedFilters', true,
    'deadlineCalendar', true,
    'weeklyReports', true,
    'weeklyReminders', true,
    'customAlertPreferences', true,
    'premiumBriefing', true,
    'completeDatabaseAccess', true,
    'maxPageSize', 100
  )
)
on conflict (code) do update set
  name = excluded.name,
  description = excluded.description,
  monthly_price = excluded.monthly_price,
  annual_price = excluded.annual_price,
  access_rank = excluded.access_rank,
  display_order = excluded.display_order,
  is_recommended = excluded.is_recommended,
  feature_configuration = excluded.feature_configuration;

-- === Geography ==============================================================

insert into public.states (id, name, abbreviation, slug, country_code, is_active)
values ('a2000000-0000-4000-8000-000000000001'::uuid,
        'Georgia', 'GA', 'georgia', 'US', true)
on conflict (country_code, abbreviation) do update set is_active = true;

-- All 159 Georgia counties, with the Census FIPS county code. Coordinates are
-- loaded separately below for the counties the product launches with; the rest
-- stay null until a verified centroid dataset is imported rather than being
-- filled with estimates.
insert into public.counties (state_id, name, slug, fips_code)
select ga.id, v.name, public.slugify(v.name), v.fips
from (select id from public.states where abbreviation = 'GA' limit 1) ga,
(values
  ('Appling','13001'),('Atkinson','13003'),('Bacon','13005'),('Baker','13007'),
  ('Baldwin','13009'),('Banks','13011'),('Barrow','13013'),('Bartow','13015'),
  ('Ben Hill','13017'),('Berrien','13019'),('Bibb','13021'),('Bleckley','13023'),
  ('Brantley','13025'),('Brooks','13027'),('Bryan','13029'),('Bulloch','13031'),
  ('Burke','13033'),('Butts','13035'),('Calhoun','13037'),('Camden','13039'),
  ('Candler','13043'),('Carroll','13045'),('Catoosa','13047'),('Charlton','13049'),
  ('Chatham','13051'),('Chattahoochee','13053'),('Chattooga','13055'),
  ('Cherokee','13057'),('Clarke','13059'),('Clay','13061'),('Clayton','13063'),
  ('Clinch','13065'),('Cobb','13067'),('Coffee','13069'),('Colquitt','13071'),
  ('Columbia','13073'),('Cook','13075'),('Coweta','13077'),('Crawford','13079'),
  ('Crisp','13081'),('Dade','13083'),('Dawson','13085'),('Decatur','13087'),
  ('DeKalb','13089'),('Dodge','13091'),('Dooly','13093'),('Dougherty','13095'),
  ('Douglas','13097'),('Early','13099'),('Echols','13101'),('Effingham','13103'),
  ('Elbert','13105'),('Emanuel','13107'),('Evans','13109'),('Fannin','13111'),
  ('Fayette','13113'),('Floyd','13115'),('Forsyth','13117'),('Franklin','13119'),
  ('Fulton','13121'),('Gilmer','13123'),('Glascock','13125'),('Glynn','13127'),
  ('Gordon','13129'),('Grady','13131'),('Greene','13133'),('Gwinnett','13135'),
  ('Habersham','13137'),('Hall','13139'),('Hancock','13141'),('Haralson','13143'),
  ('Harris','13145'),('Hart','13147'),('Heard','13149'),('Henry','13151'),
  ('Houston','13153'),('Irwin','13155'),('Jackson','13157'),('Jasper','13159'),
  ('Jeff Davis','13161'),('Jefferson','13163'),('Jenkins','13165'),
  ('Johnson','13167'),('Jones','13169'),('Lamar','13171'),('Lanier','13173'),
  ('Laurens','13175'),('Lee','13177'),('Liberty','13179'),('Lincoln','13181'),
  ('Long','13183'),('Lowndes','13185'),('Lumpkin','13187'),('McDuffie','13189'),
  ('McIntosh','13191'),('Macon','13193'),('Madison','13195'),('Marion','13197'),
  ('Meriwether','13199'),('Miller','13201'),('Mitchell','13205'),
  ('Monroe','13207'),('Montgomery','13209'),('Morgan','13211'),('Murray','13213'),
  ('Muscogee','13215'),('Newton','13217'),('Oconee','13219'),
  ('Oglethorpe','13221'),('Paulding','13223'),('Peach','13225'),
  ('Pickens','13227'),('Pierce','13229'),('Pike','13231'),('Polk','13233'),
  ('Pulaski','13235'),('Putnam','13237'),('Quitman','13239'),('Rabun','13241'),
  ('Randolph','13243'),('Richmond','13245'),('Rockdale','13247'),
  ('Schley','13249'),('Screven','13251'),('Seminole','13253'),
  ('Spalding','13255'),('Stephens','13257'),('Stewart','13259'),
  ('Sumter','13261'),('Talbot','13263'),('Taliaferro','13265'),
  ('Tattnall','13267'),('Taylor','13269'),('Telfair','13271'),('Terrell','13273'),
  ('Thomas','13275'),('Tift','13277'),('Toombs','13279'),('Towns','13281'),
  ('Treutlen','13283'),('Troup','13285'),('Turner','13287'),('Twiggs','13289'),
  ('Union','13291'),('Upson','13293'),('Walker','13295'),('Walton','13297'),
  ('Ware','13299'),('Warren','13301'),('Washington','13303'),('Wayne','13305'),
  ('Webster','13307'),('Wheeler','13309'),('White','13311'),('Whitfield','13313'),
  ('Wilcox','13315'),('Wilkes','13317'),('Wilkinson','13319'),('Worth','13321')
) as v(name, fips)
on conflict (state_id, slug) do update set fips_code = excluded.fips_code;

-- Approximate county-seat coordinates for the launch counties. Used only to
-- centre map views, never for distance calculations presented as precise.
update public.counties c set latitude = v.lat, longitude = v.lon
from (values
  ('fulton', 33.7490, -84.3880), ('dekalb', 33.7712, -84.2260),
  ('cobb', 33.9526, -84.5499), ('gwinnett', 33.9601, -84.0219),
  ('chatham', 32.0809, -81.0912), ('richmond', 33.4735, -81.9748),
  ('muscogee', 32.4610, -84.9877), ('bibb', 32.8407, -83.6324),
  ('clarke', 33.9519, -83.3576), ('lowndes', 30.8327, -83.2785),
  ('dougherty', 31.5785, -84.1557), ('hall', 34.2979, -83.8241),
  ('whitfield', 34.7698, -84.9702), ('glynn', 31.1499, -81.4915),
  ('houston', 32.6130, -83.6000), ('floyd', 34.2570, -85.1647),
  ('troup', 33.0362, -85.0322), ('thomas', 30.8366, -83.9788),
  ('bulloch', 32.4488, -81.7832), ('camden', 30.8724, -81.6556),
  ('clayton', 33.5207, -84.3538), ('henry', 33.4473, -84.1469),
  ('cherokee', 34.2367, -84.4908), ('forsyth', 34.2073, -84.1402)
) as v(slug, lat, lon)
where c.slug = v.slug;

-- Initial cities: the municipalities the launch content most often references.
insert into public.cities (county_id, name, slug)
select co.id, v.name, public.slugify(v.name)
from (values
  ('fulton','Atlanta'),('fulton','Sandy Springs'),('fulton','Roswell'),
  ('fulton','Alpharetta'),('fulton','East Point'),('fulton','College Park'),
  ('chatham','Savannah'),('chatham','Pooler'),('chatham','Garden City'),
  ('richmond','Augusta'),('muscogee','Columbus'),('bibb','Macon'),
  ('clarke','Athens'),('dougherty','Albany'),('lowndes','Valdosta'),
  ('houston','Warner Robins'),('houston','Perry'),
  ('cobb','Marietta'),('cobb','Smyrna'),('cobb','Kennesaw'),('cobb','Austell'),
  ('gwinnett','Lawrenceville'),('gwinnett','Duluth'),('gwinnett','Norcross'),
  ('gwinnett','Suwanee'),
  ('dekalb','Decatur'),('dekalb','Tucker'),('dekalb','Chamblee'),
  ('dekalb','Doraville'),('dekalb','Stone Mountain'),
  ('hall','Gainesville'),('whitfield','Dalton'),('floyd','Rome'),
  ('troup','LaGrange'),('glynn','Brunswick'),('bulloch','Statesboro'),
  ('thomas','Thomasville'),('tift','Tifton'),('laurens','Dublin'),
  ('baldwin','Milledgeville'),('coweta','Newnan'),('carroll','Carrollton'),
  ('carroll','Villa Rica'),
  ('henry','McDonough'),('henry','Stockbridge'),('henry','Locust Grove'),
  ('newton','Covington'),('rockdale','Conyers'),('bartow','Cartersville'),
  ('cherokee','Canton'),('cherokee','Woodstock'),('forsyth','Cumming'),
  ('douglas','Douglasville'),('fayette','Peachtree City'),
  ('fayette','Fayetteville'),
  ('clayton','Jonesboro'),('clayton','Forest Park'),('clayton','Riverdale'),
  ('spalding','Griffin'),('liberty','Hinesville'),('camden','Kingsland'),
  ('ware','Waycross'),('colquitt','Moultrie'),('sumter','Americus'),
  ('gordon','Calhoun'),('stephens','Toccoa'),('toombs','Vidalia'),
  ('wayne','Jesup'),('walton','Monroe'),('barrow','Winder'),
  ('jackson','Jefferson'),('habersham','Cornelia'),('fannin','Blue Ridge'),
  ('gilmer','Ellijay'),('pickens','Jasper'),('dawson','Dawsonville'),
  ('lumpkin','Dahlonega'),('union','Blairsville'),('catoosa','Ringgold'),
  ('walker','LaFayette'),('polk','Cedartown'),('effingham','Springfield')
) as v(county_slug, name)
join public.counties co on co.slug = v.county_slug
join public.states st on st.id = co.state_id and st.abbreviation = 'GA'
on conflict (county_id, slug) do nothing;

-- === Industry taxonomy ======================================================

insert into public.industries (id, name, slug, description, display_order) values
('a3000000-0000-4000-8000-000000000001'::uuid, 'Manufacturing', 'manufacturing',
 'Discrete and process manufacturing, including contract manufacturing and '
 'fabrication.', 1),
('a3000000-0000-4000-8000-000000000002'::uuid, 'Logistics and Warehousing',
 'logistics-and-warehousing',
 'Third-party logistics, distribution, cold storage, drayage and freight '
 'brokerage.', 2),
('a3000000-0000-4000-8000-000000000003'::uuid, 'Construction and Trades',
 'construction-and-trades',
 'General contracting, specialty trades, site work and building services.', 3),
('a3000000-0000-4000-8000-000000000004'::uuid, 'Healthcare and Life Sciences',
 'healthcare-and-life-sciences',
 'Clinical practices, outpatient facilities, medical devices and biosciences.',
 4),
('a3000000-0000-4000-8000-000000000005'::uuid, 'Professional Services',
 'professional-services',
 'Accounting, legal, engineering, consulting and staffing firms.', 5),
('a3000000-0000-4000-8000-000000000006'::uuid, 'Retail and Consumer',
 'retail-and-consumer',
 'Brick-and-mortar retail, e-commerce fulfilment and consumer brands.', 6),
('a3000000-0000-4000-8000-000000000007'::uuid, 'Food and Beverage Production',
 'food-and-beverage-production',
 'Processing, packaging, commercial kitchens and beverage manufacturing.', 7),
('a3000000-0000-4000-8000-000000000008'::uuid, 'Agriculture and Forestry',
 'agriculture-and-forestry',
 'Row crop, poultry, timber, agribusiness services and value-added processing.',
 8),
('a3000000-0000-4000-8000-000000000009'::uuid, 'Technology and Software',
 'technology-and-software',
 'Software, IT services, data infrastructure and advanced electronics.', 9),
('a3000000-0000-4000-8000-00000000000a'::uuid, 'Hospitality and Tourism',
 'hospitality-and-tourism',
 'Lodging, food service, entertainment venues and destination businesses.', 10),
('a3000000-0000-4000-8000-00000000000b'::uuid, 'Automotive and Mobility',
 'automotive-and-mobility',
 'Vehicle assembly, suppliers, electric-vehicle supply chain and dealerships.',
 11),
('a3000000-0000-4000-8000-00000000000c'::uuid, 'Energy and Utilities',
 'energy-and-utilities',
 'Generation, transmission, solar development, water and waste infrastructure.',
 12)
on conflict (slug) do update set
  name = excluded.name,
  description = excluded.description,
  display_order = excluded.display_order;

-- === Sources ================================================================
--
-- These are genuine public bodies and public data services. `automation_allowed`
-- stays false everywhere until each site's terms of use have actually been read
-- and the review outcome recorded — the table constraint enforces that order.

insert into public.sources (
  id, name, organization_name, source_type, website_url, jurisdiction,
  reliability_score, update_frequency, api_available, api_documentation_url,
  automation_allowed, scraping_review_status, internal_notes
) values
('a4000000-0000-4000-8000-000000000001'::uuid,
 'Georgia Department of Economic Development',
 'State of Georgia', 'government', 'https://www.georgia.org', 'Georgia',
 15, 'weekly', false, null, false, 'not_reviewed',
 'Statewide incentive programs, site selection and industry announcements.'),
('a4000000-0000-4000-8000-000000000002'::uuid,
 'Georgia Department of Community Affairs',
 'State of Georgia', 'government', 'https://www.dca.ga.gov', 'Georgia',
 15, 'weekly', false, null, false, 'not_reviewed',
 'Community development block grants, OneGeorgia, downtown development.'),
('a4000000-0000-4000-8000-000000000003'::uuid,
 'Georgia Department of Administrative Services — Team Georgia Marketplace',
 'State of Georgia', 'government', 'https://doas.ga.gov', 'Georgia',
 15, 'daily', false, null, false, 'not_reviewed',
 'State procurement solicitations and vendor registration.'),
('a4000000-0000-4000-8000-000000000004'::uuid,
 'Georgia Department of Revenue',
 'State of Georgia', 'government', 'https://dor.georgia.gov', 'Georgia',
 15, 'monthly', false, null, false, 'not_reviewed',
 'Tax credits, exemptions and delinquent-tax procedure.'),
('a4000000-0000-4000-8000-000000000005'::uuid,
 'U.S. Small Business Administration',
 'U.S. Small Business Administration', 'government', 'https://www.sba.gov',
 'United States', 15, 'weekly', true,
 'https://api.sba.gov', false, 'not_reviewed',
 '7(a), 504, microloan and disaster programs; local district office calendar.'),
('a4000000-0000-4000-8000-000000000006'::uuid,
 'Grants.gov', 'U.S. General Services Administration', 'government',
 'https://www.grants.gov', 'United States', 15, 'daily', true,
 'https://www.grants.gov/api', false, 'not_reviewed',
 'Federal discretionary grant opportunities across all agencies.'),
('a4000000-0000-4000-8000-000000000007'::uuid,
 'SAM.gov Contract Opportunities',
 'U.S. General Services Administration', 'government', 'https://sam.gov',
 'United States', 15, 'daily', true, 'https://open.gsa.gov/api/get-opportunities-public-api/',
 false, 'not_reviewed',
 'Federal contract and subcontract opportunities, including set-asides.'),
('a4000000-0000-4000-8000-000000000008'::uuid,
 'GSA Real Property Disposal',
 'U.S. General Services Administration', 'government',
 'https://realestatesales.gov', 'United States', 15, 'weekly', false, null,
 false, 'not_reviewed',
 'Federal surplus real property auctions and negotiated sales.'),
('a4000000-0000-4000-8000-000000000009'::uuid,
 'Georgia Department of Transportation',
 'State of Georgia', 'government', 'https://www.dot.ga.gov', 'Georgia',
 15, 'weekly', false, null, false, 'not_reviewed',
 'Construction lettings, right-of-way disposal and corridor projects.'),
('a4000000-0000-4000-8000-00000000000a'::uuid,
 'U.S. Bureau of Labor Statistics',
 'U.S. Department of Labor', 'economic_data', 'https://www.bls.gov',
 'United States', 15, 'monthly', true,
 'https://www.bls.gov/developers/', false, 'not_reviewed',
 'Producer price indexes, construction employment and wage series.'),
('a4000000-0000-4000-8000-00000000000b'::uuid,
 'Federal Reserve Economic Data (FRED)',
 'Federal Reserve Bank of St. Louis', 'economic_data',
 'https://fred.stlouisfed.org', 'United States', 15, 'daily', true,
 'https://fred.stlouisfed.org/docs/api/fred/', false, 'not_reviewed',
 'Interest rates, lending conditions and regional economic series.'),
('a4000000-0000-4000-8000-00000000000c'::uuid,
 'U.S. Census Bureau Building Permits Survey',
 'U.S. Census Bureau', 'economic_data', 'https://www.census.gov',
 'United States', 13, 'monthly', true,
 'https://www.census.gov/data/developers.html', false, 'not_reviewed',
 'Permit activity by metro area; a leading indicator for construction demand.')
on conflict (id) do update set
  name = excluded.name,
  reliability_score = excluded.reliability_score,
  internal_notes = excluded.internal_notes;

-- === Market indicators ======================================================

insert into public.market_indicators (
  id, name, slug, category, description, unit, source_id, geographic_scope,
  update_frequency, minimum_access_rank, display_order
) values
('a5000000-0000-4000-8000-000000000001'::uuid,
 'Construction Materials Price Index', 'construction-materials-price-index',
 'construction_cost',
 'Producer price index for inputs to new nonresidential construction.',
 'index (2019 = 100)', 'a4000000-0000-4000-8000-00000000000a'::uuid,
 'United States', 'monthly', 0, 1),
('a5000000-0000-4000-8000-000000000002'::uuid,
 'Structural Steel Mill Price', 'structural-steel-mill-price', 'materials',
 'Average mill price for fabricated structural steel.', 'USD per ton',
 'a4000000-0000-4000-8000-00000000000a'::uuid, 'United States', 'monthly', 10, 2),
('a5000000-0000-4000-8000-000000000003'::uuid,
 'Ready-Mix Concrete Price', 'ready-mix-concrete-price', 'materials',
 'Delivered ready-mix concrete price, South Atlantic region.',
 'USD per cubic yard', 'a4000000-0000-4000-8000-00000000000a'::uuid,
 'South Atlantic', 'monthly', 10, 3),
('a5000000-0000-4000-8000-000000000004'::uuid,
 'Metro Atlanta Industrial Asking Rent', 'atlanta-industrial-asking-rent',
 'commercial_rent',
 'Average triple-net asking rent for industrial and warehouse space.',
 'USD per sq ft per year', null, 'Metro Atlanta', 'quarterly', 20, 4),
('a5000000-0000-4000-8000-000000000005'::uuid,
 'Metro Atlanta Industrial Vacancy', 'atlanta-industrial-vacancy', 'vacancy',
 'Share of industrial inventory available for lease.', 'percent', null,
 'Metro Atlanta', 'quarterly', 20, 5),
('a5000000-0000-4000-8000-000000000006'::uuid,
 'Metro Atlanta Office Vacancy', 'atlanta-office-vacancy', 'vacancy',
 'Share of office inventory available for lease.', 'percent', null,
 'Metro Atlanta', 'quarterly', 20, 6),
('a5000000-0000-4000-8000-000000000007'::uuid,
 'Bank Prime Loan Rate', 'bank-prime-loan-rate', 'interest_rate',
 'The rate most small-business floating-rate loans are priced against.',
 'percent', 'a4000000-0000-4000-8000-00000000000b'::uuid, 'United States',
 'monthly', 0, 7),
('a5000000-0000-4000-8000-000000000008'::uuid,
 'SBA 504 Debenture Rate', 'sba-504-debenture-rate', 'lending',
 'Effective rate on the SBA 504 twenty-five year debenture.', 'percent',
 'a4000000-0000-4000-8000-000000000005'::uuid, 'United States', 'monthly', 10, 8),
('a5000000-0000-4000-8000-000000000009'::uuid,
 'Georgia Construction Employment', 'georgia-construction-employment', 'labor',
 'Seasonally adjusted construction payroll employment in Georgia.',
 'thousands of jobs', 'a4000000-0000-4000-8000-00000000000a'::uuid, 'Georgia',
 'monthly', 10, 9),
('a5000000-0000-4000-8000-00000000000a'::uuid,
 'Georgia On-Highway Diesel Price', 'georgia-diesel-price', 'fuel',
 'Average retail on-highway diesel price, Lower Atlantic region.',
 'USD per gallon', 'a4000000-0000-4000-8000-00000000000b'::uuid,
 'Lower Atlantic', 'weekly', 0, 10),
('a5000000-0000-4000-8000-00000000000b'::uuid,
 'Metro Atlanta Building Permits', 'atlanta-building-permits',
 'permit_activity',
 'Privately owned building permits issued in the Atlanta metropolitan area.',
 'permits per month', 'a4000000-0000-4000-8000-00000000000c'::uuid,
 'Metro Atlanta', 'monthly', 10, 11),
('a5000000-0000-4000-8000-00000000000c'::uuid,
 'Commercial Property Insurance Index', 'commercial-property-insurance-index',
 'insurance',
 'Composite index of commercial property insurance renewal pricing.',
 'index (2019 = 100)', null, 'Southeast', 'quarterly', 20, 12)
on conflict (slug) do update set
  name = excluded.name,
  description = excluded.description,
  minimum_access_rank = excluded.minimum_access_rank;
