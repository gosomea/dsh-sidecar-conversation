# 原生列表与空侧问生命周期修复

本次修复发布为 0.2.8。只修改侧问插件，DSH 源码未修改。

## 行为

- 默认使用完整原生会话列表，只在底部提供层级视图切换，记住用户选择。已有明确的选择继续保留。
- 原生行、工作区管理、搜索、拖动、置顶、归档由 DSH 渲染和处理。可选层级视图仍是插件渲染，不能宣称直接复用了未公开的 SessionNodeItem / ProjectRowItem。
- 独立侧问通过原生 create({ cwd }) 创建，未开始原生 turn/start 前不加入工作区成员，避免原生 New Session 复用其只读权限。
- 启动恢复把旧版空侧问移出工作区成员；不删除 Session，不重写权限，侧问历史入口继续可用。
- 首轮开始后通过原生 workspace.attachSession 加入父会话的工作区。pendingWorkspace 在移出前持久化，异常中断后可恢复；完成后清除，避免重启时把用户主动移出的已发送会话重新加入。
- 主会话的创建及权限预设仍完全由 DSH 负责。

## 验证

2026-10-26，本机 Node 24：

- pnpm test：24 个文件，199 项测试通过。覆盖旧空侧问权限事件保持、workspace membership 幂等、已发送会话主动移出、首轮持久化恢复、默认原生列表与切换持久化。
- pnpm build / TypeScript 检查通过，git diff --check 通过。
- 打包安装到已登记的 3187 隔离 home，使用未修改的 DSH rc.3；未重建 DSH。
- 浏览器从主会话第 4 轮选择“仅用此回合新建”：右侧默认“仅可查看”，原生输入框与引用可用。独立查询存储确认未发送侧问不在工作区成员中，pendingWorkspace=true。
- 保留这个侧问草稿，点击原生新建会话：主会话显示原生“工作区内修改”，没有复用侧问权限。返回父会话后草稿及引用仍在。
- 用 deepseek-codebuddy/deepseek-v4.1-flash High 发送真实请求，得到 SIDECAR-LIFECYCLE-OK。存储确认子会话成为工作区成员且 pendingWorkspace=false，主会话仍为 4 轮。
- 原生列表切换层级视图、折叠父会话、刷新：折叠与当前侧问保持；切回原生列表，完整原生工作区控件与消息保持。

Windows GUI 本轮未实测；跨平台 CI 的结果以本次发布记录为准。旧版不兼容的其他插件不在本次修复范围内。

## 3080 部署

安装相同本地 tarball 并重启，未发布新 npm 版本。重启前备份会话、侧问索引、工作区与 profile。

备份共有 1,431 个会话文件；重启恢复后原有日志内容保留。一次原生恢复在一条 Session 日志末尾追加 session/end-seed，旧内容保持完整前缀，其余文件逐字节一致。39 条侧问记录和全部 prompt receipts 保留，索引仅新增草稿 reservation 状态。3 条空侧问被标记待加入工作区；已确认旧 read-only + never 的问题侧问从工作区复用候选中排除，没有改写它的权限。

部署后在 sop-agent-2 的原生工作区行点击新建会话：输入框显示“完全权限”，没有复用旧侧问的 Custom；底部层级切换入口可见。

本地证据位于 .playwright-mcp/lifecycle-20261026/，包括 native-new.png、native-sidecar.png 和 daily-native.png；该目录不提交。
