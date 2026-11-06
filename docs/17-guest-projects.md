# 17: Start Without an Account (Guest Projects)

> **Status: implemented.** Builds on [16 — Guest Access via Share Links](16-guest-access.md). Code: `apps/server/src/app.ts` (`POST /api/guest`), `apps/server/src/routes/projects.ts` (guest project rules), `apps/server/src/guests.ts` (ownership migration, cleanup), `apps/web/src/pages/AuthPage.tsx`, `apps/web/src/pages/DashboardPage.tsx`, `apps/web/src/editor/ShareDialog.tsx`, `apps/web/src/editor/TopBar.tsx`. Tests: `apps/server/test/api.test.ts` (guest projects), `e2e/guest.spec.ts`.

## Goal

Anyone can try Loopboard in one click: draw a diagram from scratch or a template, or import a Vensim `.mdl` file, **without signing up**. An account is needed only to **share a project with others** or to **keep it on other devices**.

> Example: a student finds Loopboard, clicks *Start drawing — no account needed*, drops in their `.mdl` from class and sees the loops detected. When they want to send it to their group, Loopboard asks them to create a free account, and the project simply stays theirs.

## Why the wall sits at sharing, not at saving

- **Everything autosaves.** Diagrams sync to the server continuously (Yjs), so there is no "Save" moment to gate. Gating on saving would mean either risking unsaved work or adding an artificial Save step.
- **Sharing is where value is proven.** By the time someone invites others, they have seen what the tool does; asking for an account then feels fair.
- **Sharing is where losing a guest hurts others.** If a guest owner clears their cookies, everyone they invited would lose the project too. An account owner keeps the "only one account needed" promise from doc 16 intact.
- **Sharing is where abuse starts.** Anonymous share links would make Loopboard anonymous hosting. A guest who can only see their own work is uninteresting to spammers.

## Principles

1. **One click to the canvas.** No name, no email, no form. The guest is called "Guest" until they change it or sign up.
2. **Same guest identity as doc 16.** A guest who started alone and later joins a share link (or the other way round) is one and the same anonymous user. No new permission code paths.
3. **Honest about where work lives.** Guests always see that their work lives in this browser only, and how to keep it.
4. **Upgrading never loses anything.** Creating an account or signing in moves owned projects too, not just memberships.

## User experience

### 1. Starting

`/signin` and `/signup` (where visitors without a session land) show, below the form:

```
──────────────── or ────────────────
[   Start drawing — no account needed   ]
Your work stays in this browser until you create an account.
```

Clicking it creates a guest session and opens the dashboard with the **New project** dialog (blank or template) already open. Visitors who came via a `?next=` link go back there instead.

### 2. Working as a guest owner

- **Dashboard:** *New project*, *Import* and drag-and-drop of `.mdl` / `.cld.json` work as for accounts. Guests can rename, duplicate and delete projects they own. The "Keep your projects" card stays at the bottom and shows how many of the guest's **3 projects** are used.
- **Editor:** identical to an owner's editor. The top bar shows a small **Keep your work** button for guests that leads to sign-up and back to the same project.
- **Share:** the dialog explains that sharing needs a free account and offers **Create free account**. After sign-up the guest lands back in the project and the share dialog works normally.
- **End guest session** (account menu) warns that projects created as a guest are deleted with the session.

### 3. Upgrading

Unchanged from doc 16, plus: projects the guest **owns** become owned by the account. Sign-up and sign-in both work (sign-in merges into the existing account).

## Rules

| Action | Guest (own project) | Guest (joined via link) | Account |
|--------|:---:|:---:|:---:|
| Create, import, duplicate projects | ✓ (up to 3 owned) | — | ✓ |
| Edit, comment, versions, export | ✓ | per role | per role |
| Rename project | ✓ | ✗ | editor+ |
| Delete project | ✓ | ✗ | owner |
| Share links, email invites, change roles | ✗ (needs an account) | ✗ | per role |

## Technical design

### API

| Method | Path | Change |
|--------|------|--------|
| POST | `/api/guest` | **New.** Body `{ name? }` (default "Guest"). Creates an anonymous session via `auth.api.signInAnonymous` and forwards its `Set-Cookie`. Already signed in (guest or account): no-op, returns the current user. Rate-limited to 10 per hour per IP |
| POST | `/api/projects` | Guests allowed, up to `GUEST_PROJECT_LIMIT` (3) owned projects; beyond that `403 "Guests can have up to 3 projects…"` |
| POST | `/api/projects/:id/duplicate` | Guests allowed, same limit |
| PATCH | `/api/projects/:id` | Guests allowed **only on projects they own** |
| DELETE | `/api/projects/:id` | Guests allowed (owner role is still required) |
| sharing endpoints | | Unchanged: `requireAccount` → `403 "Create a free account to do this"` |

The limit lives in `@cld/shared` (`GUEST_PROJECT_LIMIT`) so the dashboard can show it.

### Upgrade: `migrateGuest`

Besides memberships, versions, changelog and comments, `projects.owner_id` moves from the guest to the account. This is essential: `projects.owner_id` cascades on user deletion, and Better Auth deletes the anonymous user right after `onLinkAccount`. Without the move, upgrading would delete the guest's projects.

### Cleanup

Guest sessions are rolling 30-day sessions. Once a guest has **no unexpired session** (and is older than a day), nobody can reach their identity any more, so the daily sweep deletes them. Projects they own are deleted with them by the existing `owner_id` cascade. (Previously inactive guests were kept for 90 days; aligning with the session lifetime avoids keeping data nobody can open.) Guests without any membership are still removed after a day.

### No schema change

Everything uses the existing `user.is_anonymous` flag and `projects.owner_id`.

## Security and abuse

| Risk | Mitigation |
|------|------------|
| Bots creating guest users | `POST /api/guest` is rate-limited per IP (10/hour); orphaned guests are swept daily |
| Storage abuse | 3 projects per guest, the existing 12 MB body limit and per-route rate limits on project creation |
| Anonymous content distribution | Guests can't create share links or invite anyone, so only they can see their projects |
| Losing work (private window, cleared cookies) | Persistent "lives in this browser" notices on the dashboard, the editor top bar and the end-session dialog |

## Testing

- **Server:** a guest starts a session in one call; creates, imports, renames, duplicates and deletes own projects; hits the limit; can't rename a project they only joined; can't share; upgrading moves ownership and the project survives the guest's deletion; expired guest owners are cleaned up together with their projects.
- **E2E:** a fresh browser clicks *Start drawing*, creates a template project, draws, is asked for an account when sharing, signs up and lands back in the same project that now has a working share dialog.
