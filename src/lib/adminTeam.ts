// Client-side bridge to the `admin-team` Supabase Edge Function.
//
// Lets an admin create/edit/delete OTHER admin logins from the Team tab.
// The edge function does the privileged work (Supabase Auth admin API +
// public.user_roles) using the service-role key, which never touches the
// browser. The auth JWT is attached automatically by `supabase.functions.invoke`.

import { supabase } from "@/integrations/supabase/client";

export type TeamMember = {
  id: string;
  email: string;
  full_name: string | null;
  created_at: string;
  last_sign_in_at: string | null;
};

type ErrorBody = { error?: string; detail?: string };

// The edge function returns `{ error, detail? }` on failure even with a 2xx
// status in some paths, so check `data?.error` in addition to `error`.
function resultOrThrow<T>(data: (T & ErrorBody) | null, error: { message: string } | null): T {
  if (error) throw new Error(error.message);
  if (!data) throw new Error("no_response");
  if (data.error) throw new Error(data.detail ?? data.error);
  return data as T;
}

export async function listTeamMembers(): Promise<TeamMember[]> {
  const { data, error } = await supabase.functions.invoke<{ members: TeamMember[] } & ErrorBody>(
    "admin-team",
    { body: { action: "list" } },
  );
  return resultOrThrow(data, error).members;
}

export async function createTeamMember(input: {
  email: string;
  password: string;
  full_name: string;
}): Promise<TeamMember> {
  const { data, error } = await supabase.functions.invoke<{ member: TeamMember } & ErrorBody>(
    "admin-team",
    { body: { action: "create", ...input } },
  );
  return resultOrThrow(data, error).member;
}

export async function updateTeamMember(input: {
  user_id: string;
  email?: string;
  password?: string;
  full_name?: string;
}): Promise<TeamMember> {
  const { data, error } = await supabase.functions.invoke<{ member: TeamMember } & ErrorBody>(
    "admin-team",
    { body: { action: "update", ...input } },
  );
  return resultOrThrow(data, error).member;
}

export async function deleteTeamMember(user_id: string): Promise<void> {
  const { data, error } = await supabase.functions.invoke<{ ok: true } & ErrorBody>(
    "admin-team",
    { body: { action: "delete", user_id } },
  );
  resultOrThrow(data, error);
}
