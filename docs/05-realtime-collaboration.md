# 05: Real-time Collaboration

## Goals

- Everyone sees the same diagram converge, with no "merge conflict" dialogs.
- You can **see the others**: where their cursors are, what they've selected, what they're dragging or typing, and which diagram they're on.
- It feels instant locally (optimistic updates) and smooth remotely (< 150 ms).
- It recovers gracefully from network hiccups, and short offline periods merge cleanly.

## Transport & sync

- **Hocuspocus** WebSocket endpoint `wss://<host>/collab`. One connection per browser tab can multiplex several documents, though for now we only open one project document.
- Document name: `project:<uuid>`.
- Auth: a short-lived JWT from `POST /api/projects/:id/collab-token`. The provider refreshes the token on reconnect (`token: async () => fetchToken()`).
- Scaling: `@hocuspocus/extension-redis` publishes document updates and awareness to Redis, so clients connected to different collab instances still see each other. Use sticky sessions (by document name hash) at the proxy when we have > 1 instance; it isn't strictly required, but it reduces Redis traffic.
- Local cache: `y-indexeddb`, so reloads open instantly and edits made offline are kept.

## Document vs awareness

| Data | Channel | Persisted | Undoable |
|------|---------|-----------|----------|
| Elements, styles, layers, diagrams, variables, comments | Y.Doc | ✓ | ✓ (own changes) |
| Cursor position | Awareness | ✗ | ✗ |
| Selection | Awareness | ✗ | ✗ |
| In-progress drag / resize / rotate (transient transform) | Awareness | ✗ | ✗ |
| Current diagram & viewport | Awareness | ✗ | ✗ |
| Text being typed (caret / selection range) | Awareness (+ text in Y.Doc) | partial | ✓ |
| "Is typing a comment" | Awareness | ✗ | ✗ |

### Awareness state shape

```ts
interface PresenceState {
  user: { id: string; name: string; avatarUrl?: string; color: string };
  diagramId: string | null;
  cursor: { x: number; y: number } | null;        // world coordinates
  viewport: { x: number; y: number; zoom: number; w: number; h: number };
  selection: string[];                            // element ids
  tool: ToolId;
  transient?: {                                    // live manipulation preview
    kind: 'move' | 'resize' | 'curve' | 'rotate' | 'draw-link';
    ids: string[];
    dx?: number; dy?: number;                      // move
    rect?: { x: number; y: number; w: number; h: number }; // resize
    control?: { x: number; y: number };            // curve arc control point
    from?: string; to?: { x: number; y: number } | string; // drawing a link
  };
  editing?: { elementId: string; field: 'text' | 'name' };
  followTarget?: string;                           // clientId being followed
  idle?: boolean;                                  // no input for 60 s
}
```

Awareness updates are throttled to **20 Hz (50 ms)** while moving. Cursors only go out when they've moved more than 1 world-pixel. On the receiving side, cursors are **interpolated** (lerp toward the target over about 80 ms), so remote cursors glide smoothly even at 20 Hz.

## Live movement: transient state, then commit

Writing every pointer-move into the Y.Doc would bloat history and undo, and would send many tiny CRDT updates. Instead:

1. **Pointer down** on the selected elements: begin a gesture locally.
2. **Pointer move:** update local render state immediately and publish `transient: { kind: 'move', ids, dx, dy }` via awareness (20 Hz).
3. Remote clients render those elements **at their transient position**, with a thin outline in the dragging user's color and their name tag.
4. **Pointer up:** one `doc.transact()` writes the final `x, y` values (one undo step) and clears `transient`.
5. If the dragging client disconnects mid-gesture, its awareness times out (30 s, or right away on clean close) and the elements snap back to the document state. Nothing is corrupted.

Resizing, curving arrows (dragging the control point) and drawing new links follow the same pattern. Remote users see a "ghost" arrow following the other user's pointer while they draw a link.

### Concurrent manipulation of the same element

- **No hard locks.** That's last-writer-wins per property (Yjs Y.Map semantics).
- **Soft locks:** if another user is dragging or editing element X, X shows their color outline, and starting a drag on it shows a small toast "Maya is moving this". You can still proceed.
- **Text editing:** while one user edits a variable's name, others see the box tinted with that user's color plus a caret indicator. Variable names are `Y.Text`, so two people typing at once merges character-by-character, though that's rare.

## Presence UI

- **Avatar stack** in the top bar: online users, colored ring, and a dot showing whether they're on the same diagram or another one. Clicking an avatar enters **follow mode**: your viewport tracks theirs until you pan or press Esc.
- **Diagram tabs** show tiny avatars of who is on each diagram.
- **Remote cursors**: an arrow in the user's color plus a name label. The label fades after 3 s of no movement and comes back on move. Off-screen collaborators get edge indicators (small arrows on the viewport border pointing to them).
- **Remote selection**: a dashed outline in the user's color with a name chip at the top-left corner of the bounding box.
- **Cursor chat** (Figma-like, phase 3): press `/` to show a short message bubble at your cursor for 5 s.
- Idle users (60 s without input) have their cursors dimmed.
- Colors: a deterministic palette of 12 accessible colors, hashed from the user id. Users can override theirs in preferences.

## Undo / redo

- One `Y.UndoManager` per client, tracking `diagrams`, `variables` and `meta.defaults`, with `trackedOrigins = new Set([LOCAL_ORIGIN])`. **You only undo your own changes**, never a collaborator's.
- `captureTimeout: 400ms` merges rapid edits, e.g. typing into the same field.
- Selection is stored in the undo stack-item meta and restored after undo/redo.
- Comments are *not* in the undo scope; they have their own delete/edit UI.
- Imports and restores are one transaction and one undo step, with a confirm toast: "Imported 22 variables, 30 links. Undo".

## Comments in real time

Comment threads live in the Y.Doc (`comments` map), so new comments appear for everyone immediately. Read-only `commenter` connections can't write to the Y.Doc, so commenters write through the API:

- `POST /api/projects/:id/comments` → the API checks the role, then applies a Yjs update to the document **through the collab server's direct connection** (Hocuspocus `openDirectConnection`, using an internal service token). This keeps one source of truth while still letting the server enforce "commenters can only touch comments".
- Editors write comments directly through the Y.Doc for speed. A collab `beforeHandleMessage` hook isn't needed for editors.
- Mentions trigger an email/in-app notification through the worker (phase 3).

## Connection states (visible in the UI)

| State | UI |
|-------|----|
| Connecting | Subtle spinner in the top bar, canvas shows the cached IndexedDB state |
| Synced | Small green dot plus "Saved" |
| Unsynced local changes | "Saving…" |
| Offline | Yellow banner "You're offline. Changes will sync when you reconnect." Editing continues |
| Auth expired / access revoked | Modal, editor switches to read-only |
| Schema version mismatch | Modal "A new version is available. Reload" |

## Server hooks (collab)

```ts
new Server({
  extensions: [
    new Logger(), new Redis({ host, port }),
    new Database({ fetch: loadSnapshot, store: storeSnapshot }), // debounced
    new Throttle({ throttle: 300, banTime: 5 }),                // connection flood guard
  ],
  debounce: 2000, maxDebounce: 10000,
  async onAuthenticate({ token, documentName, connection }) { /* verify JWT, check projectId matches, readOnly for viewer/commenter */ },
  async onLoadDocument({ document }) { /* migrate schema */ },
  async onChange({ documentName }) { /* enqueue thumbnail (debounced), bump activity */ },
  async onDisconnect() { /* metrics */ },
});
```

- **Size guard:** reject a document larger than 20 MB, and an incoming update larger than 1 MB.
- **Access revocation:** when a member is removed, the API publishes `revoke:<projectId>:<userId>` to Redis, and collab closes that user's connections.
