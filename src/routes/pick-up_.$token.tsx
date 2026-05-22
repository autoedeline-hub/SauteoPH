import { createFileRoute } from "@tanstack/react-router";
import { BookByInvite } from "./book.$token";

// Channel-aware alias of /book/$token for pickup invites — see
// dine-in_.$token.tsx for the rationale and the back-stop guarantees.
export const Route = createFileRoute("/pick-up_/$token")({
  component: PickupByInvite,
  head: () => ({
    meta: [
      { title: "Confirm your pickup — Sautéo" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
});

function PickupByInvite() {
  const { token } = Route.useParams();
  return <BookByInvite token={token} />;
}
