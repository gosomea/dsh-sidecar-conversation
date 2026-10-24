# dsh-sidecar-conversation

Ask about selected text or a completed turn in DeepSeek Harness's native sidebar. Version `0.2.0` is an release targeting a DSH `0.2.1-alpha.3` build with the workspace extensions below; Better Sidebar is not required. [简体中文](./README.zh.md)

## Usage

Select text in a completed Assistant reply, or click “侧问这个回合” at the end of a turn, then choose an action:

| Action | Result |
| --- | --- |
| 追加到最近侧问 (append) | Append to the current parent's most recently used Sidecar; shown only when that Session exists and its tab remains open |
| 仅用选文新建／仅用此回合新建 (independent) | Create an independent Session containing the selection or the turn's final answer, plus your question |
| 从此回合 Fork | Create a child Session inheriting history through that turn, with the current reference attached |

The left menu confirms the creation mode and opens the native composer directly. You can attach files, choose permissions and a model, or add more references. New chats do not copy another Sidecar's draft; explicit append preserves the target draft and adds references. Independent Sessions appear alongside the main Session; nested Fork rows depend on DSH's native workspace implementation, which this plugin does not modify.

Sidecar history can create, reopen, archive and restore chats for the current source Session. Closing a tab closes its view without stopping generation. Switching main Sessions, reopening tabs and refreshing restore drafts and references by child Session; sent references remain clickable and highlight their source.

A compact Fork row links the fork turn, lag count and latest parent turn; appending references does not update inherited history. Independent Sessions indicate that they contain references without a Fork gap. Selections are limited to 4,000 characters.

## Permissions and Sessions

Menu-created chats start read-only and can be changed through DSH's native permission picker. Read-only restricts workspace writes, not network access; Sidecars share the source workspace, so tools with write access can change the same files. The plugin does not automatically send replies back to the parent.

Initial titles use the first question’s summary. The native Session title then drives the left row, right tab and history; renames update all three. The left Fork prefix `↳ 侧问 ·` is a display decoration that survives renaming, with legacy prefixes normalized only for display. History uses the native sidebar order, including manual ordering, recency, pins and grouping.

Plugin archival changes Sidecar history status; native Sessions stay unarchived so they can run. Independent Sessions also appear in the source Session's Sidecar history, without establishing native parentage.

## Installation and development

This package requires the local ui-workspace `sidebar.workspaces.session.title` slot and `sessionOrder` service. Stock `0.2.1-alpha.3` does not supply these extensions; the plugin npm package does not include them. [Release requirements](./docs/release-0.2.0.md)

Install local source in an environment matching the target DSH version:

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm test
pnpm build
dsh plugin --profile web add link:$(pwd)
dsh --profile web --dump-config
```

Restart the target Web instance after installation. Validate with a separate DSH_HOME, port and plugin build directory first to avoid rebuilding artifacts served by the daily instance. `--dump-config` proves configuration composition, not runtime loading. [Compatibility and validation limits](./docs/compatibility.md)

Uninstall with `dsh plugin --profile web remove dsh-sidecar-conversation`. Dependencies use public npm packages, without TypeScript paths or workspace links into a local Harness checkout.

## Persistence and validation

Messages, replies, attachments and tool events use native DSH Session capabilities. The plugin stores a Sidecar index and source associations; drafts and tabs are browser state. After clearing browser data, history can reopen sent conversations but cannot recover unsent drafts.

- [Native session logs: ownership, references and upgrade boundaries](./docs/native-session-log.md)
- [2026-10-24 regression: both entry points, switching, reopening and refresh](./docs/regression-2026-10-24.md)
- [Title and order synchronization validation](./docs/title-order-2026-10-24.md)
- [Architecture](./docs/architecture.md) and [development](./docs/development.md)

## License

[Apache License 2.0](./LICENSE)
