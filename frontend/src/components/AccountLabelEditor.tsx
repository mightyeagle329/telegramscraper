"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";

interface Props {
  accountId: string;
  value: string;
  /** Called after a successful save so the parent can refresh its list. */
  onSaved: () => void;
}

/**
 * Inline-editable account label.
 *
 *   - Click the label → turns into an input.
 *   - Enter or blur → saves via `PATCH /api/accounts/{id}`.
 *   - Escape → cancels (reverts to original value).
 *   - Small pencil icon hints it's editable.
 *
 * Empty submissions are server-rejected; the server falls the label back
 * to the account id so we never end up with a blank row.
 */
export default function AccountLabelEditor({
  accountId,
  value,
  onSaved,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    // If the parent refreshes with a new value while we're NOT editing,
    // sync our draft to it. If we ARE editing, leave the draft alone.
    if (!editing) setDraft(value);
  }, [value, editing]);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  async function save() {
    const trimmed = draft.trim();
    if (trimmed === value.trim()) {
      setEditing(false);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await api.updateAccount(accountId, { label: trimmed });
      setEditing(false);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  function cancel() {
    setDraft(value);
    setEditing(false);
    setError(null);
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        title="Click to rename"
        className="group inline-flex items-center gap-1.5 text-left font-medium hover:text-accent-green transition-colors"
      >
        <span className="truncate max-w-[180px]">{value}</span>
        <PencilIcon />
      </button>
    );
  }

  return (
    <div className="inline-flex flex-col gap-1">
      <div className="inline-flex items-center gap-1">
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              save();
            } else if (e.key === "Escape") {
              e.preventDefault();
              cancel();
            }
          }}
          onBlur={save}
          disabled={saving}
          maxLength={80}
          className="bg-background border border-card-border rounded px-2 py-1 text-sm w-44 focus:outline-none focus:border-accent-green/60 disabled:opacity-50"
        />
        <button
          type="button"
          onMouseDown={(e) => {
            // Prevent blur before we save
            e.preventDefault();
          }}
          onClick={save}
          disabled={saving}
          className="text-[10px] px-1.5 py-0.5 rounded border border-accent-green/40 text-accent-green hover:bg-accent-green/10 disabled:opacity-50"
        >
          {saving ? "…" : "save"}
        </button>
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={cancel}
          disabled={saving}
          className="text-[10px] px-1.5 py-0.5 rounded border border-card-border hover:bg-card-border/40 disabled:opacity-50"
        >
          cancel
        </button>
      </div>
      {error ? (
        <div className="text-[10px] text-accent-red">{error}</div>
      ) : null}
    </div>
  );
}

function PencilIcon() {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="opacity-0 group-hover:opacity-100 transition-opacity"
      aria-hidden
    >
      <path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
    </svg>
  );
}
