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

## 5. Multiplayer game server (Railway) + Vercel client

The **Next.js app** can stay on **Vercel**. **Online 1v1** also needs the **WebSocket game process** in [`game-server/`](../game-server/) running 24/7 — that is **not** run on Vercel. **Railway** (or similar) hosts that process; the browser connects from your Vercel URL to Railway over **`wss://`**.

### 5.1 Create the Railway service (same GitHub repo)

The game server imports **`src/`** from the repo root (`../../src/...` from `game-server`). **Railpack** (auto-detect) often fails on a monorepo (“Error creating build plan with Railpack”). This repo uses **`game-server/Dockerfile`** with **build context = repository root** so both `src/` and `game-server/` are included. [`railway.toml`](../railway.toml) at the repo root sets the Docker builder.

1. In [Railway](https://railway.app): **New project** → **Deploy from GitHub repo** → select this repository.
2. Open the service **Settings → Build**:
   - **Root Directory:** leave **empty** (repo root), **not** `game-server`.  
     If Root Directory is set to only `game-server`, the Docker build cannot see `src/` and will fail.
   - **Builder:** **Dockerfile** (or let Railway read [`railway.toml`](../railway.toml) after redeploy).
   - **Dockerfile path:** `game-server/Dockerfile`
3. **Deploy** — the image runs `npm start` inside `/app/game-server` (see the Dockerfile).
4. **Generate domain:** **Settings → Networking → Public Networking** → generate a public URL (e.g. `*.up.railway.app`). Browsers use **`wss://`** to the **same host** for WebSockets.

### 5.2 Environment variable on Vercel (connect the two products)

In **Vercel → your Next.js project → Settings → Environment Variables** (Production):

| Name | Value |
|------|--------|
| `NEXT_PUBLIC_MULTIPLAYER_WS_URL` | `wss://YOUR-RAILWAY-PUBLIC-HOST` |

Example: if Railway shows `https://fallen-empire-game-production-xxxx.up.railway.app`, set:

`NEXT_PUBLIC_MULTIPLAYER_WS_URL=wss://fallen-empire-game-production-xxxx.up.railway.app`

(No path suffix — the game client opens a WebSocket to the service root.)

Redeploy Vercel after saving so the client bundle picks up the variable.

### 5.3 What runs where

| Piece | Host |
|--------|------|
| Next.js UI | Vercel |
| `game-server` (WS + sim ticks) | Railway |
| Browser | Uses `NEXT_PUBLIC_MULTIPLAYER_WS_URL` → Railway |

You do **not** merge the two into one deploy: two hosts, one env var links them.

### 5.4 Local check

Terminal A: `npm run game-server` from repo root.  
Terminal B: `npm run dev`, open the app, **1v1 Online** — should connect to `ws://127.0.0.1:3333` by default.

---

## Notes

- **HTTPS:** Vercel provides TLS; the auth cookie uses `Secure` in production.
- **Dev-only API routes** (`/api/workflow`, `/api/evolve`) use the filesystem; they may error on Vercel and are not required to play the game.
- **Logout:** `DELETE /api/auth` clears the session cookie (optional; not wired in the UI).
