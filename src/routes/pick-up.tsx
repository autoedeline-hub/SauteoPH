import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { ChevronRight, ShoppingBag, X, Clock, AlertTriangle, CalendarDays, CreditCard } from "lucide-react";
import { useSiteRules } from "@/integrations/site-content";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { MenuPage } from "./index";

export const Route = createFileRoute("/pick-up")({
  component: PickupPage,
  head: () => ({
    meta: [
      { title: "Order pickup — Sautéo" },
      {
        name: "description",
        content:
          "Order Sautéo for pickup. Choose your time, pick from our menu, and pay with Maya QR.",
      },
    ],
  }),
});

function PickupPage() {
  const [rulesAccepted, setRulesAccepted] = useState(false);
  const [started, setStarted] = useState(false);

  if (started) return <MenuPage forcedChannel="pickup" />;

  return (
    <>
      {!rulesAccepted && <PickupRulesModal onAccept={() => setRulesAccepted(true)} />}
      <PickupIntro onStart={() => setStarted(true)} rulesAccepted={rulesAccepted} />
    </>
  );
}

function PickupRulesModal({ onAccept }: { onAccept: () => void }) {
  const rules = useSiteRules("pickup_rules");
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
            <ShoppingBag className="h-5 w-5 text-primary-foreground shrink-0" />
            <div>
              <h2 className="font-display text-lg text-primary-foreground leading-tight">
                Pick-Up Order Rules
              </h2>
              <p className="text-primary-foreground/70 text-xs mt-0.5">
                Please read before placing your order
              </p>
            </div>
          </div>
        </div>

        {/* Rules */}
        <div className="px-6 py-5 space-y-4 max-h-[60vh] overflow-y-auto">
          <Rule
            icon={<Clock className="h-4 w-4 text-amber-500" />}
            title={t("cutoff")}
            body={b("cutoff")}
          />
          <Rule
            icon={<CalendarDays className="h-4 w-4 text-blue-500" />}
            title={t("available_days")}
            body={b("available_days")}
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
          <Rule
            icon={<ShoppingBag className="h-4 w-4 text-primary" />}
            title={t("be_on_time")}
            body={b("be_on_time")}
          />
        </div>

        {/* CTA */}
        <div className="px-6 py-4 border-t border-border bg-muted/30">
          <button
            onClick={onAccept}
            className="w-full inline-flex items-center justify-center gap-2 rounded-full bg-primary text-primary-foreground px-6 py-3 text-sm font-semibold hover:opacity-90 transition"
          >
            I understand, proceed to order <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
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

function PickupIntro({ onStart, rulesAccepted }: { onStart: () => void; rulesAccepted: boolean }) {
  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1 w-full max-w-3xl mx-auto px-4 sm:px-6 py-12 md:py-20">
        <div className="text-center mb-10 md:mb-14">
          <div className="mx-auto h-16 w-16 rounded-full bg-mustard/30 flex items-center justify-center mb-6">
            <ShoppingBag className="h-7 w-7 text-primary" />
          </div>
          <h1 className="font-display text-3xl md:text-5xl mb-3">
            Order Sautéo for pickup
          </h1>
          <p className="text-muted-foreground text-base md:text-lg max-w-xl mx-auto">
            Get your favorite dishes to go. Pick your window (4 PM, 6 PM, or
            8 PM), choose from the menu, and pay with Maya QR.
          </p>
        </div>

        <div className="flex justify-center">
          <button
            onClick={onStart}
            disabled={!rulesAccepted}
            className="inline-flex items-center gap-2 rounded-full bg-primary text-primary-foreground px-6 py-3 text-sm md:text-base font-semibold hover:opacity-90 transition disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Start your order <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </main>
      <Footer />
    </div>
  );
}

