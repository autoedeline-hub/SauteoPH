import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Image as ImageIcon, Search, UtensilsCrossed } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";

// Standalone /menu route used as the Messenger reply link when a customer
// asks "what's on the menu?". Browse-only — no cart, no checkout, no admin
// actions. Mirrors the admin menu panel layout so the look stays consistent
// across surfaces, but pulls only active items and locks the cards down.
export const Route = createFileRoute("/menu")({
  component: MenuViewerPage,
  head: () => ({
    meta: [
      { title: "Menu — Sautéo" },
      {
        name: "description",
        content:
          "Browse the Sautéo menu — burgers, set menus, desserts, and drinks.",
      },
    ],
  }),
});

type MenuVariant = { name: string; price: number };
type MenuCategory = { id: string; name: string; sort_order: number };
type MenuItem = {
  id: string;
  name: string;
  description: string | null;
  price: number;
  image_url: string | null;
  category_id: string;
  active: boolean;
  sort_order: number;
  variants: MenuVariant[] | null;
};

function MenuViewerPage() {
  const [items, setItems] = useState<MenuItem[]>([]);
  const [cats, setCats] = useState<MenuCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: c }, { data: i }] = await Promise.all([
      supabase.from("menu_categories").select("*").order("sort_order"),
      supabase
        .from("menu_items")
        .select("*")
        .eq("active", true)
        .order("sort_order"),
    ]);
    setCats((c ?? []) as MenuCategory[]);
    setItems(((i ?? []) as unknown) as MenuItem[]);
    setLoading(false);
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const visibleItems = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const catOrder = new Map(cats.map((c) => [c.id, c.sort_order]));
    return items
      .filter((item) => {
        if (categoryFilter !== "all" && item.category_id !== categoryFilter)
          return false;
        if (needle && !item.name.toLowerCase().includes(needle)) return false;
        return true;
      })
      .sort((a, b) => {
        const ca = catOrder.get(a.category_id) ?? Number.MAX_SAFE_INTEGER;
        const cb = catOrder.get(b.category_id) ?? Number.MAX_SAFE_INTEGER;
        if (ca !== cb) return ca - cb;
        if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
        return a.name.localeCompare(b.name);
      });
  }, [items, cats, categoryFilter, search]);

  const itemCountsByCat = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const it of items)
      counts[it.category_id] = (counts[it.category_id] ?? 0) + 1;
    return counts;
  }, [items]);

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1 w-full max-w-6xl mx-auto px-4 sm:px-6 py-8 md:py-12">
        <div className="mb-6">
          <h1 className="font-display text-3xl md:text-5xl mb-2">Menu</h1>
          <p className="text-muted-foreground text-sm md:text-base">
            {loading
              ? "Loading…"
              : `${items.length} item${items.length === 1 ? "" : "s"} across ${cats.length} categor${cats.length === 1 ? "y" : "ies"}.`}
          </p>
        </div>

        {/* Filters — search + category chips. Read-only menu, but still want
            the browse affordances customers expect on a menu page. */}
        <div className="bg-card border border-border rounded-2xl p-4 shadow-sm space-y-3 mb-6">
          <div className="relative">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search menu items by name…"
              className="w-full bg-background border border-border rounded-lg pl-10 pr-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-foreground/10 focus:border-foreground transition"
            />
          </div>
          {cats.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              <FilterChip
                label="All"
                count={items.length}
                active={categoryFilter === "all"}
                onClick={() => setCategoryFilter("all")}
              />
              {cats.map((c) => (
                <FilterChip
                  key={c.id}
                  label={c.name}
                  count={itemCountsByCat[c.id] ?? 0}
                  active={categoryFilter === c.id}
                  onClick={() => setCategoryFilter(c.id)}
                />
              ))}
            </div>
          )}
        </div>

        {/* Card grid */}
        {loading ? (
          <div className="bg-card border border-border rounded-2xl py-16 text-center text-muted-foreground text-sm shadow-sm">
            Loading menu…
          </div>
        ) : items.length === 0 ? (
          <div className="bg-card border border-border rounded-2xl py-16 text-center shadow-sm">
            <UtensilsCrossed className="h-8 w-8 mx-auto text-muted-foreground/60 mb-3" />
            <p className="text-sm font-medium">No menu items yet</p>
            <p className="text-xs text-muted-foreground mt-1">
              Please check back soon.
            </p>
          </div>
        ) : visibleItems.length === 0 ? (
          <div className="bg-card border border-border rounded-2xl py-16 text-center shadow-sm">
            <Search className="h-8 w-8 mx-auto text-muted-foreground/60 mb-3" />
            <p className="text-sm font-medium">No matches</p>
            <p className="text-xs text-muted-foreground mt-1">
              Try a different search or category.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
            {visibleItems.map((item) => {
              const cat = cats.find((c) => c.id === item.category_id);
              const variantCount = item.variants?.length ?? 0;
              return (
                <div
                  key={item.id}
                  className="bg-card border border-border rounded-2xl overflow-hidden shadow-sm flex flex-col"
                >
                  <div className="aspect-[4/3] bg-muted flex items-center justify-center overflow-hidden">
                    {item.image_url ? (
                      <img
                        src={item.image_url}
                        alt={item.name}
                        loading="lazy"
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <ImageIcon className="h-8 w-8 text-muted-foreground/40" />
                    )}
                  </div>
                  <div className="p-3 flex-1 flex flex-col">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-sm font-medium truncate">
                          {item.name}
                        </div>
                        <div className="text-[11px] text-muted-foreground mt-0.5 truncate">
                          {cat?.name ?? "Uncategorized"}
                        </div>
                      </div>
                      <div className="text-sm text-foreground font-semibold tabular-nums shrink-0">
                        ₱{Number(item.price).toFixed(0)}
                      </div>
                    </div>
                    {item.description && (
                      <p className="mt-2 text-xs text-muted-foreground leading-relaxed line-clamp-3 whitespace-pre-line">
                        {item.description}
                      </p>
                    )}
                    {variantCount > 0 && (
                      <div className="mt-3 inline-flex self-start items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-muted/60 text-muted-foreground">
                        {variantCount} variant{variantCount === 1 ? "" : "s"}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>
      <Footer />
    </div>
  );
}

function FilterChip({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition ${
        active
          ? "bg-foreground text-background"
          : "bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground"
      }`}
    >
      {label}
      <span
        className={`tabular-nums ${active ? "text-background/70" : "text-muted-foreground/70"}`}
      >
        {count}
      </span>
    </button>
  );
}
