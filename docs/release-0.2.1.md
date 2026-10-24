# 0.2.1

修复 `0.2.0` 依赖本地定制 DSH 接口、无法在官方 npm DSH 上使用的问题。目标为未修改的 `@deepseek-ai/dsh@0.2.1-alpha.3`，无需 DSH 源码补丁或 Better Sidebar。

- 关联侧问标识改用已有原生行首及悬浮插槽；三个界面继续读取原生 Session 标题。
- 历史顺序由插件内只读适配器复用原生工作区视图 store，支持手动拖动、最近更新、置顶和分组，无额外排序持久化。
- 移除 `uiWorkspace.sessionOrder` 与 `sidebar.workspaces.session.title` 的声明、读取及注册。
- 消息、引用和原生 session log 的处理不变；不迁移现有会话或侧问索引。

类型检查和 147 项测试通过；在官方 npm Host 中从 tgz 安装，完成真实 Fork/独立会话请求、标题同步、置顶、手动拖动与刷新验证。详见[隔离验收记录](./plugin-only-2026-10-24.md)。

原生运行状态会优先替换行首箭头。父子 Session 折叠仍是定制 DSH 的独立能力，此包不替换原生列表。
