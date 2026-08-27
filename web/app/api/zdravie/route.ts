import { NextResponse } from "next/server";
import { isAuthorizedRequest } from "@/lib/dashboardAuth";
import { jsonNoStoreHeaders } from "@/lib/apiJsonNoStore";
import { formatRpcError, MISSING_SUPABASE_CONFIG } from "@/lib/formatRpcError";
import {
  MOJA_CASHFLOW_PERIOD_START,
  MOJA_MAIN_CASH_ACCOUNT_KEY,
  MOJA_MAIN_CASH_ACCOUNT_LABEL,
} from "@/lib/cashflowConfig";
import { buildCashflowMonths } from "@/lib/cashflowMonthly";
import type { CashflowEnrichedTx } from "@/lib/cashflowPie";
import {
  transformHybridPayload,
  type PnlXlsPayload,
} from "@/lib/pnlHybrid";
import {
  buildRunwaySummary,
  buildZdravieKpis,
  joinZdravieMonths,
  sumCashPressures,
} from "@/lib/zdravieMetrics";
import {
  supabasePostgrestGet,
  supabasePostgrestRpc,
} from "@/lib/supabasePostgrestRpc";

export const dynamic = "force-dynamic";

type BalanceRow = {
  balance?: unknown;
  currency?: unknown;
  display_iban?: unknown;
  fetched_at?: unknown;
};

type TxRow = {
  booking_date?: unknown;
  amount?: unknown;
  creditor_name?: unknown;
  debtor_name?: unknown;
  creditor_iban?: unknown;
  debtor_iban?: unknown;
  remittance_info?: unknown;
  raw_json?: unknown;
};

function stringFromRaw(raw: unknown, key: string): string | null {
  if (!raw || typeof raw !== "object") return null;
  const value = (raw as Record<string, unknown>)[key];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function tradingPartyFromRaw(raw: unknown): string | null {
  return stringFromRaw(raw, "tradingPartyIdentification");
}

function additionalInfoFromRaw(raw: unknown): string | null {
  return stringFromRaw(raw, "additionalInformation");
}

export async function GET(request: Request) {
  if (!(await isAuthorizedRequest(request))) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: jsonNoStoreHeaders }
    );
  }

  const supabaseUrl = (process.env.SUPABASE_URL || "").trim();
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json(
      { error: MISSING_SUPABASE_CONFIG },
      { status: 500, headers: jsonNoStoreHeaders }
    );
  }

  const url = new URL(request.url);
  const year = url.searchParams.get("year") ?? undefined;
  const accountKey = MOJA_MAIN_CASH_ACCOUNT_KEY;
  const periodStart = MOJA_CASHFLOW_PERIOD_START;

  const [pnlRes, balRes, txRes] = await Promise.all([
    supabasePostgrestRpc<PnlXlsPayload>(
      supabaseUrl,
      serviceKey,
      "get_pnl_xls_dashboard",
      { ...(year ? { p_year: year } : {}) }
    ),
    supabasePostgrestGet<BalanceRow[]>(
      supabaseUrl,
      serviceKey,
      `tatra_account_balances?select=balance,currency,display_iban,fetched_at&account_iban=eq.${encodeURIComponent(accountKey)}&limit=1`
    ),
    supabasePostgrestGet<TxRow[]>(
      supabaseUrl,
      serviceKey,
      `tatra_transactions?select=booking_date,amount,creditor_name,debtor_name,creditor_iban,debtor_iban,remittance_info,raw_json&account_iban=eq.${encodeURIComponent(accountKey)}&booking_date=gte.${periodStart}&order=booking_date.asc&limit=5000`
    ),
  ]);

  if (pnlRes.error) {
    return NextResponse.json(
      { error: formatRpcError(pnlRes.error, "zdravie-pnl") },
      { status: 500, headers: jsonNoStoreHeaders }
    );
  }
  if (pnlRes.data == null) {
    return NextResponse.json(
      { error: "P&L RPC returned null" },
      { status: 500, headers: jsonNoStoreHeaders }
    );
  }
  if (balRes.error) {
    return NextResponse.json(
      { error: formatRpcError(balRes.error, "zdravie-balance") },
      { status: 500, headers: jsonNoStoreHeaders }
    );
  }
  if (txRes.error) {
    return NextResponse.json(
      { error: formatRpcError(txRes.error, "zdravie-tx") },
      { status: 500, headers: jsonNoStoreHeaders }
    );
  }

  const balRow = balRes.data?.[0];
  const balance = Number(balRow?.balance);
  if (!Number.isFinite(balance)) {
    return NextResponse.json(
      { error: "Zostatok účtu nie je v databáze — spusti sync_tatra." },
      { status: 404, headers: jsonNoStoreHeaders }
    );
  }

  const currency =
    typeof balRow?.currency === "string" && balRow.currency.trim()
      ? balRow.currency.trim()
      : "EUR";

  const displayIban =
    typeof balRow?.display_iban === "string" && balRow.display_iban.trim()
      ? balRow.display_iban.trim()
      : MOJA_MAIN_CASH_ACCOUNT_LABEL;

  const lastSync =
    balRow?.fetched_at != null ? String(balRow.fetched_at) : null;

  const transactions: CashflowEnrichedTx[] = (txRes.data ?? [])
    .map((row) => {
      const creditorFromRaw = stringFromRaw(row.raw_json, "creditorName");
      const debtorFromRaw = stringFromRaw(row.raw_json, "debtorName");
      const creditorName =
        typeof row.creditor_name === "string" && row.creditor_name.trim()
          ? row.creditor_name.trim()
          : creditorFromRaw;
      const debtorName =
        typeof row.debtor_name === "string" && row.debtor_name.trim()
          ? row.debtor_name.trim()
          : debtorFromRaw;

      return {
        booking_date: String(row.booking_date ?? ""),
        amount: Number(row.amount),
        creditor_name: creditorName,
        debtor_name: debtorName,
        creditor_iban:
          typeof row.creditor_iban === "string" ? row.creditor_iban : null,
        debtor_iban: typeof row.debtor_iban === "string" ? row.debtor_iban : null,
        remittance_info:
          typeof row.remittance_info === "string" ? row.remittance_info : null,
        trading_party: tradingPartyFromRaw(row.raw_json),
        additional_info: additionalInfoFromRaw(row.raw_json),
      };
    })
    .filter(
      (row) =>
        row.booking_date && Number.isFinite(row.amount) && row.amount !== 0
    );

  const { rows: cashMonths, openingAtPeriodStart, ytdNet } =
    buildCashflowMonths(balance, transactions, periodStart);

  const pnl = transformHybridPayload(pnlRes.data);
  const joined = joinZdravieMonths(pnl, cashMonths);
  const pressures = sumCashPressures(transactions);
  const runway = buildRunwaySummary(cashMonths);
  const kpis = buildZdravieKpis({
    pnl,
    joined,
    currentBalance: balance,
    ytdNetCash: ytdNet,
    openingAtPeriodStart,
    cashLastSync: lastSync,
    pressures,
  });

  return NextResponse.json(
    {
      meta: {
        accountLabel: displayIban,
        periodStart,
        currency,
        lastSync,
        pnlNote: pnl.meta.note,
        pnlYear: pnl.meta.year,
        mode: "hybrid" as const,
        cogsRate: 0.42,
      },
      kpis,
      months: joined,
      cashMonths,
      runway,
      pressures: {
        owner: pressures.owner,
        orin: pressures.orin,
      },
      costMix: {
        cogs: pnl.totals.cogs,
        marketing: pnl.totals.marketing_spend,
        staff: pnl.totals.staff_spend,
        otherOpex: Math.max(
          0,
          pnl.totals.total_opex -
            pnl.totals.marketing_spend -
            pnl.totals.staff_spend
        ),
      },
    },
    { headers: jsonNoStoreHeaders }
  );
}
