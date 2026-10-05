import 'server-only';

import type { NextRequest } from 'next/server';
import { getRequestAccount } from '../request-account';
import type { AiFeature, AiUsageTag } from './usage';

/**
 * Who a scheduled job's AI calls count under in the usage ledger
 * (INV-AI-010). The scheduled run (Vercel's cron, carrying the real
 * CRON_SECRET) is the system's own; the same job started by a person's own
 * button counts under that person. Compared against the real secret, not
 * just "has a Bearer header", so a made-up header can't make a person's
 * run look like the system's.
 */
export async function scheduledJobUsage(req: NextRequest, feature: AiFeature): Promise<AiUsageTag> {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get('authorization') === `Bearer ${secret}`) return { feature, trigger: 'cron', actorEmail: null };
  const account = await getRequestAccount(req).catch(() => null);
  return { feature, trigger: 'manual', actorEmail: account?.email ?? null };
}
