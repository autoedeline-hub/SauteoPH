"""
Migrates all table data from old Supabase project to new Supabase project.
Run with: python scripts/migrate_supabase.py

Requires in .env:
  OLD_SUPABASE_URL, OLD_SUPABASE_SERVICE_KEY
  SUPABASE_URL,     NEW_SUPABASE_SERVICE_KEY
"""

import re
import sys
import requests

# --- Load .env ---
env = {}
try:
    with open(".env", "r") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            m = re.match(r'^([A-Z_][A-Z0-9_]*)\s*=\s*"?([^"#]*)"?\s*(?:#.*)?$', line)
            if m:
                env[m.group(1)] = m.group(2).strip()
except FileNotFoundError:
    print("ERROR: .env file not found. Run from the admin-console directory.")
    sys.exit(1)

OLD_URL = env.get("OLD_SUPABASE_URL", "")
OLD_KEY = env.get("OLD_SUPABASE_SERVICE_KEY", "")
NEW_URL = env.get("SUPABASE_URL", "")
NEW_KEY = env.get("NEW_SUPABASE_SERVICE_KEY", "")

for name, val in [("OLD_SUPABASE_URL", OLD_URL), ("OLD_SUPABASE_SERVICE_KEY", OLD_KEY),
                  ("SUPABASE_URL", NEW_URL), ("NEW_SUPABASE_SERVICE_KEY", NEW_KEY)]:
    if not val or val.startswith("YOUR_"):
        print(f"ERROR: Missing or placeholder value for {name} in .env")
        sys.exit(1)

OLD_REST = f"{OLD_URL}/rest/v1"
NEW_REST = f"{NEW_URL}/rest/v1"

OLD_HEADERS = {
    "apikey": OLD_KEY,
    "Authorization": f"Bearer {OLD_KEY}",
    "Content-Type": "application/json",
}
NEW_HEADERS = {
    "apikey": NEW_KEY,
    "Authorization": f"Bearer {NEW_KEY}",
    "Content-Type": "application/json",
    "Prefer": "resolution=merge-duplicates",
}

# Columns with secondary unique constraints — deduplicate source rows on these keys
# (keep last seen row per unique value, by iteration order = highest id wins if sorted)
DEDUP_KEYS = {
    "crm_contacts": "email",
}

# FK-ordered. user_roles skipped — grant admin manually.
TABLES = [
    "menu_categories",
    "menu_items",
    "time_slots",
    "bookings",
    "booking_items",
    "payments",
    "crm_contacts",
    "faq",
    "booking_invites",
]


def get_new_columns(table):
    """Discover which columns exist in the new schema via OpenAPI spec."""
    r = requests.get(
        f"{NEW_URL}/rest/v1/",
        headers={"apikey": NEW_KEY, "Authorization": f"Bearer {NEW_KEY}"},
    )
    if r.status_code == 200:
        try:
            spec = r.json()
            definitions = spec.get("definitions", {})
            if table in definitions:
                return set(definitions[table].get("properties", {}).keys())
        except Exception:
            pass
    # Fallback: fetch a single row if table has data
    r2 = requests.get(
        f"{NEW_REST}/{table}",
        headers={**NEW_HEADERS, "Range": "0-0"},
        params={"select": "*", "limit": "1"},
    )
    if r2.status_code in (200, 206) and r2.json():
        return set(r2.json()[0].keys())
    return None


def fetch_all(table):
    """Fetch all rows from old project with pagination."""
    rows = []
    page = 1000
    offset = 0
    while True:
        r = requests.get(
            f"{OLD_REST}/{table}",
            headers={**OLD_HEADERS, "Range": f"{offset}-{offset + page - 1}", "Prefer": "count=none"},
            params={"select": "*"},
        )
        if r.status_code not in (200, 206):
            raise RuntimeError(f"fetch failed ({r.status_code}): {r.text[:200]}")
        batch = r.json()
        if not batch:
            break
        rows.extend(batch)
        if len(batch) < page:
            break
        offset += page
    return rows


def filter_columns(rows, allowed_cols):
    """Strip columns that don't exist in the destination schema."""
    if allowed_cols is None:
        return rows
    return [{k: v for k, v in row.items() if k in allowed_cols} for row in rows]


def upsert_all(table, rows):
    """Upsert rows into new project in chunks. Falls back to row-by-row on 409."""
    chunk_size = 200
    for i in range(0, len(rows), chunk_size):
        chunk = rows[i:i + chunk_size]
        r = requests.post(
            f"{NEW_REST}/{table}",
            headers=NEW_HEADERS,
            json=chunk,
        )
        if r.status_code not in (200, 201):
            if r.status_code == 409:
                # Unique constraint conflict — insert row by row, skipping duplicates
                skipped = 0
                for row in chunk:
                    r2 = requests.post(
                        f"{NEW_REST}/{table}",
                        headers=NEW_HEADERS,
                        json=[row],
                    )
                    if r2.status_code == 409:
                        skipped += 1
                    elif r2.status_code not in (200, 201):
                        raise RuntimeError(f"upsert failed ({r2.status_code}): {r2.text[:300]}")
                if skipped:
                    print(f"[{skipped} duplicate(s) skipped] ", end="", flush=True)
            else:
                raise RuntimeError(f"upsert failed ({r.status_code}): {r.text[:300]}")


# --- Step 1: Clear destination tables (reverse FK order) ---
print("Clearing destination tables...")
for table in reversed(TABLES):
    r = requests.delete(
        f"{NEW_REST}/{table}",
        headers={**NEW_HEADERS, "Prefer": "return=minimal"},
        params={"id": "not.is.null"},
    )
    if r.status_code not in (200, 204):
        print(f"  WARNING: could not clear {table} ({r.status_code}): {r.text[:100]}")
    else:
        print(f"  cleared {table}")

print()

# --- Step 2: Migrate all tables ---
total = 0
for table in TABLES:
    print(f"  {table} ... ", end="", flush=True)
    try:
        rows = fetch_all(table)
        if not rows:
            print("empty, skipped")
            continue

        # Get destination columns and strip any extras from old schema
        allowed = get_new_columns(table)
        rows = filter_columns(rows, allowed)

        # Deduplicate on secondary unique key if needed (keep last = highest id wins)
        if table in DEDUP_KEYS:
            key = DEDUP_KEYS[table]
            seen = {}
            for row in sorted(rows, key=lambda r: r.get("id", 0)):
                val = (row.get(key) or "").lower()
                seen[val] = row
            rows = list(seen.values())

        upsert_all(table, rows)
        print(f"{len(rows)} rows copied")
        total += len(rows)

    except Exception as e:
        print("FAILED")
        print(f"  -> {e}")
        sys.exit(1)

print(f"\nDone. {total} total rows migrated.")