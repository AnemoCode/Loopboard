# 16: Guest Access via Share Links

> **Status: implemented** (as designed below). Code: `apps/server/src/routes/sharing.ts`, `apps/server/src/guests.ts`, `apps/web/src/pages/InvitePage.tsx`, `apps/web/src/editor/ShareDialog.tsx`. Tests: `apps/server/test/api.test.ts` (guest access), `e2e/guest.spec.ts`.

## Goal

Only the person who stores the project needs an account. Everyone else opens a share link, types their name, and is in the diagram with live cursors, editing and comments, all in one step. Guests can create an account later and keep everything.

> Example: a lecturer creates a project and drops the link in the workshop chat. Twenty students open it, type their names, and are editing within ten seconds.

## Principles

1. **One field, one click.** Joining as a guest asks for a display name and nothing else.
2. **Guests are real users under the hood.** Each guest is an ordinary `user` row flagged `isAnonymous`, with a normal session cookie. Roles, the cookie-authenticated WebSocket, comment authorship, presence and revocation all work **without new permission code paths**.
3. **The owner stays in control.** Guest access is a per-link switch, every guest appears in the member list, and revoking a link can also remove the guests who joined through it.
4. **Accounts are optional, never lost.** Creating an account (or signing in) while you're a guest moves all your projects and comments to that account.

## User experience

### 1. Sharing (owner or editor)

The Share dialog's "Invite links" section becomes **"Share link"**:

```
Share link
[ Can edit ▾ ]  [✓] Anyone with the link can join without an account
https://loopboard.app/invite/k3J9…        [ Copy link ]   [ Revoke ]
```

- The guest switch is **on by default** for new links, since the main use case is "only one account needed". It can be toggled on an existing link at any time.
- People with access show a **Guest** badge next to guests. Guests can be removed or have their role changed exactly like account users.
- Revoking a link asks: *"Also remove the 7 guests who joined with this link?"* (checked by default).

### 2. Joining (guest)

Opening `/invite/:token` no longer requires signing in:

```
        ┌────────────────────────────────────────┐
        │   Maya invited you to                  │
        │   Coffee Agroforestry  · Can edit      │
        │                                        │
        │   Your name                            │
        │   [ Jonas                          ]   │
        │                                        │
        │   [        Join as guest        ]      │
        │                                        │
        │   Have an account? Sign in · Sign up   │
        └────────────────────────────────────────┘
```

- The name is required (1–50 characters) because it appears on cursors and comments. It is pre-filled when the same browser joined before.
- **Join as guest** creates the guest session, adds the membership and opens the editor.
- Someone already signed in sees the existing **Join project** button and no name field.
- If the link doesn't allow guests, only "Sign in / Create account" is offered.
- An invalid or revoked link shows the existing "Invite not available" page.

### 3. Working as a guest

- The editor is identical apart from what their role allows. Collaborators see guests like anyone else, with a small "Guest" note in the avatar tooltip.
- The account menu (avatar) shows *Jonas · Guest* and offers:
  - **Change name** (updates cursors and future comments)
  - **Create account to keep access**: one line explaining that guest access lives in this browser only
  - **Leave project**
- Guests who open `/` see a minimal dashboard listing the projects they joined. A friendly card replaces "New project": *"Create a free account to start your own projects and keep access on any device."*
- The same browser keeps the guest identity for 30 days of inactivity (rolling session), so closing the tab and coming back next week just works. A second share link opened in the same browser adds that project to the same guest; no new identity is created.

### 4. Creating an account later (upgrade)

- From the account menu or the dashboard card, the guest goes to sign up. The page is titled "Keep your projects" and the name is pre-filled.
- After sign-up, **or after signing in to an existing account**, all of the guest's memberships, comments and version authorship move to the account. The page reloads into the same project with the account identity. A toast says "Your projects are now saved to your account."

## What guests can and cannot do

> **Update:** since [doc 17](17-guest-projects.md), guests can also create, import, duplicate, rename and delete **their own** projects (up to 3). Managing access still needs an account. The table below describes guests who joined someone else's project.

**Rule:** a guest can do everything their role allows *inside* a project, but nothing that creates projects or manages access.

| Action | Guest (editor) | Guest (commenter/viewer) |
|--------|:--------------:|:------------------------:|
| Edit diagrams, layers, import into the project | ✓ | ✗ |
| Comment, resolve | ✓ | commenter ✓ |
| Export (PNG/SVG/PDF/MDL/JSON) | ✓ | ✓ |
| Save and restore versions | ✓ | ✗ |
| See presence and collaborators' names | ✓ | ✓ |
| See collaborators' **email addresses** | ✗ | ✗ |
| Invite people, create/revoke links, change roles | ✗ | ✗ |
| Rename, duplicate or delete the project | ✗ | ✗ |
| Create or import new projects | ✗ (needs an account) | ✗ |

## Technical design

### Auth: Better Auth `anonymous` plugin

```ts
// apps/server/src/auth.ts
plugins: [
  anonymous({
    emailDomainName: 'guest.loopboard.invalid', // placeholder emails, never shown or mailed
    onLinkAccount: async ({ anonymousUser, newUser }) =>
      migrateGuest(anonymousUser.user.id, newUser.user.id),
  }),
],
```

- Adds `user.is_anonymous` and the `/sign-in/anonymous` endpoint. When an anonymous session signs up or signs in, it calls `onLinkAccount` and then deletes the anonymous user.
- `migrateGuest(from, to)`, in one transaction:
  1. For each project membership of `from`, upsert it onto `to`, keeping the **higher** role.
  2. `project_versions.created_by`: move to `to`.
  3. For each affected project, rewrite `authorId` on comment messages and `createdBy` on threads from `from` to `to`. This goes through `collab.withDocument` so connected clients see it immediately.

### Data model (one migration)

| Table | Change |
|-------|--------|
| `user` | `is_anonymous boolean not null default false` (plugin field) |
| `project_invites` | `allow_guests boolean not null default true` (links only) |
| `project_members` | `invite_id uuid null references project_invites(id) on delete set null`, i.e. *joined via which link* (used for "remove guests from this link") |

### API changes

| Method | Path | Change |
|--------|------|--------|
| GET | `/api/invites/:token` | **No sign-in required.** Returns `{ projectName, invitedBy, role, allowGuests, alreadyMember, signedIn }`, nothing else about the project |
| POST | `/api/invites/:token/guest` | **New.** Body `{ name }`. If the link allows guests: reuse the current guest session, or create one via `auth.api.signInAnonymous` (forwarding its `Set-Cookie`). Set the name and add the membership (`invite_id` = link). Returns `{ projectId }`. Rate-limited per IP (e.g. 20/hour) |
| POST | `/api/invites/:token/accept` | Unchanged (signed-in users) |
| POST | `/api/projects/:id/links` | Body gains `allowGuests` (default `true`) |
| PATCH | `/api/projects/:id/links/:linkId` | **New.** `{ role?, allowGuests? }` |
| DELETE | `/api/projects/:id/links/:linkId?removeGuests=true` | Optionally removes guest members who joined via the link and disconnects them |
| PATCH | `/api/me` | **New.** `{ name }` (guests and account users) |
| GET | `/api/me` | Adds `isGuest` |
| GET | `/api/projects/:id/members` | Adds `isGuest` per member; **omits emails** for guest members and when the requester is a guest |

**Guard:** a new `requireAccount(req)` helper returns `403 "Create an account to do this"` for guests. It is applied to project create/duplicate/rename/delete, member invites and link management. The existing `requireRole` covers everything else unchanged.

### Real-time collaboration

No changes. The guest has a normal session cookie, so `onAuthenticate` works as today, and removing a guest closes their socket through the existing `disconnectUser`. The guest flag goes into awareness `user` (`{ id, name, color, guest: true }`) for the tooltip badge.

### Frontend changes

| Area | Change |
|------|--------|
| Routing | `/invite/:token` moves out of `RequireAuth` |
| `InvitePage` | Three states: guest join form · signed-in "Join project" · sign-in only |
| `ShareDialog` | Guest switch per link, Guest badges, "remove guests" option on revoke |
| `UserMenu` | Guest variant (Change name · Create account · Leave) |
| `DashboardPage` | Guest variant (joined projects + account card, no New/Import) |
| `AuthPage` | "Keep your projects" copy and pre-filled name when the current session is a guest; success toast after linking |
| Presence | "Guest" in avatar tooltips |

### Housekeeping

A daily cleanup on the server (`setInterval` at startup, no job queue) deletes anonymous users who have **no memberships**, or who have **no unexpired session** left (changed from 90 days of inactivity in [doc 17](17-guest-projects.md)). Their comments keep the author's name, which the document stores alongside the `authorId`.

## Security and abuse

| Risk | Mitigation |
|------|------------|
| A leaked link lets strangers in | The owner sees every guest, can remove them, switch off guest access, or revoke the link (and its guests) in one click. Version history allows recovery. The link role can be lowered to "Can comment"/"Can view" |
| Guest spam / account farming | Per-IP rate limit on guest join. Guests can't create projects or links. Guest records with no projects are cleaned up |
| Impersonation via display names | Names are labelled "Guest" wherever identity matters (members list, avatar tooltip) |
| Email exposure | Guests never receive email addresses; placeholder guest emails are never displayed |
| Session theft | Same cookie protections as accounts (`HttpOnly`, `Secure`, `SameSite=Lax`, origin check on mutations) |
| Token guessing | Unchanged: 24-byte random tokens, rate-limited lookup |

## Testing

**Server integration** (`apps/server/test`):
- Guest join creates a session, a membership and a working WebSocket with the link's role.
- A link without guest access refuses.
- A second link in the same browser reuses the guest.
- Guests get `403` on project/sharing endpoints and see no emails.
- Revoking with `removeGuests` disconnects them.
- **Upgrade** (sign-up and sign-in) migrates memberships (keeping the higher role), versions and comment authorship.
- The cleanup job removes orphaned guests.

**End-to-end** (`e2e/guest.spec.ts`):
1. The owner creates a link. A **fresh browser with no account** types a name and edits live with the owner (cursor label shows the guest's name, edits sync both ways).
2. A guest viewer can't edit, and the owner removes them, so they see "No access".
3. A guest creates an account and lands in the same project, now listed on their dashboard.
4. Turning guest access off on the link sends new visitors to sign-in.

## Rollout steps (≈ 3–4 days)

1. **Backend (1–1.5 d):** migration; anonymous plugin + `migrateGuest`; guest-join endpoint; `requireAccount`; link PATCH/DELETE options; `/api/me` PATCH; email hiding; cleanup task; integration tests.
2. **Frontend (1.5 d):** join page states; share dialog switch, badges and revoke option; guest variants of the account menu and dashboard; upgrade copy and toast; presence badge.
3. **Verify (0.5 d):** e2e suite on dev and the Docker stack; update docs 09, 10 and 15.

## Open questions (sensible defaults chosen)

1. **Guest access on by default for new links?** Plan: **yes**, matching "only one account needed". The alternative is off by default with a one-click toggle.
2. **Default link role?** Plan: keep **Can edit** (workshops). Owners can pick a lower role per link.
3. **Link expiry** (e.g. 7 or 30 days)? Plan: not in the first version; revoking covers it. Easy to add later as `expires_at`.
4. **Should guest editors be able to restore versions?** Plan: yes, like any editor, since restoring is itself undoable through the version saved before each restore.
