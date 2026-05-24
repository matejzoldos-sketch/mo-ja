#!/usr/bin/env python3
"""
Tatra banka Premium API (Účty / AIS) → Supabase tatra_transactions + tatra_account_balances
(display_iban z API alebo zachované z DB pre ručný popis účtu).

Client credentials (návod TB): POST /token, application/x-www-form-urlencoded,
povinné polia client_id, client_secret, grant_type=client_credentials, scope=PREMIUM_AIS.
Predvolený scope je PREMIUM_AIS; override cez TATRA_OAUTH_SCOPE.

Refresh token (authorization code + PKCE): grant refresh_token s HTTP Basic klientom,
telom grant_type + refresh_token — pozri scripts/tatra_oauth_pkce.py.

Env (.env alebo GitHub Secrets):
  SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY
  TATRA_CLIENT_ID
  TATRA_CLIENT_SECRET
  TATRA_ENV                    # sandbox | production (default sandbox)

Voliteľné:
  TATRA_REFRESH_TOKEN          # ak nastavený, auto použije refresh_token namiesto CC
  TATRA_OAUTH_GRANT            # auto | refresh_token | client_credentials
  TATRA_OAUTH_CLIENT_AUTH      # len pre refresh_token: basic (default) | body
  TATRA_OAUTH_BASE
  TATRA_PREMIUM_API_ROOT
  TATRA_ACCOUNTS_API_BASE
  TATRA_OAUTH_SCOPE            # default PREMIUM_AIS pri client_credentials
  TATRA_API_HEADER_NAME / TATRA_API_HEADER_VALUE  # napr. FAC BBTB podľa Swaggeru Účty
  TATRA_TX_MAX_PAGES          # max stránok pohybov na účet (default 250), ak API stránuje cez _links.next
  TATRA_TX_DATE_FROM_MIN      # YYYY-MM-DD — booking_date nebude starší (max. z --days a tejto dátumy)

Usage:
  python sync_tatra.py --days 30
  python sync_tatra.py --days 7 --dry-run
  python sync_tatra.py --days 120 --date-from 2026-01-01
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import logging
import os
import re
import sys
import uuid
import warnings
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List, Optional
from urllib.parse import quote, urljoin

import httpx
from dotenv import load_dotenv

try:
    from urllib3.exceptions import NotOpenSSLWarning

    warnings.filterwarnings("ignore", category=NotOpenSSLWarning)
except ImportError:
    pass

from supabase import create_client

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("httpcore").setLevel(logging.WARNING)
log = logging.getLogger("sync_tatra")


def utc_now_iso_timestamptz() -> str:
    """Pri každom upserte — inak PG pri UPDATE neobnoví DEFAULT now() a dashboard ukazuje starý čas."""
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _parse_iso_date_arg(raw: str, flag: str) -> Optional[date]:
    s = (raw or "").strip()
    if not s:
        return None
    try:
        return date.fromisoformat(s[:10])
    except ValueError:
        log.error("Neplatný dátum %s=%r (očakuj YYYY-MM-DD).", flag, raw)
        raise SystemExit(1) from None


def _tx_date_from_floor() -> Optional[date]:
    raw = os.environ.get("TATRA_TX_DATE_FROM_MIN", "").strip()
    if not raw:
        return None
    try:
        return date.fromisoformat(raw[:10])
    except ValueError:
        log.warning("Ignorujem TATRA_TX_DATE_FROM_MIN=%r (nie YYYY-MM-DD).", raw)
        return None

# Jednoznačná značka v logu (GitHub Actions), aby bolo jasné, ktorá verzia skriptu beží.
SYNC_TATRA_BUILD = "require-refresh-preflight-20260521"

# ---------------------------------------------------------------------------
# Defaults (Tatra dokumentácia – presné cesty tokenu doplň zo Swaggeru OAuth)
# ---------------------------------------------------------------------------

OAUTH_SANDBOX = "https://api.tatrabanka.sk/premium/sandbox/auth/oauth/v2"
OAUTH_PRODUCTION = "https://api.tatrabanka.sk/premium/production/auth/oauth/v2"

PREMIUM_SANDBOX = "https://api.tatrabanka.sk/premium/sandbox"
PREMIUM_PRODUCTION = "https://api.tatrabanka.sk/premium/production"

ACCOUNTS_SANDBOX = f"{PREMIUM_SANDBOX}/v3/accounts"
ACCOUNTS_PRODUCTION = f"{PREMIUM_PRODUCTION}/v3/accounts"

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_SERVICE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
TATRA_CLIENT_ID = os.environ["TATRA_CLIENT_ID"]
TATRA_CLIENT_SECRET = os.environ["TATRA_CLIENT_SECRET"]
TATRA_REFRESH_TOKEN = os.environ.get("TATRA_REFRESH_TOKEN", "").strip()
TATRA_OAUTH_GRANT_RAW = os.environ.get("TATRA_OAUTH_GRANT", "auto").strip().lower()
TATRA_OAUTH_CLIENT_AUTH = os.environ.get("TATRA_OAUTH_CLIENT_AUTH", "basic").strip().lower()
TATRA_OAUTH_SCOPE = os.environ.get("TATRA_OAUTH_SCOPE", "PREMIUM_AIS").strip()
TATRA_ENV = os.environ.get("TATRA_ENV", "sandbox").strip().lower()
TATRA_API_HEADER_NAME = os.environ.get("TATRA_API_HEADER_NAME", "").strip()
TATRA_API_HEADER_VALUE = os.environ.get("TATRA_API_HEADER_VALUE", "").strip()
TATRA_TX_MAX_PAGES = max(1, int(os.environ.get("TATRA_TX_MAX_PAGES", "250")))

_http = httpx.Client(timeout=60.0, follow_redirects=True)


def _oauth_base() -> str:
    if os.environ.get("TATRA_OAUTH_BASE"):
        return os.environ["TATRA_OAUTH_BASE"].rstrip("/")
    return OAUTH_SANDBOX if TATRA_ENV != "production" else OAUTH_PRODUCTION


def _premium_api_root() -> str:
    if os.environ.get("TATRA_PREMIUM_API_ROOT"):
        return os.environ["TATRA_PREMIUM_API_ROOT"].rstrip("/")
    return PREMIUM_SANDBOX if TATRA_ENV != "production" else PREMIUM_PRODUCTION


def _accounts_api_base() -> str:
    if os.environ.get("TATRA_ACCOUNTS_API_BASE"):
        return os.environ["TATRA_ACCOUNTS_API_BASE"].rstrip("/")
    return ACCOUNTS_SANDBOX if TATRA_ENV != "production" else ACCOUNTS_PRODUCTION


def _default_headers(access_token: str) -> Dict[str, str]:
    h: Dict[str, str] = {
        "Authorization": f"Bearer {access_token}",
        "Accept": "application/json",
        "X-Request-ID": str(uuid.uuid4()),
    }
    if TATRA_API_HEADER_NAME and TATRA_API_HEADER_VALUE:
        h[TATRA_API_HEADER_NAME] = TATRA_API_HEADER_VALUE
    return h


def _oauth_grant_effective() -> str:
    if TATRA_OAUTH_GRANT_RAW in ("", "auto"):
        return "refresh_token" if TATRA_REFRESH_TOKEN else "client_credentials"
    return TATRA_OAUTH_GRANT_RAW


def _client_id_hint() -> str:
    """Posledné znaky client_id — na porovnanie s appkou v Tatra portáli / ZITA."""
    cid = (TATRA_CLIENT_ID or "").strip()
    if len(cid) <= 8:
        return "(prázdne alebo príliš krátke)"
    return f"…{cid[-8:]}"


def _require_refresh_token_configured() -> None:
    """V CI nastav TATRA_REQUIRE_REFRESH_TOKEN=1 — client_credentials bez súhlasu AIS zlyhá."""
    raw = os.environ.get("TATRA_REQUIRE_REFRESH_TOKEN", "").strip().lower()
    if raw not in ("1", "true", "yes"):
        return
    if TATRA_REFRESH_TOKEN:
        return
    log.error(
        "TATRA_REQUIRE_REFRESH_TOKEN=1, ale TATRA_REFRESH_TOKEN chýba. "
        "AIS (GET /v3/accounts) vyžaduje OAuth súhlas — pozri scripts/tatra_oauth_pkce.py "
        "a docs/tatra-oauth-callback/. Ulož refresh_token do GitHub Secret TATRA_REFRESH_TOKEN. "
        "Ak používaš rovnakú appku ako ZITA dashboard, skopíruj ten istý secret (client_id musí sedieť: %s).",
        _client_id_hint(),
    )
    sys.exit(1)


def _basic_auth_header() -> Dict[str, str]:
    raw = f"{TATRA_CLIENT_ID}:{TATRA_CLIENT_SECRET}".encode()
    return {"Authorization": f"Basic {base64.b64encode(raw).decode('ascii')}"}


def _post_token(form: Dict[str, str]) -> str:
    token_url = f"{_oauth_base()}/token"
    headers: Dict[str, str] = {
        "Accept": "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
    }
    data = dict(form)
    if TATRA_OAUTH_CLIENT_AUTH == "body":
        data["client_id"] = TATRA_CLIENT_ID
        data["client_secret"] = TATRA_CLIENT_SECRET
    elif TATRA_OAUTH_CLIENT_AUTH == "basic":
        headers.update(_basic_auth_header())
    else:
        raise ValueError(
            f"TATRA_OAUTH_CLIENT_AUTH must be basic or body, got {TATRA_OAUTH_CLIENT_AUTH!r}"
        )

    resp = _http.post(token_url, data=data, headers=headers)
    if resp.status_code >= 400:
        log.error("Token request failed %s: %s", resp.status_code, resp.text[:800])
    resp.raise_for_status()
    body = resp.json()
    token = body.get("access_token")
    if not token:
        raise RuntimeError(f"No access_token in token response: {list(body.keys())}")
    return str(token)


def fetch_access_token_client_credentials() -> str:
    """
    OAuth2 client_credentials podľa TB návodu (telo, nie Basic):
    client_id, client_secret, grant_type, scope (povinné PREMIUM_AIS).
    """
    scope = TATRA_OAUTH_SCOPE or "PREMIUM_AIS"
    token_url = f"{_oauth_base()}/token"
    data = {
        "client_id": TATRA_CLIENT_ID,
        "client_secret": TATRA_CLIENT_SECRET,
        "grant_type": "client_credentials",
        "scope": scope,
    }
    resp = _http.post(
        token_url,
        data=data,
        headers={
            "Accept": "application/json",
            "Content-Type": "application/x-www-form-urlencoded",
        },
    )
    if resp.status_code >= 400:
        log.error("Token (client_credentials) failed %s: %s", resp.status_code, resp.text[:800])
    resp.raise_for_status()
    body = resp.json()
    token = body.get("access_token")
    if not token:
        raise RuntimeError(f"No access_token in token response: {list(body.keys())}")
    return str(token)


def fetch_access_token_refresh_grant() -> str:
    """OAuth2 refresh_token — telo len grant + refresh_token; klient cez Basic (TB vzor)."""
    return _post_token(
        {
            "grant_type": "refresh_token",
            "refresh_token": TATRA_REFRESH_TOKEN,
        }
    )


def fetch_accounts(access_token: str) -> List[dict]:
    """
    Zoznam účtov. Cesta môže byť GET na bázu alebo GET / … – uprav pod Swagger AIS 3.2.1.
    """
    url = _accounts_api_base()
    resp = _http.get(url, headers=_default_headers(access_token))
    if resp.status_code >= 400:
        log.error("Accounts request failed %s: %s", resp.status_code, resp.text[:500])
        if resp.status_code == 403:
            try:
                err = resp.json()
                if err.get("errorCode") == "NO_CONTRACT":
                    log.error(
                        "NO_CONTRACT: Tatra nenašla platnú zmluvu / prepojenie k tejto aplikácii. "
                        "Over zmluvu Premium API v banke, stav aplikácie v dev portáli a pri FAC_BBTB "
                        "aktívny súhlas v Business banking. Podpora: developer@tatrabanka.sk."
                    )
                elif err.get("errorCode") == "NO_AUTHORIZATION":
                    grant = _oauth_grant_effective()
                    log.error(
                        "NO_AUTHORIZATION: Token OK, ale banka nemá platný súhlas AIS pre client_id %s "
                        "(grant=%s). Typické príčiny: (1) chýba TATRA_REFRESH_TOKEN — jednorazovo "
                        "scripts/tatra_oauth_pkce.py authorize + exchange; (2) iný Client ID ako appka "
                        "schválená v Business banking / ZITA; (3) súhlas FAC_BBTB neaktívny v TB Business. "
                        "Podpora: developer@tatrabanka.sk.",
                        _client_id_hint(),
                        grant,
                    )
            except Exception:
                pass
        resp.raise_for_status()
    data = resp.json()
    # Berlin Group často: { "accounts": [ ... ] }
    accounts = data.get("accounts")
    if accounts is None and isinstance(data, list):
        accounts = data
    if not isinstance(accounts, list):
        log.warning(
            "Unexpected accounts JSON shape; keys=%s. Uprav fetch_accounts() podľa Swaggeru.",
            list(data.keys()) if isinstance(data, dict) else type(data),
        )
        return []
    return accounts


def _account_resource_id_for_api(acc: dict) -> Optional[str]:
    """Rovnaký identifikátor ako pri GET …/v5/accounts/{id}/transactions."""
    rid = acc.get("resourceId") or acc.get("iban") or acc.get("accountId")
    if rid:
        return str(rid).strip()
    nested = acc.get("account")
    if isinstance(nested, dict):
        rid = nested.get("resourceId") or nested.get("iban") or nested.get("accountId")
        if rid:
            return str(rid).strip()
    return None


def _account_storage_key(acc: dict) -> str:
    """Kľúč účtu v Supabase (tatra_transactions.account_iban, tatra_account_balances PK)."""
    rid = _account_resource_id_for_api(acc)
    return rid if rid else "unknown"


def _iban_from_account_json(account: dict) -> Optional[str]:
    """IBAN z odpovede AIS (ak banka pošle); inak None."""
    iban = account.get("iban")
    if isinstance(iban, str) and iban.strip():
        return iban.strip().upper()[:42]
    nested = account.get("account")
    if isinstance(nested, dict):
        ib = nested.get("iban")
        if isinstance(ib, str) and ib.strip():
            return ib.strip().upper()[:42]
    bban = account.get("bban")
    if isinstance(bban, str) and bban.strip():
        return bban.strip()[:34]
    return None


def enrich_balance_rows_preserve_manual_fields(client: Any, rows: List[dict]) -> None:
    """Zachovaj z DB display_iban a referenčný zostatok z BB (API ich neposiela)."""
    for row in rows:
        key = row.get("account_iban")
        if not key:
            continue
        try:
            r = (
                client.table("tatra_account_balances")
                .select("display_iban", "ref_balance_as_of", "ref_balance_amount")
                .eq("account_iban", key)
                .limit(1)
                .execute()
            )
            if not r.data:
                continue
            prev = r.data[0]
            if not row.get("display_iban"):
                d = prev.get("display_iban")
                if isinstance(d, str) and d.strip():
                    row["display_iban"] = d.strip()
            if prev.get("ref_balance_amount") is not None:
                row["ref_balance_as_of"] = prev.get("ref_balance_as_of")
                row["ref_balance_amount"] = prev.get("ref_balance_amount")
        except Exception as e:
            log.debug("preserve manual balance fields %s: %s", key, e)


def fetch_account_detail(access_token: str, resource_id: str) -> Optional[dict]:
    """
    Detail účtu (často obsahuje balances[]). Zoznam GET /v3/accounts ich často nevracia.
    TB: GET /v5/accounts/{account-id}
    """
    enc = quote(str(resource_id), safe="-_.~")
    url = f"{_premium_api_root()}/v5/accounts/{enc}"
    try:
        resp = _http.get(url, headers=_default_headers(access_token))
    except httpx.RequestError as e:
        log.warning("Account detail sieťová chyba pre %s: %s", resource_id, e)
        return None
    if resp.status_code == 404:
        log.warning("Account detail 404 pre %s — skontroluj cestu vo fetch_account_detail()", resource_id)
        return None
    if resp.status_code >= 400:
        log.warning(
            "Account detail HTTP %s pre %s: %s",
            resp.status_code,
            resource_id,
            resp.text[:400],
        )
        return None
    data = resp.json()
    if not isinstance(data, dict):
        return None
    nested = data.get("account")
    if isinstance(nested, dict):
        return nested
    if isinstance(data.get("balances"), list) or data.get("resourceId") or data.get("iban"):
        return data
    accs = data.get("accounts")
    if isinstance(accs, list) and accs and isinstance(accs[0], dict):
        return accs[0]
    return None


_BALANCE_TYPE_ORDER = (
    "interimavailable",
    "forwardavailable",
    "expected",
    "closingbooked",
    "interimbooked",
)


def _normalize_balance_type_key(raw: Any) -> str:
    s = re.sub(r"[^a-z]", "", str(raw or "").lower())
    return s


def _pick_balance_entry(balances: List[Any]) -> Optional[dict]:
    dicts = [b for b in balances if isinstance(b, dict)]
    if not dicts:
        return None
    by_norm: Dict[str, dict] = {}
    for b in dicts:
        k = _normalize_balance_type_key(b.get("balanceType"))
        if k and k not in by_norm:
            by_norm[k] = b
    for pref in _BALANCE_TYPE_ORDER:
        if pref in by_norm:
            return by_norm[pref]
    return dicts[0]


def extract_balance_row(account: dict) -> Optional[dict]:
    """Berlin Group: pole balances[] → jeden riadok pre upsert tatra_account_balances."""
    storage_key = _account_storage_key(account)
    if storage_key == "unknown":
        return None
    balances = account.get("balances")
    if not isinstance(balances, list) or not balances:
        return None
    chosen = _pick_balance_entry(balances)
    if chosen is None:
        return None
    amt_obj = chosen.get("balanceAmount") or chosen.get("amount") or {}
    if not isinstance(amt_obj, dict):
        amt_obj = {}
    amount_raw = amt_obj.get("amount")
    try:
        balance = float(amount_raw) if amount_raw is not None else None
    except (TypeError, ValueError):
        balance = None
    if balance is None:
        return None
    currency = str(amt_obj.get("currency") or "EUR")[:8]
    ref = chosen.get("referenceDate")
    ref_date = str(ref)[:10] if ref else None
    bt = chosen.get("balanceType")
    resource_id = _account_resource_id_for_api(account)
    row: Dict[str, Any] = {
        "account_iban": storage_key,
        "resource_id": resource_id,
        "balance": balance,
        "currency": currency,
        "balance_type": str(bt)[:64] if bt else None,
        "reference_date": ref_date,
        "raw_balances": balances,
    }
    disp = _iban_from_account_json(account)
    if disp:
        row["display_iban"] = disp
    return row


def _touch_balances_fetched_at(client: Any, account_ibans: List[str], ts: str) -> None:
    """Samostatný UPDATE — upsert cez PostgREST občas neprepíše fetched_at pri konflikte."""
    if not account_ibans:
        return
    uniq = list(dict.fromkeys(ib for ib in account_ibans if ib))
    for i in range(0, len(uniq), 100):
        part = uniq[i : i + 100]
        client.table("tatra_account_balances").update({"fetched_at": ts}).in_("account_iban", part).execute()


def _touch_transactions_fetched_at(client: Any, external_ids: List[str], ts: str) -> None:
    if not external_ids:
        return
    uniq = list(dict.fromkeys(e for e in external_ids if e))
    for i in range(0, len(uniq), 200):
        part = uniq[i : i + 200]
        client.table("tatra_transactions").update({"fetched_at": ts}).in_("external_id", part).execute()


def upsert_account_balances(client: Any, rows: List[dict], dry_run: bool) -> int:
    if dry_run:
        log.info("Dry-run: would upsert %d balance rows", len(rows))
        return len(rows)
    if not rows:
        return 0
    assert client is not None
    ts = utc_now_iso_timestamptz()
    for row in rows:
        row["fetched_at"] = ts
    client.table("tatra_account_balances").upsert(rows, on_conflict="account_iban").execute()
    _touch_balances_fetched_at(client, [str(r["account_iban"]) for r in rows if r.get("account_iban")], ts)
    return len(rows)


def _parse_transactions_page(data: Any) -> List[dict]:
    """Jedna stránka JSON odpovede → zoznam transakčných dictov."""
    if not isinstance(data, dict):
        return []
    tx_root = data.get("transactions")
    if isinstance(tx_root, list):
        return [x for x in tx_root if isinstance(x, dict)]
    if isinstance(tx_root, dict):
        booked = tx_root.get("booked") or []
        pending = tx_root.get("pending") or []
        if isinstance(booked, list) and isinstance(pending, list):
            out = [x for x in booked + pending if isinstance(x, dict)]
            return out
    if isinstance(data.get("booked"), list):
        return [x for x in data["booked"] if isinstance(x, dict)]
    txs = data.get("transactionList") or data.get("transactions")
    if isinstance(txs, list):
        return [x for x in txs if isinstance(x, dict)]
    return []


def _next_transactions_href(data: Any, resp: httpx.Response) -> Optional[str]:
    """Berlin Group: _links.next.href alebo Link: ...; rel=\"next\"."""
    if isinstance(data, dict):
        for container in (
            data,
            data.get("transactions") if isinstance(data.get("transactions"), dict) else None,
        ):
            if not isinstance(container, dict):
                continue
            for lk in ("_links", "links"):
                nxt = container.get(lk, {}).get("next")
                if isinstance(nxt, dict):
                    h = nxt.get("href")
                    if isinstance(h, str) and h.strip():
                        return h.strip()
                elif isinstance(nxt, str) and nxt.strip():
                    return nxt.strip()
    raw = resp.headers.get("Link") or resp.headers.get("link")
    if raw:
        for part in raw.split(","):
            if 'rel="next"' in part or "rel=next" in part:
                m = re.search(r"<([^>]+)>", part.strip())
                if m:
                    return m.group(1).strip()
    return None


def fetch_transactions_for_account(
    access_token: str,
    account: dict,
    date_from: date,
    date_to: date,
) -> List[dict]:
    """
    Pohyby pre jeden účet. Doplň resourceId / cestu a query parametre podľa Swaggeru
    (napr. /accounts/{id}/transactions?dateFrom=&dateTo=).
    Sleduje stránkovanie (_links.next / Link header), aby sa nestratili staršie dni.
    """
    resource_id = _account_resource_id_for_api(account)
    if not resource_id:
        log.warning(
            "Account without resourceId/iban (vrátane vnoreného account{}), skip: %s",
            list(account.keys())[:12],
        )
        return []

    # TB: GET /v5/accounts/{account-id}/transactions (Business banking + Premium API Účty)
    root = _premium_api_root()
    enc_rid = quote(str(resource_id), safe="-_.~")
    first_url = f"{root}/v5/accounts/{enc_rid}/transactions"
    params = {
        "dateFrom": date_from.isoformat(),
        "dateTo": date_to.isoformat(),
    }

    all_tx: List[dict] = []
    next_url: Optional[str] = None
    prev_request_url: Optional[str] = None
    page = 0

    while page < TATRA_TX_MAX_PAGES:
        if next_url:
            if next_url == prev_request_url:
                log.warning("Transactions: next URL repeats, stop pagination for %s", resource_id)
                break
            resp = _http.get(next_url, headers=_default_headers(access_token))
        else:
            resp = _http.get(
                first_url, headers=_default_headers(access_token), params=params
            )
        if resp.status_code == 404:
            log.warning(
                "Transactions 404 for %s — skontroluj cestu v fetch_transactions_for_account()",
                resource_id,
            )
            break
        resp.raise_for_status()
        prev_request_url = str(resp.request.url)
        data = resp.json()
        batch = _parse_transactions_page(data)
        all_tx.extend(batch)
        page += 1

        href = _next_transactions_href(data, resp)
        if not href:
            if page == 1 and not batch:
                log.warning(
                    "Unexpected transactions shape; keys=%s",
                    list(data.keys()) if isinstance(data, dict) else type(data),
                )
            break
        next_url = urljoin(str(resp.request.url), href)
        if page <= 3 or page % 10 == 0:
            log.info(
                "  %s transactions page %d: +%d (total %d)",
                resource_id,
                page,
                len(batch),
                len(all_tx),
            )

    if page >= TATRA_TX_MAX_PAGES:
        log.warning(
            "Transactions: hit TATRA_TX_MAX_PAGES=%d for %s — raise env if needed",
            TATRA_TX_MAX_PAGES,
            resource_id,
        )
    return all_tx


def _fallback_external_id(account_iban: str, txn: dict) -> str:
    raw = json.dumps(txn, sort_keys=True, default=str)
    digest = hashlib.sha256(f"{account_iban}|{raw}".encode()).hexdigest()[:40]
    return f"sha256:{digest}"


def map_transaction(account_iban: str, txn: dict) -> dict:
    """
    Mapovanie Berlin Group–like JSON na stĺpce. Uprav podľa reálnej odpovede TB.
    """
    tid = (
        txn.get("transactionId")
        or txn.get("entryReference")
        or txn.get("mandateId")
    )
    external_id = str(tid) if tid else _fallback_external_id(account_iban, txn)

    amt_obj = txn.get("transactionAmount") or txn.get("amount") or {}
    if isinstance(amt_obj, dict):
        amount_raw = amt_obj.get("amount")
        currency = amt_obj.get("currency") or "EUR"
    else:
        amount_raw = amt_obj
        currency = txn.get("currency") or "EUR"

    try:
        amount = float(amount_raw) if amount_raw is not None else None
    except (TypeError, ValueError):
        amount = None

    booking = txn.get("bookingDate") or txn.get("bookingDateTime")
    value_d = txn.get("valueDate") or txn.get("valueDateTime")
    booking_date = str(booking)[:10] if booking else None
    value_date = str(value_d)[:10] if value_d else None

    creditor = txn.get("creditorName") or txn.get("creditor", {}).get("name")
    debtor = txn.get("debtorName") or txn.get("debtor", {}).get("name")
    creditor_iban = txn.get("creditorAccount", {}).get("iban") if isinstance(
        txn.get("creditorAccount"), dict
    ) else txn.get("creditorIban")
    debtor_iban = txn.get("debtorAccount", {}).get("iban") if isinstance(
        txn.get("debtorAccount"), dict
    ) else txn.get("debtorIban")

    remittance = txn.get("remittanceInformationUnstructured")
    if remittance is None and isinstance(txn.get("remittanceInformationStructured"), dict):
        remittance = json.dumps(txn["remittanceInformationStructured"], default=str)

    return {
        "external_id": external_id,
        "account_iban": account_iban,
        "booking_date": booking_date,
        "value_date": value_date,
        "amount": amount,
        "currency": str(currency)[:8] if currency else "EUR",
        "creditor_name": creditor,
        "debtor_name": debtor,
        "creditor_iban": creditor_iban,
        "debtor_iban": debtor_iban,
        "remittance_info": remittance,
        # JSON objekt pre stĺpec jsonb (nie json.dumps — inak je v PG skalár „string“ a ->>'kľúč' je NULL).
        "raw_json": json.loads(json.dumps(txn, default=str)),
    }


def upsert_transactions(client: Any, rows: List[dict], dry_run: bool) -> int:
    if dry_run:
        log.info("Dry-run: would upsert %d rows", len(rows))
        return len(rows)
    batch = 100
    n = 0
    ts = utc_now_iso_timestamptz()
    for i in range(0, len(rows), batch):
        part = rows[i : i + batch]
        for row in part:
            row["fetched_at"] = ts
        client.table("tatra_transactions").upsert(part, on_conflict="external_id").execute()
        n += len(part)
    _touch_transactions_fetched_at(
        client, [str(r["external_id"]) for r in rows if r.get("external_id")], ts
    )
    return n


def main() -> None:
    parser = argparse.ArgumentParser(description="Tatra AIS → Supabase tatra_transactions")
    parser.add_argument(
        "--days",
        type=int,
        default=30,
        help="Siahnuť booking dátumy od today-days .. today",
    )
    parser.add_argument(
        "--date-from",
        type=str,
        default="",
        help="Min. booking_date YYYY-MM-DD (prepíše začiatok z --days, ak by bol skorší)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Nestoreovať do Supabase, len log",
    )
    args = parser.parse_args()

    log.info("sync_tatra build=%s", SYNC_TATRA_BUILD)

    _require_refresh_token_configured()

    grant = _oauth_grant_effective()
    if grant == "refresh_token":
        if not TATRA_REFRESH_TOKEN:
            log.error(
                "Grant refresh_token vyžaduje TATRA_REFRESH_TOKEN (.env / GitHub Secret). "
                "Získaš ho výmenou authorization_code podľa OAuth Swaggeru (jednorazovo)."
            )
            sys.exit(1)
    elif grant != "client_credentials":
        log.error(
            "Neznámy grant %r. Použi TATRA_OAUTH_GRANT=auto|refresh_token|client_credentials.",
            grant,
        )
        sys.exit(1)

    date_to = date.today()
    date_from = date_to - timedelta(days=max(1, args.days))
    floor_cli = _parse_iso_date_arg(args.date_from, "--date-from") if args.date_from.strip() else None
    floor_env = _tx_date_from_floor()
    _floors = [d for d in (floor_cli, floor_env) if d is not None]
    floor = max(_floors) if _floors else None
    if floor is not None and date_from < floor:
        log.info("Obmedzenie booking: date_from %s → %s (--date-from alebo TATRA_TX_DATE_FROM_MIN)", date_from, floor)
        date_from = floor

    rt_status = (
        f"nastavený (dĺžka {len(TATRA_REFRESH_TOKEN)})"
        if TATRA_REFRESH_TOKEN
        else "CHÝBA — sync použije client_credentials (AIS /accounts často vráti NO_AUTHORIZATION)"
    )
    log.info(
        "Tatra env=%s, client_id=%s, TATRA_REFRESH_TOKEN=%s, grant=%s (raw=%s), "
        "oauth_scope=%s, refresh_auth=%s, accounts=%s, api root=%s",
        TATRA_ENV,
        _client_id_hint(),
        rt_status,
        grant,
        TATRA_OAUTH_GRANT_RAW or "auto",
        TATRA_OAUTH_SCOPE,
        TATRA_OAUTH_CLIENT_AUTH if grant == "refresh_token" else "tb_form_body",
        _accounts_api_base(),
        _premium_api_root(),
    )
    if grant == "client_credentials":
        log.warning(
            "Grant client_credentials: token získaš, ale AIS účty vyžadujú OAuth refresh_token "
            "(alebo aktívny súhlas FAC_BBTB v Business banking pre tento client_id). "
            "Pozri README → Tatra banka sync."
        )
    log.info("Date range %s → %s", date_from, date_to)

    if grant == "refresh_token":
        access_token = fetch_access_token_refresh_grant()
        log.info("Access token získaný (refresh_token).")
    else:
        access_token = fetch_access_token_client_credentials()
        log.info("Access token získaný (client_credentials).")

    accounts = fetch_accounts(access_token)
    log.info("Účty: %d", len(accounts))

    merged_accounts: List[dict] = []
    balance_rows: List[dict] = []
    for acc in accounts:
        if not isinstance(acc, dict):
            continue
        rid = _account_resource_id_for_api(acc)
        merged = acc
        if rid and not (isinstance(acc.get("balances"), list) and len(acc.get("balances") or []) > 0):
            detail = fetch_account_detail(access_token, rid)
            if detail:
                merged = {**acc, **detail}
                log.info("Účet %s: zostatok z GET /v5/accounts/{id} (zoznam nemal balances[])", rid)
        merged_accounts.append(merged)
        br = extract_balance_row(merged)
        if br:
            balance_rows.append(br)
        else:
            log.warning(
                "Účet bez extrahovateľného zostatku (stále žiadne balances[]): %s",
                _account_storage_key(merged),
            )

    all_rows: List[dict] = []
    for merged in merged_accounts:
        acct_key = _account_storage_key(merged)
        if acct_key == "unknown":
            log.warning(
                "Preskakujem transakcie: stále žiadny resourceId/iban po zlúčení s detailom účtu."
            )
            continue
        try:
            txs = fetch_transactions_for_account(access_token, merged, date_from, date_to)
        except httpx.HTTPStatusError as e:
            log.warning("Transakcie pre %s: %s", acct_key, e)
            continue
        for txn in txs:
            if not isinstance(txn, dict):
                continue
            all_rows.append(map_transaction(acct_key, txn))

    log.info("Spracovaných transakcií: %d", len(all_rows))

    if not args.dry_run:
        client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    else:
        client = None

    if client and balance_rows:
        enrich_balance_rows_preserve_manual_fields(client, balance_rows)
    for row in balance_rows:
        row.setdefault("display_iban", None)
        row.setdefault("ref_balance_as_of", None)
        row.setdefault("ref_balance_amount", None)

    nb = upsert_account_balances(client, balance_rows, args.dry_run)
    log.info("Zostatky účtov: upsert %d.", nb)
    n = upsert_transactions(client, all_rows, args.dry_run)
    log.info("Hotovo, transakcie upsert %d riadkov.", n)


if __name__ == "__main__":
    main()
