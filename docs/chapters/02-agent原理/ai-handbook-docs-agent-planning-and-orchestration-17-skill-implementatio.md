# 退款处理

> **资料来源**：[AI Handbook](https://github.com/nageoffer/ai-handbook) · 原文件：`docs/agent/planning-and-orchestration/17-skill-implementation.md`。

上一篇梳理了 Skill 的通用规范和行业框架实现——SKILL.md 是什么格式、渐进式披露怎么工作、Spring AI 和 LangChain4j 分别怎么做。这一篇把概念落地：用 TinyAgent 从零实现 `activate_skill` 模式，包括 SKILL.md 解析、技能专属工具隔离、`DynamicToolProvider` 动态注入，以及完整的 Demo 演示。

TinyAgent 对齐了行业主流的执行模式——LLM 调用 `activate_skill(name)` 加载技能指令到主上下文，同时解锁技能专属工具，然后在主循环中按指令调用业务工具。整个过程只有一个 LLM、一个对话上下文，没有子 Agent。

> 本项目中具体代码已上传 GitHub [TinyAgent](https://github.com/nageoffer/tinyagent)，大家 Clone 项目后，将代码分支切换到 1.11.x，默认主分支是最新代码。运行前复制 `.env.example` 为 `.env`，把自己的 API Key 填进去，默认阿里云百炼平台；`.env` 已加入 `.gitignore`，切分支时不会丢。

### TinyAgent 怎么用 Skill

TinyAgent 对齐了行业主流的 `activate_skill` 模式——LLM 调用 `activate_skill(name)` 加载技能指令到主上下文，同时解锁技能专属工具，然后在主循环中按指令调用业务工具。在标准格式之上，TinyAgent 只新增了一个 `tools` 字段，做了一处简化。

#### 1. 为什么需要 `tools` 字段

上一篇讲到 LangChain4j 有技能作用域工具（Skill-Scoped Tools）——绑定在 Skill 上的工具，激活前对 LLM 不可见，激活后才动态暴露。TinyAgent 也实现了这个机制，原因是：**如果所有工具都可见，LLM 会跳过 `activate_skill` 直接调用业务工具，技能指令永远不会进入上下文**。

打个比方，如果 LLM 从一开始就能看到 `applyRefund`，用户要求退掉订单 88231 时，LLM 很可能直接调 `applyRefund`——毕竟功能名称和描述就摆在眼前，何必多走一步激活技能？但这样一来，先查订单 → 验证状态 → 再退款的标准流程就被跳过了，技能指令永远不会被读取。

这就是鸡生蛋问题：**LLM 不会调 `activate_skill`，因为它已经看到了想要的工具；技能指令不进上下文，因为 LLM 没调 `activate_skill`**。

![](https://oss.open8gu.com/iShot_2026-07-06_18.12.25.png)

解决方案很直接——在 Skill 定义中声明专属工具，启动时从 LLM 可见列表中排除，激活后才动态注入：

- `queryOrder`、`applyRefund`、`queryLogistics` 这类**流程专属工具**放进技能的 `tools` 列表，激活前不可见
- `searchKnowledge`、`getCurrentTime` 这类**通用工具**保持始终可见
- LLM 初始只看到通用工具 + `activate_skill`，必须先激活技能才能拿到业务工具

> 这和 LangChain4j 的 Skill-Scoped Tools 是同一个思路。区别在于 LangChain4j 通过 `ToolProvider` 机制在每轮 LLM 调用前重新评估可见工具，TinyAgent 用更轻量的 `DynamicToolProvider` 接口在工具执行后一次性注入——实现不同，效果一致。

#### 2. 我们简化了哪些规则

**Skill 是单文件而非文件夹**。官方规范中，一个 Skill 是以 `SKILL.md` 为入口的整个文件夹（可含 `scripts/`、`references/` 等子目录）。TinyAgent 简化为 `skills/` 目录下的单个 `.md` 文件，没有子目录结构。这是因为当前的两个技能（退款、查单）流程简单，不需要脚本和参考文档。生产环境如果技能复杂度上升，应该按照官方规范的文件夹结构组织。

#### 3. 比特严选的两个 Skill 定义

退款处理技能：

```markdown
<!-- resources/skills/process-refund.md -->
---
name: process-refund
description: >
  退款处理技能：自动查询订单状态，验证退款资格，条件满足则提交退款申请。
  适用于用户要求退货退款的场景，无需手动分步操作。
tools:
  - queryOrder
  - applyRefund
---

## 退款处理

### 概述

你是比特严选的退款处理专员。当用户要求退货退款时，按照以下流程处理。

### 处理步骤

#### Step 1: 查询订单
使用 queryOrder 查询用户提供的订单号，确认订单状态和商品信息。

#### Step 2: 验证退款条件并处理
根据订单状态判断：
- 如果状态为已签收，使用 applyRefund 提交退款申请，退款原因使用用户描述的原因
- 如果状态不是已签收，直接告知用户当前订单状态，说明需要签收后才能申请退款
- 如果订单不存在，告知用户订单号可能有误

### 输出要求
处理完成后，给出简洁明了的处理结果。包含订单商品名称、退款单号（如有）和预计到账时间。
```

订单全流程查询技能：

```markdown
<!-- resources/skills/order-inquiry.md -->
---
name: order-inquiry
description: >
  订单全流程查询技能：查询订单详情，如果已发货则同时查询物流轨迹，
  返回包含订单状态和物流进度的完整信息。无需分步调用。
tools:
  - queryOrder
  - queryLogistics
---

## 订单全流程查询

### 概述

你是比特严选的订单查询专员。当用户要求查看订单状态或物流进度时，按照以下流程查询完整信息。

### 处理步骤

#### Step 1: 查询订单详情
使用 queryOrder 查询订单详情，获取商品名称、价格、订单状态、运单号等信息。

#### Step 2: 查询物流（按需）
如果订单有运单号（trackingNo 不为空），使用 queryLogistics 查询物流轨迹。
如果订单没有运单号，说明可能尚未发货，只返回订单基本信息即可。

### 输出要求
查询完成后，给出一段完整的订单状态说明，包含商品信息、当前状态和物流进度（如有）。
```

frontmatter 有三个字段：`name`（kebab-case，符合官方规范）、`description` 是标准字段，`tools` 是 TinyAgent 扩展的——声明该技能的专属工具，激活前对 LLM 不可见。Markdown 正文就是技能指令——LLM 激活技能后读取这段正文，按步骤调用里面提到的工具。

#### 4. Tool vs Skill：本项目的边界

在 TinyAgent 里，Tool 和 Skill 的区别如下：

| 维度 | Tool（工具） | Skill（技能） |
|------|-------------|--------------|
| 定义方式 | Java 类，实现 Tool 接口 | `.md` 文件，YAML 前置元数据 + Markdown 指令 |
| 发现方式 | 代码中手动注册到 ToolRegistry | 从 `skills/` 目录自动扫描加载 |
| 执行方式 | 直接调用业务接口，无 LLM 参与 | LLM 在主上下文中读取指令，按步骤调用工具 |
| 灵活性 | 高（LLM 自由组合） | 中等（LLM 在指令约束下执行） |
| 新增成本 | 写 Java 代码、编译、部署 | 新建一个 `.md` 文件，无需编译 |

> `instructions` 和 Plan-and-Execute 的 Planner 提示词的区别：Planner 的提示词教 LLM 怎么拆解步骤（元能力），Skill 的 Markdown 正文直接告诉 LLM 具体该怎么做（领域知识）。前者教你怎么做规划，后者要求照着这份规划来执行。

### Skill 数据类与核心组件

#### 1. Skill 数据类

SKILL.md 文件加载后需要映射成 Java 对象。Skill 是一个纯粹的数据类：

```java
@Data
@NoArgsConstructor
public class Skill {

    private String name;
    private String description;
    private List<String> tools;
    private String instructions;
}
```

用 Lombok 的 `@Data` 生成 getter/setter，`@NoArgsConstructor` 用于 Jackson 反序列化。和之前几篇的 Tool 接口不同，**Skill 不实现 Tool 接口**——Skill 是数据类，存放从 YAML 加载的配置；Tool 是行为接口，定义了 `invoke()` 方法。两者之间通过 `ActivateSkillTool` 桥接。

四个字段：`name` 和 `description` 来自 YAML frontmatter，`tools` 也来自 frontmatter——声明该技能的专属工具名列表，`instructions` 来自 Markdown 正文。`tools` 里列出的工具在技能激活前对 LLM 不可见，激活后由 `DynamicToolProvider` 动态注入。

#### 2. 类关系一览

![](https://oss.open8gu.com/iShot_2026-07-06_18.12.24.png)

### SkillRegistry：目录发现与注册

`SkillRegistry` 做三件事：从目录扫描 `.md` 文件、按 SKILL.md 格式解析、通过 `buildAgentRegistry()` 构建主 Agent 的工具注册表。

```java
public class SkillRegistry {

    private final Map<String, Skill> skills = new LinkedHashMap<>();
    private final ObjectMapper yamlMapper = new ObjectMapper(new YAMLFactory());

    public SkillRegistry() {
    }

    // 从指定目录扫描所有 .md 文件，按 SKILL.md 格式解析
    public void loadFromDirectory(Path skillsDir) {
        // ...... 遍历 *.md 文件，调用 parseSkillMd
    }

    /**
     * 构建主 Agent 的工具注册表：
     * - 收集所有技能声明的 tools，标记为技能专属
     * - 只注册不属于任何技能的通用工具 + activate_skill
     * - 技能专属工具在 activate_skill 激活后由 DynamicToolProvider 动态注入
     */
    public ToolRegistry buildAgentRegistry(ToolRegistry baseRegistry) {
        Set<String> skillScopedNames = new HashSet<>();
        for (Skill skill : skills.values()) {
            if (skill.getTools() != null) {
                skillScopedNames.addAll(skill.getTools());
            }
        }

        ToolRegistry agentRegistry = new ToolRegistry();
        for (Tool tool : baseRegistry.getTools()) {
            if (!skillScopedNames.contains(tool.name())) {
                agentRegistry.register(tool);
            }
        }
        agentRegistry.register(new ActivateSkillTool(this, baseRegistry));
        return agentRegistry;
    }

    // ......
}
```

构造函数很简单——**不需要任何外部依赖**。`SkillRegistry` 只负责加载和注册，不参与执行。`buildAgentRegistry()` 的核心逻辑是**分离通用工具和技能专属工具**：先遍历所有技能的 `tools` 列表，收集技能专属工具名（如 `queryOrder`、`applyRefund`、`queryLogistics`），然后只把不在这个集合里的通用工具注册到主 Agent 的注册表。`ActivateSkillTool` 同时接收 `this`（用于查找技能定义）和 `baseRegistry`（全量注册表，用于激活时查找专属工具对象）。

#### 1. SKILL.md 解析

SkillRegistry 扫描 `skills/` 目录下的 `.md` 文件，按 SKILL.md 格式解析——提取 `---` 之间的 YAML 前置元数据和 `---` 之后的 Markdown 正文：

```java
private Skill parseSkillMd(Path file) throws IOException {
    String content = Files.readString(file);
    String trimmed = content.strip();

    int secondSep = trimmed.indexOf("---", 3);
    String yamlPart = trimmed.substring(3, secondSep).strip();
    String markdownBody = trimmed.substring(secondSep + 3).strip();

    // YAML 部分解析为 Skill 对象（name、description、tools）
    Skill skill = yamlMapper.readValue(yamlPart, Skill.class);
    // Markdown 正文作为 instructions
    skill.setInstructions(markdownBody);
    return skill;
}
```

![](https://oss.open8gu.com/iShot_2026-07-06_18.12.26.png)

`yamlMapper` 是 `new ObjectMapper(new YAMLFactory())`，Jackson 的 YAML 扩展模块。Maven 依赖：

```xml
<dependency>
    <groupId>com.fasterxml.jackson.dataformat</groupId>
    <artifactId>jackson-dataformat-yaml</artifactId>
</dependency>
```

#### 2. 两个注册表的关系

`buildAgentRegistry()` 构建的主 Agent 注册表**不包含技能专属工具**——它们被隔离到激活后才可见：

![](https://oss.open8gu.com/iShot_2026-07-06_18.12.27.png)

LLM 初始只能看到 3 个工具（2 个通用工具 + 1 个 `activate_skill`）。`queryOrder`、`queryLogistics`、`applyRefund` 在激活对应技能之前完全不在 LLM 的 tools 列表中——LLM 不知道它们的存在，也无法直接调用。这从根本上解决了绕过技能直接调工具的问题。

#### 3. DynamicToolProvider：动态工具注入接口

在讲 `ActivateSkillTool` 之前，先引入一个关键接口——`DynamicToolProvider`：

```java
public interface DynamicToolProvider {

    List<Tool> dynamicTools();
}
```

这个接口只有一个方法：`dynamicTools()` 返回需要动态注入的工具列表。`ReActAgent` 在执行完一个工具后，检查它是否实现了 `DynamicToolProvider`——如果是，就把返回的工具加入 LLM 可见列表。这是一种通用机制，不限于 Skill 场景。

#### 4. ActivateSkillTool：SKILL.md 到 Function Calling 的桥梁

`ActivateSkillTool` 是整个 Skill 机制的核心——它同时实现了 `Tool` 和 `DynamicToolProvider` 两个接口，LLM 通过 Function Calling 调用它来激活技能，同时解锁技能专属工具：

```java
public class ActivateSkillTool implements Tool, DynamicToolProvider {

    private final SkillRegistry skillRegistry;
    private final ToolRegistry executionRegistry;
    private final String parametersJson;
    private final String descriptionText;
    private final List<Tool> activatedTools = new ArrayList<>();

    public ActivateSkillTool(SkillRegistry skillRegistry,
                             ToolRegistry executionRegistry) {
        this.skillRegistry = skillRegistry;
        this.executionRegistry = executionRegistry;
        this.parametersJson = buildParametersJson(skillRegistry.getSkills());
        this.descriptionText = buildDescription(skillRegistry.getSkills());
    }

    @Override
    public String name() { return "activate_skill"; }

    @Override
    public String description() { return descriptionText; }

    @Override
    public String parameters() { return parametersJson; }

    @Override
    public String invoke(String input) {
        String skillName = ToolUtils.extractRequiredField(input, "name");
        if (skillName.isBlank()) {
            return "{\"error\":\"缺少必填参数 name\"}";
        }

        Skill skill = skillRegistry.getSkill(skillName);
        if (skill == null) {
            return "{\"error\":\"未找到技能：" + skillName + "\"}";
        }

        activatedTools.clear();
        if (skill.getTools() != null) {
            for (String toolName : skill.getTools()) {
                Tool tool = executionRegistry.getTool(toolName);
                if (tool != null) {
                    activatedTools.add(tool);
                }
            }
        }

        return "技能已激活：" + skillName
                + "。请严格按照以下指令操作：\n\n"
                + skill.getInstructions();
    }

    @Override
    public List<Tool> dynamicTools() {
        List<Tool> result = new ArrayList<>(activatedTools);
        activatedTools.clear();
        return result;
    }

    private static String buildDescription(Collection<Skill> skills) {
        StringBuilder sb = new StringBuilder("激活一个技能来获取专业处理指令。可用技能：");
        boolean first = true;
        for (Skill skill : skills) {
            if (!first) {
                sb.append("、");
            }
            sb.append(skill.getName()).append("（")
                    .append(skill.getDescription().strip()).append("）");
            first = false;
        }
        sb.append("。激活后会返回详细的处理步骤，并解锁该技能所需的专属工具。");
        return sb.toString();
    }

    private static String buildParametersJson(Collection<Skill> skills) {
        String enumValues = skills.stream()
                .map(s -> "\"" + s.getName() + "\"")
                .collect(Collectors.joining(","));
        return "{\"type\":\"object\",\"properties\":{\"name\":{\"type\":\"string\","
                + "\"description\":\"要激活的技能名称\",\"enum\":["
                + enumValues + "]}},\"required\":[\"name\"]}";
    }
}
```

这个类做两件事：**返回指令文本 + 暂存技能专属工具**。几个设计要点：

**description 动态拼接技能列表**。构造时 `buildDescription()` 遍历所有已注册的技能，把每个技能的 `name` 和完整 `description` 拼成一段文本，存入 `descriptionText`——这对应渐进式披露的 Level 1。LLM 在 tools 数组里看到这段描述，就知道有哪些技能可以激活、每个技能做什么，不需要额外的系统提示词。注意结尾写了“并解锁该技能所需的专属工具”——告诉 LLM 激活后会有新工具出现。

**parameters 带 enum 约束**。`buildParametersJson()` 同样在构造时从技能列表动态生成 JSON Schema，`enum` 列出了所有合法的技能名，LLM 只能从中选择，不会瞎编一个不存在的技能名。两个构建方法都在构造时执行一次，`description()` 和 `parameters()` 直接返回缓存的字符串，避免每次 LLM 调用都重复拼接。

**invoke 返回指令文本 + 暂存工具**。当 LLM 调用 `activate_skill` 并传入 `process-refund` 时，`invoke()` 做两件事：①根据技能的 `tools` 列表从全量注册表（`executionRegistry`）中查找对应的 Tool 对象，暂存到 `activatedTools`；②返回技能的完整 Markdown 指令作为 observation。

**dynamicTools 取出并清空**。`ReActAgent` 执行完 `invoke()` 后，检测到 `DynamicToolProvider`，调用 `dynamicTools()` 取走暂存的工具。`activatedTools` 随即清空，避免重复注入。

#### 5. ReActAgent 如何注入动态工具

上一节讲了 `ActivateSkillTool` 的 `invoke()` 把技能专属工具暂存到 `activatedTools`，`dynamicTools()` 负责取出并清空。那 `ReActAgent` 什么时候调 `dynamicTools()`？取出的工具又怎么加到 LLM 可见列表里？

答案在 `run()` 方法的主循环里。先看两个关键的局部变量（都在 `run()` 内部声明，每次调用重新创建）：

- **`budgetedTools`**：`List<Tool>`，决定下一次 LLM 调用能看到哪些工具。初始时只有通用工具 + `activate_skill`，一共 3 个。
- **`dynamicToolMap`**：`Map<String, Tool>`，存放激活后注入的技能专属工具。执行阶段查找工具时，先查 `toolRegistry`（通用工具），没找到再查这个 Map。

每执行完一个工具，`ReActAgent` 检查它是否实现了 `DynamicToolProvider`——如果是，就取出动态工具，同时放进这两个数据结构：

```java
// ReActAgent.run() 中的工具执行块（简化，省略了 observation 折叠、消息构建等）
Map<String, Tool> dynamicToolMap = new LinkedHashMap<>();

for (ToolCallInfo tc : response.toolCalls()) {
    // 第一步：查找工具——先查静态注册表，再查动态注入表
    Tool targetTool = toolRegistry.getTool(tc.functionName());
    if (targetTool == null) {
        targetTool = dynamicToolMap.get(tc.functionName());
    }
    String observation = targetTool != null
            ? targetTool.invoke(tc.arguments() == null ? "" : tc.arguments())
            : "{\"error\":\"未找到工具：" + tc.functionName() + "\"}";

    // 第二步：检查是否有动态工具需要注入
    if (targetTool instanceof DynamicToolProvider provider) {
        List<Tool> newTools = provider.dynamicTools();
        if (!newTools.isEmpty()) {
            Set<String> existingNames = new HashSet<>();
            for (Tool t : budgetedTools) {
                existingNames.add(t.name());
            }
            for (Tool newTool : newTools) {
                // 放进执行查找表（始终覆盖，保证能执行）
                dynamicToolMap.put(newTool.name(), newTool);
                // 放进 LLM 可见列表（去重，existingNames.add 返回 true 说明是新工具）
                if (existingNames.add(newTool.name())) {
                    budgetedTools.add(newTool);
                }
            }
            // 重建 tools JSON，LLM 下一圈就能看到新工具
            tools = toolRegistry.buildToolsJsonArray(objectMapper, budgetedTools);
        }
    }
}
```

##### 5.1 用退款场景走一遍

用退掉订单 88231 这个请求，逐圈走一遍这段逻辑：

**第 1 圈：LLM 调用 `activate_skill`**。`toolRegistry` 里有 `activate_skill`（通用工具），找到并执行 `invoke()`。执行过程中，`ActivateSkillTool` 把 `queryOrder` 和 `applyRefund` 存进了 `activatedTools`。执行完毕后，代码检测到 `ActivateSkillTool` 实现了 `DynamicToolProvider`，于是调 `dynamicTools()` 取出这两个工具：

- `dynamicToolMap` 存入 `queryOrder` 和 `applyRefund`（后续执行时能找到）
- `budgetedTools` 加入这两个工具（LLM 下一圈可见）
- 重建 tools JSON，工具列表从 3 个变为 5 个

**第 2 圈：LLM 调用 `queryOrder`**。`toolRegistry` 里没有 `queryOrder`——它是技能专属工具，启动时就被 `buildAgentRegistry()` 排除了。但 `dynamicToolMap` 里有（第 1 圈刚放进去的），找到并执行，返回订单详情。`QueryOrderTool` 没有实现 `DynamicToolProvider`，跳过注入检查。

**第 3 圈：LLM 调用 `applyRefund`**。同理，`toolRegistry` 里没有，`dynamicToolMap` 里有，找到并执行，返回退款结果。

整个过程可以用一张表概括：

| 圈次 | LLM 调用 | 从哪找到 | 执行后动态注入 | LLM 可见工具数 |
|------|---------|---------|--------------|-------------|
| 1 | `activate_skill` | `toolRegistry` | `queryOrder`、`applyRefund` | 3 → 5 |
| 2 | `queryOrder` | `dynamicToolMap` | 无 | 5 |
| 3 | `applyRefund` | `dynamicToolMap` | 无 | 5 |
| 4 | （无工具调用，输出最终回复） | — | — | 5 |

![](https://oss.open8gu.com/iShot_2026-07-06_18.12.28.png)

##### 5.2 三个设计要点

**工具查找两步走**。执行工具时先查 `toolRegistry`（静态注册的通用工具），没找到再查 `dynamicToolMap`（动态注入的技能专属工具）。这样做的好处是：技能激活前 LLM 即使幻觉出一个 `queryOrder` 调用，也会得到 `未找到工具` 的错误；激活后 `queryOrder` 进了 `dynamicToolMap`，同样的调用就能正常执行。

![](https://oss.open8gu.com/iShot_2026-07-06_18.12.29.png)

**注入时去重**。`process-refund` 和 `order-inquiry` 都声明了 `queryOrder`。如果用户在一次 `run()` 里先后激活两个技能，`queryOrder` 会被注入两次。代码用 `existingNames` 集合做去重——`Set.add()` 返回 `true` 说明是新元素，`false` 说明已存在。`dynamicToolMap` 始终覆盖更新（保证最新版本能执行），但 `budgetedTools` 只在首次出现时才添加，避免 tools JSON 里出现重复的工具定义。

**局部变量保证跨调用隔离**。`dynamicToolMap` 和 `budgetedTools` 都是 `run()` 方法的局部变量，每次 `run()` 调用都从空 Map / 初始列表开始。场景 1 激活了 `applyRefund`，场景 2 调用 `run()` 时这个工具不会带过来——必须重新激活技能才能获取。

#### 6. 为什么 instructions 由 LLM 执行而不是硬编码

一个自然的疑问：退款流程不就是查订单 → 判断状态 → 退款吗，为什么不直接写成 Java 代码？

```java
// 伪代码示意——硬编码方式，不需要 LLM
String orderJson = toolRegistry.execute(new Action("queryOrder", input));
if ("已签收".equals(extractStatus(orderJson))) {
    return toolRegistry.execute(new Action("applyRefund", input));
}
```

这种方式当然可以，也更快更省 Token。但它有两个局限：

**参数提取和错误处理依赖硬编码**。用户可能只说想退上周买的扫地机，原因是坏了好几天。LLM 在主上下文中能结合对话历史理解用户意图，灵活组织退款原因描述，硬编码做不到这一点。

**新增技能需要编译部署**。硬编码的技能是 Java 类，每次新增或修改都需要改代码、编译、重新部署。SKILL.md + LLM 驱动的技能只需要新建一个文件——写清楚指令正文和工具列表，重启加载即可。在快速迭代的业务场景下，这个差异很重要。

当然，对于步骤极其固定、完全不需要 LLM 灵活性的场景，硬编码 Tool 也是合理的选择。但那时候它就是一个普通的复合 Tool（在 Spring AI 里就是一个 `@Tool` 方法里写了多步逻辑），不叫 Skill。**Skill 的核心特征是 LLM 驱动执行 + 指令引导 + 文件定义 + 目录发现**。

#### 7. Skill 指令的写作技巧

SKILL.md 的 Markdown 正文就是技能的灵魂。写得好，LLM 按部就班完成任务；写得差，LLM 可能跳步骤或者瞎发挥。几个实践下来管用的原则：

**用祈使句直接下指令**。不要写“你应该查询订单”，直接写“使用 queryOrder 查询订单详情”。LLM 对直接指令的遵循度远高于建议式表达。

**每一步说清楚用哪个工具**。不要写“查一下订单状态”，要写“使用 queryOrder 查询订单详情”——把工具名明确写出来。LLM 在 2 个工具的选择空间里都可能纠结，明确指令能大幅降低出错率。

**用 Markdown 结构组织步骤**。概述、处理步骤、输出要求分节写，每个步骤用 `### Step N` 标记。LLM 对结构化文本的理解比一大段自然语言好得多。

**把分支条件写成列表**。例如“如果已签收则退款，否则告知用户”——写成带 `-` 的列表比写成一段话清晰。LLM 对列表格式的条件判断遵循率更高。

### LLM 发现与激活机制

#### 1. 技能注册后如何被 LLM 看到

`buildAgentRegistry()` 过滤掉了技能专属工具，主 Agent 初始看到的 tools 列表只有 3 个：

```json
[
  {"type":"function","function":{"name":"searchKnowledge","description":"检索知识库..."}},
  {"type":"function","function":{"name":"getCurrentTime","description":"获取当前时间..."}},
  {"type":"function","function":{"name":"activate_skill",
    "description":"激活一个技能来获取专业处理指令。可用技能：process-refund（退款处理技能：自动查询订单状态，验证退款资格，条件满足则提交退款申请。适用于用户要求退货退款的场景，无需手动分步操作。）、order-inquiry（订单全流程查询技能：查询订单详情，如果已发货则同时查询物流轨迹，返回包含订单状态和物流进度的完整信息。无需分步调用。）。激活后会返回详细的处理步骤，并解锁该技能所需的专属工具。",
    "parameters":{"type":"object","properties":{"name":{"type":"string",
      "description":"要激活的技能名称",
      "enum":["process-refund","order-inquiry"]}},"required":["name"]}}}
]
```

LLM 看不到 `queryOrder`、`applyRefund`、`queryLogistics`——它们是技能专属工具，只有激活对应技能后才会出现在 tools 列表中。面对退掉订单 88231 这种请求，LLM 唯一能做的就是调用 `activate_skill`。

整个流程的时序如下：

![](https://oss.open8gu.com/iShot_2026-07-06_18.12.33.png)

这张图的关键在于两点。第一，**只有一个 LLM、一个主循环**。技能指令作为 `tool` 角色的消息进入主上下文，LLM 在同一个对话里读取指令、调用工具、生成回复，没有子 Agent。第二，**工具动态注入**。LLM 初始只看到 3 个工具，调用 `activate_skill` 后通过 `DynamicToolProvider` 解锁了 `queryOrder` 和 `applyRefund`，工具列表从 3 个变为 5 个。

#### 2. 技能描述的设计技巧

`activate_skill` 的 `description()` 内嵌了所有技能的名称和说明——这是 LLM 判断是否需要激活技能的唯一依据。三个原则：

**说清楚做了什么**。不要只写“处理退款”，要写“查询订单状态，验证退款资格，条件满足则提交退款申请”——让 LLM 知道这个技能覆盖了哪些步骤。

**说清楚什么时候用**。“适用于用户要求退货退款的场景”——帮助 LLM 判断当前意图是否匹配。

**说清楚不用手动做什么**。“无需手动分步操作”——告诉 LLM 激活技能后按指令走就行，不需要自己规划步骤。

| 描述写法 | 问题 | 改进 |
|---------|------|------|
| 处理退款 | 太模糊，LLM 不确定该不该激活 | 写明内部步骤 |
| 查询订单并退款 | 没说清适用场景 | 加上场景说明 |
| 退款处理技能：自动查询订单状态，验证退款资格，条件满足则提交退款申请。适用于用户要求退货退款的场景，无需手动分步操作。 | 三个要素齐全 | — |

#### 3. 技能与工具共存时的选择逻辑

初始状态下，主 Agent 看到 2 个通用工具 + 1 个 `activate_skill`。由于 `queryOrder` 等业务工具被隔离在技能里，LLM 面对业务请求时只能走技能路径：

- 用户要求退掉订单 88231 → LLM 选 `activate_skill` 并传入 `process-refund`（意图匹配退款技能描述，且没有其他业务工具可选）
- 用户询问订单 88231 到哪了 → LLM 选 `activate_skill` 并传入 `order-inquiry`（意图匹配订单查询技能描述）
- 用户询问退换货政策 → LLM 选 `searchKnowledge`（知识查询属于通用工具，不需要走技能）
- 用户询问当前时间 → LLM 选 `getCurrentTime`（通用工具，直接可用）

### Demo：完整运行示例

把所有组件串起来：

```java
public class SkillDemo {

    public static void main(String[] args) {
        ToolRegistry toolRegistry = new ToolRegistry();
        toolRegistry.register(new QueryOrderTool());
        toolRegistry.register(new QueryLogisticsTool());
        toolRegistry.register(new ApplyRefundTool());
        toolRegistry.register(new SearchKnowledgeTool());
        toolRegistry.register(new GetCurrentTimeTool());

        Properties dotEnv = loadDotEnv();
        LlmClient llmClient = new LlmClient(
                setting(dotEnv, "TINYAGENT_API_URL",
                        "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions"),
                requiredSetting(dotEnv, "TINYAGENT_API_KEY"),
                setting(dotEnv, "TINYAGENT_MODEL", "qwen-plus")
        );

        // 从 skills/ 目录加载技能定义（SKILL.md 格式）
        SkillRegistry skillRegistry = new SkillRegistry();
        skillRegistry.loadFromDirectory(Path.of("src/main/resources/skills"));

        // 构建主 Agent 注册表：通用工具 + activate_skill（技能专属工具激活后才可见）
        ToolRegistry agentTools = skillRegistry.buildAgentRegistry(toolRegistry);

        ReActAgent agent = new ReActAgent(llmClient, agentTools, 10, 8000);

        // 场景 1：退款
        System.out.println("========== 场景 1：退款 ==========");
        String answer1 = agent.run("我的订单 88231 那个扫地机坏了，帮我退掉");
        System.out.println("\n[最终结果] " + answer1);

        // 场景 2：订单查询
        System.out.println("\n\n========== 场景 2：订单全流程查询 ==========");
        String answer2 = agent.run("帮我看看订单 88231 现在到哪了");
        System.out.println("\n[最终结果] " + answer2);
    }

    // loadDotEnv()、requiredSetting()、setting() ......
}
```

注意三个关键步骤：

**Step 1：注册业务工具**。所有 5 个基础工具注册到 `toolRegistry`。

**Step 2：加载技能定义**。`loadFromDirectory()` 扫描 `.md` 文件，按 SKILL.md 格式解析（YAML 前置元数据 + Markdown 指令正文），存入 `SkillRegistry`。注意这一步只是解析和存储，不做任何 ToolRegistry 注册。

**Step 3：构建主 Agent 注册表**。`buildAgentRegistry(toolRegistry)` 创建一个新的 ToolRegistry，过滤掉技能专属工具（`queryOrder`、`queryLogistics`、`applyRefund`），只注册通用工具（`searchKnowledge`、`getCurrentTime`）和 `activate_skill`。LLM 初始只能看到 3 个函数。

![](https://oss.open8gu.com/iShot_2026-07-06_18.12.32.png)

预期控制台输出（大模型措辞每次会有细微差异，但技能激活和工具调用的结构一致）：

**场景 1：退款**

```text
[SkillRegistry] 加载技能：process-refund（process-refund.md）
[SkillRegistry] 加载技能：order-inquiry（order-inquiry.md）
[SkillRegistry] 技能专属工具（激活前不可见）：[queryOrder, queryLogistics, applyRefund]
========== 场景 1：退款 ==========

===== 第 1 圈 =====
[工具调用] activate_skill({"name":"process-refund"})
[Skill] 激活技能：process-refund，解锁工具：[queryOrder, applyRefund]
[工具结果] 技能已激活：process-refund。请严格按照以下指令操作......
[动态工具] 解锁 2 个技能专属工具：[queryOrder, applyRefund]

===== 第 2 圈 =====
[工具调用] queryOrder({"orderId":"88231"})
[工具结果] {"orderId":"88231","product":"比特 S10 Pro 扫地机",
  "price":1999,...,"status":"已签收",...}

===== 第 3 圈 =====
[工具调用] applyRefund({"orderId":"88231","reason":"扫地机质量问题"})
[工具结果] {"success":true,"refundId":"RF20260629001",...}

===== 第 4 圈 =====
[最终答复] 已经为您处理了订单 88231 的退款申请......
```

看控制台日志的三个关键点：

第一，**启动时打印了技能专属工具列表**。`[SkillRegistry] 技能专属工具（激活前不可见）：[queryOrder, queryLogistics, applyRefund]`——这三个工具被从主 Agent 注册表中排除了，LLM 初始看不到它们。

第二，**第 1 圈激活技能后解锁了专属工具**。LLM 调用 `activate_skill` 后，`DynamicToolProvider` 把 `queryOrder` 和 `applyRefund` 注入了可见列表。从第 2 圈开始，LLM 才能调用这两个工具。

第三，**第 2-3 圈 LLM 按照技能指令依次调用工具**——先 `queryOrder` 确认状态是已签收，然后 `applyRefund` 提交退款。指令文本里写了“使用 queryOrder 查询”和“使用 applyRefund 提交退款”，LLM 自然按步骤执行。整个过程在主循环中完成，没有子 Agent。

**场景 2：订单全流程查询**

```text
========== 场景 2：订单全流程查询 ==========

===== 第 1 圈 =====
[工具调用] activate_skill({"name":"order-inquiry"})
[Skill] 激活技能：order-inquiry，解锁工具：[queryOrder, queryLogistics]
[工具结果] 技能已激活：order-inquiry。请严格按照以下指令操作......
[动态工具] 解锁 2 个技能专属工具：[queryOrder, queryLogistics]

===== 第 2 圈 =====
[工具调用] queryOrder({"orderId":"88231"})
[工具结果] {"orderId":"88231",...,"trackingNo":"SF1234567890",...}

===== 第 3 圈 =====
[工具调用] queryLogistics({"trackingNo":"SF1234567890"})
[工具结果] {"trackingNo":"SF1234567890","carrier":"顺丰速运","status":"已签收",...}

===== 第 4 圈 =====
[最终答复] 您的订单 88231（比特 S10 Pro 扫地机）已签收......
```

两个场景的共同点：**主循环跑了 4 圈**（激活技能 + 调工具 1-2 次 + 生成回复），全程在同一个 LLM 上下文中完成。对比没有技能的 ReAct 方式：场景 1 同样需要 3-4 圈（查订单 → 判断状态 → 退款 → 回复），圈数差不多。

那 Skill 的价值在哪？**不在于减少圈数，而在于两点：工具隔离 + 流程引导**。工具隔离确保 LLM 必须先激活技能才能拿到业务工具，不可能跳过技能直接操作；技能指令保证了 LLM 先查订单再退款，不会跳步骤、不会乱序。两者配合，把退款从 LLM 的自由发挥变成了标准化流程。

### Skill vs Plan-and-Execute：什么时候用哪个

#### 1. 三层能力光谱

到这里，TinyAgent 有了三种执行能力，它们不是替代关系，而是一个从确定到灵活的光谱：

```text
确定性高 ◀━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━▶ 灵活性高

   Tool            Skill           Plan-and-Execute
  （原子操作）    （文件定义的       （动态规划）
                  指令驱动执行）

  查一个订单     退款全流程        帮我退款，顺便推荐
  搜一次知识库   订单全流程查询      一个新扫地机
```

**Tool 是最小单元**：一次操作，一个结果。

**Skill 是预定义的指令驱动执行**：SKILL.md 定义指令，LLM 在指令引导下执行，不需要临时规划。新增技能只需要新建一个 `.md` 文件，无需改代码。

**Plan-and-Execute 是动态规划**：每次根据用户需求生成新计划。最灵活，但多花一次规划的 LLM 调用。

#### 2. 决策矩阵

| 判断维度 | 用 Tool | 用 Skill | 用 Plan-and-Execute |
|---------|---------|---------|-------------------|
| 任务步骤数 | 1 步 | 2-4 步，流程固定 | 3 步以上，流程不固定 |
| 场景频率 | 不限 | 高频（值得沉淀） | 不限 |
| 步骤稳定性 | — | 固定（写入 instructions） | 不固定，需要临时规划 |
| 子任务数 | 1 个 | 1 个（内含多步） | 多个独立子任务 |
| 新增成本 | 写 Java + 编译 | 新建 `.md` 文件 | 零（通用引擎） |
| Token 效率 | 每步走主 Agent 上下文 | 只多一次 activate_skill 调用加载指令 | 规划 1 次 + 每步走 Executor 上下文 |

![](https://oss.open8gu.com/iShot_2026-07-06_18.12.30.png)

#### 3. 组合使用

三种模式可以组合。上一篇的 `AgentRouter` 可以进一步扩展：

```text
用户输入
  ↓
[AgentRouter]
  ├── 知识问答？ → 固定 RAG Workflow
  ├── 匹配已有技能？ → ReAct + Skill
  ├── 简单工具任务？ → ReAct
  └── 复杂多目标？ → Plan-and-Execute
```

实际上不需要显式路由——技能注册到主 Agent 的 ToolRegistry 后，ReAct 和 Plan-and-Execute 都能自动使用它们。ReAct 场景下主 LLM 会直接选择技能；Plan-and-Execute 场景下 Planner 也可以在计划步骤的 `toolHint` 里指定技能名称。

### 进阶思考：技能的更多可能性

#### 1. 动态加载与热更新

当前实现在启动时扫描一次 `skills/` 目录。生产环境可以加一个文件监听（如 `WatchService`），目录里新增或修改了 `.md` 文件就自动重新加载——不重启服务就能上线新技能。这和 Spring Boot 的 `application.yml` 热更新是同一个思路。

#### 2. 技能组合

LLM 能不能在一次对话里激活多个技能？技术上可以——`activate_skill` 始终在 tools 列表里，LLM 可以多次调用它。但连续激活多个技能会导致指令堆叠，上下文膨胀，LLM 可能搞混不同技能的步骤。更好的做法是在需要多技能协作的场景下使用 Plan-and-Execute 或多智能体架构——这正是后续篇章要讲的内容。

#### 3. 技能质量评估

`instructions` 写得好不好，直接决定技能执行的质量。但不像 Java 代码有编译器兜底，Markdown 指令改一个字就可能让 LLM 跳步骤或者选错工具——而且你改完之后看不出来，得跑一遍才能发现。

解决思路是给每个技能写回归测试。TinyAgent 当前没有内置这个机制，但思路很直接——写一个测试方法，把用户消息喂给 Agent，录制 LLM 实际调用了哪些工具，然后断言工具调用序列符合预期：

```java
// 技能回归测试示意（非 TinyAgent 现有代码）
@Test
void processRefund_normalFlow() {
    // 正常退款：已签收订单，应该走 activate_skill → queryOrder → applyRefund
    String answer = agent.run("订单 88231 扫地机坏了，帮我退掉");

    // 断言：工具调用序列包含这三个，且顺序正确
    assertThat(toolCallRecorder.getCalledTools())
            .containsExactly("activate_skill", "queryOrder", "applyRefund");
    // 断言：最终回复包含退款单号
    assertThat(answer).contains("RF");
}

@Test
void processRefund_orderNotFound() {
    // 订单不存在：应该走 activate_skill → queryOrder，不应该调 applyRefund
    String answer = agent.run("帮我退掉订单 99999");

    assertThat(toolCallRecorder.getCalledTools())
            .containsExactly("activate_skill", "queryOrder");
    assertThat(toolCallRecorder.getCalledTools())
            .doesNotContain("applyRefund");
    assertThat(answer).containsAnyOf("订单不存在", "订单号有误");
}
```

这里的关键是 `toolCallRecorder`——一个记录 LLM 实际工具调用序列的组件，在测试时注入到 Agent 中。它不干预执行过程，只是旁路记录每次 `invoke()` 被调用时的工具名称。

有了这类测试，每次修改 `process-refund.md` 的指令文本后跑一遍，就能确认 LLM 是否仍然按照先查订单 → 再退款的顺序执行，不会因为改了一句描述就把流程搞乱。

> 需要注意的是，LLM 的输出具有不确定性——同样的输入可能偶尔走出不同的工具调用路径。生产环境如果要做这类测试，通常会把 LLM 的 `temperature` 设为 0 来降低随机性，或者多次运行取通过率而不是要求每次都通过。

### 文末总结

这一篇从 TinyAgent 的项目约定出发，完整实现了 `activate_skill` 模式的技能系统：

- **技能专属工具隔离**：在 SKILL.md 标准字段之外扩展了 `tools` 字段，声明技能专属工具。`buildAgentRegistry()` 启动时将专属工具从 LLM 可见列表中排除，解决了 LLM 绕过技能直接调工具的鸡生蛋问题——对齐了 LangChain4j 的 Skill-Scoped Tools 设计。
- **目录发现**：`SkillRegistry.loadFromDirectory()` 扫描 `skills/` 目录的 `.md` 文件，解析 YAML 前置元数据和 Markdown 指令正文。加载过程只存储定义，不做任何注册。
- **activate_skill + DynamicToolProvider 执行模式**：LLM 调用 `activate_skill(name)` 加载技能指令到主上下文，同时通过 `DynamicToolProvider` 接口将技能专属工具动态注入 LLM 可见列表。`ActivateSkillTool` 同时实现 `Tool` 和 `DynamicToolProvider` 两个接口，桥接了 SKILL.md 规范到 Function Calling 体系。
- **工具隔离保证**：`ReActAgent` 的 `dynamicToolMap` 是 `run()` 的局部变量，保证多次调用之间的工具不泄漏。
- **三层能力光谱**：Tool（原子操作）→ Skill（指令驱动执行）→ Plan-and-Execute（动态规划），三者不是替代关系，越稳定的场景越往 Skill 靠，越灵活的需求越往 Plan-and-Execute 靠。

到这里，TinyAgent 有了单工具调用、预定义技能和动态规划三种能力。但之前的例子一直在处理单品类的需求——退一台扫地机、查一个订单。如果用户要求对比比特 AirX 耳机和比特 BandPro 头戴式耳机，并顺便推荐一个搭配手机用的智能手表，这句话横跨耳机和智能穿戴两个品类，涉及商品对比和搭配推荐两种任务类型。下一篇，咱们用跨品类场景来验证工具、技能和规划的组合编排能力——对比 + 搭配 + 售后一起跑。

