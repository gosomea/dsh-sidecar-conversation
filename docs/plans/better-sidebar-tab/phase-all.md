# Phases

## Phase 1 — safe rc.8 foundation

- Create an independent Harness worktree from `origin/master` (rc.8).
- Port only the detached Session and native embedded Conversation Surface work.
- Add focused runtime, renderer, and conversation tests plus an Agent Note.

## Phase 2 — Better Sidebar tab shell

- Add the optional Better Sidebar peer and dynamic Cordis service injection.
- Register dynamic chat tabs and the singleton history tab.
- Move draft, active, close, archive, visibility, and parent binding onto the
  Better Sidebar lifecycle.

## Phase 3 — native conversation parity

- Bind each visible chat tab to the generic native Surface.
- Route text submit through Sidecar Host APIs while preserving native composer,
  approval, question, running, retry, tool, and stop presentation.
- Remove the old drawer, layout observer, internal tabs, and duplicate cards.

## Phase 4 — migration and responsiveness

- Convert legacy browser UI state into versioned tab metadata once.
- Show the first optimistic user message immediately.
- Stop waiting for durable history before the create route returns after a
  successfully admitted first prompt.

## Phase 5 — compatibility and verification

- Verify the rc.8 + Better Sidebar profile contains one right-panel provider.
- Run focused Harness tests and all Sidecar check/test/build/pack commands.
- Exercise selection, whole-turn, IME, session switching, hidden generation,
  close/reopen, archive/restore, and missing-dependency boot behavior in Web.

