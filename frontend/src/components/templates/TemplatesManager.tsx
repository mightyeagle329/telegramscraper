"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  createTemplate,
  deleteTemplate,
  updateTemplate,
} from "@/lib/actions/templates";
import {
  extractTemplateVariables,
  type DbMessageTemplate,
} from "@/types/database";

type Draft = { id: string | null; name: string; body: string };

const EMPTY: Draft = { id: null, name: "", body: "" };

export default function TemplatesManager({
  initial,
}: {
  initial: DbMessageTemplate[];
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const isEditing = draft.id !== null;

  function startEdit(t: DbMessageTemplate) {
    setDraft({ id: t.id, name: t.name, body: t.body });
    setError(null);
  }

  function reset() {
    setDraft(EMPTY);
    setError(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = isEditing
        ? await updateTemplate(draft.id!, {
            name: draft.name,
            body: draft.body,
          })
        : await createTemplate({ name: draft.name, body: draft.body });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      reset();
      router.refresh();
    });
  }

  async function remove(t: DbMessageTemplate) {
    if (!confirm(`Delete template "${t.name}"?`)) return;
    startTransition(async () => {
      const result = await deleteTemplate(t.id);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      if (draft.id === t.id) reset();
      router.refresh();
    });
  }

  const detectedVars = extractTemplateVariables(draft.body);

  return (
    <div className="grid md:grid-cols-[1fr_1.2fr] gap-6">
      {/* Left: list */}
      <div className="bg-card-bg border border-card-border rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-card-border flex items-center justify-between">
          <h2 className="font-semibold text-sm uppercase text-text-muted">
            {initial.length} template{initial.length === 1 ? "" : "s"}
          </h2>
          <button
            onClick={reset}
            className="text-xs text-accent-green hover:underline"
          >
            + New template
          </button>
        </div>
        {initial.length === 0 ? (
          <p className="text-text-muted text-sm px-4 py-6 text-center">
            No templates yet. Fill in the form to create your first.
          </p>
        ) : (
          <ul>
            {initial.map((t) => (
              <li
                key={t.id}
                className={`px-4 py-3 border-b border-card-border/40 last:border-b-0 cursor-pointer ${
                  draft.id === t.id
                    ? "bg-card-border/30"
                    : "hover:bg-card-border/20"
                }`}
                onClick={() => startEdit(t)}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-medium truncate">{t.name}</div>
                    <div className="text-xs text-text-muted line-clamp-2 mt-0.5">
                      {t.body}
                    </div>
                    {t.variables.length > 0 ? (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {t.variables.map((v) => (
                          <span
                            key={v}
                            className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-card-border text-text-muted"
                          >
                            {`{${v}}`}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      remove(t);
                    }}
                    disabled={pending}
                    className="text-xs text-accent-red hover:underline shrink-0"
                  >
                    delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Right: editor */}
      <form
        onSubmit={submit}
        className="bg-card-bg border border-card-border rounded-xl p-5 space-y-4"
      >
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">
            {isEditing ? "Edit template" : "New template"}
          </h2>
          {isEditing ? (
            <button
              type="button"
              onClick={reset}
              className="text-xs text-text-muted hover:text-foreground"
            >
              cancel edit
            </button>
          ) : null}
        </div>

        <label className="block">
          <span className="block text-xs uppercase text-text-muted mb-1">
            Name
          </span>
          <input
            value={draft.name}
            onChange={(e) =>
              setDraft((d) => ({ ...d, name: e.target.value }))
            }
            placeholder="e.g. Opener — PT lead"
            className="w-full bg-background border border-card-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent-green/50"
            required
          />
        </label>

        <label className="block">
          <span className="block text-xs uppercase text-text-muted mb-1">
            Message body
            <span className="normal-case text-text-muted/70 ml-2">
              — up to 4096 chars, placeholders: {"{first_name}"}{" "}
              {"{last_name}"} {"{username}"}
            </span>
          </span>
          <textarea
            value={draft.body}
            onChange={(e) =>
              setDraft((d) => ({ ...d, body: e.target.value }))
            }
            placeholder={
              "Hey {first_name}, quick question — saw you in the group and wanted to reach out."
            }
            rows={8}
            className="w-full bg-background border border-card-border rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-accent-green/50"
            required
          />
          <div className="mt-1 flex items-center justify-between text-xs text-text-muted">
            <span>
              {detectedVars.length > 0 ? (
                <>
                  Detected placeholders:{" "}
                  {detectedVars.map((v) => `{${v}}`).join(", ")}
                </>
              ) : (
                "No placeholders yet — add at least {first_name} so DMs feel personal."
              )}
            </span>
            <span>{draft.body.length} / 4096</span>
          </div>
        </label>

        {error ? (
          <div className="px-3 py-2 bg-accent-red/10 border border-accent-red/30 text-accent-red rounded-lg text-sm">
            {error}
          </div>
        ) : null}

        <div className="flex justify-end gap-2">
          <button
            type="submit"
            disabled={pending}
            className="px-4 py-2 rounded-lg bg-accent-green/20 border border-accent-green/40 text-accent-green text-sm font-medium hover:bg-accent-green/30 disabled:opacity-50"
          >
            {pending
              ? "Saving…"
              : isEditing
              ? "Save changes"
              : "Create template"}
          </button>
        </div>
      </form>
    </div>
  );
}
