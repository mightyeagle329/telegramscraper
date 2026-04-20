"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  // useSearchParams requires a Suspense boundary in Next.js 16.
  return (
    <Suspense
      fallback={
        <AuthShell title="Log in">
          <div className="text-text-muted text-sm">Loading…</div>
        </AuthShell>
      }
    >
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const search = useSearchParams();
  const next = search.get("next") || "/dashboard";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (error) {
        setError(error.message);
        return;
      }
      router.push(next);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell title="Log in" subtitle="Welcome back.">
      <form onSubmit={handleSubmit} className="space-y-4">
        <Input
          label="Email"
          type="email"
          value={email}
          onChange={setEmail}
          autoFocus
          required
        />
        <Input
          label="Password"
          type="password"
          value={password}
          onChange={setPassword}
          required
        />
        {error ? (
          <div className="text-accent-red text-sm">{error}</div>
        ) : null}
        <button
          type="submit"
          disabled={busy}
          className="w-full px-4 py-2 rounded-lg bg-accent-green/20 border border-accent-green/40 text-accent-green font-medium hover:bg-accent-green/30 disabled:opacity-50"
        >
          {busy ? "Logging in…" : "Log in"}
        </button>
      </form>
      <p className="text-text-muted text-sm text-center mt-6">
        Don&apos;t have an account?{" "}
        <Link href="/signup" className="text-white hover:underline">
          Sign up
        </Link>
      </p>
    </AuthShell>
  );
}

// Small local-only helpers; we duplicate-ish across login/signup rather than
// building a shared auth components folder until the auth flow grows.

function AuthShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen flex items-center justify-center px-6 bg-background">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <Link href="/" className="font-bold text-xl">
            Telegram Outreach
          </Link>
        </div>
        <div className="bg-card-bg border border-card-border rounded-xl p-6">
          <h1 className="text-xl font-semibold">{title}</h1>
          {subtitle ? (
            <p className="text-text-muted text-sm mt-1">{subtitle}</p>
          ) : null}
          <div className="mt-5">{children}</div>
        </div>
      </div>
    </div>
  );
}

function Input({
  label,
  type,
  value,
  onChange,
  autoFocus,
  required,
}: {
  label: string;
  type: string;
  value: string;
  onChange: (v: string) => void;
  autoFocus?: boolean;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="block text-xs uppercase text-text-muted mb-1">
        {label}
      </span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoFocus={autoFocus}
        required={required}
        className="w-full bg-background border border-card-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent-green/50"
      />
    </label>
  );
}
