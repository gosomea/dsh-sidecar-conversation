# Architecture

## Components

```text
Selection menu / Turn action ── opens parent-scoped draft
       │
       ▼ first send
First Sidecar: Host create route ── validate source ── fork ── persist provisioning binding
                                                    └── apply/verify access ── rename ── prompt ── activate
Existing Sidecar: optimistic user item ── validate parent source ── append context prompt ── reconcile by RPC ID
       │                                  │
       │                                  └── $DSH_HOME/sidecar-conversation.json
       ▼
SSE broker ── session/event ── visible drawer transcript reducer
                                  ▲
                                  └── history tail on ready/reconnect
```

The Registry is the authority for the relation between a parent and a child. DSH's ordinary `parentSessionId` lineage is useful for navigation but is not treated as proof that a Session is an authorized Sidecar.

## Invariants

1. `parentSessionId` is written once and no API can mutate it.
2. Create and prompt retries derive stable RPC IDs and check durable history before sending.
3. A binding is persisted before the first prompt. Rename is best effort and cannot destroy the binding.
4. Source validation always requires one exact finalized `assistant/message` seq/id. Selection sources additionally verify that the normalized quote belongs to that message; whole-turn sources inherit context from the fork and carry no synthetic quote.
5. A new source entry prepares a new Sidecar and exposes its access-mode choice directly. Reusing the active Sidecar is explicit; when selected, the Host validates the new source against the bound parent before wrapping it as reference data.
6. Optimistic client messages are transient and are not persisted in browser storage. They remain visible on failure and are removed only after a real `user/message` with the acknowledged RPC ID arrives through SSE or history.
7. The drawer renders only records for `SessionListState.current`; state is bucketed by parent ID.
8. Hiding or switching the drawer closes EventSource and releases transcript memory, but does not cancel the Host Session. Reopening establishes SSE first and then reads history.
9. Access mode is part of the immutable binding. A new Sidecar defaults to `read-only`; v1 records migrate to `inherit` to preserve their previous behavior.
10. `read-only` is activated before the first prompt with durable `sandbox/mode=read-only` and `approval/policy=never` events. A synchronous global tool guard denies calls if those facts later drift. `inherit` snapshots the effective fork-point values for display but does not live-sync with its parent.
11. Ordinary Sidecar questions are wrapped as data before reaching the Session prompt endpoint, so leading slash text cannot invoke hidden-Session commands.

## Layout coexistence

The root entry occupies the additive `shell.overlay` list slot. It observes the parent of `[data-conversation-scroll]`, reserves a 400–720 px internal lane with right padding, and positions the Sidecar exactly in that lane. The main transcript and composer therefore shrink instead of being obscured. It neither reads private AionUI classes nor writes `grid-template-columns`; details, preview, and explorer remain separate Shell columns. Below 840 px the Sidecar uses the complete conversation rectangle as a compact fallback.

## Persistence failure

Writes create a unique sibling temporary file with mode `0600`, write and `fsync` it, rename atomically, chmod the destination, and `fsync` its directory. Invalid existing JSON is kept byte-for-byte and makes the registry read-only for the process lifetime.

Creation uses a `provisioning` registry state. Startup recovery re-hides every child, completes interrupted provisioning idempotently, and reapplies the locked read-only policy before an incomplete Sidecar becomes visible.
