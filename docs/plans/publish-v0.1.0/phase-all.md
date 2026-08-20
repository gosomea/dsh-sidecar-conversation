# v0.1.0 发布阶段

1. **兼容性收口**：README 明确要求带 detached Session / embedded Conversation Surface 的 Harness 源码构建。
2. **制品验证**：执行 frozen install、check、test、build、pack dry-run，并检查敏感信息与本机路径。
3. **公开发布**：登录 npm 官方 registry，发布 `0.1.0`，验证 `npm view`。
4. **版本封存**：提交发布文档，推送 `main`，创建并推送 `v0.1.0`；不在 npm 成功前打标签。

