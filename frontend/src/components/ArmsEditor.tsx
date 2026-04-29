"use client";

import { useMemo } from "react";
import TemplatePicker from "@/components/TemplatePicker";
import type { DbMessageTemplate } from "@/types/database";

/** UI-only arm shape: same as CampaignArmInput but with picker state. */
export interface ArmDraft {
  /** Stable id for React key reuse (NOT sent to backend). */
  id: string;
  /** A/B label (e.g. "A", "B", "control"). */
  name: string;
  /**
   * "templates": rotate through static `primary_*` variants per send.
   * "ai":        generate a personalised opener per target via OpenAI
   *              (uses `aiStyle` instructions). Follow-ups are still
   *              templated — AI mode only changes the first-touch DM.
   */
  mode: "templates" | "ai";
  /** Free-form style instructions for AI mode (one-liner is fine). */
  aiStyle: string;
  primarySelectedIds: string[];
  primaryInline: string;
  /** Empty string = no follow-up for this arm. */
  followUpDays: string;
  followupSelectedIds: string[];
  followupInline: string;
}

interface Props {
  arms: ArmDraft[];
  onChange: (arms: ArmDraft[]) => void;
  libraryTemplates: DbMessageTemplate[];
  supabaseAvailable: boolean;
  /** Whether the backend has an OpenAI key. Greys out the AI toggle when false. */
  aiAvailable: boolean;
  /** Model name to show in the AI panel (e.g. "gpt-4o-mini"). */
  aiModel: string;
  onSaveInlineToLibrary?: (variants: string[]) => Promise<void>;
}

/**
 * Multi-arm A/B test editor. Each arm is its own template strategy with
 * primary + (optional) follow-up. Targets are split round-robin across
 * arms by the backend, so 100 contacts with 2 arms = 50 to each arm.
 *
 * UX rules:
 *  - Always at least one arm. Removing the last arm is blocked.
 *  - Arms auto-name to letters (A, B, C...) when added but the user can
 *    rename inline (we don't enforce uniqueness here — the backend does).
 *  - Adding a 2nd arm makes the layout switch from "single template editor"
 *    to "stacked arm cards" so users see they're now A/B testing.
 */
export default function ArmsEditor({
  arms,
  onChange,
  libraryTemplates,
  supabaseAvailable,
  aiAvailable,
  aiModel,
  onSaveInlineToLibrary,
}: Props) {
  const isAB = arms.length > 1;

  function updateArm(id: string, patch: Partial<ArmDraft>) {
    onChange(arms.map((a) => (a.id === id ? { ...a, ...patch } : a)));
  }

  function addArm() {
    const nextLetter = nextArmLetter(arms.map((a) => a.name));
    const newArm: ArmDraft = {
      id: cryptoRandomId(),
      name: nextLetter,
      mode: "templates",
      aiStyle: "",
      primarySelectedIds: [],
      primaryInline: "",
      followUpDays: "",
      followupSelectedIds: [],
      followupInline: "",
    };
    onChange([...arms, newArm]);
  }

  function removeArm(id: string) {
    if (arms.length <= 1) return;
    onChange(arms.filter((a) => a.id !== id));
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs uppercase text-text-muted">
            {isAB
              ? `A/B test — ${arms.length} arms running in parallel`
              : "Message templates"}
          </div>
          {isAB ? (
            <p className="text-xs text-text-muted/80 mt-0.5">
              Targets are split evenly across arms. After ~50+ sends per arm,
              the stats panel below will show which copy wins.
            </p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={addArm}
          className="text-xs text-accent-green hover:underline"
        >
          + Add another arm
        </button>
      </div>

      <div className="space-y-4">
        {arms.map((arm, idx) => (
          <ArmCard
            key={arm.id}
            arm={arm}
            index={idx}
            isAB={isAB}
            onChange={(patch) => updateArm(arm.id, patch)}
            onRemove={() => removeArm(arm.id)}
            removable={arms.length > 1}
            libraryTemplates={libraryTemplates}
            supabaseAvailable={supabaseAvailable}
            aiAvailable={aiAvailable}
            aiModel={aiModel}
            onSaveInlineToLibrary={onSaveInlineToLibrary}
          />
        ))}
      </div>
    </div>
  );
}

interface ArmCardProps {
  arm: ArmDraft;
  index: number;
  isAB: boolean;
  removable: boolean;
  onChange: (patch: Partial<ArmDraft>) => void;
  onRemove: () => void;
  libraryTemplates: DbMessageTemplate[];
  supabaseAvailable: boolean;
  aiAvailable: boolean;
  aiModel: string;
  onSaveInlineToLibrary?: (variants: string[]) => Promise<void>;
}

function ArmCard({
  arm,
  index,
  isAB,
  removable,
  onChange,
  onRemove,
  libraryTemplates,
  supabaseAvailable,
  aiAvailable,
  aiModel,
  onSaveInlineToLibrary,
}: ArmCardProps) {
  const showFollowup = useMemo(
    () => arm.followUpDays !== "" && Number(arm.followUpDays) > 0,
    [arm.followUpDays]
  );

  // Visual color cycle so two arms are easy to tell apart at a glance.
  const tone = TONES[index % TONES.length];

  return (
    <div
      className={`border rounded-xl p-4 space-y-3 ${
        isAB ? `border-${tone.border} bg-${tone.bg}` : "border-card-border"
      }`}
      style={
        isAB
          ? { borderColor: tone.borderHex, background: tone.bgHex }
          : undefined
      }
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          {isAB ? (
            <span
              className="text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded"
              style={{ background: tone.chipHex, color: tone.chipTextHex }}
            >
              Arm
            </span>
          ) : null}
          <input
            value={arm.name}
            onChange={(e) => onChange({ name: e.target.value })}
            placeholder="Arm name (A, B, control…)"
            className="bg-background border border-card-border rounded px-2 py-1 text-sm font-semibold w-40"
          />
        </div>
        {removable ? (
          <button
            type="button"
            onClick={onRemove}
            className="text-xs text-text-muted hover:text-accent-red"
          >
            remove arm
          </button>
        ) : null}
      </div>

      <div>
        <div className="flex items-center justify-between mb-2 gap-3 flex-wrap">
          <label className="text-xs uppercase text-text-muted">
            Primary message
          </label>
          <div className="inline-flex border border-card-border rounded-lg overflow-hidden text-xs">
            <button
              type="button"
              onClick={() => onChange({ mode: "templates" })}
              className={`px-3 py-1 transition-colors ${
                arm.mode === "templates"
                  ? "bg-card-border/40 text-foreground"
                  : "text-text-muted hover:text-foreground"
              }`}
            >
              Templates
            </button>
            <button
              type="button"
              onClick={() => {
                if (!aiAvailable) return;
                onChange({ mode: "ai" });
              }}
              disabled={!aiAvailable}
              title={
                aiAvailable
                  ? "Generate a personalized opener per target"
                  : "Set OPENAI_API_KEY in backend/.env to enable AI mode"
              }
              className={`px-3 py-1 transition-colors border-l border-card-border ${
                arm.mode === "ai"
                  ? "bg-card-border/40 text-foreground"
                  : "text-text-muted hover:text-foreground"
              } disabled:opacity-40 disabled:cursor-not-allowed`}
            >
              AI ({aiModel})
            </button>
          </div>
        </div>

        {arm.mode === "templates" ? (
          <TemplatePicker
            libraryTemplates={libraryTemplates}
            supabaseAvailable={supabaseAvailable}
            selectedLibraryIds={arm.primarySelectedIds}
            onSelectedLibraryIdsChange={(ids) =>
              onChange({ primarySelectedIds: ids })
            }
            inlineText={arm.primaryInline}
            onInlineTextChange={(s) => onChange({ primaryInline: s })}
            onSaveInlineToLibrary={onSaveInlineToLibrary}
            rows={6}
            placeholder={
              "Hey {first_name}, saw you in the group...\n---\nHi {first_name}! ..."
            }
          />
        ) : (
          <div className="space-y-2">
            <textarea
              value={arm.aiStyle}
              onChange={(e) => onChange({ aiStyle: e.target.value })}
              rows={6}
              placeholder={[
                "Style instructions for GPT — written like you're briefing a copywriter.",
                "",
                "Example:",
                "Friendly and casual. Mention I'm building Telegram outreach automation",
                "and ask if they'd be open to a 10-min chat. One sentence max, no emojis.",
              ].join("\n")}
              className="w-full bg-background border border-card-border rounded-lg px-3 py-2 text-sm font-mono"
            />
            <p className="text-xs text-text-muted">
              Each target gets a unique opener generated at launch time
              using their first name + the source group as context. Cost
              is paid up front (~$0.0001 per opener with{" "}
              <code>{aiModel}</code>) — small but predictable.
            </p>
          </div>
        )}
      </div>

      <div className="flex items-end gap-3">
        <div className="w-40">
          <label className="block text-xs uppercase text-text-muted mb-1">
            Follow-up after (days)
          </label>
          <input
            value={arm.followUpDays}
            onChange={(e) => onChange({ followUpDays: e.target.value })}
            inputMode="numeric"
            placeholder="off"
            className="w-full bg-background border border-card-border rounded-lg px-3 py-2 text-sm"
          />
        </div>
        <p className="text-xs text-text-muted flex-1 pb-2">
          Blank = no follow-up. Auto-cancelled when the recipient replies.
        </p>
      </div>

      {showFollowup ? (
        <div>
          <label className="block text-xs uppercase text-text-muted mb-2">
            Follow-up templates
          </label>
          <TemplatePicker
            libraryTemplates={libraryTemplates}
            supabaseAvailable={supabaseAvailable}
            selectedLibraryIds={arm.followupSelectedIds}
            onSelectedLibraryIdsChange={(ids) =>
              onChange({ followupSelectedIds: ids })
            }
            inlineText={arm.followupInline}
            onInlineTextChange={(s) => onChange({ followupInline: s })}
            onSaveInlineToLibrary={onSaveInlineToLibrary}
            rows={4}
            placeholder={"Hey {first_name}, just bumping this..."}
          />
        </div>
      ) : null}
    </div>
  );
}

// Hard-coded hex tokens because Tailwind 4 won't generate dynamic class names.
const TONES = [
  {
    border: "accent-green/40",
    bg: "accent-green/5",
    borderHex: "rgba(74, 222, 128, 0.35)",
    bgHex: "rgba(74, 222, 128, 0.04)",
    chipHex: "rgba(74, 222, 128, 0.15)",
    chipTextHex: "rgb(74, 222, 128)",
  },
  {
    border: "accent-blue/40",
    bg: "accent-blue/5",
    borderHex: "rgba(96, 165, 250, 0.35)",
    bgHex: "rgba(96, 165, 250, 0.04)",
    chipHex: "rgba(96, 165, 250, 0.15)",
    chipTextHex: "rgb(96, 165, 250)",
  },
  {
    border: "accent-yellow/40",
    bg: "accent-yellow/5",
    borderHex: "rgba(250, 204, 21, 0.35)",
    bgHex: "rgba(250, 204, 21, 0.04)",
    chipHex: "rgba(250, 204, 21, 0.15)",
    chipTextHex: "rgb(250, 204, 21)",
  },
  {
    border: "accent-red/40",
    bg: "accent-red/5",
    borderHex: "rgba(248, 113, 113, 0.35)",
    bgHex: "rgba(248, 113, 113, 0.04)",
    chipHex: "rgba(248, 113, 113, 0.15)",
    chipTextHex: "rgb(248, 113, 113)",
  },
];

function nextArmLetter(used: string[]): string {
  const taken = new Set(used.map((s) => s.trim().toUpperCase()));
  for (let i = 0; i < 26; i++) {
    const letter = String.fromCharCode(65 + i);
    if (!taken.has(letter)) return letter;
  }
  return `arm-${used.length + 1}`;
}

function cryptoRandomId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2);
}
