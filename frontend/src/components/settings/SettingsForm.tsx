"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  updateAccountSecurity,
  updateProfile,
  updateSettings,
} from "@/lib/actions/settings";
import type { DbProfile, DbUserSettings } from "@/types/database";

interface Props {
  profile: DbProfile | null;
  settings: DbUserSettings | null;
}

export default function SettingsForm({ profile, settings }: Props) {
  return (
    <div className="space-y-8">
      <ProfileSection profile={profile} />
      <SendingSection settings={settings} />
      <SecuritySection />
    </div>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="bg-card-bg border border-card-border rounded-xl p-6">
      <div className="mb-5">
        <h2 className="font-semibold text-lg">{title}</h2>
        <p className="text-text-muted text-sm mt-1">{description}</p>
      </div>
      {children}
    </section>
  );
}

function Field({
  label,
  hint,
  children,
  className = "",
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={`block ${className}`}>
      <span className="block text-xs uppercase text-text-muted mb-1">
        {label}
        {hint ? (
          <span className="normal-case text-text-muted/70 ml-2">— {hint}</span>
        ) : null}
      </span>
      {children}
    </label>
  );
}

const INPUT_CLASS =
  "w-full bg-background border border-card-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent-green/50";

function Toast({
  state,
}: {
  state: { kind: "ok" | "err"; text: string } | null;
}) {
  if (!state) return null;
  return (
    <div
      className={`mt-3 px-3 py-2 rounded-lg text-sm border ${
        state.kind === "ok"
          ? "bg-accent-green/10 border-accent-green/30 text-accent-green"
          : "bg-accent-red/10 border-accent-red/30 text-accent-red"
      }`}
    >
      {state.text}
    </div>
  );
}

function SubmitButton({
  pending,
  children,
}: {
  pending: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="submit"
      disabled={pending}
      className="px-4 py-2 rounded-lg bg-accent-green/20 border border-accent-green/40 text-accent-green text-sm font-medium hover:bg-accent-green/30 disabled:opacity-50"
    >
      {pending ? "Saving…" : children}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────

function ProfileSection({ profile }: { profile: DbProfile | null }) {
  const router = useRouter();
  const [fullName, setFullName] = useState(profile?.full_name ?? "");
  const [timezone, setTimezone] = useState(profile?.timezone ?? "UTC");
  const [msg, setMsg] = useState<
    { kind: "ok" | "err"; text: string } | null
  >(null);
  const [pending, startTransition] = useTransition();

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    startTransition(async () => {
      const res = await updateProfile({ full_name: fullName, timezone });
      if (!res.ok) setMsg({ kind: "err", text: res.error });
      else {
        setMsg({ kind: "ok", text: "Profile saved." });
        router.refresh();
      }
    });
  }

  return (
    <Section title="Profile" description="Your name and timezone.">
      <form onSubmit={onSubmit} className="grid md:grid-cols-2 gap-4">
        <Field label="Full name">
          <input
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            className={INPUT_CLASS}
            placeholder="Jane Doe"
          />
        </Field>
        <Field
          label="Timezone"
          hint="used for operating-hours windows"
        >
          <input
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            className={INPUT_CLASS}
            placeholder="Europe/Lisbon"
          />
        </Field>
        <div className="md:col-span-2 flex justify-end">
          <SubmitButton pending={pending}>Save profile</SubmitButton>
        </div>
        <div className="md:col-span-2">
          <Toast state={msg} />
        </div>
      </form>
    </Section>
  );
}

// ─────────────────────────────────────────────────────────────────────

function SendingSection({ settings }: { settings: DbUserSettings | null }) {
  const router = useRouter();
  const [draft, setDraft] = useState({
    default_delay_min_s: settings?.default_delay_min_s ?? 45,
    default_delay_max_s: settings?.default_delay_max_s ?? 180,
    warmup_days: settings?.warmup_days ?? 7,
    steady_daily_limit: settings?.steady_daily_limit ?? 50,
    default_delete_after_s: settings?.default_delete_after_s ?? null,
    min_template_variants: settings?.min_template_variants ?? 3,
    peer_flood_pause_hours: settings?.peer_flood_pause_hours ?? 48,
    operating_start_hour: settings?.operating_start_hour ?? null,
    operating_end_hour: settings?.operating_end_hour ?? null,
  });
  const [msg, setMsg] = useState<
    { kind: "ok" | "err"; text: string } | null
  >(null);
  const [pending, startTransition] = useTransition();

  function update<K extends keyof typeof draft>(
    key: K,
    value: (typeof draft)[K]
  ) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  function numOrNull(v: string): number | null {
    if (v.trim() === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    startTransition(async () => {
      const res = await updateSettings(draft);
      if (!res.ok) setMsg({ kind: "err", text: res.error });
      else {
        setMsg({ kind: "ok", text: "Sending defaults saved." });
        router.refresh();
      }
    });
  }

  return (
    <Section
      title="Sending defaults"
      description="Defaults applied to every campaign. Individual campaigns can override."
    >
      <form onSubmit={onSubmit} className="grid md:grid-cols-2 gap-4">
        <Field
          label="Delay min (s)"
          hint="random jitter floor"
        >
          <input
            type="number"
            min={10}
            value={draft.default_delay_min_s}
            onChange={(e) =>
              update("default_delay_min_s", Number(e.target.value))
            }
            className={INPUT_CLASS}
          />
        </Field>
        <Field label="Delay max (s)" hint="random jitter ceiling">
          <input
            type="number"
            min={11}
            value={draft.default_delay_max_s}
            onChange={(e) =>
              update("default_delay_max_s", Number(e.target.value))
            }
            className={INPUT_CLASS}
          />
        </Field>

        <Field label="Warm-up days" hint="0 → no warm-up">
          <input
            type="number"
            min={0}
            max={30}
            value={draft.warmup_days}
            onChange={(e) => update("warmup_days", Number(e.target.value))}
            className={INPUT_CLASS}
          />
        </Field>
        <Field label="Steady daily DM cap" hint="per account">
          <input
            type="number"
            min={1}
            max={200}
            value={draft.steady_daily_limit}
            onChange={(e) =>
              update("steady_daily_limit", Number(e.target.value))
            }
            className={INPUT_CLASS}
          />
        </Field>

        <Field
          label="Send-delete after (s)"
          hint="blank = off; deletes our copy after N s"
        >
          <input
            type="number"
            min={0}
            value={draft.default_delete_after_s ?? ""}
            onChange={(e) =>
              update("default_delete_after_s", numOrNull(e.target.value))
            }
            className={INPUT_CLASS}
            placeholder="off"
          />
        </Field>
        <Field
          label="Min template variants"
          hint="safety check before launch"
        >
          <input
            type="number"
            min={1}
            value={draft.min_template_variants}
            onChange={(e) =>
              update("min_template_variants", Number(e.target.value))
            }
            className={INPUT_CLASS}
          />
        </Field>

        <Field
          label="PEER_FLOOD pause (h)"
          hint="cool-down when account trips PeerFlood"
        >
          <input
            type="number"
            min={1}
            max={168}
            value={draft.peer_flood_pause_hours}
            onChange={(e) =>
              update("peer_flood_pause_hours", Number(e.target.value))
            }
            className={INPUT_CLASS}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Op hours start" hint="0–23 or blank = always">
            <input
              type="number"
              min={0}
              max={23}
              value={draft.operating_start_hour ?? ""}
              onChange={(e) =>
                update("operating_start_hour", numOrNull(e.target.value))
              }
              className={INPUT_CLASS}
              placeholder="any"
            />
          </Field>
          <Field label="Op hours end" hint="0–23 or blank">
            <input
              type="number"
              min={0}
              max={23}
              value={draft.operating_end_hour ?? ""}
              onChange={(e) =>
                update("operating_end_hour", numOrNull(e.target.value))
              }
              className={INPUT_CLASS}
              placeholder="any"
            />
          </Field>
        </div>

        <div className="md:col-span-2 flex justify-end">
          <SubmitButton pending={pending}>Save sending defaults</SubmitButton>
        </div>
        <div className="md:col-span-2">
          <Toast state={msg} />
        </div>
      </form>
    </Section>
  );
}

// ─────────────────────────────────────────────────────────────────────

function SecuritySection() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState<
    { kind: "ok" | "err"; text: string } | null
  >(null);
  const [pending, startTransition] = useTransition();

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (!email && !password) {
      setMsg({ kind: "err", text: "Nothing to change." });
      return;
    }
    startTransition(async () => {
      const res = await updateAccountSecurity({
        email: email || undefined,
        password: password || undefined,
      });
      if (!res.ok) setMsg({ kind: "err", text: res.error });
      else {
        if (email) {
          setMsg({
            kind: "ok",
            text: "Email change request sent — check both your old and new inbox for confirmation links.",
          });
        } else {
          setMsg({ kind: "ok", text: "Password updated." });
        }
        setEmail("");
        setPassword("");
      }
    });
  }

  return (
    <Section
      title="Account security"
      description="Change your email or password. Email changes require confirmation."
    >
      <form onSubmit={onSubmit} className="grid md:grid-cols-2 gap-4">
        <Field label="New email" hint="leave blank to skip">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={INPUT_CLASS}
            autoComplete="email"
          />
        </Field>
        <Field label="New password" hint="at least 8 characters">
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={INPUT_CLASS}
            autoComplete="new-password"
          />
        </Field>
        <div className="md:col-span-2 flex justify-end">
          <SubmitButton pending={pending}>Update security</SubmitButton>
        </div>
        <div className="md:col-span-2">
          <Toast state={msg} />
        </div>
      </form>
    </Section>
  );
}
