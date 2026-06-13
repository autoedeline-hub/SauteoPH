// Editable guest-facing rule copy, backed by the Supabase `site_content` table.
// This module is the ONLY place that touches that table. The generated Supabase
// `Database` type does not include `site_content`, so DB access is cast here once
// and the rest of the app consumes the typed interfaces below.
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface SiteRule {
  id: string;
  title: string;
  body: string;
}

export type SiteContentKey = "dinein_rules" | "pickup_rules";

export const DINEIN_DEFAULTS: SiteRule[] = [
  { id: "available_days", title: "Available Wednesday – Sunday", body: "Seatings are 1 PM, 3 PM, 5 PM, and 7 PM on Wed–Sun only. We are closed on Mondays and Tuesdays." },
  { id: "invite_only", title: "Reservations are invite-only", body: "Dine-in is waitlist-only. Message us to join the waitlist — we'll send a personal, single-use booking link valid for 24 hours when a seat opens for you." },
  { id: "full_payment", title: "Full payment secures your seat", body: "100% pre-payment via GCash or Maya is required. Send your payment screenshot after booking — your reservation is only confirmed once our team verifies it." },
  { id: "no_refunds", title: "No refunds — no-shows forfeit payment", body: "All sales are final. Cancellations and no-shows forfeit your payment in full. A no-show is recorded 1 hour after your slot time. Please book only if you are sure." },
  { id: "arrive_on_time", title: "Arrive on time — 15-minute grace", body: "Please arrive on time; we recommend 15 minutes early as parking is limited. Your table is held for 15 minutes past your slot, then may be released to a waitlist or walk-in guest." },
  { id: "party_size", title: "Book your exact party size", body: "Reserve only the seats you need and arrive with the exact party size booked. We can't seat extra guests beyond your reservation." },
  { id: "intimate_setting", title: "An intimate setting — smart casual", body: "Sautéo is an intimate venue. Dress smart casual, keep voices low, and please bring no outside food or drinks — be considerate of fellow diners." },
];

export const PICKUP_DEFAULTS: SiteRule[] = [
  { id: "cutoff", title: "Cut-off is 6 PM the day before", body: "Orders must be placed by 6:00 PM the day before your chosen pick-up date. Late orders will not be accepted." },
  { id: "available_days", title: "Available Wednesday – Sunday", body: "Pick-up windows are 4 PM, 6 PM, and 8 PM on Wed–Sun only. No pick-up on Mondays and Tuesdays." },
  { id: "full_payment", title: "Full payment secures your order", body: "Send your GCash or Maya payment screenshot after checkout. Your order is only confirmed once payment is verified by our team." },
  { id: "no_refunds", title: "No refunds — no exceptions", body: "All pick-up orders are non-refundable. Cancellations forfeit your payment in full. Please order only if you are sure." },
  { id: "be_on_time", title: "Be on time for pick-up", body: "Orders are prepared fresh for your slot. Please arrive on time. Unclaimed orders after 30 minutes may be forfeited." },
];

const DEFAULTS: Record<SiteContentKey, SiteRule[]> = {
  dinein_rules: DINEIN_DEFAULTS,
  pickup_rules: PICKUP_DEFAULTS,
};

// Anchor on defaults (fixed ids/order); overlay stored title/body when present.
// This keeps the page matched to its hardcoded icons even if the stored JSON is
// reordered, partial, or has stray ids.
function mergeWithDefaults(key: SiteContentKey, stored: SiteRule[] | null | undefined): SiteRule[] {
  if (!stored || !Array.isArray(stored)) return DEFAULTS[key];
  const byId = new Map(stored.map((r) => [r.id, r]));
  return DEFAULTS[key].map((d) => {
    const s = byId.get(d.id);
    return s ? { id: d.id, title: s.title ?? d.title, body: s.body ?? d.body } : d;
  });
}

export async function fetchSiteRules(key: SiteContentKey): Promise<SiteRule[]> {
  try {
    const { data, error } = await (supabase as any)
      .from("site_content")
      .select("rules")
      .eq("key", key)
      .maybeSingle();
    if (error) return DEFAULTS[key];
    return mergeWithDefaults(key, data?.rules as SiteRule[] | undefined);
  } catch {
    return DEFAULTS[key];
  }
}

export async function saveSiteRules(
  key: SiteContentKey,
  rules: SiteRule[],
): Promise<{ error: string | null }> {
  try {
    const { error } = await (supabase as any)
      .from("site_content")
      .upsert({ key, rules }, { onConflict: "key" });
    return { error: error ? error.message : null };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Unknown error" };
  }
}

// Public-page hook: starts from defaults (no flicker / offline-safe), then
// overlays the stored copy once it loads.
export function useSiteRules(key: SiteContentKey): SiteRule[] {
  const [rules, setRules] = useState<SiteRule[]>(DEFAULTS[key]);
  useEffect(() => {
    let alive = true;
    fetchSiteRules(key).then((r) => {
      if (alive) setRules(r);
    });
    return () => {
      alive = false;
    };
  }, [key]);
  return rules;
}
