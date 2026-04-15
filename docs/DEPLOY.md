# Deploy Fallen Empire (private site)

The game is a standard **Next.js 14** app. All gameplay runs in the browser; hosting is “build + serve.”

## 1. Environment variables (Vercel) — optional

**Production** uses built-in defaults for the password gate (see [`src/lib/siteAuth.ts`](../src/lib/siteAuth.ts)), so you do **not** need to set anything in Vercel for protection to work.

To **change** the password or rotate the session signing key, add in **Settings → Environment Variables**:

| Name | Value |
|------|--------|
| `SITE_PASSWORD` | Shared password shown on `/login` |
| `COOKIE_SECRET` | Long random secret (e.g. `openssl rand -hex 32`); changing it logs everyone out |

**Local dev:** Unset = no gate. Set both in `.env.local` (see [`.env.example`](../.env.example)) to test `/login` locally.

Copy [`.env.example`](../.env.example) to `.env.local` locally when testing the gate:

```bash
cp .env.example .env.local
# Edit .env.local — uncomment and set SITE_PASSWORD and COOKIE_SECRET
```

## 2. Push to GitHub

```bash
git add .
git commit -m "Prepare for deploy"
git remote add origin <your-repo-url>   # if needed
git push -u origin main
```

## 3. Connect Vercel

1. Go to [vercel.com](https://vercel.com) and **Add New → Project**.
2. Import the GitHub repository.
3. Framework preset: **Next.js** (auto-detected).
4. Add the environment variables above (Production + Preview if you want auth on previews).
5. **Deploy**.

After deploy, open the production URL. You should be redirected to `/login` until you enter `SITE_PASSWORD`.

## 4. Custom domain (optional)

In Vercel: **Project → Settings → Domains** — add your domain and follow DNS instructions.

## Notes

- **HTTPS:** Vercel provides TLS; the auth cookie uses `Secure` in production.
- **Dev-only API routes** (`/api/workflow`, `/api/evolve`) use the filesystem; they may error on Vercel and are not required to play the game.
- **Logout:** `DELETE /api/auth` clears the session cookie (optional; not wired in the UI).
