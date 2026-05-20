import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import {
  ChevronRight,
  CreditCard,
  MessageCircle,
  ShoppingBag,
  Truck,
} from "lucide-react";
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
          "Order Sautéo for pickup. Choose personal pickup or have it delivered by Lalamove or Grab. Pay ahead with Maya QR.",
      },
    ],
  }),
});

function PickupPage() {
  const [started, setStarted] = useState(false);
  if (started) return <MenuPage forcedChannel="pickup" />;
  return <PickupIntro onStart={() => setStarted(true)} />;
}

function PickupIntro({ onStart }: { onStart: () => void }) {
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
            Get your favorite dishes to go. Pick it up yourself, or have it
            delivered by Lalamove or Grab.
          </p>
        </div>

        <div className="grid gap-3 md:gap-4 md:grid-cols-3 mb-10 md:mb-12">
          <IntroPoint
            icon={<ShoppingBag className="h-5 w-5 text-primary" />}
            title="Personal pickup"
            body="Swing by during your chosen window and grab your order."
          />
          <IntroPoint
            icon={<Truck className="h-5 w-5 text-primary" />}
            title="Courier delivery"
            body="Book Lalamove or Grab — we'll prep, you choose the address."
          />
          <IntroPoint
            icon={<CreditCard className="h-5 w-5 text-primary" />}
            title="Pay ahead with Maya"
            body="Scan the QR at checkout and upload your proof — no on-site queue."
          />
        </div>

        <div className="flex justify-center">
          <button
            onClick={onStart}
            className="inline-flex items-center gap-2 rounded-full bg-primary text-primary-foreground px-6 py-3 text-sm md:text-base font-semibold hover:opacity-90 transition"
          >
            View menu & order <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        <p className="text-center text-xs text-muted-foreground mt-6 inline-flex items-center justify-center gap-1.5 w-full">
          <MessageCircle className="h-3.5 w-3.5" />
          Pickup is invite-only — message us on Messenger for your link.
        </p>
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
