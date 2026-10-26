# 兼容性与隔离验证

## 当前实现

`0.2.8` 在未修改的 DSH `0.2.1-rc.3` 隔离实例上验证。Host 使用 Session Controller；客户端通过 `sidebarRight` / `sidebarRightTabs` 注册原生 Tab，通过 `sessions.retain`、SessionProvider 与 `conversation.content` factory 渲染子 Session。无需 Better Sidebar 或旧 detached Surface API。

原 0.1 实现不能直接在本次新版基线上运行：`effectiveApprovalPolicy` 导出已移除；旧 detached/mountSurface API 不再适用；把子 Session 原生归档以隐藏它会被 archived-session gate 阻止执行。现已替换审批查询与客户端挂载，并保持子 Session 原生未归档。

## 空侧问与主会话权限

未发送侧问不加入工作区可复用空会话列表，首轮开始后通过原生 workspace API 加入。旧空侧问恢复只调整成员关系，不重写权限和原生日志。普通新会话保持原生默认权限。详见[0.2.8 验证记录](./native-list-lifecycle-2026-10-26.md)。

## Windows 索引写入

`0.2.2` 修复 Windows 新建侧问时的 `EPERM: fsync`：只跳过父目录刷盘，保留临时文件 fsync、关闭及原子替换，不吞掉文件权限、磁盘和重命名错误。Windows/Linux 原生 CI、故障注入回归及升级范围见[0.2.2 修复记录](./release-0.2.2.md)。索引版本仍为 3，原生会话和消息日志不迁移。

## 插件内的标题与顺序适配

`0.2.1` 不再声明或读取 `uiWorkspace.sessionOrder`、`sidebar.workspaces.session.title`。关联侧问使用公开的 `sidebar.session.row.leading` / `sidebar.session.row.hover`；原生 Session 标题仍是三个界面的名称来源。

顺序适配器从公开 slot ledger 取得 `sidebar.workspaces` 的共享 store handle，在同为 root scope 的 `shell.overlay` 注册一个无 UI 组件，由框架提供原生 `useStore`，结合 `useSessions`、`useWorkspaces` 计算历史顺序。插件不调用 handle.create、不读原生 localStorage key、不写原生偏好，也不维护第二份持久化排序。适配器对当前原生视图状态形状有版本依赖，升级 DSH 时需回归手动排序、置顶和分组。

原生运行状态会优先替换行首箭头；归档原生行不显示箭头。未修改的官方 DSH 原生列表不提供 Session 父子折叠。当前插件通过公开 `sidebar.workspaces` 插槽提供会话层级视图，关联关系来自插件索引；0.2.8 默认保留完整原生列表，底部切换可进入插件层级视图，已有明确选择继续保留；可选层级视图复用原生搜索、同级拖动排序、置顶与归档操作，但行由插件渲染，并非公开原生行组件；全文搜索是否启用由 DSH 原生索引配置决定。无需任何 DSH 源码定制。`0.2.0` 的本地扩展硬依赖是发布兼容性错误，历史记录见[原验收](./title-order-2026-10-24.md)。

## 2026-10-24 当前验收

以下为已部署日常 3080 的 `0.2.0` 记录；`0.2.1` 的官方包隔离验收见[插件内适配记录](./plugin-only-2026-10-24.md)。选区与整回合入口、切换主会话、关闭重开、刷新、已发送引用跳转和新侧问焦点均通过；135 项测试及类型检查通过。718 个日常会话保留，740 个会话文件哈希不变。详见[回归记录](./regression-2026-10-24.md)和[原生 session log](./native-session-log.md)。

以下 2026-10-23 记录保留各阶段当时的测试数量、构建状态与部署范围，不代表当前未部署；后续记录只扩大明确验证的范围。

## 2026-10-23 验证基线

- DSH 源码 HEAD：`01bac39c3d`，package 版本 `0.2.1-alpha.3`。
- 隔离副本沿用的 Web 构建标识：`0.2.1-alpha.3-5719020-dirty`。本次未重建 DSH core/Web，不能视为对 HEAD 全新构建的验证。
- Node 24；React 18；Cordis `4.0.5-alpha.2`。
- 模型：`deepseek-codebuddy / deepseek-v4.1-flash`，High；主请求与子请求均完成真实调用。
- 插件源码、DSH 源码、DSH_HOME、临时工作区和 3186 端口独立于日常 3080 实例。

## 检查与结果

| 层级 | 操作与独立证据 | 结果与范围 |
| --- | --- | --- |
| 逻辑 | TypeScript 检查；Vitest，包括归档 gate 回归、原生 Session 引用释放、显示投影及幂等发送 | 通过：13 个测试文件、90 项测试 |
| 公开依赖 | 新目录 frozen-lockfile 安装 npm 依赖，执行 check/build | 通过；不是只依赖源码 symlink 编译 |
| 安装与组合 | 独立 profile 用 `dsh plugin add link:` 安装，检查 manifest 与 dump-config | 通过；实际运行另由下列 Host/UI 验证 |
| Host/模型 | 创建子 Session，检查父子 ID、临时 cwd、持久化 user/message 与 assistant/message | 通过；原始 archived gate 阻断也已复现 |
| 原生侧栏 | 回合按钮创建并发送；渲染回复与磁盘日志比对 | 通过；部分后续后台点击需 DOM 诊断辅助，未覆盖所有鼠标路径 |
| 刷新与故障 | 刷新恢复；阻断 list 接口再刷新 | 正常恢复；阻断后显示加载失败，不展示缓存回复 |
| 重启与幂等 | 重启隔离 Host，归档/恢复，同一请求 key 发送两次 | 同一 rpcId，磁盘只一条新用户消息；模型记得此前父子标记 |
| 父日志隔离 | 与初始父日志比较 | 无侧问消息混入；重启新增一条 session/end-seed，因此文件不是字节不变 |
| 历史日志 | 只读复制一条旧 v0 zstd Session，用官方 catalog strict/current 转换 | 288 物理行转为 v4 的 138 逻辑事件，原 Assistant ID 保留，原文件 SHA-256 不变 |

## 持久化与迁移边界

侧问 registry 的 version 3 与原生 Session header 的 version 不是同一个版本号。抽样旧 Session 实际为 v0；当前 writer 为 v4。迁移会改变 seq，引用应按稳定消息 ID 重新定位，不能信任旧 sourceSeq。

历史样本检查还扫描了日常库 722 个 Session header，确认该样本没有 child，因而官方迁移器使用空 child facts。共 15 条历史侧问只抽查了这一条；未验证其余 14 条，也未执行旧侧问在 Host/UI 中完整迁移后续聊。不要批量改写原日志来绕过迁移提示。

## 2026-10-23 初次验证限制

- 原生聊天视图显示完整继承历史，不做旧 afterSeq 裁剪。
- 原生 Session 必须未归档才能运行，因此侧问在原生左侧会话列表可见；插件归档只影响侧问历史状态。
- 此次未测试与其它第三方 sidebar 插件联合启用、全部工具审批交互、附件和跨设备 Tab 同步。
- 打包结构检查不等于从 tgz 安装后的端到端测试；真实 Host 使用 link 安装。
- 未修改或重启日常 DSH；未发布 npm、未替日常 profile 安装此开发版本。

## 历史：原生列表折叠（已由插件内实现取代）

隔离 DSH 的 ui-workspace 已加入按 parentId 折叠分叉会话：在分组视图中，侧问显示在可见父会话下面，箭头切换不改变当前会话，展开状态在浏览器中保存。置顶子会话、不可见父会话和跨分组父子保留独立行；搜索和平铺视图不嵌套。这是 DSH 原生源码改动，单独安装此插件包不会带来列表折叠。隔离环境已完整重建为 `0.2.1-alpha.3-01bac39-dirty`；日常 3080 产物未重建。工作区 467 项测试、build:artifacts 与 build:check 通过；doc-sync 为 42 通过、1 失败，失败来自未改动的 python/sdk/uv.lock:113 提交哈希引用。

## 侧问标题

标题使用首次提问摘要，原生 Tab 通过动态标题插槽展示，草稿未输入时显示“新侧问”。旧的引用范围默认名在启动恢复时更新，原生自定义名称保留。此迁移只追加原生重命名事件并更新侧问 registry，不改写消息。隔离三条旧侧问已核对 registry、原生会话列表和 Tab／历史标题，刷新后仍一致；94 项插件测试通过。

## 独立新会话与历史新建

新增可选 creationMode（缺省 fork，或 independent），旧记录仍按关联侧问读取。独立模式使用 Session Controller create，沿用工作区与所选权限，不设置 parentSessionId，不继承历史。发送内容只含明确选中文字和新问题。registry 保留来源会话关联以供历史入口查找。历史“新建侧问”由 Host 查询最近已完成回答，不依赖屏幕上已挂载的消息。

隔离验证：API 和浏览器分别创建独立会话，原生 v4 header 均无 parentSessionId；日志无父会话测试标记，模型对未知标记回复 UNKNOWN；左侧 aria-level 为 1，关联侧问为 2；从历史按钮创建、选择独立模式、发送收到回复、从左侧打开均通过。100 项插件测试（含模式持久化、同请求模式冲突、权限复制、历史入口）通过。日常 3080 未部署。

## 0.2.3 原生权限与选文定位

新增依赖是官方已发布的 `@deepseek-ai/dsh-permission-presets` 服务，不依赖本地定制 API。使用 DSH 原生预设身份、沙箱与审批事实，权限菜单与后续独立调整继续交给原生 Session。选文定位只使用公开渲染标记、DOM Range 和浏览器高亮 API；不修改 DSH 源码。验证范围见[0.2.3 记录](./release-0.2.3.md)。


## 官方版左侧列表与 Windows

官方 npm DSH `0.2.1-alpha.3` 使用平铺的左侧会话列表。关联 Fork 的原生 v4 header 仍保存 `parentSession`，插件索引也保留来源主会话；列表上的 `↳` 与来源悬浮提示不等同于缩进、折叠树。独立新会话没有原生父会话，保持顶层。

本文早期父子行折叠、`aria-level` 为 2 的验收来自定制 DSH 构建，不能作为发布包证据。当前插件内实现的验证见[会话层级与主会话引用](./plugin-tree-main-reference-2026-10-24.md)；未复用那份定制源码。侧问历史与数据关系始终来自插件索引和原生会话日志。

DSH `0.2.1-rc.3` 的[普通 Fork 升级说明](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/upgrade-guide/v0.2.1-rc.3/independent-session-forks/guide.zh.md)进一步取消新建普通 Fork 的原生 `parentSession`／`parentSessionId`，以及基于该字段的缩进。旧日志保持原字段。插件仍从自己的 registry 保存来源主会话及回合，所以“来源回合”和侧问历史不依赖此上游字段。遇到 Windows 平铺列表时，应同时核对 DSH 版本与是否使用定制客户端；仅凭操作系统不能判断数据关系是否丢失。
