import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { format, subDays, subMonths } from "date-fns";
import { inviteLinkPath } from "@/lib/invite";
import { formatSlotTime12h, localToday } from "@/lib/utils";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
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
  Facebook,
  Inbox,
  MessageSquareWarning,
  CalendarPlus,
  Mail,
  Phone,
  Instagram,
  BookOpen,
  EyeOff,
  ShieldCheck,
  ShieldAlert,
  ExternalLink,
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

type TabKey = "overview" | "pipeline" | "bookings" | "seniorids" | "invites" | "contacts" | "escalations" | "menu" | "slots" | "knowledge";

// Nav order is the *user-facing journey*, top → bottom: situational
// awareness (Overview) → core catalog (Menu) → in-flight customer flow
// (Pipelines / Orders / Invites / Waitlist) → calendar (Time Slot) →
// reactive support (Escalation) → admin-only knowledge (FAQs).
const NAV: { key: TabKey; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: "overview", label: "Overview", icon: LayoutDashboard },
  { key: "menu", label: "Menu", icon: UtensilsCrossed },
  { key: "pipeline", label: "Pipelines", icon: TrendingUp },
  { key: "bookings", label: "Orders", icon: ShoppingBag },
  { key: "seniorids", label: "Senior IDs", icon: ShieldCheck },
  { key: "invites", label: "Invites", icon: Mail },
  { key: "contacts", label: "Waitlist", icon: Clock },
  { key: "slots", label: "Time Slot", icon: CalendarClock },
  { key: "escalations", label: "Escalation", icon: AlertCircle },
  { key: "knowledge", label: "FAQs", icon: BookOpen },
];

const PAGE_META: Record<TabKey, { title: string; subtitle: string }> = {
  overview: { title: "Overview", subtitle: "A calm summary of what's happening at Sautéo today." },
  menu: { title: "Menu", subtitle: "Curate the dishes available to guests." },
  pipeline: { title: "Pipelines", subtitle: "Track every customer from request to seated — pickup and dine-in side by side." },
  bookings: { title: "Orders", subtitle: "Verify payments and manage incoming reservations." },
  seniorids: { title: "Senior IDs", subtitle: "Review and verify Senior Citizen and PWD ID photos submitted with discount claims." },
  invites: { title: "Invites", subtitle: "Generate one-time booking links for waitlisted customers." },
  contacts: { title: "Waitlist", subtitle: "Guests waiting for a table, grouped by the date and time they want to book." },
  slots: { title: "Time Slot", subtitle: "Open, close, and adjust capacity for each service." },
  escalations: { title: "Escalation", subtitle: "Messenger questions the chatbot couldn't answer — review and resolve here." },
  knowledge: { title: "FAQs", subtitle: "Answers the chatbot uses when guests message Sautéo." },
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
  // Sidebar badge counts — re-fire on tab change so resolving/verifying
  // items in the respective tab reflects immediately when staff navigates away.
  const [unresolvedEscalations, setUnresolvedEscalations] = useState(0);
  const [unverifiedClaims, setUnverifiedClaims] = useState(0);

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    (async () => {
      const [{ count: esc }, { count: claims }] = await Promise.all([
        supabase.from("escalations").select("*", { count: "exact", head: true }).eq("resolved", false),
        supabase.from("senior_pwd_claims").select("*", { count: "exact", head: true }).eq("verified", false),
      ]);
      if (!cancelled) {
        setUnresolvedEscalations(esc ?? 0);
        setUnverifiedClaims(claims ?? 0);
      }
    })();
    return () => { cancelled = true; };
  }, [tab, isAdmin]);

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
          badges={{ escalations: unresolvedEscalations, seniorids: unverifiedClaims }}
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
              badges={{ escalations: unresolvedEscalations, seniorids: unverifiedClaims }}
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
          {tab === "pipeline" && <PipelineTab onJumpToOrders={() => setTab("bookings")} />}
          {tab === "bookings" && <BookingsTab />}
          {tab === "seniorids" && <SeniorIdsTab />}
          {tab === "invites" && <InvitesTab />}
          {tab === "contacts" && <WaitlistTab />}
          {tab === "escalations" && <EscalationsTab />}
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
  tab, onTab, email, compact, badges,
}: {
  tab: TabKey;
  onTab: (t: TabKey) => void;
  email?: string;
  compact?: boolean;
  // Optional unread-style counters keyed by TabKey. Currently only used by
  // the Escalations tab; left generic so future tabs can opt in without
  // another signature change.
  badges?: Partial<Record<TabKey, number>>;
}) {
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
          const badge = badges?.[key] ?? 0;
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
              {badge > 0 && (
                <span
                  aria-label={`${badge} needs attention`}
                  className="ml-auto inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1.5 rounded-full bg-destructive text-destructive-foreground text-[10px] font-semibold leading-none tabular-nums shrink-0"
                >
                  {badge > 99 ? "99+" : badge}
                </span>
              )}
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
type TopItem = {
  menuItemId: string | null;
  name: string;
  imageUrl: string | null;
  units: number;
  revenue: number;
};

type SalesRange = "week" | "month" | "year";

function OverviewTab({ onJumpToOrders }: { onJumpToOrders: () => void }) {
  const [stats, setStats] = useState({
    revenueToday: 0,
    pending: 0,
    weekOrders: 0,
    activeMenu: 0,
    // Revenue + headcount of confirmed bookings whose dining date is
    // today-or-later. Surfaces money already verified for upcoming
    // service — bookings that the chart's "by date confirmed" axis no
    // longer surfaces as backward-looking activity.
    upcomingRevenue: 0,
    upcomingCount: 0,
  });
  // All confirmed bookings (with their slot_date) so we can re-bucket
  // the sales series client-side when the range toggle changes.
  const [confirmedBookings, setConfirmedBookings] = useState<Booking[]>([]);
  const [recent, setRecent] = useState<Booking[]>([]);
  const [topItems, setTopItems] = useState<TopItem[]>([]);
  const [loading, setLoading] = useState(true);
  // Sales-chart range toggle. Local to the chart — KPI cards above
  // ("Today's revenue", "Orders this week") stay fixed.
  const [salesRange, setSalesRange] = useState<SalesRange>("week");

  useEffect(() => {
    (async () => {
      setLoading(true);
      const today = format(new Date(), "yyyy-MM-dd");
      const weekAgo = format(subDays(new Date(), 6), "yyyy-MM-dd");
      const monthAgo = format(subDays(new Date(), 29), "yyyy-MM-dd");

      const { data: bookingsData } = await supabase
        .from("bookings")
        .select("*, time_slots(slot_date, slot_time), booking_items(menu_item_id, item_name, quantity, unit_price), payments(id, status, reference_number, screenshot_url)")
        .order("created_at", { ascending: false });

      const rows = (bookingsData ?? []) as any as Booking[];

      const revenueToday = rows
        .filter(b => b.status === "confirmed" && b.time_slots?.slot_date === today)
        .reduce((sum, b) => sum + Number(b.total_amount || 0), 0);

      const pending = rows.filter(b => b.status === "pending").length;

      const weekOrders = rows.filter(
        b => b.status === "confirmed" && b.time_slots && b.time_slots.slot_date >= weekAgo
      ).length;

      const confirmed = rows.filter(b => b.status === "confirmed");

      const upcoming = confirmed.filter(
        b => b.time_slots && b.time_slots.slot_date >= today
      );
      const upcomingRevenue = upcoming.reduce(
        (s, b) => s + Number(b.total_amount || 0),
        0
      );
      const upcomingCount = upcoming.length;

      // Top-selling items, last 30 days, confirmed bookings only. Aggregate
      // booking_items by menu_item_id (fallback to item_name when the menu
      // item has since been deleted), then enrich with image_url.
      type AggRow = {
        menuItemId: string | null;
        name: string;
        units: number;
        revenue: number;
      };
      const agg = new Map<string, AggRow>();
      for (const b of rows) {
        if (b.status !== "confirmed") continue;
        const slotDate = (b as any).time_slots?.slot_date as string | undefined;
        if (!slotDate || slotDate < monthAgo) continue;
        for (const bi of ((b as any).booking_items ?? []) as Array<{
          menu_item_id: string | null;
          item_name: string;
          quantity: number;
          unit_price: number;
        }>) {
          const key = bi.menu_item_id ?? `name:${bi.item_name}`;
          const prev = agg.get(key) ?? {
            menuItemId: bi.menu_item_id,
            name: bi.item_name,
            units: 0,
            revenue: 0,
          };
          prev.units += Number(bi.quantity) || 0;
          prev.revenue += (Number(bi.quantity) || 0) * (Number(bi.unit_price) || 0);
          agg.set(key, prev);
        }
      }
      const topAgg = Array.from(agg.values())
        .sort((a, b) => b.units - a.units)
        .slice(0, 5);

      const ids = topAgg.map(a => a.menuItemId).filter((x): x is string => !!x);
      let images = new Map<string, string | null>();
      if (ids.length > 0) {
        const { data: imgRows } = await supabase
          .from("menu_items")
          .select("id, image_url")
          .in("id", ids);
        for (const row of (imgRows ?? []) as Array<{ id: string; image_url: string | null }>) {
          images.set(row.id, row.image_url);
        }
      }
      const topItemsFinal: TopItem[] = topAgg.map(a => ({
        menuItemId: a.menuItemId,
        name: a.name,
        imageUrl: a.menuItemId ? images.get(a.menuItemId) ?? null : null,
        units: a.units,
        revenue: a.revenue,
      }));

      const { count: activeMenu } = await supabase
        .from("menu_items")
        .select("*", { count: "exact", head: true })
        .eq("active", true);

      setStats({
        revenueToday,
        pending,
        weekOrders,
        activeMenu: activeMenu ?? 0,
        upcomingRevenue,
        upcomingCount,
      });
      setConfirmedBookings(confirmed);
      // Hold the most recent 20 confirmed bookings so the Recent orders
      // panel has enough to scroll through without re-fetching. The panel
      // caps its own height; anything beyond what fits triggers the
      // internal scrollbar.
      setRecent(confirmed.slice(0, 20));
      setTopItems(topItemsFinal);
      setLoading(false);
    })();
  }, []);

  const hasPending = stats.pending > 0;

  // Derive the chart series from the cached confirmed-bookings list
  // whenever the range toggle changes. No new network request.
  //
  // Buckets by `confirmed_at` (when admin clicked Verify and revenue was
  // recognized), falling back to `created_at` for legacy rows missing the
  // stamp. Previously we bucketed by `time_slots.slot_date` — the future
  // dining date — which meant a booking confirmed today for next week
  // vanished from the 7d/30d backward-looking views.
  const salesSeries = useMemo<{ date: string; revenue: number }[]>(() => {
    const bucketed = confirmedBookings.map(b => {
      const ts = (b as any).confirmed_at || (b as any).created_at;
      return {
        dateKey: ts ? String(ts).slice(0, 10) : "",
        revenue: Number(b.total_amount || 0),
      };
    });
    const out: { date: string; revenue: number }[] = [];
    if (salesRange === "week") {
      for (let i = 6; i >= 0; i--) {
        const d = format(subDays(new Date(), i), "yyyy-MM-dd");
        const revenue = bucketed
          .filter(x => x.dateKey === d)
          .reduce((s, x) => s + x.revenue, 0);
        out.push({ date: d, revenue });
      }
      return out;
    }
    if (salesRange === "month") {
      // 30 daily buckets. X-axis thins ticks so labels stay readable.
      for (let i = 29; i >= 0; i--) {
        const d = format(subDays(new Date(), i), "yyyy-MM-dd");
        const revenue = bucketed
          .filter(x => x.dateKey === d)
          .reduce((s, x) => s + x.revenue, 0);
        out.push({ date: d, revenue });
      }
      return out;
    }
    // "year" — 12 monthly buckets keyed on the first day of each month.
    for (let i = 11; i >= 0; i--) {
      const monthDate = subMonths(new Date(), i);
      const monthKey = format(monthDate, "yyyy-MM");
      const revenue = bucketed
        .filter(x => x.dateKey.startsWith(monthKey))
        .reduce((s, x) => s + x.revenue, 0);
      out.push({ date: format(monthDate, "yyyy-MM-01"), revenue });
    }
    return out;
  }, [confirmedBookings, salesRange]);

  const salesTotal = salesSeries.reduce((s, d) => s + d.revenue, 0);
  const salesHeading =
    salesRange === "week"
      ? "7-day sales"
      : salesRange === "month"
      ? "30-day sales"
      : "12-month sales";
  const salesSubtitle =
    salesRange === "week"
      ? "Daily revenue from confirmed orders. By date confirmed."
      : salesRange === "month"
      ? "Daily revenue from confirmed orders. By date confirmed."
      : "Monthly revenue from confirmed orders. By month confirmed.";

  return (
    <div className="space-y-4">
      {/* Compact KPI strip — Pending is one of four cards instead of a hero. */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <KpiCard
          label="Pending"
          value={loading ? "—" : String(stats.pending)}
          hint={
            hasPending
              ? stats.pending === 1
                ? "order awaiting verify"
                : "orders awaiting verify"
              : "all verified"
          }
          icon={hasPending ? AlertCircle : CheckCircle2}
          tone={hasPending ? "alert" : "neutral"}
          onClick={hasPending ? onJumpToOrders : undefined}
          loading={loading}
        />
        <KpiCard
          label="Today's revenue"
          value={
            loading
              ? "—"
              : `₱${stats.revenueToday.toLocaleString("en-PH", {
                  maximumFractionDigits: 0,
                })}`
          }
          hint="confirmed today"
          icon={TrendingUp}
          loading={loading}
        />
        <KpiCard
          label="Upcoming"
          value={
            loading
              ? "—"
              : `₱${stats.upcomingRevenue.toLocaleString("en-PH", {
                  maximumFractionDigits: 0,
                })}`
          }
          hint={
            stats.upcomingCount === 1
              ? "1 confirmed booking ahead"
              : `${stats.upcomingCount} confirmed bookings ahead`
          }
          icon={CalendarPlus}
          loading={loading}
        />
        <KpiCard
          label="Orders this week"
          value={loading ? "—" : String(stats.weekOrders)}
          hint="last 7 days"
          icon={CalendarRange}
          loading={loading}
        />
        <KpiCard
          label="Active menu items"
          value={loading ? "—" : String(stats.activeMenu)}
          hint="currently sellable"
          icon={Salad}
          loading={loading}
        />
      </div>

      {/* Row 1: revenue area chart (8) + top selling items (4) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <section className="lg:col-span-8 bg-card border border-border rounded-2xl shadow-sm p-5">
          <div className="flex items-start justify-between gap-3 mb-4 flex-wrap">
            <div>
              <h2 className="font-display text-base">{salesHeading}</h2>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {salesSubtitle}
              </p>
            </div>
            <div className="flex items-center gap-3">
              {/* Range toggle — 7-day / 30-day / 12-month. Pure
                  client-side re-bucketing, no extra fetch. */}
              <div
                role="tablist"
                aria-label="Sales range"
                className="inline-flex rounded-full bg-muted p-0.5"
              >
                {([
                  { value: "week", label: "7d" },
                  { value: "month", label: "30d" },
                  { value: "year", label: "12mo" },
                ] as const).map((opt) => {
                  const active = salesRange === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      onClick={() => setSalesRange(opt.value)}
                      className={`text-[11px] px-3 py-1 rounded-full transition ${
                        active
                          ? "bg-foreground text-background font-semibold"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
              <div className="text-right">
                <div className="font-display text-xl font-semibold tabular-nums">
                  ₱{salesTotal.toLocaleString("en-PH", { maximumFractionDigits: 0 })}
                </div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  total
                </div>
              </div>
            </div>
          </div>
          <div className="h-56">
            {loading ? (
              <div className="h-full flex items-center justify-center text-xs text-muted-foreground">
                Loading…
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                  data={salesSeries}
                  margin={{ top: 8, right: 8, left: -16, bottom: 0 }}
                >
                  <defs>
                    <linearGradient id="revFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#D2502B" stopOpacity={0.32} />
                      <stop offset="100%" stopColor="#D2502B" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid
                    stroke="var(--border)"
                    strokeDasharray="2 4"
                    vertical={false}
                  />
                  <XAxis
                    dataKey="date"
                    tickFormatter={(d: string) =>
                      salesRange === "week"
                        ? format(new Date(d), "EEEEEE")
                        : salesRange === "month"
                        ? format(new Date(d), "MMM d")
                        : format(new Date(d), "MMM")
                    }
                    tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                    axisLine={false}
                    tickLine={false}
                    interval={
                      salesRange === "month" ? 4 : "preserveStartEnd"
                    }
                    minTickGap={salesRange === "year" ? 8 : 16}
                  />
                  <YAxis
                    tickFormatter={(v: number) =>
                      v >= 1000 ? `₱${(v / 1000).toFixed(0)}k` : `₱${v}`
                    }
                    tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                    axisLine={false}
                    tickLine={false}
                    width={48}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "var(--card)",
                      border: "1px solid var(--border)",
                      borderRadius: 12,
                      fontSize: 12,
                      fontFamily: "Inter",
                      boxShadow: "0 4px 12px rgb(0 0 0 / 0.08)",
                    }}
                    labelFormatter={(d: string) =>
                      salesRange === "year"
                        ? format(new Date(d), "MMMM yyyy")
                        : format(new Date(d), "EEE, MMM d")
                    }
                    formatter={(v: number) => [
                      `₱${v.toLocaleString("en-PH")}`,
                      "Revenue",
                    ]}
                  />
                  <Area
                    type="monotone"
                    dataKey="revenue"
                    stroke="#D2502B"
                    strokeWidth={2}
                    fill="url(#revFill)"
                    dot={
                      salesRange === "week"
                        ? { r: 3, fill: "#D2502B", strokeWidth: 0 }
                        : false
                    }
                    activeDot={{ r: 5, strokeWidth: 0 }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </section>

        <section className="lg:col-span-4 bg-card border border-border rounded-2xl shadow-sm p-5">
          <h2 className="font-display text-base">Top selling items</h2>
          <p className="text-[11px] text-muted-foreground mt-0.5 mb-3">
            Most units sold · last 30 days.
          </p>
          {loading ? (
            <div className="text-xs text-muted-foreground py-6 text-center">
              Loading…
            </div>
          ) : topItems.length === 0 ? (
            <div className="text-xs text-muted-foreground py-6 text-center">
              No confirmed sales yet.
            </div>
          ) : (
            <ul className="divide-y divide-border/60">
              {topItems.map((it, i) => (
                <li
                  key={it.menuItemId ?? it.name}
                  className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0"
                >
                  {it.imageUrl ? (
                    <img
                      src={it.imageUrl}
                      alt={it.name}
                      className="h-10 w-10 rounded-lg object-cover bg-muted shrink-0"
                      loading="lazy"
                    />
                  ) : (
                    <div className="h-10 w-10 rounded-lg bg-mustard/20 shrink-0 flex items-center justify-center font-display text-sm font-semibold text-foreground/70">
                      {it.name.charAt(0).toUpperCase()}
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium truncate">
                      {it.name}
                    </div>
                    <div className="text-[11px] text-muted-foreground tabular-nums">
                      {it.units} sold · ₱
                      {it.revenue.toLocaleString("en-PH", {
                        maximumFractionDigits: 0,
                      })}
                    </div>
                  </div>
                  <div className="text-[11px] font-medium text-primary tabular-nums shrink-0">
                    #{i + 1}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* Row 2: recent orders */}
      <section className="bg-card border border-border rounded-2xl shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-border">
          <h2 className="font-display text-base">Recent orders</h2>
          <button
            onClick={onJumpToOrders}
            className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
          >
            View all <ArrowRight className="h-3 w-3" />
          </button>
        </div>

        {loading ? (
          <div className="px-5 py-10 text-center text-muted-foreground text-sm">
            Loading…
          </div>
        ) : recent.length === 0 ? (
          <EmptyState
            icon={Inbox}
            title="No confirmed orders yet"
            hint="Verified bookings will show up here."
            className="px-5 py-8"
          />
        ) : (
          // Scroll is scoped to the list. Cap height so the panel doesn't
          // grow indefinitely as the Recent orders backlog gets longer —
          // admin scrolls inside instead of pushing the page down.
          <ul className="divide-y divide-border max-h-96 overflow-y-auto">
            {recent.map((b) => (
              <li
                key={b.id}
                className="px-5 py-2.5 flex items-center justify-between hover:bg-muted/30 transition"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2.5">
                    <span className="text-sm font-medium truncate">
                      {b.customer_name}
                    </span>
                    <StatusBadge status={b.status} />
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-0.5 truncate">
                    {b.reference_code}
                    {b.time_slots && (
                      <>
                        {" "}
                        ·{" "}
                        {format(
                          new Date(b.time_slots.slot_date),
                          "EEE, MMM d",
                        )}{" "}
                        · {formatSlotTime12h(b.time_slots.slot_time)}
                      </>
                    )}
                  </div>
                </div>
                <div className="text-right shrink-0 ml-4">
                  <div className="text-sm font-display font-semibold tabular-nums">
                    ₱{Number(b.total_amount).toFixed(0)}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    {b.group_size} guest{b.group_size === 1 ? "" : "s"}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

// Compact KPI card. Same shape for all 4 in the strip; the `alert` tone
// flips colors when there's pending work so it still draws the eye.
function KpiCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = "neutral",
  onClick,
  loading,
}: {
  label: string;
  value: string;
  hint?: string;
  icon: React.ComponentType<{ className?: string }>;
  tone?: "neutral" | "alert";
  onClick?: () => void;
  loading: boolean;
}) {
  const alert = tone === "alert";
  const inner = (
    <>
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <div
          className={`text-[10px] uppercase tracking-wider font-medium ${
            alert ? "text-background/70" : "text-muted-foreground"
          }`}
        >
          {label}
        </div>
        <div
          className={`rounded-lg p-1.5 shrink-0 ${
            alert ? "bg-background/15" : "bg-muted text-muted-foreground"
          }`}
        >
          <Icon className="h-3.5 w-3.5" />
        </div>
      </div>
      <div className="font-display text-2xl font-semibold tabular-nums tracking-tight truncate">
        {loading ? (
          <span className={alert ? "text-background/40" : "text-muted-foreground/40"}>
            —
          </span>
        ) : (
          value
        )}
      </div>
      {hint && (
        <div
          className={`text-[11px] mt-0.5 truncate ${
            alert ? "text-background/80" : "text-muted-foreground"
          }`}
        >
          {hint}
        </div>
      )}
    </>
  );

  const base = `block w-full text-left rounded-xl p-4 border transition ${
    alert
      ? "bg-foreground text-background border-foreground shadow-sm"
      : "bg-card text-foreground border-border shadow-sm"
  }`;

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={`${base} hover:shadow-md ${
          alert ? "hover:-translate-y-0.5" : ""
        }`}
      >
        {inner}
      </button>
    );
  }
  return <div className={base}>{inner}</div>;
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
// Sign-in only. Public signup was removed from this form — new admins are
// invited from inside the console by an existing admin (see the "Admins"
// section). The Supabase auth API still accepts password sign-ups in theory,
// but the user_roles gate below denies access regardless, and the project's
// auth dashboard should keep signups locked to "invite only" as well.
function AdminLogin() {
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [err, setErr] = useState<string|null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password: pw });
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
          Admin sign in
        </div>
        <p className="text-sm text-muted-foreground mb-6">
          Welcome back. Sign in to manage Sautéo.
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
            {busy ? "…" : "Sign in"}
          </button>
          <p className="pt-1 text-center text-[11px] leading-relaxed text-muted-foreground">
            Admin access is invite-only. Ask an existing admin to add your account from inside the console.
          </p>
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

/* ============ Senior / PWD ID verification ============ */
type SeniorClaim = {
  id: string;
  booking_id: string;
  reference_code: string;
  kind: string;
  full_name: string;
  id_number: string;
  date_of_birth: string;
  age: string;
  sex: string;
  date_of_issue: string;
  address: string;
  item_name: string;
  discount_amount: number;
  id_photo_path: string | null;
  verified: boolean;
  verified_at: string | null;
  created_at: string;
};

function SeniorIdsTab() {
  const [claims, setClaims] = useState<SeniorClaim[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "pending" | "verified">("pending");
  const [verifyingId, setVerifyingId] = useState<string | null>(null);
  // Signed URL cache: claimId → { url, expiresAt }
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});
  const [lightbox, setLightbox] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const q = supabase
      .from("senior_pwd_claims")
      .select("*")
      .order("created_at", { ascending: false });
    const { data } = await q;
    setClaims((data ?? []) as SeniorClaim[]);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const visible = useMemo(() => {
    if (filter === "pending") return claims.filter(c => !c.verified);
    if (filter === "verified") return claims.filter(c => c.verified);
    return claims;
  }, [claims, filter]);

  const pendingCount = useMemo(() => claims.filter(c => !c.verified).length, [claims]);

  const toggleVerified = async (claim: SeniorClaim) => {
    setVerifyingId(claim.id);
    const next = !claim.verified;
    setClaims(prev => prev.map(c => c.id === claim.id
      ? { ...c, verified: next, verified_at: next ? new Date().toISOString() : null }
      : c));
    const { error } = await supabase
      .from("senior_pwd_claims")
      .update({ verified: next, verified_at: next ? new Date().toISOString() : null })
      .eq("id", claim.id);
    if (error) {
      // Rollback optimistic update.
      setClaims(prev => prev.map(c => c.id === claim.id ? claim : c));
    }
    setVerifyingId(null);
  };

  // Mint a signed URL for an ID photo. Cached for the session since each
  // URL is valid for 1 hour and photos don't change after upload.
  const getPhotoUrl = async (claim: SeniorClaim) => {
    if (!claim.id_photo_path) return;
    if (photoUrls[claim.id]) {
      setLightbox(photoUrls[claim.id]);
      return;
    }
    const { data } = await supabase.storage
      .from("senior-pwd-ids")
      .createSignedUrl(claim.id_photo_path, 3600);
    if (data?.signedUrl) {
      setPhotoUrls(prev => ({ ...prev, [claim.id]: data.signedUrl }));
      setLightbox(data.signedUrl);
    }
  };

  const kindLabel = (kind: string) =>
    kind === "pwd" ? "PWD" : "Senior";

  const kindStyle = (kind: string) =>
    kind === "pwd"
      ? "bg-sky-100 text-sky-700"
      : "bg-amber-100 text-amber-700";

  return (
    <div className="space-y-6">
      {/* Header row */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="font-display text-xl">Senior / PWD claims</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {loading ? "Loading…" : `${pendingCount} pending · ${claims.length} total`}
          </p>
        </div>
        <button
          onClick={load}
          className="inline-flex items-center gap-1.5 bg-muted/60 hover:bg-muted rounded-full px-4 py-2 text-sm font-medium transition"
        >
          Refresh
        </button>
      </div>

      {/* Filter pills */}
      <div className="flex items-center gap-2">
        {(["pending", "all", "verified"] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-4 py-1.5 rounded-full text-sm font-medium transition ${
              filter === f
                ? "bg-foreground text-background"
                : "bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
          >
            {f === "pending" ? `Pending${pendingCount > 0 ? ` (${pendingCount})` : ""}` : f === "verified" ? "Verified" : "All"}
          </button>
        ))}
      </div>

      {/* List */}
      {loading ? (
        <div className="text-sm text-muted-foreground py-12 text-center">Loading…</div>
      ) : visible.length === 0 ? (
        <EmptyState
          icon={ShieldCheck}
          title={filter === "pending" ? "No pending claims" : "No claims yet"}
          hint={filter === "pending" ? "All submitted IDs have been verified." : "ID claims appear here when customers use Senior or PWD discounts."}
          className="py-16"
        />
      ) : (
        <div className="space-y-3">
          {visible.map(claim => (
            <div
              key={claim.id}
              className={`bg-card border rounded-2xl p-4 shadow-sm flex items-start gap-4 ${
                claim.verified ? "border-border opacity-70" : "border-amber-200"
              }`}
            >
              {/* Photo thumbnail */}
              <div
                className="shrink-0 w-16 h-20 rounded-lg bg-muted flex items-center justify-center cursor-pointer overflow-hidden border border-border hover:opacity-80 transition"
                onClick={() => getPhotoUrl(claim)}
                title="Click to view full-size ID"
              >
                {photoUrls[claim.id] ? (
                  <img src={photoUrls[claim.id]} alt="ID" className="w-full h-full object-cover" />
                ) : claim.id_photo_path ? (
                  <div className="flex flex-col items-center gap-1 text-muted-foreground p-1">
                    <ExternalLink className="h-5 w-5" />
                    <span className="text-[10px] text-center leading-tight">View ID</span>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-1 text-muted-foreground/50 p-1">
                    <ShieldAlert className="h-5 w-5" />
                    <span className="text-[10px] text-center leading-tight">No photo</span>
                  </div>
                )}
              </div>

              {/* Claim details */}
              <div className="flex-1 min-w-0 space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ${kindStyle(claim.kind)}`}>
                    {kindLabel(claim.kind)}
                  </span>
                  <span className="text-sm font-medium truncate">{claim.full_name || "—"}</span>
                  {claim.verified && (
                    <span className="inline-flex items-center gap-1 text-[11px] text-emerald-600 font-medium">
                      <ShieldCheck className="h-3.5 w-3.5" /> Verified
                    </span>
                  )}
                </div>
                <div className="text-[11px] text-muted-foreground space-y-0.5">
                  <div>Booking ref: <span className="font-medium text-foreground font-mono">{claim.reference_code}</span></div>
                  <div>Item: {claim.item_name || "—"} · ₱{Number(claim.discount_amount).toFixed(0)} off</div>
                  {claim.id_number && <div>ID #: {claim.id_number}</div>}
                  {claim.date_of_birth && <div>DOB: {claim.date_of_birth}{claim.age ? ` · Age: ${claim.age}` : ""}</div>}
                  {claim.date_of_issue && <div>Issued: {claim.date_of_issue}</div>}
                  {claim.address && <div className="truncate">Address: {claim.address}</div>}
                </div>
                <div className="text-[10px] text-muted-foreground/60 pt-0.5">
                  Submitted {format(new Date(claim.created_at), "MMM d, yyyy · h:mm a")}
                </div>
              </div>

              {/* Verified toggle */}
              <div className="shrink-0 flex flex-col items-center gap-1.5">
                <button
                  type="button"
                  role="switch"
                  aria-checked={claim.verified}
                  disabled={verifyingId === claim.id}
                  onClick={() => toggleVerified(claim)}
                  title={claim.verified ? "Mark as unverified" : "Mark as verified"}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-50 ${
                    claim.verified ? "bg-emerald-500" : "bg-muted-foreground/30"
                  }`}
                >
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-background shadow transition-transform ${
                    claim.verified ? "translate-x-[22px]" : "translate-x-[3px]"
                  }`} />
                </button>
                <span className="text-[10px] text-muted-foreground">
                  {claim.verified ? "Verified" : "Pending"}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Lightbox — full-size ID photo */}
      {lightbox && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setLightbox(null)}
        >
          <img
            src={lightbox}
            alt="ID full size"
            className="max-w-full max-h-full rounded-xl shadow-2xl object-contain"
            onClick={e => e.stopPropagation()}
          />
          <button
            className="absolute top-4 right-4 text-white/80 hover:text-white text-2xl font-bold"
            onClick={() => setLightbox(null)}
          >
            ✕
          </button>
        </div>
      )}
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
    if (pid) {
      const { error: payErr } = await supabase
        .from("payments")
        .update({ status: "verified", verified_at: now })
        .eq("id", pid);
      if (payErr) {
        alert(`Couldn't mark payment verified: ${payErr.message}`);
        return;
      }
    }
    const { error: bookingErr } = await supabase
      .from("bookings")
      .update({ status: "confirmed", confirmed_at: now })
      .eq("id", b.id);
    if (bookingErr) {
      alert(`Couldn't confirm booking: ${bookingErr.message}`);
      return;
    }
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

      {/* Table (wide desktop, ≥ xl). On MacBook Air-class viewports and
          smaller we drop to the card layout below — the 9-column table
          gets too cramped under ~1280px even with whitespace-nowrap.
          Vertical scroll is scoped to the table body so admin doesn't
          have to scroll the page when the list grows. */}
      <div className="hidden xl:block bg-card border border-border rounded-2xl shadow-sm overflow-hidden">
        <div className="overflow-auto max-h-[calc(100vh-280px)]">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-20 bg-muted text-muted-foreground text-[11px] uppercase tracking-wider border-b border-border">
              <tr>
                <th className="px-3 py-3 font-medium text-center">Ref</th>
                <th className="px-3 py-3 font-medium text-center">Customer</th>
                <th className="px-3 py-3 font-medium text-center">Slot</th>
                <th className="px-3 py-3 font-medium text-center">Pax</th>
                <th className="px-3 py-3 font-medium text-center">Items</th>
                <th className="px-3 py-3 font-medium text-center">Total</th>
                <th className="px-3 py-3 font-medium text-center">Payment</th>
                <th className="px-3 py-3 font-medium text-center">Status</th>
                <th className="px-3 py-3 font-medium text-center"></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={9} className="px-3 py-12 text-center text-muted-foreground">Loading…</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={9} className="p-0">
                  <EmptyState
                    icon={hasFilters ? Search : Inbox}
                    title={hasFilters ? "No matches" : "No bookings yet"}
                    hint={hasFilters ? "Try a different search or clear filters." : "New reservations will appear here as guests check out."}
                  />
                </td></tr>
              ) : filtered.map(b => (
                <tr key={b.id} className="border-t border-border align-middle hover:bg-muted/70 transition">
                  <td className="px-3 py-3 font-mono text-[11px] text-muted-foreground whitespace-nowrap text-center">
                    {b.reference_code}
                    {b.source && b.source !== "web" && (
                      <div className="mt-1 inline-flex items-center px-1.5 py-0.5 rounded-full bg-muted text-[10px] uppercase tracking-wider font-medium text-muted-foreground">
                        {SOURCE_LABEL[b.source] ?? b.source}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-3 max-w-[180px] text-center">
                    <div className="font-medium truncate" title={b.customer_name}>{b.customer_name}</div>
                    <div className="text-[11px] text-muted-foreground truncate" title={b.customer_email}>{b.customer_email}</div>
                    <div className="text-[11px] text-muted-foreground truncate" title={b.customer_phone}>{b.customer_phone}</div>
                    {b.allergy_notes && (
                      <div className="mt-1 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-destructive/10 text-destructive text-[10px] font-medium" title={b.allergy_notes}>
                        <AlertCircle className="h-3 w-3" /> Allergy
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap text-center">
                    {b.time_slots && <>
                      <div>{format(new Date(b.time_slots.slot_date), "EEE, MMM d")}</div>
                      <div className="text-[11px] text-muted-foreground">{formatSlotTime12h(b.time_slots.slot_time)}</div>
                    </>}
                    {b.pickup_mode && b.pickup_mode !== "dine_in" && (
                      <div className="mt-1 text-[11px] text-muted-foreground">
                        {PICKUP_LABEL[b.pickup_mode] ?? b.pickup_mode}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-3 tabular-nums text-center">{b.group_size}</td>
                  <td className="px-3 py-3 text-[11px] max-w-[180px] text-center">
                    {b.booking_items?.map((bi, i) => (
                      <div key={i} className="truncate" title={`${bi.quantity}× ${bi.item_name}`}>
                        {bi.quantity}× {bi.item_name}
                      </div>
                    ))}
                  </td>
                  <td className="px-3 py-3 text-center font-medium whitespace-nowrap tabular-nums">
                    <div>₱{Number(b.total_amount).toFixed(0)}</div>
                    {b.credit_remaining != null && b.credit_remaining > 0 && (
                      <div className="text-[11px] text-muted-foreground mt-0.5 font-normal">
                        Credit ₱{Number(b.credit_remaining).toFixed(0)}
                        {b.refund_status && <> · {REFUND_LABEL[b.refund_status] ?? b.refund_status}</>}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-3 text-[11px] max-w-[140px] text-center">
                    {b.payments?.[0]?.reference_number && (
                      <div className="truncate" title={b.payments[0].reference_number}>
                        Ref: {b.payments[0].reference_number}
                      </div>
                    )}
                    {b.payments?.[0]?.screenshot_url && (
                      <a href={b.payments[0].screenshot_url} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                        Screenshot
                      </a>
                    )}
                    <div className="text-muted-foreground truncate" title={b.payments?.[0]?.status ?? undefined}>
                      {b.payments?.[0]?.status}
                    </div>
                  </td>
                  <td className="px-3 py-3 text-center">
                    <StatusBadge status={b.status} />
                  </td>
                  <td className="px-3 py-3 text-center">
                    {b.status !== "confirmed" && (
                      <button
                        onClick={() => verify(b)}
                        className="inline-flex items-center gap-1.5 text-xs bg-foreground text-background rounded-full px-3 py-1.5 font-medium hover:opacity-90 transition whitespace-nowrap"
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

      {/* Cards — covers mobile, tablet, and laptop widths up to xl.
          Single-column on phones, two-up on tablet and laptop so MacBook
          Air-class screens don't have one tall stack of orders. Scroll
          is scoped to this container so the page itself stays put. */}
      <div className="xl:hidden grid grid-cols-1 md:grid-cols-2 gap-3 max-h-[calc(100vh-280px)] overflow-y-auto pr-1">
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
                    ? <>{format(new Date(b.time_slots.slot_date), "EEE, MMM d")} · {formatSlotTime12h(b.time_slots.slot_time)}</>
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
  available_pickup: boolean;
};

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
    setItems(
      (((i ?? []) as unknown) as MenuItem[]).map((item) => ({
        ...item,
        available_dine_in: item.available_dine_in ?? true,
        available_pickup: item.available_pickup ?? true,
      })),
    );
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
                  <div className="mt-2 flex flex-wrap gap-1">
                    {item.available_dine_in && (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-muted/60 text-muted-foreground">
                        Dine-in
                      </span>
                    )}
                    {item.available_pickup && (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-muted/60 text-muted-foreground">
                        Pick-up
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

  const togglePickup = async (cat: MenuCategory) => {
    const next = !cat.available_pickup;
    // Optimistic flip; rollback if Supabase rejects.
    setWorking(prev => prev.map(c => (c.id === cat.id ? { ...c, available_pickup: next } : c)));
    const { error } = await supabase
      .from("menu_categories")
      .update({ available_pickup: next })
      .eq("id", cat.id);
    if (error) {
      setWorking(prev => prev.map(c => (c.id === cat.id ? { ...c, available_pickup: cat.available_pickup } : c)));
      setErr(error.message);
    } else {
      onChanged();
    }
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
              maxLength={80}
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

          <p className="text-[11px] leading-relaxed text-muted-foreground pt-1">
            Toggle the pill on the right to hide a category from the pickup menu. Dine-in always shows every category.
          </p>

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
                  onTogglePickup={() => togglePickup(c)}
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
  cat, count, canMoveUp, canMoveDown, onRename, onDelete, onUp, onDown, onTogglePickup,
}: {
  cat: MenuCategory;
  count: number;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onRename: (name: string) => void;
  onDelete: () => void;
  onUp: () => void;
  onDown: () => void;
  onTogglePickup: () => void;
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
            maxLength={80}
            className="w-full bg-background border border-border rounded-md px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-foreground/10 focus:border-foreground transition"
          />
        ) : (
          <button
            type="button"
            onClick={() => setEditing(true)}
            // Long category names like "Set Menu (WITH POTATO FRESH FRIES and
            // DRINKS) (NO SIDES)" used to get truncated mid-paren on one line.
            // Allow up to two lines + break long tokens so the name stays
            // readable without pushing the toggle / actions off-row.
            className="block w-full text-left text-sm font-medium leading-tight line-clamp-2 break-words hover:underline underline-offset-2"
          >
            {cat.name}
          </button>
        )}
        <div className="text-[11px] text-muted-foreground">
          {count} item{count === 1 ? "" : "s"}
        </div>
      </div>
      {/* Pickup visibility toggle — hides the whole category from the pickup
          booking flow when off. Dine-in always shows every category. */}
      <button
        type="button"
        role="switch"
        aria-checked={cat.available_pickup}
        aria-label={`Show in pickup menu (${cat.available_pickup ? "on" : "off"})`}
        title={cat.available_pickup ? "Visible in pickup menu" : "Hidden from pickup menu"}
        onClick={onTogglePickup}
        className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
          cat.available_pickup ? "bg-foreground" : "bg-muted-foreground/30"
        }`}
      >
        <span
          className={`inline-block h-3.5 w-3.5 transform rounded-full bg-background shadow transition-transform ${
            cat.available_pickup ? "translate-x-[18px]" : "translate-x-[2px]"
          }`}
        />
      </button>
      <button
        type="button"
        onClick={() => setEditing(e => !e)}
        aria-label="Rename"
        className="shrink-0 p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60 transition"
      >
        <Pencil className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        onClick={onDelete}
        aria-label="Delete"
        disabled={count > 0}
        title={count > 0 ? "Move items out first" : "Delete category"}
        className="shrink-0 p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
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
  // Dine-in availability is no longer admin-toggleable — every menu item
  // appears on reservation menus by default. Only pickup visibility is
  // controlled per-item via the toggle below.
  const [availablePickup, setAvailablePickup] = useState<boolean>(item?.available_pickup ?? true);
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
    // No availability gate — dine-in is always on now. Items can opt out
    // of pickup only.

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
        // Always true now — dine-in availability is no longer admin-toggleable.
        available_dine_in: true,
        available_pickup: availablePickup,
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

          {/* Pickup availability — sibling of the Active toggle above,
              same shape so the two rows line up edge-to-edge. */}
          <div className="flex items-center justify-between bg-muted/30 border border-border rounded-xl px-4 py-3">
            <div>
              <div className="text-sm font-medium">Available for Pickup</div>
              <div className="text-xs text-muted-foreground mt-0.5">
                Hidden items are not shown in the pickup menu.
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={availablePickup}
              aria-pressed={availablePickup}
              aria-label="Toggle pickup availability"
              onClick={() => setAvailablePickup((v) => !v)}
              className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-foreground/20 ${
                availablePickup ? "bg-foreground" : "bg-muted"
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-background shadow transition ${
                  availablePickup ? "translate-x-6" : "translate-x-1"
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
  // Added by 20260530120000_time_slots_channel.sql — separates dine-in
  // and pickup slot pools so each channel tracks its own capacity.
  channel: "dine_in" | "pickup";
  slot_date: string;
  slot_time: string;
  capacity: number;
  seats_taken: number;
  is_open: boolean;
};

// Time-of-day strings the public pickup flow actually shows to customers
// (`PickupReservationView.PICKUP_SLOT_TIMES` mirrors this). Admin is free
// to create pickup slots at other times, but the SlotsTab flags them with
// a warning chip since customers won't see them.
const PICKUP_VISIBLE_TIMES = ["16:00:00", "18:00:00", "20:00:00"] as const;

function SlotsTab() {
  const [slots, setSlots] = useState<TimeSlot[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeWindow, setActiveWindow] = useState<"dine_in" | "pickup">("dine_in");
  // null = closed; "dine_in"/"pickup" = creator dialog open with that channel.
  const [creatorOpenFor, setCreatorOpenFor] = useState<
    "dine_in" | "pickup" | null
  >(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("time_slots")
      .select("*")
      .gte("slot_date", format(new Date(), "yyyy-MM-dd"))
      .order("slot_date")
      .order("slot_time");
    // The DB query only filters by date so today's elapsed slots come
    // back too — strip them client-side so "Upcoming" actually means
    // upcoming. Slot times are local restaurant time; combining with
    // slot_date gives a comparable Date.
    const now = new Date();
    const upcoming = ((data ?? []) as TimeSlot[]).filter((s) => {
      const slotDateTime = new Date(`${s.slot_date}T${s.slot_time}`);
      return slotDateTime > now;
    });
    setSlots(upcoming);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  // Split into dine-in / pickup pools. Each section renders independently
  // with its own grouping, header counts, and creator action.
  const dineInSlots = useMemo(
    () => slots.filter((s) => s.channel === "dine_in"),
    [slots],
  );
  const pickupSlots = useMemo(
    () => slots.filter((s) => s.channel === "pickup"),
    [slots],
  );
  const activeSlots = activeWindow === "dine_in" ? dineInSlots : pickupSlots;
  const activeDayCount = useMemo(
    () => new Set(activeSlots.map((s) => s.slot_date)).size,
    [activeSlots],
  );
  const activeTitle =
    activeWindow === "dine_in" ? "Dine-in Window" : "Pick-up Window";
  const activeEmptyHint =
    activeWindow === "dine_in"
      ? "No dine-in slots yet — open windows so guests can reserve a table."
      : "No pickup slots yet — open 4 PM / 6 PM / 8 PM windows for guests to order.";

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
    if (!confirm(`Delete the ${formatSlotTime12h(s.slot_time)} slot on ${format(new Date(s.slot_date), "EEE, MMM d")}?`)) return;
    setSlots(prev => prev.filter(p => p.id !== s.id));
    await supabase.from("time_slots").delete().eq("id", s.id);
  };

  return (
    <div className="space-y-6">
      <div className="bg-card border border-border rounded-2xl p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="inline-flex rounded-full bg-muted p-0.5">
            {(["dine_in", "pickup"] as const).map((windowKey) => {
              const active = activeWindow === windowKey;
              const Icon = windowKey === "dine_in" ? UtensilsCrossed : ShoppingBag;
              return (
                <button
                  key={windowKey}
                  type="button"
                  onClick={() => setActiveWindow(windowKey)}
                  className={`inline-flex items-center gap-1.5 text-sm px-4 py-1.5 rounded-full transition ${
                    active
                      ? "bg-foreground text-background font-semibold"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {windowKey === "dine_in" ? "Dine-in Window" : "Pick-up Window"}
                </button>
              );
            })}
          </div>
          <div className="text-xs text-muted-foreground">
            {loading
              ? "Loading…"
              : `${activeSlots.length} slot${activeSlots.length === 1 ? "" : "s"} across ${activeDayCount} day${activeDayCount === 1 ? "" : "s"}`}
          </div>
        </div>
      </div>

      <ChannelSlotsSection
        channel={activeWindow}
        title={activeTitle}
        emptyHint={activeEmptyHint}
        slots={activeSlots}
        loading={loading}
        onNewClick={() => setCreatorOpenFor(activeWindow)}
        onToggle={toggle}
        onUpdateCap={updateCap}
        onDelete={deleteSlot}
      />

      {creatorOpenFor && (
        <SlotCreator
          channel={creatorOpenFor}
          existing={slots}
          onClose={() => setCreatorOpenFor(null)}
          onCreated={() => { setCreatorOpenFor(null); load(); }}
        />
      )}
    </div>
  );
}

// One channel's slate of upcoming slots — header (count + "New slots"
// button), empty state, or the same date-grouped grid the tab had before
// the split. Lives next to SlotsTab so the two channel pools render
// independently within one tab.
function ChannelSlotsSection({
  channel,
  title,
  emptyHint,
  slots,
  loading,
  onNewClick,
  onToggle,
  onUpdateCap,
  onDelete,
}: {
  channel: "dine_in" | "pickup";
  title: string;
  emptyHint: string;
  slots: TimeSlot[];
  loading: boolean;
  onNewClick: () => void;
  onToggle: (id: string, isOpen: boolean) => void;
  onUpdateCap: (id: string, cap: number) => void;
  onDelete: (s: TimeSlot) => void;
}) {
  const grouped = useMemo(() => {
    const g: Record<string, TimeSlot[]> = {};
    slots.forEach(s => { (g[s.slot_date] ||= []).push(s); });
    return g;
  }, [slots]);
  const dayCount = Object.keys(grouped).length;
  const newLabel = channel === "dine_in" ? "New dine-in slots" : "New pickup slots";
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-xl">{title}</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {loading
              ? "Loading…"
              : `${slots.length} slot${slots.length === 1 ? "" : "s"} across ${dayCount} day${dayCount === 1 ? "" : "s"}.`}
          </p>
        </div>
        <button
          onClick={onNewClick}
          className="inline-flex items-center gap-1.5 bg-foreground text-background rounded-full px-4 py-2 text-sm font-medium hover:opacity-90 transition"
        >
          <CalendarPlus className="h-4 w-4" />
          {newLabel}
        </button>
      </div>

      {loading ? (
        <div className="bg-card border border-border rounded-2xl py-16 text-center text-muted-foreground text-sm shadow-sm">
          Loading slots…
        </div>
      ) : dayCount === 0 ? (
        <div className="bg-card border border-border rounded-2xl shadow-sm">
          <EmptyState
            icon={CalendarClock}
            title={`No upcoming ${channel === "dine_in" ? "dine-in" : "pickup"} slots`}
            hint={emptyHint}
            action={
              <button
                onClick={onNewClick}
                className="inline-flex items-center gap-1.5 bg-foreground text-background rounded-full px-4 py-2 text-sm font-medium hover:opacity-90 transition"
              >
                <CalendarPlus className="h-4 w-4" /> {newLabel}
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
                    onToggle={() => onToggle(s.id, s.is_open)}
                    onUpdateCap={cap => onUpdateCap(s.id, cap)}
                    onDelete={() => onDelete(s)}
                  />
                ))}
              </div>
            </div>
          );
        })
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
  // Pickup customers only see slots at the 3 fixed times (4/6/8 PM).
  // Admin can technically create other times but the customer-facing
  // booking flow filters them out — flag the card so admin notices.
  const offSchedulePickup =
    slot.channel === "pickup" &&
    !(PICKUP_VISIBLE_TIMES as readonly string[]).includes(slot.slot_time);
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
      <div className={`font-display text-xs leading-none ${slot.is_open ? "" : "text-muted-foreground"}`}>
        {formatSlotTime12h(slot.slot_time)}
      </div>
      <div className="text-[10px] text-muted-foreground mt-1">
        {slot.seats_taken}/{slot.capacity}
        {full && slot.is_open && <span className="ml-1 font-medium text-charcoal">· full</span>}
      </div>
      {offSchedulePickup && (
        <div
          title="Pickup customers only see 4 PM, 6 PM, and 8 PM slots."
          className="mt-1.5 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-destructive/10 text-destructive text-[9px] font-medium leading-none"
        >
          <AlertCircle className="h-2.5 w-2.5" />
          Hidden from customers
        </div>
      )}
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
  channel,
  existing,
  onClose,
  onCreated,
}: {
  channel: "dine_in" | "pickup";
  existing: TimeSlot[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const todayStr = format(new Date(), "yyyy-MM-dd");
  const [mode, setMode] = useState<"single" | "range">("single");
  const [date, setDate] = useState(todayStr);
  const [endDate, setEndDate] = useState(todayStr);
  // Defaults differ per channel — pickup pre-fills the 4 PM / 6 PM / 8 PM
  // schedule so the most common case is one click away. Admin can override.
  const isPickup = channel === "pickup";
  const [startTime, setStartTime] = useState(isPickup ? "16:00" : "18:00");
  const [endTime, setEndTime] = useState(isPickup ? "20:00" : "20:00");
  const [interval, setInterval] = useState(isPickup ? "120" : "30");
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

    // Dedup against existing slots in the SAME channel — an 18:00 dine-in
    // slot shouldn't block an 18:00 pickup slot creation, since they're
    // independent rows after the channel split.
    const existingKey = new Set(
      existing
        .filter((s) => s.channel === channel)
        .map((s) => `${s.slot_date}|${s.slot_time}`),
    );
    const rows: { slot_date: string; slot_time: string }[] = [];
    for (const d of dates) for (const t of times) {
      const key = `${d}|${t}`;
      if (!existingKey.has(key)) rows.push({ slot_date: d, slot_time: t });
    }
    return rows;
  }, [mode, date, endDate, startTime, endTime, interval, capacity, existing, channel]);

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
      const rows = planned.map(r => ({
        slot_date: r.slot_date,
        slot_time: r.slot_time,
        capacity: cap,
        is_open: true,
        channel,
      }));
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
          <h3 className="font-display text-lg">
            {channel === "dine_in" ? "New dine-in slots" : "New pickup slots"}
          </h3>
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
            {isPickup && (
              <div className="mt-1 text-muted-foreground">
                Pickup customers only see 4 PM, 6 PM, and 8 PM slots — anything else will be hidden from the booking flow.
              </div>
            )}
            {planned.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {planned.slice(0, 12).map((p, i) => (
                  <span key={i} className="px-2 py-0.5 rounded-full bg-card border border-border text-[10px] tabular-nums">
                    {formatSlotTime12h(p.slot_time)}
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
  // Messenger Page-Scoped ID, populated for waitlist guests + anyone the
  // bot has ever messaged. n8n's invite-sender workflow uses it as the
  // Send API recipient, so the InviteCreator copies this into
  // booking_invites.platform_id on submit.
  messenger_psid: string | null;
  // What the bot captured on Messenger — number of guests for dine-in or
  // number of meals for pickup. Pre-fills the InviteCreator's group_size
  // input so admin doesn't fall back to the "2" default.
  last_party_size: number | null;
  source: string | null;
  tags: string[];
  notes: string | null;
  // Requested booking slot the bot captured on the waitlist (added by
  // 20260529120000_waitlist_requested_slot). Null → "Unscheduled" bucket.
  requested_date: string | null; // YYYY-MM-DD
  requested_time: string | null; // HH:MM:SS
  created_at: string;
  updated_at: string;
  total_bookings: number;
  confirmed_bookings: number;
  lifetime_spend: number;
  last_visit_date: string | null;
  first_booking_at: string | null;
  channels: string[];
};

// Sentinel date/time key for waitlist guests the bot hasn't captured a
// requested slot for yet. Can't collide with a real date (YYYY-MM-DD).
const UNSCHEDULED = "__unscheduled__";

function WaitlistTab() {
  const [contacts, setContacts] = useState<ContactRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Open, upcoming slots keyed by `${date}|${HH:MM}` so a guest's requested
  // date+time resolves to the real time_slot a bulk invite locks onto.
  const [slots, setSlots] = useState<TimeSlot[]>([]);
  // Group keys (`${date}|${time}`) with a bulk send in flight — disables that
  // group's button so a double-click can't double-issue.
  const [bulkSending, setBulkSending] = useState<Set<string>>(new Set());
  const [bulkResult, setBulkResult] = useState<string | null>(null);

  // When set, opens the InviteCreator dialog prefilled with this contact's
  // info. Generating an invite from here links it back to the contact via
  // booking_invites.contact_id so the Invites tab can group/monitor by guest.
  const [inviteFor, setInviteFor] = useState<ContactRow | null>(null);

  // contact_id → that contact's invites, most-recent first. Drives the
  // status badge (Active / Used / Expired / None) and the contextual
  // action button (Copy link if an active invite exists, otherwise
  // Generate invite). Keeps the admin from accidentally issuing two
  // active invites to the same guest.
  const [invitesByContact, setInvitesByContact] = useState<
    Map<string, BookingInvite[]>
  >(new Map());
  const [copiedContactId, setCopiedContactId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);

    // Open, upcoming dine-in slots — used to resolve a requested date+time
    // to a real slot for bulk invites. Waitlist invites are always issued
    // for the dine-in channel (sendBulkInvites below sets channel:"dine_in"),
    // so we filter to dine-in here to avoid grabbing a pickup slot that
    // happens to share the same date+time.
    const today = localToday();
    const { data: slotData } = await supabase
      .from("time_slots")
      .select("id, channel, slot_date, slot_time, capacity, seats_taken, is_open")
      .eq("channel", "dine_in")
      .gte("slot_date", today)
      .eq("is_open", true)
      .order("slot_date")
      .order("slot_time");
    setSlots((slotData ?? []) as TimeSlot[]);

    const { data } = await supabase
      .from("crm_contacts_with_stats")
      .select("*")
      .order("updated_at", { ascending: false });
    const rows = (data ?? []) as ContactRow[];
    setContacts(rows);

    // Load invites linked to any visible contact. We only need the fields
    // used for status + the token to copy — keep the projection tight.
    const ids = rows.map((r) => r.id);
    if (ids.length > 0) {
      const { data: invRaw } = await supabase
        .from("booking_invites" as any)
        .select("id, token, channel, customer_name, group_size, expires_at, used_at, contact_id, slot_id, created_at")
        .in("contact_id", ids);
      const m = new Map<string, BookingInvite[]>();
      for (const inv of ((invRaw ?? []) as unknown as BookingInvite[])) {
        if (!inv.contact_id) continue;
        const arr = m.get(inv.contact_id) ?? [];
        arr.push(inv);
        m.set(inv.contact_id, arr);
      }
      for (const arr of m.values()) {
        arr.sort(
          (a, b) =>
            new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
        );
      }
      setInvitesByContact(m);
    } else {
      setInvitesByContact(new Map());
    }

    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  // Latest party size known for the contact, sourced from their most-recent
  // invite that captured one. Waitlist details (collected over Messenger)
  // land on booking_invites.group_size when admin issues the invite, so this
  // is the closest stored proxy for "how many guests is Sautéo expecting".
  const guestsFor = useCallback(
    (contactId: string): number | null => {
      const list = invitesByContact.get(contactId);
      if (!list) return null;
      for (const inv of list) {
        if (typeof inv.group_size === "number" && inv.group_size > 0) {
          return inv.group_size;
        }
      }
      return null;
    },
    [invitesByContact],
  );

  // Active = unused + not expired = the only state that has a copyable link
  // and should block "Generate invite" on the row to prevent duplicates.
  const inviteStatusFor = useCallback(
    (
      contactId: string,
    ):
      | { state: "active"; hoursLeft: number; invite: BookingInvite }
      | { state: "used"; invite: BookingInvite }
      | { state: "expired"; invite: BookingInvite }
      | { state: "none" } => {
      const list = invitesByContact.get(contactId);
      if (!list || list.length === 0) return { state: "none" };
      const active = list.find(
        (i) => !i.used_at && new Date(i.expires_at) > new Date(),
      );
      if (active) {
        const hoursLeft = Math.max(
          0,
          Math.round(
            (new Date(active.expires_at).getTime() - Date.now()) / 36e5,
          ),
        );
        return { state: "active", hoursLeft, invite: active };
      }
      const used = list.find((i) => i.used_at);
      if (used) return { state: "used", invite: used };
      return { state: "expired", invite: list[0] };
    },
    [invitesByContact],
  );

  const copyInviteLink = async (
    contactId: string,
    token: string,
    channel: "dine_in" | "pickup",
  ) => {
    const path = inviteLinkPath(channel, token);
    const url =
      typeof window !== "undefined" ? `${window.location.origin}${path}` : path;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = url;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setCopiedContactId(contactId);
    window.setTimeout(
      () => setCopiedContactId((p) => (p === contactId ? null : p)),
      1500,
    );
  };

  // Time normalized to HH:MM so requested_time ("HH:MM:SS") and slot_time
  // ("HH:MM:SS") compare cleanly regardless of trailing seconds.
  const hhmm = (t: string | null) => (t ? t.slice(0, 5) : "");

  const slotByKey = useMemo(() => {
    const m = new Map<string, TimeSlot>();
    for (const s of slots) m.set(`${s.slot_date}|${hhmm(s.slot_time)}`, s);
    return m;
  }, [slots]);

  // Resolve a group's requested date+time to the open slot a bulk invite
  // locks onto. Null for the "Unscheduled" bucket or when no slot exists.
  const resolveSlot = useCallback(
    (date: string, time: string): TimeSlot | null =>
      date === UNSCHEDULED || !time || time === UNSCHEDULED
        ? null
        : slotByKey.get(`${date}|${hhmm(time)}`) ?? null,
    [slotByKey],
  );

  // This tab is single-purpose now — only waitlist guests.
  const allWaitlist = useMemo(
    () => contacts.filter((c) => c.tags.includes("waitlist")),
    [contacts],
  );

  const searched = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return allWaitlist;
    return allWaitlist.filter(
      (c) =>
        c.full_name?.toLowerCase().includes(needle) ||
        c.email?.toLowerCase().includes(needle) ||
        c.phone?.toLowerCase().includes(needle) ||
        c.facebook_handle?.toLowerCase().includes(needle) ||
        c.instagram_handle?.toLowerCase().includes(needle),
    );
  }, [allWaitlist, query]);

  const stats = useMemo(() => {
    let scheduled = 0;
    let invited = 0;
    for (const c of allWaitlist) {
      if (c.requested_date) scheduled += 1;
      if (inviteStatusFor(c.id).state === "active") invited += 1;
    }
    return {
      total: allWaitlist.length,
      scheduled,
      invited,
      unscheduled: allWaitlist.length - scheduled,
    };
  }, [allWaitlist, inviteStatusFor]);

  // date → [time, guests][]. Null requested_date/time bucket to UNSCHEDULED.
  // Pre-sorted: dates ascending (soonest first) with Unscheduled pinned last;
  // times ascending within a date, "no time" last.
  const grouped = useMemo(() => {
    const byDate = new Map<string, Map<string, ContactRow[]>>();
    for (const c of searched) {
      const dateKey = c.requested_date ?? UNSCHEDULED;
      const timeKey =
        c.requested_date && c.requested_time ? c.requested_time : UNSCHEDULED;
      const byTime = byDate.get(dateKey) ?? new Map<string, ContactRow[]>();
      const arr = byTime.get(timeKey) ?? [];
      arr.push(c);
      byTime.set(timeKey, arr);
      byDate.set(dateKey, byTime);
    }
    const sortKeys = (a: string, b: string) =>
      a === UNSCHEDULED ? 1 : b === UNSCHEDULED ? -1 : a.localeCompare(b);
    return [...byDate.entries()]
      .sort(([a], [b]) => sortKeys(a, b))
      .map(
        ([date, byTime]) =>
          [date, [...byTime.entries()].sort(([a], [b]) => sortKeys(a, b))] as const,
      );
  }, [searched]);

  // Bulk-issue slot-locked dine-in invites for everyone in a group who
  // doesn't already have an active invite. One multi-row insert; the n8n
  // sender fires per row off platform_id (Messenger PSID), so this is the
  // "bulk send". Guests without a PSID get a row but no auto-delivery.
  const sendBulkInvites = useCallback(
    async (date: string, time: string, groupContacts: ContactRow[]) => {
      const slot = resolveSlot(date, time);
      const key = `${date}|${time}`;
      if (!slot || !slot.is_open) {
        setBulkResult("No matching open slot for this date/time — open one in the Slots tab first.");
        return;
      }
      const eligible = groupContacts.filter(
        (c) => inviteStatusFor(c.id).state !== "active",
      );
      if (eligible.length === 0) {
        setBulkResult("Everyone in this group already has an active invite.");
        return;
      }
      setBulkSending((prev) => new Set(prev).add(key));
      const expiresAt = new Date(Date.now() + 72 * 3600_000).toISOString();
      const payloads = eligible.map((c) => {
        const p: Record<string, unknown> = {
          token: generateInviteToken(),
          channel: "dine_in",
          customer_name: c.full_name,
          customer_email: c.email,
          customer_phone: c.phone,
          group_size: c.last_party_size ?? guestsFor(c.id) ?? null,
          source: c.channels.includes("instagram") ? "instagram" : "messenger",
          expires_at: expiresAt,
          contact_id: c.id,
          slot_id: slot.id,
        };
        if (c.messenger_psid) p.platform_id = c.messenger_psid;
        return p;
      });
      const { error } = await supabase
        .from("booking_invites" as any)
        .insert(payloads);
      setBulkSending((prev) => {
        const n = new Set(prev);
        n.delete(key);
        return n;
      });
      if (error) {
        setBulkResult(`Could not send invites: ${error.message}`);
        return;
      }
      const skipped = groupContacts.length - eligible.length;
      const noPsid = eligible.filter((c) => !c.messenger_psid).length;
      setBulkResult(
        `Sent ${eligible.length} invite${eligible.length === 1 ? "" : "s"}` +
          (skipped ? ` · ${skipped} already active` : "") +
          (noPsid ? ` · ${noPsid} need a manual link (no Messenger ID)` : "") +
          ".",
      );
      load();
    },
    [resolveSlot, inviteStatusFor, guestsFor, load],
  );

  // Auto-dismiss the bulk-send toast.
  useEffect(() => {
    if (!bulkResult) return;
    const t = window.setTimeout(() => setBulkResult(null), 7000);
    return () => window.clearTimeout(t);
  }, [bulkResult]);

  return (
    <div className="space-y-6">
      {/* Summary strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <MiniStat label="Waitlisted" value={String(stats.total)} icon={Clock} loading={loading} />
        <MiniStat label="Scheduled" value={String(stats.scheduled)} icon={CalendarClock} loading={loading} />
        <MiniStat label="Invited" value={String(stats.invited)} icon={Mail} loading={loading} />
        <MiniStat label="Unscheduled" value={String(stats.unscheduled)} icon={AlertCircle} loading={loading} />
      </div>

      {/* Search */}
      <div className="bg-card border border-border rounded-2xl p-4 shadow-sm">
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
      </div>

      {/* Bulk-send result toast */}
      {bulkResult && (
        <div className="bg-mustard/15 border border-mustard/40 text-charcoal rounded-2xl px-4 py-3 text-sm flex items-center gap-2 shadow-sm">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>{bulkResult}</span>
        </div>
      )}

      {/* Waitlist grouped by requested date → time. Each time-group has one
          bulk "Send invites" button that locks every guest to that slot. */}
      {loading ? (
        <div className="bg-card border border-border rounded-2xl py-16 text-center text-muted-foreground text-sm shadow-sm">Loading waitlist…</div>
      ) : grouped.length === 0 ? (
        <div className="bg-card border border-border rounded-2xl shadow-sm">
          <EmptyState
            icon={allWaitlist.length === 0 ? Clock : Search}
            title={allWaitlist.length === 0 ? "No one on the waitlist" : "No matches"}
            hint={allWaitlist.length === 0 ? "Waitlist guests appear here as they come in from Messenger." : "Try a different search."}
          />
        </div>
      ) : (
        <div className="space-y-6">
          {grouped.map(([date, timeGroups]) => {
            const dateTotal = timeGroups.reduce((n, [, g]) => n + g.length, 0);
            return (
              <div key={date} className="space-y-3">
                {/* Date section header */}
                <div className="flex items-center gap-2 px-1">
                  <CalendarClock className="h-4 w-4 text-muted-foreground" />
                  <h3 className="font-display text-lg font-semibold">
                    {date === UNSCHEDULED
                      ? "Unscheduled"
                      : format(new Date(date + "T00:00:00"), "EEEE, MMMM d")}
                  </h3>
                  <span className="text-xs text-muted-foreground">
                    {dateTotal} guest{dateTotal === 1 ? "" : "s"}
                  </span>
                </div>

                {timeGroups.map(([time, guests]) => {
                  const groupKey = `${date}|${time}`;
                  const slot = resolveSlot(date, time);
                  const sending = bulkSending.has(groupKey);
                  const eligibleCount = guests.filter(
                    (c) => inviteStatusFor(c.id).state !== "active",
                  ).length;
                  const requestedSeats = guests.reduce(
                    (n, c) => n + (c.last_party_size ?? guestsFor(c.id) ?? 0),
                    0,
                  );
                  const remaining = slot ? slot.capacity - slot.seats_taken : null;
                  const canSend = !!slot && slot.is_open && eligibleCount > 0 && !sending;
                  const noSlot = date !== UNSCHEDULED && time !== UNSCHEDULED && !slot;

                  return (
                    <div key={groupKey} className="bg-card border border-border rounded-2xl shadow-sm overflow-hidden">
                      {/* Group header — time, demand, and the bulk action */}
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 justify-between px-5 py-3 bg-muted/40 border-b border-border">
                        <div className="flex items-center gap-2.5 flex-wrap text-sm">
                          <span className="font-display font-semibold tabular-nums">
                            {time === UNSCHEDULED ? "No time set" : formatSlotTime12h(time)}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {guests.length} guest{guests.length === 1 ? "" : "s"}
                          </span>
                          {requestedSeats > 0 && (
                            <span className="text-xs text-muted-foreground">
                              · {requestedSeats} seat{requestedSeats === 1 ? "" : "s"} requested
                            </span>
                          )}
                          {remaining != null && (
                            <span className={`text-xs ${requestedSeats > remaining ? "text-destructive font-medium" : "text-muted-foreground"}`}>
                              · {remaining} open in slot
                            </span>
                          )}
                        </div>
                        {date === UNSCHEDULED || time === UNSCHEDULED ? (
                          <span className="text-[11px] text-muted-foreground">Capture a date &amp; time to bulk-invite</span>
                        ) : noSlot ? (
                          <span className="text-[11px] text-muted-foreground" title="No open time slot matches this date and time">
                            No open slot — create one in Slots
                          </span>
                        ) : (
                          <button
                            onClick={() => sendBulkInvites(date, time, guests)}
                            disabled={!canSend}
                            title="Send slot-locked invites to everyone in this group without an active invite"
                            className="inline-flex items-center gap-1.5 text-xs font-semibold rounded-full px-3.5 py-2 bg-foreground text-background hover:opacity-90 transition disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            <Mail className="h-3.5 w-3.5" />
                            {sending
                              ? "Sending…"
                              : eligibleCount === 0
                                ? "All invited"
                                : `Send invites to all (${eligibleCount})`}
                          </button>
                        )}
                      </div>

                      {/* Guests in this time-group */}
                      <ul className="divide-y divide-border">
                        {guests.map((c) => {
                          const invStatus = inviteStatusFor(c.id);
                          const party = c.last_party_size ?? guestsFor(c.id);
                          return (
                            <li
                              key={c.id}
                              className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 px-5 py-3.5 hover:bg-muted/30 transition"
                            >
                              {/* Guest (clickable → opens drawer) */}
                              <button onClick={() => setSelectedId(c.id)} className="text-left min-w-0 flex-1">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="font-medium truncate">{c.full_name}</span>
                                  {!c.messenger_psid && (
                                    <span
                                      title="No Messenger ID — this invite can't auto-send; copy the link to share it manually"
                                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-destructive/10 text-destructive text-[10px] font-medium"
                                    >
                                      <AlertCircle className="h-3 w-3" /> no auto-send
                                    </span>
                                  )}
                                </div>
                                <div className="text-xs text-muted-foreground mt-0.5 truncate flex items-center gap-3 flex-wrap">
                                  {c.email && <span className="inline-flex items-center gap-1"><Mail className="h-3 w-3" /> {c.email}</span>}
                                  {c.phone && <span className="inline-flex items-center gap-1"><Phone className="h-3 w-3" /> {c.phone}</span>}
                                  {c.facebook_handle && <span className="inline-flex items-center gap-1"><Facebook className="h-3 w-3" /> {c.facebook_handle.slice(0, 14)}{c.facebook_handle.length > 14 ? "…" : ""}</span>}
                                  {c.instagram_handle && <span className="inline-flex items-center gap-1"><Instagram className="h-3 w-3" /> {c.instagram_handle}</span>}
                                </div>
                              </button>

                              {/* Party · status · per-guest action */}
                              <div className="flex items-center gap-4 sm:gap-5 shrink-0">
                                <span className="text-xs text-muted-foreground tabular-nums">
                                  <span className="uppercase tracking-wider text-[10px] mr-1">Party</span>
                                  {party != null ? (
                                    <span className="text-foreground font-medium">{party}</span>
                                  ) : (
                                    <span className="text-muted-foreground/60">—</span>
                                  )}
                                </span>
                                <InviteStatusPill status={invStatus} />
                                {invStatus.state === "active" ? (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      copyInviteLink(
                                        c.id,
                                        invStatus.invite.token,
                                        invStatus.invite.channel as "dine_in" | "pickup",
                                      );
                                    }}
                                    title="Copy this guest's active invite link"
                                    className="inline-flex items-center gap-1.5 text-xs font-semibold rounded-full px-3 py-1.5 border border-border hover:bg-muted transition"
                                  >
                                    {copiedContactId === c.id ? (
                                      <><CheckCircle2 className="h-3.5 w-3.5" /> Copied!</>
                                    ) : (
                                      <><Mail className="h-3.5 w-3.5" /> Copy link</>
                                    )}
                                  </button>
                                ) : (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setInviteFor(c);
                                    }}
                                    title="Generate one invite for just this guest"
                                    className="inline-flex items-center gap-1.5 text-xs font-semibold rounded-full px-3 py-1.5 border border-border hover:bg-muted transition"
                                  >
                                    <Mail className="h-3.5 w-3.5" /> Generate
                                  </button>
                                )}
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}

      {selectedId && (() => {
        const c = contacts.find((row) => row.id === selectedId);
        const status = inviteStatusFor(selectedId);
        return (
          <ContactDrawer
            id={selectedId}
            onClose={() => setSelectedId(null)}
            onSaved={() => { setSelectedId(null); load(); }}
            inviteStatus={status}
            isCopied={copiedContactId === selectedId}
            onCopyInvite={
              status.state === "active"
                ? () =>
                    copyInviteLink(
                      selectedId,
                      status.invite.token,
                      status.invite.channel as "dine_in" | "pickup",
                    )
                : undefined
            }
            onGenerateInvite={c ? () => setInviteFor(c) : undefined}
          />
        );
      })()}

      {inviteFor && (
        <InviteCreator
          prefill={{
            contactId: inviteFor.id,
            name: inviteFor.full_name,
            email: inviteFor.email,
            phone: inviteFor.phone,
            messengerPsid: inviteFor.messenger_psid,
            groupSize: inviteFor.last_party_size ?? extractPartySize(inviteFor.notes),
            // Best-guess of the original messaging channel — defaults to
            // 'messenger' since that's where both waitlist + pickup
            // customers usually come in from.
            source:
              inviteFor.channels.includes("instagram") ? "instagram" :
              inviteFor.channels.includes("messenger") ? "messenger" : "messenger",
            // Default the channel radio to match the contact's tag. Tie
            // goes to dine-in. Admin can still flip it in the dialog.
            channel: inviteFor.tags.includes("pickup") && !inviteFor.tags.includes("waitlist")
              ? "pickup"
              : "dine_in",
          }}
          onClose={() => setInviteFor(null)}
          onCreated={() => { setInviteFor(null); /* invite shows up in Invites tab */ }}
        />
      )}
    </div>
  );
}

/* ============ Escalations ============
   Messenger questions the chatbot couldn't resolve. Rows are inserted by
   the n8n / Messenger pipeline (we never write them here — the admin only
   reads + flips `resolved`). Default view is "open, newest first" so staff
   sees what needs attention without scrolling past resolved history. */

type Escalation = {
  id: string;
  platform_id: string;
  // The bot doesn't always have a name (e.g. a guest who never identified
  // themselves in Messenger). Treat the name as optional and render a
  // "Unknown guest" fallback.
  full_name: string | null;
  guest_message: string;
  // Ad-hoc category tag set by the bot ("general", "booking_confirmed", …).
  // Treated as free-form text so a new state can appear without a code
  // change; the tag chip just renders whatever is there.
  state: string | null;
  resolved: boolean;
  resolved_at: string | null;
  // Admin-only internal note. Never sent back to the customer; lets staff
  // leave context for themselves or teammates ("called back at 3pm",
  // "waiting on kitchen confirmation", etc.).
  notes: string | null;
  created_at: string;
};

// EscalationsTab — verbatim port from the canonical Sautéo admin console.
// Reads/writes the public `escalations` table directly via the supabase
// client; the n8n / Messenger pipeline inserts rows, and admin clears
// them with optional notes + a Messenger deep-link by PSID.
function EscalationsTab() {
  const [rows, setRows] = useState<Escalation[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"unresolved" | "all">("unresolved");
  const [editingNotes, setEditingNotes] = useState<string | null>(null);
  const [notesDraft, setNotesDraft] = useState("");
  const [saving, setSaving] = useState(false);

  const fetchRows = useCallback(async () => {
    setLoading(true);
    let q = supabase.from("escalations").select("*").order("created_at", { ascending: false });
    if (filter === "unresolved") q = q.eq("resolved", false);
    const { data } = await q;
    setRows((data ?? []) as Escalation[]);
    setLoading(false);
  }, [filter]);

  useEffect(() => { fetchRows(); }, [fetchRows]);

  const markResolved = async (id: string, notes: string) => {
    setSaving(true);
    await supabase.from("escalations").update({
      resolved: true,
      resolved_at: new Date().toISOString(),
      notes,
    }).eq("id", id);
    setSaving(false);
    setEditingNotes(null);
    fetchRows();
  };

  const saveNotesOnly = async (id: string) => {
    setSaving(true);
    await supabase.from("escalations").update({ notes: notesDraft }).eq("id", id);
    setSaving(false);
    setEditingNotes(null);
    fetchRows();
  };

  return (
    <div className="space-y-6">
      {/* Filter bar */}
      <div className="flex items-center gap-3">
        <div className="flex rounded-lg border border-border overflow-hidden text-sm">
          {(["unresolved", "all"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-4 py-2 transition ${
                filter === f ? "bg-foreground text-background font-medium" : "text-muted-foreground hover:bg-muted/50"
              }`}
            >
              {f === "unresolved" ? "Needs attention" : "All"}
            </button>
          ))}
        </div>
        <span className="text-sm text-muted-foreground">{rows.length} record{rows.length !== 1 ? "s" : ""}</span>
        <button onClick={fetchRows} className="ml-auto text-xs text-muted-foreground hover:text-foreground underline underline-offset-2">
          Refresh
        </button>
      </div>

      {loading ? (
        <div className="text-sm text-muted-foreground py-12 text-center">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card p-12 text-center">
          <MessageSquareWarning className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">
            {filter === "unresolved" ? "No open escalations — all caught up!" : "No escalations recorded yet."}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map((row) => (
            <div
              key={row.id}
              className={`rounded-2xl border bg-card p-5 space-y-3 ${
                row.resolved ? "border-border opacity-60" : "border-destructive/40"
              }`}
            >
              {/* Header row */}
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium">{row.full_name || "Unknown guest"}</span>
                    {row.state && (
                      <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-muted text-muted-foreground font-medium">
                        {row.state}
                      </span>
                    )}
                    {row.resolved && (
                      <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-green-500/10 text-green-600 font-medium">
                        Resolved
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 flex-wrap text-[11px] text-muted-foreground">
                    <span>PSID: {row.platform_id}</span>
                    <span>·</span>
                    <span>{new Date(row.created_at).toLocaleString()}</span>
                    <span>·</span>
                    <a
                      href={`https://www.facebook.com/messages/t/${row.platform_id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-blue-500 hover:text-blue-600 underline underline-offset-2 font-medium"
                    >
                      <Facebook className="h-3 w-3" />
                      Reply on Messenger
                    </a>
                  </div>
                </div>
                {!row.resolved && (
                  <button
                    onClick={() => {
                      setEditingNotes(row.id);
                      setNotesDraft(row.notes ?? "");
                    }}
                    className="shrink-0 text-xs px-3 py-1.5 rounded-lg border border-border hover:bg-muted/50 transition"
                  >
                    Mark resolved
                  </button>
                )}
              </div>

              {/* Guest message */}
              <div className="rounded-xl bg-muted/50 px-4 py-3 text-sm text-foreground leading-relaxed">
                {row.guest_message}
              </div>

              {/* Notes / resolve form */}
              {editingNotes === row.id ? (
                <div className="space-y-2">
                  <textarea
                    className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
                    rows={3}
                    placeholder="Add a note (optional) — e.g. replied via Messenger, added to FAQ…"
                    value={notesDraft}
                    onChange={(e) => setNotesDraft(e.target.value)}
                  />
                  <div className="flex gap-2">
                    <button
                      disabled={saving}
                      onClick={() => markResolved(row.id, notesDraft)}
                      className="text-xs px-3 py-1.5 rounded-lg bg-foreground text-background hover:opacity-90 transition disabled:opacity-50"
                    >
                      {saving ? "Saving…" : "Resolve"}
                    </button>
                    <button
                      onClick={() => saveNotesOnly(row.id)}
                      disabled={saving}
                      className="text-xs px-3 py-1.5 rounded-lg border border-border hover:bg-muted/50 transition disabled:opacity-50"
                    >
                      Save note only
                    </button>
                    <button
                      onClick={() => setEditingNotes(null)}
                      className="text-xs px-3 py-1.5 text-muted-foreground hover:text-foreground transition"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : row.notes ? (
                <div className="text-xs text-muted-foreground italic">
                  Note: {row.notes}
                  {!row.resolved && (
                    <button
                      onClick={() => { setEditingNotes(row.id); setNotesDraft(row.notes ?? ""); }}
                      className="ml-2 underline underline-offset-2 not-italic"
                    >
                      Edit
                    </button>
                  )}
                </div>
              ) : !row.resolved ? (
                <button
                  onClick={() => { setEditingNotes(row.id); setNotesDraft(""); }}
                  className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground transition"
                >
                  + Add note
                </button>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Tiny status pill rendered in the contacts table's "Invite status" column.
// Mirrors the same vocabulary used in the Invites tab (active / used /
// expired) so admins recognize it at a glance from either screen.
function InviteStatusPill({
  status,
}: {
  status:
    | { state: "active"; hoursLeft: number; invite: BookingInvite }
    | { state: "used"; invite: BookingInvite }
    | { state: "expired"; invite: BookingInvite }
    | { state: "none" };
}) {
  if (status.state === "none") {
    return <span className="text-xs text-muted-foreground/70">—</span>;
  }
  if (status.state === "active") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 text-primary text-[10px] font-semibold uppercase tracking-wider">
        Active · {status.hoursLeft}h
      </span>
    );
  }
  if (status.state === "used") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-muted text-muted-foreground text-[10px] font-semibold uppercase tracking-wider">
        Used{status.invite.used_at && ` · ${format(new Date(status.invite.used_at), "MMM d")}`}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-destructive/10 text-destructive text-[10px] font-semibold uppercase tracking-wider">
      Expired
    </span>
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
  inviteStatus,
  isCopied,
  onCopyInvite,
  onGenerateInvite,
}: {
  id: string;
  onClose: () => void;
  onSaved: () => void;
  inviteStatus?:
    | { state: "active"; hoursLeft: number; invite: BookingInvite }
    | { state: "used"; invite: BookingInvite }
    | { state: "expired"; invite: BookingInvite }
    | { state: "none" };
  isCopied?: boolean;
  onCopyInvite?: () => void;
  onGenerateInvite?: () => void;
}) {
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
                  <div className="min-w-0">
                    <div className="font-display text-2xl tracking-tight">{contact.full_name}</div>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      {contact.tags.map(t => (
                        <span key={t} className="px-2 py-0.5 rounded-full bg-mustard/25 text-charcoal text-[10px] font-medium">
                          {t}
                        </span>
                      ))}
                      {inviteStatus && inviteStatus.state !== "none" && (
                        <InviteStatusPill status={inviteStatus} />
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {/* Generate invite / Copy link — mirrors the contact-row
                        action. Hidden if the parent didn't pass the callbacks
                        (e.g. for non-waitlist contacts on a future caller). */}
                    {inviteStatus?.state === "active" && onCopyInvite ? (
                      <button
                        type="button"
                        onClick={onCopyInvite}
                        className="inline-flex items-center gap-1.5 text-xs bg-foreground text-background rounded-full px-3 py-1.5 font-medium hover:opacity-90 transition"
                      >
                        {isCopied ? (
                          <>
                            <CheckCircle2 className="h-3.5 w-3.5" /> Copied!
                          </>
                        ) : (
                          <>
                            <Mail className="h-3.5 w-3.5" /> Copy link
                          </>
                        )}
                      </button>
                    ) : onGenerateInvite &&
                      (contact.tags.includes("waitlist") ||
                        contact.tags.includes("pickup")) ? (
                      <button
                        type="button"
                        onClick={onGenerateInvite}
                        className="inline-flex items-center gap-1.5 text-xs bg-foreground text-background rounded-full px-3 py-1.5 font-medium hover:opacity-90 transition"
                      >
                        <Mail className="h-3.5 w-3.5" />
                        Generate invite
                      </button>
                    ) : null}
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
                  <ContactField label="Full name" value={draft.full_name} onChange={v => setDraft(d => ({ ...d, full_name: v }))} maxLength={120} />
                  <ContactField label="Email" type="email" value={draft.email} onChange={v => setDraft(d => ({ ...d, email: v }))} maxLength={254} />
                  <ContactField label="Phone" value={draft.phone} onChange={v => setDraft(d => ({ ...d, phone: v }))} maxLength={32} />
                  <ContactField label="Facebook handle" value={draft.facebook_handle} onChange={v => setDraft(d => ({ ...d, facebook_handle: v }))} maxLength={80} />
                  <ContactField label="Instagram handle" value={draft.instagram_handle} onChange={v => setDraft(d => ({ ...d, instagram_handle: v }))} maxLength={80} />
                  <ContactField label="Tags (comma-separated)" value={draft.tagsCsv} onChange={v => setDraft(d => ({ ...d, tagsCsv: v }))} maxLength={500} />
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
                              ? <>{format(new Date(b.time_slots.slot_date), "EEE, MMM d")} · {formatSlotTime12h(b.time_slots.slot_time)}</>
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
  label, value, onChange, type, maxLength,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  // Optional cap that mirrors the create_booking() server-side limits
  // so admins can't type past what the RPC accepts.
  maxLength?: number;
}) {
  return (
    <div>
      <label className="block text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">{label}</label>
      <input
        type={type ?? "text"}
        value={value}
        onChange={e => onChange(e.target.value)}
        maxLength={maxLength}
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
              onChange={e => setQuestion(e.target.value.slice(0, 300))}
              placeholder="e.g. What are your hours?"
              maxLength={300}
              className={cls}
            />
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">Answer</label>
            <textarea
              rows={6}
              value={answer}
              onChange={e => setAnswer(e.target.value.slice(0, 2000))}
              placeholder="The exact reply the chatbot will send."
              maxLength={2000}
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
              onChange={e => setTagsCsv(e.target.value.slice(0, 300))}
              placeholder="e.g. refund, cancel, credit"
              maxLength={300}
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

/* ============ Invites ============ */
type BookingInvite = {
  id: string;
  token: string;
  channel: "dine_in" | "pickup";
  customer_name: string;
  customer_email: string | null;
  customer_phone: string | null;
  group_size: number | null;
  source: string | null;
  platform_id: string | null;
  notes: string | null;
  expires_at: string;
  used_at: string | null;
  used_booking_id: string | null;
  // Added by the 20260517140000_booking_invites_contact_link migration.
  // Nullable for invites issued manually (no contact selected).
  contact_id: string | null;
  // Added by 20260529120000_waitlist_requested_slot — pins the invite to one
  // time slot (admin Waitlist bulk invite). Null for un-locked invites.
  slot_id: string | null;
  created_at: string;
};

// Generates a URL-safe random token. 24 bytes → 32 base64url chars ≈ 192
// bits — well past guess-resistant, and within the 16..128 length window
// the lookup_invite RPC accepts. Uses Web Crypto where available and a
// graceful fallback for legacy WebViews.
function generateInviteToken(): string {
  const bytes = new Uint8Array(24);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  let b64: string;
  if (typeof btoa === "function") {
    let bin = "";
    for (const b of bytes) bin += String.fromCharCode(b);
    b64 = btoa(bin);
  } else {
    b64 = Buffer.from(bytes).toString("base64");
  }
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function inviteStatus(inv: BookingInvite): "used" | "expired" | "unused" {
  if (inv.used_at) return "used";
  if (new Date(inv.expires_at) < new Date()) return "expired";
  return "unused";
}

function InvitesTab() {
  const [invites, setInvites] = useState<BookingInvite[]>([]);
  const [loading, setLoading] = useState(true);
  const [creatorOpen, setCreatorOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState<"all" | "unused" | "used" | "expired">("all");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    // booking_invites isn't in the generated types yet — cast through `as any`
    // until the next type-regen pass.
    const { data, error } = await supabase
      .from("booking_invites" as any)
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) console.warn("[invites] load failed:", error);
    setInvites(((data ?? []) as unknown as BookingInvite[]));
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    if (statusFilter === "all") return invites;
    return invites.filter(i => inviteStatus(i) === statusFilter);
  }, [invites, statusFilter]);

  const counts = useMemo(() => {
    const c = { all: invites.length, unused: 0, used: 0, expired: 0 };
    for (const i of invites) c[inviteStatus(i)] += 1;
    return c;
  }, [invites]);

  // KPI strip. Surfaces "what needs my attention today" at the page level.
  const kpis = useMemo(() => {
    const now = Date.now();
    const dayMs = 24 * 36e5;
    const sevenDaysAgo = now - 7 * dayMs;
    const thirtyDaysAgo = now - 30 * dayMs;

    let expiringSoon = 0;
    let usedThisWeek = 0;
    let usedLast30 = 0;
    let expiredLast30 = 0;
    for (const i of invites) {
      const s = inviteStatus(i);
      const expiresMs = new Date(i.expires_at).getTime();
      if (s === "unused" && expiresMs - now < dayMs) expiringSoon += 1;
      if (s === "used" && i.used_at && new Date(i.used_at).getTime() >= sevenDaysAgo) {
        usedThisWeek += 1;
      }
      const created = new Date(i.created_at).getTime();
      if (created >= thirtyDaysAgo) {
        if (s === "used") usedLast30 += 1;
        if (s === "expired") expiredLast30 += 1;
      }
    }
    const denom = usedLast30 + expiredLast30;
    const conversion = denom > 0 ? Math.round((usedLast30 / denom) * 100) : null;
    return { expiringSoon, usedThisWeek, conversion };
  }, [invites]);

  const linkFor = (inv: BookingInvite) => {
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    return `${origin}${inviteLinkPath(inv.channel, inv.token)}`;
  };

  const copyLink = async (inv: BookingInvite) => {
    const url = linkFor(inv);
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // Legacy fallback — modern admin browsers shouldn't hit this.
      const ta = document.createElement("textarea");
      ta.value = url;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setCopiedId(inv.id);
    window.setTimeout(() => setCopiedId(p => (p === inv.id ? null : p)), 1500);
  };

  const revokeInvite = async (inv: BookingInvite) => {
    if (inv.used_at) return;
    if (!confirm(`Delete invite for ${inv.customer_name}? The link will stop working.`)) return;
    const { error } = await supabase
      .from("booking_invites" as any)
      .delete()
      .eq("id", inv.id);
    if (error) {
      alert(`Couldn't delete: ${error.message}`);
      return;
    }
    load();
  };

  return (
    <div className="space-y-4">
      {/* KPI strip — one-glance read on what needs attention today. */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <InviteKpiCard
          label="Unused"
          value={counts.unused}
          sub="Active links"
          accent="primary"
          loading={loading}
        />
        <InviteKpiCard
          label="Expiring < 24h"
          value={kpis.expiringSoon}
          sub="Send a nudge"
          accent="mustard"
          loading={loading}
        />
        <InviteKpiCard
          label="Used this week"
          value={kpis.usedThisWeek}
          sub="Converted to booking"
          accent="success"
          loading={loading}
        />
        <InviteKpiCard
          label="Conversion rate"
          value={kpis.conversion == null ? "—" : `${kpis.conversion}%`}
          sub="Last 30 days"
          accent={null}
          loading={loading}
        />
      </div>

      {/* Filter row — chromeless segmented control + primary CTA. */}
      <div className="flex items-center justify-between gap-3 px-1">
        <div className="inline-flex bg-muted/60 rounded-full p-1 gap-0.5">
          {(["all", "unused", "used", "expired"] as const).map((s) => {
            const active = statusFilter === s;
            return (
              <button
                key={s}
                type="button"
                onClick={() => setStatusFilter(s)}
                className={`px-3 py-1.5 rounded-full text-[11px] font-semibold transition inline-flex items-center gap-1.5 ${
                  active
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {s === "all" ? "All" : s.charAt(0).toUpperCase() + s.slice(1)}
                <span
                  className={`tabular-nums ${
                    active ? "text-muted-foreground" : "text-muted-foreground/70"
                  }`}
                >
                  {counts[s]}
                </span>
              </button>
            );
          })}
        </div>
        <button
          onClick={() => setCreatorOpen(true)}
          className="inline-flex items-center gap-1.5 bg-primary text-primary-foreground rounded-full px-4 py-2 text-xs font-semibold hover:opacity-90 shadow-sm transition"
        >
          <Plus className="h-3.5 w-3.5" />
          Manual invite
        </button>
      </div>

      {/* List container — internal scroll so the page itself stays put as
          invites pile up. Sticky header inside the scroll keeps context. */}
      {loading ? (
        <div className="bg-card border border-border rounded-2xl py-12 text-center text-muted-foreground text-sm">
          Loading invites…
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-card border border-border rounded-2xl">
          <EmptyState
            icon={Inbox}
            title={EMPTY_COPY[statusFilter].title}
            hint={EMPTY_COPY[statusFilter].hint}
          />
        </div>
      ) : (
        <div className="rounded-2xl border border-border bg-muted/30 p-2 max-h-[calc(100vh-22rem)] overflow-y-auto">
          <div className="sticky top-0 z-10 bg-muted/30 backdrop-blur-sm px-2 py-1.5 flex items-center justify-between text-[10px] uppercase tracking-wider text-muted-foreground/70 font-medium">
            <span>
              Showing {filtered.length} of {invites.length}
            </span>
            <span>Newest first</span>
          </div>
          <ul className="space-y-2 mt-1">
            {filtered.map((inv) => (
              <InviteRow
                key={inv.id}
                inv={inv}
                copied={copiedId === inv.id}
                onCopy={() => copyLink(inv)}
                onRevoke={() => revokeInvite(inv)}
              />
            ))}
          </ul>
        </div>
      )}

      {creatorOpen && (
        <InviteCreator
          onClose={() => setCreatorOpen(false)}
          onCreated={() => { setCreatorOpen(false); load(); }}
        />
      )}
    </div>
  );
}

// Compact stats card used by the InvitesTab strip. Optional left-accent
// border surfaces urgency without competing with the value text.
function InviteKpiCard({
  label,
  value,
  sub,
  accent,
  loading,
}: {
  label: string;
  value: number | string;
  sub: string;
  accent: "primary" | "mustard" | "success" | null;
  loading: boolean;
}) {
  const accentClass =
    accent === "primary"
      ? "border-l-4 border-l-primary"
      : accent === "mustard"
      ? "border-l-4 border-l-mustard"
      : accent === "success"
      ? "border-l-4 border-l-emerald-500"
      : "";
  return (
    <div
      className={`bg-card border border-border rounded-2xl p-4 shadow-sm ${accentClass}`}
    >
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
        {label}
      </div>
      <div className="font-display text-3xl text-foreground leading-none mt-2 tabular-nums">
        {loading ? <span className="text-muted-foreground/40">—</span> : value}
      </div>
      <div className="text-[11px] text-muted-foreground mt-1">{sub}</div>
    </div>
  );
}

// Per-filter empty-state copy. Lives outside the component so the JSX
// stays clean and the strings are easy to find / edit.
const EMPTY_COPY: Record<
  "all" | "unused" | "used" | "expired",
  { title: string; hint: string }
> = {
  all: {
    title: "No invites issued yet",
    hint:
      "Generate one from the Contacts tab, or hit Manual invite to issue a link for a guest who isn't a contact yet.",
  },
  unused: {
    title: "Inbox zero",
    hint: "Every invite is either used or expired — nice work staying on top of it.",
  },
  used: {
    title: "No conversions yet",
    hint: "Used invites land here with the booking they created.",
  },
  expired: {
    title: "No expired invites",
    hint: "You're staying on top of those 24-hour links.",
  },
};

// Single invite row. Three zones (channel icon · identity+meta · actions)
// with a left status accent and an urgency-colored countdown for unused
// links. Delete only shows on hover so Copy link gets the spotlight.
function InviteRow({
  inv,
  copied,
  onCopy,
  onRevoke,
}: {
  inv: BookingInvite;
  copied: boolean;
  onCopy: () => void;
  onRevoke: () => void;
}) {
  const status = inviteStatus(inv);
  const hoursLeft =
    (new Date(inv.expires_at).getTime() - Date.now()) / 36e5;

  // Status accent on the left edge — reads like a Kanban swimlane stripe.
  const accentClass =
    status === "unused"
      ? hoursLeft < 12
        ? "border-l-2 border-l-destructive"
        : hoursLeft < 24
        ? "border-l-2 border-l-mustard"
        : "border-l-2 border-l-emerald-500"
      : status === "used"
      ? "border-l-2 border-l-muted-foreground/30"
      : "border-l-2 border-l-destructive/40";

  // Channel icon square — instant left-edge scan of dine-in vs pickup.
  const channelIsDineIn = inv.channel === "dine_in";

  // Subtle status pill (replaces the old loud uppercase pill).
  const statusPill =
    status === "unused"
      ? "bg-emerald-500/10 text-emerald-700"
      : status === "used"
      ? "bg-muted text-muted-foreground"
      : "bg-destructive/10 text-destructive";

  // Countdown color rules for unused invites.
  const countdownColor =
    hoursLeft < 12
      ? "text-destructive font-medium"
      : hoursLeft < 24
      ? "text-mustard"
      : "text-emerald-600";

  return (
    <li
      className={`group relative bg-card ${accentClass} border border-border rounded-xl px-4 py-3 hover:border-foreground/20 hover:shadow-sm transition ${
        status === "expired" ? "opacity-60" : ""
      }`}
    >
      <div className="flex items-center gap-4">
        {/* Zone A — channel indicator */}
        <div
          className={`flex items-center justify-center h-10 w-10 rounded-lg shrink-0 ${
            channelIsDineIn
              ? "bg-mustard/20 text-foreground"
              : "bg-primary/10 text-primary"
          }`}
          title={channelIsDineIn ? "Dine-in" : "Pickup"}
        >
          {channelIsDineIn ? (
            <UtensilsCrossed className="h-4 w-4" />
          ) : (
            <ShoppingBag className="h-4 w-4" />
          )}
        </div>

        {/* Zone B — identity + meta */}
        <div className="min-w-0 flex-1 space-y-0.5">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-foreground truncate">
              {inv.customer_name}
            </span>
            <span
              className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider ${statusPill}`}
            >
              {status}
            </span>
            {inv.source && inv.source !== "messenger" && (
              <span className="text-[10px] text-muted-foreground/70 uppercase tracking-wide">
                · {inv.source}
              </span>
            )}
          </div>
          <div className="text-xs text-muted-foreground truncate">
            {[
              inv.customer_email,
              inv.customer_phone,
              inv.group_size ? `Party of ${inv.group_size}` : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </div>
          <div className="text-[11px]">
            {status === "unused" && (
              <span className={`inline-flex items-center gap-1 ${countdownColor}`}>
                <Clock className="h-3 w-3" />
                Expires in {Math.max(0, Math.round(hoursLeft))}h
                <span className="text-muted-foreground/70 ml-1">
                  ({format(new Date(inv.expires_at), "MMM d, h:mm a")})
                </span>
              </span>
            )}
            {status === "used" && inv.used_at && (
              <span className="inline-flex items-center gap-1 text-muted-foreground">
                <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                Used {format(new Date(inv.used_at), "MMM d, h:mm a")}
                {inv.used_booking_id && (
                  <>
                    {" "}
                    →{" "}
                    <span className="font-mono">
                      {inv.used_booking_id.slice(0, 8)}
                    </span>
                  </>
                )}
              </span>
            )}
            {status === "expired" && (
              <span className="text-muted-foreground/70">
                Expired {format(new Date(inv.expires_at), "MMM d, h:mm a")}
              </span>
            )}
          </div>
        </div>

        {/* Zone C — actions */}
        <div className="shrink-0 flex items-center gap-1">
          {status === "unused" && (
            <button
              onClick={onCopy}
              className="inline-flex items-center gap-1.5 text-xs font-semibold rounded-full px-3.5 py-2 bg-foreground text-background hover:opacity-90 transition"
            >
              {copied ? (
                <>
                  <CheckCircle2 className="h-3.5 w-3.5" /> Copied
                </>
              ) : (
                <>Copy link</>
              )}
            </button>
          )}
          {!inv.used_at && (
            <button
              onClick={onRevoke}
              aria-label="Delete invite"
              className="opacity-0 group-hover:opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/5"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
    </li>
  );
}

type InviteCreatorPrefill = {
  contactId?: string;
  name?: string;
  email?: string | null;
  phone?: string | null;
  // Carried straight from ContactRow so the new invite row gets the PSID
  // attached at INSERT time. The n8n invite-sender workflow reads
  // booking_invites.platform_id and would have nothing to send to without
  // this — admin would have to type the PSID manually otherwise.
  messengerPsid?: string | null;
  source?: "messenger" | "instagram" | "manual";
  // Default for the dine-in / pickup radio. WaitlistTab passes this based on
  // the contact's tags ("waitlist" → dine_in, "pickup" → pickup) so the
  // admin doesn't have to remember which channel the guest came in through.
  channel?: "dine_in" | "pickup";
  // Pre-fill the party-size field from whatever the customer told the
  // bot on the waitlist. Avoids the admin defaulting to "2" when the
  // guest already said "4" in Messenger.
  groupSize?: number;
};

// The Messenger waitlist + pickup pipeline stashes party size into the
// contact's free-text notes ("Party size on waitlist: 4" or "Requested
// meals: 4") when the dedicated `last_party_size` column isn't set on a
// legacy row. Pull it back out so the InviteCreator can pre-fill the
// group_size field instead of defaulting to 2.
function extractPartySize(notes: string | null | undefined): number | undefined {
  if (!notes) return undefined;
  const m = notes.match(/(?:Party size on waitlist|Requested meals)[^:]*:\s*(\d+)/i);
  if (!m) return undefined;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) && n >= 1 && n <= 50 ? n : undefined;
}

function InviteCreator({
  prefill,
  onClose,
  onCreated,
}: {
  prefill?: InviteCreatorPrefill;
  onClose: () => void;
  onCreated: () => void;
}) {
  // Both channels enabled — pickup flow lives at the same /book/$token URL
  // and the customer page branches on this `channel` value to render the
  // dine-in or pickup UI. Default comes from the prefill (set by the
  // WaitlistTab button based on tag); falls back to dine-in for manual
  // invites issued from the Invites tab.
  const [channel, setChannel] = useState<"dine_in" | "pickup">(
    prefill?.channel ?? "dine_in",
  );
  const [name, setName] = useState(prefill?.name ?? "");
  const [email, setEmail] = useState(prefill?.email ?? "");
  const [phone, setPhone] = useState(prefill?.phone ?? "");
  const [groupSize, setGroupSize] = useState<number | "">(prefill?.groupSize ?? 2);
  const [source, setSource] = useState<"messenger" | "instagram" | "manual">(
    prefill?.source ?? "messenger",
  );
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const inputCls =
    "w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-foreground/10 focus:border-foreground transition";

  const nameOk = name.trim().length >= 2;
  const canSubmit = !busy && nameOk;

  const submit = async () => {
    if (!canSubmit) return;
    setErrorMsg(null);
    setBusy(true);
    const expiresAt = new Date(Date.now() + 72 * 3600_000).toISOString();
    const payload: Record<string, unknown> = {
      token: generateInviteToken(),
      channel,
      customer_name: name.trim(),
      customer_email: email.trim() ? email.trim().toLowerCase() : null,
      customer_phone: phone.trim() || null,
      group_size: typeof groupSize === "number" && groupSize >= 1 ? groupSize : null,
      source,
      notes: notes.trim() || null,
      expires_at: expiresAt,
    };
    // Link the invite back to the originating CRM contact when this is being
    // generated from the Contacts tab — lets the Invites monitor view show
    // "issued for <contact>" and groups invites by guest history.
    if (prefill?.contactId) payload.contact_id = prefill.contactId;
    // Copy the contact's Messenger PSID onto the invite so the n8n
    // sender workflow has a recipient when the row INSERT fires the
    // Supabase webhook.
    if (prefill?.messengerPsid) payload.platform_id = prefill.messengerPsid;
    const { error } = await supabase.from("booking_invites" as any).insert(payload);
    setBusy(false);
    if (error) {
      setErrorMsg(error.message);
      return;
    }
    onCreated();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4 py-6 bg-charcoal/40">
      <div className="bg-card border border-border rounded-2xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
          <h3 className="font-display text-lg font-semibold">Generate booking invite</h3>
          <button
            onClick={onClose}
            aria-label="Close"
            className="p-1 text-muted-foreground hover:text-foreground rounded-lg"
          >
            <XIcon className="h-4 w-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">
              Booking type
            </label>
            <div className="inline-flex rounded-full bg-muted p-0.5">
              {(["dine_in", "pickup"] as const).map(k => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setChannel(k)}
                  className={`text-xs px-3 py-1.5 rounded-full transition ${
                    channel === k
                      ? "bg-foreground text-background font-semibold"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {k === "dine_in" ? "Dine-in" : "Pickup"}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2">
              <label className="block text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">
                Customer name *
              </label>
              <input
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="Juan Dela Cruz"
                className={inputCls}
                maxLength={120}
              />
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="juan@example.com"
                className={inputCls}
              />
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">
                Phone
              </label>
              <input
                value={phone}
                onChange={e => setPhone(e.target.value)}
                placeholder="+63 917 000 0000"
                className={inputCls}
                maxLength={32}
              />
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">
                Group size
              </label>
              <input
                type="number"
                min={1}
                max={50}
                value={groupSize}
                onChange={e => {
                  const v = e.target.value;
                  if (v === "") setGroupSize("");
                  else {
                    const n = Number(v);
                    setGroupSize(Number.isFinite(n) ? Math.max(1, Math.min(50, Math.floor(n))) : "");
                  }
                }}
                className={inputCls}
              />
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">
                Source
              </label>
              <select
                value={source}
                onChange={e => setSource(e.target.value as any)}
                className={inputCls}
              >
                <option value="messenger">Messenger</option>
                <option value="instagram">Instagram</option>
                <option value="manual">Manual</option>
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="block text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">
                Notes (admin-only)
              </label>
              <textarea
                value={notes}
                onChange={e => setNotes(e.target.value.slice(0, 500))}
                rows={2}
                className={`${inputCls} resize-none`}
                placeholder="e.g. paid via Maya 2026-05-17 — waitlist #14"
              />
            </div>
          </div>

          <p className="text-[11px] text-muted-foreground bg-muted/40 border border-border rounded-lg p-3 leading-relaxed">
            The link expires in 72 hours and can only be used once. Customer
            info pre-fills on the booking page but stays editable in case of typos.
          </p>

          {errorMsg && (
            <div className="text-xs text-destructive bg-destructive/10 border border-destructive/30 rounded-lg p-2.5">
              {errorMsg}
            </div>
          )}
        </div>

        <div className="px-5 py-4 border-t border-border flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            disabled={busy}
            className="rounded-full px-4 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-muted/50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={!canSubmit}
            className="rounded-full bg-foreground text-background px-4 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50"
          >
            {busy ? "Generating…" : "Generate invite"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ============ Pipeline ============
   Kanban-style view of every customer in the pickup or dine-in flow, with
   one column per stage. The stage for each contact is DERIVED from
   existing tables (no separate stage column to keep in sync):

     contact.tags + latest invite + latest booking → stage

   Mapping (pickup channel; dine-in uses the same logic with relabeled
   columns):
     Request    – tagged 'pickup', no invite & no booking
     Invited    – has active (unused & unexpired) invite, no booking
     Booked     – latest booking status='pending', not completed
     Confirmed  – latest booking status='confirmed', not completed
     Picked up  – latest booking has completed_at
     Cancelled  – latest booking status='cancelled' (collapsed lane)
     Expired    – only expired/used invites without a booking (collapsed)

   Cards expose stage-appropriate actions so admin can advance the
   customer right from the board. */

type PipelineChannel = "pickup" | "dine_in";
type PipelineStage =
  | "request"
  | "invited"
  | "booked"
  | "confirmed"
  | "completed"
  | "cancelled"
  | "expired";

type PipelineBooking = {
  id: string;
  reference_code: string;
  status: string;
  created_at: string;
  confirmed_at: string | null;
  completed_at: string | null;
  pickup_mode: string | null;
  total_amount: number;
  customer_email: string | null;
  customer_phone: string | null;
  facebook_handle: string | null;
  time_slots?: { slot_date: string; slot_time: string };
  // Latest payment shell, so the Pipeline's Verify button can flip it
  // to 'verified' in the same operation that confirms the booking.
  payments?: { id: string; status: string | null }[];
};

type PipelineCard = {
  contact: ContactRow;
  invites: BookingInvite[];           // sorted most-recent first
  bookings: PipelineBooking[];        // sorted most-recent first
  stage: PipelineStage;
  // Convenience: highest-priority invite + latest booking already resolved
  activeInvite: BookingInvite | null;
  latestInvite: BookingInvite | null;
  latestBooking: PipelineBooking | null;
};

const STAGE_LABELS: Record<PipelineChannel, Record<PipelineStage, string>> = {
  pickup: {
    request: "Request",
    invited: "Invited",
    booked: "Booked",
    confirmed: "Confirmed",
    completed: "Picked up",
    cancelled: "Cancelled",
    expired: "Expired",
  },
  dine_in: {
    request: "Waitlist",
    invited: "Invited",
    booked: "Booked",
    confirmed: "Confirmed",
    completed: "Visited",
    cancelled: "Cancelled / No-show",
    expired: "Expired",
  },
};

// Returns the matching booking_invites row for an "active" claim — unused
// and not yet expired. Used for the Invited stage + Copy link button.
function findActiveInvite(invites: BookingInvite[]): BookingInvite | null {
  return (
    invites.find((i) => !i.used_at && new Date(i.expires_at) > new Date()) ??
    null
  );
}

function deriveStage(
  invites: BookingInvite[],
  bookings: PipelineBooking[],
): PipelineStage {
  const latestBooking = bookings[0] ?? null;
  if (latestBooking) {
    if (latestBooking.status === "cancelled") return "cancelled";
    if (latestBooking.completed_at) return "completed";
    if (latestBooking.status === "confirmed") return "confirmed";
    if (latestBooking.status === "pending") return "booked";
  }
  const active = findActiveInvite(invites);
  if (active) return "invited";
  // Has invites but none active (all used without booking — rare — or
  // expired). Drop to "expired" so the card shows up in the collapsed lane
  // for admin attention.
  if (invites.length > 0) return "expired";
  return "request";
}

// Match bookings → contact via email / phone / facebook_handle, mirroring
// the existing ContactDrawer pattern. Email match is case-insensitive.
function bookingMatchesContact(b: PipelineBooking, c: ContactRow): boolean {
  if (c.email && b.customer_email && b.customer_email.toLowerCase() === c.email.toLowerCase()) {
    return true;
  }
  if (c.phone && b.customer_phone && b.customer_phone === c.phone) return true;
  if (c.facebook_handle && b.facebook_handle && b.facebook_handle === c.facebook_handle) {
    return true;
  }
  return false;
}

function PipelineTab({ onJumpToOrders }: { onJumpToOrders: () => void }) {
  const [channel, setChannel] = useState<PipelineChannel>("dine_in");
  const [contacts, setContacts] = useState<ContactRow[]>([]);
  const [allInvites, setAllInvites] = useState<BookingInvite[]>([]);
  const [allBookings, setAllBookings] = useState<PipelineBooking[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteFor, setInviteFor] = useState<ContactRow | null>(null);
  const [copiedContactId, setCopiedContactId] = useState<string | null>(null);
  // Per-card busy flag for the "Mark complete" action so the button can
  // show a spinner without blocking the rest of the board.
  const [completingId, setCompletingId] = useState<string | null>(null);
  // Per-card busy flag for the "Verify" action so the button can show
  // its own spinner without blocking the rest of the board.
  const [verifyingId, setVerifyingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    // Load contacts tagged for the current channel. We do a wide fetch and
    // filter client-side rather than a contains() query so the response is
    // cached for both channels — switching tabs doesn't re-hit the network.
    const [{ data: cData }, { data: invData }, { data: bkData }] =
      await Promise.all([
        supabase
          .from("crm_contacts_with_stats")
          .select("*")
          .order("updated_at", { ascending: false }),
        supabase
          .from("booking_invites" as any)
          .select(
            "id, token, channel, customer_name, customer_email, customer_phone, group_size, source, platform_id, notes, expires_at, used_at, used_booking_id, contact_id, created_at",
          )
          .order("created_at", { ascending: false })
          .limit(500),
        supabase
          .from("bookings")
          .select(
            "id, reference_code, status, created_at, confirmed_at, completed_at, pickup_mode, total_amount, customer_email, customer_phone, facebook_handle, time_slots(slot_date, slot_time), payments(id, status)",
          )
          .order("created_at", { ascending: false })
          .limit(500),
      ]);
    setContacts((cData ?? []) as ContactRow[]);
    setAllInvites(((invData ?? []) as unknown) as BookingInvite[]);
    setAllBookings(((bkData ?? []) as unknown) as PipelineBooking[]);
    setLoading(false);
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  // Build the card set for the selected channel. Each contact yields one
  // card; the stage is derived; cards are bucketed by stage in the next
  // step. Contacts tagged for the OTHER channel are excluded (a customer
  // tagged both pickup AND waitlist appears in both pipelines — intentional).
  const cards = useMemo<PipelineCard[]>(() => {
    const wantTag = channel === "pickup" ? "pickup" : "waitlist";
    const relevantInvitesByContact = new Map<string, BookingInvite[]>();
    for (const inv of allInvites) {
      if (!inv.contact_id) continue;
      if (inv.channel !== channel) continue;
      const list = relevantInvitesByContact.get(inv.contact_id) ?? [];
      list.push(inv);
      relevantInvitesByContact.set(inv.contact_id, list);
    }

    return contacts
      .filter((c) => c.tags.includes(wantTag))
      .map<PipelineCard>((c) => {
        const invs = relevantInvitesByContact.get(c.id) ?? [];
        // Bookings whose pickup_mode aligns with this channel. Dine-in =
        // pickup_mode is null or 'dine_in'; pickup = anything else.
        const myBookings = allBookings
          .filter((b) => bookingMatchesContact(b, c))
          .filter((b) => {
            const mode = b.pickup_mode ?? "dine_in";
            return channel === "pickup" ? mode !== "dine_in" : mode === "dine_in";
          });
        const stage = deriveStage(invs, myBookings);
        return {
          contact: c,
          invites: invs,
          bookings: myBookings,
          stage,
          activeInvite: findActiveInvite(invs),
          latestInvite: invs[0] ?? null,
          latestBooking: myBookings[0] ?? null,
        };
      });
  }, [contacts, allInvites, allBookings, channel]);

  const byStage = useMemo(() => {
    const m: Record<PipelineStage, PipelineCard[]> = {
      request: [],
      invited: [],
      booked: [],
      confirmed: [],
      completed: [],
      cancelled: [],
      expired: [],
    };
    for (const card of cards) m[card.stage].push(card);
    return m;
  }, [cards]);

  const copyInviteLink = async (contactId: string, token: string) => {
    // The pipeline view is always scoped to a single channel via the
    // parent state, so any invite generated from here matches it.
    const path = inviteLinkPath(channel, token);
    const url =
      typeof window !== "undefined" ? `${window.location.origin}${path}` : path;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = url;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setCopiedContactId(contactId);
    window.setTimeout(
      () => setCopiedContactId((p) => (p === contactId ? null : p)),
      1500,
    );
  };

  // Verifies a pending booking directly from the pipeline card. Same
  // two writes the Orders tab's Verify button performs:
  //   1. payments.status → 'verified' (if a shell exists)
  //   2. bookings.status → 'confirmed' + stamp confirmed_at
  // The card moves to the CONFIRMED column on the next load() because
  // deriveStage() now sees latestBooking.status === 'confirmed'.
  const verifyBooking = async (bookingId: string, paymentId: string | null) => {
    setVerifyingId(bookingId);
    if (paymentId) {
      const { error: payErr } = await supabase
        .from("payments")
        .update({ status: "verified", verified_at: new Date().toISOString() })
        .eq("id", paymentId);
      if (payErr) {
        setVerifyingId(null);
        alert(`Couldn't mark payment verified: ${payErr.message}`);
        return;
      }
    }
    const { error: bookingErr } = await supabase
      .from("bookings")
      .update({ status: "confirmed", confirmed_at: new Date().toISOString() })
      .eq("id", bookingId);
    setVerifyingId(null);
    if (bookingErr) {
      alert(`Couldn't confirm booking: ${bookingErr.message}`);
      return;
    }
    load();
  };

  // Stamps completed_at on the latest confirmed booking. RLS already lets
  // admin UPDATE bookings, so no RPC needed here.
  const markCompleted = async (bookingId: string) => {
    setCompletingId(bookingId);
    // completed_at column was added by the 20260518120000 migration; the
    // generated types are stale until they're re-introspected, so cast at
    // the update payload to bypass.
    const { error } = await supabase
      .from("bookings")
      .update({ completed_at: new Date().toISOString() } as any)
      .eq("id", bookingId);
    setCompletingId(null);
    if (error) {
      alert(`Couldn't mark complete: ${error.message}`);
      return;
    }
    load();
  };

  // Stage order in the visible kanban (cancelled + expired sit in a
  // collapsed lane below).
  const mainStages: PipelineStage[] = [
    "request",
    "invited",
    "booked",
    "confirmed",
    "completed",
  ];

  return (
    <div className="space-y-6">
      {/* Channel toggle */}
      <div className="bg-card border border-border rounded-2xl p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="inline-flex rounded-full bg-muted p-0.5">
            {(["dine_in", "pickup"] as const).map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setChannel(c)}
                className={`text-sm px-4 py-1.5 rounded-full transition ${
                  channel === c
                    ? "bg-foreground text-background font-semibold"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {c === "pickup" ? "Pickup" : "Dine-in"}
              </button>
            ))}
          </div>
          <div className="text-xs text-muted-foreground">
            {loading
              ? "Loading…"
              : `${cards.length} ${cards.length === 1 ? "guest" : "guests"} in ${channel === "pickup" ? "pickup" : "dine-in"} pipeline`}
          </div>
        </div>
        <p className="text-[11px] text-muted-foreground mt-2 leading-relaxed">
          Stages are derived from invite + booking state — moving a card forward
          means clicking the action button on it (Generate invite, Copy link,
          Verify in Orders, Mark complete). No drag-and-drop, no drift.
        </p>
      </div>

      {/* Main 5-column kanban. Columns share the available width (no
          horizontal scrollbar at the board level); when a single column has
          more than ~5 cards, scrolling happens vertically inside that column
          via overflow-y-auto + max-height on the column body below. */}
      <div className="grid grid-cols-5 gap-3 min-w-0">
        {mainStages.map((stage) => (
            <PipelineColumn
              key={stage}
              label={STAGE_LABELS[channel][stage]}
              cards={byStage[stage]}
              channel={channel}
              tone={stage === "completed" ? "success" : "neutral"}
              loading={loading}
              renderCard={(card) => (
                <PipelineCardView
                  key={card.contact.id}
                  card={card}
                  channel={channel}
                  copied={copiedContactId === card.contact.id}
                  completing={
                    card.latestBooking
                      ? completingId === card.latestBooking.id
                      : false
                  }
                  verifying={
                    card.latestBooking
                      ? verifyingId === card.latestBooking.id
                      : false
                  }
                  onGenerateInvite={() => setInviteFor(card.contact)}
                  onCopyInvite={(token) =>
                    copyInviteLink(card.contact.id, token)
                  }
                  onJumpToOrders={onJumpToOrders}
                  onVerify={(bookingId, paymentId) =>
                    verifyBooking(bookingId, paymentId)
                  }
                  onMarkComplete={(bookingId) => markCompleted(bookingId)}
                />
              )}
            />
          ))}
      </div>

      {/* Collapsed lane — cancelled + expired together, less visually noisy
          than dedicated columns since they're terminal states admin
          rarely acts on. */}
      <PipelineCollapsedLane
        channel={channel}
        cancelled={byStage.cancelled}
        expired={byStage.expired}
      />

      {inviteFor && (
        <InviteCreator
          prefill={{
            contactId: inviteFor.id,
            name: inviteFor.full_name,
            email: inviteFor.email,
            phone: inviteFor.phone,
            messengerPsid: inviteFor.messenger_psid,
            groupSize: inviteFor.last_party_size ?? extractPartySize(inviteFor.notes),
            source:
              inviteFor.channels.includes("instagram")
                ? "instagram"
                : "messenger",
            channel,
          }}
          onClose={() => setInviteFor(null)}
          onCreated={() => {
            setInviteFor(null);
            load();
          }}
        />
      )}
    </div>
  );
}

function PipelineColumn({
  label,
  cards,
  channel: _channel,
  tone,
  loading,
  renderCard,
}: {
  label: string;
  cards: PipelineCard[];
  channel: PipelineChannel;
  tone: "neutral" | "success";
  loading: boolean;
  renderCard: (card: PipelineCard) => React.ReactNode;
}) {
  const headerTone =
    tone === "success" ? "text-primary" : "text-foreground";
  return (
    <div className="bg-muted/30 border border-border rounded-2xl flex flex-col min-h-[200px] min-w-0">
      <div className="px-3 py-2.5 border-b border-border flex items-center justify-between gap-2">
        <div className={`text-[11px] uppercase tracking-wider font-semibold ${headerTone}`}>
          {label}
        </div>
        <div className="text-[11px] text-muted-foreground tabular-nums">
          {loading ? "…" : cards.length}
        </div>
      </div>
      {/* Body caps at ~5 cards. A 6th card pushes the column into overflow,
          which paints a thin vertical scrollbar; columns with ≤5 cards never
          show one. max-h is tuned to ~5 × card height + gaps + padding. */}
      <div className="flex-1 p-2 space-y-2 overflow-y-auto max-h-[34rem]">
        {!loading && cards.length === 0 && (
          <div className="text-[11px] text-muted-foreground/70 italic px-2 py-3 text-center">
            Empty
          </div>
        )}
        {cards.map(renderCard)}
      </div>
    </div>
  );
}

function PipelineCardView({
  card,
  channel,
  copied,
  completing,
  verifying,
  onGenerateInvite,
  onCopyInvite,
  onJumpToOrders,
  onVerify,
  onMarkComplete,
}: {
  card: PipelineCard;
  channel: PipelineChannel;
  copied: boolean;
  completing: boolean;
  verifying: boolean;
  onGenerateInvite: () => void;
  onCopyInvite: (token: string) => void;
  onJumpToOrders: () => void;
  onVerify: (bookingId: string, paymentId: string | null) => void;
  onMarkComplete: (bookingId: string) => void;
}) {
  const { contact, stage, activeInvite, latestBooking } = card;
  return (
    <div className="bg-card border border-border rounded-xl p-3 shadow-sm space-y-2">
      <div className="min-w-0">
        <div className="text-sm font-semibold truncate">{contact.full_name}</div>
        <div className="text-[11px] text-muted-foreground truncate">
          {contact.email || contact.phone || contact.facebook_handle || "—"}
        </div>
      </div>

      {/* Stage-specific quick info */}
      {stage === "invited" && activeInvite && (
        <div className="text-[10px] text-muted-foreground">
          Expires{" "}
          {format(new Date(activeInvite.expires_at), "MMM d, h:mm a")}
        </div>
      )}
      {(stage === "booked" || stage === "confirmed" || stage === "completed") &&
        latestBooking && (
          <div className="text-[10px] text-muted-foreground space-y-0.5">
            <div className="font-mono">{latestBooking.reference_code}</div>
            {latestBooking.time_slots && (
              <div>
                {format(
                  new Date(latestBooking.time_slots.slot_date),
                  "MMM d",
                )}{" "}
                · {formatSlotTime12h(latestBooking.time_slots.slot_time)}
              </div>
            )}
            <div className="tabular-nums">
              ₱{Number(latestBooking.total_amount).toFixed(0)}
            </div>
          </div>
        )}

      {/* Stage-specific primary action */}
      {stage === "request" && (
        <button
          onClick={onGenerateInvite}
          className="w-full inline-flex items-center justify-center gap-1.5 text-[11px] font-semibold rounded-full px-2.5 py-1.5 bg-foreground text-background hover:opacity-90 transition"
        >
          <Mail className="h-3 w-3" />
          Generate invite
        </button>
      )}
      {stage === "invited" && activeInvite && (
        <button
          onClick={() => onCopyInvite(activeInvite.token)}
          className="w-full inline-flex items-center justify-center gap-1.5 text-[11px] font-semibold rounded-full px-2.5 py-1.5 bg-foreground text-background hover:opacity-90 transition"
        >
          {copied ? (
            <>
              <CheckCircle2 className="h-3 w-3" /> Copied!
            </>
          ) : (
            <>
              <Mail className="h-3 w-3" /> Copy link
            </>
          )}
        </button>
      )}
      {stage === "booked" && latestBooking && (
        <button
          onClick={() =>
            onVerify(
              latestBooking.id,
              latestBooking.payments?.[0]?.id ?? null,
            )
          }
          disabled={verifying}
          className="w-full inline-flex items-center justify-center gap-1.5 text-[11px] font-semibold rounded-full px-2.5 py-1.5 bg-foreground text-background hover:opacity-90 transition disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <CheckCircle2 className="h-3 w-3" />
          {verifying ? "Verifying…" : "Verify"}
        </button>
      )}
      {stage === "confirmed" && (
        <button
          onClick={onJumpToOrders}
          className="w-full inline-flex items-center justify-center gap-1.5 text-[11px] font-semibold rounded-full px-2.5 py-1.5 bg-muted hover:bg-muted/70 transition"
        >
          Open in Orders
          <ArrowRight className="h-3 w-3" />
        </button>
      )}
      {stage === "confirmed" && latestBooking && (
        <button
          onClick={() => onMarkComplete(latestBooking.id)}
          disabled={completing}
          className="w-full inline-flex items-center justify-center gap-1.5 text-[11px] font-semibold rounded-full px-2.5 py-1.5 bg-primary text-primary-foreground hover:opacity-90 transition disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <CheckCircle2 className="h-3 w-3" />
          {completing
            ? "Marking…"
            : channel === "pickup"
            ? "Mark picked up"
            : "Mark visited"}
        </button>
      )}
      {stage === "completed" && latestBooking?.completed_at && (
        <div className="text-[10px] text-primary inline-flex items-center gap-1">
          <CheckCircle2 className="h-3 w-3" />
          {format(new Date(latestBooking.completed_at), "MMM d, h:mm a")}
        </div>
      )}
    </div>
  );
}

function PipelineCollapsedLane({
  channel,
  cancelled,
  expired,
}: {
  channel: PipelineChannel;
  cancelled: PipelineCard[];
  expired: PipelineCard[];
}) {
  const [open, setOpen] = useState(false);
  const total = cancelled.length + expired.length;
  if (total === 0) return null;

  return (
    <div className="bg-card border border-border rounded-2xl shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((p) => !p)}
        className="w-full flex items-center justify-between gap-3 px-5 py-3 hover:bg-muted/30 transition"
      >
        <div className="flex items-center gap-3 text-sm">
          <span className="font-semibold">Inactive</span>
          <span className="text-xs text-muted-foreground">
            {cancelled.length} cancelled · {expired.length} expired
          </span>
        </div>
        <ChevronDown
          className={`h-4 w-4 text-muted-foreground transition-transform ${
            open ? "rotate-180" : "rotate-0"
          }`}
        />
      </button>
      {open && (
        <div className="border-t border-border px-5 py-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">
              {STAGE_LABELS[channel].cancelled}
            </div>
            {cancelled.length === 0 ? (
              <div className="text-[11px] text-muted-foreground/70 italic">
                None
              </div>
            ) : (
              <ul className="space-y-1.5">
                {cancelled.map((c) => (
                  <li
                    key={c.contact.id}
                    className="text-xs px-2.5 py-1.5 bg-muted/40 border border-border rounded-lg flex items-center justify-between gap-2"
                  >
                    <span className="truncate">{c.contact.full_name}</span>
                    {c.latestBooking && (
                      <span className="font-mono text-[10px] text-muted-foreground shrink-0">
                        {c.latestBooking.reference_code}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">
              {STAGE_LABELS[channel].expired}
            </div>
            {expired.length === 0 ? (
              <div className="text-[11px] text-muted-foreground/70 italic">
                None
              </div>
            ) : (
              <ul className="space-y-1.5">
                {expired.map((c) => (
                  <li
                    key={c.contact.id}
                    className="text-xs px-2.5 py-1.5 bg-muted/40 border border-border rounded-lg flex items-center justify-between gap-2"
                  >
                    <span className="truncate">{c.contact.full_name}</span>
                    {c.latestInvite && (
                      <span className="text-[10px] text-muted-foreground shrink-0">
                        {format(new Date(c.latestInvite.expires_at), "MMM d")}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
