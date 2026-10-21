import fs from 'node:fs'
import path from 'node:path'
import type { Sprint as SprintType, Task as TaskType } from './types.js'
import { Sprint, Task, ProjectConfig, isWorkflowAssignee } from './types.js'
import { parseFrontmatter, parseTaskBody } from './frontmatter.js'
import { isValidAgentName } from './agents.js'
import { AgentMeta } from './types.js'

export type LintSeverity = 'error' | 'warning'

export interface LintIssue {
  file: string
  severity: LintSeverity
  code: string
  message: string
}

export interface LintResult {
  issues: LintIssue[]
  ok: boolean
}

const ISSUE = {
  NO_BOARD: 'NO_BOARD',
  MISSING_CONFIG: 'MISSING_CONFIG',
  INVALID_CONFIG: 'INVALID_CONFIG',
  INVALID_FRONTMATTER: 'INVALID_FRONTMATTER',
  DUPLICATE_ID: 'DUPLICATE_ID',
  INVALID_SPRINT_REF: 'INVALID_SPRINT_REF',
  INVALID_DEPENDENCY: 'INVALID_DEPENDENCY',
  INVALID_AGENT: 'INVALID_AGENT',
  UNKNOWN_ASSIGNEE: 'UNKNOWN_ASSIGNEE',
  NO_ACCEPTANCE_CRITERIA: 'NO_ACCEPTANCE_CRITERIA',
} as const

function rel(rootDir: string, absPath: string): string {
  return path.relative(rootDir, absPath)
}

function tryParseTask(filePath: string, content: string): { task?: TaskType; issue?: LintIssue } {
  try {
    const { data, body } = parseFrontmatter(content, Task)
    // Criteria live in the markdown body, not the frontmatter.
    return { task: { ...data, acceptanceCriteria: parseTaskBody(body).acceptanceCriteria } }
  } catch (err) {
    return {
      issue: {
        file: filePath,
        severity: 'error',
        code: ISSUE.INVALID_FRONTMATTER,
        message: `Frontmatter error: ${(err as Error).message.split('\n')[0]}`,
      },
    }
  }
}

function tryParseSprint(filePath: string, content: string): { sprint?: SprintType; issue?: LintIssue } {
  try {
    const { data } = parseFrontmatter(content, Sprint)
    return { sprint: data }
  } catch (err) {
    return {
      issue: {
        file: filePath,
        severity: 'error',
        code: ISSUE.INVALID_FRONTMATTER,
        message: `Frontmatter error: ${(err as Error).message.split('\n')[0]}`,
      },
    }
  }
}

/**
 * Lint the integrity of an AgentSprint board at `rootDir`.
 * Checks YAML syntax, frontmatter schema validity, duplicate task IDs,
 * sprint references, dependency references, agent profiles, assignees and
 * unfinished tasks without acceptance criteria.
 * `ok` is false only when there is at least one error — warnings are
 * reported but do not fail the lint.
 */
export function lintProject(rootDir: string): LintResult {
  const issues: LintIssue[] = []
  const root = path.resolve(rootDir)
  const boardDir = path.join(root, '.agentboard')

  if (!fs.existsSync(boardDir)) {
    issues.push({
      file: '.agentboard/',
      severity: 'error',
      code: ISSUE.NO_BOARD,
      message: `No AgentSprint board found at ${root}. Run: agentboard init`,
    })
    return { issues, ok: false }
  }

  const configPath = path.join(boardDir, 'config.yaml')
  if (!fs.existsSync(configPath)) {
    issues.push({
      file: rel(root, configPath),
      severity: 'error',
      code: ISSUE.MISSING_CONFIG,
      message: 'Missing config.yaml. Run: agentboard init',
    })
  } else {
    try {
      const raw = fs.readFileSync(configPath, 'utf8')
      parseFrontmatter(raw, ProjectConfig)
    } catch (err) {
      issues.push({
        file: rel(root, configPath),
        severity: 'error',
        code: ISSUE.INVALID_CONFIG,
        message: `Config error: ${(err as Error).message.split('\n')[0]}`,
      })
    }
  }

  const tasksDir = path.join(boardDir, 'tasks')
  const sprintsDir = path.join(boardDir, 'sprints')
  const agentsDir = path.join(boardDir, 'agents')
  const seenIds = new Map<string, string>()
  const validTaskIds = new Set<string>()
  const sprintIds = new Set<number>()
  const agentNames = new Set<string>()
  const tasks: TaskType[] = []

  if (fs.existsSync(sprintsDir)) {
    for (const file of fs.readdirSync(sprintsDir)) {
      if (!file.endsWith('.md')) continue
      const abs = path.join(sprintsDir, file)
      const content = fs.readFileSync(abs, 'utf8')
      const result = tryParseSprint(rel(root, abs), content)
      if (result.sprint) {
        if (sprintIds.has(result.sprint.id)) {
          issues.push({
            file: rel(root, abs),
            severity: 'error',
            code: 'DUPLICATE_SPRINT_ID',
            message: `Duplicate sprint ID ${result.sprint.id}`,
          })
        } else {
          sprintIds.add(result.sprint.id)
        }
      }
      if (result.issue) {
        issues.push(result.issue)
      }
    }
  }

  if (fs.existsSync(agentsDir)) {
    for (const file of fs.readdirSync(agentsDir)) {
      if (!file.endsWith('.md')) continue
      const abs = path.join(agentsDir, file)
      const relPath = rel(root, abs)
      const name = file.replace(/\.md$/, '')
      if (!isValidAgentName(name)) {
        issues.push({
          file: relPath,
          severity: 'error',
          code: ISSUE.INVALID_AGENT,
          message: `Invalid agent file name "${name}" (must be a lowercase slug like "designer")`,
        })
        continue
      }
      const content = fs.readFileSync(abs, 'utf8')
      try {
        const { body } = parseFrontmatter(content, AgentMeta)
        if (!body.trim()) {
          throw new Error('agent prompt (markdown body) is empty')
        }
        agentNames.add(name)
      } catch (err) {
        issues.push({
          file: relPath,
          severity: 'error',
          code: ISSUE.INVALID_AGENT,
          message: `Agent error: ${(err as Error).message.split('\n')[0]}`,
        })
      }
    }
  }

  if (fs.existsSync(tasksDir)) {
    for (const file of fs.readdirSync(tasksDir)) {
      if (!file.endsWith('.md')) continue
      const abs = path.join(tasksDir, file)
      const content = fs.readFileSync(abs, 'utf8')
      const relPath = rel(root, abs)

      const result = tryParseTask(relPath, content)
      if (result.task) {
        const task = result.task
        if (seenIds.has(task.id)) {
          issues.push({
            file: relPath,
            severity: 'error',
            code: ISSUE.DUPLICATE_ID,
            message: `Duplicate task ID '${task.id}' (first seen in ${seenIds.get(task.id)})`,
          })
        } else {
          seenIds.set(task.id, relPath)
          validTaskIds.add(task.id)
        }
        tasks.push(task)
      }
      if (result.issue) {
        issues.push(result.issue)
      }
    }
  }

  for (const task of tasks) {
    if (task.sprint != null && !sprintIds.has(task.sprint)) {
      issues.push({
        file: rel(root, path.join(tasksDir, `${task.id}.md`)),
        severity: 'error',
        code: ISSUE.INVALID_SPRINT_REF,
        message: `Task '${task.id}' references non-existent sprint ${task.sprint}`,
      })
    }

    for (const dep of task.dependencies) {
      if (!validTaskIds.has(dep)) {
        issues.push({
          file: rel(root, path.join(tasksDir, `${task.id}.md`)),
          severity: 'error',
          code: ISSUE.INVALID_DEPENDENCY,
          message: `Task '${task.id}' depends on non-existent task '${dep}'`,
        })
      }
    }

    if (!isWorkflowAssignee(task.assignee) && !agentNames.has(task.assignee)) {
      issues.push({
        file: rel(root, path.join(tasksDir, `${task.id}.md`)),
        severity: 'warning',
        code: ISSUE.UNKNOWN_ASSIGNEE,
        message: `Task '${task.id}' is assigned to '${task.assignee}' — not a workflow role and no .agentboard/agents/${task.assignee}.md exists`,
      })
    }

    if (task.status !== 'Done' && task.acceptanceCriteria.length === 0) {
      issues.push({
        file: rel(root, path.join(tasksDir, `${task.id}.md`)),
        severity: 'warning',
        code: ISSUE.NO_ACCEPTANCE_CRITERIA,
        message: `Task '${task.id}' has no acceptance criteria — dispatch holds it back until it has some`,
      })
    }
  }

  return { issues, ok: issues.every((i) => i.severity !== 'error') }
}
