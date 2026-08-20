# 架构

dsh-sidecar-conversation 只负责 Sidecar 语义和入口；右侧面板、分栏、Tab 持久化和显示/隐藏由 dsh-better-sidebar 负责。插件不再创建自己的 drawer，也不改写 Harness 或 AionUI 的 Shell 网格。

## 数据流

    Assistant 选区 / 回合操作
              │
              ▼
    Better Sidebar 定向打开 draft Tab（此时不创建 Session）
              │ 首次发送
              ▼
    Host create ── 校验 finalized Assistant ── fork ── Registry 绑定
              │                                      │
              │                                      ├─ 隐藏 child Session
              │                                      ├─ 应用只读/继承权限
              │                                      └─ 幂等发送首问
              ▼
    Better Sidebar chat Tab ── Harness embedded Conversation Surface
                                  （消息、工具、审批、停止、composer）

## Better Sidebar Tab 模型

插件注册两个 Tab 类型：

- dsh-sidecar-conversation:chat：隐藏类型；每个 requestKey 打开一个稳定的 sidecar:<requestKey> Tab。meta 只保存版本化的父会话绑定、请求键和 draft/active 状态。
- dsh-sidecar-conversation:history：当前父会话的单例历史 Tab，用于重新打开、归档和恢复 Sidecar。

打开时使用 sessionId: parentSessionId 定向到目标主会话，不切换当前主会话。每个 Tab 带 sidecar://... 路径，使 Better Sidebar 在需要时自动展开右侧面板。旧浏览器状态键 dsh.sidecar-conversation.ui.v1 只做一次兼容迁移，不删除原数据。

Tab 的关闭和 Sidecar 的归档是两个操作：关闭只释放可见 Surface 和右侧视图；归档由用户显式触发，改变 Registry 状态但不删除 child Session 或历史。重新从历史打开时复用原来的 child Session，不重新 fork。

## Session 与绑定不变量

Host Registry $DSH_HOME/sidecar-conversation.json 是父子关系的唯一权威来源：

1. parentSessionId 创建后不可修改，一个 Sidecar 只能属于一个父会话。
2. child Session 是实现细节，会被从主导航隐藏；Sidecar 运行不会改变主会话选择。
3. 切换主会话时，Better Sidebar 通过定向 Session scope 只显示所属 Sidecar 的 Tab；切回时恢复相同的 Tab、草稿和活动状态。
4. 选区必须能对应一条已完成的 Assistant 消息；整回合入口使用同一消息作为分叉点，不伪造选区文本。Host 以 message id 查找最终历史并采用 canonical seq，避免分页或客户端投影造成 source message/seq/quote 不一致。
5. create/prompt 使用稳定 RPC ID、flight 去重和 durable history 检查；重试不会重复 fork 或重复发送。首次问题接受后客户端立即显示乐观用户消息，再由 native history 和事件流确认并去重。

## 原生 Conversation Surface

Sidecar 不渲染第二套 transcript。每个可见 chat Tab 请求 Harness 提供的通用 detached Session 和 embedded Conversation Surface，并通过自定义文本提交适配器把输入交回 Sidecar Host /sidecar-conversation/v1/prompt，以保留 Host 的包装文本、权限边界和稳定 RPC 身份。

消息 Markdown、reasoning、tool call/result、审批、question、running/stop、错误、重试和 composer 均来自主会话组件。Tab 隐藏时释放可见 Surface；child Session 不会因隐藏而取消，后台生成继续，重新打开时通过 history + SSE 补齐。

该通用 embedded Surface 正在 Harness rc.8 源码分支合入。当前正式发布的 Host 若未提供 detached Session/Surface，插件应明确显示兼容性错误，不降级成另一套自定义聊天组件。

## Host API 与权限

Host 路由前缀为 /sidecar-conversation/v1：

| 路由 | 用途 |
| --- | --- |
| GET /list?parentSessionId= | 查询当前父会话的 Sidecar |
| POST /create | 校验来源、fork、登记、应用权限并发送首问 |
| POST /prompt | 校验 child 归属后幂等发送后续问题 |
| POST /archive | 归档或恢复已有记录 |
| GET /events?sessionId= | 推送指定 child 的 Session 事件 |

“只读”在首问前固定为 workspace read-only + approval=never，并在工具边界检查策略漂移；它不保证网络读取或任意第三方 MCP 的副作用。“继承”记录分叉点的有效权限，不会随父会话实时同步。两种模式创建后均不可切换。

Sidecar 的首问和后续问题都被包装成数据文本，用户输入的 /permission 等内容不会直接作为隐藏 child Session 的命令执行。父子记录隔离，但共享工作区；继承模式或允许工具时，Sidecar 的 Bash/Edit 仍可能影响主会话看到的文件。

Registry 写入使用版本化 JSON、0600 临时文件、fsync 和原子 rename。损坏的旧文件会被保留并使本次进程停止写入，不覆盖用户数据；provisioning 记录可在启动时恢复。

## 与其他右侧插件共存

Better Sidebar 是唯一的右侧面板宿主。Sidecar 只注册第三方 Tab，不添加第六列，也不读取 AionUI 私有 class、不写 grid-template-columns。安装文件/变更/预览/Explorer 等插件时，它们继续注册各自的 Better Sidebar Tab；Sidecar 只占自己的 chat/history Tab。选区入口仍作为 shell.overlay 插槽中的轻量浮层存在。
