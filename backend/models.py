from pydantic import BaseModel
from typing import Optional, Any


class GroupAdd(BaseModel):
    url: str


class GroupResponse(BaseModel):
    id: str
    name: str
    url: str
    member_count: int
    scraped_count: int
    status: str
    last_scraped: Optional[str] = None


class MemberData(BaseModel):
    user_id: int
    username: Optional[str] = None
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    phone: Optional[str] = None
    group_name: str
    group_url: str
    scraped_at: str
    is_new: bool = False


class ScrapeResult(BaseModel):
    group_name: str
    total_members: int
    new_members: int
    exported_to_sheet: bool


class MonitorStatus(BaseModel):
    group_url: str
    is_monitoring: bool
    interval_seconds: int
    last_check: Optional[str] = None
    new_members_since_last: int = 0


class ProxyConfig(BaseModel):
    """IPRoyal-style residential proxy config (one sticky session per account)."""

    type: str = "socks5"  # socks5 | http
    host: str
    port: int
    username: Optional[str] = None
    password: Optional[str] = None


class AccountAdd(BaseModel):
    """Body for registering a new sender account (pre-login bookkeeping).

    The actual Telethon sign-in with SMS code is run via the `add_account.py`
    CLI against this record — we don't expose the SMS flow to the web API.
    """

    phone: str
    label: Optional[str] = None
    proxy: Optional[ProxyConfig] = None
    api_id: Optional[int] = None
    api_hash: Optional[str] = None


class AccountUpdate(BaseModel):
    """Patch body for editable account fields."""

    label: Optional[str] = None
    # Set to True to dismiss the stale `last_error` + `last_error_at` fields
    # from the UI. Doesn't affect account status.
    dismiss_error: Optional[bool] = None


class AccountResponse(BaseModel):
    """Redacted account view returned by the API (no proxy creds, no api_hash)."""

    id: str
    label: str
    phone: str
    status: str
    warmup_started_at: Optional[str] = None
    daily_limit: int
    daily_sent: int
    total_sent: int
    last_send_at: Optional[str] = None
    last_error: Optional[str] = None
    last_error_at: Optional[str] = None
    proxy_host: Optional[str] = None
    proxy_port: Optional[int] = None
    proxy_type: Optional[str] = None
    health: dict = {}


class TargetMember(BaseModel):
    """A scraped member the sender can DM. Matches the sheet/scraper shape."""

    user_id: int
    username: Optional[str] = ""
    first_name: Optional[str] = ""
    last_name: Optional[str] = ""


class EnqueueRequest(BaseModel):
    """Enqueue DM tasks onto one account's queue."""

    account_id: str
    targets: list[TargetMember]
    templates: list[str]
    delete_after_s: Optional[int] = None
    campaign: str = ""
    follow_up_after_days: Optional[int] = None
    follow_up_templates: Optional[list[str]] = None


class DistributeRequest(BaseModel):
    """Enqueue DM tasks across multiple accounts round-robin."""

    account_ids: list[str]
    targets: list[TargetMember]
    templates: list[str]
    delete_after_s: Optional[int] = None
    campaign: str = ""
    follow_up_after_days: Optional[int] = None
    follow_up_templates: Optional[list[str]] = None


class CampaignArm(BaseModel):
    """One A/B test arm. Each arm is its own message strategy.

    Arms are run in parallel inside one campaign — targets are split evenly
    across arms so we can fairly compare reply rates between strategies.
    Each arm's name (e.g. "A", "B", "control", "gpt-opener") is stamped on
    every send + reply record for reporting.

    Two opener modes per arm:
      - **Templates mode (default)**: ``primary_templates`` is a list of
        variants; the worker picks one at random per send.
      - **AI mode**: ``ai_style`` is set (free-form style instructions).
        At campaign-launch time we generate ONE custom opener per target
        via OpenAI and store it as that target's lone template, so the
        sender hot path is unchanged. ``primary_templates`` is ignored
        when ``ai_style`` is set.

    Follow-ups always use ``follow_up_templates`` regardless of mode —
    the AI opener is for first-touch; the nudge stays as templated copy.
    """

    name: str
    primary_templates: Optional[list[str]] = None
    ai_style: Optional[str] = None
    follow_up_after_days: Optional[int] = None
    follow_up_templates: Optional[list[str]] = None


class CampaignFromSheetRequest(BaseModel):
    """Enqueue DMs using members pulled from an existing Google Sheet tab."""

    sheet_group_name: str
    account_ids: list[str]
    delete_after_s: Optional[int] = None
    campaign: str = ""
    limit: Optional[int] = None
    # Shuffle the rows from the sheet before applying `limit`. Defaults to
    # True because scraped-message order surfaces heavy posters (often
    # admins / bots / official accounts) at the top — without shuffling,
    # a small `limit` campaign hits exactly those people, who all have
    # privacy restrictions and skip 100% of the time. Set False if you
    # specifically want sheet-order (e.g. recently-scraped first).
    shuffle: bool = True
    # Drop usernames / names matching bot / admin / official / support /
    # staff / news / notify / alerts patterns before enqueueing. Defaults
    # to True — these accounts almost always have privacy restrictions
    # and skip 100% of the time. Set False to bypass and try them anyway.
    filter_bots: bool = True

    # === A/B testing ===
    # Phase 2B: define one or more `arms`, each with its own template set
    # and (optional) follow-up config. Targets are split round-robin across
    # arms so each arm sees roughly the same target count for fair
    # reply-rate comparison.
    arms: Optional[list[CampaignArm]] = None

    # === Legacy single-arm fields (back-compat) ===
    # If `arms` is omitted, we fall back to a single implicit arm built
    # from these fields — preserves the pre-2B request shape so existing
    # frontend builds keep working without redeploy.
    templates: Optional[list[str]] = None
    follow_up_after_days: Optional[int] = None
    follow_up_templates: Optional[list[str]] = None


class WarmupGroupsRequest(BaseModel):
    """Replace the list of warm-up group URLs."""

    urls: list[str]


class SignupStartRequest(BaseModel):
    """Kick off a web-based account signup (step 1 of 3)."""

    phone: str
    label: Optional[str] = ""
    proxy: Optional[ProxyConfig] = None
    api_id: Optional[int] = None
    api_hash: Optional[str] = None


class SignupCodeRequest(BaseModel):
    """Submit the SMS code (step 2 of 3)."""

    signup_token: str
    code: str


class SignupPasswordRequest(BaseModel):
    """Submit the 2FA cloud password (step 3, only if Telegram prompts)."""

    signup_token: str
    password: str
