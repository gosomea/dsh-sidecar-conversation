# Phase 3 — native conversation surface

## Constraint

A standalone plugin must not import Harness private components or private CSS.
The current public SDK exposes primitives and slots, but not a complete
embeddable conversation bound to an arbitrary Session.

## Recommended path

1. Propose an upstream public `ConversationSurface` contract that accepts a
   `SessionBinding`/session-scoped provide face and presentation flags.
2. Make the main conversation use that same surface first, proving it is not a
   Sidecar-only fork.
3. Mount the public surface in Sidecar with the archived child binding.
4. Add Sidecar-only chrome outside the shared surface: source pill, access
   label, tabs, archive, and parent-session visibility.
5. Delete the custom transcript parser, approval/question cards, tool rows,
   running state, cancel wiring, and composer after parity tests pass.

## Compatibility policy

Do not ship a compatibility transcript renderer. A host without the public
Surface reports a compatibility error. An iframe, DOM cloning, and a renderer
assembled from primitives are rejected because they duplicate routing/state or
drift from the main Session UI.

## Verification

- Main and Sidecar render identical Markdown, reasoning, tool calls/results,
  approvals, questions, queued prompts, streaming state, errors, and stop UI.
- A Harness UI upgrade requires no Sidecar-specific transcript changes.
- Native Web and Web+AionUI layouts pass the same interaction suite.
