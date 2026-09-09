import {copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {basename, dirname, extname, join, relative, sep} from 'node:path'

const appRoot = join(import.meta.dirname, '..')
const workspace = join(appRoot, '..')
const sourceRoot = join(workspace, 'source-references')
const docsRoot = join(appRoot, 'docs')
const chaptersRoot = join(docsRoot, 'chapters')
const assetsRoot = join(docsRoot, 'public', 'original-assets')
const sources = [
  {folder: 'ai-handbook', title: 'AI Handbook', repo: 'https://github.com/nageoffer/ai-handbook'},
  {folder: 'hello-agents', title: 'Hello-Agents', repo: 'https://github.com/datawhalechina/hello-agents'},
  {folder: 'agent-camp', title: 'Agent Camp', repo: 'https://github.com/yibo365/agent-camp'},
  {folder: 'agent-interview-100', title: 'Agent Interview 100', repo: 'https://github.com/BigKunLun/Agent-Interview-100'},
  {folder: 'ai-agents-from-zero', title: 'AI Agents From Zero', repo: 'https://github.com/didilili/ai-agents-from-zero'},
  {folder: 'ai-agent-interview-guide', title: 'AI Agent Interview Guide', repo: 'https://github.com/bcefghj/ai-agent-interview-guide'},
  {folder: 'agent-interview-hub', title: 'Agent Interview Hub', repo: 'https://github.com/Zchary1106/agent-interview-hub'},
]
const chapters = [
  {id: '01-模型与提示', title: '第一章：模型、Prompt 与结构化输出', goal: '建立模型能力边界，学会把自然语言输出接成可靠的产品接口。', weeks: '第 1–2 周'},
  {id: '02-Agent原理', title: '第二章：Agent 核心原理与设计模式', goal: '理解 Agent 与聊天机器人的边界，掌握 ReAct、规划和停止条件。', weeks: '第 3 周'},
  {id: '03-RAG', title: '第三章：RAG 与知识增强', goal: '掌握分块、召回、重排、引用与 RAG 评测，不把检索当成黑盒。', weeks: '第 4 周'},
  {id: '04-工具与MCP', title: '第四章：Function Calling、Tool Use 与 MCP', goal: '把模型的推理接入受控工具，并理解权限、确认、审计和 MCP 互操作。', weeks: '第 5 周'},
  {id: '05-编排与多Agent', title: '第五章：编排、状态机与多 Agent', goal: '选择单 Agent、图编排、计划执行和多 Agent 的合适边界。', weeks: '第 6 周'},
  {id: '06-上下文与记忆', title: '第六章：上下文工程与记忆', goal: '管理上下文窗口、会话历史、长期记忆和压缩策略。', weeks: '第 7 周'},
  {id: '07-TS产品工程', title: '第七章：TypeScript 产品化与工程实践', goal: '把 Agent 做成可用产品：BFF、流式状态、权限、失败态与部署。', weeks: '第 8 周'},
  {id: '08-评测安全可观测', title: '第八章：评测、安全与可观测性', goal: '用任务集、Trace、指标和安全边界，让 Agent 可以被验证和迭代。', weeks: '第 9–10 周'},
  {id: '09-CodingAgent', title: '第九章：Coding Agent 与 Harness', goal: '理解编码代理、沙箱、工作区、评测 Harness 与人机协作。', weeks: '第 11 周'},
  {id: '10-项目实战', title: '第十章：项目实战与作品集', goal: '把知识收敛成能演示、能解释取舍、能复盘失败的项目。', weeks: '第 12 周'},
  {id: '11-面试与求职', title: '第十一章：面试、岗位与求职准备', goal: '在做完项目后，用题库查漏并转化成自己的项目叙事。', weeks: '贯穿复习'},
  {id: '12-附录与索引', title: '附录：索引、环境与补充材料', goal: '保留全部资料中的目录页、配置说明与补充内容，不打断主线学习。', weeks: '按需查阅'},
]
const skip = new Set(['.git', 'node_modules', '.DS_Store', '__pycache__'])
const markdownExtensions = new Set(['.md', '.mdx'])
const mediaExtensions = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.avif', '.pdf'])

// 学习库服务于“理解并能落地”的主线，而不是保存一次完整爬取。社区项目的
// 输出快照、补丁记录和自动生成文本缺少上下文、复用价值低，且会淹没正式教程。
// 上游文件仍留在 source-references 中，需要时可重新纳入。
function isPublishedDocument(rel) {
  const path = `/${rel.replaceAll('\\', '/').toLowerCase()}`
  if (path.includes('/co-creation-projects/')) return false
  if (/(^|\/)_(sidebar|sidebar_en)\.(md|mdx)$/.test(path)) return false
  if (/(^|\/)(patch-applied|patch-failed)\.(md|mdx)$/.test(path)) return false
  return true
}

function listFiles(dir, out = []) {
  for (const entry of readdirSync(dir, {withFileTypes: true})) {
    if (skip.has(entry.name)) continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) listFiles(full, out)
    else if (entry.isFile()) out.push(full)
  }
  return out
}
function classify(path, text) {
  // 用路径和章节标题归类，而不是扫描整篇正文；长文常会顺带提到“安全/评测”，
  // 全文匹配会把无关文章错误塞进同一章。
  const firstHeading = text.match(/^#\s+(.+)$/m)?.[1] || ''
  const headings = firstHeading
  const value = `${path}\n${headings}`.toLowerCase()
  const has = (...terms) => terms.some((term) => value.includes(term.toLowerCase()))
  const file = basename(path).toLowerCase()
  // 无一级标题或极短 Markdown 多为提示词/代码片段；保留在附录，避免污染主阅读顺序。
  if (!firstHeading || text.trim().length < 900 || has('/prompts/', '/tests/', '/outputs/', '/templates/')) return '12-附录与索引'
  if (has('co-creation-projects/', '/code/', '/projects/', '项目代码', 'project-template')) return '10-项目实战'
  if (/^(readme|index|sidebar|preface|changelog|patch-applied)\.(md|mdx)$/.test(file) || has('创建一个目录', '按分类浏览面试题', '学习计划', '环境配置', '安装配置')) return '12-附录与索引'
  if (has('岗位要求', '真实面经', '简历', 'offer', 'star 法则', '求职')) return '11-面试与求职'
  if (has('coding agent', 'coding-agent', 'claude code', 'codex cli', 'openhands', 'harness', '代码代理', '编程代理', 'cursor')) return '09-CodingAgent'
  if (has('评测', 'evaluation', 'eval', '安全', 'security', 'prompt injection', '可观测', 'observability', 'trace', '部署', 'guardrail')) return '08-评测安全可观测'
  if (has('context engineering', '上下文工程', '上下文窗口', '记忆', 'memory')) return '06-上下文与记忆'
  if (has('langgraph', 'langchain', 'autogen', 'crewai', 'multi-agent', 'multi agent', '多智能体', 'plan-and-execute', 'plan and execute', '编排')) return '05-编排与多Agent'
  if (has('mcp', 'function calling', 'function-calling', 'tool use', '工具调用', 'tool calling')) return '04-工具与MCP'
  if (has('rag', '检索增强', '向量数据库', '向量检索', 'graphrag', '召回', '重排')) return '03-RAG'
  if (has('react', 'agent 核心', 'agent核心', 'agent 设计', 'agent设计', '规划', 'planning')) return '02-Agent原理'
  if (has('prompt', '提示词', '大模型', 'llm', 'structured output', '结构化输出')) return '01-模型与提示'
  if (has('项目', '实战', 'demo', '案例', 'tutorial', '教程', '实践')) return '10-项目实战'
  if (has('面试', '面经', '岗位要求', '简历', 'offer', 'star 法则', '算法题', '求职')) return '11-面试与求职'
  return '07-TS产品工程'
}
function extractTitle(content, fallback) {
  return content.match(/^#\s+(.+)$/m)?.[1]?.replace(/\s+#+$/, '').trim() || fallback.replace(/^\d+[-_.]?/, '') || '未命名章节'
}
function escapeHtml(value) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
}
function removeLeadingFrontmatter(content) {
  if (!content.startsWith('---')) return content
  const end = content.indexOf('\n---', 3)
  return end === -1 ? content : content.slice(end + 4).replace(/^\n/, '')
}
// 上游部分教程用 HTML class 做网页装饰（doc-hero、interview-grid 等）。
// 本书不携带它们的 CSS，因此将非代码块中的展示标签还原为普通 Markdown，避免读者看到标签源码。
function normalizePresentationHtml(content) {
  return content.split(/(```[\s\S]*?```)/g).map((part, index) => {
    if (index % 2) return part
    return part
      .replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_, level, text) => `\n${'#'.repeat(Number(level))} ${text.replace(/<[^>]+>/g, '').trim()}\n`)
      .replace(/<br\s*\/?\s*>/gi, '\n')
      .replace(/<\/(?:section|div|p|blockquote|li|ul|ol)>/gi, '\n')
      .replace(/<\/?(?:section|div|p|span|strong|em|blockquote|ul|ol|li)\b[^>]*>/gi, '')
  }).join('')
}
function safeName(value) {
  return value.normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 72) || 'article'
}

rmSync(chaptersRoot, {recursive: true, force: true})
rmSync(assetsRoot, {recursive: true, force: true})
rmSync(join(docsRoot, '90-原始资料镜像'), {recursive: true, force: true})
mkdirSync(chaptersRoot, {recursive: true})
mkdirSync(assetsRoot, {recursive: true})
const documents = []
for (const source of sources) {
  const sourceDir = join(sourceRoot, source.folder)
  if (!existsSync(sourceDir)) continue
  for (const file of listFiles(sourceDir)) {
    const rel = relative(sourceDir, file).split(sep).join('/')
    const extension = extname(file).toLowerCase()
    if (markdownExtensions.has(extension) && isPublishedDocument(rel)) {
      const content = normalizePresentationHtml(removeLeadingFrontmatter(readFileSync(file, 'utf8')))
      documents.push({source, sourceDir, file, rel, content, chapter: classify(rel, content), title: extractTitle(content, basename(file, extension))})
    } else if (mediaExtensions.has(extension)) {
      const destination = join(assetsRoot, source.folder, rel)
      mkdirSync(dirname(destination), {recursive: true})
      copyFileSync(file, destination)
    }
  }
}
documents.sort((a, b) => a.chapter.localeCompare(b.chapter, 'zh-CN') || a.title.localeCompare(b.title, 'zh-CN'))
// 文章不再拼成 12 篇超长 Markdown；每份原文生成独立页。这样可以保留原文间的
// 链接关系，并以“源文件绝对路径 -> Wiki 路径”作为唯一映射依据。
const slugCounts = new Map()
for (const document of documents) {
  const sourcePath = document.rel.replace(/\.(md|mdx)$/i, '')
  const base = safeName(`${document.source.folder}-${sourcePath}`)
  const count = (slugCounts.get(base) || 0) + 1
  slugCounts.set(base, count)
  document.slug = count === 1 ? base : `${base}-${count}`
  document.wikiPath = `./chapters/${document.chapter.toLowerCase()}/${document.slug}`
}
const documentBySourcePath = new Map(documents.map((document) => [document.file, document]))

function splitTarget(target) {
  const clean = target.replace(/^<|>$/g, '')
  const hashIndex = clean.indexOf('#')
  const beforeHash = hashIndex === -1 ? clean : clean.slice(0, hashIndex)
  const hash = hashIndex === -1 ? '' : clean.slice(hashIndex)
  const queryIndex = beforeHash.indexOf('?')
  return {
    clean,
    path: queryIndex === -1 ? beforeHash : beforeHash.slice(0, queryIndex),
    suffix: (queryIndex === -1 ? '' : beforeHash.slice(queryIndex)) + hash,
  }
}

function resolveSourceFile(document, targetPath) {
  const absolute = join(dirname(document.file), targetPath)
  const candidates = [
    absolute,
    `${absolute}.md`,
    `${absolute}.mdx`,
    join(absolute, 'README.md'),
    join(absolute, 'index.md'),
  ]
  return candidates.find(existsSync)
}

function resolveTarget(document, target) {
  const {clean, path, suffix} = splitTarget(target)
  if (/^(https?:|data:|mailto:|#)/i.test(clean)) return target
  if (clean.startsWith('/original-assets/')) return target
  if (clean.startsWith('/')) return document.source.repo
  if (!path) return target

  const absolute = resolveSourceFile(document, path)
  if (absolute && mediaExtensions.has(extname(absolute).toLowerCase())) {
    return `/original-assets/${document.source.folder}/${relative(document.sourceDir, absolute).split(sep).join('/')}${suffix}`
  }
  const targetDocument = absolute && documentBySourcePath.get(absolute)
  // Docsify 在嵌套路由中会把 ./chapters/... 解析成当前文章的子路径。
  // 统一输出站点根路径，确保正文里的“相关文章”跨章节跳转不会落到 404。
  if (targetDocument) return `/${targetDocument.wikiPath.slice(2)}${suffix}`

  // 上游原文中存在大量未导入的目录页、示例代码和历史链接。它们不能指到一个
  // 必然 404 的本地路径；统一回退到可追溯的上游仓库首页。
  return document.source.repo
}

// 项目教程里的 localhost 地址是“启动该项目后才能访问”的运行提示，不是 Wiki
// 跳转入口。渲染为代码文字，避免读者误点到自己机器上不存在的端口。
function literalizeLocalhostUrls(content) {
  return content.split(/(```[\s\S]*?```|`[^`\n]*`)/g).map((part) => {
    if (part.startsWith('```') || part.startsWith('`')) return part
    return part
      .replace(/\[([^\]]+)\]\((https?:\/\/localhost[^\s)]+)\)/g, '$1（本地运行地址：`$2`）')
      .replace(/(https?:\/\/localhost(?::\d+)?(?:\/[^\s<|]*)?)/g, '`$1`')
  }).join('')
}
function prepareContent(document) {
  let content = document.content
  content = content.replace(/(!?\[[^\]]*\]\()([^\s)]+)([^)]*\))/g, (whole, start, target, end) => `${start}${resolveTarget(document, target)}${end}`)
  // 处理 GitHub README 中常见的“图片徽章包在外链里”的嵌套 Markdown。
  content = content.replace(/(\]\()((?:\.\/)?LICENSE)(\))/g, (whole, start, target, end) => `${start}${resolveTarget(document, target)}${end}`)
  content = content.replace(/(<img\s+[^>]*?src=["'])([^"']+)(["'][^>]*>)/gi, (whole, start, target, end) => `${start}${resolveTarget(document, target)}${end}`)
  content = literalizeLocalhostUrls(content)
  content = content.replace(/^#\s+.*\n?/, '').replace(/^(#{1,5})(?=\s)/gm, '#$1')
  // 外层已写入唯一的 H1；这里仅保留来源信息，避免正文开头重复标题。
  const from = `> **资料来源**：[${document.source.title}](${document.source.repo}) · 原文件：\`${document.rel}\`。\n\n`
  return `${from}${content}`
}
const sidebar = []
for (const chapter of chapters) {
  const chapterDocs = documents.filter((document) => document.chapter === chapter.id)
  // 目录名统一小写，保证跨平台路径一致。
  const chapterPath = chapter.id.toLowerCase()
  const chapterDir = join(chaptersRoot, chapterPath)
  mkdirSync(chapterDir, {recursive: true})
  for (const document of chapterDocs) {
    writeFileSync(join(chapterDir, `${document.slug}.md`), `# ${document.title}\n\n${prepareContent(document)}\n`, 'utf8')
  }
  const articleIndex = chapterDocs.map((document) => `- [${document.title}](/${document.wikiPath.slice(2)}) · ${document.source.title}`).join('\n')
  writeFileSync(join(chapterDir, 'README.md'), `# ${chapter.title}\n\n**学习阶段：${chapter.weeks}**  
${chapter.goal}\n\n本章收录 ${chapterDocs.length} 篇独立文章。文章保留来源标记，原文中的可解析内部链接会跳转到本 Wiki 对应页面；不能映射的链接则回退到来源仓库，避免出现本地 404。\n\n## 本章文章\n\n${articleIndex || '暂无文章。'}\n`, 'utf8')
  sidebar.push({id: chapter.id, title: chapter.title, link: `/chapters/${chapterPath}/README`, documents: chapterDocs})
}
const chapterGroups = [
  {title: '第一部分：模型与 Agent 基础', ids: ['01-模型与提示', '02-Agent原理']},
  {title: '第二部分：RAG、工具与编排', ids: ['03-RAG', '04-工具与MCP', '05-编排与多Agent']},
  {title: '第三部分：上下文与工程实践', ids: ['06-上下文与记忆', '07-TS产品工程', '08-评测安全可观测', '09-CodingAgent']},
  {title: '第四部分：项目与职业进阶', ids: ['10-项目实战', '11-面试与求职']},
  {title: '附录：索引与补充材料', ids: ['12-附录与索引']},
]

const createSidebarMarkdown = (activeChapterId) => {
  const sidebarMarkdown = chapterGroups.map((group) => {
    const chapterLinks = group.ids
      .map((id) => sidebar.find((chapter) => chapter.id === id))
      .filter(Boolean)
      .map((chapter) => {
        const articleLinks = chapter.id === activeChapterId
          ? chapter.documents
            .map((document) => `    - [${document.title}](/${document.wikiPath.slice(2)})`)
            .join('\n')
          : ''
        return `  - [${chapter.title}](${chapter.link}.md)${articleLinks ? `\n${articleLinks}` : ''}`
      })
      .join('\n')
    return `- <strong>${group.title}</strong>\n${chapterLinks}`
  }).join('\n\n')

  return `- [Agent 学习书架](/index.md)\n  - [阅读使用说明](/00-开始这里/README.md)\n  - [AI Agent 开发面经 QA 冲刺](/13-interview-qa/README.md)\n\n${sidebarMarkdown}\n`
}

writeFileSync(join(docsRoot, '_sidebar.md'), createSidebarMarkdown(), 'utf8')
for (const chapter of sidebar) {
  writeFileSync(
    join(docsRoot, 'chapters', chapter.id.toLowerCase(), '_sidebar.md'),
    createSidebarMarkdown(chapter.id),
    'utf8',
  )
}
console.log(`已按 ${chapters.length} 个学习章节整理 ${documents.length} 篇资料。`)
