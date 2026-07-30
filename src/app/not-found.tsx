import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-4 text-center">
      <p className="font-mono text-sm text-ink-500">404</p>
      <h1 className="mt-2 text-2xl sm:text-3xl">
        That page is not in the ledger
      </h1>
      <p className="mt-3 max-w-md text-sm text-ink-600">
        The record may have been archived, the address may have changed, or the
        link may simply be wrong.
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <Link
          href="/"
          className="rounded-lg bg-ink-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-ink-800"
        >
          Back to the home page
        </Link>
        <Link
          href="/opportunities"
          className="rounded-lg border border-ink-300 px-4 py-2.5 text-sm font-semibold hover:bg-ink-50"
        >
          Search opportunities
        </Link>
      </div>
    </div>
  );
}
