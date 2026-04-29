"use client";

import { useMemo } from "react";
import TemplatePicker from "@/components/TemplatePicker";
import type { DbMessageTemplate } from "@/types/database";

/**
 * Default professional style instructions seeded into a new arm so the AI
 * textarea is never empty (zero-input pitfall). The user can still rewrite
 * them — these are just a sane starting point that produces decent first-
 * touch openers without any tuning.
 */
export const DEFAULT_PRIMARY_AI_STYLE = [
  "Write a brief, warm, professional outreach DM in the sender's voice.",
  "Reference that we share a Telegram group as the reason for reaching out.",
  "Ask one short, low-stakes question to start a conversation.",
  "One or two sentences max. No emojis, no links, no salesy language.",
  "Address the recipient by their first name when known.",
].join(" ");

export const DEFAULT_FOLLOWUP_AI_STYLE = [
  "Write a brief, friendly follow-up DM nudging a previous unanswered message.",
  "Don't sound pushy or apologetic — keep it casual.",
  "One sentence. No emojis, no links, no recap of what you said before.",
  "Address the recipient by their first name when known.",
].join(" ");

/** UI-only arm shape: same as CampaignArmInput but with picker state. */
export interface ArmDraft {
  /** Stable id for React key reuse (NOT sent to backend). */
  id: string;
  /** A/B label (e.g. "A", "B", "control"). */
  name: string;
  /**
   * "templates": rotate through static `primary_*` variants per send.
   * "ai":        generate a personalised opener per target via OpenAI
   *              (uses `aiStyle` instructions). The two modes are
   *              independent for primary and follow-up — you can have a
   *              templated primary with an AI follow-up, or vice versa.
   */
  mode: "templates" | "ai";
  aiStyle: string;
  primarySelectedIds: string[];
  primaryInline: string;
  /** Empty string = no follow-up for this arm. */
  followUpDays: string;
  followupMode: "templates" | "ai";
  followupAiStyle: string;
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
 * Build a fresh arm with sensible defaults — including pre-filled AI
 * style prompts so toggling to AI mode doesn't show a blank textarea.
 */
export function makeArm(name: string, primaryInline = ""): ArmDraft {
  return {
    id: cryptoRandomId(),
    name,
    mode: "templates",
    aiStyle: DEFAULT_PRIMARY_AI_STYLE,
    primarySelectedIds: [],
    primaryInline,
    followUpDays: "",
    followupMode: "templates",
    followupAiStyle: DEFAULT_FOLLOWUP_AI_STYLE,
    followupSelectedIds: [],
    followupInline: "",
  };
}

/**
 * Multi-arm A/B test editor. Each arm has its own primary + (optional)
 * follow-up message strategy. Targets are split round-robin across arms
 * by the backend, so 100 contacts with 2 arms = 50 to each arm.
 *
 * UX rules:
 *  - Always at least one arm. Removing the last arm is blocked.
 *  - Adding a 2nd arm flips the layout to A/B mode (color-coded cards).
 *  - Each message slot (primary / follow-up) has independent Templates/AI
 *    toggles so you can mix and match.
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
    onChange([...arms, makeArm(nextLetter)]);
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
              : "Message strategy"}
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

  const tone = TONES[index % TONES.length];

  return (
    <div
      className="border rounded-xl p-4 space-y-4"
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

      <MessagePicker
        label="Primary message"
        mode={arm.mode}
        onModeChange={(m) => onChange({ mode: m })}
        aiStyle={arm.aiStyle}
        onAiStyleChange={(s) => onChange({ aiStyle: s })}
        aiPlaceholder={DEFAULT_PRIMARY_AI_STYLE}
        templatePlaceholder={
          "Hey {first_name}, saw you in the group...\n---\nHi {first_name}! ..."
        }
        templateRows={6}
        selectedLibraryIds={arm.primarySelectedIds}
        onSelectedLibraryIdsChange={(ids) =>
          onChange({ primarySelectedIds: ids })
        }
        inlineText={arm.primaryInline}
        onInlineTextChange={(s) => onChange({ primaryInline: s })}
        libraryTemplates={libraryTemplates}
        supabaseAvailable={supabaseAvailable}
        aiAvailable={aiAvailable}
        aiModel={aiModel}
        onSaveInlineToLibrary={onSaveInlineToLibrary}
      />

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
        <MessagePicker
          label="Follow-up message"
          mode={arm.followupMode}
          onModeChange={(m) => onChange({ followupMode: m })}
          aiStyle={arm.followupAiStyle}
          onAiStyleChange={(s) => onChange({ followupAiStyle: s })}
          aiPlaceholder={DEFAULT_FOLLOWUP_AI_STYLE}
          templatePlaceholder={"Hey {first_name}, just bumping this..."}
          templateRows={4}
          selectedLibraryIds={arm.followupSelectedIds}
          onSelectedLibraryIdsChange={(ids) =>
            onChange({ followupSelectedIds: ids })
          }
          inlineText={arm.followupInline}
          onInlineTextChange={(s) => onChange({ followupInline: s })}
          libraryTemplates={libraryTemplates}
          supabaseAvailable={supabaseAvailable}
          aiAvailable={aiAvailable}
          aiModel={aiModel}
          onSaveInlineToLibrary={onSaveInlineToLibrary}
        />
      ) : null}
    </div>
  );
}

interface MessagePickerProps {
  label: string;
  mode: "templates" | "ai";
  onModeChange: (m: "templates" | "ai") => void;
  aiStyle: string;
  onAiStyleChange: (s: string) => void;
  aiPlaceholder: string;
  templatePlaceholder: string;
  templateRows: number;
  selectedLibraryIds: string[];
  onSelectedLibraryIdsChange: (ids: string[]) => void;
  inlineText: string;
  onInlineTextChange: (s: string) => void;
  libraryTemplates: DbMessageTemplate[];
  supabaseAvailable: boolean;
  aiAvailable: boolean;
  aiModel: string;
  onSaveInlineToLibrary?: (variants: string[]) => Promise<void>;
}

/**
 * One message slot (primary or follow-up) with a Templates / AI toggle.
 * Extracted so primary and follow-up share the same UX and validation
 * exactly — when we add another option (e.g. file-imported variants) it
 * lands in both places at once.
 */
function MessagePicker(props: MessagePickerProps) {
  return (
    <div>
      <div className="flex items-center justify-between mb-2 gap-3 flex-wrap">
        <label className="text-xs uppercase text-text-muted">
          {props.label}
        </label>
        <div className="inline-flex border border-card-border rounded-lg overflow-hidden text-xs">
          <button
            type="button"
            onClick={() => props.onModeChange("templates")}
            className={`px-3 py-1 transition-colors ${
              props.mode === "templates"
                ? "bg-card-border/40 text-foreground"
                : "text-text-muted hover:text-foreground"
            }`}
          >
            Templates
          </button>
          <button
            type="button"
            onClick={() => {
              if (!props.aiAvailable) return;
              props.onModeChange("ai");
            }}
            disabled={!props.aiAvailable}
            title={
              props.aiAvailable
                ? "Generate a personalized opener per target"
                : "Set OPENAI_API_KEY in backend/.env to enable AI mode"
            }
            className={`px-3 py-1 transition-colors border-l border-card-border ${
              props.mode === "ai"
                ? "bg-card-border/40 text-foreground"
                : "text-text-muted hover:text-foreground"
            } disabled:opacity-40 disabled:cursor-not-allowed`}
          >
            AI ({props.aiModel})
          </button>
        </div>
      </div>

      {props.mode === "templates" ? (
        <TemplatePicker
          libraryTemplates={props.libraryTemplates}
          supabaseAvailable={props.supabaseAvailable}
          selectedLibraryIds={props.selectedLibraryIds}
          onSelectedLibraryIdsChange={props.onSelectedLibraryIdsChange}
          inlineText={props.inlineText}
          onInlineTextChange={props.onInlineTextChange}
          onSaveInlineToLibrary={props.onSaveInlineToLibrary}
          rows={props.templateRows}
          placeholder={props.templatePlaceholder}
        />
      ) : (
        <div className="space-y-2">
          <textarea
            value={props.aiStyle}
            onChange={(e) => props.onAiStyleChange(e.target.value)}
            rows={5}
            placeholder={props.aiPlaceholder}
            className="w-full bg-background border border-card-border rounded-lg px-3 py-2 text-sm"
          />
          <p className="text-xs text-text-muted">
            Each target gets a unique line generated at launch using their
            first name + the source group as context. Cost ~$0.0001 per
            opener with <code>{props.aiModel}</code> — small + paid up front.
          </p>
        </div>
      )}
    </div>
  );
}

const TONES = [
  {
    borderHex: "rgba(74, 222, 128, 0.35)",
    bgHex: "rgba(74, 222, 128, 0.04)",
    chipHex: "rgba(74, 222, 128, 0.15)",
    chipTextHex: "rgb(74, 222, 128)",
  },
  {
    borderHex: "rgba(96, 165, 250, 0.35)",
    bgHex: "rgba(96, 165, 250, 0.04)",
    chipHex: "rgba(96, 165, 250, 0.15)",
    chipTextHex: "rgb(96, 165, 250)",
  },
  {
    borderHex: "rgba(250, 204, 21, 0.35)",
    bgHex: "rgba(250, 204, 21, 0.04)",
    chipHex: "rgba(250, 204, 21, 0.15)",
    chipTextHex: "rgb(250, 204, 21)",
  },
  {
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
