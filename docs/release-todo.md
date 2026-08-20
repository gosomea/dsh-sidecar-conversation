# v0.1.0 发布前 TODO

当前状态：

- [ ] Better Sidebar Tab 重构完成手动验收
- [x] 在包含通用 embedded Conversation Surface 的 Harness rc.8 源码构建中完成 Web 联调（2026-08-20 自动 smoke test；仍待用户回归）
- [x] 发布 npm：`dsh-sidecar-conversation@0.1.0`（2026-08-20）
- [ ] 创建 Git 标签和 GitHub Release
- [x] 验证 npm 官方 registry 可公开读取版本和 tarball（2026-08-20）
- [ ] 验证干净 DSH profile 的公开安装与完整交互

`0.1.0` 已发布到 npm。当前主要安装方式是：先安装/升级 `dsh-better-sidebar@^0.14.0`，再从 npm 安装 `dsh-sidecar-conversation`。完整功能仍需使用包含 embedded Conversation Surface 的兼容 Harness 源码构建。

## 用户验收

- [ ] Assistant 选区旁的“在侧边栏提问”在拖选结束后稳定可点击，移动到按钮不会丢失选区。
- [ ] 任意已完成回合的“侧问这个回合”入口可打开 draft Tab 并正常发送。
- [ ] 首次发送前明确选择“只读”或“继承”，没有默认替用户选择继承权限。
- [ ] 只读可分析/搜索/查看文件但不能修改工作区；继承沿用分叉点权限。
- [ ] 首次提问立即显示在 Sidecar Tab；native Surface 后续显示 Markdown、reasoning、工具、审批、question、running、停止、错误和重试，且不出现包装英文文本。
- [ ] 输入法组合期间回车不会误发送，组合结束后回车发送正常。
- [ ] 每个 Sidecar 只有一个 Better Sidebar Tab；历史 Tab 可点击切换，选文卡片可删除。
- [ ] 关闭 Tab 不归档、不停止后台生成；重开后历史补齐且不重复。
- [ ] 切换主会话只显示所属父会话的 Sidecar，返回后恢复原 Tab；主会话不会被覆盖。
- [ ] 与 AionUI/文件/变更/预览/Explorer 同时安装时不新增列、不覆盖主会话。
- [ ] 缺少 Better Sidebar 或 embedded Surface 时不会卡在 Loading plugins…，并显示明确错误。
- [ ] 深色/浅色主题、窄窗口、刷新和 3080 端口重启均正常。

## 本地验证

    pnpm install --frozen-lockfile
    pnpm check
    pnpm test
    pnpm build
    pnpm pack --dry-run

    dsh plugin --profile web add dsh-better-sidebar@^0.14.0
    dsh plugin --profile web add link:$(pwd)
    dsh --profile web --dump-config

源码 Harness 联调：

    cd /path/to/deepseek-harness
    pnpm run build:lib
    pnpm run build:web
    pnpm dsh web

## npm 发布（已完成）

登录和发布必须显式使用 npm 官方 registry：

    npm login --registry=https://registry.npmjs.org/
    npm whoami --registry=https://registry.npmjs.org/
    npm publish --access public --registry=https://registry.npmjs.org/
    npm view dsh-sidecar-conversation version --registry=https://registry.npmjs.org/

验证结果为 `0.1.0`。后续版本仍需先更新 README、兼容性说明和本清单，再执行发布。

## 标签与 Release（npm 发布成功后再执行）

    git tag v0.1.0
    git push origin v0.1.0

之后可以在 GitHub 基于 v0.1.0 创建 Release。标签必须对应已验证的 npm 发布提交。

## 公开安装验证（发布成功后再执行）

在没有本地 link: 依赖的干净 Web profile 中：

    dsh plugin --profile web add dsh-better-sidebar@^0.14.0
    dsh plugin --profile web add dsh-sidecar-conversation
    dsh --profile web --dump-config
    dsh web

卸载：

    dsh plugin --profile web remove dsh-sidecar-conversation
    dsh plugin --profile web remove dsh-better-sidebar
