# dsh-sidecar-conversation

**Turn part of your main conversation into a lasting conversation beside it.**

In DeepSeek Harness Web, select part of an answer, ask about a whole turn, or fork from an earlier point. Sidecars run in the native right sidebar with their own messages, drafts, model and permissions while your main conversation stays in place.

[简体中文](./README.zh.md) · [GitHub Release](https://github.com/gosomea/dsh-sidecar-conversation/releases/tag/v0.2.0) · [npm](https://www.npmjs.com/package/dsh-sidecar-conversation)

## What you can do

- **Explain part of an answer:** select unfamiliar text and ask about it with a source reference.
- **Continue an existing Sidecar:** append new text or a whole-turn reference to the most recently used Sidecar without losing its draft question.
- **Explore another direction:** fork an earlier turn's context while the main conversation continues its work.
- **Start with references only:** create an independent Session containing explicit references and your question, without inheriting the full conversation.

The right-hand chat uses DSH's native composer: file uploads, model and reasoning selection, permission controls, messages, tool calls, approvals, stop and error displays. A Sidecar supports continued conversation across multiple turns.

## Two entry points, the same choices

Select text in a completed Assistant answer, or click “侧问这个回合” at the end of a turn, to open the action menu.

| Menu action | Text selection | Whole turn |
| --- | --- | --- |
| 追加到最近侧问 (append) | Add the selected text to the target draft | Add a whole-turn reference to the target draft |
| 仅用选文新建／仅用此回合新建 (independent) | Start with only the selected text | Start with only that turn's final Assistant answer |
| 从此回合 Fork | Inherit history through the selection's turn and attach its text reference | Inherit history through the turn and attach its turn reference |

Append appears only when the current main Session has a prepared Sidecar whose tab remains open. The menu therefore has two creation choices, or three choices including append. If the right dock is collapsed but the tab remains open, append reveals the target Sidecar. Closed tabs and unprepared drafts are not eligible targets.

The left menu determines the creation mode. Choosing a new chat prepares its Session and opens the native composer directly, without another mode choice or an automatic model call. The new draft contains only the current source and does not copy another Sidecar's selections.

## From references to continued conversation

1. Select text or a turn on the left, then choose append, independent creation or Fork.
2. Edit your question on the right and choose files, model and permissions as needed. Add references from the left one at a time, or remove individual draft references.
3. Click a draft reference to return to and highlight its source. References remain clickable in sent messages.
4. Continue in the current Sidecar after sending. Switching main Sessions, reopening tabs and refreshing restore each child Session's state without mixing selections or returning to an older Sidecar.

Selections are limited to 4,000 characters. A whole-turn reference points to the final Assistant answer; independent Sessions receive that explicit reference, while only Fork inherits earlier history. Missing or unreadable sources produce an error while preserving the reference.

## Fork and independent Sessions

| | Linked Sidecar (Fork) | Independent Session |
| --- | --- | --- |
| Context | Main conversation history through the selected turn | Only explicitly added references and questions |
| Native relationship | Child of the main Session | No native parent, alongside the main Session |
| Fork progress | Links the fork turn, lag count and latest parent turn | Indicates references only, without a Fork gap |
| History entry | Listed in the source Session's Sidecar history | Also recoverable from the source Session's Sidecar history |

A Fork contains context from the point of branching and does not follow the main conversation live. The progress row updates when the main Session adds turns; appending references neither reduces the lag count nor merges later history automatically.

Both modes use the source workspace. Menu-created chats start read-only and can be changed through native permission controls; tools with write access modify the same workspace files. Read-only does not imply network isolation. Sidecar messages belong to their own Session and are not automatically sent back to the main conversation.

## Titles, history and recovery

Initial titles summarize the first question. The left list, right tab and history then read the native Session title, including manual renames. The left Fork prefix `↳ 侧问 ·` is a display decoration and is not stored in new Session names. Sidecar history follows native manual ordering, recency, pins and grouping.

Sidecar history supports creation, reopening, archival and restoration. Closing a tab closes its view without stopping background generation; plugin archival does not delete the native Session. History creation starts from the main Session's latest completed answer and offers Fork or independent mode; without a completed answer, it asks you to finish a turn first.

Messages, replies, attachments and tool events use native DSH Session capabilities. `sidecar-conversation.json` stores the Sidecar index; drafts and tab layouts are browser state. After clearing browser data, history can reopen sent conversations, but session logs cannot recover unsent drafts. [Native session-log ownership and upgrade boundaries](./docs/native-session-log.md)

## Check DSH compatibility before installation

Version `0.2.0` uses DSH `0.2.1-alpha.3` APIs and requires these **local ui-workspace extensions** in the target build:

- `uiWorkspace.sessionOrder`: provides the native sidebar's Session order.
- `sidebar.workspaces.session.title`: decorates linked Sidecar titles.

Stock npm DSH `0.2.1-alpha.3` does not include these extensions, and the plugin package does not ship DSH core modifications. Installing the plugin alone cannot supply them; a missing order interface produces an explicit error. Nested rows also depend on the target DSH build. Better Sidebar is not required. [Full compatibility details](./docs/compatibility.md)

In a DSH environment with these capabilities, install a locally built plugin through the Web profile:

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm test
pnpm build
dsh plugin --profile web add link:$(pwd)
dsh --profile web --dump-config
```

Restart the target Web instance after installation. `--dump-config` proves composition only; open the page to verify runtime loading. Use a separate DSH_HOME, port and plugin directory for development builds to protect your daily instance. Uninstall with `dsh plugin --profile web remove dsh-sidecar-conversation`. [Development and verification](./docs/development.md)

## Validation records

The plugin passes 140 tests and TypeScript checks; its release tarball passed an independent build, entry checks, clean installation and Host-entry import. Browser and real-model coverage are recorded separately below:

- [Both entry points, main-Session switching, reopening, refresh and reference navigation](./docs/regression-2026-10-24.md)
- [Native titles, ordering, manual renames and post-deployment data checks](./docs/title-order-2026-10-24.md)
- [Architecture boundaries between native Sessions and the plugin](./docs/architecture.md)

These results do not imply that every DSH Web check passes; the linked records describe known baseline failures and remaining coverage gaps.

## License

[Apache License 2.0](./LICENSE)
