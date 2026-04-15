'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

function safeRedirectPath(from: string | null): string {
  if (!from || !from.startsWith('/') || from.startsWith('//')) return '/';
  return from;
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);

  const from = safeRedirectPath(searchParams.get('from'));

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setPending(true);
    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
        credentials: 'include',
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(typeof data.error === 'string' ? data.error : 'Login failed');
        return;
      }
      router.push(from);
      router.refresh();
    } catch {
      setError('Network error');
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="min-h-screen h-screen bg-empire-dark flex items-center justify-center p-6">
      <div className="medieval-frame w-full max-w-md shadow-2xl">
        <div className="medieval-frame-inner p-8 md:p-10">
          <h1 className="medieval-title font-[family-name:var(--font-cinzel-decorative)] text-2xl md:text-3xl text-center mb-2 tracking-wide">
            Fallen Empire
          </h1>
          <p className="text-center text-empire-parchment/55 text-sm mb-8 font-[family-name:var(--font-medieval)]">
            Enter the site password to continue
          </p>

          <form onSubmit={onSubmit} className="space-y-5">
            <div>
              <label
                htmlFor="site-password"
                className="block text-xs uppercase tracking-wider text-empire-parchment/50 mb-2"
              >
                Password
              </label>
              <input
                id="site-password"
                name="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-3 rounded border border-empire-gold/25 bg-empire-dark/80 text-empire-parchment placeholder:text-empire-parchment/30 focus:outline-none focus:border-empire-gold/50 focus:ring-1 focus:ring-empire-gold/30"
                placeholder="••••••••"
                disabled={pending}
                required
              />
            </div>

            {error ? (
              <p className="text-red-400/90 text-sm text-center" role="alert">
                {error}
              </p>
            ) : null}

            <button
              type="submit"
              disabled={pending}
              className="w-full py-3 rounded border border-empire-gold/40 bg-empire-gold/10 text-empire-parchment font-medium tracking-wide hover:bg-empire-gold/20 hover:border-empire-gold/55 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {pending ? 'Entering…' : 'Enter'}
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen h-screen bg-empire-dark flex items-center justify-center text-empire-parchment/50 text-sm">
          Loading…
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
