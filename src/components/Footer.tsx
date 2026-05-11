import { Facebook, Instagram, MapPin } from "lucide-react";

export function Footer() {
  return (
    <footer id="visit" className="bg-charcoal text-cream mt-24">
      <div className="max-w-6xl mx-auto px-6 py-16 grid md:grid-cols-3 gap-10">
        <div>
          <h3 className="font-display text-3xl mb-3">Sautéo<span className="text-primary">.</span></h3>
          <p className="text-cream/70 text-sm leading-relaxed">A small kitchen serving big flavors. Reservations only — Wed through Sun.</p>
        </div>
        <div>
          <h4 className="font-display text-xl mb-3">Visit Us</h4>
          <a
            href="https://maps.google.com/?q=Sauteo+Restaurant"
            target="_blank" rel="noreferrer"
            className="flex items-start gap-2 text-cream/80 hover:text-mustard transition text-sm"
          >
            <MapPin className="h-4 w-4 mt-0.5 shrink-0" />
            <span>123 Maginhawa St,<br />Quezon City, Philippines<br /><span className="underline">Open in Maps →</span></span>
          </a>
        </div>
        <div>
          <h4 className="font-display text-xl mb-3">Follow</h4>
          <div className="flex gap-3">
            <a href="https://facebook.com" target="_blank" rel="noreferrer" className="h-10 w-10 rounded-full bg-cream/10 hover:bg-mustard hover:text-charcoal flex items-center justify-center transition">
              <Facebook className="h-4 w-4" />
            </a>
            <a href="https://instagram.com" target="_blank" rel="noreferrer" className="h-10 w-10 rounded-full bg-cream/10 hover:bg-mustard hover:text-charcoal flex items-center justify-center transition">
              <Instagram className="h-4 w-4" />
            </a>
          </div>
        </div>
      </div>
      <div className="border-t border-cream/10 py-5 text-center text-cream/50 text-xs">
        © {new Date().getFullYear()} Sautéo. All rights reserved.
      </div>
    </footer>
  );
}
