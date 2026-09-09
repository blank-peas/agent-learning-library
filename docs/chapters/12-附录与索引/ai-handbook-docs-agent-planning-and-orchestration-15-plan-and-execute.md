# plan-and-execute

> **资料来源**：[AI Handbook](https://github.com/nageoffer/ai-handbook) · 原文件：`docs/agent/planning-and-orchestration/15-plan-and-execute.md`。

上一篇收尾时留了一句话：Plan-and-Execute 模式天然具备阶段信号，到那时按任务阶段调整上下文会清晰得多。这一篇就来兑现这个承诺。

前面的篇幅，咱们从 ReAct 循环起步，一路搭建了工具调用、Function Calling、终止控制、短期记忆、持久化、长期记忆、上下文工程——TinyAgent 已经是一个能想、能干、能记住你是谁、还会精打细算 Token 的智能体了。但它的决策方式始终没变：**一步一步走，走一步看一步**。

这种方式在简单任务上表现不错。用户说“帮我查订单 88231 的物流”，Agent 查订单拿运单号、查物流拿轨迹、给出答复——三步搞定，每一步都很清晰。但如果用户说的是这样一句话呢？

> 我家老人想要一台扫地机，预算 2000 以内，要好操作的。另外帮我看看订单 88231 到了没，到了的话帮我把那台坏的退掉。

一句话里塞了两个独立任务，其中一个还带条件分支（到了才退）。ReAct 会怎么处理？一步一步摸索。问题是——它不知道前面还有多少步要走，也不知道两个任务之间该怎么安排顺序。这就是 ReAct 的天花板。

这一篇，咱们给 TinyAgent 装上规划能力——先想清楚要干什么、分几步、每步用什么工具，然后再一步一步执行。这就是 Plan-and-Execute 模式。

> 本项目中具体代码已上传 GitHub [TinyAgent](https://github.com/nageoffer/tinyagent)，大家 Clone 项目后，将代码分支切换到 1.10.x，默认主分支是最新代码。运行前复制 `.env.example` 为 `.env`，把自己的 API Key 填进去，默认阿里云百炼平台；`.env` 已加入 `.gitignore`，切分支时不会丢。

### ReAct 的天花板：走一步看一步的代价

在引入新方案之前，先把问题说透——ReAct 到底在什么场景下会拉胯？

#### 1. 复杂任务的真实困境

拿开头那个例子来分析。用户一句话包含了两个子任务：

- **子任务 A**：推荐一台 2000 以内、适合老人用的扫地机
- **子任务 B**：查订单 88231 是否签收，如果已签收则申请退款

流程图如下所示：

![](https://oss.open8gu.com/iShot_2026-07-02_13.39.42.png)

ReAct Agent 拿到这句话后，第 1 圈的 Thought 里确实可以想“用户有两个任务，先处理退款再推荐”——ReAct 不禁止在 Thought 里做规划。但问题是，这个规划只存在于 Thought 的一段自然语言文字里，**不会被结构化保存**。随着轮次增加、Observation 堆积，这段最初的规划越来越容易被大模型的注意力机制淡化。假设它先查了订单：

```text
第 1 圈：查订单 88231 → 拿到订单详情，状态“已签收”
第 2 圈：查物流确认签收 → 拿到物流轨迹
第 3 圈：申请退款 → 拿到退款单号
第 4 圈：……然后呢？
```

走到第 4 圈，messages 里已经堆了三轮退款相关的 Observation。虽然原始 user message 还在上下文里，推荐扫地机的需求不会凭空消失，但退款信息占据了大量上下文空间，大模型的注意力可能偏移——它有可能在这一圈就以为任务已完成，直接输出 Final Answer，漏掉推荐。更糟的是，如果中间某一圈大脑跳到推荐任务，查了知识库，然后下一圈又跳回退款——整条轨迹就变成了一条逻辑交错的线。

这不是 TinyAgent 的 bug，而是 ReAct 范式的结构性局限——它**没有为多子任务提供显式的结构化保障**，导致在复杂任务上表现不够稳定。

#### 2. 三个根因

**规划不被显式结构化保存**。ReAct 可以在 Thought 里做局部规划（先处理退款，再推荐），但这个规划只是一段自然语言，不会被保存为独立的数据结构。随着轮次增加、Observation 堆积，最初的规划在上下文中的权重逐渐下降。就像导航只在出发时口头说了一遍全程路线，然后每个路口都只告诉你“下个路口左转”——简单路线没问题，复杂路线你可能走偏。

**缺乏显式的条件分支机制**。用户说“到了的话帮我退掉”——这是一个 if-then 逻辑。ReAct 没有专门的分支结构，大脑只能在 Thought 里隐式地记住这个条件。实践中大模型通常能处理简单条件，但随着轮次增加和上下文膨胀，条件被误判或遗忘的概率上升。

**多任务切换成本高**。ReAct 的 messages 是线性累积的，子任务 A 的工具结果和子任务 B 的工具结果混在一起。大脑在第 6 圈要综合两个子任务的结果时，得从一堆交错的 Observation 里把相关信息捡出来——这对大模型的长上下文理解能力是个不小的挑战。

用一句话概括：**ReAct 把规划和执行耦合在同一个循环里，且规划不被显式结构化保留；Plan-and-Execute 把两者拆开，计划本身就是一份可追踪、可调整的执行清单。**

#### 3. 一张表看清边界

| 维度 | ReAct | Plan-and-Execute |
|------|-------|-------------------|
| 决策方式 | 每步推理一次，决定下一个动作 | 先生成完整计划，再逐步执行 |
| 适合的任务 | 单目标、1-3 步可完成 | 多目标、多步骤、有依赖关系 |
| 全局视角 | 可在 Thought 中局部规划，但不会结构化保留 | 有，计划覆盖所有步骤并保存为独立数据结构 |
| 条件分支 | 隐式（靠 Thought 记住，轮次多时易丢失） | 显式（写在计划步骤里） |
| 失败恢复 | 靠下一圈 Thought 自行调整 | 可以重新规划（Re-plan） |
| 额外开销 | 无 | 多一次规划的 LLM 调用 |
| 可观测性 | 只能看 Thought 日志 | 计划本身就是可读的执行清单 |

### Plan-and-Execute：先想清楚再动手

#### 1. 核心思想

Plan-and-Execute 的核心思想很直觉——**把规划和执行拆成两个独立阶段**。

打个比方：你去宜家买家具。ReAct 的方式是进门之后走一步看一步——先看到沙发觉得不错，逛到厨房区又想起要买碗碟，最后在出口才发现忘了量尺寸，又折回去。Plan-and-Execute 的方式是进门前先列个清单——要买什么、在几楼、按什么路线走、预算多少——然后按清单一项一项拿。

落到 Agent 上，两个阶段的职责很清晰：

- **Planner（规划器）**：拿到用户的原始需求，结合可用工具列表，生成一份结构化的执行计划——包含哪些步骤、每步干什么、用什么工具、步骤之间的依赖关系。
- **Executor（执行器）**：按计划逐步执行，每步调用对应的工具，拿到结果后更新步骤状态。如果某步失败或结果偏离预期，可以触发重新规划（Re-plan）。

#### 2. 架构全景

![](https://oss.open8gu.com/iShot_2026-07-02_13.39.43.png)

这张图有三个关键点：

**Planner 和 Executor 是分离的**。Planner 负责想——生成和调整计划；Executor 负责执行——调用工具拿结果。两者都用 LLM，但 Prompt 不同、职责不同。架构上这种分离支持给 Planner 用推理能力强的大模型（比如 DeepSeek-R1），给 Executor 用速度快、成本低的小模型——各取所长。本篇的实现为了简单，Planner 和 Executor 共用同一个 `LlmClient`；如果要分模型，给 `Planner` 传入独立的 `LlmClient` 实例即可。

**Re-plan 是可选的**。不是每步执行完都要重新规划。只有当步骤失败、或者工具返回了计划之外的新信息时，才触发重新规划。大多数情况下，计划生成一次就够了。

**最后一步是综合**。所有工具调用完成后，Agent 不是简单地把结果拼起来，而是再调一次 LLM，把所有步骤的结果综合成一段连贯的、面向用户的回复。

#### 3. ReAct vs Plan-and-Execute 的执行轨迹对比

用同一个复杂任务来对比两种方式的执行轨迹：

**用户输入**：“我家老人想要一台扫地机，预算 2000 以内。另外帮我看看订单 88231 到了没，到了就帮我退掉。”

**ReAct 的轨迹**（一步一步摸索）：

```text
第 1 圈 Thought: 用户有两个需求，先处理订单问题。查订单 88231。
  → Action: queryOrder(88231)
第 2 圈 Thought: 订单已签收，需要查物流确认。
  → Action: queryLogistics(SF1234567890)
第 3 圈 Thought: 确认已签收，用户说到了就退，我来申请退款。
  → Action: applyRefund({"orderId":"88231","reason":"用户要求退货"})
第 4 圈 Thought: 退款搞定了，还有推荐扫地机的需求。搜一下知识库。
  → Action: searchKnowledge("扫地机 2000以内 老人")
第 5 圈 Thought: 拿到推荐信息了，综合回复。
  → Final Answer: ......
```

5 圈，逻辑能跑通，但大脑每一圈都在临时决定下一步该干什么。如果第 3 圈大脑的注意力被退款流程占据，误以为任务已经完成，就会直接输出 Final Answer——只回复了退款结果，漏掉了推荐。这不是必然发生，但上下文越长，风险越高。

**Plan-and-Execute 的轨迹**（先规划再执行）：

```text
【规划阶段】
  Plan:
    Step 1: 搜索知识库，查询 2000 以内适合老人的扫地机型号
    Step 2: 查询订单 88231 的详情，确认商品和状态
    Step 3: 如果订单已签收，为订单 88231 申请退款
    Step 4: 综合推荐结果和退款进展，给出最终回复

【执行阶段】
  Step 1 → searchKnowledge("扫地机 2000以内 适合老人") → 拿到推荐信息 ✓
  Step 2 → queryOrder("88231") → 状态：已签收 ✓
  Step 3 → applyRefund({"orderId":"88231","reason":"..."}) → 退款已提交 ✓
  Step 4 → LLM 综合所有结果 → 最终回复 ✓
```

4 步，每步目标明确。即使中间某步失败（比如退款接口超时），Agent 也清楚知道是哪一步出了问题、前面哪些步骤已经完成了、后面还有什么要做——因为计划本身就是一份完整的清单。

> 你可能注意到了：Plan-and-Execute 的轨迹里没有查物流这一步。Planner 在规划时看到了 `queryOrder` 的工具描述——返回订单状态、商品、物流单号等信息——据此判断订单详情里应该包含签收状态，不需要额外安排 `queryLogistics`。这就是全局视角的好处——Planner 能在规划阶段就根据工具描述优化步骤编排，而 ReAct 只能执行到一半才发现多走了弯路。

### 数据结构：计划长什么样

在写 Planner 和 Executor 之前，先把计划这个概念落成代码。一个计划由若干步骤组成，每个步骤有明确的描述、预期使用的工具、执行状态和结果。

#### 1. PlanStep：一个步骤

```java
public class PlanStep {

    private final int stepId;        // 步骤编号，从 1 递增
    private final String description; // 这一步要做什么（自然语言）
    private final String toolHint;   // 建议使用的工具名，null 表示综合步骤
    private PlanStepStatus status;   // PENDING → EXECUTING → COMPLETED / FAILED
    private String result;           // 执行结果（成功为文本，失败为错误原因）

    public PlanStep(int stepId, String description, String toolHint) {
        this.stepId = stepId;
        this.description = description;
        this.toolHint = toolHint;
        this.status = PlanStepStatus.PENDING;
    }

    public void markCompleted(String result) {
        this.status = PlanStepStatus.COMPLETED;
        this.result = result;
    }

    public void markFailed(String reason) {
        this.status = PlanStepStatus.FAILED;
        this.result = reason;
    }

    // getters 省略
}
```

```java
public enum PlanStepStatus {
    PENDING, EXECUTING, COMPLETED, FAILED
}
```

几个设计决策说明一下：

**`toolHint` 是提示而非强制**。Planner 在规划时会猜测每步可能用到的工具，但 Executor 执行时不一定非得用这个工具。`toolHint` 有两个作用：一是注入 Executor 的提示词（建议使用的工具：queryOrder），给 LLM 一个方向、降低决策负担；二是区分工具步骤和综合步骤——`toolHint` 为 `null` 表示这步不调工具，走纯文本综合分支。但 `toolHint` 不是铁令，Executor 有权根据实际情况选择其他工具。

**状态流转是单向的**。`PENDING → EXECUTING → COMPLETED / FAILED`，不允许倒退。如果一步失败了需要重试，走的是重新规划的路径——Planner 会生成一个新的计划（可能包含“重试第 N 步”的新步骤），而不是把失败的步骤状态改回 `PENDING`。

#### 2. Plan：完整计划

```java
public class Plan {

    private final String goal;          // 用户原始需求，执行步骤和重规划时均从此读取
    private final List<PlanStep> steps; // 按执行顺序排列的步骤列表

    public Plan(String goal, List<PlanStep> steps) {
        this.goal = goal;
        this.steps = new ArrayList<>(steps);
    }

    public String getProgressSummary() {
        ......
    }

    // getGoal()、getSteps()、nextPendingStep()、isAllDone()、hasFailedStep()、isAllDone() ......
}
```

`getProgressSummary()` 的输出长这样：

```text
  ✓ Step 1: 搜索知识库，查询 2000 以内适合老人的扫地机 → {"matched":"比特 S10 Lite 扫地机","price":1599,...}
  ✓ Step 2: 查询订单 88231 的详情 → {"orderId":"88231","status":"已签收",...}
  ▶ Step 3: 为订单 88231 申请退款
  ○ Step 4: 综合推荐结果和退款进展，生成最终回复
```

这个摘要有两个用途：一是打印到控制台方便调试，二是喂给 Planner 做重新规划时的上下文——Planner 看到哪些步骤完成了、拿到了什么结果，才能做出合理的调整。

### Planner：让大模型做规划

Planner 是 Plan-and-Execute 的核心——它用一次 LLM 调用，把用户的自然语言需求拆解成结构化的步骤列表。

#### 1. 规划提示词设计

规划提示词要解决三个问题：让大模型知道有哪些工具可用、按什么格式输出计划、遵循什么规划原则。

```java
public class Planner {

    private final LlmClient llmClient;
    private final ToolRegistry toolRegistry;

    public Planner(LlmClient llmClient, ToolRegistry toolRegistry) {
        this.llmClient = llmClient;
        this.toolRegistry = toolRegistry;
    }

    private String buildPlannerPrompt() {
        StringBuilder toolList = new StringBuilder();
        for (Tool tool : toolRegistry.getTools()) {
            toolList.append("- ").append(tool.name())
                    .append("：").append(tool.description()).append("\n");
        }

        return """
                你是一个任务规划助手。根据用户的问题，将任务拆解为一系列可执行的步骤。

                可用工具：
                %s
                输出格式要求：
                用 JSON 数组表示计划，每个元素包含：
                - stepId：步骤编号（从 1 开始）
                - description：这一步要做什么（简洁明确）
                - toolHint：预计使用的工具名（如果是纯推理或综合步骤，填 null）

                规划原则：
                1. 每一步只做一件事，对应一次工具调用或一次推理判断
                2. 步骤之间按执行顺序排列——如果 B 依赖 A 的结果，A 必须排在 B 前面
                3. 最后一步必须是“综合以上结果，给出最终回复”，toolHint 填 null
                4. 步骤数量控制在 3-7 步，太少说明拆分不够，太多说明拆分过细
                5. 如果用户的需求包含条件判断（如“如果……就……”），把条件检查和条件执行拆成两步
                6. 只输出 JSON 数组，不要输出任何解释

                示例：
                用户问题：帮我查一下订单 88231 到了没，到了就退掉。
                输出：
                [
                  {"stepId":1,"description":"查询订单 88231 的详情，确认订单状态","toolHint":"queryOrder"},
                  {"stepId":2,"description":"如果订单已签收，为订单 88231 申请退款，退款原因为用户主动申请","toolHint":"applyRefund"},
                  {"stepId":3,"description":"综合以上结果，告知用户订单状态和退款进展","toolHint":null}
                ]
                """.formatted(toolList);
    }

    // createPlan()、replan()、parsePlan()、extractJsonArray() ......
}
```

提示词里有几个关键设计值得展开讲。

**工具列表提供给 Planner 看，但 Planner 不调工具**。Planner 的职责是规划，不是执行。它需要知道有哪些工具可用，才能合理地分配步骤和 `toolHint`，但它本身不触发任何工具调用。

**步骤数量约束在 3-7 步**。太少（1-2 步）说明 Planner 没有真正做拆解，可能把多个操作挤在一步里；太多（8 步以上）说明拆得过细，增加了执行轮次和 LLM 调用成本，收益递减。3-7 步覆盖了比特严选绝大多数客服场景。

**条件判断拆成两步**。“如果到了就退”这种需求，Planner 应该把查询状态和申请退款拆成两步，而不是写成一步“查询订单并在签收后退款”。拆成两步的好处是：Executor 执行完第 1 步后，可以根据结果决定第 2 步是否要执行——条件逻辑变成了可观测的步骤状态。

**最后一步固定为综合步骤**。`toolHint` 为 `null` 表示这步不调工具，而是用 LLM 把前面所有步骤的结果综合成面向用户的回复。这一步非常重要——没有它，Agent 只能拼凑工具返回的 JSON，用户体验很差。

#### 2. 生成计划

```java
public Plan createPlan(String userMessage) {
    ObjectMapper objectMapper = llmClient.getObjectMapper();
    ArrayNode messages = objectMapper.createArrayNode();

    ObjectNode systemMsg = messages.addObject();
    systemMsg.put("role", "system");
    systemMsg.put("content", buildPlannerPrompt());

    ObjectNode userMsg = messages.addObject();
    userMsg.put("role", "user");
    userMsg.put("content", userMessage);

    ChatResponse response = llmClient.chatWithTools(
            messages, objectMapper.createArrayNode());
    String content = response.content();

    return parsePlan(userMessage, content);
}

private Plan parsePlan(String goal, String content) {
    ObjectMapper objectMapper = llmClient.getObjectMapper();
    try {
        // 提取 JSON 数组（大模型可能在 JSON 前后附带文字）
        String json = extractJsonArray(content);
        JsonNode arrayNode = objectMapper.readTree(json);

        List<PlanStep> steps = new ArrayList<>();
        for (JsonNode node : arrayNode) {
            int stepId = node.get("stepId").asInt();
            String description = node.get("description").asText();
            String toolHint = node.has("toolHint") && !node.get("toolHint").isNull()
                    ? node.get("toolHint").asText() : null;
            steps.add(new PlanStep(stepId, description, toolHint));
        }
        return new Plan(goal, steps);
    } catch (Exception e) {
        // 解析失败：降级为单步计划，让 Executor 自行处理
        System.out.println("[Planner] 计划解析失败，降级为单步执行：" + e.getMessage());
        List<PlanStep> fallback = List.of(
                new PlanStep(1, goal, null),
                new PlanStep(2, "综合以上结果，给出最终回复", null)
        );
        return new Plan(goal, fallback);
    }
}

private String extractJsonArray(String text) {
    int start = text.indexOf('[');
    int end = text.lastIndexOf(']');
    if (start >= 0 && end > start) {
        return text.substring(start, end + 1);
    }
    throw new IllegalArgumentException("未找到 JSON 数组");
}
```

`extractJsonArray()` 做了一件事——从大模型返回的文本中提取 JSON 数组。虽然提示词要求“只输出 JSON 数组”，但大模型偶尔会在 JSON 前后加一句解释。直接用 `indexOf('[')` 和 `lastIndexOf(']')` 定位，比依赖大模型严格遵守“只输出 JSON”更可靠。

**解析失败的降级策略**是关键——如果 Planner 返回的内容完全解析不出来（比如模型幻觉了一段不相关的文本），不能让整个 Agent 崩掉。降级为单步计划本质上就退化成了 ReAct 模式——虽然没有规划的好处，但至少能工作。

#### 3. 重新规划

当某个步骤执行失败、或者工具返回了意料之外的结果时，Planner 需要根据已完成的步骤和当前状况重新生成计划：

```java
public Plan replan(Plan currentPlan) {
    String goal = currentPlan.getGoal();
    ObjectMapper objectMapper = llmClient.getObjectMapper();
    ArrayNode messages = objectMapper.createArrayNode();

    ObjectNode systemMsg = messages.addObject();
    systemMsg.put("role", "system");
    systemMsg.put("content", buildPlannerPrompt());

    String replanContext = """
            用户原始问题：%s

            之前的计划执行进度：
            %s
            请根据已完成步骤的结果和失败情况，重新规划剩余步骤。
            已完成的步骤不需要重复，只规划接下来要做的事。
            步骤编号从 %d 开始继续编号。
            """.formatted(
            goal,
            currentPlan.getProgressSummary(),
            currentPlan.getNextStepId());

    ObjectNode userMsg = messages.addObject();
    userMsg.put("role", "user");
    userMsg.put("content", replanContext);

    ChatResponse response = llmClient.chatWithTools(
            messages, objectMapper.createArrayNode());

    Plan newPlan = parsePlan(goal, response.content());

    List<PlanStep> merged = new ArrayList<>();
    for (PlanStep step : currentPlan.getSteps()) {
        if (step.getStatus() == PlanStepStatus.COMPLETED) {
            merged.add(step);
        }
    }
    merged.addAll(newPlan.getSteps());

    return new Plan(goal, merged);
}
```

重新规划的核心在于 **`getProgressSummary()` 提供的上下文**。Planner 看到的不只是“第 3 步失败了”，而是“第 1 步查订单成功，结果是已签收；第 2 步查物流成功；第 3 步退款失败，原因是退款接口超时”——有了这些信息，Planner 可以做出合理的调整，比如加一步“重试退款申请”或者“改为引导用户手动退款”。

**合并策略**也很重要：已完成的步骤保留（连同它们的结果），只替换待执行和失败的部分。这样 Executor 不会重复执行已经成功的步骤，节省时间和 Token。

### Executor：按计划执行每一步

Executor 负责执行计划中的每个步骤。它接收步骤描述和之前步骤的上下文，调用 LLM 决定使用什么工具、传什么参数，然后执行工具并返回结果。

#### 1. 执行单步的 Prompt 设计

跟 ReAct 的系统提示词不同，Executor 的提示词更聚焦——它不需要考虑接下来该做什么（那是 Planner 的事），只需要把这一步做好：

```java
private String executeStep(PlanStep step, Plan plan, ArrayNode tools) {
    ObjectMapper objectMapper = llmClient.getObjectMapper();
    ArrayNode messages = objectMapper.createArrayNode();

    String completedContext = buildCompletedContext(plan);
    boolean isSynthesisStep = step.getToolHint() == null;

    ObjectNode systemMsg = messages.addObject();
    systemMsg.put("role", "system");
    if (isSynthesisStep) {
        systemMsg.put("content", """
                你是比特严选的智能客服助手。
                请根据之前各步骤的执行结果，综合生成一段面向用户的完整回复。
                不要调用任何工具，直接输出最终回复文本。

                之前步骤的执行结果：
                %s
                """.formatted(completedContext));
    } else {
        String toolHintLine = step.getToolHint() != null
                ? "建议使用的工具：" + step.getToolHint()
                  + "（仅供参考，你可以根据实际情况选择其他工具）\n"
                : "";
        systemMsg.put("content", """
                你是比特严选的智能客服助手。你正在按计划执行一个任务。
                当前步骤的目标：%s
                %s
                之前步骤的执行结果：
                %s
                重要约束：
                - 只完成当前步骤描述的目标，不要做其他步骤的工作
                - 每次最多调用一个工具
                - 拿到工具结果后，如果已经满足当前步骤的目标，直接输出结果文本，不要继续调用工具
                """.formatted(step.getDescription(), toolHintLine, completedContext));
    }

    ObjectNode userMsg = messages.addObject();
    userMsg.put("role", "user");
    userMsg.put("content", "用户原始问题：" + plan.getGoal());

    // 综合步骤传空 tools，强制 LLM 只输出文本
    ArrayNode stepTools = isSynthesisStep
            ? objectMapper.createArrayNode() : tools;

    for (int i = 0; i < MAX_STEP_ROUNDS; i++) {
        ChatResponse response = llmClient.chatWithTools(messages, stepTools);

        if (!response.hasToolCalls()) {
            return response.content() != null ? response.content() : "";
        }

        // ...... 工具调用处理（构建 assistant 消息、执行工具、追加 tool 消息）
    }

    throw new RuntimeException("当前步骤未能在限定轮次内完成");
}

private String buildCompletedContext(Plan plan) {
    // ...... 遍历已完成步骤，拼接 “Step N（描述）：结果” 格式
}
```

#### 2. 关键点设计

**综合步骤传空 tools 数组**。这是最关键的一个设计——当 `toolHint == null` 时，说明这步是纯文本综合，不需要调任何工具。如果你仍然把 tools 传给 LLM，它看到工具就有冲动去调——比如在综合回复时又去搜一遍知识库。传空 tools 从 API 层面就堵死了这条路，LLM 只能输出文本。同时系统提示词也换成了综合专用版本，不再提调用工具。

**工具步骤的三条约束**。实际跑下来会发现，没有约束的 Executor 很容易越界——Step 1 是搜知识库，但 LLM 顺手把 `queryOrder` 也调了。这不是 LLM 的错，它只是想帮忙多做一些。但越界会导致两个问题：一是后续步骤做了重复工作（Step 2 又查一遍订单），二是当前步骤的 3 圈轮次被无关调用消耗掉。三条约束——只做当前步骤、每次最多调一个工具、拿到结果就收手——把 Executor 的行为框在计划范围内。

**每步最多 3 圈**。大多数计划步骤只需要 1 次工具调用。给 3 圈的余量是为了处理工具返回错误后 LLM 自行重试的情况（比如第 1 圈传错了参数格式，LLM 看到错误后第 2 圈修正）。3 圈足够了——如果 3 圈还搞不定，`executeStep()` 会抛出异常，上层的 `catch` 块会标记步骤为 FAILED 并触发重新规划。

**`buildCompletedContext()` 传递上下文**。第 3 步执行时，Executor 能看到第 1 步和第 2 步的结果。比如第 2 步查了订单，拿到了状态“已签收”，第 3 步的退款就可以直接引用这个结果，不需要再查一遍。这是 Plan-and-Execute 比 ReAct 高效的一个重要原因——步骤之间的信息传递是显式的、结构化的。

### PlanAndExecuteAgent：完整的主循环

把 Planner 和 Executor 串起来，就是 `PlanAndExecuteAgent` 的主循环。

```java
public class PlanAndExecuteAgent {

    private static final int MAX_STEP_ROUNDS = 3;

    private final LlmClient llmClient;
    private final ToolRegistry toolRegistry;
    private final Planner planner;
    private final int maxReplanCount;

    public PlanAndExecuteAgent(LlmClient llmClient, ToolRegistry toolRegistry,
                               int maxReplanCount) {
        this.llmClient = llmClient;
        this.toolRegistry = toolRegistry;
        this.planner = new Planner(llmClient, toolRegistry);
        this.maxReplanCount = maxReplanCount;
    }

    public String run(String userMessage) {
        ObjectMapper objectMapper = llmClient.getObjectMapper();

        // 阶段一：生成计划
        System.out.println("[Plan] 正在规划...");
        Plan plan = planner.createPlan(userMessage);
        System.out.println("[Plan] 计划生成完成：");
        System.out.println(plan.getProgressSummary());

        ArrayNode tools = toolRegistry.buildToolsJsonArray(objectMapper);
        int replanCount = 0;

        // 阶段二：逐步执行
        while (!plan.isAllDone()) {
            PlanStep step = plan.nextPendingStep();
            if (step == null) break;

            step.setStatus(PlanStepStatus.EXECUTING);
            System.out.println("\n[Execute] ▶ Step " + step.getStepId()
                    + ": " + step.getDescription());

            try {
                String result = executeStep(step, plan, tools);
                step.markCompleted(result);
                System.out.println("[Execute] ✓ Step " + step.getStepId()
                        + " 完成");
            } catch (Exception e) {
                step.markFailed(e.getMessage());
                System.out.println("[Execute] ✗ Step " + step.getStepId()
                        + " 失败：" + e.getMessage());

                if (replanCount < maxReplanCount) {
                    replanCount++;
                    System.out.println("[Replan] 第 " + replanCount
                            + " 次重新规划...");
                    plan = planner.replan(plan);
                    System.out.println("[Replan] 新计划：");
                    System.out.println(plan.getProgressSummary());
                } else {
                    System.out.println("[Replan] 已达最大重规划次数，跳过失败步骤");
                }
            }
        }

        // 阶段三：返回最终结果
        System.out.println("\n[Plan] 执行完成：");
        System.out.println(plan.getProgressSummary());

        return extractFinalResult(plan);
    }

    // executeStep()、buildCompletedContext() 见上一节
    // extractFinalResult() ......
}
```

主循环的三个阶段对应代码里的三个注释块，逻辑很直白。重点说几个设计决策：

**`MAX_STEP_ROUNDS = 3` 限制每步的内部轮次**。大多数计划步骤只需要 1 次工具调用，给 3 圈余量是为了处理工具返回错误后 LLM 自行重试的情况。3 圈还搞不定，`executeStep()` 抛出异常，上层 `catch` 块标记 FAILED 并触发重新规划——确保超轮次不会被当成完成。

**`maxReplanCount` 限制重规划次数**。重新规划需要一次 LLM 调用，成本不低。而且重规划存在递归风险——新计划的某步又失败，又触发重规划，无限循环。默认设为 2 次：第一次重规划处理偶发失败（如网络超时），第二次处理持续性问题（如工具真的不可用）。两次还搞不定，说明问题不在计划层面，继续重规划也没意义。

**异常触发重规划，而不是每步都重规划**。有些 Plan-and-Execute 实现在每步执行后都调一次 Planner 检查计划是否需要调整（Every-step Re-plan）。这种做法更健壮，但代价是 LLM 调用次数翻倍。对于比特严选的场景——5 个工具、3-5 步的计划——只在失败时重规划已经足够。如果你的场景步骤多、不确定性高（比如多轮对话中用户随时变需求），可以考虑每步重规划。

**`extractFinalResult()` 的回退逻辑**。正常情况下，最后一步（`toolHint` 为 `null` 的综合步骤）的结果就是最终回复。但如果综合步骤失败了（比如 LLM 超时），回退到拼接所有已完成步骤的结果——虽然格式不够友好，但总比返回空好。

### 动态重规划：计划赶不上变化

重规划不只是失败了就重来。在实际场景中，有三种情况需要重新规划：

#### 1. 步骤执行失败

最直接的情况。比如退款接口返回“该订单不在退款有效期内”，Planner 看到这个结果后，可能会把计划调整为引导用户联系人工客服。

#### 2. 工具返回了计划之外的新信息

比如计划的第 2 步是“查询订单 88231 的详情”，查出来的结果是“订单状态：退款中”。这意味着订单已经在退款流程里了，原计划第 3 步的申请退款就没必要执行。如果不重规划，Executor 会傻傻地再申请一次退款，可能导致重复退款。

这种情况比步骤失败更隐蔽——步骤本身执行成功了，但结果改变了后续步骤的前提条件。

#### 3. 用户在下一轮对话中追加需求

这在多轮对话中很常见：第一轮 Agent 执行完计划、返回了结果，用户紧接着说“对了，顺便帮我看看你们有没有新款耳机”。这时如果系统保留了上一轮的 Plan 对象，就可以把新需求融入已有计划——要么追加新步骤，要么重新生成包含新任务的完整计划，而不是从零开始。

> 注意：当前 `run()` 是同步阻塞的，执行期间用户无法发送新消息。这里说的追加需求发生在上一轮 `run()` 返回之后、下一轮对话开始时。

> 本篇的实现只处理了第 1 种情况（步骤失败触发重规划）。第 2 种情况可以通过在 `executeStep()` 后增加一个结果校验器来检测——比对步骤描述的预期和实际结果，差异较大时触发重规划。第 3 种情况需要对接多轮对话机制，将上一轮的 Plan 传入下一轮，识别新需求后触发增量重规划——这块内容较多，会放到本系列后面的多轮任务编排篇里专门讲。

#### 4. 重规划的成本权衡

| 重规划策略 | LLM 调用成本 | 适用场景 | 风险 |
|-----------|-------------|---------|------|
| 从不重规划 | 零 | 步骤简单、工具稳定、任务确定性高 | 失败后直接崩 |
| 仅失败时重规划 | 低（多 0-2 次） | 工具偶发失败、但大多数时候可靠 | 可能错过需要调整的非失败情况 |
| 每步执行后重规划 | 高（步骤数 × 1） | 步骤多、环境变化大、用户需求不确定 | 成本翻倍，重规划本身可能引入新问题 |

比特严选场景选择仅失败时重规划——5 个工具都是内部系统，稳定性有保障，偶尔的网络超时用一次重规划就能覆盖。

### 进阶思考：什么时候该用 Plan-and-Execute

Plan-and-Execute 不是万能的。规划本身有成本——多一次额外的 LLM 调用（Planner 的提示词本身就有数百 Token 的工具列表和规划原则，再加上输出的计划 JSON），多 1-3 秒的响应时间。对于简单任务，这些开销是纯浪费。

#### 1. 任务复杂度的判断标准

怎么判断一个任务是否复杂到需要规划？三个信号：

**多工具协作**。用户的需求涉及两个以上工具——比如查订单 + 退款需要 `queryOrder` 和 `applyRefund`，推荐商品 + 查物流需要 `searchKnowledge` 和 `queryLogistics`。单工具任务用 ReAct 足够。

**条件分支**。用户的需求包含“如果……就……”的逻辑——“到了就退”“没货就推荐替代品”。ReAct 只能隐式处理条件，Plan-and-Execute 可以把条件显式写在计划里。

**多个独立子任务**。用户一句话包含两个以上不相关的需求——“帮我查物流，另外推荐一个新款耳机”。ReAct 处理多子任务容易遗漏，Plan-and-Execute 在规划阶段就把所有子任务列出来了。

#### 2. 路由：自动选择 ReAct 还是 Plan-and-Execute

一个生产级的 Agent 不应该让用户选择模式——它应该自己判断。可以用一次轻量的 LLM 调用做任务复杂度分类：

```java
public class AgentRouter {

    private final LlmClient llmClient;
    private final ReActAgent reactAgent;
    private final PlanAndExecuteAgent planAgent;

    public String route(String userMessage) {
        String mode = classifyComplexity(userMessage);
        System.out.println("[Router] 任务模式：" + mode);

        if ("plan".equals(mode)) {
            return planAgent.run(userMessage);
        } else {
            return reactAgent.run(userMessage);
        }
    }

    private String classifyComplexity(String userMessage) {
        ObjectMapper objectMapper = llmClient.getObjectMapper();
        ArrayNode messages = objectMapper.createArrayNode();

        ObjectNode systemMsg = messages.addObject();
        systemMsg.put("role", "system");
        systemMsg.put("content", """
                判断用户的问题是简单任务还是复杂任务。
                简单任务：只需要一个工具调用或直接回答，输出 react
                复杂任务：需要多个工具协作、包含条件判断、或有多个子需求，输出 plan
                只输出 react 或 plan，不要输出其他内容。""");

        ObjectNode userMsg = messages.addObject();
        userMsg.put("role", "user");
        userMsg.put("content", userMessage);

        ChatResponse response = llmClient.chatWithTools(
                messages, objectMapper.createArrayNode());
        String result = response.content().strip().toLowerCase();
        return result.contains("plan") ? "plan" : "react";
    }
}
```

路由调用的开销很小——输入不超过 200 Token，输出只有一个单词，延迟通常在 1 秒左右。换来的是：简单任务不走规划的冤枉路，复杂任务不在 ReAct 里瞎摸索。

#### 3. 两种模式的决策流程图

![](https://oss.open8gu.com/iShot_2026-07-02_13.39.44.png)

### Demo：一个复杂任务的完整执行

把所有组件串起来，用开头那个复杂场景跑一遍：

```java
public class PlanAndExecuteDemo {

    public static void main(String[] args) {
        ToolRegistry toolRegistry = new ToolRegistry();
        toolRegistry.register(new QueryOrderTool());
        toolRegistry.register(new QueryLogisticsTool());
        toolRegistry.register(new ApplyRefundTool());
        toolRegistry.register(new SearchKnowledgeTool());
        toolRegistry.register(new GetCurrentTimeTool());

        // LlmClient 初始化（跟之前的 Demo 一样，从 .env 读取配置）
        Properties dotEnv = loadDotEnv();
        LlmClient llmClient = new LlmClient(
                setting(dotEnv, "TINYAGENT_API_URL",
                        "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions"),
                requiredSetting(dotEnv, "TINYAGENT_API_KEY"),
                setting(dotEnv, "TINYAGENT_MODEL", "deepseek-v4-pro")
        );

        PlanAndExecuteAgent agent = new PlanAndExecuteAgent(
                llmClient, toolRegistry, 2);

        String answer = agent.run(
                "我家老人想要一台扫地机，预算 2000 以内，要好操作的。"
                        + "另外帮我看看订单 88231 到了没，到了的话帮我把那台坏的退掉。");

        System.out.println("\n========== 最终结果 ==========");
        System.out.println(answer);
    }

    // loadDotEnv()、requiredSetting()、setting() ......
}
```

预期控制台输出（大模型措辞每次会有细微差异，但步骤结构和工具调用一致）：

```text
[Plan] 正在规划...
[Plan] 计划生成完成：
  ○ Step 1: 查询订单 88231 的详情，获取订单状态、商品等信息
  ○ Step 2: 检索比特严选知识库，查询预算 2000 以内、操作简单的扫地机推荐
  ○ Step 3: 如果订单 88231 已签收，则为其申请退款，退款原因为商品问题
  ○ Step 4: 综合订单状态、退款进展和扫地机推荐，给出最终回复

[Execute] ▶ Step 1: 查询订单 88231 的详情，获取订单状态、商品等信息
[工具调用] queryOrder({"orderId":"88231"})
[工具结果] {"orderId":"88231","product":"比特 S10 Pro 扫地机","price":1999,...,"status":"已签收",...}
[Execute] ✓ Step 1 完成

[Execute] ▶ Step 2: 检索比特严选知识库，查询预算 2000 以内、操作简单的扫地机推荐
[工具调用] searchKnowledge({"query":"预算2000以内 操作简单 扫地机推荐"})
[工具结果] {"matched":"扫地机选购指南","content":"比特 S10 Lite 扫地机（¥1599）：一键启停，语音播报，..."}
[Execute] ✓ Step 2 完成

[Execute] ▶ Step 3: 如果订单 88231 已签收，则为其申请退款，退款原因为商品问题
[工具调用] applyRefund({"orderId":"88231","reason":"商品问题：扫地机存在故障"})
[工具结果] {"success":true,"refundId":"RF20260629001","message":"退款申请已提交，预计 1-3 个工作日到账"}
[Execute] ✓ Step 3 完成

[Execute] ▶ Step 4: 综合订单状态、退款进展和扫地机推荐，给出最终回复
[Execute] ✓ Step 4 完成

[Plan] 执行完成：
  ✓ Step 1: 查询订单 88231 的详情 → 订单 88231，比特 S10 Pro 扫地机，已签收...
  ✓ Step 2: 检索知识库，查询扫地机推荐 → 比特 S10 Lite（¥1599），一键启停，适合老人...
  ✓ Step 3: 为订单 88231 申请退款 → 退款已提交，退款单号 RF20260629001...
  ✓ Step 4: 综合以上结果，给出最终回复 → 已经为您处理完毕...

========== 最终结果 ==========
已经为您处理完毕，以下是本次服务的总结：

📦 订单 88231 处理结果
您购买的比特 S10 Pro 扫地机（¥1999）已于 6 月 22 日签收。
由于商品存在故障，已为您发起退款申请：
- 退款单号：RF20260629001
- 退款金额：¥1999.00
- 预计 1-3 个工作日到账，原路退回

🏠 给老人用的扫地机推荐
考虑到预算 2000 以内、操作简单，重点推荐比特 S10 Lite 扫地机（¥1599）：
- 一键启停，无需复杂设置
- 语音播报，老人听得懂、用得来
- 自动回充，完全不用操心

如有其他问题，随时联系我！
```

对比 ReAct 的执行方式，Plan-and-Execute 有三个明显优势：

**不会遗漏子任务**。Plan 在开头就把推荐扫地机和处理订单退款两个子任务都列出来了，不存在执行到一半忘记另一个的风险。

**每步聚焦、不越界**。每步的 Executor 只做当前步骤的事——Step 1 查订单就只查订单，Step 2 搜知识库就只搜知识库。而 ReAct 的大脑是自由发挥的，可能在查物流时顺手又查了一遍订单，白白消耗轮次。

**可观测性好得多**。控制台打印的计划清单就是一份实时进度表——哪步在执行、哪步完成了、每步的结果是什么，一目了然。排查问题时，你不需要从一堆 Thought 日志里还原大脑的推理链路——看计划就够了。

### Plan-and-Execute 的局限与应对

Plan-and-Execute 不是银弹。在使用之前，需要清楚它的限制：

#### 1. 规划的额外延迟与模式选择

生成计划需要一次 LLM 调用，通常 1-3 秒。对于“帮我查订单 88231”这种一步搞定的任务，多出的规划时间是纯浪费。

实际上，如果你要做一个比特严选的 Agentic RAG 平台，首先要区分固定 RAG 流程和 Agent 决策流程。这里的 Workflow 不是把退货退款这种业务办理流程写死在代码里，而是指 RAG 的固定处理链路——问题进入后，按既定顺序完成查询改写、知识检索、重排序和答案生成。

所以整体上会有三种执行模式：

![](https://oss.open8gu.com/iShot_2026-07-06_18.12.16.png)

三种模式的定位和取舍：

| 维度 | Workflow（固定 RAG 流程） | ReAct（单步推理） | Plan-and-Execute（先规划再执行） |
|------|----------------------|------------------|-------------------------------|
| 决策方式 | 代码固定 RAG 链路，不做工具决策 | 每步 LLM 推理 | 先 LLM 规划，再逐步执行 |
| 响应延迟 | 低（检索 + 一次生成，可能叠加改写 / 重排） | 中等（N 步 × LLM 推理） | 最高（规划 + N 步 × LLM 推理） |
| 灵活性 | 最低（只覆盖知识问答链路） | 最高（每步自由决策） | 中等（计划约束执行范围） |
| 适用场景 | FAQ、商品说明、售后政策、选购指南等知识问答 | 1-3 步的简单工具任务 | 多目标、有分支、需要全局视角的复杂任务 |
| 维护成本 | 维护知识库质量、索引和检索链路 | 零，通用循环 | 零，通用循环 |

Workflow 适合纯知识问答。比如用户问“比特 S10 Lite 适合老人用吗”“退货政策是什么”“扫地机耗材多久换一次”，这些问题不需要 Agent 自主选择工具，也不需要先规划步骤，直接走固定 RAG 链路就够了：改写查询 → 检索知识库 → 重排序 → 生成答案。

退货退款、订单查询这类要调用业务系统的动作，不属于这里的 Workflow。它们应该进入 Agent 决策链路：简单的一两步任务走 ReAct；同时包含推荐、查订单、条件退款等多个目标时，再走 Plan-and-Execute。

所以前面讲的 `AgentRouter` 还可以进一步扩展：先判断是不是知识问答，是就走固定 RAG Workflow；不是知识问答，再判断任务复杂度，简单走 ReAct，复杂走 Plan-and-Execute。

#### 2. 计划质量依赖大模型

Planner 生成的计划质量取决于大模型的推理能力。如果模型把步骤拆得太粗（一步里塞了三个操作）或太细（查个订单分成三步），执行效果都会打折扣。应对方式有两个：一是在提示词里加更多的 Few-shot 示例来锚定拆分粒度；二是给 Planner 传入独立的 `LlmClient`，对接推理能力更强的模型（比如 DeepSeek-R1），Executor 用更快更便宜的模型。

#### 3. 上下文窗口的消耗

每执行一步，`buildCompletedContext()` 就要把前面所有步骤的结果带上。如果计划有 7 步、每步结果 200-400 Token，到第 7 步时上下文里要塞 1200-2800 Token 的历史结果。这跟 ReAct 的 Observation 累积问题本质相同——第 14 篇讲的 `ObservationFolder` 同样可以用在这里，对步骤结果做字段级 JSON 折叠。

| 局限 | 影响 | 应对方式 |
|------|------|---------|
| 规划延迟 | 简单任务多等 1-3 秒 | AgentRouter 路由，知识问答走 Workflow，简单工具任务走 ReAct |
| 计划质量 | 步骤拆分不合理 | 丰富 Few-shot 示例；Planner 用强模型 |
| 上下文消耗 | 步骤多时历史结果占空间 | 步骤结果用 ObservationFolder 折叠 |
| 实时交互弱 | 计划生成后用户无法中途调整 | 多轮对话中支持追加需求触发重规划 |

### 文末总结

这一篇从 ReAct 一步一步走的天花板出发，引入了 Plan-and-Execute 模式——先规划再执行的两阶段架构：

- **Planner 做规划**：用一次 LLM 调用，把用户的自然语言需求拆解成结构化的步骤列表（`Plan` + `PlanStep`）。提示词里提供工具列表和规划原则，输出 JSON 数组。解析失败时降级为单步计划，不影响主流程。
- **Executor 做执行**：按计划逐步执行，每步聚焦于一个目标。`toolHint` 注入提示词给 Executor 提供工具方向，`buildCompletedContext()` 传递前序步骤结果。每步最多 3 圈 LLM 调用，超轮次抛异常触发重规划。
- **Re-plan 做兜底**：步骤失败时触发重新规划，Planner 看到已完成步骤的结果和失败原因，生成新的后续计划。已完成的步骤保留不重复执行。
- **AgentRouter 做路由**：先把知识问答分发到固定 RAG Workflow；再用一次轻量 LLM 调用判断工具任务复杂度，简单任务走 ReAct，复杂任务走 Plan-and-Execute，避免不必要的规划开销。

用一句话概括：**ReAct 是走一步看一步的战术执行，Plan-and-Execute 是先画地图再上路的战略规划。两者不是替代关系，而是互补——简单任务用 ReAct 的灵活，复杂任务用 Plan-and-Execute 的全局视角**。

到这里，TinyAgent 有了两种决策模式。ReAct 和 Plan-and-Execute 都能动态调用工具，但它们复用的是单个工具能力，还没有把一套稳定的多步编排经验沉淀下来。如果比特严选的多个场景都反复出现“先查订单、必要时查物流、再判断退款”这类组合动作，每次都让 Planner 临时拆解和安排步骤，既浪费 Token，也增加不稳定性。下一篇，咱们把这种高频、稳定的编排逻辑封装成 Skill（技能），让 Agent 像学会了一个新本领一样，直接调用封装好的技能，不用每次都从零开始规划。

