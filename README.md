# mo-ja — Shopify → Supabase

Synchronizácia **objednávok**, **riadkov**, **lokácií** a **skladových zásob** z Shopify Admin API do Postgres (Supabase).

## Požiadavky

- Shopify **Custom app** s Admin API tokenom a scopes: `read_orders`, `read_inventory`, `read_locations`, `read_products` (voliteľne `read_customers`).
- Supabase projekt; migráciu spustiť pred prvým syncom.

## Nastavenie

1. Skopíruj `.env.example` na `.env` a doplň hodnoty (tokeny neukladaj do gitu).

2. V [Supabase SQL Editor](https://supabase.com/dashboard) spusti obsah súboru `supabase/migrations/001_shopify_core.sql`, alebo:

   ```bash
   supabase link --project-ref kqsmsegcqdhuhiofxyuu
   supabase db push
   ```

3. Lokálne:

   ```bash
   python -m venv .venv
   source .venv/bin/activate
   pip install -r requirements.txt
   python sync_shopify.py --days 14
   ```

## Použitie `sync_shopify.py`

| Príkaz | Popis |
|--------|--------|
| `python sync_shopify.py` | Predvolené: `updated_at` ≥ dnes − 14 dní + lokácie + sklad |
| `python sync_shopify.py --days 7` | Užšie okno podľa `updated_at` |
| `python sync_shopify.py --ytd` | Objednávky s `created_at` ≥ 1. január **aktuálneho roka** |
| `python sync_shopify.py --ytd --ytd-year 2026` | Rovnaké pre konkrétny rok |
| `python sync_shopify.py --from 2026-01-01` | `updated_at` ≥ dátum |
| `python sync_shopify.py --orders-only` | Bez inventory |
| `python sync_shopify.py --inventory-only` | Len lokácie + sklad (lokácie sa stiahnu vždy kvôli FK) |

## GitHub Actions

V repozitári nastav **Secrets**:

- `SHOPIFY_STORE`, `SHOPIFY_ACCESS_TOKEN`
- `SUPABASE_URL` (voliteľné ak použiješ default v workflow)
- `SUPABASE_SERVICE_ROLE_KEY`

Workflow: každý deň o ~04:15 UTC reconciliácia (`--days 14`); **v pondelok** (kalendár Europe/Bratislava) beh `--ytd`. Manuálne `workflow_dispatch` s voľbou `daily` / `ytd`.

## Tabuľky

- `shopify_orders`, `shopify_order_line_items`, `shopify_locations`, `shopify_inventory_levels`, `shopify_sync_state`

RLS je zapnuté bez politík pre anon — prístup len cez **service role** (skript / server).

## Webhooks (neskôr)

Pre takmer reálny čas môžeš doplniť Supabase Edge Function a Shopify webhooks; tento repo zatiaľ používa polling cez cron.
