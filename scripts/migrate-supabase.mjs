// Migrates all table data from old Supabase project to new Supabase project.
// Run with: node scripts/migrate-supabase.mjs
//
// Requires in .env:
//   OLD_SUPABASE_URL, OLD_SUPABASE_SERVICE_KEY
//   SUPABASE_URL, NEW_SUPABASE_SERVICE_KEY

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

// --- Load .env ---
const envText = readFileSync(".env", "utf8");
const env = Object.fromEntries(
  envText.split(/\r?\n/).filter(Boolean).map(line => {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*"?([^"#]*)"?\s*(?:#.*)?$/);
    return m ? [m[1], m[2].trim()] : [null, null];
  }).filter(([k]) => k)
);

const OLD_URL  = env.OLD_SUPABASE_URL;
const OLD_KEY  = env.OLD_SUPABASE_SERVICE_KEY;
const NEW_URL  = env.SUPABASE_URL;
const NEW_KEY  = env.NEW_SUPABASE_SERVICE_KEY;

for (const [name, val] of [["OLD_SUPABASE_URL", OLD_URL], ["OLD_SUPABASE_SERVICE_KEY", OLD_KEY], ["SUPABASE_URL", NEW_URL], ["NEW_SUPABASE_SERVICE_KEY", NEW_KEY]]) {
  if (!val || val.startsWith("YOUR_")) { console.error(`Missing or placeholder: ${name}`); process.exit(1); }
}

const src = createClient(OLD_URL, OLD_KEY, { auth: { persistSession: false } });
const dst = createClient(NEW_URL, NEW_KEY, { auth: { persistSession: false } });

// Migration order respects FK dependencies.
// user_roles is skipped — auth.users won't transfer; grant admin manually.
const TABLES = [
  "menu_categories",
  "menu_items",
  "time_slots",
  "bookings",
  "booking_items",
  "payments",
  "crm_contacts",
  "faq",
  "booking_invites",
];

async function fetchAll(table) {
  const rows = [];
  const PAGE = 1000;
  let from = 0;
  while (true) {
    const { data, error } = await src
      .from(table)
      .select("*")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`[${table}] fetch error: ${error.message}`);
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return rows;
}

async function upsertAll(table, rows) {
  const CHUNK = 200;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const { error } = await dst.from(table).upsert(chunk, { onConflict: "id" });
    if (error) throw new Error(`[${table}] upsert error: ${error.message}`);
  }
}

let totalRows = 0;
for (const table of TABLES) {
  process.stdout.write(`  ${table} ... `);
  try {
    const rows = await fetchAll(table);
    if (rows.length === 0) { console.log("empty, skipped"); continue; }
    await upsertAll(table, rows);
    console.log(`${rows.length} rows copied`);
    totalRows += rows.length;
  } catch (err) {
    console.log(`FAILED`);
    console.error(`  → ${err.message}`);
    process.exit(1);
  }
}

console.log(`\nDone. ${totalRows} total rows migrated.`);