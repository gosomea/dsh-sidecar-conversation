# 兼容性

## 当前联调基线

- Node.js 22+
- React 18
- DeepSeek Harness Web，基于 rc.8 的源码构建
- dsh-better-sidebar ^0.14.0

本次重构依赖 Harness rc.8 即将合入的通用 detached Session / embedded Conversation Surface。它还不是当前 Sidecar 可独立依赖的已发布 npm API；如果你的源码构建尚未包含该 Surface，右侧 Tab 会显示兼容性错误，插件不会退回到旧 drawer 或自定义 transcript。请先更新 Harness 对应源码分支并重新构建 host/client，再进行 Web 联调。

Sidecar 本身保持独立 workspace，使用公开的 @deepseek-ai/* 类型/构建依赖，不使用外层 Harness checkout 的 TypeScript paths、workspace extends 或 link: 依赖。运行时仍需使用与当前 Web profile 相容的 Harness 版本。

## Better Sidebar

必须安装一个 dsh-better-sidebar 0.14+ 实例。Sidecar 以可选动态服务接入：如果服务暂时不存在，插件不会让整个 Web 卡在 Loading plugins…，但侧问 Tab 无法打开；安装后需重启 Web 或重新加载 client。不要同时安装两份 Better Sidebar，否则会出现两个右侧面板和重复注册。

Better Sidebar 负责右侧面板、分栏、Tab 状态和会话定向打开；Sidecar 不再自己维护宽度、drawer、布局 observer 或内部 Tab。dsh-aionui-panel 等插件可继续注册它们自己的文件、变更、预览和 Explorer Tab，Sidecar 不会覆盖主会话或增加列。

实际联调时必须先确认这些第三方 UI 插件支持当前 Harness slot 契约。`@linxin666/dsh-web-ui-all@0.1.15` 在 rc.8 源码 Shell 中仍按旧方式注册 `settings.plugin.item`，会因缺少 keyed slot 的 `options.key` 让整个插件树启动失败；这发生在 Sidecar 挂载之前。当前联调 profile 暂不启用该 bundle，改用 Better Sidebar 自带的文件、源代码管理、终端和浏览器 Tab。待上游发布 rc.8 兼容版本后再做联合启用测试。

## 不支持与明确边界

- 旧版 Harness 没有通用 embedded Conversation Surface 时不支持原生聊天显示。
- 0.1 联调范围只支持纯文本输入；暂不支持图片附件、拖拽文件和自动写回父会话。
- 选区必须来自已完成的 Assistant 消息，长度不超过 4,000 字符；reasoning、tool JSON、跨消息选区不作为引用来源。整回合入口可对任意已完成回合发起侧问。
- 只读模式约束工作区文件系统，不等同于网络隔离，也不能替第三方 MCP 判断副作用。
- Sidecar 与父会话记录隔离，但共享工作区；继承权限下的工具可并发修改同一文件。
- 访问模式创建后不可切换；关闭 Tab 不会归档或停止 child，归档需要显式操作。
- 当前未发布 npm。不要使用 dsh plugin add dsh-sidecar-conversation 的公开安装方式；请使用本文档的本地 link: 联调流程。
