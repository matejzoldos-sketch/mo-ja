"use client";

import { useEffect, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { HeaderBrand, HeaderSectionSelect } from "../components/HeaderNav";
import { PeriodFilterMenu } from "../components/PeriodFilterMenu";
import {
  currentCalendarYm,
  periodFilterNeedsUrlNormalize,
  periodFilterToSearchParams,
  parsePeriodFilter,
  type PeriodFilter,
} from "@/lib/dashboardPeriodFilter";
import MarketingMerPanel from "./MarketingMerPanel";

/** Default: aktuálny mesiac — scorecards = mesiac vs predchádzajúci (MoM). */
function defaultMarketingPeriod(): PeriodFilter {
  return { range: "month", month: currentCalendarYm() };
}

export default function MarketingClient() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const rangeRaw = searchParams.get("range");
  const monthRaw = searchParams.get("month");
  const yearRaw = searchParams.get("year");

  const period = useMemo(() => {
    if (!rangeRaw && !monthRaw && !yearRaw) {
      return defaultMarketingPeriod();
    }
    return parsePeriodFilter(rangeRaw, monthRaw, yearRaw, {
      defaultRange: "month",
    });
  }, [rangeRaw, monthRaw, yearRaw]);

  useEffect(() => {
    const view = searchParams.get("view");
    const dim = searchParams.get("dim");
    const missingPeriod = !rangeRaw && !monthRaw && !yearRaw;
    const needsNormalize = periodFilterNeedsUrlNormalize(
      rangeRaw,
      monthRaw,
      yearRaw
    );
    if (!needsNormalize && !view && !dim && !missingPeriod) return;

    const next = missingPeriod
      ? defaultMarketingPeriod()
      : parsePeriodFilter(rangeRaw, monthRaw, yearRaw, {
          defaultRange: "month",
        });
    const params = periodFilterToSearchParams(next, searchParams);
    params.delete("view");
    params.delete("dim");
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [searchParams, pathname, router, rangeRaw, monthRaw, yearRaw]);

  const setPeriodInUrl = (next: PeriodFilter) => {
    const params = periodFilterToSearchParams(next, searchParams);
    params.delete("view");
    params.delete("dim");
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  return (
    <>
      <header className="site-header site-header--sklad">
        <div className="site-header__inner">
          <HeaderBrand />
          <div className="site-toolbar__filters site-toolbar__filters--under-brand">
            <HeaderSectionSelect />
          </div>
        </div>
        <div className="site-toolbar">
          <div className="site-toolbar__filters">
            <PeriodFilterMenu period={period} onChange={setPeriodInUrl} />
          </div>
        </div>
      </header>

      <main className="main-wrap">
        <MarketingMerPanel period={period} />
      </main>
    </>
  );
}
