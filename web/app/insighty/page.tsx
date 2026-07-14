import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  title: "MO–JA insighty",
  description: "Riziká a príležitosti na základe dát",
};

export default function InsightyPage() {
  redirect("/");
}

