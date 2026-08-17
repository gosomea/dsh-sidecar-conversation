# dsh-sidecar-conversation

[![CI](https://github.com/gosomea/dsh-sidecar-conversation/actions/workflows/ci.yml/badge.svg)](https://github.com/gosomea/dsh-sidecar-conversation/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](./LICENSE)

为 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) Web 提供与主会话绑定的侧边对话。

选中 Assistant 回复中的文字，或者对整个回合发起侧问，即可在主对话右侧继续交流。侧问拥有独立上下文和历史，不会打断或改写主会话。

## 功能

- 选中文字后直接出现“在侧边聊天中提问”。
- 支持对整个 Assistant 回合发起侧问。
- 侧问固定绑定父会话，切换主会话后自动隐藏和恢复。
- 每次新建时选择“只读”或“继承”权限。
- 支持 Markdown、代码块、reasoning、工具调用、审批、停止生成和实时历史。
- 可与 `dsh-aionui-panel` 的文件、变更、预览和 Explorer 面板同时使用。

## 快速安装

需要 Node.js 22+ 和可正常运行的 `dsh web`。

```bash
dsh plugin --profile web add dsh-sidecar-conversation
dsh --profile web --dump-config
dsh web
```

`--dump-config` 输出中出现 `dsh-sidecar-conversation` 即表示插件层已加载。

## 使用流程

1. 在已完成的 Assistant 回复中选中文字，点击“在侧边聊天中提问”；也可以点击回合操作区的“侧问这个回合”。
2. 在右侧选择权限：
   - **只读**：可以分析、搜索和查看文件，不能修改工作区。
   - **继承**：沿用分叉点的权限，可以执行原会话允许的修改。
3. 输入问题并发送。首次发送时创建独立子 Session，主对话保持不变。
4. 之后可在右侧继续对话，或通过顶部标签切换该父会话的历史侧问。

每次从主对话发起侧问时默认准备一个新的 Sidecar。如果希望追加到当前 Sidecar，点击“继续当前侧问”。权限创建后不可切换；需要其他权限时请新建 Sidecar。

## 卸载

```bash
dsh plugin --profile web remove dsh-sidecar-conversation
```

## 从 GitHub 安装

```bash
dsh plugin --profile web add github:gosomea/dsh-sidecar-conversation
```

GitHub 安装需要为 `prepare` 构建脚本授权。npm 包已经包含构建后的 `lib/`，因此推荐使用 npm 安装。

## 本地开发

```bash
git clone https://github.com/gosomea/dsh-sidecar-conversation.git
cd dsh-sidecar-conversation
corepack enable
pnpm install --frozen-lockfile
pnpm check
pnpm test
pnpm build
dsh plugin --profile web add link:$(pwd)
```

更多信息：[架构](./docs/architecture.md) · [兼容性](./docs/compatibility.md) · [开发说明](./docs/development.md)

## License

[Apache License 2.0](./LICENSE)
