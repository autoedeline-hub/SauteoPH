# extract-id

Vision-LLM ID extractor used by the Senior/PWD claim form in the checkout
flow. Accepts a base64-encoded photo of a Philippine government ID and
returns structured fields (name, ID number, address, kind, confidence).

## Behavior when no key is set

If `OPENROUTER_API_KEY` is not set, the function returns
`200 { available: false, reason: "no_api_key" }`. The frontend treats this
as "auto-fill is off" and falls back to manual entry — no UI errors, no
console noise. This lets you ship the form before provisioning the key.

## Setup

1. Get an OpenRouter API key at <https://openrouter.ai/keys>.
2. Deploy the function:
   ```bash
   supabase functions deploy extract-id --no-verify-jwt
   ```
   `--no-verify-jwt` is intentional — checkout is anonymous (no login) and
   this function never touches the database.
3. Set the secret:
   ```bash
   supabase secrets set OPENROUTER_API_KEY=sk-or-...
   ```
4. Optional overrides:
   ```bash
   supabase secrets set OPENROUTER_MODEL=google/gemini-2.5-flash
   supabase secrets set OPENROUTER_REFERER=https://your-domain.com
   supabase secrets set OPENROUTER_APP_NAME="Sauteo PH"
   ```

## Model choice

Default is `google/gemini-2.5-flash` — fast, cheap (~₱0.02–0.05 per ID),
and reliably returns valid JSON. Alternatives:

- `anthropic/claude-haiku-4.5` — strong vision, slightly pricier
- `openai/gpt-4o-mini` — good fallback

Swap via the `OPENROUTER_MODEL` secret without redeploying the function.

## Calling from the frontend

```ts
const { data } = await supabase.functions.invoke("extract-id", {
  body: { image_base64, mime_type: "image/jpeg" },
});
// data: { available: false } | { available: true, kind, full_name, ... }
```

## Cost guardrails

- Images are capped at ~6 MB base64 (~4.5 MB raw) by the function itself.
- The frontend should pre-compress (resize to ≤1600px long edge, JPEG q≈0.85)
  before calling — that's plenty for OCR and keeps tokens low.
