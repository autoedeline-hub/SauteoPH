// Reads tmp/airtable/Conversations.json (produced by airtable-dump.mjs) and
// emits SQL that backfills crm_contacts.messenger_psid for every active
// Messenger thread the bot is tracking.
//
//   node scripts/airtable-dump.mjs                  # 1. dump Airtable → JSON
//   node scripts/airtable-import-conversations.mjs  # 2. JSON → SQL
//   (paste tmp/airtable/import-conversations.sql into Supabase SQL editor)
//
// Why this matters: the Conversations table is the authoritative source
// of Messenger PSIDs. Without an import, the n8n invite-sender workflow
// has nothing to send to (booking_invites.platform_id stays NULL).
//
// Strategy:
//   - Skip bot-fixture rows whose sender_id starts with "TEST_".
//   - For each remaining row, treat sender_id as a PSID (validated by the
//     CHECK constraint on crm_contacts.messenger_psid).
//   - If any existing contact already has this PSID, do nothing.
//   - Otherwise, upsert a contact (name from Conversations.name when
//     present, else a generic label) and link the PSID via
//     link_messenger_psid(). Idempotent: re-runs do not create dupes.
//
// Output: tmp/airtable/import-conversations.sql

import { readFileSync, writeFileSync, existsSync } from "node:fs";

const SRC = "tmp/airtable/Conversations.json";
const OUT = "tmp/airtable/import-conversations.sql";

if (!existsSync(SRC)) {
  console.error(`Missing ${SRC}. Run scripts/airtable-dump.mjs first.`);
  process.exit(1);
}

const rows = JSON.parse(readFileSync(SRC, "utf8"));

const escape = (v) =>
  v == null || v === "" ? "NULL" : `'${String(v).replace(/'/g, "''")}'`;
const isPsid = (v) => typeof v === "string" && /^[0-9]{15,}$/.test(v.trim());

const lines = [
  "-- Backfills Messenger PSIDs onto crm_contacts from the Airtable",
  "-- Conversations table. Idempotent — uses link_messenger_psid() which",
  "-- no-ops when a different contact already owns the PSID.",
  "BEGIN;",
];

let kept = 0;
let skippedTest = 0;
let skippedNoPsid = 0;

for (const r of rows) {
  const f = r.fields ?? {};
  const senderId = (f.sender_id ?? "").trim();
  if (!senderId) {
    skippedNoPsid += 1;
    continue;
  }
  if (/^TEST_/i.test(senderId)) {
    skippedTest += 1;
    continue;
  }
  if (!isPsid(senderId)) {
    skippedNoPsid += 1;
    continue;
  }

  const name = (f.name ?? "").trim() || "Messenger guest";
  const platform = (f.platform ?? "").trim() || "messenger";

  // Pack the live conversation state into notes so the admin Contacts
  // drawer surfaces context (last state, position, last_updated). These
  // change over time — fine, we'll just append on re-import.
  const notesBits = [];
  if (f.state) notesBits.push(`Conversation state: ${f.state}`);
  if (f.position) notesBits.push(`Bot position: ${f.position}`);
  if (f.last_updated) notesBits.push(`Last bot activity: ${f.last_updated}`);
  const notes = notesBits.length ? notesBits.join(" · ") : null;

  lines.push(
    `DO $$
DECLARE v_id UUID;
BEGIN
  -- Prefer matching an existing contact that already has this PSID, so
  -- repeated runs don't create stubs. If none exists, upsert_crm_contact
  -- with the name + 'messenger' source falls through to an INSERT.
  SELECT id INTO v_id FROM public.crm_contacts WHERE messenger_psid = ${escape(senderId)} LIMIT 1;
  IF v_id IS NULL THEN
    v_id := public.upsert_crm_contact(
      ${escape(name)},
      NULL,
      NULL,
      NULL,
      NULL,
      ${escape(platform)}
    );
  END IF;
  PERFORM public.link_messenger_psid(v_id, ${escape(senderId)});
  ${
    notes
      ? `UPDATE public.crm_contacts SET notes = COALESCE(notes, '') ||
            CASE WHEN notes IS NULL OR notes = '' THEN '' ELSE E'\\n' END ||
            ${escape(notes)}
  WHERE id = v_id;`
      : "-- no extra notes"
  }
END $$;`,
  );
  kept += 1;
}

lines.push("COMMIT;");

writeFileSync(OUT, lines.join("\n\n"));
console.log(
  `Wrote ${kept} statements to ${OUT} ` +
    `(skipped ${skippedTest} test rows, ${skippedNoPsid} without a valid PSID).`,
);
