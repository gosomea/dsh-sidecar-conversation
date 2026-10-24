# 原生 session log 的处理方式

侧问是一条真正的 DSH Session。正文、流式回复、工具事件与历史恢复交给 DSH；插件负责创建入口、来源引用和侧问索引。本文描述 0.2.x 的原生输入框路径；旧版 `/create`、`/prompt` 与 SSE 路由仍保留供兼容，不是当前原生输入框的消息通道。

## 数据归属

| 数据 | 所有者与恢复来源 |
| --- | --- |
| Session 创建、Fork、历史与运行 | DSH Session Controller、SessionProvider、原生 Session 持久化插件 |
| 消息发送、附件、权限与模型 | 原生 `conversation.content` 和 SessionInput；插件不替代这些提交与恢复流程 |
| 已发送引用 | 原生 `user/message` 的文本内容，包含插件定义的引用标记 |
| 未发送问题与引用 | 原生输入框按子 Session 保存的浏览器草稿；不属于 session log |
| Tab 布局与选中状态 | 原生右侧栏；插件另存 `dsh-sidecar-native-tabs-v1` 元数据以解释侧问资源 |
| 来源绑定、创建方式、归档、标题和旧请求回执 | `$DSH_HOME/sidecar-conversation.json`；这是索引，不能重建完整对话 |

Registry 还保存初始选文、首问和初始权限快照，供标题、兼容及恢复使用，因此同样包含用户内容。初始权限快照不是当前有效权限的权威来源；创建完成后由 DSH 的权限事实与选择器控制。Registry 使用版本化 JSON、临时文件和原子替换，损坏时保留原文件并拒绝写入。

## 从创建到发送

1. 左侧菜单确认独立或 Fork，`prepare` 校验来源消息并调用原生 create/fork；此时创建 Session，但不发送模型请求。
2. 插件把来源引用作为一次性 seed 放进该子 Session 的原生输入框。已有原生草稿优先；初始化持久化后移除 seed，避免刷新重复插入。
3. 用户通过原生输入框提交。InputTrigger codec 调用插件 `/reference`，按来源 Session 和稳定消息 ID 读取原生历史，校验选文，取得当前 canonical seq。
4. codec 返回 `<sidecar_reference>` 包裹的 JSON，包含来源 Session ID、消息 ID、seq、类型、选文、可选文本偏移和实际引用正文。它与问题一起成为普通 `user/message` 文本，由 DSH 写入原生日志。整个回合引用的正文是最终 Assistant 回答；Fork 的其余上下文由原生分叉继承。
5. 插件监听原生 `user/message`（仅 `source.kind=user`）与标题事件，更新侧问索引和首问标题；不复制回复或工具轨迹到第二套日志。

当前验证基线写入 `session.v4.jsonl.zstd`。文件名、压缩、事件格式与迁移均由 DSH 管理，插件运行时通过 Session API 读取，不自行解压或改写日志。测试中只读解压用于独立核对落盘证据。

## 重开与引用跳转

右侧视图用 `sessions.retain`、SessionProvider 和 `conversation.content` 挂载子 Session。关闭标签释放视图引用，历史重开复用原子 Session；恢复元数据不主动抢占其他标签。追加目标同时匹配来源父会话、活动 registry 记录和原生 dock 中仍存在的标签；仅有本地缓存或尚未创建的草稿不算目标。

已发送引用通过 UserText 扩展渲染原生 ReferenceChip。点击后使用 `openSession` 和 `loadThrough` 打开来源并加载历史，再定位消息与文本范围。来源不存在时保留引用并报告错误；旧消息未保存过的引用位置不会凭空补出。未发送引用可逐项删除，与已发送引用使用相同的来源结构。

清除浏览器数据会丢失未发送草稿和本地布局；registry 与原生日志仍可恢复已发送侧问。插件归档不删除 Session，也不调用原生归档阻止它继续运行。

## DSH 升级时检查什么

| 适配边界 | 主要代码 | 验证重点 |
| --- | --- | --- |
| Session Controller 与工作区 | `src/host/modern-api.ts` | create/fork、cwd、inspect、rename、归档 gate 与运行恢复 |
| 原生聊天及输入框 | `src/client/native-sidebar.tsx` | retain/release、SessionProvider、输入 actions、首问与附件、草稿恢复 |
| 引用协议与渲染 | `src/core/references.ts`、`src/client/references.tsx` | codec、UserText、消息 ID、分页、跳转高亮 |
| 原生侧栏 | `src/client/native-sidebar.tsx` | 标签 inventory、主会话作用域、最近激活目标、关闭重开和焦点 |
| 原生日志迁移 | DSH 官方迁移器 | 消息 ID 保留、seq 变化、迁移后引用与继续聊天 |

发送前校验会按稳定消息 ID 更新 seq，但已经发送的引用仍保存当时的 seq；点击加载通过该 seq 分页，再按消息 ID 定位。不能据此宣称任意日志迁移后都能正确跳转。历史 v0 样本转换验证和未覆盖范围见[兼容性记录](./compatibility.md)；本轮 v4 恢复验证见[回归记录](./regression-2026-10-24.md)。

标题与顺序适配只读取原生 Session 投影及工作区视图 store，不参与消息持久化、模型提交或引用协议。`0.2.1` 已移除两个本地定制接口的依赖，无需为 session log 修改 DSH。
