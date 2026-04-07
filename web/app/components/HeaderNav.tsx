"use client";

import { usePathname, useRouter } from "next/navigation";

export function HeaderNav() {
  const pathname = usePathname();
  const router = useRouter();
  const section = pathname === "/sklad" ? "sklad" : "predaj";

  return (
    <div className="header-brand-nav">
      <span className="header-brand-nav__title">MO–JA</span>
      <label className="period-filter header-brand-nav__section">
        <span className="period-filter__label">Sekcia</span>
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
      </label>
    </div>
  );
}
