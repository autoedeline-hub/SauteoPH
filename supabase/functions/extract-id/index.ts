// Supabase Edge Function — extract-id
//
// POST  /functions/v1/extract-id
// Body:  { image_base64: string, mime_type?: string }
// Reply: 200 { available: true, kind, full_name, id_number, address, confidence }
//        200 { available: false, reason: "no_api_key" }       (key not set)
//        400 { error: "..." }                                  (bad input)
//        502 { error: "openrouter_error", detail: "..." }      (upstream)
//
// We call OpenRouter with a vision-capable model and ask it to return
// JSON. The frontend uses this to auto-fill the Senior/PWD claim form
// after a guest uploads their ID photo — fields stay editable so the
// guest can correct any misread.
//
// Env vars (set via `supabase secrets set` after deploy):
//   OPENROUTER_API_KEY    — required for live extraction
//   OPENROUTER_MODEL      — optional, defaults to google/gemini-2.5-flash
//   OPENROUTER_REFERER    — optional, your site URL (recommended by OR)
//   OPENROUTER_APP_NAME   — optional, your app name shown in OR dashboards
//
// Deploy:
//   supabase functions deploy extract-id --no-verify-jwt
//   supabase secrets set OPENROUTER_API_KEY=sk-or-...
//
// Note: --no-verify-jwt is intentional. The form is anonymous (no login)
// and the function only reads a posted image. It does NOT touch the DB.

// deno-lint-ignore-file no-explicit-any
declare const Deno: { env: { get(name: string): string | undefined } };

const DEFAULT_MODEL = "google/gemini-2.5-flash";

const SYSTEM_PROMPT = `You extract identity fields from photographs of Philippine government-issued IDs.

The two most common IDs you'll see are LGU-issued Senior Citizen IDs (Office of Senior Citizens Affairs / OSCA) and Person With Disability (PWD) IDs. You also handle UMID, PhilSys (National) ID, driver's license, passport, and voter's ID.

Return ONLY valid JSON matching this schema (no prose, no markdown):
{
  "kind": "senior" | "pwd" | "other",
  "full_name": string,       // exactly as printed
  "id_number": string,       // primary ID number ONLY — no labels, no prefixes
  "address": string,         // address as printed, joined to one line
  "date_of_birth": string,   // as printed — preserve original format (MM/DD/YYYY etc.)
  "age": string,             // as printed (digits only) or "" if absent
  "sex": string,             // "M" or "F" — normalize anything else to one of these
  "date_of_issue": string,   // as printed — preserve original format
  "confidence": number       // 0..1
}

=== KIND DETECTION ===

"senior" — the card header mentions any of: "Senior Citizen", "OSCA", "Office of Senior Citizens Affairs"
"pwd"    — the card mentions "Person With Disability", "PWD", or shows the international access symbol
"other"  — any other ID type. Still extract name, number, and address.

=== NAME ===

For Senior Citizen IDs, the card has TWO name fields:
  • A "Name:" label near the top (canonical)
  • A "Printed Name and Signature/Thumbmark" line at the bottom

Always take the value from the top "Name:" field. Preserve middle names, middle initials, and suffixes (Jr., Sr., III, etc.). Keep the casing as printed (uppercase if printed uppercase).

For other IDs, take the name as it appears in the main name field. Do not invent middle initials.

=== ID_NUMBER ===

Return ONLY the number portion. Strip these labels if the OCR captured them:
  • "ID No.", "ID No:", "ID Number:"
  • "OSCA No.", "OSCA #"
  • "Control No.", "Control #"

Preserve internal separators (dashes, dots, spaces) as printed. Examples:

  Senior Citizen ID printed "ID No. 8764"              → "8764"
  Senior Citizen ID printed "OSCA-2019-001234"         → "OSCA-2019-001234"
  PhilSys printed "1234-5678-9101-1213"                → "1234-5678-9101-1213"
  PWD ID printed "RR-XXXXXX-XX-..."                    → "RR-XXXXXX-XX-..."
  Driver's license "N01-23-456789"                     → "N01-23-456789"

For Senior Citizen IDs specifically: the ID number is often a short integer (3-6 digits) printed in red or distinct color near the bottom-left. Do NOT confuse it with the date of birth, age, date of issue, or any other number on the card.

=== ADDRESS ===

Read the "Address:" field exactly as printed. PH addresses are commonly:
  • Short LGU form:  "Poblacion Baliwag, Bulacan"
  • Full street form: "833 Sisa St., Brgy 526, Zone 52 Sampaloc, Manila City, Metro Manila"

If the address is split across lines, join with a single comma + space. Do not abbreviate or expand abbreviations.

=== DATE OF BIRTH / DATE OF ISSUE ===

Preserve the format exactly as printed on the card:
  • "11/05/1953"   → "11/05/1953"
  • "Nov 5, 1953"  → "Nov 5, 1953"
  • "1953-11-05"   → "1953-11-05"

Don't reformat. Don't convert between MM/DD/YYYY and DD/MM/YYYY — the admin will read it as-is to cross-check against the photo. If the field is absent, return an empty string.

Senior Citizen ID layout typically has Date of Birth and Date of Issue labeled directly under the values; PhilSys and driver's licenses use "DOB" / "Date of Birth" / "Birth Date".

=== AGE ===

Return DIGITS ONLY, no units. "65" not "65 years old". If absent, return "".

=== SEX ===

Normalize to a single character:
  • "M", "Male", "MALE", "MASCULINE"  → "M"
  • "F", "Female", "FEMALE", "FEMENINE" → "F"
  • Anything else / absent             → ""

=== UNREADABLE FIELDS ===

If a field is missing, obscured, or unreadable, return an empty string for that field — DO NOT GUESS. If the entire image is not a government ID (e.g. a selfie, a receipt, blank paper), return all empty strings and confidence 0.

Confidence reflects your overall certainty across all fields. If the photo is glare-heavy, partially cropped, or low-res, return a low confidence even if you extracted something.`;

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Max-Age": "86400",
  };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(), "content-type": "application/json" },
  });
}

function stripJsonFences(s: string): string {
  // The model occasionally wraps JSON in ```json … ``` fences despite the
  // instructions. Strip them defensively so JSON.parse doesn't blow up.
  const trimmed = s.trim();
  const fence = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return fence ? fence[1] : trimmed;
}

function normalizeKind(k: unknown): "senior" | "pwd" | "other" {
  const v = String(k ?? "").trim().toLowerCase();
  if (v === "senior" || v === "pwd") return v;
  return "other";
}

function clampConfidence(c: unknown): number {
  const n = Number(c);
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

// Belt-and-suspenders for the id_number field. The prompt instructs the
// model to strip labels, but vision OCR sometimes leaves them attached
// (especially when the label and number are visually close on the card).
// Strip the common ones here so the user never sees "ID No. 8764" in the
// form — they see "8764".
function cleanIdNumber(raw: unknown): string {
  let s = String(raw ?? "").trim();
  // Drop common Philippine ID label prefixes (case-insensitive).
  s = s.replace(
    /^(id\s*(?:no\.?|number)\s*:?\s*|osca\s*(?:no\.?|#|number)\s*:?\s*|control\s*(?:no\.?|#)\s*:?\s*)/i,
    "",
  );
  // Collapse any internal runs of whitespace but preserve dashes/dots used
  // as legitimate separators (PhilSys uses dashes, OSCA codes sometimes do).
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

// Coerce sex to "M" / "F" / "". Belt-and-suspenders for cards that print
// the full word or use non-English variants — the prompt already asks for
// normalization but we re-enforce here.
function normalizeSex(raw: unknown): string {
  const v = String(raw ?? "")
    .trim()
    .toUpperCase();
  if (v.startsWith("M")) return "M";
  if (v.startsWith("F")) return "F";
  return "";
}

// Strip non-digits from age strings ("65 years old" → "65"). Returns "" if
// nothing's left or if the result is out of plausible range (defends
// against the model returning the year of birth here by mistake).
function normalizeAge(raw: unknown): string {
  const digits = String(raw ?? "").replace(/[^\d]/g, "");
  if (!digits) return "";
  const n = Number(digits);
  if (!Number.isFinite(n) || n < 1 || n > 130) return "";
  return String(n);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }
  if (req.method !== "POST") {
    return json(405, { error: "method_not_allowed" });
  }

  const apiKey = Deno.env.get("OPENROUTER_API_KEY");
  if (!apiKey) {
    // Soft-fail: the frontend treats this as "feature off" and falls back
    // to manual entry. No need to log noisily — we expect this in dev until
    // the key is provisioned.
    return json(200, { available: false, reason: "no_api_key" });
  }

  let body: { image_base64?: string; mime_type?: string };
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "invalid_json" });
  }

  const imageB64 = (body.image_base64 ?? "").replace(/^data:[^;]+;base64,/, "");
  const mime = body.mime_type || "image/jpeg";
  if (!imageB64 || imageB64.length < 200) {
    return json(400, { error: "image_too_small_or_missing" });
  }
  // Cap at ~6 MB base64 (~4.5 MB raw) — OpenRouter rejects huge payloads.
  if (imageB64.length > 6_000_000) {
    return json(400, { error: "image_too_large" });
  }

  const model = Deno.env.get("OPENROUTER_MODEL") || DEFAULT_MODEL;
  const referer = Deno.env.get("OPENROUTER_REFERER") || "";
  const appName = Deno.env.get("OPENROUTER_APP_NAME") || "Sauteo PH";

  const orPayload = {
    model,
    // Force JSON output where the model honors it. Gemini does; some others
    // ignore this and we rely on prompt + fence-stripping instead.
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "Extract the identity fields from this ID photo. Return ONLY the JSON object.",
          },
          {
            type: "image_url",
            image_url: { url: `data:${mime};base64,${imageB64}` },
          },
        ],
      },
    ],
  };

  let upstream: Response;
  try {
    upstream = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        ...(referer ? { "HTTP-Referer": referer } : {}),
        "X-Title": appName,
      },
      body: JSON.stringify(orPayload),
    });
  } catch (e) {
    return json(502, { error: "openrouter_fetch_failed", detail: String(e) });
  }

  if (!upstream.ok) {
    const detail = await upstream.text().catch(() => "");
    return json(502, { error: "openrouter_error", status: upstream.status, detail });
  }

  let parsed: any;
  try {
    parsed = await upstream.json();
  } catch (e) {
    return json(502, { error: "openrouter_bad_json", detail: String(e) });
  }

  const content: string = parsed?.choices?.[0]?.message?.content ?? "";
  let extracted: any;
  try {
    extracted = JSON.parse(stripJsonFences(content));
  } catch {
    return json(502, { error: "model_returned_non_json", detail: content.slice(0, 500) });
  }

  return json(200, {
    available: true,
    kind: normalizeKind(extracted.kind),
    full_name: String(extracted.full_name ?? "").trim(),
    id_number: cleanIdNumber(extracted.id_number),
    address: String(extracted.address ?? "").trim(),
    date_of_birth: String(extracted.date_of_birth ?? "").trim(),
    age: normalizeAge(extracted.age),
    sex: normalizeSex(extracted.sex),
    date_of_issue: String(extracted.date_of_issue ?? "").trim(),
    confidence: clampConfidence(extracted.confidence),
  });
});
