// Senior / PWD discount math.
//
// Per RA 9994 (Senior Citizens Act) and RA 10754 (PWD Act): 20% discount
// and VAT exemption on the senior's / PWD's own consumed portion. We treat
// "VAT exempt" as already baked into menu prices today, so the on-screen
// discount is the full 20% off; the receipt still surfaces the "VAT-exempt"
// label as required by BIR.
//
// Attribution model (new in 2026-05): each cart line is either anonymous
// (full price) or carries an attached `Claimant` keyed by its cart key.
// One ID = one unit (strict). A senior who wants 2 burgers discounted has
// to upload 2 IDs, which produces 2 distinct claimed cart lines.

export const SENIOR_PWD_DISCOUNT_RATE = 0.2;

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
  // Original File references for front and back of the ID card.
  idPhotoFile: File | null;
  idBackPhotoFile: File | null;
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
    idBackPhotoFile: null,
  };
}

// A "unit" is one qty of one cart line. A line with qty=3 expands to three
// units. With per-line claim attribution, claimed lines are always qty=1
// (one ID = one unit), so each claimed cart key contributes exactly one
// claimed unit.
export type CartUnit = {
  key: string;            // unique per-unit id ("<cartKey>#<n>")
  cartKey: string;        // the original cart key (id or id::variantIndex or …::claim:<id>)
  itemId: string;
  variantIndex: number | null;
  displayName: string;    // e.g. "Burger Set" or "Burger Set — Coke Zero"
  unitPrice: number;
};

export type DiscountedUnit = {
  unit: CartUnit;
  claimantIndex: number;  // position in iteration order — only used for receipt labelling
  discountAmount: number; // peso amount off this single unit
  discountedPrice: number;
};

export type DiscountSummary = {
  gross: number;          // sum of all units at sticker price
  discount: number;       // total peso amount discounted
  net: number;            // gross - discount
  discountedUnits: DiscountedUnit[];
  // Count of units actually discounted — equal to the number of claim
  // entries with a matching cart line. Kept for receipt copy ("Discount × N").
  effectiveClaimants: number;
};

// cartKey → Claimant. Keyed by the *full* cart key (including the
// `::claim:<shortId>` suffix that distinguishes claimed lines from anonymous
// ones), so a lookup is O(1) per unit.
export type ClaimsByCartKey = Record<string, Claimant>;

export function summarizeDiscount(
  units: CartUnit[],
  claimsByCartKey: ClaimsByCartKey,
  rate: number = SENIOR_PWD_DISCOUNT_RATE,
): DiscountSummary {
  const gross = units.reduce((s, u) => s + u.unitPrice, 0);

  let discount = 0;
  let claimantIndex = 0;
  const discountedUnits: DiscountedUnit[] = [];
  for (const u of units) {
    if (!claimsByCartKey[u.cartKey]) continue;
    const d = u.unitPrice * rate;
    discount += d;
    discountedUnits.push({
      unit: u,
      claimantIndex,
      discountAmount: d,
      discountedPrice: u.unitPrice - d,
    });
    claimantIndex += 1;
  }

  return {
    gross,
    discount,
    net: gross - discount,
    discountedUnits,
    effectiveClaimants: discountedUnits.length,
  };
}
