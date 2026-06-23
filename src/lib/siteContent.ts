import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type RuleSection = "dinein" | "pickup";

export interface BookingRule {
  id: string;
  section: RuleSection;
  group_label: string;
  title: string;
  body: string;
  sort_order: number;
}

export async function fetchBookingRules(section: RuleSection): Promise<BookingRule[]> {
  const { data, error } = await supabase
    .from("booking_rules")
    .select("*")
    .eq("section", section)
    .order("sort_order", { ascending: true });
  if (error || !data) return [];
  return data as BookingRule[];
}

export function useBookingRules(section: RuleSection): BookingRule[] {
  const [rules, setRules] = useState<BookingRule[]>([]);
  useEffect(() => {
    fetchBookingRules(section).then(setRules);
  }, [section]);
  return rules;
}

export interface DisplayRule {
  id: string;
  group_label: string;
  title: string;
  body: string;
}

// Guest-page hook: start from a hardcoded fallback (no flicker, offline-safe),
// then overlay the admin-managed `booking_rules` once they load. This is the
// bridge that makes admin /admin#rules edits reach the public pages: every
// guest rule surface reads booking_rules through here.
export function useBookingRulesDisplay(
  section: RuleSection,
  fallback: DisplayRule[],
): DisplayRule[] {
  const [rules, setRules] = useState<DisplayRule[]>(fallback);
  useEffect(() => {
    let alive = true;
    fetchBookingRules(section).then((rows) => {
      if (!alive || rows.length === 0) return;
      setRules(
        rows.map((r) => ({
          id: r.id,
          group_label: r.group_label,
          title: r.title,
          body: r.body,
        })),
      );
    });
    return () => {
      alive = false;
    };
  }, [section]);
  return rules;
}
