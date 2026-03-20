import { defineConfig } from 'vitepress';

function vitepressBase(): string {
  const raw = process.env.VITEPRESS_BASE ?? '/';
  const withSlash = raw.endsWith('/') ? raw : `${raw}/`;
  return withSlash === '//' ? '/' : withSlash;
}

const base = vitepressBase();

export default defineConfig({
  title: 'Slotmux',
  description: 'Intelligent context window management for AI applications',
  base,
  head: [['link', { rel: 'icon', type: 'image/svg+xml', href: `${base}favicon.svg` }]],
  themeConfig: {
    logo: '/slotmux.svg',
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
          { text: 'Events', link: '/concepts/events' },
          { text: 'Plugins', link: '/concepts/plugins' },
          { text: 'Providers', link: '/concepts/providers' },
          { text: 'Token counting', link: '/concepts/token-counting' },
          { text: 'Presets', link: '/concepts/presets' },
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
        text: 'Observability',
        items: [
          { text: 'Events & observability', link: '/guides/events-and-observability' },
          { text: 'Debug inspector', link: '/guides/debug-inspector' },
          { text: 'OpenTelemetry', link: '/guides/opentelemetry' },
        ],
      },
      {
        text: 'Advanced Features',
        items: [
          { text: 'Streaming build', link: '/guides/streaming-build' },
          { text: 'Reactive context', link: '/guides/reactive-context' },
          { text: 'Serialization & checkpoints', link: '/guides/serialization-and-checkpoints' },
          { text: 'Lossless compression', link: '/guides/lossless-compression-locales' },
          { text: 'Multimodal content', link: '/guides/multimodal-content' },
          { text: 'Pinning & ephemeral', link: '/guides/pinning-and-ephemeral' },
        ],
      },
      {
        text: 'Plugins',
        items: [
          { text: 'RAG', link: '/plugins/rag' },
          { text: 'Memory', link: '/plugins/memory' },
          { text: 'Tools', link: '/plugins/tools' },
        ],
      },
      {
        text: 'Production',
        items: [
          { text: 'Error handling', link: '/guides/error-handling' },
          { text: 'Performance tuning', link: '/guides/performance-tuning' },
          { text: 'Security & redaction', link: '/guides/security-and-redaction' },
          { text: 'Presets & defaults', link: '/guides/presets-and-defaults' },
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
