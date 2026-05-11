import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";
import { CheckCircle2, LogOut, Settings } from "lucide-react";

export const Route = createFileRoute("/admin")({ component: AdminPage });

type Booking = {
  id: string; reference_code: string; customer_name: string; customer_email: string;
  customer_phone: string; group_size: number; total_amount: number; status: string;
  created_at: string; slot_id: string;
  time_slots?: { slot_date: string; slot_time: string };
  booking_items?: { item_name: string; quantity: number }[];
  payments?: { id: string; status: string; reference_number: string | null; screenshot_url: string | null }[];
};

function AdminPage() {
  const [session, setSession] = useState<any>(null);
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"bookings" | "menu" | "slots">("bookings");

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) { setIsAdmin(null); setLoading(false); return; }
    (async () => {
      setLoading(true);
      const { data } = await supabase.from("user_roles").select("role").eq("user_id", session.user.id).eq("role", "admin").maybeSingle();
      setIsAdmin(!!data);
      setLoading(false);
    })();
  }, [session]);

  if (loading) return <div className="min-h-screen flex items-center justify-center text-muted-foreground">Loading…</div>;
  if (!session) return <AdminLogin />;
  if (!isAdmin) return <NotAuthorized email={session.user.email} />;

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <Link to="/" className="font-display text-xl font-semibold">Sautéo<span className="text-primary">.</span> <span className="text-muted-foreground text-sm font-sans font-normal">Admin</span></Link>
            <nav className="flex gap-1">
              {(["bookings","menu","slots"] as const).map(t => (
                <button key={t} onClick={() => setTab(t)}
                  className={`px-3 py-1.5 rounded-full text-sm capitalize ${tab===t ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"}`}>
                  {t}
                </button>
              ))}
            </nav>
          </div>
          <button onClick={() => supabase.auth.signOut()} className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5"><LogOut className="h-4 w-4" /> Sign out</button>
        </div>
      </header>
      <main className="max-w-7xl mx-auto px-6 py-8">
        {tab === "bookings" && <BookingsTab />}
        {tab === "menu" && <MenuTab />}
        {tab === "slots" && <SlotsTab />}
      </main>
    </div>
  );
}

function AdminLogin() {
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [mode, setMode] = useState<"login"|"signup">("login");
  const [err, setErr] = useState<string|null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr(null);
    const { error } = mode === "login"
      ? await supabase.auth.signInWithPassword({ email, password: pw })
      : await supabase.auth.signUp({ email, password: pw });
    if (error) setErr(error.message);
    setBusy(false);
  };
  return (
    <div className="min-h-screen flex items-center justify-center px-6 bg-background">
      <form onSubmit={submit} className="w-full max-w-sm bg-card border border-border rounded-2xl p-8">
        <h1 className="font-display text-2xl mb-1">Admin {mode === "login" ? "Login" : "Sign Up"}</h1>
        <p className="text-sm text-muted-foreground mb-6">{mode === "login" ? "Sign in to manage Sautéo." : "Create the first admin account."}</p>
        <div className="space-y-3">
          <input type="email" required placeholder="Email" value={email} onChange={e=>setEmail(e.target.value)}
            className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm" />
          <input type="password" required minLength={6} placeholder="Password" value={pw} onChange={e=>setPw(e.target.value)}
            className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm" />
          {err && <div className="text-sm text-destructive">{err}</div>}
          <button disabled={busy} className="w-full rounded-full bg-primary text-primary-foreground py-2.5 font-medium disabled:opacity-50">
            {busy ? "…" : mode === "login" ? "Sign in" : "Create account"}
          </button>
          <button type="button" onClick={() => setMode(m => m==="login"?"signup":"login")}
            className="w-full text-xs text-muted-foreground hover:text-foreground">
            {mode === "login" ? "First time? Create the admin account →" : "← Already have an account? Sign in"}
          </button>
        </div>
      </form>
    </div>
  );
}

function NotAuthorized({ email }: { email?: string }) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 text-center">
      <h1 className="font-display text-3xl mb-2">Not authorized</h1>
      <p className="text-muted-foreground max-w-md">Signed in as <span className="font-medium">{email}</span>, but this account isn't an admin.</p>
      <button onClick={() => supabase.auth.signOut()} className="mt-6 rounded-full bg-foreground text-background px-5 py-2 text-sm">Sign out</button>
    </div>
  );
}

/* ============ Bookings ============ */
function BookingsTab() {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    let q = supabase.from("bookings").select("*, time_slots(slot_date, slot_time), booking_items(item_name, quantity), payments(id, status, reference_number, screenshot_url)").order("created_at", { ascending: false });
    if (statusFilter !== "all") q = q.eq("status", statusFilter);
    const { data } = await q;
    let rows = (data ?? []) as any as Booking[];
    if (from) rows = rows.filter(b => b.time_slots && b.time_slots.slot_date >= from);
    if (to) rows = rows.filter(b => b.time_slots && b.time_slots.slot_date <= to);
    setBookings(rows);
    setLoading(false);
  };
  useEffect(() => { load(); }, [statusFilter, from, to]);

  const verify = async (b: Booking) => {
    const pid = b.payments?.[0]?.id;
    if (pid) await supabase.from("payments").update({ status: "verified", verified_at: new Date().toISOString() }).eq("id", pid);
    await supabase.from("bookings").update({ status: "confirmed" }).eq("id", b.id);
    load();
  };

  return (
    <div>
      <div className="flex flex-wrap items-end gap-3 mb-6">
        <div>
          <label className="block text-xs text-muted-foreground mb-1">Status</label>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="bg-card border border-border rounded-lg px-3 py-2 text-sm">
            <option value="all">All</option>
            <option value="pending">Pending</option>
            <option value="confirmed">Confirmed</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>
        <div>
          <label className="block text-xs text-muted-foreground mb-1">From</label>
          <input type="date" value={from} onChange={e=>setFrom(e.target.value)} className="bg-card border border-border rounded-lg px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-xs text-muted-foreground mb-1">To</label>
          <input type="date" value={to} onChange={e=>setTo(e.target.value)} className="bg-card border border-border rounded-lg px-3 py-2 text-sm" />
        </div>
      </div>

      <div className="bg-card border border-border rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted text-muted-foreground text-left">
              <tr>
                <th className="px-4 py-3 font-medium">Ref</th>
                <th className="px-4 py-3 font-medium">Customer</th>
                <th className="px-4 py-3 font-medium">Slot</th>
                <th className="px-4 py-3 font-medium">Group</th>
                <th className="px-4 py-3 font-medium">Items</th>
                <th className="px-4 py-3 font-medium">Total</th>
                <th className="px-4 py-3 font-medium">Payment</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={9} className="px-4 py-8 text-center text-muted-foreground">Loading…</td></tr>
              ) : bookings.length === 0 ? (
                <tr><td colSpan={9} className="px-4 py-8 text-center text-muted-foreground">No bookings yet.</td></tr>
              ) : bookings.map(b => (
                <tr key={b.id} className="border-t border-border align-top">
                  <td className="px-4 py-3 font-mono text-xs">{b.reference_code}</td>
                  <td className="px-4 py-3">
                    <div className="font-medium">{b.customer_name}</div>
                    <div className="text-xs text-muted-foreground">{b.customer_email}</div>
                    <div className="text-xs text-muted-foreground">{b.customer_phone}</div>
                  </td>
                  <td className="px-4 py-3">
                    {b.time_slots && <>
                      <div>{format(new Date(b.time_slots.slot_date), "EEE, MMM d")}</div>
                      <div className="text-xs text-muted-foreground">{b.time_slots.slot_time.slice(0,5)}</div>
                    </>}
                  </td>
                  <td className="px-4 py-3">{b.group_size}</td>
                  <td className="px-4 py-3 text-xs max-w-xs">
                    {b.booking_items?.map((bi, i) => <div key={i}>{bi.quantity}× {bi.item_name}</div>)}
                  </td>
                  <td className="px-4 py-3 font-medium">₱{Number(b.total_amount).toFixed(0)}</td>
                  <td className="px-4 py-3 text-xs">
                    {b.payments?.[0]?.reference_number && <div>Ref: {b.payments[0].reference_number}</div>}
                    {b.payments?.[0]?.screenshot_url && <a href={b.payments[0].screenshot_url} target="_blank" rel="noreferrer" className="text-primary underline">Screenshot</a>}
                    <div className="text-muted-foreground">{b.payments?.[0]?.status}</div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-block px-2 py-0.5 rounded-full text-xs ${
                      b.status === "confirmed" ? "bg-mustard/40 text-charcoal" :
                      b.status === "cancelled" ? "bg-destructive/20 text-destructive" :
                      "bg-muted text-muted-foreground"
                    }`}>{b.status}</span>
                  </td>
                  <td className="px-4 py-3">
                    {b.status !== "confirmed" && (
                      <button onClick={() => verify(b)} className="inline-flex items-center gap-1 text-xs bg-primary text-primary-foreground rounded-full px-3 py-1.5 hover:opacity-90">
                        <CheckCircle2 className="h-3 w-3" /> Verify
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ============ Menu Manager ============ */
function MenuTab() {
  const [items, setItems] = useState<any[]>([]);
  const [cats, setCats] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ name: "", description: "", price: "", image_url: "", category_id: "" });

  const load = async () => {
    const [{ data: c }, { data: i }] = await Promise.all([
      supabase.from("menu_categories").select("*").order("sort_order"),
      supabase.from("menu_items").select("*").order("sort_order"),
    ]);
    setCats(c ?? []); setItems(i ?? []);
    if (c?.length && !form.category_id) setForm(f => ({ ...f, category_id: c[0].id }));
  };
  useEffect(() => { load(); }, []);

  const toggle = async (id: string, active: boolean) => {
    await supabase.from("menu_items").update({ active: !active }).eq("id", id);
    load();
  };
  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    await supabase.from("menu_items").insert({ ...form, price: Number(form.price) });
    setForm({ name: "", description: "", price: "", image_url: "", category_id: form.category_id });
    setBusy(false);
    load();
  };

  return (
    <div className="grid lg:grid-cols-[1fr_360px] gap-6">
      <div className="bg-card border border-border rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted text-left text-muted-foreground">
              <tr><th className="px-4 py-3">Name</th><th className="px-4 py-3">Category</th><th className="px-4 py-3">Price</th><th className="px-4 py-3">Active</th></tr>
            </thead>
            <tbody>
              {items.map(it => {
                const cat = cats.find(c => c.id === it.category_id);
                return (
                  <tr key={it.id} className="border-t border-border">
                    <td className="px-4 py-3 font-medium">{it.name}</td>
                    <td className="px-4 py-3 text-muted-foreground">{cat?.name}</td>
                    <td className="px-4 py-3">₱{Number(it.price).toFixed(0)}</td>
                    <td className="px-4 py-3">
                      <button onClick={() => toggle(it.id, it.active)}
                        className={`px-3 py-1 rounded-full text-xs ${it.active ? "bg-mustard/40 text-charcoal" : "bg-muted text-muted-foreground"}`}>
                        {it.active ? "On" : "Off"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      <form onSubmit={add} className="bg-card border border-border rounded-2xl p-5 h-fit space-y-3">
        <h3 className="font-display text-lg">Add menu item</h3>
        <input required placeholder="Name" value={form.name} onChange={e=>setForm({...form,name:e.target.value})} className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm" />
        <textarea placeholder="Description" value={form.description} onChange={e=>setForm({...form,description:e.target.value})} className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm h-20" />
        <input required type="number" step="0.01" placeholder="Price (₱)" value={form.price} onChange={e=>setForm({...form,price:e.target.value})} className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm" />
        <input placeholder="Image URL" value={form.image_url} onChange={e=>setForm({...form,image_url:e.target.value})} className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm" />
        <select required value={form.category_id} onChange={e=>setForm({...form,category_id:e.target.value})} className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm">
          {cats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <button disabled={busy} className="w-full rounded-full bg-primary text-primary-foreground py-2 text-sm font-medium disabled:opacity-50">Add Item</button>
      </form>
    </div>
  );
}

/* ============ Slots Manager ============ */
function SlotsTab() {
  const [slots, setSlots] = useState<any[]>([]);
  const load = async () => {
    const { data } = await supabase.from("time_slots").select("*").gte("slot_date", format(new Date(), "yyyy-MM-dd")).order("slot_date").order("slot_time");
    setSlots(data ?? []);
  };
  useEffect(() => { load(); }, []);

  const toggle = async (id: string, isOpen: boolean) => {
    await supabase.from("time_slots").update({ is_open: !isOpen }).eq("id", id);
    load();
  };
  const updateCap = async (id: string, capacity: number) => {
    await supabase.from("time_slots").update({ capacity }).eq("id", id);
    load();
  };

  const grouped: Record<string, any[]> = {};
  slots.forEach(s => { (grouped[s.slot_date] ||= []).push(s); });

  return (
    <div className="space-y-4">
      {Object.entries(grouped).map(([date, ss]) => (
        <div key={date} className="bg-card border border-border rounded-2xl p-5">
          <h3 className="font-display text-lg mb-3">{format(new Date(date), "EEEE, MMM d")}</h3>
          <div className="grid sm:grid-cols-5 gap-3">
            {ss.map(s => (
              <div key={s.id} className={`p-3 rounded-xl border ${s.is_open ? "border-border bg-background" : "border-border bg-muted/30 opacity-60"}`}>
                <div className="font-medium">{s.slot_time.slice(0,5)}</div>
                <div className="text-xs text-muted-foreground mb-2">{s.seats_taken}/{s.capacity} taken</div>
                <input type="number" value={s.capacity} onChange={e => updateCap(s.id, parseInt(e.target.value)||0)}
                  className="w-full bg-background border border-border rounded px-2 py-1 text-xs mb-2" />
                <button onClick={() => toggle(s.id, s.is_open)}
                  className={`w-full rounded-full py-1 text-xs ${s.is_open ? "bg-foreground text-background" : "bg-mustard/40 text-charcoal"}`}>
                  {s.is_open ? "Close" : "Open"}
                </button>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
