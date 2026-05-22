import { createFileRoute } from "@tanstack/react-router";
import { BookByInvite } from "./book.$token";

// Channel-aware alias of /book/$token. Admin generates dine-in invites
// straight to /dine-in/<token> so customers see a URL that matches the
// flow they're entering. Validation, prefill, and atomic invite-consume
// are all delegated to BookByInvite — the create_booking RPC enforces
// channel match at the DB layer, so a pickup token at this URL still
// fails fast with invite_channel_mismatch.
export const Route = createFileRoute("/dine-in_/$token")({
  component: DineInByInvite,
  head: () => ({
    meta: [
      { title: "Confirm your reservation — Sautéo" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
});

function DineInByInvite() {
  const { token } = Route.useParams();
  return <BookByInvite token={token} />;
}
