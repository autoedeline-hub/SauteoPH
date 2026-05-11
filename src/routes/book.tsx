import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Header } from "@/components/Header";
import { Check, ChevronLeft, ChevronRight, Minus, Plus, Upload, CheckCircle2 } from "lucide-react";
import { format, addDays, startOfDay, isBefore } from "date-fns";

export const Route = createFileRoute("/book")({
  component: BookPage,
  head: () => ({
    meta: [
      { title: "Book a Table — Sautéo" },
      { name: "description", content: "Pick a date, build your meal, and pay to confirm." },
    ],
  }),
});

type Slot = { id: string; slot_date: string; slot_time: string; capacity: number; seats_taken: number; is_open: boolean };
type Category = { id: string; name: string; slug: string; sort_order: number };
type MenuItem = { id: string; category_id: string; name: string; description: string | null; price: number; image_url: string | null; active: boolean };
type Cart = Record<string, number>; // menu_item_id -> qty

const STEPS = ["Date & Time", "Menu", "Your Details", "Payment", "Confirmation"];

const COUNTRY_CODES = [
  { code: "+63", label: "🇵🇭 PH" },
  { code: "+1", label: "🇺🇸 US" },
  { code: "+44", label: "🇬🇧 UK" },
  { code: "+61", label: "🇦🇺 AU" },
  { code: "+65", label: "🇸🇬 SG" },
  { code: "+852", label: "🇭🇰 HK" },
];

function BookPage() {
  const [step, setStep] = useState(0);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [items, setItems] = useState<MenuItem[]>([]);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [cart, setCart] = useState<Cart>({});
  const [details, setDetails] = useState({
    name: "", email: "", phone: "", countryCode: "+63",
    facebook: "", instagram: "", groupSize: 2,
  });
  const [payment, setPayment] = useState({ reference: "", file: null as File | null });
  const [submitting, setSubmitting] = useState(false);
  const [confirmation, setConfirmation] = useState<{ refCode: string; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const today = format(new Date(), "yyyy-MM-dd");
      const [{ data: s }, { data: c }, { data: i }] = await Promise.all([
        supabase.from("time_slots").select("*").gte("slot_date", today).order("slot_date").order("slot_time"),
        supabase.from("menu_categories").select("*").order("sort_order"),
        supabase.from("menu_items").select("*").eq("active", true).order("sort_order"),
      ]);
      setSlots((s ?? []) as Slot[]);
      setCategories((c ?? []) as Category[]);
      setItems(((i ?? []) as MenuItem[]).map(it => ({ ...it, price: Number(it.price) })));
      if (c && c.length) setActiveCategory(c[0].id);
    })();
  }, []);

  const next30Days = useMemo(() => Array.from({ length: 30 }, (_, k) => addDays(startOfDay(new Date()), k)), []);
  const slotsByDate = useMemo(() => {
    const m: Record<string, Slot[]> = {};
    slots.forEach(s => { (m[s.slot_date] ||= []).push(s); });
    return m;
  }, [slots]);

  const total = useMemo(() => Object.entries(cart).reduce((sum, [id, qty]) => {
    const it = items.find(x => x.id === id);
    return sum + (it ? it.price * qty : 0);
  }, 0), [cart, items]);

  const cartCount = Object.values(cart).reduce((a, b) => a + b, 0);
  const selectedSlot = slots.find(s => s.id === selectedSlotId) || null;

  const canNext = () => {
    if (step === 0) return !!selectedSlotId;
    if (step === 1) return cartCount > 0;
    if (step === 2) return details.name && details.email && details.phone && details.groupSize >= 1;
    if (step === 3) return !!(payment.reference || payment.file);
    return true;
  };

  const submitBooking = async () => {
    if (!selectedSlotId) return;
    setSubmitting(true); setError(null);
    try {
      // Reserve seats atomically
      const { data: reserved, error: rerr } = await supabase.rpc("reserve_seats", { _slot_id: selectedSlotId, _seats: details.groupSize });
      if (rerr) throw rerr;
      if (!reserved) throw new Error("That slot just filled up. Please pick another.");

      const { data: booking, error: berr } = await supabase.from("bookings").insert({
        slot_id: selectedSlotId,
        customer_name: details.name,
        customer_email: details.email,
        customer_phone: `${details.countryCode} ${details.phone}`,
        facebook_handle: details.facebook || null,
        instagram_handle: details.instagram || null,
        group_size: details.groupSize,
        total_amount: total,
        status: "pending",
      }).select().single();
      if (berr) throw berr;

      const lineItems = Object.entries(cart).map(([id, qty]) => {
        const it = items.find(x => x.id === id)!;
        return { booking_id: booking.id, menu_item_id: id, item_name: it.name, unit_price: it.price, quantity: qty };
      });
      const { error: ierr } = await supabase.from("booking_items").insert(lineItems);
      if (ierr) throw ierr;

      let screenshotUrl: string | null = null;
      if (payment.file) {
        const path = `${booking.id}/${Date.now()}-${payment.file.name}`;
        const { error: upErr } = await supabase.storage.from("payment-proofs").upload(path, payment.file);
        if (!upErr) {
          const { data: pub } = supabase.storage.from("payment-proofs").getPublicUrl(path);
          screenshotUrl = pub.publicUrl;
        }
      }

      const { error: perr } = await supabase.from("payments").insert({
        booking_id: booking.id,
        reference_number: payment.reference || null,
        screenshot_url: screenshotUrl,
        status: "submitted",
      });
      if (perr) throw perr;

      setConfirmation({ refCode: booking.reference_code, total });
      setStep(4);
    } catch (e: any) {
      setError(e.message || "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1 max-w-5xl mx-auto w-full px-4 sm:px-6 py-8 md:py-12">
        {/* Progress */}
        <div className="mb-10">
          <div className="flex items-center gap-2 sm:gap-3 overflow-x-auto pb-2">
            {STEPS.map((label, i) => (
              <div key={label} className="flex items-center gap-2 sm:gap-3 shrink-0">
                <div className={`h-8 w-8 rounded-full flex items-center justify-center text-sm font-medium transition ${
                  i < step ? "bg-primary text-primary-foreground" :
                  i === step ? "bg-foreground text-background" :
                  "bg-muted text-muted-foreground"
                }`}>
                  {i < step ? <Check className="h-4 w-4" /> : i + 1}
                </div>
                <span className={`text-xs sm:text-sm ${i === step ? "font-medium text-foreground" : "text-muted-foreground"}`}>{label}</span>
                {i < STEPS.length - 1 && <div className="h-px w-4 sm:w-8 bg-border" />}
              </div>
            ))}
          </div>
        </div>

        {error && <div className="mb-6 rounded-xl bg-destructive/10 text-destructive px-4 py-3 text-sm">{error}</div>}

        {step === 0 && (
          <Step1
            days={next30Days}
            slotsByDate={slotsByDate}
            selectedDate={selectedDate}
            selectedSlotId={selectedSlotId}
            setSelectedDate={setSelectedDate}
            setSelectedSlotId={setSelectedSlotId}
          />
        )}
        {step === 1 && (
          <Step2
            categories={categories}
            items={items}
            activeCategory={activeCategory}
            setActiveCategory={setActiveCategory}
            cart={cart}
            setCart={setCart}
            total={total}
          />
        )}
        {step === 2 && <Step3 details={details} setDetails={setDetails} />}
        {step === 3 && <Step4 payment={payment} setPayment={setPayment} total={total} />}
        {step === 4 && confirmation && selectedSlot && (
          <Step5 confirmation={confirmation} slot={selectedSlot} details={details} />
        )}

        {/* Nav */}
        {step < 4 && (
          <div className="mt-10 flex items-center justify-between">
            <button
              onClick={() => setStep(s => Math.max(0, s - 1))}
              disabled={step === 0}
              className="inline-flex items-center gap-1 px-4 py-2 rounded-full text-sm text-muted-foreground hover:text-foreground disabled:opacity-30"
            >
              <ChevronLeft className="h-4 w-4" /> Back
            </button>
            {step < 3 ? (
              <button
                onClick={() => setStep(s => s + 1)}
                disabled={!canNext()}
                className="inline-flex items-center gap-1 px-6 py-3 rounded-full bg-primary text-primary-foreground font-medium disabled:opacity-40 hover:opacity-90 transition"
              >
                Continue <ChevronRight className="h-4 w-4" />
              </button>
            ) : (
              <button
                onClick={submitBooking}
                disabled={!canNext() || submitting}
                className="inline-flex items-center gap-1 px-6 py-3 rounded-full bg-primary text-primary-foreground font-medium disabled:opacity-40 hover:opacity-90 transition"
              >
                {submitting ? "Submitting…" : "Submit Booking"}
              </button>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

/* ============ Step 1 ============ */
function Step1({ days, slotsByDate, selectedDate, selectedSlotId, setSelectedDate, setSelectedSlotId }: any) {
  return (
    <div>
      <h2 className="font-display text-3xl mb-2">Pick a date & time</h2>
      <p className="text-muted-foreground mb-6">We're open Wednesday through Sunday. Each seating runs 90 minutes.</p>

      <div className="grid grid-cols-7 gap-2 mb-8">
        {["S","M","T","W","T","F","S"].map((d, i) => <div key={i} className="text-center text-xs text-muted-foreground py-2">{d}</div>)}
        {days.map((d: Date) => {
          const dateStr = format(d, "yyyy-MM-dd");
          const dow = d.getDay();
          const isOpen = [3,4,5,6,0].includes(dow);
          const hasSlots = !!slotsByDate[dateStr];
          const past = isBefore(d, startOfDay(new Date()));
          const disabled = !isOpen || !hasSlots || past;
          const isSelected = selectedDate === dateStr;
          return (
            <button
              key={dateStr}
              disabled={disabled}
              onClick={() => { setSelectedDate(dateStr); setSelectedSlotId(null); }}
              className={`aspect-square rounded-xl flex flex-col items-center justify-center text-sm transition ${
                disabled ? "bg-muted/40 text-muted-foreground/40 cursor-not-allowed" :
                isSelected ? "bg-primary text-primary-foreground" :
                "bg-card hover:bg-accent border border-border"
              }`}
            >
              <span className="text-[10px] uppercase">{format(d, "MMM")}</span>
              <span className="text-lg font-medium">{format(d, "d")}</span>
            </button>
          );
        })}
      </div>

      {selectedDate && (
        <div>
          <h3 className="font-display text-xl mb-3">Available times — {format(new Date(selectedDate), "EEEE, MMM d")}</h3>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            {(slotsByDate[selectedDate] ?? []).map((s: Slot) => {
              const seatsLeft = s.capacity - s.seats_taken;
              const full = !s.is_open || seatsLeft <= 0;
              const isSel = selectedSlotId === s.id;
              return (
                <button
                  key={s.id}
                  disabled={full}
                  onClick={() => setSelectedSlotId(s.id)}
                  className={`p-4 rounded-xl text-left transition ${
                    full ? "bg-muted/40 text-muted-foreground/50 cursor-not-allowed" :
                    isSel ? "bg-primary text-primary-foreground" :
                    "bg-card border border-border hover:border-primary"
                  }`}
                >
                  <div className="font-medium">{s.slot_time.slice(0,5)}</div>
                  <div className="text-xs opacity-80 mt-1">{full ? "Full" : `${seatsLeft} seats left`}</div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/* ============ Step 2 ============ */
function Step2({ categories, items, activeCategory, setActiveCategory, cart, setCart, total }: any) {
  const filtered = items.filter((i: MenuItem) => i.category_id === activeCategory);
  const update = (id: string, delta: number) => {
    setCart((prev: Cart) => {
      const q = (prev[id] || 0) + delta;
      const next = { ...prev };
      if (q <= 0) delete next[id]; else next[id] = q;
      return next;
    });
  };
  return (
    <div className="grid lg:grid-cols-[1fr_320px] gap-8">
      <div>
        <h2 className="font-display text-3xl mb-2">Build your meal</h2>
        <p className="text-muted-foreground mb-6">Pre-order what you'll eat — we'll have it ready when you arrive.</p>

        <div className="flex gap-2 mb-6 overflow-x-auto pb-2">
          {categories.map((c: Category) => (
            <button
              key={c.id}
              onClick={() => setActiveCategory(c.id)}
              className={`px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition ${
                activeCategory === c.id ? "bg-foreground text-background" : "bg-muted text-muted-foreground hover:bg-muted/70"
              }`}
            >{c.name}</button>
          ))}
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          {filtered.map((it: MenuItem) => {
            const qty = cart[it.id] || 0;
            return (
              <div key={it.id} className="bg-card rounded-2xl border border-border overflow-hidden flex flex-col">
                {it.image_url && (
                  <img src={it.image_url} alt={it.name} loading="lazy" className="w-full aspect-[4/3] object-cover" />
                )}
                <div className="p-4 flex flex-col flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-display text-lg">{it.name}</h3>
                    <span className="font-medium text-primary">₱{it.price.toFixed(0)}</span>
                  </div>
                  <p className="text-sm text-muted-foreground mt-1 mb-4 flex-1">{it.description}</p>
                  <div className="flex items-center justify-between">
                    {qty === 0 ? (
                      <button onClick={() => update(it.id, 1)} className="px-4 py-2 rounded-full bg-primary text-primary-foreground text-sm font-medium hover:opacity-90">Add</button>
                    ) : (
                      <div className="flex items-center gap-3">
                        <button onClick={() => update(it.id, -1)} className="h-8 w-8 rounded-full bg-muted flex items-center justify-center hover:bg-muted/70"><Minus className="h-4 w-4" /></button>
                        <span className="font-medium w-6 text-center">{qty}</span>
                        <button onClick={() => update(it.id, 1)} className="h-8 w-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center hover:opacity-90"><Plus className="h-4 w-4" /></button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Sticky cart */}
      <aside className="lg:sticky lg:top-24 h-fit bg-card border border-border rounded-2xl p-5">
        <h3 className="font-display text-xl mb-3">Your order</h3>
        {Object.keys(cart).length === 0 ? (
          <p className="text-sm text-muted-foreground">No items yet — add a few dishes.</p>
        ) : (
          <ul className="space-y-2 mb-4">
            {Object.entries(cart).map(([id, qty]) => {
              const it = items.find((x: MenuItem) => x.id === id);
              if (!it) return null;
              return (
                <li key={id} className="flex justify-between text-sm">
                  <span>{qty}× {it.name}</span>
                  <span className="text-muted-foreground">₱{(it.price * (qty as number)).toFixed(0)}</span>
                </li>
              );
            })}
          </ul>
        )}
        <div className="border-t border-border pt-3 flex justify-between font-medium">
          <span>Total</span>
          <span className="text-primary text-lg">₱{total.toFixed(0)}</span>
        </div>
      </aside>
    </div>
  );
}

/* ============ Step 3 ============ */
function Step3({ details, setDetails }: any) {
  const update = (k: string, v: any) => setDetails((d: any) => ({ ...d, [k]: v }));
  return (
    <div className="max-w-2xl">
      <h2 className="font-display text-3xl mb-2">Your details</h2>
      <p className="text-muted-foreground mb-6">We'll use these to confirm your booking.</p>
      <div className="space-y-4">
        <Field label="Full name *"><input className="input" value={details.name} onChange={e => update("name", e.target.value)} /></Field>
        <Field label="Email *"><input type="email" className="input" value={details.email} onChange={e => update("email", e.target.value)} /></Field>
        <Field label="Phone *">
          <div className="flex gap-2">
            <select className="input w-28" value={details.countryCode} onChange={e => update("countryCode", e.target.value)}>
              {COUNTRY_CODES.map(c => <option key={c.code} value={c.code}>{c.label} {c.code}</option>)}
            </select>
            <input className="input flex-1" value={details.phone} onChange={e => update("phone", e.target.value)} placeholder="9XX XXX XXXX" />
          </div>
        </Field>
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Facebook handle"><input className="input" value={details.facebook} onChange={e => update("facebook", e.target.value)} placeholder="@yourname" /></Field>
          <Field label="Instagram handle"><input className="input" value={details.instagram} onChange={e => update("instagram", e.target.value)} placeholder="@yourname" /></Field>
        </div>
        <Field label="Group size *">
          <input type="number" min={1} max={10} className="input w-32" value={details.groupSize} onChange={e => update("groupSize", parseInt(e.target.value) || 1)} />
        </Field>
        {details.groupSize >= 5 && (
          <div className="rounded-xl bg-mustard/30 text-charcoal px-4 py-3 text-sm">
            Heads up — groups of 5 or more require manual approval. We'll DM you to confirm.
          </div>
        )}
      </div>
      <style>{`.input { width:100%; background:var(--card); border:1px solid var(--border); border-radius:12px; padding:12px 14px; font-size:14px; outline:none; transition:border-color .15s; } .input:focus{border-color:var(--primary)}`}</style>
    </div>
  );
}

function Field({ label, children }: any) {
  return <label className="block"><span className="block text-sm font-medium mb-1.5">{label}</span>{children}</label>;
}

/* ============ Step 4 ============ */
function Step4({ payment, setPayment, total }: any) {
  return (
    <div className="max-w-2xl">
      <h2 className="font-display text-3xl mb-2">Payment</h2>
      <p className="text-muted-foreground mb-6">Pay <span className="font-semibold text-primary">₱{total.toFixed(0)}</span> via Maya / InstaPay, then upload proof or enter the reference number below.</p>

      <div className="bg-charcoal text-cream rounded-2xl p-6 mb-6">
        <div className="text-mustard text-xs uppercase tracking-wider mb-2">Send payment to</div>
        <div className="font-display text-2xl mb-1">Sautéo Kitchen</div>
        <div className="text-cream/80 text-sm space-y-1">
          <div>Maya / InstaPay: <span className="font-mono text-mustard">+63 917 555 0123</span></div>
          <div>Account name: Sautéo Kitchen Co.</div>
          <div className="pt-2 text-cream/60">Amount: <span className="text-cream font-semibold">₱{total.toFixed(0)}</span></div>
        </div>
      </div>

      <div className="space-y-4">
        <Field label="Payment reference number">
          <input className="input" value={payment.reference} onChange={e => setPayment({ ...payment, reference: e.target.value })} placeholder="e.g. ABC123XYZ" />
        </Field>
        <div className="text-center text-xs text-muted-foreground">— or —</div>
        <Field label="Upload payment screenshot">
          <label className="flex items-center gap-3 px-4 py-6 rounded-xl border-2 border-dashed border-border hover:border-primary cursor-pointer transition">
            <Upload className="h-5 w-5 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">{payment.file ? payment.file.name : "Click to upload (PNG / JPG)"}</span>
            <input type="file" accept="image/*" className="hidden" onChange={e => setPayment({ ...payment, file: e.target.files?.[0] || null })} />
          </label>
        </Field>
      </div>
      <style>{`.input { width:100%; background:var(--card); border:1px solid var(--border); border-radius:12px; padding:12px 14px; font-size:14px; outline:none; }`}</style>
    </div>
  );
}

/* ============ Step 5 ============ */
function Step5({ confirmation, slot, details }: any) {
  return (
    <div className="max-w-2xl mx-auto text-center py-10">
      <div className="h-20 w-20 rounded-full bg-mustard/30 mx-auto flex items-center justify-center mb-6">
        <CheckCircle2 className="h-10 w-10 text-primary" />
      </div>
      <h2 className="font-display text-4xl mb-3">Booking received!</h2>
      <p className="text-muted-foreground mb-8">We're verifying your payment. You'll get a confirmation via email or DM within a few hours.</p>

      <div className="bg-card border border-border rounded-2xl p-6 text-left mb-8">
        <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1">Reference code</div>
        <div className="font-mono text-2xl font-semibold text-primary mb-5">{confirmation.refCode}</div>
        <dl className="space-y-2 text-sm">
          <div className="flex justify-between"><dt className="text-muted-foreground">Date</dt><dd className="font-medium">{format(new Date(slot.slot_date), "EEE, MMM d")}</dd></div>
          <div className="flex justify-between"><dt className="text-muted-foreground">Time</dt><dd className="font-medium">{slot.slot_time.slice(0,5)}</dd></div>
          <div className="flex justify-between"><dt className="text-muted-foreground">Guests</dt><dd className="font-medium">{details.groupSize}</dd></div>
          <div className="flex justify-between border-t border-border pt-2 mt-2"><dt className="text-muted-foreground">Total paid</dt><dd className="font-medium text-primary">₱{confirmation.total.toFixed(0)}</dd></div>
        </dl>
      </div>

      <div className="text-left bg-mustard/20 rounded-2xl p-5 mb-8">
        <h3 className="font-display text-lg mb-2">What happens next?</h3>
        <ol className="text-sm text-charcoal/80 space-y-1.5 list-decimal pl-5">
          <li>We verify your payment (usually within a few hours).</li>
          <li>You'll receive a confirmation email.</li>
          <li>Show up at your slot — your table and food will be ready.</li>
        </ol>
      </div>

      <Link to="/" className="inline-flex items-center justify-center rounded-full bg-foreground text-background px-6 py-3 font-medium hover:opacity-90">Back to home</Link>
    </div>
  );
}
