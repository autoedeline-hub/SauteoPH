import { createFileRoute, redirect } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import {
  AlertTriangle,
  BookOpen,
  CalendarClock,
  Camera,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  Image as ImageIcon,
  Loader2,
  MessageCircle,
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
  type ClaimsByCartKey,
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
import { formatSlotTime12h, localToday } from "@/lib/utils";
import { PICKUP_DEFAULTS } from "@/integrations/site-content";
import { useBookingRulesDisplay, type DisplayRule } from "@/lib/siteContent";

// Bare `/` redirects to the read-only /menu page. The booking flows
// (/dine-in, /pick-up) stay reachable only via the tokenized invite
// links Sautéo sends out — landing on the public root shouldn't expose
// them.
export const Route = createFileRoute("/")({
  beforeLoad: () => {
    throw redirect({ to: "/menu" });
  },
});

type Category = { id: string; name: string; slug: string; sort_order: number; available_pickup: boolean };
type MenuItemVariant = { name: string; price: number };
type MenuItem = {
  id: string;
  category_id: string;
  name: string;
  description: string | null;
  price: number;
  image_url: string | null;
  active: boolean;
  available_dine_in: boolean;
  available_pickup: boolean;
  variants: MenuItemVariant[] | null;
};
// Cart key scheme:
//   - item with no variant       -> key = item.id
//   - item with a chosen variant -> key = item.id + "::" + variantIndex
type Cart = Record<string, number>;
// Top-level view machine:
//   - "menu" — non-invite homepage browse (SEO surface). Today's behavior.
//   - "wizard" — invite checkout, or the invite-only gate for bare visitors
//     who hit Checkout without an invite. Invite users see a 4-step
//     wizard: slot → menu → details/payment → receipt.
//   - "receipt" — post-confirm.
type View = "menu" | "wizard" | "receipt";
// Dine-in uses 1 | 2 | 3 (its stepper renders 4 as the unreachable "Done"
// placeholder). Pickup uses the full 1 | 2 | 3 | 4 — its visible steps are
// Date/Time → Menu → Info → Pay, plus receipt rendered outside the wizard.
type WizardStep = 1 | 2 | 3 | 4;

// Sautéo's public Messenger conversation. Used by the pre-invite gate, the
// /dine-in marketing page, and the receipt's "send payment screenshot" CTA.
const MESSENGER_URL = "https://www.facebook.com/messages/t/1119234891273865";

// Cart key shape:
//   - `<itemId>`                                          — no variant, no claim
//   - `<itemId>::<variantIndex>`                          — variant chosen
//   - `<itemId>::_::claim:<shortId>`                      — claimed line, no variant
//   - `<itemId>::<variantIndex>::claim:<shortId>`         — claimed line + variant
// The optional `::claim:<shortId>` suffix turns a claimed line into its own
// cart entry (qty locked at 1) so it never merges with anonymous adds of the
// same item/variant. Per RA 9994: one ID covers exactly one unit.
const CART_KEY_DELIM = "::";
const CLAIM_PREFIX = "claim:";
const CLAIM_VARIANT_PLACEHOLDER = "_";

function makeCartKey(itemId: string, variantIndex: number | null): string {
  return variantIndex == null ? itemId : `${itemId}${CART_KEY_DELIM}${variantIndex}`;
}

function makeClaimCartKey(
  itemId: string,
  variantIndex: number | null,
  claimId: string,
): string {
  const variantSeg = variantIndex == null ? CLAIM_VARIANT_PLACEHOLDER : String(variantIndex);
  return `${itemId}${CART_KEY_DELIM}${variantSeg}${CART_KEY_DELIM}${CLAIM_PREFIX}${claimId}`;
}

// Short, URL-safe id good enough to disambiguate cart lines within a
// single browsing session — collision risk is negligible at cart sizes.
function makeClaimId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID().slice(0, 8);
  }
  return Math.random().toString(36).slice(2, 10);
}

function parseCartKey(key: string): { itemId: string; variantIndex: number | null } {
  const parts = key.split(CART_KEY_DELIM);
  const itemId = parts[0];
  if (parts.length < 2) return { itemId, variantIndex: null };
  // Second segment is either the variant index (anonymous line) or the
  // placeholder "_" (claimed line without a variant). Anything else is the
  // claim segment (in which case there's no variant in this position).
  const second = parts[1];
  if (second === CLAIM_VARIANT_PLACEHOLDER) return { itemId, variantIndex: null };
  if (second.startsWith(CLAIM_PREFIX)) return { itemId, variantIndex: null };
  const vi = Number(second);
  return { itemId, variantIndex: Number.isFinite(vi) ? vi : null };
}

// Returns the claim short-id if this cart key represents a claimed line,
// else null. The caller can index `ClaimsByCartKey` directly with the full
// key — this helper is for badge/UI checks that don't need the value.
function getClaimId(key: string): string | null {
  const parts = key.split(CART_KEY_DELIM);
  const last = parts[parts.length - 1];
  return last.startsWith(CLAIM_PREFIX) ? last.slice(CLAIM_PREFIX.length) : null;
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

// Shared slot loader for both wizards. Two paths:
//   1. lockedSlotId set (admin Waitlist bulk invite, or any future
//      pickup-locked invite) — fetch that one slot by id and select it
//      immediately. The customer doesn't get a picker.
//   2. otherwise — fetch all open, upcoming `channel` slots from today
//      forward, optionally filtered to a small set of valid times
//      (pickup's 4/6/8 PM rule).
// Returns the same shape both wizards built inline.
function useReservationSlots({
  channel,
  lockedSlotId,
  filterTimes,
}: {
  channel: "dine_in" | "pickup";
  lockedSlotId: string | null | undefined;
  filterTimes?: readonly string[];
}) {
  const [slots, setSlots] = useState<AvailableSlot[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(true);
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setSlotsLoading(true);
      if (lockedSlotId) {
        const { data, error } = await supabase
          .from("time_slots")
          .select("id, slot_date, slot_time, capacity, seats_taken, is_open")
          .eq("id", lockedSlotId)
          .maybeSingle();
        if (error || !data) {
          console.warn("[slots] locked slot load failed:", error);
          setSlots([]);
        } else {
          setSlots([data as AvailableSlot]);
          setSelectedSlotId((data as AvailableSlot).id);
        }
        setSlotsLoading(false);
        return;
      }
      const today = localToday();
      let query = supabase
        .from("time_slots")
        .select("id, slot_date, slot_time, capacity, seats_taken, is_open")
        .eq("channel", channel)
        .gte("slot_date", today)
        .eq("is_open", true);
      if (filterTimes && filterTimes.length > 0) {
        query = query.in("slot_time", filterTimes as unknown as string[]);
      }
      const { data, error } = await query
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
    // `filterTimes` is a module-stable readonly tuple in every current
    // caller, so it isn't in deps. `channel` changes never happen at
    // runtime today either, but keep it tracked for future flexibility.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel, lockedSlotId]);

  const slotsByDate = useMemo(() => {
    const m: Record<string, AvailableSlot[]> = {};
    for (const s of slots) (m[s.slot_date] ||= []).push(s);
    return m;
  }, [slots]);

  const selectedSlot = useMemo(
    () => slots.find((s) => s.id === selectedSlotId) ?? null,
    [slots, selectedSlotId],
  );

  return {
    slots,
    slotsLoading,
    selectedSlotId,
    setSelectedSlotId,
    slotsByDate,
    selectedSlot,
  };
}

// Per-claimant ID-extraction status. Shared by ReservationView (state)
// and ClaimantCard (rendered hint), so it lives at module scope.
type AutoFillStatus =
  | { state: "idle" }
  | { state: "loading" }
  | { state: "filled"; confidence: number }
  | { state: "off" }
  | { state: "failed" };

// 4-pill (dine-in) / 5-pill (pickup) progress indicator at the top of each
// wizard. The trailing pill (receipt placeholder) is never click-reachable;
// every other pill is reachable iff it's <= `current` (i.e. you can jump
// back but not skip ahead). `done` is a presentational flag — callers
// decide whether earlier steps are visually checked off.
function WizardStepper({
  steps,
  current,
  onJump,
}: {
  steps: ReadonlyArray<{ n: number; label: string; done: boolean }>;
  current: number;
  onJump: (n: number) => void;
}) {
  const finalN = steps[steps.length - 1]?.n;
  return (
    <div className="mb-6">
      <ol className="flex items-center gap-2">
        {steps.map((s, i, arr) => {
          const active = current === s.n;
          const reachable = s.n !== finalN && s.n <= current;
          return (
            <li key={s.n} className="flex items-center gap-2 flex-1">
              <button
                type="button"
                onClick={() => {
                  if (!reachable) return;
                  onJump(s.n);
                }}
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
                  {s.done && !active ? <Check className="h-3 w-3" /> : s.n}
                </span>
                <span className="hidden sm:inline">{s.label}</span>
              </button>
              {i < arr.length - 1 && (
                <span
                  className={`flex-1 h-px ${
                    arr[i + 1].done || current > s.n ? "bg-primary/30" : "bg-border"
                  }`}
                />
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

// Subtotal / SC-PWD discount / Amount-due rows, shared across the desktop
// cart sidebar, the mobile cart sheet, both wizard "Order summary" cards,
// and the receipt. Variants differ in copy density and typography only;
// everything reads from `DiscountSummary` so a copy or rate change lands
// in one place. Renders nothing when there's no discount and `showTotal`
// is false (compact sheet, where the total lives in the header).
function DiscountBreakdown({
  summary,
  variant,
  showTotal = true,
  totalLabelDiscount = "Amount due",
  totalLabelNone = "Total",
}: {
  summary: DiscountSummary;
  variant: "panel" | "wizard" | "receipt";
  // The mobile cart sheet hides its total in the header, so it asks for
  // rows only. Everything else renders the total inline.
  showTotal?: boolean;
  totalLabelDiscount?: string;
  totalLabelNone?: string;
}) {
  const hasDiscount = summary.discount > 0;
  if (!hasDiscount && !showTotal) return null;

  const lineCls =
    variant === "wizard" ? "text-sm" : variant === "receipt" ? "text-xs" : "text-[11px]";
  const discountLabel =
    variant === "wizard"
      ? `Senior / PWD discount (${Math.round(SENIOR_PWD_DISCOUNT_RATE * 100)}% × ${summary.effectiveClaimants})`
      : variant === "receipt"
        ? "Total discount"
        : "SC/PWD discount";

  return (
    <>
      {hasDiscount && (
        <>
          <div className={`flex justify-between ${lineCls} text-muted-foreground`}>
            <span>Subtotal</span>
            <span className="tabular-nums">₱{summary.gross.toFixed(0)}</span>
          </div>
          <div className={`flex justify-between ${lineCls} text-primary`}>
            <span>{discountLabel}</span>
            <span className="tabular-nums">−₱{summary.discount.toFixed(0)}</span>
          </div>
        </>
      )}
      {showTotal && variant === "panel" && (
        <div className="flex items-baseline justify-between pt-1.5">
          <span className="text-xs uppercase tracking-wider text-muted-foreground">
            {hasDiscount ? totalLabelDiscount : totalLabelNone}
          </span>
          <span className="font-display text-2xl font-semibold tabular-nums">
            ₱{summary.net.toFixed(0)}
          </span>
        </div>
      )}
      {showTotal && variant === "wizard" && (
        <div className="flex justify-between font-semibold text-foreground pt-1">
          <span>{hasDiscount ? totalLabelDiscount : totalLabelNone}</span>
          <span className="tabular-nums">₱{summary.net.toFixed(0)}</span>
        </div>
      )}
    </>
  );
}

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
  // cartKey → Claimant for claimed (senior/PWD) lines. Keyed by the *full*
  // cart key so the entry is dropped automatically when the line is. The
  // VariantSelectModal collects the claim at item-add time; per-line trash
  // / qty=0 routes through `removeCartKey` below to clean both maps.
  const [claims, setClaims] = useState<ClaimsByCartKey>({});
  // Invite users go straight into the booking wizard. Pickup is public —
  // visitors of /pick-up (no token) also drop straight into the wizard so
  // they start at step 1 (Date & time). Bare dine-in visitors stay on the
  // menu so the SEO homepage is browseable; tapping Checkout sends them
  // into the wizard where the invite-only gate fires.
  const [view, setView] = useState<View>(
    invite || effectiveChannel === "pickup" ? "wizard" : "menu",
  );
  // Lifted out of the wizard so MenuPage can swap the page layout when the
  // guest is on the menu step (which wants a fixed-height layout + sticky
  // cart bar, unlike the other wizard steps).
  const [wizardStep, setWizardStep] = useState<WizardStep>(1);
  const [receipt, setReceipt] = useState<ReceiptShape | null>(null);

  useEffect(() => {
    (async () => {
      // Pickup hides whole categories admins flagged as dine-in-only (e.g.
      // "Group Sets"). Dine-in always shows every category — the dine-in
      // availability rule is "always on" and lives at the item level too.
      // PostgREST builder rule: filter (.eq) before transform (.order).
      const catBase = supabase.from("menu_categories").select("*");
      const catFiltered =
        effectiveChannel === "pickup" ? catBase.eq("available_pickup", true) : catBase;

      const [{ data: c }, { data: i }] = await Promise.all([
        catFiltered.order("sort_order"),
        supabase
          .from("menu_items")
          .select("*")
          .eq("active", true)
          .eq(
            effectiveChannel === "pickup"
              ? "available_pickup"
              : "available_dine_in",
            true,
          )
          .order("sort_order"),
      ]);
      const visibleCats = (c ?? []) as Category[];
      setCategories(visibleCats);
      // Drop items whose category got filtered out — otherwise they'd show
      // up under an "Uncategorized" fallback or render with no chip header.
      const visibleCatIds = new Set(visibleCats.map((cat) => cat.id));
      // Cast via unknown because the generated Supabase types don't yet
      // include the recently-added `variants` jsonb column. The runtime row
      // shape matches MenuItem.
      setItems(
        ((i ?? []) as unknown as MenuItem[])
          .filter((it) => visibleCatIds.has(it.category_id))
          .map((it) => ({
            ...it,
            price: Number(it.price),
            available_dine_in: it.available_dine_in ?? true,
            available_pickup: it.available_pickup ?? true,
          })),
      );
    })();
  }, [effectiveChannel]);

  // Expand the cart into per-unit rows so the discount engine can attribute
  // a discount to any claimed line. Each (cart key × qty) becomes qty
  // distinct CartUnit entries; claimed lines are qty=1, so they contribute
  // exactly one discounted unit each.
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

  // Live discount summary driven by which cart lines carry a Claimant.
  // Used by the cart panels and by the payment-step breakdown card so the
  // total updates the moment a senior/PWD line is added or removed.
  const discountSummary: DiscountSummary = useMemo(
    () => summarizeDiscount(cartUnits, claims),
    [cartUnits, claims],
  );

  // The menu-view "Total" button still shows the sticker total (no claim
  // form on that screen). PaymentView and ReceiptView use discountSummary.net.
  const total = gross;
  const cartCount = Object.values(cart).reduce((a, b) => a + b, 0);

  // Generic stepper — operates on a composite cart key. When the qty hits
  // 0, also revoke any object URL the line's claim photo created and clear
  // the matching `claims` entry so the two maps stay in sync.
  const updateQty = (key: string, delta: number) => {
    setCart((prev) => {
      const q = (prev[key] || 0) + delta;
      const next = { ...prev };
      if (q <= 0) delete next[key];
      else next[key] = q;
      return next;
    });
    if (claims[key]) {
      const photoUrl = claims[key].idPhotoUrl;
      setCart((prev) => {
        // No-op state read so React batches with the setCart above; the
        // real check is whether the qty would zero out, which we evaluate
        // off the previous claims map.
        const prevQty = prev[key] || 0;
        if (prevQty + delta <= 0 && photoUrl) URL.revokeObjectURL(photoUrl);
        return prev;
      });
      setClaims((prev) => {
        if (!prev[key]) return prev;
        // Drop the claim only when the cart line is gone. Claimed lines are
        // qty=1 by construction, so any non-positive delta empties them.
        if ((cart[key] || 0) + delta > 0) return prev;
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
  };

  // Add a regular (no claim) or claimed (senior/PWD) line. Claimed lines
  // always force qty=1 — one ID covers one unit per RA 9994 — and live on
  // their own cart key so they never merge with anonymous adds.
  const addToCart = (
    itemId: string,
    variantIndex: number | null,
    qty: number,
    claim?: Claimant,
  ) => {
    if (qty <= 0) return;
    if (claim) {
      const claimId = makeClaimId();
      const key = makeClaimCartKey(itemId, variantIndex, claimId);
      setCart((prev) => ({ ...prev, [key]: 1 }));
      setClaims((prev) => ({ ...prev, [key]: claim }));
      return;
    }
    const key = makeCartKey(itemId, variantIndex);
    setCart((prev) => ({ ...prev, [key]: (prev[key] || 0) + qty }));
  };

  // placeOrder is the post-RPC step. ReservationView calls create_booking
  // and, on success, passes the returned reference_code and the chosen
  // slot back here so we can render the receipt with real data.
  const placeOrder = (args: {
    bookingId: string;
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

    // Snapshot the per-line discount attribution at order time so the
    // receipt matches what the guest just authorized — each discounted
    // unit reads its own Claimant from the cart-key → claim map.
    const discountLines: ReceiptDiscountLine[] = discountSummary.discountedUnits.map(
      (du) => {
        const c = claims[du.unit.cartKey];
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
    // Upload ID photos + persist claim rows. Best-effort: failures are logged
    // but never shown to the customer — the booking is already confirmed.
    // We capture claims in a local snapshot before clearing state so the async
    // closure still sees the data even after setClaims({}) below.
    const claimsSnapshot = { ...claims };
    (async () => {
      await Promise.allSettled(
        Object.entries(claimsSnapshot).map(async ([cartKey, claim]) => {
          const du = discountSummary.discountedUnits.find(
            (u) => u.unit.cartKey === cartKey,
          );

          // Upload front and back ID photos, storing their paths on the claim row.
          const uploadPhoto = async (file: File, suffix: string): Promise<string | null> => {
            const ext = file.type.includes("png") ? "png" : file.type.includes("webp") ? "webp" : "jpg";
            const safeName = cartKey.replace(/[^a-z0-9]/gi, "_").slice(0, 40);
            const path = `bookings/${args.referenceCode}/${safeName}_${suffix}.${ext}`;
            const { error } = await supabase.storage
              .from("senior-pwd-ids")
              .upload(path, file, { contentType: file.type, upsert: false });
            if (error) {
              console.warn(`[senior-id] ${suffix} photo upload failed:`, error.message);
              return null;
            }
            return path;
          };

          const [photoPath, backPhotoPath] = await Promise.all([
            claim.idPhotoFile     ? uploadPhoto(claim.idPhotoFile,     "front") : Promise.resolve(null),
            claim.idBackPhotoFile ? uploadPhoto(claim.idBackPhotoFile, "back")  : Promise.resolve(null),
          ]);

          const claimRow: Record<string, unknown> = {
            booking_id: args.bookingId,
            reference_code: args.referenceCode,
            kind: claim.kind,
            full_name: claim.fullName,
            id_number: claim.idNumber,
            date_of_birth: claim.dateOfBirth,
            age: claim.age,
            sex: claim.sex,
            date_of_issue: claim.dateOfIssue,
            address: claim.address,
            item_name: du?.unit.displayName ?? "",
            discount_amount: du?.discountAmount ?? 0,
            id_photo_path: photoPath,
            id_back_photo_path: backPhotoPath,
          };
          let { error: insertErr } = await (supabase.from("senior_pwd_claims") as any).insert(claimRow);
          // Fallback: if the migration hasn't been applied yet, retry without
          // the back-photo column so the front-photo claim still saves.
          if (insertErr?.message?.includes("id_back_photo_path")) {
            const { id_back_photo_path: _dropped, ...rowWithoutBack } = claimRow;
            ({ error: insertErr } = await (supabase.from("senior_pwd_claims") as any).insert(rowWithoutBack));
          }
          if (insertErr) console.warn("[senior-id] claim insert failed:", insertErr.message);
        }),
      );
    })();

    setCart({});
    setClaims({});
    setView("receipt");
    // Reset for the next booking — receipt view drives the user back to
    // step 1 if they tap "Place another order".
    setWizardStep(1);
  };

  // The menu UI (whether the standalone browse or step 2 inside the wizard)
  // keeps the existing fixed-height layout + sticky cart bar. All other
  // views use the standard scrolling page layout.
  const isMenuView =
    view === "menu" || (view === "wizard" && wizardStep === 2);

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
            claims={claims}
            updateQty={updateQty}
            addToCart={addToCart}
            total={total}
            cartCount={cartCount}
            discountSummary={discountSummary}
            onCheckout={() => setView("wizard")}
            allowDiscount={effectiveChannel === "dine_in"}
          />
        )}
        {view === "wizard" &&
          (effectiveChannel === "pickup" ? (
            <PickupReservationView
              invite={invite}
              cart={cart}
              items={items}
              gross={gross}
              cartUnitCount={cartUnits.length}
              discountSummary={discountSummary}
              step={wizardStep}
              setStep={setWizardStep}
              renderMenu={() => (
                <MenuView
                  categories={categories}
                  items={items}
                  cart={cart}
                  claims={claims}
                  updateQty={updateQty}
                  addToCart={addToCart}
                  total={total}
                  cartCount={cartCount}
                  discountSummary={discountSummary}
                  onCheckout={() => setWizardStep(3)}
                  allowDiscount={false}
                />
              )}
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
              discountSummary={discountSummary}
              step={wizardStep}
              setStep={setWizardStep}
              renderMenu={() => (
                <MenuView
                  categories={categories}
                  items={items}
                  cart={cart}
                  claims={claims}
                  updateQty={updateQty}
                  addToCart={addToCart}
                  total={total}
                  cartCount={cartCount}
                  discountSummary={discountSummary}
                  onCheckout={() => setWizardStep(3)}
                  allowDiscount={true}
                />
              )}
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
  claims,
  updateQty,
  addToCart,
  total,
  cartCount,
  discountSummary,
  onCheckout,
  allowDiscount,
}: {
  categories: Category[];
  items: MenuItem[];
  cart: Cart;
  // cartKey → Claimant for senior/PWD-claimed lines. Drives the discount
  // badges and the discounted unit/line totals in the cart panels.
  claims: ClaimsByCartKey;
  updateQty: (key: string, delta: number) => void;
  addToCart: (
    itemId: string,
    variantIndex: number | null,
    qty: number,
    claim?: Claimant,
  ) => void;
  total: number;
  cartCount: number;
  // Net total after RA 9994 discounts. Drives the "Total" line in the
  // cart footer; falls back to gross when no lines are claimed.
  discountSummary: DiscountSummary;
  onCheckout: () => void;
  allowDiscount: boolean;
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
  // Senior/PWD claimed adds are always one-shot — they don't honor keepOpen,
  // and they always force the toast + close, since each claim is its own
  // ID-upload commitment.
  const handleVariantAdd = useCallback(
    (
      item: MenuItem,
      variantIndex: number | null,
      qty: number,
      keepOpen: boolean,
      claim?: Claimant,
    ) => {
      addToCart(item.id, variantIndex, qty, claim);
      if (claim || !keepOpen) {
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
                      <span className="flex items-baseline gap-2 min-w-0 flex-1">
                        {/* min-w-0 here is what actually lets `truncate`
                            shrink the name in a flex layout — without it,
                            flex children default to min-width: auto and
                            the long set-menu names blow past the chevron. */}
                        <span className="font-display text-xl md:text-2xl font-semibold text-foreground tracking-tight min-w-0">
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
        claims={claims}
        items={items}
        updateQty={updateQty}
        summary={discountSummary}
        cartCount={cartCount}
        onCheckout={onCheckout}
      />

      {/* Mobile / tablet (below lg) — cococart-style bottom pill + bottom sheet.
          The desktop CartSidePanel above takes over at lg. The toast is now
          cross-viewport (no lg:hidden). */}
      {cartCount > 0 && (
        <PreviewCartPill
          cartCount={cartCount}
          total={discountSummary.net}
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
        claims={claims}
        items={items}
        updateQty={handleUpdateQty}
        total={discountSummary.net}
        summary={discountSummary}
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
        allowDiscount={allowDiscount}
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
  allowDiscount,
}: {
  item: MenuItem | null;
  quickAdd: boolean;
  onClose: () => void;
  onAdd: (
    item: MenuItem,
    variantIndex: number | null,
    qty: number,
    keepOpen: boolean,
    claim?: Claimant,
  ) => void;
  allowDiscount: boolean;
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

  // Senior/PWD claim attached to this add. `regular` = no discount.
  // `senior` / `pwd` open the ID-upload form below and lock qty to 1 (one
  // ID covers one unit per RA 9994). Each Add commits one claim.
  const [claimKind, setClaimKind] = useState<"regular" | "senior" | "pwd">(
    "regular",
  );
  const [claim, setClaim] = useState<Claimant>(() => makeBlankClaimant("senior"));
  const [claimAutoFill, setClaimAutoFill] = useState<AutoFillStatus>({
    state: "idle",
  });
  const claimExtractAbort = useRef<AbortController | null>(null);
  const scrollBodyRef = useRef<HTMLDivElement | null>(null);
  const isClaimed = claimKind !== "regular";

  useEffect(() => {
    if (item) {
      setDisplayed(item);
      setMounted(true);
      setSelectedIndices(new Set());
      setQty(1);
      setShowAdded(false);
      // Scroll modal body to top so variant checkboxes are visible immediately
      // (without this the modal opened scrolled to the middle on items with a
      // tall image, hiding all checkboxes above the fold).
      if (scrollBodyRef.current) scrollBodyRef.current.scrollTop = 0;
      // Fresh modal session — reset the claim form so a stale ID from a
      // prior item doesn't bleed across opens. Revoke the previous photo
      // URL inside the functional updater so we always free the *current*
      // blob (a `[]`-dep unmount effect would close over the initial null).
      setClaimKind("regular");
      setClaim((prev) => {
        if (prev.idPhotoUrl) URL.revokeObjectURL(prev.idPhotoUrl);
        return makeBlankClaimant("senior");
      });
      setClaimAutoFill({ state: "idle" });
      claimExtractAbort.current?.abort();
      claimExtractAbort.current = null;
      return;
    }
    const t = window.setTimeout(() => {
      setMounted(false);
      setDisplayed(null);
      // Modal fully unmounting — revoke any photo URL still held and
      // abort any in-flight OCR. Lives inside the updater so the latest
      // claim's blob is freed (vs an `[]`-dep effect that captures the
      // initial-render null).
      setClaim((prev) => {
        if (prev.idPhotoUrl) URL.revokeObjectURL(prev.idPhotoUrl);
        return prev.idPhotoUrl ? { ...prev, idPhotoUrl: null, idPhotoFile: null } : prev;
      });
      claimExtractAbort.current?.abort();
      claimExtractAbort.current = null;
    }, 200);
    return () => window.clearTimeout(t);
  }, [item]);

  // Reset photo state when the customer flips between Regular / Senior / PWD.
  // Switching to Regular drops the in-progress claim entirely; switching
  // between Senior and PWD only re-flags the kind on the in-progress claim
  // (so they don't lose a half-filled form by tapping the wrong pill).
  useEffect(() => {
    if (claimKind === "regular") {
      claimExtractAbort.current?.abort();
      claimExtractAbort.current = null;
      setClaim((prev) => {
        if (prev.idPhotoUrl) URL.revokeObjectURL(prev.idPhotoUrl);
        return makeBlankClaimant("senior");
      });
      setClaimAutoFill({ state: "idle" });
    } else {
      setClaim((prev) => ({ ...prev, kind: claimKind }));
    }
    // Claimed adds are always qty=1 (one ID = one unit, RA 9994). Setting
    // it here covers both directions so qty never gets out of sync with
    // the disabled stepper.
    setQty(1);
  }, [claimKind]);

  const onClaimPhotoChange = (file: File | null) => {
    setClaim((prev) => {
      if (prev.idPhotoUrl) URL.revokeObjectURL(prev.idPhotoUrl);
      return {
        ...prev,
        idPhotoFile: file,
        idPhotoUrl: file ? URL.createObjectURL(file) : null,
      };
    });
    claimExtractAbort.current?.abort();
    if (!file) {
      setClaimAutoFill({ state: "idle" });
      return;
    }
    const ac = new AbortController();
    claimExtractAbort.current = ac;
    setClaimAutoFill({ state: "loading" });
    (async () => {
      let result: ExtractIdResult;
      try {
        result = await extractIdFromPhoto(file, ac.signal);
      } catch (e) {
        if ((e as DOMException)?.name === "AbortError") return;
        setClaimAutoFill({ state: "failed" });
        return;
      }
      if (ac.signal.aborted) return;
      if (!result.available) {
        setClaimAutoFill({ state: "off" });
        return;
      }
      // Mirror the wizard's OCR autofill: only fill empty fields so we
      // don't stomp anything the customer already typed.
      setClaim((prev) => ({
        ...prev,
        kind:
          result.kind === "senior" || result.kind === "pwd"
            ? result.kind
            : prev.kind,
        fullName: prev.fullName.trim() ? prev.fullName : result.full_name,
        idNumber: prev.idNumber.trim() ? prev.idNumber : result.id_number,
        address: prev.address.trim() ? prev.address : result.address,
        dateOfBirth: prev.dateOfBirth.trim() ? prev.dateOfBirth : result.date_of_birth,
        age: prev.age.trim() ? prev.age : result.age,
        sex: prev.sex.trim() ? prev.sex : result.sex,
        dateOfIssue: prev.dateOfIssue.trim() ? prev.dateOfIssue : result.date_of_issue,
      }));
      // Echo the recognized kind onto the radio so the customer sees the
      // pill state agree with what the OCR found.
      if (result.kind === "senior" || result.kind === "pwd") {
        setClaimKind(result.kind);
      }
      setClaimAutoFill({ state: "filled", confidence: result.confidence });
    })();
  };

  const claimFieldsValid =
    claim.fullName.trim().length >= 2 &&
    claim.age.trim().length >= 1 &&
    claim.dateOfBirth.trim().length >= 4 &&
    claim.dateOfIssue.trim().length >= 4 &&
    !!claim.idPhotoFile;

  // Auto-hide the in-modal "Added!" pill ~2s after each add.
  useEffect(() => {
    if (!showAdded) return;
    const t = window.setTimeout(() => setShowAdded(false), 2000);
    return () => window.clearTimeout(t);
  }, [showAdded, addedNonce]);

  useEffect(() => {
    if (!item) return;
    setOpenGroup(null);
  }, [item]);

  // Toggle a variant's selection. As a side effect, opens the accordion
  // group containing the just-toggled variant so the user can see what they
  // just picked. Inline (not in an effect) so manual accordion header taps
  // are NEVER fought by selection state.
  // Claimed adds are single-unit, so selecting a variant replaces the
  // current pick instead of multi-adding.
  const toggleSelection = (idx: number) => {
    setSelectedIndices((prev) => {
      if (isClaimed) {
        if (prev.has(idx) && prev.size === 1) return new Set();
        return new Set([idx]);
      }
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
  // Claimed adds layer on an extra gate: the ID + fields must validate and
  // (for variant items) exactly one variant must be picked since a claim
  // is one-shot.
  const canAdd =
    qty > 0 &&
    (!hasVariants || selectedIndices.size > 0) &&
    (!isClaimed || claimFieldsValid) &&
    (!isClaimed || !hasVariants || selectedIndices.size === 1);

  const handleAddClick = () => {
    if (!canAdd) return;
    // Claimed adds are always single-unit, single-line. Pass the claim
    // through to addToCart so MenuPage allocates a fresh claim cart key.
    if (isClaimed) {
      const variantIndex = hasVariants
        ? Array.from(selectedIndices)[0]
        : null;
      onAdd(displayed, variantIndex ?? null, 1, false, { ...claim });
      return;
    }
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

        {/* Scrollable interior — image + name + variants + optional description.
            Image height is capped so variant pickers are visible above the
            fold; otherwise on mobile a square hero ate the whole modal and
            customers couldn't tell why "Add to cart" was disabled. */}
        <div ref={scrollBodyRef} className="flex-1 overflow-y-auto min-h-0">
          {/* Image */}
          <div
            className={`w-full bg-muted overflow-hidden ${
              hasVariants ? "aspect-[16/9] max-h-44" : "aspect-square"
            }`}
          >
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

          {allowDiscount && (
            <>
              {/* For whom? — Regular / Senior / PWD. Picking a non-regular
                  option locks qty to 1 (one ID = one unit per RA 9994) and
                  expands the ID form below. */}
              <div className="px-5 pt-3 pb-2">
                <div className="block text-[10px] uppercase tracking-wider text-muted-foreground mb-2">
                  For whom?
                </div>
                <div className="inline-flex rounded-full bg-muted/50 p-0.5 w-full">
                  {(
                    [
                      { value: "regular", label: "Regular" },
                      { value: "senior", label: "Senior" },
                      { value: "pwd", label: "PWD" },
                    ] as const
                  ).map((opt) => {
                    const active = claimKind === opt.value;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setClaimKind(opt.value)}
                        aria-pressed={active}
                        className={`flex-1 px-3 py-1.5 rounded-full text-xs font-semibold transition ${
                          active
                            ? "bg-foreground text-background shadow-sm"
                            : "text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
                {isClaimed && (
                  <p className="mt-2 text-[11px] text-muted-foreground leading-snug">
                    Upload one valid ID per discounted unit. 20% off applies to
                    this line only — to discount another unit, add it again
                    with a separate ID.
                  </p>
                )}
              </div>

              {isClaimed && (
                <div className="px-5 pt-1 pb-2">
                  <ClaimantCard
                    index={0}
                    claimant={claim}
                    autoFill={claimAutoFill}
                    onChange={(patch) => setClaim((prev) => ({ ...prev, ...patch }))}
                    onPhotoChange={onClaimPhotoChange}
                    onRemove={() => setClaimKind("regular")}
                  />
                </div>
              )}
            </>
          )}

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
                disabled={qty <= 1 || isClaimed}
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
                disabled={isClaimed}
                className="h-9 w-9 flex items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed transition"
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
  claims,
  items,
  updateQty,
  total,
  summary,
  onCheckout,
}: {
  open: boolean;
  onClose: () => void;
  cart: Cart;
  claims: ClaimsByCartKey;
  items: MenuItem[];
  updateQty: (key: string, delta: number) => void;
  // Net (after discount). Headline number shown on the sheet header.
  total: number;
  // Full discount summary (gross/discount/net + claim attribution). Drives
  // the footer Subtotal/Discount rows via <DiscountBreakdown />.
  summary: DiscountSummary;
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
          const claim = claims[key] ?? null;
          const unitPrice = getLinePrice(it, variantIndex);
          return {
            key,
            qty,
            name: it.name,
            variantName: getVariantName(it, variantIndex),
            price: unitPrice,
            discountedPrice: claim
              ? unitPrice * (1 - SENIOR_PWD_DISCOUNT_RATE)
              : unitPrice,
            claim,
            image_url: it.image_url,
          };
        })
        .filter(Boolean) as {
        key: string;
        qty: number;
        name: string;
        variantName: string | null;
        price: number;
        discountedPrice: number;
        claim: Claimant | null;
        image_url: string | null;
      }[],
    [cart, items, claims],
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
                    {li.claim && (
                      <span
                        className={`inline-flex items-center gap-1 mt-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-semibold ${
                          li.claim.kind === "pwd"
                            ? "bg-sky-100 text-sky-800"
                            : "bg-mustard/40 text-charcoal"
                        }`}
                      >
                        {li.claim.kind === "pwd" ? "PWD" : "Senior"}
                        {li.claim.fullName.trim() && (
                          <span className="font-normal opacity-70">
                            · {li.claim.fullName.trim().split(/\s+/)[0]}
                          </span>
                        )}
                      </span>
                    )}
                    <div className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
                      {li.claim ? (
                        <>
                          <span className="line-through">₱{li.price.toFixed(0)}</span>{" "}
                          <span className="text-foreground font-semibold">
                            ₱{li.discountedPrice.toFixed(0)}
                          </span>
                        </>
                      ) : (
                        <>₱{li.price.toFixed(0)}</>
                      )}
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
                      disabled={!!li.claim}
                      title={li.claim ? "Re-add this item with another ID to discount more" : undefined}
                      className="h-8 w-8 flex items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed transition"
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  {/* One-tap remove — pulls qty straight to 0 so the line
                      drops out instead of having to spam the minus button.
                      Same control on desktop (CartSidePanel) so the gesture
                      transfers between breakpoints. */}
                  <button
                    type="button"
                    onClick={() => updateQty(li.key, -li.qty)}
                    aria-label={`Remove ${li.name}`}
                    title="Remove from order"
                    className="h-8 w-8 rounded-full border border-border bg-background inline-flex items-center justify-center text-muted-foreground hover:text-destructive hover:border-destructive/40 transition shrink-0"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Footer — discount rows only (total lives in the header). */}
        <div className="px-5 pt-4 pb-5 border-t border-border/60 shrink-0 bg-card space-y-1.5">
          <DiscountBreakdown summary={summary} variant="panel" showTotal={false} />
          <button
            type="button"
            onClick={onCheckout}
            disabled={lineItems.length === 0}
            className="w-full inline-flex items-center justify-center gap-2 rounded-full bg-foreground text-background px-5 py-3 text-sm font-semibold hover:opacity-90 transition disabled:opacity-40 disabled:cursor-not-allowed mt-2"
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
  claims,
  items,
  updateQty,
  summary,
  cartCount,
  onCheckout,
}: {
  cart: Cart;
  claims: ClaimsByCartKey;
  items: MenuItem[];
  updateQty: (key: string, delta: number) => void;
  // Full discount summary (gross/discount/net + claim attribution). The
  // footer's Subtotal/Discount/Total are rendered via <DiscountBreakdown />.
  summary: DiscountSummary;
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
          const claim = claims[key] ?? null;
          const unitPrice = getLinePrice(it, variantIndex);
          return {
            key,
            qty,
            name: it.name,
            variantName: getVariantName(it, variantIndex),
            price: unitPrice,
            discountedPrice: claim
              ? unitPrice * (1 - SENIOR_PWD_DISCOUNT_RATE)
              : unitPrice,
            claim,
          };
        })
        .filter(Boolean) as {
        key: string;
        qty: number;
        name: string;
        variantName: string | null;
        price: number;
        discountedPrice: number;
        claim: Claimant | null;
      }[],
    [cart, claims, items],
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
                    {/* Item name kept at `text-xs` (smaller than the
                        section heading) so the typical menu names fit on
                        one line in a 320px panel; falls back to a 2-line
                        clamp for the long set-menu titles. */}
                    <div className="text-xs font-semibold text-foreground leading-snug line-clamp-2">
                      {li.name}
                    </div>
                    {li.variantName && (
                      <div className="text-[11px] text-muted-foreground mt-0.5 leading-tight line-clamp-1">
                        {li.variantName}
                      </div>
                    )}
                    {li.claim && (
                      <span
                        className={`inline-flex items-center gap-1 mt-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-semibold ${
                          li.claim.kind === "pwd"
                            ? "bg-sky-100 text-sky-800"
                            : "bg-mustard/40 text-charcoal"
                        }`}
                      >
                        {li.claim.kind === "pwd" ? "PWD" : "Senior"}
                        {li.claim.fullName.trim() && (
                          <span className="font-normal opacity-70">
                            · {li.claim.fullName.trim().split(/\s+/)[0]}
                          </span>
                        )}
                      </span>
                    )}
                    <div className="text-[11px] text-muted-foreground mt-0.5">
                      {li.claim ? (
                        <>
                          <span className="line-through">₱{li.price.toFixed(0)}</span>{" "}
                          <span className="text-foreground font-semibold">
                            ₱{li.discountedPrice.toFixed(0)}
                          </span>
                        </>
                      ) : (
                        <>₱{li.price.toFixed(0)}</>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1.5 shrink-0">
                    <div className="text-sm font-semibold text-foreground tabular-nums">
                      ₱{(li.discountedPrice * li.qty).toFixed(0)}
                    </div>
                    {/* Stepper first, trash on the right — matches the
                        mobile cart sheet so the gesture is the same on
                        either breakpoint. The `+` button is disabled on
                        claimed lines (qty locked at 1; re-add to discount
                        another unit). */}
                    <div className="inline-flex items-center gap-1.5">
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
                          disabled={!!li.claim}
                          title={li.claim ? "Re-add this item with another ID to discount more" : undefined}
                          className="h-6 w-6 flex items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed transition"
                        >
                          <Plus className="h-3 w-3" />
                        </button>
                      </div>
                      <button
                        type="button"
                        onClick={() => updateQty(li.key, -li.qty)}
                        aria-label={`Remove ${li.name}`}
                        title="Remove from order"
                        className="h-6 w-6 rounded-full border border-border bg-background inline-flex items-center justify-center text-muted-foreground hover:text-destructive hover:border-destructive/40 transition"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Footer */}
        <div className="px-5 pt-4 pb-5 border-t border-border/60 shrink-0 bg-card space-y-1.5">
          <DiscountBreakdown summary={summary} variant="panel" />
          <button
            type="button"
            onClick={onCheckout}
            disabled={isEmpty}
            className="w-full inline-flex items-center justify-center gap-2 rounded-full bg-foreground text-background px-5 py-3 text-sm font-semibold hover:opacity-90 transition disabled:opacity-40 disabled:cursor-not-allowed mt-3"
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
  bookingId: string;
  referenceCode: string;
  slot: AvailableSlot;
  customerName: string;
  groupSize: number;
  pickupMode?: "dine_in" | "personal_pickup" | "lalamove" | "grab";
  courierAddress?: string | null;
  paymentReference?: string | null;
};

// Public /pick-up agreement, now backed by the admin-editable booking_rules
// (pickup). Falls back to the static defaults until they load.
const PICKUP_FALLBACK: DisplayRule[] = PICKUP_DEFAULTS.map((r) => ({ ...r, group_label: "" }));

function PickupAgreementScreen({ onAgree }: { onAgree: () => void }) {
  const rules = useBookingRulesDisplay("pickup", PICKUP_FALLBACK);
  return <BookingAgreementScreen customerName="" rules={rules} onAgree={onAgree} />;
}

function BookingAgreementScreen({
  customerName,
  rules,
  onAgree,
}: {
  customerName: string;
  rules: { id: string; title: string; body: string }[];
  onAgree: () => void;
}) {
  const [checked, setChecked] = useState(false);
  const firstName = customerName.trim().split(" ")[0];

  return (
    <div className="max-w-md mx-auto py-8">
      <div className="flex justify-center mb-6">
        <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center">
          <BookOpen className="h-7 w-7 text-primary" />
        </div>
      </div>

      <h1 className="font-display text-2xl md:text-3xl text-center mb-2">
        Before you book{firstName ? `, ${firstName}` : ""}
      </h1>
      <p className="text-center text-muted-foreground text-sm mb-6 leading-relaxed">
        Please read and agree to Sautéo's booking policy<br />before choosing your slot.
      </p>

      <div className="space-y-3 mb-6">
        {rules.map((rule) => (
          <div key={rule.id} className="bg-card border border-border rounded-xl p-4 flex gap-3">
            <CheckCircle2 className="h-5 w-5 text-primary shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold leading-snug">{rule.title}</p>
              <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{rule.body}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="text-center mb-5">
        <a
          href="/terms"
          className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground transition"
        >
          Read full Terms &amp; Privacy Policy
        </a>
      </div>

      <label className="flex items-start gap-3 cursor-pointer mb-6 select-none">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => setChecked(e.target.checked)}
          className="mt-0.5 h-4 w-4 rounded border-border accent-primary cursor-pointer shrink-0"
        />
        <span className="text-sm text-muted-foreground leading-snug">
          I have read and agree to Sautéo's booking policy. I understand that{" "}
          <span className="text-foreground font-semibold">no cash refunds</span> will be given for{" "}
          <span className="text-foreground font-semibold">cancellations</span> or{" "}
          <span className="text-foreground font-semibold">no-shows</span>, under any circumstances.
        </span>
      </label>

      <button
        disabled={!checked}
        onClick={onAgree}
        className="w-full rounded-full bg-primary text-primary-foreground py-3 text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 transition"
      >
        I agree — proceed to booking
      </button>
    </div>
  );
}

function DineInReservationView({
  invite,
  cart,
  items,
  gross,
  cartUnitCount,
  discountSummary,
  step,
  setStep,
  renderMenu,
  onBack,
  onConfirm,
}: {
  invite: LoadedInvite | null;
  cart: Cart;
  items: MenuItem[];
  gross: number;
  cartUnitCount: number;
  discountSummary: DiscountSummary;
  // Step state is lifted to MenuPage so the page layout can switch to the
  // fixed-height menu layout when the guest is on step 2. Dine-in only uses
  // 1 | 2 | 3; the 4th pill is the "Done" placeholder (receipt rendered
  // outside this component). Typed as the full union for symmetry with the
  // pickup wizard.
  step: WizardStep;
  setStep: React.Dispatch<React.SetStateAction<WizardStep>>;
  // The menu UI as a render slot — MenuPage owns the cart/items/categories
  // and just hands us a ready-to-render <MenuView/> for step 2.
  renderMenu: () => React.ReactNode;
  // Pre-invite gate's "Back to menu" affordance; not used by the 4-step
  // wizard itself (each step has its own back nav inside the wizard).
  onBack: () => void;
  onConfirm: (args: ConfirmArgs) => void;
}) {
  // Senior/PWD claims now happen at item-add time inside the variant modal
  // (per-line attribution). No claim form lives on this payment step —
  // the discount breakdown below still reads from `discountSummary`.
  const payable = discountSummary.net;
  const hasDiscount = discountSummary.discount > 0;

  // Slot picker state — delegated to the shared hook so dine-in + pickup
  // load slots through the same code path.
  const {
    slots,
    slotsLoading,
    selectedSlotId,
    setSelectedSlotId,
    slotsByDate,
    selectedSlot,
  } = useReservationSlots({
    channel: "dine_in",
    lockedSlotId: invite?.lockedSlotId,
  });

  // When the invite was issued for a specific slot (admin "Waitlist" bulk
  // invite), the customer doesn't pick — we show that one slot read-only and
  // create_booking enforces it server-side.
  const isSlotLocked = !!invite?.lockedSlotId;

  // Customer info — prefilled from the invite when available so the customer
  // only has to pick a slot. Fields stay editable (in case the waitlist had
  // typos) BUT we surface a hint that the name/email/phone match what
  // Sautéo collected on Messenger.
  const [customerName, setCustomerName] = useState(invite?.customerName ?? "");
  const [customerEmail, setCustomerEmail] = useState(invite?.customerEmail ?? "");
  const [customerPhone, setCustomerPhone] = useState(invite?.customerPhone ?? "");
  const [groupSize, setGroupSize] = useState<number>(invite?.groupSize ?? 2);

  // QR display fallback — flips to true when /maya-qr.png 404s so the
  // payment card still renders gracefully without the image.
  const [qrImgError, setQrImgError] = useState(false);

  // Wizard step is owned by MenuPage (so the page layout can swap on step 2
  // for the menu's fixed-height layout). The user-visible ordering is:
  //   1 — Slot (date + time picker) + guests
  //   2 — Menu items (renderMenu slot from MenuPage)
  //   3 — Details + payment, internally split into two sub-steps:
  //         "details" — name/email/phone/notes + senior/PWD claims
  //         "pay"     — Maya QR + reference + Confirm
  //   4 — Receipt (rendered outside this component by MenuPage)
  const [paymentSubStep, setPaymentSubStep] = useState<"details" | "pay">(
    "details",
  );

  // Whenever we land on step 3, restart at the details sub-step. Avoids the
  // guest landing mid-form after they tap the stepper to jump back.
  useEffect(() => {
    if (step === 3) setPaymentSubStep("details");
  }, [step]);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

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
  // Per-step validity gates. Continue is enabled only when the current
  // step's required fields are all valid. Final submit gate (`canSubmit`)
  // re-checks everything as a defense in depth.
  //   1 — Slot picked + capacity ok + valid group size
  //   2 — Cart has at least one item
  //   3a — Customer details valid
  //   3b — Always valid here. Senior/PWD claims now live on the cart line
  //         (collected in the variant modal at item-add time), so there is
  //         no per-step gate left to evaluate.
  const step1Valid =
    !!selectedSlot && slotCapacityOk && groupSizeValid;
  const cartCount = Object.values(cart).reduce((a, b) => a + b, 0);
  const step2Valid = cartCount > 0;
  const step3aValid = nameValid && emailValid && phoneValid;

  const canSubmit =
    !submitting &&
    cartUnitCount > 0 &&
    step1Valid &&
    step2Valid &&
    step3aValid;

  // Step transitions scroll the next panel into view so the user lands at
  // the top of the new step instead of mid-page. Dine-in only ever passes
  // 1 | 2 | 3 here — the 4th pill ("Done") is never click-reachable.
  const goToStep = (s: 1 | 2 | 3) => {
    setStep(s);
    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
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

    const combinedNotes = variantDetailLines.length
      ? `Variants: ${variantDetailLines.join("; ")}`.slice(0, 500)
      : null;

    const payload: Record<string, unknown> = {
      slot_id: selectedSlot.id,
      customer_name: customerName.trim(),
      customer_email: customerEmail.trim().toLowerCase(),
      customer_phone: customerPhone.trim(),
      group_size: groupSize,
      notes: combinedNotes,
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
    const result = (data ?? {}) as { reference_code?: string; booking_id?: string };
    if (!result.reference_code || !result.booking_id) {
      setSubmitting(false);
      setSubmitError("Booking didn't return a reference code. Contact us in Messenger.");
      return;
    }

    setSubmitting(false);
    onConfirm({
      bookingId: result.booking_id,
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
            href={MESSENGER_URL}
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

  // Step 2 (menu) needs the wider, fixed-height layout to host MenuView's
  // sticky cart bar; the other steps use the standard centered wizard
  // wrapper. Page-level layout (h-screen vs min-h-screen) is also swapped
  // by MenuPage via `isMenuView`.
  const isMenuStep = step === 2;

  return (
    <div
      className={
        isMenuStep
          ? "max-w-3xl mx-auto flex-1 flex flex-col min-h-0 w-full"
          : "max-w-2xl mx-auto"
      }
    >
      <div className="flex items-center gap-2 mb-2">
        <Sparkles className="h-6 w-6 text-primary" />
        <h2 className="font-display text-3xl md:text-4xl">
          Confirm your reservation
        </h2>
      </div>
      <p className="text-muted-foreground mb-5">
        Step {step} of 4 — your total is{" "}
        <span className="font-semibold text-primary">
          ₱{payable.toFixed(0)}
        </span>
        .
      </p>

      <WizardStepper
        current={step}
        onJump={(n) => goToStep(n as 1 | 2 | 3)}
        steps={[
          { n: 1, label: "Slot", done: step > 1 },
          { n: 2, label: "Menu", done: step > 2 },
          { n: 3, label: "Pay", done: false },
          { n: 4, label: "Done", done: false },
        ]}
      />

      {/* ============ STEP 3b — Order summary (rendered with payment) ============
          Discount attribution moved to item-add time, so this card is now
          a quiet recap: subtotal, any RA 9994 / RA 10754 discounts applied
          per claimed line, and the amount due. If nothing was claimed, a
          single Total line stands in for the breakdown. */}
      {step === 3 && paymentSubStep === "pay" && (
      <div className="bg-card border border-border rounded-2xl p-5 mb-8 shadow-sm">
        <div className="flex items-center gap-2 mb-3">
          <Sparkles className="h-4 w-4 text-primary shrink-0" />
          <h3 className="font-display text-lg font-semibold">Order summary</h3>
        </div>
        <DiscountBreakdown summary={discountSummary} variant="wizard" />
        <p className="text-[11px] text-muted-foreground pt-2 leading-relaxed">
          {hasDiscount
            ? "Discount applied to each qualifying line at the cart. To claim another ID, go back and add the item again under Senior / PWD."
            : `Eligible for a Senior / PWD discount? Go back to the menu and tap your item — pick Senior or PWD before adding to receive ${Math.round(SENIOR_PWD_DISCOUNT_RATE * 100)}% off that line.`}
        </p>
      </div>
      )}

      {/* ============ STEP 1 — Slot picker + party size ============
          Dates grouped, time chips per date. RLS lets anon read
          time_slots; we filter to is_open=true and seats remaining.
          Guests count lives here so the capacity check has a real number
          when the customer picks a slot. */}
      {step === 1 && (
      <div className="bg-card border border-border rounded-2xl p-5 mb-8 shadow-sm">
        <div className="flex items-center gap-2 mb-1">
          <CalendarClock className="h-4 w-4 text-primary" />
          <h3 className="font-display text-lg font-semibold">
            {isSlotLocked ? "Your reserved slot" : "Pick your slot"}
          </h3>
        </div>
        <p className="text-xs text-muted-foreground mb-4">
          {isSlotLocked
            ? "Sautéo reserved this time for you — just confirm below."
            : "Only the dates and times Sautéo has opened are shown."}
        </p>

        {/* Party size — compact stepper. Drives the slot capacity check
            below so unavailable slots get correctly disabled. */}
        <div className="mb-4 flex items-center justify-between bg-muted/40 border border-border rounded-xl px-4 py-2.5">
          <div className="min-w-0">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Guests
            </div>
            <div className="text-[11px] text-muted-foreground">
              How many in your party (1–50)?
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              aria-label="Decrease guests"
              onClick={() => setGroupSize((g) => Math.max(1, g - 1))}
              disabled={groupSize <= 1}
              className="h-9 w-9 rounded-full bg-background border border-border text-foreground hover:bg-muted transition disabled:opacity-40 disabled:cursor-not-allowed"
            >
              −
            </button>
            <span className="font-display text-lg font-semibold tabular-nums w-8 text-center">
              {groupSize}
            </span>
            <button
              type="button"
              aria-label="Increase guests"
              onClick={() => setGroupSize((g) => Math.min(50, g + 1))}
              disabled={groupSize >= 50}
              className="h-9 w-9 rounded-full bg-background border border-border text-foreground hover:bg-muted transition disabled:opacity-40 disabled:cursor-not-allowed"
            >
              +
            </button>
          </div>
        </div>

        {isSlotLocked ? (
          slotsLoading ? (
            <div className="text-sm text-muted-foreground">Loading your slot…</div>
          ) : selectedSlot ? (
            <div className="rounded-xl border border-foreground bg-foreground/5 p-4">
              <div className="font-display text-lg font-semibold">
                {new Date(selectedSlot.slot_date + "T00:00:00").toLocaleDateString(undefined, {
                  weekday: "long",
                  month: "long",
                  day: "numeric",
                  year: "numeric",
                })}
              </div>
              <div className="text-sm text-muted-foreground mt-0.5">
                {formatSlotTime12h(selectedSlot.slot_time)}
              </div>
            </div>
          ) : (
            <div className="text-sm text-muted-foreground bg-muted/40 border border-border rounded-lg p-3">
              We couldn't load your reserved slot — please reply on Messenger and we'll help you out.
            </div>
          )
        ) : slotsLoading ? (
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

      {/* Step 1 nav — Continue to menu. (No Back: this is the first step.) */}
      {step === 1 && (
        <div className="flex items-center gap-3 mb-8">
          <button
            type="button"
            onClick={() => goToStep(2)}
            disabled={!step1Valid}
            className="flex-1 inline-flex items-center justify-center gap-2 px-6 py-3 rounded-full bg-foreground text-background font-semibold hover:opacity-90 transition disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Continue to menu
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* ============ STEP 2 — Menu items ============
          Renders the standard MenuView inside the wizard. MenuView's
          "Checkout" button advances to step 3 via the renderMenu slot
          wired up by MenuPage. */}
      {step === 2 && (
        <div className="flex-1 flex flex-col min-h-0 -mx-4 sm:-mx-6">
          {renderMenu()}
        </div>
      )}

      {/* Step 2 nav — Back to slot. (Continue lives inside MenuView's
          sticky cart bar.) */}
      {step === 2 && (
        <div className="flex items-center gap-3 mb-8 mt-3">
          <button
            type="button"
            onClick={() => goToStep(1)}
            className="inline-flex items-center justify-center gap-1.5 px-5 py-3 rounded-full bg-muted text-foreground text-sm font-semibold hover:bg-muted/70 transition"
          >
            <ChevronLeft className="h-4 w-4" />
            Back to slot
          </button>
          {!step2Valid && (
            <p className="text-xs text-muted-foreground italic">
              Add at least one item to continue.
            </p>
          )}
        </div>
      )}

      {/* ============ STEP 3a — Your details ============
          Customer info — fields mirror create_booking() server validation.
          Group size is captured on step 1 alongside the slot picker, so
          this card stays focused on contact info + notes. */}
      {step === 3 && paymentSubStep === "details" && (
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
              readOnly
              className="w-full bg-muted/50 border border-border rounded-lg px-3 py-2 text-sm cursor-default select-text"
            />
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
              Email
            </label>
            <input
              type="email"
              value={customerEmail}
              readOnly
              className="w-full bg-muted/50 border border-border rounded-lg px-3 py-2 text-sm cursor-default select-text"
            />
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
              Phone
            </label>
            <input
              type="tel"
              value={customerPhone}
              readOnly
              className="w-full bg-muted/50 border border-border rounded-lg px-3 py-2 text-sm cursor-default select-text"
            />
          </div>
        </div>
      </div>
      )}

      {/* Step 3a nav — Back to menu / Continue to payment. */}
      {step === 3 && paymentSubStep === "details" && (
        <div className="flex items-center gap-3 mb-8">
          <button
            type="button"
            onClick={() => goToStep(2)}
            className="inline-flex items-center justify-center gap-1.5 px-5 py-3 rounded-full bg-muted text-foreground text-sm font-semibold hover:bg-muted/70 transition"
          >
            <ChevronLeft className="h-4 w-4" />
            Back to menu
          </button>
          <button
            type="button"
            onClick={() => setPaymentSubStep("pay")}
            disabled={!step3aValid}
            className="flex-1 inline-flex items-center justify-center gap-2 px-6 py-3 rounded-full bg-foreground text-background font-semibold hover:opacity-90 transition disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Continue to payment
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* ============ STEP 3b — Payment ============
          Sautéo Payment QR — same Maya / InstaPay account customers see
          on the pickup flow. The receipt's totals + payment-verification
          path are shared with pickup so the admin Orders dashboard sees
          dine-in payments through the same lens. */}
      {step === 3 && paymentSubStep === "pay" && (
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
                <span className="font-mono text-cream">09953645517</span>
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
                    src="/maya-qr.jpg"
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
        {hasDiscount &&
          " Please bring the uploaded ID(s) with you on your visit — if they aren't presented, the discount will be voided."}
      </p>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => setPaymentSubStep("details")}
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
   per Sautéo's request.

   As of the 5-step rebuild, pickup is walk-in only — Lalamove / Grab
   delivery modes were retired. Older bookings may still carry those
   pickup_mode values; the admin Orders tab still labels them correctly. */

function PickupReservationView({
  invite,
  cart,
  items,
  gross,
  cartUnitCount,
  discountSummary,
  step,
  setStep,
  renderMenu,
  onBack,
  onConfirm,
}: {
  invite: LoadedInvite | null;
  cart: Cart;
  items: MenuItem[];
  gross: number;
  cartUnitCount: number;
  discountSummary: DiscountSummary;
  // Lifted to MenuPage so the page layout can swap on step 2 (menu).
  step: WizardStep;
  setStep: React.Dispatch<React.SetStateAction<WizardStep>>;
  // MenuView slot for step 2 — MenuPage owns cart/items/categories.
  renderMenu: () => React.ReactNode;
  // Unused by pickup itself (no pre-invite gate — pickup is public per
  // 20260524120000_open_pickup_bookings.sql) but kept for prop symmetry
  // with the dine-in wizard.
  onBack: () => void;
  onConfirm: (args: ConfirmArgs) => void;
}) {
  // Senior/PWD claims happen at item-add time inside the variant modal;
  // no claim form lives on this payment step. The breakdown below reads
  // from discountSummary the same way dine-in does.
  const payable = discountSummary.net;
  const hasDiscount = discountSummary.discount > 0;

  const [pickupMode, setPickupMode] = useState<"personal" | "courier">("personal");
  const [courierAddress, setCourierAddress] = useState("");

  // Pickup windows are restricted to 3 fixed times per day; admin opens
  // them in the Slots tab. Anything else gets filtered out of the picker.
  const PICKUP_SLOT_TIMES = ["16:00:00", "18:00:00", "20:00:00"] as const;

  // Slot picker state — shared loader. Pickup adds the 4/6/8 PM filter
  // via `filterTimes`; the same locked-slot bypass applies.
  const {
    slots,
    slotsLoading,
    selectedSlotId,
    setSelectedSlotId,
    slotsByDate,
    selectedSlot,
  } = useReservationSlots({
    channel: "pickup",
    lockedSlotId: invite?.lockedSlotId,
    filterTimes: PICKUP_SLOT_TIMES,
  });

  // Slot-locked invite (admin bulk invite) — show the one locked slot
  // read-only instead of the picker. Harmless when the invite isn't locked.
  const isSlotLocked = !!invite?.lockedSlotId;

  // Customer info — prefilled from invite when present. `groupSize` is
  // repurposed as "number of meals" for pickup but uses the same RPC field.
  const [customerName, setCustomerName] = useState(invite?.customerName ?? "");
  const [customerEmail, setCustomerEmail] = useState(invite?.customerEmail ?? "");
  const [customerPhone, setCustomerPhone] = useState(invite?.customerPhone ?? "");
  // Auto-derived from the cart. The RPC still needs group_size; the
  // customer doesn't type it — every item they added bumps the count.
  // Falls back to 1 when the cart is empty so the slot picker's capacity
  // check has a sane minimum on step 1 (cart is built on step 2).
  const numberOfMeals = Math.max(cartUnitCount, 1);
  const [agreedToPolicy, setAgreedToPolicy] = useState(false);
  const [crmHint, setCrmHint] = useState<string | null>(null);

  // When the customer types a valid email on the Info step, look them up
  // in crm_contacts and pre-fill name + phone if those fields are blank.
  // Fields stay fully editable — this is convenience, not a lock.
  const lookupByEmail = useCallback(async (email: string) => {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return;
    const { data } = await supabase
      .from("crm_contacts")
      .select("full_name, phone")
      .eq("email", email.trim().toLowerCase())
      .maybeSingle();
    if (!data) return;
    if (data.full_name && !customerName.trim()) {
      setCustomerName(data.full_name);
    }
    if (data.phone && !customerPhone.trim()) {
      setCustomerPhone(data.phone);
    }
    if (data.full_name || data.phone) {
      setCrmHint("We found your details — feel free to edit anything.");
      setTimeout(() => setCrmHint(null), 5000);
    }
  }, [customerName, customerPhone]);

  // QR display fallback — flips to true when /maya-qr.png 404s.
  const [qrImgError, setQrImgError] = useState(false);

  // Wizard step is owned by MenuPage (so the page layout can swap on
  // step 2 for the menu's fixed-height layout). Visible ordering:
  //   1 — Window + pickup mode + courier address (the "logistics" step)
  //   2 — Menu items (renderMenu slot from MenuPage)
  //   3 — Details + payment (sub-step "details" → "pay")
  //   4 — QR payment + senior/PWD claims + Confirm
  //   5 — Receipt (rendered outside this component by MenuPage)
  // No sub-steps — each visible step has its own stepper pill.

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

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

  // Per-step validity gates. Continue is enabled only when the current
  // step's required fields are all valid. Final submit gate (`canSubmit`)
  // re-checks everything as a defense in depth. Five visible steps:
  //   1 — Slot picked + capacity ok (meal count is 1 here until cart is
  //       built on step 2; capacity tightens once the cart fills).
  //   2 — Cart has at least one item.
  //   3 — Customer details valid.
  //   4 — Senior/PWD claims live on the cart line now; this step has no
  //        extra gate (the discount summary is informational).
  //   5 — Receipt (rendered outside the wizard).
  const cartCount = Object.values(cart).reduce((a, b) => a + b, 0);
  const step1Valid = !!selectedSlot && slotCapacityOk;
  const step2Valid = cartCount > 0 && mealsValid;
  const step3Valid = nameValid && emailValid && phoneValid &&
    (pickupMode === "personal" || courierAddress.trim().length >= 5);

  const canSubmit =
    !submitting &&
    cartUnitCount > 0 &&
    step1Valid &&
    step2Valid &&
    step3Valid;

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
    const combinedNotes = variantDetailLines.length
      ? `Variants: ${variantDetailLines.join("; ")}`.slice(0, 500)
      : null;

    const payload: Record<string, unknown> = {
      slot_id: selectedSlot.id,
      customer_name: customerName.trim(),
      customer_email: customerEmail.trim().toLowerCase(),
      customer_phone: customerPhone.trim(),
      group_size: numberOfMeals,
      notes: combinedNotes,
      pickup_mode: pickupMode === "personal" ? "personal_pickup" : "lalamove",
      ...(pickupMode === "courier" && courierAddress.trim()
        ? { courier_address: courierAddress.trim() }
        : {}),
      items: Object.entries(qtyByMenuItemId).map(
        ([menu_item_id, quantity]) => ({ menu_item_id, quantity }),
      ),
    };
    if (invite?.token) payload.invite_token = invite.token;
    const pid = new URLSearchParams(window.location.search).get("pid");
    if (pid) payload.platform_id = pid;

    const { data, error } = await (supabase.rpc as any)("create_booking", {
      payload,
    });
    if (error) {
      setSubmitting(false);
      setSubmitError(friendlyBookingError(error.message));
      return;
    }
    const result = (data ?? {}) as { reference_code?: string; booking_id?: string };
    if (!result.reference_code || !result.booking_id) {
      setSubmitting(false);
      setSubmitError(
        "Booking didn't return a reference code. Contact us in Messenger.",
      );
      return;
    }

    setSubmitting(false);
    onConfirm({
      bookingId: result.booking_id,
      referenceCode: result.reference_code,
      slot: selectedSlot,
      customerName: customerName.trim(),
      groupSize: numberOfMeals,
      pickupMode: pickupMode === "personal" ? "personal_pickup" : "lalamove",
      courierAddress: pickupMode === "courier" ? courierAddress.trim() || null : null,
      paymentReference: null,
    });
  };

  // Show the agreement screen only on the public /pick-up route (no invite).
  // Token-based pickup links already passed through BookingRules in book.$token.tsx.
  if (!invite && !agreedToPolicy) {
    return (
      <PickupAgreementScreen onAgree={() => setAgreedToPolicy(true)} />
    );
  }

  // Pickup is open to the public — no invite gate. Anyone hitting
  // /pick-up can place an order; create_booking() no longer requires
  // a token for pickup channels.

  // Step transitions scroll the next panel into view so the user lands at
  // the top of the new step instead of mid-page. Visible range is 1..4;
  // pill 5 ("Done") on the stepper is the receipt placeholder.
  const goToStep = (s: 1 | 2 | 3 | 4) => {
    setStep(s);
    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  // Step 2 (menu) needs the wider, fixed-height layout to host MenuView's
  // sticky cart bar; the other steps use the standard centered wrapper.
  const isMenuStep = step === 2;

  return (
    <div
      className={
        isMenuStep
          ? "max-w-3xl mx-auto flex-1 flex flex-col min-h-0 w-full"
          : "max-w-2xl mx-auto"
      }
    >
      <div className="flex items-center gap-2 mb-2">
        <ShoppingBag className="h-6 w-6 text-primary" />
        <h2 className="font-display text-3xl md:text-4xl">
          Confirm your pickup
        </h2>
      </div>
      <p className="text-muted-foreground mb-5">
        Step {step} of 5 — your total is{" "}
        <span className="font-semibold text-primary">
          ₱{payable.toFixed(0)}
        </span>
        .
      </p>

      <WizardStepper
        current={step}
        onJump={(n) => goToStep(n as 1 | 2 | 3 | 4)}
        steps={[
          { n: 1, label: "Date & time", done: step > 1 },
          { n: 2, label: "Menu", done: step > 2 },
          { n: 3, label: "Info", done: step > 3 },
          { n: 4, label: "Pay", done: false },
          { n: 5, label: "Done", done: false },
        ]}
      />

      {/* ============ STEP 3 — Customer information ============
          Customer contact info. Meal count is auto-derived from the cart
          (built in step 2), so it lives only on the receipt summary. */}
      {step === 3 && (
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
                  onBlur={() => lookupByEmail(customerEmail)}
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
              {crmHint && (
                <p className="sm:col-span-2 text-xs text-primary mt-1">{crmHint}</p>
              )}
            </div>
          </div>

          {/* Pickup method */}
          <div className="bg-card border border-border rounded-2xl p-5 mb-6 shadow-sm">
            <div className="flex items-center gap-2 mb-4">
              <Truck className="h-4 w-4 text-primary" />
              <h3 className="font-display text-lg font-semibold">Pickup method</h3>
            </div>
            <div className="grid grid-cols-2 gap-3 mb-4">
              <button
                type="button"
                onClick={() => setPickupMode("personal")}
                className={`flex flex-col items-center gap-2 p-4 rounded-xl border-2 text-sm font-medium transition ${
                  pickupMode === "personal"
                    ? "border-foreground bg-foreground/5"
                    : "border-border hover:border-foreground/30"
                }`}
              >
                <UserIcon className="h-5 w-5" />
                I'll pick up myself
              </button>
              <button
                type="button"
                onClick={() => setPickupMode("courier")}
                className={`flex flex-col items-center gap-2 p-4 rounded-xl border-2 text-sm font-medium transition ${
                  pickupMode === "courier"
                    ? "border-foreground bg-foreground/5"
                    : "border-border hover:border-foreground/30"
                }`}
              >
                <Truck className="h-5 w-5" />
                Send a courier
              </button>
            </div>

            {pickupMode === "courier" && (
              <div className="space-y-3">
                <div>
                  <label className="block text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                    Delivery address
                  </label>
                  <textarea
                    value={courierAddress}
                    onChange={(e) => setCourierAddress(e.target.value)}
                    placeholder="Enter the full delivery address for your courier…"
                    rows={3}
                    maxLength={300}
                    className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-foreground/10 focus:border-foreground transition resize-none"
                  />
                </div>
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-3.5">
                  <p className="text-xs text-amber-800 leading-relaxed">
                    <span className="font-semibold">Please note:</span> You are responsible for booking and paying for your own courier. Sautéo will have your order ready at the scheduled pickup window — your courier must collect it at that time.
                  </p>
                </div>
              </div>
            )}
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => goToStep(2)}
              className="inline-flex items-center justify-center gap-1.5 px-5 py-3 rounded-full bg-muted text-foreground text-sm font-semibold hover:bg-muted/70 transition"
            >
              <ChevronLeft className="h-4 w-4" />
              Back to menu
            </button>
            <button
              type="button"
              onClick={() => goToStep(4)}
              disabled={!step3Valid}
              className="flex-1 inline-flex items-center justify-center gap-2 px-6 py-3 rounded-full bg-foreground text-background font-semibold hover:opacity-90 transition disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Continue to payment
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </>
      )}

      {/* ============ STEP 1 — Date & time only ============ */}
      {step === 1 && (
        <>
          {/* Slot picker */}
          <div className="bg-card border border-border rounded-2xl p-5 mb-6 shadow-sm">
            <div className="flex items-center gap-2 mb-1">
              <CalendarClock className="h-4 w-4 text-primary" />
              <h3 className="font-display text-lg font-semibold">
                {isSlotLocked ? "Your reserved window" : "Pick your pickup window"}
              </h3>
            </div>
            <p className="text-xs text-muted-foreground mb-4">
              {isSlotLocked
                ? "Sautéo reserved this window for you — just confirm below."
                : "When you'd like the food ready."}
            </p>

            {isSlotLocked ? (
              slotsLoading ? (
                <div className="text-sm text-muted-foreground">Loading your window…</div>
              ) : selectedSlot ? (
                <div className="rounded-xl border border-foreground bg-foreground/5 p-4">
                  <div className="font-display text-lg font-semibold">
                    {new Date(selectedSlot.slot_date + "T00:00:00").toLocaleDateString(undefined, {
                      weekday: "long",
                      month: "long",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </div>
                  <div className="text-sm text-muted-foreground mt-0.5">
                    {formatSlotTime12h(selectedSlot.slot_time)}
                  </div>
                </div>
              ) : (
                <div className="text-sm text-muted-foreground bg-muted/40 border border-border rounded-lg p-3">
                  We couldn't load your reserved window — reply on Messenger and we'll help you out.
                </div>
              )
            ) : slotsLoading ? (
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
                That window only has {selectedSlot.capacity - selectedSlot.seats_taken} meal{selectedSlot.capacity - selectedSlot.seats_taken === 1 ? "" : "s"} left — order fewer items or pick another window.
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={() => goToStep(2)}
            disabled={!step1Valid}
            className="w-full inline-flex items-center justify-center gap-2 px-6 py-4 rounded-full bg-primary text-primary-foreground font-medium hover:opacity-90 transition disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Continue to menu
            <ChevronRight className="h-4 w-4" />
          </button>
        </>
      )}

      {/* ============ STEP 2 — Menu items ============
          Renders MenuView inside the wizard via the renderMenu slot wired
          up by MenuPage. "Checkout" advances to step 3. */}
      {step === 2 && (
        <div className="flex-1 flex flex-col min-h-0 -mx-4 sm:-mx-6">
          {renderMenu()}
        </div>
      )}

      {step === 2 && (
        <div className="flex items-center gap-3 mb-8 mt-3">
          <button
            type="button"
            onClick={() => goToStep(1)}
            className="inline-flex items-center justify-center gap-1.5 px-5 py-3 rounded-full bg-muted text-foreground text-sm font-semibold hover:bg-muted/70 transition"
          >
            <ChevronLeft className="h-4 w-4" />
            Back to window
          </button>
          {!step2Valid && (
            <p className="text-xs text-muted-foreground italic">
              Add at least one item to continue.
            </p>
          )}
        </div>
      )}

      {/* ============ STEP 4 — Discount + Payment + Confirm ============ */}
      {step === 4 && (
        <>
          {/* Order summary — discount attribution now lives on the cart
              lines (variant modal at item-add time), so this card is a
              quiet recap. */}
          <div className="bg-card border border-border rounded-2xl p-5 mb-6 shadow-sm">
            <div className="flex items-center gap-2 mb-3">
              <Sparkles className="h-4 w-4 text-primary shrink-0" />
              <h3 className="font-display text-lg font-semibold">Order summary</h3>
            </div>
            <DiscountBreakdown summary={discountSummary} variant="wizard" />
            <p className="text-[11px] text-muted-foreground pt-2 leading-relaxed">
              {hasDiscount
                ? "Discount applied to each qualifying line at the cart. To claim another ID, go back and add the item again under Senior / PWD."
                : `Eligible for a Senior / PWD discount? Go back to the menu, tap your item, and pick Senior or PWD before adding to receive ${Math.round(SENIOR_PWD_DISCOUNT_RATE * 100)}% off that line.`}
            </p>
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
                    <span className="font-mono text-cream">09953645517</span>
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
                        src="/maya-qr.jpg"
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
            {hasDiscount &&
              " Please bring the uploaded ID(s) with you on pickup — if they aren't presented, the discount will be voided."}
          </p>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => goToStep(3)}
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
  // Fields only appear once the AI has finished (filled/off/failed) —
  // before that the card shows only the photo upload section.
  const showFields = autoFill.state !== "idle" && autoFill.state !== "loading";
  const hasInteracted = showFields;
  const errorRing = "border-destructive/60 focus:border-destructive focus:ring-destructive/20";

  // ── Back-side photo ──────────────────────────────────────────────────────
  // State lives here (not in the parent) because the back photo is only
  // needed for field-merging; the parent never stores it.
  const [backPhotoFile, setBackPhotoFile] = useState<File | null>(null);
  const [backPhotoUrl, setBackPhotoUrl] = useState<string | null>(null);
  const [backAutoFill, setBackAutoFill] = useState<AutoFillStatus>({ state: "idle" });
  const backExtractAbort = useRef<AbortController | null>(null);
  // Always read the latest claimant values when merging — the async AI call
  // takes ~2 s so `claimant` prop could drift if the user edits a field.
  const claimantRef = useRef(claimant);
  useEffect(() => { claimantRef.current = claimant; }, [claimant]);
  // Abort any in-flight back-side AI call on unmount.
  useEffect(() => () => { backExtractAbort.current?.abort(); }, []);

  const backFileInputId = `claimant-${index}-back-photo`;

  const onBackPhotoChange = (file: File | null) => {
    setBackPhotoUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return file ? URL.createObjectURL(file) : null;
    });
    setBackPhotoFile(file);
    // Bubble the File reference to the parent so the submit code can upload it.
    onChange({ idBackPhotoFile: file });
    backExtractAbort.current?.abort();
    if (!file) { setBackAutoFill({ state: "idle" }); return; }
    const ac = new AbortController();
    backExtractAbort.current = ac;
    setBackAutoFill({ state: "loading" });
    (async () => {
      let result: ExtractIdResult;
      try {
        result = await extractIdFromPhoto(file, ac.signal);
      } catch (e) {
        if ((e as DOMException)?.name === "AbortError") return;
        setBackAutoFill({ state: "failed" });
        return;
      }
      if (ac.signal.aborted) return;
      if (!result.available) { setBackAutoFill({ state: "off" }); return; }
      // Merge: only fill fields that the front scan left empty.
      const cur = claimantRef.current;
      onChange({
        fullName:    cur.fullName.trim()    ? cur.fullName    : result.full_name,
        idNumber:    cur.idNumber.trim()    ? cur.idNumber    : result.id_number,
        address:     cur.address.trim()     ? cur.address     : result.address,
        dateOfBirth: cur.dateOfBirth.trim() ? cur.dateOfBirth : result.date_of_birth,
        age:         cur.age.trim()         ? cur.age         : result.age,
        sex:         cur.sex.trim()         ? cur.sex         : result.sex,
        dateOfIssue: cur.dateOfIssue.trim() ? cur.dateOfIssue : result.date_of_issue,
      });
      setBackAutoFill({ state: "filled", confidence: result.confidence });
    })();
  };

  // Only prompt for back side when AI read the front successfully but some
  // required fields are still empty (data is on the back of the card).
  const showBackSidePrompt =
    showFields &&
    autoFill.state === "filled" &&
    (nameMissing || ageMissing || dobMissing || issuedMissing) &&
    backAutoFill.state === "idle";

  return (
    <div className="border border-border rounded-xl p-4 bg-background space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="h-7 w-7 rounded-full bg-muted flex items-center justify-center text-xs font-semibold tabular-nums">
            {index + 1}
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

      {/* Photo upload — always the first thing visible in the card.
          The AI pipeline starts the moment a photo is selected. */}
      <div>
        <label className="block text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
          ID photo
        </label>
        <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
          {/* "Take photo" — opens the phone's native camera on mobile. */}
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
          {/* "Upload" — picks an existing photo from gallery / disk. */}
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

        {/* AI status — spinner while reading, confirm/error after */}
        {autoFill.state === "loading" && (
          <div className="mt-2 inline-flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Reading ID — this takes a couple of seconds…
          </div>
        )}
        {autoFill.state === "filled" && (
          <div className="mt-2 inline-flex items-center gap-2 text-xs text-primary">
            <Sparkles className="h-3.5 w-3.5" />
            Auto-filled from your ID — please double-check the fields below.
            {autoFill.confidence > 0 && (
              <span className="text-muted-foreground">
                ({Math.round(autoFill.confidence * 100)}% confidence)
              </span>
            )}
          </div>
        )}
        {autoFill.state === "off" && (
          <div className="mt-2 inline-flex items-center gap-2 text-xs text-muted-foreground">
            <AlertTriangle className="h-3.5 w-3.5" />
            Auto-scan is not available — please type the details below manually.
          </div>
        )}
        {autoFill.state === "failed" && (
          <div className="mt-2 inline-flex items-center gap-2 text-xs text-muted-foreground">
            <AlertTriangle className="h-3.5 w-3.5" />
            Couldn't read the ID — please type the fields manually.
          </div>
        )}
      </div>

      {/* Form fields — only appear after AI finishes (filled / off / failed).
          While AI is loading the card intentionally stays compact. */}
      {showFields && (
        <>
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

        {/* ── Back-side prompt ─────────────────────────────────────────────
            Appears only when AI read the front but fields are still empty.
            Stays hidden if everything filled, or if AI wasn't available. */}
        {showBackSidePrompt && (
          <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-3 space-y-2">
            <p className="text-xs font-medium text-amber-800">
              Some details weren't found on the front. Add the back of your ID to fill them in automatically.
            </p>
            <div className="flex items-center gap-2 flex-wrap">
              <label
                htmlFor={`${backFileInputId}-camera`}
                className="inline-flex items-center gap-2 cursor-pointer text-xs font-semibold bg-foreground text-background hover:opacity-90 rounded-full px-3 py-2 transition"
              >
                <Camera className="h-3.5 w-3.5" />
                Take back
              </label>
              <input
                id={`${backFileInputId}-camera`}
                type="file"
                accept="image/*"
                capture="environment"
                onChange={(e) => onBackPhotoChange(e.target.files?.[0] ?? null)}
                className="hidden"
              />
              <label
                htmlFor={backFileInputId}
                className="inline-flex items-center gap-2 cursor-pointer text-xs font-semibold bg-muted hover:bg-muted/70 rounded-full px-3 py-2 transition"
              >
                <Upload className="h-3.5 w-3.5" />
                Upload back
              </label>
              <input
                id={backFileInputId}
                type="file"
                accept="image/*"
                onChange={(e) => onBackPhotoChange(e.target.files?.[0] ?? null)}
                className="hidden"
              />
            </div>
          </div>
        )}

        {/* Back-side photo preview + AI status */}
        {backPhotoFile && (
          <div className="flex items-start gap-3">
            {backPhotoUrl && (
              <div className="relative h-12 w-12 rounded-lg overflow-hidden border border-border shrink-0">
                <img src={backPhotoUrl} alt="ID back" className="h-full w-full object-cover" />
              </div>
            )}
            <div className="flex-1 min-w-0 space-y-1">
              <p className="text-xs text-muted-foreground truncate">{backPhotoFile.name}</p>
              {backAutoFill.state === "loading" && (
                <div className="inline-flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Reading back of ID…
                </div>
              )}
              {backAutoFill.state === "filled" && (
                <div className="inline-flex items-center gap-2 text-xs text-primary">
                  <Sparkles className="h-3.5 w-3.5" />
                  Back filled — missing fields updated above.
                  {backAutoFill.confidence > 0 && (
                    <span className="text-muted-foreground">
                      ({Math.round(backAutoFill.confidence * 100)}%)
                    </span>
                  )}
                </div>
              )}
              {(backAutoFill.state === "failed" || backAutoFill.state === "off") && (
                <div className="inline-flex items-center gap-2 text-xs text-muted-foreground">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  Couldn't read back — fill remaining fields manually.
                </div>
              )}
              <button
                type="button"
                onClick={() => onBackPhotoChange(null)}
                className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground transition"
              >
                Remove
              </button>
            </div>
          </div>
        )}
        </>
      )}
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
        {/* Closes out the 4-step booking flow: Slot → Menu → Pay → Done. */}
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-primary/10 text-primary text-[10px] font-semibold uppercase tracking-wider mb-3">
          <CheckCircle2 className="h-3 w-3" />
          Step 4 of 4 — Confirmed
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
              Itemized senior / PWD discounts
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

      {/* Payment reminder — sits outside the receipt card so it doesn't end
          up on the printed copy. Tells the guest the final step they need to
          take (send proof to Messenger) so the Sautéo team can verify and
          confirm the order in the admin Orders dashboard. */}
      <div className="bg-mustard/20 border border-mustard/40 rounded-2xl p-5 md:p-6 mb-6 text-center print:hidden">
        <p className="text-sm md:text-base text-foreground leading-relaxed mb-4">
          <span className="font-semibold">
            Please send your Proof of Payment to Messenger
          </span>{" "}
          so the Sautéo team can confirm your order. Include the reference
          code{" "}
          <span className="font-mono text-primary font-semibold">
            {receipt.ref}
          </span>{" "}
          when you message us.
        </p>
        <a
          href={MESSENGER_URL}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center justify-center gap-2 rounded-full bg-primary text-primary-foreground px-5 py-2.5 text-sm font-semibold hover:opacity-90 transition"
        >
          <MessageCircle className="h-4 w-4" />
          Chat on Messenger
        </a>
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
