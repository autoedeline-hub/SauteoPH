// Senior / PWD discount math.
//
// TEMPORARY implementation per owner: a flat 12% discount that doubles as
// the "VAT-exempt" label on the receipt. RA 9994 actually mandates 20% +
// VAT-exempt; we'll revisit once pricing-model (VAT-inclusive vs net) is
// confirmed and split out the SC vs PWD bundles. For now, both claim types
// route through this same rate.

export const SENIOR_PWD_DISCOUNT_RATE = 0.12;

export type ClaimantKind = "senior" | "pwd";

export type Claimant = {
  kind: ClaimantKind;
  fullName: string;
  idNumber: string;
  address: string;
  // Captured straight from the ID (auto-fill when available; admin verifies
  // visually against the photo). Empty strings when the OCR couldn't read
  // the field or the user hasn't filled it manually yet. Date strings are
  // stored as-printed on the card (PH IDs use mixed MM/DD/YYYY and other
  // formats — we don't normalize so admins read what's actually on the card).
  dateOfBirth: string;
  age: string;
  sex: string;
  dateOfIssue: string;
  // Object URL of the uploaded photo. The File itself is held alongside in
  // PaymentView state — this string is only for previewing.
  idPhotoUrl: string | null;
  // Original File reference, kept so we can upload it server-side once the
  // booking persistence flow is wired.
  idPhotoFile: File | null;
};

export function makeBlankClaimant(kind: ClaimantKind = "senior"): Claimant {
  return {
    kind,
    fullName: "",
    idNumber: "",
    address: "",
    dateOfBirth: "",
    age: "",
    sex: "",
    dateOfIssue: "",
    idPhotoUrl: null,
    idPhotoFile: null,
  };
}

// A "unit" is one qty of one cart line. A line with qty=3 expands to three
// units. The N highest-priced units across the cart are the ones that get
// the discount applied (one unit per claimant). Same item can occupy more
// than one slot.
export type CartUnit = {
  key: string;            // unique per-unit id ("<cartKey>#<n>")
  cartKey: string;        // the original cart key (id or id::variantIndex)
  itemId: string;
  variantIndex: number | null;
  displayName: string;    // e.g. "Burger Set" or "Burger Set — Coke Zero"
  unitPrice: number;
};

export type DiscountedUnit = {
  unit: CartUnit;
  claimantIndex: number;  // 0-based pointer back into the claimants array
  discountAmount: number; // peso amount off this single unit
  discountedPrice: number;
};

export type DiscountSummary = {
  gross: number;          // sum of all units at sticker price
  discount: number;       // total peso amount discounted
  net: number;            // gross - discount
  discountedUnits: DiscountedUnit[];
  // The cap: you cannot discount more units than the cart contains, even
  // if more claimants are uploaded. This number is min(units, claimants).
  effectiveClaimants: number;
};

// Picks one unit per claimant, biased toward the highest-priced unit so the
// guest sees the biggest legal saving. We sort by unitPrice desc, then take
// the first `claimants` entries.
export function pickDiscountedUnits(
  units: CartUnit[],
  claimants: number,
): CartUnit[] {
  if (claimants <= 0 || units.length === 0) return [];
  const sorted = [...units].sort((a, b) => b.unitPrice - a.unitPrice);
  return sorted.slice(0, claimants);
}

export function summarizeDiscount(
  units: CartUnit[],
  claimants: number,
  rate: number = SENIOR_PWD_DISCOUNT_RATE,
): DiscountSummary {
  const gross = units.reduce((s, u) => s + u.unitPrice, 0);
  const picked = pickDiscountedUnits(units, claimants);
  const pickedKeys = new Set(picked.map((u) => u.key));

  let discount = 0;
  const discountedUnits: DiscountedUnit[] = [];
  let claimantIndex = 0;
  for (const u of units) {
    if (!pickedKeys.has(u.key)) continue;
    const d = u.unitPrice * rate;
    discount += d;
    discountedUnits.push({
      unit: u,
      claimantIndex,
      discountAmount: d,
      discountedPrice: u.unitPrice - d,
    });
    claimantIndex += 1;
    if (claimantIndex >= claimants) break;
  }

  return {
    gross,
    discount,
    net: gross - discount,
    discountedUnits,
    effectiveClaimants: discountedUnits.length,
  };
}
