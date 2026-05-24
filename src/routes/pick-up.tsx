import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { ChevronRight, ShoppingBag } from "lucide-react";
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

        <div className="flex justify-center">
          <button
            onClick={onStart}
            className="inline-flex items-center gap-2 rounded-full bg-primary text-primary-foreground px-6 py-3 text-sm md:text-base font-semibold hover:opacity-90 transition"
          >
            View menu & order <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </main>
      <Footer />
    </div>
  );
}

