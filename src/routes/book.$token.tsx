import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { AlertTriangle, CheckCircle2, Loader2, MessageCircle, ScrollText } from "lucide-react";
import { InviteContext, type LoadedInvite } from "@/lib/invite";
import { useBookingRulesDisplay, type DisplayRule } from "@/lib/siteContent";
import { MenuPage } from "./index";

export const Route = createFileRoute("/book/$token")({
  component: BookRouteComponent,
  head: () => ({
    meta: [
      { title: "Confirm your reservation — Sautéo" },
      // Don't index invite pages — they're personal links.
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
});

function BookRouteComponent() {
  const { token } = Route.useParams();
  return <BookByInvite token={token} />;
}

// What lookup_invite() returns. Discriminated union so the UI can branch
// without ad-hoc string checks elsewhere.
type LookupResult =
  | { status: "valid"; channel: "dine_in" | "pickup"; customer_name: string;
      customer_email: string | null; customer_phone: string | null;
      group_size: number | null; expires_at: string;
      slot_id: string | null; slot_date: string | null; slot_time: string | null }
  | { status: "invalid" }
  | { status: "used" }
  | { status: "expired" };

// Exported so /dine-in/$token and /pick-up/$token can reuse the same
// invite-validation + MenuPage rendering pipeline. Each route file owns
// its own Route.useParams() call and passes the token in here.
export function BookByInvite({ token }: { token: string }) {
  type ViewState =
    | { kind: "loading" }
    | { kind: "rules"; invite: LoadedInvite }
    | { kind: "valid"; invite: LoadedInvite }
    | { kind: "blocked"; reason: "invalid" | "used" | "expired" | "load_failed" };
  const [state, setState] = useState<ViewState>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await (supabase.rpc as any)("lookup_invite", {
        _token: token,
      });
      if (cancelled) return;
      if (error) {
        console.warn("[invite] lookup failed:", error);
        setState({ kind: "blocked", reason: "load_failed" });
        return;
      }
      const result = (data ?? { status: "invalid" }) as LookupResult;
      if (result.status !== "valid") {
        setState({ kind: "blocked", reason: result.status });
        return;
      }
      setState({
        kind: "rules",
        invite: {
          token,
          channel: result.channel,
          customerName: result.customer_name,
          customerEmail: result.customer_email,
          customerPhone: result.customer_phone,
          groupSize: result.group_size,
          expiresAt: result.expires_at,
          lockedSlotId: result.slot_id,
          lockedSlotDate: result.slot_date,
          lockedSlotTime: result.slot_time,
        },
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (state.kind === "loading") {
    return (
      <div className="min-h-screen flex flex-col">
        <Header />
        <main className="flex-1 w-full max-w-2xl mx-auto px-4 sm:px-6 py-12 flex items-center justify-center">
          <div className="flex flex-col items-center gap-3 text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin" />
            <p className="text-sm">Checking your invite…</p>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  if (state.kind === "blocked") {
    return <InviteBlocked reason={state.reason} />;
  }

  if (state.kind === "rules") {
    return (
      <BookingRules
        invite={state.invite}
        onAgree={() => setState({ kind: "valid", invite: state.invite })}
      />
    );
  }

  // Provider injects the invite into MenuPage's useInvite() — that's what
  // flips the page from "Booking is invite-only" to the real reservation
  // form with prefilled customer info + the invite_token attached to the
  // create_booking RPC call on submit.
  return (
    <InviteContext.Provider value={state.invite}>
      <MenuPage />
    </InviteContext.Provider>
  );
}

const DINE_IN_RULES = [
  {
    heading: "Available Wednesday – Sunday",
    body: "Seatings are 1 PM, 3 PM, 5 PM, and 7 PM on Wed–Sun only. We are closed on Mondays and Tuesdays. Your slot date falls within the open service week.",
  },
  {
    heading: "Reservation is invite-only",
    body: "Dine-in bookings are waitlist-only. Your invite link is personal, single-use, and valid for 24 hours. Do not share it — it is locked to your name and cannot be transferred.",
  },
  {
    heading: "Full payment secures your seat",
    body: "100% pre-payment via GCash or Maya is required. Your reservation is only confirmed once payment is verified by our team. Unpaid bookings are automatically released after 30 minutes.",
  },
  {
    heading: "Cancellation & no-show policy",
    body: "In the event of a cancellation or no-show, a refund is issued less a ₱500 cancellation fee per guest, regardless of the reason. A no-show is recorded 30 minutes after your slot time. Please message us in advance if your plans change.",
  },
  {
    heading: "Arrive on time — 15-minute grace",
    body: "Please arrive on time; we recommend 15 minutes early as parking is limited. Your table is held for 15 minutes past your slot, then may be released to a waitlist or walk-in guest.",
  },
  {
    heading: "Book your exact party size",
    body: "Reserve only the seats you need and arrive with the exact party size booked. We can't seat extra guests beyond your reservation.",
  },
  {
    heading: "An intimate setting — smart casual",
    body: "Sautéo is an intimate venue. Dress smart casual, keep voices low, and please bring no outside food or drinks — be considerate of fellow diners.",
  },
];

const PICKUP_RULES = [
  {
    heading: "1. Pre-Order Policy",
    body: "All orders are accepted on a pre-order basis only and are scheduled for the next available business day. Orders are prepared fresh based on the selected pickup schedule.",
  },
  {
    heading: "2. No Cancellation Policy",
    body: "Once an order has been placed and payment has been confirmed, it is considered final. No cancellations, modifications, refunds, or transfers will be permitted after order confirmation.",
  },
  {
    heading: "3. Pickup Schedule",
    body: "You may select your preferred pickup time: 4:00 PM, 6:00 PM, or 8:00 PM. Pickup times are estimates and may be subject to operational adjustments.",
  },
  {
    heading: "4. Rider Booking Requirement",
    body: "If arranging third-party delivery (e.g. Lalamove, Grab), wait for our confirmation that the order is ready before booking a rider. We are not responsible for rider waiting fees or delays incurred when a rider is booked early.",
  },
  {
    heading: "5. Fresh Preparation & Pickup Responsibility",
    body: "All items are prepared fresh to maintain quality. You are responsible for collecting your order within your selected pickup window. Orders not collected may be considered abandoned and forfeited without refund.",
  },
  {
    heading: "6. Payment Terms",
    body: "Full payment is required before order preparation and pickup. Orders will only be processed after payment has been received and verified.",
  },
  {
    heading: "7. Discounts",
    body: "Senior Citizen and PWD discounts are not applicable to pickup orders unless otherwise required by applicable law.",
  },
];

// Hardcoded dine-in rules mapped into the booking_rules display shape — the
// offline/first-paint fallback before the live admin rules load.
const DINE_IN_FALLBACK: DisplayRule[] = DINE_IN_RULES.map((r, i) => ({
  id: String(i),
  group_label: "",
  title: r.heading,
  body: r.body,
}));

const PICKUP_FALLBACK: DisplayRule[] = PICKUP_RULES.map((r, i) => ({
  id: String(i),
  group_label: "",
  title: r.heading,
  body: r.body,
}));

function BookingRules({
  invite,
  onAgree,
}: {
  invite: LoadedInvite;
  onAgree: () => void;
}) {
  const [checked, setChecked] = useState(false);
  const isPickup = invite.channel === "pickup";
  // Both invite agreements read the admin-editable booking_rules so /admin#rules
  // edits show on the live invite links; the hardcoded sets are the fallback.
  const liveRules = useBookingRulesDisplay(
    isPickup ? "pickup" : "dinein",
    isPickup ? PICKUP_FALLBACK : DINE_IN_FALLBACK,
  );
  const rules = liveRules.map((r) => ({ heading: r.title, body: r.body }));

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1 w-full max-w-xl mx-auto px-4 sm:px-6 py-10 md:py-16">
        <div className="flex flex-col items-center text-center mb-8">
          <div className="h-14 w-14 rounded-full bg-mustard/30 flex items-center justify-center mb-4">
            <ScrollText className="h-6 w-6 text-primary" />
          </div>
          <h1 className="font-display text-2xl md:text-3xl mb-2">
            {isPickup
              ? "Pre-Order Agreement & Terms of Purchase"
              : `Before you book, ${invite.customerName.split(" ")[0]}`}
          </h1>
          <p className="text-muted-foreground text-sm md:text-base max-w-sm">
            {isPickup
              ? "By placing an order you acknowledge that you have read, understood, and agreed to the following terms."
              : "Please read and agree to Sautéo's booking policy before choosing your slot."}
          </p>
        </div>

        <div className="space-y-3 mb-8">
          {rules.map((rule, i) => (
            <div
              key={i}
              className="bg-card border border-border rounded-2xl p-4 shadow-sm text-left"
            >
              <div className="flex items-start gap-3">
                <CheckCircle2 className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-foreground leading-snug">
                    {rule.heading}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                    {rule.body}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="mb-6 text-center">
          <Link
            to="/terms"
            target="_blank"
            className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground transition"
          >
            Read full Terms &amp; Privacy Policy
          </Link>
        </div>

        <label className="flex items-start gap-3 mb-6 cursor-pointer">
          <input
            type="checkbox"
            checked={checked}
            onChange={(e) => setChecked(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-border accent-primary shrink-0"
          />
          <span className="text-sm text-foreground leading-snug">
            {isPickup
              ? "I have read and agree to the Pre-Order Agreement & Terms of Purchase."
              : "I have read and agree to Sautéo's booking policy. I understand that cancellations and no-shows are subject to a ₱500 cancellation fee per guest, with the remaining balance refunded via Maya."}
          </span>
        </label>

        <button
          type="button"
          onClick={onAgree}
          disabled={!checked}
          className="w-full rounded-full bg-primary text-primary-foreground px-6 py-3 text-sm font-semibold hover:opacity-90 transition disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {isPickup ? "I agree — proceed to order" : "I agree — proceed to booking"}
        </button>
      </main>
      <Footer />
    </div>
  );
}

const REASON_COPY: Record<
  "invalid" | "used" | "expired" | "load_failed",
  { title: string; body: string }
> = {
  invalid: {
    title: "Invite not recognized",
    body: "We couldn't find this booking link. Double-check the link from your Messenger conversation, or message us if it still doesn't work.",
  },
  used: {
    title: "This invite has already been used",
    body: "Each booking link works once. If you need to make a change or rebook, please message us on Messenger.",
  },
  expired: {
    title: "This invite has expired",
    body: "Booking links are valid for 72 hours. Message us on Messenger and we'll send you a fresh one.",
  },
  load_failed: {
    title: "We couldn't verify your invite",
    body: "Something went wrong checking your booking link. Try refreshing this page. If it keeps happening, message us on Messenger.",
  },
};

function InviteBlocked({
  reason,
}: {
  reason: "invalid" | "used" | "expired" | "load_failed";
}) {
  const copy = REASON_COPY[reason];
  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1 w-full max-w-xl mx-auto px-4 sm:px-6 py-12 flex items-center justify-center">
        <div className="bg-card border border-border rounded-2xl p-6 md:p-8 shadow-sm text-center w-full">
          <div className="mx-auto h-14 w-14 rounded-full bg-destructive/10 flex items-center justify-center mb-5">
            <AlertTriangle className="h-6 w-6 text-destructive" />
          </div>
          <h1 className="font-display text-2xl md:text-3xl mb-2">{copy.title}</h1>
          <p className="text-muted-foreground text-sm leading-relaxed mb-6">
            {copy.body}
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <a
              href="https://m.me/1119234891273865"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center justify-center gap-2 rounded-full bg-primary text-primary-foreground px-5 py-3 text-sm font-semibold hover:opacity-90 transition"
            >
              <MessageCircle className="h-4 w-4" />
              Message Sautéo
            </a>
            <Link
              to="/"
              className="inline-flex items-center justify-center gap-2 rounded-full bg-muted text-foreground px-5 py-3 text-sm font-semibold hover:bg-muted/70 transition"
            >
              View menu
            </Link>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
