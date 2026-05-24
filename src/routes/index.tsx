import { createFileRoute, redirect } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import {
  AlertTriangle,
  CalendarClock,
  Camera,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  Image as ImageIcon,
  Loader2,
  Minus,
  Pencil,
  Plus,
  QrCode,
  Search,
  ShoppingBag,
  Sparkles,
  Trash2,
  Truck,
  Upload,
  User as UserIcon,
  X,
} from "lucide-react";
import {
  SENIOR_PWD_DISCOUNT_RATE,
  type CartUnit,
  type Claimant,
  type DiscountSummary,
  makeBlankClaimant,
  summarizeDiscount,
} from "@/lib/seniorDiscount";
import { extractIdFromPhoto, type ExtractIdResult } from "@/lib/extractId";
import {
  friendlyBookingError,
  useInvite,
  type LoadedInvite,
} from "@/lib/invite";
import { formatSlotTime12h } from "@/lib/utils";

// Bare `/` redirects to the read-only /menu page. The booking flows
// (/dine-in, /pick-up) stay reachable only via the tokenized invite
// links Sautéo sends out — landing on the public root shouldn't expose
// them.
export const Route = createFileRoute("/")({
  beforeLoad: () => {
    throw redirect({ to: "/menu" });
  },
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

// Split a variant display name on the " with " connector so we can group
// rows like "Savory Sauce with Coke Zero" under a "Savory Sauce" accordion
// header. Names without the connector are returned with group=null and the
// full name as the option (rendered flat).
function parseVariantName(name: string): { group: string | null; option: string } {
  const idx = name.indexOf(" with ");
  if (idx === -1) return { group: null, option: name };
  return {
    group: name.slice(0, idx).trim(),
    option: name.slice(idx + " with ".length).trim(),
  };
}

type VariantGroupEntry = { variant: MenuItemVariant; index: number; option: string };
type VariantGroup = { name: string; entries: VariantGroupEntry[] };

// Build groups in first-encounter order. The entry.index MUST remain the
// original flat-array index — that's what selectedIndex and the cart-key
// scheme reference downstream.
function buildVariantGroups(variants: MenuItemVariant[]): VariantGroup[] {
  const groups: VariantGroup[] = [];
  const byName = new Map<string, VariantGroup>();
  variants.forEach((v, index) => {
    const { group, option } = parseVariantName(v.name);
    if (group == null) return;
    let g = byName.get(group);
    if (!g) {
      g = { name: group, entries: [] };
      byName.set(group, g);
      groups.push(g);
    }
    g.entries.push({ variant: v, index, option });
  });
  return groups;
}

type ReceiptLine = { name: string; qty: number; price: number };
type ReceiptDiscountLine = {
  itemName: string;
  claimantKind: "senior" | "pwd";
  claimantName: string;
  idNumber: string;
  dateOfBirth: string;
  age: string;
  sex: string;
  dateOfIssue: string;
  discountAmount: number;
};
type ReceiptShape = {
  ref: string;
  items: ReceiptLine[];
  gross: number;
  discount: number;
  total: number;
  discountLines: ReceiptDiscountLine[];
  at: Date;
  slotDate: string;
  slotTime: string;
  customerName: string;
  groupSize: number;
  // Pickup-specific. For dine-in bookings these stay null.
  pickupMode: "dine_in" | "personal_pickup" | "lalamove" | "grab";
  courierAddress: string | null;
  paymentReference: string | null;
};

type AvailableSlot = {
  id: string;
  slot_date: string;
  slot_time: string;
  capacity: number;
  seats_taken: number;
};

// Per-claimant ID-extraction status. Shared by ReservationView (state)
// and ClaimantCard (rendered hint), so it lives at module scope.
type AutoFillStatus =
  | { state: "idle" }
  | { state: "loading" }
  | { state: "filled"; confidence: number }
  | { state: "off" }
  | { state: "failed" };

// Exported for the /book/$token, /dine-in, and /pick-up routes, which
// render this same page either wrapped in InviteContext.Provider (token
// route, prefills + locks customer info and attaches invite_token to
// create_booking) or with a forcedChannel prop (dine-in / pick-up routes,
// which need to gate to the right channel without a token).
export function MenuPage({
  forcedChannel,
}: {
  forcedChannel?: "dine_in" | "pickup";
} = {}) {
  // When rendered under InviteContext.Provider (the /book/$token route),
  // this returns the loaded invite. Without a provider the page is in
  // "menu browse" mode and the checkout gate appears, channel chosen by
  // forcedChannel (or dine-in as a final fallback).
  const invite = useInvite();
  const effectiveChannel = invite?.channel ?? forcedChannel ?? "dine_in";

  const [categories, setCategories] = useState<Category[]>([]);
  const [items, setItems] = useState<MenuItem[]>([]);
  const [cart, setCart] = useState<Cart>({});
  const [view, setView] = useState<View>("menu");
  const [receipt, setReceipt] = useState<ReceiptShape | null>(null);
  // Senior/PWD claims survive going back to the menu so the guest doesn't
  // have to re-enter IDs if they tweak the cart. Reset when an order is
  // placed (after the receipt renders) or when the receipt → new order
  // transition fires.
  const [claimants, setClaimants] = useState<Claimant[]>([]);

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
    })();
  }, []);

  // Expand the cart into per-unit rows so the discount engine can pick the
  // N highest-priced units for N claimants. Each (cart key × qty) becomes
  // qty distinct CartUnit entries.
  const cartUnits = useMemo<CartUnit[]>(() => {
    const out: CartUnit[] = [];
    for (const [key, qty] of Object.entries(cart)) {
      const { itemId, variantIndex } = parseCartKey(key);
      const it = items.find((x) => x.id === itemId);
      if (!it) continue;
      const unitPrice = getLinePrice(it, variantIndex);
      const variantName = getVariantName(it, variantIndex);
      const displayName = variantName ? `${it.name} — ${variantName}` : it.name;
      for (let n = 0; n < qty; n += 1) {
        out.push({
          key: `${key}#${n}`,
          cartKey: key,
          itemId,
          variantIndex,
          displayName,
          unitPrice,
        });
      }
    }
    return out;
  }, [cart, items]);

  const gross = useMemo(
    () => cartUnits.reduce((s, u) => s + u.unitPrice, 0),
    [cartUnits],
  );

  // Live discount summary based on however many claimants are currently
  // staged. Used in PaymentView for the live-updating total. Even partly-
  // filled claimant rows count toward the discount preview — the form
  // gates the actual checkout with a per-row validity check.
  const discountSummary: DiscountSummary = useMemo(
    () => summarizeDiscount(cartUnits, claimants.length),
    [cartUnits, claimants.length],
  );

  // The menu-view "Total" button still shows the sticker total (no claim
  // form on that screen). PaymentView and ReceiptView use discountSummary.net.
  const total = gross;
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

  // placeOrder is the post-RPC step. ReservationView calls create_booking
  // and, on success, passes the returned reference_code and the chosen
  // slot back here so we can render the receipt with real data.
  const placeOrder = (args: {
    referenceCode: string;
    slot: AvailableSlot;
    customerName: string;
    groupSize: number;
    pickupMode?: "dine_in" | "personal_pickup" | "lalamove" | "grab";
    courierAddress?: string | null;
    paymentReference?: string | null;
  }) => {
    const lineItems: ReceiptLine[] = Object.entries(cart)
      .map(([key, qty]) => {
        const { itemId, variantIndex } = parseCartKey(key);
        const it = items.find((x) => x.id === itemId);
        if (!it) return null;
        const variantName = getVariantName(it, variantIndex);
        const displayName = variantName ? `${it.name} — ${variantName}` : it.name;
        return { name: displayName, qty, price: getLinePrice(it, variantIndex) };
      })
      .filter(Boolean) as ReceiptLine[];

    // Snapshot the per-claimant discount picks at the time of order so the
    // receipt matches what the guest just authorized — even if they later
    // re-open the menu in this session.
    const discountLines: ReceiptDiscountLine[] = discountSummary.discountedUnits.map(
      (du) => {
        const c = claimants[du.claimantIndex];
        return {
          itemName: du.unit.displayName,
          claimantKind: c?.kind ?? "senior",
          claimantName: c?.fullName ?? "",
          idNumber: c?.idNumber ?? "",
          dateOfBirth: c?.dateOfBirth ?? "",
          age: c?.age ?? "",
          sex: c?.sex ?? "",
          dateOfIssue: c?.dateOfIssue ?? "",
          discountAmount: du.discountAmount,
        };
      },
    );

    setReceipt({
      ref: args.referenceCode,
      items: lineItems,
      gross: discountSummary.gross,
      discount: discountSummary.discount,
      total: discountSummary.net,
      discountLines,
      at: new Date(),
      slotDate: args.slot.slot_date,
      slotTime: args.slot.slot_time,
      customerName: args.customerName,
      groupSize: args.groupSize,
      pickupMode: args.pickupMode ?? "dine_in",
      courierAddress: args.courierAddress ?? null,
      paymentReference: args.paymentReference ?? null,
    });
    setCart({});
    setClaimants([]);
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
            cart={cart}
            updateQty={updateQty}
            addToCart={addToCart}
            total={total}
            cartCount={cartCount}
            onCheckout={() => setView("payment")}
          />
        )}
        {view === "payment" &&
          (effectiveChannel === "pickup" ? (
            <PickupReservationView
              invite={invite}
              cart={cart}
              items={items}
              gross={gross}
              cartUnitCount={cartUnits.length}
              claimants={claimants}
              setClaimants={setClaimants}
              discountSummary={discountSummary}
              onBack={() => setView("menu")}
              onConfirm={placeOrder}
            />
          ) : (
            <DineInReservationView
              invite={invite}
              cart={cart}
              items={items}
              gross={gross}
              cartUnitCount={cartUnits.length}
              claimants={claimants}
              setClaimants={setClaimants}
              discountSummary={discountSummary}
              onBack={() => setView("menu")}
              onConfirm={placeOrder}
            />
          ))}
        {view === "receipt" && receipt && (
          <ReceiptView receipt={receipt} />
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
  cart,
  updateQty,
  addToCart,
  total,
  cartCount,
  onCheckout,
}: {
  categories: Category[];
  items: MenuItem[];
  cart: Cart;
  updateQty: (key: string, delta: number) => void;
  addToCart: (itemId: string, variantIndex: number | null, qty: number) => void;
  total: number;
  cartCount: number;
  onCheckout: () => void;
}) {
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  // Accordion expansion state.
  //   - In normal (non-search) mode: at most ONE id is expanded (radio-style).
  //     The id stored here is the currently expanded category, or null if all
  //     are collapsed. We seed it lazily with the first category id once
  //     categories arrive (see effect below).
  //   - In search mode this state is ignored; every category with matches is
  //     auto-expanded instead (computed inline in the render).
  // All categories start collapsed by default — the customer chooses which
  // category to browse first.
  const [expandedId, setExpandedId] = useState<string | null>(null);

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

  // Toggle a category. Radio-style: opening a new one closes the previously
  // open one; tapping the open one again collapses it (null).
  const handleToggle = (id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
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

      {/* Scrollable menu area — only this scrolls; the page does not.
          The accordion headers act as the navigation now (no sticky pill bar). */}
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto -mx-4 sm:-mx-6 px-4 sm:px-6 min-h-0"
      >
        <div className={`pt-4 ${cartCount > 0 ? "pb-32 lg:pb-12" : "pb-12"}`}>
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

          <div className="divide-y divide-border border-y border-border">
            {categories.map((c) => {
              const list = itemsByCategory[c.id] ?? [];
              // When searching, hide categories with zero matches entirely.
              if (isSearching && list.length === 0) return null;

              // Search mode auto-expands every visible category (override
              // single-expansion). Otherwise honor the radio-style expandedId.
              const isOpen = isSearching ? true : expandedId === c.id;
              const panelId = `category-panel-${c.id}`;
              const itemCount = list.length;

              return (
                <section key={c.id} data-category-id={c.id}>
                  {/* Header — full-width tappable button, min 44px tall */}
                  <h2 className="m-0">
                    <button
                      type="button"
                      onClick={() => handleToggle(c.id)}
                      aria-expanded={isOpen}
                      aria-controls={panelId}
                      className="group w-full flex items-center justify-between gap-4 min-h-[56px] py-4 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/20 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                    >
                      <span className="flex items-baseline gap-2 min-w-0">
                        <span className="font-display text-xl md:text-2xl font-semibold text-foreground tracking-tight truncate">
                          {c.name}
                        </span>
                        <span className="text-sm text-muted-foreground shrink-0">
                          · {itemCount} {itemCount === 1 ? "item" : "items"}
                        </span>
                      </span>
                      <ChevronDown
                        aria-hidden="true"
                        className={`h-5 w-5 shrink-0 text-muted-foreground transition-transform duration-300 ${
                          isOpen ? "rotate-180" : "rotate-0"
                        }`}
                      />
                    </button>
                  </h2>

                  {/* Body — CSS grid trick: animate grid-template-rows from
                      0fr → 1fr so the inner content's natural height drives
                      the open height with a smooth transition. */}
                  <div
                    id={panelId}
                    aria-hidden={!isOpen}
                    className={`grid transition-[grid-template-rows] duration-300 ease-out ${
                      isOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
                    }`}
                  >
                    <div className="overflow-hidden">
                      <div
                        className={`pb-6 transition-opacity duration-200 ${
                          isOpen ? "opacity-100" : "opacity-0"
                        }`}
                      >
                        {list.length === 0 ? (
                          <p className="text-sm text-muted-foreground">
                            No items yet
                          </p>
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
                      </div>
                    </div>
                  </div>
                </section>
              );
            })}
          </div>
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
  // Multi-select: tick multiple variants, then a single "Add to cart" adds
  // `qty` of each ticked variant to the cart.
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(
    () => new Set(),
  );
  const [qty, setQty] = useState(1);
  // Set-menu mode only: nonce-driven in-modal "Added!" pill. We bump the
  // nonce on each successful add so a fast double-add restarts the timer
  // rather than flickering the pill off briefly.
  const [addedNonce, setAddedNonce] = useState(0);
  const [showAdded, setShowAdded] = useState(false);
  // Which accordion group is currently expanded. Only meaningful when the
  // current item's variants build 2+ distinct groups (otherwise we render
  // the flat radio list and ignore this entirely).
  const [openGroup, setOpenGroup] = useState<string | null>(null);

  useEffect(() => {
    if (item) {
      setDisplayed(item);
      setMounted(true);
      setSelectedIndices(new Set());
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

  // When a new item is opened, default the accordion to its first group
  // (only relevant for items whose variants build 2+ groups; otherwise
  // openGroup is unused).
  useEffect(() => {
    if (!item) return;
    const vs = item.variants ?? [];
    const gs = buildVariantGroups(vs);
    setOpenGroup(gs.length >= 2 ? gs[0].name : null);
  }, [item]);

  // Toggle a variant's selection. As a side effect, opens the accordion
  // group containing the just-toggled variant so the user can see what they
  // just picked. Inline (not in an effect) so manual accordion header taps
  // are NEVER fought by selection state.
  const toggleSelection = (idx: number) => {
    setSelectedIndices((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
    const v = displayed?.variants?.[idx];
    if (v) {
      const { group } = parseVariantName(v.name);
      if (group) setOpenGroup(group);
    }
  };

  if (!mounted || !displayed) return null;

  const variants = displayed.variants ?? [];
  const hasVariants = variants.length > 0;
  const open = !!item;

  // Decide flat vs accordion. We only switch to accordion when there are
  // 2+ distinct "X with …" groups; one-group or zero-group items render
  // as the existing flat radio list (Coke, Iced Tea, à la carte burgers).
  const groups = buildVariantGroups(variants);
  const useAccordion = groups.length >= 2;
  // When the item has no variants, no selection is required — Add is always
  // armed (subject to qty). When variants exist, at least one must be ticked.
  const canAdd =
    qty > 0 && (!hasVariants || selectedIndices.size > 0);

  const handleAddClick = () => {
    if (!canAdd) return;
    if (!hasVariants) {
      onAdd(displayed, null, qty, quickAdd);
    } else {
      // Multi-add: every ticked variant gets `qty` units added to the cart.
      // We pass keepOpen=true for all but the last call so the parent
      // doesn't close the modal mid-loop in classic mode. After the loop,
      // the final call respects the real quickAdd flag.
      const indices = Array.from(selectedIndices);
      indices.forEach((variantIndex, i) => {
        const isLast = i === indices.length - 1;
        const keepOpen = quickAdd || !isLast;
        onAdd(displayed, variantIndex, qty, keepOpen);
      });
    }
    if (quickAdd) {
      // Set-menu / multi-variant: keep the modal open, show the in-place
      // pill, and reset selections + qty so the next batch starts clean.
      setSelectedIndices(new Set());
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

          {/* Variant list — only rendered when variants exist.
              Items whose variant names share a "X with Y" prefix get
              grouped into single-expansion accordion sections. Items
              with one (or zero) such groups render flat as before. */}
          {hasVariants && (() => {
            // Renders one selectable radio row for the variant at the given
            // original index. `label` lets the accordion mode strip the
            // shared "<group> with " prefix; flat mode passes the full name.
            const renderRow = (idx: number, label: string) => {
              const v = variants[idx];
              const isSel = selectedIndices.has(idx);
              return (
                <li key={idx}>
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={isSel}
                    onClick={() => toggleSelection(idx)}
                    className={`w-full flex items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition duration-200 active:scale-[0.98] ${
                      isSel
                        ? "border-foreground bg-muted"
                        : "border-border bg-background hover:bg-muted"
                    }`}
                  >
                    {/* Checkbox indicator (left) — filled square with check
                        icon when selected, empty bordered square otherwise. */}
                    <span
                      aria-hidden="true"
                      className={`relative h-5 w-5 shrink-0 rounded-md border-2 flex items-center justify-center transition-colors ${
                        isSel
                          ? "border-foreground bg-foreground text-background"
                          : "border-border bg-transparent"
                      }`}
                    >
                      <Check
                        className={`h-3 w-3 transition-transform duration-150 ${
                          isSel ? "scale-100" : "scale-0"
                        }`}
                        strokeWidth={3}
                      />
                    </span>
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
                        {label}
                      </div>
                    </div>
                    <div className="text-sm font-semibold text-foreground tabular-nums shrink-0 pl-2">
                      ₱{Number(v.price).toFixed(0)}
                    </div>
                  </button>
                </li>
              );
            };

            return (
              <div className="px-5 pt-3 pb-2">
                {quickAdd && (
                  <p className="text-xs text-muted-foreground mb-2">
                    Pick a combo, then add it. The modal stays open so you can mix
                    and match.
                  </p>
                )}
                {useAccordion ? (
                  <div className="space-y-2">
                    {groups.map((g) => {
                      const isOpen = openGroup === g.name;
                      const minPrice = g.entries.reduce(
                        (m, e) => Math.min(m, Number(e.variant.price)),
                        Number.POSITIVE_INFINITY,
                      );
                      const bodyId = `variant-group-${g.name.replace(/\s+/g, "-").toLowerCase()}`;
                      return (
                        <div
                          key={g.name}
                          className="rounded-xl border border-border bg-background overflow-hidden"
                        >
                          <button
                            type="button"
                            onClick={() => setOpenGroup(isOpen ? null : g.name)}
                            aria-expanded={isOpen}
                            aria-controls={bodyId}
                            className="w-full flex items-center justify-between gap-3 px-3 py-3 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/20 focus-visible:ring-inset"
                          >
                            <span className="flex items-baseline gap-2 min-w-0">
                              <span className="font-display text-sm sm:text-base font-semibold text-foreground truncate">
                                {g.name}
                              </span>
                              <span className="text-muted-foreground text-xs shrink-0 tabular-nums">
                                from ₱{minPrice.toFixed(0)}
                              </span>
                            </span>
                            <ChevronDown
                              aria-hidden="true"
                              className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-300 ${
                                isOpen ? "rotate-180" : "rotate-0"
                              }`}
                            />
                          </button>
                          {/* Body — same grid-rows 0fr/1fr trick used by the
                              menu category accordion so the two feel consistent. */}
                          <div
                            id={bodyId}
                            aria-hidden={!isOpen}
                            className={`grid transition-[grid-template-rows] duration-300 ease-out ${
                              isOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
                            }`}
                          >
                            <div className="overflow-hidden">
                              <ul
                                className={`px-2 pb-2 pt-1 space-y-2 transition-opacity duration-200 ${
                                  isOpen ? "opacity-100" : "opacity-0"
                                }`}
                                role="group"
                                aria-label={`${g.name} options`}
                              >
                                {g.entries.map((e) => renderRow(e.index, e.option))}
                              </ul>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <ul
                    className="space-y-2"
                    role="group"
                    aria-label="Variant options"
                  >
                    {variants.map((v, idx) => renderRow(idx, v.name))}
                  </ul>
                )}
              </div>
            );
          })()}

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

/* ============ Dine-In Reservation View ============
   Customers reach this screen via a dine-in invite link from Sautéo
   management after they've cleared the Messenger waitlist + paid. So this
   is the "confirm your slot" step — no QR / payment proof, but the booking
   row still gets created with status='pending' and payment row as
   'submitted' (admin flips both to 'verified' / 'confirmed' from the
   Orders tab once they reconcile the upstream payment).

   Pickup customers get a separate view (PickupReservationView) — that flow
   collects payment on the web via Maya QR, plus pickup-mode + courier
   address. The Senior/PWD claim section is shared in shape but lives in
   each view's body so the two flows stay independently editable.        */
// Shared shape between DineIn and Pickup onConfirm — optional pickup fields
// are populated only by the pickup view.
type ConfirmArgs = {
  referenceCode: string;
  slot: AvailableSlot;
  customerName: string;
  groupSize: number;
  pickupMode?: "dine_in" | "personal_pickup" | "lalamove" | "grab";
  courierAddress?: string | null;
  paymentReference?: string | null;
};

function DineInReservationView({
  invite,
  cart,
  items,
  gross,
  cartUnitCount,
  claimants,
  setClaimants,
  discountSummary,
  onBack,
  onConfirm,
}: {
  invite: LoadedInvite | null;
  cart: Cart;
  items: MenuItem[];
  gross: number;
  cartUnitCount: number;
  claimants: Claimant[];
  setClaimants: React.Dispatch<React.SetStateAction<Claimant[]>>;
  discountSummary: DiscountSummary;
  onBack: () => void;
  onConfirm: (args: ConfirmArgs) => void;
}) {
  const claimFormOpen = claimants.length > 0;
  const payable = discountSummary.net;

  // Slot picker state.
  const [slots, setSlots] = useState<AvailableSlot[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(true);
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null);

  // Customer info — prefilled from the invite when available so the customer
  // only has to pick a slot. Fields stay editable (in case the waitlist had
  // typos) BUT we surface a hint that the name/email/phone match what
  // Sautéo collected on Messenger.
  const [customerName, setCustomerName] = useState(invite?.customerName ?? "");
  const [customerEmail, setCustomerEmail] = useState(invite?.customerEmail ?? "");
  const [customerPhone, setCustomerPhone] = useState(invite?.customerPhone ?? "");
  const [groupSize, setGroupSize] = useState<number>(invite?.groupSize ?? 2);
  const [notes, setNotes] = useState("");

  // QR display fallback — flips to true when /maya-qr.png 404s so the
  // payment card still renders gracefully without the image.
  const [qrImgError, setQrImgError] = useState(false);

  // Wizard step. Matches the pickup checkout: each step fits one screen
  // so the customer never has to scroll past a long form to pay.
  //   1 — Your details (name/email/phone/group/notes)
  //   2 — Slot (date + time picker)
  //   3 — Discount + payment (senior toggle + Maya QR + proof) → Confirm
  const [step, setStep] = useState<1 | 2 | 3>(1);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Load upcoming, open slots with remaining capacity. The RLS policy on
  // time_slots permits public SELECT, so this works with the anon key.
  useEffect(() => {
    (async () => {
      setSlotsLoading(true);
      const today = new Date().toISOString().slice(0, 10);
      const { data, error } = await supabase
        .from("time_slots")
        .select("id, slot_date, slot_time, capacity, seats_taken, is_open")
        .gte("slot_date", today)
        .eq("is_open", true)
        .order("slot_date")
        .order("slot_time");
      if (error) {
        console.warn("[slots] load failed:", error);
        setSlots([]);
      } else {
        setSlots(
          ((data ?? []) as AvailableSlot[]).filter(
            (s) => s.seats_taken < s.capacity,
          ),
        );
      }
      setSlotsLoading(false);
    })();
  }, []);

  const slotsByDate = useMemo(() => {
    const m: Record<string, AvailableSlot[]> = {};
    for (const s of slots) (m[s.slot_date] ||= []).push(s);
    return m;
  }, [slots]);

  const selectedSlot = useMemo(
    () => slots.find((s) => s.id === selectedSlotId) ?? null,
    [slots, selectedSlotId],
  );

  // ---- Validation -----------------------------------------------------
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail.trim());
  const nameValid =
    customerName.trim().length >= 1 && customerName.trim().length <= 120;
  const phoneTrimmed = customerPhone.trim();
  const phoneValid = phoneTrimmed.length >= 7 && phoneTrimmed.length <= 32;
  const groupSizeValid = groupSize >= 1 && groupSize <= 50;
  const slotCapacityOk =
    !selectedSlot ||
    selectedSlot.seats_taken + groupSize <= selectedSlot.capacity;

  // Required-field set, in priority order per Sautéo:
  //   1. Full name
  //   2. Age (verifies senior status, must be 60+ per RA 9994)
  //   3. Date of birth (cross-checks age)
  //   4. Date of issue (proves the ID is current)
  //   5. ID photo (admin verification)
  // ID number and address are still collected (and shown on the receipt
  // when present) but don't block submit — many LGU SC IDs have a short
  // ID number or no street address that would fail strict validation.
  const allClaimsValid = useMemo(
    () =>
      claimants.every(
        (c) =>
          c.fullName.trim().length >= 2 &&
          c.age.trim().length >= 1 &&
          c.dateOfBirth.trim().length >= 4 &&
          c.dateOfIssue.trim().length >= 4 &&
          !!c.idPhotoFile,
      ),
    [claimants],
  );

  // Per-step validity gates. Continue is enabled only when the current
  // step's required fields are all valid. Final submit gate (`canSubmit`)
  // re-checks everything as a defense in depth.
  const step1Valid = nameValid && emailValid && phoneValid && groupSizeValid;
  const step2Valid = !!selectedSlot && slotCapacityOk;
  const step3Valid = !claimFormOpen || allClaimsValid;

  const canSubmit =
    !submitting &&
    cartUnitCount > 0 &&
    step1Valid &&
    step2Valid &&
    step3Valid;

  // Step transitions scroll the next panel into view so the user lands at
  // the top of the new step instead of mid-page.
  const goToStep = (s: 1 | 2 | 3) => {
    setStep(s);
    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  // Trim claimants to cart size as before.
  useEffect(() => {
    if (claimants.length > cartUnitCount) {
      setClaimants((prev) => prev.slice(0, Math.max(cartUnitCount, 0)));
    }
  }, [cartUnitCount, claimants.length, setClaimants]);

  // Per-claimant ID autofill state. `idle`/`off`/`failed` render nothing
  // disruptive; `loading` shows a spinner; `filled` shows a "please verify"
  // hint with the model's confidence. The abort map cancels stale OCR
  // requests when the same row's photo is replaced quickly.
  const [autoFillByIdx, setAutoFillByIdx] = useState<Record<number, AutoFillStatus>>(
    {},
  );
  const extractAbortByIdx = useRef<Record<number, AbortController>>({});

  const toggleClaim = () => {
    setClaimants((prev) => (prev.length > 0 ? [] : [makeBlankClaimant("senior")]));
  };

  const addClaimant = () => {
    if (claimants.length >= cartUnitCount) return;
    setClaimants((prev) => [...prev, makeBlankClaimant("senior")]);
  };

  const removeClaimant = (idx: number) => {
    setClaimants((prev) => {
      // Revoke any preview URLs we created so we don't leak.
      const removed = prev[idx];
      if (removed?.idPhotoUrl) URL.revokeObjectURL(removed.idPhotoUrl);
      const next = prev.filter((_, i) => i !== idx);
      // Always keep at least one row open while the toggle is on. If the
      // last row was removed, close the form by emptying the array (the
      // toggle reads claimants.length > 0).
      return next;
    });
  };

  const updateClaimant = (idx: number, patch: Partial<Claimant>) => {
    setClaimants((prev) =>
      prev.map((c, i) => (i === idx ? { ...c, ...patch } : c)),
    );
  };

  const onPhotoChange = (idx: number, file: File | null) => {
    setClaimants((prev) => {
      const next = [...prev];
      const cur = next[idx];
      if (cur?.idPhotoUrl) URL.revokeObjectURL(cur.idPhotoUrl);
      next[idx] = {
        ...cur,
        idPhotoFile: file,
        idPhotoUrl: file ? URL.createObjectURL(file) : null,
      };
      return next;
    });

    // Abort any in-flight extraction for this slot — the photo just
    // changed, so the previous result is stale.
    extractAbortByIdx.current[idx]?.abort();
    if (!file) {
      setAutoFillByIdx((m) => ({ ...m, [idx]: { state: "idle" } }));
      return;
    }

    const ac = new AbortController();
    extractAbortByIdx.current[idx] = ac;
    setAutoFillByIdx((m) => ({ ...m, [idx]: { state: "loading" } }));

    (async () => {
      let result: ExtractIdResult;
      try {
        result = await extractIdFromPhoto(file, ac.signal);
      } catch (e) {
        if ((e as DOMException)?.name === "AbortError") return;
        setAutoFillByIdx((m) => ({ ...m, [idx]: { state: "failed" } }));
        return;
      }
      if (ac.signal.aborted) return;

      if (!result.available) {
        // Key not set yet, or function unreachable — fall back silently to
        // manual entry. Use "off" so we don't flash an error.
        setAutoFillByIdx((m) => ({ ...m, [idx]: { state: "off" } }));
        return;
      }

      // Autofill — but only fill empty fields, so we don't stomp anything
      // the user already typed before the OCR returned. The 'kind' field
      // gets adjusted if the model is highly confident.
      setClaimants((prev) =>
        prev.map((c, i) => {
          if (i !== idx) return c;
          return {
            ...c,
            kind:
              result.kind === "senior" || result.kind === "pwd"
                ? result.kind
                : c.kind,
            fullName: c.fullName.trim() ? c.fullName : result.full_name,
            idNumber: c.idNumber.trim() ? c.idNumber : result.id_number,
            address: c.address.trim() ? c.address : result.address,
            dateOfBirth: c.dateOfBirth.trim() ? c.dateOfBirth : result.date_of_birth,
            age: c.age.trim() ? c.age : result.age,
            sex: c.sex.trim() ? c.sex : result.sex,
            dateOfIssue: c.dateOfIssue.trim() ? c.dateOfIssue : result.date_of_issue,
          };
        }),
      );
      setAutoFillByIdx((m) => ({
        ...m,
        [idx]: { state: "filled", confidence: result.confidence },
      }));
    })();
  };

  // ---- Submit: call create_booking RPC --------------------------------
  // The RPC takes items as [{ menu_item_id, quantity }]. The cart can hold
  // multiple variants of the same menu_item_id at different prices, but
  // the RPC doesn't yet know about variants — it looks up the base price
  // from menu_items.price. We aggregate cart units by menu_item_id so the
  // RPC inserts one booking_items row per menu item with summed qty. Variant
  // info gets packed into the notes field for the admin's awareness.
  const handleSubmit = async () => {
    if (!canSubmit || !selectedSlot) return;
    setSubmitError(null);
    setSubmitting(true);

    // Aggregate by menu_item_id and collect variant detail for notes.
    const qtyByMenuItemId: Record<string, number> = {};
    const variantDetailLines: string[] = [];
    for (const [key, qty] of Object.entries(cart)) {
      const { itemId, variantIndex } = parseCartKey(key);
      qtyByMenuItemId[itemId] = (qtyByMenuItemId[itemId] || 0) + qty;
      if (variantIndex != null) {
        const it = items.find((x) => x.id === itemId);
        const vName = it ? getVariantName(it, variantIndex) : null;
        if (it && vName) variantDetailLines.push(`${qty}× ${it.name} — ${vName}`);
      }
    }

    const userNote = notes.trim();
    const variantNote = variantDetailLines.length
      ? `Variants: ${variantDetailLines.join("; ")}`
      : "";
    const combinedNotes = [userNote, variantNote]
      .filter(Boolean)
      .join(" | ")
      .slice(0, 500);

    const payload: Record<string, unknown> = {
      slot_id: selectedSlot.id,
      customer_name: customerName.trim(),
      customer_email: customerEmail.trim().toLowerCase(),
      customer_phone: customerPhone.trim(),
      group_size: groupSize,
      notes: combinedNotes || null,
      pickup_mode: invite?.channel === "pickup" ? "personal_pickup" : "dine_in",
      items: Object.entries(qtyByMenuItemId).map(([menu_item_id, quantity]) => ({
        menu_item_id,
        quantity,
      })),
    };

    // Attaching the invite token causes create_booking() to atomically
    // validate + mark it used in the same transaction. Without this, anon
    // callers are rejected with 'invite_required'.
    if (invite?.token) payload.invite_token = invite.token;

    // create_booking returns jsonb { booking_id, reference_code, total_amount }.
    // The generated types are stale (the migration hasn't been re-introspected
    // since the RPC was added), so we cast through `as any` here and
    // re-validate the shape below.
    const { data, error } = await (supabase.rpc as any)("create_booking", {
      payload,
    });
    if (error) {
      setSubmitting(false);
      setSubmitError(friendlyBookingError(error.message));
      return;
    }
    const result = (data ?? {}) as { reference_code?: string };
    if (!result.reference_code) {
      setSubmitting(false);
      setSubmitError("Booking didn't return a reference code. Contact us in Messenger.");
      return;
    }

    setSubmitting(false);
    onConfirm({
      referenceCode: result.reference_code,
      slot: selectedSlot,
      customerName: customerName.trim(),
      groupSize,
    });
  };

  // No invite = "/" visitor who tapped Review order. Booking is only
  // available through a one-time invite link sent by Sautéo after the
  // Messenger waitlist clears — show that explanation here instead of the
  // form. Keeps the menu page browsable for SEO / casual visitors without
  // leaking a way to bypass the waitlist.
  if (!invite) {
    return (
      <div className="max-w-2xl mx-auto">
        <button
          onClick={onBack}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-6"
        >
          <ChevronLeft className="h-4 w-4" /> Back to menu
        </button>

        <div className="bg-card border border-border rounded-2xl p-6 md:p-8 shadow-sm text-center">
          <div className="mx-auto h-14 w-14 rounded-full bg-mustard/30 flex items-center justify-center mb-5">
            <Sparkles className="h-6 w-6 text-primary" />
          </div>
          <h2 className="font-display text-2xl md:text-3xl mb-2">
            Booking is invite-only
          </h2>
          <p className="text-muted-foreground text-sm leading-relaxed mb-6">
            Sautéo runs a Messenger-based waitlist. When you reach the front
            of the line, our team will send you a one-time booking link
            (good for {/* keep token expiry copy in sync with migration */}
            <span className="text-foreground font-medium">72 hours</span>)
            that brings you straight to this screen with your details
            pre-filled.
          </p>
          <a
            href="https://www.facebook.com/messages/t/1119234891273865"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center justify-center gap-2 rounded-full bg-primary text-primary-foreground px-5 py-3 text-sm font-semibold hover:opacity-90 transition"
          >
            Message us on Messenger
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto">
      <button
        onClick={onBack}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-6"
      >
        <ChevronLeft className="h-4 w-4" /> Back to menu
      </button>

      <div className="flex items-center gap-2 mb-2">
        <Sparkles className="h-6 w-6 text-primary" />
        <h2 className="font-display text-3xl md:text-4xl">
          Confirm your reservation
        </h2>
      </div>
      <p className="text-muted-foreground mb-5">
        Step {step} of 3 — your total is{" "}
        <span className="font-semibold text-primary">
          ₱{payable.toFixed(0)}
        </span>
        .
      </p>

      {/* Progress indicator — three labelled pills with a connector bar.
          Completed steps are clickable so the user can jump back; future
          steps are not (must satisfy current step first). Mirrors the
          pickup checkout's progress nav. */}
      <div className="mb-6">
        <ol className="flex items-center gap-2">
          {([
            { n: 1 as const, label: "Your details", done: step > 1 || step1Valid },
            { n: 2 as const, label: "Slot", done: step > 2 || step2Valid },
            { n: 3 as const, label: "Payment", done: false },
          ]).map((s, i, arr) => {
            const active = step === s.n;
            const reachable = s.n <= step;
            return (
              <li key={s.n} className="flex items-center gap-2 flex-1">
                <button
                  type="button"
                  onClick={() => reachable && goToStep(s.n)}
                  disabled={!reachable}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold transition ${
                    active
                      ? "bg-foreground text-background"
                      : s.done
                      ? "bg-primary/10 text-primary"
                      : "bg-muted text-muted-foreground"
                  } disabled:cursor-not-allowed`}
                >
                  <span
                    className={`h-5 w-5 rounded-full inline-flex items-center justify-center text-[10px] tabular-nums ${
                      active
                        ? "bg-background/20 text-background"
                        : s.done
                        ? "bg-primary text-primary-foreground"
                        : "bg-background text-muted-foreground"
                    }`}
                  >
                    {s.done && !active ? (
                      <Check className="h-3 w-3" />
                    ) : (
                      s.n
                    )}
                  </span>
                  <span className="hidden sm:inline">{s.label}</span>
                </button>
                {i < arr.length - 1 && (
                  <span
                    className={`flex-1 h-px ${
                      arr[i + 1].done || step > s.n ? "bg-primary/30" : "bg-border"
                    }`}
                  />
                )}
              </li>
            );
          })}
        </ol>
      </div>

      {/* ============ STEP 3 — Senior/PWD discount (rendered with payment) ============
          Renders the toggle by default; when on,
          expands into N claim rows (one per cardholder). Each row collects
          the fields RA 9994 requires for the OR: full name, ID number,
          address, ID photo. The number of rows is capped at the number of
          cart units so we can't promise more discount than there's items. */}
      {step === 3 && (
      <div className="bg-card border border-border rounded-2xl p-5 mb-8 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary shrink-0" />
              <h3 className="font-display text-lg font-semibold">
                Senior / PWD discount
              </h3>
            </div>
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
              Per RA 9994 / RA 10754 — {Math.round(SENIOR_PWD_DISCOUNT_RATE * 100)}% off
              and VAT-exempt on one qualifying bundle per ID. Upload one ID per claimant.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={claimFormOpen}
            onClick={toggleClaim}
            className={`relative inline-flex h-6 w-11 shrink-0 rounded-full transition-colors ${
              claimFormOpen ? "bg-foreground" : "bg-muted"
            }`}
          >
            <span
              className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-background shadow transition-transform ${
                claimFormOpen ? "translate-x-5" : "translate-x-0"
              }`}
            />
          </button>
        </div>

        {claimFormOpen && (
          <div className="mt-5 space-y-4">
            {cartUnitCount === 0 && (
              <div className="text-xs text-destructive bg-destructive/10 border border-destructive/30 rounded-lg p-3">
                Add at least one item to the cart before claiming a discount.
              </div>
            )}

            <div className="text-[11px] text-muted-foreground bg-muted/40 border border-border rounded-lg p-3 leading-relaxed">
              Uploaded ID photos are sent to our verification provider to read
              the name, ID number, and address — to save you typing. Fields
              remain editable. By proceeding you consent to this processing
              under the Data Privacy Act of 2012.
            </div>

            {claimants.map((c, idx) => (
              <ClaimantCard
                key={idx}
                index={idx}
                claimant={c}
                autoFill={autoFillByIdx[idx] ?? { state: "idle" }}
                onChange={(patch) => updateClaimant(idx, patch)}
                onPhotoChange={(file) => onPhotoChange(idx, file)}
                onRemove={() => removeClaimant(idx)}
              />
            ))}

            <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
              <button
                type="button"
                onClick={addClaimant}
                disabled={claimants.length >= cartUnitCount}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-foreground bg-muted hover:bg-muted/70 rounded-full px-3 py-1.5 transition disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Plus className="h-3.5 w-3.5" />
                Add another ID
              </button>
              <div className="text-[11px] text-muted-foreground">
                {claimants.length} of max {cartUnitCount} qualifying bundles
              </div>
            </div>

            {/* Live total breakdown */}
            <div className="border-t border-border/60 pt-4 mt-2 space-y-1.5 text-sm">
              <div className="flex justify-between text-muted-foreground">
                <span>Subtotal</span>
                <span className="tabular-nums">₱{gross.toFixed(0)}</span>
              </div>
              {discountSummary.discount > 0 && (
                <div className="flex justify-between text-primary">
                  <span>
                    Discount ({Math.round(SENIOR_PWD_DISCOUNT_RATE * 100)}% × {discountSummary.effectiveClaimants})
                  </span>
                  <span className="tabular-nums">
                    −₱{discountSummary.discount.toFixed(0)}
                  </span>
                </div>
              )}
              <div className="flex justify-between font-semibold text-foreground pt-1">
                <span>Amount due</span>
                <span className="tabular-nums">₱{payable.toFixed(0)}</span>
              </div>
            </div>

            {!allClaimsValid && (
              <p className="text-xs text-muted-foreground italic">
                Fill name, age, date of birth, date of issue, and upload an ID photo for every claimant to proceed.
              </p>
            )}
          </div>
        )}
      </div>
      )}

      {/* ============ STEP 2 — Slot picker ============
          Dates grouped, time chips per date. RLS lets anon read
          time_slots; we filter to is_open=true and seats remaining. */}
      {step === 2 && (
      <div className="bg-card border border-border rounded-2xl p-5 mb-8 shadow-sm">
        <div className="flex items-center gap-2 mb-1">
          <CalendarClock className="h-4 w-4 text-primary" />
          <h3 className="font-display text-lg font-semibold">Pick your slot</h3>
        </div>
        <p className="text-xs text-muted-foreground mb-4">
          Only the dates and times Sautéo has opened are shown.
        </p>

        {slotsLoading ? (
          <div className="text-sm text-muted-foreground">Loading slots…</div>
        ) : slots.length === 0 ? (
          <div className="text-sm text-muted-foreground bg-muted/40 border border-border rounded-lg p-3">
            No open slots right now — please reply on Messenger and we'll get you another invite.
          </div>
        ) : (
          <div className="space-y-3">
            {Object.entries(slotsByDate).map(([date, daySlots]) => {
              const d = new Date(date + "T00:00:00");
              const dayLabel = d.toLocaleDateString(undefined, {
                weekday: "short",
                month: "short",
                day: "numeric",
                year: "numeric",
              });
              return (
                <div key={date}>
                  <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                    {dayLabel}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {daySlots.map((s) => {
                      const remaining = s.capacity - s.seats_taken;
                      const tooSmall = remaining < groupSize;
                      const selected = s.id === selectedSlotId;
                      const t = formatSlotTime12h(s.slot_time);
                      return (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => setSelectedSlotId(s.id)}
                          disabled={tooSmall}
                          aria-pressed={selected}
                          className={`inline-flex flex-col items-center px-3 py-2 rounded-xl border text-xs font-semibold transition ${
                            selected
                              ? "border-foreground bg-foreground text-background"
                              : tooSmall
                              ? "border-border bg-muted/40 text-muted-foreground opacity-50 cursor-not-allowed"
                              : "border-border bg-background hover:bg-muted"
                          }`}
                        >
                          <span className="tabular-nums">{t}</span>
                          <span className={`text-[10px] font-normal ${selected ? "text-background/70" : "text-muted-foreground"}`}>
                            {remaining} seat{remaining === 1 ? "" : "s"} left
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {selectedSlot && !slotCapacityOk && (
          <div className="mt-3 text-xs text-destructive bg-destructive/10 border border-destructive/30 rounded-lg p-2.5">
            That slot only has {selectedSlot.capacity - selectedSlot.seats_taken} seat
            {selectedSlot.capacity - selectedSlot.seats_taken === 1 ? "" : "s"} left — pick a smaller group or another slot.
          </div>
        )}
      </div>
      )}

      {/* Step 2 nav — Back to details / Continue to payment. */}
      {step === 2 && (
        <div className="flex items-center gap-3 mb-8">
          <button
            type="button"
            onClick={() => goToStep(1)}
            className="inline-flex items-center justify-center gap-1.5 px-5 py-3 rounded-full bg-muted text-foreground text-sm font-semibold hover:bg-muted/70 transition"
          >
            <ChevronLeft className="h-4 w-4" />
            Back
          </button>
          <button
            type="button"
            onClick={() => goToStep(3)}
            disabled={!step2Valid}
            className="flex-1 inline-flex items-center justify-center gap-2 px-6 py-3 rounded-full bg-foreground text-background font-semibold hover:opacity-90 transition disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Continue to payment
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* ============ STEP 1 — Your details ============
          Customer info — fields mirror create_booking() server validation. */}
      {step === 1 && (
      <div className="bg-card border border-border rounded-2xl p-5 mb-8 shadow-sm">
        <div className="flex items-center gap-2 mb-4">
          <UserIcon className="h-4 w-4 text-primary" />
          <h3 className="font-display text-lg font-semibold">Your details</h3>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2">
            <label className="block text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
              Full name
            </label>
            <input
              type="text"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              placeholder="Juan Dela Cruz"
              maxLength={120}
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-foreground/10 focus:border-foreground transition"
            />
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
              Email
            </label>
            <input
              type="email"
              value={customerEmail}
              onChange={(e) => setCustomerEmail(e.target.value)}
              placeholder="juan@example.com"
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-foreground/10 focus:border-foreground transition"
            />
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
              Phone
            </label>
            <input
              type="tel"
              value={customerPhone}
              onChange={(e) => setCustomerPhone(e.target.value)}
              placeholder="+63 917 000 0000"
              maxLength={32}
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-foreground/10 focus:border-foreground transition"
            />
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
              Group size
            </label>
            <input
              type="number"
              min={1}
              max={50}
              value={groupSize}
              onChange={(e) => {
                const n = Number(e.target.value);
                setGroupSize(Number.isFinite(n) ? Math.max(1, Math.min(50, Math.floor(n))) : 1);
              }}
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-foreground/10 focus:border-foreground transition"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="block text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
              Notes (optional)
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value.slice(0, 500))}
              placeholder="Allergies, special requests, dietary notes…"
              rows={2}
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-foreground/10 focus:border-foreground transition resize-none"
            />
            <div className="mt-1 text-[10px] text-muted-foreground text-right tabular-nums">
              {notes.length} / 500
            </div>
          </div>
        </div>
      </div>
      )}

      {/* Step 1 nav — Continue to slot. */}
      {step === 1 && (
        <div className="flex items-center gap-3 mb-8">
          <button
            type="button"
            onClick={() => goToStep(2)}
            disabled={!step1Valid}
            className="flex-1 inline-flex items-center justify-center gap-2 px-6 py-3 rounded-full bg-foreground text-background font-semibold hover:opacity-90 transition disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Continue to slot
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* ============ STEP 3 — Payment ============
          Sautéo Payment QR — same Maya / InstaPay account customers see
          on the pickup flow. The receipt's totals + payment-verification
          path are shared with pickup so the admin Orders dashboard sees
          dine-in payments through the same lens. */}
      {step === 3 && (
      <>
      <div className="bg-charcoal text-cream rounded-2xl p-6 mb-6">
        <div className="flex flex-col md:flex-row md:items-center gap-4 md:gap-6">
          <div className="flex-1 min-w-0 md:text-center">
            <div className="text-cream text-xs uppercase tracking-wider mb-2">
              Send payment to Sautéo PH
            </div>
            <div className="text-cream/80 text-sm space-y-1">
              <div className="break-words">
                Maya / InstaPay:{" "}
                <span className="font-mono text-cream">+63 123 456 789</span>
              </div>
              <div className="pt-2 text-cream/60">
                Amount:{" "}
                <span className="text-cream font-semibold break-words">
                  ₱{payable.toFixed(0)}
                </span>
              </div>
            </div>
          </div>
          <div className="flex flex-col items-center md:items-end shrink-0">
            <div className="bg-white p-3 rounded-xl shadow-lg ring-1 ring-cream/10 w-44 sm:w-52 md:w-48 lg:w-52">
              <div className="w-full aspect-square flex items-center justify-center">
                {qrImgError ? (
                  <div className="flex flex-col items-center justify-center text-center gap-2 text-gray-400">
                    <QrCode className="h-16 w-16" aria-hidden="true" />
                    <span className="text-xs font-medium text-gray-500">
                      QR coming soon
                    </span>
                  </div>
                ) : (
                  <img
                    src="/maya-qr.png"
                    alt="Scan to pay via Maya or any QR Ph–compatible app"
                    className="w-full h-full object-contain"
                    onError={() => setQrImgError(true)}
                  />
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {submitError && (
        <div className="mb-4 text-sm text-destructive bg-destructive/10 border border-destructive/30 rounded-lg p-3 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{submitError}</span>
        </div>
      )}

      <p className="text-sm text-muted-foreground leading-relaxed mb-4">
        Please settle your payment to confirm your reservation with our team
        — this step locks in your slot.
        {claimFormOpen &&
          " Your uploaded ID(s) go to our admin for verification — if a photo can't be verified, we'll ask for a re-upload within 24 hours."}
      </p>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => goToStep(2)}
          disabled={submitting}
          className="inline-flex items-center justify-center gap-1.5 px-5 py-3 rounded-full bg-muted text-foreground text-sm font-semibold hover:bg-muted/70 transition disabled:opacity-50"
        >
          <ChevronLeft className="h-4 w-4" />
          Back
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!canSubmit}
          className="flex-1 inline-flex items-center justify-center gap-2 px-6 py-4 rounded-full bg-primary text-primary-foreground font-medium hover:opacity-90 transition disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {submitting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Confirming reservation…
            </>
          ) : (
            "Confirm reservation"
          )}
        </button>
      </div>
      </>
      )}
    </div>
  );
}

/* ============ Pickup Reservation View ============
   Customers reach this screen via a pickup invite link. Unlike dine-in,
   payment happens HERE (Maya QR + reference number or screenshot upload),
   and the guest picks how the food gets to them (personal pickup,
   Lalamove, or Grab). When a courier is selected, an address is required.

   The Senior/PWD claim section is shared in shape with dine-in but lives
   in this component's body so the two flows stay independently editable
   per Sautéo's request.                                                   */
type PickupMode = "personal_pickup" | "lalamove" | "grab";

const PICKUP_MODE_OPTIONS: Array<{
  value: PickupMode;
  label: string;
  hint: string;
}> = [
  {
    value: "personal_pickup",
    label: "Personal pickup",
    hint: "Pick up your order at Sautéo at the time below.",
  },
  {
    value: "lalamove",
    label: "Lalamove",
    hint: "Send a Lalamove rider — we'll have the order ready.",
  },
  {
    value: "grab",
    label: "Grab",
    hint: "Send a Grab rider — we'll have the order ready.",
  },
];

function PickupReservationView({
  invite,
  cart,
  items,
  gross,
  cartUnitCount,
  claimants,
  setClaimants,
  discountSummary,
  onBack,
  onConfirm,
}: {
  invite: LoadedInvite | null;
  cart: Cart;
  items: MenuItem[];
  gross: number;
  cartUnitCount: number;
  claimants: Claimant[];
  setClaimants: React.Dispatch<React.SetStateAction<Claimant[]>>;
  discountSummary: DiscountSummary;
  onBack: () => void;
  onConfirm: (args: ConfirmArgs) => void;
}) {
  const claimFormOpen = claimants.length > 0;
  const payable = discountSummary.net;

  // Slot picker state (same shape as dine-in).
  const [slots, setSlots] = useState<AvailableSlot[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(true);
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null);

  // Customer info — prefilled from invite. `groupSize` is repurposed as
  // "number of meals" for pickup but uses the same RPC field.
  const [customerName, setCustomerName] = useState(invite?.customerName ?? "");
  const [customerEmail, setCustomerEmail] = useState(invite?.customerEmail ?? "");
  const [customerPhone, setCustomerPhone] = useState(invite?.customerPhone ?? "");
  const [numberOfMeals, setNumberOfMeals] = useState<number>(
    invite?.groupSize ?? 1,
  );
  const [notes, setNotes] = useState("");

  // Pickup-specific state.
  const [pickupMode, setPickupMode] = useState<PickupMode>("personal_pickup");
  const [courierAddress, setCourierAddress] = useState("");
  // QR display fallback — flips to true when /maya-qr.png 404s.
  const [qrImgError, setQrImgError] = useState(false);

  // Wizard step. The pickup checkout was a single long-scroll page; users
  // bailed before reaching payment. Three steps each fit on one screen:
  //   1 — Your details (name/email/phone/meals/notes)
  //   2 — Pickup setup (window + mode + courier address if applicable)
  //   3 — Discount + Maya QR → Confirm (payment verified off-platform)
  // Each step has its own validity check; Continue is disabled until valid.
  const [step, setStep] = useState<1 | 2 | 3>(1);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Load upcoming, open slots.
  useEffect(() => {
    (async () => {
      setSlotsLoading(true);
      const today = new Date().toISOString().slice(0, 10);
      const { data, error } = await supabase
        .from("time_slots")
        .select("id, slot_date, slot_time, capacity, seats_taken, is_open")
        .gte("slot_date", today)
        .eq("is_open", true)
        .order("slot_date")
        .order("slot_time");
      if (error) {
        console.warn("[slots] load failed:", error);
        setSlots([]);
      } else {
        setSlots(
          ((data ?? []) as AvailableSlot[]).filter(
            (s) => s.seats_taken < s.capacity,
          ),
        );
      }
      setSlotsLoading(false);
    })();
  }, []);

  const slotsByDate = useMemo(() => {
    const m: Record<string, AvailableSlot[]> = {};
    for (const s of slots) (m[s.slot_date] ||= []).push(s);
    return m;
  }, [slots]);

  const selectedSlot = useMemo(
    () => slots.find((s) => s.id === selectedSlotId) ?? null,
    [slots, selectedSlotId],
  );

  // Validation ---------------------------------------------------------
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail.trim());
  const nameValid =
    customerName.trim().length >= 1 && customerName.trim().length <= 120;
  const phoneTrimmed = customerPhone.trim();
  const phoneValid = phoneTrimmed.length >= 7 && phoneTrimmed.length <= 32;
  const mealsValid = numberOfMeals >= 1 && numberOfMeals <= 50;
  const slotCapacityOk =
    !selectedSlot ||
    selectedSlot.seats_taken + numberOfMeals <= selectedSlot.capacity;

  // Courier requires an address; personal pickup doesn't.
  const courierAddressOk =
    pickupMode === "personal_pickup" || courierAddress.trim().length >= 4;

  const allClaimsValid = useMemo(
    () =>
      claimants.every(
        (c) =>
          c.fullName.trim().length >= 2 &&
          c.age.trim().length >= 1 &&
          c.dateOfBirth.trim().length >= 4 &&
          c.dateOfIssue.trim().length >= 4 &&
          !!c.idPhotoFile,
      ),
    [claimants],
  );

  // Per-step validity gates. Continue is enabled only when the current
  // step's required fields are all valid. Final submit gate (`canSubmit`)
  // re-checks everything as a defense in depth.
  const step1Valid = nameValid && emailValid && phoneValid && mealsValid;
  const step2Valid = !!selectedSlot && slotCapacityOk && courierAddressOk;
  const step3Valid = !claimFormOpen || allClaimsValid;

  const canSubmit =
    !submitting &&
    cartUnitCount > 0 &&
    step1Valid &&
    step2Valid &&
    step3Valid;

  // Trim claimants to cart size (same guard as dine-in).
  useEffect(() => {
    if (claimants.length > cartUnitCount) {
      setClaimants((prev) => prev.slice(0, Math.max(cartUnitCount, 0)));
    }
  }, [cartUnitCount, claimants.length, setClaimants]);

  // Per-claimant ID autofill state (mirrors dine-in).
  const [autoFillByIdx, setAutoFillByIdx] = useState<Record<number, AutoFillStatus>>(
    {},
  );
  const extractAbortByIdx = useRef<Record<number, AbortController>>({});

  // Claim-section helpers (mirror dine-in body).
  const toggleClaim = () => {
    setClaimants((prev) =>
      prev.length > 0 ? [] : [makeBlankClaimant("senior")],
    );
  };
  const addClaimant = () => {
    if (claimants.length >= cartUnitCount) return;
    setClaimants((prev) => [...prev, makeBlankClaimant("senior")]);
  };
  const removeClaimant = (idx: number) => {
    setClaimants((prev) => {
      const removed = prev[idx];
      if (removed?.idPhotoUrl) URL.revokeObjectURL(removed.idPhotoUrl);
      return prev.filter((_, i) => i !== idx);
    });
  };
  const updateClaimant = (idx: number, patch: Partial<Claimant>) => {
    setClaimants((prev) =>
      prev.map((c, i) => (i === idx ? { ...c, ...patch } : c)),
    );
  };
  const onClaimPhotoChange = (idx: number, file: File | null) => {
    setClaimants((prev) => {
      const next = [...prev];
      const cur = next[idx];
      if (cur?.idPhotoUrl) URL.revokeObjectURL(cur.idPhotoUrl);
      next[idx] = {
        ...cur,
        idPhotoFile: file,
        idPhotoUrl: file ? URL.createObjectURL(file) : null,
      };
      return next;
    });
    extractAbortByIdx.current[idx]?.abort();
    if (!file) {
      setAutoFillByIdx((m) => ({ ...m, [idx]: { state: "idle" } }));
      return;
    }
    const ac = new AbortController();
    extractAbortByIdx.current[idx] = ac;
    setAutoFillByIdx((m) => ({ ...m, [idx]: { state: "loading" } }));
    (async () => {
      let result: ExtractIdResult;
      try {
        result = await extractIdFromPhoto(file, ac.signal);
      } catch (e) {
        if ((e as DOMException)?.name === "AbortError") return;
        setAutoFillByIdx((m) => ({ ...m, [idx]: { state: "failed" } }));
        return;
      }
      if (ac.signal.aborted) return;
      if (!result.available) {
        setAutoFillByIdx((m) => ({ ...m, [idx]: { state: "off" } }));
        return;
      }
      setClaimants((prev) =>
        prev.map((c, i) => {
          if (i !== idx) return c;
          return {
            ...c,
            kind:
              result.kind === "senior" || result.kind === "pwd"
                ? result.kind
                : c.kind,
            fullName: c.fullName.trim() ? c.fullName : result.full_name,
            idNumber: c.idNumber.trim() ? c.idNumber : result.id_number,
            address: c.address.trim() ? c.address : result.address,
            dateOfBirth: c.dateOfBirth.trim()
              ? c.dateOfBirth
              : result.date_of_birth,
            age: c.age.trim() ? c.age : result.age,
            sex: c.sex.trim() ? c.sex : result.sex,
            dateOfIssue: c.dateOfIssue.trim()
              ? c.dateOfIssue
              : result.date_of_issue,
          };
        }),
      );
      setAutoFillByIdx((m) => ({
        ...m,
        [idx]: { state: "filled", confidence: result.confidence },
      }));
    })();
  };

  // Submit -------------------------------------------------------------
  const handleSubmit = async () => {
    if (!canSubmit || !selectedSlot) return;
    setSubmitError(null);
    setSubmitting(true);

    // Same variant-aggregation pattern as dine-in.
    const qtyByMenuItemId: Record<string, number> = {};
    const variantDetailLines: string[] = [];
    for (const [key, qty] of Object.entries(cart)) {
      const { itemId, variantIndex } = parseCartKey(key);
      qtyByMenuItemId[itemId] = (qtyByMenuItemId[itemId] || 0) + qty;
      if (variantIndex != null) {
        const it = items.find((x) => x.id === itemId);
        const vName = it ? getVariantName(it, variantIndex) : null;
        if (it && vName)
          variantDetailLines.push(`${qty}× ${it.name} — ${vName}`);
      }
    }
    const userNote = notes.trim();
    const variantNote = variantDetailLines.length
      ? `Variants: ${variantDetailLines.join("; ")}`
      : "";
    const combinedNotes = [userNote, variantNote]
      .filter(Boolean)
      .join(" | ")
      .slice(0, 500);

    const payload: Record<string, unknown> = {
      slot_id: selectedSlot.id,
      customer_name: customerName.trim(),
      customer_email: customerEmail.trim().toLowerCase(),
      customer_phone: customerPhone.trim(),
      group_size: numberOfMeals,
      notes: combinedNotes || null,
      pickup_mode: pickupMode,
      courier_address:
        pickupMode === "personal_pickup" ? null : courierAddress.trim(),
      items: Object.entries(qtyByMenuItemId).map(
        ([menu_item_id, quantity]) => ({ menu_item_id, quantity }),
      ),
    };
    if (invite?.token) payload.invite_token = invite.token;

    const { data, error } = await (supabase.rpc as any)("create_booking", {
      payload,
    });
    if (error) {
      setSubmitting(false);
      setSubmitError(friendlyBookingError(error.message));
      return;
    }
    const result = (data ?? {}) as { reference_code?: string };
    if (!result.reference_code) {
      setSubmitting(false);
      setSubmitError(
        "Booking didn't return a reference code. Contact us in Messenger.",
      );
      return;
    }

    setSubmitting(false);
    onConfirm({
      referenceCode: result.reference_code,
      slot: selectedSlot,
      customerName: customerName.trim(),
      groupSize: numberOfMeals,
      pickupMode,
      courierAddress:
        pickupMode === "personal_pickup" ? null : courierAddress.trim(),
      paymentReference: null,
    });
  };

  // Pickup is open to the public — no invite gate. Anyone hitting
  // /pick-up can place an order; create_booking() no longer requires
  // a token for pickup channels.
  const isCourier = pickupMode === "lalamove" || pickupMode === "grab";

  // Step transitions scroll the next panel into view so the user lands at
  // the top of the new step instead of mid-page.
  const goToStep = (s: 1 | 2 | 3) => {
    setStep(s);
    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  return (
    <div className="max-w-2xl mx-auto">
      <button
        onClick={onBack}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-6"
      >
        <ChevronLeft className="h-4 w-4" /> Back to menu
      </button>

      <div className="flex items-center gap-2 mb-2">
        <ShoppingBag className="h-6 w-6 text-primary" />
        <h2 className="font-display text-3xl md:text-4xl">
          Confirm your pickup
        </h2>
      </div>
      <p className="text-muted-foreground mb-5">
        Step {step} of 3 — your total is{" "}
        <span className="font-semibold text-primary">
          ₱{payable.toFixed(0)}
        </span>
        .
      </p>

      {/* Progress indicator — three labelled pills with a connector bar.
          Completed steps are clickable so the user can jump back; future
          steps are not (must satisfy current step first). */}
      <div className="mb-6">
        <ol className="flex items-center gap-2">
          {([
            { n: 1 as const, label: "Your details", done: step > 1 || step1Valid },
            { n: 2 as const, label: "Pickup", done: step > 2 || step2Valid },
            { n: 3 as const, label: "Payment", done: false },
          ]).map((s, i, arr) => {
            const active = step === s.n;
            const reachable = s.n <= step;
            return (
              <li key={s.n} className="flex items-center gap-2 flex-1">
                <button
                  type="button"
                  onClick={() => reachable && goToStep(s.n)}
                  disabled={!reachable}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold transition ${
                    active
                      ? "bg-foreground text-background"
                      : s.done
                      ? "bg-primary/10 text-primary"
                      : "bg-muted text-muted-foreground"
                  } disabled:cursor-not-allowed`}
                >
                  <span
                    className={`h-5 w-5 rounded-full inline-flex items-center justify-center text-[10px] tabular-nums ${
                      active
                        ? "bg-background/20 text-background"
                        : s.done
                        ? "bg-primary text-primary-foreground"
                        : "bg-background text-muted-foreground"
                    }`}
                  >
                    {s.done && !active ? (
                      <Check className="h-3 w-3" />
                    ) : (
                      s.n
                    )}
                  </span>
                  <span className="hidden sm:inline">{s.label}</span>
                </button>
                {i < arr.length - 1 && (
                  <span
                    className={`flex-1 h-px ${
                      arr[i + 1].done || step > s.n ? "bg-primary/30" : "bg-border"
                    }`}
                  />
                )}
              </li>
            );
          })}
        </ol>
      </div>

      {/* ============ STEP 1 — Your details ============ */}
      {step === 1 && (
        <>
          <div className="bg-card border border-border rounded-2xl p-5 mb-6 shadow-sm">
            <div className="flex items-center gap-2 mb-4">
              <UserIcon className="h-4 w-4 text-primary" />
              <h3 className="font-display text-lg font-semibold">Your details</h3>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="sm:col-span-2">
                <label className="block text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                  Full name
                </label>
                <input
                  type="text"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  placeholder="Juan Dela Cruz"
                  maxLength={120}
                  className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-foreground/10 focus:border-foreground transition"
                />
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                  Email
                </label>
                <input
                  type="email"
                  value={customerEmail}
                  onChange={(e) => setCustomerEmail(e.target.value)}
                  placeholder="juan@example.com"
                  className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-foreground/10 focus:border-foreground transition"
                />
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                  Phone
                </label>
                <input
                  type="tel"
                  value={customerPhone}
                  onChange={(e) => setCustomerPhone(e.target.value)}
                  placeholder="+63 917 000 0000"
                  maxLength={32}
                  className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-foreground/10 focus:border-foreground transition"
                />
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                  Number of meals
                </label>
                <input
                  type="number"
                  min={1}
                  max={50}
                  value={numberOfMeals}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    setNumberOfMeals(
                      Number.isFinite(n)
                        ? Math.max(1, Math.min(50, Math.floor(n)))
                        : 1,
                    );
                  }}
                  className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-foreground/10 focus:border-foreground transition"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                  Notes (optional)
                </label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value.slice(0, 500))}
                  placeholder="Allergies, special requests…"
                  rows={2}
                  className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-foreground/10 focus:border-foreground transition resize-none"
                />
                <div className="mt-1 text-[10px] text-muted-foreground text-right tabular-nums">
                  {notes.length} / 500
                </div>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={() => goToStep(2)}
            disabled={!step1Valid}
            className="w-full inline-flex items-center justify-center gap-2 px-6 py-4 rounded-full bg-primary text-primary-foreground font-medium hover:opacity-90 transition disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Continue
            <ChevronRight className="h-4 w-4" />
          </button>
        </>
      )}

      {/* ============ STEP 2 — Pickup setup ============ */}
      {step === 2 && (
        <>
          {/* Slot picker */}
          <div className="bg-card border border-border rounded-2xl p-5 mb-6 shadow-sm">
            <div className="flex items-center gap-2 mb-1">
              <CalendarClock className="h-4 w-4 text-primary" />
              <h3 className="font-display text-lg font-semibold">
                Pick your pickup window
              </h3>
            </div>
            <p className="text-xs text-muted-foreground mb-4">
              When you'd like the food ready.
            </p>

            {slotsLoading ? (
              <div className="text-sm text-muted-foreground">Loading slots…</div>
            ) : slots.length === 0 ? (
              <div className="text-sm text-muted-foreground bg-muted/40 border border-border rounded-lg p-3">
                No open windows right now — reply on Messenger and we'll get you another invite.
              </div>
            ) : (
              <div className="space-y-3">
                {Object.entries(slotsByDate).map(([date, daySlots]) => {
                  const d = new Date(date + "T00:00:00");
                  const dayLabel = d.toLocaleDateString(undefined, {
                    weekday: "short",
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  });
                  return (
                    <div key={date}>
                      <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                        {dayLabel}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {daySlots.map((s) => {
                          const remaining = s.capacity - s.seats_taken;
                          const tooSmall = remaining < numberOfMeals;
                          const selected = s.id === selectedSlotId;
                          const t = formatSlotTime12h(s.slot_time);
                          return (
                            <button
                              key={s.id}
                              type="button"
                              onClick={() => setSelectedSlotId(s.id)}
                              disabled={tooSmall}
                              aria-pressed={selected}
                              className={`inline-flex flex-col items-center px-3 py-2 rounded-xl border text-xs font-semibold transition ${
                                selected
                                  ? "border-foreground bg-foreground text-background"
                                  : tooSmall
                                  ? "border-border bg-muted/40 text-muted-foreground opacity-50 cursor-not-allowed"
                                  : "border-border bg-background hover:bg-muted"
                              }`}
                            >
                              <span className="tabular-nums">{t}</span>
                              <span
                                className={`text-[10px] font-normal ${
                                  selected
                                    ? "text-background/70"
                                    : "text-muted-foreground"
                                }`}
                              >
                                {remaining} left
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {selectedSlot && !slotCapacityOk && (
              <div className="mt-3 text-xs text-destructive bg-destructive/10 border border-destructive/30 rounded-lg p-2.5">
                That window only has {selectedSlot.capacity - selectedSlot.seats_taken} seats left — pick fewer meals (step 1) or another slot.
              </div>
            )}
          </div>

          {/* Pickup mode selector */}
          <div className="bg-card border border-border rounded-2xl p-5 mb-6 shadow-sm">
            <div className="flex items-center gap-2 mb-3">
              <Truck className="h-4 w-4 text-primary" />
              <h3 className="font-display text-lg font-semibold">
                How would you like to get it?
              </h3>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {PICKUP_MODE_OPTIONS.map((opt) => {
                const active = pickupMode === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setPickupMode(opt.value)}
                    aria-pressed={active}
                    className={`text-left rounded-xl border p-3 transition ${
                      active
                        ? "border-foreground bg-muted"
                        : "border-border bg-background hover:bg-muted/50"
                    }`}
                  >
                    <div className="font-semibold text-sm">{opt.label}</div>
                    <div className="text-[11px] text-muted-foreground mt-0.5 leading-snug">
                      {opt.hint}
                    </div>
                  </button>
                );
              })}
            </div>

            {isCourier && (
              <div className="mt-4">
                <label className="block text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                  Drop-off address *
                </label>
                <input
                  type="text"
                  value={courierAddress}
                  onChange={(e) => setCourierAddress(e.target.value)}
                  placeholder="Street, Barangay, City"
                  className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-foreground/10 focus:border-foreground transition"
                />
                <p className="text-[10px] text-muted-foreground mt-1">
                  Required for {pickupMode === "lalamove" ? "Lalamove" : "Grab"}.
                </p>
              </div>
            )}
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => goToStep(1)}
              className="inline-flex items-center justify-center gap-1.5 px-5 py-3 rounded-full bg-muted text-foreground text-sm font-semibold hover:bg-muted/70 transition"
            >
              <ChevronLeft className="h-4 w-4" />
              Back
            </button>
            <button
              type="button"
              onClick={() => goToStep(3)}
              disabled={!step2Valid}
              className="flex-1 inline-flex items-center justify-center gap-2 px-6 py-4 rounded-full bg-primary text-primary-foreground font-medium hover:opacity-90 transition disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Continue to payment
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </>
      )}

      {/* ============ STEP 3 — Discount + Payment ============ */}
      {step === 3 && (
        <>
          {/* Senior / PWD discount section. */}
          <div className="bg-card border border-border rounded-2xl p-5 mb-6 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-primary shrink-0" />
                  <h3 className="font-display text-lg font-semibold">
                    Senior / PWD discount
                  </h3>
                </div>
                <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                  Per RA 9994 / RA 10754 —{" "}
                  {Math.round(SENIOR_PWD_DISCOUNT_RATE * 100)}% off and VAT-exempt
                  on one qualifying bundle per ID.
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={claimFormOpen}
                onClick={toggleClaim}
                className={`relative inline-flex h-6 w-11 shrink-0 rounded-full transition-colors ${
                  claimFormOpen ? "bg-foreground" : "bg-muted"
                }`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-background shadow transition-transform ${
                    claimFormOpen ? "translate-x-5" : "translate-x-0"
                  }`}
                />
              </button>
            </div>

            {claimFormOpen && (
              <div className="mt-5 space-y-4">
                {cartUnitCount === 0 && (
                  <div className="text-xs text-destructive bg-destructive/10 border border-destructive/30 rounded-lg p-3">
                    Add at least one item to the cart before claiming a discount.
                  </div>
                )}
                <div className="text-[11px] text-muted-foreground bg-muted/40 border border-border rounded-lg p-3 leading-relaxed">
                  Uploaded ID photos are sent to our verification provider to
                  read the name, ID number, and address. Fields stay editable.
                  By proceeding you consent to this processing under the Data
                  Privacy Act of 2012.
                </div>
                {claimants.map((c, idx) => (
                  <ClaimantCard
                    key={idx}
                    index={idx}
                    claimant={c}
                    autoFill={autoFillByIdx[idx] ?? { state: "idle" }}
                    onChange={(patch) => updateClaimant(idx, patch)}
                    onPhotoChange={(file) => onClaimPhotoChange(idx, file)}
                    onRemove={() => removeClaimant(idx)}
                  />
                ))}
                <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                  <button
                    type="button"
                    onClick={addClaimant}
                    disabled={claimants.length >= cartUnitCount}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold text-foreground bg-muted hover:bg-muted/70 rounded-full px-3 py-1.5 transition disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Add another ID
                  </button>
                  <div className="text-[11px] text-muted-foreground">
                    {claimants.length} of max {cartUnitCount} qualifying bundles
                  </div>
                </div>
                <div className="border-t border-border/60 pt-4 mt-2 space-y-1.5 text-sm">
                  <div className="flex justify-between text-muted-foreground">
                    <span>Subtotal</span>
                    <span className="tabular-nums">₱{gross.toFixed(0)}</span>
                  </div>
                  {discountSummary.discount > 0 && (
                    <div className="flex justify-between text-primary">
                      <span>
                        Discount ({Math.round(SENIOR_PWD_DISCOUNT_RATE * 100)}% ×{" "}
                        {discountSummary.effectiveClaimants})
                      </span>
                      <span className="tabular-nums">
                        −₱{discountSummary.discount.toFixed(0)}
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between font-semibold text-foreground pt-1">
                    <span>Amount due</span>
                    <span className="tabular-nums">₱{payable.toFixed(0)}</span>
                  </div>
                </div>
                {!allClaimsValid && (
                  <p className="text-xs text-muted-foreground italic">
                    Fill name, age, date of birth, date of issue, and upload an
                    ID photo for every claimant to proceed.
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Maya QR block */}
          <div className="bg-charcoal text-cream rounded-2xl p-6 mb-6">
            <div className="flex flex-col md:flex-row md:items-center gap-4 md:gap-6">
              <div className="flex-1 min-w-0 md:text-center">
                <div className="text-cream text-xs uppercase tracking-wider mb-2">
                  Send payment to Sautéo PH
                </div>
                <div className="text-cream/80 text-sm space-y-1">
                  <div className="break-words">
                    Maya / InstaPay:{" "}
                    <span className="font-mono text-cream">+63 123 456 789</span>
                  </div>
                  <div className="pt-2 text-cream/60">
                    Amount:{" "}
                    <span className="text-cream font-semibold break-words">
                      ₱{payable.toFixed(0)}
                    </span>
                  </div>
                </div>
              </div>
              <div className="flex flex-col items-center md:items-end shrink-0">
                <div className="bg-white p-3 rounded-xl shadow-lg ring-1 ring-cream/10 w-44 sm:w-52 md:w-48 lg:w-52">
                  <div className="w-full aspect-square flex items-center justify-center">
                    {qrImgError ? (
                      <div className="flex flex-col items-center justify-center text-center gap-2 text-gray-400">
                        <QrCode className="h-16 w-16" aria-hidden="true" />
                        <span className="text-xs font-medium text-gray-500">
                          QR coming soon
                        </span>
                      </div>
                    ) : (
                      <img
                        src="/maya-qr.png"
                        alt="Scan to pay via Maya or any QR Ph–compatible app"
                        className="w-full h-full object-contain"
                        onError={() => setQrImgError(true)}
                      />
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {submitError && (
            <div className="mb-4 text-sm text-destructive bg-destructive/10 border border-destructive/30 rounded-lg p-3 flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>{submitError}</span>
            </div>
          )}

          <p className="text-sm text-muted-foreground leading-relaxed mb-4">
            After you confirm, our team verifies your payment in the Orders
            dashboard. Once verified, your pickup is locked in.
            {claimFormOpen &&
              " Uploaded ID(s) go to our admin for verification — if a photo can't be verified, we'll ask for a re-upload within 24 hours."}
          </p>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => goToStep(2)}
              disabled={submitting}
              className="inline-flex items-center justify-center gap-1.5 px-5 py-3 rounded-full bg-muted text-foreground text-sm font-semibold hover:bg-muted/70 transition disabled:opacity-50"
            >
              <ChevronLeft className="h-4 w-4" />
              Back
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!canSubmit}
              className="flex-1 inline-flex items-center justify-center gap-2 px-6 py-4 rounded-full bg-primary text-primary-foreground font-medium hover:opacity-90 transition disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Confirming pickup…
                </>
              ) : (
                "Confirm pickup"
              )}
            </button>
          </div>
        </>
      )}

    </div>
  );
}

/* ============ Per-claimant ID form card ============ */
function ClaimantCard({
  index,
  claimant,
  autoFill,
  onChange,
  onPhotoChange,
  onRemove,
}: {
  index: number;
  claimant: Claimant;
  autoFill: AutoFillStatus;
  onChange: (patch: Partial<Claimant>) => void;
  onPhotoChange: (file: File | null) => void;
  onRemove: () => void;
}) {
  const fileInputId = `claimant-${index}-photo`;
  const inputCls =
    "w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-foreground/10 focus:border-foreground transition";
  // Per-required-field "is this filled in?" flags so we can highlight the
  // specific input that's blocking submit. Matches the validity check used
  // by allClaimsValid in ReservationView — keep them in sync.
  const nameMissing = claimant.fullName.trim().length < 2;
  const ageMissing = claimant.age.trim().length < 1;
  const dobMissing = claimant.dateOfBirth.trim().length < 4;
  const issuedMissing = claimant.dateOfIssue.trim().length < 4;
  const photoMissing = !claimant.idPhotoFile;
  const missingLabels = [
    nameMissing && "Name",
    ageMissing && "Age",
    dobMissing && "Date of birth",
    issuedMissing && "Date of issue",
    photoMissing && "ID photo",
  ].filter(Boolean) as string[];
  // Subtle red ring on inputs whose value is empty. Only kicks in once the
  // user has interacted (started a photo upload OR typed anywhere), so the
  // form doesn't look angry the moment it opens.
  const hasInteracted =
    !!claimant.idPhotoFile ||
    claimant.fullName.length > 0 ||
    claimant.idNumber.length > 0 ||
    claimant.address.length > 0 ||
    claimant.age.length > 0 ||
    claimant.dateOfBirth.length > 0 ||
    claimant.dateOfIssue.length > 0;
  const errorRing = "border-destructive/60 focus:border-destructive focus:ring-destructive/20";

  return (
    <div className="border border-border rounded-xl p-4 bg-background space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="h-7 w-7 rounded-full bg-muted flex items-center justify-center text-xs font-semibold tabular-nums">
            {index + 1}
          </div>
          <div className="inline-flex rounded-full bg-muted p-0.5">
            {(["senior", "pwd"] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => onChange({ kind: k })}
                className={`text-[11px] uppercase tracking-wider px-2.5 py-1 rounded-full transition ${
                  claimant.kind === k
                    ? "bg-foreground text-background font-semibold"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {k === "senior" ? "Senior" : "PWD"}
              </button>
            ))}
          </div>
          {/* Validation badge. Only show "Complete" once the user has
              actually filled things in — otherwise a brand-new blank card
              would falsely flash green. */}
          {hasInteracted && missingLabels.length === 0 && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 text-primary text-[10px] font-semibold uppercase tracking-wider">
              <Check className="h-3 w-3" /> Complete
            </span>
          )}
          {hasInteracted && missingLabels.length > 0 && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-destructive/10 text-destructive text-[10px] font-semibold uppercase tracking-wider">
              <AlertTriangle className="h-3 w-3" />
              Missing: {missingLabels.join(", ")}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove claimant ${index + 1}`}
          className="text-muted-foreground hover:text-destructive transition"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      {/* 6-column grid lets us put the small DOB/age/sex/issue fields on
          one tidy row on tablet+ while name and address stay full-width.
          On mobile everything stacks to single column. */}
      <div className="grid grid-cols-2 sm:grid-cols-6 gap-3">
        <div className="col-span-2 sm:col-span-4">
          <label className="block text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
            Full name (as on ID)
          </label>
          <input
            type="text"
            value={claimant.fullName}
            onChange={(e) => onChange({ fullName: e.target.value })}
            placeholder="Juan Dela Cruz"
            className={`${inputCls} ${hasInteracted && nameMissing ? errorRing : ""}`}
            autoComplete="off"
          />
        </div>
        <div className="col-span-2 sm:col-span-2">
          <label className="block text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
            ID number
          </label>
          <input
            type="text"
            value={claimant.idNumber}
            onChange={(e) => onChange({ idNumber: e.target.value })}
            placeholder={claimant.kind === "pwd" ? "RR-XXXXXX-XX..." : "e.g. 8764"}
            className={inputCls}
            autoComplete="off"
          />
        </div>

        <div className="col-span-2 sm:col-span-2">
          <label className="block text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
            Date of birth
          </label>
          <input
            type="text"
            value={claimant.dateOfBirth}
            onChange={(e) => onChange({ dateOfBirth: e.target.value })}
            placeholder="MM/DD/YYYY"
            className={`${inputCls} ${hasInteracted && dobMissing ? errorRing : ""}`}
            autoComplete="off"
          />
        </div>
        <div className="col-span-1 sm:col-span-1">
          <label className="block text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
            Age
          </label>
          <input
            type="text"
            inputMode="numeric"
            value={claimant.age}
            onChange={(e) => onChange({ age: e.target.value })}
            placeholder="65"
            className={`${inputCls} ${hasInteracted && ageMissing ? errorRing : ""}`}
            autoComplete="off"
          />
        </div>
        <div className="col-span-1 sm:col-span-1">
          <label className="block text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
            Sex
          </label>
          <select
            value={claimant.sex}
            onChange={(e) => onChange({ sex: e.target.value })}
            className={inputCls}
          >
            <option value="">—</option>
            <option value="M">M</option>
            <option value="F">F</option>
          </select>
        </div>
        <div className="col-span-2 sm:col-span-2">
          <label className="block text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
            Date of issue
          </label>
          <input
            type="text"
            value={claimant.dateOfIssue}
            onChange={(e) => onChange({ dateOfIssue: e.target.value })}
            placeholder="MM/DD/YYYY"
            className={`${inputCls} ${hasInteracted && issuedMissing ? errorRing : ""}`}
            autoComplete="off"
          />
        </div>

        <div className="col-span-2 sm:col-span-6">
          <label className="block text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
            Address
          </label>
          <input
            type="text"
            value={claimant.address}
            onChange={(e) => onChange({ address: e.target.value })}
            placeholder="Street, Barangay, City"
            className={inputCls}
            autoComplete="off"
          />
        </div>
      </div>

      <div>
        <label className="block text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
          ID photo
        </label>
        <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
          {/* "Take photo" — opens the phone's native camera directly on
              mobile via the `capture` attribute (rear/world-facing camera).
              On desktop browsers `capture` is ignored and this falls back
              to the regular file picker, so we can ship the same control
              everywhere without feature-detection. */}
          <label
            htmlFor={`${fileInputId}-camera`}
            className="inline-flex items-center gap-2 cursor-pointer text-xs font-semibold bg-foreground text-background hover:opacity-90 rounded-full px-3 py-2 transition"
          >
            <Camera className="h-3.5 w-3.5" />
            {claimant.idPhotoFile ? "Retake" : "Take photo"}
          </label>
          <input
            id={`${fileInputId}-camera`}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={(e) => onPhotoChange(e.target.files?.[0] ?? null)}
            className="hidden"
          />

          {/* "Upload" — picks an existing photo from the gallery / disk.
              Same handler so the autofill pipeline runs identically. */}
          <label
            htmlFor={fileInputId}
            className="inline-flex items-center gap-2 cursor-pointer text-xs font-semibold bg-muted hover:bg-muted/70 rounded-full px-3 py-2 transition"
          >
            <Upload className="h-3.5 w-3.5" />
            {claimant.idPhotoFile ? "Replace" : "Upload"}
          </label>
          <input
            id={fileInputId}
            type="file"
            accept="image/*"
            onChange={(e) => onPhotoChange(e.target.files?.[0] ?? null)}
            className="hidden"
          />
          {claimant.idPhotoUrl ? (
            <div className="relative h-12 w-12 rounded-lg overflow-hidden border border-border shrink-0">
              <img
                src={claimant.idPhotoUrl}
                alt="ID preview"
                className="h-full w-full object-cover"
              />
            </div>
          ) : (
            <div className="h-12 w-12 rounded-lg border border-dashed border-border flex items-center justify-center text-muted-foreground shrink-0">
              <ImageIcon className="h-4 w-4" />
            </div>
          )}
          {claimant.idPhotoFile && (
            <span className="text-xs text-muted-foreground truncate min-w-0">
              {claimant.idPhotoFile.name}
            </span>
          )}
        </div>

        {/* Autofill status row. Renders nothing in idle/off states so the
            form looks clean before/after a photo is dropped; renders a
            spinner while the LLM reads the ID; shows a "please verify" hint
            on success with the model's confidence; shows a quiet retry hint
            on failure. */}
        {autoFill.state === "loading" && (
          <div className="mt-2 inline-flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Reading ID — this takes a couple of seconds…
          </div>
        )}
        {autoFill.state === "filled" && (
          <div className="mt-2 inline-flex items-center gap-2 text-xs text-primary">
            <Sparkles className="h-3.5 w-3.5" />
            Auto-filled from your ID — please double-check the fields above.
            {autoFill.confidence > 0 && (
              <span className="text-muted-foreground">
                ({Math.round(autoFill.confidence * 100)}% confidence)
              </span>
            )}
          </div>
        )}
        {autoFill.state === "failed" && (
          <div className="mt-2 inline-flex items-center gap-2 text-xs text-muted-foreground">
            <AlertTriangle className="h-3.5 w-3.5" />
            Couldn't read the ID automatically — please type the fields manually.
          </div>
        )}
      </div>
    </div>
  );
}

/* ============ Receipt View ============ */
// Invite tokens are single-use, so the receipt is a terminal screen — no
// "New order" CTA. Guests who need to book again message Sautéo on
// Messenger to get a fresh invite.
function ReceiptView({
  receipt,
}: {
  receipt: ReceiptShape;
}) {
  const hasDiscount = receipt.discountLines.length > 0;
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
            {hasDiscount && (
              <div className="mt-1 inline-flex items-center px-2 py-0.5 rounded-full bg-primary/10 text-primary text-[10px] font-semibold uppercase tracking-wider">
                VAT-exempt · SC/PWD
              </div>
            )}
          </div>
          <div className="text-right">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">Reference</div>
            <div className="font-mono text-base font-semibold text-primary">{receipt.ref}</div>
          </div>
        </div>

        <div className="text-xs text-muted-foreground mb-4">
          {receipt.at.toLocaleString()}
        </div>

        {/* Slot + party / pickup block. Helps the guest forward this to
            their group and serves as the admin-facing summary. Layout
            adapts: dine-in shows Slot + Party; pickup shows Pickup window,
            Mode, Address (if courier), Meals, Payment ref. */}
        {receipt.pickupMode === "dine_in" ? (
          <div className="border border-border rounded-lg p-3 mb-6 grid grid-cols-2 gap-3 text-xs">
            <div>
              <div className="uppercase tracking-wider text-muted-foreground">Slot</div>
              <div className="text-foreground font-medium mt-0.5">
                {new Date(receipt.slotDate + "T00:00:00").toLocaleDateString(undefined, {
                  weekday: "short",
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}{" "}
                · {formatSlotTime12h(receipt.slotTime)}
              </div>
            </div>
            <div>
              <div className="uppercase tracking-wider text-muted-foreground">Party</div>
              <div className="text-foreground font-medium mt-0.5">
                {receipt.customerName} · {receipt.groupSize}{" "}
                {receipt.groupSize === 1 ? "person" : "people"}
              </div>
            </div>
          </div>
        ) : (
          <div className="border border-border rounded-lg p-3 mb-6 grid grid-cols-2 gap-3 text-xs">
            <div>
              <div className="uppercase tracking-wider text-muted-foreground">Pickup window</div>
              <div className="text-foreground font-medium mt-0.5">
                {new Date(receipt.slotDate + "T00:00:00").toLocaleDateString(undefined, {
                  weekday: "short",
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}{" "}
                · {formatSlotTime12h(receipt.slotTime)}
              </div>
            </div>
            <div>
              <div className="uppercase tracking-wider text-muted-foreground">Mode</div>
              <div className="text-foreground font-medium mt-0.5">
                {receipt.pickupMode === "personal_pickup" && "Personal pickup"}
                {receipt.pickupMode === "lalamove" && "Lalamove"}
                {receipt.pickupMode === "grab" && "Grab"}
              </div>
            </div>
            <div>
              <div className="uppercase tracking-wider text-muted-foreground">Customer</div>
              <div className="text-foreground font-medium mt-0.5">
                {receipt.customerName} · {receipt.groupSize} meal
                {receipt.groupSize === 1 ? "" : "s"}
              </div>
            </div>
            {receipt.courierAddress && (
              <div>
                <div className="uppercase tracking-wider text-muted-foreground">
                  Drop-off
                </div>
                <div className="text-foreground font-medium mt-0.5 truncate">
                  {receipt.courierAddress}
                </div>
              </div>
            )}
            {receipt.paymentReference && (
              <div className="col-span-2">
                <div className="uppercase tracking-wider text-muted-foreground">
                  Maya reference
                </div>
                <div className="text-foreground font-medium mt-0.5 font-mono">
                  {receipt.paymentReference}
                </div>
              </div>
            )}
          </div>
        )}

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

        {hasDiscount && (
          <div className="border-t border-border pt-4 mb-4 space-y-2">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">
              Senior / PWD discount
            </div>
            {receipt.discountLines.map((d, i) => {
              // Compact "DOB · Age · Sex · Issued" line — only rendered if
              // at least one of the four fields was captured. Keeps the
              // receipt clean when the OCR / admin only filled the
              // minimum required fields (name + ID).
              const extras = [
                d.dateOfBirth && `DOB ${d.dateOfBirth}`,
                d.age && `Age ${d.age}`,
                d.sex,
                d.dateOfIssue && `Issued ${d.dateOfIssue}`,
              ].filter(Boolean);
              return (
                <div
                  key={i}
                  className="flex items-start justify-between gap-3 text-sm"
                >
                  <div className="min-w-0">
                    <div className="font-medium text-foreground">
                      {d.itemName}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {d.claimantKind === "pwd" ? "PWD" : "Senior"} ·{" "}
                      {d.claimantName || "—"} · {d.idNumber || "—"}
                    </div>
                    {extras.length > 0 && (
                      <div className="text-[11px] text-muted-foreground/80 mt-0.5">
                        {extras.join(" · ")}
                      </div>
                    )}
                  </div>
                  <div className="text-primary font-medium tabular-nums shrink-0">
                    −₱{d.discountAmount.toFixed(0)}
                  </div>
                </div>
              );
            })}
            <div className="flex justify-between text-xs text-muted-foreground pt-2 border-t border-border/40">
              <span>Subtotal</span>
              <span className="tabular-nums">₱{receipt.gross.toFixed(0)}</span>
            </div>
            <div className="flex justify-between text-xs text-primary">
              <span>Total discount</span>
              <span className="tabular-nums">−₱{receipt.discount.toFixed(0)}</span>
            </div>
          </div>
        )}

        <div className="border-t border-border pt-4 flex justify-between items-center">
          <span className="font-medium">Total Paid</span>
          <span className="text-primary text-2xl font-display">₱{receipt.total.toFixed(0)}</span>
        </div>

        {hasDiscount && (
          <p className="mt-4 text-[11px] leading-relaxed text-muted-foreground">
            Discount applied per RA 9994 / RA 10754. ID(s) submitted for verification — if any photo cannot be verified, we'll request a re-upload within 24 hours before charging the full amount.
          </p>
        )}
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
