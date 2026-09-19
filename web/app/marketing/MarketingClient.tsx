"use client";

import { HeaderBrand, HeaderSectionSelect } from "../components/HeaderNav";
import MarketingMerPanel from "./MarketingMerPanel";
import MarketingUtmClient from "./MarketingUtmClient";

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
        <div style={{ marginTop: "1.25rem" }}>
          <h2 className="dashboard-card__title">UTM atribúcia</h2>
          <p className="dashboard-meta dashboard-meta--hint">
            Google Ads, Meta Ads a revenue z UTM atribúcie v jednom pohľade.
          </p>
          <MarketingUtmClient embedded />
        </div>
      </main>
    </>
  );
}
