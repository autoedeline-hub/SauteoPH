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
