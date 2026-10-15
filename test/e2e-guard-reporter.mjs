/**
 * Playwright reporter: fails `npm run e2e` when any test was skipped (a
 * `.skip`, `.fixme` or `test.skip()` inside a test), or when fewer tests ran
 * than the floor in test/e2e-floor.json — so a skipped or deleted end-to-end
 * test cannot pass quietly (AGENTS rule 19). The e2e twin of Karma's
 * spec-count reporter. Raise the floor when a spec adds tests.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const floorFile = path.join(path.dirname(fileURLToPath(import.meta.url)), 'e2e-floor.json');
const FLOOR = JSON.parse(fs.readFileSync(floorFile, 'utf8')).minimumTests;

export default class E2eGuardReporter {
  ran = 0;
  skipped = [];

  onTestEnd(test, result) {
    if (result.status === 'skipped') this.skipped.push(test.titlePath().join(' › '));
    else if (result.retry === 0) this.ran += 1;
  }

  onEnd() {
    const problems = [];
    if (this.skipped.length > 0) problems.push(`${this.skipped.length} skipped: ${this.skipped.join('; ')}`);
    if (this.ran < FLOOR)
      problems.push(`${this.ran} tests ran, fewer than the floor of ${FLOOR} (test/e2e-floor.json)`);
    if (problems.length === 0) {
      process.stdout.write(`e2e count: ${this.ran} ran (floor ${FLOOR})\n`);
      return undefined;
    }
    problems.forEach((p) => process.stdout.write(`E2E COUNT FAILED — ${p}\n`));
    return { status: 'failed' };
  }

  printsToStdio() {
    return false;
  }
}
