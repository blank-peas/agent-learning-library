# rag-as-tool

> **资料来源**：[AI Handbook](https://github.com/nageoffer/ai-handbook) · 原文件：`docs/agent/planning-and-orchestration/20-rag-as-tool.md`。

上一篇给 TinyAgent 装上了 Reflection 机制，让 Agent 不只会执行，还能自我评估、自我纠错。结尾留了一个伏笔：Agent 系列从第 5 篇开始就有一个 `searchKnowledge` 工具，但它一直是硬编码的——写死了几个关键词匹配分支，返回固定的文本。RAG 系列花了大量篇幅讲的向量检索、重排序、混合检索，在 Agent 这边一个都没用上。

这一篇，咱们把 RAG 真正接入 Agent——让检索变成 Agent 的一个工具，由智能体自主决定什么时候查知识库、查什么、查到的结果怎么用。

> 本项目中具体代码已上传 GitHub [TinyAgent](https://github.com/nageoffer/tinyagent)，大家 Clone 项目后，将代码分支切换到 1.14.x，默认主分支是最新代码。运行前复制 `.env.example` 为 `.env`，把自己的 API Key 填进去，默认阿里云百炼平台；`.env` 已加入 `.gitignore`，切分支时不会丢。

### Mock 版知识搜索

从第 5 篇开始，TinyAgent 的工具箱里就有一个 `SearchKnowledgeTool`。回顾一下它的核心实现：

```java
public String invoke(String input) {
    String query = ToolUtils.extractField(input, "query");
    String lowerQuery = query.toLowerCase();

    if (lowerQuery.contains("扫地机") && (lowerQuery.contains("推荐")
            || lowerQuery.contains("老人") || lowerQuery.contains("产品"))) {
        return "{\"matched\":\"扫地机选购指南\", \"content\":\"比特 S10 Lite ...\"}";
    }

    if (lowerQuery.contains("耳机")) {
        return "{\"matched\":\"耳机产品列表\", \"content\":\"比特 AirX ...\"}";
    }

    // ...... 更多 if-else 分支

    return "{\"matched\":\"七天无理由退货政策\", \"content\":\"签收次日起 7 天内...\"}";
}
```

本质上就是一个 `if-else` 关键词匹配器。之前这么写是因为 Agent 系列的重点在循环控制、记忆、规划、反思这些机制，知识检索用 Mock 不影响主线叙事。但随着 TinyAgent 的能力越来越完整，是时候换成真正的 RAG 检索了——覆盖全量知识、理解语义、支持动态更新，而不是靠 `if-else` 穷举几个关键词分支。

### 整体设计：RAG 作为 Tool 的架构

在动手写代码之前，先把架构理清楚。RAG 作为 Agent 的一个 Tool，和之前的 `queryOrder`、`compareProducts` 这些工具本质上没区别——都是实现了 `Tool` 接口，由 Agent 自主决定什么时候调用。区别在于，RAG 工具内部跑的是一条完整的检索链路。

![](https://oss.open8gu.com/iShot_2026-07-10_13.44.28.png)

整条链路分三层：

- **工具层**：`RagSearchTool` 实现 `Tool` 接口，Agent 通过 Function Calling 调用它，和调 `queryOrder` 没有任何区别。
- **检索层**：接收用户 query → 调 Embedding API 转向量 → 在 pgvector 里做向量检索 → 返回 Top-K 个最相关的知识片段。
- **存储层**：`knowledge_chunk` 表，存的是预处理好的知识文档片段和对应的向量。

为什么用 pgvector 而不是 Milvus？TinyAgent 在第 13 篇长期记忆里已经用 pgvector 存用户画像和交互记录了——`schema.sql` 里有 `CREATE EXTENSION IF NOT EXISTS vector`，`memory_entry` 表已经跑在 pgvector 上。读者的 Docker 环境里已经有一个跑着 pgvector 的 PostgreSQL 容器，不需要额外装任何东西。比特严选 300-500 个 SKU 的体量，pgvector 的性能绰绰有余。

### 知识库表设计

在 `schema.sql` 里新增一张 `knowledge_chunk` 表：

```sql
CREATE TABLE IF NOT EXISTS knowledge_chunk (
    id         BIGSERIAL    PRIMARY KEY,
    source     VARCHAR(256) NOT NULL,
    content    TEXT         NOT NULL,
    embedding  vector(1024),
    created_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

四个字段，各管各的事：

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | `BIGSERIAL` | 自增主键 |
| `source` | `VARCHAR(256)` | 来源文件名，如 `退货政策.txt`，方便追溯 |
| `content` | `TEXT` | 知识片段的原始文本 |
| `embedding` | `vector(1024)` | 文本对应的向量，1024 维（和 `memory_entry` 保持一致） |
| `created_at` | `TIMESTAMP` | 写入时间 |

和 `memory_entry` 表的区别在于：`memory_entry` 是用户级的（有 `user_id`、`key`、`type`），存的是某个用户的画像和交互记录；`knowledge_chunk` 是全局的，存的是平台的知识文档，所有用户共享。

### 知识文档准备与导入

#### 1. 准备知识文档

在 `src/main/resources/` 下新建一个 `knowledge` 目录，放入比特严选的知识文档。每个 `.txt` 文件是一个独立的知识主题：

```
src/main/resources/knowledge/
├── 退货政策.txt
├── 保修政策.txt
├── 扫地机选购指南.txt
├── 耳机产品信息.txt
├── 智能穿戴产品信息.txt
├── 手机产品信息.txt
├── IoT生态搭配指南.txt
└── 常见故障排查.txt
```

以 `退货政策.txt` 为例：

```text
比特严选退货政策

签收次日起 7 天内，商品外观完好、主要配件齐全，可申请七天无理由退货。

质量问题退货不受 7 天限制，但需要先通过售后检测确认为非人为损坏。检测周期一般为 1-3 个工作日。

以下商品不支持七天无理由退货：已激活的手机和平板电脑、已拆封的耳机（因卫生原因）、定制刻字商品。

退货运费规则：质量问题由比特严选承担运费；非质量问题（如不喜欢、买错了）由买家承担运费，运费约 10-15 元。

退款到账时效：审核通过后 1-3 个工作日原路退回。
```

每个文件控制在几百字以内——比特严选体量不大，知识文档也不需要特别长。如果某个主题内容较多（比如常见故障排查涵盖多个品类），在文件内部用空行分段，每段聚焦一个子主题，导入时按段切分。

#### 2. 文档导入器

`KnowledgeImporter` 负责读取 `knowledge` 目录下的所有 `.txt` 文件，按段切分，调 Embedding API 生成向量，写入 `knowledge_chunk` 表。每次运行先清空旧数据再写入，支持反复执行：

```java
public class KnowledgeImporter {

    private final DataSource dataSource;
    private final EmbeddingClient embeddingClient;

    public KnowledgeImporter(DataSource dataSource, EmbeddingClient embeddingClient) {
        this.dataSource = dataSource;
        this.embeddingClient = embeddingClient;
    }

    public void importFromResources(String resourceDir) {
        // 省略查找文件代码...

        System.out.println("[知识导入] 找到 " + txtFiles.size() + " 个文档");
        int totalChunks = 0;

        for (Path file : txtFiles) {
            // 省略导入代码...
        }
        System.out.println("[知识导入] 完成，共导入 " + totalChunks + " 个片段");
    }

  	// 省略 toVectorString、insertChunk、splitByParagraph、clearAll...
}
```

几个设计要点：

- **先删后插**：`clearAll()` 在每次导入前清空 `knowledge_chunk` 表。用户可能修改了知识文档后重新跑导入，先删后插保证表里的数据和文件内容一致，不会残留旧版本的片段。
- **`Files.list` 用 try-with-resources 包裹**：`Files.list()` 返回的 `Stream` 底层持有目录句柄，用完必须关闭，否则句柄泄漏。这是一个容易踩的坑。
- **按空行切段**：`splitByParagraph()` 用双换行符切分，每段作为一个独立的 chunk。这是最简单的切分策略，适合比特严选这种知识文档结构清晰、每段聚焦一个主题的场景。RAG 系列讲过更复杂的切分策略（按语义切、滑动窗口切），但这篇的重点不在切分，够用就好。
- **过滤太短的段**：长度不超过 10 个字符的段（比如只有一个标题行）直接跳过，这些段信息密度太低，向量化后也检索不到有价值的内容。

整个导入流程串起来是这样的：

![](https://oss.open8gu.com/iShot_2026-07-10_13.44.29.png)

#### 3. 导入放进 Demo 启动流程

导入这件事，与其让读者单独记一个 main，不如直接放进 `RagAsToolDemo` 的启动流程里：Demo 一启动先跑一遍导入，再进入问答。因为 `KnowledgeImporter` 是先删后插的幂等实现，重复跑不会累积脏数据，图的就是读者 Clone 下来跑一个 main 就能用，不用记两个入口。

```java
// RagAsToolDemo 启动时先导入知识库（幂等：先清空再写入，重复跑不会重复累积）
KnowledgeImporter importer = new KnowledgeImporter(dataSource, embeddingClient);
importer.importFromResources("knowledge");
```

读者 Clone 项目后，只需要两步准备：

1. 确保 pgvector 的 Docker 容器在跑（第 13 篇长期记忆已经配过了）
2. 在 `.env` 里配好 API Key

然后直接运行 `RagAsToolDemo.main()`。首次进入问答前，控制台会先打印导入进度：

```text
[知识导入] 找到 8 个文档
[知识导入] IoT生态搭配指南.txt → 5 个片段
[知识导入] 保修政策.txt → 4 个片段
[知识导入] 常见故障排查.txt → 4 个片段
[知识导入] 手机产品信息.txt → 2 个片段
[知识导入] 扫地机选购指南.txt → 5 个片段
[知识导入] 智能穿戴产品信息.txt → 4 个片段
[知识导入] 耳机产品信息.txt → 2 个片段
[知识导入] 退货政策.txt → 5 个片段
[知识导入] 完成，共导入 31 个片段
```

导入完成后，`knowledge_chunk` 表里就有了 31 条带向量的知识片段，等着 `RagSearchTool` 来检索。

### 实现 RagSearchTool

核心来了。`RagSearchTool` 要替换掉 Mock 版的 `SearchKnowledgeTool`，实现真正的向量检索。

```java
public class RagSearchTool implements Tool {

    private static final double SIMILARITY_THRESHOLD = 0.5;

    private final DataSource dataSource;
    private final EmbeddingClient embeddingClient;
    private final int topK;

    // 省略构造函数...

    @Override
    public String name() {
        return "searchKnowledge";
    }

    @Override
    public String description() {
        return "检索比特严选知识库，查找售后政策、产品信息、选购指南、故障排查等内容。"
                + "当用户的问题涉及产品知识、平台规则或常见问题时使用。";
    }

    @Override
    public String parameters() {
        return """
                {
                  "type": "object",
                  "properties": {
                    "query": {
                      "type": "string",
                      "description": "搜索内容，用自然语言描述要查找的信息"
                    }
                  },
                  "required": ["query"]
                }""";
    }

    @Override
    public String invoke(String input) {
        String query = ToolUtils.extractField(input, "query");
        if (query.isBlank()) {
            return "{\"error\":\"缺少搜索内容\"}";
        }

        double[] queryVector = embeddingClient.embed(query);
        String vectorStr = toVectorString(queryVector);

        String sql = "SELECT source, content, "
                + "1 - (embedding <=> ?::vector) AS similarity "
                + "FROM knowledge_chunk "
                + "WHERE embedding IS NOT NULL "
                + "ORDER BY embedding <=> ?::vector "
                + "LIMIT ?";

        // 省略检索拼接...
    }

    // 省略 toVectorString...

    private record ChunkResult(String source, String content, double similarity) {}
}
```

几个关键设计点：

**工具名保持不变。** `name()` 返回的还是 `searchKnowledge`，和 Mock 版完全一致。这意味着之前所有 Demo 里的 system prompt、Skill 指令、Plan-and-Execute 的步骤描述，都不需要改动。Agent 之前已经形成需要查知识库时调用 `searchKnowledge` 的习惯，换成真实 RAG 后这个习惯依然有效。

**description 只讲自己的适用场景。** Mock 版的 description 只说明检索比特严选知识库，返回匹配的售后政策、常见问题或产品信息；新版进一步说明当用户的问题涉及产品知识、平台规则或常见问题时使用，让 Agent 一眼看出这是处理知识性问题的工具。

> 这里要强调一条反面原则：**不要在一个工具的描述里点名其它工具**（比如补充查订单时改用 `queryOrder`）。工具名是会变的，一旦改名这句话就成了过时噪音，还让本该自包含的工具描述和兄弟工具的命名强耦合。跨工具到底先选哪个，是编排层的全局策略，后面第二道防线放到 system prompt 里统一处理。

**相似度阈值过滤。** 检索出 Top-K 结果后，低于 `SIMILARITY_THRESHOLD`（0.5）的片段直接过滤掉。当知识库里确实没有相关内容时，返回 `matched: 0` 和明确提示，而不是硬凑一个低相关性的结果。

**返回相似度分数。** 结果里带了 `similarity` 字段（余弦相似度，0 到 1 之间）。这个分数 Agent 不一定直接用，但它让调试变得容易——你能直观看到检索结果和 query 有多匹配，方便排查检索命中但结果不相关的问题。

**异常不上抛。** 数据库查询出错时，返回一个包含 `error` 字段的 JSON，而不是直接抛异常。这样 Agent 的 ReAct 循环不会因为数据库连接超时而整个中断——它看到 error 信息后可以决定下一步怎么做（告知用户、换个方式查、或者跳过这个步骤）。

#### 和 Mock 版的对比

替换前后，Agent 侧的代码改动极小：

```java
// 替换前
toolRegistry.register(new SearchKnowledgeTool());

// 替换后
toolRegistry.register(new RagSearchTool(dataSource, embeddingClient));
```

一行代码的变化，背后是从硬编码关键词匹配到向量语义检索的跨越。

| 维度 | Mock 版 SearchKnowledgeTool | 真实版 RagSearchTool |
|------|---------------------------|---------------------|
| 检索方式 | `if-else` 关键词匹配 | Embedding → pgvector 向量检索 |
| 覆盖范围 | 约 6 个硬编码分支 | 知识库全量片段（Demo 中 31 个） |
| 语义理解 | 无，纯字符串包含判断 | 有，向量相似度排序 |
| 返回结果 | 固定文本，无相关性排序 | Top-K 片段 + 相似度分数 |
| 更新方式 | 改 Java 代码 | 改 `.txt` 文件 → 重新导入 |

### Agent 什么时候该调 RAG：决策边界问题

到这里，技术实现已经完成了。但真正难的问题才刚开始——**Agent 怎么知道什么时候该调 `searchKnowledge`，什么时候不该调**？

这不是一个理论问题，而是一个实实在在影响用户体验的工程问题。决策偏差有两个方向，每个方向都会出事：

#### 1. 该调的时候没调

用户问：“比特扫地机拆封后还能退吗？”

这个问题的答案藏在退货政策里——已拆封的耳机不支持七天无理由退货，但扫地机没有这个限制。Agent 必须查知识库才能给出准确答案。如果 Agent 自以为知道退货政策，然后凭自己的训练知识回答，很可能给出一个似是而非的通用回复，而不是比特严选特有的规则。

这类遗漏的根因是：**Agent 把自己的通用知识当成了业务知识**。LLM 训练时见过大量的退货政策文档，它觉得自己知道答案，但它不知道比特严选的具体规则。

#### 2. 不该调的时候反而调了

用户问：“帮我查一下订单 88231 到了没。”

这个问题应该调 `queryOrder` 查订单状态，跟知识库没有半毛钱关系。但如果 Agent 先调了 `searchKnowledge("订单查询")`，拿回来一段订单状态查询的操作指南，然后基于这个指南给用户回复——用户要的是查订单结果，不是查订单教程。

更隐蔽的场景是，用户说“帮我对比 AirX 和 BandPro 耳机”，Agent 已经有 `compareProducts` 工具能拿到精确的规格参数，但它先调了 `searchKnowledge("AirX BandPro 对比")`，拿到的是一段模糊的产品简介。这不仅浪费了一次 LLM 调用，还可能让 Agent 基于不够精确的知识库信息做对比，而不是用 `compareProducts` 返回的结构化数据。

这类多余调用的根因是：**Agent 分不清哪些问题该用结构化工具、哪些问题该查知识库**。

#### 3. 工程解法：三道防线

这个决策问题没有银弹，但有一套组合拳能显著降低偏差率。

##### 第一道防线：每个工具的描述讲清自己的场景

最直接的办法是在每个工具的 `description()` 里，把这个工具**自己**的适用场景写清楚。Agent 选工具时看的就是这些描述，描述越具体，决策越准。

对比一下改进前后的 `description()`：

```java
// 改进前：太笼统，边界模糊
"检索比特严选知识库，返回匹配的售后政策、常见问题或产品信息。"

// 改进后：把适用场景说具体，让 Agent 一眼看出这是处理知识性问题的工具
"检索比特严选知识库，查找售后政策、产品信息、选购指南、"
+ "故障排查等内容。当用户的问题涉及产品知识、平台规则或常见问题时使用。"
```

这里有一条**反面原则**必须强调：不要在一个工具的描述里点名其它工具。你可能会想在 `searchKnowledge` 的描述里补充查订单时改用 `queryOrder`、对比规格时改用 `compareProducts`——看起来划清了边界，实则埋了雷：

- **工具名会变。** 哪天 `queryOrder` 改名、拆分或下线，这句话就变成过时噪音，还得回来逐个工具改描述。
- **破坏自包含。** 一个工具的描述本该是关于它自己的元数据，能独立复用；一旦引用兄弟工具的名字，就和整套工具的命名强耦合了。

正确的做法是：每个工具只负责把自己的定位讲清楚（`queryOrder` 强调查询实时订单，`compareProducts` 强调获取精确规格参数，`searchKnowledge` 强调查询知识性问题），彼此的边界自然就分开了。至于面对一个问题该优先使用哪个工具，那是全局策略，交给下面的第二道防线。

##### 第二道防线：system prompt 里给决策指引

工具描述用于说明每个工具的用途，system prompt 则提供面对问题时优先选择哪类工具的全局策略。这里才是放跨工具路由的正确位置——但同样别把具体工具名写死，用**角色**来描述，让 Agent 自己去 tools 列表里对号入座：

```text
工具选择原则：
- 查订单状态、物流轨迹这类实时数据，直接调对应的查询工具，不要先去知识库检索
- 对比商品的具体规格参数，用商品对比工具拿结构化数据，不要用知识库检索代替
- 平台规则（退货、保修、运费）、选购建议、功能介绍这类知识性问题，才查知识库
- 原则：能用结构化工具精确获取的信息，就不要去知识库模糊检索；拿不准时先判断问题类型再选工具
```

这段指引的核心原则是：**能用结构化工具精确获取的信息，不要去知识库里模糊检索**。`queryOrder` 返回的是确定性的订单数据，`compareProducts` 返回的是精确的规格参数，这些都比知识库检索的结果更准确、更可靠。知识库的定位是兜底——当没有专门的工具可以获取信息时，才去知识库查。

##### 第三道防线：检索结果的相关性过滤

即使 Agent 正确地决定查询知识库，检索结果也不一定都相关。`RagSearchTool` 返回的 Top-K 结果按相似度排序，但排在第三名的片段可能相似度只有 0.3，和 query 关系不大。

前面 `RagSearchTool` 的代码里已经实现了这一道防线——`SIMILARITY_THRESHOLD = 0.5`，检索出 Top-K 结果后，低于阈值的片段直接过滤掉。当知识库里确实没有相关内容时（比如用户问了一个比特严选根本不涉及的话题），返回 `matched: 0` 和一条明确的提示。Agent 看到这个结果后，不会硬凑一个答案，而是会告诉用户该问题超出知识范围。

> 这里有个反直觉的坑要提醒：稠密向量模型（尤其是中文短文本）对语义无关的内容也常给出 0.3～0.4 的余弦相似度，阈值定太低（比如 0.3）几乎过滤不掉任何东西，`matched:0` 就形同虚设了。所以这道防线的风险往往不是太严，而是太松。0.5 只是一个偏保守的起点，最优值和 Embedding 模型强相关，实际项目里务必用一批测试 query 跑一遍，看清各相似度区间的检索质量再标定。

#### 4. 三道防线的关系

三道防线不是互相替代，而是层层递进：

![](https://oss.open8gu.com/iShot_2026-07-10_13.44.30.png)

| 防线 | 作用阶段 | 解决的问题 |
|------|---------|-----------|
| 工具描述讲清自身定位 | Agent 选工具时 | 减少用错工具的概率 |
| system prompt 给指引 | Agent 分析问题时 | 减少不知道该用哪个工具的概率 |
| 相关性过滤 | 工具返回结果时 | 减少检索命中但结果不相关的噪音 |

用一句话概括：**工具描述管能不能用，system prompt 管该不该用，相关性过滤管用了之后结果准不准。**

需要说清楚一个事实：即使三道防线都到位了，Agent 仍然会偶尔做出不理想的决策——该调的没调、不该调的调了。这不是 bug，而是 LLM 决策的概率性本质。这三道防线做的事情是**显著降低偏差率**，而不是消灭偏差。如果你需要 100% 的调用准确性，应该在 Agent 外部用规则引擎做意图路由（第一篇 RAG vs Agent 提过的硬编码路由），把决定何时查询知识库的权力从 LLM 手里拿走。但那样就失去了 Agent 自主决策的灵活性——这是一个工程上的取舍。

### 完整 Demo：RAG 工具实战

把上面的代码串在一起，跑一个完整的 Demo。

```java
public class RagAsToolDemo {

    public static void main(String[] args) {
        Properties dotEnv = loadDotEnv();

        DataSource dataSource = createDataSource(dotEnv);

        EmbeddingClient embeddingClient = new EmbeddingClient(
                setting(dotEnv, "TINYAGENT_EMBEDDING_URL",
                        "https://dashscope.aliyuncs.com/compatible-mode/v1/embeddings"),
                requiredSetting(dotEnv, "TINYAGENT_API_KEY"),
                setting(dotEnv, "TINYAGENT_EMBEDDING_MODEL", "text-embedding-v3")
        );

        // 导入知识库（幂等：先清空再写入，重复跑不会重复累积）
        KnowledgeImporter importer = new KnowledgeImporter(dataSource, embeddingClient);
        importer.importFromResources("knowledge");

        LlmClient llmClient = new LlmClient(
                setting(dotEnv, "TINYAGENT_API_URL",
                        "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions"),
                requiredSetting(dotEnv, "TINYAGENT_API_KEY"),
                setting(dotEnv, "TINYAGENT_MODEL", "qwen-plus")
        );

        ToolRegistry toolRegistry = new ToolRegistry();
        // 省略
        // 用 RagSearchTool 替换 Mock 版 SearchKnowledgeTool
        toolRegistry.register(new RagSearchTool(dataSource, embeddingClient));

        ReActAgent agent = new ReActAgent(llmClient, toolRegistry);

        System.out.println("========== 场景一：退货政策咨询（应该查知识库）==========");
        String answer1 = agent.run("比特扫地机拆封后还能退吗？");
        System.out.println("[最终答复] " + answer1);

        System.out.println("\n========== 场景二：查订单状态（不应该查知识库）==========");
        String answer2 = agent.run("帮我查一下订单 88231 到了没");
        System.out.println("[最终答复] " + answer2);

        System.out.println("\n========== 场景三：混合场景（订单 + 知识库）==========");
        String answer3 = agent.run("我买的扫地机不回充了，能退吗？订单号 88231");
        System.out.println("[最终答复] " + answer3);
    }

    private static DataSource createDataSource(Properties dotEnv) {
        PGSimpleDataSource ds = new PGSimpleDataSource();
        ds.setUrl(setting(dotEnv, "TINYAGENT_DB_URL",
                "jdbc:postgresql://localhost:5432/tinyagent"));
        ds.setUser(setting(dotEnv, "TINYAGENT_DB_USER", "postgres"));
        ds.setPassword(setting(dotEnv, "TINYAGENT_DB_PASSWORD", "postgres"));
        return ds;
    }

    // loadDotEnv / setting / requiredSetting 方法与其他 Demo 一致，此处省略
}
```

#### 场景一：退货政策咨询

用户问：“比特扫地机拆封后还能退吗？”

预期行为：Agent 应该调 `searchKnowledge`，从知识库里查到退货政策的具体规则。

```text
===== 第 1 圈 =====
[大脑] 用户想了解扫地机拆封后的退货政策，这属于平台规则问题，需要查知识库。
[工具调用] searchKnowledge({"query":"扫地机 拆封 退货政策"})
[工具结果] {"query":"扫地机 拆封 退货政策","matched":2,"chunks":[
  {"source":"退货政策.txt","content":"签收次日起 7 天内，商品外观完好、
   主要配件齐全，可申请七天无理由退货。","similarity":0.8234},
  {"source":"退货政策.txt","content":"以下商品不支持七天无理由退货：
   已激活的手机和平板电脑、已拆封的耳机（因卫生原因）、
   定制刻字商品。","similarity":0.7856}
]}

===== 第 2 圈 =====
[最终答复] 比特扫地机拆封后是可以退的。根据比特严选的退货政策，签收次日起
7 天内，只要商品外观完好、主要配件齐全，就可以申请七天无理由退货。不支持退货
的商品是已激活的手机和平板电脑、已拆封的耳机以及定制刻字商品，扫地机不在此列。
```

注意 Agent 的推理过程——它先判断这属于平台规则问题，然后选了 `searchKnowledge`，而不是 `queryOrder` 或 `compareProducts`。知识库返回了两个相关片段，Agent 综合两段内容给出了准确的答案：扫地机不在不支持退货的清单里，所以可以退。

如果是 Mock 版，用户输入“扫地机拆封后还能退吗”会匹配到兜底分支，只返回笼统的七天无理由退货政策，不会精确区分已拆封耳机不支持退货但扫地机可以退。

#### 场景二：查订单状态

用户问：“帮我查一下订单 88231 到了没。”

预期行为：Agent 应该直接调 `queryOrder`，不需要查知识库。

```text
===== 第 1 圈 =====
[大脑] 用户要查具体订单的状态，直接用 queryOrder 查询。
[工具调用] queryOrder({"orderId":"88231"})
[工具结果] {"orderId":"88231","product":"比特 S10 Pro 扫地机",
 "status":"已签收","signedAt":"2026-06-22","price":1999}

===== 第 2 圈 =====
[最终答复] 您的订单 88231（比特 S10 Pro 扫地机，¥1999）已于 6 月 22 日签收。
```

Agent 直接选了 `queryOrder`，两圈搞定，没有多余地调 `searchKnowledge`。

#### 场景三：混合场景

用户问：“我买的扫地机不回充了，能退吗？订单号 88231。”

这个问题同时需要两个工具：`queryOrder` 查订单状态确认签收时间，`searchKnowledge` 查退货政策。

```text
===== 第 1 圈 =====
[大脑] 用户反映扫地机故障想退货，需要先查订单信息确认签收时间，
       同时查退货政策看是否符合条件。先查订单。
[工具调用] queryOrder({"orderId":"88231"})
[工具结果] {"orderId":"88231","product":"比特 S10 Pro 扫地机",
 "status":"已签收","signedAt":"2026-06-22","price":1999}

===== 第 2 圈 =====
[大脑] 订单已签收，签收时间是 6 月 22 日。需要确认当前日期，
       再查退货政策看质量问题的处理方式。
[工具调用] getCurrentTime({})
[工具结果] {"currentTime":"2026-07-16 15:30:00"}

===== 第 3 圈 =====
[大脑] 签收日 6 月 22 日到现在 7 月 16 日已过 24 天，
       超过 7 天无理由退货期限。但用户反映的是质量问题（不回充），
       需要查知识库看质量问题退货的规则。
[工具调用] searchKnowledge({"query":"质量问题 退货 超过七天"})
[工具结果] {"query":"质量问题 退货 超过七天","matched":2,"chunks":[
  {"source":"退货政策.txt","content":"质量问题退货不受 7 天限制，
   但需要先通过售后检测确认为非人为损坏。检测周期一般为 1-3 个工作日。",
   "similarity":0.8512},
  {"source":"常见故障排查.txt","content":"扫地机不回充可能的原因：
   1. 充电座未通电或接触不良；2. 回充路径有障碍物；
   3. 充电触点脏污。建议先排查以上原因，若仍无法解决，
   可联系售后检测。","similarity":0.7234}
]}

===== 第 4 圈 =====
[最终答复] 您的订单 88231（比特 S10 Pro 扫地机）已于 6 月 22 日签收，
距今已超过 7 天无理由退货期限。不过您反映的不回充属于质量问题，
质量问题退货不受 7 天限制。

在申请退货之前，建议您先排查以下常见原因：
1. 检查充电座是否通电、接触是否良好
2. 确认回充路径没有障碍物
3. 清洁充电触点

如果以上排查后仍无法解决，可以申请售后检测。检测确认为非人为损坏后，
即可办理退货，检测周期一般 1-3 个工作日。需要我帮您申请退货吗？
```

这个场景充分展示了 Agent 的决策能力——它先查了订单确认签收时间，再获取当前时间做计算，发现超过 7 天后才去查知识库的质量问题退货规则。三个工具各司其职，没有多余调用，也没有遗漏。更关键的是，知识库返回了故障排查的信息，Agent 把它也融入了回复，在给出退货方案的同时先建议排查——这比直接告诉用户可以退更专业。

### 从 RAG 到 Agent 的 RAG：有什么不同

到这里有必要回头看一眼：把 RAG 做成 Agent 的一个工具之后，和 RAG 系列里讲的独立 RAG 系统有什么本质区别？

#### 1. 调用决策权在 Agent 手里

独立 RAG 系统的逻辑是固定的：用户输入 → 检索 → 生成。每次用户发消息，检索一定会执行。Agent 里的 RAG 工具不一样——Agent 先分析用户问题的类型，判断需不需要查知识库，需要的话才调。用户问订单状态，不查；用户问退货政策，查；用户问了一个混合问题，先查订单再查知识库。

这个区别看起来简单，但意义重大。独立 RAG 系统面对“帮我查订单 88231”这种问题，会去知识库里检索 `订单 88231`，然后返回一堆和订单查询相关的通用指南——答非所问。Agent 不会犯这个错，因为它在调工具之前会先想一步。

#### 2. 检索结果的使用方式不同

独立 RAG 系统把检索结果直接拼进 prompt，让模型生成最终回复。检索结果的质量直接决定回复质量——找到了就答对，找错了就答错。

Agent 里的 RAG 工具返回的是一次 Observation（工具结果）。Agent 拿到这个 Observation 后，会和其他工具的 Observation 一起综合分析。场景三里，Agent 把订单信息（来自 `queryOrder`）、当前时间（来自 `getCurrentTime`）、退货政策和故障排查方案（来自 `searchKnowledge`）四种信息交叉引用，给出了一个远比单独查知识库更完整的回复。

#### 3. 多工具协作的上下文

独立 RAG 系统是单链路的——检索 → 生成，链路里只有一种信息来源。Agent 的工具链是多源的，RAG 只是其中一个来源。这意味着 Agent 可以在查完知识库后转而查询订单，也可以根据订单结果继续查询知识库，形成动态多轮检索，而独立 RAG 系统做不到。

![](https://oss.open8gu.com/iShot_2026-07-10_13.44.31.png)

| 维度 | 独立 RAG 系统 | Agent 里的 RAG 工具 |
|------|-------------|-------------------|
| 调用时机 | 每次都调，无差别检索 | Agent 自主判断，按需检索 |
| 检索结果用法 | 直接拼 prompt 生成回复 | 作为 Observation，和其他工具结果综合分析 |
| 信息来源 | 单一（知识库） | 多源（知识库 + 订单系统 + 商品系统 + ……） |
| 多轮交互 | 不支持，一次检索定生死 | 支持，可以根据结果决定是否追查 |

### 文末总结

这一篇把 RAG 从一个独立系统降维成了 Agent 的一个工具：

- **替换 Mock**：用 `RagSearchTool` 替换了硬编码的 `SearchKnowledgeTool`。底层用 pgvector 做向量检索，复用了 TinyAgent 已有的 PostgreSQL 和 `EmbeddingClient` 基础设施，不需要额外部署 Milvus。
- **知识导入**：`KnowledgeImporter` 读取 `src/main/resources/knowledge/` 目录下的 `.txt` 文件，按段切分后调 Embedding API 生成向量，写入 `knowledge_chunk` 表。先删后插，支持反复执行。
- **决策边界**：Agent 该不该调 RAG 工具是一个概率性决策，没有银弹。三道防线组合降低偏差率——工具描述讲清各自定位、不点名兄弟工具（管能不能用）、system prompt 用角色描述给决策指引（管该不该用）、相关性过滤（管用了之后结果准不准）。
- **和独立 RAG 的区别**：调用决策权在 Agent 手里（按需检索而非无差别检索），检索结果作为 Observation 参与多工具综合分析，支持动态多轮检索。

用一句话概括：**RAG 作为 Tool 的核心价值不在于检索本身——检索的实现和 RAG 系列讲的一模一样——而在于让 Agent 自主决定什么时候查、查什么、怎么用查到的东西。**

下一篇进入多智能体协作——当比特严选的场景复杂到一个 Agent 忙不过来时，怎么把商品咨询、售后处理、IoT 搭配推荐拆给不同的 Agent，让它们各司其职、协同完成用户的复合需求。

