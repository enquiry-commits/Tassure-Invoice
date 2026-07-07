const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env.local') });
const { createClient } = require('@supabase/supabase-js');

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

async function main() {
  const { data, error } = await sb.from('companies').select('*').limit(1);
  if (error) { console.error(error); process.exit(1); }
  console.log('Columns:', Object.keys(data[0] || {}));
  console.log('\nSample row:', JSON.stringify(data[0], null, 2));

  const { count } = await sb.from('companies').select('*', { count: 'exact', head: true });
  console.log('\nTotal rows in companies table:', count);
}

main();
