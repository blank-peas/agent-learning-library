# why-memory

> **资料来源**：[AI Handbook](https://github.com/nageoffer/ai-handbook) · 原文件：`docs/agent/memory-and-context/10-why-memory.md`。

上一篇咱们给 ReAct 循环加上了四道终止防线——最大步数、重复调用检测、Token 预算、无进展检测——Agent 现在知道什么时候该停了。到这里，ReAct 核心部分算是告一段落：比特严选智能体有了完整的推理-行动循环、结构化的工具调用、以及稳健的终止保护。

但如果你真的拿现在的 TinyAgent 跑一个完整的客服会话，很快就会发现一个致命的问题。

用户先问了一句：

> 帮我查一下订单 88231 的物流到哪了。

Agent 正常工作：调 `queryOrder` 拿到运单号，调 `queryLogistics` 查到物流状态，回复“您的比特 S10 Pro 扫地机已到达杭州转运中心”。完美。

然后用户紧接着问了第二句：

> 那我要退款呢，这个扫地机不回充了。

这时候 Agent 懵了——“那”是哪个？“这个扫地机”是什么扫地机？退款退哪个订单？用户没说订单号，因为在他看来，上一句刚聊过订单 88231，Agent 应该知道。但 Agent 真的不知道。

打开 `ReActAgent.run()` 的代码看一眼，原因一目了然：

```java
public String run(String userMessage) {
    ArrayNode messages = objectMapper.createArrayNode();

    // 每次 run() 都重新创建消息列表——从零开始
    ObjectNode systemMsg = messages.addObject();
    systemMsg.put("role", "system");
    systemMsg.put("content", buildSystemPrompt());

    ObjectNode userMsg = messages.addObject();
    userMsg.put("role", "user");
    userMsg.put("content", userMessage);

    // ... 循环、调工具、返回结果
}
```

每次调 `run()`，消息列表都是全新的——只有 system 提示词和当前这句用户输入。上一轮对话里查过的订单号、工具返回的物流信息、Agent 给出的回复——全部丢失。对 Agent 来说，每次 `run()` 都是人生第一次见到用户。

这就像一个客服，每接一句话就失忆一次。用户说“我刚才跟你说的那个订单”，他只能反问“请问您说的是哪个订单？”——用户一定抓狂。

**这就是记忆问题。**

下面这张图直观展示了问题所在——左边是现在的失忆 Agent，右边是加上记忆后的效果：

![](https://oss.open8gu.com/iShot_2026-07-06_18.12.53.png)

> 本项目中具体代码已上传 GitHub [TinyAgent](https://github.com/nageoffer/tinyagent)，大家 Clone 项目后，将代码分支切换到 1.5.x，默认主分支是最新代码。运行前复制 `.env.example` 为 `.env`，把自己的 API Key 填进去，默认阿里云百炼平台；`.env` 已加入 `.gitignore`，切分支时不会丢。

### 记忆到底是什么

在 Agent 的语境里，记忆（Memory）说白了就一件事：**让 Agent 能利用过去的信息来处理当前的任务**。

这个定义很宽——上一轮对话的内容是记忆，三天前用户投诉过的工单也是记忆，某个工具返回过的商品规格数据还是记忆。它们的共同点是：不在当前输入里，但对当前任务有用。

为什么需要专门设计一个记忆模块？因为大模型本身并没有持久的记忆能力。

#### 1. 大模型的记忆只是上下文窗口

大模型看起来记得你说过什么，但它并不是真的在某个地方存储了你的话。它只是在处理当前请求时，能看到你发过来的所有消息——这些消息拼在一起，就是上下文窗口（Context Window）。

```text
你发给模型的消息列表：
  [system] 你是比特严选的智能客服...
  [user] 帮我查一下订单 88231 的物流
  [assistant] 好的，我来帮您查...（调工具）
  [tool] {"status":"运输中","location":"杭州转运中心"}
  [assistant] 您的扫地机已到达杭州转运中心...
  [user] 那我要退款呢                           ← 第二轮

模型能记住前面的内容，是因为这些消息都在同一个请求里。
```

模型看到了完整的消息列表，自然能理解“那”指的是订单 88231。但这不是记忆——这是**你的代码把历史消息一起发过去了**。如果你不发，模型就不知道。

换句话说：**大模型的记忆完全取决于你在 `messages` 数组里放了什么**。

#### 2. 上下文窗口不等于无限记忆

你可能会想，既然把历史消息都塞进 `messages` 就行，那还需要什么记忆模块？

问题在于上下文窗口是有限的。虽然主流模型（DeepSeek V4、Qwen3.7、GPT-5.5、Claude Opus 4.8）现在都支持 1M Token 的上下文窗口，但这不意味着你应该把所有历史消息无脑塞进去：

- **成本问题**：上一篇讲过，Agent 循环的 Token 消耗是二次增长的。如果还要叠加历史消息，成本增长更快。
- **注意力稀释**：上下文越长，模型对关键信息的注意力越分散。Anthropic 在文档里明确提到过 context rot——上下文越大，准确率和召回可能下降。
- **延迟问题**：输入 Token 越多，模型推理时间越长。电商智能体场景要求快速响应，用户不会等你处理 10 万 Token 的历史。

所以记忆模块要做的，不是简单地把所有历史消息塞进上下文，而是**有策略地管理哪些信息应该保留、哪些应该压缩、哪些应该丢弃**。

### Agent 需要哪几种记忆

如果把 Agent 类比成一个人类客服，他在工作中用到的记忆至少有三种：

#### 1. 对话记忆：刚才聊了什么

最基础也最直观的记忆——记住这个用户在这次会话里说过什么、Agent 回复过什么。

```text
用户第 1 句：帮我查一下订单 88231 的物流
Agent 回复：您的比特 S10 Pro 扫地机已到达杭州转运中心...
用户第 2 句：那我要退款呢
Agent 需要知道：用户说的是订单 88231，商品是扫地机
```

对话记忆解决的是**指代消解**问题——用户说“那个”“这个”“它”的时候，Agent 能知道指的是什么。没有对话记忆，多轮对话完全无法进行。

在技术上，对话记忆就是把之前轮次的 `user`、`assistant`、`tool` 消息保存下来，在下一轮调 API 时放进 `messages` 数组里。

#### 2. 任务记忆：做过什么、做到哪了

比对话记忆更高一层——不只是记住聊过什么，还要记住在这次任务中做过哪些动作、取得了什么中间结果。

还是退款的例子：

```text
第 1 圈：调 queryOrder 查到订单信息（价格 1999、已签收、签收日期 6.22）
第 2 圈：调 searchKnowledge 查到退货政策（7 天无理由、质量问题需检测）
第 3 圈：调 getCurrentTime 查到当前时间（7.1）
         → 判断签收已超 7 天，不适用无理由退货，走质量问题流程
第 4 圈：调 applyRefund 提交退款申请
```

这里面“已经查过订单信息了”“退货政策是 7 天”“签收已超 7 天”这些判断，就是任务记忆。如果任务中间被打断（比如模型 API 超时重试），Agent 需要知道自己做到哪一步了，而不是从头开始。

在目前的 ReAct 循环里，任务记忆其实已经隐含在消息列表中了——每圈的 assistant 消息和 tool 消息就是任务执行的轨迹。但这种记忆方式有个问题：它随着循环结束就消失了，下一次 `run()` 看不到。

#### 3. 工具结果记忆：查过的数据还记得吗

Agent 在执行任务的过程中会调用多个工具，每个工具都会返回一些数据。这些数据对当前任务有用，有时候对后续任务也有用。

```text
第一轮对话：
  queryOrder(88231) → {"product":"比特 S10 Pro 扫地机","price":1999,...}

第二轮对话：
  用户说“那我要退款呢”
  → Agent 如果还记得第一轮查过的订单数据，就不需要再调一次 queryOrder
  → 节省了一圈循环的 Token 消耗和 API 调用
```

工具结果记忆的价值在于**避免重复调用**。如果 Agent 能记住上一轮已经查过订单 88231 的信息，这一轮就可以直接用，不需要再花一圈循环去查。对于比特严选这种场景，同一个会话里用户围绕同一个订单反复提问是很常见的——查了物流、问退货、又问退款到账时间——每次都重新查订单是一种浪费。

> 工具结果记忆还有一个容易被忽略的好处：**一致性**。如果两轮对话之间订单数据发生了变化（比如物流更新了），Agent 用的是第一轮查到的旧数据还是重新查到的新数据？这取决于业务场景——有些场景需要实时性（物流状态），有些场景需要一致性（退款计算基于下单时的价格）。工具结果记忆让你有机会做出这个选择，而不是被动地每次都重新查。

用一张图把三种记忆的关系和各自的职责拎清楚：

![](https://oss.open8gu.com/iShot_2026-07-06_18.12.54.png)

### 短期记忆 vs 长期记忆

三种记忆还可以从另一个维度来分类——按生命周期分为短期记忆和长期记忆：

| 维度 | 短期记忆 | 长期记忆 |
|------|---------|---------|
| 生命周期 | 一次会话 / 一次任务 | 跨会话持久化 |
| 存储方式 | 内存（List / Map） | 数据库 / 文件 / 向量库 |
| 典型内容 | 当前对话历史、本次工具调用结果 | 用户偏好、历史工单、长期画像 |
| 信息密度 | 原始消息，相对冗余 | 经过压缩或摘要，信息密度高 |
| 比特严选场景 | 本次对话里查过的订单、聊过的内容 | 用户过去 30 天的退款记录、偏好品类 |

#### 1. 短期记忆：会话级别

短期记忆的范围是一次会话。用户打开客服窗口到关闭窗口，这段时间内的所有对话内容和工具调用结果，都属于短期记忆。

短期记忆解决的核心问题就是前面说的多轮对话——让 Agent 在同一次会话里能记住前面聊过什么。实现上很直接：用一个列表把每轮的消息存下来，下一轮调 API 时一起发过去。

对于比特严选当前的场景，**短期记忆是最优先要解决的**。一个连上一句话都记不住的客服，谈不上智能。

#### 2. 长期记忆：跨会话持久化

长期记忆的范围超出单次会话。比如：

- **用户画像**：用户 A 偏好智能家居产品，预算通常在 2000-3000 元——这些信息不是一次对话就能收集完的，需要跨多次会话积累。
- **历史工单**：用户上个月投诉过扫地机噪音大，这次又来咨询扫地机——如果 Agent 能知道这个历史，就能更有针对性地推荐。
- **操作记录**：用户在不同会话里退过哪些商品、问过哪些问题——这些信息对识别高风险用户（频繁退款）或提供个性化服务有用。

长期记忆需要持久化存储——数据库、文件系统、向量库都可以。它的实现比短期记忆复杂得多，涉及存什么、怎么存、怎么检索、怎么过期等一系列问题。

> 这一篇重点解决短期记忆。长期记忆会在后续文章中结合 RAG 检索一起讲——把 RAG 变成 Agent 的一个工具，用来检索长期记忆，这是第 12 篇的内容。

### 给 TinyAgent 加上短期记忆

目标很明确：让 Agent 在同一次会话的多轮对话中，能记住之前聊过的内容。

#### 1. 设计思路

核心思路很简单：**在 Agent 外部维护一个消息列表，每轮对话结束后把用户输入和 Agent 回复追加进去，下一轮调 API 时把这个列表里的历史消息一起发过去**。

```text
第一轮：
  messages = [system, user("查订单 88231")]
  → Agent 运行、调工具、回复
  → 记忆列表追加：user("查订单 88231") + assistant("您的扫地机已到达...")

第二轮：
  messages = [system, user("查订单 88231"), assistant("您的扫地机已到达..."), user("那我要退款呢")]
  → Agent 看到完整历史，知道“那”指的是订单 88231
```

关键设计决策：记忆应该放在 Agent 内部还是外部？

放内部的话，`ReActAgent` 自己持有一个消息列表，每次 `run()` 自动追加——实现简单，但 Agent 变成了有状态的，不能跨线程共享。

放外部的话，记忆模块独立于 Agent，通过接口注入——Agent 保持无状态（或者说状态由外部管理），更灵活，也更容易替换实现（比如从内存切换到 Redis）。

咱们选外部注入方案，定义一个 `ChatMemory` 接口。

#### 2. ChatMemory 接口

```java
public interface ChatMemory {

    void add(ChatMessage message);

    List<ChatMessage> messages();

    void clear();
}
```

三个方法，职责清晰：

- `add()`：追加一条消息。
- `messages()`：取出所有历史消息。
- `clear()`：清空记忆（会话结束时调用）。

`ChatMessage` 是消息的数据载体：

```java
public record ChatMessage(Role role, String content, String toolCallId) {

    public enum Role {
        SYSTEM, USER, ASSISTANT, TOOL
    }

    public static ChatMessage system(String content) {
        return new ChatMessage(Role.SYSTEM, content, null);
    }

    public static ChatMessage user(String content) {
        return new ChatMessage(Role.USER, content, null);
    }

    public static ChatMessage assistant(String content) {
        return new ChatMessage(Role.ASSISTANT, content, null);
    }

    public static ChatMessage tool(String toolCallId, String content) {
        return new ChatMessage(Role.TOOL, content, toolCallId);
    }
}
```

用 `record` 定义，不可变，四种角色对应 API 协议里的四种消息类型。`toolCallId` 只有 `TOOL` 角色的消息才用，其他角色传 `null`。

> 你可能注意到这里的 `ChatMessage` 没有存储 `tool_calls` 字段（assistant 消息发起工具调用时带的结构化信息）。这是有意为之——短期记忆只保存对话的自然语言轨迹（用户说了什么、Agent 回复了什么），不保存中间的工具调用细节。原因有两个：一是工具调用细节会大量增加记忆的 Token 占用；二是对于多轮对话的指代消解来说，知道 Agent 最终回复了什么就够了，不需要知道它中间调了哪些工具。

#### 3. InMemoryChatMemory 实现

最简单的实现——用一个 `ArrayList` 存消息：

```java
public class InMemoryChatMemory implements ChatMemory {

    private final List<ChatMessage> messages = new ArrayList<>();

    @Override
    public void add(ChatMessage message) {
        messages.add(message);
    }

    @Override
    public List<ChatMessage> messages() {
        return Collections.unmodifiableList(messages);
    }

    @Override
    public void clear() {
        messages.clear();
    }
}
```

`messages()` 返回不可修改的视图，防止外部代码意外修改记忆内容。

这个实现有一个明显的局限：**消息只增不减，没有容量控制**。如果用户在一次会话里聊了几十轮，历史消息会越来越长，最终可能撑爆 Token 预算。怎么解决？下一篇讲记忆压缩和摘要策略。

#### 4. 改造 ReActAgent

改动不大——构造函数加一个可选的 `ChatMemory` 参数，`run()` 方法里在构建消息列表时注入历史消息，在返回结果时追加到记忆。

构造函数增加 `ChatMemory` 参数：

```java
public class ReActAgent {

    private static final int DEFAULT_MAX_STEPS = 10;
    private static final int DEFAULT_MAX_TOKENS = 8000;

    private final LlmClient llmClient;
    private final ToolRegistry toolRegistry;
    private final ObjectMapper objectMapper;
    private final int maxSteps;
    private final int maxTokens;
    private final ChatMemory chatMemory;

    public ReActAgent(LlmClient llmClient, ToolRegistry toolRegistry) {
        this(llmClient, toolRegistry, DEFAULT_MAX_STEPS, DEFAULT_MAX_TOKENS, null);
    }

    public ReActAgent(LlmClient llmClient, ToolRegistry toolRegistry,
                      int maxSteps, int maxTokens) {
        this(llmClient, toolRegistry, maxSteps, maxTokens, null);
    }

    public ReActAgent(LlmClient llmClient, ToolRegistry toolRegistry,
                      int maxSteps, int maxTokens, ChatMemory chatMemory) {
        this.llmClient = llmClient;
        this.toolRegistry = toolRegistry;
        this.objectMapper = llmClient.getObjectMapper();
        this.maxSteps = maxSteps;
        this.maxTokens = maxTokens;
        this.chatMemory = chatMemory;
    }
}
```

三个构造函数保持向后兼容——前两个不传 `chatMemory`，默认 `null`，行为跟之前完全一致。

`run()` 方法的改动集中在两个地方：**构建消息列表时注入历史**和**返回结果时追加记忆**。

构建消息列表的逻辑：

```java
public String run(String userMessage) {
    ArrayNode messages = objectMapper.createArrayNode();

    String systemPrompt = buildSystemPrompt();
    ObjectNode systemMsg = messages.addObject();
    systemMsg.put("role", "system");
    systemMsg.put("content", systemPrompt);

    TokenBudget tokenBudget = new TokenBudget(maxTokens);
    tokenBudget.addMessage(systemPrompt);

    if (chatMemory != null) {
        // 先把当前用户消息追加到记忆
        chatMemory.add(ChatMessage.user(userMessage));
        // 把记忆中的所有历史消息注入 messages 数组
        for (ChatMessage mem : chatMemory.messages()) {
            ObjectNode memMsg = messages.addObject();
            switch (mem.role()) {
                case SYSTEM -> {
                    memMsg.put("role", "system");
                    memMsg.put("content", mem.content());
                }
                case USER -> {
                    memMsg.put("role", "user");
                    memMsg.put("content", mem.content());
                }
                case ASSISTANT -> {
                    memMsg.put("role", "assistant");
                    memMsg.put("content", mem.content());
                }
                case TOOL -> {
                    memMsg.put("role", "tool");
                    memMsg.put("tool_call_id", mem.toolCallId());
                    memMsg.put("content", mem.content());
                }
            }
            tokenBudget.addMessage(mem.content());
        }
    } else {
        // 没有记忆模块，行为跟之前一样
        ObjectNode userMsg = messages.addObject();
        userMsg.put("role", "user");
        userMsg.put("content", userMessage);
        tokenBudget.addMessage(userMessage);
    }

    // ... 后续循环逻辑不变
}
```

返回结果时追加到记忆：

```java
// 正常结束
if (!response.hasToolCalls()) {
    String answer = response.content() != null ? response.content() : "";
    System.out.println("[最终答复] " + answer);
    if (chatMemory != null) {
        chatMemory.add(ChatMessage.assistant(answer));
    }
    return answer;
}
```

每个返回点（正常结束、重复调用停止、无进展停止、最大步数停止）都要追加 assistant 消息到记忆。这样不管 Agent 以什么方式结束，下一轮对话都能看到这一轮的回复。

用下面的时序图看整个记忆注入流程：

![](https://oss.open8gu.com/iShot_2026-07-02_13.39.28.png)

#### 5. 系统提示词的小调整

加了记忆之后，系统提示词也要做一个小调整——告诉大脑注意对话上下文中的指代：

```java
private String buildSystemPrompt() {
    return """
            你是比特严选的智能客服助手，负责帮助用户解决商品咨询、\
            订单查询、物流追踪、退款换货等问题。
            请根据用户的问题，合理选择工具获取真实信息，\
            然后给出准确、友好的回复。

            注意事项：
            - 合理选择工具，每次调用后分析结果再决定下一步
            - 如果工具返回错误，分析原因并尝试换一种方式解决
            - 如果用户的问题超出工具能力范围，直接如实告知
            - 最终回复面向用户，不要暴露工具名、JSON 数据等内部细节
            - 避免重复调用相同的工具获取相同的信息
            - 注意对话上下文，用户可能会用代词（如“它”“那个”“这个订单”）引用之前提到的内容
            """;
}
```

最后一条是新增的。有了历史消息做上下文，大脑通常能自动理解指代关系，但显式提醒一下能提高准确率——尤其是在历史消息较长、指代关系不太明显的情况下。

#### 6. Demo 跑多轮对话

更新 `BitMallAgentDemo`，用同一个 `ChatMemory` 实例跑两轮对话：

```java
public static void main(String[] args) {
    ToolRegistry toolRegistry = new ToolRegistry();
    toolRegistry.register(new QueryOrderTool());
    toolRegistry.register(new QueryLogisticsTool());
    toolRegistry.register(new ApplyRefundTool());
    toolRegistry.register(new SearchKnowledgeTool());
    toolRegistry.register(new GetCurrentTimeTool());

    Properties dotEnv = loadDotEnv();
    LlmClient llmClient = new LlmClient(
            setting(dotEnv, "TINYAGENT_API_URL", "..."),
            requiredSetting(dotEnv, "TINYAGENT_API_KEY"),
            setting(dotEnv, "TINYAGENT_MODEL", "deepseek-v4-pro")
    );

    ChatMemory memory = new InMemoryChatMemory();
    ReActAgent agent = new ReActAgent(llmClient, toolRegistry, 10, 8000, memory);

    System.out.println("========== 第一轮对话 ==========");
    String answer1 = agent.run("帮我查一下订单 88231 的物流到哪了");
    System.out.println("\n[最终结果] " + answer1);

    System.out.println("\n\n========== 第二轮对话 ==========");
    String answer2 = agent.run("那我要退款呢，这个扫地机不回充了");
    System.out.println("\n[最终结果] " + answer2);
}
```

关键在于 `ChatMemory memory = new InMemoryChatMemory()` 这一行——两轮对话共享同一个记忆实例。第一轮的对话内容会被记忆保存，第二轮能看到。

预期的控制台输出：

```text
========== 第一轮对话 ==========

===== 第 1 圈 =====
[大脑] 好的，我先帮您查一下订单 88231 的详细信息，稍等～
[工具调用] queryOrder({"orderId": "88231"})
[工具结果] {"orderId":"88231","product":"比特 S10 Pro 扫地机...

===== 第 2 圈 =====
[大脑] 订单已查到，我再帮您查一下物流轨迹详情。
[工具调用] queryLogistics({"trackingNo": "SF1234567890"})
[工具结果] {"trackingNo":"SF1234567890","carrier":"顺丰速运...

===== 第 3 圈 =====
[最终答复] 您好！关于订单 **88231** 的物流情况，以下是详情：

......

您的快递已经在 **6月22日** 由本人签收啦！如果您没有收到包裹或有其他疑问，可以随时告诉我，我帮您进一步处理。

[最终结果] ......


========== 第二轮对话 ==========

===== 第 1 圈 =====
[大脑] 好的，这个扫地机无法回充确实很影响使用体验。我先帮您查一下相关的退货政策，同时为您发起退款申请。
[工具调用] searchKnowledge({"query": "扫地机 退货政策 退款条件"})
[工具结果] {"query":"扫地机 退货政策 退款条件","matched":"七天无理由退货政策...
[工具调用] applyRefund({"orderId": "88231", "reason": "质量问题：扫地机无法回充"})
[工具结果] {"success":true,"refundId":"RF20260629001...

===== 第 2 圈 =====
[大脑] 退款申请已提交成功！不过根据退货政策，我还需要确认一下时效。让我看看当前日期
[工具调用] getCurrentTime({})
[工具结果] {"currentTime":"2026-07-02T17:03:56"}

===== 第 3 圈 =====
[最终答复] 好的，退款申请已经为您提交了！以下是详细信息：

......

退款到账前，建议您保持商品外观和配件完整，以便后续可能的售后检测。还有其他需要帮您处理的吗？

[最终结果] ......
```

注意第二轮对话的第一个关键变化：**Agent 没有再调 `queryOrder`**。因为它从历史消息中已经知道订单 88231 是比特 S10 Pro 扫地机、价格 1999 元、已签收——这些信息在第一轮对话里已经查过了。Agent 直接跳到了查退货政策和提交退款，省了一圈循环。

第二个关键变化：**Agent 知道“那”指的是订单 88231**。用户没有在第二轮对话里提到任何订单号，但 Agent 从历史消息里读到了第一轮的对话内容，准确地理解了指代关系，并用正确的订单号调了 `applyRefund`。

这就是短期记忆的价值——**同一个会话里的信息可以跨轮次复用**。

### 记忆带来的新问题

加上记忆之后，多轮对话的问题解决了，但新的问题也来了。

#### 1. 记忆膨胀

现在的 `InMemoryChatMemory` 只追加、不删减。如果用户聊了 20 轮，每轮平均 500 Token（用户输入 + Agent 回复），光历史消息就有 10000 Token。加上 system 提示词和当前轮的工具调用，很容易突破 Token 预算。

更糟糕的是，大部分历史消息对当前任务可能没用。用户前 10 轮在问手机推荐，第 11 轮突然转到问扫地机退款——前 10 轮的手机推荐对话对退款任务毫无帮助，但它们占着 Token 预算，让 Agent 能做有用工作的空间变小了。

#### 2. 信息过载

即使 Token 预算够用，太长的历史消息也会影响 Agent 的决策质量。大脑看到 20 轮的历史对话，注意力被分散到了各种无关信息上——有些是关于手机推荐的、有些是关于物流查询的、有些是关于促销活动的——它需要从中找到跟当前退款任务相关的那几条信息。

这就像给一个客服递了一本 50 页的用户历史档案，然后让他在 5 秒内找到“上次退款是什么原因”——信息量越大，找到有用信息的难度越高。

#### 3. 跨会话的遗忘

`InMemoryChatMemory` 存在内存里，进程一重启就没了。用户今天咨询了扫地机不回充的问题，明天又来问“上次那个退款到了吗”——Agent 完全不记得有这回事。

对于比特严选的客服场景，这意味着用户每次打开客服窗口都要重新描述问题，之前的沟通记录全部作废。

> 正常企业中，会话记忆一般都存储在关系型数据库或者 Redis 缓存中，内存仅提供演示效果。

### 记忆的三种管理策略

针对上面的问题，业界有三种常见的记忆管理策略：

| 策略 | 原理 | 优点 | 缺点 | 适用场景 |
|------|------|------|------|---------|
| 滑动窗口 | 只保留最近 N 轮对话 | 实现简单，Token 可控 | 丢失早期信息，N 之前的上下文彻底消失 | 闲聊、简单问答 |
| 摘要压缩 | 把旧对话压缩成一段摘要 | Token 可控，保留关键信息 | 需要额外的 LLM 调用，摘要可能丢失细节 | 长对话、客服、诊断 |
| 混合策略 | 最近 N 轮保持原文 + 更早的做摘要 | 兼顾近期精确和远期概览 | 实现最复杂 | 生产环境推荐 |

用一张图直观对比三种策略处理 10 轮对话时的差异：

![](https://oss.open8gu.com/iShot_2026-07-06_18.12.55.png)

打个比方：滑动窗口就像只看最近几页聊天记录，翻过去的就不看了；摘要压缩就像把之前的聊天记录写成一段会议纪要；混合策略就像最近几页保持原文，更早的写成纪要——既能看到最近几句话的细节，又能知道之前大致聊了什么。

> 这三种策略的具体实现，包括怎么做摘要、怎么设滑动窗口大小、怎么混合使用，会在下一篇《手写 Agent 记忆模块》中详细展开并给出完整代码。

### 不同场景下的记忆选型

不同的业务场景对记忆的需求差异很大。以比特严选为例：

| 场景 | 记忆需求 | 建议方案 |
|------|---------|---------|
| 查订单 / 查物流 | 只需要当前轮次的信息 | 不需要记忆，或最多保留 1 轮 |
| 退款流程 | 需要知道是哪个订单、什么商品 | 短期记忆，保留最近 3-5 轮 |
| 故障诊断 | 需要记住已排除的步骤、已尝试的方案 | 短期记忆 + 任务记忆 |
| 跨品类推荐 | 需要记住用户的偏好、预算、已推荐的商品 | 短期记忆 + 长期记忆 |
| 老用户回访 | 需要知道历史购买记录、投诉记录 | 长期记忆（数据库 / 向量库） |

一个重要的原则：**记忆不是越多越好，而是越精准越好**。Agent 在做决策时，只需要跟当前任务相关的信息。无关的记忆不仅浪费 Token，还可能干扰决策——就像一个客服被塞了一堆跟当前问题无关的用户历史，反而不知道该从哪入手了。

### 文末总结

这一篇从一个多轮对话失败的场景切入，讲清楚了 Agent 为什么需要记忆：

- **根本原因**：大模型没有持久记忆，它的记忆完全取决于你在 `messages` 数组里放了什么。每次 `run()` 都重建消息列表，就等于让 Agent 每次都失忆。
- **三种记忆**：对话记忆（聊过什么）、任务记忆（做过什么）、工具结果记忆（查过什么数据）——对应多轮对话的指代消解、任务续接、避免重复调用。
- **短期 vs 长期**：短期记忆解决一次会话内的多轮连贯性，长期记忆解决跨会话的信息持久化。
- **最小实现**：通过 `ChatMemory` 接口和 `InMemoryChatMemory`，只改了 `ReActAgent` 的构造函数和消息构建逻辑，就让 Agent 具备了多轮对话能力。向后兼容，不传 `chatMemory` 则行为不变。
- **新问题**：记忆膨胀、信息过载、跨会话遗忘——这些问题需要更精细的记忆管理策略来解决。

用一句话概括：记忆是 Agent 从一问一答升级到持续对话的关键——没有记忆的 Agent 像个金鱼，每 7 秒就是一个全新的世界。

下一篇《手写 Agent 记忆模块》，咱们正式动手实现三种记忆管理策略——滑动窗口、摘要压缩、混合策略——并把它们集成到 TinyAgent 里，让记忆可控、可配、不爆预算。

