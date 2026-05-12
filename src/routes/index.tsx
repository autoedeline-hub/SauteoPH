import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { Minus, Plus, ShoppingBag, ChevronLeft, CheckCircle2, Printer } from "lucide-react";

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
type MenuItem = {
  id: string;
  category_id: string;
  name: string;
  description: string | null;
  price: number;
  image_url: string | null;
  active: boolean;
};
type Cart = Record<string, number>;
type View = "menu" | "payment" | "receipt";

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
      setItems(((i ?? []) as MenuItem[]).map((it) => ({ ...it, price: Number(it.price) })));
      if (c && c.length) setActiveCategory(c[0].id);
    })();
  }, []);

  const total = useMemo(
    () =>
      Object.entries(cart).reduce((sum, [id, qty]) => {
        const it = items.find((x) => x.id === id);
        return sum + (it ? it.price * qty : 0);
      }, 0),
    [cart, items],
  );
  const cartCount = Object.values(cart).reduce((a, b) => a + b, 0);

  const updateQty = (id: string, delta: number) => {
    setCart((prev) => {
      const q = (prev[id] || 0) + delta;
      const next = { ...prev };
      if (q <= 0) delete next[id];
      else next[id] = q;
      return next;
    });
  };

  const placeOrder = () => {
    const ref = "STO-" + Date.now().toString(36).toUpperCase().slice(-6);
    const lineItems = Object.entries(cart)
      .map(([id, qty]) => {
        const it = items.find((x) => x.id === id);
        return it ? { name: it.name, qty, price: it.price } : null;
      })
      .filter(Boolean) as { name: string; qty: number; price: number }[];
    setReceipt({ ref, total, items: lineItems, at: new Date() });
    setCart({});
    setView("receipt");
  };

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1 max-w-6xl mx-auto w-full px-4 sm:px-6 py-8 md:py-12">
        {view === "menu" && (
          <MenuView
            categories={categories}
            items={items}
            activeCategory={activeCategory}
            setActiveCategory={setActiveCategory}
            cart={cart}
            updateQty={updateQty}
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
  total,
  cartCount,
  onCheckout,
}: {
  categories: Category[];
  items: MenuItem[];
  activeCategory: string | null;
  setActiveCategory: (id: string) => void;
  cart: Cart;
  updateQty: (id: string, delta: number) => void;
  total: number;
  cartCount: number;
  onCheckout: () => void;
}) {
  const filtered = items.filter((i) => i.category_id === activeCategory);
  return (
    <div className="grid lg:grid-cols-[1fr_340px] gap-8">
      <div>
        <h1 className="font-display text-4xl md:text-5xl mb-2">Menu</h1>
        <p className="text-muted-foreground mb-8">Browse, add to cart, then check out.</p>

        <div className="flex gap-2 mb-6 overflow-x-auto pb-2">
          {categories.map((c) => (
            <button
              key={c.id}
              onClick={() => setActiveCategory(c.id)}
              className={`px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition ${
                activeCategory === c.id
                  ? "bg-foreground text-background"
                  : "bg-muted text-muted-foreground hover:bg-muted/70"
              }`}
            >
              {c.name}
            </button>
          ))}
        </div>

        {filtered.length === 0 ? (
          <div className="text-muted-foreground text-sm py-12 text-center">No items in this category yet.</div>
        ) : (
          <div className="grid sm:grid-cols-2 gap-4">
            {filtered.map((it) => {
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
                    {it.description && (
                      <p className="text-sm text-muted-foreground mt-1 mb-4 flex-1">{it.description}</p>
                    )}
                    <div className="flex items-center justify-between mt-auto">
                      {qty === 0 ? (
                        <button
                          onClick={() => updateQty(it.id, 1)}
                          className="px-4 py-2 rounded-full bg-primary text-primary-foreground text-sm font-medium hover:opacity-90"
                        >
                          Add
                        </button>
                      ) : (
                        <div className="flex items-center gap-3">
                          <button
                            onClick={() => updateQty(it.id, -1)}
                            className="h-8 w-8 rounded-full bg-muted flex items-center justify-center hover:bg-muted/70"
                          >
                            <Minus className="h-4 w-4" />
                          </button>
                          <span className="font-medium w-6 text-center">{qty}</span>
                          <button
                            onClick={() => updateQty(it.id, 1)}
                            className="h-8 w-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center hover:opacity-90"
                          >
                            <Plus className="h-4 w-4" />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Cart */}
      <aside className="lg:sticky lg:top-24 h-fit bg-card border border-border rounded-2xl p-5">
        <div className="flex items-center gap-2 mb-3">
          <ShoppingBag className="h-5 w-5 text-primary" />
          <h2 className="font-display text-xl">Your order</h2>
        </div>
        {Object.keys(cart).length === 0 ? (
          <p className="text-sm text-muted-foreground">No items yet — add a few dishes.</p>
        ) : (
          <ul className="space-y-2 mb-4">
            {Object.entries(cart).map(([id, qty]) => {
              const it = items.find((x) => x.id === id);
              if (!it) return null;
              return (
                <li key={id} className="flex justify-between text-sm">
                  <span>
                    {qty}× {it.name}
                  </span>
                  <span className="text-muted-foreground">₱{(it.price * qty).toFixed(0)}</span>
                </li>
              );
            })}
          </ul>
        )}
        <div className="border-t border-border pt-3 flex justify-between font-medium mb-4">
          <span>Total</span>
          <span className="text-primary text-lg">₱{total.toFixed(0)}</span>
        </div>
        <button
          onClick={onCheckout}
          disabled={cartCount === 0}
          className="w-full px-6 py-3 rounded-full bg-primary text-primary-foreground font-medium disabled:opacity-40 hover:opacity-90 transition"
        >
          Checkout · ₱{total.toFixed(0)}
        </button>
      </aside>
    </div>
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
