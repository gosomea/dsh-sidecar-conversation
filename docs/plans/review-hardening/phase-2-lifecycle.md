# Phase 2 — lifecycle and scale

## Goal

Keep Sidecars bounded and cheap without deleting user history or changing a
running child Session.

## Changes

1. Add an overflow menu to every active Sidecar tab with **Archive**.
2. Add a collapsed **Archived Sidecars** section with restore; do not load
   archived transcripts until restored.
3. Show a soft warning after 20 active Sidecars per parent. Do not auto-delete.
4. Run recovery through a bounded queue. Provisioning records are repaired;
   active records only reassert hiding/read-only facts as required.
5. Replace Registry mutation rollback with one serialized copy-on-write
   transaction: clone → mutate → atomically persist → publish in-memory state.
6. Do not install layout observers while the drawer is hidden. While visible,
   observe the conversation host with ResizeObserver and use one narrowly
   scoped replacement observer. Skip state writes when geometry is unchanged.
7. Keep the current EventSource cleanup, clear transient errors on `ready`, and
   evaluate a supported Harness connection extension before adding a custom
   multiplex protocol.

## Verification

- Archive/restore never changes parent binding or child history.
- 100 records do not create 100 transcript subscriptions.
- Hidden drawer produces no body-wide MutationObserver work.
- Concurrent Registry operations remain identical in memory and on disk when
  an injected write fails.
- Opening and closing a drawer returns the SSE client count to its baseline.

