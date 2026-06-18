// One-off connectivity probe. Loads .env.local, counts real data. Prints NO secrets.
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const envPath = path.join(__dirname, '..', '.env.local');
for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim();
}

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

(async () => {
  const u = await sb.from('users').select('*', { count: 'exact', head: true });
  console.log('public.users:', u.error ? 'ERR ' + u.error.message : u.count);
  const f = await sb.schema('ops').from('findings').select('*', { count: 'exact', head: true });
  console.log('ops.findings:', f.error ? 'ERR ' + f.error.message : f.count);
  const t = await sb.schema('ops').from('tickets').select('*', { count: 'exact', head: true });
  console.log('ops.tickets:', t.error ? 'ERR ' + t.error.message : t.count);
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
