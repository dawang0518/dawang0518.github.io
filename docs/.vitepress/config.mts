import { defineConfig } from 'vitepress'

export default defineConfig({
  title: "我的博客",
  description: "个人技术博客",
  lang: 'zh-CN',

  // 如果部署到 GitHub Pages 的子路径，需要设置 base
  // base: '/仓库名/',

  head: [
    ['link', { rel: 'icon', href: '/favicon.ico' }]
  ],

  themeConfig: {
    logo: '/logo.svg',

    nav: [
      { text: '首页', link: '/' },
      { text: '文章', link: '/posts/' },
      { text: '关于', link: '/about/' }
    ],

    sidebar: {
      '/posts/': [
        {
          text: '文章列表',
          items: [
            { text: '欢迎来到我的博客', link: '/posts/hello-world' },
            { text: '我的技能栈', link: '/posts/skills' }
          ]
        }
      ]
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/你的用户名' }
    ],

    footer: {
      message: '用 VitePress 构建',
      copyright: 'Copyright © 2024-present'
    },

    search: {
      provider: 'local'
    },

    outline: {
      level: [2, 3],
      label: '目录'
    },

    lastUpdated: {
      text: '最后更新于'
    },

    docFooter: {
      prev: '上一篇',
      next: '下一篇'
    }
  }
})
