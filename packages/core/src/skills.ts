import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import matter from 'gray-matter'

/** A Claude Code skill found on disk, usable in an agent profile's `skills:` list. */
export interface SkillInfo {
  /** The skill's `name:` (what `skills:` refers to); falls back to its folder name. */
  name: string
  description: string
  /** `project` = `<root>/.claude/skills`, `user` = `~/.claude/skills`. */
  source: 'project' | 'user'
}

function readSkillDir(dir: string, source: SkillInfo['source']): SkillInfo[] {
  let entries: string[]
  try {
    entries = fs.readdirSync(dir)
  } catch {
    return []
  }
  const out: SkillInfo[] = []
  for (const entry of entries) {
    let raw: string
    try {
      raw = fs.readFileSync(path.join(dir, entry, 'SKILL.md'), 'utf8')
    } catch {
      continue
    }
    let data: Record<string, unknown>
    try {
      data = matter(raw).data as Record<string, unknown>
    } catch {
      continue
    }
    // Skills that only a human can invoke cannot be preloaded into a subagent.
    if (data['disable-model-invocation'] === true) continue
    const name = typeof data.name === 'string' && data.name.trim() ? data.name.trim() : entry
    const description = typeof data.description === 'string' ? data.description.trim() : ''
    out.push({ name, description, source })
  }
  return out
}

/**
 * List the Claude Code skills an agent profile can preload: the project's
 * `.claude/skills/` first, then the user's `~/.claude/skills/`. A name found
 * in both is reported once, as the project skill (it wins in Claude Code too).
 */
export function discoverSkills(rootDir: string, opts: { homeDir?: string } = {}): SkillInfo[] {
  const home = opts.homeDir ?? os.homedir()
  const seen = new Set<string>()
  const out: SkillInfo[] = []
  for (const skill of [
    ...readSkillDir(path.join(rootDir, '.claude', 'skills'), 'project'),
    ...readSkillDir(path.join(home, '.claude', 'skills'), 'user'),
  ]) {
    if (seen.has(skill.name)) continue
    seen.add(skill.name)
    out.push(skill)
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

/** Skill names referenced by agent profiles that are not installed (they are skipped at runtime). */
export function missingSkills(agents: Array<{ name: string; skills: string[] }>, installed: SkillInfo[]): Array<{ agent: string; skill: string }> {
  const have = new Set(installed.map((s) => s.name))
  return agents.flatMap((a) => a.skills.filter((s) => !have.has(s)).map((skill) => ({ agent: a.name, skill })))
}
