# Security Audit Report — Cabinet

**Date:** 2026-04-14
**Scope:** Full application (Next.js app, terminal WebSocket server, agent runners, storage layer)
**Reviewer:** Automated source review

## Executive Summary

Cabinet is a self-hosted Next.js 16 knowledge base storing markdown on disk under `/data`. Architecture shows security-conscious patterns (path validation, salted password hash, middleware auth) but several **Critical** issues exist — most notably an **unauthenticated WebSocket endpoint that spawns a Claude CLI shell with `--dangerously-skip-permissions`**, combined with `Access-Control-Allow-Origin: *`. Any website a logged-in user visits could fully compromise the host.

| # | Severity | Title |
|---|----------|-------|
| 1 | Critical | Unauthenticated WebSocket RCE via terminal server |
| 2 | Critical | Terminal HTTP/WS server bypasses Next.js auth middleware |
| 3 | Critical | `Access-Control-Allow-Origin: *` on terminal server |
| 4 | High | Stored XSS via `allowDangerousHtml: true` in markdown renderer |
| 5 | High | XSS via unescaped wiki-link `[[Page Name]]` injection |
| 6 | High | Iframe sandbox `allow-scripts allow-same-origin` allows escape |
| 7 | High | Agent `workdir` parameter not validated against DATA_DIR |
| 8 | Medium | No file-size limit on uploads (disk DoS) |
| 9 | Medium | Client-supplied MIME type trusted on uploads |
| 10 | Medium | `process.env` spread into spawned agent processes leaks `CLAUDE_API_KEY` |
| 11 | Low | `execSync("which claude")` inherits full env in terminal-server |

---

## 1. Path Traversal — ✅ Mitigated

`src/lib/storage/path-utils.ts:15-21` — `resolveContentPath()` resolves and verifies the result starts with `DATA_DIR`, throwing on escape. All page/asset/upload routes funnel through this helper. **Good practice.** One exception is documented as Finding #7 below (`workdir` parameter on agent runs).

---

## 2. Command Injection / Shell Execution

### Finding 1 — CRITICAL: Unauthenticated WebSocket RCE

**File:** `server/terminal-server.ts:197-282`

The PTY WebSocket server spawns Claude CLI for any client that connects, with **`--dangerously-skip-permissions`** and a user-supplied prompt:

```ts
shell = CLAUDE_PATH;
args = prompt
  ? ["--dangerously-skip-permissions", prompt]
  : ["--dangerously-skip-permissions"];
term = pty.spawn(shell, args, { cwd: DATA_DIR, env: { ...process.env } });
```

There is no auth check on `wss.on("connection", ...)`. The server runs on its own HTTP server (port 3001 / `DAEMON_PORT`), not Next.js, so `src/middleware.ts` does not apply.

**Exploit:** Connect to `ws://host:3001/?id=pwn&prompt=...` and drive an interactive Claude session with permissions disabled — this is full RCE as the server user, against `DATA_DIR` and any tools `claude` can invoke (file write, shell, network).

**Fix:**
- Verify the `kb-auth` cookie on the WebSocket upgrade (`req.headers.cookie`).
- Drop `--dangerously-skip-permissions` or make it an admin-only opt-in.
- Bind the daemon to `127.0.0.1` only.

### Finding 7 — HIGH: Agent `workdir` not validated

**File:** `src/lib/agents/agent-manager.ts:82-95`

```ts
const cwd = workdir ? path.join(DATA_DIR, workdir) : DATA_DIR;
```

`path.join` does **not** prevent `../` escape (unlike `resolveContentPath`). If `workdir` originates from a user-created job/agent task, an attacker can run Claude in any directory on the host.

**Fix:** `const cwd = workdir ? resolveContentPath(workdir) : DATA_DIR;`

### Finding 11 — LOW: `execSync("which claude")` env spread

**File:** `server/terminal-server.ts:104-110` — Fixed command, no injection vector, but the inherited env may surface in error logs.

### Git operations — ✅ Safe
`src/lib/git/git-service.ts` uses `simple-git`, which passes args as arrays — no shell interpolation.

---

## 3. Authentication & Authorization

### ✅ Good: Cookie-based auth
`src/middleware.ts`, `src/app/api/auth/{login,check}/route.ts` use a SHA-256(password+salt) cookie with `httpOnly` + `sameSite=lax`. Middleware gates all routes except `/login` and `/api/auth/*`.

### Finding 2 — CRITICAL: Terminal server bypasses middleware

The terminal server is a **separate `http.createServer`** (`server/terminal-server.ts:190`). Next.js middleware does not apply, so the kb-auth cookie is never checked. This is what makes Finding 1 reachable.

### Finding 3 — CRITICAL: `Access-Control-Allow-Origin: *`

**File:** `server/terminal-server.ts:131`

```ts
res.setHeader("Access-Control-Allow-Origin", "*");
```

Combined with the unauthenticated WebSocket, **any website the user visits** can connect to `ws://localhost:3001` from the user's browser and trigger RCE.

**Fix:** Echo only same-origin (`http://localhost:3000`) and check the `Origin` header on WebSocket upgrade.

---

## 4. Cross-Site Scripting (XSS)

### Finding 4 — HIGH: `allowDangerousHtml: true`

**File:** `src/lib/markdown/to-html.ts:85-86`

```ts
.use(remarkRehype, { allowDangerousHtml: true })
.use(rehypeStringify, { allowDangerousHtml: true })
```

Any `<script>` / `<img onerror=...>` written into a page renders as live HTML in the editor and viewers. Anyone with write access (or a successful AI-edit prompt-injection) gets persistent XSS, which then steals the auth cookie of subsequent viewers (cookie is `httpOnly` so direct exfil is blocked, but the attacker can call any API in-session).

**Fix:** Set `allowDangerousHtml: false`, or pipe through `rehype-sanitize` with an allowlist that includes only the elements you actually need (Mermaid blocks are handled separately).

### Finding 5 — HIGH: Wiki-link injection

**File:** `src/lib/markdown/to-html.ts:11-19`

```ts
return `<a data-wiki-link="true" data-page-name="${pageName}" href="#page:${slug}" class="wiki-link">${pageName}</a>`;
```

`pageName` is interpolated raw. `[[Foo" onclick="alert(1)]]` breaks out of the attribute.

**Fix:** HTML-escape `pageName` and `slug` before interpolation.

### Finding 6 — HIGH: Iframe sandbox too permissive

**File:** `src/components/editor/website-viewer.tsx:56-62`

```tsx
sandbox="allow-scripts allow-same-origin allow-forms"
```

`allow-scripts` + `allow-same-origin` together is equivalent to no sandbox — the iframe can `window.parent.fetch(...)` against same-origin APIs with the user's cookie. Any user-uploaded `index.html` (embedded apps) becomes a foothold for cross-site CRUD against `/api/pages`, `/api/git`, etc.

**Fix:** Drop `allow-same-origin` (and ideally `allow-forms`). Use `postMessage` if the embedded app needs to talk to the host.

---

## 5. Arbitrary File Write / Upload

### Finding 8 — MEDIUM: No size limit
**File:** `src/app/api/upload/[...path]/route.ts:35` — `await fs.writeFile(filePath, buffer)` with no size check. A single multi-GB upload can fill the data disk.

**Fix:** Reject `file.size > MAX_UPLOAD_BYTES` (e.g. 100 MB) before reading the buffer.

### Finding 9 — MEDIUM: Client MIME type trusted
**File:** `src/app/api/upload/[...path]/route.ts:38-46` — uses `file.type` (browser-supplied) to choose the markdown wrapper. Combined with no extension allowlist, an attacker can persist `.exe`/`.html`/`.svg` payloads next to legitimate assets.

**Fix:** Sniff with `file-type`; allowlist extensions; for SVGs run sanitization or store with `Content-Disposition: attachment`.

---

## 6. Secrets & Env Handling

### Finding 10 — MEDIUM: Secrets leak through `spawn` env

**File:** `src/lib/agents/agent-manager.ts:88-95` — `env: { ...process.env, ... }` hands every env var (including `CLAUDE_API_KEY`, `KB_PASSWORD`) to the spawned agent. Prompt-injection in the agent prompt or in any document read by the agent can extract secrets via `printenv`/network exfil.

**Fix:** Pass an explicit allowlist (`PATH`, `HOME`, `LANG`, plus any vars the provider strictly needs).

`KB_PASSWORD` itself (used in `src/middleware.ts`, `src/app/api/auth/*`) is read from env but never logged — that part is fine.

---

## 7. SSRF, CSRF, Misc.

- **SSRF:** No server-side `fetch()` of user-controlled URLs found in API routes (website viewer fetches client-side via iframe). Linked-repo `.repo.yaml` is read for display only.
- **CSRF:** `sameSite=lax` on `kb-auth` blocks cross-site form POSTs to JSON endpoints. The terminal server's `*` CORS does *not* expose the Next.js APIs because they're on a different origin/port — but Finding 6 (iframe escape) effectively bypasses CSRF protection from inside the app.
- **Dependencies:** `next@16.2.1`, `node-pty@1.x`, `ws@8.x`, `simple-git`, `better-sqlite3` — no known critical advisories at time of scan. Run `npm audit` regularly.

---

## Prioritized Remediation Plan

1. **(Critical, today)** Bind `terminal-server.ts` to `127.0.0.1`, require `kb-auth` cookie on upgrade, lock CORS to the Next.js origin, drop `--dangerously-skip-permissions` from the default arg list.
2. **(Critical, today)** Set `allowDangerousHtml: false` in `to-html.ts` or insert `rehype-sanitize`.
3. **(High, this week)** Escape `pageName`/`slug` in `convertWikiLinks`; tighten iframe sandbox in `website-viewer.tsx`; route `workdir` through `resolveContentPath()` in `agent-manager.ts`.
4. **(Medium, this week)** Add upload size cap and server-side MIME sniff in `upload/[...path]/route.ts`. Replace `...process.env` spread with an explicit allowlist in agent spawn.
5. **(Hygiene)** Add `npm audit` to CI; document the threat model (single-tenant, trusted-author) in the README; consider CSP headers via `next.config`.

---

*Generated 2026-04-14.*
