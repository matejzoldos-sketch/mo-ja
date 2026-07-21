"use client";

import { useEffect, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { HeaderBrand, HeaderSectionSelect } from "../components/HeaderNav";
import { PeriodFilterMenu } from "../components/PeriodFilterMenu";
import {
  periodFilterNeedsUrlNormalize,
  periodFilterToSearchParams,
  parsePeriodFilter,
  type PeriodFilter,
} from "@/lib/dashboardPeriodFilter";
import MarketingMerPanel from "./MarketingMerPanel";

export default function MarketingClient() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const rangeRaw = searchParams.get("range");
  const monthRaw = searchParams.get("month");
  const yearRaw = searchParams.get("year");

  const period = useMemo(() => {
    if (!rangeRaw && !monthRaw && !yearRaw) {
      return { range: "year" as const, year: "2026" };
    }
    return parsePeriodFilter(rangeRaw, monthRaw, yearRaw, {
      defaultRange: "year",
    });
  }, [rangeRaw, monthRaw, yearRaw]);

  useEffect(() => {
    const view = searchParams.get("view");
    const dim = searchParams.get("dim");
    const needsNormalize = periodFilterNeedsUrlNormalize(
      rangeRaw,
      monthRaw,
      yearRaw
    );
    if (!needsNormalize && !view && !dim) return;

    const next = parsePeriodFilter(rangeRaw, monthRaw, yearRaw, {
      defaultRange: "year",
    });
    const params = periodFilterToSearchParams(next, searchParams);
    params.delete("view");
    params.delete("dim");
    if (!rangeRaw && !monthRaw && !yearRaw) {
      params.set("range", "year");
      params.set("year", "2026");
      params.delete("month");
    }
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
