# 兼容性与隔离验证

## 当前实现

0.2.0（本地未发布）适配 DSH `0.2.1-alpha.3`。Host 使用 Session Controller；客户端通过 `sidebarRight` / `sidebarRightTabs` 注册原生 Tab，通过 `sessions.retain`、SessionProvider 与 `conversation.content` factory 渲染子 Session。无需 Better Sidebar 或旧 detached Surface API。

原 0.1 实现不能直接在本次新版基线上运行：`effectiveApprovalPolicy` 导出已移除；旧 detached/mountSurface API 不再适用；把子 Session 原生归档以隐藏它会被 archived-session gate 阻止执行。现已替换审批查询与客户端挂载，并保持子 Session 原生未归档。

## 标题与原生顺序扩展

标题与顺序同步需要目标 DSH 提供 `uiWorkspace.sessionOrder` 和 `sidebar.workspaces.session.title`，这两项是本地 ui-workspace 扩展，不随插件 npm 包发布。普通 `0.2.1-alpha.3` 版本号本身不能证明这些能力存在。完整验证和原生 Web 检查边界见[标题与顺序同步记录](./title-order-2026-10-24.md)。

## 2026-10-24 当前验收

已部署到日常 3080；本轮回归没有重启或再次部署。选区与整回合入口、切换主会话、关闭重开、刷新、已发送引用跳转和新侧问焦点均通过；135 项测试及类型检查通过。718 个日常会话保留，740 个会话文件哈希不变。详见[回归记录](./regression-2026-10-24.md)和[原生 session log](./native-session-log.md)。

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

## 原生列表折叠（同日后续验证）

隔离 DSH 的 ui-workspace 已加入按 parentId 折叠分叉会话：在分组视图中，侧问显示在可见父会话下面，箭头切换不改变当前会话，展开状态在浏览器中保存。置顶子会话、不可见父会话和跨分组父子保留独立行；搜索和平铺视图不嵌套。这是 DSH 原生源码改动，单独安装此插件包不会带来列表折叠。隔离环境已完整重建为 `0.2.1-alpha.3-01bac39-dirty`；日常 3080 产物未重建。工作区 467 项测试、build:artifacts 与 build:check 通过；doc-sync 为 42 通过、1 失败，失败来自未改动的 python/sdk/uv.lock:113 提交哈希引用。

## 侧问标题

标题使用首次提问摘要，原生 Tab 通过动态标题插槽展示，草稿未输入时显示“新侧问”。旧的引用范围默认名在启动恢复时更新，原生自定义名称保留。此迁移只追加原生重命名事件并更新侧问 registry，不改写消息。隔离三条旧侧问已核对 registry、原生会话列表和 Tab／历史标题，刷新后仍一致；94 项插件测试通过。

## 独立新会话与历史新建

新增可选 creationMode（缺省 fork，或 independent），旧记录仍按关联侧问读取。独立模式使用 Session Controller create，沿用工作区与所选权限，不设置 parentSessionId，不继承历史。发送内容只含明确选中文字和新问题。registry 保留来源会话关联以供历史入口查找。历史“新建侧问”由 Host 查询最近已完成回答，不依赖屏幕上已挂载的消息。

隔离验证：API 和浏览器分别创建独立会话，原生 v4 header 均无 parentSessionId；日志无父会话测试标记，模型对未知标记回复 UNKNOWN；左侧 aria-level 为 1，关联侧问为 2；从历史按钮创建、选择独立模式、发送收到回复、从左侧打开均通过。100 项插件测试（含模式持久化、同请求模式冲突、权限复制、历史入口）通过。日常 3080 未部署。
