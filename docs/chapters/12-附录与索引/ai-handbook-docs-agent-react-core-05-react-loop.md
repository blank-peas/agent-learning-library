# react-loop

> **资料来源**：[AI Handbook](https://github.com/nageoffer/ai-handbook) · 原文件：`docs/agent/react-core/05-react-loop.md`。

上一篇咱们把 ReAct 范式讲透了：推理和行动交替运转的 Thought-Action-Observation 三元组，用退款和查物流两个场景走了完整轨迹。最后那段 `agentRun` 骨架代码，你已经能看懂每一行对应三元组的哪个环节。

但那毕竟是骨架——`buildReActPrompt`、`parseAction`、`toolRegistry` 全是方法名，里面一行实现都没有。这一篇，咱们把骨架变成能跑的代码。

目标很明确：**用纯 Java + OkHttp，不依赖任何 Agent 框架，实现一个最小可运行的 ReAct Agent**。跑起来之后，你在 IDE 里打个断点，能一圈一圈看比特严选智能体怎么想、怎么干、怎么看结果再接着想。代码量不大，但跑通这一趟，ReAct 就不再是概念，而是你手里实实在在的工程能力。

> 这篇的目标是跑通，不是做到完美。工具定义、提示词打磨、输出解析、终止控制，分别在第 06 到 09 篇逐一深入。这里先用最简版把整个循环串起来。

> 本项目中具体代码已上传 GitHub [TinyAgent](https://github.com/nageoffer/tinyagent)，大家 Clone 项目后，将代码分支切换到 1.0.x，默认主分支是最新代码。运行前复制 `.env.example` 为 `.env`，把自己的 API Key 填进去，默认阿里云百炼平台；`.env` 已加入 `.gitignore`，切分支时不会丢。

### 搭积木前先看图纸

#### 1. 五个组件

要把 ReAct 循环跑起来，咱们一共需要五个组件：

| 组件 | 职责 | 一句话说清楚 |
|------|------|-------------|
| `Action` | 数据载体 | 记录一次工具调用的名称和参数 |
| `Tool` | 工具契约 | 每个工具实现这个接口，提供名称、描述和执行逻辑 |
| `ToolRegistry` | 工具注册表 | 管理所有工具，按名字查找并执行 |
| `LlmClient` | 大模型调用层 | 用 OkHttp 调 OpenAI 兼容 API，发消息、收回复 |
| `ReActAgent` | 主循环 | 串联以上所有，驱动 Thought-Action-Observation 循环 |

五个组件，自底向上组装：`Tool` 实现注册到 `ToolRegistry`，`ToolRegistry` 和 `LlmClient` 注入 `ReActAgent`，`ReActAgent` 对外暴露一个 `run(userMessage)` 方法——传入用户消息，返回最终答复。

下面这张图把组装关系画出来：

![](https://oss.open8gu.com/iShot_2026-06-26_10.42.45.png)

#### 2. 组装顺序

接下来按从底向上的顺序，逐个搭积木：

1. **工具层**：`Action`、`Tool`、`ToolRegistry`，再实现五个 Mock 工具
2. **大模型调用层**：`LlmClient`，用 OkHttp 调 API
3. **主循环**：`ReActAgent`，把所有组件串起来
4. **跑起来**：组装、执行、看效果

### 只要两个依赖

整个实现只用两个外部依赖：OkHttp 负责 HTTP 调用，Jackson 负责 JSON 序列化和解析。如果你用 Spring Boot，Jackson 已经自带了，只需额外加一个 OkHttp：

```xml
<dependency>
    <groupId>com.squareup.okhttp3</groupId>
    <artifactId>okhttp</artifactId>
    <version>4.12.0</version>
</dependency>
<dependency>
    <groupId>com.fasterxml.jackson.core</groupId>
    <artifactId>jackson-databind</artifactId>
</dependency>
```

如果不是 Spring Boot 项目，`jackson-databind` 需要显式写版本；Spring Boot 项目可以交给 parent 管理版本。

### 第一块积木：工具层

#### 1. Action 和 Tool

`Action` 是一个简单的数据载体，记录大脑决定调哪个工具、传什么参数：

```java
public record Action(String toolName, String toolInput) {
}
```

`Tool` 是工具的契约，每个工具实现三个方法——我叫什么、我能干什么、执行：

```java
public interface Tool {

    String name();

    String description();

    String invoke(String input);
}
```

#### 2. ToolRegistry

`ToolRegistry` 做两件事：管理工具的注册，以及根据 `Action` 找到对应工具并执行。

```java
public class ToolRegistry {

    private final Map<String, Tool> tools = new LinkedHashMap<>();

    public void register(Tool tool) {
        Objects.requireNonNull(tool, "tool must not be null");
        tools.put(tool.name(), tool);
    }

    public String execute(Action action) {
        if (action == null || action.toolName() == null || action.toolName().isBlank()) {
            return "{\"error\":\"未解析到可执行的工具名称\"}";
        }

        Tool tool = tools.get(action.toolName());
        if (tool == null) {
            return "{\"error\":\"未找到工具：" + action.toolName() + "\"}";
        }
        return tool.invoke(action.toolInput() == null ? "" : action.toolInput());
    }

    public String buildToolList() {
        StringBuilder sb = new StringBuilder();
        int index = 1;
        for (Tool tool : tools.values()) {
            sb.append(index++).append(". ")
              .append(tool.name())
              .append(" - ")
              .append(tool.description())
              .append("\n");
        }
        return sb.toString();
    }
}
```

`buildToolList()` 把所有工具的名称和描述拼成文本，后面要塞进提示词里告诉大脑手里有哪些牌可打。用 `LinkedHashMap` 而不是 `HashMap`，是为了让工具列表的顺序稳定——每次生成的提示词一模一样，大脑的表现才可预测。

注意 `execute()` 里对未知工具的处理：返回一个 JSON 错误信息而不是抛异常。因为大脑调错工具名是大模型的常见毛病，把错误信息作为 Observation 喂回去，大脑看到错误还有机会自我纠正。一旦抛异常，循环直接崩了，纠正的机会都没有。空 `Action`、空工具名和空入参也做了兜底，避免解析失败时直接触发空指针。

#### 3. 五个 Mock 工具

第三篇蓝图里定好了第一版的五个工具。这里用 Mock 数据来模拟业务系统——重点是跑通循环，不是对接真实后端。

**查询订单工具**——服务查订单、查物流（取运单号）、退款（取订单信息）等多个场景：

```java
public class QueryOrderTool implements Tool {

    @Override
    public String name() {
        return "queryOrder";
    }

    @Override
    public String description() {
        return "查询订单详情。输入：订单号（如 88231）。"
             + "返回：商品名、下单时间、签收时间、订单状态、运单号。";
    }

    @Override
    public String invoke(String input) {
        String orderId = input.trim();
        if ("88231".equals(orderId)) {
            return "{\"orderId\":\"88231\",\"product\":\"比特 S10 Pro 扫地机\","
                 + "\"price\":1999,\"orderTime\":\"2026-06-20\","
                 + "\"signTime\":\"2026-06-22\",\"status\":\"已签收\","
                 + "\"trackingNo\":\"SF1234567890\"}";
        }
        return "{\"error\":\"订单不存在：" + orderId + "\"}";
    }
}
```

**获取当前时间工具**——这个不是 Mock，而是真实的。大脑判断退货时限需要知道今天几号，但模型本身不知道当前日期，必须通过工具获取：

```java
public class GetCurrentTimeTool implements Tool {

    @Override
    public String name() {
        return "getCurrentTime";
    }

    @Override
    public String description() {
        return "获取当前日期时间。无需输入参数，返回当前时间的 JSON。";
    }

    @Override
    public String invoke(String input) {
        String now = LocalDateTime.now()
                .format(DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss"));
        return "{\"currentTime\":\"" + now + "\"}";
    }
}
```

**退款申请工具**——服务 T3（退款/换货），这是五个工具里唯一有副作用的——它会真的发起退款（Mock 里当然只是返回成功）：

```java
public class ApplyRefundTool implements Tool {

    @Override
    public String name() {
        return "applyRefund";
    }

    @Override
    public String description() {
        return "发起退款申请。输入：JSON 格式，包含 orderId（订单号）和 reason（退款原因）。"
             + "返回：申请结果，包含退款单号。";
    }

    @Override
    public String invoke(String input) {
        return "{\"success\":true,\"refundId\":\"RF20260629001\","
             + "\"message\":\"退款申请已提交，预计 1-3 个工作日到账\"}";
    }
}
```

另外两个工具——`QueryLogisticsTool`（查物流轨迹）和 `SearchKnowledgeTool`（检索知识库）——结构完全一致，只是 `name()`、`description()` 和 `invoke()` 的内容不同。这里不再展开，完整代码在仓库里。

> `SearchKnowledgeTool` 值得多说一句：它的 `invoke()` 里面跑的就是你在 RAG 系列写的那套检索链路——Embedding → 向量检索 → 重排序。只不过现在被包了一层 `Tool` 接口，大脑自己决定什么时候调。**从 RAG 到 Agent 的那条线，就在这个工具上接通了**。

工具层就绪，接下来搭大模型调用层。

### 第二块积木：大模型调用层

#### 1. LlmClient 的职责

`LlmClient` 只做一件事：接收一组消息（`messages`），发给大模型 API，返回大模型的回复文本。它不关心消息内容是什么、回复要怎么处理——那是 `ReActAgent` 的事。

#### 2. 完整实现

这里用 OpenAI 兼容的 Chat Completions 接口。国内的 DeepSeek、通义千问、智谱等主流大模型都兼容这个协议，换个 URL 和 API Key 就能跑：

```java
public class LlmClient {

    private static final MediaType JSON_MEDIA_TYPE
            = MediaType.get("application/json; charset=utf-8");

    private final OkHttpClient httpClient;
    private final ObjectMapper objectMapper;
    private final String apiUrl;
    private final String apiKey;
    private final String model;

    public LlmClient(String apiUrl, String apiKey, String model) {
        this.apiUrl = apiUrl;
        this.apiKey = apiKey;
        this.model = model;
        this.objectMapper = new ObjectMapper();
        this.httpClient = new OkHttpClient.Builder()
                .connectTimeout(30, TimeUnit.SECONDS)
                .readTimeout(120, TimeUnit.SECONDS)
                .build();
    }

    public String chat(List<Map<String, String>> messages) {
        try {
            ObjectNode requestBody = objectMapper.createObjectNode();
            requestBody.put("model", model);
            requestBody.put("temperature", 0.1);

            // 构建 messages 数组
            ArrayNode messagesArray = requestBody.putArray("messages");
            for (Map<String, String> msg : messages) {
                ObjectNode msgNode = messagesArray.addObject();
                msgNode.put("role", msg.get("role"));
                msgNode.put("content", msg.get("content"));
            }

            // stop 序列：让模型输出到 Action Input 就停下，别自己编 Observation
            ArrayNode stopArray = requestBody.putArray("stop");
            stopArray.add("Observation:");

            Request request = new Request.Builder()
                    .url(apiUrl)
                    .addHeader("Authorization", "Bearer " + apiKey)
                    .post(RequestBody.create(requestBody.toString(), JSON_MEDIA_TYPE))
                    .build();

            try (Response response = httpClient.newCall(request).execute()) {
                ResponseBody body = response.body();
                String responseText = body == null ? "" : body.string();
                if (!response.isSuccessful()) {
                    throw new RuntimeException("API 调用失败，状态码：" + response.code() + "，响应：" + responseText);
                }

                JsonNode responseJson = objectMapper.readTree(responseText);
                JsonNode contentNode = responseJson.at("/choices/0/message/content");
                if (contentNode.isMissingNode() || contentNode.isNull()) {
                    throw new RuntimeException("API 响应中缺少 choices[0].message.content：" + responseText);
                }
                return contentNode.asText();
            }
        } catch (IOException e) {
            throw new RuntimeException("调用大模型失败：" + e.getMessage(), e);
        }
    }
}
```

几个值得注意的点：

**`temperature` 设为 0.1**。ReAct 循环里大脑要按固定格式输出、要做逻辑判断，稳定性比创造性重要。温度越低，输出越确定。

**`stop` 序列是关键**。你可能好奇：为什么要加一个 `Observation:` 的停止序列？

回想一下 ReAct 的流程：大脑输出 Thought + Action + Action Input 之后，应该停下来，等你的代码去调工具、拿真实结果。但问题来了——大模型是自回归生成器，它的本能就是一个字一个字地往下写，写完 Action Input 之后它不会自己停下来。它在训练数据里见过太多"Action 后面跟 Observation"的模式，会顺手把 Observation 也编出来。

用退款场景走一遍你就明白了。假设没有 stop 序列，用户说"我想退订单 88231"，大脑可能会一口气输出这些：

```text
── 第 1 轮（模型自己编的） ──────────────────────────
Thought: 用户想退订单 88231，我需要先查订单详情。
Action: queryOrder
Action Input: 88231
Observation: {"orderId":"88231","product":"比特 S10 Pro 扫地机","price":1999,"status":"已签收"}
                                            ↑ queryOrder 根本没被调用，这条数据是编的

── 第 2 轮（还是模型自己编的） ──────────────────────────
Thought: 已查到订单，签收状态，可以申请退款。
Action: applyRefund
Action Input: {"orderId":"88231","reason":"用户主动申请退款"}
Observation: {"success":true,"refundId":"RF20260629001","message":"退款已提交"}
                                            ↑ applyRefund 也没被调用，退款根本没发生

── 直接给答案 ──────────────────────────────────
Thought: 退款已完成，可以回复用户了。
Final Answer: 您好，订单 88231 的退款已提交，退款单号 RF20260629001，预计 1-3 个工作日到账。
```

看起来流程很完整，对吧？但仔细想想——`queryOrder` 和 `applyRefund` 这两个工具**根本没有被真正调用过**。整段输出都是大脑一口气编出来的。那两行 Observation 里的数据不是工具返回的，是模型自己想象的。

更危险的是：模型跳过了 `getCurrentTime` 和 `searchKnowledge`，没有检查退货时限，没有查售后政策，直接就"退了"。在真实系统里，退款 API 根本没有被调用，但模型已经告诉用户"退款已提交"了——这就是幻觉变成了承诺。

**`stop` 序列就是解决这个问题的。** 要真正理解它，得先搞清楚大模型生成文本的底层机制。

大模型不是一次性吐出整段文本的，而是一个 Token 一个 Token 地往外蹦。你可以把它想象成一台打字机：打完一个字，才决定下一个字打什么。模型写完 `Action Input: 88231` 之后，下一个要打的字大概率就是 `Observation`——因为它在训练数据里见过无数次这个模式。

`stop` 参数不是提示词，模型看不到它。它是你在请求参数里传给 API 服务器的一道指令，相当于告诉服务器：

> "你帮我盯着这台打字机，一个字一个字地看。它一旦打出了 `Observation:` 这几个字，你立刻把打字机的电源拔了，然后把 `Observation:` 这几个字也扔掉，只把前面已经打好的内容给我。"

关键点在这：**API 返回给你的内容里，连 `Observation:` 本身都没有。** 不是返回了再让你删，而是在返回之前就被吞掉了。你的代码收到的是干干净净的三行——Thought、Action、Action Input，后面什么都没有。

用退款场景走一圈你就彻底明白了。加上 `stop: ["Observation:"]` 后：

**第 1 圈**，你的代码把消息列表发给 API。模型这台打字机开始一个字一个字地打：`T`、`h`、`o`、`u`、`g`、`h`、`t`、`:`……一路打到 `Action Input: 88231`，接着它要打 `O`、`b`、`s`、`e`、`r`、`v`、`a`、`t`、`i`、`o`、`n`、`:`——API 检测到了 stop 关键词，拔电源，吞掉 `Observation:`，把前面的内容返回。你的代码收到的就是这些：

```text
Thought: 用户想退订单 88231，我需要先查订单详情。
Action: queryOrder
Action Input: 88231
（到这里就没了，干干净净，没有 Observation）
```

然后你的代码接管。`parseAction` 从这三行里提取出工具名 `queryOrder` 和参数 `88231`。`toolRegistry.execute()` 调用真实的 `QueryOrderTool`，拿到真实的订单数据。你的代码自己拼一条消息 `"Observation: {真实数据}"` 追加到消息列表，开始第 2 圈。

**第 2 圈**，模型看到上一圈的真实订单数据，发现签收时间是 6 月 22 日，想判断退货时限。它继续打字：

```text
Thought: 已查到订单，签收 6 月 22 日。需要知道今天日期来判断是否在退货期内。
Action: getCurrentTime
Action Input:
（又到这里就没了——API 再次截断）
```

你的代码再次接管，调用真实的 `getCurrentTimeTool`，拿回真实的当前时间，追加到消息列表。

**第 3 圈**、**第 4 圈**同理——每一圈模型都在该停的地方被截断，每一次 Observation 都是你的代码调用真实工具后自己拼上去的。

**第 5 圈**，模型认为信息收集完毕，开始打：

```text
Thought: 订单信息、当前时间、售后政策、退款结果都齐了，可以回复用户。
Final Answer: 您好，您的退款已提交……
```

这一圈它输出的是 `Final Answer:`，自始至终没有打出 `Observation:` 这几个字，stop 序列不会触发，模型正常输出完整答复，你的代码完整地收到这段文本。

下面这张对比图把两种情况放在一起看——左边是没有 stop 序列时大脑自说自话、工具从未被调用的情况，右边是加了 stop 序列后每一圈都被及时截断、交给真实工具执行的正确流程：

![](https://oss.open8gu.com/iShot_2026-07-06_18.12.38.png)

**`readTimeout` 设为 120 秒**。大模型推理需要时间，尤其是第一圈要消化整段系统提示词，默认的 10 秒超时大概率不够。

大模型调用层搞定，最后把主循环串起来。

### 第三块积木：ReActAgent 主循环

所有零件到齐，现在把它们组装成循环。

#### 1. 消息列表驱动

上一篇的骨架用的是字符串拼接的 `trace` 列表，每次把整条轨迹拼成一个大字符串发给模型。这种方式简单但粗糙——整段对话被塞进一个 `user` 消息里，模型分不清哪些是用户说的、哪些是大脑自己想的、哪些是工具返回的。

实际调 Chat API 时，更好的做法是用消息列表：每一条消息有明确的 `role`，大脑的输出是 `assistant`，工具结果包在 `user` 角色里追加回去。模型天然能区分不同来源的信息。

```text
messages[0] = {role: "system",    content: 系统提示词（身份+工具列表+格式要求）}
messages[1] = {role: "user",      content: 用户的原始消息}
messages[2] = {role: "assistant", content: 第一圈的 Thought + Action + Action Input}
messages[3] = {role: "user",      content: "Observation: {工具返回结果}"}
messages[4] = {role: "assistant", content: 第二圈的 Thought + Action + Action Input}
messages[5] = {role: "user",      content: "Observation: {工具返回结果}"}
...
```

每转一圈，消息列表就多两条：一条 `assistant`（大脑的思考和行动），一条 `user`（工具返回的观测结果）。模型每次被调用时，都能看到从头到尾的完整轨迹，知道已经走到哪一步了。

下面这张图把消息列表的增长过程画出来，一圈一圈看得很清楚：

![](https://oss.open8gu.com/iShot_2026-07-06_18.12.37.png)

#### 2. 系统提示词

系统提示词告诉大脑三件事：你是谁、手里有什么工具、按什么格式输出。

```java
private String buildSystemPrompt() {
    return """
            你是比特严选的智能客服助手。你可以使用以下工具来帮助用户解决问题。

            工具列表：
            %s
            请严格按照以下格式思考和行动：

            Thought: <你的思考过程，分析当前局面，决定下一步做什么>
            Action: <要调用的工具名，必须是工具列表中的一个>
            Action Input: <传给工具的参数>

            工具执行后你会收到 Observation（工具返回的结果），然后继续下一轮思考。
            重复上述过程，直到你收集到足够的信息来回答用户。

            当你准备好给出最终答案时，使用以下格式：

            Thought: <总结已有信息，说明为什么可以回答了>
            Final Answer: <给用户的最终回复>

            注意：
            - 每次只调用一个工具
            - 必须先 Thought 再 Action，不要跳过思考步骤
            - Action 必须是工具列表中存在的工具名，不要编造工具
            """.formatted(toolRegistry.buildToolList());
}
```

这段提示词是够用但不完美的最小版。怎么加 Few-shot 示例让大脑更稳定、怎么处理边界情况、怎么防止格式跑偏——这些打磨技巧放在第 07 篇《ReAct 提示词设计》里专门讲。

#### 3. 解析模型输出

大脑按格式输出的文本长这样：

```text
Thought: 用户想退订单 88231 的扫地机，我需要先查订单详情。
Action: queryOrder
Action Input: 88231
```

咱们要从里面提取出工具名（`queryOrder`）和参数（`88231`），组装成一个 `Action` 对象。最小版用逐行扫描就够了：

```java
private Action parseAction(String llmOutput) {
    String toolName = "";
    String toolInput = "";

    for (String line : llmOutput.split("\n")) {
        String trimmed = line.trim();
        if (trimmed.startsWith("Action Input:")) {
            toolInput = trimmed.substring("Action Input:".length()).trim();
        } else if (trimmed.startsWith("Action:")) {
            toolName = trimmed.substring("Action:".length()).trim();
        }
    }
    return new Action(toolName, toolInput);
}
```

注意扫描顺序：先判断 `Action Input:` 再判断 `Action:`。因为 `Action Input:` 以 `Action:` 开头，如果反过来先判断 `Action:`，`Action Input: 88231` 这一行也会被误匹配，工具名会变成 `Input: 88231`——一个典型的前缀歧义 bug。另外，当前实现取的是最后一次匹配，如果大脑在 Thought 里也写了 `Action:` 这个词，同样会被误提取——不过别急着修，第 08 篇咱们会用 Function Calling 彻底替掉文本解析，这些问题自然就不存在了。

这个解析器能跑，但很脆弱。大模型输出稍有偏差——多了个空行、换了个冒号格式、把 `Action:` 写成 `action:`——就可能解析失败。与其在正则上缝缝补补，不如换个思路：第 08 篇咱们引入 Function Calling，让模型直接返回结构化的工具调用，彻底告别文本解析。

提取 `Final Answer` 就更简单了：

```java
private String extractFinalAnswer(String llmOutput) {
    int index = llmOutput.indexOf("Final Answer:");
    if (index >= 0) {
        return llmOutput.substring(index + "Final Answer:".length()).trim();
    }
    return llmOutput;
}
```

#### 4. run() 方法：完整的主循环

所有零件到齐，`run()` 方法把它们串成循环。先看流程图抓住整体脉络，再看代码就不会迷路：

![](https://oss.open8gu.com/iShot_2026-07-06_18.12.39.png)

代码实现如下：

```java
public class ReActAgent {

    private static final int MAX_STEPS = 10;

    private final LlmClient llmClient;
    private final ToolRegistry toolRegistry;

    public ReActAgent(LlmClient llmClient, ToolRegistry toolRegistry) {
        this.llmClient = llmClient;
        this.toolRegistry = toolRegistry;
    }

    public String run(String userMessage) {
        List<Map<String, String>> messages = new ArrayList<>();
        messages.add(Map.of("role", "system", "content", buildSystemPrompt()));
        messages.add(Map.of("role", "user", "content", userMessage));

        for (int step = 1; step <= MAX_STEPS; step++) {
            System.out.println("\n===== 第 " + step + " 圈 =====");

            String llmOutput = llmClient.chat(messages);

            int finalAnswerIndex = llmOutput.indexOf("Final Answer:");
            if (finalAnswerIndex >= 0) {
                String thought = llmOutput.substring(0, finalAnswerIndex).trim();
                if (!thought.isBlank()) {
                    System.out.println("[大脑] " + thought);
                }
                String answer = extractFinalAnswer(llmOutput);
                System.out.println("[最终答复] " + answer);
                return answer;
            }

            System.out.println("[大脑] " + llmOutput);

            messages.add(Map.of("role", "assistant", "content", llmOutput));

            Action action = parseAction(llmOutput);
            if (action.toolName().isBlank()) {
                String answer = llmOutput.trim();
                System.out.println("[最终答复-兜底] " + answer);
                return answer;
            }

            System.out.println("[工具调用] " + action.toolName() + "(" + action.toolInput() + ")");

            String observation = toolRegistry.execute(action);
            System.out.println("[工具结果] " + observation);

            messages.add(Map.of("role", "user", "content", "Observation: " + observation));
        }

        return "抱歉，我思考了太多步仍未完成任务，请尝试换一种方式描述您的问题。";
    }

    private String buildSystemPrompt() {
        return """
                你是比特严选的智能客服助手。你可以使用以下工具来帮助用户解决问题。

                工具列表：
                %s
                请严格按照以下格式思考和行动：

                Thought: <你的思考过程，分析当前局面，决定下一步做什么>
                Action: <要调用的工具名，必须是工具列表中的一个>
                Action Input: <传给工具的参数>

                工具执行后你会收到 Observation（工具返回的结果），然后继续下一轮思考。
                重复上述过程，直到你收集到足够的信息来回答用户。

                当你准备好给出最终答案时，使用以下格式：

                Thought: <总结已有信息，说明为什么可以回答了>
                Final Answer: <给用户的最终回复>

                注意：
                - 每次只调用一个工具
                - 必须先 Thought 再 Action，不要跳过思考步骤
                - Action 必须是工具列表中存在的工具名，不要编造工具
                """.formatted(toolRegistry.buildToolList());
    }
  
    // 省略 parseAction、extractFinalAnswer 方法...
}
```

对照上一篇的三元组，循环的每一步都对得上号：

| ReAct 三元组 | 对应代码 | 做了什么 |
|-------------|---------|---------|
| Thought + Action | `llmClient.chat(messages)` | 大脑看完整条轨迹，输出推理和要调的工具 |
| 判断终止 | `llmOutput.contains("Final Answer:")` | 大脑说够了就停 |
| 兜底终止 | `action.toolName().isBlank()` | 大脑没走格式但也没调工具，直接把清理后的输出当答复返回 |
| Action 执行 | `toolRegistry.execute(action)` | 调用真实工具，拿回真实数据 |
| Observation | `messages.add(...)` | 工具结果追加到消息列表，等大脑下一圈来看 |
| 循环 | `for (int step = 1; step <= MAX_STEPS; step++)` | 最多转 10 圈，防止死循环 |

表格里多了一行“兜底终止”，值得单独说一下。提示词虽然要求大脑用 `Final Answer:` 格式收尾，但实际跑起来你会发现——不是所有模型都会乖乖照做。有些模型（尤其是轻量级或对指令跟随不够强的）在认为任务完成时，会直接输出一段完整答复，既不带 `Final Answer:` 前缀，也不调任何工具。如果没有兜底检查，`parseAction` 会解析出空工具名，`execute` 返回错误，这个错误作为 Observation 喂回去，大脑再试……一直空转到 `MAX_STEPS` 才停。所以加了一个简单判断：解析出来工具名为空或全是空白，说明大脑这一圈既没调工具也没走 `Final Answer:` 格式，直接把清理后的输出当最终答复返回。

#### 5. 时序图：一次退款循环的完整调用链

用时序图把退款场景（T3）的多圈循环画出来，看看各组件之间怎么配合：

![](https://oss.open8gu.com/iShot_2026-06-26_10.42.47.png)

### 组装并跑起来

#### 1. 入口代码

五个组件各自就位，最后一步是把它们装在一起跑。先在项目根目录准备一个 `.env` 文件：

```dotenv
TINYAGENT_API_URL=https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions
TINYAGENT_API_KEY=your-api-key
TINYAGENT_MODEL=deepseek-v4-pro
```

然后入口代码读取这个文件，组装 Agent：

```java
import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Properties;

public class BitMallAgentDemo {

    public static void main(String[] args) {
        // 1. 注册工具
        ToolRegistry toolRegistry = new ToolRegistry();
        toolRegistry.register(new QueryOrderTool());
        toolRegistry.register(new QueryLogisticsTool());
        toolRegistry.register(new ApplyRefundTool());
        toolRegistry.register(new SearchKnowledgeTool());
        toolRegistry.register(new GetCurrentTimeTool());

        // 2. 初始化大模型客户端（以阿里百炼兼容模式为例，换成其他兼容 API 只改 .env）
        Properties dotEnv = loadDotEnv();
        LlmClient llmClient = new LlmClient(
                setting(dotEnv, "TINYAGENT_API_URL", "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions"),
                requiredSetting(dotEnv, "TINYAGENT_API_KEY"),
                setting(dotEnv, "TINYAGENT_MODEL", "deepseek-v4-pro")
        );

        // 3. 组装 Agent
        ReActAgent agent = new ReActAgent(llmClient, toolRegistry);
        String userMessage = "我上周买的扫地机不回充了，修不好我想退。订单号 88231。";

        // 4. 跑一个退款场景
        String answer = agent.run(userMessage);

        System.out.println("\n========== 最终结果 ==========");
        System.out.println(answer);
    }

    private static Properties loadDotEnv() {
        Properties properties = new Properties();
        Path path = Path.of(".env");
        if (!Files.exists(path)) {
            return properties;
        }

        try (InputStream input = Files.newInputStream(path)) {
            properties.load(input);
            return properties;
        } catch (IOException e) {
            throw new IllegalStateException("读取 .env 文件失败：" + path.toAbsolutePath(), e);
        }
    }

    // 省略 requiredSetting、setting 方法，较简单...
}
```

核心代码还是四步：注册工具、创建客户端、组装 Agent、调用 `run()`。`.env` 只按最简单的 `KEY=VALUE` 读取，API Key 不再硬编码在源码里；这个文件不提交到 Git，所以切分支也不用反复改代码。

#### 2. 退款场景的完整输出

运行 `BitMallAgentDemo`，控制台输出大致如下（大模型的措辞每次会有细微差异，但逻辑一致）：

```text
===== 第 1 圈 =====
[大脑] Thought: 用户提供了订单号 88231，需要先查询订单详情，了解商品信息、下单时间、签收时间、当前状态等，以便判断是否符合退货条件。
Action: queryOrder
Action Input: 88231
[工具调用] queryOrder(88231)
[工具结果] {"orderId":"88231","product":"比特 S10 Pro 扫地机","price":1999,"orderTime":"2026-06-20","signTime":"2026-06-22","status":"已签收","trackingNo":"SF1234567890"}

===== 第 2 圈 =====
[大脑] Thought: 已获取订单详情，商品是比特 S10 Pro 扫地机，签收时间是6月22日。用户说"上周买的"，需要确认当前日期，判断是否在7天无理由退货或15天质量问题换货期内。同时可以查一下售后知识库关于退货政策。
Action: getCurrentTime
Action Input: 
[工具调用] getCurrentTime()
[工具结果] {"currentTime":"2026-06-30T19:05:23"}

===== 第 3 圈 =====
[大脑] 现在时间是6月30日，签收6月22日，已过8天。需要查看售后政策，看质量问题退货的规定。同时用户说"修不好"暗示可能已经联系过维修，我来查一下售后知识库。
Action: searchKnowledge
Action Input: 扫地机 不回充 退货 政策
[工具调用] searchKnowledge(扫地机 不回充 退货 政策)
[工具结果] {"matched":"七天无理由退货政策","content":"签收次日起 7 天内，商品外观和主要配件完整，可申请退货；质量问题需先进行售后检测。"}

===== 第 4 圈 =====
[大脑] Thought: 签收已超7天，但用户反馈的是质量问题（不回充），且表示"修不好"。知识库说质量问题需售后检测，但用户可能已经尝试过维修。现在我可以帮用户直接发起退款申请，理由是质量问题。让我用 applyRefund 工具提交退款申请。
Action: applyRefund
Action Input: {"orderId":"88231","reason":"质量问题：扫地机不回充，已尝试维修但修不好"}
[工具调用] applyRefund({"orderId":"88231","reason":"质量问题：扫地机不回充，已尝试维修但修不好"})
[工具结果] {"success":true,"refundId":"RF20260629001","message":"退款申请已提交，预计 1-3 个工作日到账"}

===== 第 5 圈 =====
[大脑] Thought: 已获取所有必要信息：订单详情、当前时间、售后政策，并成功提交退款申请。现在可以给用户一个完整的答复。
[最终答复] 您好，已为您查询并处理完毕，以下是详情：

📋 **订单信息**
- 订单号：**88231**
- 商品：**比特 S10 Pro 扫地机**（¥1999.00）
- 下单时间：2026年6月20日
- 签收时间：2026年6月22日
- 物流单号：SF1234567890

🔧 **退款申请已提交**
- 退款原因：质量问题（扫地机不回充，维修无效）
- 退款单号：**RF20260629001**
- 预计 **1-3 个工作日** 到账，届时款项将退回您的原支付方式。

⚠️ 温馨提示：虽然签收已超过7天无理由退货期，但您的扫地机属于质量问题，已成功提交退款申请。如有需要，您也可以凭运单号 **SF1234567890** 查询物流信息，方便后续退货寄回。如有其他问题，随时联系我！

========== 最终结果 ==========
您好，已为您查询并处理完毕，以下是详情：

📋 **订单信息**
- 订单号：**88231**
- 商品：**比特 S10 Pro 扫地机**（¥1999.00）
- 下单时间：2026年6月20日
- 签收时间：2026年6月22日
- 物流单号：SF1234567890

🔧 **退款申请已提交**
- 退款原因：质量问题（扫地机不回充，维修无效）
- 退款单号：**RF20260629001**
- 预计 **1-3 个工作日** 到账，届时款项将退回您的原支付方式。

⚠️ 温馨提示：虽然签收已超过7天无理由退货期，但您的扫地机属于质量问题，已成功提交退款申请。如有需要，您也可以凭运单号 **SF1234567890** 查询物流信息，方便后续退货寄回。如有其他问题，随时联系我！
```

#### 3. 逐圈分析

五圈循环（四圈工具调用 + 一圈给出答复），前四圈都是一次完整的 Thought → Action → Observation：

**第 1 圈**：大脑看到用户说“想退”“订单号 88231”，判断要先查订单 → 调 `queryOrder` → 拿回订单详情。

**第 2 圈**：大脑看到订单 6 月 22 日签收，想判断退货时限，需要今天日期 → 调 `getCurrentTime` → 拿回当前时间。

**第 3 圈**：大脑没有直接退款，而是意识到还需要售后政策依据 → 调 `searchKnowledge` → 拿回七天无理由和质量问题处理规则。

**第 4 圈**：大脑结合订单时间、当前日期和售后政策，判断已经超过 7 天无理由期限，但用户反馈的是“不回充”这类质量问题，于是尝试发起退款申请 → 调 `applyRefund` → 拿回退款单号和到账提示。

**第 5 圈**：大脑发现订单信息、政策依据和退款结果都齐了 → 输出 `Final Answer`，循环终止。

注意第 2 圈到第 4 圈之间的判断链路——大脑不是查完订单就机械地退款，而是先获取当前日期，再检索售后政策，最后把“6 月 22 日签收、6 月 30 日申请、超过 7 天无理由、但属于质量问题”这些信息合在一起做决策。这就是 ReAct 的核心价值：**推理驱动行动，而不是无脑串联**。

#### 4. 再跑一个简单场景：查物流

退款是三星任务，咱们再跑一个二星的查物流（T2），感受一下循环在简单场景里怎么转：

```java
String answer = agent.run("帮我看看订单 88231 的快递到哪了。");
```

控制台输出：

```text
===== 第 1 圈 =====
[大脑] Thought: 用户想查询订单 88231 的快递状态。首先需要获取订单详情，以得到运单号。然后根据运单号查询物流轨迹。
Action: queryOrder
Action Input: 88231
[工具调用] queryOrder(88231)
[工具结果] {"orderId":"88231","product":"比特 S10 Pro 扫地机","price":1999,"orderTime":"2026-06-20","signTime":"2026-06-22","status":"已签收","trackingNo":"SF1234567890"}

===== 第 2 圈 =====
[大脑] Thought: 获取到订单详情，运单号为 SF1234567890，订单状态为"已签收"。接下来用运单号查询物流轨迹，给用户提供完整的物流信息。
Action: queryLogistics
Action Input: SF1234567890
[工具调用] queryLogistics(SF1234567890)
[工具结果] {"trackingNo":"SF1234567890","carrier":"顺丰速运","status":"已签收","traces":[{"time":"2026-06-20 18:20:00","desc":"快件已揽收"},{"time":"2026-06-21 09:10:00","desc":"快件到达上海转运中心"},{"time":"2026-06-22 11:35:00","desc":"快件已由本人签收"}]}

===== 第 3 圈 =====
[大脑] Thought: 已获取订单详情和物流轨迹，信息完整。订单状态为"已签收"，物流轨迹显示快件已于 2026年6月22日 由本人签收。可以给用户一个完整的回复了。
[最终答复] 您好，您的订单 **88231**（比特 S10 Pro 扫地机）的快递信息如下：

- **物流公司**：顺丰速运
- **运单号**：SF1234567890
- **当前状态**：✅ 已签收

**物流轨迹**：
| 时间 | 状态 |
|------|------|
| 2026-06-20 18:20 | 快件已揽收 |
| 2026-06-21 09:10 | 快件到达上海转运中心 |
| 2026-06-22 11:35 | 快件已由本人签收 |

您的包裹已于 **6月22日上午11:35** 由本人签收，快递已经送达啦！如果还有其他问题，随时告诉我~
```

只转了两圈工具调用。注意第 1 圈 Thought 里的关键推理：大脑意识到要查物流需要运单号，但用户只给了订单号，于是先查订单再查物流——这就是推理为行动指路。纯工具调用可能会直接拿订单号去调 `queryLogistics`，参数对不上，白跑一趟。

### 这个最小版还差什么

代码跑起来了，但别急着高兴——这只是个能跑的骨架，离生产可用还差不少。好消息是，每个问题都有对应的篇章来解决：

| 问题 | 现状 | 改进方向 | 在哪一篇 |
|------|------|---------|---------|
| 工具定义太简陋 | `description()` 返回一段文本，参数格式靠大脑自己猜 | 用 JSON Schema 描述入参出参，让大脑精确知道每个工具要什么格式 | 第 06 篇·Tool 的定义与注册 |
| 提示词不够稳定 | 没有 Few-shot 示例，大脑可能跑偏格式 | 加示例引导、负面约束、格式锚定 | 第 07 篇·ReAct 提示词设计 |
| 解析太脆弱 | 按行扫描，大模型多打一个空格就可能崩 | 用 Function Calling 让模型直接返回结构化调用，彻底绕开文本解析 | 第 08 篇·Function Calling |
| 终止太粗暴 | 只有 `MAX_STEPS`、`Final Answer` 和空工具名兜底 | Token 预算控制、空转检测、超时兜底 | 第 09 篇·终止条件与最大步数 |
| 工具是 Mock 的 | 返回硬编码数据 | 对接真实业务系统 API | 贯穿后续所有篇章 |

这张表就是接下来四篇的路线图。每一篇拿起这个最小版的一个薄弱环节，把它加固到生产级别。

### 文末总结

这一篇咱们把上一篇的骨架变成了能跑的代码：

- **五个组件**：`Action`（数据载体）、`Tool`（工具接口）、`ToolRegistry`（注册与执行）、`LlmClient`（OkHttp 调大模型）、`ReActAgent`（主循环）。
- **主循环的核心逻辑**：初始化消息列表 → 调大模型拿 Thought + Action → 判断是否 Final Answer → 解析 Action 并执行工具 → 把 Observation 追加到消息列表 → 进入下一圈。
- **三个关键设计**：`stop` 序列防止大脑编造 Observation；工具未找到时返回错误信息而非抛异常，给大脑自我纠正的机会；空工具名兜底防止模型不走格式时死循环。
- **两个场景验证**：退款场景（四次工具调用，带政策检索和条件判断）和查物流（两圈，带数据依赖），证明循环能跑通。

> 一句话收尾：100 多行核心代码，五个组件一装，ReAct 循环就转起来了。你现在手里有了一个能想、能干、能看结果再接着想的 Agent——虽然还很粗糙，但骨架已经立住了。

下一篇，咱们从上面那张表的第一行开始——用 JSON Schema 精确描述工具的入参出参，让大脑不用再猜。我们下一篇见。

