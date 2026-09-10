import { rankForEmail, nameForEmail, type PersonRank } from '@/lib/staff-directory';

/**
 * Who may ask the assistant about WHOM's own activity — Vincent's spec,
 * 2026-09-10.
 *
 * This gates exactly the person-centric tools (my_tasks_summary /
 * recent_activity_summary / team_activity / active_users_today / team_roster
 * load figures) and NOTHING else. Client data, invoicing, arrears, company
 * lookups, SOA — every account can use those in full. And a blocked
 * person-level query never blocks the underlying facts: "what did <leader>
 * do" is refused, but "what changed on <that company>" is always fair game
 * and the refusal message says so.
 *
 * The tiers (see PersonRank):
 *   owner  Vincent — nobody but himself may query his activity.
 *   partner        — only the owner may. Partners cannot see each other.
 *   leader         — owner, partners and OTHER leaders may.
 *   staff          — any other staff/leader/partner/owner may. Staff see each other.
 */

const RANK_LEVEL: Record<PersonRank, number> = {
  staff: 1, leader: 2, partner: 3, owner: 4,
};

export type PersonVisibility =
  | { allowed: true }
  | { allowed: false; reason: string };

/** Can `viewerEmail` see `targetEmail`'s own activity/whereabouts? */
export function canSeePersonActivity(
  viewerEmail: string | null | undefined,
  targetEmail: string | null | undefined,
): PersonVisibility {
  const viewer = rankForEmail(viewerEmail);
  const target = rankForEmail(targetEmail);
  const targetName = nameForEmail(targetEmail) ?? 'that person';

  // Same person always sees themselves.
  if (viewerEmail && targetEmail && viewerEmail.toLowerCase() === targetEmail.toLowerCase()) {
    return { allowed: true };
  }
  if (target === 'owner') {
    return viewer === 'owner'
      ? { allowed: true }
      : { allowed: false, reason: `${targetName}'s own activity is not something any account can look up.` };
  }
  if (target === 'partner') {
    return viewer === 'owner'
      ? { allowed: true }
      : { allowed: false, reason: `${targetName} is a partner — only the firm owner can look up a partner's activity. You can still ask about any specific company or change; that is not restricted.` };
  }
  if (target === 'leader') {
    return RANK_LEVEL[viewer] >= RANK_LEVEL['leader']
      ? { allowed: true }
      : { allowed: false, reason: `${targetName} is a team leader — their personal activity is only visible to management and other leaders. What you CAN ask is what happened on the specific companies they handle (e.g. "what changed on <company> today") — that is not restricted.` };
  }
  // target === 'staff' — any staff/leader/partner/owner may.
  return { allowed: true };
}

/**
 * A predicate for filtering a company-wide activity list down to the people
 * this viewer is allowed to see. Used by team_activity / active_users_today,
 * which return everyone at once — a lower-ranked viewer gets a real answer
 * with the higher-ranked people simply omitted, not a refusal.
 */
export function personActivityFilter(viewerEmail: string | null | undefined): (targetEmail: string) => boolean {
  return (targetEmail: string) => canSeePersonActivity(viewerEmail, targetEmail).allowed;
}

/** Rank of the caller, for tools that vary their shape by tier. */
export function callerRank(email: string | null | undefined): PersonRank {
  return rankForEmail(email);
}
