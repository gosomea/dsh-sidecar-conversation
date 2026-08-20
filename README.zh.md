# dsh-sidecar-conversation

这是 [README.md](./README.md) 的简体中文说明，内容保持一致。插件面向 DeepSeek Harness Web，将选区侧问和整回合侧问作为 dsh-better-sidebar 的第三方 Tab，复用 Harness 原生 Conversation Surface，并让每个 Sidecar 固定绑定一个父会话。

当前仅支持本地联调：先使用 Harness rc.8 即将合入通用 embedded Conversation Surface 的源码构建版本，安装/升级 dsh-better-sidebar@^0.14.0，再链接本地插件：

    cd /path/to/dsh-sidecar-conversation
    pnpm install
    dsh plugin --profile web add dsh-better-sidebar@^0.14.0
    dsh plugin --profile web add link:$(pwd)

    cd /path/to/deepseek-harness
    pnpm run build:lib
    pnpm run build:web
    pnpm dsh web

完整功能流程、权限说明、Tab 生命周期和发布步骤请看[主 README](./README.md)。当前不发布 npm，也不要按公开安装流程使用未验收的版本。
