/**
 * Report PDF generation.
 *
 * Written as a small, dependency-free PDF writer rather than by driving a
 * headless browser. A weekly report is structured text — headings, paragraphs,
 * key/value rows and a deadline table — and shipping a browser into the
 * serverless bundle to render that would cost several hundred megabytes and a
 * cold start measured in seconds, for output no better than this.
 *
 * The output is a valid PDF 1.4 file using the standard Helvetica fonts, which
 * every reader has built in, so nothing is embedded.
 */

const PAGE_WIDTH = 612; // US Letter, points
const PAGE_HEIGHT = 792;
const MARGIN = 56;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

type FontName = 'body' | 'bold';

interface Line {
  text: string;
  size: number;
  font: FontName;
  /** Extra space above the line, in points. */
  spaceBefore: number;
}

export interface ReportBlock {
  type: 'title' | 'heading' | 'subheading' | 'paragraph' | 'keyValue' | 'divider';
  text?: string;
  label?: string;
  value?: string;
}

/**
 * Approximate advance width for Helvetica at a given size.
 *
 * The exact widths live in the font's AFM table; this uses a per-character
 * average calibrated against Helvetica, which is accurate enough for wrapping
 * body text and avoids embedding a metrics table for a cosmetic result.
 */
function textWidth(text: string, size: number, font: FontName): number {
  const factor = font === 'bold' ? 0.56 : 0.5;
  return text.length * size * factor;
}

function wrap(text: string, size: number, font: FontName): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [''];

  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (textWidth(candidate, size, font) <= CONTENT_WIDTH) {
      current = candidate;
    } else {
      if (current) lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/** Escapes the three characters that are special inside a PDF string literal. */
function escapePdfText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    // Characters outside WinAnsi would need an embedded font; replacing the
    // handful that appear in editorial copy keeps the output readable.
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/—/g, '--')
    .replace(/–/g, '-')
    .replace(/…/g, '...')
    // eslint-disable-next-line no-control-regex
    .replace(/[^\x20-\x7E]/g, '');
}

function blocksToLines(blocks: readonly ReportBlock[]): Line[] {
  const lines: Line[] = [];

  for (const block of blocks) {
    switch (block.type) {
      case 'title':
        for (const line of wrap(block.text ?? '', 22, 'bold')) {
          lines.push({ text: line, size: 22, font: 'bold', spaceBefore: 10 });
        }
        break;
      case 'heading':
        for (const line of wrap(block.text ?? '', 15, 'bold')) {
          lines.push({ text: line, size: 15, font: 'bold', spaceBefore: 18 });
        }
        break;
      case 'subheading':
        for (const line of wrap(block.text ?? '', 12, 'bold')) {
          lines.push({ text: line, size: 12, font: 'bold', spaceBefore: 12 });
        }
        break;
      case 'keyValue':
        for (const line of wrap(
          `${block.label ?? ''}: ${block.value ?? ''}`,
          10,
          'body',
        )) {
          lines.push({ text: line, size: 10, font: 'body', spaceBefore: 2 });
        }
        break;
      case 'divider':
        lines.push({ text: '', size: 10, font: 'body', spaceBefore: 8 });
        break;
      case 'paragraph':
      default:
        for (const line of wrap(block.text ?? '', 10.5, 'body')) {
          lines.push({ text: line, size: 10.5, font: 'body', spaceBefore: 3 });
        }
        break;
    }
  }

  return lines;
}

function paginate(lines: readonly Line[]): Line[][] {
  const pages: Line[][] = [];
  let page: Line[] = [];
  let y = PAGE_HEIGHT - MARGIN;

  for (const line of lines) {
    const advance = line.size * 1.35 + line.spaceBefore;
    if (y - advance < MARGIN + 30) {
      pages.push(page);
      page = [];
      y = PAGE_HEIGHT - MARGIN;
    }
    y -= advance;
    page.push(line);
  }
  if (page.length > 0) pages.push(page);
  return pages.length > 0 ? pages : [[]];
}

function contentStream(lines: readonly Line[], pageNumber: number, pageCount: number): string {
  const parts: string[] = ['BT'];
  let y = PAGE_HEIGHT - MARGIN;
  let currentFont = '';
  let currentSize = 0;

  for (const line of lines) {
    y -= line.size * 1.35 + line.spaceBefore;
    const fontRef = line.font === 'bold' ? '/F2' : '/F1';
    if (fontRef !== currentFont || line.size !== currentSize) {
      parts.push(`${fontRef} ${line.size.toFixed(2)} Tf`);
      currentFont = fontRef;
      currentSize = line.size;
    }
    parts.push(`1 0 0 1 ${MARGIN} ${y.toFixed(2)} Tm`);
    parts.push(`(${escapePdfText(line.text)}) Tj`);
  }

  // Footer: page number and the standing disclaimer required by spec 25.
  parts.push('/F1 8.00 Tf');
  parts.push(`1 0 0 1 ${MARGIN} ${MARGIN - 20} Tm`);
  parts.push(
    `(${escapePdfText(
      `Page ${pageNumber} of ${pageCount} — Georgia Opportunity Ledger. ` +
        'Research and decision support only; not investment, legal or brokerage advice.',
    )}) Tj`,
  );
  parts.push('ET');

  return parts.join('\n');
}

/** Builds a complete PDF document from structured blocks. */
export function renderPdf(blocks: readonly ReportBlock[]): Buffer {
  const pages = paginate(blocksToLines(blocks));
  const pageCount = pages.length;

  const objects: string[] = [];
  // Object numbering: 1 catalog, 2 pages, 3 and 4 fonts, then page/content
  // pairs from 5 onward.
  const firstPageObject = 5;
  const pageObjectIds = pages.map((_, index) => firstPageObject + index * 2);

  objects.push('<< /Type /Catalog /Pages 2 0 R >>');
  objects.push(
    `<< /Type /Pages /Kids [${pageObjectIds
      .map((id) => `${id} 0 R`)
      .join(' ')}] /Count ${pageCount} >>`,
  );
  objects.push(
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
  );
  objects.push(
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
  );

  pages.forEach((pageLines, index) => {
    const pageId = pageObjectIds[index] ?? firstPageObject;
    const contentId = pageId + 1;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
        `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentId} 0 R >>`,
    );
    const stream = contentStream(pageLines, index + 1, pageCount);
    objects.push(
      `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`,
    );
  });

  const chunks: Buffer[] = [];
  const offsets: number[] = [];
  let position = 0;

  const push = (text: string) => {
    const buffer = Buffer.from(text, 'latin1');
    chunks.push(buffer);
    position += buffer.length;
  };

  push('%PDF-1.4\n');
  // A binary comment marks the file as binary for transfer tools.
  push('%\xE2\xE3\xCF\xD3\n');

  objects.forEach((body, index) => {
    offsets[index] = position;
    push(`${index + 1} 0 obj\n${body}\nendobj\n`);
  });

  const xrefStart = position;
  push(`xref\n0 ${objects.length + 1}\n`);
  push('0000000000 65535 f \n');
  for (const offset of offsets) {
    push(`${String(offset).padStart(10, '0')} 00000 n \n`);
  }
  push(
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n` +
      `startxref\n${xrefStart}\n%%EOF\n`,
  );

  return Buffer.concat(chunks);
}

export interface ReportForPdf {
  title: string;
  reportType: string;
  periodStart: string | null;
  periodEnd: string | null;
  executiveSummary: string | null;
  marketCommentary: string | null;
  sections: ReadonlyArray<{ title: string; content: string | null }>;
  opportunities: ReadonlyArray<{
    title: string;
    county: string | null;
    score: number;
    classification: string;
    closingDate: string | null;
    commentary: string | null;
  }>;
  isSample: boolean;
}

export function reportToBlocks(report: ReportForPdf): ReportBlock[] {
  const blocks: ReportBlock[] = [];

  blocks.push({ type: 'title', text: report.title });

  const period =
    report.periodStart && report.periodEnd
      ? `${report.periodStart} to ${report.periodEnd}`
      : 'Undated';
  blocks.push({ type: 'keyValue', label: 'Reporting period', value: period });
  blocks.push({
    type: 'keyValue',
    label: 'Report type',
    value: report.reportType.replace(/_/g, ' '),
  });

  if (report.isSample) {
    blocks.push({
      type: 'paragraph',
      text:
        'SAMPLE DATA — this report was generated from seeded example records ' +
        'and does not describe real opportunities.',
    });
  }

  if (report.executiveSummary) {
    blocks.push({ type: 'heading', text: 'Executive summary' });
    blocks.push({ type: 'paragraph', text: report.executiveSummary });
  }

  if (report.marketCommentary) {
    blocks.push({ type: 'heading', text: 'Market commentary' });
    blocks.push({ type: 'paragraph', text: report.marketCommentary });
  }

  for (const section of report.sections) {
    blocks.push({ type: 'heading', text: section.title });
    if (section.content) {
      blocks.push({ type: 'paragraph', text: section.content });
    }
  }

  if (report.opportunities.length > 0) {
    blocks.push({ type: 'heading', text: 'Opportunities in this report' });
    for (const opportunity of report.opportunities) {
      blocks.push({ type: 'subheading', text: opportunity.title });
      blocks.push({
        type: 'keyValue',
        label: 'Score',
        value: `${opportunity.score} (${opportunity.classification.replace(/_/g, ' ')})`,
      });
      if (opportunity.county) {
        blocks.push({ type: 'keyValue', label: 'County', value: opportunity.county });
      }
      if (opportunity.closingDate) {
        blocks.push({
          type: 'keyValue',
          label: 'Deadline',
          value: opportunity.closingDate.slice(0, 10),
        });
      }
      if (opportunity.commentary) {
        blocks.push({ type: 'paragraph', text: opportunity.commentary });
      }
      blocks.push({ type: 'divider' });
    }
  }

  blocks.push({ type: 'heading', text: 'How to read this report' });
  blocks.push({
    type: 'paragraph',
    text:
      'Scores run from 0 to 100 across seven weighted components: financial ' +
      'value, accessibility, time sensitivity, source reliability, capital ' +
      'requirement, complexity and risk. Every record is traceable to a named ' +
      'public source and carries the date on which it was last verified. ' +
      'Verify all figures independently before you commit capital.',
  });

  return blocks;
}
