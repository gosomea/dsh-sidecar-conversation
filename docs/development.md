# Development

## Standalone workflow

```bash
corepack enable
pnpm install
pnpm check
pnpm test
pnpm build
pnpm pack --dry-run
```

`pnpm-workspace.yaml` intentionally makes this directory its own workspace root, even when cloned inside another monorepo. The generated lockfile must be committed.

## Link into DSH

```bash
dsh plugin --profile web add link:$(pwd)
dsh web
```

Uninstall or replace the link through `dsh plugin --profile web`; never edit the Harness checkout or `profiles/web/cordis.patch.yml` manually.

## Test focus

- Pure quote and transcript folds.
- Registry atomic/read-only behavior and immutable binding.
- Create/prompt idempotency and source mismatch rejection.
- Registry v1-to-v2 migration, provisioning recovery, read-only policy pinning, and fail-closed drift detection.
- Slash-prefixed Sidecar questions remain model text instead of permission commands.
- Parent-scoped browser persistence.
- Manual browser matrix: native three-column shell, AionUI five-column shell, narrow conversation, Session switching, background completion, approval, cancel, unload/reload.

## Release checklist

1. Confirm `npm view dsh-sidecar-conversation` is still unclaimed.
2. Run all CI commands from a fresh checkout.
3. Inspect `pnpm pack --dry-run`; it must contain no local paths or workspace-only files.
4. Test link installation in a clean `web` profile.
5. Publish only after setting repository metadata. Author metadata is optional and never changes technical identifiers.
