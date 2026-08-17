import { MarkdownText as DshMarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'

export function MarkdownText({ text }: { text: string }) {
  return <DshMarkdownText text={text} />
}
