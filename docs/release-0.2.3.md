# 0.2.3

选文引用只高亮选中文字；整个回合引用才高亮该回合。新侧问通过 DSH 原生权限预设初始化，默认只读，使用原生权限菜单独立调整。

## 实现与兼容

- 选文使用 DOM Range 和 CSS Custom Highlight，3 秒后清除；不抢走输入框选区、不改写消息 DOM。浏览器没有该 API 时用文字矩形覆盖层。相同文字优先匹配捕获的偏移；没有偏移的旧引用仅在可唯一定位时高亮，匹配失败不会退化为整回合高亮。
- 默认调用 `permissionPresets.set(session, 'read-only')`，审批策略取原生预设配置。`inherit` 复制主会话当前预设一次，覆盖 Fork 历史中的旧权限；真正 custom 的来源复制原生有效沙箱与审批值。之后主、子会话各自独立调整。
- 不修改 DSH 源码；新增依赖为官方已发布的 `@deepseek-ai/dsh-permission-presets`。Session log、引用格式、registry v3 与现有会话保持兼容。既有 custom 会话不批量改写，仍可通过原生菜单选择预设。

## 验证

- macOS / Node 24：类型检查、22 个测试文件共 165 项通过；覆盖重复文字、Markdown 跨段空白、定位失败、输入焦点保留、几何降级清理、整回合高亮，以及原生预设和继承后的独立调整。
- 构建与打包在隔离目录完成，声明、Host、client 和 patch 入口均存在；未重建日常 3080 正在提供的插件产物。
- 官方 npm DSH `0.2.1-alpha.3` / 3187 / 独立 DSH_HOME 从 tgz 安装，既有 4 条侧问保留。浏览器实测第二处重复选文，草稿与发送后的历史引用均准确高亮第二处文字，整回合标记为零。
- 新建 Fork 与独立会话的原生权限投影均为 read-only，审批为原生 ask；继承创建复制 workspace-write，随后调整父、子会话后互不覆盖。右侧原生权限菜单可切换只读、工作区内修改、完全权限。
- 隔离主会话与侧问均完成真实模型请求；原生日志记录 provider `deepseek-codebuddy`、model `deepseek-v4.1-flash`、推理等级 high。引用与问题仍通过原生输入框写入日志。

## 升级

```sh
dsh plugin --profile web add dsh-sidecar-conversation@0.2.3
```

保留原有 DSH_HOME，安装后重启 DSH Web。无需删除会话、侧问索引或历史。
