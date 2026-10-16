import { describeBody } from './body';
import { HttpRow, isPendingRow } from './state';

/**
 * POSIX single quotes: nothing inside is special to bash — not `$`, not
 * backticks, not `\`, not a newline. The only character that cannot appear
 * inside is `'` itself, so it closes the quote, adds an escaped `'` and
 * reopens: `'` → `'\''` (FR-HTTP-06, §6.8).
 */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

/**
 * "Copy as cURL" for bash. Every value is single-quoted. The URL goes after
 * `--url`, so a captured URL that starts with `-` is never read as an
 * option; the body goes after `--data-raw`, so a leading `@` is never read
 * as a file name. Header values equal to the policy's `redactedValue` are
 * copied as `[redacted]`; a body the probe did not read as text (a
 * descriptor such as `[Blob 512 bytes]`) is left out.
 */
export function toCurl(row: HttpRow, redactedValue = '[redacted]'): string {
  const parts = [`curl --url ${shellQuote(row.url)}`, `  -X ${shellQuote(row.method)}`];
  for (const name of Object.keys(row.reqHeaders)) {
    const value = row.reqHeaders[name] === redactedValue ? '[redacted]' : row.reqHeaders[name];
    parts.push(`  -H ${shellQuote(`${name}: ${value}`)}`);
  }
  if (!isPendingRow(row) && row.reqBody !== null && describeBody(row.reqBody).kind !== 'descriptor') {
    parts.push(`  --data-raw ${shellQuote(row.reqBody)}`);
  }
  return parts.join(' \\\n');
}
