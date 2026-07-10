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

// slotDate: "YYYY-MM-DD" (bookings.time_slots.slot_date). slotTime is kept in
// the signature for call-site stability but isn't used in the copy below —
// Nikko's wording assumes the guest already knows their reserved time from
// the payment-confirmation message and deliberately doesn't restate it (see
// the "WAIT OUTSIDE ... UNTIL YOU ARE CALLED" line, which references "YOUR
// RESERVED TIME" the same way). today: caller-supplied YYYY-MM-DD "today"
// (localToday()) so this stays a pure function.
export function buildReminderMessage(
  customerName: string | null | undefined,
  slotDate: string,
  slotTime: string | null | undefined,
  today: string,
): string {
  const name = titleCase(customerName) || "there";

  const tomorrow = new Date(`${today}T00:00:00`);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = format(tomorrow, "yyyy-MM-dd");

  const when =
    slotDate === today
      ? "today"
      : slotDate === tomorrowStr
      ? "tomorrow"
      : format(new Date(`${slotDate}T00:00:00`), "EEEE, MMM d");

  return `Hi ${name}, this is a gentle reminder of your reservation ${when}.\n\nKindly note that we accept MAYA Philippines payment only for any additional items ordered during your visit.\n\nIF YOU ARRIVE EARLIER THAN YOUR RESERVED TIME, WE KINDLY ASK THAT YOU WAIT OUTSIDE THE RESTAURANT UNTIL YOU ARE CALLED.\n\n❗ No outside food or drinks allowed.\n\n❗ No pets allowed.\n\nTAKEOUT POLICY\n❗ Only unfinished burgers may be packed for takeout. Sides, teas, and all other menu items are for dine-in only and cannot be taken out.\n\nCANCELLATION / NO-SHOW POLICY\n❗ A ₱500 fee per guest will be deducted in the event of a cancellation or no-show. The remaining balance will be refunded via MAYA through our official channels.\n\nThank you\n— Sautéo`;
}
