# 0.2.1 插件内适配与官方包验收

`0.2.1` 可以安装在未修改的官方 npm DSH `0.2.1-alpha.3` 上。它移除了 `0.2.0` 对两个本地定制接口的依赖，不需要修改 DSH 源码。

## 接入方式

- 原生 Session 标题仍是左栏、右侧 Tab 和历史的名称来源。
- 关联侧问通过现有 `sidebar.session.row.leading` 插槽显示 `↳`，通过 `sidebar.session.row.hover` 补充来源信息。原生待处理、未读和运行状态优先显示；归档原生行不显示箭头。独立会话保持普通行。
- `workspace-adapter.tsx` 从公开 slot ledger 取得 `sidebar.workspaces` 的共享 store handle，在同为 root scope 的 `shell.overlay` 注册无 UI 的只读组件。框架提供原有 store 实例；插件不调用 create、不读原生 localStorage key、不写排序偏好。
- 适配器结合原生 Session、Workspace 快照，投影手动顺序、最近更新、置顶和分组。只保存一份内存快照供历史订阅；归档和折叠不丢失历史条目。DSH 升级时需要回归这一处视图适配。

官方 DSH 没有父子 Session 折叠插槽，此修复包不替换整个原生列表来模拟它。本地定制 DSH 的折叠功能独立于本次适配。

## 隔离基线

使用全新 npm 运行时 `@deepseek-ai/dsh@0.2.1-alpha.3`，独立 DSH_HOME、profile 和 3187 端口。插件从构建后的 `0.2.1.tgz` 经 `dsh plugin --profile web install --ignore-scripts` 安装；profile 依赖为 `file:`，最终 lockfile 包含 tarball integrity，实际安装目录不是源码 symlink。早期诊断留下的 link 与虚拟 store 已清理后重装。

模型与日常路由一致：`deepseek-codebuddy / deepseek-v4.1-flash`，High。测试工作区由原生 Workspace/Session API 绑定；发送模型任务前核对原生 v4 header 中的 cwd。

## 已执行的验证

| 范围 | 证据与结果 |
| --- | --- |
| 插件检查 | TypeScript 检查、21 个文件共 147 项测试通过。覆盖视图投影、原生 store 共用、延迟注册/卸载/替换、源引用隔离和原有业务回归。 |
| 原版加载 | 官方 npm Host 启动，浏览器能操作插件；运行时不提供两个定制接口，客户端也不再引用它们。 |
| 原生聊天 | 浏览器回合菜单创建 Fork 和独立会话，分别收到 `STOCK-FORK-OK`、`STOCK-INDEPENDENT-OK` 真实模型回复。父会话保持选中，发送后没有跳回旧侧问。 |
| 引用隔离 | 独立会话输入框仅有本次整个回合引用；旧 Fork 的选文草稿保留在旧输入框，刷新后仍各自恢复。 |
| 选区入口 | 主回答拖选后，选文引用成功追加到现有 Fork 输入框。后台标签页的动画帧有延迟；本轮没有宣称已逐项重跑选区菜单的全部鼠标路径。 |
| 标题 | 原生 Session rename 后，左栏、右侧 Tab、历史均同步 `兼容验证 · Fork A` / `兼容验证 · 独立 B`，刷新后保持。 |
| 顺序 | 原生最近更新顺序为 B、A；置顶 A 后，左栏与历史均为 A、B。切到单列表手动排序、取消置顶后，通过真实浏览器拖拽将 A 放到 B 前面，历史随即同步；刷新后仍为 A、B。 |
| 原生日志 | 磁盘 v4 header：Fork 有 parentSession，独立会话没有；两者 cwd 均为隔离工作区，回复存在各自原生日志。没有引入第二套消息日志。 |

测试记录和包安装日志保存在本机隔离环境登记项 `sidecar-stock-alpha3-20261024`，不进入发布包。日常 3080 未重启，没有向日常会话发送验证消息；本轮不迁移或批量改写会话及侧问索引。

## 验证边界

浏览器验证基于当前 macOS / Node 24 / 官方 alpha.3。Windows 路径、全部第三方插件组合、所有审批/附件交互和其他 DSH 版本未在本轮重新验证。此前的完整入口与来源跳转验证见[回归记录](./regression-2026-10-24.md)；本次原生日志职责不变，见[session log 说明](./native-session-log.md)。
