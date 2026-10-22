import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import matter from 'gray-matter'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  ProjectStore,
  buildDispatchPlan,
  buildProjectContext,
  buildReviewQueue,
  discoverSkills,
  formatJournalEntry,
  missingSkills,
  parseJournal,
  planDispatch,
  renderClaudeSubagent,
  reviewerFor,
  snapshotProject,
} from '../src/index.js'

let dir: string
let store: ProjectStore

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentboard-continuity-'))
  store = ProjectStore.init(dir, { sample: false })
  store.installDefaultAgents()
})

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

function writeSkill(base: string, folder: string, frontmatter: string): void {
  fs.mkdirSync(path.join(base, folder), { recursive: true })
  fs.writeFileSync(path.join(base, folder, 'SKILL.md'), `---\n${frontmatter}\n---\n\nBody`, 'utf8')
}

describe('skills', () => {
  it('discovers project and user skills, project first, skipping human-only ones', () => {
    const home = path.join(dir, 'home')
    writeSkill(path.join(dir, '.claude', 'skills'), 'local', 'name: shared\ndescription: project copy')
    writeSkill(path.join(home, '.claude', 'skills'), 'a', 'name: shared\ndescription: user copy')
    writeSkill(path.join(home, '.claude', 'skills'), 'taste-skill', 'name: design-taste-frontend\ndescription: taste')
    writeSkill(path.join(home, '.claude', 'skills'), 'manual', 'name: manual\ndisable-model-invocation: true')
    writeSkill(path.join(home, '.claude', 'skills'), 'nameless', 'description: no name field')
    const skills = discoverSkills(dir, { homeDir: home })
    expect(skills.map((s) => s.name)).toEqual(['design-taste-frontend', 'nameless', 'shared'])
    expect(skills.find((s) => s.name === 'shared')).toMatchObject({ source: 'project', description: 'project copy' })
  })

  it('returns nothing when no skill folder exists', () => {
    expect(discoverSkills(dir, { homeDir: path.join(dir, 'nobody') })).toEqual([])
  })

  it('reports skills referenced by agents that are not installed', () => {
    const missing = missingSkills([{ name: 'designer', skills: ['a', 'b'] }], [{ name: 'a', description: '', source: 'user' }])
    expect(missing).toEqual([{ agent: 'designer', skill: 'b' }])
  })

  it('default agents preload no skills, name them for the Skill tool, and reviewers cannot edit', () => {
    for (const agent of store.listAgents()) expect(agent.skills).toEqual([])
    const designer = store.getAgent('designer')!
    expect(designer.prompt).toContain('Skill tool')
    expect(designer.prompt).toContain('web-design-guidelines')
    const reviewer = store.getAgent('code-reviewer')!
    expect(reviewer.disallowedTools).toEqual(['Edit', 'Write', 'NotebookEdit'])
    const { data, content } = matter(renderClaudeSubagent(reviewer, 'Demo'))
    expect(data.skills).toBeUndefined()
    expect(content).toContain('requesting-code-review')
    expect(data.disallowedTools).toBe('Edit, Write, NotebookEdit')
    expect(content).toContain('AgentSprint review protocol')
    expect(content).toContain('task_review')
  })

  it('saveAgent round-trips skills and disallowed tools', () => {
    store.saveAgent({ name: 'qa', description: 'QA', prompt: 'Check.', skills: ['tdd'], disallowedTools: ['Edit'] })
    const raw = fs.readFileSync(path.join(store.boardDir, 'agents', 'qa.md'), 'utf8')
    expect(matter(raw).data).toMatchObject({ skills: ['tdd'], disallowedTools: ['Edit'] })
    expect(store.getAgent('qa')).toMatchObject({ skills: ['tdd'], disallowedTools: ['Edit'] })
  })

  it('task specs tell non-Claude agents which skills a profile asks to load', () => {
    const designer = store.getAgent('designer')!
    store.saveAgent({ ...designer, skills: ['web-design-guidelines'] })
    const task = store.createTask({ title: 'Landing', assignee: 'designer' })
    expect(store.agentForTask(task)?.skills).toEqual(['web-design-guidelines'])
  })
})

describe('review gate', () => {
  it('routes UI work to ui-reviewer, code to code-reviewer, decisions to nobody', () => {
    const agents = store.listAgents()
    expect(reviewerFor({ assignee: 'designer', tags: [] }, agents)).toBe('ui-reviewer')
    expect(reviewerFor({ assignee: 'developer', tags: ['frontend'] }, agents)).toBe('ui-reviewer')
    expect(reviewerFor({ assignee: 'developer', tags: ['api'] }, agents)).toBe('code-reviewer')
    expect(reviewerFor({ assignee: 'dev', tags: [] }, agents)).toBe('code-reviewer')
    expect(reviewerFor({ assignee: 'ideator', tags: [] }, agents)).toBeNull()
    expect(reviewerFor({ assignee: 'code-reviewer', tags: [] }, agents)).toBeNull()
    expect(reviewerFor({ assignee: 'developer', tags: [] }, [{ name: 'developer' }])).toBeNull()
  })

  it('matches decision-agent tags without regard to case', () => {
    const agents = [
      { name: 'muse', tags: ['Creative'] },
      { name: 'brain', tags: ['IDEAS'] },
      { name: 'gate', tags: ['Reviewer'] },
      { name: 'code-reviewer' },
    ]
    expect(reviewerFor({ assignee: 'muse', tags: [] }, agents)).toBeNull()
    expect(reviewerFor({ assignee: 'brain', tags: [] }, agents)).toBeNull()
    expect(reviewerFor({ assignee: 'gate', tags: [] }, agents)).toBeNull()
  })

  it('dispatch plans name the reviewer and list a review gate for tasks in Review', () => {
    const sprint = store.createSprint('MVP')
    store.setSprintStatus(sprint.id, 'active')
    const [api, ui] = store.createTaskBatch([
      { ref: 'api', title: 'API', sprint: sprint.id, assignee: 'developer', acceptanceCriteria: ['GET /items works'] },
      { ref: 'ui', title: 'UI', sprint: sprint.id, assignee: 'designer' },
    ])
    store.setTaskStatus(ui!.id, 'Review')
    const plan = planDispatch(store.state)
    expect(plan.waves[0]!.map((i) => [i.id, i.reviewer])).toEqual([[api!.id, 'code-reviewer']])
    expect(plan.review[0]!.reviewer).toBe('ui-reviewer')
    const md = buildDispatchPlan(plan, 'Demo')
    expect(md).toContain('| Review gate |')
    expect(md).toContain(`## Review gate`)
    expect(md).toContain(`**${ui!.id} → \`ui-reviewer\`:**`)
    expect(md).toContain('session_handoff')
  })

  it('approve keeps the task in Review and records a review event', () => {
    const task = store.createTask({ title: 'API', assignee: 'developer', status: 'Review' })
    const after = store.reviewTask(task.id, { reviewer: 'code-reviewer', verdict: 'approve', summary: 'Correct and minimal.' })
    expect(after.status).toBe('Review')
    expect(after.notes).toContain('(code-reviewer) **Review: approved** — Correct and minimal.')
    expect(after.activity.at(-1)).toMatchObject({ type: 'review', actor: 'code-reviewer', detail: 'approved' })
  })

  it('changes sends the task back to In Progress with the findings', () => {
    const task = store.createTask({ title: 'API', assignee: 'developer', status: 'Review' })
    const after = store.reviewTask(task.id, {
      reviewer: 'code-reviewer',
      verdict: 'changes',
      findings: ['src/api.ts:12 — empty input throws', 'missing test for 404'],
    })
    expect(after.status).toBe('In Progress')
    expect(after.assignee).toBe('developer')
    expect(after.notes).toContain('  - src/api.ts:12 — empty input throws')
    expect(after.activity.at(-1)?.detail).toBe('changes requested (2 findings)')
    // the note survives a reload from disk
    expect(ProjectStore.open(dir).state.tasks.find((t) => t.id === task.id)?.notes).toContain('missing test for 404')
  })

  it('keeps multi-line author and reviewer names on one line in notes and activity', () => {
    const task = store.createTask({ title: 'API', assignee: 'developer', status: 'Review' })
    store.appendTaskNote(task.id, 'progress', 'bot\n## x')
    store.reviewTask(task.id, { reviewer: 'rev\n## y', verdict: 'changes', findings: ['fix it'] })
    // A later rewrite must keep both activity lines (a split line is dropped as malformed).
    store.setTaskStatus(task.id, 'Review')

    const raw = fs.readFileSync(path.join(dir, '.agentboard', 'tasks', `${task.id}.md`), 'utf8')
    expect(raw).not.toMatch(/^## [xy]/m)
    const reloaded = ProjectStore.open(dir).state.tasks.find((t) => t.id === task.id)!
    expect(reloaded.notes).toContain('(bot ## x) progress')
    expect(reloaded.notes).toContain('(rev ## y) **Review: changes requested**')
    expect(reloaded.activity.map((a) => [a.actor, a.type])).toEqual(
      expect.arrayContaining([
        ['bot ## x', 'note'],
        ['rev ## y', 'review'],
      ]),
    )
  })

  it('rejects verdicts on tasks not in Review and empty change requests', () => {
    const todo = store.createTask({ title: 'Later', status: 'To Do' })
    expect(() => store.reviewTask(todo.id, { reviewer: 'code-reviewer', verdict: 'approve' })).toThrow(/not "Review"/)
    const review = store.createTask({ title: 'Now', status: 'Review' })
    expect(() => store.reviewTask(review.id, { reviewer: 'code-reviewer', verdict: 'changes' })).toThrow(/finding/)
  })

  it('decideReview closes or sends back only work in Review, as the human', () => {
    const a = store.createTask({ title: 'A', assignee: 'developer', status: 'Review' })
    const b = store.createTask({ title: 'B', assignee: 'developer', status: 'Review' })
    const todo = store.createTask({ title: 'Later', status: 'To Do' })
    store.reviewTask(a.id, { reviewer: 'code-reviewer', verdict: 'approve' })
    expect(buildReviewQueue(store.state.tasks).map((q) => [q.id, q.recommendation])).toEqual([[a.id, 'approve'], [b.id, 'look']])

    const done = store.decideReview(a.id, { decision: 'done' })
    expect(done.status).toBe('Done')
    expect(done.activity.at(-1)).toMatchObject({ type: 'status', actor: 'user', detail: 'Review → Done' })

    const back = store.decideReview(b.id, { decision: 'changes', by: 'maria', findings: ['button is off by one'] })
    expect(back.status).toBe('In Progress')
    expect(back.notes).toContain('(maria) **Review: changes requested**')
    expect(() => store.decideReview(todo.id, { decision: 'done' })).toThrow(/not "Review"/)
    expect(() => store.decideReview(a.id, { decision: 'changes', findings: ['x'] })).toThrow(/not "Review"/)
    expect(store.state.tasks.find((t) => t.id === todo.id)?.status).toBe('To Do')
  })
})

describe('session journal', () => {
  it('round-trips entries through the Markdown format', () => {
    const entry = { at: '2026-10-20T10:00:00.000Z', author: 'claude', summary: 'Built the API.', done: ['TK-1'], next: ['TK-2 UI'], blockers: [] }
    const md = formatJournalEntry(entry)
    expect(md).toContain('## 2026-10-20T10:00:00.000Z — claude')
    expect(md).not.toContain('Blockers')
    expect(parseJournal(`# Session journal\n\n${md}`)).toEqual([entry])
  })

  it('appends handoffs in order and keeps hand-written entries', () => {
    store.appendJournal({ author: 'claude', summary: 'First', next: ['ship'] })
    const file = path.join(store.boardDir, 'journal.md')
    fs.appendFileSync(file, '\n## 2026-01-01T00:00:00.000Z — ana\n\n**Summary:** written\nby hand\n')
    store.appendJournal({ author: 'codex', done: ['x'], blockers: ['CI red'] })
    const journal = store.getJournal()
    expect(journal.map((e) => e.author)).toEqual(['claude', 'ana', 'codex'])
    expect(journal[1]!.summary).toBe('written by hand')
    expect(journal[2]!.blockers).toEqual(['CI red'])
  })

  it('refuses an empty handoff', () => {
    expect(() => store.appendJournal({ author: 'x', summary: '  ' })).toThrow(/handoff needs/)
  })
})

describe('project context', () => {
  it('summarizes sprint, work in flight, next, blocked and the last handoff', () => {
    const sprint = store.createSprint('Ship MVP')
    store.setSprintStatus(sprint.id, 'active')
    const [a, b, c, d] = store.createTaskBatch([
      { ref: 'a', title: 'Setup', sprint: sprint.id, assignee: 'developer', status: 'Done', estimate: 2 },
      { ref: 'b', title: 'API', sprint: sprint.id, assignee: 'developer', status: 'In Progress', acceptanceCriteria: ['[x] one', 'two'] },
      { ref: 'c', title: 'UI', sprint: sprint.id, assignee: 'designer', status: 'To Do', priority: 'high' },
      { ref: 'd', title: 'E2E', sprint: sprint.id, assignee: 'tester', status: 'To Do', dependsOn: ['b'] },
    ])
    store.appendTaskNote(b!.id, 'endpoint skeleton ready', 'developer')
    store.appendJournal({ author: 'claude', summary: 'Kicked off the MVP.', next: ['finish API'] })
    store.appendLearning('Always run the linter')

    const snap = snapshotProject({ tasks: store.state.tasks, activeSprint: store.state.activeSprint, journal: store.getJournal() })
    expect(snap.inProgress.map((t) => t.id)).toEqual([b!.id])
    expect(snap.next.map((t) => t.id)).toEqual([c!.id])
    expect(snap.blocked).toEqual([{ task: expect.objectContaining({ id: d!.id }), blockers: [b!.id] }])
    expect(snap.recentlyDone.map((t) => t.id)).toEqual([a!.id])

    const md = store.buildContext({ now: new Date('2026-10-20T12:00:00Z') })
    expect(md).toContain('## Sprint 1 (active): Ship MVP')
    expect(md).toContain('1/4 tasks done (25%)')
    expect(md).toContain('Kicked off the MVP.')
    expect(md).toContain(`**${b!.id}** API — \`developer\`, medium · AC 1/2`)
    expect(md).toContain('last note: endpoint skeleton ready')
    expect(md).toContain(`waits on ${b!.id}`)
    expect(md).toContain('Always run the linter')
    expect(md).toContain('session_handoff')
  })

  it('falls back to unscheduled work without an active sprint and caps long lists', () => {
    for (let i = 0; i < 12; i++) store.createTask({ title: `Task ${i}`, status: 'To Do' })
    const md = buildProjectContext(
      { projectName: 'Demo', tasks: store.state.tasks, activeSprint: null, journal: [] },
      { limit: 5 },
    )
    expect(md).toContain('## No active sprint')
    expect(md).toContain('…and 7 more')
    expect(md).toContain('_Nothing in progress._')
  })
})

describe('learningsTail', () => {
  it('skips automatic retro dumps and keeps real lessons', async () => {
    const { learningsTail } = await import('../src/index.js')
    const md = '- Always lint\n\n## Sprint 3 retro — 2026-08-21\n\n# Sprint 3\n- [high] **AS-8** done\n\n## Process rules\n\n- One project, one board'
    const tail = learningsTail(md, 10)
    expect(tail).toContain('Always lint')
    expect(tail).toContain('One project, one board')
    expect(tail).not.toContain('AS-8')
  })

  it('drops the whole retro dump, including its own ## Tasks and ## Retro sections', async () => {
    const { learningsTail } = await import('../src/index.js')
    const retro = (n: number): string =>
      `## Sprint ${n} retro — 2026-08-21\n\n# Sprint ${n} — Goal\n\n- **Status**: closed\n\n## Tasks\n\n### Backlog (0)\n\n_none_\n\n\n### Done (1)\n\n- [high] **AS-${n}** — Something (agent)\n\n## Retro\n\n_Pendiente: qué fue bien._`
    const md = `- Always lint\n\n${retro(3)}\n\n${retro(4)}\n\n\n## Reglas de proceso\n\n- Un proyecto = un tablero`
    const tail = learningsTail(md, 15)
    expect(tail).toContain('Always lint')
    expect(tail).toContain('## Reglas de proceso')
    expect(tail).toContain('Un proyecto = un tablero')
    expect(tail).not.toContain('## Tasks')
    expect(tail).not.toContain('### Backlog (0)')
    expect(tail).not.toContain('_none_')
    expect(tail).not.toContain('AS-3')
    expect(tail).not.toContain('Pendiente')
  })
})

describe('appendLearningsSection', () => {
  it('nests the body headings so the section stays a single ## block', () => {
    store.appendLearning('Always lint')
    store.appendLearningsSection('Sprint 9 retro — 2026-10-21', '# Sprint 9 — Goal\n\n## Tasks\n\n### Backlog (0)\n\n_none_\n\n## Retro\n\n_tbd_')
    const md = store.getLearnings()
    expect(md.match(/^#{1,2} .*$/gm)).toEqual(['## Sprint 9 retro — 2026-10-21'])
    expect(md).toContain('### Sprint 9 — Goal')
    expect(md).toContain('#### Tasks')
    expect(md).toContain('##### Backlog (0)')
    expect(md).toContain('#### Retro')
  })

  it('keeps a closed sprint retro out of the context brief', () => {
    store.appendLearning('Always lint')
    const sprint = store.createSprint('Ship MVP')
    store.setSprintStatus(sprint.id, 'active')
    store.setSprintStatus(sprint.id, 'closed')
    const brief = buildProjectContext({ projectName: 'demo', tasks: [], activeSprint: null, journal: [], learnings: store.getLearnings() })
    expect(brief).toContain('Always lint')
    expect(brief).not.toContain('Backlog (0)')
    expect(brief).not.toContain('_none_')
  })

  it('a board with only the samples asks for the real project instead of resuming the tutorial', () => {
    const sampleDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentboard-sample-'))
    try {
      const sample = ProjectStore.init(sampleDir, { sample: true })
      expect(sample.state.tasks.filter((t) => t.status === 'In Progress')).toEqual([])
      const fresh = sample.buildContext()
      expect(fresh).toContain('## New board')
      expect(fresh).toContain('idea-to-mvp')
      expect(fresh).toContain('_Nothing in progress._')
      sample.createTask({ title: 'Login page', acceptanceCriteria: ['Users can sign in'] })
      expect(sample.buildContext()).not.toContain('## New board')
    } finally {
      fs.rmSync(sampleDir, { recursive: true, force: true })
    }
  })
})
