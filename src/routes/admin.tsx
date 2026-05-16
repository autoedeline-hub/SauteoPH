import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { format, subDays } from "date-fns";
import {
  CheckCircle2,
  LogOut,
  LayoutDashboard,
  ShoppingBag,
  UtensilsCrossed,
  CalendarClock,
  Menu as MenuIcon,
  X as XIcon,
  TrendingUp,
  Clock,
  CalendarRange,
  Salad,
  ImageIcon,
  Plus,
  Trash2,
  Upload,
  ChevronDown,
  ChevronUp,
  Search,
  AlertCircle,
  ArrowRight,
  Tag,
  Pencil,
  Inbox,
  CalendarPlus,
  Users,
  Mail,
  Phone,
  Facebook,
  Instagram,
  BookOpen,
  EyeOff,
} from "lucide-react";

export const Route = createFileRoute("/admin")({ component: AdminPage });

type Booking = {
  id: string; reference_code: string; customer_name: string; customer_email: string;
  customer_phone: string; group_size: number; total_amount: number; status: string;
  created_at: string; slot_id: string;
  source?: string | null;
  pickup_mode?: string | null;
  courier_address?: string | null;
  allergy_notes?: string | null;
  credit_remaining?: number | null;
  refund_status?: string | null;
  confirmed_at?: string | null;
  platform_id?: string | null;
  time_slots?: { slot_date: string; slot_time: string };
  booking_items?: { item_name: string; quantity: number }[];
  payments?: { id: string; status: string; reference_number: string | null; screenshot_url: string | null }[];
};

const SOURCE_LABEL: Record<string, string> = {
  web: "Web",
  messenger: "Messenger",
  instagram: "Instagram",
  manual: "Manual",
};

const PICKUP_LABEL: Record<string, string> = {
  dine_in: "Dine-in",
  personal_pickup: "Personal pickup",
  lalamove: "Lalamove",
  grab: "Grab",
};

const REFUND_LABEL: Record<string, string> = {
  available: "Credit available",
  partially_redeemed: "Partially redeemed",
  fully_redeemed: "Fully redeemed",
  forfeited: "Forfeited",
};

type TabKey = "overview" | "bookings" | "contacts" | "menu" | "slots" | "knowledge";

const NAV: { key: TabKey; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: "overview", label: "Overview", icon: LayoutDashboard },
  { key: "bookings", label: "Orders", icon: ShoppingBag },
  { key: "contacts", label: "Contacts", icon: Users },
  { key: "menu", label: "Menu", icon: UtensilsCrossed },
  { key: "slots", label: "Slots", icon: CalendarClock },
  { key: "knowledge", label: "Knowledge", icon: BookOpen },
];

const PAGE_META: Record<TabKey, { title: string; subtitle: string }> = {
  overview: { title: "Overview", subtitle: "A calm summary of what's happening at Sautéo today." },
  bookings: { title: "Orders", subtitle: "Verify payments and manage incoming reservations." },
  contacts: { title: "Contacts", subtitle: "Every guest who has booked, waitlisted, or messaged Sautéo." },
  menu: { title: "Menu", subtitle: "Curate the dishes available to guests." },
  slots: { title: "Time Slots", subtitle: "Open, close, and adjust capacity for each service." },
  knowledge: { title: "Knowledge", subtitle: "FAQ answers the chatbot uses when guests message Sautéo." },
};

const FAQ_TOPICS = [
  "Welcome","Hours","Location","Payment","Refund","Waitlist",
  "Pickup","Allergies","Dress Code","Escalation","Other",
] as const;

function AdminPage() {
  const [session, setSession] = useState<any>(null);
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<TabKey>("overview");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

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

  const meta = PAGE_META[tab];

  return (
    <div className="min-h-screen bg-background flex">
      {/* Sidebar (desktop) */}
      <aside className="hidden lg:flex w-64 shrink-0 flex-col bg-card border-r border-border">
        <SidebarContent
          tab={tab}
          onTab={(t) => { setTab(t); setMobileNavOpen(false); }}
          email={session.user.email}
        />
      </aside>

      {/* Mobile top bar */}
      <div className="lg:hidden fixed top-0 inset-x-0 z-30 h-14 flex items-center justify-between px-4 bg-card border-b border-border">
        <Link to="/" className="font-display text-lg font-semibold">
          Sautéo<span className="text-primary">.</span>
          <span className="ml-2 text-xs font-sans font-normal text-muted-foreground tracking-wider uppercase">Admin</span>
        </Link>
        <button
          aria-label="Open menu"
          onClick={() => setMobileNavOpen(true)}
          className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50"
        >
          <MenuIcon className="h-5 w-5" />
        </button>
      </div>

      {/* Mobile drawer */}
      {mobileNavOpen && (
        <div className="lg:hidden fixed inset-0 z-40">
          <div
            className="absolute inset-0 bg-charcoal/40 backdrop-blur-sm"
            onClick={() => setMobileNavOpen(false)}
          />
          <aside className="absolute left-0 top-0 bottom-0 w-72 bg-card border-r border-border flex flex-col">
            <div className="flex items-center justify-between px-4 h-14 border-b border-border">
              <span className="font-display text-lg font-semibold">
                Sautéo<span className="text-primary">.</span>
              </span>
              <button
                aria-label="Close menu"
                onClick={() => setMobileNavOpen(false)}
                className="p-2 rounded-lg text-muted-foreground hover:text-foreground"
              >
                <XIcon className="h-5 w-5" />
              </button>
            </div>
            <SidebarContent
              tab={tab}
              onTab={(t) => { setTab(t); setMobileNavOpen(false); }}
              email={session.user.email}
              compact
            />
          </aside>
        </div>
      )}

      {/* Main area */}
      <main className="flex-1 min-w-0 pt-14 lg:pt-0">
        <div className="max-w-7xl mx-auto px-5 sm:px-8 py-8 lg:py-10">
          <header className="mb-8">
            <h1 className="font-display text-3xl md:text-4xl tracking-tight">{meta.title}</h1>
            <p className="text-sm text-muted-foreground mt-1.5">{meta.subtitle}</p>
          </header>

          {tab === "overview" && <OverviewTab onJumpToOrders={() => setTab("bookings")} />}
          {tab === "bookings" && <BookingsTab />}
          {tab === "contacts" && <ContactsTab />}
          {tab === "menu" && <MenuTab />}
          {tab === "slots" && <SlotsTab />}
          {tab === "knowledge" && <KnowledgeTab />}
        </div>
      </main>
    </div>
  );
}

/* ============ Sidebar ============ */
function SidebarContent({
  tab, onTab, email, compact,
}: { tab: TabKey; onTab: (t: TabKey) => void; email?: string; compact?: boolean }) {
  return (
    <>
      {!compact && (
        <div className="px-6 h-20 flex items-center border-b border-border">
          <Link to="/" className="font-display text-2xl font-semibold leading-none">
            Sautéo<span className="text-primary">.</span>
            <div className="text-[10px] font-sans font-medium tracking-[0.18em] uppercase text-muted-foreground mt-1">
              Admin Console
            </div>
          </Link>
        </div>
      )}

      <nav className="flex-1 px-3 py-5 space-y-1">
        {NAV.map(({ key, label, icon: Icon }) => {
          const active = tab === key;
          return (
            <button
              key={key}
              onClick={() => onTab(key)}
              className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm transition ${
                active
                  ? "bg-foreground text-background font-medium shadow-sm"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
              }`}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span>{label}</span>
            </button>
          );
        })}
      </nav>

      <div className="px-4 py-4 border-t border-border space-y-3">
        <div className="px-2">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Signed in</div>
          <div className="text-xs text-foreground truncate">{email}</div>
        </div>
        <button
          onClick={() => supabase.auth.signOut()}
          className="w-full inline-flex items-center justify-center gap-2 rounded-full bg-muted/60 hover:bg-muted text-foreground py-2 text-xs font-medium transition"
        >
          <LogOut className="h-3.5 w-3.5" /> Sign out
        </button>
      </div>
    </>
  );
}

/* ============ Overview ============ */
function OverviewTab({ onJumpToOrders }: { onJumpToOrders: () => void }) {
  const [stats, setStats] = useState({
    revenueToday: 0,
    pending: 0,
    weekOrders: 0,
    activeMenu: 0,
  });
  const [weekSeries, setWeekSeries] = useState<{ date: string; revenue: number }[]>([]);
  const [recent, setRecent] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const today = format(new Date(), "yyyy-MM-dd");
      const weekAgo = format(subDays(new Date(), 6), "yyyy-MM-dd");

      const { data: bookingsData } = await supabase
        .from("bookings")
        .select("*, time_slots(slot_date, slot_time), booking_items(item_name, quantity), payments(id, status, reference_number, screenshot_url)")
        .order("created_at", { ascending: false });

      const rows = (bookingsData ?? []) as any as Booking[];

      const revenueToday = rows
        .filter(b => b.status === "confirmed" && b.time_slots?.slot_date === today)
        .reduce((sum, b) => sum + Number(b.total_amount || 0), 0);

      const pending = rows.filter(b => b.status === "pending").length;

      const weekOrders = rows.filter(
        b => b.status === "confirmed" && b.time_slots && b.time_slots.slot_date >= weekAgo
      ).length;

      const series: { date: string; revenue: number }[] = [];
      for (let i = 6; i >= 0; i--) {
        const d = format(subDays(new Date(), i), "yyyy-MM-dd");
        const revenue = rows
          .filter(b => b.status === "confirmed" && b.time_slots?.slot_date === d)
          .reduce((sum, b) => sum + Number(b.total_amount || 0), 0);
        series.push({ date: d, revenue });
      }

      const { count: activeMenu } = await supabase
        .from("menu_items")
        .select("*", { count: "exact", head: true })
        .eq("active", true);

      setStats({
        revenueToday,
        pending,
        weekOrders,
        activeMenu: activeMenu ?? 0,
      });
      setWeekSeries(series);
      setRecent(rows.filter(b => b.status === "confirmed").slice(0, 5));
      setLoading(false);
    })();
  }, []);

  const hasPending = stats.pending > 0;
  const weekRevenue = weekSeries.reduce((s, d) => s + d.revenue, 0);
  const peakRevenue = Math.max(1, ...weekSeries.map(d => d.revenue));

  return (
    <div className="space-y-6">
      {/* Hero: pending verifications takes center stage when there's work to do */}
      <button
        onClick={hasPending ? onJumpToOrders : undefined}
        disabled={!hasPending}
        className={`w-full text-left rounded-2xl p-6 lg:p-7 transition border ${
          hasPending
            ? "bg-foreground text-background border-foreground shadow-md hover:shadow-lg hover:-translate-y-0.5 cursor-pointer"
            : "bg-card text-foreground border-border shadow-sm cursor-default"
        }`}
      >
        <div className="flex items-start gap-5">
          <div className={`shrink-0 rounded-2xl p-3 ${hasPending ? "bg-background/15" : "bg-muted"}`}>
            {hasPending ? <AlertCircle className="h-6 w-6" /> : <CheckCircle2 className="h-6 w-6 text-muted-foreground" />}
          </div>
          <div className="flex-1 min-w-0">
            <div className={`text-[10px] uppercase tracking-wider font-medium ${hasPending ? "text-background/70" : "text-muted-foreground"}`}>
              Pending verifications
            </div>
            <div className="mt-1 flex items-baseline gap-3 flex-wrap">
              <span className="font-display text-5xl md:text-6xl font-semibold tracking-tight">
                {loading ? <span className="opacity-40">—</span> : stats.pending}
              </span>
              <span className={`text-sm ${hasPending ? "text-background/80" : "text-muted-foreground"}`}>
                {hasPending
                  ? stats.pending === 1 ? "order is waiting for you" : "orders are waiting for you"
                  : "everything is verified — nice work."}
              </span>
            </div>
          </div>
          {hasPending && (
            <div className="shrink-0 self-center inline-flex items-center gap-1.5 text-xs font-medium opacity-90">
              Review now <ArrowRight className="h-4 w-4" />
            </div>
          )}
        </div>
      </button>

      {/* Secondary KPIs — smaller, equal weight */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <SecondaryKpi
          label="Today's revenue"
          value={`₱${stats.revenueToday.toLocaleString("en-PH", { maximumFractionDigits: 0 })}`}
          icon={TrendingUp}
          loading={loading}
        />
        <SecondaryKpi
          label="Orders this week"
          value={String(stats.weekOrders)}
          icon={CalendarRange}
          loading={loading}
        />
        <SecondaryKpi
          label="Active menu items"
          value={String(stats.activeMenu)}
          icon={Salad}
          loading={loading}
        />
      </div>

      {/* Two-col layout for chart + recent orders on large screens */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Revenue chart */}
        <section className="lg:col-span-2 bg-card border border-border rounded-2xl shadow-sm p-6">
          <div className="flex items-baseline justify-between gap-3">
            <div>
              <h2 className="font-display text-xl">Last 7 days</h2>
              <p className="text-xs text-muted-foreground mt-0.5">Revenue from confirmed orders.</p>
            </div>
            <div className="text-right">
              <div className="font-display text-2xl font-semibold tabular-nums">
                ₱{weekRevenue.toLocaleString("en-PH", { maximumFractionDigits: 0 })}
              </div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">total</div>
            </div>
          </div>
          <div className="mt-6 flex items-end gap-2 h-32">
            {loading ? (
              <div className="w-full text-center text-xs text-muted-foreground self-center">Loading…</div>
            ) : (
              weekSeries.map((d, i) => {
                const heightPct = d.revenue === 0 ? 4 : Math.max(8, (d.revenue / peakRevenue) * 100);
                const isToday = i === weekSeries.length - 1;
                return (
                  <div key={d.date} className="flex-1 flex flex-col items-center gap-2 min-w-0">
                    <div className="w-full flex items-end justify-center h-full">
                      <div
                        title={`₱${d.revenue.toLocaleString("en-PH", { maximumFractionDigits: 0 })} on ${format(new Date(d.date), "EEE, MMM d")}`}
                        style={{ height: `${heightPct}%` }}
                        className={`w-full rounded-md transition ${
                          isToday ? "bg-foreground" : d.revenue === 0 ? "bg-muted" : "bg-foreground/30 hover:bg-foreground/50"
                        }`}
                      />
                    </div>
                    <div className={`text-[10px] tabular-nums ${isToday ? "text-foreground font-medium" : "text-muted-foreground"}`}>
                      {format(new Date(d.date), "EEEEEE")}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </section>

        {/* Recent orders */}
        <section className="lg:col-span-3 bg-card border border-border rounded-2xl shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-6 py-5 border-b border-border">
            <div>
              <h2 className="font-display text-xl">Recent orders</h2>
              <p className="text-xs text-muted-foreground mt-0.5">Last 5 confirmed bookings.</p>
            </div>
            <button
              onClick={onJumpToOrders}
              className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
            >
              View all <ArrowRight className="h-3 w-3" />
            </button>
          </div>

          {loading ? (
            <div className="px-6 py-12 text-center text-muted-foreground text-sm">Loading…</div>
          ) : recent.length === 0 ? (
            <EmptyState
              icon={Inbox}
              title="No confirmed orders yet"
              hint="Verified bookings will show up here."
              className="px-6 py-10"
            />
          ) : (
            <ul className="divide-y divide-border">
              {recent.map(b => (
                <li key={b.id} className="px-6 py-4 flex items-center justify-between hover:bg-muted/30 transition">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2.5">
                      <span className="font-medium truncate">{b.customer_name}</span>
                      <StatusBadge status={b.status} />
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5 truncate">
                      {b.reference_code}
                      {b.time_slots && (
                        <> · {format(new Date(b.time_slots.slot_date), "EEE, MMM d")} · {b.time_slots.slot_time.slice(0, 5)}</>
                      )}
                    </div>
                  </div>
                  <div className="text-right shrink-0 ml-4">
                    <div className="font-display font-semibold">₱{Number(b.total_amount).toFixed(0)}</div>
                    <div className="text-[11px] text-muted-foreground">{b.group_size} guest{b.group_size === 1 ? "" : "s"}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function SecondaryKpi({
  label, value, icon: Icon, loading,
}: { label: string; value: string; icon: React.ComponentType<{ className?: string }>; loading: boolean }) {
  return (
    <div className="bg-card border border-border rounded-2xl p-5 shadow-sm flex items-center gap-4">
      <div className="bg-muted rounded-xl p-2.5 text-muted-foreground shrink-0">
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">{label}</div>
        <div className="mt-0.5 text-2xl font-display font-semibold tracking-tight truncate">
          {loading ? <span className="text-muted-foreground/40">—</span> : value}
        </div>
      </div>
    </div>
  );
}

/* ============ Shared empty state ============ */
function EmptyState({
  icon: Icon, title, hint, action, className,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  hint?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`text-center ${className ?? "py-16"}`}>
      <div className="inline-flex items-center justify-center h-12 w-12 rounded-2xl bg-muted/60 text-muted-foreground mb-3">
        <Icon className="h-6 w-6" />
      </div>
      <div className="font-display text-base">{title}</div>
      {hint && <div className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">{hint}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/* ============ Status badge ============ */
function StatusBadge({ status }: { status: string }) {
  const styles =
    status === "confirmed"
      ? "bg-mustard/30 text-charcoal"
      : status === "cancelled"
      ? "bg-destructive/15 text-destructive"
      : "bg-muted text-muted-foreground";
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium capitalize ${styles}`}>
      {status}
    </span>
  );
}

/* ============ Login / Not authorized ============ */
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
      <form onSubmit={submit} className="w-full max-w-sm bg-card border border-border rounded-2xl p-8 shadow-sm">
        <div className="font-display text-2xl mb-1">
          Sautéo<span className="text-primary">.</span>
        </div>
        <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground mb-6">
          Admin {mode === "login" ? "Sign in" : "Sign up"}
        </div>
        <p className="text-sm text-muted-foreground mb-6">
          {mode === "login" ? "Welcome back. Sign in to manage Sautéo." : "Create the first admin account."}
        </p>
        <div className="space-y-3">
          <input
            type="email" required placeholder="Email"
            value={email} onChange={e=>setEmail(e.target.value)}
            className="w-full bg-background border border-border rounded-lg px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-foreground/10 focus:border-foreground transition"
          />
          <input
            type="password" required minLength={6} placeholder="Password"
            value={pw} onChange={e=>setPw(e.target.value)}
            className="w-full bg-background border border-border rounded-lg px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-foreground/10 focus:border-foreground transition"
          />
          {err && <div className="text-sm text-destructive">{err}</div>}
          <button
            disabled={busy}
            className="w-full rounded-full bg-foreground text-background py-2.5 font-medium text-sm hover:opacity-90 disabled:opacity-50 transition"
          >
            {busy ? "…" : mode === "login" ? "Sign in" : "Create account"}
          </button>
          <button
            type="button"
            onClick={() => setMode(m => m==="login"?"signup":"login")}
            className="w-full text-xs text-muted-foreground hover:text-foreground"
          >
            {mode === "login" ? "First time? Create the admin account →" : "← Already have an account? Sign in"}
          </button>
        </div>
      </form>
    </div>
  );
}

function NotAuthorized({ email }: { email?: string }) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 text-center bg-background">
      <div className="bg-card border border-border rounded-2xl px-8 py-10 shadow-sm max-w-md">
        <div className="font-display text-2xl mb-1">
          Sautéo<span className="text-primary">.</span>
        </div>
        <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground mb-6">
          Restricted area
        </div>
        <h1 className="font-display text-2xl mb-2">Not authorized</h1>
        <p className="text-muted-foreground text-sm">
          Signed in as <span className="font-medium text-foreground">{email}</span>, but this account isn't an admin.
        </p>
        <button
          onClick={() => supabase.auth.signOut()}
          className="mt-6 rounded-full bg-foreground text-background px-5 py-2 text-sm hover:opacity-90 transition"
        >
          Sign out
        </button>
      </div>
    </div>
  );
}

/* ============ Bookings ============ */
function BookingsTab() {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");
  const [query, setQuery] = useState<string>("");
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

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return bookings.filter(b => {
      if (sourceFilter !== "all" && (b.source ?? "web") !== sourceFilter) return false;
      if (!needle) return true;
      return (
        b.customer_name?.toLowerCase().includes(needle) ||
        b.customer_email?.toLowerCase().includes(needle) ||
        b.customer_phone?.toLowerCase().includes(needle) ||
        b.reference_code?.toLowerCase().includes(needle) ||
        b.platform_id?.toLowerCase().includes(needle)
      );
    });
  }, [bookings, query, sourceFilter]);

  const verify = async (b: Booking) => {
    const now = new Date().toISOString();
    const pid = b.payments?.[0]?.id;
    if (pid) await supabase.from("payments").update({ status: "verified", verified_at: now }).eq("id", pid);
    await supabase.from("bookings").update({ status: "confirmed", confirmed_at: now }).eq("id", b.id);
    load();
  };

  const hasFilters = !!(from || to || statusFilter !== "all" || sourceFilter !== "all" || query);

  const sourceCounts = useMemo(() => {
    const m: Record<string, number> = { all: bookings.length };
    for (const b of bookings) {
      const s = b.source ?? "web";
      m[s] = (m[s] ?? 0) + 1;
    }
    return m;
  }, [bookings]);
  const sourceKeys = useMemo(
    () => Object.keys(sourceCounts).filter(k => k !== "all"),
    [sourceCounts]
  );
  const inputCls = "bg-background border border-border rounded-lg px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-foreground/10 focus:border-foreground transition";

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="bg-card border border-border rounded-2xl p-5 shadow-sm space-y-4">
        {/* Search bar */}
        <div className="relative">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="search"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search by name, email, phone, or reference…"
            className={`${inputCls} w-full pl-10`}
          />
        </div>

        <div className="flex flex-wrap items-end gap-4">
          <div className="min-w-[140px]">
            <label className="block text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">Status</label>
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className={inputCls}>
              <option value="all">All</option>
              <option value="pending">Pending</option>
              <option value="confirmed">Confirmed</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">From</label>
            <input type="date" value={from} onChange={e=>setFrom(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">To</label>
            <input type="date" value={to} onChange={e=>setTo(e.target.value)} className={inputCls} />
          </div>
          {hasFilters && (
            <button
              onClick={() => { setFrom(""); setTo(""); setStatusFilter("all"); setSourceFilter("all"); setQuery(""); }}
              className="text-xs text-muted-foreground hover:text-foreground ml-auto"
            >
              Reset
            </button>
          )}
        </div>

        {sourceKeys.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pt-1">
            <CategoryChip
              label="All channels"
              count={sourceCounts.all ?? 0}
              active={sourceFilter === "all"}
              onClick={() => setSourceFilter("all")}
            />
            {sourceKeys.map(k => (
              <CategoryChip
                key={k}
                label={SOURCE_LABEL[k] ?? k}
                count={sourceCounts[k] ?? 0}
                active={sourceFilter === k}
                onClick={() => setSourceFilter(k)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Table (desktop) */}
      <div className="hidden lg:block bg-card border border-border rounded-2xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-muted-foreground text-xs uppercase tracking-wider">
              <tr>
                <th className="px-5 py-4 font-medium text-left">Ref</th>
                <th className="px-5 py-4 font-medium text-left">Customer</th>
                <th className="px-5 py-4 font-medium text-left">Slot</th>
                <th className="px-5 py-4 font-medium text-left">Group</th>
                <th className="px-5 py-4 font-medium text-left">Items</th>
                <th className="px-5 py-4 font-medium text-left">Total</th>
                <th className="px-5 py-4 font-medium text-left">Payment</th>
                <th className="px-5 py-4 font-medium text-left">Status</th>
                <th className="px-5 py-4 font-medium text-left"></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={9} className="px-5 py-12 text-center text-muted-foreground">Loading…</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={9} className="p-0">
                  <EmptyState
                    icon={hasFilters ? Search : Inbox}
                    title={hasFilters ? "No matches" : "No bookings yet"}
                    hint={hasFilters ? "Try a different search or clear filters." : "New reservations will appear here as guests check out."}
                  />
                </td></tr>
              ) : filtered.map(b => (
                <tr key={b.id} className="border-t border-border align-top hover:bg-muted/30 transition">
                  <td className="px-5 py-4 font-mono text-xs text-muted-foreground">
                    {b.reference_code}
                    {b.source && b.source !== "web" && (
                      <div className="mt-1 inline-flex items-center px-1.5 py-0.5 rounded-full bg-muted text-[10px] uppercase tracking-wider font-medium text-muted-foreground">
                        {SOURCE_LABEL[b.source] ?? b.source}
                      </div>
                    )}
                  </td>
                  <td className="px-5 py-4">
                    <div className="font-medium">{b.customer_name}</div>
                    <div className="text-xs text-muted-foreground">{b.customer_email}</div>
                    <div className="text-xs text-muted-foreground">{b.customer_phone}</div>
                    {b.allergy_notes && (
                      <div className="mt-1 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-destructive/10 text-destructive text-[10px] font-medium" title={b.allergy_notes}>
                        <AlertCircle className="h-3 w-3" /> Allergy
                      </div>
                    )}
                  </td>
                  <td className="px-5 py-4">
                    {b.time_slots && <>
                      <div>{format(new Date(b.time_slots.slot_date), "EEE, MMM d")}</div>
                      <div className="text-xs text-muted-foreground">{b.time_slots.slot_time.slice(0,5)}</div>
                    </>}
                    {b.pickup_mode && b.pickup_mode !== "dine_in" && (
                      <div className="mt-1 text-[11px] text-muted-foreground">
                        {PICKUP_LABEL[b.pickup_mode] ?? b.pickup_mode}
                      </div>
                    )}
                  </td>
                  <td className="px-5 py-4">{b.group_size}</td>
                  <td className="px-5 py-4 text-xs max-w-xs">
                    {b.booking_items?.map((bi, i) => <div key={i}>{bi.quantity}× {bi.item_name}</div>)}
                  </td>
                  <td className="px-5 py-4 font-medium">
                    <div>₱{Number(b.total_amount).toFixed(0)}</div>
                    {b.credit_remaining != null && b.credit_remaining > 0 && (
                      <div className="text-[11px] text-muted-foreground mt-0.5">
                        Credit ₱{Number(b.credit_remaining).toFixed(0)}
                        {b.refund_status && <> · {REFUND_LABEL[b.refund_status] ?? b.refund_status}</>}
                      </div>
                    )}
                  </td>
                  <td className="px-5 py-4 text-xs">
                    {b.payments?.[0]?.reference_number && <div>Ref: {b.payments[0].reference_number}</div>}
                    {b.payments?.[0]?.screenshot_url && (
                      <a href={b.payments[0].screenshot_url} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                        Screenshot
                      </a>
                    )}
                    <div className="text-muted-foreground">{b.payments?.[0]?.status}</div>
                  </td>
                  <td className="px-5 py-4">
                    <StatusBadge status={b.status} />
                  </td>
                  <td className="px-5 py-4">
                    {b.status !== "confirmed" && (
                      <button
                        onClick={() => verify(b)}
                        className="inline-flex items-center gap-1.5 text-xs bg-foreground text-background rounded-full px-4 py-2 font-medium hover:opacity-90 transition"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" /> Verify
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Cards (mobile + tablet) */}
      <div className="lg:hidden space-y-3">
        {loading ? (
          <div className="bg-card border border-border rounded-2xl py-12 text-center text-muted-foreground text-sm shadow-sm">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="bg-card border border-border rounded-2xl shadow-sm">
            <EmptyState
              icon={hasFilters ? Search : Inbox}
              title={hasFilters ? "No matches" : "No bookings yet"}
              hint={hasFilters ? "Try a different search or clear filters." : "New reservations will appear here as guests check out."}
            />
          </div>
        ) : filtered.map(b => (
          <div key={b.id} className="bg-card border border-border rounded-2xl p-4 shadow-sm space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="font-medium truncate">{b.customer_name}</div>
                <div className="text-xs text-muted-foreground font-mono flex items-center gap-1.5">
                  {b.reference_code}
                  {b.source && b.source !== "web" && (
                    <span className="px-1.5 py-0.5 rounded-full bg-muted text-[10px] uppercase tracking-wider font-medium">
                      {SOURCE_LABEL[b.source] ?? b.source}
                    </span>
                  )}
                </div>
              </div>
              <StatusBadge status={b.status} />
            </div>
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Slot</div>
                <div className="mt-0.5">
                  {b.time_slots
                    ? <>{format(new Date(b.time_slots.slot_date), "EEE, MMM d")} · {b.time_slots.slot_time.slice(0,5)}</>
                    : <span className="text-muted-foreground">—</span>}
                </div>
                {b.pickup_mode && b.pickup_mode !== "dine_in" && (
                  <div className="text-muted-foreground mt-0.5">{PICKUP_LABEL[b.pickup_mode] ?? b.pickup_mode}</div>
                )}
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Total</div>
                <div className="mt-0.5 font-medium">₱{Number(b.total_amount).toFixed(0)} · {b.group_size} guest{b.group_size === 1 ? "" : "s"}</div>
                {b.credit_remaining != null && b.credit_remaining > 0 && (
                  <div className="text-muted-foreground mt-0.5">
                    Credit ₱{Number(b.credit_remaining).toFixed(0)}
                  </div>
                )}
              </div>
              <div className="col-span-2">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Contact</div>
                <div className="mt-0.5 truncate">{b.customer_email}</div>
                <div className="text-muted-foreground truncate">{b.customer_phone}</div>
              </div>
              {b.courier_address && (
                <div className="col-span-2">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Courier address</div>
                  <div className="mt-0.5 whitespace-pre-line">{b.courier_address}</div>
                </div>
              )}
              {b.allergy_notes && (
                <div className="col-span-2">
                  <div className="text-[10px] uppercase tracking-wider text-destructive inline-flex items-center gap-1">
                    <AlertCircle className="h-3 w-3" /> Allergy notes
                  </div>
                  <div className="mt-0.5 whitespace-pre-line">{b.allergy_notes}</div>
                </div>
              )}
              {b.booking_items?.length ? (
                <div className="col-span-2">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Items</div>
                  <div className="mt-0.5">
                    {b.booking_items.map((bi, i) => <div key={i}>{bi.quantity}× {bi.item_name}</div>)}
                  </div>
                </div>
              ) : null}
              {(b.payments?.[0]?.reference_number || b.payments?.[0]?.screenshot_url) && (
                <div className="col-span-2">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Payment</div>
                  <div className="mt-0.5">
                    {b.payments?.[0]?.reference_number && <div>Ref: {b.payments[0].reference_number}</div>}
                    {b.payments?.[0]?.screenshot_url && (
                      <a href={b.payments[0].screenshot_url} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                        View screenshot
                      </a>
                    )}
                    <div className="text-muted-foreground capitalize">{b.payments?.[0]?.status}</div>
                  </div>
                </div>
              )}
            </div>
            {b.status !== "confirmed" && (
              <button
                onClick={() => verify(b)}
                className="w-full inline-flex items-center justify-center gap-1.5 text-xs bg-foreground text-background rounded-full px-4 py-2.5 font-medium hover:opacity-90 transition"
              >
                <CheckCircle2 className="h-3.5 w-3.5" /> Verify payment
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ============ Menu Manager (Shopify-style) ============ */

type MenuVariant = { name: string; price: number };

type MenuCategory = {
  id: string;
  name: string;
  sort_order: number;
};

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

const MENU_IMAGES_BUCKET = "menu-images";
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const ALLOWED_IMAGE_MIME = ["image/jpeg", "image/png", "image/webp", "image/avif"];

const menuInputCls =
  "w-full bg-background border border-border rounded-lg px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-foreground/10 focus:border-foreground transition";

function MenuTab() {
  const [items, setItems] = useState<MenuItem[]>([]);
  const [cats, setCats] = useState<MenuCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<MenuItem | null>(null);
  const [catManagerOpen, setCatManagerOpen] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: c }, { data: i }] = await Promise.all([
      supabase.from("menu_categories").select("*").order("sort_order"),
      supabase.from("menu_items").select("*").order("sort_order"),
    ]);
    setCats((c ?? []) as MenuCategory[]);
    setItems(((i ?? []) as unknown) as MenuItem[]);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const openCreate = () => {
    setEditingItem(null);
    setEditorOpen(true);
  };
  const openEdit = (item: MenuItem) => {
    setEditingItem(item);
    setEditorOpen(true);
  };
  const closeEditor = () => {
    setEditorOpen(false);
    setEditingItem(null);
  };

  const toggleActive = async (item: MenuItem, e: React.MouseEvent) => {
    e.stopPropagation();
    setItems(prev => prev.map(p => (p.id === item.id ? { ...p, active: !p.active } : p)));
    const { error } = await supabase
      .from("menu_items")
      .update({ active: !item.active })
      .eq("id", item.id);
    if (error) {
      setItems(prev => prev.map(p => (p.id === item.id ? { ...p, active: item.active } : p)));
    }
  };

  const visibleItems = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const catOrder = new Map(cats.map(c => [c.id, c.sort_order]));
    return items
      .filter(item => {
        if (categoryFilter !== "all" && item.category_id !== categoryFilter) return false;
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
    for (const it of items) counts[it.category_id] = (counts[it.category_id] ?? 0) + 1;
    return counts;
  }, [items]);

  return (
    <div className="space-y-6">
      {/* Header row */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="font-display text-xl">Menu items</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {loading
              ? "Loading…"
              : `${items.length} item${items.length === 1 ? "" : "s"} across ${cats.length} categor${cats.length === 1 ? "y" : "ies"} · click a card to edit.`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setCatManagerOpen(true)}
            className="inline-flex items-center gap-1.5 bg-muted/60 hover:bg-muted text-foreground rounded-full px-4 py-2 text-sm font-medium transition"
          >
            <Tag className="h-4 w-4" />
            Categories
          </button>
          <button
            onClick={openCreate}
            disabled={cats.length === 0}
            className="inline-flex items-center gap-1.5 bg-foreground text-background rounded-full px-4 py-2 text-sm font-medium hover:opacity-90 transition disabled:opacity-50"
          >
            <Plus className="h-4 w-4" />
            Add new item
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-card border border-border rounded-2xl p-4 shadow-sm space-y-3">
        <div className="relative">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="search"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search menu items by name…"
            className="w-full bg-background border border-border rounded-lg pl-10 pr-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-foreground/10 focus:border-foreground transition"
          />
        </div>
        {cats.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            <CategoryChip
              label="All"
              count={items.length}
              active={categoryFilter === "all"}
              onClick={() => setCategoryFilter("all")}
            />
            {cats.map(c => (
              <CategoryChip
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
      ) : cats.length === 0 ? (
        <div className="bg-card border border-border rounded-2xl shadow-sm">
          <EmptyState
            icon={Tag}
            title="No categories yet"
            hint="Add at least one category before creating menu items."
            action={
              <button
                onClick={() => setCatManagerOpen(true)}
                className="inline-flex items-center gap-1.5 bg-foreground text-background rounded-full px-4 py-2 text-sm font-medium hover:opacity-90 transition"
              >
                <Tag className="h-4 w-4" /> Manage categories
              </button>
            }
          />
        </div>
      ) : items.length === 0 ? (
        <div className="bg-card border border-border rounded-2xl shadow-sm">
          <EmptyState
            icon={UtensilsCrossed}
            title="No menu items yet"
            hint='Click "Add new item" to create your first dish.'
            action={
              <button
                onClick={openCreate}
                className="inline-flex items-center gap-1.5 bg-foreground text-background rounded-full px-4 py-2 text-sm font-medium hover:opacity-90 transition"
              >
                <Plus className="h-4 w-4" /> Add new item
              </button>
            }
          />
        </div>
      ) : visibleItems.length === 0 ? (
        <div className="bg-card border border-border rounded-2xl shadow-sm">
          <EmptyState
            icon={Search}
            title="No matches"
            hint="Try a different search or category."
          />
        </div>
      ) : (
        <div className="max-h-[calc(100vh-22rem)] overflow-y-auto pr-1 -mr-1">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
          {visibleItems.map(item => {
            const cat = cats.find(c => c.id === item.category_id);
            const variantCount = item.variants?.length ?? 0;
            return (
              <button
                key={item.id}
                onClick={() => openEdit(item)}
                className="text-left bg-card border border-border rounded-2xl overflow-hidden hover:shadow-md transition-shadow cursor-pointer focus:outline-none focus:ring-2 focus:ring-foreground/20"
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
                <div className="p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">{item.name}</div>
                      <div className="text-[11px] text-muted-foreground mt-0.5 truncate">
                        {cat?.name ?? "Uncategorized"}
                      </div>
                    </div>
                    <div className="text-sm text-foreground font-semibold tabular-nums shrink-0">
                      ₱{Number(item.price).toFixed(0)}
                    </div>
                  </div>
                  <div className="mt-3 inline-flex items-center gap-2">
                    <span
                      role="button"
                      tabIndex={0}
                      aria-pressed={item.active}
                      aria-label={item.active ? "Set inactive" : "Set active"}
                      onClick={(e) => toggleActive(item, e)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          e.stopPropagation();
                          toggleActive(item, e as unknown as React.MouseEvent);
                        }
                      }}
                      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium transition cursor-pointer ${
                        item.active
                          ? "bg-mustard/30 text-charcoal hover:bg-mustard/40"
                          : "bg-muted text-muted-foreground hover:bg-muted/80"
                      }`}
                    >
                      {item.active ? "On" : "Off"}
                    </span>
                    {variantCount > 0 && (
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-muted/60 text-muted-foreground">
                        {variantCount} variant{variantCount === 1 ? "" : "s"}
                      </span>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
          </div>
        </div>
      )}

      {/* Editor dialog */}
      {editorOpen && (
        <MenuItemEditor
          item={editingItem}
          categories={cats}
          onClose={closeEditor}
          onSaved={() => { closeEditor(); load(); }}
        />
      )}

      {catManagerOpen && (
        <CategoryManager
          categories={cats}
          counts={itemCountsByCat}
          onClose={() => setCatManagerOpen(false)}
          onChanged={load}
        />
      )}
    </div>
  );
}

function CategoryChip({
  label, count, active, onClick,
}: { label: string; count: number; active: boolean; onClick: () => void }) {
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
      <span className={`tabular-nums ${active ? "text-background/70" : "text-muted-foreground/70"}`}>
        {count}
      </span>
    </button>
  );
}

/* ============ Category manager dialog ============ */
function CategoryManager({
  categories, counts, onClose, onChanged,
}: {
  categories: MenuCategory[];
  counts: Record<string, number>;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [working, setWorking] = useState<MenuCategory[]>(categories);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { setWorking(categories); }, [categories]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, busy]);

  const slugify = (s: string) =>
    s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || `cat-${Date.now()}`;

  const addCategory = async () => {
    const trimmed = newName.trim();
    if (!trimmed) return;
    setErr(null);
    setBusy(true);
    try {
      const sort_order = working.length === 0 ? 0 : Math.max(...working.map(c => c.sort_order)) + 1;
      const { data, error } = await supabase
        .from("menu_categories")
        .insert({ name: trimmed, slug: slugify(trimmed), sort_order })
        .select("*")
        .single();
      if (error) throw new Error(error.message);
      if (data) setWorking(prev => [...prev, data as MenuCategory]);
      setNewName("");
      onChanged();
    } catch (e: any) {
      setErr(e?.message ?? "Could not add category.");
    } finally {
      setBusy(false);
    }
  };

  const renameCategory = async (id: string, name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setWorking(prev => prev.map(c => (c.id === id ? { ...c, name: trimmed } : c)));
    const { error } = await supabase.from("menu_categories").update({ name: trimmed }).eq("id", id);
    if (error) setErr(error.message);
    else onChanged();
  };

  const removeCategory = async (c: MenuCategory) => {
    const count = counts[c.id] ?? 0;
    if (count > 0) {
      alert(`"${c.name}" has ${count} item${count === 1 ? "" : "s"}. Move or delete those first.`);
      return;
    }
    if (!confirm(`Delete category "${c.name}"?`)) return;
    setWorking(prev => prev.filter(p => p.id !== c.id));
    const { error } = await supabase.from("menu_categories").delete().eq("id", c.id);
    if (error) setErr(error.message);
    else onChanged();
  };

  const moveCategory = async (id: string, dir: -1 | 1) => {
    const sorted = [...working].sort((a, b) => a.sort_order - b.sort_order);
    const idx = sorted.findIndex(c => c.id === id);
    const swapIdx = idx + dir;
    if (idx < 0 || swapIdx < 0 || swapIdx >= sorted.length) return;
    const a = sorted[idx]; const b = sorted[swapIdx];
    const reordered = sorted.map(c => {
      if (c.id === a.id) return { ...c, sort_order: b.sort_order };
      if (c.id === b.id) return { ...c, sort_order: a.sort_order };
      return c;
    });
    setWorking(reordered);
    await Promise.all([
      supabase.from("menu_categories").update({ sort_order: b.sort_order }).eq("id", a.id),
      supabase.from("menu_categories").update({ sort_order: a.sort_order }).eq("id", b.id),
    ]);
    onChanged();
  };

  const sortedWorking = [...working].sort((a, b) => a.sort_order - b.sort_order);

  return (
    <div
      className="fixed inset-0 z-50 flex items-stretch sm:items-center sm:justify-center"
      role="dialog"
      aria-modal="true"
      aria-label="Manage categories"
    >
      <div className="absolute inset-0 bg-black/40" onClick={busy ? undefined : onClose} />
      <div className="relative z-10 w-full sm:max-w-md sm:my-8 mx-0 sm:mx-auto bg-card sm:rounded-2xl shadow-2xl border border-border max-h-[100vh] sm:max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 sm:px-6 py-4 border-b border-border">
          <div>
            <h3 className="font-display text-lg">Categories</h3>
            <p className="text-xs text-muted-foreground mt-0.5">Used to group menu items.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Close"
            className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50 disabled:opacity-50"
          >
            <XIcon className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 sm:px-6 py-5 space-y-4">
          {/* Add new */}
          <div className="flex items-stretch gap-2">
            <input
              type="text"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addCategory(); } }}
              placeholder="New category name"
              className="flex-1 bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-foreground/10 focus:border-foreground transition"
            />
            <button
              type="button"
              onClick={addCategory}
              disabled={busy || !newName.trim()}
              className="inline-flex items-center gap-1.5 bg-foreground text-background rounded-lg px-3 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50 transition"
            >
              <Plus className="h-4 w-4" /> Add
            </button>
          </div>
          {err && <div className="text-xs text-destructive">{err}</div>}

          {/* List */}
          {sortedWorking.length === 0 ? (
            <EmptyState icon={Tag} title="No categories" hint="Add your first category above." className="py-10" />
          ) : (
            <ul className="space-y-2">
              {sortedWorking.map((c, i) => (
                <CategoryRow
                  key={c.id}
                  cat={c}
                  count={counts[c.id] ?? 0}
                  canMoveUp={i > 0}
                  canMoveDown={i < sortedWorking.length - 1}
                  onRename={name => renameCategory(c.id, name)}
                  onDelete={() => removeCategory(c)}
                  onUp={() => moveCategory(c.id, -1)}
                  onDown={() => moveCategory(c.id, 1)}
                />
              ))}
            </ul>
          )}
        </div>

        <div className="border-t border-border bg-card px-5 sm:px-6 py-4 flex items-center justify-end">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-full bg-foreground text-background px-4 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

function CategoryRow({
  cat, count, canMoveUp, canMoveDown, onRename, onDelete, onUp, onDown,
}: {
  cat: MenuCategory;
  count: number;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onRename: (name: string) => void;
  onDelete: () => void;
  onUp: () => void;
  onDown: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(cat.name);
  useEffect(() => { setDraft(cat.name); }, [cat.name]);

  const commit = () => {
    setEditing(false);
    if (draft.trim() && draft.trim() !== cat.name) onRename(draft);
    else setDraft(cat.name);
  };

  return (
    <li className="flex items-center gap-2 bg-muted/30 border border-border rounded-xl px-3 py-2">
      <div className="flex flex-col">
        <button
          type="button"
          aria-label="Move up"
          onClick={onUp}
          disabled={!canMoveUp}
          className="text-muted-foreground hover:text-foreground disabled:opacity-30 leading-none"
        >
          <ChevronUp className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          aria-label="Move down"
          onClick={onDown}
          disabled={!canMoveDown}
          className="text-muted-foreground hover:text-foreground disabled:opacity-30 leading-none"
        >
          <ChevronDown className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="flex-1 min-w-0">
        {editing ? (
          <input
            autoFocus
            type="text"
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={e => {
              if (e.key === "Enter") { e.preventDefault(); commit(); }
              if (e.key === "Escape") { setDraft(cat.name); setEditing(false); }
            }}
            className="w-full bg-background border border-border rounded-md px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-foreground/10 focus:border-foreground transition"
          />
        ) : (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="text-sm font-medium truncate hover:underline underline-offset-2"
          >
            {cat.name}
          </button>
        )}
        <div className="text-[11px] text-muted-foreground">
          {count} item{count === 1 ? "" : "s"}
        </div>
      </div>
      <button
        type="button"
        onClick={() => setEditing(e => !e)}
        aria-label="Rename"
        className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60 transition"
      >
        <Pencil className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        onClick={onDelete}
        aria-label="Delete"
        disabled={count > 0}
        title={count > 0 ? "Move items out first" : "Delete category"}
        className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </li>
  );
}

/* ============ Editor Dialog ============ */
function MenuItemEditor({
  item,
  categories,
  onClose,
  onSaved,
}: {
  item: MenuItem | null;
  categories: MenuCategory[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!item;

  const [name, setName] = useState(item?.name ?? "");
  const [categoryId, setCategoryId] = useState(item?.category_id ?? categories[0]?.id ?? "");
  const [description, setDescription] = useState(item?.description ?? "");
  const [price, setPrice] = useState<string>(item ? String(item.price) : "");
  const [active, setActive] = useState<boolean>(item?.active ?? true);
  const [sortOrder, setSortOrder] = useState<string>(item ? String(item.sort_order) : "");
  const [variants, setVariants] = useState<{ name: string; price: string }[]>(
    item?.variants?.map(v => ({ name: v.name, price: String(v.price) })) ?? []
  );
  const [variantsOpen, setVariantsOpen] = useState<boolean>((item?.variants?.length ?? 0) > 0);

  // Image state — currentUrl is the persisted Supabase URL; pendingFile is what
  // the user just picked. previewUrl is whichever is most appropriate to show.
  const [currentUrl, setCurrentUrl] = useState<string | null>(item?.image_url ?? null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [pendingPreview, setPendingPreview] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // ESC closes the dialog.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Free the object URL on unmount or when the pending file changes.
  useEffect(() => {
    return () => { if (pendingPreview) URL.revokeObjectURL(pendingPreview); };
  }, [pendingPreview]);

  const displayedImage = pendingPreview ?? currentUrl;

  const handleFile = useCallback((file: File) => {
    setImageError(null);
    if (!ALLOWED_IMAGE_MIME.includes(file.type)) {
      setImageError("Unsupported file type. Use JPEG, PNG, WebP, or AVIF.");
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setImageError("Image is over 5 MB. Please choose a smaller file.");
      return;
    }
    if (pendingPreview) URL.revokeObjectURL(pendingPreview);
    setPendingFile(file);
    setPendingPreview(URL.createObjectURL(file));
  }, [pendingPreview]);

  const onFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    // Reset input so picking the same file again still fires.
    e.target.value = "";
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setImageError("That doesn't look like an image.");
      return;
    }
    handleFile(file);
  };

  const removeImage = () => {
    if (pendingPreview) URL.revokeObjectURL(pendingPreview);
    setPendingFile(null);
    setPendingPreview(null);
    setCurrentUrl(null);
    setImageError(null);
  };

  // Best-effort delete of an old image when replacing or removing.
  const deleteOldImage = async (url: string | null) => {
    if (!url) return;
    // Extract filename portion after the bucket path.
    const marker = `/${MENU_IMAGES_BUCKET}/`;
    const idx = url.indexOf(marker);
    if (idx === -1) return;
    const filename = url.slice(idx + marker.length);
    if (!filename) return;
    await supabase.storage.from(MENU_IMAGES_BUCKET).remove([filename]).catch(() => {});
  };

  const uploadPending = async (): Promise<string | null> => {
    if (!pendingFile) return null;
    const ext = pendingFile.name.includes(".")
      ? pendingFile.name.slice(pendingFile.name.lastIndexOf(".")).toLowerCase()
      : "";
    const filename = `${crypto.randomUUID()}${ext}`;
    const { error: upErr } = await supabase.storage
      .from(MENU_IMAGES_BUCKET)
      .upload(filename, pendingFile, {
        contentType: pendingFile.type,
        upsert: false,
      });
    if (upErr) throw new Error(upErr.message || "Image upload failed.");
    const { data } = supabase.storage.from(MENU_IMAGES_BUCKET).getPublicUrl(filename);
    return data.publicUrl;
  };

  const handleSave = async () => {
    setSubmitError(null);

    // Validation.
    const trimmedName = name.trim();
    if (!trimmedName) { setSubmitError("Name is required."); return; }
    if (trimmedName.length > 120) { setSubmitError("Name must be 120 characters or less."); return; }
    if (!categoryId) { setSubmitError("Pick a category."); return; }
    const priceNum = Number(price);
    if (!Number.isFinite(priceNum) || priceNum < 0) { setSubmitError("Price must be a non-negative number."); return; }

    // Clean variants: drop empty / non-positive rows.
    const cleanedVariants: MenuVariant[] = variants
      .map(v => ({ name: v.name.trim(), price: Number(v.price) }))
      .filter(v => v.name.length > 0 && Number.isFinite(v.price) && v.price > 0);

    setSaving(true);
    try {
      // Step 1: upload new image if one is pending.
      let nextImageUrl: string | null = currentUrl;
      const previousUrl = item?.image_url ?? null;
      if (pendingFile) {
        nextImageUrl = await uploadPending();
      } else if (currentUrl === null && previousUrl) {
        // User cleared the image without uploading a new one.
        nextImageUrl = null;
      }

      // Step 2: write the row. Use cast-via-unknown because the generated
      // Supabase types don't yet know about the `variants` column.
      const payload = {
        name: trimmedName,
        description: description.trim() === "" ? null : description,
        price: priceNum,
        image_url: nextImageUrl,
        category_id: categoryId,
        active,
        sort_order: sortOrder === "" ? 0 : Number(sortOrder),
        variants: cleanedVariants.length > 0 ? cleanedVariants : null,
      } as unknown as Record<string, unknown>;

      if (isEdit && item) {
        const { error } = await supabase
          .from("menu_items")
          .update(payload as never)
          .eq("id", item.id);
        if (error) throw new Error(error.message);
      } else {
        const { error } = await supabase
          .from("menu_items")
          .insert(payload as never);
        if (error) throw new Error(error.message);
      }

      // Step 3: best-effort cleanup of any orphaned previous image.
      if (pendingFile && previousUrl && previousUrl !== nextImageUrl) {
        await deleteOldImage(previousUrl);
      } else if (!pendingFile && currentUrl === null && previousUrl) {
        await deleteOldImage(previousUrl);
      }

      onSaved();
    } catch (err: any) {
      setSubmitError(err?.message ?? "Something went wrong.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!isEdit || !item) return;
    if (!confirm(`Delete "${item.name}"? This can't be undone.`)) return;
    setDeleting(true);
    try {
      const { error } = await supabase.from("menu_items").delete().eq("id", item.id);
      if (error) throw new Error(error.message);
      await deleteOldImage(item.image_url ?? null);
      onSaved();
    } catch (err: any) {
      setSubmitError(err?.message ?? "Could not delete this item.");
      setDeleting(false);
    }
  };

  // Variants helpers.
  const addVariant = () => {
    setVariantsOpen(true);
    setVariants(prev => [...prev, { name: "", price: "" }]);
  };
  const updateVariant = (i: number, patch: Partial<{ name: string; price: string }>) => {
    setVariants(prev => prev.map((v, idx) => (idx === i ? { ...v, ...patch } : v)));
  };
  const removeVariant = (i: number) => {
    setVariants(prev => prev.filter((_, idx) => idx !== i));
  };

  const busy = saving || deleting;

  return (
    <div
      className="fixed inset-0 z-50 flex items-stretch sm:items-center sm:justify-center"
      role="dialog"
      aria-modal="true"
      aria-label={isEdit ? "Edit menu item" : "New menu item"}
    >
      <div className="absolute inset-0 bg-black/40" onClick={busy ? undefined : onClose} />
      <div className="relative z-10 w-full sm:max-w-2xl sm:my-8 mx-0 sm:mx-auto bg-card sm:rounded-2xl shadow-2xl border border-border max-h-[100vh] sm:max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 sm:px-6 py-4 border-b border-border">
          <h3 className="font-display text-lg">{isEdit ? "Edit item" : "New item"}</h3>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Close"
            className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50 disabled:opacity-50"
          >
            <XIcon className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 sm:px-6 py-5 space-y-5">
          {/* Image upload */}
          <ImageUploadField
            displayedImage={displayedImage}
            error={imageError}
            onFile={handleFile}
            onDrop={onDrop}
            onRemove={removeImage}
            onPick={onFileInput}
            hasAny={!!displayedImage}
          />

          {/* Name */}
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">Name</label>
            <input
              type="text"
              required
              maxLength={120}
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Truffle Carbonara"
              className={menuInputCls}
            />
          </div>

          {/* Category */}
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">Category</label>
            <select
              required
              value={categoryId}
              onChange={e => setCategoryId(e.target.value)}
              className={menuInputCls}
            >
              {categories.length === 0 && <option value="">No categories — add one first</option>}
              {categories.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>

          {/* Description */}
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">Description</label>
            <textarea
              rows={4}
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Tell guests what makes this dish special. Line breaks are preserved."
              className={`${menuInputCls} resize-y whitespace-pre-line`}
            />
          </div>

          {/* Price + Sort order */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">Price</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">₱</span>
                <input
                  type="number"
                  required
                  min="0"
                  step="0.01"
                  value={price}
                  onChange={e => setPrice(e.target.value)}
                  placeholder="0.00"
                  className={`${menuInputCls} pl-7 tabular-nums`}
                />
              </div>
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">Sort order</label>
              <input
                type="number"
                step="1"
                value={sortOrder}
                onChange={e => setSortOrder(e.target.value)}
                placeholder="0"
                className={`${menuInputCls} tabular-nums`}
              />
            </div>
          </div>

          {/* Active toggle */}
          <div className="flex items-center justify-between bg-muted/30 border border-border rounded-xl px-4 py-3">
            <div>
              <div className="text-sm font-medium">Active</div>
              <div className="text-xs text-muted-foreground mt-0.5">
                Inactive items are hidden from the customer menu.
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={active}
              aria-pressed={active}
              aria-label="Toggle active"
              onClick={() => setActive(a => !a)}
              className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-foreground/20 ${
                active ? "bg-foreground" : "bg-muted"
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-background shadow transition ${
                  active ? "translate-x-6" : "translate-x-1"
                }`}
              />
            </button>
          </div>

          {/* Variants */}
          <VariantRowList
            variants={variants}
            open={variantsOpen}
            onToggleOpen={() => setVariantsOpen(o => !o)}
            onAdd={addVariant}
            onUpdate={updateVariant}
            onRemove={removeVariant}
          />
        </div>

        {/* Footer */}
        <div className="border-t border-border bg-card px-5 sm:px-6 py-4 flex items-center justify-between gap-3">
          <div>
            {isEdit && (
              <button
                type="button"
                onClick={handleDelete}
                disabled={busy}
                className="inline-flex items-center gap-1.5 text-destructive hover:bg-destructive/10 rounded-lg px-3 py-2 text-sm disabled:opacity-50"
              >
                <Trash2 className="h-4 w-4" />
                {deleting ? "Deleting…" : "Delete"}
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            {submitError && (
              <span className="text-xs text-destructive mr-2">{submitError}</span>
            )}
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="rounded-full px-4 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-muted/50 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={busy}
              className="rounded-full bg-foreground text-background px-4 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50"
            >
              {saving ? "Saving…" : isEdit ? "Save changes" : "Create item"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ============ Image upload field ============ */
function ImageUploadField({
  displayedImage,
  error,
  onFile,
  onDrop,
  onRemove,
  onPick,
  hasAny,
}: {
  displayedImage: string | null;
  error: string | null;
  onFile: (file: File) => void;
  onDrop: (e: React.DragEvent) => void;
  onRemove: () => void;
  onPick: (e: React.ChangeEvent<HTMLInputElement>) => void;
  hasAny: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  return (
    <div>
      <label className="block text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">Image</label>
      <div
        role="button"
        tabIndex={0}
        aria-label="Upload image"
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { setDragOver(false); onDrop(e); }}
        className={`relative aspect-[4/3] w-full rounded-xl border-2 border-dashed flex items-center justify-center overflow-hidden bg-muted/30 cursor-pointer transition ${
          dragOver ? "border-foreground bg-muted/60" : "border-border hover:border-foreground/40"
        }`}
      >
        {displayedImage ? (
          <img src={displayedImage} alt="Preview" className="w-full h-full object-cover" />
        ) : (
          <div className="flex flex-col items-center justify-center text-muted-foreground text-sm gap-2 px-4 text-center">
            <Upload className="h-7 w-7" />
            <div>
              <span className="font-medium text-foreground">Click to upload</span> or drag &amp; drop
            </div>
            <div className="text-xs">JPEG, PNG, WebP, or AVIF · up to 5 MB</div>
          </div>
        )}
        <input
          ref={inputRef}
          type="file"
          accept={ALLOWED_IMAGE_MIME.join(",")}
          onChange={onPick}
          className="hidden"
        />
      </div>
      {hasAny && (
        <div className="mt-2 flex items-center gap-3 text-xs">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="text-foreground underline-offset-2 hover:underline"
          >
            Replace
          </button>
          <button
            type="button"
            onClick={onRemove}
            className="text-destructive underline-offset-2 hover:underline"
          >
            Remove
          </button>
        </div>
      )}
      {error && (
        <div className="mt-2 text-xs text-destructive">{error}</div>
      )}
    </div>
  );
}

/* ============ Variant rows ============ */
function VariantRowList({
  variants,
  open,
  onToggleOpen,
  onAdd,
  onUpdate,
  onRemove,
}: {
  variants: { name: string; price: string }[];
  open: boolean;
  onToggleOpen: () => void;
  onAdd: () => void;
  onUpdate: (i: number, patch: Partial<{ name: string; price: string }>) => void;
  onRemove: (i: number) => void;
}) {
  return (
    <div className="border border-border rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 bg-muted/30">
        <button
          type="button"
          onClick={onToggleOpen}
          className="inline-flex items-center gap-2 text-sm font-medium"
          aria-expanded={open}
        >
          {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          Variants
          <span className="text-xs text-muted-foreground font-normal">
            ({variants.length})
          </span>
        </button>
        <button
          type="button"
          onClick={onAdd}
          className="inline-flex items-center gap-1 text-xs font-medium text-foreground hover:opacity-80"
        >
          <Plus className="h-3.5 w-3.5" /> Add variant
        </button>
      </div>
      {open && (
        <div className="p-4 space-y-2.5">
          {variants.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No variants — customer adds this item directly to cart.
            </p>
          ) : (
            variants.map((v, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  type="text"
                  value={v.name}
                  onChange={e => onUpdate(i, { name: e.target.value })}
                  placeholder="Variant name (e.g. Large)"
                  className={`${menuInputCls} flex-1`}
                />
                <div className="relative w-32">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">₱</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={v.price}
                    onChange={e => onUpdate(i, { price: e.target.value })}
                    placeholder="0.00"
                    className={`${menuInputCls} pl-7 tabular-nums`}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => onRemove(i)}
                  aria-label="Remove variant"
                  className="p-2 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                >
                  <XIcon className="h-4 w-4" />
                </button>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

/* ============ Slots Manager ============ */
type TimeSlot = {
  id: string;
  slot_date: string;
  slot_time: string;
  capacity: number;
  seats_taken: number;
  is_open: boolean;
};

function SlotsTab() {
  const [slots, setSlots] = useState<TimeSlot[]>([]);
  const [loading, setLoading] = useState(true);
  const [creatorOpen, setCreatorOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("time_slots")
      .select("*")
      .gte("slot_date", format(new Date(), "yyyy-MM-dd"))
      .order("slot_date")
      .order("slot_time");
    setSlots((data ?? []) as TimeSlot[]);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const toggle = async (id: string, isOpen: boolean) => {
    setSlots(prev => prev.map(s => (s.id === id ? { ...s, is_open: !isOpen } : s)));
    await supabase.from("time_slots").update({ is_open: !isOpen }).eq("id", id);
  };
  const updateCap = async (id: string, capacity: number) => {
    setSlots(prev => prev.map(s => (s.id === id ? { ...s, capacity } : s)));
    await supabase.from("time_slots").update({ capacity }).eq("id", id);
  };
  const deleteSlot = async (s: TimeSlot) => {
    if (s.seats_taken > 0) {
      alert("This slot already has bookings. Close it instead of deleting.");
      return;
    }
    if (!confirm(`Delete the ${s.slot_time.slice(0, 5)} slot on ${format(new Date(s.slot_date), "EEE, MMM d")}?`)) return;
    setSlots(prev => prev.filter(p => p.id !== s.id));
    await supabase.from("time_slots").delete().eq("id", s.id);
  };

  const grouped = useMemo(() => {
    const g: Record<string, TimeSlot[]> = {};
    slots.forEach(s => { (g[s.slot_date] ||= []).push(s); });
    return g;
  }, [slots]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-xl">Upcoming slots</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {loading
              ? "Loading…"
              : `${slots.length} slot${slots.length === 1 ? "" : "s"} across ${Object.keys(grouped).length} day${Object.keys(grouped).length === 1 ? "" : "s"}.`}
          </p>
        </div>
        <button
          onClick={() => setCreatorOpen(true)}
          className="inline-flex items-center gap-1.5 bg-foreground text-background rounded-full px-4 py-2 text-sm font-medium hover:opacity-90 transition"
        >
          <CalendarPlus className="h-4 w-4" />
          New slots
        </button>
      </div>

      {/* Body */}
      {loading ? (
        <div className="bg-card border border-border rounded-2xl py-16 text-center text-muted-foreground text-sm shadow-sm">
          Loading slots…
        </div>
      ) : Object.keys(grouped).length === 0 ? (
        <div className="bg-card border border-border rounded-2xl shadow-sm">
          <EmptyState
            icon={CalendarClock}
            title="No upcoming slots"
            hint="Create slots so guests can book a table."
            action={
              <button
                onClick={() => setCreatorOpen(true)}
                className="inline-flex items-center gap-1.5 bg-foreground text-background rounded-full px-4 py-2 text-sm font-medium hover:opacity-90 transition"
              >
                <CalendarPlus className="h-4 w-4" /> Create slots
              </button>
            }
          />
        </div>
      ) : (
        Object.entries(grouped).map(([date, ss]) => {
          const totalSeats = ss.reduce((s, x) => s + x.capacity, 0);
          const takenSeats = ss.reduce((s, x) => s + x.seats_taken, 0);
          return (
            <div key={date} className="bg-card border border-border rounded-2xl p-5 lg:p-6 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-display text-lg lg:text-xl">{format(new Date(date), "EEEE, MMM d")}</h3>
                <span className="text-xs text-muted-foreground">
                  {takenSeats}/{totalSeats} seats · {ss.length} slot{ss.length === 1 ? "" : "s"}
                </span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2.5">
                {ss.map(s => (
                  <SlotCard
                    key={s.id}
                    slot={s}
                    onToggle={() => toggle(s.id, s.is_open)}
                    onUpdateCap={cap => updateCap(s.id, cap)}
                    onDelete={() => deleteSlot(s)}
                  />
                ))}
              </div>
            </div>
          );
        })
      )}

      {creatorOpen && (
        <SlotCreator
          existing={slots}
          onClose={() => setCreatorOpen(false)}
          onCreated={() => { setCreatorOpen(false); load(); }}
        />
      )}
    </div>
  );
}

function SlotCard({
  slot, onToggle, onUpdateCap, onDelete,
}: {
  slot: TimeSlot;
  onToggle: () => void;
  onUpdateCap: (cap: number) => void;
  onDelete: () => void;
}) {
  const full = slot.seats_taken >= slot.capacity;
  return (
    <div
      className={`relative p-3 rounded-xl border transition ${
        slot.is_open
          ? full
            ? "border-border bg-mustard/10"
            : "border-border bg-background"
          : "border-border bg-muted/30"
      }`}
    >
      <button
        type="button"
        onClick={onDelete}
        aria-label="Delete slot"
        className="absolute top-1.5 right-1.5 p-1 rounded-md text-muted-foreground/60 hover:text-destructive hover:bg-destructive/10 transition"
      >
        <XIcon className="h-3 w-3" />
      </button>
      <div className={`font-display text-base leading-none ${slot.is_open ? "" : "text-muted-foreground"}`}>
        {slot.slot_time.slice(0, 5)}
      </div>
      <div className="text-[10px] text-muted-foreground mt-1">
        {slot.seats_taken}/{slot.capacity}
        {full && slot.is_open && <span className="ml-1 font-medium text-charcoal">· full</span>}
      </div>
      <input
        type="number"
        min={0}
        value={slot.capacity}
        onChange={e => onUpdateCap(parseInt(e.target.value) || 0)}
        className="mt-2 w-full bg-background border border-border rounded-md px-2 py-1 text-xs tabular-nums focus:outline-none focus:ring-2 focus:ring-foreground/10 focus:border-foreground transition"
      />
      <button
        onClick={onToggle}
        className={`mt-1.5 w-full rounded-full py-1 text-[11px] font-medium transition ${
          slot.is_open
            ? "bg-foreground text-background hover:opacity-90"
            : "bg-mustard/30 text-charcoal hover:bg-mustard/40"
        }`}
      >
        {slot.is_open ? "Close" : "Open"}
      </button>
    </div>
  );
}

function SlotCreator({
  existing, onClose, onCreated,
}: { existing: TimeSlot[]; onClose: () => void; onCreated: () => void }) {
  const todayStr = format(new Date(), "yyyy-MM-dd");
  const [mode, setMode] = useState<"single" | "range">("single");
  const [date, setDate] = useState(todayStr);
  const [endDate, setEndDate] = useState(todayStr);
  const [startTime, setStartTime] = useState("18:00");
  const [endTime, setEndTime] = useState("20:00");
  const [interval, setInterval] = useState("30");
  const [capacity, setCapacity] = useState("10");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, busy]);

  const cls = "w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-foreground/10 focus:border-foreground transition";

  const planned = useMemo(() => {
    const cap = Number(capacity) || 0;
    if (cap <= 0) return [];
    const dates: string[] = [];
    if (mode === "single") {
      dates.push(date);
    } else {
      const start = new Date(date);
      const end = new Date(endDate);
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return [];
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        dates.push(format(d, "yyyy-MM-dd"));
      }
    }
    const [sh, sm] = startTime.split(":").map(Number);
    const [eh, em] = endTime.split(":").map(Number);
    const step = Math.max(5, Number(interval) || 0);
    if (!Number.isFinite(sh) || !Number.isFinite(eh)) return [];
    const startMin = sh * 60 + sm;
    const endMin = eh * 60 + em;
    if (endMin < startMin) return [];

    const times: string[] = [];
    for (let t = startMin; t <= endMin; t += step) {
      const h = String(Math.floor(t / 60)).padStart(2, "0");
      const m = String(t % 60).padStart(2, "0");
      times.push(`${h}:${m}:00`);
    }

    const existingKey = new Set(existing.map(s => `${s.slot_date}|${s.slot_time}`));
    const rows: { slot_date: string; slot_time: string }[] = [];
    for (const d of dates) for (const t of times) {
      const key = `${d}|${t}`;
      if (!existingKey.has(key)) rows.push({ slot_date: d, slot_time: t });
    }
    return rows;
  }, [mode, date, endDate, startTime, endTime, interval, capacity, existing]);

  const skipped = useMemo(() => {
    // How many would-be slots got deduped against existing ones.
    if (planned.length === 0) return 0;
    const [sh, sm] = startTime.split(":").map(Number);
    const [eh, em] = endTime.split(":").map(Number);
    const step = Math.max(5, Number(interval) || 0);
    if (!Number.isFinite(sh) || !Number.isFinite(eh)) return 0;
    const startMin = sh * 60 + sm;
    const endMin = eh * 60 + em;
    if (endMin < startMin) return 0;
    const perDay = Math.floor((endMin - startMin) / step) + 1;

    const dayCount = mode === "single"
      ? 1
      : (() => {
          const start = new Date(date);
          const end = new Date(endDate);
          if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return 0;
          return Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
        })();

    return Math.max(0, perDay * dayCount - planned.length);
  }, [planned, mode, date, endDate, startTime, endTime, interval]);

  const submit = async () => {
    setErr(null);
    const cap = Number(capacity);
    if (!Number.isFinite(cap) || cap <= 0) { setErr("Capacity must be a positive number."); return; }
    if (planned.length === 0) { setErr("No new slots would be created with these settings."); return; }

    setBusy(true);
    try {
      const rows = planned.map(r => ({ slot_date: r.slot_date, slot_time: r.slot_time, capacity: cap, is_open: true }));
      const { error } = await supabase.from("time_slots").insert(rows);
      if (error) throw new Error(error.message);
      onCreated();
    } catch (e: any) {
      setErr(e?.message ?? "Could not create slots.");
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-stretch sm:items-center sm:justify-center"
      role="dialog"
      aria-modal="true"
      aria-label="Create slots"
    >
      <div className="absolute inset-0 bg-black/40" onClick={busy ? undefined : onClose} />
      <div className="relative z-10 w-full sm:max-w-xl sm:my-8 mx-0 sm:mx-auto bg-card sm:rounded-2xl shadow-2xl border border-border max-h-[100vh] sm:max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 sm:px-6 py-4 border-b border-border">
          <h3 className="font-display text-lg">New slots</h3>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Close"
            className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50 disabled:opacity-50"
          >
            <XIcon className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 sm:px-6 py-5 space-y-5">
          {/* Mode toggle */}
          <div className="flex p-1 bg-muted/40 rounded-full text-xs font-medium">
            {(["single", "range"] as const).map(m => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={`flex-1 px-3 py-1.5 rounded-full transition ${
                  mode === m ? "bg-card shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {m === "single" ? "One day" : "Date range"}
              </button>
            ))}
          </div>

          {/* Dates */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">
                {mode === "single" ? "Date" : "From"}
              </label>
              <input type="date" min={todayStr} value={date} onChange={e => setDate(e.target.value)} className={cls} />
            </div>
            {mode === "range" && (
              <div>
                <label className="block text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">To</label>
                <input type="date" min={date} value={endDate} onChange={e => setEndDate(e.target.value)} className={cls} />
              </div>
            )}
          </div>

          {/* Times */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">Start time</label>
              <input type="time" value={startTime} onChange={e => setStartTime(e.target.value)} className={cls} />
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">End time</label>
              <input type="time" value={endTime} onChange={e => setEndTime(e.target.value)} className={cls} />
            </div>
          </div>

          {/* Interval + capacity */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">Interval (minutes)</label>
              <input type="number" min={5} step={5} value={interval} onChange={e => setInterval(e.target.value)} className={`${cls} tabular-nums`} />
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">Capacity per slot</label>
              <input type="number" min={1} value={capacity} onChange={e => setCapacity(e.target.value)} className={`${cls} tabular-nums`} />
            </div>
          </div>

          {/* Preview */}
          <div className="rounded-xl bg-muted/30 border border-border px-4 py-3 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Will create</span>
              <span className="font-semibold text-foreground">{planned.length} slot{planned.length === 1 ? "" : "s"}</span>
            </div>
            {skipped > 0 && (
              <div className="mt-1 text-muted-foreground">
                {skipped} duplicate{skipped === 1 ? "" : "s"} will be skipped.
              </div>
            )}
            {planned.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {planned.slice(0, 12).map((p, i) => (
                  <span key={i} className="px-2 py-0.5 rounded-full bg-card border border-border text-[10px] tabular-nums">
                    {p.slot_time.slice(0, 5)}
                  </span>
                ))}
                {planned.length > 12 && (
                  <span className="px-2 py-0.5 text-[10px] text-muted-foreground">+{planned.length - 12} more</span>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="border-t border-border bg-card px-5 sm:px-6 py-4 flex items-center justify-end gap-2">
          {err && <span className="text-xs text-destructive mr-auto">{err}</span>}
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-full px-4 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-muted/50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={busy || planned.length === 0}
            className="rounded-full bg-foreground text-background px-4 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50"
          >
            {busy ? "Creating…" : `Create ${planned.length} slot${planned.length === 1 ? "" : "s"}`}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ============ Contacts ============ */
type ContactRow = {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  facebook_handle: string | null;
  instagram_handle: string | null;
  source: string | null;
  tags: string[];
  notes: string | null;
  created_at: string;
  updated_at: string;
  total_bookings: number;
  confirmed_bookings: number;
  lifetime_spend: number;
  last_visit_date: string | null;
  first_booking_at: string | null;
  channels: string[];
};

function ContactsTab() {
  const [contacts, setContacts] = useState<ContactRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [tagFilter, setTagFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<"recent" | "spend" | "visits" | "name">("recent");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("crm_contacts_with_stats")
      .select("*")
      .order("updated_at", { ascending: false });
    setContacts((data ?? []) as ContactRow[]);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const tagCounts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const c of contacts) for (const t of c.tags) m[t] = (m[t] ?? 0) + 1;
    return m;
  }, [contacts]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    let rows = contacts.filter(c => {
      if (tagFilter !== "all" && !c.tags.includes(tagFilter)) return false;
      if (!needle) return true;
      return (
        c.full_name?.toLowerCase().includes(needle) ||
        c.email?.toLowerCase().includes(needle) ||
        c.phone?.toLowerCase().includes(needle) ||
        c.facebook_handle?.toLowerCase().includes(needle) ||
        c.instagram_handle?.toLowerCase().includes(needle)
      );
    });
    rows = [...rows].sort((a, b) => {
      switch (sortBy) {
        case "spend": return Number(b.lifetime_spend) - Number(a.lifetime_spend);
        case "visits": return b.confirmed_bookings - a.confirmed_bookings;
        case "name": return a.full_name.localeCompare(b.full_name);
        case "recent":
        default:
          return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
      }
    });
    return rows;
  }, [contacts, query, tagFilter, sortBy]);

  const totalSpend = useMemo(
    () => contacts.reduce((s, c) => s + Number(c.lifetime_spend || 0), 0),
    [contacts]
  );

  return (
    <div className="space-y-6">
      {/* Summary strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <MiniStat label="Contacts" value={String(contacts.length)} icon={Users} loading={loading} />
        <MiniStat label="Lifetime spend" value={`₱${totalSpend.toLocaleString("en-PH", { maximumFractionDigits: 0 })}`} icon={TrendingUp} loading={loading} />
        <MiniStat label="With email" value={String(contacts.filter(c => c.email).length)} icon={Mail} loading={loading} />
        <MiniStat label="From chat" value={String(contacts.filter(c => c.channels.some(ch => ch === "messenger" || ch === "instagram")).length)} icon={Facebook} loading={loading} />
      </div>

      {/* Filters */}
      <div className="bg-card border border-border rounded-2xl p-4 shadow-sm space-y-3">
        <div className="relative">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="search"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search by name, email, phone, FB or IG handle…"
            className="w-full bg-background border border-border rounded-lg pl-10 pr-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-foreground/10 focus:border-foreground transition"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2 justify-between">
          <div className="flex flex-wrap gap-1.5">
            <CategoryChip
              label="All tags"
              count={contacts.length}
              active={tagFilter === "all"}
              onClick={() => setTagFilter("all")}
            />
            {Object.entries(tagCounts).map(([t, n]) => (
              <CategoryChip
                key={t}
                label={t}
                count={n}
                active={tagFilter === t}
                onClick={() => setTagFilter(t)}
              />
            ))}
          </div>
          <select
            value={sortBy}
            onChange={e => setSortBy(e.target.value as typeof sortBy)}
            className="bg-background border border-border rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-foreground/10 focus:border-foreground transition"
          >
            <option value="recent">Recently updated</option>
            <option value="spend">Top spenders</option>
            <option value="visits">Most visits</option>
            <option value="name">Name A–Z</option>
          </select>
        </div>
      </div>

      {/* List */}
      {loading ? (
        <div className="bg-card border border-border rounded-2xl py-16 text-center text-muted-foreground text-sm shadow-sm">Loading contacts…</div>
      ) : filtered.length === 0 ? (
        <div className="bg-card border border-border rounded-2xl shadow-sm">
          <EmptyState
            icon={contacts.length === 0 ? Users : Search}
            title={contacts.length === 0 ? "No contacts yet" : "No matches"}
            hint={contacts.length === 0 ? "Contacts auto-populate from confirmed bookings." : "Try a different search or clear the tag filter."}
          />
        </div>
      ) : (
        <div className="bg-card border border-border rounded-2xl shadow-sm overflow-hidden">
          <ul className="divide-y divide-border">
            {filtered.map(c => (
              <li key={c.id}>
                <button
                  onClick={() => setSelectedId(c.id)}
                  className="w-full text-left px-5 py-4 flex items-center justify-between gap-4 hover:bg-muted/30 transition"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium truncate">{c.full_name}</span>
                      {c.tags.map(t => (
                        <span key={t} className="px-2 py-0.5 rounded-full bg-mustard/25 text-charcoal text-[10px] font-medium">
                          {t}
                        </span>
                      ))}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5 truncate flex items-center gap-3 flex-wrap">
                      {c.email && <span className="inline-flex items-center gap-1"><Mail className="h-3 w-3" /> {c.email}</span>}
                      {c.phone && <span className="inline-flex items-center gap-1"><Phone className="h-3 w-3" /> {c.phone}</span>}
                      {c.facebook_handle && <span className="inline-flex items-center gap-1"><Facebook className="h-3 w-3" /> {c.facebook_handle.slice(0, 14)}{c.facebook_handle.length > 14 ? "…" : ""}</span>}
                      {c.instagram_handle && <span className="inline-flex items-center gap-1"><Instagram className="h-3 w-3" /> {c.instagram_handle}</span>}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="font-display font-semibold tabular-nums">₱{Number(c.lifetime_spend).toLocaleString("en-PH", { maximumFractionDigits: 0 })}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {c.confirmed_bookings} visit{c.confirmed_bookings === 1 ? "" : "s"}
                      {c.last_visit_date && <> · last {format(new Date(c.last_visit_date), "MMM d")}</>}
                    </div>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {selectedId && (
        <ContactDrawer
          id={selectedId}
          onClose={() => setSelectedId(null)}
          onSaved={() => { setSelectedId(null); load(); }}
        />
      )}
    </div>
  );
}

function MiniStat({
  label, value, icon: Icon, loading,
}: { label: string; value: string; icon: React.ComponentType<{ className?: string }>; loading: boolean }) {
  return (
    <div className="bg-card border border-border rounded-2xl px-4 py-3 shadow-sm flex items-center gap-3">
      <div className="bg-muted rounded-lg p-2 text-muted-foreground shrink-0">
        <Icon className="h-3.5 w-3.5" />
      </div>
      <div className="min-w-0">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium truncate">{label}</div>
        <div className="text-lg font-display font-semibold tracking-tight truncate">
          {loading ? <span className="text-muted-foreground/40">—</span> : value}
        </div>
      </div>
    </div>
  );
}

/* ============ Contact detail drawer ============ */
function ContactDrawer({
  id, onClose, onSaved,
}: { id: string; onClose: () => void; onSaved: () => void }) {
  const [contact, setContact] = useState<ContactRow | null>(null);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<{ full_name: string; email: string; phone: string; facebook_handle: string; instagram_handle: string; notes: string; tagsCsv: string }>({
    full_name: "", email: "", phone: "", facebook_handle: "", instagram_handle: "", notes: "", tagsCsv: "",
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data: c } = await supabase
      .from("crm_contacts_with_stats")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    const cast = c as ContactRow | null;
    setContact(cast);
    if (cast) {
      setDraft({
        full_name: cast.full_name ?? "",
        email: cast.email ?? "",
        phone: cast.phone ?? "",
        facebook_handle: cast.facebook_handle ?? "",
        instagram_handle: cast.instagram_handle ?? "",
        notes: cast.notes ?? "",
        tagsCsv: (cast.tags ?? []).join(", "),
      });

      // Pull this contact's bookings — match across email/phone/fb_handle.
      const filters: string[] = [];
      if (cast.email) filters.push(`customer_email.ilike.${cast.email}`);
      if (cast.phone) filters.push(`customer_phone.eq.${cast.phone}`);
      if (cast.facebook_handle) filters.push(`facebook_handle.eq.${cast.facebook_handle}`);

      if (filters.length > 0) {
        const { data: bk } = await supabase
          .from("bookings")
          .select("*, time_slots(slot_date, slot_time), booking_items(item_name, quantity), payments(id, status, reference_number, screenshot_url)")
          .or(filters.join(","))
          .order("created_at", { ascending: false });
        setBookings(((bk ?? []) as unknown) as Booking[]);
      } else {
        setBookings([]);
      }
    }
    setLoading(false);
  }, [id]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, busy]);

  const save = async () => {
    setErr(null);
    const trimmedName = draft.full_name.trim();
    if (!trimmedName) { setErr("Name is required."); return; }
    setBusy(true);
    try {
      const tags = draft.tagsCsv
        .split(",")
        .map(t => t.trim().toLowerCase())
        .filter(Boolean)
        .filter((t, i, arr) => arr.indexOf(t) === i);
      const { error } = await supabase
        .from("crm_contacts")
        .update({
          full_name: trimmedName,
          email: draft.email.trim() || null,
          phone: draft.phone.trim() || null,
          facebook_handle: draft.facebook_handle.trim() || null,
          instagram_handle: draft.instagram_handle.trim() || null,
          notes: draft.notes.trim() || null,
          tags,
        })
        .eq("id", id);
      if (error) throw new Error(error.message);
      onSaved();
    } catch (e: any) {
      setErr(e?.message ?? "Could not save contact.");
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!contact) return;
    if (!confirm(`Delete ${contact.full_name}? Their bookings stay, but they will reappear here on the next booking sync.`)) return;
    setBusy(true);
    const { error } = await supabase.from("crm_contacts").delete().eq("id", id);
    if (error) { setErr(error.message); setBusy(false); return; }
    onSaved();
  };

  return (
    <div className="fixed inset-0 z-50 flex" role="dialog" aria-modal="true" aria-label="Contact detail">
      <div className="absolute inset-0 bg-black/40" onClick={busy ? undefined : onClose} />
      <aside className="relative ml-auto w-full sm:w-[32rem] bg-card border-l border-border shadow-2xl flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h3 className="font-display text-lg">Contact</h3>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Close"
            className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50 disabled:opacity-50"
          >
            <XIcon className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-5 space-y-6">
          {loading || !contact ? (
            <div className="py-12 text-center text-muted-foreground text-sm">Loading…</div>
          ) : (
            <>
              {/* Header */}
              <div>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-display text-2xl tracking-tight">{contact.full_name}</div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {contact.tags.map(t => (
                        <span key={t} className="px-2 py-0.5 rounded-full bg-mustard/25 text-charcoal text-[10px] font-medium">
                          {t}
                        </span>
                      ))}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setEditing(e => !e)}
                    className="inline-flex items-center gap-1.5 text-xs bg-muted/60 hover:bg-muted text-foreground rounded-full px-3 py-1.5 font-medium transition"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                    {editing ? "Cancel" : "Edit"}
                  </button>
                </div>
              </div>

              {/* Lifetime stats */}
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-muted/30 border border-border rounded-xl p-3">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Lifetime</div>
                  <div className="font-display text-lg font-semibold tabular-nums">
                    ₱{Number(contact.lifetime_spend).toLocaleString("en-PH", { maximumFractionDigits: 0 })}
                  </div>
                </div>
                <div className="bg-muted/30 border border-border rounded-xl p-3">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Visits</div>
                  <div className="font-display text-lg font-semibold tabular-nums">{contact.confirmed_bookings}</div>
                </div>
                <div className="bg-muted/30 border border-border rounded-xl p-3">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Last visit</div>
                  <div className="font-display text-lg font-semibold">
                    {contact.last_visit_date ? format(new Date(contact.last_visit_date), "MMM d") : <span className="text-muted-foreground">—</span>}
                  </div>
                </div>
              </div>

              {/* Edit form OR read view */}
              {editing ? (
                <div className="space-y-3">
                  <ContactField label="Full name" value={draft.full_name} onChange={v => setDraft(d => ({ ...d, full_name: v }))} />
                  <ContactField label="Email" type="email" value={draft.email} onChange={v => setDraft(d => ({ ...d, email: v }))} />
                  <ContactField label="Phone" value={draft.phone} onChange={v => setDraft(d => ({ ...d, phone: v }))} />
                  <ContactField label="Facebook handle" value={draft.facebook_handle} onChange={v => setDraft(d => ({ ...d, facebook_handle: v }))} />
                  <ContactField label="Instagram handle" value={draft.instagram_handle} onChange={v => setDraft(d => ({ ...d, instagram_handle: v }))} />
                  <ContactField label="Tags (comma-separated)" value={draft.tagsCsv} onChange={v => setDraft(d => ({ ...d, tagsCsv: v }))} />
                  <div>
                    <label className="block text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">Notes</label>
                    <textarea
                      rows={4}
                      value={draft.notes}
                      onChange={e => setDraft(d => ({ ...d, notes: e.target.value }))}
                      className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-foreground/10 focus:border-foreground transition resize-y whitespace-pre-line"
                    />
                  </div>
                  {err && <div className="text-xs text-destructive">{err}</div>}
                </div>
              ) : (
                <div className="space-y-2 text-sm">
                  <ContactLine icon={Mail} value={contact.email} />
                  <ContactLine icon={Phone} value={contact.phone} />
                  <ContactLine icon={Facebook} value={contact.facebook_handle} />
                  <ContactLine icon={Instagram} value={contact.instagram_handle} />
                  {contact.notes && (
                    <div className="pt-3 border-t border-border">
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Notes</div>
                      <div className="whitespace-pre-line">{contact.notes}</div>
                    </div>
                  )}
                </div>
              )}

              {/* Linked bookings */}
              <div className="border-t border-border pt-5">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="font-display text-base">Bookings</h4>
                  <span className="text-xs text-muted-foreground">{bookings.length}</span>
                </div>
                {bookings.length === 0 ? (
                  <div className="text-xs text-muted-foreground">No linked bookings yet.</div>
                ) : (
                  <ul className="space-y-2">
                    {bookings.map(b => (
                      <li key={b.id} className="bg-muted/30 border border-border rounded-xl px-3 py-2 flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-sm font-medium flex items-center gap-2">
                            <span className="font-mono text-xs text-muted-foreground">{b.reference_code}</span>
                            <StatusBadge status={b.status} />
                          </div>
                          <div className="text-[11px] text-muted-foreground mt-0.5">
                            {b.time_slots
                              ? <>{format(new Date(b.time_slots.slot_date), "EEE, MMM d")} · {b.time_slots.slot_time.slice(0, 5)}</>
                              : "—"}
                            {" · "}{b.group_size} guest{b.group_size === 1 ? "" : "s"}
                          </div>
                        </div>
                        <div className="text-sm font-semibold tabular-nums shrink-0">
                          ₱{Number(b.total_amount).toFixed(0)}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}
        </div>

        {editing && (
          <div className="border-t border-border bg-card px-5 py-4 flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={remove}
              disabled={busy}
              className="inline-flex items-center gap-1.5 text-destructive hover:bg-destructive/10 rounded-lg px-3 py-2 text-sm disabled:opacity-50"
            >
              <Trash2 className="h-4 w-4" /> Delete
            </button>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setEditing(false)}
                disabled={busy}
                className="rounded-full px-4 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-muted/50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={save}
                disabled={busy}
                className="rounded-full bg-foreground text-background px-4 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50"
              >
                {busy ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        )}
      </aside>
    </div>
  );
}

function ContactField({
  label, value, onChange, type,
}: { label: string; value: string; onChange: (v: string) => void; type?: string }) {
  return (
    <div>
      <label className="block text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">{label}</label>
      <input
        type={type ?? "text"}
        value={value}
        onChange={e => onChange(e.target.value)}
        className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-foreground/10 focus:border-foreground transition"
      />
    </div>
  );
}

function ContactLine({
  icon: Icon, value,
}: { icon: React.ComponentType<{ className?: string }>; value: string | null }) {
  if (!value) return null;
  return (
    <div className="flex items-center gap-2 text-foreground">
      <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
      <span className="truncate">{value}</span>
    </div>
  );
}

/* ============ Knowledge / FAQ ============ */
type FaqEntry = {
  id: string;
  question: string;
  answer: string;
  topic: string | null;
  tags: string[];
  priority: number;
  active: boolean;
  created_at: string;
  updated_at: string;
};

function KnowledgeTab() {
  const [items, setItems] = useState<FaqEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [topicFilter, setTopicFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<FaqEntry | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("faq")
      .select("*")
      .order("priority", { ascending: false })
      .order("topic")
      .order("question");
    setItems((data ?? []) as FaqEntry[]);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const topicCounts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const f of items) {
      const t = f.topic ?? "Other";
      m[t] = (m[t] ?? 0) + 1;
    }
    return m;
  }, [items]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return items.filter(f => {
      if (!showInactive && !f.active) return false;
      if (topicFilter !== "all" && (f.topic ?? "Other") !== topicFilter) return false;
      if (!needle) return true;
      return (
        f.question.toLowerCase().includes(needle) ||
        f.answer.toLowerCase().includes(needle) ||
        f.tags.some(t => t.toLowerCase().includes(needle))
      );
    });
  }, [items, topicFilter, search, showInactive]);

  const toggleActive = async (entry: FaqEntry, e: React.MouseEvent) => {
    e.stopPropagation();
    setItems(prev => prev.map(p => (p.id === entry.id ? { ...p, active: !p.active } : p)));
    const { error } = await supabase.from("faq").update({ active: !entry.active }).eq("id", entry.id);
    if (error) setItems(prev => prev.map(p => (p.id === entry.id ? { ...p, active: entry.active } : p)));
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="font-display text-xl">Chatbot FAQ</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {loading
              ? "Loading…"
              : `${items.filter(f => f.active).length} active entr${items.filter(f => f.active).length === 1 ? "y" : "ies"} · used by the Messenger / Instagram bot.`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowInactive(s => !s)}
            className={`inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium transition ${
              showInactive
                ? "bg-foreground text-background hover:opacity-90"
                : "bg-muted/60 hover:bg-muted text-foreground"
            }`}
          >
            <EyeOff className="h-4 w-4" />
            {showInactive ? "Showing inactive" : "Hide inactive"}
          </button>
          <button
            onClick={() => { setEditing(null); setEditorOpen(true); }}
            className="inline-flex items-center gap-1.5 bg-foreground text-background rounded-full px-4 py-2 text-sm font-medium hover:opacity-90 transition"
          >
            <Plus className="h-4 w-4" />
            New entry
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-card border border-border rounded-2xl p-4 shadow-sm space-y-3">
        <div className="relative">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="search"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search questions, answers, or tags…"
            className="w-full bg-background border border-border rounded-lg pl-10 pr-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-foreground/10 focus:border-foreground transition"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          <CategoryChip
            label="All topics"
            count={items.length}
            active={topicFilter === "all"}
            onClick={() => setTopicFilter("all")}
          />
          {FAQ_TOPICS.filter(t => topicCounts[t]).map(t => (
            <CategoryChip
              key={t}
              label={t}
              count={topicCounts[t] ?? 0}
              active={topicFilter === t}
              onClick={() => setTopicFilter(t)}
            />
          ))}
        </div>
      </div>

      {/* List */}
      {loading ? (
        <div className="bg-card border border-border rounded-2xl py-16 text-center text-muted-foreground text-sm shadow-sm">Loading FAQ…</div>
      ) : filtered.length === 0 ? (
        <div className="bg-card border border-border rounded-2xl shadow-sm">
          <EmptyState
            icon={items.length === 0 ? BookOpen : Search}
            title={items.length === 0 ? "No FAQ entries yet" : "No matches"}
            hint={items.length === 0 ? 'Click "New entry" to add the first answer the chatbot can use.' : "Try a different search or topic filter."}
            action={items.length === 0 ? (
              <button
                onClick={() => { setEditing(null); setEditorOpen(true); }}
                className="inline-flex items-center gap-1.5 bg-foreground text-background rounded-full px-4 py-2 text-sm font-medium hover:opacity-90 transition"
              >
                <Plus className="h-4 w-4" /> New entry
              </button>
            ) : undefined}
          />
        </div>
      ) : (
        <ul className="space-y-3">
          {filtered.map(f => (
            <li
              key={f.id}
              className={`bg-card border border-border rounded-2xl p-5 shadow-sm hover:shadow-md transition cursor-pointer ${
                f.active ? "" : "opacity-60"
              }`}
              onClick={() => { setEditing(f); setEditorOpen(true); }}
            >
              <div className="flex items-start justify-between gap-3 mb-2 flex-wrap">
                <div className="min-w-0 flex-1">
                  <div className="font-display text-base leading-snug">{f.question}</div>
                  <div className="mt-2 flex items-center gap-2 flex-wrap">
                    {f.topic && (
                      <span className="px-2 py-0.5 rounded-full bg-mustard/25 text-charcoal text-[10px] font-medium">
                        {f.topic}
                      </span>
                    )}
                    {f.priority > 0 && (
                      <span className="px-2 py-0.5 rounded-full bg-muted text-[10px] font-medium text-muted-foreground">
                        Priority {f.priority}
                      </span>
                    )}
                    {f.tags.slice(0, 5).map(t => (
                      <span key={t} className="text-[10px] text-muted-foreground">
                        #{t}
                      </span>
                    ))}
                    {f.tags.length > 5 && (
                      <span className="text-[10px] text-muted-foreground">+{f.tags.length - 5}</span>
                    )}
                  </div>
                </div>
                <span
                  role="button"
                  tabIndex={0}
                  aria-pressed={f.active}
                  onClick={(e) => toggleActive(f, e)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      e.stopPropagation();
                      toggleActive(f, e as unknown as React.MouseEvent);
                    }
                  }}
                  className={`shrink-0 inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium cursor-pointer transition ${
                    f.active
                      ? "bg-mustard/30 text-charcoal hover:bg-mustard/40"
                      : "bg-muted text-muted-foreground hover:bg-muted/80"
                  }`}
                >
                  {f.active ? "Active" : "Inactive"}
                </span>
              </div>
              <p className="text-sm text-muted-foreground whitespace-pre-line line-clamp-3">{f.answer}</p>
            </li>
          ))}
        </ul>
      )}

      {editorOpen && (
        <FaqEditor
          entry={editing}
          onClose={() => { setEditorOpen(false); setEditing(null); }}
          onSaved={() => { setEditorOpen(false); setEditing(null); load(); }}
        />
      )}
    </div>
  );
}

function FaqEditor({
  entry, onClose, onSaved,
}: { entry: FaqEntry | null; onClose: () => void; onSaved: () => void }) {
  const isEdit = !!entry;
  const [question, setQuestion] = useState(entry?.question ?? "");
  const [answer, setAnswer] = useState(entry?.answer ?? "");
  const [topic, setTopic] = useState<string>(entry?.topic ?? "Other");
  const [priority, setPriority] = useState<string>(entry ? String(entry.priority) : "0");
  const [active, setActive] = useState<boolean>(entry?.active ?? true);
  const [tagsCsv, setTagsCsv] = useState<string>((entry?.tags ?? []).join(", "));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, busy]);

  const cls = "w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-foreground/10 focus:border-foreground transition";

  const save = async () => {
    setErr(null);
    const q = question.trim();
    const a = answer.trim();
    if (!q) { setErr("Question is required."); return; }
    if (!a) { setErr("Answer is required."); return; }
    setBusy(true);
    try {
      const tags = tagsCsv
        .split(",")
        .map(t => t.trim().toLowerCase())
        .filter(Boolean)
        .filter((t, i, arr) => arr.indexOf(t) === i);
      const payload = {
        question: q,
        answer: a,
        topic: topic || null,
        tags,
        priority: Number(priority) || 0,
        active,
      };
      if (isEdit && entry) {
        const { error } = await supabase.from("faq").update(payload).eq("id", entry.id);
        if (error) throw new Error(error.message);
      } else {
        const { error } = await supabase.from("faq").insert(payload);
        if (error) throw new Error(error.message);
      }
      onSaved();
    } catch (e: any) {
      setErr(e?.message ?? "Could not save.");
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!entry) return;
    if (!confirm(`Delete "${entry.question}"?`)) return;
    setBusy(true);
    const { error } = await supabase.from("faq").delete().eq("id", entry.id);
    if (error) { setErr(error.message); setBusy(false); return; }
    onSaved();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-stretch sm:items-center sm:justify-center"
      role="dialog"
      aria-modal="true"
      aria-label={isEdit ? "Edit FAQ entry" : "New FAQ entry"}
    >
      <div className="absolute inset-0 bg-black/40" onClick={busy ? undefined : onClose} />
      <div className="relative z-10 w-full sm:max-w-2xl sm:my-8 mx-0 sm:mx-auto bg-card sm:rounded-2xl shadow-2xl border border-border max-h-[100vh] sm:max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 sm:px-6 py-4 border-b border-border">
          <h3 className="font-display text-lg">{isEdit ? "Edit FAQ" : "New FAQ"}</h3>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Close"
            className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50 disabled:opacity-50"
          >
            <XIcon className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 sm:px-6 py-5 space-y-4">
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">Question</label>
            <input
              type="text"
              value={question}
              onChange={e => setQuestion(e.target.value)}
              placeholder="e.g. What are your hours?"
              className={cls}
            />
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">Answer</label>
            <textarea
              rows={6}
              value={answer}
              onChange={e => setAnswer(e.target.value)}
              placeholder="The exact reply the chatbot will send."
              className={`${cls} resize-y whitespace-pre-line`}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">Topic</label>
              <select value={topic} onChange={e => setTopic(e.target.value)} className={cls}>
                {FAQ_TOPICS.map(t => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">Priority</label>
              <input
                type="number"
                value={priority}
                onChange={e => setPriority(e.target.value)}
                className={`${cls} tabular-nums`}
              />
            </div>
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">Tags (comma-separated)</label>
            <input
              type="text"
              value={tagsCsv}
              onChange={e => setTagsCsv(e.target.value)}
              placeholder="e.g. refund, cancel, credit"
              className={cls}
            />
          </div>

          <div className="flex items-center justify-between bg-muted/30 border border-border rounded-xl px-4 py-3">
            <div>
              <div className="text-sm font-medium">Active</div>
              <div className="text-xs text-muted-foreground mt-0.5">
                Inactive entries are hidden from the chatbot.
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={active}
              onClick={() => setActive(a => !a)}
              className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-foreground/20 ${
                active ? "bg-foreground" : "bg-muted"
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-background shadow transition ${
                  active ? "translate-x-6" : "translate-x-1"
                }`}
              />
            </button>
          </div>
        </div>

        <div className="border-t border-border bg-card px-5 sm:px-6 py-4 flex items-center justify-between gap-2">
          <div>
            {isEdit && (
              <button
                type="button"
                onClick={remove}
                disabled={busy}
                className="inline-flex items-center gap-1.5 text-destructive hover:bg-destructive/10 rounded-lg px-3 py-2 text-sm disabled:opacity-50"
              >
                <Trash2 className="h-4 w-4" /> Delete
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            {err && <span className="text-xs text-destructive mr-2">{err}</span>}
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="rounded-full px-4 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-muted/50 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={save}
              disabled={busy}
              className="rounded-full bg-foreground text-background px-4 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50"
            >
              {busy ? "Saving…" : isEdit ? "Save changes" : "Create entry"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
