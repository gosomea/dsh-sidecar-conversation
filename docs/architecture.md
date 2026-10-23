# 架构

0.2.0 把侧问接入 DSH 原生右侧栏与聊天输入框。插件不实现第二套 transcript，也不修改 DSH Shell 或左侧列表布局。

## 数据流

```text
选文 / 整回合菜单 / 侧问历史
  → 确认创建方式或选择最近激活侧问
  → prepare：来源校验 → 原生 create / fork → registry 绑定
  → 原生 SessionProvider + conversation.content
  → 原生输入框提交 → 引用 codec → DSH session log
```

`src/host/modern-api.ts` 隔离当前 DSH Session Controller 接口；`sidecar-service.ts` 负责创建、来源校验、标题同步及旧请求兼容。`src/client/native-sidebar.tsx` 将插件资源映射到原生 Tab，按父会话管理目标，按子会话挂载聊天视图。仍保留的 Better Sidebar 类型与迁移代码服务于内部适配和旧状态，不要求安装 Better Sidebar 插件。

## 会话与视图不变量

- 独立模式没有原生 parentSessionId；Fork 继承所选回合的历史。两者都在 registry 中关联来源会话，创建后不改变模式。
- 创建请求使用父会话与 requestKey 查找现有记录；恢复已登记的请求不重复创建或重放已接受首问。该保证不等于原生 fork 成功而 registry 尚未写入时的崩溃原子性。
- 新建只带入此次来源；追加只作用于当前父会话仍打开的最近使用侧问。恢复缓存元数据不重新激活旧 Tab。
- 原生子 Session 保持可运行；关闭 Tab、插件归档和取消生成是不同操作。
- 子 Session 共享工作区。创建权限由插件初始化，后续权限、模型、附件及发送由原生输入框处理。

数据归属、持久化格式和升级检查集中在[原生 session log](./native-session-log.md)。入口与生命周期验证见[回归说明](./regression-2026-10-24.md)，DSH 基线与历史兼容范围见[兼容性记录](./compatibility.md)。
