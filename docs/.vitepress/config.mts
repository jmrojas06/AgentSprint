import { defineConfig } from 'vitepress'

// GitHub Pages serves project sites under /<repo>/ — set the base so assets
// resolve. Locally (docs:dev / docs:preview) the default '/' is used.
const base = process.env.DOCS_BASE ?? '/'

export default defineConfig({
  base,
  lang: 'en-US',
  title: 'AgentSprint',
  description:
    'Git-native sprint board for solo developers who code with AI agents.',
  srcExclude: [
    '**/PROGRESS.md',
    '**/demo-pipeline.md',
    '**/video-notes.md',
    '**/video-storyboard.md',
    '**/video-script-es.md',
    '**/sprint-planning.md',
  ],
  head: [
    [
      'link',
      {
        rel: 'icon',
        type: 'image/svg+xml',
        href: `${base === '/' ? '' : base.replace(/\/$/, '')}/logo.svg`,
      },
    ],
  ],
  themeConfig: {
    siteTitle: 'AgentSprint',
    nav: [
      { text: 'Docs', link: '/quick-start' },
      { text: 'CLI', link: '/cli' },
      { text: 'API', link: '/api' },
      { text: 'MCP', link: '/mcp' },
      { text: 'Compare', link: '/comparison' },
      {
        text: 'GitHub',
        link: 'https://github.com/jmrojas06/AgentSprint',
      },
    ],
    sidebar: [
      {
        text: 'Getting started',
        items: [
          { text: 'Introduction', link: '/' },
          { text: 'Installation', link: '/installation' },
          { text: 'Quick start', link: '/quick-start' },
          { text: 'Task file format', link: '/task-format' },
        ],
      },
      {
        text: 'Reference',
        items: [
          { text: 'CLI reference', link: '/cli' },
          { text: 'REST API', link: '/api' },
          { text: 'MCP server & tools', link: '/mcp' },
          { text: 'Architecture', link: '/architecture' },
          { text: 'Troubleshooting', link: '/troubleshooting' },
        ],
      },
      {
        text: 'Background',
        items: [{ text: 'Comparison', link: '/comparison' }],
      },
    ],
    socialLinks: [
      {
        icon: 'github',
        link: 'https://github.com/jmrojas06/AgentSprint',
      },
    ],
    outline: { level: [2, 3] },
  },
})
