// Client-side bridge to the `extract-id` Supabase Edge Function.
//
// Resizes/compresses the image in the browser before POSTing, then asks
// the function to OCR it. The function returns either:
//   { available: false, reason }    — feature off (no API key set yet)
//   { available: true, ...fields }  — autofill data
//
// We surface both as a single `ExtractIdResult` discriminated union so
// the UI can branch cleanly: on `available: false` we silently fall back
// to manual entry; on `available: true` we autofill.

import { supabase } from "@/integrations/supabase/client";

export type ExtractIdResult =
  | { available: false; reason: string }
  | {
      available: true;
      kind: "senior" | "pwd" | "other";
      full_name: string;
      id_number: string;
      address: string;
      // Added so admins can verify age >= 60 for senior claims. All four
      // are optional in practice — older / non-standard IDs may not have
      // them. The frontend treats empty strings as "skip autofill".
      date_of_birth: string;
      age: string;
      sex: string;
      date_of_issue: string;
      confidence: number;
    };

// Downscale + JPEG-compress so we stay well under the function's 6 MB cap
// and don't waste OpenRouter tokens on huge images. Targets ≤1600px on the
// long edge at q=0.85 — well above what's needed for OCR.
async function fileToCompressedBase64(file: File): Promise<{
  base64: string;
  mimeType: string;
}> {
  const MAX_EDGE = 1600;
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error("image_decode_failed"));
    i.src = dataUrl;
  });

  const longEdge = Math.max(img.naturalWidth, img.naturalHeight);
  const scale = longEdge > MAX_EDGE ? MAX_EDGE / longEdge : 1;
  const w = Math.round(img.naturalWidth * scale);
  const h = Math.round(img.naturalHeight * scale);

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    // Canvas unavailable (very old browser) — fall back to raw file.
    return {
      base64: dataUrl.replace(/^data:[^;]+;base64,/, ""),
      mimeType: file.type || "image/jpeg",
    };
  }
  ctx.drawImage(img, 0, 0, w, h);

  const compressed = canvas.toDataURL("image/jpeg", 0.85);
  return {
    base64: compressed.replace(/^data:image\/jpeg;base64,/, ""),
    mimeType: "image/jpeg",
  };
}

export async function extractIdFromPhoto(
  file: File,
  signal?: AbortSignal,
): Promise<ExtractIdResult> {
  if (signal?.aborted) throw new DOMException("aborted", "AbortError");

  const { base64, mimeType } = await fileToCompressedBase64(file);

  if (signal?.aborted) throw new DOMException("aborted", "AbortError");

  const { data, error } = await supabase.functions.invoke<ExtractIdResult>(
    "extract-id",
    { body: { image_base64: base64, mime_type: mimeType } },
  );

  if (error) {
    // Treat any network/function error as "not available" so the form
    // gracefully degrades to manual entry. The error is logged so devs
    // can find it; the user never sees a broken state.
    console.warn("[extract-id] invocation failed:", error);
    return { available: false, reason: "invocation_failed" };
  }
  if (!data) {
    return { available: false, reason: "no_response" };
  }
  return data;
}
