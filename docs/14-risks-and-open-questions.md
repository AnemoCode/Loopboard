# 14: Risks & Open Questions

## Risks

| # | Risk | Likelihood | Impact | Mitigation |
|---|------|:---------:|:------:|------------|
| R1 | **MDL format details are undocumented** (flags for delay marks, loop direction, shadows, fonts) | High | High | Build the PLE fixture set first. Keep everything unknown as passthrough. Byte-identical round-trip tests. Manual Vensim check per release |
| R2 | The custom canvas engine takes longer than planned | Medium | High | Time-boxed spike in sprint 1. Keep the engine scope tight (no rotation for variables, no freehand). Fallback: React Flow for interaction, with `@cld/render` still used for export |
| R3 | Editor and export rendering drift apart | Medium | Medium | Shared geometry package, plus an automated canvas-vs-export screenshot parity test |
| R4 | Text measurement differs between browsers and the server (wrapping, PDF) | Medium | Medium | Bundle the fonts and do our own layout from font metrics, never platform text APIs. Golden tests |
| R5 | Concurrent edits break invariants (dangling links, duplicate names) | Medium | Medium | Idempotent `repair()` on every client, property-based convergence tests |
| R6 | Editors can write arbitrary Yjs updates (malicious insider) | Low | Medium | Size caps, validation on read, versions for recovery. Optionally a server-side update validator (decode and check) later |
| R7 | Collab server memory grows with many open docs | Low | Medium | Hocuspocus unloads idle documents. Monitor memory. Horizontal scaling through Redis |
| R8 | Vensim license / trademark | Low | Low | Clean-room format implementation from our own files. Don't use the "Vensim" name in branding. Describe it as "compatible with Vensim .mdl files" |
| R9 | Scope creep (simulation, stocks & flows) | High | Medium | Non-goals in 01. Stock/flow only as visual elements, Phase 6+ |
| R10 | Larger diagrams than expected (1,000+ elements) | Low | Medium | SVG with viewport culling, memoization. Benchmark early with synthetic docs |

## Open questions (decide before or during Phase 0/1)

1. **Product name and domain:** "Loopwise" is a placeholder.
2. **Hosting target:** self-host on one VM (e.g. Hetzner, EU) as proposed, or a PaaS (Fly.io / Railway)? The plan assumes a VM with compose.
3. **Who signs up:** open registration, invite-only beta, or university SSO only? This affects the auth providers in Phase 0.
4. **Anonymous editing:** should someone be able to join a workshop through a link *without an account*? It's attractive for classrooms. Phase 5 currently plans anonymous *viewing* only.
5. **Licensing of our code:** open source (AGPL keeps hosted forks open; MIT maximises adoption) or proprietary?
6. **Which Vensim version is the reference?** PLE 10.x is assumed. Do we also need to support files from Stella/iThink (`.stmx`, XMILE) or Kumu exports? XMILE is an open standard and would be a natural second interop format.
7. **Should comments be included in `.mdl` export** (as Vensim comment objects), or dropped?
8. **Loop marker semantics:** keep markers purely visual (as in Vensim), or bind them to detected cycles and warn when they go stale? Proposed: optional binding (Phase 5).
9. **Diagrams vs layers in the UX:** do users really need both on day one? Proposed: diagrams in Phase 1, layers in Phase 4.
10. **Mobile/tablet:** what level of support? Proposed: view and comment on tablets, editing best-effort.
