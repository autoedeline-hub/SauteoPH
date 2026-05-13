import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  Minus,
  Pencil,
  Plus,
  Printer,
  Search,
  ShoppingBag,
  X,
} from "lucide-react";

export const Route = createFileRoute("/")({
  component: MenuPage,
  head: () => ({
    meta: [
      { title: "Menu — Sautéo" },
      { name: "description", content: "Browse the menu, add to cart, and pay." },
    ],
  }),
});

type Category = { id: string; name: string; slug: string; sort_order: number };
type MenuItemVariant = { name: string; price: number };
type MenuItem = {
  id: string;
  category_id: string;
  name: string;
  description: string | null;
  price: number;
  image_url: string | null;
  active: boolean;
  variants: MenuItemVariant[] | null;
};
// Cart key scheme:
//   - item with no variant       -> key = item.id
//   - item with a chosen variant -> key = item.id + "::" + variantIndex
type Cart = Record<string, number>;
type View = "menu" | "payment" | "receipt";

const CART_KEY_DELIM = "::";

function makeCartKey(itemId: string, variantIndex: number | null): string {
  return variantIndex == null ? itemId : `${itemId}${CART_KEY_DELIM}${variantIndex}`;
}

function parseCartKey(key: string): { itemId: string; variantIndex: number | null } {
  const idx = key.indexOf(CART_KEY_DELIM);
  if (idx === -1) return { itemId: key, variantIndex: null };
  const itemId = key.slice(0, idx);
  const vi = Number(key.slice(idx + CART_KEY_DELIM.length));
  return { itemId, variantIndex: Number.isFinite(vi) ? vi : null };
}

function getLinePrice(item: MenuItem, variantIndex: number | null): number {
  if (variantIndex != null && item.variants && item.variants[variantIndex]) {
    return Number(item.variants[variantIndex].price);
  }
  return item.price;
}

function getVariantName(item: MenuItem, variantIndex: number | null): string | null {
  if (variantIndex != null && item.variants && item.variants[variantIndex]) {
    return item.variants[variantIndex].name;
  }
  return null;
}

function MenuPage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [items, setItems] = useState<MenuItem[]>([]);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [cart, setCart] = useState<Cart>({});
  const [view, setView] = useState<View>("menu");
  const [receipt, setReceipt] = useState<{ ref: string; total: number; items: { name: string; qty: number; price: number }[]; at: Date } | null>(null);

  useEffect(() => {
    (async () => {
      const [{ data: c }, { data: i }] = await Promise.all([
        supabase.from("menu_categories").select("*").order("sort_order"),
        supabase.from("menu_items").select("*").eq("active", true).order("sort_order"),
      ]);
      setCategories((c ?? []) as Category[]);
      // Cast via unknown because the generated Supabase types don't yet
      // include the recently-added `variants` jsonb column. The runtime row
      // shape matches MenuItem.
      setItems(((i ?? []) as unknown as MenuItem[]).map((it) => ({ ...it, price: Number(it.price) })));
      if (c && c.length) setActiveCategory(c[0].id);
    })();
  }, []);

  const total = useMemo(
    () =>
      Object.entries(cart).reduce((sum, [key, qty]) => {
        const { itemId, variantIndex } = parseCartKey(key);
        const it = items.find((x) => x.id === itemId);
        return sum + (it ? getLinePrice(it, variantIndex) * qty : 0);
      }, 0),
    [cart, items],
  );
  const cartCount = Object.values(cart).reduce((a, b) => a + b, 0);

  // Generic stepper — operates on a composite cart key (id or id::variantIndex).
  const updateQty = (key: string, delta: number) => {
    setCart((prev) => {
      const q = (prev[key] || 0) + delta;
      const next = { ...prev };
      if (q <= 0) delete next[key];
      else next[key] = q;
      return next;
    });
  };

  // New add-to-cart entry point used by the variant modal and the no-variant
  // card tap. Builds the composite key and bumps quantity by `qty`.
  const addToCart = (itemId: string, variantIndex: number | null, qty: number) => {
    if (qty <= 0) return;
    const key = makeCartKey(itemId, variantIndex);
    setCart((prev) => ({ ...prev, [key]: (prev[key] || 0) + qty }));
  };

  const placeOrder = () => {
    const ref = "STO-" + Date.now().toString(36).toUpperCase().slice(-6);
    const lineItems = Object.entries(cart)
      .map(([key, qty]) => {
        const { itemId, variantIndex } = parseCartKey(key);
        const it = items.find((x) => x.id === itemId);
        if (!it) return null;
        const variantName = getVariantName(it, variantIndex);
        // Receipt line name includes variant suffix so the printout reads cleanly.
        // NOTE: stubbed — the future booking RPC may want a structured
        //   { item_id, variant_index, variant_name, qty, unit_price } payload
        //   instead of a flattened display name. Revisit when wiring real orders.
        const displayName = variantName ? `${it.name} — ${variantName}` : it.name;
        return { name: displayName, qty, price: getLinePrice(it, variantIndex) };
      })
      .filter(Boolean) as { name: string; qty: number; price: number }[];
    setReceipt({ ref, total, items: lineItems, at: new Date() });
    setCart({});
    setView("receipt");
  };

  const isMenuView = view === "menu";

  return (
    <div
      className={
        isMenuView
          ? "h-screen flex flex-col overflow-hidden"
          : "min-h-screen flex flex-col"
      }
    >
      <Header />
      <main
        className={
          isMenuView
            ? "flex-1 w-full max-w-3xl mx-auto px-4 sm:px-6 pt-8 overflow-hidden flex flex-col min-h-0"
            : "flex-1 w-full max-w-3xl mx-auto px-4 sm:px-6 py-8 md:py-12"
        }
      >
        {view === "menu" && (
          <MenuView
            categories={categories}
            items={items}
            activeCategory={activeCategory}
            setActiveCategory={setActiveCategory}
            cart={cart}
            updateQty={updateQty}
            addToCart={addToCart}
            total={total}
            cartCount={cartCount}
            onCheckout={() => setView("payment")}
          />
        )}
        {view === "payment" && (
          <PaymentView
            total={total}
            onBack={() => setView("menu")}
            onConfirm={placeOrder}
          />
        )}
        {view === "receipt" && receipt && (
          <ReceiptView
            receipt={receipt}
            onNewOrder={() => setView("menu")}
          />
        )}
      </main>
      <Footer />
    </div>
  );
}

/* ============ Menu View ============ */
function MenuView({
  categories,
  items,
  activeCategory,
  setActiveCategory,
  cart,
  updateQty,
  addToCart,
  total,
  cartCount,
  onCheckout,
}: {
  categories: Category[];
  items: MenuItem[];
  activeCategory: string | null;
  setActiveCategory: (id: string) => void;
  cart: Cart;
  updateQty: (key: string, delta: number) => void;
  addToCart: (itemId: string, variantIndex: number | null, qty: number) => void;
  total: number;
  cartCount: number;
  onCheckout: () => void;
}) {
  const pillScrollerRef = useRef<HTMLDivElement | null>(null);
  const pillRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const isProgrammaticScroll = useRef(false);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  // Cross-viewport "Added!" toast state (formerly mobile-only).
  // `variantIndex` lets the toast subtitle render the chosen variant name.
  const [lastAdded, setLastAdded] = useState<
    { item: MenuItem; variantIndex: number | null; nonce: number } | null
  >(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  // Variant selection modal target. Null = closed.
  // `quickAdd` is computed at open time based on the item's category slug:
  // set-menu items get tap-to-add (modal stays open, no commit step), all
  // other categories use the classic select-then-confirm flow.
  const [variantTarget, setVariantTarget] = useState<
    { item: MenuItem; quickAdd: boolean } | null
  >(null);

  // Wrap updateQty so the "Added!" toast fires on positive deltas (cart steppers).
  const handleUpdateQty = useCallback(
    (key: string, delta: number) => {
      if (delta > 0) {
        const { itemId, variantIndex } = parseCartKey(key);
        const it = items.find((x) => x.id === itemId);
        if (it) setLastAdded({ item: it, variantIndex, nonce: Date.now() });
      }
      updateQty(key, delta);
    },
    [items, updateQty],
  );

  // Tap-on-card handler. Always opens the modal so the customer sees the
  // image + description before committing. Items without variants get a
  // simplified modal (no "Which option..." picker — just qty + Add to cart).
  // Quick-add (stay-open + in-modal "Added!" pill) kicks in for any item
  // with 2 or more variants, so customers can mix-and-match without the
  // modal closing after each add.
  const handleCardTap = useCallback(
    (item: MenuItem) => {
      const quickAdd = !!item.variants && item.variants.length >= 2;
      setVariantTarget({ item, quickAdd });
    },
    [],
  );

  // Called by the variant modal when a variant is committed.
  // In classic mode: invoked by the "Add to cart" footer button, fires the
  // global AddToCartToast, then closes the modal.
  // In set-menu (quick-add) mode: invoked by the in-modal "Add to cart" CTA;
  // modal stays open and the global toast is suppressed — the modal renders
  // its own in-place "Added!" indicator instead.
  const handleVariantAdd = useCallback(
    (
      item: MenuItem,
      variantIndex: number | null,
      qty: number,
      keepOpen: boolean,
    ) => {
      addToCart(item.id, variantIndex, qty);
      if (!keepOpen) {
        setLastAdded({ item, variantIndex, nonce: Date.now() });
        setVariantTarget(null);
      }
    },
    [addToCart],
  );

  // Auto-dismiss toast ~2s after each new add. Re-running on `nonce` resets the timer
  // when the user adds another item before the previous toast clears.
  useEffect(() => {
    if (!lastAdded) return;
    const t = window.setTimeout(() => setLastAdded(null), 2000);
    return () => window.clearTimeout(t);
  }, [lastAdded]);

  // Lock body scroll while the bottom sheet or the variant modal is open.
  useEffect(() => {
    if (!sheetOpen && !variantTarget) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [sheetOpen, variantTarget]);

  // If the cart empties, make sure the sheet closes too.
  useEffect(() => {
    if (cartCount === 0 && sheetOpen) setSheetOpen(false);
  }, [cartCount, sheetOpen]);

  const itemsByCategory = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const matches = q
      ? (it: MenuItem) =>
          it.name.toLowerCase().includes(q) ||
          (it.description?.toLowerCase().includes(q) ?? false)
      : null;

    const map: Record<string, MenuItem[]> = {};
    for (const c of categories) map[c.id] = [];
    for (const it of items) {
      if (!map[it.category_id]) continue;
      if (matches && !matches(it)) continue;
      map[it.category_id].push(it);
    }
    return map;
  }, [categories, items, searchQuery]);

  const isSearching = searchQuery.trim().length > 0;
  const hasResults = categories.some(
    (c) => (itemsByCategory[c.id] ?? []).length > 0,
  );

  // Update chevron enabled state based on scroll position
  const updateChevronState = useCallback(() => {
    const el = pillScrollerRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 4);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  }, []);

  useEffect(() => {
    const el = pillScrollerRef.current;
    if (!el) return;
    updateChevronState();
    el.addEventListener("scroll", updateChevronState, { passive: true });
    const ro = new ResizeObserver(updateChevronState);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", updateChevronState);
      ro.disconnect();
    };
  }, [updateChevronState, categories.length]);

  // Scrollspy: observe each section inside the menu scroll container,
  // set active category to the one most in view.
  useEffect(() => {
    if (!categories.length) return;
    const scrollRoot = scrollContainerRef.current;
    if (!scrollRoot) return;

    const visibility = new Map<string, number>();

    const pickTop = () => {
      let best: { id: string; ratio: number } | null = null;
      for (const [id, ratio] of visibility.entries()) {
        if (!best || ratio > best.ratio) best = { id, ratio };
      }
      if (best && best.ratio > 0) {
        setActiveCategory(best.id);
      }
    };

    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const id = (e.target as HTMLElement).dataset.categoryId;
          if (!id) continue;
          visibility.set(id, e.isIntersecting ? e.intersectionRatio : 0);
        }
        if (!isProgrammaticScroll.current) pickTop();
      },
      {
        root: scrollRoot,
        // trigger when the section heading crosses ~20% from the top
        rootMargin: "-20% 0px -60% 0px",
        threshold: [0, 0.25, 0.5, 0.75, 1],
      },
    );

    for (const c of categories) {
      const node = sectionRefs.current[c.id];
      if (node) observer.observe(node);
    }
    return () => {
      observer.disconnect();
    };
  }, [categories, setActiveCategory]);

  // Auto-scroll active pill into the horizontal center
  useEffect(() => {
    if (!activeCategory) return;
    const pill = pillRefs.current[activeCategory];
    const scroller = pillScrollerRef.current;
    if (!pill || !scroller) return;
    const target =
      pill.offsetLeft - scroller.clientWidth / 2 + pill.clientWidth / 2;
    scroller.scrollTo({
      left: Math.max(0, target),
      behavior: "smooth",
    });
  }, [activeCategory]);

  const handlePillClick = (id: string) => {
    setActiveCategory(id);
    const node = sectionRefs.current[id];
    if (node) {
      isProgrammaticScroll.current = true;
      node.scrollIntoView({ behavior: "smooth", block: "start" });
      // release the lock once the smooth scroll settles
      window.setTimeout(() => {
        isProgrammaticScroll.current = false;
      }, 800);
    }
  };

  const scrollPills = (dir: -1 | 1) => {
    const el = pillScrollerRef.current;
    if (!el) return;
    el.scrollBy({ left: dir * 200, behavior: "smooth" });
  };

  return (
    <div className="relative flex-1 flex flex-col min-h-0">
      {/* Static top block — title + search stay put while the menu scrolls. */}
      <div className="pb-4 shrink-0">
        <h1 className="font-display text-3xl md:text-5xl font-semibold tracking-tight mb-6">
          What would you like to order?
        </h1>

        <div className="relative max-w-xl">
          <Search className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search"
            aria-label="Search menu items"
            className="w-full h-11 pl-11 pr-10 rounded-full border border-border bg-background text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-foreground/10 transition"
          />
          {isSearching && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              aria-label="Clear search"
              className="absolute right-3 top-1/2 -translate-y-1/2 h-6 w-6 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {/* Scrollable menu area — only this scrolls; the page does not. */}
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto -mx-4 sm:-mx-6 px-4 sm:px-6 min-h-0"
      >
        {/* Sticky category pill bar, anchored to top of the scroll container */}
        <div className="sticky top-0 z-30 -mx-4 sm:-mx-6 px-4 sm:px-6 py-3 bg-background/90 backdrop-blur-md border-b border-border/60">
          <div className="flex items-center gap-2">
            <button
              onClick={() => scrollPills(-1)}
              disabled={!canScrollLeft}
              aria-label="Scroll categories left"
              className="shrink-0 h-8 w-8 rounded-full flex items-center justify-center text-foreground/70 hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed transition"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>

            <div
              ref={pillScrollerRef}
              className="flex-1 overflow-x-auto scrollbar-none"
              style={{ scrollbarWidth: "none" }}
            >
              <div className="flex items-center gap-2 w-max px-1">
                {categories.map((c) => {
                  const active = activeCategory === c.id;
                  return (
                    <button
                      key={c.id}
                      ref={(el) => {
                        pillRefs.current[c.id] = el;
                      }}
                      onClick={() => handlePillClick(c.id)}
                      className={`whitespace-nowrap rounded-full text-xs sm:text-sm font-medium uppercase tracking-wide transition px-4 sm:px-5 py-2 sm:py-2.5 ${
                        active
                          ? "bg-foreground text-background shadow-sm"
                          : "bg-transparent text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {c.name}
                    </button>
                  );
                })}
              </div>
            </div>

            <button
              onClick={() => scrollPills(1)}
              disabled={!canScrollRight}
              aria-label="Scroll categories right"
              className="shrink-0 h-8 w-8 rounded-full flex items-center justify-center text-foreground/70 hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed transition"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Vertical sections */}
        <div className={`pt-8 ${cartCount > 0 ? "pb-32 lg:pb-12" : "pb-12"}`}>
          {isSearching && !hasResults && (
            <div className="text-center py-20 text-muted-foreground">
              <p className="text-sm">
                No items match{" "}
                <span className="text-foreground font-medium">
                  "{searchQuery}"
                </span>
              </p>
            </div>
          )}
          {categories.map((c) => {
            const list = itemsByCategory[c.id] ?? [];
            // When searching, hide sections that have no matches.
            if (isSearching && list.length === 0) return null;
            return (
              <section
                key={c.id}
                ref={(el) => {
                  sectionRefs.current[c.id] = el;
                }}
                data-category-id={c.id}
                style={{ scrollMarginTop: "5rem" }}
                className="mb-14"
              >
                <h2 className="font-display text-2xl md:text-3xl font-semibold mb-6">
                  {c.name}
                </h2>
                {list.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No items yet</p>
                ) : (
                  <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
                    {list.map((it) => (
                      <MenuItemCard
                        key={it.id}
                        item={it}
                        onAdd={() => handleCardTap(it)}
                      />
                    ))}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      </div>

      {/* Side cart panel — lives outside the scroll container,
          parked in the empty space right of the centered max-w-3xl column. */}
      <CartSidePanel
        cart={cart}
        items={items}
        updateQty={updateQty}
        total={total}
        cartCount={cartCount}
        onCheckout={onCheckout}
      />

      {/* Mobile / tablet (below lg) — cococart-style bottom pill + bottom sheet.
          The desktop CartSidePanel above takes over at lg. The toast is now
          cross-viewport (no lg:hidden). */}
      {cartCount > 0 && (
        <PreviewCartPill
          cartCount={cartCount}
          total={total}
          onOpen={() => setSheetOpen(true)}
        />
      )}

      <AddToCartToast
        lastAdded={lastAdded}
        categories={categories}
        hasPillBelow={cartCount > 0}
      />

      <CartPreviewSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        cart={cart}
        items={items}
        updateQty={handleUpdateQty}
        total={total}
        onCheckout={() => {
          setSheetOpen(false);
          onCheckout();
        }}
      />

      <VariantSelectModal
        item={variantTarget?.item ?? null}
        quickAdd={variantTarget?.quickAdd ?? false}
        onClose={() => setVariantTarget(null)}
        onAdd={handleVariantAdd}
      />
    </div>
  );
}

/* ============ Mobile: Preview Cart Pill ============ */
function PreviewCartPill({
  cartCount,
  total,
  onOpen,
}: {
  cartCount: number;
  total: number;
  onOpen: () => void;
}) {
  return (
    <div className="lg:hidden fixed inset-x-0 bottom-3 z-40 px-3 pointer-events-none">
      <div className="mx-auto w-full max-w-md pointer-events-auto">
        <button
          type="button"
          onClick={onOpen}
          aria-label={`Preview cart, ${cartCount} ${cartCount === 1 ? "item" : "items"}, total ₱${total.toFixed(0)}`}
          className="w-full flex items-center justify-between gap-3 rounded-full bg-foreground text-background shadow-lg pl-2 pr-5 py-2 hover:opacity-95 active:scale-[0.99] transition"
        >
          <span className="flex items-center gap-3 min-w-0">
            <span className="h-9 w-9 rounded-full bg-background text-foreground flex items-center justify-center shrink-0 text-sm font-semibold tabular-nums">
              {cartCount}
            </span>
            <span className="text-sm font-semibold">Preview cart</span>
          </span>
          <span className="text-sm font-semibold tabular-nums">
            ₱{total.toFixed(0)}
          </span>
        </button>
      </div>
    </div>
  );
}

/* ============ Cross-viewport: Add-to-Cart Toast ============
   Visible on all breakpoints. On mobile it sits bottom-center above the
   preview pill (if any). On desktop it sits bottom-center of the viewport
   so it doesn't overlap the right-side CartSidePanel — we cap the panel
   width via `max-w-md` and the side panel is anchored ~24rem right of
   center, leaving the center safe.                                       */
function AddToCartToast({
  lastAdded,
  categories,
  hasPillBelow,
}: {
  lastAdded: { item: MenuItem; variantIndex: number | null; nonce: number } | null;
  categories: Category[];
  hasPillBelow: boolean;
}) {
  // Keep the last item around for the slide-down animation after dismissal.
  const [displayed, setDisplayed] = useState(lastAdded);
  useEffect(() => {
    if (lastAdded) setDisplayed(lastAdded);
  }, [lastAdded]);

  const visible = !!lastAdded;
  const item = displayed?.item;
  const variantIndex = displayed?.variantIndex ?? null;
  const subtitle = useMemo(() => {
    if (!item) return "";
    // Prefer the variant name when present; fall back to category name.
    const vName = getVariantName(item, variantIndex);
    if (vName) return vName;
    const cat = categories.find((c) => c.id === item.category_id);
    return cat?.name ?? "";
  }, [item, variantIndex, categories]);

  if (!item) return null;

  // Mobile: above the preview pill if it's there, else closer to the edge.
  // Desktop (lg): always bottom-6, centered.
  const bottomClass = hasPillBelow ? "bottom-20 lg:bottom-6" : "bottom-6";

  return (
    <div
      className={`fixed inset-x-0 ${bottomClass} z-40 px-3 pointer-events-none`}
      aria-live="polite"
    >
      <div className="mx-auto w-full max-w-md lg:max-w-sm">
        <div
          className={`pointer-events-auto bg-card text-foreground border border-border rounded-2xl shadow-lg px-3 py-2.5 flex items-center gap-3 transition-all duration-300 ${
            visible
              ? "translate-y-0 opacity-100"
              : "translate-y-4 opacity-0"
          }`}
        >
          <div className="h-10 w-10 rounded-lg bg-muted overflow-hidden flex items-center justify-center shrink-0">
            {item.image_url ? (
              <img
                src={item.image_url}
                alt=""
                className="h-full w-full object-cover"
              />
            ) : (
              <ShoppingBag className="h-4 w-4 text-muted-foreground" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-foreground leading-tight line-clamp-1">
              {item.name}
            </div>
            {subtitle && (
              <div className="text-xs text-muted-foreground leading-tight mt-0.5 line-clamp-1">
                {subtitle}
              </div>
            )}
          </div>
          <div className="text-xs font-semibold text-foreground shrink-0 pl-2">
            Added!
          </div>
        </div>
      </div>
    </div>
  );
}

/* ============ Variant Selection Modal ============
   Centered dialog (works on both mobile and desktop). Mirrors the
   CartPreviewSheet's scrim + click-to-close pattern but centers the
   inner panel rather than docking it to the bottom edge.                 */
function VariantSelectModal({
  item,
  quickAdd,
  onClose,
  onAdd,
}: {
  item: MenuItem | null;
  quickAdd: boolean;
  onClose: () => void;
  onAdd: (
    item: MenuItem,
    variantIndex: number | null,
    qty: number,
    keepOpen: boolean,
  ) => void;
}) {
  // Keep mounted for one render after close so the fade-out animates.
  const [mounted, setMounted] = useState(!!item);
  const [displayed, setDisplayed] = useState<MenuItem | null>(item);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [qty, setQty] = useState(1);
  // Set-menu mode only: nonce-driven in-modal "Added!" pill. We bump the
  // nonce on each successful add so a fast double-add restarts the timer
  // rather than flickering the pill off briefly.
  const [addedNonce, setAddedNonce] = useState(0);
  const [showAdded, setShowAdded] = useState(false);

  useEffect(() => {
    if (item) {
      setDisplayed(item);
      setMounted(true);
      setSelectedIndex(null);
      setQty(1);
      setShowAdded(false);
      return;
    }
    const t = window.setTimeout(() => {
      setMounted(false);
      setDisplayed(null);
    }, 200);
    return () => window.clearTimeout(t);
  }, [item]);

  // Auto-hide the in-modal "Added!" pill ~2s after each add.
  useEffect(() => {
    if (!showAdded) return;
    const t = window.setTimeout(() => setShowAdded(false), 2000);
    return () => window.clearTimeout(t);
  }, [showAdded, addedNonce]);

  if (!mounted || !displayed) return null;

  const variants = displayed.variants ?? [];
  const hasVariants = variants.length > 0;
  const open = !!item;
  // When the item has no variants, no selection is required — Add is always
  // armed (subject to qty). When variants exist, a selection is required.
  const canAdd = qty > 0 && (!hasVariants || selectedIndex != null);

  const handleAddClick = () => {
    if (!canAdd) return;
    const variantIndex = hasVariants ? selectedIndex : null;
    onAdd(displayed, variantIndex, qty, quickAdd);
    if (quickAdd) {
      // Set-menu: keep the modal open, show the in-place pill, and reset
      // selection + qty so the next add starts from a clean slate.
      setSelectedIndex(null);
      setQty(1);
      setAddedNonce((n) => n + 1);
      setShowAdded(true);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4 py-6"
      role="dialog"
      aria-modal="true"
      aria-label={`Select option for ${displayed.name}`}
    >
      {/* Scrim — click to close, same pattern as CartPreviewSheet */}
      <div
        onClick={onClose}
        className={`absolute inset-0 bg-black/40 transition-opacity duration-200 ${
          open ? "opacity-100" : "opacity-0"
        }`}
      />

      {/* Panel */}
      <div
        className={`relative w-full max-w-md bg-card text-foreground rounded-2xl shadow-xl border border-border max-h-[85vh] flex flex-col overflow-hidden transition-all duration-200 ease-out ${
          open ? "opacity-100 scale-100" : "opacity-0 scale-95"
        }`}
      >
        {/* Close button — floats over the image */}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute top-3 right-3 z-10 h-8 w-8 rounded-full bg-background/90 backdrop-blur-sm flex items-center justify-center text-foreground hover:bg-muted transition shadow-sm"
        >
          <X className="h-4 w-4" />
        </button>

        {/* Scrollable interior — image + name + variants + optional description */}
        <div className="flex-1 overflow-y-auto min-h-0">
          {/* Image */}
          <div className="w-full aspect-square bg-muted overflow-hidden">
            {displayed.image_url ? (
              <img
                src={displayed.image_url}
                alt={displayed.name}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <ShoppingBag className="h-8 w-8 text-muted-foreground" />
              </div>
            )}
          </div>

          <div className="px-5 pt-5 pb-2">
            <h2 className="font-display text-lg sm:text-xl font-bold uppercase tracking-wide text-foreground leading-tight">
              {displayed.name}
            </h2>
            {hasVariants ? (
              <p className="text-sm text-muted-foreground mt-2">
                Which option would you like?
              </p>
            ) : (
              <p className="text-lg font-bold text-foreground mt-2 tabular-nums">
                ₱{Number(displayed.price).toFixed(0)}
              </p>
            )}
          </div>

          {/* Variant list — only rendered when variants exist */}
          {hasVariants && (
          <div className="px-5 pt-3 pb-2">
            {quickAdd && (
              <p className="text-xs text-muted-foreground mb-2">
                Pick a combo, then add it. The modal stays open so you can mix
                and match.
              </p>
            )}
            <ul className="space-y-2">
              {variants.map((v, idx) => {
                // Both modes use the same select-then-confirm flow now.
                // Set-menu mode differs only in that the confirm step keeps
                // the modal open and renders an in-place "Added!" pill.
                const isSel = selectedIndex === idx;
                return (
                  <li key={idx}>
                    <button
                      type="button"
                      onClick={() => setSelectedIndex(idx)}
                      aria-pressed={isSel}
                      className={`w-full flex items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition duration-200 active:scale-[0.98] ${
                        isSel
                          ? "border-foreground bg-muted ring-2 ring-foreground"
                          : "border-border bg-background hover:bg-muted"
                      }`}
                    >
                      <div className="h-10 w-10 rounded-lg bg-muted overflow-hidden flex items-center justify-center shrink-0">
                        {displayed.image_url ? (
                          <img
                            src={displayed.image_url}
                            alt=""
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <ShoppingBag className="h-4 w-4 text-muted-foreground" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold text-foreground leading-tight line-clamp-1">
                          {v.name}
                        </div>
                      </div>
                      <div className="text-sm font-semibold text-foreground tabular-nums shrink-0 pl-2">
                        ₱{Number(v.price).toFixed(0)}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
          )}

          {/* Optional description — only render when present */}
          {displayed.description && (
            <div className="px-5 pt-3 pb-5">
              <p className="text-xs text-muted-foreground leading-relaxed whitespace-pre-line">
                {displayed.description}
              </p>
            </div>
          )}
        </div>

        {/* Footer: stepper + add-to-cart CTA (both modes).
            Set-menu mode keeps the modal open after add and renders an
            in-place "Added!" pill (overlaid above the stepper) instead of
            firing the global AddToCartToast.                            */}
        <div className="relative px-5 pt-3 pb-5 border-t border-border/60 shrink-0 bg-card">
          {/* In-modal "Added!" pill — overlay so it doesn't reflow the
              footer. Anchored just above the stepper row. Set-menu only. */}
          {quickAdd && (
            <div
              className="pointer-events-none absolute left-1/2 -translate-x-1/2 -top-3 z-10"
              aria-live="polite"
            >
              <div
                className={`flex items-center gap-1.5 rounded-full bg-foreground text-background px-3 py-1.5 text-xs font-semibold shadow-md transition-all duration-300 ease-out ${
                  showAdded
                    ? "opacity-100 translate-y-0"
                    : "opacity-0 translate-y-2"
                }`}
              >
                <Check className="h-3.5 w-3.5" />
                Added!
              </div>
            </div>
          )}

          <div className="flex items-center justify-center mb-3">
            <div className="inline-flex items-center rounded-full border border-border bg-background">
              <button
                type="button"
                onClick={() => setQty((q) => Math.max(1, q - 1))}
                aria-label="Decrease quantity"
                disabled={qty <= 1}
                className="h-9 w-9 flex items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed transition"
              >
                <Minus className="h-4 w-4" />
              </button>
              <span className="w-8 text-center text-sm font-semibold tabular-nums">
                {qty}
              </span>
              <button
                type="button"
                onClick={() => setQty((q) => q + 1)}
                aria-label="Increase quantity"
                className="h-9 w-9 flex items-center justify-center text-muted-foreground hover:text-foreground transition"
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>
          </div>

          <button
            type="button"
            onClick={handleAddClick}
            disabled={!canAdd}
            className="w-full inline-flex items-center justify-center gap-2 rounded-full bg-foreground text-background px-5 py-3 text-sm font-semibold hover:opacity-90 transition disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Add to cart
          </button>
        </div>
      </div>
    </div>
  );
}

/* ============ Mobile: Cart Preview Bottom Sheet ============ */
function CartPreviewSheet({
  open,
  onClose,
  cart,
  items,
  updateQty,
  total,
  onCheckout,
}: {
  open: boolean;
  onClose: () => void;
  cart: Cart;
  items: MenuItem[];
  updateQty: (key: string, delta: number) => void;
  total: number;
  onCheckout: () => void;
}) {
  // Keep the sheet mounted for one render after close so the slide-down animates.
  const [mounted, setMounted] = useState(open);
  useEffect(() => {
    if (open) {
      setMounted(true);
      return;
    }
    const t = window.setTimeout(() => setMounted(false), 250);
    return () => window.clearTimeout(t);
  }, [open]);

  const lineItems = useMemo(
    () =>
      Object.entries(cart)
        .map(([key, qty]) => {
          const { itemId, variantIndex } = parseCartKey(key);
          const it = items.find((x) => x.id === itemId);
          if (!it) return null;
          return {
            key,
            qty,
            name: it.name,
            variantName: getVariantName(it, variantIndex),
            price: getLinePrice(it, variantIndex),
            image_url: it.image_url,
          };
        })
        .filter(Boolean) as {
        key: string;
        qty: number;
        name: string;
        variantName: string | null;
        price: number;
        image_url: string | null;
      }[],
    [cart, items],
  );

  if (!mounted) return null;

  return (
    <div
      className="lg:hidden fixed inset-0 z-50"
      role="dialog"
      aria-modal="true"
      aria-label="Your order"
    >
      {/* Scrim */}
      <div
        onClick={onClose}
        className={`absolute inset-0 bg-black/40 transition-opacity duration-200 ${
          open ? "opacity-100" : "opacity-0"
        }`}
      />

      {/* Sheet */}
      <div
        className={`absolute inset-x-0 bottom-0 bg-card text-foreground rounded-t-2xl shadow-xl border-t border-border max-h-[85vh] flex flex-col transition-transform duration-300 ease-out ${
          open ? "translate-y-0" : "translate-y-full"
        }`}
        style={{ height: "70vh" }}
      >
        {/* Header */}
        <div className="px-5 pt-5 pb-4 border-b border-border/60 shrink-0 flex items-center justify-between gap-4">
          <h2 className="font-display text-xl font-semibold tracking-tight">
            Your order
          </h2>
          <div className="flex items-center gap-3">
            <span className="font-display text-xl font-semibold tabular-nums">
              ₱{total.toFixed(0)}
            </span>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close cart preview"
              className="h-8 w-8 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 min-h-0">
          {lineItems.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center">
              <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center mb-3">
                <ShoppingBag className="h-5 w-5 text-muted-foreground" />
              </div>
              <p className="text-sm text-muted-foreground">
                Your cart is empty
              </p>
            </div>
          ) : (
            <ul className="space-y-4">
              {lineItems.map((li) => (
                <li
                  key={li.key}
                  className="flex items-center gap-3"
                >
                  <div className="h-12 w-12 rounded-lg bg-muted overflow-hidden flex items-center justify-center shrink-0">
                    {li.image_url ? (
                      <img
                        src={li.image_url}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <ShoppingBag className="h-4 w-4 text-muted-foreground" />
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <div className="text-sm font-semibold text-foreground leading-tight line-clamp-1">
                        {li.name}
                      </div>
                      <Pencil className="h-3 w-3 text-muted-foreground shrink-0" />
                    </div>
                    {li.variantName && (
                      <div className="text-xs text-muted-foreground leading-tight mt-0.5 line-clamp-1">
                        {li.variantName}
                      </div>
                    )}
                    <div className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
                      ₱{li.price.toFixed(0)}
                    </div>
                  </div>

                  <div className="inline-flex items-center rounded-full border border-border bg-background shrink-0">
                    <button
                      type="button"
                      onClick={() => updateQty(li.key, -1)}
                      aria-label={`Decrease ${li.name}`}
                      className="h-8 w-8 flex items-center justify-center text-muted-foreground hover:text-foreground transition"
                    >
                      <Minus className="h-3.5 w-3.5" />
                    </button>
                    <span className="w-6 text-center text-sm font-semibold tabular-nums">
                      {li.qty}
                    </span>
                    <button
                      type="button"
                      onClick={() => updateQty(li.key, 1)}
                      aria-label={`Increase ${li.name}`}
                      className="h-8 w-8 flex items-center justify-center text-muted-foreground hover:text-foreground transition"
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 pt-4 pb-5 border-t border-border/60 shrink-0 bg-card">
          <button
            type="button"
            onClick={onCheckout}
            disabled={lineItems.length === 0}
            className="w-full inline-flex items-center justify-center gap-2 rounded-full bg-foreground text-background px-5 py-3 text-sm font-semibold hover:opacity-90 transition disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Proceed to checkout
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

/* ============ Cart Side Panel ============ */
function CartSidePanel({
  cart,
  items,
  updateQty,
  total,
  cartCount,
  onCheckout,
}: {
  cart: Cart;
  items: MenuItem[];
  updateQty: (key: string, delta: number) => void;
  total: number;
  cartCount: number;
  onCheckout: () => void;
}) {
  const lineItems = useMemo(
    () =>
      Object.entries(cart)
        .map(([key, qty]) => {
          const { itemId, variantIndex } = parseCartKey(key);
          const it = items.find((x) => x.id === itemId);
          if (!it) return null;
          return {
            key,
            qty,
            name: it.name,
            variantName: getVariantName(it, variantIndex),
            price: getLinePrice(it, variantIndex),
          };
        })
        .filter(Boolean) as {
        key: string;
        qty: number;
        name: string;
        variantName: string | null;
        price: number;
      }[],
    [cart, items],
  );

  const isEmpty = cartCount === 0;

  return (
    <aside
      aria-label="Your order"
      className="
        hidden lg:flex flex-col
        fixed top-24 bottom-16 z-30
        w-[320px] xl:w-[340px]
        left-[calc(50%+24rem+1.5rem)]
        xl:left-[calc(50%+24rem+2rem)]
        max-h-[calc(100vh-10rem)]
      "
    >
      <div className="flex flex-col h-full bg-card text-foreground border border-border rounded-2xl shadow-sm overflow-hidden">
        {/* Header */}
        <div className="px-5 pt-5 pb-4 border-b border-border/60 shrink-0">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-xl font-semibold tracking-tight">
              Your order
            </h2>
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <ShoppingBag className="h-3.5 w-3.5" />
              {cartCount} {cartCount === 1 ? "item" : "items"}
            </span>
          </div>
        </div>

        {/* Body */}
        {isEmpty ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center px-6 py-10">
            <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center mb-4">
              <ShoppingBag className="h-5 w-5 text-muted-foreground" />
            </div>
            <p className="font-display text-base text-foreground mb-1">
              Your cart is empty
            </p>
            <p className="text-xs text-muted-foreground leading-relaxed max-w-[220px]">
              Tap any dish on the left to start building your order.
            </p>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto px-5 py-4 min-h-0">
            <ul className="space-y-4">
              {lineItems.map((li) => (
                <li
                  key={li.key}
                  className="flex items-start justify-between gap-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-foreground leading-snug line-clamp-2">
                      {li.name}
                    </div>
                    {li.variantName && (
                      <div className="text-xs text-muted-foreground mt-0.5 leading-tight line-clamp-1">
                        {li.variantName}
                      </div>
                    )}
                    <div className="text-xs text-muted-foreground mt-0.5">
                      ₱{li.price.toFixed(0)}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1.5 shrink-0">
                    <div className="text-sm font-semibold text-foreground tabular-nums">
                      ₱{(li.price * li.qty).toFixed(0)}
                    </div>
                    <div className="inline-flex items-center rounded-full border border-border bg-background">
                      <button
                        type="button"
                        onClick={() => updateQty(li.key, -1)}
                        aria-label={`Decrease ${li.name}`}
                        className="h-6 w-6 flex items-center justify-center text-muted-foreground hover:text-foreground transition"
                      >
                        <Minus className="h-3 w-3" />
                      </button>
                      <span className="w-5 text-center text-xs font-semibold tabular-nums">
                        {li.qty}
                      </span>
                      <button
                        type="button"
                        onClick={() => updateQty(li.key, 1)}
                        aria-label={`Increase ${li.name}`}
                        className="h-6 w-6 flex items-center justify-center text-muted-foreground hover:text-foreground transition"
                      >
                        <Plus className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Footer */}
        <div className="px-5 pt-4 pb-5 border-t border-border/60 shrink-0 bg-card">
          <div className="flex items-baseline justify-between mb-4">
            <span className="text-xs uppercase tracking-wider text-muted-foreground">
              Total
            </span>
            <span className="font-display text-2xl font-semibold tabular-nums">
              ₱{total.toFixed(0)}
            </span>
          </div>
          <button
            type="button"
            onClick={onCheckout}
            disabled={isEmpty}
            className="w-full inline-flex items-center justify-center gap-2 rounded-full bg-foreground text-background px-5 py-3 text-sm font-semibold hover:opacity-90 transition disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Review order
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </aside>
  );
}

/* ============ Menu Item Card ============ */
function MenuItemCard({
  item,
  onAdd,
}: {
  item: MenuItem;
  onAdd: () => void;
}) {
  const isSetMenu = !item.image_url;

  // Split description on \n or "+" lines for set-menu composition
  const compositionLines = useMemo(() => {
    if (!item.description) return [] as string[];
    // Split on newlines first; if none, split on " + " or "+"
    let raw = item.description.split(/\r?\n/);
    if (raw.length === 1) {
      raw = item.description.split(/\s*\+\s*/);
    }
    return raw.map((s) => s.trim()).filter(Boolean);
  }, [item.description]);

  if (isSetMenu) {
    return (
      <button
        type="button"
        onClick={onAdd}
        className="group relative text-left bg-card rounded-2xl border border-border p-6 flex flex-col items-center text-center hover:shadow-md transition min-h-[280px]"
      >
        {compositionLines.length > 0 && (
          <div className="flex-1 flex flex-col justify-center items-center gap-2 text-xs sm:text-sm font-semibold uppercase tracking-wide leading-snug">
            {compositionLines.map((line, idx) => {
              const isNoDessert = /no\s*dessert/i.test(line);
              const isPlus = line === "+" || line === "";
              return (
                <div key={idx}>
                  {idx > 0 && !isPlus && (
                    <div className="text-muted-foreground font-normal text-base my-1">
                      +
                    </div>
                  )}
                  <div
                    className={
                      isNoDessert
                        ? "text-destructive font-semibold"
                        : "text-foreground"
                    }
                  >
                    {line}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="mt-5 pt-4 border-t border-border/60 w-full">
          <div className="text-xs sm:text-sm font-bold uppercase tracking-wide text-foreground">
            {item.name}
          </div>
          <div className="mt-2 text-lg font-bold text-foreground">
            ₱{item.price.toFixed(0)}
            <span className="text-muted-foreground">+</span>
          </div>
        </div>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onAdd}
      className="group relative text-left bg-card rounded-2xl border border-border overflow-hidden flex flex-col hover:shadow-md transition"
    >
      <div className="w-full aspect-square overflow-hidden bg-muted">
        <img
          src={item.image_url!}
          alt={item.name}
          loading="lazy"
          className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-300"
        />
      </div>
      <div className="p-3 flex-1 flex flex-col items-center text-center gap-1.5">
        <h3 className="text-[11px] sm:text-xs font-semibold uppercase tracking-wide text-foreground leading-snug min-h-[2rem] flex items-center justify-center">
          {item.name}
        </h3>
        <div className="mt-auto pt-0.5 text-sm font-bold text-foreground tabular-nums">
          ₱{item.price.toFixed(0)}
        </div>
      </div>
    </button>
  );
}

/* ============ Payment View ============ */
function PaymentView({
  total,
  onBack,
  onConfirm,
}: {
  total: number;
  onBack: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="max-w-2xl mx-auto">
      <button
        onClick={onBack}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-6"
      >
        <ChevronLeft className="h-4 w-4" /> Back to menu
      </button>

      <h2 className="font-display text-3xl md:text-4xl mb-2">Payment</h2>
      <p className="text-muted-foreground mb-8">
        Send <span className="font-semibold text-primary">₱{total.toFixed(0)}</span> via Maya / InstaPay, then confirm to generate your receipt.
      </p>

      <div className="bg-charcoal text-cream rounded-2xl p-6 mb-8">
        <div className="text-mustard text-xs uppercase tracking-wider mb-2">Send payment to</div>
        <div className="font-display text-2xl mb-1">Sautéo Kitchen</div>
        <div className="text-cream/80 text-sm space-y-1">
          <div>
            Maya / InstaPay: <span className="font-mono text-mustard">+63 917 555 0123</span>
          </div>
          <div>Account name: Sautéo Kitchen Co.</div>
          <div className="pt-2 text-cream/60">
            Amount: <span className="text-cream font-semibold">₱{total.toFixed(0)}</span>
          </div>
        </div>
      </div>

      <button
        onClick={onConfirm}
        className="w-full px-6 py-4 rounded-full bg-primary text-primary-foreground font-medium hover:opacity-90 transition"
      >
        I've paid · Generate receipt
      </button>
    </div>
  );
}

/* ============ Receipt View ============ */
function ReceiptView({
  receipt,
  onNewOrder,
}: {
  receipt: { ref: string; total: number; items: { name: string; qty: number; price: number }[]; at: Date };
  onNewOrder: () => void;
}) {
  return (
    <div className="max-w-2xl mx-auto py-6">
      <div className="text-center mb-8">
        <div className="h-20 w-20 rounded-full bg-mustard/30 mx-auto flex items-center justify-center mb-6">
          <CheckCircle2 className="h-10 w-10 text-primary" />
        </div>
        <h2 className="font-display text-4xl mb-2">Order received!</h2>
        <p className="text-muted-foreground">Thanks. Here's your receipt.</p>
      </div>

      <div id="receipt" className="bg-card border border-border rounded-2xl p-6 md:p-8 mb-6">
        <div className="flex items-start justify-between mb-6 pb-6 border-b border-border">
          <div>
            <div className="font-display text-2xl">Sautéo<span className="text-primary">.</span></div>
            <div className="text-xs text-muted-foreground mt-1">Sautéo Kitchen Co.</div>
          </div>
          <div className="text-right">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">Reference</div>
            <div className="font-mono text-base font-semibold text-primary">{receipt.ref}</div>
          </div>
        </div>

        <div className="text-xs text-muted-foreground mb-4">
          {receipt.at.toLocaleString()}
        </div>

        <table className="w-full text-sm mb-6">
          <thead>
            <tr className="text-left text-muted-foreground border-b border-border">
              <th className="py-2 font-medium">Item</th>
              <th className="py-2 font-medium text-center w-16">Qty</th>
              <th className="py-2 font-medium text-right w-24">Price</th>
              <th className="py-2 font-medium text-right w-24">Subtotal</th>
            </tr>
          </thead>
          <tbody>
            {receipt.items.map((li, i) => (
              <tr key={i} className="border-b border-border/40 last:border-0">
                <td className="py-3">{li.name}</td>
                <td className="py-3 text-center">{li.qty}</td>
                <td className="py-3 text-right text-muted-foreground">₱{li.price.toFixed(0)}</td>
                <td className="py-3 text-right font-medium">₱{(li.price * li.qty).toFixed(0)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="border-t border-border pt-4 flex justify-between items-center">
          <span className="font-medium">Total Paid</span>
          <span className="text-primary text-2xl font-display">₱{receipt.total.toFixed(0)}</span>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <button
          onClick={() => window.print()}
          className="flex-1 inline-flex items-center justify-center gap-2 px-6 py-3 rounded-full border border-border bg-background hover:bg-accent font-medium transition"
        >
          <Printer className="h-4 w-4" /> Print receipt
        </button>
        <button
          onClick={onNewOrder}
          className="flex-1 px-6 py-3 rounded-full bg-foreground text-background font-medium hover:opacity-90 transition"
        >
          Place another order
        </button>
      </div>

      <style>{`
        @media print {
          header, footer, button { display: none !important; }
          #receipt { border: none; padding: 0; }
        }
      `}</style>
    </div>
  );
}
