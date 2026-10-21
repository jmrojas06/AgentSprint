/**
 * The dialog copies the full `idea-to-mvp` prompt, rendered by the server
 * (POST /api/prompts/idea-to-mvp), to paste into Claude Code as a message.
 * Not the `/mcp__agentsprint__idea-to-mvp` slash command: Claude Code splits
 * its arguments on whitespace, so a multi-word idea would not survive.
 */

/** POSIX single-quoting: safe to paste into bash, zsh and sh. */
export function shellQuote(text: string): string {
  return `'${text.replace(/'/g, `'\\''`)}'`
}

/**
 * The same prompt started from a terminal: `claude '<prompt>'` opens an
 * interactive session with it as the first message. '' while there is none.
 */
export function buildIdeaCli(prompt: string): string {
  return prompt ? `claude ${shellQuote(prompt)}` : ''
}

export const IDEA_DOCS_URL = 'https://github.com/jmrojas06/AgentSprint/blob/main/docs/agents.md#idea--mvp'
