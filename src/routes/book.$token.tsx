import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { AlertTriangle, Loader2, MessageCircle } from "lucide-react";
import { InviteContext, type LoadedInvite } from "@/lib/invite";
import { MenuPage } from "./index";

export const Route = createFileRoute("/book/$token")({
  component: BookByInvite,
  head: () => ({
    meta: [
      { title: "Confirm your reservation — Sautéo" },
      // Don't index invite pages — they're personal links.
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
});

// What lookup_invite() returns. Discriminated union so the UI can branch
// without ad-hoc string checks elsewhere.
type LookupResult =
  | { status: "valid"; channel: "dine_in" | "pickup"; customer_name: string;
      customer_email: string | null; customer_phone: string | null;
      group_size: number | null; expires_at: string }
  | { status: "invalid" }
  | { status: "used" }
  | { status: "expired" };

function BookByInvite() {
  const { token } = Route.useParams();
  type ViewState =
    | { kind: "loading" }
    | { kind: "valid"; invite: LoadedInvite }
    | { kind: "blocked"; reason: "invalid" | "used" | "expired" | "load_failed" };
  const [state, setState] = useState<ViewState>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await (supabase.rpc as any)("lookup_invite", {
        _token: token,
      });
      if (cancelled) return;
      if (error) {
        console.warn("[invite] lookup failed:", error);
        setState({ kind: "blocked", reason: "load_failed" });
        return;
      }
      const result = (data ?? { status: "invalid" }) as LookupResult;
      if (result.status !== "valid") {
        setState({ kind: "blocked", reason: result.status });
        return;
      }
      setState({
        kind: "valid",
        invite: {
          token,
          channel: result.channel,
          customerName: result.customer_name,
          customerEmail: result.customer_email,
          customerPhone: result.customer_phone,
          groupSize: result.group_size,
          expiresAt: result.expires_at,
        },
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (state.kind === "loading") {
    return (
      <div className="min-h-screen flex flex-col">
        <Header />
        <main className="flex-1 w-full max-w-2xl mx-auto px-4 sm:px-6 py-12 flex items-center justify-center">
          <div className="flex flex-col items-center gap-3 text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin" />
            <p className="text-sm">Checking your invite…</p>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  if (state.kind === "blocked") {
    return <InviteBlocked reason={state.reason} />;
  }

  // Provider injects the invite into MenuPage's useInvite() — that's what
  // flips the page from "Booking is invite-only" to the real reservation
  // form with prefilled customer info + the invite_token attached to the
  // create_booking RPC call on submit.
  return (
    <InviteContext.Provider value={state.invite}>
      <MenuPage />
    </InviteContext.Provider>
  );
}

const REASON_COPY: Record<
  "invalid" | "used" | "expired" | "load_failed",
  { title: string; body: string }
> = {
  invalid: {
    title: "Invite not recognized",
    body: "We couldn't find this booking link. Double-check the link from your Messenger conversation, or message us if it still doesn't work.",
  },
  used: {
    title: "This invite has already been used",
    body: "Each booking link works once. If you need to make a change or rebook, please message us on Messenger.",
  },
  expired: {
    title: "This invite has expired",
    body: "Booking links are valid for 72 hours. Message us on Messenger and we'll send you a fresh one.",
  },
  load_failed: {
    title: "We couldn't verify your invite",
    body: "Something went wrong checking your booking link. Try refreshing this page. If it keeps happening, message us on Messenger.",
  },
};

function InviteBlocked({
  reason,
}: {
  reason: "invalid" | "used" | "expired" | "load_failed";
}) {
  const copy = REASON_COPY[reason];
  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1 w-full max-w-xl mx-auto px-4 sm:px-6 py-12 flex items-center justify-center">
        <div className="bg-card border border-border rounded-2xl p-6 md:p-8 shadow-sm text-center w-full">
          <div className="mx-auto h-14 w-14 rounded-full bg-destructive/10 flex items-center justify-center mb-5">
            <AlertTriangle className="h-6 w-6 text-destructive" />
          </div>
          <h1 className="font-display text-2xl md:text-3xl mb-2">{copy.title}</h1>
          <p className="text-muted-foreground text-sm leading-relaxed mb-6">
            {copy.body}
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <a
              href="https://www.facebook.com/messages/t/1119234891273865"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center justify-center gap-2 rounded-full bg-primary text-primary-foreground px-5 py-3 text-sm font-semibold hover:opacity-90 transition"
            >
              <MessageCircle className="h-4 w-4" />
              Message Sautéo
            </a>
            <Link
              to="/"
              className="inline-flex items-center justify-center gap-2 rounded-full bg-muted text-foreground px-5 py-3 text-sm font-semibold hover:bg-muted/70 transition"
            >
              View menu
            </Link>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
