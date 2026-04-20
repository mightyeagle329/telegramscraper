"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { ProxyInput } from "@/lib/types";

type Step = "form" | "code" | "password";

interface Props {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

const initialForm = {
  phone: "",
  label: "",
  proxyType: "socks5" as "socks5" | "socks4" | "http",
  proxyHost: "",
  proxyPort: "",
  proxyUsername: "",
  proxyPassword: "",
  apiId: "",
  apiHash: "",
};

export default function AddAccountModal({ open, onClose, onSuccess }: Props) {
  const [step, setStep] = useState<Step>("form");
  const [form, setForm] = useState(initialForm);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [expiresIn, setExpiresIn] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const reset = () => {
    setStep("form");
    setForm(initialForm);
    setCode("");
    setPassword("");
    setToken(null);
    setExpiresIn(0);
    setBusy(false);
    setError(null);
    if (countdownRef.current) {
      clearInterval(countdownRef.current);
      countdownRef.current = null;
    }
  };

  useEffect(() => {
    if (!open) reset();
  }, [open]);

  useEffect(() => {
    if (expiresIn <= 0) {
      if (countdownRef.current) {
        clearInterval(countdownRef.current);
        countdownRef.current = null;
      }
      return;
    }
    countdownRef.current = setInterval(() => {
      setExpiresIn((s) => Math.max(0, s - 1));
    }, 1000);
    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, [token]);

  const close = async () => {
    if (token && step !== "form") {
      try {
        await api.signupAbandon(token);
      } catch {
        /* ignore */
      }
    }
    reset();
    onClose();
  };

  const submitForm = async () => {
    setError(null);
    if (!form.phone.startsWith("+")) {
      setError("Phone must be in E.164 format (starts with +).");
      return;
    }
    const proxy: ProxyInput | null =
      form.proxyHost && form.proxyPort
        ? {
            type: form.proxyType,
            host: form.proxyHost.trim(),
            port: Number(form.proxyPort),
            username: form.proxyUsername.trim() || null,
            password: form.proxyPassword || null,
          }
        : null;
    setBusy(true);
    try {
      const res = await api.signupStart({
        phone: form.phone.trim(),
        label: form.label.trim(),
        proxy,
        api_id: form.apiId ? Number(form.apiId) : null,
        api_hash: form.apiHash.trim() || null,
      });
      setToken(res.signup_token);
      setExpiresIn(res.expires_in_s);
      setStep("code");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Signup failed");
    } finally {
      setBusy(false);
    }
  };

  const submitCode = async () => {
    setError(null);
    if (!token) return;
    if (!code.trim()) {
      setError("Enter the SMS code Telegram sent.");
      return;
    }
    setBusy(true);
    try {
      const res = await api.signupVerify(token, code.trim());
      if (res.state === "awaiting_password" || res.needs_password) {
        setStep("password");
        setCode("");
      } else if (res.state === "completed") {
        onSuccess();
        reset();
        onClose();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Code verification failed");
    } finally {
      setBusy(false);
    }
  };

  const submitPassword = async () => {
    setError(null);
    if (!token) return;
    if (!password) {
      setError("Enter the 2FA cloud password.");
      return;
    }
    setBusy(true);
    try {
      const res = await api.signupPassword(token, password);
      if (res.state === "completed") {
        onSuccess();
        reset();
        onClose();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "2FA verification failed");
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="bg-card-bg border border-card-border rounded-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between border-b border-card-border px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold">Add sender account</h2>
            <p className="text-xs text-text-muted">
              Step {step === "form" ? 1 : step === "code" ? 2 : 3} of 3 ·{" "}
              {step === "form"
                ? "phone + proxy"
                : step === "code"
                ? "SMS verification"
                : "2FA password"}
              {expiresIn > 0 && step !== "form"
                ? ` · expires in ${Math.floor(expiresIn / 60)}:${String(
                    expiresIn % 60
                  ).padStart(2, "0")}`
                : ""}
            </p>
          </div>
          <button
            onClick={close}
            className="text-text-muted hover:text-white text-2xl leading-none"
            aria-label="close"
          >
            ×
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          {error ? (
            <div className="px-3 py-2 bg-accent-red/10 border border-accent-red/30 text-accent-red rounded-lg text-sm">
              {error}
            </div>
          ) : null}

          {step === "form" ? (
            <>
              <div className="grid md:grid-cols-2 gap-3">
                <Field label="Phone (E.164)" hint="+441234567890">
                  <input
                    value={form.phone}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, phone: e.target.value }))
                    }
                    placeholder="+441234567890"
                    className="w-full bg-background border border-card-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent-green/50"
                  />
                </Field>
                <Field label="Label" hint="friendly name (optional)">
                  <input
                    value={form.label}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, label: e.target.value }))
                    }
                    placeholder="UK-1"
                    className="w-full bg-background border border-card-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent-green/50"
                  />
                </Field>
              </div>

              <div className="border-t border-card-border/60 pt-4">
                <div className="text-xs uppercase text-text-muted mb-2">
                  IPRoyal sticky-session proxy (recommended — unique per account)
                </div>
                <div className="grid md:grid-cols-4 gap-3">
                  <Field label="Type">
                    <select
                      value={form.proxyType}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          proxyType: e.target.value as typeof form.proxyType,
                        }))
                      }
                      className="w-full bg-background border border-card-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent-green/50"
                    >
                      <option value="socks5">socks5</option>
                      <option value="socks4">socks4</option>
                      <option value="http">http</option>
                    </select>
                  </Field>
                  <Field label="Host" className="md:col-span-2">
                    <input
                      value={form.proxyHost}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, proxyHost: e.target.value }))
                      }
                      placeholder="geo.iproyal.com"
                      className="w-full bg-background border border-card-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent-green/50"
                    />
                  </Field>
                  <Field label="Port">
                    <input
                      value={form.proxyPort}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, proxyPort: e.target.value }))
                      }
                      placeholder="12321"
                      className="w-full bg-background border border-card-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent-green/50"
                    />
                  </Field>
                  <Field label="Username" className="md:col-span-2">
                    <input
                      value={form.proxyUsername}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          proxyUsername: e.target.value,
                        }))
                      }
                      placeholder="user-country-gb-session-abc123"
                      className="w-full bg-background border border-card-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent-green/50"
                    />
                  </Field>
                  <Field label="Password" className="md:col-span-2">
                    <input
                      type="password"
                      value={form.proxyPassword}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          proxyPassword: e.target.value,
                        }))
                      }
                      placeholder="••••••••"
                      className="w-full bg-background border border-card-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent-green/50"
                    />
                  </Field>
                </div>
                <p className="text-xs text-text-muted mt-2">
                  Skip the proxy fields to sign in directly (not recommended —
                  all 10 accounts would share your server&apos;s IP).
                </p>
              </div>

              <details className="border-t border-card-border/60 pt-4">
                <summary className="cursor-pointer text-xs uppercase text-text-muted">
                  Advanced: per-account api_id / api_hash
                </summary>
                <div className="grid md:grid-cols-2 gap-3 mt-3">
                  <Field label="api_id">
                    <input
                      value={form.apiId}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, apiId: e.target.value }))
                      }
                      placeholder="(uses .env default)"
                      className="w-full bg-background border border-card-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent-green/50"
                    />
                  </Field>
                  <Field label="api_hash">
                    <input
                      value={form.apiHash}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, apiHash: e.target.value }))
                      }
                      placeholder="(uses .env default)"
                      className="w-full bg-background border border-card-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent-green/50"
                    />
                  </Field>
                </div>
              </details>
            </>
          ) : step === "code" ? (
            <div>
              <p className="text-sm text-text-muted mb-3">
                Telegram sent an SMS code to <strong>{form.phone}</strong>{" "}
                through your proxy. Check your virtual-number dashboard (or
                physical phone) and paste it here.
              </p>
              <Field label="SMS code">
                <input
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") submitCode();
                  }}
                  placeholder="12345"
                  className="w-full bg-background border border-card-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent-green/50"
                  autoFocus
                />
              </Field>
            </div>
          ) : (
            <div>
              <p className="text-sm text-text-muted mb-3">
                This account has 2FA cloud password enabled. Enter it to
                finish signing in.
              </p>
              <Field label="2FA password">
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") submitPassword();
                  }}
                  placeholder="••••••••"
                  className="w-full bg-background border border-card-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent-green/50"
                  autoFocus
                />
              </Field>
            </div>
          )}
        </div>

        <div className="flex justify-between items-center px-6 py-4 border-t border-card-border">
          <button
            onClick={close}
            disabled={busy}
            className="px-4 py-2 text-sm text-text-muted hover:text-white"
          >
            Cancel
          </button>
          <button
            onClick={
              step === "form"
                ? submitForm
                : step === "code"
                ? submitCode
                : submitPassword
            }
            disabled={busy}
            className="px-4 py-2 rounded-lg bg-accent-green/20 border border-accent-green/40 text-accent-green text-sm font-medium hover:bg-accent-green/30 disabled:opacity-50"
          >
            {busy
              ? "Working…"
              : step === "form"
              ? "Send SMS code"
              : step === "code"
              ? "Verify code"
              : "Finish signup"}
          </button>
        </div>
      </div>

    </div>
  );
}

function Field({
  label,
  hint,
  className = "",
  children,
}: {
  label: string;
  hint?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={className}>
      <label className="block text-xs uppercase text-text-muted mb-1">
        {label}
        {hint ? (
          <span className="ml-2 text-text-muted/70 normal-case">{hint}</span>
        ) : null}
      </label>
      {children}
    </div>
  );
}
