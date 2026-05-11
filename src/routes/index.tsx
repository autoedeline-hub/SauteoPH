import { createFileRoute, Link } from "@tanstack/react-router";
import { Calendar, CreditCard, Clock, Users } from "lucide-react";
import heroImg from "@/assets/hero.jpg";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";

export const Route = createFileRoute("/")({
  component: Index,
});

const guidelines = [
  { icon: Calendar, title: "Reservations only", body: "No walk-ins. Every table is pre-booked through this page." },
  { icon: CreditCard, title: "Prepaid bookings", body: "Your booking is confirmed once we verify your payment." },
  { icon: Clock, title: "Wed – Sun, 5 seatings", body: "1:00, 2:30, 4:00, 5:30, 7:00 PM. Each seating runs 90 min." },
  { icon: Users, title: "Up to 4 per booking", body: "Groups of 5+ require manual approval. Reach out via DM first." },
];

function Index() {
  return (
    <div className="min-h-screen flex flex-col">
      <Header />

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="max-w-6xl mx-auto px-6 pt-12 md:pt-20 pb-16 md:pb-24 grid md:grid-cols-2 gap-10 items-center">
          <div>
            <span className="inline-block text-xs uppercase tracking-[0.2em] text-primary font-medium mb-5">Reservations · Wed–Sun</span>
            <h1 className="font-display text-5xl md:text-7xl leading-[1.02] mb-6">
              Slow food,<br />served on time.
            </h1>
            <p className="text-lg text-muted-foreground max-w-md mb-8">
              Pick your slot, build your meal, pay in one go. Show up — your table and your food are waiting.
            </p>
            <Link
              to="/book"
              className="inline-flex items-center justify-center rounded-full bg-primary text-primary-foreground px-8 py-4 text-base font-medium hover:opacity-90 shadow-lg shadow-primary/20 transition"
            >
              Book a Table →
            </Link>
          </div>
          <div className="relative">
            <div className="absolute -inset-6 bg-mustard/30 rounded-[2rem] -rotate-2" aria-hidden />
            <img
              src={heroImg}
              alt="Sautéo signature double cheeseburger with hand-cut fries"
              width={1600}
              height={1024}
              className="relative rounded-[2rem] shadow-2xl object-cover w-full aspect-[4/5] md:aspect-[5/6]"
            />
          </div>
        </div>
      </section>

      {/* Guidelines */}
      <section id="guidelines" className="bg-charcoal text-cream py-20 md:py-28">
        <div className="max-w-6xl mx-auto px-6">
          <div className="max-w-2xl mb-14">
            <span className="text-mustard text-xs uppercase tracking-[0.2em] font-medium">House Rules</span>
            <h2 className="font-display text-4xl md:text-5xl mt-3">A few things, before you book.</h2>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {guidelines.map(({ icon: Icon, title, body }) => (
              <div key={title} className="bg-cream/5 backdrop-blur rounded-2xl p-6 border border-cream/10">
                <Icon className="h-6 w-6 text-mustard mb-4" />
                <h3 className="font-display text-xl mb-2">{title}</h3>
                <p className="text-cream/70 text-sm leading-relaxed">{body}</p>
              </div>
            ))}
          </div>
          <div className="mt-14 text-center">
            <Link
              to="/book"
              className="inline-flex items-center justify-center rounded-full bg-mustard text-charcoal px-8 py-4 font-medium hover:opacity-90 transition"
            >
              Start Booking →
            </Link>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
}
