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
