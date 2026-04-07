#!/usr/bin/env python3
"""
Shopify Admin API → Supabase (orders, line items, locations, inventory levels, stock snapshots).

Env:
  SHOPIFY_STORE              — shop handle without .myshopify.com (e.g. yttmhc-p0)
  SHOPIFY_ACCESS_TOKEN       — legacy Admin API token (Develop apps, before 2026-01-01), optional if using OAuth below
  SHOPIFY_CLIENT_ID          — Dev Dashboard app Client ID (with SHOPIFY_CLIENT_SECRET → OAuth client_credentials)
  SHOPIFY_CLIENT_SECRET      — Dev Dashboard app Client secret
  SHOPIFY_API_VERSION        — optional, default 2026-01
  SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY

Auth (2026+): New apps use Dev Dashboard; tokens are obtained via POST /admin/oauth/access_token
(client_credentials). See https://shopify.dev/docs/apps/build/dev-dashboard/get-api-access-tokens
If SHOPIFY_CLIENT_ID and SHOPIFY_CLIENT_SECRET are set, they take precedence over SHOPIFY_ACCESS_TOKEN.

Usage:
  python sync_shopify.py                    # orders created_at YTD (current year) + inventory + locations
  python sync_shopify.py --days 7           # narrower: updated_at ≥ today−days
  python sync_shopify.py --ytd              # orders with created_at >= Jan 1 (current year)
  python sync_shopify.py --from 2026-01-01   # updated_at >= date (YYYY-MM-DD)
  python sync_shopify.py --orders-only
  python sync_shopify.py --inventory-only
"""

from __future__ import annotations

import argparse
import logging
from collections import defaultdict
import os
import re
import sys
import time
import unicodedata
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

import httpx
from dotenv import load_dotenv
from supabase import create_client

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logging.getLogger("httpx").setLevel(logging.WARNING)
log = logging.getLogger("sync_shopify")

# GitHub Actions often sets SHOPIFY_API_VERSION from a missing secret → "".
# os.environ.get("X", "default") still returns "" if X is present but empty.
DEFAULT_API_VERSION_FALLBACK = "2026-01"


def _resolved_api_version() -> str:
    raw = (os.environ.get("SHOPIFY_API_VERSION") or "").strip()
    return raw or DEFAULT_API_VERSION_FALLBACK


ORDERS_PAGE_SIZE = 40
INVENTORY_ITEMS_PAGE_SIZE = 50
UPSERT_CHUNK = 150

# Admin API access tokens from Shopify use several prefixes (not only shpat_).
# See Shopify community / docs on token types; shpss_ appears for some legacy / app setups.
_SHOPIFY_ADMIN_API_PREFIXES: Tuple[str, ...] = (
    "shpat_",
    "shpca_",
    "shpss_",
    "shpua_",
)


def _admin_token_prefix(token: str) -> Optional[str]:
    for p in _SHOPIFY_ADMIN_API_PREFIXES:
        if token.startswith(p):
            return p
    return None


def _fix_token_prefix_casing(t: str) -> str:
    for p in _SHOPIFY_ADMIN_API_PREFIXES:
        n = len(p)
        if len(t) >= n and t[:n].lower() == p and not t.startswith(p):
            return p + t[n:]
    return t


def _require_env(name: str) -> str:
    v = os.environ.get(name, "").strip()
    if not v:
        log.error("Missing required env %s", name)
        sys.exit(1)
    return v


def _normalize_store(raw: str) -> str:
    """Accept handle only or full myshopify URL; secrets often include extra cruft."""
    s = raw.strip()
    s = re.sub(r"^https?://", "", s, flags=re.IGNORECASE).rstrip("/")
    if s.endswith(".myshopify.com"):
        s = s[: -len(".myshopify.com")]
    return s.strip()


def _normalize_token(raw: str) -> str:
    t = (raw or "").strip().strip("\ufeff")
    for zw in ("\u200b", "\u200c", "\u200d", "\ufeff"):
        t = t.replace(zw, "")
    t = t.strip()
    t = unicodedata.normalize("NFKC", t)
    # Copy/paste from some UIs uses fullwidth/low-line chars that look like _ but break shpat_ checks & API.
    for bad in (
        "\uff3f",  # FULLWIDTH LOW LINE
        "\u2017",  # DOUBLE LOW LINE
        "\u203f",  # UNDERTIE
        "\ufe58",  # SMALL EM DASH
    ):
        t = t.replace(bad, "_")
    if t.lower().startswith("bearer "):
        t = t[7:].strip()
    # GitHub secret pasted as "shpat_..." with quotes → breaks prefix check and auth.
    if len(t) >= 2 and t[0] == t[-1] and t[0] in "\"'":
        t = t[1:-1].strip()
    t = _fix_token_prefix_casing(t)
    return t


def _log_token_hint(token: str) -> None:
    """Safe diagnostics for CI (never log the full secret)."""
    n = len(token)
    log.info("SHOPIFY_ACCESS_TOKEN length=%d", n)
    prefix = _admin_token_prefix(token)
    if prefix:
        log.info("Token prefix OK (%s — Shopify Admin API-style access token)", prefix)
        if n < 32:
            log.warning("Token looks unusually short; confirm you copied the full Admin API access token.")
        return
    if token:
        c0 = token[0]
        log.warning(
            "Token first character is U+%04X (expected U+0073 's' for Shopify admin tokens). "
            "If this is not 0073, re-copy the token from Shopify into a plain-text editor, then into GitHub.",
            ord(c0),
        )
        cps = " ".join(f"U+{ord(c):04X}" for c in token[:9])
        log.warning(
            "Token first 9 codepoints (debug): %s — common prefixes: shpat_, shpca_, shpss_, shpua_",
            cps,
        )
    log.warning(
        "Token does not match known Shopify Admin API prefixes %s. "
        "Fix: GitHub → Settings → Secrets → Actions → SHOPIFY_ACCESS_TOKEN = full value from "
        "Develop apps → API credentials → Reveal (not Client secret / API key).",
        _SHOPIFY_ADMIN_API_PREFIXES,
    )


def fetch_admin_token_client_credentials(
    client: httpx.Client,
    store: str,
    client_id: str,
    client_secret: str,
) -> str:
    """Exchange Dev Dashboard Client ID/secret for a short-lived Admin API access_token."""
    url = f"https://{store}.myshopify.com/admin/oauth/access_token"
    resp = client.post(
        url,
        data={
            "grant_type": "client_credentials",
            "client_id": client_id.strip(),
            "client_secret": client_secret.strip(),
        },
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    if not resp.is_success:
        log.error(
            "OAuth client_credentials failed HTTP %s for %s — body (truncated): %s",
            resp.status_code,
            url,
            (resp.text or "")[:800],
        )
    resp.raise_for_status()
    body = resp.json()
    tok = body.get("access_token")
    if not tok:
        log.error("OAuth response missing access_token: %s", body)
        sys.exit(1)
    expires_in = body.get("expires_in", "?")
    log.info("Admin API token via client_credentials (expires_in=%s s)", expires_in)
    return str(tok).strip()


def gid_to_int(gid: Optional[str]) -> Optional[int]:
    if not gid or not isinstance(gid, str):
        return None
    m = re.search(r"/(\d+)\s*$", gid)
    if not m:
        return None
    return int(m.group(1))


def shopify_graphql(
    client: httpx.Client,
    store: str,
    token: str,
    api_version: str,
    query: str,
    variables: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    url = f"https://{store}.myshopify.com/admin/api/{api_version}/graphql.json"
    headers = {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": token,
    }
    body: Dict[str, Any] = {"query": query}
    if variables:
        body["variables"] = variables

    for attempt in range(6):
        resp = client.post(url, headers=headers, json=body)
        if resp.status_code == 429:
            wait = float(resp.headers.get("Retry-After", "2"))
            log.warning("429 rate limited, sleeping %.1fs (attempt %s)", wait, attempt + 1)
            time.sleep(wait)
            continue
        if resp.status_code == 401:
            log.error(
                "Shopify 401 Unauthorized for %s — token shape looks OK but Shopify rejected it. "
                "Most often: SHOPIFY_STORE must be the exact myshopify handle of the SAME shop where "
                "this token was issued (admin URL …/store/HANDLE). Token from shop A will 401 on shop B. "
                "Also try SHOPIFY_API_VERSION=2026-01 (or latest in Shopify docs) if your shop deprecated old API. "
                "Re-Reveal a fresh Admin API access token if the app was reinstalled.",
                url,
            )
            log.error("Response (truncated): %s", (resp.text or "")[:800])
        resp.raise_for_status()
        data = resp.json()
        if data.get("errors"):
            log.error("GraphQL errors: %s", data["errors"])
            sys.exit(1)
        ext = data.get("extensions") or {}
        cost = ext.get("cost")
        if cost and cost.get("throttleStatus"):
            ts = cost["throttleStatus"]
            avail = ts.get("currentlyAvailable")
            restore = ts.get("restoreRate")
            if avail is not None and avail < 100 and restore:
                sleep_s = min(2.0, max(0.2, (200 - avail) / max(restore, 1)))
                time.sleep(sleep_s)
        return data["data"]
    log.error("Too many 429 responses")
    sys.exit(1)


LOCATIONS_QUERY = """
query Locations($cursor: String) {
  locations(first: 50, after: $cursor) {
    pageInfo { hasNextPage endCursor }
    edges {
      node {
        id
        name
        isActive
      }
    }
  }
}
"""

ORDERS_QUERY = """
query Orders($cursor: String, $query: String!) {
  orders(first: %d, after: $cursor, query: $query, sortKey: UPDATED_AT, reverse: true) {
    pageInfo { hasNextPage endCursor }
    edges {
      cursor
      node {
        id
        legacyResourceId
        name
        createdAt
        updatedAt
        displayFinancialStatus
        displayFulfillmentStatus
        currencyCode
        totalPriceSet { shopMoney { amount currencyCode } }
        subtotalPriceSet { shopMoney { amount currencyCode } }
        lineItems(first: 250) {
          edges {
            node {
              id
              name
              title
              variantTitle
              currentQuantity
              quantity
              sku
              variant { id sku inventoryItem { id legacyResourceId } }
              originalUnitPriceSet { shopMoney { amount } }
            }
          }
        }
      }
    }
  }
}
""" % ORDERS_PAGE_SIZE

INVENTORY_ITEMS_QUERY = """
query InvItems($cursor: String) {
  inventoryItems(first: %d, after: $cursor) {
    pageInfo { hasNextPage endCursor }
    edges {
      node {
        id
        sku
        tracked
        updatedAt
        inventoryLevels(first: 50) {
          edges {
            node {
              id
              updatedAt
              quantities(names: ["available"]) { name quantity }
              location { id name isActive }
            }
          }
        }
      }
    }
  }
}
""" % INVENTORY_ITEMS_PAGE_SIZE


def fetch_all_locations(
    client: httpx.Client, store: str, token: str, ver: str
) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    cursor: Optional[str] = None
    while True:
        data = shopify_graphql(client, store, token, ver, LOCATIONS_QUERY, {"cursor": cursor})
        conn = data.get("locations") or {}
        for edge in conn.get("edges") or []:
            n = edge["node"]
            lid = gid_to_int(n["id"])
            if lid is None:
                continue
            raw = dict(n)
            rows.append(
                {
                    "id": lid,
                    "name": n.get("name"),
                    "is_active": n.get("isActive"),
                    "raw_json": raw,
                }
            )
        page = conn.get("pageInfo") or {}
        if not page.get("hasNextPage"):
            break
        cursor = page.get("endCursor")
    return rows


def upsert_chunked(supabase: Any, table: str, rows: List[Dict[str, Any]], on_conflict: str) -> None:
    for i in range(0, len(rows), UPSERT_CHUNK):
        batch = rows[i : i + UPSERT_CHUNK]
        supabase.table(table).upsert(batch, on_conflict=on_conflict).execute()


def sync_locations(supabase: Any, client: httpx.Client, store: str, token: str, ver: str) -> None:
    log.info("Fetching locations ...")
    rows = fetch_all_locations(client, store, token, ver)
    if not rows:
        log.warning("No locations returned")
        return
    upsert_chunked(supabase, "shopify_locations", rows, "id")
    log.info("Upserted %d locations", len(rows))


def order_node_to_rows(
    node: Dict[str, Any],
) -> Tuple[Dict[str, Any], List[Dict[str, Any]]]:
    oid = node.get("legacyResourceId")
    if oid is not None:
        oid = int(oid)
    else:
        oid = gid_to_int(node.get("id"))
    if oid is None:
        raise ValueError("order without id")

    total_set = (node.get("totalPriceSet") or {}).get("shopMoney") or {}
    sub_set = (node.get("subtotalPriceSet") or {}).get("shopMoney") or {}
    total_price = total_set.get("amount")
    subtotal_price = sub_set.get("amount")

    order_row = {
        "id": oid,
        "shopify_gid": node.get("id"),
        "name": node.get("name"),
        "created_at": node.get("createdAt"),
        "updated_at": node.get("updatedAt"),
        "financial_status": node.get("displayFinancialStatus"),
        "fulfillment_status": node.get("displayFulfillmentStatus"),
        "currency": node.get("currencyCode") or total_set.get("currencyCode"),
        "total_price": float(total_price) if total_price is not None else None,
        "subtotal_price": float(subtotal_price) if subtotal_price is not None else None,
        # Bez read_customers scope — dopln customer { displayName } do query ak pridáš scope.
        "customer_display_name": None,
        "raw_json": node,
    }

    line_rows: List[Dict[str, Any]] = []
    for e in (node.get("lineItems") or {}).get("edges") or []:
        ln = e["node"]
        lid = gid_to_int(ln.get("id"))
        if lid is None:
            continue
        variant = ln.get("variant") or {}
        var_id = gid_to_int(variant.get("id"))
        inv_item_obj = variant.get("inventoryItem") or {}
        inv_item_id = gid_to_int(inv_item_obj.get("id"))
        if inv_item_id is None:
            leg = inv_item_obj.get("legacyResourceId")
            if leg is not None:
                try:
                    inv_item_id = int(leg)
                except (TypeError, ValueError):
                    inv_item_id = None
        qty_raw = ln.get("currentQuantity")
        if qty_raw is None:
            qty_raw = ln.get("quantity")
        price_set = (ln.get("originalUnitPriceSet") or {}).get("shopMoney") or {}
        amt = price_set.get("amount")
        line_rows.append(
            {
                "order_id": oid,
                "line_item_id": lid,
                "title": ln.get("title"),
                "sku": ln.get("sku") or variant.get("sku"),
                "quantity": qty_raw,
                "variant_id": var_id,
                "inventory_item_id": inv_item_id,
                "unit_price": float(amt) if amt is not None else None,
                "raw_json": ln,
            }
        )

    return order_row, line_rows


def sync_orders(
    supabase: Any,
    client: httpx.Client,
    store: str,
    token: str,
    ver: str,
    search_query: str,
) -> None:
    log.info("Fetching orders query=%r ...", search_query)
    cursor: Optional[str] = None
    total_orders = 0
    while True:
        data = shopify_graphql(
            client,
            store,
            token,
            ver,
            ORDERS_QUERY,
            {"cursor": cursor, "query": search_query},
        )
        conn = data.get("orders") or {}
        edges = conn.get("edges") or []
        order_rows: List[Dict[str, Any]] = []
        all_lines: List[Dict[str, Any]] = []
        order_ids: List[int] = []

        for edge in edges:
            node = edge["node"]
            try:
                orow, lrows = order_node_to_rows(node)
            except ValueError as e:
                log.warning("Skip order: %s", e)
                continue
            order_rows.append(orow)
            order_ids.append(orow["id"])
            all_lines.extend(lrows)

        if order_ids:
            supabase.table("shopify_order_line_items").delete().in_("order_id", order_ids).execute()
            upsert_chunked(supabase, "shopify_orders", order_rows, "id")
            if all_lines:
                upsert_chunked(
                    supabase,
                    "shopify_order_line_items",
                    all_lines,
                    "order_id,line_item_id",
                )

        total_orders += len(order_rows)
        page = conn.get("pageInfo") or {}
        if not page.get("hasNextPage"):
            break
        cursor = page.get("endCursor")

    log.info("Synced %d orders (this query window)", total_orders)


def sync_inventory(
    supabase: Any,
    client: httpx.Client,
    store: str,
    token: str,
    ver: str,
) -> None:
    log.info("Fetching inventory items + levels ...")
    cursor: Optional[str] = None
    level_rows: List[Dict[str, Any]] = []
    while True:
        data = shopify_graphql(
            client, store, token, ver, INVENTORY_ITEMS_QUERY, {"cursor": cursor}
        )
        conn = data.get("inventoryItems") or {}
        for edge in conn.get("edges") or []:
            item = edge["node"]
            item_id = gid_to_int(item.get("id"))
            if item_id is None:
                continue
            for le in (item.get("inventoryLevels") or {}).get("edges") or []:
                lv = le["node"]
                loc = lv.get("location") or {}
                loc_id = gid_to_int(loc.get("id"))
                if loc_id is None:
                    continue
                qty = 0
                for q in lv.get("quantities") or []:
                    if q.get("name") == "available":
                        qty = int(q.get("quantity") or 0)
                        break
                raw = {
                    "inventoryItemId": item.get("id"),
                    "inventoryItemSku": item.get("sku"),
                    "level": lv,
                }
                level_rows.append(
                    {
                        "inventory_item_id": item_id,
                        "location_id": loc_id,
                        "available": qty,
                        "updated_at": lv.get("updatedAt"),
                        "raw_json": raw,
                    }
                )
        page = conn.get("pageInfo") or {}
        if not page.get("hasNextPage"):
            break
        cursor = page.get("endCursor")

    if not level_rows:
        log.warning("No inventory levels returned")
        return
    upsert_chunked(
        supabase,
        "shopify_inventory_levels",
        level_rows,
        "inventory_item_id,location_id",
    )
    log.info("Upserted %d inventory level rows", len(level_rows))

    by_sku: Dict[str, int] = defaultdict(int)
    for r in level_rows:
        raw = r.get("raw_json") or {}
        if isinstance(raw, dict):
            sku = (raw.get("inventoryItemSku") or "").strip()
        else:
            sku = ""
        label = sku if sku else "—"
        by_sku[label] += int(r.get("available") or 0)

    snapshot_rows = [
        {"sku_label": k, "total_available": v} for k, v in sorted(by_sku.items())
    ]
    if snapshot_rows:
        try:
            supabase.table("shopify_inventory_snapshots").insert(snapshot_rows).execute()
            log.info("Inserted %d inventory snapshot rows", len(snapshot_rows))
        except Exception as e:
            log.warning(
                "Could not insert shopify_inventory_snapshots (run migration 007?): %s",
                e,
            )


def build_orders_search_query(args: argparse.Namespace) -> str:
    if args.ytd:
        y = args.ytd_year or date.today().year
        return f"created_at:>={y}-01-01"
    if args.from_date:
        return f"updated_at:>={args.from_date.isoformat()}"
    if args.days is not None:
        start = date.today() - timedelta(days=int(args.days))
        return f"updated_at:>={start.isoformat()}"
    y = date.today().year
    return f"created_at:>={y}-01-01"


def main() -> None:
    parser = argparse.ArgumentParser(description="Shopify → Supabase sync")
    parser.add_argument("--days", type=int, default=None, help="updated_at >= today−days")
    parser.add_argument(
        "--from",
        dest="from_date",
        type=lambda s: datetime.strptime(s, "%Y-%m-%d").date(),
        default=None,
        help="updated_at >= YYYY-MM-DD",
    )
    parser.add_argument(
        "--ytd",
        action="store_true",
        help="orders created_at >= Jan 1 (see --ytd-year)",
    )
    parser.add_argument(
        "--ytd-year",
        type=int,
        default=None,
        help="year for --ytd (default: current calendar year)",
    )
    parser.add_argument("--orders-only", action="store_true")
    parser.add_argument("--inventory-only", action="store_true")
    args = parser.parse_args()
    args.ytd_year = args.ytd_year or date.today().year

    store = _normalize_store(_require_env("SHOPIFY_STORE"))
    client_id = os.environ.get("SHOPIFY_CLIENT_ID", "").strip()
    client_secret = os.environ.get("SHOPIFY_CLIENT_SECRET", "").strip()
    raw_access = os.environ.get("SHOPIFY_ACCESS_TOKEN", "").strip()

    sb_url = _require_env("SUPABASE_URL")
    sb_key = _require_env("SUPABASE_SERVICE_ROLE_KEY")
    ver = _resolved_api_version()
    log.info("Shopify API version %s", ver)
    log.info("Shopify store %s.myshopify.com", store)

    supabase = create_client(sb_url, sb_key)

    inv_only = args.inventory_only
    ord_only = args.orders_only
    if inv_only and ord_only:
        log.error("Choose at most one of --inventory-only / --orders-only")
        sys.exit(1)

    if not (client_id and client_secret) and not raw_access:
        log.error(
            "Shopify auth: set SHOPIFY_CLIENT_ID + SHOPIFY_CLIENT_SECRET (Dev Dashboard, Jan 2026+), "
            "or SHOPIFY_ACCESS_TOKEN (legacy custom app). See README."
        )
        sys.exit(1)

    with httpx.Client(timeout=120.0) as client:
        if client_id and client_secret:
            token = fetch_admin_token_client_credentials(client, store, client_id, client_secret)
        else:
            token = _normalize_token(raw_access)
            _log_token_hint(token)

        if not inv_only:
            sync_locations(supabase, client, store, token, ver)
        if not inv_only:
            q = build_orders_search_query(args)
            sync_orders(supabase, client, store, token, ver, q)
        if not ord_only:
            if inv_only:
                sync_locations(supabase, client, store, token, ver)
            sync_inventory(supabase, client, store, token, ver)

    now_iso = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    supabase.table("shopify_sync_state").upsert(
        {
            "resource": "full_sync",
            "last_success_at": now_iso,
            "meta": {"argv": sys.argv[1:]},
        },
        on_conflict="resource",
    ).execute()
    log.info("Done.")


if __name__ == "__main__":
    main()
