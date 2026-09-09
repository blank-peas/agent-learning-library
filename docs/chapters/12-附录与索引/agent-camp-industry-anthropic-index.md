# Anthropic Engineering

> **资料来源**：[Agent Camp](https://github.com/yibo365/agent-camp) · 原文件：`industry/anthropic/index.md`。


来源：[Engineering at Anthropic](https://www.anthropic.com/engineering) / [Anthropic News](https://www.anthropic.com/news)。整理日期：2026-06-26。

这一组收录 Anthropic Engineering 入口当前可见的工程文章，并补充与 Agent 工程强相关的最新产品文章。每篇都整理成站内中文深度精读页，保留原文链接、发布时间和主题脉络，重点提炼 Claude Code、Agent harness、上下文工程、工具使用、评测、安全和 MCP 的工程取舍。

> 说明：本站页面面向国内学习者做了较完整的中文讲解和结构化重述，但不是逐字全文翻译。需要核对原始表述、图片和代码时，请回到原文阅读。

### 文章列表

- [Claude Tag：团队协作型 Agent 的新形态](./chapters/07-ts产品工程/agent-camp-industry-anthropic-claude-tag)
- [Claude Opus 4.8 与 Dynamic Workflows](./chapters/07-ts产品工程/agent-camp-industry-anthropic-claude-opus-4-8-dynamic-workflows)
- [Claude 跨产品隔离与约束](./chapters/07-ts产品工程/agent-camp-industry-anthropic-how-we-contain-claude)
- [Claude Code 质量报告更新](./chapters/09-codingagent/agent-camp-industry-anthropic-april-23-postmortem)
- [扩展托管 Agent：把“大脑”和“手”解耦](./chapters/07-ts产品工程/agent-camp-industry-anthropic-managed-agents)
- [Claude Code auto mode：更安全地减少权限确认](./chapters/09-codingagent/agent-camp-industry-anthropic-claude-code-auto-mode)
- [长周期应用开发的 Harness 设计](./chapters/09-codingagent/agent-camp-industry-anthropic-harness-design-long-running-apps)
- [Claude Opus 4.6 BrowseComp 表现中的评测感知](./chapters/08-评测安全可观测/agent-camp-industry-anthropic-eval-awareness-browsecomp)
- [量化 Agent 编程评测中的基础设施噪声](./chapters/08-评测安全可观测/agent-camp-industry-anthropic-infrastructure-noise)
- [用一组并行 Claude 构建 C 编译器](./chapters/07-ts产品工程/agent-camp-industry-anthropic-building-c-compiler)
- [设计抗 AI 的技术评测](./chapters/08-评测安全可观测/agent-camp-industry-anthropic-ai-resistant-technical-evaluations)
- [揭开 AI Agent 评测的面纱](./chapters/08-评测安全可观测/agent-camp-industry-anthropic-demystifying-evals-for-ai-agents)
- [长周期 Agent 的有效 Harness](./chapters/09-codingagent/agent-camp-industry-anthropic-effective-harnesses-for-long-running-agent)
- [Claude Developer Platform 的高级工具使用](./chapters/07-ts产品工程/agent-camp-industry-anthropic-advanced-tool-use)
- [用 MCP 执行代码：构建更高效的 Agent](./chapters/04-工具与mcp/agent-camp-industry-anthropic-code-execution-with-mcp)
- [通过沙箱让 Claude Code 更安全更自主](./chapters/09-codingagent/agent-camp-industry-anthropic-claude-code-sandboxing)
- [用 Agent Skills 装备真实世界 Agent](./chapters/07-ts产品工程/agent-camp-industry-anthropic-equipping-agents-for-the-real-world-with-a)
- [AI Agent 的有效上下文工程](./chapters/06-上下文与记忆/agent-camp-industry-anthropic-effective-context-engineering-for-ai-agent)
- [三个近期问题复盘](./chapters/07-ts产品工程/agent-camp-industry-anthropic-a-postmortem-of-three-recent-issues)
- [用 Agent 编写有效的 Agent 工具](./chapters/07-ts产品工程/agent-camp-industry-anthropic-writing-tools-for-agents)
- [Claude Desktop Extensions：一键安装 MCP Server](./chapters/04-工具与mcp/agent-camp-industry-anthropic-desktop-extensions)
- [Anthropic 如何构建多 Agent 研究系统](./chapters/05-编排与多agent/agent-camp-industry-anthropic-multi-agent-research-system)
- [Claude Code：Agent 编程最佳实践](./chapters/09-codingagent/agent-camp-industry-anthropic-claude-code-best-practices)
- [“think” 工具：让 Claude 在复杂工具使用中停下来思考](./chapters/07-ts产品工程/agent-camp-industry-anthropic-claude-think-tool)
- [用 Claude 3.5 Sonnet 提升 SWE-bench Verified 表现](./chapters/07-ts产品工程/agent-camp-industry-anthropic-swe-bench-sonnet)
- [构建高效 Agent](./chapters/07-ts产品工程/agent-camp-industry-anthropic-building-effective-agents)
- [Contextual Retrieval](./chapters/08-评测安全可观测/agent-camp-industry-anthropic-contextual-retrieval)

### 阅读顺序

1. 入门 Agent 设计：先读 [构建高效 Agent](./chapters/07-ts产品工程/agent-camp-industry-anthropic-building-effective-agents)、[有效上下文工程](./chapters/06-上下文与记忆/agent-camp-industry-anthropic-effective-context-engineering-for-ai-agent)。
2. 做 Coding Agent：读 [Claude Code 最佳实践](./chapters/09-codingagent/agent-camp-industry-anthropic-claude-code-best-practices)、[长周期 Harness](./chapters/09-codingagent/agent-camp-industry-anthropic-effective-harnesses-for-long-running-agent)、[Managed Agents](./chapters/07-ts产品工程/agent-camp-industry-anthropic-managed-agents)、[Dynamic Workflows](./chapters/07-ts产品工程/agent-camp-industry-anthropic-claude-opus-4-8-dynamic-workflows)。
3. 做团队协作 Agent：读 [Claude Tag](./chapters/07-ts产品工程/agent-camp-industry-anthropic-claude-tag)、[Managed Agents](./chapters/07-ts产品工程/agent-camp-industry-anthropic-managed-agents)、[多 Agent 研究系统](./chapters/05-编排与多agent/agent-camp-industry-anthropic-multi-agent-research-system)。
4. 做安全与权限：读 [沙箱](./chapters/09-codingagent/agent-camp-industry-anthropic-claude-code-sandboxing)、[auto mode](./chapters/09-codingagent/agent-camp-industry-anthropic-claude-code-auto-mode)、[containment](./chapters/07-ts产品工程/agent-camp-industry-anthropic-how-we-contain-claude)。
5. 做评测与可靠性：读 [Agent evals](./chapters/08-评测安全可观测/agent-camp-industry-anthropic-demystifying-evals-for-ai-agents)、[基础设施噪声](./chapters/08-评测安全可观测/agent-camp-industry-anthropic-infrastructure-noise)、[AI-resistant evaluations](./chapters/08-评测安全可观测/agent-camp-industry-anthropic-ai-resistant-technical-evaluations)、[事故复盘](./chapters/07-ts产品工程/agent-camp-industry-anthropic-a-postmortem-of-three-recent-issues)。

