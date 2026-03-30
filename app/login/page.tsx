"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });

      if (res.ok) {
        router.push("/");
      } else {
        const data = await res.json();
        setError(data.error || "Neplatné přihlašovací údaje");
      }
    } catch {
      setError("Chyba při přihlašování");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <form
        onSubmit={handleSubmit}
        className="bg-primary-light rounded-2xl p-8 w-full max-w-sm space-y-6"
      >
        <h1 className="text-2xl font-bold text-center">PPL Quiz Trainer</h1>
        <p className="text-center text-gray-400 text-sm">
          Přihlaste se pro přístup
        </p>

        {error && (
          <div className="bg-incorrect/20 text-incorrect text-sm rounded-lg p-3 text-center">
            {error}
          </div>
        )}

        <div className="space-y-4">
          <input
            type="text"
            placeholder="Uživatelské jméno"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="w-full px-4 py-3 rounded-lg bg-primary border border-gray-700 text-white placeholder-gray-500 focus:outline-none focus:border-accent"
            required
            autoFocus
          />
          <input
            type="password"
            placeholder="Heslo"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full px-4 py-3 rounded-lg bg-primary border border-gray-700 text-white placeholder-gray-500 focus:outline-none focus:border-accent"
            required
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full py-3 rounded-lg bg-accent hover:bg-accent-hover text-primary font-bold transition-colors disabled:opacity-50"
        >
          {loading ? "Přihlašování..." : "Přihlásit se"}
        </button>
      </form>
    </div>
  );
}
