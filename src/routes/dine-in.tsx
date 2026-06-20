import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import {
  CalendarClock,
  MessageCircle,
  Users,
  CalendarDays,
  CreditCard,
  AlertTriangle,
  Clock,
  Sparkles,
  ChevronRight,
  CheckCircle2,
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

  return (
    <div className="min-h-screen flex flex-col">
      {!rulesAccepted && (
        <DineInRulesModal onAccept={() => setRulesAccepted(true)} />
      )}
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
  { id: "no_refunds", group_label: "Reservation Rules", title: "No refunds — no-shows forfeit payment", body: "All sales are final. Cancellations and no-shows forfeit your payment in full. A no-show is recorded 1 hour after your slot time. Please book only if you are sure." },
  { id: "arrive_on_time", group_label: "Dining Guidelines", title: "Arrive on time — 15-minute grace", body: "Please arrive on time; we recommend 15 minutes early as parking is limited. Your table is held for 15 minutes past your slot, then may be released to a waitlist or walk-in guest." },
  { id: "party_size", group_label: "Dining Guidelines", title: "Book your exact party size", body: "Reserve only the seats you need and arrive with the exact party size booked. We can't seat extra guests beyond your reservation." },
  { id: "intimate_setting", group_label: "Dining Guidelines", title: "An intimate setting — smart casual", body: "Sautéo is an intimate venue. Dress smart casual, keep voices low, and please bring no outside food or drinks — be considerate of fellow diners." },
];

// Decorative icons applied by display position (the admin controls order via
// sort_order). Falls back to a neutral check when there are more rules than icons.
const DINEIN_ICONS: React.ReactNode[] = [
  <CalendarDays className="h-4 w-4 text-blue-500" />,
  <MessageCircle className="h-4 w-4 text-primary" />,
  <CreditCard className="h-4 w-4 text-green-500" />,
  <AlertTriangle className="h-4 w-4 text-red-500" />,
  <Clock className="h-4 w-4 text-amber-500" />,
  <Users className="h-4 w-4 text-primary" />,
  <Sparkles className="h-4 w-4 text-mustard" />,
];

// Group rules by their label, preserving first-seen (sort_order) order.
function groupDineInRules(rules: DisplayRule[]) {
  const order: string[] = [];
  const map = new Map<string, { title: string; body: string; icon: React.ReactNode }[]>();
  rules.forEach((r, i) => {
    if (!map.has(r.group_label)) {
      map.set(r.group_label, []);
      order.push(r.group_label);
    }
    map.get(r.group_label)!.push({
      title: r.title,
      body: r.body,
      icon: DINEIN_ICONS[i] ?? <CheckCircle2 className="h-4 w-4 text-primary" />,
    });
  });
  return order.map((label) => ({ label, items: map.get(label)! }));
}

function DineInRulesModal({ onAccept }: { onAccept: () => void }) {
  const rules = useBookingRulesDisplay("dinein", DINEIN_FALLBACK);
  const groups = useMemo(() => groupDineInRules(rules), [rules]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className="relative w-full max-w-md bg-background rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="bg-primary px-6 py-5">
          <div className="flex items-center gap-3">
            <CalendarClock className="h-5 w-5 text-primary-foreground shrink-0" />
            <div>
              <h2 className="font-display text-lg text-primary-foreground leading-tight">
                Dine-In Reservation Rules
              </h2>
              <p className="text-primary-foreground/70 text-xs mt-0.5">
                Please read before booking your table
              </p>
            </div>
          </div>
        </div>

        {/* Rules & guidelines */}
        <div className="px-6 py-5 space-y-5 max-h-[60vh] overflow-y-auto">
          {groups.map((g) => (
            <div key={g.label} className="space-y-4">
              <SectionLabel>{g.label}</SectionLabel>
              {g.items.map((it, j) => (
                <Rule key={j} icon={it.icon} title={it.title} body={it.body} />
              ))}
            </div>
          ))}
        </div>

        {/* CTA */}
        <div className="px-6 py-4 border-t border-border bg-muted/30">
          <button
            onClick={onAccept}
            className="w-full inline-flex items-center justify-center gap-2 rounded-full bg-primary text-primary-foreground px-6 py-3 text-sm font-semibold hover:opacity-90 transition"
          >
            I understand, proceed to booking <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/80">
      {children}
    </p>
  );
}

function Rule({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="flex gap-3">
      <div className="mt-0.5 shrink-0">{icon}</div>
      <div>
        <p className="text-sm font-semibold text-foreground leading-snug">{title}</p>
        <p className="text-sm text-muted-foreground mt-0.5 leading-relaxed">{body}</p>
      </div>
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
