"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

export default function LoginClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function safeNext(raw: string | null): string {
    if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return "/";
    return raw;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
        credentials: "include",
      });
      if (!res.ok) {
        setError("Nesprávne heslo.");
        return;
      }
      router.push(safeNext(searchParams.get("next")));
      router.refresh();
    } catch {
      setError("Sieťová chyba.");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="main-wrap login-page">
      <div className="login-card">
        <h1 className="login-card__title">MO–JA dashboard</h1>
        <p className="login-card__hint">Zadaj heslo na pokračovanie.</p>
        <form onSubmit={onSubmit} className="login-form">
          <label className="login-form__label" htmlFor="pw">
            Heslo
          </label>
          <input
            id="pw"
            name="password"
            type="password"
            autoComplete="current-password"
            className="login-form__input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={pending}
            required
          />
          {error ? <p className="login-form__error">{error}</p> : null}
          <button type="submit" className="login-form__submit" disabled={pending}>
            {pending ? "Prihlasujem…" : "Prihlásiť sa"}
          </button>
        </form>
      </div>
    </main>
  );
}
