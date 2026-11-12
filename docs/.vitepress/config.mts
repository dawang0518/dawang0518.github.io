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

  vue: {
    template: {
      compilerOptions: {
        // C++ 模板语法中的 <T>、<int> 等不要当作 HTML 标签
        isCustomElement: (tag) => tag.includes('::') || tag.includes('_')
      }
    }
  },

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
        },
        {
          text: '硬件基础',
          items: [
            { text: '从主板到设备树：硬件是怎么连起来的', link: '/posts/computer-architecture' }
          ]
        },
        {
          text: 'QEMU 学嵌入式 Linux',
          items: [
            { text: '一、环境与第一次启动', link: '/posts/qemu-linux-01-env' },
            { text: '二、读懂启动日志', link: '/posts/qemu-linux-02-boot-log' },
            { text: '三、存储与网络实地验证', link: '/posts/qemu-linux-03-storage-network' },
            { text: '四、给虚拟机装一块硬盘', link: '/posts/qemu-linux-04-disk-persistence' },
            { text: '五、搭建 Linux 构建环境', link: '/posts/qemu-linux-05-docker-build' },
            { text: '六、Buildroot 到底做了什么', link: '/posts/qemu-linux-06-buildroot' },
            { text: '七、从 .c 到 .ko：内核模块与字符设备驱动', link: '/posts/qemu-linux-07-module-driver' },
            { text: '八、用 U-Boot 引导自己构建的内核', link: '/posts/qemu-linux-08-uboot' }
          ]
        }
      ],
      '/cpp/': [
        {
          text: '语言基础',
          items: [
            { text: '1-关键字', link: '/cpp/1-关键字' },
            { text: '2-指针与智能指针', link: '/cpp/2-指针与智能指针' },
            { text: '3-面向对象', link: '/cpp/3-面向对象' }
          ]
        },
        {
          text: 'STL 与泛型',
          items: [
            { text: '4-STL', link: '/cpp/4-STL' },
            { text: '10-模板与泛型', link: '/cpp/10-模板与泛型' }
          ]
        },
        {
          text: '内存与编译',
          items: [
            { text: '5-内存管理', link: '/cpp/5-内存管理' },
            { text: '7-编译与类型', link: '/cpp/7-编译与类型' }
          ]
        },
        {
          text: '现代 C++',
          items: [
            { text: '6-C++11新特性', link: '/cpp/6-C++11新特性' },
            { text: '9-异常处理', link: '/cpp/9-异常处理' }
          ]
        },
        {
          text: '工程实践',
          items: [
            { text: '8-字符串与原生函数', link: '/cpp/8-字符串与原生函数' },
            { text: '11-设计模式与惯用法', link: '/cpp/11-设计模式与惯用法' }
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
