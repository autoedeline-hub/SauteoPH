import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import {
  CalendarClock,
  MessageCircle,
  Users,
  CheckCircle2,
  BookOpen,
} from "lucide-react";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { useBookingRulesDisplay, type DisplayRule } from "@/lib/siteContent";

// Public-facing dine-in marketing page. Booking is invite-only — guests
// reach the actual reservation flow only via /dine-in/<token>, which the
// admin issues from the Waitlist tab after the Messenger waitlist clears.
// This page therefore funnels visitors straight to Messenger; it does NOT
// render the menu or any checkout UI of its own.
const MESSENGER_URL = "https://www.facebook.com/messages/t/1119234891273865";

export const Route = createFileRoute("/dine-in")({
  component: DineInPage,
  head: () => ({
    meta: [
      { title: "Reserve a table — Sautéo" },
      {
        name: "description",
        content:
          "Reserve a table at Sautéo. Pick your time slot, share your party size, and we'll have your seat ready.",
      },
    ],
  }),
});

function DineInPage() {
  const [rulesAccepted, setRulesAccepted] = useState(false);

  if (!rulesAccepted) {
    return <DineInAgreement onAccept={() => setRulesAccepted(true)} />;
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1 w-full max-w-3xl mx-auto px-4 sm:px-6 py-12 md:py-20">
        <div className="text-center mb-10 md:mb-14">
          <div className="mx-auto h-16 w-16 rounded-full bg-mustard/30 flex items-center justify-center mb-6">
            <CalendarClock className="h-7 w-7 text-primary" />
          </div>
          <h1 className="font-display text-3xl md:text-5xl mb-3">
            Reserve your table at Sautéo
          </h1>
          <p className="text-muted-foreground text-base md:text-lg max-w-xl mx-auto">
            An intimate dining experience. Pick your time slot, share your
            party size, and we'll have your seat ready.
          </p>
        </div>

        <div className="grid gap-3 md:gap-4 md:grid-cols-3 mb-10 md:mb-12">
          <IntroPoint
            icon={<CalendarClock className="h-5 w-5 text-primary" />}
            title="Pick a time slot"
            body="See live availability and reserve in a few taps."
          />
          <IntroPoint
            icon={<Users className="h-5 w-5 text-primary" />}
            title="Bring your group"
            body="Reserve for one or share the table — let us know the party size."
          />
          <IntroPoint
            icon={<MessageCircle className="h-5 w-5 text-primary" />}
            title="Invite-only"
            body="Reach out on Messenger to get your one-time booking link."
          />
        </div>

        <div className="flex justify-center">
          <a
            href={rulesAccepted ? MESSENGER_URL : undefined}
            target="_blank"
            rel="noreferrer"
            aria-disabled={!rulesAccepted}
            className={`inline-flex items-center gap-2 rounded-full bg-primary text-primary-foreground px-6 py-3 text-sm md:text-base font-semibold transition ${
              rulesAccepted
                ? "hover:opacity-90"
                : "opacity-40 cursor-not-allowed pointer-events-none"
            }`}
          >
            <MessageCircle className="h-4 w-4" />
            Chat on Messenger
          </a>
        </div>
      </main>
      <Footer />
    </div>
  );
}

// Hardcoded fallback shown until booking_rules loads (offline/SSR-safe). Mirrors
// the admin's dine-in seed; live edits in /admin#rules overlay this once fetched.
const DINEIN_FALLBACK: DisplayRule[] = [
  { id: "available_days", group_label: "Reservation Rules", title: "Available Wednesday – Sunday", body: "Seatings are 1 PM, 3 PM, 5 PM, and 7 PM on Wed–Sun only. We are closed on Mondays and Tuesdays." },
  { id: "invite_only", group_label: "Reservation Rules", title: "Reservations are invite-only", body: "Dine-in is waitlist-only. Message us to join the waitlist — we'll send a personal, single-use booking link valid for 24 hours when a seat opens for you." },
  { id: "full_payment", group_label: "Reservation Rules", title: "Full payment secures your seat", body: "100% pre-payment via GCash or Maya is required. Send your payment screenshot after booking — your reservation is only confirmed once our team verifies it." },
  { id: "no_refunds", group_label: "Reservation Rules", title: "Cancellation & no-show policy", body: "In the event of a cancellation or no-show, a refund is issued less a ₱500 cancellation fee per guest, regardless of the reason. A no-show is recorded 30 minutes after your slot time. Please book only if you are sure." },
  { id: "arrive_on_time", group_label: "Dining Guidelines", title: "Arrive on time — 15-minute grace", body: "Please arrive on time; we recommend 15 minutes early as parking is limited. Your table is held for 15 minutes past your slot, then may be released to a waitlist or walk-in guest." },
  { id: "party_size", group_label: "Dining Guidelines", title: "Book your exact party size", body: "Reserve only the seats you need and arrive with the exact party size booked. We can't seat extra guests beyond your reservation." },
  { id: "intimate_setting", group_label: "Dining Guidelines", title: "An intimate setting — smart casual", body: "Sautéo is an intimate venue. Dress smart casual, keep voices low, and please bring no outside food or drinks — be considerate of fellow diners." },
];

// Full-page booking-policy agreement with an explicit consent checkbox, matching
// the /pick-up agreement. Rules come from the admin-editable booking_rules table.
function DineInAgreement({ onAccept }: { onAccept: () => void }) {
  const rules = useBookingRulesDisplay("dinein", DINEIN_FALLBACK);
  const [checked, setChecked] = useState(false);

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1 w-full px-4 sm:px-6 py-8">
        <div className="max-w-md mx-auto">
          <div className="flex justify-center mb-6">
            <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center">
              <BookOpen className="h-7 w-7 text-primary" />
            </div>
          </div>

          <h1 className="font-display text-2xl md:text-3xl text-center mb-2">
            Before you book
          </h1>
          <p className="text-center text-muted-foreground text-sm mb-6 leading-relaxed">
            Please read and agree to Sautéo's booking policy<br />before choosing your slot.
          </p>

          <div className="space-y-3 mb-6">
            {rules.map((rule) => (
              <div key={rule.id} className="bg-card border border-border rounded-xl p-4 flex gap-3">
                <CheckCircle2 className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold leading-snug">{rule.title}</p>
                  <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{rule.body}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="text-center mb-5">
            <a
              href="/terms"
              className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground transition"
            >
              Read full Terms &amp; Privacy Policy
            </a>
          </div>

          <label className="flex items-start gap-3 cursor-pointer mb-6 select-none">
            <input
              type="checkbox"
              checked={checked}
              onChange={(e) => setChecked(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-border accent-primary cursor-pointer shrink-0"
            />
            <span className="text-sm text-muted-foreground leading-snug">
              I have read and agree to Sautéo's booking policy. I understand that{" "}
              <span className="text-foreground font-semibold">cancellations</span> and{" "}
              <span className="text-foreground font-semibold">no-shows</span> are subject to a{" "}
              <span className="text-foreground font-semibold">₱500 cancellation fee per guest</span>, with the remaining balance refunded via Maya.
            </span>
          </label>

          <button
            disabled={!checked}
            onClick={onAccept}
            className="w-full rounded-full bg-primary text-primary-foreground py-3 text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 transition"
          >
            I agree — proceed to booking
          </button>
        </div>
      </main>
      <Footer />
    </div>
  );
}

function IntroPoint({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="bg-card border border-border rounded-2xl p-5 shadow-sm">
      <div className="h-10 w-10 rounded-full bg-mustard/30 flex items-center justify-center mb-3">
        {icon}
      </div>
      <h3 className="font-display text-lg mb-1">{title}</h3>
      <p className="text-muted-foreground text-sm leading-relaxed">{body}</p>
    </div>
  );
}
