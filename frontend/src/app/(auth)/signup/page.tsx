"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useT } from "@/lib/i18n/context";

export default function SignupPage() {
  const t = useT();
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
      <Shell>
        <h1 className="text-xl font-semibold">
          {t("auth.signup.checkEmail.title")}
        </h1>
        <p className="text-text-muted text-sm mt-3">
          {t("auth.signup.checkEmail.body", { email })}
        </p>
      </Shell>
    );
  }

  return (
    <Shell>
      <h1 className="text-xl font-semibold">{t("auth.signup.title")}</h1>
      <p className="text-text-muted text-sm mt-1">{t("auth.signup.subtitle")}</p>
      <form onSubmit={handleSubmit} className="space-y-4 mt-5">
        <Field label={`${t("auth.field.fullName")} ${t("auth.field.fullName.optional")}`}>
          <input
            type="text"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            className="input"
          />
        </Field>
        <Field label={t("auth.field.email")}>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoFocus
            className="input"
          />
        </Field>
        <Field
          label={`${t("auth.field.password")} — ${t("auth.field.password.hint")}`}
        >
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={8}
            required
            className="input"
          />
        </Field>
        {error ? <div className="text-accent-red text-sm">{error}</div> : null}
        <button
          type="submit"
          disabled={busy}
          className="w-full px-4 py-2 rounded-lg bg-accent-green/20 border border-accent-green/40 text-accent-green font-medium hover:bg-accent-green/30 disabled:opacity-50"
        >
          {busy ? t("auth.signup.loading") : t("auth.signup.submit")}
        </button>
      </form>
      <p className="text-text-muted text-sm text-center mt-6">
        {t("auth.signup.haveAccount")}{" "}
        <Link href="/login" className="text-foreground hover:underline">
          {t("nav.signIn")}
        </Link>
      </p>

      <style>{`
        .input{
          width:100%;
          background:var(--background,#0a0a0a);
          border:1px solid var(--card-border,#27272a);
          border-radius:.5rem;
          padding:.5rem .75rem;
          font-size:.875rem;
          color:inherit;
        }
        .input:focus{outline:none;border-color:rgba(34,197,94,.5)}
      `}</style>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  const t = useT();
  return (
    <div className="min-h-screen flex items-center justify-center px-4 md:px-6 bg-background">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <Link href="/" className="font-bold text-xl">
            {t("app.name")}
          </Link>
        </div>
        <div className="card-elevated p-5 md:p-6">{children}</div>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="block text-xs uppercase text-text-muted mb-1">
        {label}
      </span>
      {children}
    </label>
  );
}
