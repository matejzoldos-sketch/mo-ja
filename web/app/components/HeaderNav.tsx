"use client";

import { usePathname, useRouter } from "next/navigation";

export type DashboardSection =
  | "predaj"
  | "cashflow"
  | "sklad"
  | "insighty"
  | "marketing";

const SECTIONS: {
  id: DashboardSection;
  label: string;
  path: string;
  subtitle: string;
}[] = [
  { id: "predaj", label: "Predaj", path: "/", subtitle: "Predaj" },
  { id: "cashflow", label: "Cash flow", path: "/cashflow", subtitle: "Cash flow" },
  { id: "sklad", label: "Sklad", path: "/sklad", subtitle: "Sklad" },
  { id: "insighty", label: "Insighty", path: "/insighty", subtitle: "Insighty" },
  { id: "marketing", label: "Marketing", path: "/marketing", subtitle: "Marketing" },
];

/** Dočasne skryté v hlavnom menu — stránka /insighty ostáva dostupná priamo. */
const HIDDEN_NAV_SECTIONS = new Set<DashboardSection>(["insighty"]);

const NAV_SECTIONS = SECTIONS.filter((s) => !HIDDEN_NAV_SECTIONS.has(s.id));

function sectionFromPathname(pathname: string): DashboardSection {
  if (pathname === "/cashflow") return "cashflow";
  if (pathname === "/sklad") return "sklad";
  if (pathname === "/insighty") return "insighty";
  if (pathname === "/marketing") return "marketing";
  return "predaj";
}

export function HeaderBrand() {
  const pathname = usePathname();
  const section = sectionFromPathname(pathname);
  const subtitle =
    SECTIONS.find((s) => s.id === section)?.subtitle ?? "Prehľad";

  return (
    <div className="header-brand">
      <span className="header-brand__mark" aria-hidden />
      <div className="header-brand__text">
        <span className="header-brand__title">MO–JA</span>
        <span className="header-brand__subtitle">{subtitle}</span>
      </div>
    </div>
  );
}

export function HeaderSectionSelect() {
  const pathname = usePathname();
  const router = useRouter();
  const section = sectionFromPathname(pathname);

  const go = (id: DashboardSection) => {
    const target = SECTIONS.find((s) => s.id === id);
    router.push(target?.path ?? "/");
  };

  return (
    <div className="header-section-switch" role="navigation" aria-label="Menu">
      <div className="header-section-switch__segmented" role="tablist">
        {NAV_SECTIONS.map((s) => (
          <button
            key={s.id}
            type="button"
            role="tab"
            aria-selected={section === s.id}
            className={
              section === s.id
                ? "header-section-switch__btn is-active"
                : "header-section-switch__btn"
            }
            onClick={() => go(s.id)}
          >
            {s.label}
          </button>
        ))}
      </div>

      <select
        className="period-filter__select header-section-switch__select"
        value={section}
        onChange={(e) => go(e.target.value as DashboardSection)}
        aria-label="Sekcia"
      >
        {NAV_SECTIONS.map((s) => (
          <option key={s.id} value={s.id}>
            {s.label}
          </option>
        ))}
      </select>
    </div>
  );
}
