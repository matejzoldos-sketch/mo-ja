import type { Metadata } from "next";
import InsightyClient from "./InsightyClient";

export const metadata: Metadata = {
  title: "MO–JA insighty",
  description: "Riziká a príležitosti na základe dát",
};

export default function InsightyPage() {
  return <InsightyClient />;
}

