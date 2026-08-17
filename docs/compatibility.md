# Compatibility

## Supported host

- Node.js 22+
- DeepSeek Harness SDK `0.1.0-rc.6`
- Web profile (`dsh web`)
- React 18

The package uses only published `@deepseek-ai/*` dependencies. It has no TypeScript `paths`, external workspace `extends`, or `link:` dependency.

## dsh-aionui-panel

The plugins can be installed together. AionUI may extend the shell from three to five columns; this plugin does not add a sixth column. The Sidecar drawer is constrained to the current conversation center region and follows its size through `ResizeObserver`.

## Deliberate limits in 0.1

- Text prompts only; no image attachment or drag/drop intake.
- No automatic write-back into the parent conversation.
- Read-only mode confines workspace filesystem effects but does not disable network reads or classify arbitrary third-party MCP APIs. Inherit mode shares the parent's fork-point permission surface, so parent and child can race on shared files.
- Access mode is immutable. Create a new Sidecar to switch between Read-only and Inherit.
