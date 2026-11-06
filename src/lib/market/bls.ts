import { z } from 'zod';

export const BLS_SERIES = 'SMS13000002000000001';
export const BLS_URL = `https://api.bls.gov/publicAPI/v1/timeseries/data/${BLS_SERIES}`;
export const BLS_SOURCE_URL = `https://data.bls.gov/timeseries/${BLS_SERIES}`;

const responseSchema = z.object({
  status: z.literal('REQUEST_SUCCEEDED'),
  Results: z.object({
    series: z
      .array(
        z.object({
          seriesID: z.literal(BLS_SERIES),
          data: z
            .array(
              z.object({
                year: z.string().regex(/^20\d{2}$/),
                period: z.string().regex(/^M(0[1-9]|1[0-3])$/),
                value: z.string().regex(/^\d+(\.\d{1,4})?$/),
                footnotes: z.array(z.object({ code: z.string().optional() })),
              }),
            )
            .min(2)
            .max(40),
        }),
      )
      .length(1),
  }),
});

/** Exact BLS series: Georgia construction payrolls, seasonally adjusted,
 * thousands of jobs. Never substitute a price index or another geography. */
export function parseBlsEmployment(payload: unknown, now: Date) {
  const series = responseSchema.parse(payload).Results.series[0];
  if (!series) throw new Error('BLS series is missing.');
  const rows = series.data
    .filter((row) => row.period !== 'M13') // Annual average is not a month.
    .map((row) => {
      const year = Number(row.year),
        month = Number(row.period.slice(1));
      const start = new Date(Date.UTC(year, month - 1, 1));
      const end = new Date(Date.UTC(year, month, 0));
      const value = Number(row.value);
      if (end > now || value <= 0 || value > 10000) {
        throw new Error(
          'BLS employment observation is outside expected bounds.',
        );
      }
      return {
        start,
        end,
        value,
        preliminary: row.footnotes.some((note) => note.code === 'P'),
        otherFootnotes: row.footnotes.some(
          (note) => note.code && note.code !== 'P',
        ),
      };
    })
    .sort((a, b) => a.start.getTime() - b.start.getTime());
  const latest = rows.at(-1);
  if (
    rows.length < 2 ||
    !latest ||
    now.getTime() - latest.end.getTime() > 120 * 86400000
  ) {
    throw new Error('BLS employment observations are missing or stale.');
  }
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i],
      previous = rows[i - 1];
    if (!row || !previous)
      throw new Error('BLS observation sequence is incomplete.');
    if (
      row.start.getTime() !==
      new Date(
        Date.UTC(
          previous.start.getUTCFullYear(),
          previous.start.getUTCMonth() + 1,
          1,
        ),
      ).getTime()
    ) {
      throw new Error(
        'BLS employment observations contain duplicate or missing months.',
      );
    }
  }
  // Skip the first month: its predecessor is outside the fetched window.
  // Explicit previous values prevent comparison against illustrative seed data.
  return rows.slice(1).map((row, index) => ({
    reporting_period_start: row.start.toISOString().slice(0, 10),
    reporting_period_end: row.end.toISOString().slice(0, 10),
    value: row.value,
    previous_value: rows[index]!.value,
    source_url: BLS_SOURCE_URL,
    verified_at: now.toISOString(),
    is_sample: false,
    interpretation:
      'Source: U.S. Bureau of Labor Statistics. Georgia construction payroll employment, seasonally adjusted, in thousands of jobs. Retrieved automatically from the BLS Public Data API. Values may be revised.' +
      (row.preliminary ? ' Preliminary estimate.' : '') +
      (row.otherFootnotes
        ? ' See the BLS source for additional footnotes.'
        : ''),
  }));
}

export async function fetchBlsEmployment(now: Date, fetchImpl = fetch) {
  const response = await fetchImpl(BLS_URL, {
    redirect: 'error',
    cache: 'no-store',
    signal: AbortSignal.timeout(10000),
    headers: { Accept: 'application/json' },
  });
  if (!response.ok)
    throw new Error(`BLS data request failed (HTTP ${response.status}).`);
  const reader = response.body?.getReader();
  if (!reader) throw new Error('BLS data response is empty.');
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.length;
      if (bytes > 128000)
        throw new Error('BLS data response exceeds the allowed size.');
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  return parseBlsEmployment(
    JSON.parse(Buffer.concat(chunks).toString('utf8')),
    now,
  );
}
