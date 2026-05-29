import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// "Today" in the restaurant's local timezone, as YYYY-MM-DD. Sautéo runs
// in PH (UTC+8); `new Date().toISOString().slice(0, 10)` returns the UTC
// date, which is 8 hours behind PH and silently surfaces yesterday's
// elapsed slots during the PH morning. Use this everywhere we want
// "today" for slot/booking date filtering.
//
// Note: this is timezone-of-the-browser, not strictly PH. Customers
// always book from PH so they line up; admins outside PH would see
// "today" as their own local date, which is the right read for them too
// since they're managing slots in restaurant-local language.
export function localToday(): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
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
