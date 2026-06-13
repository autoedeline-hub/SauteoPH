// Dumps schema + all rows of every table in the Airtable base to ./tmp/airtable/.
// Run with: node scripts/airtable-dump.mjs
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";

const envText = readFileSync(".env", "utf8");
const env = Object.fromEntries(
  envText.split(/\r?\n/).filter(Boolean).map(line => {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*"?([^"]*)"?$/);
    return m ? [m[1], m[2]] : [null, null];
  }).filter(([k]) => k)
);

const TOKEN = env.AIRTABLE_TOKEN;
const BASE = env.AIRTABLE_BASE_ID;
if (!TOKEN || !BASE) {
  console.error("Missing AIRTABLE_TOKEN or AIRTABLE_BASE_ID in .env");
  process.exit(1);
}

const OUT = "tmp/airtable";
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const headers = { Authorization: `Bearer ${TOKEN}` };

async function fetchAll(tableId) {
  const rows = [];
  let offset;
  do {
    const url = new URL(`https://api.airtable.com/v0/${BASE}/${tableId}`);
    url.searchParams.set("pageSize", "100");
    if (offset) url.searchParams.set("offset", offset);
    const res = await fetch(url, { headers });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`${tableId} ${res.status}: ${body.slice(0, 300)}`);
    }
    const j = await res.json();
    rows.push(...j.records);
    offset = j.offset;
  } while (offset);
  return rows;
}

const schemaRes = await fetch(`https://api.airtable.com/v0/meta/bases/${BASE}/tables`, { headers });
const schema = await schemaRes.json();
writeFileSync(`${OUT}/_schema.json`, JSON.stringify(schema, null, 2));

const summary = [];
for (const t of schema.tables) {
  process.stdout.write(`Fetching ${t.name}… `);
  try {
    const rows = await fetchAll(t.id);
    writeFileSync(`${OUT}/${t.name.replace(/\W+/g, "_")}.json`, JSON.stringify(rows, null, 2));
    summary.push({ table: t.name, count: rows.length });
    console.log(`${rows.length} rows`);
  } catch (e) {
    summary.push({ table: t.name, error: e.message });
    console.log("error:", e.message);
  }
}

writeFileSync(`${OUT}/_summary.json`, JSON.stringify(summary, null, 2));
console.log("\nDone.\n", summary);
