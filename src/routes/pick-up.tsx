import { createFileRoute } from "@tanstack/react-router";
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
  return <MenuPage forcedChannel="pickup" />;
}
