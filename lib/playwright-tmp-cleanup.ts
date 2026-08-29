import { readdir, rm, stat } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';

// Shared between every code path that launches Chromium via
// @sparticuz/chromium on Vercel (lib/teamwork-agm.ts's getBrowser() AND
// lib/teamwork-nd.ts's launchBrowser() — moved here 2026-08-29 so both
// protect the same shared /tmp resource; teamwork-nd.ts never called this
// at all before, silently contributing to the same pool every single day).
// Vercel reuses Fluid Compute instances between cron invocations. Chromium
// can leave sizable profiles in /tmp after a terminated invocation; once
// free space drops below 64 MB, the next browser launch or close can fail
// outright (confirmed live from real Chromium stderr: "Less than 64MB of
// free space in temporary directory for shared memory files"). Only remove
// profiles old enough that they cannot belong to a concurrently starting
// request — each caller's own cron schedule keeps invocations at least an
// hour apart, so a 2-minute age cutoff can never mistake a still-running
// invocation's own fresh profile for stale garbage.
const PLAYWRIGHT_TEMP_PREFIXES = [
  'playwright_chromiumdev_profile-',
  'playwright-artifacts-',
];

export async function removeStalePlaywrightTempDirs() {
  const root = tmpdir();
  const cutoff = Date.now() - 2 * 60_000;
  let entries: string[];
  try {
    entries = await readdir(root);
  } catch {
    return;
  }

  await Promise.all(entries
    .filter(name => PLAYWRIGHT_TEMP_PREFIXES.some(prefix => name.startsWith(prefix)))
    .map(async name => {
      const target = path.join(root, name);
      try {
        if ((await stat(target)).mtimeMs < cutoff) {
          await rm(target, { recursive: true, force: true });
        }
      } catch {
        // Cleanup is best-effort; login should still report the real failure.
      }
    }));
}
