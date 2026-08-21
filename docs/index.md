---
layout: home

hero:
  name: AgentSprint
  text: Git-native sprint board
  tagline: For solo developers who code with AI agents. Your tasks live as plain Markdown inside your repo — and your agent works through them, sprint by sprint.
  actions:
    - theme: brand
      text: Get started
      link: /quick-start
    - theme: alt
      text: View on GitHub
      link: https://github.com/jmrojas06/AgentSprint
  image:
    src: demo.gif
    alt: AgentSprint board in action

features:
  - icon: 📁
    title: Your board is a folder in git
    details: One task = one Markdown file with YAML frontmatter. No accounts, no cloud, no lock-in. Review history in every commit.
  - icon: 🤖
    title: Agents are first-class workers
    details: Any file-capable agent (opencode, Claude Code, Cursor…) reads AGENTS.md, claims one task at a time and moves it across the board.
  - icon: 🔌
    title: Native MCP server
    details: Agents claim, update and complete tasks through MCP tools — over stdio or Streamable HTTP on the same port as the UI.
  - icon: ⚡
    title: Spec export in one click
    details: Turn any task into a self-contained prompt for your agent, with your brand guidelines injected automatically.
  - icon: 🏃
    title: Real sprint semantics
    details: Plan sprints, activate one at a time, track burndown and completion stats. Finished work lands in Review — you decide what's Done.
  - icon: 🔍
    title: Fast local search
    details: Full-text task search backed by SQLite (zero native deps) with real-time file watching — edit files directly and the board updates instantly.
---
