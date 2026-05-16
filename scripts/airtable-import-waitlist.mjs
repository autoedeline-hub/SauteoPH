// Reads tmp/airtable/Waitlist_Guests.json (produced by airtable-dump.mjs) and
// emits a reviewable SQL file that upserts each guest into crm_contacts via
// the upsert_crm_contact() helper. Run the resulting SQL in the Supabase SQL
// editor.
//
//   node scripts/airtable-import-waitlist.mjs
//
// Output: tmp/airtable/import-waitlist.sql

import { readFileSync, writeFileSync, existsSync } from "node:fs";

const SRC = "tmp/airtable/Waitlist_Guests.json";
const OUT = "tmp/airtable/import-waitlist.sql";

if (!existsSync(SRC)) {
  console.error(`Missing ${SRC}. Run scripts/airtable-dump.mjs first.`);
  process.exit(1);
}

const rows = JSON.parse(readFileSync(SRC, "utf8"));

const escape = v => v == null || v === "" ? "NULL" : `'${String(v).replace(/'/g, "''")}'`;
const validEmail = v => typeof v === "string" && /^[^@]+@[^@]+\.[^@]+$/.test(v.trim());

const lines = [
  "-- Imports historical waitlist guests from Airtable into crm_contacts.",
  "-- Uses the upsert helper so re-running is safe (idempotent by email/phone/fb_handle).",
  "BEGIN;",
];

for (const r of rows) {
  const f = r.fields ?? {};
  const name = (f.full_name ?? "").trim() || "Waitlist guest";
  const emailRaw = (f.email ?? "").trim();
  const email = validEmail(emailRaw) ? emailRaw : null;
  const phone = (f.mobile ?? "").trim() || null;
  const fb = (f.fb_handle ?? "").trim() || null;
  // Junk email goes into notes so we keep the data.
  const notesBits = [];
  if (emailRaw && !email) notesBits.push(`Airtable email field: ${emailRaw}`);
  if (f.party_size) notesBits.push(`Party size on waitlist: ${f.party_size}`);
  if (f.status) notesBits.push(`Waitlist status: ${f.status}`);
  const notes = notesBits.length ? notesBits.join(" · ") : null;

  lines.push(
    `DO $$
DECLARE v_id UUID;
BEGIN
  v_id := public.upsert_crm_contact(
    ${escape(name)},
    ${escape(email)},
    ${escape(phone)},
    ${escape(fb)},
    NULL,
    'messenger'
  );
  UPDATE public.crm_contacts SET
    tags  = CASE WHEN 'waitlist' = ANY(tags) THEN tags ELSE tags || ARRAY['waitlist'] END,
    notes = COALESCE(notes, '') ||
            CASE WHEN notes IS NULL OR notes = '' THEN '' ELSE E'\\n' END ||
            ${escape(notes ?? "")}
  WHERE id = v_id;
END $$;`
  );
}

lines.push("COMMIT;");

writeFileSync(OUT, lines.join("\n\n"));
console.log(`Wrote ${rows.length} statements to ${OUT}`);
