"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function SignupPage() {
  const router = useRouter();

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [awaitConfirm, setAwaitConfirm] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const supabase = createClient();
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { full_name: fullName || undefined },
          emailRedirectTo: `${window.location.origin}/callback`,
        },
      });
      if (error) {
        setError(error.message);
        return;
      }
      // If Supabase project requires email confirmation, `session` is null
      // and the user needs to click the link. Otherwise land them straight in.
      if (!data.session) {
        setAwaitConfirm(true);
        return;
      }
      router.push("/dashboard");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (awaitConfirm) {
    return (
      <div className="min-h-screen flex items-center justify-center px-6 bg-background">
        <div className="w-full max-w-sm text-center">
          <Link href="/" className="font-bold text-xl">
            Telegram Outreach
          </Link>
          <div className="bg-card-bg border border-card-border rounded-xl p-6 mt-6">
            <h1 className="text-xl font-semibold">Check your email</h1>
            <p className="text-text-muted text-sm mt-3">
              We sent a confirmation link to{" "}
              <span className="text-foreground">{email}</span>. Click it to finish
              creating your account.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-6 bg-background">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <Link href="/" className="font-bold text-xl">
            Telegram Outreach
          </Link>
        </div>
        <div className="bg-card-bg border border-card-border rounded-xl p-6">
          <h1 className="text-xl font-semibold">Create your account</h1>
          <p className="text-text-muted text-sm mt-1">
            Free to start. No credit card.
          </p>
          <form onSubmit={handleSubmit} className="space-y-4 mt-5">
            <Field label="Full name" optional>
              <input
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="input"
              />
            </Field>
            <Field label="Email">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus
                className="input"
              />
            </Field>
            <Field label="Password" hint="at least 8 characters">
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={8}
                required
                className="input"
              />
            </Field>
            {error ? (
              <div className="text-accent-red text-sm">{error}</div>
            ) : null}
            <button
              type="submit"
              disabled={busy}
              className="w-full px-4 py-2 rounded-lg bg-accent-green/20 border border-accent-green/40 text-accent-green font-medium hover:bg-accent-green/30 disabled:opacity-50"
            >
              {busy ? "Creating account…" : "Sign up"}
            </button>
          </form>
          <p className="text-text-muted text-sm text-center mt-6">
            Already have an account?{" "}
            <Link href="/login" className="text-foreground hover:underline">
              Log in
            </Link>
          </p>
        </div>
      </div>
      <style>{`.input{width:100%;background:var(--background,#0a0a0a);border:1px solid var(--card-border,#27272a);border-radius:.5rem;padding:.5rem .75rem;font-size:.875rem;color:inherit}.input:focus{outline:none;border-color:rgba(34,197,94,.5)}`}</style>
    </div>
  );
}

function Field({
  label,
  hint,
  optional,
  children,
}: {
  label: string;
  hint?: string;
  optional?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="block text-xs uppercase text-text-muted mb-1">
        {label}
        {optional ? (
          <span className="normal-case text-text-muted/70 ml-1">
            (optional)
          </span>
        ) : null}
        {hint ? (
          <span className="normal-case text-text-muted/70 ml-2">— {hint}</span>
        ) : null}
      </span>
      {children}
    </label>
  );
}
