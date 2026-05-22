// Invite context — flows the validated booking_invite from the
// `/book/$token` route down to the shared MenuPage in src/routes/index.tsx.
//
// Two consumers:
//   - `/` (no provider)             → useInvite() returns null. Menu is
//     browseable; checkout is gated with a "use your invite link" message.
//   - `/book/$token` (with provider) → useInvite() returns the loaded
//     invite. Customer-info fields prefill and lock; submit passes the
//     token to create_booking() so it's atomically consumed.

import { createContext, useContext } from "react";

export type LoadedInvite = {
  token: string;
  channel: "dine_in" | "pickup";
  customerName: string;
  customerEmail: string | null;
  customerPhone: string | null;
  groupSize: number | null;
  expiresAt: string; // ISO 8601
};

export const InviteContext = createContext<LoadedInvite | null>(null);

export function useInvite(): LoadedInvite | null {
  return useContext(InviteContext);
}

// Customer-facing invite path keyed off the issued channel. Admin link
// copiers feed straight from booking_invites.channel, so a dine-in invite
// always copies as /dine-in/<token> and a pickup invite as /pick-up/<token>.
// /book/<token> still works for back-compat with previously-shared links.
export function inviteLinkPath(
  channel: "dine_in" | "pickup",
  token: string,
): string {
  const segment = channel === "pickup" ? "pick-up" : "dine-in";
  return `/${segment}/${token}`;
}

// Maps SQLSTATE / message from create_booking RPC errors into a friendly
// sentence for the customer. RPC raises these via RAISE EXCEPTION:
//   'invite_required'         P0001
//   'invite_invalid'          P0002
//   'invite_already_used'     P0003
//   'invite_expired'          P0004
//   'invite_channel_mismatch' P0005
// Falls through to the raw message for anything we didn't anticipate so
// debugging stays possible.
export function friendlyBookingError(message: string | undefined): string {
  const m = (message ?? "").toLowerCase();
  if (m.includes("invite_required")) {
    return "Booking requires an invite link from our team. Please reach out on Messenger.";
  }
  if (m.includes("invite_invalid")) {
    return "We couldn't recognize this invite link. Please reach out on Messenger.";
  }
  if (m.includes("invite_already_used")) {
    return "This invite has already been used. Please message us on Messenger if you need help.";
  }
  if (m.includes("invite_expired")) {
    return "This invite has expired. Please message us on Messenger to request a new one.";
  }
  if (m.includes("invite_channel_mismatch")) {
    return "This invite was issued for a different booking type. Please message us on Messenger.";
  }
  if (m.includes("time slot is full")) {
    return "That time slot just filled up — please pick another.";
  }
  return message || "Booking failed. Please try again or message us on Messenger.";
}
