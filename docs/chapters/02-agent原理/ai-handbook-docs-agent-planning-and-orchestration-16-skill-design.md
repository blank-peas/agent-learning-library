# 退款处理

> **资料来源**：[AI Handbook](https://github.com/nageoffer/ai-handbook) · 原文件：`docs/agent/planning-and-orchestration/16-skill-design.md`。

上一篇结尾留了个伏笔：如果比特严选的多个场景都反复出现先查订单、验证条件、再退款这类组合动作，每次都让 Planner 临时拆解和安排步骤，既浪费 Token，也增加不稳定性。这一篇就来解决这个问题——把高频、稳定的多步编排封装成 Skill（技能）。

回顾一下 TinyAgent 目前的能力光谱：ReAct 让 Agent 能一步一步推理和调用工具，Plan-and-Execute 让 Agent 能先规划再执行。两者的共同点是——每次面对用户请求，大脑都在做全量决策，从零开始选工具、排步骤。对于用户提出帮我退掉订单 88231 这类中等复杂度任务，Plan-and-Execute 每次都要花一次 LLM 调用生成一模一样的计划，而 ReAct 则要自己摸索出查订单、判断状态、退款这条路。能不能把这种验证过的编排沉淀下来，让 Agent 直接用？

### 重复编排的代价：每次都从零规划

#### 1. 退款场景的重复规划

拿退款这个高频场景举例。用户要求退掉订单 88231 时，Plan-and-Execute 会先调一次 Planner 生成计划：

```text
Step 1: 查询订单 88231 的详情，确认订单状态  → queryOrder
Step 2: 如果订单已签收，为订单 88231 申请退款  → applyRefund
Step 3: 综合以上结果，告知用户退款进展        → null
```

下一个用户要求处理订单 99001 的耳机问题并退款时，Planner 又生成一遍：

```text
Step 1: 查询订单 99001 的详情，确认订单状态  → queryOrder
Step 2: 如果订单已签收，为订单 99001 申请退款  → applyRefund
Step 3: 综合以上结果，告知用户退款进展        → null
```

两份计划的结构一模一样，只有订单号不同。但每次生成计划都需要一次 LLM 调用——输入包含系统提示词（规划原则 + 工具列表约 400 Token）和用户问题，输出约 200 Token 的 JSON 计划。加上网络延迟，每次多花 1-2 秒和几百 Token。

如果退款场景一天命中 500 次，500 次完全相同的规划就是纯浪费。

![](https://oss.open8gu.com/iShot_2026-07-06_18.12.19.png)

#### 2. 哪些编排适合沉淀

不是所有编排都值得封装成技能。适合沉淀的编排有两个特征：

**高频**。这个编排在业务中反复出现。比特严选的退款流程、订单全流程查询、商品推荐——这些是客服场景的高频操作。

**稳定**。步骤顺序和分支逻辑基本固定，不会因用户措辞不同而大幅变化。退款不管用户怎么说，底层都是查订单 → 检查状态 → 提交退款。

| 场景 | 频率 | 步骤稳定性 | 适合封装 |
|------|------|-----------|---------|
| 退款处理 | 高 | 固定：查订单 → 检查 → 退款 | 适合 |
| 订单全流程查询 | 高 | 固定：查订单 → 有运单则查物流 | 适合 |
| 帮我对比 A 和 B 哪个好 | 中 | 不固定：品类不同、对比维度不同 | 不太适合 |
| 我家扫地机不吸灰了怎么办 | 低 | 不固定：故障诊断树因机型而异 | 暂不适合 |

用一句话概括：**高频 + 稳定 = 值得封装成 Skill；低频或步骤不固定的场景，留给 Plan-and-Execute 动态规划更合适**。

### Skill 是什么

在进入 TinyAgent 的实现之前，先把 Skill 本身讲清楚。这个概念有通用规范、有框架差异、也有本项目的自定义约定——三层容易混在一起，下面分层讲。

#### 1. [通用规范] SKILL.md：从 Anthropic 到行业开放标准

Agent Skills 最早由 Anthropic 在 2025 年 10 月的工程博客中提出，2025 年 12 月作为开放规范发布在 agentskills.io。官方定义是：

> Agent Skills are a lightweight, open format for extending AI agent capabilities with specialized knowledge and workflows.

注意关键词是格式（format），不是执行引擎——SKILL.md 定义的是一种文件规范，用来打包领域知识和工作流，让 Agent 按需加载。至于加载之后怎么执行（是启动子 Agent、走 ReAct 循环还是直接注入提示词），那是各个运行时（Claude Code、Cursor、Gemini CLI 等）自己的事。

截至 2026 年 7 月，已有 40+ Agent 产品支持这个格式，包括 Claude Code、GitHub Copilot、Cursor、Gemini CLI、Spring AI 等。规范仓库在 GitHub agentskills/agentskills（Apache 2.0 许可），任何人都可以贡献。

打个比方：SKILL.md 就像菜谱的标准格式——统一写清楚菜名、食材、步骤。不同厨房（运行时）拿到同一份菜谱，可能用不同的锅灶来做，但菜谱本身的格式是通用的。

#### 2. [通用规范] 渐进式披露：Skill 的核心设计理念

Skill 体系最核心的设计理念是渐进式披露（Progressive Disclosure）——只在需要时才加载需要的知识，而非一次性全部塞进上下文。

> 以下为量级估算，非官方精确值。

分三个阶段：

| 阶段 | 加载内容 | 加载时机 | Token 成本 |
|------|---------|---------|-----------|
| Discovery（发现） | 仅 `name` + `description` | 会话启动时常驻注入 | 约 50-100 Token/Skill |
| Activation（激活） | 完整 SKILL.md 正文 | 任务匹配 description 时 | 约 2000-5000 Token |
| Execution（执行） | scripts/、references/ 等资源 | 指令中引用时按需读取 | 按实际文件大小 |

举个例子：假设比特严选装了 20 个 Skill（退款、查单、推荐、故障诊断……），会话启动时只有 Level 1 常驻——20 个 Skill 的 name + description 加起来约 2000 Token。用户要退掉订单 88231 时，Agent 判断匹配了退款 Skill 的 description，才把完整的 SKILL.md 正文读进来（Level 2）。如果正文里引用了某个脚本或参考文档，执行到那一步时再按需加载（Level 3）。

用一句话概括：**绝大部分请求只需要部分 Skill 的部分资源。渐进式披露用最小的上下文成本，换取最大的知识覆盖范围**。

![](https://oss.open8gu.com/iShot_2026-07-06_18.12.20.png)

> 和 System Prompt 的区别：System Prompt（如 CLAUDE.md）是项目级全局规则，每次会话全量加载，恒定占用上下文。Skill 是按需触发的能力包，未命中时零成本。两者协同工作——System Prompt 定义全局约束，Skill 封装特定领域工作流。

#### 3. [通用规范] SKILL.md 文件结构与标准字段

##### 3.1 目录结构

在官方规范里，一个 Skill 是一个文件夹（目录名即技能名），至少包含一个 `SKILL.md` 文件：

```text
process-refund/
├── SKILL.md          # 必需：元信息 + 指令正文
├── scripts/          # 可选：可执行脚本
├── references/       # 可选：参考文档
└── assets/           # 可选：模板、静态资源
```

##### 3.2 SKILL.md 文件格式

文件分两部分：上半部分是 YAML 前置元数据（frontmatter），下半部分是 Markdown 正文（指令）。

最简示例——只需两个必填字段就是一个合法的 Skill：

```markdown
---
name: process-refund
description: 退款处理技能，查询订单状态并提交退款申请。适用于用户要求退货退款的场景。
---

## 退款处理

### 处理步骤
1. 查询订单详情，确认订单状态和商品信息
2. 如果已签收，提交退款申请
3. 告知用户处理结果
```

带可选字段的完整示例：

```markdown
---
name: process-refund
description: >
  退款处理技能，查询订单状态并提交退款申请。
  适用于用户要求退货退款的场景。
license: Apache-2.0
compatibility: 需要访问订单系统 API
metadata:
  author: bitmall-team
  version: "1.0"
allowed-tools: Bash(curl:*) Read
---

（Markdown 正文...）
```

##### 3.3 标准 frontmatter 字段

以下是 agentskills.io 规范定义的全部字段：

| 字段 | 是否必填 | 约束 | 用途 | 来源 |
|------|---------|------|------|------|
| `name` | **必填** | 最长 64 字符，只能用小写字母、数字和连字符（kebab-case），不能以连字符开头或结尾，必须与目录名一致 | Skill 的唯一标识符 | [通用规范] |
| `description` | **必填** | 最长 1024 字符，需要同时回答做什么（WHAT）和什么时候用（WHEN） | Agent 靠这段描述判断是否激活 Skill，是触发机制的核心 | [通用规范] |
| `license` | 可选 | 许可证名称或引用 | 标注许可证 | [通用规范] |
| `compatibility` | 可选 | 无 | 环境要求说明（系统依赖、网络访问等） | [通用规范] |
| `metadata` | 可选 | 任意键值对（string → string） | 扩展元数据，各运行时自行解释 | [通用规范] |
| `allowed-tools` | 可选 | 空格分隔的工具名列表 | 工具白名单，限制 Skill 执行时可调用的工具 | [运行时行为]，**标注为实验性**，不同运行时支持程度不同 |

> 注意：除上述 6 个字段外，不同 Agent 运行时可能扩展自己的私有字段。例如 Claude Code 支持 `disable-model-invocation`、`user-invocable`、`context`、`agent`、`model`、`hooks` 等字段——这些是 **[运行时行为]**，不属于通用规范。在 frontmatter 中写了不认识的字段，运行时应当忽略而非报错。

##### 3.4 Markdown 正文

`---` 之后的 Markdown 正文就是 Skill 的指令——Agent 激活这个 Skill 后读取并遵循的内容。官方规范对正文格式没有强制限制，推荐包含：分步骤操作指南、输入输出示例、常见边界情况、验证检查清单。

两个实践建议：

- **控制在 500 行以内**。500 行文本约 2000-3000 Token，是单个 Skill 激活后比较合理的上下文开销。超过 500 行时，把业务细节下沉到 `references/` 目录的子文件，SKILL.md 正文只做路由。

- **SKILL.md 正文是路由器，不是知识仓库**。它的职责是分发任务到正确的模块，而不是包含所有相关信息。

##### 3.5 触发机制

Skill 支持两种触发方式：

- **自动触发**：Agent 根据 `description` 字段做语义匹配。用户的意图如果和 description 匹配，Agent 自动加载对应的 SKILL.md。这是最常见的方式，整个过程用户无感。

- **手动触发**：用户通过斜杠命令（如 `/process-refund`）显式调用。适合用户明确知道要用哪个 Skill 的场景。

![](https://oss.open8gu.com/iShot_2026-07-06_18.12.21.png)

`description` 的写法直接决定自动触发的命中率。官方推荐的书写公式：**功能定义（WHAT）+ 触发场景（WHEN）+ 排除边界（可选）**。

| 写法 | 问题 |
|------|------|
| 处理退款 | 太模糊，Agent 无法判断何时该用 |
| 退款处理技能：查询订单状态，验证退款资格，条件满足则提交退款申请。适用于用户要求退货退款的场景。 | WHAT + WHEN 齐全，Agent 能准确匹配 |

#### 4. [运行时行为] 主流框架的对应物

SKILL.md 是一个开放的文件规范，主流 Java Agent 框架在 2026 年上半年已陆续补上了支持——Spring AI 通过社区扩展库实现了完整的三阶段披露，LangChain4j 在核心仓库里新增了官方 Skills 模块（目前 beta 状态）。下面梳理几个主流框架的现状，重点讲差异和执行模式。

##### 4.1 Spring AI（社区扩展 `spring-ai-agent-utils`）

Spring AI 已列入 agentskills.io 的官方客户端名单，并且通过社区扩展库 `spring-ai-agent-utils`（`org.springaicommunity`）提供了**完整的 SKILL.md 支持**。核心类是 `SkillsTool`——它实现了从目录扫描、渐进式披露到技能执行的全链路。

需要注意的是，`SkillsTool` 不在 Spring AI 核心框架（`org.springframework.ai`）里，而是来自社区扩展库。你不会在 `ChatClient` 或 `ChatModel` 的核心 API 中找到 Skill 相关的类——它以 **Tool 的形式集成**，把 `SkillsTool` 注册为 `ChatClient` 的工具回调，LLM 通过 Function Calling 来发现和激活 Skill。

**实现原理（三阶段渐进式披露）**：

1. **Discovery**：`SkillsTool` 初始化时扫描指定目录，解析每个 SKILL.md 的 frontmatter，把所有 `name` + `description` 嵌入自身的工具描述中。此时只占用 name 和 description 的 Token。
2. **Semantic Matching**：LLM 根据嵌入的描述做语义匹配，选择合适的 Skill 名称，调用 `SkillsTool`。
3. **Execution**：`SkillsTool` 加载完整的 SKILL.md 正文返回给 LLM。LLM 读取指令后，配合 `FileSystemTools`（读取 `references/` 文件）和 `ShellTools`（执行 `scripts/` 脚本）完成任务。

```java
// Spring AI 2.0 + spring-ai-agent-utils：完整的 SKILL.md 支持
ChatClient chatClient = ChatClient.builder(chatModel)
        .defaultToolCallbacks(SkillsTool.builder()
                .addSkillsDirectory("skills")      // 从文件系统扫描 SKILL.md
                .build())
        .defaultTools(FileSystemTools.builder().build())  // 可选：让 LLM 读取 Skill 引用的文件
        .defaultTools(ShellTools.builder().build())       // 可选：让 LLM 执行 Skill 内置的脚本
        .build();

String response = chatClient.prompt()
        .user("帮我退掉订单 88231，扫地机坏了")
        .call()
        .content();
```

Maven 依赖（Spring AI 2.0.0 GA + 社区扩展）：

```xml
<dependency>
    <groupId>org.springaicommunity</groupId>
    <artifactId>spring-ai-agent-utils</artifactId>
    <version>0.10.0</version>
</dependency>
```

> `SkillsTool` 支持从文件系统目录和 classpath 资源两种方式加载 Skill，且与 LLM 提供商无关——同一套 SKILL.md 文件可以配合 OpenAI、Anthropic、Gemini 等任何 Spring AI 支持的模型使用。

| 维度 | SKILL.md 规范 | Spring AI（`SkillsTool`） |
|------|-------------|--------------------------|
| 定义方式 | 文件（Markdown + YAML） | 文件（完全兼容 SKILL.md 格式） |
| 发现机制 | 目录扫描 + description 语义匹配 | `SkillsTool` 目录扫描 + LLM 语义匹配 |
| 渐进式披露 | 三阶段按需加载 | 完整实现三阶段 |
| 工具作用域 | `allowed-tools`（可选/实验性） | 通过 `FileSystemTools` + `ShellTools` 辅助执行 |
| 集成方式 | 各运行时自行实现 | 以 Tool 形式注册到 `ChatClient` |
| 执行模式 | 由运行时决定 | LLM 在主对话上下文中读取指令并执行 |

**TinyAgent 对齐了这个模式**：下一篇的 TinyAgent 实现和 Spring AI、LangChain4j 走的是同一条路——`activate_skill` 返回指令文本到主对话上下文，LLM 在主循环中按指令调用业务工具。区别在于 TinyAgent 是用纯 Java + OkHttp 从零实现的，不依赖框架。

![](https://oss.open8gu.com/iShot_2026-07-06_18.12.17.png)

##### 4.2 LangChain4j（官方模块 `langchain4j-skills`）

LangChain4j 在核心仓库中新增了 `langchain4j-skills` 模块，遵循 Agent Skills 规范，提供了完整的 SKILL.md 支持。模块目前是 **beta 状态**（API 标记为实验性），但已有官方文档和 Maven 制品。

核心类是 `Skills`——它通过 `toolProvider()` 注册到 `AiService`，为 LLM 提供 `activate_skill` 和 `read_skill_resource` 两个内置工具。LLM 以 `process-refund` 为参数调用 `activate_skill` 来激活技能，拿到完整的 SKILL.md 指令后在主对话上下文中执行。

###### 4.2.1 实现原理（三阶段渐进式披露）

1. **Discovery**：`FileSystemSkillLoader` 扫描指定目录的子文件夹（每个子文件夹是一个 Skill，必须包含 `SKILL.md`），解析 frontmatter。`Skills.formatAvailableSkills()` 把所有 `name` + `description` 格式化为 XML 块注入系统提示词。
2. **Activation**：LLM 调用 `activate_skill` 激活 `process-refund`，获取完整的 SKILL.md 正文。同时，**技能作用域工具**（Skill-Scoped Tools）变为可见——这些绑定在 Skill 上的工具，只在技能激活后才暴露给 LLM，激活前不可见。
3. **Execution**：LLM 按照指令在主对话上下文中调用工具。如果技能有 `references/` 目录，LLM 通过 `read_skill_resource` 按需读取参考文档。

注意这里的关键词——**主对话上下文**。`activate_skill` 返回的是一段文本（技能指令），LLM 读完之后在当前对话里继续调用业务工具，不会启动一个新的子循环。这和 Spring AI 的 `SkillsTool` 是同一个思路，也是 TinyAgent 下一篇实现对齐的目标模式。

###### 4.2.2 activate_skill 调用流程

用一个具体场景把流程串起来。用户要退掉订单 88231：

```text
第 1 步：LLM 看到系统消息里的技能列表（只有 name + description）
        判断匹配 process-refund，发起 Function Call：
        → activate_skill({"name": "process-refund"})

第 2 步：框架返回 SKILL.md 的完整 Markdown 正文（指令文本）
        同时技能作用域工具（如 applyRefund）变为可见

第 3 步：LLM 在主对话上下文中读取指令，按步骤调用业务工具：
        → validateOrder("88231")  → 结果返回主上下文
        → applyRefund("88231")   → 结果返回主上下文

第 4 步：LLM 综合所有结果，回复用户
```

整个过程只有一个 LLM、一个对话上下文。技能指令和工具调用结果都在主上下文中，LLM 能看到完整的执行过程。

![](https://oss.open8gu.com/iShot_2026-07-06_18.12.22.png)

###### 4.2.3 技能作用域工具（Skill-Scoped Tools）

这是 LangChain4j 最值得关注的设计——可以为每个 Skill 绑定专属工具，**激活前对 LLM 不可见，激活后才动态暴露**。

支持三种绑定方式：

**方式一：`@Tool` 注解方法**——最常用，直接把 Java 类绑定到 Skill：

```java
class OrderTools {
    @Tool("Validates a customer order by ID")
    String validateOrder(String orderId) { return "valid"; }

    @Tool("Charges payment for a customer order")
    String chargePayment(String orderId) { return "charged"; }
}

Skill skill = Skill.builder()
        .name("process-order")
        .description("Processes a customer order end-to-end")
        .content("To process an order:\n1. Call validateOrder...\n2. Call chargePayment...")
        .tools(new OrderTools())   // 这些工具只在 activate 之后才可见
        .build();
```

**方式二：ToolProvider（如 MCP）**——适合外部工具源：

```java
ToolProvider mcpToolProvider = McpToolProvider.builder()
        .mcpClients(mcpClient)
        .toolFilter((tool, client) -> tool.name().startsWith("inventory_"))
        .build();

Skill skill = Skill.builder()
        .name("inventory-management")
        .description("Manages warehouse inventory")
        .content("Use inventory tools to check stock levels...")
        .toolProviders(mcpToolProvider)
        .build();
```

**方式三：`ToolSpecification` + `ToolExecutor`**——手动定义参数 Schema 和执行逻辑。三种方式可以混合使用。

###### 4.2.4 内部原理：动态可见性怎么实现

技能作用域工具的动态可见性依赖三个阶段：

1. **激活前**：LLM 只看到 `activate_skill`（和 `read_skill_resource`）。绑定在技能上的工具完全不在 tools 列表中。
2. **激活时**：LLM 调用 `activate_skill` 激活 `process-order`，框架在 `ToolExecutionResultMessage` 中记录激活状态。
3. **激活后**：下一轮 LLM 调用前，框架通过 `ToolProvider` 机制重新评估可见工具。检测到技能已激活，把绑定的工具加入 tools 列表。这些工具在后续调用中持续可见，直到技能被取消激活。

> `activate_skill` 被标记为 `ALWAYS_VISIBLE`——即使启用了 Tool Search（工具搜索），LLM 也始终能看到它。技能作用域工具则不会出现在 Tool Search 的搜索池中，只能通过激活解锁。

![](https://oss.open8gu.com/iShot_2026-07-06_18.12.23.png)

###### 4.2.5 注册陷阱：哪些 tool 该绑 Skill，哪些该放全局

动态可见性是个好设计，但有一个容易踩的坑：**一旦把某个 tool 绑进 Skill，它就变成激活前不可见——如果 Skill 因为 description 没匹配上而没被激活，这个 tool 就彻底消失了**，哪怕它本来可以独立使用。

这个问题的根源不是框架 bug，而是注册归类错误。LangChain4j 里 tool 有两个互斥的注册位置，可见性相差很大：

```java
AiServices.builder(MyAiService.class)
        .chatModel(chatModel)
        .tools(new OrderQueryTools())       // ← 全局工具：始终可见，与 Skill 无关
        .toolProvider(skills.toolProvider()) // ← 技能作用域：激活后才可见
        .build();
```

判断一个 tool 该放哪一层，问自己一个问题：**不激活 Skill 就被单独调用，会有问题吗？**

| 回答 | tool 类型举例 | 该放哪 |
|------|-------------|-------|
| 不会（查询、只读、幂等） | `queryOrderStatus`、`getProductInfo` | `.tools()` 全局，永远可见 |
| 会（不可逆、危险动作） | `applyRefund`、`deleteAccount` | `Skill.tools()` 技能专属，激活才解锁 |

> 全局注册的 tool 照样可以被 SKILL.md 正文引用。SKILL.md 是指令文本，引用一个全局 tool 完全合法——**Skill 正文引用 tool ≠ 该 tool 必须是技能专属**。

一个实用的折中技巧——同名动作拆成全局只读版 + 门控执行版：

```java
// 全局：随时能查退款资格（只读，安全）
.tools(new RefundQueryTools())   // checkRefundEligibility(orderId)

// 技能专属：真正执行退款（不可逆，需走流程）
Skill refundSkill = Skill.builder()
        .name("process-refund")
        .tools(new RefundActionTools())  // applyRefund(orderId)
        .build();
```

这样即使 Skill 没被激活，只读能力不受影响；而真正动钱的动作依然被 Skill 门控。

用一句话概括：**门控只留给不激活流程就不该被单独调用的危险动作。查询、只读、幂等动作一律放全局**。

###### 4.2.6 完整装配代码

```java
// LangChain4j 1.17.x：官方 langchain4j-skills 模块（beta）
Skills skills = Skills.from(
        FileSystemSkillLoader.loadSkills(Path.of("skills/")));

MyAiService service = AiServices.builder(MyAiService.class)
        .chatModel(chatModel)
        .tools(new OrderTools())                    // 全局工具（始终可见）
        .toolProvider(skills.toolProvider())         // 注册 activate_skill 等
        .systemMessage("You have access to the following skills:\n"
                + skills.formatAvailableSkills()
                + "\nActivate a skill before following its instructions.")
        .build();
```

`formatAvailableSkills()` 生成的系统消息片段是 XML 格式——这就是渐进式披露的 Level 1，只有 name + description，不到 100 Token：

```xml
<available_skills>
    <skill>
        <name>process-order</name>
        <description>Processes a customer order end-to-end</description>
    </skill>
    <skill>
        <name>data-analysis</name>
        <description>Analyse tabular data and produce charts</description>
    </skill>
</available_skills>
```

Maven 依赖（beta，API 可能变动）：

```xml
<dependency>
    <groupId>dev.langchain4j</groupId>
    <artifactId>langchain4j-skills</artifactId>
    <version>1.17.2-beta27</version>
</dependency>
```

###### 4.2.7 两种集成模式

LangChain4j 提供了两种集成模式：

| 模式 | 核心类 | 内置工具 | 安全性 | 适用场景 |
|------|--------|---------|--------|---------|
| Tool 模式（推荐） | `Skills` | `activate_skill` + `read_skill_resource` | 高（无文件系统访问） | 生产环境 |
| Shell 模式（实验性） | `ShellSkills` | `run_shell_command` | 低（无沙箱） | 原型验证 |

Tool 模式下，所有技能内容在初始化时加载到内存，`activate_skill` 返回的是预加载的内容，LLM 在推理时不访问文件系统。Shell 模式下，LLM 通过 `cat /path/to/skills/docx/SKILL.md` 直接读取文件，更接近 Claude Code 的原生行为，但没有沙箱保护。

> 从文件系统加载的技能也可以通过 `toBuilder()` 追加绑定工具：`FileSystemSkillLoader.loadSkill(path).toBuilder().tools(new OrderTools()).build()`。

##### 4.3 Semantic Kernel

微软的 Semantic Kernel 用目录结构定义 Plugin（早期版本就叫 Skill）——每个 Plugin 是一个文件夹，里面有 `skprompt.txt`（提示词模板）和 `config.json`（描述、参数、执行配置）。Kernel 从文件系统发现并注册 Plugin。这在文件定义和目录发现层面和 SKILL.md 最接近，但文件格式完全不同。

##### 4.4 小结

**功能对比**：

| 框架 | 文件定义 | 目录发现 | 工具作用域 | 渐进式披露 | 状态 |
|------|---------|---------|-----------|-----------|------|
| SKILL.md 规范 | 是 | 是 | 可选（实验性） | 三阶段 | 开放标准 |
| Spring AI（`SkillsTool`） | 是 | 是 | 通过辅助工具 | 三阶段 | 社区扩展 GA |
| LangChain4j（`Skills`） | 是 | 是 | 是（技能作用域工具） | 三阶段 | 官方模块 beta |
| Semantic Kernel | 是（`skprompt.txt`） | 是 | 否 | 否 | — |

两个主流 Java 框架都已支持 SKILL.md 的完整三阶段披露，且在**执行模式**上高度一致——都是 `activate_skill` 模式（上下文注入）。TinyAgent 在下一篇的实现中对齐了这个行业共识：

| 维度 | Spring AI / LangChain4j | TinyAgent（下一篇） |
|------|------------------------|-------------------|
| 激活方式 | LLM 调用 `activate_skill(name)` 或 `SkillsTool`，按名称激活 | LLM 调用 `activate_skill(name)`，按名称激活 |
| 指令执行 | 返回到主对话上下文，由同一个 LLM 继续执行 | 返回到主对话上下文，由同一个 LLM 继续执行 |
| 工具隔离 | LangChain4j 有技能作用域工具（激活前不可见）；Spring AI 不强制隔离 | 有——技能专属工具激活前不可见，通过 `DynamicToolProvider` 动态注入 |
| 主上下文影响 | 技能指令和工具结果都进入主上下文 | 同上 |
| 贴近规范 | 贴近 | 贴近 |

> 还有一种**子 Agent 执行模式**作为替代方案：把 Skill 包装成独立的 Function，调用时启动子 ReAct 循环，主 LLM 只拿最终结果。这种模式提供了更强的上下文隔离和独立 Token 预算，但偏离了 SKILL.md 对 Skill 的定位：知识而非函数，且每次技能调用多一轮 LLM 开销。本项目早期版本用过这个方案，但出于与行业主流对齐的考虑，改为了 `activate_skill` 模式。

TinyAgent 的教学价值在哪？**把框架里的黑盒拆开给你看**——`ActivateSkillTool` 展示了 SKILL.md 到 Function Calling 的桥接逻辑，技能指令如何作为 `tool` 角色的消息注入主上下文，LLM 又如何根据指令文本选择正确的工具。读懂这些之后，你再去看 Spring AI 的 `SkillsTool` 或 LangChain4j 的 `Skills`，会更清楚框架帮你封装了什么、省略了什么。

下一篇，咱们把这些概念落地——用 TinyAgent 从零实现 `activate_skill` 模式，包括 SKILL.md 解析、技能专属工具隔离、`DynamicToolProvider` 动态注入，以及完整的 Demo 演示。

### 文末总结

这一篇从 Plan-and-Execute 的重复规划问题出发，引入了 Skill 的概念和行业实现现状：

- **SKILL.md 通用规范**：SKILL.md 是 Anthropic 发起、40+ Agent 产品支持的开放格式。标准字段只有 `name`（必填）、`description`（必填）和 4 个可选字段。核心设计理念是渐进式披露——Discovery（常驻 name + description）→ Activation（加载正文）→ Execution（按需加载脚本/文档）。
- **框架支持现状**：Spring AI 通过社区扩展库 `spring-ai-agent-utils` 的 `SkillsTool` 实现了完整的三阶段渐进式披露；LangChain4j 通过官方 `langchain4j-skills` 模块（beta）也提供了完整支持，并引入了技能作用域工具（Skill-Scoped Tools）的设计。两个框架都采用在主对话上下文中执行的 `activate_skill` 模式。
- **执行模式共识**：两个主流 Java 框架的执行模式高度一致——LLM 调用 `activate_skill(name)` 加载技能指令到主上下文，然后在同一个对话中按指令调用业务工具，不启动子循环。TinyAgent 下一篇的实现将对齐这个行业共识。

