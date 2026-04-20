"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import type { DbProfile, DbUserSettings } from "@/types/database";

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

type AuthResult =
  | { ok: false; error: string }
  | {
      ok: true;
      supabase: Awaited<ReturnType<typeof createClient>>;
      userId: string;
    };

async function authClient(): Promise<AuthResult> {
  if (!isSupabaseConfigured()) {
    return {
      ok: false,
      error: "Supabase isn't configured — settings aren't available in local-dev mode.",
    };
  }
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not authenticated." };
  return { ok: true, supabase, userId: user.id };
}

/** Load both profile + settings in one round trip. */
export async function loadSettings(): Promise<
  Result<{ profile: DbProfile | null; settings: DbUserSettings | null }>
> {
  const auth = await authClient();
  if (!auth.ok) return auth;

  const [{ data: profile }, { data: settings }] = await Promise.all([
    auth.supabase.from("profiles").select("*").eq("id", auth.userId).maybeSingle(),
    auth.supabase.from("user_settings").select("*").eq("user_id", auth.userId).maybeSingle(),
  ]);

  return {
    ok: true,
    data: {
      profile: (profile ?? null) as DbProfile | null,
      settings: (settings ?? null) as DbUserSettings | null,
    },
  };
}

export interface ProfileInput {
  full_name?: string;
  timezone?: string;
}

export async function updateProfile(
  input: ProfileInput
): Promise<Result<DbProfile>> {
  const auth = await authClient();
  if (!auth.ok) return auth;

  const patch: Record<string, string> = {};
  if (input.full_name !== undefined) patch.full_name = input.full_name.trim();
  if (input.timezone !== undefined) patch.timezone = input.timezone.trim();

  const { data, error } = await auth.supabase
    .from("profiles")
    .update(patch)
    .eq("id", auth.userId)
    .select()
    .single();
  if (error) return { ok: false, error: error.message };
  revalidatePath("/settings");
  return { ok: true, data: data as DbProfile };
}

export interface SettingsInput {
  default_delay_min_s?: number;
  default_delay_max_s?: number;
  warmup_days?: number;
  steady_daily_limit?: number;
  default_delete_after_s?: number | null;
  min_template_variants?: number;
  peer_flood_pause_hours?: number;
  operating_start_hour?: number | null;
  operating_end_hour?: number | null;
  timezone?: string;
}

function validate(input: SettingsInput): string | null {
  if (
    input.default_delay_min_s !== undefined &&
    input.default_delay_max_s !== undefined &&
    input.default_delay_min_s >= input.default_delay_max_s
  ) {
    return "Minimum delay must be less than maximum delay.";
  }
  if (input.default_delay_min_s !== undefined && input.default_delay_min_s < 10) {
    return "Minimum delay must be at least 10 seconds (Telegram will flag anything faster).";
  }
  if (input.warmup_days !== undefined && (input.warmup_days < 0 || input.warmup_days > 30)) {
    return "Warm-up days must be between 0 and 30.";
  }
  if (
    input.steady_daily_limit !== undefined &&
    (input.steady_daily_limit < 1 || input.steady_daily_limit > 200)
  ) {
    return "Steady daily limit must be between 1 and 200.";
  }
  if (
    input.operating_start_hour !== undefined &&
    input.operating_start_hour !== null &&
    (input.operating_start_hour < 0 || input.operating_start_hour > 23)
  ) {
    return "Operating start hour must be 0–23.";
  }
  if (
    input.operating_end_hour !== undefined &&
    input.operating_end_hour !== null &&
    (input.operating_end_hour < 0 || input.operating_end_hour > 23)
  ) {
    return "Operating end hour must be 0–23.";
  }
  return null;
}

export async function updateSettings(
  input: SettingsInput
): Promise<Result<DbUserSettings>> {
  const auth = await authClient();
  if (!auth.ok) return auth;

  const validationError = validate(input);
  if (validationError) return { ok: false, error: validationError };

  // Upsert so the user gets a row even if the signup trigger hasn't run
  // (it was added in migration 00002; pre-existing users may not have one).
  const { data, error } = await auth.supabase
    .from("user_settings")
    .upsert({ user_id: auth.userId, ...input }, { onConflict: "user_id" })
    .select()
    .single();
  if (error) return { ok: false, error: error.message };
  revalidatePath("/settings");
  return { ok: true, data: data as DbUserSettings };
}

/** Change email/password via Supabase Auth. */
export async function updateAccountSecurity(input: {
  email?: string;
  password?: string;
}): Promise<Result<true>> {
  const auth = await authClient();
  if (!auth.ok) return auth;

  const patch: { email?: string; password?: string } = {};
  if (input.email) patch.email = input.email.trim();
  if (input.password) {
    if (input.password.length < 8)
      return { ok: false, error: "Password must be at least 8 characters." };
    patch.password = input.password;
  }
  if (Object.keys(patch).length === 0) {
    return { ok: false, error: "Nothing to update." };
  }

  const { error } = await auth.supabase.auth.updateUser(patch);
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: true };
}
