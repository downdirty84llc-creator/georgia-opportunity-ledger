import type { SupabaseClient } from '@supabase/supabase-js';

export interface EditorOptions {
  counties: Array<{ id: string; name: string }>;
  cities: Array<{ id: string; name: string }>;
  industries: Array<{ id: string; name: string }>;
  sources: Array<{ id: string; name: string }>;
  stateId: string;
}

/**
 * Reference data the editor's dropdowns need.
 *
 * Sources come from the base table rather than the public view: staff choosing
 * a source need to see inactive and restricted ones too, and row-level security
 * already limits that table to staff.
 */
export async function loadEditorOptions(
  supabase: SupabaseClient,
): Promise<EditorOptions> {
  const [counties, cities, industries, sources, state] = await Promise.all([
    supabase
      .from('counties')
      .select('id, name')
      .eq('is_active', true)
      .order('name', { ascending: true }),
    supabase
      .from('cities')
      .select('id, name')
      .order('name', { ascending: true })
      .limit(500),
    supabase
      .from('industries')
      .select('id, name')
      .eq('is_active', true)
      .order('display_order', { ascending: true }),
    supabase
      .from('sources')
      .select('id, name')
      .order('name', { ascending: true }),
    supabase.from('states').select('id').eq('abbreviation', 'GA').maybeSingle(),
  ]);

  return {
    counties: counties.data ?? [],
    cities: cities.data ?? [],
    industries: industries.data ?? [],
    sources: sources.data ?? [],
    stateId: state.data?.id ?? '',
  };
}
