// Reads tmp/airtable/Pickup_Guests.json (produced by airtable-dump.mjs) and
// emits a reviewable SQL file that upserts each pickup customer into
// crm_contacts via the upsert_crm_contact() helper, tagging them 'pickup'.
// Run the resulting SQL in the Supabase SQL editor.
//
//   node scripts/airtable-dump.mjs            # 1. dump Airtable → JSON
//   node scripts/airtable-import-pickup.mjs   # 2. JSON → SQL
//   (paste tmp/airtable/import-pickup.sql into Supabase SQL editor)
//
// EXPECTED AIRTABLE TABLE
// -----------------------
// Name: "Pickup Guests"  (or any name that dumps to Pickup_Guests.json
//       after airtable-dump.mjs slugifies it — the SRC path below must
//       match whatever the dump emits)
//
// Suggested columns (the script handles missing fields gracefully —
// just create the ones you want to capture):
//
//   full_name         text   — guest's full name
//   email             text   — optional, validated for shape
//   mobile            text   — phone number
//   fb_handle         text   — Facebook Messenger handle (m.me/<handle>)
//   ig_handle         text   — Instagram handle, if applicable
//   requested_meals   number — how many meals they want
//   preferred_mode    text   — personal_pickup | lalamove | grab (optional)
//   preferred_window  text   — free-text "Sat afternoon", "May 20 6pm", etc.
//   status            text   — new | invited | booked | cancelled
//   notes             text   — anything else the bot captured
//
// Output: tmp/airtable/import-pickup.sql

import { readFileSync, writeFileSync, existsSync } from "node:fs";

const SRC = "tmp/airtable/Pickup_Guests.json";
const OUT = "tmp/airtable/import-pickup.sql";

if (!existsSync(SRC)) {
  console.error(
    `Missing ${SRC}.\n` +
      `1. Create a "Pickup Guests" table in Airtable.\n` +
      `2. Run: node scripts/airtable-dump.mjs\n` +
      `3. Re-run this script.`,
  );
  process.exit(1);
}

const rows = JSON.parse(readFileSync(SRC, "utf8"));

const escape = (v) =>
  v == null || v === "" ? "NULL" : `'${String(v).replace(/'/g, "''")}'`;
const validEmail = (v) =>
  typeof v === "string" && /^[^@]+@[^@]+\.[^@]+$/.test(v.trim());

const lines = [
  "-- Imports pickup-request guests from Airtable into crm_contacts.",
  "-- Tags each contact 'pickup' so they show up in admin → Contacts → pickup filter,",
  "-- and the row's Generate-invite button defaults to the Pickup channel.",
  "-- Idempotent: re-running upserts by email / phone / fb_handle and only",
  "-- appends the 'pickup' tag once.",
  "BEGIN;",
];

let kept = 0;
let skipped = 0;

for (const r of rows) {
  const f = r.fields ?? {};

  // Tolerant field reads — the Airtable column names may vary; try common
  // synonyms before giving up. Lets the user rename columns without
  // breaking the import.
  const pick = (...keys) => {
    for (const k of keys) {
      const v = f[k];
      if (v != null && String(v).trim() !== "") return String(v).trim();
    }
    return "";
  };

  const name = pick("full_name", "name", "Full Name") || "Pickup guest";
  const emailRaw = pick("email", "Email");
  const email = validEmail(emailRaw) ? emailRaw : null;
  const phone = pick("mobile", "phone", "Phone", "Mobile") || null;
  const fb = pick("fb_handle", "facebook", "FB Handle") || null;
  const ig = pick("ig_handle", "instagram", "IG Handle") || null;

  // Skip rows with no way to identify the guest — they'd just be noise.
  if (!name && !email && !phone && !fb && !ig) {
    skipped += 1;
    continue;
  }

  // Pack pickup-specific context into notes so it shows in the Contacts
  // drawer + survives re-runs without touching the structural columns.
  const notesBits = [];
  if (emailRaw && !email)
    notesBits.push(`Airtable email field: ${emailRaw}`);
  const meals = pick("requested_meals", "meals", "Meals");
  if (meals) notesBits.push(`Requested meals: ${meals}`);
  const mode = pick("preferred_mode", "pickup_mode", "Mode");
  if (mode) notesBits.push(`Preferred mode: ${mode}`);
  const window = pick("preferred_window", "window", "When");
  if (window) notesBits.push(`Preferred window: ${window}`);
  const status = pick("status", "Status");
  if (status) notesBits.push(`Pickup status: ${status}`);
  const freeNotes = pick("notes", "Notes");
  if (freeNotes) notesBits.push(freeNotes);
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
    ${escape(ig)},
    'messenger'
  );
  UPDATE public.crm_contacts SET
    tags  = CASE WHEN 'pickup' = ANY(tags) THEN tags ELSE tags || ARRAY['pickup'] END,
    notes = COALESCE(notes, '') ||
            CASE WHEN notes IS NULL OR notes = '' THEN '' ELSE E'\\n' END ||
            ${escape(notes ?? "")}
  WHERE id = v_id;
END $$;`,
  );
  kept += 1;
}

lines.push("COMMIT;");

writeFileSync(OUT, lines.join("\n\n"));
console.log(
  `Wrote ${kept} statements to ${OUT}` +
    (skipped > 0 ? ` (skipped ${skipped} empty rows).` : "."),
);
