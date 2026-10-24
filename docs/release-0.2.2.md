# 0.2.2

修复 Windows 新建侧问时的 `EPERM: operation not permitted, fsync`。`0.2.1` 在侧问索引替换完成后仍对只读父目录句柄调用 fsync，Windows 会拒绝此操作，导致请求报错，即使索引文件已经写入。

## 修复范围

索引仍使用独占创建临时文件、文件 fsync、关闭和原子替换。只在 Windows 跳过目录打开与 fsync；POSIX 保留目录 fsync。真实文件刷盘、写入和重命名错误继续向调用方报错，失败的临时文件会清理，替换前失败不会提交内存状态。

没有更改 DSH 源码、Session API、原生 session log 或 registry v3 格式。既有索引继续加载，不批量改写原生消息或 Session ID。普通 `writeFileAtomic` 公共工具不承诺 fsync 持久性，因此本修复保留当前写入协议，没有用它替换并削弱文件刷盘。

## 验证

- 故障注入：Windows 目录 fsync 固定返回 EPERM 时，修复前 4 项失败，修复后全部通过；同时验证文件 fsync 的 EPERM/EIO、rename 的 EPERM 不被吞掉，磁盘和内存保持替换前状态，重试可成功。
- 本机 macOS / Node 24：22 个测试文件、153 项通过，类型检查通过。
- [GitHub Windows/Linux CI](https://github.com/gosomea/dsh-sidecar-conversation/actions/runs/40067458802)：源码提交 `45fa418`。Linux 153 项通过；Windows 151 项通过、2 项明确跳过的 POSIX 目录刷盘/权限用例。两端类型检查、构建及 npm pack 均成功。原 CI 的 pnpm 初始化顺序同步修正，避免在执行测试前失败。
- 官方 npm DSH `0.2.1-alpha.3` 的隔离 Host 从 0.2.2 tgz 安装，沿用 3187 和独立 DSH_HOME；通过真实 `/prepare` 分别创建 Fork 和独立会话，两条索引均落盘为 active，原有 2 条索引记录完全不变。没有新增模型调用，未重启日常 3080，未向日常会话发送测试消息。此记录不宣称已在用户那台 Windows 机器验证完整 Web 交互。

Windows CI 的普通 registry、service 用例使用真实 Windows 临时文件系统，覆盖侧问创建和恢复；故障注入用例负责证明错误边界。Windows 不提供此实现所使用的 POSIX 目录刷盘步骤，不能把成功的文件替换理解为额外的目录断电持久性承诺。

## 升级

```powershell
dsh plugin --profile web add dsh-sidecar-conversation@0.2.2
```

安装后重启 DSH Web 进程。保留现有 DSH_HOME、`sidecar-conversation.json` 和会话目录；不需要删除历史、重建会话或改用管理员身份运行。
