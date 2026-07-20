#!/usr/bin/env python3
"""
Import Meta Ads Manager CSV (kampane, denný breakdown) → public.meta_ads_campaign_daily.

Použitie:
  cd mo-ja/etl
  python3 import_meta_ads_csv.py --csv-path "../docs/MOJA-Kampane-20.-6.-2023-20.-7.-2026.csv"

Vyžaduje:
  SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY (alebo SUPABASE_KEY)
"""

from __future__ import annotations

import argparse
import csv
import json
import logging
import os
from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any, Dict, List, Optional

from dotenv import load_dotenv
from supabase import create_client


ROOT = Path(__file__).resolve().parent.parent
DEFAULT_CSV = (
    ROOT / "docs" / "MOJA-Kampane-20.-6.-2023-20.-7.-2026.csv"
)  # typicky váš export

load_dotenv(ROOT / ".env")

log = logging.getLogger("import_meta_ads_csv")


def _num(val: Optional[str]) -> Optional[float]:
    if val is None:
        return None
    s = str(val).strip().replace(",", ".")
    if not s:
        return None
    try:
        return float(Decimal(s))
    except (InvalidOperation, ValueError):
        return None


def _int(val: Optional[str]) -> int:
    n = _num(val)
    if n is None:
        return 0
    return int(round(n))


def parse_csv_rows(path: Path) -> List[dict]:
    out: List[dict] = []
    with path.open(encoding="utf-8-sig", errors="replace", newline="") as f:
        reader = csv.DictReader(f)
        if not reader.fieldnames:
            return out

        for row_num, row in enumerate(reader, start=2):
            raw_date = (row.get("Začiatok vykazovania") or "").strip()
            name = (row.get("Názov kampane") or "").strip()
            if not raw_date or not name:
                log.warning(
                    "Preskočený riadok %s: chýba dátum alebo názov kampane",
                    row_num,
                )
                continue

            try:
                report_date = datetime.fromisoformat(raw_date[:10]).date()
            except ValueError:
                log.warning(
                    "Preskočený riadok %s: neplatný dátum %r",
                    row_num,
                    raw_date,
                )
                continue

            spend = _num(row.get("Minutá suma (EUR)")) or 0.0
            results = _num(row.get("Výsledky"))
            cpr = _num(row.get("Cena za výsledky"))

            out.append(
                {
                    "report_date": report_date.isoformat(),
                    "campaign_name": name,
                    "delivery_status": (row.get("Doručenie kampane") or "").strip()
                    or None,
                    "results": results,
                    "result_indicator": (row.get("Result indicator") or "").strip()
                    or None,
                    "cost_per_result": cpr,
                    "ad_set_budget": (row.get("Rozpočet zostavy reklám") or "").strip()
                    or None,
                    "ad_set_budget_type": (row.get("Typ rozpočtu zostavy reklám") or "").strip()
                    or None,
                    "spend_eur": round(spend, 6),
                    "impressions": _int(row.get("Impresie")),
                    "reach": _int(row.get("Dosah")),
                    "campaign_end": (row.get("Koniec") or "").strip() or None,
                    "attribution_setting": (
                        row.get("Nastavenie pričítania") or ""
                    ).strip()
                    or None,
                }
            )

    return out


def upsert_supabase(rows: List[dict], batch_size: int = 500) -> None:
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_KEY")
    if not url or not key:
        raise SystemExit("Chýba SUPABASE_URL alebo SUPABASE_SERVICE_ROLE_KEY v .env")

    sb = create_client(url, key)
    now = datetime.now(timezone.utc).isoformat()

    for i in range(0, len(rows), batch_size):
        chunk = [{**r, "imported_at": now} for r in rows[i : i + batch_size]]
        sb.table("meta_ads_campaign_daily").upsert(
            chunk, on_conflict="report_date,campaign_name"
        ).execute()
        log.info("Upsert %s–%s / %s", i + 1, min(i + batch_size, len(rows)), len(rows))


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")

    ap = argparse.ArgumentParser(description="Import Meta Ads CSV do mo-ja Supabase")
    ap.add_argument("--csv-path", type=Path, default=DEFAULT_CSV)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    if not args.csv_path.is_file():
        raise SystemExit(f"Súbor neexistuje: {args.csv_path}")

    rows = parse_csv_rows(args.csv_path)
    log.info("Načítaných %s riadkov z %s", len(rows), args.csv_path)

    if args.dry_run:
        spend = sum(float(r.get("spend_eur") or 0) for r in rows)
        campaigns = len({r.get("campaign_name") for r in rows})
        log.info("Dry-run: spend=%.2f EUR, kampaní=%s", spend, campaigns)
        return

    upsert_supabase(rows)


if __name__ == "__main__":
    main()

