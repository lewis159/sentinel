// Counts candidate public tables (counts only — no row data printed).
const fs = require('fs'); const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const env = fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8');
for (const l of env.split('\n')) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m) process.env[m[1]] = m[2].trim(); }
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
(async () => {
  for (const t of ['users', 'videos', 'transcripts', 'admin_audit_log', 'organisations', 'announcements', 'tier_features']) {
    const { count, error } = await sb.from(t).select('*', { count: 'exact', head: true });
    console.log(t + ':', error ? 'ERR ' + (error.message || error.code) : count);
  }
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
