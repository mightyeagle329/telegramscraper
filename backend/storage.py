import json
import os
import logging
from typing import Any

logger = logging.getLogger(__name__)

GROUPS_FILE = "groups.json"


def load_groups() -> dict[str, Any]:
    """Load groups from the persistent JSON file."""
    if not os.path.exists(GROUPS_FILE):
        return {}
    try:
        with open(GROUPS_FILE, "r") as f:
            data = json.load(f)
            if isinstance(data, dict):
                return data
            return {}
    except (json.JSONDecodeError, IOError) as e:
        logger.warning(f"Could not load groups file: {e}")
        return {}


def save_groups(groups: dict[str, Any]) -> None:
    """Save groups to the persistent JSON file."""
    try:
        with open(GROUPS_FILE, "w") as f:
            json.dump(groups, f, indent=2, default=str)
    except IOError as e:
        logger.error(f"Could not save groups file: {e}")
