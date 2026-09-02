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
// free space in temporary directory for shared memory files").
//
// Only remove profiles old enough that they cannot belong to a
// concurrently starting request. The cutoff (2026-08-31, raised from 2
// minutes to 6) is now derived from every caller's own real `maxDuration`
// hard ceiling — 300s on Vercel Hobby, the true worst-case lifetime of any
// legitimate invocation — NOT from an assumption that different callers'
// cron schedules keep them apart. That assumption was proven false live:
// on 2026-08-31, teamwork_secretary (started 19:05:03) and
// teamwork_companies (started 19:08:02, whose getBrowser() runs this
// cleanup at the very top) genuinely overlapped, because their cron
// entries had drifted into the same nominal hour. At 19:08:02, Secretary's
// own still-running profile was already ~179s old — past the old 120s
// cutoff — while Secretary was still actively running for another ~67s;
// this is a highly plausible mechanism for Companies' own failure that
// day (deleting a live sibling's profile out from under it), not just an
// unrelated coincidence. See docs/INVARIANTS.md INV-CRON-013 and
// PROJECT_STATUS.md's 2026-08-31 entry for the full incident. A 6-minute
// cutoff is comfortably above every caller's 300s ceiling even accounting
// for cleanup/close overhead after the hard kill, and still only delays
// clearing genuine garbage by a few extra minutes — cheap, since this is
// an opportunistic guard against a soft 64MB threshold, not a hard
// resource limit.
const PLAYWRIGHT_TEMP_PREFIXES = [
  'playwright_chromiumdev_profile-',
  'playwright-artifacts-',
];

export async function removeStalePlaywrightTempDirs() {
  const root = tmpdir();
  const cutoff = Date.now() - 6 * 60_000;
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

// Defense-in-depth for the residual risk the cutoff above can't fully cover
// on its own: real-world Vercel cron jitter can occasionally exceed its own
// documented hour window (observed live 2026-08-31 — see
// docs/INVARIANTS.md INV-CRON-013), so two Playwright-launching invocations
// can genuinely collide even with every cron entry on a distinct hour.
// Wraps the WHOLE "acquire a working browser/session" unit (browser launch
// through context/page creation, not just the launch() call) — the
// confirmed disk-exhaustion failure can plausibly surface at
// browser.newContext()/context.newPage() too, since both allocate
// shared-memory-backed resources the same way launch() does.
//
// `maxElapsedMs` caps the worst-case ADDED latency regardless of
// `attempts`, checked against every real caller's own budget before
// choosing the default (all 6 Playwright-launching routes have
// maxDuration=300; the ones with their own self-deadline use ~230_000ms) —
// 75s of possible retry overhead leaves comfortable room in every case.
// Callers should NOT wrap a deterministic, unretryable failure (e.g. a
// missing required env var) in this — check that before calling `acquire`.
export async function withPlaywrightRetry<T>(
  acquire: () => Promise<T>,
  { attempts = 3, delayMs = 7000, maxElapsedMs = 75_000 }: { attempts?: number; delayMs?: number; maxElapsedMs?: number } = {},
): Promise<T> {
  const start = Date.now();
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await acquire();
    } catch (error) {
      lastError = error;
      if (attempt === attempts || Date.now() - start > maxElapsedMs) break;
      console.error(`Playwright acquire failed (attempt ${attempt}/${attempts}), retrying:`, error);
      // The other invocation that may have caused this may have finished
      // by now — give the next attempt a fresh chance to clean up whatever
      // it left behind, not just whatever was stale before this call started.
      await removeStalePlaywrightTempDirs();
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
  throw lastError;
}
