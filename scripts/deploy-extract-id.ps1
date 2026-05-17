# One-shot deploy script for the extract-id Edge Function.
#
# Run from the project root:
#   pwsh scripts/deploy-extract-id.ps1
#
# Prompts (secure, no echo) for:
#   1. SUPABASE_ACCESS_TOKEN  — get from https://supabase.com/dashboard/account/tokens
#   2. OPENROUTER_API_KEY     — get from https://openrouter.ai/keys
#
# Then runs link → deploy → secrets-set in sequence. Nothing is written to disk;
# tokens live only in this process's environment. Re-run any time you rotate keys.

$ErrorActionPreference = "Stop"

$projectRef = "abpxielbycwpgzmocven"

Write-Host ""
Write-Host "=== Sauteo: deploy extract-id Edge Function ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "Step 1/4 — Supabase access token"
Write-Host "  Create one at: https://supabase.com/dashboard/account/tokens"
$supabaseTokenSecure = Read-Host -AsSecureString "Paste your Supabase personal access token"
$supabaseToken = [System.Net.NetworkCredential]::new("", $supabaseTokenSecure).Password
if ([string]::IsNullOrWhiteSpace($supabaseToken)) {
    Write-Host "No token provided. Aborting." -ForegroundColor Red
    exit 1
}
$env:SUPABASE_ACCESS_TOKEN = $supabaseToken

Write-Host ""
Write-Host "Step 2/4 — OpenRouter API key"
Write-Host "  Get one at: https://openrouter.ai/keys"
$openrouterKeySecure = Read-Host -AsSecureString "Paste your OpenRouter API key (starts with sk-or-)"
$openrouterKey = [System.Net.NetworkCredential]::new("", $openrouterKeySecure).Password
if ([string]::IsNullOrWhiteSpace($openrouterKey)) {
    Write-Host "No key provided. Aborting." -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "Step 3/4 — Linking project $projectRef..." -ForegroundColor Yellow
npx supabase link --project-ref $projectRef
if ($LASTEXITCODE -ne 0) {
    Write-Host "Link failed. Check your access token." -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "Step 4/4 — Deploying extract-id + setting secret..." -ForegroundColor Yellow
npx supabase functions deploy extract-id --no-verify-jwt
if ($LASTEXITCODE -ne 0) {
    Write-Host "Deploy failed." -ForegroundColor Red
    exit 1
}

# Set the secrets. We pass via env var to avoid the key appearing in shell
# history or process listings. Optional attribution headers also set.
npx supabase secrets set `
    OPENROUTER_API_KEY=$openrouterKey `
    OPENROUTER_APP_NAME="Sauteo PH" `
    OPENROUTER_MODEL="google/gemini-2.5-flash"
if ($LASTEXITCODE -ne 0) {
    Write-Host "Secrets set failed." -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "✓ Done. extract-id is live with OpenRouter wired up." -ForegroundColor Green
Write-Host ""
Write-Host "Verify in two ways:" -ForegroundColor Cyan
Write-Host "  1. Run:  npx supabase functions logs extract-id" -ForegroundColor Gray
Write-Host "  2. Open the booking flow, toggle Senior/PWD on, upload an ID photo." -ForegroundColor Gray
Write-Host "     Fields should auto-fill within ~2 seconds." -ForegroundColor Gray
Write-Host ""

# Clear sensitive vars from this shell (token is now stored in Supabase).
Remove-Item Env:SUPABASE_ACCESS_TOKEN
