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
} from "lucide-react";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { useSiteRules } from "@/integrations/site-content";

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

function DineInRulesModal({ onAccept }: { onAccept: () => void }) {
  const rules = useSiteRules("dinein_rules");
  const byId = useMemo(
    () => Object.fromEntries(rules.map((r) => [r.id, r])),
    [rules],
  );
  const t = (id: string) => byId[id]?.title ?? "";
  const b = (id: string) => byId[id]?.body ?? "";

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
          {/* Reservation rules — booking & payment policy */}
          <div className="space-y-4">
            <SectionLabel>Reservation Rules</SectionLabel>
            <Rule
              icon={<CalendarDays className="h-4 w-4 text-blue-500" />}
              title={t("available_days")}
              body={b("available_days")}
            />
            <Rule
              icon={<MessageCircle className="h-4 w-4 text-primary" />}
              title={t("invite_only")}
              body={b("invite_only")}
            />
            <Rule
              icon={<CreditCard className="h-4 w-4 text-green-500" />}
              title={t("full_payment")}
              body={b("full_payment")}
            />
            <Rule
              icon={<AlertTriangle className="h-4 w-4 text-red-500" />}
              title={t("no_refunds")}
              body={b("no_refunds")}
            />
          </div>

          {/* Dining guidelines — day-of conduct */}
          <div className="space-y-4 pt-1">
            <SectionLabel>Dining Guidelines</SectionLabel>
            <Rule
              icon={<Clock className="h-4 w-4 text-amber-500" />}
              title={t("arrive_on_time")}
              body={b("arrive_on_time")}
            />
            <Rule
              icon={<Users className="h-4 w-4 text-primary" />}
              title={t("party_size")}
              body={b("party_size")}
            />
            <Rule
              icon={<Sparkles className="h-4 w-4 text-mustard" />}
              title={t("intimate_setting")}
              body={b("intimate_setting")}
            />
          </div>
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
