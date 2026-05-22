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
// A Messenger PSID is page-scoped, all-digit, 15-17 chars in practice.
// Anything else in fb_handle is a vanity URL handle (e.g. "edestar.go").
const isPsid = v => typeof v === "string" && /^[0-9]{15,}$/.test(v.trim());
// Test rows the bot harness leaves behind — sender_id starts with TEST_
// or fb_handle starts with TEST_. Skipping them keeps prod crm_contacts
// from getting polluted with bot fixtures.
const isTest = v => typeof v === "string" && /^TEST_/i.test(v.trim());

const lines = [
  "-- Imports historical waitlist guests from Airtable into crm_contacts.",
  "-- Uses the upsert helper so re-running is safe (idempotent by email/phone/fb_handle).",
  "-- PSIDs (numeric 15+ digits) are routed to messenger_psid via link_messenger_psid.",
  "-- Test-harness rows (TEST_* prefix) are skipped.",
  "BEGIN;",
];

let kept = 0;
let skippedTest = 0;

for (const r of rows) {
  const f = r.fields ?? {};
  const name = (f.full_name ?? "").trim() || "Waitlist guest";
  const emailRaw = (f.email ?? "").trim();
  const email = validEmail(emailRaw) ? emailRaw : null;
  const phone = (f.mobile ?? "").trim() || null;
  const fbRaw = (f.fb_handle ?? "").trim() || null;
  // Skip bot test fixtures wholesale.
  if (fbRaw && isTest(fbRaw)) {
    skippedTest += 1;
    continue;
  }
  // Numeric fb_handle is actually a Messenger PSID. Send it through
  // link_messenger_psid below; don't pollute facebook_handle with it.
  const fbHandle = fbRaw && !isPsid(fbRaw) ? fbRaw : null;
  const messengerPsid = fbRaw && isPsid(fbRaw) ? fbRaw : null;
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
    ${escape(fbHandle)},
    NULL,
    'messenger'
  );
  ${messengerPsid ? `PERFORM public.link_messenger_psid(v_id, ${escape(messengerPsid)});` : "-- no PSID for this row"}
  UPDATE public.crm_contacts SET
    tags  = CASE WHEN 'waitlist' = ANY(tags) THEN tags ELSE tags || ARRAY['waitlist'] END,
    notes = COALESCE(notes, '') ||
            CASE WHEN notes IS NULL OR notes = '' THEN '' ELSE E'\\n' END ||
            ${escape(notes ?? "")}
  WHERE id = v_id;
END $$;`
  );
  kept += 1;
}

lines.push("COMMIT;");

writeFileSync(OUT, lines.join("\n\n"));
console.log(
  `Wrote ${kept} statements to ${OUT}` +
    (skippedTest > 0 ? ` (skipped ${skippedTest} test_harness rows).` : "."),
);
