// Reads tmp/airtable/Knowledge.json and emits SQL inserts into the faq table.
// Idempotent: re-running matches existing rows by question text (case-insensitive)
// and updates them instead of inserting duplicates.
//
//   node scripts/airtable-import-knowledge.mjs
//
// Output: tmp/airtable/import-knowledge.sql

import { readFileSync, writeFileSync, existsSync } from "node:fs";

const SRC = "tmp/airtable/Knowledge.json";
const OUT = "tmp/airtable/import-knowledge.sql";

if (!existsSync(SRC)) {
  console.error(`Missing ${SRC}. Run scripts/airtable-dump.mjs first.`);
  process.exit(1);
}

const rows = JSON.parse(readFileSync(SRC, "utf8"));

const escape = v => v == null || v === "" ? "NULL" : `'${String(v).replace(/'/g, "''")}'`;
const escapeArr = arr => {
  if (!arr || arr.length === 0) return "ARRAY[]::text[]";
  return `ARRAY[${arr.map(t => escape(String(t))).join(", ")}]::text[]`;
};

const lines = [
  "-- Imports FAQ / knowledge entries from Airtable into public.faq.",
  "-- Idempotent: matches by lower(question) and upserts.",
  "BEGIN;",
];

for (const r of rows) {
  const f = r.fields ?? {};
  const question = (f.question ?? "").trim();
  const answer = (f.answer ?? "").trim();
  if (!question || !answer) continue;

  lines.push(
    `INSERT INTO public.faq (question, answer, topic, tags, priority, active)
VALUES (${escape(question)}, ${escape(answer)}, ${escape(f.topic ?? null)}, ${escapeArr(f.tags ?? [])}, ${Number(f.priority ?? 0)}, ${f.active === false ? "false" : "true"})
ON CONFLICT DO NOTHING;`
  );
  // We don't have a unique constraint on question, so use a follow-up UPDATE
  // to keep re-runs in sync.
  lines.push(
    `UPDATE public.faq SET
   answer   = ${escape(answer)},
   topic    = ${escape(f.topic ?? null)},
   tags     = ${escapeArr(f.tags ?? [])},
   priority = ${Number(f.priority ?? 0)},
   active   = ${f.active === false ? "false" : "true"}
 WHERE lower(question) = lower(${escape(question)});`
  );
}

lines.push("COMMIT;");

writeFileSync(OUT, lines.join("\n\n"));
console.log(`Wrote ${rows.length} entries to ${OUT}`);
