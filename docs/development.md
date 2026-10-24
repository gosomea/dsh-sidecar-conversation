# 开发与验证

此仓库是独立 pnpm workspace，依赖公开的 DSH npm 包。当前目标为 `0.2.1-alpha.3`；不要引入本机 checkout 的 TypeScript paths、extends 或依赖 link。

## 本地检查

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm test
pnpm build
```

检查使用 Node 24。若日常 Host 通过 link 使用本目录，应在隔离插件副本构建，避免日常 Web 自动重载。核心 DSH 与插件需要匹配版本；无需为插件检查重建或提交 DSH core。

## Host 与浏览器验证

用独立 DSH_HOME、插件构建和端口复用兼容的测试 Host。通过 `dsh plugin --profile web add link:$(pwd)` 安装测试副本，检查组合配置后再验证运行时加载。主会话应绑定临时工作区，并完成实际模型请求。

每次改变创建、引用或 Tab 生命周期，都应重跑[双入口回归矩阵](./regression-2026-10-24.md#回归方法与结果)。用原生 session log 核对引用来源和消息，不能仅凭 UI 标签或会话数量判断成功。发布包安装、工具审批与旧日志迁移是另外的验证范围，不由这组回归代替。

## 维护入口

- [架构](./architecture.md)：创建、适配和视图边界。
- [原生 session log](./native-session-log.md)：数据归属、旧路径与 DSH 升级检查。
- [兼容性记录](./compatibility.md)：历史验证基线、结果和局限。
- [0.2.0 发布要求](./release-0.2.0.md)与[v0.1 历史发布记录](./release-todo.md)。
