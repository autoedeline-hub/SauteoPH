import { Facebook, Instagram } from "lucide-react";

export function Footer() {
  return (
    <footer
      id="visit"
      className="shrink-0 border-t border-border/50 bg-background/95 backdrop-blur-sm"
    >
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-4 text-xs text-muted-foreground">
        <span>
          Power pop{" "}
          <span className="font-semibold text-foreground">Edz</span>
        </span>
        <div className="flex items-center gap-1">
          <a
            href="https://facebook.com"
            target="_blank"
            rel="noreferrer"
            aria-label="Facebook"
            className="h-7 w-7 rounded-full flex items-center justify-center hover:bg-muted hover:text-foreground transition"
          >
            <Facebook className="h-3.5 w-3.5" />
          </a>
          <a
            href="https://instagram.com"
            target="_blank"
            rel="noreferrer"
            aria-label="Instagram"
            className="h-7 w-7 rounded-full flex items-center justify-center hover:bg-muted hover:text-foreground transition"
          >
            <Instagram className="h-3.5 w-3.5" />
          </a>
          <a
            href="https://tiktok.com"
            target="_blank"
            rel="noreferrer"
            aria-label="TikTok"
            className="h-7 w-7 rounded-full flex items-center justify-center hover:bg-muted hover:text-foreground transition"
          >
            {/* lucide-react has no TikTok glyph (trademark); inline SVG keeps
                the dep list clean and the icon weight consistent. */}
            <svg
              viewBox="0 0 24 24"
              fill="currentColor"
              className="h-3.5 w-3.5"
              aria-hidden="true"
            >
              <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5.8 20.1a6.34 6.34 0 0 0 10.86-4.43V8.41a8.16 8.16 0 0 0 4.77 1.52V6.69h-1.84Z" />
            </svg>
          </a>
        </div>
      </div>
    </footer>
  );
}
