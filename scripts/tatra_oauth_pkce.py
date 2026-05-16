#!/usr/bin/env python3
"""
Jednorazový OAuth2 Authorization Code + PKCE podľa TB Swaggeru
docs/tatra-authorization-oauth-2.0.0.yaml (/authorize vyžaduje code_challenge + S256).

1) Vygeneruj URL a otvor v prehliadači:
   python scripts/tatra_oauth_pkce.py authorize \\
     --client-id ID --redirect-uri 'https://...' --scope PREMIUM_AIS

2) Po redirecte z banky vymeň code za tokeny (query parametre podľa Swaggeru /token):
   python scripts/tatra_oauth_pkce.py exchange \\
     --code '...' --verifier-file .tatra_code_verifier.txt \\
     --client-id ID --client-secret SECRET --redirect-uri 'https://...'

Výstup: access_token, refresh_token (ulož refresh do GitHub Secret TATRA_REFRESH_TOKEN).

Redirect URI: HTTPS stránka pod tvojou kontrolou, napr. GitHub Pages z docs/:
  docs/tatra-oauth-callback/index.html → .../tatra-oauth-callback/
Scope musí byť v dev portáli zaregistrovaný (často PREMIUM_AIS pre účty).
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import secrets
import sys
import urllib.parse
from pathlib import Path

import httpx

OAUTH_BASE = {
    "production": "https://api.tatrabanka.sk/premium/production/auth/oauth/v2",
    "sandbox": "https://api.tatrabanka.sk/premium/sandbox/auth/oauth/v2",
}


def _pkce_pair() -> tuple[str, str]:
    """RFC 7636: verifier + S256 challenge (base64url)."""
    verifier_bytes = secrets.token_bytes(32)
    verifier = base64.urlsafe_b64encode(verifier_bytes).decode("ascii").rstrip("=")
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    challenge = base64.urlsafe_b64encode(digest).decode("ascii").rstrip("=")
    return verifier, challenge


def cmd_authorize(args: argparse.Namespace) -> int:
    verifier, challenge = _pkce_pair()
    vf = Path(args.verifier_file)
    vf.write_text(verifier, encoding="utf-8")
    print(f"Uložený code_verifier → {vf.resolve()} (NIKDE necommituj; potrebný pri exchange.)")

    base = OAUTH_BASE[args.env]
    q = {
        "client_id": args.client_id,
        "response_type": "code",
        "redirect_uri": args.redirect_uri,
        "scope": args.scope,
        "state": secrets.token_urlsafe(24),
        "code_challenge": challenge,
        "code_challenge_method": "S256",
    }
    url = f"{base}/authorize?{urllib.parse.urlencode(q)}"
    print("\nOtvor v prehliadači:\n")
    print(url)
    print("\nPo prihlásení skopíruj z redirect URL parameter `code` a spusti `exchange`.")
    return 0


def _parse_token_body(text: str, content_type: str) -> dict:
    text = text.strip()
    if not text:
        return {}
    ct = (content_type or "").lower()
    if "json" in ct or text.startswith("{"):
        return json.loads(text)
    # Swagger uvádza aj application/x-www-form-urlencoded
    parsed = urllib.parse.parse_qs(text, keep_blank_values=True)
    return {k: v[0] if len(v) == 1 else v for k, v in parsed.items()}


def cmd_exchange(args: argparse.Namespace) -> int:
    verifier = Path(args.verifier_file).read_text(encoding="utf-8").strip()
    if not verifier:
        print("Prázdny verifier súbor.", file=sys.stderr)
        return 1

    base = OAUTH_BASE[args.env]
    token_url = f"{base}/token"

    raw = f"{args.client_id}:{args.client_secret}".encode()
    auth = base64.b64encode(raw).decode("ascii")

    # TB Swagger: parametre /token sú v query (nie v tele)
    params = {
        "grant_type": "authorization_code",
        "code": args.code,
        "redirect_uri": args.redirect_uri,
        "code_verifier": verifier,
    }

    resp = httpx.post(
        token_url,
        params=params,
        headers={
            "Authorization": f"Basic {auth}",
            "Accept": "application/json, application/x-www-form-urlencoded;q=0.9",
        },
        timeout=60.0,
    )
    data = _parse_token_body(resp.text, resp.headers.get("content-type", ""))
    if resp.status_code >= 400:
        print(resp.status_code, resp.text[:2000], file=sys.stderr)
        if isinstance(data, dict) and data:
            print(json.dumps(data, indent=2), file=sys.stderr)
        return 1

    print(json.dumps(data, indent=2, ensure_ascii=False))
    rt = data.get("refresh_token")
    if rt:
        print(
            "\n→ Ulož do GitHub Secret TATRA_REFRESH_TOKEN (a .env), potom sync_tatra.py.",
            file=sys.stderr,
        )
    return 0


def main() -> int:
    p = argparse.ArgumentParser(description="Tatra OAuth2 authorize URL (PKCE) + token exchange")
    sub = p.add_subparsers(dest="cmd", required=True)

    a = sub.add_parser("authorize", help="Vygeneruj /authorize URL + PKCE verifier súbor")
    a.add_argument("--env", choices=("production", "sandbox"), default="production")
    a.add_argument("--client-id", required=True)
    a.add_argument("--redirect-uri", required=True, help="Presne ako Redirect URL v dev portáli")
    a.add_argument(
        "--scope",
        default="PREMIUM_AIS",
        help="Podľa registrácie aplikácie (Swagger enum, často PREMIUM_AIS)",
    )
    a.add_argument(
        "--verifier-file",
        default=".tatra_code_verifier.txt",
        help="Sem sa uloží code_verifier pre krok exchange",
    )
    a.set_defaults(func=cmd_authorize)

    e = sub.add_parser("exchange", help="Vymeň authorization code za tokeny")
    e.add_argument("--env", choices=("production", "sandbox"), default="production")
    e.add_argument("--code", required=True)
    e.add_argument("--client-id", required=True)
    e.add_argument("--client-secret", required=True)
    e.add_argument("--redirect-uri", required=True)
    e.add_argument("--verifier-file", default=".tatra_code_verifier.txt")
    e.set_defaults(func=cmd_exchange)

    args = p.parse_args()
    return int(args.func(args))


if __name__ == "__main__":
    raise SystemExit(main())
