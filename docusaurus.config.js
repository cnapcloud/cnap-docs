// @ts-check
// `@type` JSDoc annotations allow editor autocompletion and type checking
// (when paired with `@ts-check`).
// There are various equivalent ways to declare your Docusaurus config.
// See: https://docusaurus.io/docs/api/docusaurus-config

import {themes as prismThemes} from 'prism-react-renderer';

// This runs in Node.js - Don't use client-side code here (browser APIs, JSX...)

/** @type {import('@docusaurus/types').Config} */
const config = {
  title: 'CNAP DOCS',
  tagline: 'Kubernetes 기반 클라우드 네이티브 플랫폼 설치 가이드',
  favicon: 'img/favicon.png',

  // Future flags, see https://docusaurus.io/docs/api/docusaurus-config#future
  future: {
    v4: true, // Improve compatibility with the upcoming Docusaurus v4
  },

  // Set the production url of your site here
  url: 'https://guide.cnapcloud.com',
  // Set the /<baseUrl>/ pathname under which your site is served
  // For GitHub pages deployment, it is often '/<projectName>/'
  baseUrl: '/',

  // GitHub pages deployment config.
  // If you aren't using GitHub pages, you don't need these.
  organizationName: 'cnapcloud', // Usually your GitHub org/user name.
  projectName: 'cnap-docs', // Usually your repo name.

  onBrokenLinks: 'throw',

  // Even if you don't use internationalization, you can use this field to set
  // useful metadata like html lang. For example, if your site is Chinese, you
  // may want to replace "en" with "zh-Hans".
  i18n: {
    defaultLocale: 'ko',
    locales: ['ko'],
  },

  presets: [
    [
      'classic',
      /** @type {import('@docusaurus/preset-classic').Options} */
      ({
        docs: {
          sidebarPath: './sidebars.js',
          routeBasePath: '/',
          numberPrefixParser: false,
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      }),
    ],
  ],

  themeConfig:
    /** @type {import('@docusaurus/preset-classic').ThemeConfig} */
    ({
      colorMode: {
        respectPrefersColorScheme: true,
      },
      navbar: {
        title: 'CNAP DOCS',
        logo: {
          alt: 'CNAP logo',
          src: 'img/logo.svg',
        },
        items: [
          {to: '/cluster/eks-provision', label: 'K8s 클러스터', position: 'left'},
          {to: '/gitops/prerequisites', label: 'GitOps 플랫폼', position: 'left'},
        ],
      },
      footer: {
        style: 'dark',
        links: [
          {
            title: 'Docs',
            items: [
              {label: 'K8s 클러스터', to: '/cluster/eks-provision'},
              {label: 'GitOps 플랫폼', to: '/gitops/prerequisites'},
            ],
          },
          {
            title: 'CNAP Cloud',
            items: [
              {label: 'CNAP Cloud', href: 'https://cnapcloud.com'},
              {label: 'GitOps 데모', href: 'https://cnapcloud.com/gitops/'},
            ],
          },
          {
            title: 'Community',
            items: [
              {label: '블로그', href: 'https://cnapcloud.com/blog/'},
              {label: 'GitHub', href: 'https://github.com/cnapcloud'},
            ],
          },
        ],
        copyright: `Copyright © ${new Date().getFullYear()} CNAP Cloud.`,
      },
      prism: {
        theme: prismThemes.github,
        darkTheme: prismThemes.dracula,
      },
    }),
};

export default config;
