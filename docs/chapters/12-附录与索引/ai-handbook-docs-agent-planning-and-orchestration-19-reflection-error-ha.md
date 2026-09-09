# reflection-error-handling

> **资料来源**：[AI Handbook](https://github.com/nageoffer/ai-handbook) · 原文件：`docs/agent/planning-and-orchestration/19-reflection-error-handling.md`。

上一篇用跨品类场景验证了 TinyAgent 的组合编排能力——单任务用 Skill 保稳定，复合任务用 Plan-and-Execute 保完整。结尾留了一个悬念：如果 Agent 在执行过程中翻车了——工具返回错误、LLM 理解偏差、步骤结果不符预期——怎么办？回顾一下第 15 篇的 Re-plan 机制——当步骤执行抛出异常时，让 Planner 重新规划剩余步骤。这个机制只覆盖了“抛异常”这一种情况，还没有让 Agent 自己反思哪里做错了、结果够不够好。

这一篇，咱们给 TinyAgent 装上 Reflection（反思）机制——让 Agent 不只会执行，还能自我评估、自我纠错。

> 本项目中具体代码已上传 GitHub [TinyAgent](https://github.com/nageoffer/tinyagent)，大家 Clone 项目后，将代码分支切换到 1.13.x，默认主分支是最新代码。运行前复制 `.env.example` 为 `.env`，把自己的 API Key 填进去，默认阿里云百炼平台；`.env` 已加入 `.gitignore`，切分支时不会丢。

### Agent 翻车的三种姿势

在聊怎么修之前，先把问题分个类。比特严选智能体在执行过程中可能遇到的错误，大致分三种：

#### 1. 工具返回错误

这是最直接的一类——工具调用本身就报错了。

举个例子：用户说“帮我催一下快递，单号 SF0000000”，Agent 调 `queryLogistics("SF0000000")`，物流接口返回 `{"error":"运单号不存在：SF0000000"}`。原因可能是用户复制了错误的快递单号，也可能是商家已生成运单但物流公司尚未揽收。

这类错误的特征是**工具返回值里带明确的错误信息**，Agent 只要读懂错误就能做出合理的下一步——告知用户运单不存在，建议确认快递单号。

#### 2. 推理偏差

比直接报错更隐蔽的是推理偏差——工具调用成功了，结果也拿到了，但 LLM 在理解和总结时偏离了用户的真实意图。

举个例子：用户说“我家养了两只长毛猫，帮我在 R1 和 R7 Pro 两款扫地机里挑一个”，Agent 调 `compareProducts` 拿到了两款的完整规格参数，但在总结时做了全维度平铺对比（价格、吸力、续航……），没意识到对养猫用户来说，滚刷防不防缠绕才是决定性因素。工具没错，LLM 也确实做了对比，但**结果偏离了用户的真实处境**。这类偏差不报错、也不抛异常，是反思重点要盯的对象——不过它到底能不能被反思纠回来，还得看关键信息藏在哪，这点后面 Demo 会掰开讲。

#### 3. 多步任务中的连锁影响

在 Plan-and-Execute 模式下，一个步骤的失败可能影响后续步骤。

举个例子：用户说“帮我对比 AirX 耳机和 WatchFit 手表，顺便查一下订单 99999 到了没”。Planner 拆出三步：Step 1 对比耳机和手表（跨品类），Step 2 查订单，Step 3 综合回复。如果 Step 2 查不到订单，Step 3 在综合回复时需要知道这件事——否则它要么编造一个订单状态，要么干脆忽略这个子任务。

三种错误的共同点是：**光靠 `try-catch` 和简单重试解决不了**。工具错误需要判断是否值得重试（换个参数试试 vs 直接告知用户）；推理偏差根本不会抛异常；连锁影响需要全局视角来调整后续步骤。这就是反思机制要解决的问题。

![](https://oss.open8gu.com/iShot_2026-07-10_13.44.22.png)

| 错误类型 | 表现 | 现有机制 | 为什么不够 |
|---------|------|---------|---------|
| 工具返回错误 | 工具返回 error JSON | Re-plan 只在抛异常时触发 | 工具返回错误不一定抛异常，可能被当作“成功”处理 |
| 推理偏差 | 结果偏离用户意图 | 完全不检测 | 没有评估环节，步骤“完成”了就继续 |
| 连锁影响 | 后续步骤基于错误前提执行 | Re-plan 粗粒度处理 | 重规划时缺乏失败原因分析，容易重复犯错 |

### 现有的错误处理：够用但不够聪明

在加反思之前，先盘点一下 TinyAgent 已有的错误处理能力。

#### 1. ReAct 层面

ReAct 循环里已经有三道防线：

- **RepeatDetector**：检测连续两次调用相同工具、相同参数。第一次重复时注入提醒，第二次重复时强制终止。防的是死循环。
- **ProgressDetector**：检测连续多圈推理内容高度相似（Jaccard 相似度 > 0.7），一旦命中就终止循环。防的是 LLM 空转：每圈都在输出推理文本，看起来在思考，但内容反复雷同、没有实质推进。
- **最大步数**：`maxSteps` 兜底。不管什么原因，超过限定圈数就停。

这三道防线解决的是“Agent 卡住了怎么办”——检测到问题后机械地终止，不分析为什么卡住。

#### 2. Plan-and-Execute 层面

`PlanAndExecuteAgent` 有一个 Re-plan 机制。以下是简化后的核心逻辑——`planner` 是 `PlanAndExecuteAgent` 在构造时创建的字段，负责生成和调整执行计划：

```java
try {
    String result = executeStep(step, plan, tools);
    step.markCompleted(result);
} catch (Exception e) {
    step.markFailed(e.getMessage());
    if (replanCount < maxReplanCount) {
        plan = planner.replan(plan);
    }
}
```

这段代码的逻辑是：步骤执行抛异常 → 标记失败 → 让 Planner 重新规划剩余步骤。

问题在哪？两个：

**一是触发条件太窄**。只有 `executeStep` 抛异常才会触发 Re-plan。但很多错误不会以异常形式出现——工具返回 `{"error":"订单不存在"}` 时，`executeStep` 正常返回了一个字符串（LLM 把错误信息组织成了文本回复），`try-catch` 捕获不到。步骤被标记为 `COMPLETED`，但内容是一个错误描述。

**二是重规划缺乏上下文**。Re-plan 时，Planner 能看到哪些步骤完成了、哪些失败了，但不知道**为什么失败、应该怎么调整**。它只能基于步骤描述重新拆解，很可能生成一个跟之前差不多的计划——然后再次失败。

用一句话概括：**现有的错误处理是“检测到异常 → 机械应对”，缺少“分析结果质量 → 理解失败原因 → 调整策略”这个反思环节**。

### Reflection：让 Agent 学会反思

#### 1. 什么是 Reflection

Reflection（反思）的核心思想很简单：**在执行完一个步骤后，不急着往下走，先让另一个 LLM 调用来评估这一步的结果是否达成了目标。**

打个比方：你在装修房子，每刷完一面墙，不是直接刷下一面，而是退后两步看看——颜色均不均匀？有没有漏刷的角落？如果发现问题，现在补一下比等全部刷完再返工成本低得多。

落到 Agent 上，Reflection 就是在每个步骤执行完后插入一个评估环节：

```text
执行步骤 → 拿到结果 → 反思：结果达标吗？
                         ├── 达标 → 继续下一步
                         ├── 有偏差但可修 → 重试当前步骤（附带改进建议）
                         └── 无法修复 → 标记失败，触发重规划
```

#### 2. 三种反思结论

Reflector 评估完一个步骤的结果后，会给出三种结论之一：

| 结论 | 含义 | 后续动作 |
|------|------|---------|
| **PASS** | 结果充分满足步骤目标 | 标记完成，继续下一步 |
| **RETRY** | 结果有偏差，但可通过调整执行方式修正 | 将改进建议注入提示词，重试当前步骤 |
| **REPLAN** | 当前步骤遇到无法通过重试解决的问题 | 标记失败，带反思上下文触发重规划 |

三种结论对应三种不同的恢复策略——不是所有错误都需要重规划，也不是所有偏差都值得重试。Reflector 的价值就在于做这个判断。

#### 3. 有反思 vs 无反思的执行流程

先用一张图对比有反思和无反思的执行流程差异。左边是原来的逻辑——执行完直接标记完成；右边加入了反思环节——执行完先评估，不达标才触发恢复：

![](https://oss.open8gu.com/iShot_2026-07-10_13.44.23.png)

关键区别在于：无反思模式下，只要 `executeStep` 不抛异常，结果就被直接接受；有反思模式下，即使步骤“成功”了，Reflector 也会检查结果内容——工具返回的错误信息、偏离用户意图的回答，都能被识别出来。

### 手写 Reflector

#### 1. ReflectionResult：反思结果数据结构

先定义反思结果的数据结构。三个字段：结论（PASS/RETRY/REPLAN）、分析（为什么做出这个判断）、建议（如果需要重试或重规划，应该怎么调整）。

```java
public class ReflectionResult {

    public enum Verdict {
        PASS,       // 执行结果满足步骤目标，继续下一步
        RETRY,      // 执行结果有偏差，可通过重试修正
        REPLAN      // 当前步骤无法通过重试修复，需要调整后续计划
    }

    private final Verdict verdict;
    private final String analysis;
    private final String suggestion;

    public ReflectionResult(Verdict verdict, String analysis,
                            String suggestion) {
        this.verdict = verdict;
        this.analysis = analysis;
        this.suggestion = suggestion;
    }

    // getter ......
}
```

结构很简单，核心是 `Verdict` 枚举——三种结论对应三种恢复策略，不需要更多分类。`analysis` 是给日志看的，`suggestion` 是给重试时注入提示词用的。

#### 2. Reflector：反思器实现

Reflector 的工作就是：拿到一个步骤的目标描述、执行结果和用户原始需求，调一次 LLM 来评估结果质量，返回结构化的 `ReflectionResult`。

```java
public class Reflector {

    private final LlmClient llmClient;

    public Reflector(LlmClient llmClient) {
        this.llmClient = llmClient;
    }

    public ReflectionResult reflect(PlanStep step, String stepResult,
                                    String goal) {
        ObjectMapper objectMapper = llmClient.getObjectMapper();
        ArrayNode messages = objectMapper.createArrayNode();

        ObjectNode systemMsg = messages.addObject();
        systemMsg.put("role", "system");
        systemMsg.put("content", buildReflectionPrompt());

        ObjectNode userMsg = messages.addObject();
        userMsg.put("role", "user");
        userMsg.put("content", """
                用户原始需求：%s
                当前步骤目标：%s
                执行结果：%s
                """.formatted(goal, step.getDescription(), stepResult));

        ChatResponse response = llmClient.chatWithTools(
                messages, objectMapper.createArrayNode());

        return parseReflection(response.content());
    }

    // ......
}
```

`reflect` 方法接收三个输入：当前步骤（含目标描述）、步骤的执行结果、用户原始需求。这三个信息缺一不可——步骤目标告诉 Reflector 该达到什么标准，执行结果是被评估的对象，而用户原始需求提供了 Executor 拿不到的全局上下文。最后这点是反思能发挥作用的关键：Executor 执行非综合步骤时只看步骤目标（比如只写了 `对比两款扫地机的规格参数`），看不到完整需求；用户的真实处境（比如养了两只长毛猫）只藏在原始需求里。Reflector 握着这块 Executor 没有的上下文，才能判断执行结果有没有跑偏。

#### 3. 反思提示词设计

反思提示词是 Reflector 的灵魂——它决定了评估的准确度。

```java
private String buildReflectionPrompt() {
    return """
            你是一个执行质量评审员。请评估当前步骤的执行结果
            是否达成了步骤目标。

            请严格按照以下 JSON 格式输出，不要输出任何其他内容：
            {"verdict":"PASS 或 RETRY 或 REPLAN",
             "analysis":"一句话说明评估结论",
             "suggestion":"改进建议"}

            评估标准：
            - PASS：执行结果已充分满足步骤目标，信息完整且准确
            - RETRY：执行结果存在明显偏差，可通过调整执行方式修正。
              典型偏差包括：遗漏了用户关注的重点、回答过于笼统、
              只做了全维度罗列却没结合用户的使用场景给出针对性侧重、
              没给出明确推荐而是"各有优势看你偏好"这类和稀泥的结论
            - REPLAN：当前步骤遇到了无法通过重试解决的问题
              （如工具返回错误、所需数据不存在），需要调整后续计划

            注意：
            - 如果执行结果包含错误信息（如"未找到""不存在""error"），
              应判定为 REPLAN
            - 对综合回复类步骤（目标包含"综合""最终回复"），
              只要覆盖了已完成步骤的关键信息即可判定 PASS
            - 只输出 JSON，不要输出任何解释文字
            """;
}
```

提示词有几个设计要点：

**明确三级评估标准**。不同级别的问题对应不同的恢复成本——RETRY 只重跑当前步骤，REPLAN 要重新规划后续所有步骤。标准定得太宽松，工具错误被放过；定得太严格，每步都重试浪费 Token。

**RETRY 盯住推理偏差**。RETRY 的判据里特意点名了几种典型偏差：只做全维度罗列不结合场景、给个各有优势看你偏好的和稀泥结论。这类结果不报错、格式也齐全，但没真正回应用户的处境——反思要盯的正是这一类。判据写具体了，Reflector 才有明确的抓手，不至于把这种笼统结果误判成 PASS。

**特殊处理错误关键词**。提示词里特别指出，如果结果包含“未找到”“不存在”“error”等关键词，应该直接判 REPLAN。这条规则解决了前面提到的核心问题——工具返回错误但不抛异常的情况。

**对综合步骤放宽标准**。综合回复步骤（最后一步，toolHint 为 null）的评估标准相对宽松——只要覆盖了关键信息就行，不需要每个细节都完美。否则综合步骤会频繁触发 RETRY，得不偿失。

> 风险提示：仅靠未找到、不存在、`error` 等关键词匹配来判 REPLAN，在实际生产中容易误判——比如商品对比结果里出现“该型号不存在降噪功能”，这是正常信息，不是工具错误。更稳健的做法是让工具返回结构化的 status 字段（如 `"status":"error"`），Reflector 按 status 判断而非文本匹配。本篇的 Demo 工具已经用了 `"error"` 字段包裹错误信息，但提示词里的关键词规则仅作为兜底——如果你的工具返回格式不统一，需要根据实际情况调整这些规则。

#### 4. 解析反思结果

LLM 返回的是 JSON 文本，需要解析成 `ReflectionResult` 对象。解析逻辑跟 Planner 解析计划 JSON 一样——提取 JSON 子串，反序列化，异常时降级为 PASS（宁可放过也不要因为解析失败卡住流程）。

```java
private ReflectionResult parseReflection(String content) {
    ObjectMapper objectMapper = llmClient.getObjectMapper();
    try {
        String json = extractJson(content);
        JsonNode node = objectMapper.readTree(json);

        String verdictStr = node.path("verdict").asText("PASS");
        ReflectionResult.Verdict verdict = switch (verdictStr) {
            case "RETRY" -> ReflectionResult.Verdict.RETRY;
            case "REPLAN" -> ReflectionResult.Verdict.REPLAN;
            default -> ReflectionResult.Verdict.PASS;
        };

        String analysis = node.path("analysis").asText("");
        String suggestion = node.path("suggestion").asText("");

        return new ReflectionResult(verdict, analysis, suggestion);
    } catch (Exception e) {
        System.out.println("[Reflect] 反思结果解析失败，默认 PASS："
                + e.getMessage());
        return new ReflectionResult(
                ReflectionResult.Verdict.PASS, "解析失败，默认通过", "");
    }
}

private String extractJson(String text) {
    int start = text.indexOf('{');
    int end = text.lastIndexOf('}');
    if (start >= 0 && end > start) {
        return text.substring(start, end + 1);
    }
    throw new IllegalArgumentException("未找到 JSON 对象");
}
```

> 这里用了一个跟 Planner 相同的兜底策略：解析失败时返回 PASS 而不是抛异常。原因是 Reflector 本身是一个增强环节——即使反思失败了，也不应该阻断主流程。最坏情况就是退化为没有反思的原始行为。

### 集成到 PlanAndExecuteAgent

Reflector 写好了，现在把它接入 `PlanAndExecuteAgent` 的执行循环。

#### 1. 添加 Reflector 依赖

给 `PlanAndExecuteAgent` 新增一个构造函数，接受可选的 `Reflector`。不传就走原来的逻辑，传了就启用反思：

```java
public class PlanAndExecuteAgent {

    private static final int MAX_STEP_ROUNDS = 3;
    private static final int MAX_STEP_RETRY = 1;

    private final LlmClient llmClient;
    private final ToolRegistry toolRegistry;
    private final Planner planner;
    private final int maxReplanCount;
    private final Reflector reflector;

    // 兼容旧调用，不传 Reflector 就不启用反思
    public PlanAndExecuteAgent(LlmClient llmClient,
                               ToolRegistry toolRegistry,
                               int maxReplanCount) {
        this(llmClient, toolRegistry, maxReplanCount, null);
    }

    // 新构造函数，传入 Reflector 启用反思
    public PlanAndExecuteAgent(LlmClient llmClient,
                               ToolRegistry toolRegistry,
                               int maxReplanCount,
                               Reflector reflector) {
        this.llmClient = llmClient;
        this.toolRegistry = toolRegistry;
        this.planner = new Planner(llmClient, toolRegistry);
        this.maxReplanCount = maxReplanCount;
        this.reflector = reflector;
    }

    // ......
}
```

`MAX_STEP_RETRY = 1` 限制每个步骤最多重试一次。重试次数设太高会浪费 Token，设为 1 在实践中是个合理的平衡——大多数可修正的偏差，一次反思 + 一次重试就够了。

#### 2. 改造执行循环

核心改动在 `run()` 方法的步骤执行部分。原来是“执行 → 标记完成 / 标记失败”，现在变成“执行 → 反思 → 根据结论决定下一步”：

```java
while (!plan.isAllDone()) {
    PlanStep step = plan.nextPendingStep();
    if (step == null) break;

    step.setStatus(PlanStepStatus.EXECUTING);
    System.out.println("\n[Execute] ▶ Step " + step.getStepId()
            + ": " + step.getDescription());

    String reflectionHint = null;  // 反思建议，首次执行为空
    boolean stepDone = false;
    int stepRetry = 0;

    while (!stepDone) {
        try {
            String result = executeStep(
                    step, plan, tools, reflectionHint);

            if (reflector != null) {
                ReflectionResult reflection = reflector.reflect(
                        step, result, plan.getGoal());

                switch (reflection.getVerdict()) {
                    case PASS -> {
                        System.out.println("[Reflect] ✓ Step "
                                + step.getStepId() + " 通过");
                        step.markCompleted(result);
                        stepDone = true;
                    }
                    case RETRY -> {
                        if (stepRetry < MAX_STEP_RETRY) {
                            stepRetry++;
                            reflectionHint =
                                    reflection.getSuggestion();
                            System.out.println("[Reflect] ↻ Step "
                                    + step.getStepId() + " 第 "
                                    + stepRetry + " 次重试："
                                    + reflection.getAnalysis());
                        } else {
                            System.out.println("[Reflect] Step "
                                    + step.getStepId()
                                    + " 重试次数已达上限，"
                                    + "接受当前结果");
                            step.markCompleted(result);
                            stepDone = true;
                        }
                    }
                    case REPLAN -> {
                        System.out.println("[Reflect] ✗ Step "
                                + step.getStepId()
                                + " 需要重规划："
                                + reflection.getAnalysis());
                        step.markFailed(
                                reflection.getAnalysis());
                        stepDone = true;
                    }
                }
            } else {
                step.markCompleted(result);
                stepDone = true;
            }
        } catch (Exception e) {
            step.markFailed(e.getMessage());
            stepDone = true;
        }
    }

    // ...... 失败后的重规划逻辑
}
```

几个关键设计点：

**双层循环结构**。外层遍历 Plan 的步骤，内层是当前步骤的反思-重试循环。`reflectionHint` 在首次执行时为 null，重试时带上 Reflector 的改进建议。

**重试时注入反思建议**。`executeStep` 新增了 `reflectionHint` 参数。如果不为空，会被拼入步骤执行的 system prompt 里：

```java
String reflectLine = reflectionHint != null
        ? "上一次尝试的反思：" + reflectionHint
          + "\n请根据这个反思调整执行方式。\n"
        : "";
```

这样 Executor 在重试时就能看到“上次的问题是什么、这次该注意什么”，而不是盲目重跑一遍。

**Executor 全程步骤域**。这里藏着一个容易被忽略、但对反思至关重要的设计：`executeStep` 拼给 Executor 的上下文里，非综合步骤只喂步骤描述，综合步骤只喂已完成步骤的结果，Executor 全程不直接读用户的原始需求（`plan.getGoal()`）。原始需求只交给两个地方——Planner（拆步骤时）和 Reflector（评估时）。这不是偷懒，而是刻意让 Reflector 成为唯一把完整用户意图带回执行期的环节。为什么这么设计？这是反思能改变输出的结构前提：只有当问题必须对照完整 goal 才看得出来、而 goal-blind 的 Executor 结构上看不到时，才轮得到 Reflector 兜底。至于什么场景真能触发这种纠偏、什么场景其实用不上，Demo 那节会掰开讲。

**重试上限后接受现状**。如果重试次数达到 `MAX_STEP_RETRY` 但 Reflector 仍然判 RETRY，就接受当前结果继续走。避免在一个步骤上无限消耗 Token。

> 你可能会想：如果重试后还是 RETRY、重规划后新步骤还是 REPLAN，会不会陷入死循环？不会——代码里有两层兜底。`MAX_STEP_RETRY = 1` 限制每个步骤最多重试一次，超过就接受当前结果往下走；`maxReplanCount`（Demo 中设为 2）限制整个任务最多重规划两次，超过就跳过失败步骤直接进入综合回复。两个上限共同保证了最坏情况下的 LLM 调用次数有确定的上界，不会无限循环。

**REPLAN 时携带反思分析**。步骤被判 REPLAN 时，`markFailed(reflection.getAnalysis())` 把反思分析作为失败原因保存到步骤的 `result` 字段。后续 `planner.replan(plan)` 调用 `plan.getProgressSummary()` 时，这段分析会出现在失败步骤的描述里——Planner 重规划时就能看到“为什么失败、下一步该怎么调整”。

#### 3. 综合步骤的失败信息透传

还有一个细节需要处理：如果某个步骤失败了，最终的综合步骤需要知道这件事。原来的 `executeStep` 只把已完成步骤的结果传给综合步骤，失败步骤被忽略了——综合步骤无从得知某个子任务失败，自然也不会在回复里提及。

新增一个 `buildFailedContext` 方法，把失败步骤的信息也传给综合步骤：

```java
private String buildFailedContext(Plan plan) {
    StringBuilder sb = new StringBuilder();
    for (PlanStep s : plan.getSteps()) {
        if (s.getStatus() == PlanStepStatus.FAILED
                && s.getResult() != null) {
            sb.append("Step ").append(s.getStepId()).append("（")
                    .append(s.getDescription()).append("）失败原因：")
                    .append(s.getResult()).append("\n");
        }
    }
    return sb.toString();
}
```

在综合步骤的 system prompt 里，如果有失败步骤，就多加一段提示：

```java
if (isSynthesisStep) {
    String failedContext = buildFailedContext(plan);
    systemMsg.put("content", """
            你是比特严选的智能客服助手。
            请根据之前各步骤的执行结果，
            综合生成一段面向用户的完整回复。

            之前步骤的执行结果：
            %s
            %s
            """.formatted(completedContext,
            failedContext.isEmpty() ? ""
                    : "以下步骤执行失败，请在回复中如实告知用户：\n"
                      + failedContext));
}
```

这样综合步骤就能在回复里如实说明哪些子任务成功了、哪些失败了，而不是假装一切正常。（还有一个边界情况：如果前置步骤**全部**失败、没有任何成功结果，综合步骤会切到一个专门的提示词，直接据失败原因如实答复——否则模型对着空结果容易返回空串，反而要多绕一次重规划。）

### 完整反思流程

把上面的组件串起来，完整的反思流程如下：

![](https://oss.open8gu.com/iShot_2026-07-10_13.44.24.png)

整个流程中有三个关键的信息流转：

1. **执行结果 → Reflector**：Reflector 拿到步骤目标和执行结果，评估质量
2. **反思建议 → Executor**：重试时把 Reflector 的建议注入 Executor 的 system prompt
3. **反思分析 → Planner**：REPLAN 时把反思分析写入失败步骤的 result，Planner 重规划时能看到

### Demo：反思机制实战

前面把 Reflector 和三种结论都讲透了，也讲了 Executor 全程步骤域这个刻意的设计。这一节把反思真正跑起来，用一个会暴露空壳数据的查询，看它在轨迹里到底做了什么。

先把话说在前面：**比特严选这个 Demo 的业务场景足够简单，简单到未必能让反思的价值完全显现。** 这不是缺点——恰恰相反，把一个简单场景跑透、再讲清它在复杂业务里会变成什么样，比硬演一个漂亮的落差更有用。

#### 1. 一个会暴露空壳数据的查询

用户的提问很简单：

> 帮我查一下订单 99999 到了没。

订单 99999 不存在。但 `queryOrder` 对它并不报错，而是返回一个字段齐全、格式正常的空壳：

```json
{"orderId":"99999","status":"查询中","remark":"该订单信息正在同步，请稍后再试"}
```

这就是前面提过的、比显性报错更难缠的情况：数据没错、工具没抛异常、`status` 字段也在，但它压根没回答用户问的到了没。这种空壳在生产里太常见了——服务降级、最终一致性延迟、遗留系统返回一个占位对象而不是报错。`try-catch` 对它无能为力，因为根本没有异常可抓。

#### 2. 反思的执行轨迹

只需要在构造 Agent 时多传一个 `Reflector`：

```java
Reflector reflector = new Reflector(llmClient);
PlanAndExecuteAgent agent =
        new PlanAndExecuteAgent(llmClient, toolRegistry, 2, reflector);
String answer = agent.run("帮我查一下订单 99999 到了没");
```

实际执行轨迹（qwen-plus 实跑）：

```text
[Plan] 计划生成完成：
  ○ Step 1: 查询订单 99999 的详情，获取订单状态和签收信息
  ○ Step 2: 根据订单状态或签收时间判断是否已签收
  ○ Step 3: 综合以上结果，告知用户订单是否已到

[Execute] ▶ Step 1: 查询订单 99999 的详情，获取订单状态和签收信息
[工具调用] queryOrder({"orderId": "99999"})
[工具结果] {"orderId":"99999","status":"查询中",
  "remark":"该订单信息正在同步，请稍后再试"}
[Reflect] ✗ Step 1 需要重规划：执行结果未能获取订单状态和签收信息，
  数据尚在同步中，无法达成步骤目标。
[Replan] 第 1 次重新规划...
  ○ Step 4: 综合已有信息，告知用户订单 99999 查询失败、数据同步中、
    无法获取订单状态，建议稍后重试或联系客服

[Execute] ▶ Step 4: 综合已有信息，告知用户订单 99999 查询失败...
[Reflect] ↻ Step 4 第 1 次重试：执行结果未按步骤目标告知用户订单查询
  失败及建议，而是给出无关的通用回复，严重偏离目标。
[Reflect] ✓ Step 4 通过
[Execute] ✓ Step 4 完成

[最终结果] 您好，很抱歉，关于您的订单 99999，我们暂时未能查询到相关信息。
目前系统可能正在进行数据同步，导致订单状态未及时更新。建议您稍后重试，
或直接联系人工客服获取进一步帮助。
```

下面这张图把上面的文字轨迹画成流程，方便对照每个决策点发生了什么：

![](https://oss.open8gu.com/iShot_2026-07-10_13.44.25.png)

短短一条轨迹里，反思触发了两次不同级别的干预：

- **Step 1 判 REPLAN**：Reflector 拿步骤目标（获取订单状态和签收信息）去比对结果（只有一个 `查询中`），判定所需数据缺失、这一步没达成目标，把它交回 Planner。Planner 据此把剩余步骤压缩成一步——如实告知用户查询失败。注意，没有反思的话，这个 `查询中` 会被直接标记为 Step 1 完成，整个系统里不会留下任何这一步其实没拿到数据的痕迹。
- **Step 4 判 RETRY**：重规划出的新步骤第一次执行时，LLM 给了一段和订单无关的通用客套话，偏离了步骤目标。Reflector 抓住这个偏差，注入改进建议让它重试，第二次才对上。

> 你自己跑，未必和上面一字不差——REPLAN 把控制权交回了 Planner，Planner 重规划出几步、恢复步骤要不要再 RETRY 一次，都带随机性，LLM 调用次数也跟着浮动。但有一点每次都一样：`查询中` 这个空壳，每一次都在 Step 1 被反思判 REPLAN 拦下，没有一次被当成正常状态放过去。这也印证了后面第 5 节的规律——RETRY 走同一步、路径固定，REPLAN 交回 Planner、路径不定。

#### 3. 别被这个简单场景骗了：反思做了什么、没做什么

诚实地说：如果你把这个订单查询也跑一遍无反思版本，会发现最终回复跟上面几乎一样——都是得体地告诉用户信息还在同步、请稍后或联系客服。为什么？因为这个 mock 返回的空壳自带了 `请稍后再试` 这句免责声明，负责综合回复的那一步顺手把它转达出去，就已经答得不差了。

所以在这个简单场景里，反思**没有**让最终答案更漂亮。它做的是另一件事：

- 把 Step 1 这一步没拿到数据，从一次侥幸的蒙混，变成了一个显式、可检查、可恢复的状态（REPLAN）；
- 顺带逮住了 Step 4 那段跑题的回复（RETRY）。

一句话：**反思在这里不是让模型更聪明，而是让失败变成系统能看见、能兜住的一等状态。** 至于这份保障值不值多花的几次 LLM 调用，取决于你的业务有多复杂、失败有多隐蔽——简单查询里它像多余的开销，复杂业务里它可能就是唯一那道防线。

#### 4. 到了复杂业务场景，反思才真正兑现价值

那什么样的场景，反思能实打实地改变结果、而不只是记录失败？这背后有一条能推的规律。

Reflector 没有上帝视角，它没有 ground truth（拿不到标准答案）。它能拿到的只有步骤目标、执行结果、用户完整 goal 三样，所以它只抓得住两类问题——结果没达成目标、结果自相矛盾或明显残缺。它抓不住一个看起来合理的假答案：如果工具给 99999 编了个 `{"status":"已签收"}`，Reflector 没法知道这是假的。**反思能校验完整性，不能校验真实性。**

把这个信息分布画出来，就能看清反思发挥作用的边界——同一份 goal，到综合步骤手里和到 Reflector 手里，能看到的东西根本不是一回事：

![](https://oss.open8gu.com/iShot_2026-07-10_13.44.26.png)

顺着这条规律，就能分清哪些场景反思能改变输出、哪些不能：

| 业务场景 | 反思能否改变最终输出 | 为什么 |
|---------|------------------|------|
| 单工具查询、结果自带说明（本 Demo） | 基本不能 | 缺失信号在结果里就看得见，负责综合的步骤自己也会如实转达 |
| 硬约束只藏在原始需求里（预算上限、合规红线、用户明确排除的品牌） | 能 | 执行与综合步骤都是 goal-blind，看不到约束，只有 Reflector 握着完整 goal 能拦下越界的结果 |
| 多步长链条，某步结果没达成本步目标却不报错 | 能 | 不设卡就会把偏差喂给下游连锁放大；反思在每一步设了道关 |
| 结果对照步骤目标明显残缺（该给三项只给两项、该有签收时间却没有） | 能 | Reflector 按目标校验完整性，逼它补齐 |
| 看起来合理的假数据（伪造的已签收、过期缓存冒充实时） | 不能 | 反思没有 ground truth，校验不了真实性——这是它的能力边界 |

放到比特严选的真实业务里，中间那几行随处可见：跨品类搭配推荐时用户卡死了预算上限（第 18 篇那种复合任务），综合步骤只看到各商品规格、看不到预算，一不留神就推超了，得靠 Reflector 拿着原始需求拦下来；退款流程里先查订单、再查退货检测状态、最后决定能不能退，中间任何一步拿到看似正常实则不完整的结果，都会让最后的结论建立在错误前提上。**场景越简单、工具结果越自解释，反思越像多余的开销；场景越复杂、步骤越多、失败越隐蔽，反思越是那道兜底的防线。**

#### 5. Demo 代码

```java
public class ReflectionDemo {

    public static void main(String[] args) {
        ToolRegistry toolRegistry = new ToolRegistry();
        toolRegistry.register(new QueryOrderTool());
        // ...... 其余工具照常注册

        LlmClient llmClient = new LlmClient(/* 阿里云百炼 qwen-plus */);

        // 订单 99999 不存在，queryOrder 不报错，只返回一个 status 为"查询中"的空壳
        Reflector reflector = new Reflector(llmClient);
        PlanAndExecuteAgent agent =
                new PlanAndExecuteAgent(llmClient, toolRegistry, 2, reflector);
        String answer = agent.run("帮我查一下订单 99999 到了没");
        System.out.println("\n[最终结果] " + answer);
    }
}
```

> 想直观感受反思做了什么，可以把构造参数里的 `reflector` 去掉再跑一次——对这个简单查询，两次最终回复会很接近，但去掉反思后，Step 1 的 `查询中` 会被悄无声息地标记为完成，没有 REPLAN、也没有那道校验。差别不在这一句回复里，而在过程可不可控。

### Reflection 的成本与权衡

反思不是免费的——每个步骤多一次 LLM 调用。来算一笔账：

#### 1. Token 成本

| 执行方式 | LLM 调用次数 | 说明 |
|---------|------------|------|
| 无反思 | 1（规划）+ N（执行）| N 为步骤数 |
| 有反思（全部 PASS） | 1 + N + N | 每步多一次反思调用 |
| 有反思（1 次 RETRY） | 1 + N + N + 1（重试）+ 1（重试反思） | 重试步骤多两次调用 |
| 有反思（1 次 REPLAN） | 1 + N + N + 1（重规划）+ M（新步骤执行 + 反思） | M 为新步骤数 |

以本节的订单 Demo 为例。无反思时是一个 2 步计划（查询 + 综合），约 4 次调用：规划 1 次、查询这步的工具调用与结果总结 2 次、综合回复 1 次。有反思那次跑出来更热闹——Step 1 反思判 REPLAN、触发一次重规划，重规划出的 Step 4 又经历了一次 RETRY，一路数下来约 9 次 LLM 调用（具体次数随 Planner 每次拆几步而浮动）。

多出来的这几次，输入都很短（步骤目标 + 执行结果 + 反思提示词），每次大约消耗 300-500 Token，远少于执行步骤那种要带工具定义和历史的调用。所以实际 Token 增量，比调用次数的涨幅要小得多。换个角度看：无反思省下这几次调用，代价是 Step 1 没拿到数据这件事被悄悄咽了下去；有反思多花了点 Token，把它变成了一个显式、可恢复的失败。简单查询里这笔钱花得肉疼，复杂业务里——一步错、步步错的那种——它就是止损。

#### 2. 什么时候开反思

不是所有场景都需要反思。一张表帮你决定：

| 场景 | 是否建议开反思 | 理由 |
|------|-------------|------|
| 单步简单查询（查订单、查物流） | 否 | 工具调用结果明确，不太会出偏差 |
| 多步骤复合任务 | 是 | 步骤间有依赖，一步出错影响全局 |
| 涉及外部 API 调用（真实数据库） | 是 | 外部服务可能超时、返回异常，需要识别并恢复 |
| 面向用户的最终回复 | 可选 | 如果对回复质量要求高，给综合步骤加反思 |
| Demo / 本地测试 | 否 | 省 Token，出错了看日志手动调 |

#### 3. 优化方向

**选择性反思**。不是每步都反思，而是只对高风险步骤开反思。可以在 `PlanStep` 里加一个 `needsReflection` 标记，Planner 在规划时判断哪些步骤的结果不确定性高（比如涉及外部查询的步骤），标记为需要反思。

**轻量级规则反思**。并非所有反思都需要调 LLM。工具返回值里是否包含 `"error"` 字段、结果长度是否为零、关键字段是否缺失——这些可以用规则检查，命中了才调 LLM 做深度反思。减少不必要的 LLM 调用。

**共享反思上下文**。当前的 Reflector 每次调用都是独立的，不知道之前步骤的反思结果。如果把之前的反思链传入当前反思，Reflector 能做出更有全局视角的判断——比如“Step 1 已经偏了一点，Step 2 又偏了一点，综合起来偏差已经很大，建议 REPLAN”。

### Reflection 在 Agent 领域的位置

反思不是 TinyAgent 发明的概念——它在 Agent 研究领域有明确的理论基础。

#### 1. Reflexion 论文

2023 年的 Reflexion 论文提出了一个完整的反思框架：Agent 执行任务后，先用一个评估器（Evaluator）判断结果质量，再用一个反思器（Self-Reflection）分析失败原因并生成改进策略，最终把这些反思记录存入长期记忆，供下一次执行参考。

![](https://oss.open8gu.com/iShot_2026-07-10_13.44.27.png)

TinyAgent 的 Reflector 是这个思路的简化版——我们用一次 LLM 调用同时完成了评估和反思，没有独立的评估器；反思结论直接用于当前任务的重试或重规划，没有持久化到长期记忆。这些简化在客服场景下够用——客服任务是一次性的，不需要跨任务积累反思经验。

#### 2. ReAct + Reflection

反思也可以加在 ReAct 循环里，而不仅限于 Plan-and-Execute。思路是：每次工具调用后，在把 Observation 注入对话历史之前，先检查工具返回值的质量——如果发现问题，在 Observation 后面附加一段反思提示，引导 LLM 在下一圈的 Thought 里调整策略。

具体来说，在 `ReActAgent.run()` 的工具结果处理环节，可以加这样一层预处理：

```java
// ReActAgent.run() 中，工具调用拿到结果后、注入对话历史前
String observation = toolRegistry.execute(action);

// 用 Reflector 评估工具返回值
if (reflector != null) {
    ReflectionResult check = reflector.reflect(step, observation, userMessage);
    if (check.getVerdict() == ReflectionResult.Verdict.REPLAN) {
        observation += "\n[反思提示] 上一次工具调用返回了错误：" 
                + check.getAnalysis() + "。请换一种方式解决。";
    } else if (check.getVerdict() == ReflectionResult.Verdict.RETRY) {
        observation += "\n[反思提示] " + check.getSuggestion();
    }
}

// 将 observation 注入对话历史，进入下一圈 Thought → Action → Observation
```

这种方式不需要改 ReAct 的核心循环结构，只是在 Observation 注入的环节加一层预处理。LLM 在下一圈看到 `[反思提示]` 后，会自然地在 Thought 里分析问题并调整策略——比如换一个工具参数重试，或者直接告知用户工具调用失败。

#### 3. 反思与上下文工程的关系

第 14 篇讲上下文工程时提到，每个 Token 都要花在刀刃上。反思看起来会增加 Token 消耗，但从另一个角度看，它**减少了无效 Token 的浪费**——一个错误的步骤结果如果不被及时发现，后续步骤会基于错误前提继续执行，生成大量无效内容，最终还是要重来。及时反思、及时止损，总 Token 消耗反而可能更低。

### 文末总结

这一篇给 TinyAgent 装上了 Reflection（反思）机制：

- **三种翻车姿势**：工具返回错误（不抛异常但结果含错误信息）、推理偏差（LLM 理解偏离用户意图）、多步任务连锁影响（一步失败影响后续步骤）。现有的 `try-catch` + Re-plan 只覆盖了第一种的部分场景。
- **Reflector 实现**：一次 LLM 调用评估步骤结果质量，输出三种结论——PASS（继续）、RETRY（重试并注入改进建议）、REPLAN（标记失败并触发重规划）。反思提示词针对错误关键词和综合步骤做了特殊处理。
- **集成到执行循环**：`PlanAndExecuteAgent` 的步骤执行从“执行 → 标记完成”变为“执行 → 反思 → 根据结论决定下一步”。重试时把反思建议注入 Executor 的 system prompt，重规划时把反思分析传递给 Planner。综合步骤增加了失败信息透传。
- **成本权衡**：反思会增加 LLM 调用次数（Demo 中从约 4 次增加到约 9 次），但每次反思调用消耗的 Token 远少于执行步骤。它的价值不在于让简单查询的答案更漂亮，而在于把没达成目标的步骤变成显式、可恢复的失败——业务越复杂，这道关卡越值。可通过选择性反思、规则预检、共享反思上下文来优化。

用一句话概括：**反思是在“执行完”和“标记完成”之间加了一道质量关卡——不是所有“没报错”的结果都是好结果，让 Agent 自己看一眼再往下走**。

到这里，TinyAgent 从执行到纠错的能力链已经打通。但有一个能力一直没接上——RAG。前面的系列花了大量篇幅讲检索增强生成，而 Agent 系列的 `searchKnowledge` 工具只是一个返回硬编码文本的 Mock。下一篇，咱们把 RAG 真正接入 Agent——让检索变成 Agent 的一个工具，由智能体自主决定什么时候查知识库、查什么。

