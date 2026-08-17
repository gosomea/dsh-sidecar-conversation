# v0.1.0 发布前 TODO

当前状态：

- [x] 代码已推送到 GitHub `main`
- [x] README 默认使用精简中文说明
- [x] `pnpm check`、`pnpm test`、`pnpm build` 通过
- [x] npm 官方 registry 登录成功
- [ ] 完成手动回归测试
- [ ] 发布 `dsh-sidecar-conversation@0.1.0`
- [ ] 创建并推送 `v0.1.0` 标签
- [ ] 创建 GitHub Release
- [ ] 在干净 profile 中验证公开安装

## 手动回归

- [ ] 选中 Assistant 文字后，“在侧边聊天中提问”按钮稳定可点击，选区不会丢失。
- [ ] “侧问这个回合”位于预期的回合操作位置，首次发送正常。
- [ ] 新侧问直接显示“只读 / 继承”，默认只读，不默认续接历史 Sidecar。
- [ ] “继续当前侧问”可以显式复用当前 Sidecar。
- [ ] 只读模式可以查看和分析文件，但不能修改工作区或提升权限。
- [ ] 继承模式沿用分叉点权限，工具调用和审批正常。
- [ ] 输入法组合期间按回车不会误发送，组合结束后回车发送正常。
- [ ] 用户消息发送后立即显示，不需要等待 Host 响应才出现在对话中。
- [ ] 历史 Sidecar 标签可点击切换，选文卡片可以删除。
- [ ] 切换父会话时，只显示该父会话自己的 Sidecar；切回后恢复标签、草稿和宽度。
- [ ] 关闭 Sidecar 后主对话恢复居中。
- [ ] Sidecar 隐藏期间生成继续，重新打开后历史补齐且不重复。
- [ ] 与 `dsh-aionui-panel` 同时安装时，不覆盖主对话、文件、变更、预览或 Explorer 区域。
- [ ] 深色和浅色主题显示正常，窄窗口与拖动宽度正常。

## 发布 npm

确认手动回归全部通过后执行：

```bash
npm whoami --registry=https://registry.npmjs.org/
npm publish --access public --registry=https://registry.npmjs.org/
npm view dsh-sidecar-conversation version --registry=https://registry.npmjs.org/
```

发布可能要求 npm 2FA 验证码。验证结果应为：

```text
0.1.0
```

## 标签与 Release

仅在 npm 发布成功后执行：

```bash
git tag v0.1.0
git push origin v0.1.0
```

然后可在 GitHub 基于 `v0.1.0` 创建 Release，并在 README 恢复 npm 版本徽章。

## 公开安装验证

使用没有本地 `link:` 的干净 Web profile：

```bash
dsh plugin --profile web add dsh-sidecar-conversation
dsh --profile web --dump-config
dsh web
```

卸载验证：

```bash
dsh plugin --profile web remove dsh-sidecar-conversation
```
