# dsh-sidecar-conversation

面向 DeepSeek Harness Web 的会话绑定侧边对话插件。侧问作为 dsh-better-sidebar 的第三方 Tab 在右侧并列显示，主对话保持不变，并复用 Harness 原生 Conversation Surface 的消息、工具调用、审批和输入组件。

> 兼容性提示：0.1.0 需要包含 detached Session 与 embedded Conversation Surface 扩展的 Harness 源码构建。当前官方 npm 版 Harness 尚未提供这两个运行时接口；未打补丁的官方 Web 可以安装插件，但打开 Sidecar 时会显示兼容性错误。

## 快速使用

需要 Node.js 22+、兼容的 Harness Web 源码构建，以及 dsh-better-sidebar 0.14+。

    dsh plugin --profile web add dsh-better-sidebar@^0.14.0
    dsh plugin --profile web add dsh-sidecar-conversation
    dsh --profile web --dump-config
    dsh web

源码 Harness 联调：

    cd /path/to/deepseek-harness
    pnpm install
    pnpm run build:lib
    pnpm run build:web
    pnpm dsh web

如果本机已有 dsh-web 源码启动命令，它与最后一条命令等价。重复启动前先停止占用 3080 端口的旧进程。

## 功能与流程

1. 在已完成的 Assistant 回复中选中文字，点击选区旁的“在侧边栏提问”；也可以点击回合操作区的“侧问这个回合”。选区最多 4,000 个字符。
2. 首次发送前选择访问模式：
   - **只读**：可以分析、搜索和查看文件，不能修改工作区。
   - **继承**：沿用分叉点的权限，可以执行原会话允许的修改。
3. 首次发送才创建独立子 Session，主会话不切换、不写回；用户问题会先在 Tab 中显示，再与 Host 历史和实时事件合并。
4. 每个 Sidecar 对应一个 Better Sidebar Tab；“侧问历史”是当前主会话的历史入口。切换主会话只显示属于该父会话的 Tab。
5. 关闭 Tab 只关闭视图，不等于归档，也不会停止后台生成。归档是显式操作，归档后仍可从历史恢复原来的子 Session。

侧问使用主会话的原生 Markdown、代码块、reasoning、工具调用、审批、停止、错误和 composer 组件，不维护第二套聊天 UI。插件只提供选区浮层和 Tab 内容，不修改 Harness Shell 网格，因此可以与兼容当前 Harness 版本的文件、变更、预览和 Explorer Tab 共存。

访问模式在创建后不可切换；要换模式，请从主会话重新创建 Sidecar。Sidecar 与父会话记录隔离，但共享分叉点工作区，工具对共享文件的修改仍可能影响主会话。

## 本地开发

    pnpm check
    pnpm test
    pnpm build
    pnpm pack --dry-run

本仓库是独立 workspace，不依赖外层 Harness checkout 的 TypeScript paths、workspace extends 或 link: 依赖。开发时通过 `dsh plugin --profile web add link:$(pwd)` 接入 Profile；不要手改 profiles/web/cordis.patch.yml。

更多设计说明见[架构](./docs/architecture.md)、[兼容性](./docs/compatibility.md)、[开发](./docs/development.md)和[发布前 TODO](./docs/release-todo.md)。

## 卸载

    dsh plugin --profile web remove dsh-sidecar-conversation
    dsh plugin --profile web remove dsh-better-sidebar

## License

[Apache License 2.0](./LICENSE)
