/**
 * Database types.
 *
 * `Database` is deliberately loose until the real schema types are generated:
 *
 *     npm run db:types      # writes src/lib/db/generated-types.ts
 *
 * Then change the alias below to `import type { Database } from './generated-types'`
 * and every query in the codebase gains column-level checking with no other
 * edits, because the clients already take this type as their generic.
 *
 * Two alternatives were rejected. Hand-maintaining a schema type across
 * thirty-odd tables produces something that is confidently wrong the first time
 * a migration lands — worse than a type that is honestly loose. And letting
 * supabase-js fall back to its own default makes long `select()` strings
 * resolve to an error union rather than to rows, which produces dozens of
 * misleading compile errors that have nothing to do with the query.
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Database = any;
