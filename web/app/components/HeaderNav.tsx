"use client";

import { usePathname, useRouter } from "next/navigation";

export function HeaderBrand() {
  return <span className="header-brand-nav__title">MO–JA dashboard</span>;
}

export function HeaderSectionSelect() {
  const pathname = usePathname();
  const router = useRouter();
  const section = pathname === "/sklad" ? "sklad" : "predaj";

  return (
    <select
      className="period-filter__select"
      value={section}
      onChange={(e) => {
        const v = e.target.value;
        router.push(v === "sklad" ? "/sklad" : "/");
      }}
      aria-label="Sekcia"
    >
      <option value="predaj">Predaj</option>
      <option value="sklad">Sklad</option>
    </select>
  );
}
