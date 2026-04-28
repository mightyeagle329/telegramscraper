"use client";

import Link from "next/link";
import { useState } from "react";
import type { DbMessageTemplate } from "@/types/database";

interface Props {
  /** Saved templates from the user's /templates library. Empty array hides the library block. */
  libraryTemplates: DbMessageTemplate[];
  /** Whether Supabase is configured at all (controls "save to library" button visibility). */
  supabaseAvailable: boolean;

  selectedLibraryIds: string[];
  onSelectedLibraryIdsChange: (ids: string[]) => void;

  inlineText: string;
  onInlineTextChange: (s: string) => void;

  /** Called with the parsed inline variants when the user clicks "Save inline to library". */
  onSaveInlineToLibrary?: (variants: string[]) => Promise<void>;

  /** Placeholder for the inline textarea. */
  placeholder?: string;
  /** Number of rows for the inline textarea. */
  rows?: number;
  /** Recommended minimum total variants (shown as warning if below). */
  recommendMin?: number;
}

/**
 * Picker for message templates used by the Campaigns form. Combines two
 * sources of variants:
 *
 *   1. Library — pre-saved templates from /templates (multi-select).
 *   2. Inline — variants pasted in the textarea (one per `---`-separated block).
 *
 * The campaign uses BOTH sources combined. A user can pick 2 from the
 * library and add 1 inline, and the campaign sees 3 variants total.
 *
 * Optional "Save inline to library" promotes inline variants into the
 * library so they're reusable across campaigns.
 */
export default function TemplatePicker({
  libraryTemplates,
  supabaseAvailable,
  selectedLibraryIds,
  onSelectedLibraryIdsChange,
  inlineText,
  onInlineTextChange,
  onSaveInlineToLibrary,
  placeholder,
  rows = 6,
  recommendMin = 3,
}: Props) {
  const [savingInline, setSavingInline] = useState(false);
  const [savedToast, setSavedToast] = useState<string | null>(null);

  const inlineVariants = inlineText
    .split(/\n---\n/)
    .map((s) => s.trim())
    .filter(Boolean);

  const total = selectedLibraryIds.length + inlineVariants.length;
  const showLibrary = supabaseAvailable;

  function toggle(id: string) {
    if (selectedLibraryIds.includes(id)) {
      onSelectedLibraryIdsChange(selectedLibraryIds.filter((x) => x !== id));
    } else {
      onSelectedLibraryIdsChange([...selectedLibraryIds, id]);
    }
  }

  function selectAll() {
    onSelectedLibraryIdsChange(libraryTemplates.map((t) => t.id));
  }

  function clearAll() {
    onSelectedLibraryIdsChange([]);
  }

  async function saveInline() {
    if (!onSaveInlineToLibrary || inlineVariants.length === 0) return;
    setSavingInline(true);
    try {
      await onSaveInlineToLibrary(inlineVariants);
      setSavedToast(
        `Saved ${inlineVariants.length} variant${
          inlineVariants.length === 1 ? "" : "s"
        } to library`
      );
      setTimeout(() => setSavedToast(null), 2500);
    } finally {
      setSavingInline(false);
    }
  }

  return (
    <div className="space-y-3">
      {/* Library section — only when Supabase is on */}
      {showLibrary ? (
        libraryTemplates.length > 0 ? (
          <div className="bg-background border border-card-border rounded-lg">
            <div className="px-3 py-2 border-b border-card-border/60 flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-wide text-text-muted">
                From your library ({libraryTemplates.length})
              </span>
              <span className="text-xs text-text-muted">
                {selectedLibraryIds.length === 0 ? (
                  <button
                    type="button"
                    onClick={selectAll}
                    className="hover:text-foreground"
                  >
                    select all
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={clearAll}
                    className="hover:text-foreground"
                  >
                    clear ({selectedLibraryIds.length})
                  </button>
                )}{" "}
                ·{" "}
                <Link
                  href="/templates"
                  className="hover:text-foreground hover:underline"
                >
                  manage
                </Link>
              </span>
            </div>
            <ul className="max-h-48 overflow-y-auto p-2 space-y-1">
              {libraryTemplates.map((t) => {
                const checked = selectedLibraryIds.includes(t.id);
                return (
                  <li key={t.id}>
                    <label
                      className={`flex items-start gap-2 text-sm px-2 py-1.5 rounded cursor-pointer transition-colors ${
                        checked
                          ? "bg-accent-green/10"
                          : "hover:bg-card-border/30"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggle(t.id)}
                        className="mt-0.5"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="font-medium">{t.name}</span>
                        <span className="block text-xs text-text-muted line-clamp-1 mt-0.5">
                          {t.body}
                        </span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : (
          <div className="bg-background border border-dashed border-card-border rounded-lg px-3 py-3 text-xs text-text-muted">
            Your template library is empty.{" "}
            <Link
              href="/templates"
              className="hover:text-foreground hover:underline"
            >
              Create templates in /templates
            </Link>{" "}
            to reuse them across campaigns — or just write inline below.
          </div>
        )
      ) : null}

      {/* Inline textarea — always shown */}
      <div>
        <div className="text-[10px] uppercase tracking-wide text-text-muted mb-1">
          {showLibrary ? "Or write more variants here" : "Variants"} —
          separate with a line containing{" "}
          <code className="text-[10px]">---</code>
        </div>
        <textarea
          value={inlineText}
          onChange={(e) => onInlineTextChange(e.target.value)}
          rows={rows}
          placeholder={placeholder}
          className="w-full bg-background border border-card-border rounded-lg px-3 py-2 text-sm font-mono"
        />
        <div className="flex items-center justify-between text-xs text-text-muted mt-1">
          <span>
            {inlineVariants.length} inline variant
            {inlineVariants.length === 1 ? "" : "s"}
          </span>
          {showLibrary &&
          onSaveInlineToLibrary &&
          inlineVariants.length > 0 ? (
            <button
              type="button"
              onClick={saveInline}
              disabled={savingInline}
              className="text-accent-green hover:underline disabled:opacity-50"
            >
              {savingInline ? "Saving…" : "+ Save inline to library"}
            </button>
          ) : null}
        </div>
        {savedToast ? (
          <div className="text-xs text-accent-green mt-1">{savedToast}</div>
        ) : null}
      </div>

      {/* Total + recommendation */}
      <div className="text-xs">
        <span className="text-text-muted">Total used in this campaign:</span>{" "}
        <strong
          className={
            total >= recommendMin ? "text-accent-green" : "text-accent-yellow"
          }
        >
          {total} variant{total === 1 ? "" : "s"}
        </strong>
        {total < recommendMin ? (
          <span className="text-text-muted">
            {" "}
            ({recommendMin}+ recommended for safer rotation)
          </span>
        ) : null}
      </div>
    </div>
  );
}
