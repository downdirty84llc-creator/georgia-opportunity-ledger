import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { OpportunityCard } from '@/components/opportunities/opportunity-card';
import { ButtonLink, SectionHeading } from '@/components/ui/primitives';
import { createPublicSupabaseClient } from '@/lib/db/public';
import { loadPreviewOpportunities } from '@/lib/public-data';

export const revalidate = 900;

type PageProps = { params: Promise<{ county: string }> };

async function loadCounty(slug: string) {
  const supabase = createPublicSupabaseClient();
  const { data } = await supabase
    .from('counties')
    .select('id, name, slug, fips_code, states ( name, abbreviation )')
    .eq('slug', slug)
    .eq('is_active', true)
    .maybeSingle();
  return data;
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { county: slug } = await params;
  const county = await loadCounty(slug);
  if (!county) return { title: 'County not found' };

  return {
    title: `${county.name} County opportunities`,
    description:
      `Commercial property, business funding and market intelligence for ` +
      `${county.name} County, Georgia — verified, scored and tracked to the deadline.`,
    alternates: { canonical: `/georgia/${slug}` },
  };
}

export default async function CountyPage({ params }: PageProps) {
  const { county: slug } = await params;
  const county = await loadCounty(slug);
  if (!county) notFound();

  const [property, funding] = await Promise.all([
    loadPreviewOpportunities({
      limit: 6,
      countySlug: slug,
      category: 'commercial_property',
    }),
    loadPreviewOpportunities({
      limit: 6,
      countySlug: slug,
      category: 'business_funding',
    }),
  ]);

  const total = property.length + funding.length;

  return (
    <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6">
      <nav aria-label="Breadcrumb" className="mb-6 text-sm text-ink-500">
        <ol className="flex flex-wrap items-center gap-2">
          <li>
            <a href="/" className="hover:underline">
              Home
            </a>
          </li>
          <li aria-hidden="true">/</li>
          <li>
            <a href="/commercial-property" className="hover:underline">
              Georgia
            </a>
          </li>
          <li aria-hidden="true">/</li>
          <li className="font-medium text-ink-800">{county.name} County</li>
        </ol>
      </nav>

      <h1 className="text-3xl sm:text-4xl">
        {county.name} County opportunities
      </h1>
      <p className="mt-4 max-w-3xl text-lg leading-relaxed text-ink-700">
        {total > 0
          ? `We are currently tracking ${total} published ${
              total === 1 ? 'record' : 'records'
            } in ${county.name} County across commercial property and business funding.`
          : `We monitor ${county.name} County continuously. There are no published records here right now — new ones appear as sources are checked and verified.`}
      </p>

      {property.length > 0 ? (
        <section className="mt-12">
          <SectionHeading title="Commercial property" />
          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {property.map((opportunity) => (
              <OpportunityCard
                key={opportunity.id}
                opportunity={{ ...opportunity, isLocked: true }}
              />
            ))}
          </div>
        </section>
      ) : null}

      {funding.length > 0 ? (
        <section className="mt-12">
          <SectionHeading title="Business funding" />
          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {funding.map((opportunity) => (
              <OpportunityCard
                key={opportunity.id}
                opportunity={{ ...opportunity, isLocked: true }}
              />
            ))}
          </div>
        </section>
      ) : null}

      <section className="mt-14 rounded-xl bg-ink-900 px-6 py-10 text-white sm:px-10">
        <h2 className="text-2xl text-white">
          Get {county.name} County records as they publish
        </h2>
        <p className="mt-3 max-w-2xl text-ink-200">
          Set {county.name} as a preferred county and your dashboard, weekly
          report and alerts weight toward it. Premium members are notified the
          moment a matching record is published.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <ButtonLink href="/register" variant="secondary">
            Create a free account
          </ButtonLink>
          <ButtonLink
            href="/pricing"
            variant="ghost"
            className="text-white hover:bg-ink-800"
          >
            Compare plans
          </ButtonLink>
        </div>
      </section>
    </div>
  );
}
