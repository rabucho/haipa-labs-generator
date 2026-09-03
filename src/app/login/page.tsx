"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/** /login — internal operator sign-in (no public signup). */
export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const body = (await res.json()) as { ok: boolean; errors?: string[] };
      if (!res.ok || !body.ok) {
        setError(body.errors?.[0] ?? "Sign-in failed.");
        return;
      }
      router.push("/dashboard");
      router.refresh();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="container" style={{ padding: "6rem 0", maxWidth: 420 }}>
      <span className="eyebrow">Haipa Labs · Internal</span>
      <h1 className="section-title">Operator sign-in</h1>
      <form onSubmit={handleSubmit} noValidate>
        <div style={{ marginBottom: "1rem" }}>
          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="username"
            required
          />
        </div>
        <div style={{ marginBottom: "1rem" }}>
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </div>
        {error && <p role="alert">{error}</p>}
        <button type="submit" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
      <p style={{ marginTop: "2rem", fontSize: "0.875rem", color: "var(--color-text-muted)" }}>
        Internal tool — operator accounts are provisioned by the seed script,
        not by public signup.
      </p>
    </main>
  );
}
