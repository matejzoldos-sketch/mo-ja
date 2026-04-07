#!/usr/bin/env python3
"""
Shopify Admin API → Supabase (orders, line items, locations, inventory levels).

Env:
  SHOPIFY_STORE              — shop handle without .myshopify.com (e.g. yttmhc-p0)
  SHOPIFY_ACCESS_TOKEN       — Admin API access token (Custom app)
  SHOPIFY_API_VERSION        — optional, default 2024-10
  SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY

Usage:
  python sync_shopify.py                    # last 14 days by updated_at + inventory + locations
  python sync_shopify.py --days 7
  python sync_shopify.py --ytd              # orders with created_at >= Jan 1 (current year)
  python sync_shopify.py --from 2026-01-01   # updated_at >= date (YYYY-MM-DD)
  python sync_shopify.py --orders-only
  python sync_shopify.py --inventory-only
"""

from __future__ import annotations

import argparse
import logging
import os
import re
import sys
import time
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
DEFAULT_API_VERSION_FALLBACK = "2024-10"


def _resolved_api_version() -> str:
    raw = (os.environ.get("SHOPIFY_API_VERSION") or "").strip()
    return raw or DEFAULT_API_VERSION_FALLBACK


ORDERS_PAGE_SIZE = 40
INVENTORY_ITEMS_PAGE_SIZE = 50
UPSERT_CHUNK = 150


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
    t = raw.strip()
    if t.lower().startswith("bearer "):
        t = t[7:].strip()
    return t


def _log_token_hint(token: str) -> None:
    """Safe diagnostics for CI (never log the full secret)."""
    n = len(token)
    log.info("SHOPIFY_ACCESS_TOKEN length=%d", n)
    if token.startswith("shpat_"):
        log.info("Token prefix OK (shpat_ — Admin API access token from Develop apps)")
        return
    log.warning(
        "Token does NOT start with shpat_. Wrong value in GitHub secret is the #1 cause of 401. "
        "Use Admin API access token from: Store admin → Settings → Apps → Develop apps → "
        "[Your app] → API credentials → Reveal (after Install). "
        "Do NOT use Client secret, API key, or Partner Dashboard client secret."
    )


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
                "Shopify 401 Unauthorized for %s — check SHOPIFY_ACCESS_TOKEN and SHOPIFY_STORE. "
                "Token must be the Admin API access token from this store's app (Custom app: "
                "Develop apps → API credentials → Admin API access token, often starts with shpat_). "
                "Not the Client secret. Store must be the shop handle only, same store where the app is installed.",
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
              title
              quantity
              sku
              variant { id sku inventoryItem { id } }
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
        inv_item = (variant.get("inventoryItem") or {}).get("id")
        inv_item_id = gid_to_int(inv_item)
        price_set = (ln.get("originalUnitPriceSet") or {}).get("shopMoney") or {}
        amt = price_set.get("amount")
        line_rows.append(
            {
                "order_id": oid,
                "line_item_id": lid,
                "title": ln.get("title"),
                "sku": ln.get("sku") or variant.get("sku"),
                "quantity": ln.get("quantity"),
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


def build_orders_search_query(args: argparse.Namespace) -> str:
    if args.ytd:
        y = args.ytd_year or date.today().year
        return f"created_at:>={y}-01-01"
    if args.from_date:
        return f"updated_at:>={args.from_date.isoformat()}"
    if args.days is not None:
        start = date.today() - timedelta(days=int(args.days))
        return f"updated_at:>={start.isoformat()}"
    start = date.today() - timedelta(days=14)
    return f"updated_at:>={start.isoformat()}"


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
    token = _normalize_token(_require_env("SHOPIFY_ACCESS_TOKEN"))
    _log_token_hint(token)
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

    with httpx.Client(timeout=120.0) as client:
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
