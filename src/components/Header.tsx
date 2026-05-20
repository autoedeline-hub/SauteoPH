import { Link } from "@tanstack/react-router";

export function Header() {
  return (
    <header className="sticky top-0 z-40 backdrop-blur-md bg-background/80 border-b border-border/60">
      <div className="max-w-6xl mx-auto px-6 h-16 flex items-center">
        <Link to="/" className="font-display text-2xl font-semibold tracking-tight">
          Sautéo<span className="text-primary">.</span>
        </Link>
      </div>
    </header>
  );
}
