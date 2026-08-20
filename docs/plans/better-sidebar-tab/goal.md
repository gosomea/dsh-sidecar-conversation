# Execution goal

```text
/goal Make dsh-sidecar-conversation a native third-party Better Sidebar Tab plugin while preserving its durable Sidecar semantics and native DSH conversation UI.
Scope: dsh-sidecar-conversation plus the minimum generic embedded-Session/Conversation-Surface changes in a separate deepseek-harness rc.8 worktree. Do not modify unrelated plugins or the dirty Harness checkout.
Constraints:
• Preserve all existing uncommitted user changes; no reset, checkout overwrite, or stash of the dirty Harness checkout.
• Keep child Sessions hidden from primary navigation and permanently bound to one parent Session.
• Better Sidebar owns panel geometry, split panes, tab persistence, and visibility.
• Sidecar Host APIs remain the authority for creation, access mode, prompt wrapping, and idempotency.
• Do not ship a custom transcript fallback.
Done when:
1. Harness focused runtime/renderer/conversation tests pass for a non-current hidden Session Surface without changing current navigation.
2. Sidecar registers/disposes Better Sidebar chat/history tabs and no longer mutates the main conversation layout.
3. Selection and whole-turn drafts send immediately, reuse native conversation components, and survive parent-session switching.
4. pnpm check, pnpm test, pnpm build, and pnpm pack --dry-run pass in the Sidecar repository.
5. A source-built dsh web profile loads one Better Sidebar host and completes the documented manual acceptance flow.
Stop if:
• The rc.8 APIs cannot support a detached Session without exposing it in primary navigation or changing current selection.
• A required change would overwrite unrelated user work or require publishing unofficial @deepseek-ai packages.
```

