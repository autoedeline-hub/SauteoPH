import { Link } from "@tanstack/react-router";

export function Header() {
  return (
    <header className="sticky top-0 z-40 backdrop-blur-md bg-background/80 border-b border-border/60">
      <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
        <Link to="/" className="font-display text-2xl font-semibold tracking-tight">
          Sautéo<span className="text-primary">.</span>
        </Link>
        <nav className="flex items-center gap-6 text-sm">
          <a href="/#guidelines" className="hidden sm:inline text-muted-foreground hover:text-foreground transition">Guidelines</a>
          <a href="/#visit" className="hidden sm:inline text-muted-foreground hover:text-foreground transition">Visit</a>
          <Link
            to="/book"
            className="inline-flex items-center justify-center rounded-full bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:opacity-90 transition"
          >
            Book a Table
          </Link>
        </nav>
      </div>
    </header>
  );
}
