// Manual reservation-reminder message, copied for a "Message on Facebook"
// person-to-person DM — the same channel-choice reasoning as
// buildInviteMessage in src/lib/invite.ts: Messenger's 24h (bot) / 7-day
// (human agent) windows don't apply to a normal profile-to-profile message,
// so staff can reach a guest regardless of when they last messaged the page.
//
// Built 2026-07-09 after WF03 ("24-Hour Guest Reminder") and WF10
// ("Reservation Arrival Reminder") were deactivated — their automated
// Messenger DM used the CONFIRMED_EVENT_UPDATE tag, deprecated by Meta
// 2026-01-12 (always fails), and their guest email nodes were fully
// disconnected dead code that never ran. Guests were never actually
// reminded. Nikko now sends this manually instead.

import { format } from "date-fns";

function titleCase(s: string | null | undefined): string {
  return String(s ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase()
    .replace(/(^|[\s'-])(\p{L})/gu, (_m, sep, ch) => sep + ch.toUpperCase());
}

function formatSlotTime12h(timeStr: string | null | undefined): string {
  if (!timeStr) return "";
  const [hh, mm = "00"] = timeStr.split(":");
  const h = parseInt(hh, 10);
  if (Number.isNaN(h)) return timeStr;
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${mm} ${period}`;
}

// slotDate: "YYYY-MM-DD" (bookings.time_slots.slot_date). slotTime:
// "HH:MM:SS" (bookings.time_slots.slot_time). today: caller-supplied
// YYYY-MM-DD "today" (localToday()) so this stays a pure function.
export function buildReminderMessage(
  customerName: string | null | undefined,
  slotDate: string,
  slotTime: string | null | undefined,
  today: string,
): string {
  const name = titleCase(customerName) || "there";
  const time = formatSlotTime12h(slotTime);

  const tomorrow = new Date(`${today}T00:00:00`);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = format(tomorrow, "yyyy-MM-dd");

  const when =
    slotDate === today
      ? "today"
      : slotDate === tomorrowStr
      ? "tomorrow"
      : format(new Date(`${slotDate}T00:00:00`), "EEEE, MMM d");

  return `Hi ${name}! 🍔\n\nJust a friendly reminder — your Sautéo table is reserved for ${when} at ${time}. We look forward to welcoming you!\n\nIf anything's changed or you need to reach us, just reply here.\n\n— Sautéo`;
}
