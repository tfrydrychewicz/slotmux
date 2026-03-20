import { defineConfig } from 'vitepress';

function vitepressBase(): string {
  const raw = process.env.VITEPRESS_BASE ?? '/';
  const withSlash = raw.endsWith('/') ? raw : `${raw}/`;
  return withSlash === '//' ? '/' : withSlash;
}

export default defineConfig({
  title: 'Slotmux',
  description: 'Intelligent context window management for AI applications',
  base: vitepressBase(),
  themeConfig: {
    nav: [
      { text: 'Home', link: '/' },
      { text: 'Guide', link: '/guide/' },
      { text: 'Reference', link: '/reference/' },
    ],
    sidebar: [
      {
        text: 'Guide',
        items: [
          { text: 'Overview', link: '/guide/' },
          { text: 'Getting started', link: '/guide/getting-started' },
          {
            text: 'Terminal chatbot tutorial',
            link: '/guide/build-a-chatbot',
          },
        ],
      },
      {
        text: 'Concepts',
        items: [
          { text: 'Slots', link: '/concepts/slots' },
          { text: 'Budgets', link: '/concepts/budgets' },
          { text: 'Overflow', link: '/concepts/overflow' },
          { text: 'Compression', link: '/concepts/compression' },
          { text: 'Snapshots', link: '/concepts/snapshots' },
        ],
      },
      {
        text: 'Guides',
        items: [
          { text: 'End-to-end chatbot', link: '/guides/chatbot' },
          { text: 'RAG application', link: '/guides/rag-application' },
          { text: 'Agent with tools', link: '/guides/agent-with-tools' },
          { text: 'Multi-model & providers', link: '/guides/multi-model' },
          { text: 'Custom plugin', link: '/guides/custom-plugin' },
          { text: 'Migration from LangChain', link: '/guides/migration-from-langchain' },
        ],
      },
      {
        text: 'Framework Integration',
        items: [
          { text: 'React', link: '/guides/react' },
          { text: 'Vue', link: '/guides/vue' },
          { text: 'Angular', link: '/guides/angular' },
        ],
      },
      {
        text: 'Reference',
        items: [
          { text: 'Overview', link: '/reference/' },
          {
            text: 'API (generated)',
            link: '/reference/api/README',
          },
        ],
      },
    ],
    socialLinks: [
      {
        icon: 'github',
        link: 'https://github.com/tfrydrychewicz/slotmux',
      },
    ],
    search: {
      provider: 'local',
    },
    footer: {
      message: 'Released under the MIT License.',
    },
  },
});
