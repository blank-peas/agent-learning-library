import {defineConfig} from 'vitepress'
import bookSidebar from './book-sidebar.mjs'

const guideSidebar = [
  {
    text: '从这里开始',
    items: [
      {text: '这是什么', link: '/00-开始这里/README'},
      {text: '来源、许可与使用边界', link: '/00-开始这里/来源与许可'},
    ],
  },
  ...bookSidebar,
]

export default defineConfig({
  lang: 'zh-CN',
  title: 'Agent 面试 Wiki',
  description: '从基础到项目实战的 AI Agent 学习与面试资料库',
  cleanUrls: true,
  lastUpdated: true,
  // 原始教程中有不少未经闭合的 HTML/模板片段；把它们按 Markdown 文本处理，
  // 避免第三方正文被 Vue 当作组件模板编译。
  markdown: {html: false},
  themeConfig: {
    nav: [{text: '开始阅读', link: '/'}, {text: '学习路线', link: '/chapters/01-模型与提示/README'}],
    sidebar: guideSidebar,
    outline: {level: [2, 3], label: '本页目录'},
    docFooter: {prev: '上一章', next: '下一章'},
    search: {provider: 'local'},
    footer: {message: '资料已按主题编排；每篇正文顶部保留来源与许可证边界。', copyright: '仅作个人本地学习整理。'},
  },
})
