"use client";

import { usePathname, useRouter } from "next/navigation";

export function HeaderBrand() {
  const pathname = usePathname();
  const section =
    pathname === "/sklad"
      ? "Sklad"
      : pathname === "/insighty"
        ? "Insighty"
        : pathname === "/marketing"
          ? "Marketing"
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
    pathname === "/sklad"
      ? "sklad"
      : pathname === "/insighty"
        ? "insighty"
        : pathname === "/marketing"
          ? "marketing"
          : "predaj";

  const go = (v: "predaj" | "sklad" | "insighty" | "marketing") => {
    router.push(
      v === "sklad"
        ? "/sklad"
        : v === "insighty"
          ? "/insighty"
          : v === "marketing"
            ? "/marketing"
            : "/"
    );
  };

  return (
    <div className="header-section-switch" role="navigation" aria-label="Menu">
      <div className="header-section-switch__segmented" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={section === "predaj"}
          className={
            section === "predaj"
              ? "header-section-switch__btn is-active"
              : "header-section-switch__btn"
          }
          onClick={() => go("predaj")}
        >
          Predaj
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={section === "sklad"}
          className={
            section === "sklad"
              ? "header-section-switch__btn is-active"
              : "header-section-switch__btn"
          }
          onClick={() => go("sklad")}
        >
          Sklad
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={section === "insighty"}
          className={
            section === "insighty"
              ? "header-section-switch__btn is-active"
              : "header-section-switch__btn"
          }
          onClick={() => go("insighty")}
        >
          Insighty
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={section === "marketing"}
          className={
            section === "marketing"
              ? "header-section-switch__btn is-active"
              : "header-section-switch__btn"
          }
          onClick={() => go("marketing")}
        >
          Marketing
        </button>
      </div>

      <select
        className="period-filter__select header-section-switch__select"
        value={section}
        onChange={(e) =>
          go(e.target.value as "predaj" | "sklad" | "insighty" | "marketing")
        }
        aria-label="Sekcia"
      >
        <option value="predaj">Predaj</option>
        <option value="sklad">Sklad</option>
        <option value="insighty">Insighty</option>
        <option value="marketing">Marketing</option>
      </select>
    </div>
  );
}
