import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { MenuPage, PickupRulesModal, PickupInviteLanding } from "./index";

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
  const [stage, setStage] = useState<"landing" | "rules" | "booking">("landing");
  if (stage === "booking") return <MenuPage forcedChannel="pickup" />;
  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1 w-full max-w-3xl mx-auto px-4 sm:px-6 py-8 md:py-12">
        <PickupInviteLanding onProceed={() => setStage("rules")} />
      </main>
      <Footer />
      {stage === "rules" && <PickupRulesModal onAccept={() => setStage("booking")} />}
    </div>
  );
}
