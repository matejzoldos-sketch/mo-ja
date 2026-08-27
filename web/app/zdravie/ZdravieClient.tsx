"use client";

import { HeaderBrand, HeaderSectionSelect } from "../components/HeaderNav";
import ZdraviePanel from "./ZdraviePanel";

export default function ZdravieClient() {
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
        <ZdraviePanel />
      </main>
    </>
  );
}
