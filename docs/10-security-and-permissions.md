# 10: Security & Permissions

## Roles

| Capability | Owner | Editor | Commenter | Viewer |
|------------|:-----:|:------:|:---------:|:------:|
| View diagrams, see presence | ✓ | ✓ | ✓ | ✓ |
| Export (all formats) | ✓ | ✓ | ✓ | ✓¹ |
| Duplicate to own projects | ✓ | ✓ | ✓ | ✓¹ |
| Comment / reply / resolve | ✓ | ✓ | ✓ | ✗ |
| Edit diagrams, layers, import | ✓ | ✓ | ✗ | ✗ |
| Save / restore versions | ✓ | ✓ | ✗ | ✗ |
| Rename project | ✓ | ✓ | ✗ | ✗ |
| Invite members | ✓ | ✓² | ✗ | ✗ |
| Change roles, remove members, revoke links | ✓ | ✗ | ✗ | ✗ |
| Archive / delete / transfer | ✓ | ✗ | ✗ | ✗ |

¹ The owner can disable export and duplicate for viewers (project setting). ² Only up to their own role, and only if the owner allows it.

**Public read-only links** (phase 3): an invite with role `viewer`, no email and optionally no login required. Anonymous viewers get a temporary guest identity for presence ("Anonymous Owl").

## Enforcement points

1. **API:** a `requireRole(projectId, minRole)` preHandler on every project route. Membership is looked up per request (cached in Redis for 30 s and invalidated on change).
2. **Collab server:** the JWT is verified in `onAuthenticate`. `readOnly` is set for viewers and commenters, so Hocuspocus drops their document updates. `pid` in the token must match the requested document name. Awareness is still allowed for read-only users (they appear as viewers).
3. **Commenter writes** go through the API, which only touches `comments` in the Y.Doc (via a direct connection). This prevents commenters from editing diagrams by crafting raw Yjs updates.
4. **Defence in depth for editors:** an editor *can* send arbitrary Yjs updates. That's inherent to CRDTs and acceptable within a trusted project team. Bounds:
   - update size cap (1 MB) and document size cap (20 MB),
   - `@cld/model/validate` on load and before export (malformed elements are skipped and logged, never crash the app),
   - versions allow recovery from vandalism.
5. **Revocation:** removing a member or revoking a link publishes on Redis, collab disconnects the affected sockets, and the client switches to an "Access revoked" state.

## Authentication

- Better Auth with argon2id password hashing (via `@node-rs/argon2`), email verification required before inviting others, and rate-limited login.
- Sessions in Postgres, cookie `HttpOnly; Secure; SameSite=Lax`, 30-day rolling expiry. "Sign out everywhere" in settings.
- OAuth: Google, GitHub, Microsoft (Entra, for universities).
- Optional (phase 4): TOTP 2FA and SSO/SAML for organizations.

## Threat model highlights

| Threat | Mitigation |
|--------|------------|
| XSS through variable names, comments, text | React escaping. The SVG renderer escapes text nodes and never injects raw HTML. Markdown-lite comments are rendered with a strict allowlist (no HTML). Strict CSP: `default-src 'self'; connect-src 'self' wss:; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'` (inline style needed for SVG). |
| Malicious `.mdl` upload (huge, pathological) | Size cap of 5 MB, line and object caps, linear-time hand-written tokenizer, parsing in a Web Worker / worker thread with a timeout. |
| SVG export injection | We generate SVG ourselves and never embed user-supplied SVG. Images (if added later) are re-encoded server-side. |
| CSRF | SameSite=Lax cookies + Origin check on mutations. The WS handshake requires a JWT, not cookies. |
| Token leakage (collab JWT) | 5-minute lifetime, audience-bound, project-bound, never in URLs (sent as the first WS message). |
| Invite link brute force | 32-byte random tokens, stored hashed, rate-limited lookup. |
| IDOR on project ids | Every route checks membership. UUIDs are not treated as secrets. |
| DoS on collab | Hocuspocus Throttle extension, connection limits per IP at Caddy, message size limits. |
| Data loss | Versions, nightly `pg_dump` + WAL archiving (see 11), soft deletes. |

## Privacy / GDPR (the operator is likely in the EU)

- Store only the data we need: name, email, avatar.
- Data export (`GET /api/me/export`: all owned projects as `.cld.json` + account info) and account deletion.
- No third-party trackers. Optional privacy-friendly analytics (self-hosted Plausible/Umami).
- Logs exclude diagram content. IPs are kept 14 days.
- Self-hosting in an EU region by default. A DPA template for institutional customers.
- Imported files can contain personal data (e.g. a student's name in the filename, as in our fixture). Treat uploads as user data: they are deleted with the project.
