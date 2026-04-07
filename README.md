# mo-ja — Shopify → Supabase

Synchronizácia **objednávok**, **riadkov**, **lokácií** a **skladových zásob** z Shopify Admin API do Postgres (Supabase).

## Požiadavky

- Shopify **Custom app** s Admin API tokenom a scopes: `read_inventory`, `read_locations`, `read_products` a `read_orders` alebo `read_all_orders` (pre dlhšiu históriu). Mená zákazníkov sync neťahá — `read_customers` nepotrebuješ, kým to nezapneš v `sync_shopify.py`.
- Supabase projekt; migrácie `001` (+ `002` pre dashboard) spustiť pred prvým syncom / pred webom.

## Nastavenie

1. Skopíruj `.env.example` na `.env` a doplň hodnoty (tokeny neukladaj do gitu).

2. V [Supabase SQL Editor](https://supabase.com/dashboard) spusti `001_shopify_core.sql` a potom `002_dashboard_mvp.sql`, alebo:

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

### Shopify 401 / „Invalid API key or access token“

1. **`SHOPIFY_ACCESS_TOKEN`** musí byť **Admin API access token** z **obchodného adminu**: **Settings → Apps and sales channels → Develop apps → [appka] → API credentials → Reveal** (až po **Install app**). Zvyčajne začína **`shpat_`**.  
   **Nie** Client secret, **nie** „API secret key“ z Partner Dashboardu, **nie** API key z karty Configuration.

2. **`SHOPIFY_STORE`** = len handle (napr. `yttmhc-p0`), nie celá URL.

3. Po spustení Actions v logu skontroluj riadok **`SHOPIFY_ACCESS_TOKEN length=`** a či je **`Token prefix OK (shpat_…)`**. Ak nie, secret v GitHube je stále zlý typ hodnoty.

4. Rýchly test v termináli (lokálne, token nezdieľaj):

   ```bash
   export SHOPIFY_STORE=tvoj-handle
   export SHOPIFY_ACCESS_TOKEN='shpat_...'
   curl -sS -w "\nHTTP %{http_code}\n" \
     -H "Content-Type: application/json" \
     -H "X-Shopify-Access-Token: $SHOPIFY_ACCESS_TOKEN" \
     -d '{"query":"{ shop { name } }"}' \
     "https://${SHOPIFY_STORE}.myshopify.com/admin/api/2024-10/graphql.json"
   ```

   Očakávané: HTTP **200** a JSON s `data.shop.name`. Ak **401**, token alebo store nesedí.

5. Ak appku máš **len v Partner Dashboard** a nie v **Develop apps** v tom obchode, statický `shpat_` token tam nemusí existovať — potrebuješ **OAuth access token** po inštalácii na daný obchod, alebo zjednodušiť: vytvor **Develop apps** priamo v obchode a použi ten **Admin API access token**.

## Dashboard (Next.js na Vercel)

Priečinok [`web/`](web/): KPI, grafy (Chart.js), tabuľka posledných objednávok. Dáta z RPC `get_shopify_dashboard_mvp()` v Supabase.

```bash
cd web
cp .env.example .env.local
# doplň SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
npm install
npm run dev
```

- **Ukážkové dáta bez DB:** v UI tlačidlo „Ukážkové dáta“ alebo `GET /api/dashboard?mock=1`.
- **Vercel:** Root Directory = `web`; rovnaké env ako v `.env.example`. Voliteľne `DASHBOARD_TOKEN` a potom volať API s hlavičkou `Authorization: Bearer <token>`.

Ak GraphQL pri synci spadne na `customer`, pridaj do app scope **`read_customers`** (alebo dočasne odstráň `customer { displayName }` z query).

## Tabuľky

- `shopify_orders` (+ `customer_display_name` po migrácii `002`), `shopify_order_line_items`, `shopify_locations`, `shopify_inventory_levels`, `shopify_sync_state`

RLS je zapnuté bez politík pre anon — prístup len cez **service role** (skript / server).

## Webhooks (neskôr)

Pre takmer reálny čas môžeš doplniť Supabase Edge Function a Shopify webhooks; tento repo zatiaľ používa polling cez cron.
