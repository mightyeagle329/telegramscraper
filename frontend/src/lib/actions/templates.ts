"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { extractTemplateVariables, type DbMessageTemplate } from "@/types/database";

type Result<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

const TEMPLATES_PATH = "/templates";
const MAX_BODY_LEN = 4096;

type AuthResult =
  | { ok: false; error: string }
  | { ok: true; supabase: Awaited<ReturnType<typeof createClient>>; userId: string };

async function authClient(): Promise<AuthResult> {
  if (!isSupabaseConfigured()) {
    return {
      ok: false,
      error:
        "Supabase is not configured — templates aren't available in local-dev mode. Set up Supabase to enable CRUD.",
    };
  }
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not authenticated — please log in." };
  return { ok: true, supabase, userId: user.id };
}

function validateBody(body: string): string | null {
  if (!body.trim()) return "Message body can't be empty.";
  if (body.length > MAX_BODY_LEN) {
    return `Message body is too long (${body.length} / ${MAX_BODY_LEN}).`;
  }
  return null;
}

export async function listTemplates(): Promise<Result<DbMessageTemplate[]>> {
  const auth = await authClient();
  if (!auth.ok) return auth;
  const { data, error } = await auth.supabase
    .from("message_templates")
    .select("*")
    .eq("user_id", auth.userId)
    .order("updated_at", { ascending: false });
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: (data ?? []) as DbMessageTemplate[] };
}

export async function createTemplate(input: {
  name: string;
  body: string;
}): Promise<Result<DbMessageTemplate>> {
  const auth = await authClient();
  if (!auth.ok) return auth;
  if (!input.name.trim()) return { ok: false, error: "Template name is required." };
  const bodyErr = validateBody(input.body);
  if (bodyErr) return { ok: false, error: bodyErr };
  const { data, error } = await auth.supabase
    .from("message_templates")
    .insert({
      user_id: auth.userId,
      name: input.name.trim(),
      body: input.body,
      variables: extractTemplateVariables(input.body),
    })
    .select()
    .single();
  if (error) return { ok: false, error: error.message };
  revalidatePath(TEMPLATES_PATH);
  return { ok: true, data: data as DbMessageTemplate };
}

export async function updateTemplate(
  id: string,
  input: { name: string; body: string }
): Promise<Result<DbMessageTemplate>> {
  const auth = await authClient();
  if (!auth.ok) return auth;
  if (!input.name.trim()) return { ok: false, error: "Template name is required." };
  const bodyErr = validateBody(input.body);
  if (bodyErr) return { ok: false, error: bodyErr };
  const { data, error } = await auth.supabase
    .from("message_templates")
    .update({
      name: input.name.trim(),
      body: input.body,
      variables: extractTemplateVariables(input.body),
    })
    .eq("id", id)
    .eq("user_id", auth.userId)
    .select()
    .single();
  if (error) return { ok: false, error: error.message };
  revalidatePath(TEMPLATES_PATH);
  return { ok: true, data: data as DbMessageTemplate };
}

export async function deleteTemplate(id: string): Promise<Result<true>> {
  const auth = await authClient();
  if (!auth.ok) return auth;
  const { error } = await auth.supabase
    .from("message_templates")
    .delete()
    .eq("id", id)
    .eq("user_id", auth.userId);
  if (error) return { ok: false, error: error.message };
  revalidatePath(TEMPLATES_PATH);
  return { ok: true, data: true };
}
