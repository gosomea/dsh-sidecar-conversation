# dsh-sidecar-conversation

这是 [README.md](./README.md) 的简体中文说明，内容保持一致。插件面向 DeepSeek Harness Web，将选区侧问和整回合侧问作为 dsh-better-sidebar 的第三方 Tab，复用 Harness 原生 Conversation Surface，并让每个 Sidecar 固定绑定一个父会话。

0.1.0 需要包含 detached Session 与 embedded Conversation Surface 扩展的 Harness 源码构建。当前官方 npm 版 Harness 尚未提供这两个运行时接口；未打补丁的官方 Web 可以安装插件，但打开 Sidecar 时会显示兼容性错误。

    dsh plugin --profile web add dsh-better-sidebar@^0.14.0
    dsh plugin --profile web add dsh-sidecar-conversation
    dsh --profile web --dump-config
    dsh web

本地开发才使用 link：

    cd /path/to/dsh-sidecar-conversation
    pnpm install
    dsh plugin --profile web add link:$(pwd)

    cd /path/to/deepseek-harness
    pnpm run build:lib
    pnpm run build:web
    pnpm dsh web

完整功能流程、权限说明、Tab 生命周期和兼容边界请看[主 README](./README.md)。
