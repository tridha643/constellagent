---
constellagent:
  codingAgent: gpt-5.3-codex-xhigh
  buildHarness: cursor
---
# Session Management for mini-rube (Bun.serve() + Postgres)

## Research Summary

### TL;DR Recommendation

**Use HMAC-signed cookies (not JWT, not server-side sessions).** For a single-user app authenticated by a master key (`MINI_RUBE_KEY`), this is the simplest approach that is still secure. No session table, no Redis, no `bun:sqlite` needed.

---

## Analysis of Each Option

### Option A: Postgres-backed sessions (via Prisma)

| Aspect | Assessment |
|--------|-----------|
| Complexity | Medium-high. Requires a `Session` table, cleanup cron for expired sessions, a lookup on every request. |
| Persistence | Survives restarts. |
| Verdict | **Overkill for a single-user app.** Server-side sessions shine when you need to revoke sessions, store large blobs of state, or manage many concurrent users. mini-rube has one user. |

### Option B: JWT in a signed httpOnly cookie

| Aspect | Assessment |
|--------|-----------|
| Complexity | Low-medium. Need to sign/verify JWTs, set cookie options. |
| Persistence | Stateless -- cookie is the session. Survives restarts by design. |
| Verdict | **Close, but JWT is heavier than needed.** JWT adds base64-encoded headers, claims structure, and a dependency (or manual implementation of the JWT spec). For storing just `userId`, a simple HMAC-signed cookie is lighter and achieves the same thing. |

### Option C: Redis

| Aspect | Assessment |
|--------|-----------|
| Complexity | High. Adds a runtime dependency, connection management, deployment complexity. |
| Persistence | Survives restarts (if configured with persistence). |
| Verdict | **Rejected.** Adds an entire service for something a signed cookie handles. |

### Option D: `bun:sqlite` session store

| Aspect | Assessment |
|--------|-----------|
| Complexity | Low-medium. No external deps -- `bun:sqlite` is built in. Synchronous API makes it simple. |
| Persistence | Survives restarts (file on disk). |
| Verdict | **Viable fallback if you later need server-side session data**, but unnecessary right now. The `hono_sessions` library has a `BunSqliteStore` if you ever want this. |

### Option E (Recommended): HMAC-signed cookie -- no sessions at all

| Aspect | Assessment |
|--------|-----------|
| Complexity | **Lowest.** ~30 lines of code. Zero dependencies beyond Bun builtins. |
| Persistence | Stateless -- the cookie is self-contained. |
| Verdict | **Best fit for mini-rube.** |

---

## Recommended Architecture

### Why "no sessions" works for mini-rube

mini-rube has:
- **One logical user** (the instance owner)
- **A master key** (`MINI_RUBE_KEY`) that serves as the authentication credential
- **No need for session revocation** (changing the key or the HMAC secret invalidates all cookies)
- **Only two pieces of session state**: `userId` (persistent) and OAuth `state` (ephemeral)

This means: once the user authenticates with `MINI_RUBE_KEY`, you just need to give them a tamper-proof cookie that says "this person is authenticated." A server-side session store is unnecessary.

### The Pattern: HMAC-Signed Cookie

```
Cookie value = base64url(payload) + "." + base64url(hmac_sha256(payload, secret))
Payload = JSON string: {"userId":"owner","iat":1234567890,"exp":1234654290}
Secret = derived from MINI_RUBE_KEY (or a separate SESSION_SECRET env var)
```

#### How it works:

1. **Login**: User provides `MINI_RUBE_KEY`. Server validates it, creates a payload with `userId` + `iat` + `exp`, signs it with HMAC-SHA256, sets an httpOnly cookie.

2. **Every request**: Server reads the cookie, splits on `.`, verifies the HMAC signature, checks expiration. If valid, the request is authenticated. If not, redirect to login.

3. **Logout**: Delete the cookie.

4. **OAuth state**: Store as a separate short-lived httpOnly cookie (`oauth_state`). No need for the session store -- the state is only needed for the duration of the OAuth redirect flow (~60 seconds).

### Implementation with Bun.serve() Built-in Cookie API

Bun v1.2.7+ has a built-in `request.cookies` API:

```typescript
// Reading
const sessionCookie = request.cookies.get("session");

// Writing (auto-sets Set-Cookie header on the response)
request.cookies.set("session", signedValue, {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax",
  path: "/",
  maxAge: 86400, // 24 hours
});

// Deleting
request.cookies.delete("session");
```

### Signing/Verification Utilities (~30 lines)

```typescript
import { createHmac } from "node:crypto";

const SECRET = process.env.SESSION_SECRET || process.env.MINI_RUBE_KEY;

function sign(payload: object): string {
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", SECRET).update(data).digest("base64url");
  return `${data}.${sig}`;
}

function verify(cookie: string): object | null {
  const [data, sig] = cookie.split(".");
  if (!data || !sig) return null;
  const expected = createHmac("sha256", SECRET).update(data).digest("base64url");
  if (sig !== expected) return null; // timing-safe compare in production
  try {
    const payload = JSON.parse(Buffer.from(data, "base64url").toString());
    if (payload.exp && Date.now() / 1000 > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}
```

> **Note:** In production, use `crypto.timingSafeEqual()` instead of `===` for signature comparison to prevent timing attacks.

### OAuth State Cookie

```typescript
// Before redirect to OAuth provider:
const state = crypto.randomUUID();
request.cookies.set("oauth_state", sign({ state, exp: Math.floor(Date.now()/1000) + 300 }), {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax",
  path: "/",
  maxAge: 300, // 5 minutes
});
// Redirect to provider with ?state=<state>

// On callback:
const stateCookie = verify(request.cookies.get("oauth_state"));
if (!stateCookie || stateCookie.state !== url.searchParams.get("state")) {
  return new Response("Invalid OAuth state", { status: 403 });
}
request.cookies.delete("oauth_state");
```

### Auth Middleware Helper

Since Bun.serve() has no built-in middleware, create a wrapper function:

```typescript
type AuthenticatedHandler = (req: Request, userId: string) => Response | Promise<Response>;

function requireAuth(handler: AuthenticatedHandler) {
  return (req: Request) => {
    const session = verify(req.cookies?.get("session") ?? "");
    if (!session?.userId) {
      return new Response(null, { status: 302, headers: { Location: "/login" } });
    }
    return handler(req, session.userId);
  };
}
```

---

## Security Checklist

| Concern | Solution |
|---------|----------|
| Cookie tampering | HMAC-SHA256 signature verification |
| XSS reading cookies | `httpOnly: true` |
| Cookie theft over network | `secure: true` in production |
| CSRF on mutations | `sameSite: "lax"` (blocks cross-origin POST). For extra safety on state-changing APIs, check `Origin`/`Referer` header. |
| OAuth CSRF | Signed `oauth_state` cookie compared against `?state` param |
| Session expiry | `exp` claim in signed payload + `maxAge` on cookie |
| Timing attacks on sig comparison | Use `crypto.timingSafeEqual()` |
| Secret rotation | Use a `SESSION_SECRET` env var separate from `MINI_RUBE_KEY`, so you can rotate independently |

---

## Answering the Specific Questions

### Is JWT better than server-side sessions for a single-user app?

**Neither JWT nor server-side sessions are the best fit.** JWT is a standard with its own complexity (header, claims, algorithms, libraries). Server-side sessions add storage overhead. For a single-user app, a simple HMAC-signed cookie achieves the same security guarantees as JWT with less code and no dependencies. It is essentially a "minimal JWT" -- just a signed payload -- without the full JWT spec overhead.

### Since there's a master key and only one user, do we even need traditional sessions?

**No.** The master key IS the authentication credential. Once verified, all you need is a tamper-proof token that says "authenticated." An HMAC-signed cookie with `userId` and `exp` is that token. There is nothing to store server-side.

### What's the simplest pattern that's still secure?

**HMAC-signed httpOnly cookie.** Approximately 30 lines of signing/verification code, zero dependencies beyond `node:crypto` (built into Bun), and the built-in `request.cookies` API handles parsing and setting headers automatically.

---

## Libraries Considered (and why they're not needed)

| Library | Notes |
|---------|-------|
| `hono-sessions` | Has `BunSqliteStore` and `CookieStore`, but requires Hono framework. Useful if you adopt Hono. |
| `jose` | JWT library. Works in Bun. But full JWT is overkill here. |
| `cookie` (npm) | Cookie parsing. Unnecessary -- Bun has `request.cookies` built in. |
| `iron-session` | Encrypted session cookies. Nice API but Express/Next-oriented. |

---

## Migration Path

If mini-rube later needs:
- **Multiple users**: Add a `users` table in Postgres, change `userId` in the cookie payload. Signed cookie pattern still works.
- **Session revocation**: Add a `session_version` column to the user row, include it in the cookie, and check on each request. Still no session table needed.
- **Large session data**: Move to `bun:sqlite` for a local session store (use `hono_sessions`' `BunSqliteStore` as reference) or add a Postgres `sessions` table.

---

## Sources

- [Bun Cookies Documentation](https://bun.com/docs/runtime/cookies)
- [Bun v1.2.7 Blog -- Built-in request.cookies](https://bun.com/blog/bun-v1.2.7)
- [Bun CryptoHasher HMAC API](https://bun.com/reference/bun/CryptoHasher)
- [Node crypto.createHmac in Bun](https://bun.com/reference/node/crypto/createHmac)
- [Bun Hashing Documentation](https://bun.sh/docs/runtime/hashing)
- [hono_sessions -- BunSqliteStore](https://github.com/jcs224/hono_sessions)
- [OWASP CSRF Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html)
- [Auth0 -- OAuth State Parameters for CSRF](https://auth0.com/docs/secure/attack-protection/state-parameters)
- [HMAC Signing with Web Crypto API](https://jameshfisher.com/2017/10/31/web-cryptography-api-hmac/)
- [Bun.serve() Middleware Discussion](https://github.com/oven-sh/bun/issues/17608)
- [bun:sqlite Reference](https://bun.com/reference/bun/sqlite)
