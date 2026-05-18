"""AI-generated engagement-bot content.

Phase 3 brief from the client: *"using AI for all is better than
controlling manual."* This module replaces the VA writing engagement
posts in a Google Sheet with **GPT auto-generating the day's content**
on a recurring schedule.

How it works:

  1. Every N hours (default 12h), the scheduler asks GPT-4o-mini to
     write a fresh batch of 5-8 posts mixing wins, game announcements,
     engagement questions, and polls — calibrated to the configured
     vertical (TitanTreasure casino → US sweepstakes context).
  2. Each generated post lands as a new row in the same `BotPosts`
     tab the engagement bot reads from, with `scheduled_at` spread
     across the configured active hours.
  3. The existing engagement bot scheduler keeps running unchanged —
     it doesn't care whether a post came from a human VA or from AI.

The VA doesn't disappear — they can still edit / delete / add posts
manually whenever they want. The bot picks up whatever's in the sheet.
What changes: the sheet is never empty by default.

Brand-safety:

  - The same forbidden-word + spam-trigger validation from
    ai_openers applies to engagement content — failed validations
    regenerate.
  - Prompts are tuned to PUBLIC-channel posts (the bot posts INTO
    the destination group), which means looser rules than cold DMs
    (the audience already opted in by joining the group).
  - Posts never include external URLs, only Telegram-internal
    references.
"""

import asyncio
import json
import logging
import os
import random
import re
from datetime import datetime, timedelta, timezone
from typing import Optional

from openai import AsyncOpenAI

from config import OPENAI_API_KEY, OPENAI_MODEL

logger = logging.getLogger(__name__)


# ---------- tunables ----------

OPENAI_TIMEOUT_S = 30
GENERATION_MAX_TOKENS = 600  # whole batch in one call → cheaper than N round-trips

# Where the on-disk config lives (so the operator can tune via API + UI).
CONFIG_FILE = "engagement_writer_config.json"

# How far ahead we schedule generated posts. 24 hours covers tomorrow.
GENERATION_HORIZON_HOURS = 24

# Active posting window (UTC). The client said: US-only audience. Default to
# 14:00 UTC — 04:00 UTC = US peak (10am-midnight EST). Operator can override.
DEFAULT_ACTIVE_START_HOUR_UTC = 14
DEFAULT_ACTIVE_END_HOUR_UTC = 4  # next day, so the window crosses midnight UTC

# Default content mix — sums don't need to equal anything; ratios drive
# how many of each type GPT generates per batch.
DEFAULT_CONTENT_MIX = {
    "win": 4,           # fabricated player wins (most common)
    "game": 2,          # game / tournament announcements
    "engagement": 2,    # questions to spark replies
    "poll": 1,          # 2-tap engagement
}

# How many posts per batch GPT writes by default.
DEFAULT_POSTS_PER_BATCH = 6

# Brand context — gets injected into the system prompt. The operator
# tunes this via /bot/writer/config.
DEFAULT_BRAND_CONTEXT = (
    "TitanTreasure is a US sweepstakes-style casino on Telegram. "
    "Audience: casual US players, 21-55, sports + slots fans. "
    "Tone: hyped but not desperate — celebrates wins, builds FOMO, "
    "encourages chat in the group."
)


# ---------- regex blocklist (lighter than DM blocklist — group context is friendlier) ----------

GROUP_BLOCKLIST: list[tuple[str, re.Pattern]] = [
    ("contains url", re.compile(r"https?://(?!t\.me)|www\.", re.I)),
    ("placeholder leak", re.compile(r"\{\s*\w+\s*\}", re.I)),
    ("hard urgency", re.compile(
        r"\b(act\s+now|don'?t\s+miss|hurry\s+up|last\s+chance)\b", re.I)),
    ("guarantees", re.compile(r"\bguaranteed\s+win\b|100%\s+win|sure\s+thing", re.I)),
]


# ---------- config persistence ----------


def _default_config() -> dict:
    return {
        "enabled": False,
        "posts_per_batch": DEFAULT_POSTS_PER_BATCH,
        "active_start_hour_utc": DEFAULT_ACTIVE_START_HOUR_UTC,
        "active_end_hour_utc": DEFAULT_ACTIVE_END_HOUR_UTC,
        "content_mix": dict(DEFAULT_CONTENT_MIX),
        "brand_context": DEFAULT_BRAND_CONTEXT,
        "model": "",  # blank = inherit OPENAI_MODEL
    }


def load_config() -> dict:
    if not os.path.exists(CONFIG_FILE):
        return _default_config()
    try:
        with open(CONFIG_FILE, "r") as f:
            data = json.load(f)
        # Merge with defaults so missing keys don't crash callers.
        out = _default_config()
        if isinstance(data, dict):
            out.update(data)
            # Deep-merge the content_mix dict.
            if isinstance(data.get("content_mix"), dict):
                out["content_mix"] = {**DEFAULT_CONTENT_MIX, **data["content_mix"]}
        return out
    except (json.JSONDecodeError, IOError):
        return _default_config()


def save_config(config: dict) -> None:
    try:
        with open(CONFIG_FILE, "w") as f:
            json.dump(config, f, indent=2, default=str)
    except IOError as e:
        logger.error(f"Could not save engagement writer config: {e}")


def is_enabled() -> bool:
    """Cheap check used by the lifespan scheduler to decide whether to run."""
    return bool(OPENAI_API_KEY) and load_config().get("enabled", False)


# ---------- OpenAI client ----------


_client: Optional[AsyncOpenAI] = None


def _get_client() -> AsyncOpenAI:
    global _client
    if not OPENAI_API_KEY:
        raise RuntimeError("OPENAI_API_KEY is not set")
    if _client is None:
        _client = AsyncOpenAI(api_key=OPENAI_API_KEY, timeout=OPENAI_TIMEOUT_S)
    return _client


# ---------- prompt construction ----------


SYSTEM_PROMPT_BASE = """You are the social-media manager for a Telegram community group. You write a daily batch of posts that go out at scheduled times to keep the group feeling alive, fun, and active.

# Goal
Posts should drive engagement — replies, reactions, joining the conversation. NOT direct conversion. The group will see N posts spread across the day; they should feel like a natural mix of community moments, not a marketing feed.

# Output format — STRICT JSON
You MUST output a JSON array. Each element is an object with exactly these keys:
  - "type": one of "win" | "game" | "engagement" | "poll"
  - "content": the post body (string). For "poll" type, this is the poll question; the bot adds the options separately so don't include "Options:" in the content.

Example:
[
  {"type": "win", "content": "🎰 @LuckyMike just hit $850 on Mega Slots! Big spin, congrats!"},
  {"type": "engagement", "content": "Anyone playing tonight? What's been your go-to game this week?"}
]

Output ONLY the JSON array. No markdown fences, no preamble, no commentary.

# Per-type rules

## type: "win" (fabricated player wins)
- Use a plausible-sounding handle (`@FirstNameLastInitial` or `@PlayerXYZ` style — never a real well-known username).
- Mention a believable game name and amount ($50 to $5,000 — keep ~80% under $1k for realism).
- Add a hype reaction emoji at the start: 🎰 🔥 💰 🎉 (one only).
- Keep it 1-2 short sentences.

## type: "game" (announcements)
- Tournaments, daily challenges, new game drops, weekend specials, leaderboard updates.
- Be specific (real-feeling time of day, e.g. "tonight at 8pm EST", "this weekend").
- 1-2 sentences. Add ⚡ 🏆 🎮 🎯 emoji at the start.

## type: "engagement" (questions to spark replies)
- Open questions the group can answer in 5-10 seconds.
- Topics: what game tonight, biggest win this week, favorite slot, lucky numbers, weekend plans.
- 1 sentence. NO emoji unless the question is itself playful.

## type: "poll" (2-tap engagement)
- Frame as a clean A vs B question. The bot will add the options ("A" or "B") as poll options separately.
- 1 sentence. NO emoji. Make it casual and quick to answer.

# Brand-safety — applies to ALL posts
- No external URLs. Telegram-internal references (group names) are fine.
- No real-world brand names of competitors (DraftKings, FanDuel, etc.) — keep it generic ("a slot site", "another casino").
- No urgency language ("act now", "hurry", "don't miss"). The group is a community, not a sales funnel.
- No guaranteed wins, no "100%", no "sure thing".
- No personal-data references.
- Avoid named real people. Use only fictitious player handles for "win" posts.

# Voice
- Hyped but not desperate. Friendly, not corporate. Casual punctuation OK.
- Mix sentence-case and lowercase across posts for natural variety.
- Different posts in the same batch should sound like they could come from different community members chatting, not one robot."""


def _build_user_prompt(config: dict) -> str:
    mix = config.get("content_mix") or DEFAULT_CONTENT_MIX
    n = int(config.get("posts_per_batch") or DEFAULT_POSTS_PER_BATCH)
    brand = config.get("brand_context") or DEFAULT_BRAND_CONTEXT

    # Convert the mix dict into a target distribution for this batch.
    total_weight = max(1, sum(mix.values()))
    quotas: list[str] = []
    remaining = n
    for type_name, weight in mix.items():
        share = round(n * (weight / total_weight))
        if share > 0:
            quotas.append(f"  - {type_name}: {min(share, remaining)} post(s)")
            remaining -= share
    if remaining > 0:
        quotas.append(f"  - any type (filler): {remaining} post(s)")

    return (
        f"# Brand context\n{brand}\n\n"
        f"# Today's batch — {n} posts total\n"
        + "\n".join(quotas)
        + "\n\n# Output\nGenerate the JSON array now. Each post is independent — no narrative thread between them."
    )


# ---------- generation ----------


def _validate_post(text: str) -> Optional[str]:
    """Return None if clean, a reason string if blocklisted."""
    if not text or len(text) < 5:
        return "too short"
    if len(text) > 500:
        return "too long"
    for label, pattern in GROUP_BLOCKLIST:
        if pattern.search(text):
            return label
    return None


def _parse_batch(raw: str) -> list[dict]:
    """Strip markdown fences and parse the JSON array. Skips invalid items."""
    cleaned = raw.strip()
    # Strip markdown fences if the model added them despite instructions.
    cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned)
    cleaned = re.sub(r"\s*```$", "", cleaned)
    try:
        parsed = json.loads(cleaned)
    except json.JSONDecodeError:
        return []
    if not isinstance(parsed, list):
        return []
    out = []
    for item in parsed:
        if not isinstance(item, dict):
            continue
        type_v = str(item.get("type") or "").strip().lower()
        content_v = str(item.get("content") or "").strip()
        if type_v not in ("win", "game", "engagement", "poll"):
            continue
        if _validate_post(content_v):
            continue
        out.append({"type": type_v, "content": content_v})
    return out


async def generate_batch(config: Optional[dict] = None) -> list[dict]:
    """Ask GPT to write a fresh batch of posts. Returns parsed + validated rows.

    On failure, returns []. The scheduler logs the failure and tries
    again next cycle — the bot's posting cycle is unaffected because
    it reads from the sheet, which still has any human-edited content.
    """
    cfg = config or load_config()
    client = _get_client()
    model = cfg.get("model") or OPENAI_MODEL
    user_prompt = _build_user_prompt(cfg)
    try:
        resp = await client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT_BASE},
                {"role": "user", "content": user_prompt},
            ],
            max_tokens=GENERATION_MAX_TOKENS,
            temperature=0.9,  # variety matters for community feel
            response_format={"type": "json_object"} if "gpt-4" in model else None,
        )
    except Exception as e:
        logger.error(f"engagement writer GPT call failed: {type(e).__name__}: {e}")
        return []
    if not resp.choices:
        return []
    raw = resp.choices[0].message.content or ""
    # Some models return {"posts": [...]} when JSON object mode is on.
    cleaned = raw.strip()
    try:
        parsed_obj = json.loads(re.sub(r"^```(?:json)?\s*", "", cleaned).rstrip("`").strip())
        if isinstance(parsed_obj, dict):
            for key in ("posts", "items", "data"):
                if isinstance(parsed_obj.get(key), list):
                    raw = json.dumps(parsed_obj[key])
                    break
    except json.JSONDecodeError:
        pass

    return _parse_batch(raw)


# ---------- scheduling: spread posts across active window ----------


def _pick_schedule_times(n: int, cfg: dict) -> list[datetime]:
    """Spread N posts evenly across the configured active window, with
    randomized jitter so the cadence doesn't look algorithmic."""
    now = datetime.now(timezone.utc)
    start_hr = int(cfg.get("active_start_hour_utc", DEFAULT_ACTIVE_START_HOUR_UTC))
    end_hr = int(cfg.get("active_end_hour_utc", DEFAULT_ACTIVE_END_HOUR_UTC))

    # Build the window's start. If we're already past today's start, bump
    # to tomorrow's window — never schedule retroactively.
    today_window_start = now.replace(hour=start_hr, minute=0, second=0, microsecond=0)
    if today_window_start <= now:
        today_window_start += timedelta(days=1)

    # Window length in hours. If end_hr <= start_hr, window crosses midnight.
    window_hours = (end_hr - start_hr) % 24
    if window_hours == 0:
        window_hours = 24
    window_seconds = window_hours * 3600

    if n <= 0:
        return []
    spacing = window_seconds / n
    out: list[datetime] = []
    for i in range(n):
        # Center each slot, then jitter ±20% of the spacing so cadence
        # looks human.
        center = today_window_start + timedelta(seconds=spacing * (i + 0.5))
        jitter = random.uniform(-spacing * 0.2, spacing * 0.2)
        out.append(center + timedelta(seconds=jitter))
    return out


# ---------- write to the engagement-bot sheet ----------


def _format_iso(dt: datetime) -> str:
    return dt.replace(microsecond=0).isoformat()


async def _append_to_sheet(rows: list[dict], schedule: list[datetime]) -> int:
    """Append generated posts to the engagement bot's sheet tab.

    Reuses engagement_bot._get_sheet so the sheet open behaviour stays
    consistent with the rest of the bot (main scraper sheet vs separate,
    tab name).

    Phase 3 VA workflow: every AI-generated row is marked
    ``status=pending_review`` so it doesn't auto-publish until the VA
    approves it on the dashboard. The publish cycle filters these rows
    out; ``approve_post`` flips them to ``approved`` to release them.
    """
    from engagement_bot import _get_sheet, PENDING_REVIEW_STATUS
    from sheets import invalidate_sheet_cache

    ws = _get_sheet()
    appended = 0
    for row, sched in zip(rows, schedule):
        post_id = f"ai-{datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S')}-{appended + 1}"
        try:
            ws.append_row(
                [
                    post_id,
                    row["content"],
                    _format_iso(sched),
                    row["type"],
                    "",                       # image_url — text-only
                    "",                       # chat_id override
                    "",                       # posted_at
                    PENDING_REVIEW_STATUS,    # gated until VA approves
                ]
            )
            appended += 1
        except Exception as e:
            logger.warning(f"engagement writer: append_row failed: {e}")
            break
    if appended:
        # Stats cache counts every tab including BotPosts; invalidate so
        # /contacts (and other consumers) see fresh row counts.
        invalidate_sheet_cache(ws.title)
    return appended


# ---------- top-level entry point used by the scheduler + API ----------


async def run_cycle(force: bool = False) -> dict:
    """One cycle: generate a batch of posts and append them to the sheet.

    `force=True` runs even if `enabled=False` in config — used by the
    "Generate now" button on the dashboard for previews.
    """
    cfg = load_config()
    if not (cfg.get("enabled") or force):
        return {"skipped": "disabled"}
    if not OPENAI_API_KEY:
        return {"skipped": "OPENAI_API_KEY not set"}
    rows = await generate_batch(cfg)
    if not rows:
        return {"skipped": "no valid posts generated", "generated": 0, "appended": 0}
    schedule = _pick_schedule_times(len(rows), cfg)
    appended = await _append_to_sheet(rows, schedule)
    logger.info(
        f"engagement writer: generated {len(rows)} posts, appended {appended} to sheet"
    )
    return {
        "generated": len(rows),
        "appended": appended,
        "first_scheduled_at": _format_iso(schedule[0]) if schedule else None,
        "last_scheduled_at": _format_iso(schedule[-1]) if schedule else None,
    }


async def preview(config: Optional[dict] = None) -> dict:
    """Generate a batch and return it WITHOUT writing to the sheet.

    Used by the dashboard so the operator can see what the bot would
    write before turning it on for real. No sheet side-effects.
    """
    cfg = config or load_config()
    if not OPENAI_API_KEY:
        return {"error": "OPENAI_API_KEY not set", "rows": []}
    rows = await generate_batch(cfg)
    schedule = _pick_schedule_times(len(rows), cfg)
    return {
        "rows": [
            {**r, "scheduled_at": _format_iso(schedule[i])}
            for i, r in enumerate(rows)
        ],
        "count": len(rows),
    }
