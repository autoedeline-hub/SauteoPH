import { createFileRoute } from "@tanstack/react-router";
import { CalendarClock, MessageCircle, Users } from "lucide-react";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";

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
  return (
    <div className="min-h-screen flex flex-col">
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
            href={MESSENGER_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 rounded-full bg-primary text-primary-foreground px-6 py-3 text-sm md:text-base font-semibold hover:opacity-90 transition"
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
