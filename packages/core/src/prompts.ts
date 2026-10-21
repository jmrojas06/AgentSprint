export interface IdeaToMvpInput {
  idea: string
  stack?: string
  scope?: string
  /** Board name, as in config.yaml. */
  projectName: string
  /** The specialists the orchestrator can launch. */
  agents: Array<{ name: string; description: string }>
  hasBrand: boolean
}

/**
 * The `idea-to-mvp` orchestration prompt. The MCP prompt and the web dialog
 * (through POST /api/prompts/idea-to-mvp) both render it from here.
 */
export function buildIdeaToMvpPrompt({ idea, stack, scope, projectName, agents, hasBrand }: IdeaToMvpInput): string {
  const roster = agents.length
    ? agents.map((a) => `- \`${a.name}\` — ${a.description}`).join('\n')
    : '- (no specialized agents yet — run agent_sync with installDefaults: true first)'
  const extras = [stack?.trim() && `**Preferred stack:** ${stack.trim()}`, scope?.trim() && `**Scope:** ${scope.trim()}`].filter(Boolean)
  return `You are the orchestrator turning an idea into a working MVP on the AgentSprint board "${projectName}".

## The idea

${idea.trim()}
${extras.length ? `\n${extras.join('\n\n')}\n` : ''}
## Specialists available (Claude Code subagents)

${roster}

## Plan, then build

1. **Shape it (ideator + creative-director).** Launch the \`ideator\` subagent for 3 distinct MVP angles, then the \`creative-director\` to pick one and define the cut: the single core user journey, what is explicitly OUT, and the success check. Ask me only if the idea is genuinely ambiguous.
2. **Brand.** ${hasBrand ? 'A brand kit exists — read it with brand_get and keep to it.' : 'No brand kit yet: write one with brand_update (name, tagline, tone, colors, fonts) that fits the chosen angle.'}
3. **Missing specialists.** If the MVP needs expertise the roster lacks (payments, mobile, data, …), create it with agent_upsert (name, description, prompt with mission/rules/output).
4. **Sprint.** sprint_create with the MVP goal, then sprint_activate.
5. **Tasks.** One task_create_batch call with every task of the MVP (aim for 6–15): each with a verifiable title, 3–6 acceptance criteria, an estimate, \`assignee\` set to the specialist that should build it, \`sprint\` set, and \`dependsOn\` refs. Start with a walking skeleton (project setup + one end-to-end path), then features, then a \`tester\` task and a \`docs\` task (README with how to run it).
6. **Build.** Call sprint_dispatch and follow it: launch every task of a wave in parallel with the Agent tool (\`subagent_type\` = the subagent), verify between waves (tests, typecheck, run the app), send failures to \`fixer\`, and re-dispatch until nothing is left.
7. **Hand over.** Summarize what works, how to run it, what is in Review, and what the next sprint should tackle.

Work in small verifiable steps and keep the board updated — it is the source of truth for the subagents.`
}
