import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface SiteRule {
  id: string;
  title: string;
  body: string;
}

export type SiteContentKey = "dinein_rules" | "pickup_rules";

export const DINEIN_DEFAULTS: SiteRule[] = [
  {
    id: "available_days",
    title: "Available Wednesday – Sunday",
    body: "Seatings are 1 PM, 3 PM, 5 PM, and 7 PM on Wed–Sun only. We are closed on Mondays and Tuesdays.",
  },
  {
    id: "invite_only",
    title: "Reservations are invite-only",
    body: "Dine-in is waitlist-only. Message us to join the waitlist — we'll send a personal, single-use booking link valid for 24 hours when a seat opens for you.",
  },
  {
    id: "full_payment",
    title: "Full payment secures your seat",
    body: "100% pre-payment via GCash or Maya is required. Send your payment screenshot after booking — your reservation is only confirmed once our team verifies it.",
  },
  {
    id: "no_refunds",
    title: "No refunds — no-shows forfeit payment",
    body: "All sales are final. Cancellations and no-shows forfeit your payment in full. A no-show is recorded 1 hour after your slot time. Please book only if you are sure.",
  },
  {
    id: "arrive_on_time",
    title: "Arrive on time — 15-minute grace",
    body: "Please arrive on time; we recommend 15 minutes early as a courtesy to your party. Your table is held for 15 minutes past your slot before it is released.",
  },
  {
    id: "party_size",
    title: "Party size is fixed at booking",
    body: "The group size you enter is the number of seats reserved. Additional guests on the day may not be accommodated. Please book accurately.",
  },
  {
    id: "intimate_setting",
    title: "Intimate, shared dining experience",
    body: "Sautéo PH is a small, curated dining venue. Guests share the ambiance — please be mindful of noise levels and observe a smart casual dress code.",
  },
];

export const PICKUP_DEFAULTS: SiteRule[] = [
  {
    id: "order_confirmation",
    title: "Order confirmation",
    body: "Your pickup order is confirmed once payment is verified. You will be notified via the contact details provided.",
  },
  {
    id: "payment_required",
    title: "Payment required at checkout",
    body: "Full payment via Maya/GCash is required to confirm your pickup order. Your reference number must be submitted in the booking form.",
  },
  {
    id: "pickup_window",
    title: "Pickup time window",
    body: "Please collect your order within 30 minutes of your selected slot. Unclaimed orders are forfeited after this window.",
  },
  {
    id: "changes_policy",
    title: "No changes after confirmation",
    body: "Order changes or cancellations are not accepted once your booking is confirmed and payment verified.",
  },
  {
    id: "availability",
    title: "Subject to availability",
    body: "Menu items are subject to availability. Our team may contact you if a substitution is needed.",
  },
];

function mergeWithDefaults(defaults: SiteRule[], stored: SiteRule[]): SiteRule[] {
  const storedMap = new Map(stored.map((r) => [r.id, r]));
  return defaults.map((def) => {
    const s = storedMap.get(def.id);
    if (!s) return def;
    return { id: def.id, title: s.title ?? def.title, body: s.body ?? def.body };
  });
}

export async function fetchSiteRules(key: SiteContentKey): Promise<SiteRule[]> {
  const defaults = key === "dinein_rules" ? DINEIN_DEFAULTS : PICKUP_DEFAULTS;
  const { data, error } = await (supabase as any)
    .from("site_content")
    .select("value")
    .eq("key", key)
    .single();
  if (error || !data) return defaults;
  try {
    const raw = typeof data.value === "string" ? data.value : JSON.stringify(data.value);
    const stored: SiteRule[] = JSON.parse(raw);
    return mergeWithDefaults(defaults, stored);
  } catch {
    return defaults;
  }
}

export async function saveSiteRules(
  key: SiteContentKey,
  rules: SiteRule[],
): Promise<{ error: string | null }> {
  const { error } = await (supabase as any)
    .from("site_content")
    .upsert({ key, value: rules, updated_at: new Date().toISOString() }, { onConflict: "key" });
  return { error: error ? (error.message as string) : null };
}

export function useSiteRules(key: SiteContentKey): SiteRule[] {
  const defaults = key === "dinein_rules" ? DINEIN_DEFAULTS : PICKUP_DEFAULTS;
  const [rules, setRules] = useState<SiteRule[]>(defaults);
  useEffect(() => {
    fetchSiteRules(key).then(setRules);
  }, [key]);
  return rules;
}
