# Markdown／表格选文引用回归

本地修复版本：`0.2.5`。选文来自渲染后的 Markdown；Host 使用 DSH 公开的 `extractMarkdownPlainText` 验证其来源，不再用正则自行模拟 Markdown。消息所属 Session、消息 ID 和原生日志序号的校验保持不变，改字或引用不存在的消息仍被拒绝。

## 创建和发送

选文 Fork 在创建子 Session 前使用实际 `sourceKind: selection` 和选文校验来源；不再先以空的整回合引用创建，再等发送时发现问题。原生输入框继续负责草稿、引用序列化和发送；引用随原生 `user/message` 保存，不新增聊天日志或迁移既有侧问索引。

客户端直接复用 Host 提供的原生文本投影。Host 构建从同一公开包打入该同步投影，忽略 UI CSS 与原生入口的浏览器语法高亮预热；不修改 DSH 源码，也不在 Node 中加载浏览器组件或样式。该构建适配以官方 `0.2.1-alpha.3` 为验证基线，升级 DSH 后仍需回归解析与渲染的一致性。

## 自动化验证

- 23 个测试文件，共 176 项测试通过；TypeScript 检查通过。
- 正向用例：跨表格单元格／行、HTML 实体、行内代码、嵌套引用块、引用式链接，以及 URL 含括号的链接。
- `markdown-reference-flow.test.tsx` 使用真实原生 Markdown 组件、浏览器 Selection／Range、选区菜单、Controller 和 Host 服务，覆盖选文采集、Fork 准备、草稿引用回跳、发送前序列化和发送后引用解码。jsdom 不提供布局产生的换行／制表符，测试明确补入浏览器布局分隔；真实鼠标行为另在浏览器验证。
- 负向用例：错误消息 ID、追加伪造文字、真正改变文字、词边界不相同，以及创建前不合法的选文。无效来源不会先创建 Fork。
- 打包核对：Host、client、类型和 bundle patch 入口齐全；包不含测试会话、私有日志和录屏；构建后 Host 可独立导入。

## 官方 DSH 隔离验证

复用登记环境 `sidecar-stock-alpha3-20261024`：未修改的官方 npm DSH `0.2.1-alpha.3`、独立 DSH_HOME 与 3187 端口，从 tgz 安装修复包。复用已绑定临时工作区的验收主会话，先确认原生 v4 header 中的工作目录。真实模型使用 `deepseek-codebuddy / deepseek-v4.1-flash / High`。

| 场景 | 结果 |
| --- | --- |
| 真实模型生成 Markdown | 返回含实体、行内代码、括号 URL、表格和引用块的原生回答。 |
| 跨行、跨列表格选区 → Fork → 发送 | 真实鼠标拖选得到含制表符和换行的选文，引用只带本次表格，收到 `TABLE-025-OK`。 |
| 格式化段落＋链接选区 → Fork → 发送 | 选中页面显示的 `A & B`、行内代码及链接标签，收到 `MARKDOWN-025-OK`；未回到旧侧问。 |
| 点击来源及已发送引用 | 原选区高亮，未高亮整回合；草稿与消息历史都保留回跳入口。 |
| 追加引用 → 刷新 → 发送 | 表格引用恢复到同一个 Markdown 侧问，未串入旧选文，收到 `RESTORE-025-OK`。 |
| 关闭重开、切换主会话 | 从侧问历史重开同一子 Session；切到其他主会话不出现其引用，切回仍恢复正确子 Session。 |
| 原生日志 | 两个 Fork 的 header 保留同一 `parentSession`；选文及三次侧问回复存在各自日志，主会话未混入侧问问题与回复。 |

隔离升级前的 8 条侧问保留，验收新建 2 条 Fork 后为 10 条。录像截图与私有逐项证据保存在本机 `.playwright-mcp/markdown-reference-20261024/`，不进入发布包。本轮未在实际 Windows 机器运行浏览器；Windows 与 macOS 的官方版均没有父子折叠树，详见[兼容性说明](./compatibility.md#官方版左侧列表与-windows)。

## rc.3 的原生日志查询

日常源码已更新为 `0.2.1-rc.3`，但此前运行的旧进程与客户端产物仍为 alpha.3。重启准备时发现缺失依赖和客户端构建，以及上游删除 `sessionController.inspect`。插件改用 alpha.3 和 rc.3 均提供的 `sessionQuery.readSession`：通过原生查询服务读取完整日志快照与工作目录，不激活 Agent、不自行解码／写入日志。增加一项适配测试，验证读取不依赖已移除接口，也不触发 `resolveAgent`。DSH 源码不作修改。

## 日常部署

最终包新增原生 Session Query 适配后，复用同一个 3187 测试 home 与案例，在未修改源码的 DSH `0.2.1-rc.3 / 22ddee3792` 运行。真实浏览器表格选文成功新建 Fork、发送并收到 `RC3-TABLE-025-OK`；点击已发送引用精确高亮，刷新后仍为同一侧问、无残留草稿引用。新增 Fork 的原生 header 无父字段，registry 中的来源主会话与第 43 序号引用仍保留，原生日志同时包含问题与成功回复。此环境在原有 10 条记录上新增 1 条验收记录；未用旧版 reader 再打开 rc.3 新建的 Fork。

日常 3080 安装与 rc.3 隔离环境相同的最终 tgz（SHA-256 `8db45d9f680af77d79050c995ac5f57bfe523b7d66cc808f27849e5502e6b2f1`），原生 Host 与 client 入口逐项比对一致，版本为本地 `0.2.5`。没有发布 npm／GitHub 版本。进程 PID `92464`，继续使用原 DSH_HOME、web profile、3080 与唯一 DSH 源码目录。

为恢复已有 rc.3 源码的可启动状态，执行 `pnpm install --frozen-lockfile`、`build:artifacts`（8 项通过）和 `build:check`（2 项通过），没有修改 DSH 源码或授予版本豁免。此前 alpha.3 客户端中的定制折叠树不在当前 rc.3 源码中，日常页面遵循官方平铺列表。已有 `@foreveryu/dsh-opencode-go@0.1.2` 因不匹配 rc.3 被原生兼容检查跳过，配置未删除、未放行。

部署前完整备份位于本机 `~/.dsh/backups/sidecar-0.2.5-20261024-215152/`。前后均为 1,413 个 Session 文件，38 条侧问记录与 8 条 prompt receipts 完全一致。原有文件无缺失；一个原生日志只追加 `session/end-seed`，其全部原始字节和事件前缀仍一致，其余文件哈希不变。认证后页面恢复同一个主会话与侧问历史，未向日常会话发送测试问题。
