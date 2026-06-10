// Supabase Edge Function — admin-team
//
// POST /functions/v1/admin-team
// Body: { action: "list" | "create" | "update" | "delete", ... }
//
// Lets an existing admin manage OTHER admin logins (create/edit/delete
// Supabase Auth users + their public.user_roles 'admin' row) from the
// admin console's Team tab, without touching the Supabase dashboard.
// Requires the service-role key, so this must run server-side.
//
// Auth: deployed WITH default JWT verification (no --no-verify-jwt), so the
// gateway already rejects unauthenticated calls. We additionally verify the
// caller holds the 'admin' role before doing anything privileged — being
// "logged in" isn't enough.
//
// Actions:
//   { action: "list" }
//     -> { members: TeamMember[] }
//   { action: "create", email, password, full_name, console_role?, tabs? }
//     -> { member: TeamMember }
//   { action: "update", user_id, email?, password?, full_name?, console_role?, tabs? }
//     -> { member: TeamMember }
//   { action: "delete", user_id }
//     -> { ok: true }
//     Refuses to delete the caller's own account or the last remaining
//     admin (P0001-style guardrails against locking everyone out).
//
// console_role ("admin" | "member", default "admin") and tabs (string[],
// subset of ASSIGNABLE_TABS) live in auth.users.user_metadata and drive the
// app-layer section restrictions in the admin console's sidebar — "member"
// accounts only see "overview" + their granted tabs, and never "team".
// Setting console_role to "member" is refused if it would leave zero other
// "admin" accounts (last_full_admin), and "member" callers are refused for
// every action on this endpoint (defense-in-depth — the Team tab is hidden
// from them in the UI).
//
// Deploy:
//   supabase functions deploy admin-team
//
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are auto-injected by the Edge
// Functions runtime — no `supabase secrets set` needed.

// deno-lint-ignore-file no-explicit-any
declare const Deno: { env: { get(name: string): string | undefined } };

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const EMAIL_RE = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;

// Sections a "member" account can be granted access to. Mirrors NAV in
// admin.tsx minus "overview" (always visible) and "team" (admin-only).
const ASSIGNABLE_TABS = [
  "menu", "pipeline", "bookings", "invites", "contacts",
  "slots", "seniorids", "escalations", "knowledge", "rules",
] as const;
type AssignableTab = typeof ASSIGNABLE_TABS[number];
type ConsoleRole = "admin" | "member";

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Max-Age": "86400",
  };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(), "content-type": "application/json" },
  });
}

type TeamMember = {
  id: string;
  email: string;
  full_name: string | null;
  console_role: ConsoleRole;
  tabs: AssignableTab[];
  created_at: string;
  last_sign_in_at: string | null;
};

function toMember(u: any): TeamMember {
  const meta = u.user_metadata ?? {};
  const tabs: AssignableTab[] = Array.isArray(meta.tabs)
    ? meta.tabs.filter((t: unknown): t is AssignableTab =>
        ASSIGNABLE_TABS.includes(t as AssignableTab))
    : [];
  return {
    id: u.id,
    email: u.email ?? "",
    full_name: (meta.full_name as string | undefined)?.trim() || null,
    console_role: meta.console_role === "member" ? "member" : "admin",
    tabs,
    created_at: u.created_at,
    last_sign_in_at: u.last_sign_in_at ?? null,
  };
}

async function listMembers(admin: SupabaseClient): Promise<Response> {
  const { data: roles, error: rolesErr } = await admin
    .from("user_roles")
    .select("user_id")
    .eq("role", "admin");
  if (rolesErr) return json(500, { error: "list_failed", detail: rolesErr.message });

  const adminIds = new Set((roles ?? []).map((r: any) => r.user_id));

  const { data, error } = await admin.auth.admin.listUsers({ perPage: 200 });
  if (error) return json(500, { error: "list_failed", detail: error.message });

  const members = (data?.users ?? [])
    .filter((u: any) => adminIds.has(u.id))
    .map(toMember)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));

  return json(200, { members });
}

async function createMember(admin: SupabaseClient, body: any): Promise<Response> {
  const email = String(body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");
  const fullName = String(body.full_name ?? "").trim();

  if (!fullName || fullName.length > 80) return json(400, { error: "invalid_full_name" });
  if (!EMAIL_RE.test(email)) return json(400, { error: "invalid_email" });
  if (password.length < 8) return json(400, { error: "weak_password" });

  if (body.console_role !== undefined && body.console_role !== "admin" && body.console_role !== "member") {
    return json(400, { error: "invalid_console_role" });
  }
  const consoleRole: ConsoleRole = body.console_role === "member" ? "member" : "admin";

  let tabs: AssignableTab[] = [];
  if (body.tabs !== undefined) {
    if (!Array.isArray(body.tabs) || !body.tabs.every((t: unknown) => ASSIGNABLE_TABS.includes(t as AssignableTab))) {
      return json(400, { error: "invalid_tabs" });
    }
    tabs = [...new Set(body.tabs as AssignableTab[])];
  }

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName, console_role: consoleRole, tabs },
  });
  if (error || !data?.user) {
    return json(400, { error: "create_failed", detail: error?.message ?? "unknown error" });
  }

  const { error: roleErr } = await admin
    .from("user_roles")
    .insert({ user_id: data.user.id, role: "admin" });
  if (roleErr) {
    // Don't leave behind an auth user with no admin role.
    await admin.auth.admin.deleteUser(data.user.id);
    return json(500, { error: "create_failed", detail: roleErr.message });
  }

  return json(200, { member: toMember(data.user) });
}

async function updateMember(admin: SupabaseClient, body: any): Promise<Response> {
  const userId = String(body.user_id ?? "");
  if (!userId) return json(400, { error: "invalid_request" });

  const update: Record<string, unknown> = {};

  if (typeof body.email === "string" && body.email.trim()) {
    const email = body.email.trim().toLowerCase();
    if (!EMAIL_RE.test(email)) return json(400, { error: "invalid_email" });
    update.email = email;
  }
  if (typeof body.password === "string" && body.password) {
    if (body.password.length < 8) return json(400, { error: "weak_password" });
    update.password = body.password;
  }

  const wantsFullName = typeof body.full_name === "string";
  if (wantsFullName) {
    const fullName = body.full_name.trim();
    if (!fullName || fullName.length > 80) return json(400, { error: "invalid_full_name" });
  }

  const wantsConsoleRole = body.console_role !== undefined;
  if (wantsConsoleRole && body.console_role !== "admin" && body.console_role !== "member") {
    return json(400, { error: "invalid_console_role" });
  }

  const wantsTabs = body.tabs !== undefined;
  if (wantsTabs && (!Array.isArray(body.tabs) || !body.tabs.every((t: unknown) => ASSIGNABLE_TABS.includes(t as AssignableTab)))) {
    return json(400, { error: "invalid_tabs" });
  }

  // Demoting to "member" must leave at least one other "admin" account, or
  // nobody could manage the team (or this account itself) afterwards.
  if (wantsConsoleRole && body.console_role === "member") {
    const { data: roles, error: rolesErr } = await admin
      .from("user_roles")
      .select("user_id")
      .eq("role", "admin");
    if (rolesErr) return json(500, { error: "update_failed", detail: rolesErr.message });

    const adminIds = new Set((roles ?? []).map((r: any) => r.user_id as string));
    const { data: usersData, error: usersErr } = await admin.auth.admin.listUsers({ perPage: 200 });
    if (usersErr) return json(500, { error: "update_failed", detail: usersErr.message });

    const otherFullAdmins = (usersData?.users ?? []).filter((u: any) =>
      u.id !== userId && adminIds.has(u.id) && u.user_metadata?.console_role !== "member"
    );
    if (otherFullAdmins.length === 0) return json(400, { error: "last_full_admin" });
  }

  if (wantsFullName || wantsConsoleRole || wantsTabs) {
    const { data: current, error: getErr } = await admin.auth.admin.getUserById(userId);
    if (getErr || !current?.user) {
      return json(400, { error: "update_failed", detail: getErr?.message ?? "user not found" });
    }
    const metadata: Record<string, unknown> = { ...current.user.user_metadata };
    if (wantsFullName) metadata.full_name = body.full_name.trim();
    if (wantsConsoleRole) metadata.console_role = body.console_role;
    if (wantsTabs) metadata.tabs = [...new Set(body.tabs as AssignableTab[])];
    update.user_metadata = metadata;
  }

  if (Object.keys(update).length === 0) return json(400, { error: "nothing_to_update" });

  const { data, error } = await admin.auth.admin.updateUserById(userId, update);
  if (error || !data?.user) {
    return json(400, { error: "update_failed", detail: error?.message ?? "unknown error" });
  }

  return json(200, { member: toMember(data.user) });
}

async function deleteMember(admin: SupabaseClient, body: any, callerId: string): Promise<Response> {
  const userId = String(body.user_id ?? "");
  if (!userId) return json(400, { error: "invalid_request" });

  if (userId === callerId) return json(400, { error: "cannot_delete_self" });

  const { count, error: countErr } = await admin
    .from("user_roles")
    .select("id", { count: "exact", head: true })
    .eq("role", "admin");
  if (countErr) return json(500, { error: "delete_failed", detail: countErr.message });
  if ((count ?? 0) <= 1) return json(400, { error: "last_admin" });

  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) return json(500, { error: "delete_failed", detail: error.message });

  return json(200, { ok: true });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }
  if (req.method !== "POST") {
    return json(405, { error: "method_not_allowed" });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return json(500, { error: "server_misconfigured" });
  }

  const jwt = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!jwt) return json(401, { error: "unauthorized" });

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { data: callerData, error: callerErr } = await admin.auth.getUser(jwt);
  if (callerErr || !callerData?.user) return json(401, { error: "unauthorized" });
  const caller = callerData.user;

  const { data: roleRow } = await admin
    .from("user_roles")
    .select("id")
    .eq("user_id", caller.id)
    .eq("role", "admin")
    .maybeSingle();
  if (!roleRow) return json(403, { error: "forbidden" });

  // Limited "member" accounts never see the Team tab in the UI; this is a
  // defense-in-depth backstop if one calls this function directly.
  if (caller.user_metadata?.console_role === "member") {
    return json(403, { error: "forbidden" });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "invalid_json" });
  }

  switch (body?.action) {
    case "list":
      return listMembers(admin);
    case "create":
      return createMember(admin, body);
    case "update":
      return updateMember(admin, body);
    case "delete":
      return deleteMember(admin, body, caller.id);
    default:
      return json(400, { error: "invalid_action" });
  }
});
