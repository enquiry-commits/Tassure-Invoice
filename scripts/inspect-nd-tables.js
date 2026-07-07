const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env.local') });
const { createClient } = require('@supabase/supabase-js');

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

async function main() {
  const { data: nds, count: ndCount } = await sb.from('nominee_directors').select('*', { count: 'exact' });
  console.log('nominee_directors total:', ndCount);
  console.log('sample:', JSON.stringify(nds?.[0], null, 2));
  console.log('# with member_id set:', nds.filter(n => n.member_id).length);
  console.log('# with member_id null:', nds.filter(n => !n.member_id).length);

  const { data: appts, count: apptCount } = await sb.from('nd_appointments').select('*', { count: 'exact' });
  console.log('\nnd_appointments total:', apptCount);
  console.log('sample:', JSON.stringify(appts?.[0], null, 2));
}

main();
