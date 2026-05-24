#!/usr/bin/env python3
"""
Rýchla diagnostika Tatra OAuth + GET /v3/accounts (bez zápisu do Supabase).

  python scripts/tatra_check_auth.py

Env: TATRA_CLIENT_ID, TATRA_CLIENT_SECRET, TATRA_ENV=production,
     voliteľne TATRA_REFRESH_TOKEN (odporúčané pre AIS).
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "etl"))

load_dotenv(ROOT / ".env")

from sync_tatra import (  # noqa: E402
    TATRA_CLIENT_ID,
    TATRA_REFRESH_TOKEN,
    _client_id_hint,
    _oauth_grant_effective,
    fetch_access_token_client_credentials,
    fetch_access_token_refresh_grant,
    fetch_accounts,
)


def main() -> int:
    grant = _oauth_grant_effective()
    print(f"client_id hint: {_client_id_hint()}")
    print(f"grant: {grant}")
    print(
        "TATRA_REFRESH_TOKEN:",
        f"set (len={len(TATRA_REFRESH_TOKEN)})" if TATRA_REFRESH_TOKEN else "MISSING",
    )

    if not (TATRA_CLIENT_ID or "").strip():
        print("ERROR: TATRA_CLIENT_ID nie je nastavený.", file=sys.stderr)
        return 1

    if grant == "refresh_token":
        token = fetch_access_token_refresh_grant()
        print("OK: access_token cez refresh_token")
    else:
        token = fetch_access_token_client_credentials()
        print("OK: access_token cez client_credentials (AIS môže stále zlyhať)")

    try:
        accounts = fetch_accounts(token)
    except Exception as e:
        print(f"FAIL: GET /v3/accounts — {e}", file=sys.stderr)
        if not TATRA_REFRESH_TOKEN:
            print(
                "\nTip: nastav TATRA_REFRESH_TOKEN (scripts/tatra_oauth_pkce.py + "
                "docs/tatra-oauth-callback/).",
                file=sys.stderr,
            )
        return 1

    print(f"OK: accounts={len(accounts)}")
    for i, acc in enumerate(accounts[:5]):
        if isinstance(acc, dict):
            rid = acc.get("resourceId") or acc.get("iban") or "?"
            print(f"  [{i}] resourceId/iban={rid}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
