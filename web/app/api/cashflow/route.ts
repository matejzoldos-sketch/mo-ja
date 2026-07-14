import { NextResponse } from "next/server";
import { isAuthorizedRequest } from "@/lib/dashboardAuth";
import {
  MOJA_CASHFLOW_PERIOD_START,
  MOJA_MAIN_CASH_ACCOUNT_KEY,
  MOJA_MAIN_CASH_ACCOUNT_LABEL,
} from "@/lib/cashflowConfig";
import { buildCashflowMonths } from "@/lib/cashflowMonthly";
import { supabasePostgrestGet } from "@/lib/supabasePostgrestRpc";

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
};

export async function GET(request: Request) {
  if (!(await isAuthorizedRequest(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabaseUrl = (process.env.SUPABASE_URL || "").trim();
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!supabaseUrl || !serviceKey) {
    const missing = [
      !supabaseUrl && "SUPABASE_URL",
      !serviceKey && "SUPABASE_SERVICE_ROLE_KEY",
    ].filter(Boolean);
    return NextResponse.json(
      { error: `Chýbajú env: ${missing.join(", ")}` },
      { status: 500 }
    );
  }

  const accountKey = MOJA_MAIN_CASH_ACCOUNT_KEY;
  const periodStart = MOJA_CASHFLOW_PERIOD_START;

  const [balRes, txRes] = await Promise.all([
    supabasePostgrestGet<BalanceRow[]>(
      supabaseUrl,
      serviceKey,
      `tatra_account_balances?select=balance,currency,display_iban,fetched_at&account_iban=eq.${encodeURIComponent(accountKey)}&limit=1`
    ),
    supabasePostgrestGet<TxRow[]>(
      supabaseUrl,
      serviceKey,
      `tatra_transactions?select=booking_date,amount,creditor_name,debtor_name,creditor_iban,debtor_iban,remittance_info&account_iban=eq.${encodeURIComponent(accountKey)}&booking_date=gte.${periodStart}&order=booking_date.asc&limit=5000`
    ),
  ]);

  if (balRes.error) {
    return NextResponse.json({ error: `[cashflow-balance] ${balRes.error}` }, { status: 500 });
  }
  if (txRes.error) {
    return NextResponse.json({ error: `[cashflow-tx] ${txRes.error}` }, { status: 500 });
  }

  const balRow = balRes.data?.[0];
  const balance = Number(balRow?.balance);
  if (!Number.isFinite(balance)) {
    return NextResponse.json(
      { error: "Zostatok účtu nie je v databáze — spusti sync_tatra." },
      { status: 404 }
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

  const transactions = (txRes.data ?? [])
    .map((row) => ({
      booking_date: String(row.booking_date ?? ""),
      amount: Number(row.amount),
      creditor_name:
        typeof row.creditor_name === "string" ? row.creditor_name : null,
      debtor_name: typeof row.debtor_name === "string" ? row.debtor_name : null,
      creditor_iban:
        typeof row.creditor_iban === "string" ? row.creditor_iban : null,
      debtor_iban: typeof row.debtor_iban === "string" ? row.debtor_iban : null,
      remittance_info:
        typeof row.remittance_info === "string" ? row.remittance_info : null,
    }))
    .filter((row) => row.booking_date && Number.isFinite(row.amount));

  const { rows, openingAtPeriodStart, ytdNet } = buildCashflowMonths(
    balance,
    transactions,
    periodStart
  );

  return NextResponse.json({
    meta: {
      accountLabel: displayIban,
      periodStart,
      currency,
      lastSync,
      openingDerived: true,
    },
    kpis: {
      currentBalance: balance,
      ytdNet,
      openingAtPeriodStart,
      transactionCount: transactions.length,
    },
    months: rows,
    transactions,
  });
}
