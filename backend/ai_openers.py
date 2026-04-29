"""GPT-generated personalized DM openers (Phase 2C).

Each campaign arm can flip from "static template rotation" to "AI mode".
In AI mode, the arm carries an ``ai_style`` instruction string instead of
a list of templates. At campaign-launch time, we walk every target and
generate ONE custom opener per target via the OpenAI Chat Completions API.

The generated opener replaces the arm's static template list on a
per-target basis: each queue item gets ``templates: [<the one AI opener
for this target>]`` so the existing sender pipeline (random pick, render
placeholders, append invisible suffix) keeps working unchanged.

Pre-generation rationale:
  - Cost is small + predictable. With gpt-4o-mini at ~$0.15 per 1M input
    tokens and ~$0.60 per 1M output, ~50 input + 30 output tokens per
    target works out to ~$0.0001 per opener. 1000 targets ≈ $0.10.
  - Failures fail fast: if the API key is wrong, we discover it at
    campaign-launch time, not partway through sending. The user can
    abort + retry without leaving half a queue behind.
  - Per-send latency stays predictable: workers don't hit OpenAI in the
    hot path, so a flaky model doesn't slow down outreach.
"""

import asyncio
import logging
from typing import Optional

from openai import AsyncOpenAI

from config import OPENAI_API_KEY, OPENAI_MODEL

logger = logging.getLogger(__name__)

# Per-call timeout — keep tight so a stuck API doesn't block the whole
# campaign launch. If we time out we raise; the caller decides whether
# to fall back or abort.
OPENAI_TIMEOUT_S = 30

# Concurrency cap on parallel opener generations. Stays below the typical
# OpenAI tier-1 RPM (3000/min for gpt-4o-mini) and avoids burst throttling.
MAX_PARALLEL = 8

# Max output tokens per opener — caps cost AND model verbosity. Telegram
# DMs that work tend to be 1-2 sentences; 80 tokens is plenty.
MAX_OUTPUT_TOKENS = 80

# Hard ceiling on opener length (post-generation safety). If the model
# ignores instructions and returns something huge, we truncate before
# enqueueing so we don't ship a 500-char wall of text.
MAX_OPENER_CHARS = 400

SYSTEM_PROMPT = (
    "You write short, casual Telegram DM openers.\n"
    "\n"
    "Rules:\n"
    "  - Output ONLY the message body. No quotes, no preamble like "
    '"Here is your opener:", no "Sure, ..." prefix.\n'
    "  - 1-2 sentences max. Conversational, not salesy. No emojis unless "
    "the style instructions explicitly ask for them.\n"
    "  - Address the recipient by their first name when known. Skip the "
    "name gracefully if it's missing — don't write 'Hey ,' or 'Hi None'.\n"
    "  - Never invent personal details about the recipient. Stay grounded "
    "in only the facts you're given (name, group context, style notes).\n"
    "  - No curly braces in the output."
)


class AIOpenerError(RuntimeError):
    """Raised when opener generation fails for a target.

    Caller (the campaign launcher) decides whether to skip the target or
    abort the whole batch.
    """


_client: Optional[AsyncOpenAI] = None


def _get_client() -> AsyncOpenAI:
    global _client
    if not OPENAI_API_KEY:
        raise AIOpenerError(
            "OPENAI_API_KEY is not set. Either set it in backend/.env or "
            "switch the arm back to template mode."
        )
    if _client is None:
        _client = AsyncOpenAI(api_key=OPENAI_API_KEY, timeout=OPENAI_TIMEOUT_S)
    return _client


def is_configured() -> bool:
    """Cheap check used by the API to gate the AI-mode toggle in the UI."""
    return bool(OPENAI_API_KEY)


def _build_user_prompt(
    target: dict, group_name: str, style: str
) -> str:
    """Render the per-target prompt the model receives.

    `target` matches the sender target shape (user_id + first_name +
    last_name + username). Missing fields render as ``unknown``.
    """
    # Coerce to str defensively — gspread can hand us int/float values for
    # cells that look numeric, and a str() call is cheap insurance.
    first = str(target.get("first_name") or "").strip()
    last = str(target.get("last_name") or "").strip()
    username = str(target.get("username") or "").strip()
    parts = [
        "Generate one personalized DM opener for this recipient.",
        "",
        "Recipient:",
        f"  - first name: {first or '(unknown)'}",
    ]
    if last:
        parts.append(f"  - last name: {last}")
    if username:
        parts.append(f"  - telegram username: @{username}")
    if group_name:
        parts.append(f"  - met in / context: {group_name}")
    parts += [
        "",
        "Style instructions from the sender:",
        style.strip() or "(no extra instructions — write a friendly hello)",
        "",
        "Output the message body only.",
    ]
    return "\n".join(parts)


async def _generate_one(target: dict, group_name: str, style: str) -> str:
    client = _get_client()
    user_prompt = _build_user_prompt(target, group_name, style)
    try:
        resp = await client.chat.completions.create(
            model=OPENAI_MODEL,
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
            max_tokens=MAX_OUTPUT_TOKENS,
            temperature=0.8,  # some variation between targets
        )
    except Exception as e:
        raise AIOpenerError(f"OpenAI call failed: {type(e).__name__}: {e}") from e

    if not resp.choices:
        raise AIOpenerError("OpenAI returned no choices")
    text = (resp.choices[0].message.content or "").strip()

    # Strip surrounding quotes the model sometimes adds despite instructions.
    if (text.startswith('"') and text.endswith('"')) or (
        text.startswith("'") and text.endswith("'")
    ):
        text = text[1:-1].strip()

    if not text:
        raise AIOpenerError("OpenAI returned an empty opener")

    # Defensive: drop any stray curly braces so .format() in the sender
    # doesn't choke. The system prompt already forbids them, but models
    # occasionally slip.
    text = text.replace("{", "").replace("}", "")

    if len(text) > MAX_OPENER_CHARS:
        text = text[:MAX_OPENER_CHARS].rstrip()

    return text


async def generate_openers_for_targets(
    targets: list[dict],
    group_name: str,
    style: str,
) -> list[str]:
    """Generate one opener per target in parallel (capped at MAX_PARALLEL).

    Returns a list aligned 1:1 with `targets` — `out[i]` is the opener for
    `targets[i]`. If ANY target fails, raises AIOpenerError so the caller
    can abort cleanly rather than ship a half-personalized batch (and
    leave the user with a confusing partial campaign).
    """
    if not targets:
        return []
    if not style.strip():
        raise AIOpenerError("AI mode requires a non-empty style instruction")
    _get_client()  # fail fast on missing key BEFORE we kick off N tasks

    sem = asyncio.Semaphore(MAX_PARALLEL)
    results: list[Optional[str]] = [None] * len(targets)

    async def _one(idx: int, t: dict) -> None:
        async with sem:
            results[idx] = await _generate_one(t, group_name, style)

    tasks = [asyncio.create_task(_one(i, t)) for i, t in enumerate(targets)]
    try:
        await asyncio.gather(*tasks)
    except Exception:
        # Cancel any still-pending tasks so they don't keep eating quota.
        for task in tasks:
            if not task.done():
                task.cancel()
        raise

    # Type-narrow + sanity check.
    out: list[str] = []
    for i, r in enumerate(results):
        if not r:
            raise AIOpenerError(f"Missing opener for target index {i}")
        out.append(r)
    logger.info(f"AI: generated {len(out)} openers using {OPENAI_MODEL}")
    return out
