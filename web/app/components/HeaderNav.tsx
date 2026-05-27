"use client";

import { usePathname, useRouter } from "next/navigation";

export function HeaderBrand() {
  const pathname = usePathname();
  const section =
    pathname === "/sklad"
      ? "Sklad"
      : pathname === "/insighty"
        ? "Insighty"
        : pathname === "/"
          ? "Predaj"
          : "Prehľad";

  return (
    <div className="header-brand">
      <span className="header-brand__mark" aria-hidden />
      <div className="header-brand__text">
        <span className="header-brand__title">MO–JA</span>
        <span className="header-brand__subtitle">{section}</span>
      </div>
    </div>
  );
}

export function HeaderSectionSelect() {
  const pathname = usePathname();
  const router = useRouter();
  const section =
    pathname === "/sklad" ? "sklad" : pathname === "/insighty" ? "insighty" : "predaj";

  return (
    <select
      className="period-filter__select"
      value={section}
      onChange={(e) => {
        const v = e.target.value;
        router.push(v === "sklad" ? "/sklad" : v === "insighty" ? "/insighty" : "/");
      }}
      aria-label="Sekcia"
    >
      <option value="predaj">Predaj</option>
      <option value="sklad">Sklad</option>
      <option value="insighty">Insighty</option>
    </select>
  );
}
