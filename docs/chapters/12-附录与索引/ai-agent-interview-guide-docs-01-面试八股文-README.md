# AI Agent 面试八股文 -- 总目录

> **资料来源**：[AI Agent Interview Guide](https://github.com/bcefghj/ai-agent-interview-guide) · 原文件：`docs/01-面试八股文/README.md`。


![什么是AI Agent](/original-assets/ai-agent-interview-guide/comics/01-什么是Agent.png)

> 本目录包含 9 大模块的 AI Agent 面试八股文，覆盖从基础概念到工程实践的完整知识体系。每个模块包含：概念解释、原理详解、面试问题、标准答案、追问应对、代码示例。合计 **200+ 道面试题**。

---

### 模块导航

#### 第一部分：核心概念与框架

| 序号 | 模块 | 文件 | 核心内容 | 面试题数 |
|------|------|------|----------|----------|
| 01 | [基础概念](./chapters/11-面试与求职/ai-agent-interview-guide-docs-01-面试八股文-01-基础概念) | `01-基础概念.md` | Agent 定义、组成、分类、与 Chain/ChatBot 区别 | 27 题 |
| 02 | [核心框架](./chapters/11-面试与求职/ai-agent-interview-guide-docs-01-面试八股文-02-核心框架) | `02-核心框架.md` | ReAct、Plan-and-Execute、Reflexion、LangGraph | 27 题 |

#### 第二部分：核心技术

| 序号 | 模块 | 文件 | 核心内容 | 面试题数 |
|------|------|------|----------|----------|
| 03 | [RAG 技术](./chapters/03-rag/ai-agent-interview-guide-docs-01-面试八股文-03-RAG技术) | `03-RAG技术.md` | 分块策略、向量数据库、混合检索、重排序、GraphRAG | 24+ 题 |
| 04 | [工具调用](./chapters/04-工具与mcp/ai-agent-interview-guide-docs-01-面试八股文-04-工具调用) | `04-工具调用.md` | Function Calling、MCP 协议、工具路由、安全 | 17+ 题 |
| 05 | [记忆系统](./chapters/06-上下文与记忆/ai-agent-interview-guide-docs-01-面试八股文-05-记忆系统) | `05-记忆系统.md` | 短期/长期记忆、摘要压缩、记忆检索策略 | 20 题 |
| 06 | [多智能体](./chapters/05-编排与多agent/ai-agent-interview-guide-docs-01-面试八股文-06-多智能体) | `06-多智能体.md` | 协作模式、通信机制、冲突解决、主流框架 | 20 题 |

#### 第三部分：基础与工程

| 序号 | 模块 | 文件 | 核心内容 | 面试题数 |
|------|------|------|----------|----------|
| 07 | [大模型基础](./chapters/01-模型与提示/ai-agent-interview-guide-docs-01-面试八股文-07-大模型基础) | `07-大模型基础.md` | Transformer、Attention、KV Cache、LoRA、RLHF/DPO | 28 题 |
| 08 | [工程化实践](./chapters/10-项目实战/ai-agent-interview-guide-docs-01-面试八股文-08-工程化实践) | `08-工程化实践.md` | 模型路由、熔断器、Token 优化、可观测性、部署 | 29+ 题 |
| 09 | [Prompt 工程](./chapters/01-模型与提示/ai-agent-interview-guide-docs-01-面试八股文-09-Prompt工程) | `09-Prompt工程.md` | CoT、Few-shot、ReAct 模板、Prompt 注入防御 | 28 题 |

---

### 学习建议

#### 如果你是完全的小白（建议顺序）

```
01-基础概念 → 09-Prompt工程 → 03-RAG技术 → 04-工具调用
→ 02-核心框架 → 05-记忆系统 → 06-多智能体
→ 07-大模型基础 → 08-工程化实践
```

#### 如果你有一定基础（按优先级）

```
02-核心框架（ReAct 必考） → 03-RAG技术（高频）
→ 04-工具调用（MCP 热点） → 08-工程化实践（企业级加分）
→ 其余模块查漏补缺
```

#### 面试前一晚速查

重点复习以下高频考点：
- ReAct 循环（02）
- RAG 完整流程与优化（03）
- MCP vs Function Calling（04）
- 记忆系统设计（05）
- 多 Agent 协作模式（06）
- 三态熔断器（08）
- ReAct Prompt 模板（09）

---

### 漫画图解

本系列八股文配有哆啦 A 梦风格漫画，帮助理解核心概念：

| 漫画 | 对应模块 |
|------|----------|
| ![ReAct](/original-assets/ai-agent-interview-guide/comics/02-ReAct循环.png) | 02-核心框架：ReAct 循环 |
| ![RAG](/original-assets/ai-agent-interview-guide/comics/03-RAG流程.png) | 03-RAG 技术：检索增强生成 |
| ![多Agent](/original-assets/ai-agent-interview-guide/comics/04-多Agent协作.png) | 06-多智能体：协作模式 |
| ![记忆](/original-assets/ai-agent-interview-guide/comics/05-记忆系统.png) | 05-记忆系统：短期 vs 长期 |

