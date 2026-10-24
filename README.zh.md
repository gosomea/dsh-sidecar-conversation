# dsh-sidecar-conversation

在 DeepSeek Harness 原生右侧栏中针对选文或整个回合提问。`0.2.0` 为 发布版本，适配带下述工作区扩展的 DSH `0.2.1-alpha.3` 构建；无需 Better Sidebar。[English](./README.md)

## 使用

选中已完成的 Assistant 回复，或点击回合末尾的「侧问这个回合」，选择以下操作：

| 操作 | 结果 |
| --- | --- |
| 追加到最近侧问 | 加到当前主会话最近使用的侧问；只有该侧问已创建且标签未关闭时显示 |
| 仅用选文新建／仅用此回合新建 | 创建独立 Session，只带入选文或该回合的最终回答，以及你的问题 |
| 从此回合 Fork | 创建关联子 Session，继承截至该回合的历史，并附上本次引用 |

创建方式在左侧菜单确认，右侧直接显示原生输入框。可上传文件、选择权限和模型，也可继续添加多个引用。新建不会复制其他侧问的草稿；明确追加才会保留目标草稿并累加引用。独立会话与主会话在左侧同级；Fork 的列表折叠取决于 DSH 原生工作区实现，单独安装此插件不会修改列表布局。

「侧问历史」可新建、重新打开、归档和恢复当前来源会话的侧问。关闭标签只关闭视图，不会停止生成。切换主会话、关闭重开和刷新后，草稿与引用按子 Session 恢复；已发送引用仍能点击定位高亮来源。

Fork 上方的一行提示显示分叉回合、落后轮数与最新主回合，可点击跳转；追加引用不会补齐 Fork 的历史。独立会话只提示带入引用，不显示 Fork 差距。选文最多 4,000 字符。

## 权限与会话

菜单新建默认只读，之后使用 DSH 原生权限选择器调整。只读限制工作区写入，不表示网络隔离；侧问共享来源会话的工作区，允许写入的工具可修改同一批文件。插件不自动把回复写回主会话。

初始标题使用首次问题摘要。创建后，左侧列表、右侧标签和侧问历史统一读取原生 Session 标题，重命名实时同步。左侧 Fork 的 `↳ 侧问 ·` 是显示前缀，重命名后仍保留；旧名称中的前缀只在显示时兼容处理。历史直接采用原生左栏顺序，随手动排序、最近更新、置顶和分组方式同步。

插件归档只改变侧问历史状态；原生 Session 保持未归档以便继续运行。独立 Session 也会记录在来源会话的侧问历史中，这不是原生父子关系。

## 安装与开发

此版本要求本地 ui-workspace 提供 `sidebar.workspaces.session.title` 插槽和 `sessionOrder` 服务。普通 `0.2.1-alpha.3` 不包含这些扩展，插件 npm 包也不包含它们。[发布要求](./docs/release-0.2.0.md)

在与目标 DSH 版本匹配的环境中安装本地源码：

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm test
pnpm build
dsh plugin --profile web add link:$(pwd)
dsh --profile web --dump-config
```

安装后重启目标 Web 实例。先在独立 DSH_HOME、端口和插件构建目录验证，避免重建日常实例正在使用的产物。`--dump-config` 只证明配置组合成功，不证明插件已加载。[兼容性与验证边界](./docs/compatibility.md)

卸载使用 `dsh plugin --profile web remove dsh-sidecar-conversation`。依赖来自公开 npm 包，不需要本机 Harness checkout 的 TypeScript paths 或 workspace link。

## 持久化与验证

消息、回复、附件和工具事件使用 DSH 原生 Session 能力。插件只保存侧问索引和来源关联；草稿与标签属于浏览器状态。清除浏览器数据后可从历史重新打开已发送的对话，但不能据此恢复未发送草稿。

- [原生 session log：职责、引用格式与升级边界](./docs/native-session-log.md)
- [2026-10-24 回归：两个入口、切换、重开与刷新](./docs/regression-2026-10-24.md)
- [标题与顺序同步验证](./docs/title-order-2026-10-24.md)
- [架构](./docs/architecture.md)与[开发](./docs/development.md)

## License

[Apache License 2.0](./LICENSE)
