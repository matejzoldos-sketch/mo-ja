# mo-ja — Shopify → Supabase → dashboard

Analytický stack pre e-shop **MO–JA**: sync objednávok a skladu zo Shopify, cashflow z Tatra banky a Next.js dashboard (Predaj, Sklad, Cash flow, Marketing / MER) na Vercel.

Repo: [github.com/matejzoldos-sketch/mo-ja](https://github.com/matejzoldos-sketch/mo-ja)

## Požiadavky

- Python **3.12** (CI aj lokálne odporúčané)
- Shopify **Admin API** so scopes: `read_inventory`, `read_locations`, **`read_products`** (bez neho Sklad nevie spájať predaj so skladom) a **`read_all_orders`** (pre YTD; bez neho ~posledných 60 dní). Alternatíva `read_orders` = kratšia história.
- KPI „vracajúci sa“ nepotrebuje `read_customers` — sync berie `email` z objednávky (`customer_email`). Voliteľne `read_customers` + GraphQL `customer { id }` → `customer_id`.
- Supabase projekt `kqsmsegcqdhuhiofxyuu` — pred sync/webom `supabase db push` (migrácie `001`–`080`).

### Shopify auth (od 1. 1. 2026)

Nové appky: [Dev Dashboard](https://dev.shopify.com/dashboard/) → **Client ID + Client secret** (client credentials grant). V `.env` / Secrets: `SHOPIFY_CLIENT_ID`, `SHOPIFY_CLIENT_SECRET`, `SHOPIFY_STORE`. `SHOPIFY_ACCESS_TOKEN` môže byť prázdny.

Legacy custom app: stačí `SHOPIFY_ACCESS_TOKEN` (Reveal v Develop apps).

## Setup

```bash
cp .env.example .env
supabase link --project-ref kqsmsegcqdhuhiofxyuu
supabase db push

python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python sync_shopify.py
```

Root `.env`: Shopify + Supabase + Tatra (`TATRA_*`; `TATRA_ENV` default v skripte `sandbox`, v `.env.example` a Actions cron `production`). Web: `web/.env.example` → `.env.local` (`SUPABASE_*`, voliteľne `DASHBOARD_PASSWORD` alebo legacy alias `DASHBOARD_TOKEN`).

## Štruktúra

| Cesta | Účel |
|-------|------|
| `sync_shopify.py` | Hlavný Shopify → Supabase sync |
| `etl/sync_tatra.py` | Tatra AIS → Supabase |
| `etl/import_meta_ads_csv.py` | Meta Ads CSV → MER |
| `etl/import_accounting_journal_csv.py` | Účtovný denník → MER |
| `scripts/tatra_*.py` | OAuth / auth check |
| `supabase/migrations/` | SQL (Shopify, Tatra, marketing, …) |
| `web/` | Next.js 14 dashboard (Vercel Root Directory = `web`) |
| `docs/` | OAuth callback, insights design, ukážkové CSV |

## Dashboard (Next.js)

```bash
cd web
cp .env.example .env.local
npm install && npm run dev
```

| Route | Modul |
|-------|--------|
| `/` | Predaj — KPI, grafy, objednávky (`get_shopify_dashboard_mvp`) |
| `/sklad` | Inventár zo Shopify |
| `/cashflow` | Tatra banka |
| `/marketing` | MER (revenue, ads, fees, mROAS) |
| `/login` | Heslo (`DASHBOARD_PASSWORD`) |

`/insighty` je WIP (redirect na `/`), v hlavnom menu dočasne skryté — návrh v `docs/insights-dashboard-design.md`.

- Mock bez DB: pridaj `?mock=1` k volaniu API (Predaj, analytics, marketing, insights).
- Idle logout: default 30 min (`NEXT_PUBLIC_DASHBOARD_IDLE_MINUTES`).
- Vercel: Root Directory = `web`, rovnaké env ako `web/.env.example`.

## `sync_shopify.py`

| Príkaz | Popis |
|--------|--------|
| `python sync_shopify.py` | Predvolené: YTD (`created_at` od 1. 1.) + lokácie + sklad |
| `python sync_shopify.py --days 7` | Inkrement: `updated_at` ≥ dnes − N dní |
| `python sync_shopify.py --ytd` | YTD aktuálny rok |
| `python sync_shopify.py --ytd --ytd-year 2026` | YTD konkrétny rok |
| `python sync_shopify.py --from 2026-01-01` | `updated_at` ≥ dátum |
| `python sync_shopify.py --created-from 2025-11-01` | `created_at` ≥ dátum |
| `python sync_shopify.py --utm-backfill` | UTM backfill |
| `python sync_shopify.py --orders-only` / `--inventory-only` | Bez inventory / len sklad |

## GitHub Actions

**Secrets:** `SHOPIFY_STORE` + (`SHOPIFY_CLIENT_ID`/`SECRET` alebo `SHOPIFY_ACCESS_TOKEN`), `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, voliteľne `SHOPIFY_API_VERSION`; pre Tatra: `TATRA_CLIENT_ID`, `TATRA_CLIENT_SECRET`, `TATRA_REFRESH_TOKEN`.

| Workflow | Čas (UTC) | Predvolený beh |
|----------|-----------|----------------|
| Shopify sync | 00:00 | **`--days 14`** (inkrementálny) |
| Tatra sync | 00:30 | **`--days 400`** (min. dátum 2026-01-01) |

Manuálne `workflow_dispatch`:
- **Shopify:** režim **`ytd`** / **`daily`** (14 dní); voliteľne `created_from` (YYYY-MM-DD backfill) alebo `utm_backfill`.
- **Tatra:** parametre `days` (default 400) a `tatra_env` (`production` / `sandbox`).

### Shopify 401

1. Token = Admin API access token z Develop apps (Reveal), nie Client secret z Partner Dashboardu.
2. `SHOPIFY_STORE` = handle (napr. `yttmhc-p0`), ten istý obchod ako token.
3. V logu Actions: `Token prefix OK`. Skús `SHOPIFY_API_VERSION=2026-01`.

```bash
curl -sS -w "\nHTTP %{http_code}\n" \
  -H "Content-Type: application/json" \
  -H "X-Shopify-Access-Token: $SHOPIFY_ACCESS_TOKEN" \
  -d '{"query":"{ shop { name } }"}' \
  "https://${SHOPIFY_STORE}.myshopify.com/admin/api/2026-01/graphql.json"
```

## Tatra banka

Migrácie od `051` (pohyby), `052`+ (zostatky a view `tatra_cashflow_dashboard`) — súčasť `supabase db push`.

Vlastná Tatra appka pre mo-ja (iné credentials než ZITA). AIS súhlas FAC_BBTB pre tento `client_id`.

```bash
python scripts/tatra_check_auth.py
python etl/sync_tatra.py --days 7 --dry-run
python etl/sync_tatra.py --days 45
```

OAuth refresh token: `docs/tatra-oauth-callback/` + `scripts/tatra_oauth_pkce.py` → Secret `TATRA_REFRESH_TOKEN`.

## Marketing (MER)

```bash
python etl/import_meta_ads_csv.py   # default: docs/MOJA-Kampane-20.-6.-2023-20.-7.-2026.csv
python etl/import_accounting_journal_csv.py   # default: docs/Moja - Denník.csv
```

Migrácie od `072` (Meta Ads) a `076` (účtovný denník). Dashboard: `/marketing`.

## Tabuľky (výber)

- Shopify: `shopify_orders`, `shopify_order_line_items`, `shopify_locations`, `shopify_inventory_levels`, `shopify_sync_state`
- Tatra: `tatra_transactions`, `tatra_account_balances`, view `tatra_cashflow_dashboard`
- Marketing: `meta_ads_campaign_daily`, `accounting_journal_lines`

Shopify tabuľky: RLS bez anon politík (ETL / Next.js API cez service role). Tatra a marketing tabuľky majú verejné SELECT pre anon/authenticated; dashboard stále používa service role v API.

Hlavička „Posledný sync“ berie max z `last_success_at` a `fetched_at`. Actions a Vercel musia smerovať na **ten istý** Supabase projekt.

## Webhooks

Zatiaľ polling cez cron. Edge Function + Shopify webhooks sú možné neskôr.
