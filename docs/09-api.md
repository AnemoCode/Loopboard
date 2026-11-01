# 09: API

Base path `/api`. JSON in and out, errors as `application/problem+json` (RFC 9457). Auth uses Better Auth session cookies (`HttpOnly; Secure; SameSite=Lax`). State-changing requests require a matching `Origin` header (CSRF defence) in addition to SameSite. An OpenAPI 3.1 document is generated from the Zod schemas and served at `/api/docs` (Scalar UI) in dev.

## Auth (Better Auth, mounted at `/api/auth/*`)

| Method | Path | Notes |
|--------|------|-------|
| POST | `/api/auth/sign-up/email` | name, email, password |
| POST | `/api/auth/sign-in/email` | |
| POST | `/api/auth/sign-in/magic-link` | phase 2 |
| GET | `/api/auth/sign-in/social?provider=google\|github\|microsoft` | OAuth |
| POST | `/api/auth/sign-out` | |
| GET | `/api/auth/session` | |
| POST | `/api/auth/forget-password`, `/reset-password`, `/verify-email` | |

## Users

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/me` | Current user + preferences |
| PATCH | `/api/me` | Name, avatar, preferences (theme, cursor color) |
| DELETE | `/api/me` | Delete account (transfers or deletes owned projects, after confirmation) |

## Projects

| Method | Path | Role | Description |
|--------|------|------|-------------|
| GET | `/api/projects?filter=all\|owned\|shared\|archived&q=&sort=` | n/a | List the user's projects (cursor pagination) |
| POST | `/api/projects` | n/a | Create `{ name, template? }` → creates an initial doc with one diagram and one layer |
| GET | `/api/projects/:id` | viewer+ | Metadata, my role, members summary |
| PATCH | `/api/projects/:id` | editor+ | Rename, description |
| POST | `/api/projects/:id/duplicate` | viewer+ | Copy into my projects |
| POST | `/api/projects/:id/archive` / `unarchive` | owner | |
| DELETE | `/api/projects/:id` | owner | Soft delete (30-day restore) |
| GET | `/api/projects/:id/thumbnail` | viewer+ | 302 to a signed URL |
| POST | `/api/projects/:id/collab-token` | viewer+ | `{ token, expiresAt }` JWT for the collab server |

## Members & sharing

| Method | Path | Role | Description |
|--------|------|------|-------------|
| GET | `/api/projects/:id/members` | viewer+ | |
| PATCH | `/api/projects/:id/members/:userId` | owner | Change role |
| DELETE | `/api/projects/:id/members/:userId` | owner (or self = leave) | Triggers a collab revoke |
| POST | `/api/projects/:id/transfer` | owner | Transfer ownership |
| POST | `/api/projects/:id/invites` | owner/editor¹ | `{ email?, role, expiresIn?, maxUses? }` → email invite or share link |
| GET | `/api/projects/:id/invites` | owner | |
| DELETE | `/api/projects/:id/invites/:inviteId` | owner | Revoke |
| GET | `/api/invites/:token` | n/a | Preview (project name, inviter, role) |
| POST | `/api/invites/:token/accept` | authenticated | Join the project |

¹ Editors can invite up to their own role (configurable per project).

## Versions

| Method | Path | Role | Description |
|--------|------|------|-------------|
| GET | `/api/projects/:id/versions` | viewer+ | List (label, kind, author, time) |
| POST | `/api/projects/:id/versions` | editor+ | Save named version `{ label }` |
| GET | `/api/projects/:id/versions/:vid/snapshot` | viewer+ | JSON snapshot for preview |
| POST | `/api/projects/:id/versions/:vid/restore` | editor+ | Saves the current state as a version first, then applies the restore through the collab direct connection |
| PATCH / DELETE | `/api/projects/:id/versions/:vid` | editor+ / owner | Rename / delete manual versions |

## Comments (commenter path, see 05)

| Method | Path | Role |
|--------|------|------|
| POST | `/api/projects/:id/comments` | commenter+ | Create thread `{ diagramId, anchor, body }` |
| POST | `/api/projects/:id/comments/:threadId/messages` | commenter+ | Reply |
| PATCH | `/api/projects/:id/comments/:threadId` | commenter+ | Resolve / reopen |
| PATCH / DELETE | `/api/projects/:id/comments/:threadId/messages/:mid` | author (or owner) | Edit / delete |

## Import / export

| Method | Path | Role | Description |
|--------|------|------|-------------|
| POST | `/api/import/parse` | authenticated | multipart `.mdl`/`.cld.json` → parsed preview (for clients that can't parse locally) |
| POST | `/api/projects/:id/import` | editor+ | `{ snapshot, mode: 'new-diagrams' \| 'replace', mergeVariables }` |
| POST | `/api/projects/:id/exports` | viewer+ | `{ format, scope, options }` → 200 file or 202 job |
| GET | `/api/exports/:jobId` | owner of job | Status + signed URL |

## Activity & health

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/projects/:id/activity?cursor=` | Activity feed |
| GET | `/api/health` | Liveness |
| GET | `/api/ready` | Readiness (DB, Redis, MinIO reachable) |
| GET | `/metrics` | Prometheus (internal network only) |

## Collab WebSocket

`wss://<host>/collab`, using the Hocuspocus protocol (Yjs sync + awareness + auth message).
- Document name `project:<uuid>`.
- Token: the JWT from `collab-token`, signed HS256 with `COLLAB_JWT_SECRET`. Claims: `sub`, `pid`, `role`, `exp` (5 min), `aud: 'collab'`.
- Close codes: `4401` unauthenticated, `4403` forbidden or revoked, `4413` document too large, `4426` client schema too old.

## Rate limits (Redis, per user + IP)

| Scope | Limit |
|-------|-------|
| Auth endpoints | 10/min/IP |
| Project create / import | 30/hour/user |
| Exports (server) | 60/hour/user |
| Collab-token | 60/min/user |
| General API | 600/min/user |
