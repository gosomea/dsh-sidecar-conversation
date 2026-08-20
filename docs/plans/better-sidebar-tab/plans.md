# Better Sidebar Tab integration

## Background

`dsh-sidecar-conversation` currently owns a floating drawer, conversation-column
geometry, internal conversation tabs, and a partial native Surface bridge. This
duplicates a panel host that `dsh-better-sidebar` already exposes to third-party
plugins through `ctx.betterSidebar.registerTab()`.

The closest ecosystem precedent is `dsh-sidebar-qa`, but it owns a custom
transcript and polling loop. Sidecar keeps its Host registry, immutable
parent-child binding, access boundary, idempotent prompt routes, and native DSH
conversation rendering. Only the panel host and tab lifecycle move to Better
Sidebar.

## Main line

1. Port the generic detached-Session and native Conversation Surface work to a
   clean Harness rc.8 branch without changing the dirty source checkout.
2. Make the Surface support a custom text-submit adapter so Sidecar keeps its
   Host-enforced prompt wrapper and stable RPC identities while reusing the
   native transcript, composer, interactions, and stop controls.
3. Register one hidden dynamic Better Sidebar chat tab per Sidecar plus one
   singleton history tab.
4. Remove the Sidecar drawer, layout mutation, internal tab strip, and custom
   interaction renderer. Keep only the selection popover as a shell overlay.
5. Preserve the Host registry and migrate existing browser UI state into
   Better Sidebar tab metadata without deleting the old storage document.

## Locked decisions

- Better Sidebar is the only right-panel host.
- Harness rc.8 is the implementation base.
- One Sidecar conversation equals one Better Sidebar tab.
- Closing a tab does not archive the Sidecar.
- No custom transcript fallback is shipped.
- The npm release waits for an official Harness version containing the generic
  embedded Surface API.

