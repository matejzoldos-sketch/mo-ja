"use client";

import { HeaderBrand, HeaderSectionSelect } from "../components/HeaderNav";
import MarketingMerPanel from "./MarketingMerPanel";

export default function MarketingClient() {
  return (
    <>
      <header className="site-header site-header--sklad">
        <div className="site-header__inner">
          <HeaderBrand />
          <div className="site-toolbar__filters site-toolbar__filters--under-brand">
            <HeaderSectionSelect />
          </div>
        </div>
      </header>

      <main className="main-wrap">
        <MarketingMerPanel />
      </main>
    </>
  );
}
