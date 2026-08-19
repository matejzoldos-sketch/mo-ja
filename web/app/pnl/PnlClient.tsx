"use client";

import { HeaderBrand, HeaderSectionSelect } from "../components/HeaderNav";
import PnlPanel from "./PnlPanel";

export default function PnlClient() {
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
        <PnlPanel />
      </main>
    </>
  );
}
