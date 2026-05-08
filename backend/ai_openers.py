"""GPT-generated personalized DM openers.

Generates one custom 1-2 sentence opener per target before campaign launch
and stores it as that target's lone "template" for the existing sender
pipeline. Pre-generation rationale: predictable cost, fail-fast on bad
config, and the worker hot path stays template-driven.

This module is the highest-leverage AI surface in the system — the cold
opener is the FIRST impression and dictates whether the funnel runs at
all. So it goes deeper than a one-line GPT call:

  1. **Copywriting framework in the system prompt** — hook → soft question
     → no-pressure close. Forbidden-word list (no spam triggers, no
     gambling-specific words in cold message). Length variation rule
     (60% one sentence, 40% two) so identical-shaped messages don't
     pattern-match as bot output.

  2. **Two-stage generation (optional, per arm)** — first GPT writes 3
     candidate openers in parallel; second pass picks the best and
     refines. ~3x cost, noticeably better quality. Used for high-stakes
     campaigns; cheap mode skips it.

  3. **Output validation** — every opener is regex-screened for spam
     trigger words, leaked placeholders, URLs, and length sanity. Bad
     output triggers a regenerate; failure after 2 retries falls back
     to a safe default.

  4. **Per-arm model override** — each arm picks its model
     (gpt-4o-mini for cheap testing, gpt-4o for premium quality). Lets
     you A/B test models head-to-head on the same audience.
"""

import asyncio
import logging
import re
from typing import Optional

from openai import AsyncOpenAI

from config import OPENAI_API_KEY, OPENAI_MODEL

logger = logging.getLogger(__name__)


# ---------- tunables ----------

OPENAI_TIMEOUT_S = 30
MAX_PARALLEL = 8
MAX_OUTPUT_TOKENS = 80
MAX_OPENER_CHARS = 320  # tightened from 400 — Telegram readers skim, long is bad

# Regex blocklist applied to every generated opener. Anything matching
# triggers a regenerate. Order matters — generic spam triggers first.
# These are intentionally aggressive: better to regenerate than to ship
# a flagged DM.
BLOCKLIST_PATTERNS: list[tuple[str, re.Pattern]] = [
    ("contains url", re.compile(r"https?://|t\.me/|telegram\.me/", re.I)),
    ("contains mention/handle", re.compile(r"@\w{3,}", re.I)),
    ("contains 'dm me'", re.compile(r"\bdm\s+me\b", re.I)),
    ("placeholder leak", re.compile(r"\{\s*(first_name|last_name|username)\s*\}", re.I)),
    ("forbidden gambling word", re.compile(
        r"\b(casino|win|bet|betting|wager|gambling|jackpot|deposit|bonus|"
        r"odds|slots|tournament|prize|payout)\b", re.I)),
    ("urgency language", re.compile(
        r"\b(limited\s+time|act\s+(now|fast|today)|don'?t\s+miss|"
        r"hurry|exclusive\s+offer|last\s+chance)\b", re.I)),
    ("guarantees", re.compile(r"\bguarantee[ds]?\b|100%|sure\s+win", re.I)),
    ("explicit cta", re.compile(r"\b(click|tap|join|register)\s+(here|now|this)\b", re.I)),
]

# The professional system prompt — replaces the previous 6-bullet version.
# Uses an AIDA-lite cold-outreach framework, an explicit blocklist, and
# few-shot examples to anchor the model's output style.
SYSTEM_PROMPT = """You are a senior copywriter writing a one-on-one Telegram DM that opens a real conversation. The recipient is a stranger who shares a Telegram group with the sender.

# Goal
Get a reply. Not a sale, not a click, not a follow-back. Just a reply. The sender has follow-up steps planned; your only job is to crack the door open.

# Hook framework — every opener follows this shape
1. **Specific observation** — reference the shared group concretely ("saw you in the [group]") or the recipient's first name. No "Hope you're well", no "I came across your profile".
2. **Soft question** — one open-ended question the recipient could answer in 5 seconds. Curiosity, not commitment. ("you betting on tonight?", "what's your go-to slot?", "how long you been in the group?")
3. **No close** — do NOT ask for anything. No "let me know", no "would love to chat", no link, no CTA. The question itself is the close.

# Output rules
- Output ONLY the message body. No preamble like "Here is the opener:". No surrounding quotes. No markdown.
- Length: 60% chance one sentence, 40% chance two. Cap 280 characters total.
- Tone: ~70% lowercase casual ("hey john, saw you in the group..."), ~30% sentence-case ("Hi John, noticed you're in..."). Pick dynamically per opener.
- Address the recipient by their first name when given. If the name is missing, OMIT the greeting entirely — do not write "Hey," or "Hi friend".
- Never invent personal details. Stay grounded in only what's given (first name, group, sender's style notes).

# Forbidden — regenerate if any appear
- URLs of any kind, including t.me/ links.
- @username mentions of OTHER accounts (you may use the recipient's own first name only).
- "DM me back", "let me know", "click", "tap", "join", "register", "sign up".
- Gambling vocabulary in the FIRST message: casino, win, bet, betting, wager, gambling, jackpot, deposit, bonus, odds, slots, tournament, prize, payout. (You can hint at sports/gaming context — "what slots", "any picks tonight" — but the explicit words trigger spam filters.)
- Urgency: "limited time", "act now", "don't miss", "exclusive", "last chance".
- Guarantees: "guaranteed", "100%", "sure win".
- Curly braces of any kind.
- Emoji unless the sender's style notes explicitly request them.

# Few-shot examples — the bar to clear

GOOD (one sentence, casual):
> hey mike, saw you in NFL Picks — you backing the lakers tonight?

GOOD (two sentences, sentence-case):
> Hi Sarah, noticed you're in the DFS group too. Curious — what's been your most reliable site this season?

GOOD (no name available, omits greeting):
> saw you posting in the slots community — what's been hitting for you lately?

BAD (generic, no specific hook):
> Hey! How are you doing today?

BAD (forbidden word + cta):
> Hi! Want to win some big jackpots? DM me to learn more.

BAD (urgency + url):
> Limited time bonus inside! Click https://example.com now!

# Final
Read the recipient details and the sender's style notes carefully. Write ONE opener that follows the framework. Output nothing but the message body."""

# Critic prompt for stage 2 of two-stage generation. The critic evaluates
# the 3 drafts and picks the best — or rejects all and signals regenerate.
CRITIC_SYSTEM_PROMPT = """You are a senior copywriter reviewing 3 candidate cold-DM openers. Pick the single strongest one — or reject all 3 if every candidate breaks the rules.

# Selection criteria — score in this order
1. **Forbidden-word safe** — no URLs, no @mentions of other accounts, no gambling words (casino, win, bet, slots, jackpot, deposit, bonus, etc.), no urgency, no guarantees, no explicit CTAs ("click", "join", "DM me").
2. **Hook concrete** — references the shared group or the recipient's name specifically. Generic openers ("Hi! How are you?") are a fail.
3. **Soft question** — ends in an open question the recipient can answer in 5 seconds.
4. **Natural rhythm** — sounds like a human texting, not a marketer pitching.
5. **Length sanity** — 1-2 sentences, under 280 chars.

# Output format — strict
If a candidate passes all 5: output ONLY that exact candidate's text, verbatim. No reformatting, no quotes, no preamble.

If ALL 3 candidates fail: output the literal token `REGENERATE` and nothing else.

Do NOT explain your choice. Do NOT add commentary. Output only the chosen text or `REGENERATE`.
"""


# ---------- errors + client ----------


class AIOpenerError(RuntimeError):
    """Raised when opener generation fails for a target."""


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
    return bool(OPENAI_API_KEY)


# ---------- prompt building ----------


def _build_user_prompt(target: dict, group_name: str, style: str) -> str:
    """Render the per-target user prompt.

    Coerces every text field to str so gspread's int/float cells don't
    crash .strip() (a bug we hit in Phase 2C).
    """
    first = str(target.get("first_name") or "").strip()
    last = str(target.get("last_name") or "").strip()
    username = str(target.get("username") or "").strip()
    parts = [
        "Recipient:",
        f"  - first name: {first or '(unknown)'}",
    ]
    if last:
        parts.append(f"  - last name: {last}")
    if username:
        parts.append(f"  - telegram username: @{username} (do NOT mention this in the DM)")
    if group_name:
        parts.append(f"  - shared group: {group_name}")
    parts += [
        "",
        "Sender's style notes (their voice/preference):",
        style.strip() or "(none — default to friendly + casual)",
        "",
        "Write one opener following the framework. Output the message body only.",
    ]
    return "\n".join(parts)


# ---------- output validation ----------


def _normalize_output(text: str) -> str:
    """Strip quotes, curlies, trim, and ensure length sanity."""
    text = (text or "").strip()
    # Strip surrounding quotes the model sometimes adds despite instructions.
    while (text.startswith('"') and text.endswith('"')) or (
        text.startswith("'") and text.endswith("'")
    ):
        text = text[1:-1].strip()
    # Drop curly braces — the sender's .format() would crash on placeholder leaks.
    text = text.replace("{", "").replace("}", "")
    if len(text) > MAX_OPENER_CHARS:
        text = text[:MAX_OPENER_CHARS].rstrip()
    return text


def _validate(text: str) -> Optional[str]:
    """Return None if the opener is clean; a reason string if it's bad."""
    if not text:
        return "empty"
    if len(text) < 10:
        return "too short"
    for label, pattern in BLOCKLIST_PATTERNS:
        if pattern.search(text):
            return label
    return None


# ---------- single-stage generation (cheap mode) ----------


async def _generate_candidate(
    target: dict, group_name: str, style: str, model: str
) -> str:
    """One GPT call → one opener candidate. Used as the building block
    for both single-stage and two-stage generation."""
    client = _get_client()
    user_prompt = _build_user_prompt(target, group_name, style)
    try:
        resp = await client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
            max_tokens=MAX_OUTPUT_TOKENS,
            temperature=0.85,  # slightly hotter — more variety across targets
        )
    except Exception as e:
        raise AIOpenerError(f"OpenAI call failed: {type(e).__name__}: {e}") from e

    if not resp.choices:
        raise AIOpenerError("OpenAI returned no choices")
    return _normalize_output(resp.choices[0].message.content or "")


async def _generate_single_stage(
    target: dict, group_name: str, style: str, model: str, retries: int = 2
) -> str:
    """Single-call generation with retry on validation failure."""
    last_reason = "no attempts"
    for attempt in range(retries + 1):
        try:
            text = await _generate_candidate(target, group_name, style, model)
        except AIOpenerError:
            if attempt == retries:
                raise
            continue
        reason = _validate(text)
        if reason is None:
            return text
        last_reason = reason
        logger.debug(f"AI opener rejected ({reason}); retry {attempt + 1}")
    raise AIOpenerError(f"All {retries + 1} attempts failed validation: {last_reason}")


# ---------- two-stage generation (premium mode) ----------


async def _generate_two_stage(
    target: dict, group_name: str, style: str, model: str
) -> str:
    """Generate 3 candidates in parallel, then a critic call picks the best.

    Roughly 3x the cost of single-stage but noticeably higher quality —
    used for arms where conversion matters more than per-message cost.
    """
    # Stage 1: 3 candidates in parallel.
    drafts = await asyncio.gather(
        _generate_candidate(target, group_name, style, model),
        _generate_candidate(target, group_name, style, model),
        _generate_candidate(target, group_name, style, model),
        return_exceptions=True,
    )
    valid_drafts: list[str] = []
    for d in drafts:
        if isinstance(d, Exception):
            continue
        if not _validate(d):
            valid_drafts.append(d)
    if not valid_drafts:
        # All 3 failed validation in stage 1 — fall back to single-stage retry
        # rather than waste a critic call on garbage.
        return await _generate_single_stage(target, group_name, style, model)
    if len(valid_drafts) == 1:
        return valid_drafts[0]

    # Stage 2: critic picks the best.
    critic_prompt = "Candidates:\n" + "\n".join(
        f"({i + 1}) {d}" for i, d in enumerate(valid_drafts)
    )
    client = _get_client()
    try:
        resp = await client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": CRITIC_SYSTEM_PROMPT},
                {"role": "user", "content": critic_prompt},
            ],
            max_tokens=MAX_OUTPUT_TOKENS,
            temperature=0.0,  # deterministic — we want consistent selection
        )
    except Exception as e:
        # If the critic fails, fall back to the first valid draft.
        logger.warning(f"critic call failed, using first valid draft: {e}")
        return valid_drafts[0]

    choice = _normalize_output(resp.choices[0].message.content or "")
    if choice == "REGENERATE" or _validate(choice):
        # Critic rejected all 3 OR the chosen text doesn't pass validation
        # (e.g. it hallucinated a new sentence rather than picking verbatim).
        # Fall back to single-stage on a fresh call.
        return await _generate_single_stage(target, group_name, style, model)
    return choice


# ---------- public API ----------


async def generate_openers_for_targets(
    targets: list[dict],
    group_name: str,
    style: str,
    model: Optional[str] = None,
    two_stage: bool = False,
) -> list[str]:
    """Generate one opener per target, in parallel (capped at MAX_PARALLEL).

    `model`: per-call model override. Defaults to the global OPENAI_MODEL.
    Pass "gpt-4o" for premium quality, "gpt-4o-mini" for cheap testing.

    `two_stage`: enable draft → critic → refine. Costs ~3x but noticeably
    higher quality. Recommended for arms where conversion matters most.

    If ANY target fails (after retries), raises AIOpenerError so the
    caller can abort cleanly rather than ship a half-personalized batch.
    """
    if not targets:
        return []
    if not style.strip():
        raise AIOpenerError("AI mode requires a non-empty style instruction")
    _get_client()  # fail fast on missing key BEFORE we kick off N tasks

    chosen_model = model or OPENAI_MODEL
    sem = asyncio.Semaphore(MAX_PARALLEL)
    results: list[Optional[str]] = [None] * len(targets)

    async def _one(idx: int, t: dict) -> None:
        async with sem:
            if two_stage:
                results[idx] = await _generate_two_stage(t, group_name, style, chosen_model)
            else:
                results[idx] = await _generate_single_stage(t, group_name, style, chosen_model)

    tasks = [asyncio.create_task(_one(i, t)) for i, t in enumerate(targets)]
    try:
        await asyncio.gather(*tasks)
    except Exception:
        for task in tasks:
            if not task.done():
                task.cancel()
        raise

    out: list[str] = []
    for i, r in enumerate(results):
        if not r:
            raise AIOpenerError(f"Missing opener for target index {i}")
        out.append(r)
    logger.info(
        f"AI: generated {len(out)} openers using {chosen_model} "
        f"(two_stage={two_stage})"
    )
    return out
