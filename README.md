# mo-ja — Shopify → Supabase

Synchronizácia **objednávok**, **riadkov**, **lokácií** a **skladových zásob** z Shopify Admin API do Postgres (Supabase).

## Požiadavky

- Shopify **Admin API** prístup so scopes: `read_inventory`, `read_locations`, **`read_products`** (bez neho často chýba `variant` / `inventoryItem` na riadkoch objednávok → Sklad nevie spájať predaj so skladom) a **`read_all_orders`** (pre YTD — bez neho ~**posledných 60 dní** objednávok). Alternatíva `read_orders` len s kratšou históriou.
- **`customer_id` na objednávkach** (pre KPI „vracajúci sa“ na dashboarde): v `sync_shopify.py` je v GraphQL `customer { id }`. Ak sync spadne alebo `customer` chýba, v Dev apps doplň scope **`read_customers`**. Meno zákazníka (`displayName`) sync stále defaultne neťahá — treba ho doplniť do query + `read_customers`.

### Od 1. 1. 2026 (Dev Dashboard)

Shopify už **nepovoľuje nové** „legacy“ custom appky v admine s jednorazovým **Reveal** tokenom. Nové appky vznikajú v **[Dev Dashboard](https://dev.shopify.com/dashboard/)**; autentifikácia je **Client ID + Client secret** a skript si cez [client credentials grant](https://shopify.dev/docs/apps/build/dev-dashboard/get-api-access-tokens) vyžiada krátkodobý `access_token` (nemusí začínať `shpat_`).

V `.env` / GitHub Secrets nastav **`SHOPIFY_CLIENT_ID`** a **`SHOPIFY_CLIENT_SECRET`** z Dev Dashboard → appka → **Settings** (a **`SHOPIFY_STORE`**). **`SHOPIFY_ACCESS_TOKEN`** môže byť prázdny — ak sú vyplnené Client ID aj secret, skript ich použije namiesto neho.

Staršie obchody s existujúcou legacy appkou môžu naďalej používať len **`SHOPIFY_ACCESS_TOKEN`**.
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
   python sync_shopify.py
   ```

## Použitie `sync_shopify.py`

| Príkaz | Popis |
|--------|--------|
| `python sync_shopify.py` | Predvolené: objednávky s `created_at` od 1. 1. **aktuálneho roka** + lokácie + sklad (zhoda s YTD v dashboarde) |
| `python sync_shopify.py --days 7` | Len objednávky s `updated_at` ≥ dnes − N dní (rýchly inkrementálny beh) |
| `python sync_shopify.py --ytd` | Objednávky s `created_at` ≥ 1. január **aktuálneho roka** |
| `python sync_shopify.py --ytd --ytd-year 2026` | Rovnaké pre konkrétny rok |
| `python sync_shopify.py --from 2026-01-01` | `updated_at` ≥ dátum |
| `python sync_shopify.py --orders-only` | Bez inventory |
| `python sync_shopify.py --inventory-only` | Len lokácie + sklad (lokácie sa stiahnu vždy kvôli FK) |

## GitHub Actions

V repozitári nastav **Secrets**:

- `SHOPIFY_STORE`
- **Buď** `SHOPIFY_CLIENT_ID` + `SHOPIFY_CLIENT_SECRET` (Dev Dashboard, od 2026), **alebo** `SHOPIFY_ACCESS_TOKEN` (legacy custom app)
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
- voliteľne `SHOPIFY_API_VERSION`

Workflow: každý deň o ~04:15 UTC beh **`--ytd`** (objednávky vytvorené od 1. 1., aby YTD metriky v Sklade sedeli s dátami v DB). Manuálne `workflow_dispatch`: **`ytd`** = rovnaké; **`daily`** = rýchly beh len `updated_at` za posledných 14 dní.

### Shopify 401 / „Invalid API key or access token“

1. **`SHOPIFY_ACCESS_TOKEN`** musí byť **Admin API access token** z **obchodného adminu**: **Settings → Apps and sales channels → Develop apps → [appka] → API credentials → Reveal** (až po **Install app**). Prefix môže byť napr. **`shpat_`**, **`shpca_`**, **`shpss_`**, **`shpua_`** (závisí od typu appky) — ide o **celý** reťazec z Reveal.  
   **Nie** Client secret, **nie** „API secret key“ z Partner Dashboardu, **nie** API key z karty Configuration.

2. **`SHOPIFY_STORE`** = len handle (napr. `yttmhc-p0`), nie celá URL. **Musí to byť ten istý obchod**, v ktorom si vygeneroval token (iný handle → **401** aj pri správnom `shpss_` / `shpat_`).

3. Po spustení Actions v logu skontroluj **`Token prefix OK`**. Ak áno a predsa **401**, skontroluj znova bod 2, pridaj GitHub secret **`SHOPIFY_API_VERSION`** = `2026-01` (alebo aktuálnu verziu z [Shopify API versioning](https://shopify.dev/docs/api/usage/versioning)), prípadne v appke **znova Reveal** tokenu po reinstall.

4. Rýchly test v termináli (lokálne, token nezdieľaj):

   ```bash
   export SHOPIFY_STORE=tvoj-handle
   export SHOPIFY_ACCESS_TOKEN='shpat_...'
   curl -sS -w "\nHTTP %{http_code}\n" \
     -H "Content-Type: application/json" \
     -H "X-Shopify-Access-Token: $SHOPIFY_ACCESS_TOKEN" \
     -d '{"query":"{ shop { name } }"}' \
     "https://${SHOPIFY_STORE}.myshopify.com/admin/api/2026-01/graphql.json"
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

- **Ukážkové dáta bez DB:** v UI tlačidlo „Ukážkové dáta“ alebo `GET /api/dashboard?mock=1` (aj mock vyžaduje prihlásenie, ak je zapnuté heslo).
- **Vercel:** Root Directory = `web`; rovnaké env ako v `.env.example`.
- **Zamknutie dashboardu:** nastav **`DASHBOARD_PASSWORD`** (silné heslo). Potom `/` a `/sklad` presmerujú na `/login`; po zadaní hesla sa nastaví httpOnly cookie (30 dní). API `/api/dashboard` a `/api/inventory` akceptujú buď túto cookie, alebo hlavičku `Authorization: Bearer <rovnaké heslo>` (napr. skripty). Spätne kompatibilné: ak máš len **`DASHBOARD_TOKEN`**, správa sa ako heslo (rovnaké správanie). Ak nie je ani heslo ani token, aplikácia ostáva otvorená ako doteraz.
- **Nečinnosť:** po **30 minútach** bez aktivity (myš, klávesnica, scroll, dotyk) sa zavolá odhlásenie a presmeruje na `/login`. Nastav **`NEXT_PUBLIC_DASHBOARD_IDLE_MINUTES`** (minimum 5, maximum 1440), ak chceš inú hodnotu — po zmene treba znova build / redeploy.

Ak GraphQL pri synci spadne na poli `customer`, pridaj do app scope **`read_customers`**. Po migrácii **`015_shopify_orders_customer_id_returning_kpi.sql`** spusti znova **`python sync_shopify.py --ytd`** (alebo širší beh), aby sa doplnil `customer_id` na už existujúce objednávky.

**KPI „Vracajúci sa“** na dashboarde: počíta sa len z objednávok so **`customer_id`** (nie guest). Percento = unikátny zákazník v období so „paid-ish“ stavom, ktorý mal aspoň jednu rovnakú kategóriu objednávku **pred** začiatkom obdobia (dátumy podľa `Europe/Bratislava`). Neúplná história v DB (krátky `read_orders` okno) môže metriku **podhodnotiť**.

## Tabuľky

- `shopify_orders` (`customer_display_name` po `002`, `customer_id` po `015`), `shopify_order_line_items`, `shopify_locations`, `shopify_inventory_levels`, `shopify_sync_state`

RLS je zapnuté bez politík pre anon — prístup len cez **service role** (skript / server).

## Webhooks (neskôr)

Pre takmer reálny čas môžeš doplniť Supabase Edge Function a Shopify webhooks; tento repo zatiaľ používa polling cez cron.
