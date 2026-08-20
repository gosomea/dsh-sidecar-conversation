# Goal

/goal 发布 dsh-sidecar-conversation 0.1.0，并让公开说明与真实运行时兼容范围一致。

Scope：仅修改 dsh-sidecar-conversation 仓库的发布文档、元数据和必要修复；不把未合入的 Harness 核心扩展伪装成官方 API。

Constraints:

- npm 发布必须使用 `https://registry.npmjs.org/`。
- npm 发布成功前不得创建或推送 `v0.1.0`。
- README 必须明确未打补丁的官方 Harness 不在 0.1.0 兼容范围。

Done when:

1. `pnpm install --frozen-lockfile && pnpm check && pnpm test && pnpm build && pnpm pack --dry-run` 全部通过。
2. `npm view dsh-sidecar-conversation version --registry=https://registry.npmjs.org/` 返回 `0.1.0`。
3. GitHub `main` 与 `v0.1.0` 指向同一已验证提交。

Stop if:

- npm 身份认证或 2FA 未完成。
- 包名被占用、公开制品不完整，或验证命令失败。
