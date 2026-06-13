import { Link } from "@tanstack/react-router";

export function Footer() {
  return (
    <footer
      id="visit"
      className="shrink-0 border-t border-border/50 bg-background/95 backdrop-blur-sm"
    >
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-center gap-4 text-xs text-muted-foreground">
        <span>
          Powered by{" "}
          <span className="font-semibold text-foreground">AutomatEdz</span>
        </span>
        <Link to="/terms" className="hover:text-foreground transition">
          Terms & Privacy
        </Link>
      </div>
    </footer>
  );
}
