# 开发

## 独立仓库检查

    corepack enable
    pnpm install --frozen-lockfile
    pnpm check
    pnpm test
    pnpm build
    pnpm pack --dry-run

仓库根目录是独立 workspace；不要把它加入外层 Harness workspace，也不要添加指向本机 Harness checkout 的 TypeScript paths、extends 或 link: 依赖。修改客户端或 Host 后，使用本地 link: 安装到 Web profile：

    dsh plugin --profile web add dsh-better-sidebar@^0.14.0
    dsh plugin --profile web add link:$(pwd)
    dsh --profile web --dump-config

## 源码 Harness 联调

本地 Harness 必须是包含通用 embedded Conversation Surface 的 rc.8 源码构建。示例：

    cd /path/to/deepseek-harness
    pnpm install
    pnpm run build:lib
    pnpm run build:web
    pnpm dsh web

若使用项目外的 dsh-web wrapper，确认它最终执行的是同一份源码的 apps/cli/src/bin.ts 和 Web 构建产物。重复启动前先结束旧的 Web 进程，避免 127.0.0.1:3080 的 EADDRINUSE；客户端代码更新后可刷新页面，Host 或 profile 变更需要重启。

源码 Shell 与现有用户 profile 不能混用不同 release 的核心客户端包。比如 rc.8 Web 资产配 rc.6 的 `@deepseek-ai/dsh-client-modules` 会在 bootstrap face 阶段失败，rc.8 `ui-reference` 配 rc.6 `dsh-api-remotes` 会一直等待新的 remote services。联调 profile 应让 `dsh-client-modules`、`dsh-api-remotes`、runtime、ui-conversation、ui-renderer 和 ui-slots 来自同一源码 checkout；发布版 Harness 则应统一使用同一 release 的已发布包。

不要手改 profiles/web/cordis.patch.yml。dsh plugin 会维护 profile manifest；卸载时使用：

    dsh plugin --profile web remove dsh-sidecar-conversation
    dsh plugin --profile web remove dsh-better-sidebar

## 实现边界

- src/host/：Registry、Host API、访问模式、幂等 create/prompt、SSE。
- src/client/better-sidebar.ts、tab-meta.ts：Better Sidebar 第三方 Tab 注册、定向打开、版本化 meta 和动态可选服务接入。
- src/client/components/SelectionOverlay.tsx：冻结选区并打开 draft Tab；不在拖选过程中重新读取选区。
- src/client/components/SidecarTabs.tsx：draft/history 视图和 native Surface 挂载；不实现第二套 transcript。
- src/client/controller.ts：Sidecar Host API、父会话候选消息和 native Surface 适配。
- src/client/legacy-migration.ts：一次性迁移旧浏览器 UI 状态到 Better Sidebar meta。

## 测试重点

自动测试应覆盖：

- 父子绑定不可变、来源 message id/canonical seq/quote 校验和历史分页。
- create/prompt 重试不会重复 fork 或 prompt；乐观用户消息按 RPC ID 合并。
- 只读权限固定与策略漂移拒绝；继承模式保留分叉点权限；slash 文本不触发隐藏命令。
- Better Sidebar Tab id/path/meta 稳定、draft→active 不换 Tab、history 单例和 dispose。
- Tab 关闭只释放 Surface；父会话切换只显示所属 Sidecar；隐藏期间生成继续并可补历史。
- 选区浮层在鼠标移入按钮时不丢失，整回合入口、IME 回车和删除引用片段正常。
- 缺少 Better Sidebar 或 embedded Surface 时 Web 不挂死，并给出明确错误。
- 与兼容当前 Harness release 的文件/变更/预览/Explorer Tab 共存，不修改主会话布局。

手动回归至少检查：选文、整回合、只读/继承、首问即时显示、原生工具/审批/停止、关闭/重新打开、归档/恢复、切换父会话、深浅色主题和 3080 端口重启。
