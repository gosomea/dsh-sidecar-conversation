# dsh-sidecar-conversation

面向 DeepSeek Harness Web 的会话绑定 Sidecar 对话插件。在已完成的 Assistant 消息中选中文字，会就地出现“在侧边聊天中提问”；每个已完成回合也可直接整体侧问。主对话和侧边对话在聊天中心列内并排，不改变主会话。

## 核心行为

- 打开草稿不创建 Session。每次从主对话发起侧问时，右侧直接展示“只读 / 继承”并准备新建独立 Sidecar；只有明确点击“继续当前侧问”才复用已有 Sidecar。
- 发送后用户问题会立即乐观显示，再用 RPC ID 与 SSE/History 中的真实消息合并去重；无需等待 Host 校验和事件回传才看到自己的提问。
- Sidecar 永久绑定一个父 Session。切换主会话后不显示其他会话的 Sidecar；切回时恢复该父会话自己的活动标签、宽度和草稿。
- 首次创建可选择“只读”或“继承”。只读模式固定为 `read-only` sandbox + `never` approval；继承模式沿用分叉点当时的权限。模式创建后不可切换，抽屉隐藏后生成仍可继续。
- 插件注册到 additive `shell.overlay`，只在 `[data-conversation-scroll]` 所属的聊天中心列中预留 Sidecar lane，不修改 Shell 网格，因此可与 `dsh-aionui-panel` 的 details、preview、explorer 共存。
- 视觉使用 Harness 自身的 CSS tokens 与 UI primitives，自动跟随深色/浅色主题。
- 父子对话记录隔离，但共享工作区。Sidecar 中的 Bash/Edit 仍可能影响相同文件。

## 本地安装

```bash
pnpm install
pnpm check
pnpm test
pnpm build

dsh plugin --profile web add link:$(pwd)
dsh web
```

插件 patch 位于仓库根目录 [`cordis.patch.yml`](./cordis.patch.yml)。Host Registry 位于 `$DSH_HOME/sidecar-conversation.json`，浏览器状态键为 `dsh.sidecar-conversation.ui.v1`。

## 使用

1. 选文侧问：在已完成的 Assistant 消息中选择不超过 4,000 字符的文字，点击就地出现的“在侧边聊天中提问”。
2. 整回合侧问：点击已完成回合尾部的“侧问这个回合”，无需制造伪引用文本。
3. 选择访问模式并发送。默认“只读”；只有明确选择“继承”才会沿用分叉点权限。插件创建标题为 `↳ 侧问 · <选文摘要>` 或 `↳ 侧问 · 整个回合` 的子 Session。若要避免新建，可明确选择“继续当前侧问”。
4. 在抽屉中继续提问、切换多个 Sidecar、停止生成或处理审批。

纯文本对话、实时补历史、reasoning/tool 折叠、停止、审批和结构化问题均可在抽屉完成。

## 安全边界

“只读”准确指工作区文件系统只读：Host 在发送首问前写入并校验 Session 的 sandbox/approval 事实，并在工具边界检测策略漂移。它不承诺阻断网络读取，也不能替第三方 MCP 判定外部 API 是否有副作用。Sidecar 输入中的 `/permission` 等文本不会作为隐藏 Session 命令执行。

HTTP API 只接受 loopback 同源请求、限制 JSON body，并拒绝未登记的 child Session。Registry v2 使用 `0600` 临时文件、`fsync` 和原子 rename；旧 v1 记录迁移为“继承”，若文件损坏则保留原文件并停止写入，绝不覆盖用户数据。

详见[架构](./docs/architecture.md)、[兼容性](./docs/compatibility.md)和[开发指南](./docs/development.md)。

## License

Apache-2.0
