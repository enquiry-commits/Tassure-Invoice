// The assistant's person-activity permission model (Vincent, 2026-09-10).
// Gates ONLY "what did person X do / is X responsible for" style queries —
// never client data, invoicing, arrears, deadlines. Pinned here because it
// is a security boundary and easy to regress silently.
//
// Run: npx tsx test-person-visibility.ts
import { canSeePersonActivity } from './lib/person-visibility';

const E = {
  vincent: 'vincent@tassure.com', cindy: 'cindyzhang@tassure.com', samuell: 'samuellng@tassure.com',
  leonard: 'leonard.lee@tassure.com', siokfieng: 'siokfieng@tassure.com',
  jay: 'jaytay@tassure.com', hoechyi: 'hoechyi@tassure.com', sengxin: 'sengxin@tassure.com',
  clarence: 'clarencesaw@tassure.com', lina: 'lina@tassure.com', felicia: 'felicia@tassure.com',
  shemin: 'shemin@tassure.com', minquan: 'minquan@tassure.com', jingfei: 'jingfei@tassure.com',
  chelsea: 'chelsea@tassure.com', esther: 'esther@tassure.com',
};

let fail = 0;
const T = (viewer: string, target: string, want: boolean, why: string) => {
  const got = canSeePersonActivity(viewer, target).allowed;
  const ok = got === want;
  if (!ok) { console.log(`FAIL ${why} — wanted ${want}, got ${got}`); fail++; }
  else console.log(`OK   ${why}`);
};

console.log('— Vincent (owner): sees everyone —');
T(E.vincent, E.cindy, true, 'owner → partner');
T(E.vincent, E.hoechyi, true, 'owner → leader');
T(E.vincent, E.shemin, true, 'owner → staff');
T(E.vincent, E.chelsea, true, 'owner → chelsea');

console.log('\n— Partner: only owner sees a partner; partners cannot see each other —');
T(E.cindy, E.vincent, false, 'partner → owner blocked');
T(E.cindy, E.samuell, false, 'partner → partner blocked');
T(E.cindy, E.leonard, false, 'partner → partner blocked (Leonard)');
T(E.cindy, E.hoechyi, true, 'partner → leader ok');
T(E.cindy, E.shemin, true, 'partner → staff ok');
T(E.esther, E.hoechyi, false, 'Esther (Management team but staff rank per spec) → leader blocked');

console.log('\n— Leader: sees other leaders + staff; not owner/partners —');
T(E.hoechyi, E.jay, true, 'leader → leader ok');
T(E.hoechyi, E.clarence, true, 'leader → leader (Clarence) ok');
T(E.hoechyi, E.shemin, true, 'leader → staff ok');
T(E.hoechyi, E.vincent, false, 'leader → owner blocked');
T(E.hoechyi, E.cindy, false, 'leader → partner blocked');

console.log('\n— Staff (incl. Chelsea): see each other; nothing above —');
T(E.shemin, E.minquan, true, 'staff → staff ok');
T(E.shemin, E.jingfei, true, 'staff → staff (Jing Fei) ok');
T(E.shemin, E.chelsea, true, 'staff → chelsea ok');
T(E.shemin, E.hoechyi, false, 'staff → leader blocked');
T(E.shemin, E.cindy, false, 'staff → partner blocked');
T(E.shemin, E.vincent, false, 'staff → owner blocked');
T(E.chelsea, E.shemin, true, 'chelsea → staff ok');
T(E.chelsea, E.hoechyi, false, 'chelsea → leader blocked');

console.log('\n— Self always —');
T(E.shemin, E.shemin, true, 'self');
T(E.vincent, E.vincent, true, 'owner self');
T(E.hoechyi, E.hoechyi, true, 'leader self');

// an unknown email -> treated as staff rank
T(E.shemin, 'someone.new@tassure.com', true, 'unknown email defaults to staff, staff→staff ok');

console.log(fail === 0 ? '\n=== ALL PASSED ===' : `\n=== ${fail} FAILED ===`);
process.exit(fail === 0 ? 0 : 1);
