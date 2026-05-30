import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  Image as ImageIcon,
  Search,
  UtensilsCrossed,
  X,
} from "lucide-react";
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
type MenuCategory = { id: string; name: string; sort_order: number; available_pickup: boolean };
type MenuItem = {
  id: string;
  name: string;
  description: string | null;
  price: number;
  image_url: string | null;
  category_id: string;
  active: boolean;
  available_dine_in: boolean;
  available_pickup: boolean;
  sort_order: number;
  variants: MenuVariant[] | null;
};

function MenuViewerPage() {
  const [items, setItems] = useState<MenuItem[]>([]);
  const [cats, setCats] = useState<MenuCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  // Browse-only variant viewer. Clicking a card opens this in a modal so
  // customers can see what's inside each set menu / option group without
  // dragging the cart flow onto a page that's meant to be read-only.
  const [viewItem, setViewItem] = useState<MenuItem | null>(null);

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
    setItems(
      (((i ?? []) as unknown) as MenuItem[]).map((item) => ({
        ...item,
        available_dine_in: item.available_dine_in ?? true,
        available_pickup: item.available_pickup ?? true,
      })),
    );
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
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setViewItem(item)}
                  className="bg-card border border-border rounded-2xl overflow-hidden shadow-sm flex flex-col text-left cursor-pointer hover:shadow-md hover:border-foreground/30 transition focus:outline-none focus:ring-2 focus:ring-foreground/20"
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
                </button>
              );
            })}
          </div>
        )}
      </main>
      <Footer />

      {viewItem && (
        <VariantViewerModal
          item={viewItem}
          categoryName={
            cats.find((c) => c.id === viewItem.category_id)?.name ??
            "Uncategorized"
          }
          onClose={() => setViewItem(null)}
        />
      )}
    </div>
  );
}

// Threshold above which the variant list collapses into an accordion
// instead of a long flat list. Tuned for mobile scroll — anything over
// this and set-menu drink lists make the modal too tall to read.
const ACCORDION_VARIANT_THRESHOLD = 5;

// Split " <base> with <option>" into { group: "<base>", option: "<option>" }
// so set-menu variants like "BASIC SAUTÉO HAMBURGER with COKE" stack under
// a single accordion section by base name. Mirrors the parser used in the
// booking-flow variant picker so the grouping logic is consistent across
// surfaces.
function parseVariantName(name: string): {
  group: string | null;
  option: string;
} {
  const idx = name.indexOf(" with ");
  if (idx === -1) return { group: null, option: name };
  return {
    group: name.slice(0, idx).trim(),
    option: name.slice(idx + " with ".length).trim(),
  };
}

type GroupedVariant = { name: string; price: number };
type VariantGroup = { name: string; entries: GroupedVariant[] };

function buildVariantGroups(variants: MenuVariant[]): {
  groups: VariantGroup[];
  ungrouped: MenuVariant[];
} {
  const groups: VariantGroup[] = [];
  const byName = new Map<string, VariantGroup>();
  const ungrouped: MenuVariant[] = [];
  for (const v of variants) {
    const { group, option } = parseVariantName(v.name);
    if (group == null) {
      ungrouped.push(v);
      continue;
    }
    let g = byName.get(group);
    if (!g) {
      g = { name: group, entries: [] };
      byName.set(group, g);
      groups.push(g);
    }
    g.entries.push({ name: option, price: v.price });
  }
  return { groups, ungrouped };
}

// Read-only modal showing an item's image, description, and full variant
// list. Mirrors the visual language of the booking-flow variant picker but
// strips out every interactive control (no selection, no add-to-cart) so
// the /menu page stays a pure browse surface.
function VariantViewerModal({
  item,
  categoryName,
  onClose,
}: {
  item: MenuItem;
  categoryName: string;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  const variants = item.variants ?? [];
  const { groups, ungrouped } = useMemo(
    () => buildVariantGroups(variants),
    [variants],
  );
  // Accordion when there are enough variants to make scrolling painful AND
  // we actually have group structure to collapse them under. A 10-variant
  // list with no " with " connectors stays flat — collapsing a single
  // catch-all section wouldn't reduce scroll meaningfully.
  const useAccordion =
    variants.length >= ACCORDION_VARIANT_THRESHOLD && groups.length >= 1;
  // Start fully collapsed — customer taps a header to reveal that
  // group's options. Radio-style: clicking another header closes the
  // current one, so modal height stays predictable.
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${item.name} details`}
      className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        className="bg-card border border-border rounded-t-2xl sm:rounded-2xl shadow-xl w-full sm:max-w-md max-h-[88vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-card/95 backdrop-blur border-b border-border px-4 py-3 flex items-center justify-between">
          <div className="text-sm font-medium text-muted-foreground">
            Item details
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="h-8 w-8 rounded-full hover:bg-muted flex items-center justify-center transition"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {item.image_url ? (
          <div className="aspect-[4/3] bg-muted overflow-hidden">
            <img
              src={item.image_url}
              alt={item.name}
              className="w-full h-full object-cover"
            />
          </div>
        ) : null}

        <div className="p-5">
          <div className="flex items-start justify-between gap-3 mb-1">
            <div className="min-w-0">
              <h2 className="font-display text-xl md:text-2xl leading-tight">
                {item.name}
              </h2>
              <div className="text-xs text-muted-foreground mt-1">
                {categoryName}
              </div>
            </div>
            <div className="text-lg font-semibold tabular-nums shrink-0">
              ₱{Number(item.price).toFixed(0)}
            </div>
          </div>

          {item.description && (
            <p className="mt-3 text-sm text-muted-foreground leading-relaxed whitespace-pre-line">
              {item.description}
            </p>
          )}

          {variants.length > 0 && (
            <div className="mt-5">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                {variants.length} variant{variants.length === 1 ? "" : "s"}
              </div>

              {useAccordion ? (
                <div className="space-y-2">
                  {groups.map((g) => {
                    const isOpen = expandedGroup === g.name;
                    return (
                      <div
                        key={g.name}
                        className="border border-border rounded-xl overflow-hidden"
                      >
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedGroup(isOpen ? null : g.name)
                          }
                          aria-expanded={isOpen}
                          className="w-full flex items-center justify-between gap-3 px-3 py-2.5 text-sm bg-muted/40 hover:bg-muted transition text-left"
                        >
                          <span className="font-medium leading-snug">
                            {g.name}
                          </span>
                          <span className="flex items-center gap-2 text-xs text-muted-foreground shrink-0">
                            {g.entries.length} option
                            {g.entries.length === 1 ? "" : "s"}
                            <ChevronDown
                              className={`h-4 w-4 transition-transform ${
                                isOpen ? "rotate-180" : ""
                              }`}
                            />
                          </span>
                        </button>
                        {isOpen && (
                          <ul className="divide-y divide-border bg-background">
                            {g.entries.map((v, i) => (
                              <li
                                key={`${v.name}-${i}`}
                                className="px-3 py-2.5 flex items-center justify-between gap-3 text-sm"
                              >
                                <span className="leading-snug">{v.name}</span>
                                <span className="font-semibold tabular-nums shrink-0">
                                  ₱{Number(v.price).toFixed(0)}
                                </span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    );
                  })}

                  {ungrouped.length > 0 && (
                    <ul className="divide-y divide-border border border-border rounded-xl overflow-hidden">
                      {ungrouped.map((v, i) => (
                        <li
                          key={`ungrouped-${v.name}-${i}`}
                          className="px-3 py-2.5 flex items-center justify-between gap-3 text-sm bg-background"
                        >
                          <span className="leading-snug">{v.name}</span>
                          <span className="font-semibold tabular-nums shrink-0">
                            ₱{Number(v.price).toFixed(0)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ) : (
                <ul className="divide-y divide-border border border-border rounded-xl overflow-hidden">
                  {variants.map((v, i) => (
                    <li
                      key={`${v.name}-${i}`}
                      className="px-3 py-2.5 flex items-center justify-between gap-3 text-sm bg-background"
                    >
                      <span className="leading-snug">{v.name}</span>
                      <span className="font-semibold tabular-nums shrink-0">
                        ₱{Number(v.price).toFixed(0)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </div>
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
