import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Format a PostgreSQL "HH:MM" or "HH:MM:SS" booking slot time into a
// customer-friendly 12-hour string, e.g. "13:00" → "1:00 PM". Midnight
// and noon return "12:00 AM" and "12:00 PM" respectively. Bad inputs
// fall back to whatever was passed in so we never blank out a UI cell.
export function formatSlotTime12h(timeStr: string | null | undefined): string {
  if (!timeStr) return "";
  const [hh, mm = "00"] = timeStr.split(":");
  const h = parseInt(hh, 10);
  if (Number.isNaN(h)) return timeStr;
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${mm} ${period}`;
}
