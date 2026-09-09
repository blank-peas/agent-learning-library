# multi-agent-supervisor

> **资料来源**：[AI Handbook](https://github.com/nageoffer/ai-handbook) · 原文件：`docs/agent/multi-agent/22-multi-agent-supervisor.md`。

上一篇咱们把多智能体的架构地图铺开了：单体 Agent 的三个结构性天花板、一个 Agent 的四要素、Google 的四种范式、DeepMind 论文的选型结论，最后落到比特严选——人设差异大、跨品类可分解、要错误可控，值得上中心化主从式。地图画完了，团队也画好了：商品咨询、售后服务、IoT 搭配三个专家。

这一篇开始动手。不过在敲代码之前，咱们先花小半篇把这套系统在脑子里跑一遍：它运行起来到底长什么样、凭什么比单体强、什么时候该用、代码上比单体多了什么。把这张图先刻进脑子，后面写代码就是照着图纸施工。

先说一个结论：主从式几乎没引入什么新机制，就是把咱们前面二十多篇攒下的积木换了个搭法。

### 动手之前：先把主从式想明白

这一部分不写代码，就做一件事：把主从式在脑子里拆开看——长什么样、比单体强在哪、什么时候该用、代码上多了什么。想通了再动手，省得后面一行行硬啃。

#### 1. 先在脑子里跑一遍：主从式长什么样

假设你是比特严选的用户，在对话框里敲了这么一句：

> 比特 AirX 和 BandPro 两款耳机哪个好？我通勤用。另外我刚买了 Phone S1，想再配一套运动装备，预算 3000。

这句话要是丢给上一篇讲的单体 Agent，它得一个人把耳机对比和运动装备搭配两件性质不同的事都扛下来。而在主从式里，处理它的不是一个大脑，是一个小团队。咱们先不看代码，把这句话在团队里走一遍，看看四拍下来都发生了什么。

**第一拍，编排者读题。** 请求先落到主 Agent（Supervisor）手里。在这套系统中，它扮演编排者角色。编排者自己不查规格、不算搭配价，它干的是读题、派活、收尾这三件事。它一眼看出这句话其实是两桩活：一桩是耳机对比（商品咨询的活），一桩是给 Phone S1 配运动装备（IoT 搭配的活）。

**第二拍，把第一桩活派给商品专家。** 编排者把对比 AirX 和 BandPro 这个子任务交给商品专家，顺手把用户通勤这个背景一起塞过去。商品专家接过活，关起门来跑自己的推理——查规格、逐项比、结合通勤场景下判断，得出通勤更推荐 AirX 的结论，再交回编排者。这一整套推理发生在商品子 Agent 的内部循环里，编排者在外面等结果，不掺和它具体怎么比。

**第三拍，把第二桩活派给 IoT 专家。** 编排者拿到耳机结论后，接着把为 Phone S1 搭配运动装备、预算 3000 这个子任务交给 IoT 专家。IoT 专家同样关起门跑自己的循环——按基础机型和预算算组合，得出一套运动健康套装和组合价，再交回编排者。它和商品专家互相看不见对方干了啥，各跑各的。

**第四拍，编排者收尾。** 两份结果都回到编排者手里，编排者做最后一件事：核对、去重、把打架的地方捋顺，综合成一段连贯回复。用户看到的是整合过的答复，而不是两个专家各自甩出来的半截话。

把这四拍画成一张图，主从式的骨架就清楚了：

![](https://oss.open8gu.com/iShot_2026-07-10_13.44.38.png)

看完这张图，先记住三个直觉，后面写代码全靠它们：

- 编排者不直接处理领域任务，只负责调度。它的价值在读题、派活、收尾这三步，尤其是最后的综合校验——上一篇说的中央校验瓶颈就在这儿，也是主从式把错误率压下来的关键。具体任务都交给领域专家，也就是子 Agent。
- 每个专家都是一个独立的子 Agent。这里的子只表示它位于主 Agent 下游、接受主 Agent 编排，不代表能力缩水；它仍然有自己独立的上下文、工具和循环。商品专家跑推理时，眼里只有编排者交给它的那段子任务，根本看不到 IoT 专家处理过什么——上一篇说的领域隔离，在这儿就落到了运行时。
- 你会看到循环套循环。主 Agent 有一个大循环（派完一个子 Agent、看了结果再决定派下一个，直到收工），每个子 Agent 内部又各有一个小循环（查这个工具、看了结果再查那个）。等会儿跑 Demo 看控制台，心里有这张图就不会被绕晕。

说到底，这套拆 → 派 → 干 → 汇总的流程不是主从式发明的新玩意儿，就是一个会调度的大脑带着几个各司其职的专业大脑。

#### 2. 主 Agent vs 单体到底强在哪

看完流程你八成会犯嘀咕：绕这么一大圈，比单体一个大脑硬扛到底强在哪？值不值这份周折？

就拿刚才那条既要对比耳机、又要给 Phone S1 配运动装备的请求，把两种打法摆到一张桌上看看。

单体是怎么啃这句话的？一个大脑，一份塞满了导购话术、售后政策、IoT 搭配规则的大 System Prompt，工具箱里的工具全摊开。它得在同一条上下文里，既盘算怎么对比耳机、又惦记着搭配预算，查完规格接着算组合价，所有中间产物全压在同一条消息链上。请求一复杂，上一篇讲的那几个老毛病就容易冒头：注意力被稀释（一不留神漏掉预算 3000）、工具选串（候选一多就容易挑错）、人设打架（导购的热情和售后的严谨搅在一份 prompt 里，语气忽软忽硬）。

编排者是怎么分这句话的？主 Agent 自己这条上下文干干净净，只装着识别两桩活、分别派给谁、结果怎么综合这些调度信息；耳机参数只在商品专家的上下文里，组合报价只在 IoT 专家的上下文里，谁也不挤谁。每个子 Agent 一份聚焦的人设、一套最小的工具子集，选错工具、串味的概率都低了一截。最要紧的是收尾那道综合——子 Agent 的结论不是直接甩给用户，而是先回到编排者手里过一遍筛，上一篇说的中央校验瓶颈就在这一步。

一张表把差别摆清楚：

| 对照维度 | 单体一个大脑硬扛 | 主 Agent + 子 Agent 团队 |
|---------|----------------|----------------|
| 上下文 | 各领域中间结果堆在一条链上，一长就 Lost in the Middle（上下文越长，中间位置的信息越容易被模型忽略） | 主 Agent 只留调度信息，各子 Agent 上下文互相隔离 |
| 工具选择 | 工具全摊开，候选多、易选错 | 每个子 Agent 只带自己那几个，候选少、更准 |
| 人设 | 导购 / 售后 / 搭配三种调性挤一份 prompt，互相打架 | 一个子 Agent 一份聚焦人设，不串味 |
| 错误控制 | 没有独立校验环节，错了直接输出给用户 | 主 Agent 收尾再综合校验，拦得住一部分错 |
| 独立调优 | 动一处 prompt 牵一发而动全身 | 售后不给力只调售后专家，不惊动其他人 |

不过话得说回来，别把这张表读成主 Agent 架构处处碾压单体。主 Agent 适合处理横跨多领域、又对出错敏感的复合请求；请求一旦简单——比如只问退货政策有几天——编排者那套读题、派活、综合的开销全成了纯浪费，反倒是单体一步到位，又快又省。主 Agent 的强，是有前提的强。那到底什么样的请求，才配得上编排者这套排场？

#### 3. 什么时候该上主从式

上一节那句横跨两个领域的请求，确实值得编排者带着整个团队处理。但真实的客服流量里，这种复合请求只是一小撮，更多的是询问退货政策时限、查询订单 88231 进度这类一句话一个意图的简单问题。要是不管三七二十一都走一遍主 Agent 的编排流程，token 和延迟就全白烧了。

所以进代码之前，得先在脑子里立一把尺子：一个请求进来，到底配得上多重的打法？顺着上一篇那把奥卡姆剃刀（如无必要，勿增实体），就两档。

第一档，一个 Agent 自己就够。请求简单、只落在单一知识点、也不跨领域，比如询问七天无理由的适用范围、推荐一款千元档手机、查询订单 88231 的进度。这类活，前面二十篇手写的那个单体 `ReActAgent` 自己就能办完，一份人设加几个工具足矣。上一篇的 45% 阈值和 P0 原则说的就是它：单体基线够用，就别为了架构好看硬拆。这一档本篇不再实现。

第二档，主 Agent 编排多个子 Agent（领域专家），也就是 LLM Supervisor（编排者）。请求一句话横跨多个领域，需要拆成几个子任务、按依赖顺序派活、最后把多方结果综合校验成一段回复。上一节的耳机对比加运动装备搭配请求就是典型。只有这一档，才需要主 Agent 跑编排循环，才用得上调度这道校验工序。

这两档不是两种独立的架构，而是同一支子 Agent 团队的两种用法，按需取用：

| 打法 | 请求特征 | 比特严选举例 | 谁来处理 | 为什么够 / 为什么要 |
|------|---------|-------------|---------|-------------------|
| 第一档 · 单体 Agent | 单一意图、不跨领域 | 询问七天无理由的适用范围、查询订单 88231 的进度 | 一个通用 `ReActAgent` | 简单场景基线够用，硬拆反而降效（45% 阈值） |
| 第二档 · LLM Supervisor | 一句话横跨多领域，需拆解 + 编排 + 综合 | 对比耳机并为 Phone S1 搭配运动装备 | 主 Agent 循环编排多个子 Agent + 综合校验 | 复合请求要有人拆活、对齐、消解冲突 |

分寸得说清楚：第二档比第一档多的不只是一点编排开销——主 Agent 每一圈都要读全部 agent 身份和历史、每个子 Agent 各跑一轮 ReAct 循环，token 和延迟都翻倍地涨。只有当一句话真的横跨好几个领域、需要有人在最后把多方结论对齐时，第二档才值回它多烧的那些 token。能用单体解决的，别急着上 Supervisor，这依然是那把剃刀。

落到代码，第一档你已经会了（就是前面的单体 `ReActAgent`）；本篇要动手写的是第二档——LLM Supervisor。不过写之前，还得看一个问题：主从式看着新鲜，代码上到底比单体多出了什么？

#### 4. 代码上到底多了什么：老积木换个搭法

到这儿你可能有个担心：多了主 Agent、多了子 Agent、还有派活收活这一摊子，代码是不是要重起一套复杂的调度框架？

其实不用。主从式几乎没引入什么新机制——你从第 4 篇一路攒到第 20 篇的那些积木，一块都没作废，只是换了个搭法。把单体时代的积木和多智能体要用的东西摆到一起看：

| 积木 | 单体时代干的活 | 多智能体里怎么用 |
|------|--------------|----------------|
| `ReActAgent`（ReAct 循环引擎） | 驱动单个大脑推理、行动、观察 | 原样复用——子 Agent 靠它跑循环，主 Agent 本身也是它 |
| `Tool` 接口（`name` / `description` / `invoke`） | 包装 `queryOrder`、`compareProducts` 等能力 | 原样复用——只是多写一种实现，把子 Agent 也包成工具 |
| `ToolRegistry` | 管理一个 Agent 能调的工具集合 | 原样复用——主 Agent 的注册表里装的是一个个子 Agent |
| System Prompt / 人设 | 一份大而全的客服话术 | 拆成每个子 Agent 各自一份（靠给 `ReActAgent` 注入 `systemPrompt`） |

看这张表最该记住的是：核心引擎一块都没动。ReAct 循环还是那个 ReAct 循环，`Tool` 接口还是那三个方法，`ToolRegistry` 还是那个注册表。多智能体真正新增的，就几层薄适配：

- 一个只有三个方法（`name` / `description` / `run`）的 `Agent` 接口，给单体 Agent、子 Agent、主 Agent 一个统一的壳子；
- `SpecialistAgent`，给 `ReActAgent` 套上一份领域人设和一个身份，就成了一个有明确领域身份的子 Agent——它自己没有循环，循环全借 `ReActAgent` 的；
- `AgentAsTool`，一层转接头，把一个 `Agent` 适配成一个 `Tool`；
- 主 Agent（Supervisor）本身也是一个 `ReActAgent`，只不过工具箱里装的是子 Agent，而不是查订单、比价这些具体工具。

最后那层转接头最有意思。回想第二档编排者的活：读一堆候选、挑一个调用、看结果、再挑下一个、直到收工——这套路你是不是觉得眼熟？这不就是 ReAct 循环干的事吗？只不过被挑来调用的从普通工具变成了子 Agent。

那要是能把作为领域专家的子 Agent 也当成一个工具塞进工具箱呢？主 Agent 就不需要什么新循环了，它自己就是一个普通的 `ReActAgent`，只不过工具箱里装的不是 `queryOrder`、`compareProducts`，而是一个个子 Agent。这个想法，业界叫它子 Agent 即工具（Sub-Agent as Tool）。

这个同构（结构上的一一对应）一旦成立，很多东西就免费了：主 Agent 不用另写循环，连第 9 篇那套防空转的重复检测都能直接复用。具体怎么落到代码，下面 `AgentAsTool` 那一节再展开。

到这儿，概念层的东西就齐了：主从式跑起来长什么样、什么请求配得上编排者出手、代码上不过是老积木换个搭法。下面咱们从最底下那块地基——统一的 `Agent` 抽象——开始搭。

> 本项目中具体代码已上传 GitHub [TinyAgent](https://github.com/nageoffer/tinyagent)，大家 Clone 项目后，将代码分支切换到 1.15.x，默认主分支是最新代码。运行前复制 `.env.example` 为 `.env`，把自己的 API Key 填进去，默认阿里云百炼平台；`.env` 已加入 `.gitignore`，切分支时不会丢。

### 动手搭骨架：从统一抽象到子 Agent 团队

先定一个统一的 `Agent` 抽象当壳子，再给 `ReActAgent` 注入可替换的人设，然后封一层 `SpecialistAgent`，最后把三个领域专家组成一支子 Agent 团队。

#### 1. 先给 Agent 一个统一抽象

上一篇讲四要素时说过：任何一个 Agent 都可以拆成人设、能力、上下文、循环四样东西。既然单体和多智能体的区别只是这四要素怎么摆，那咱们完全可以先定义一个统一的抽象，把它们套进同一个壳里。

这个抽象要多小有多小，三个方法就够：

```java
public interface Agent {

    String name();

    String description();

    String run(String userMessage);
}
```

- `name()`：唯一标识，用小驼峰命名（如 `productSpecialist`）。为什么强调小驼峰、不用连字符？下面把 Agent 包成工具时，这个 name 会直接当成 Function Calling 的函数名用，而部分兼容网关对函数名的字符集处理不一致，连字符容易踩坑，小驼峰最稳，也和咱们已有工具（`queryOrder`、`compareProducts`）的命名一致。
- `description()`：这就是上一篇说的 **agent card**——一句话说清这个 Agent 擅长什么、什么时候该找它。分诊和编排全靠它。
- `run(userMessage)`：接一个任务，返回结果文本。

为什么是这三个方法，而不是把 LLM、工具、记忆都塞进来？因为对调用方来说，它只关心两件事：这个 Agent 是干嘛的（`description`）、把活交给它能拿到什么（`run`）。至于它内部是用 ReAct 还是 Plan-and-Execute、挂了几个工具、有没有记忆，都是它自己的事。后面能把主从式搭得干净，靠的就是这层信息隐藏。

咱们前面手写的 `ReActAgent` 本身不实现这个接口——它是一个通用的循环引擎，不带领域身份。真正实现 `Agent` 的是后面的 `SpecialistAgent` 和 `SupervisorAgent`。类关系画出来是这样的：

![](https://oss.open8gu.com/iShot_2026-07-10_13.44.39.png)

这张图里有个小闭环要注意：`AgentAsTool` 把 `Agent` 包成 `Tool`，而 `SupervisorAgent` 内部的 `ReActAgent` 又通过 `ToolRegistry` 调用 `Tool`——绕一圈，主 Agent 调的工具其实是子 Agent。先记住这个闭环，后面会看到它怎么把整个架构串起来。

#### 2. 让 ReActAgent 长出人设：一处小改动

要按领域切分专家，第一步得让每个专家有自己的人设。但翻开咱们现在的 `ReActAgent`，会发现一个挡路的设计——系统提示词是写死的：

```java
// 改造前：人设硬编码，所有 ReActAgent 共用同一份
private String buildSystemPrompt() {
    return """
            你是比特严选的智能客服助手，负责帮助用户解决商品咨询、\
            订单查询、物流追踪、退款换货等问题。
            ......
            """;
}
```

这在单体时代没问题——反正只有一个大脑，一份人设够用。到了多智能体就不行了，售后专家要严谨守政策、导购专家要热情有主见，两份人设天差地别，总不能让它们共用这段客服话术。

改动很小，把人设从写死变成可注入，同时保证老代码一行都不用动。三步：

第一步，把默认人设抽成一个常量，作为不指定人设时的兜底：

```java
public static final String DEFAULT_SYSTEM_PROMPT = """
        你是比特严选的智能客服助手，负责帮助用户解决商品咨询、\
        订单查询、物流追踪、退款换货等问题。
        ......
        """;
```

第二步，加一个 `systemPrompt` 字段，`buildSystemPrompt()` 直接返回它：

```java
private final String systemPrompt;

private String buildSystemPrompt() {
    return systemPrompt;
}
```

第三步，也是最需要小心的一步——构造器。`ReActAgent` 原本有一串构造器，全都链到一个八参主构造器上。咱们的做法是：新增一个把 `systemPrompt` 塞进去的九参主构造器（唯一真正给字段赋值的地方），再补一个专家友好的五参构造器；老的八参构造器改为委托到九参、传默认人设。

```java
// 专家友好构造器：给一份人设 + 步数/预算即可
public ReActAgent(LlmClient llmClient, ToolRegistry toolRegistry,
                  String systemPrompt, int maxSteps, int maxTokens) {
    this(llmClient, toolRegistry, systemPrompt, maxSteps, maxTokens,
            null, null, null, null);   // 直达九参主构造器
}

// 九参主构造器：systemPrompt 为空时回退默认人设
public ReActAgent(LlmClient llmClient, ToolRegistry toolRegistry,
                  String systemPrompt, int maxSteps, int maxTokens,
                  ChatMemory chatMemory, LongTermMemoryRetriever memoryRetriever,
                  ToolFilter toolFilter, ObservationFolder observationFolder) {
    // ......
    this.systemPrompt = (systemPrompt == null || systemPrompt.isBlank())
            ? DEFAULT_SYSTEM_PROMPT : systemPrompt;
    // ......
}
```

> 这里有个容易踩的坑，专门拎出来说：五参构造器必须**直接**委托到九参主构造器、把人设传下去，绝不能图省事去中转那个八参构造器。因为八参构造器现在会填入 `DEFAULT_SYSTEM_PROMPT`——一旦中转，你辛辛苦苦写的专家人设就被悄悄换成了默认客服话术，而且编译不报错、运行不报错，只是专家表现得没有专业味儿，排查起来很费劲。

改完之后还有个好处：`String` 参数插在第三位，和原来的 `(llm, reg, int, int)`、`(llm, reg, int, int, ChatMemory)` 这些构造器不会有重载歧义（第三个参数一个是 `String` 一个是 `int`，Java 能区分开），所以前面所有篇章的 Demo 调用点原样编译通过，零改动。给核心类做扩展，不改动老代码。

#### 3. SpecialistAgent：复用带人设的 ReActAgent

有了可注入人设的 `ReActAgent`，领域子 Agent 就好办了。`SpecialistAgent` 做的事一句话就能说清：持有一个名字、一张 agent card，和一个用人设加工具子集配好的 `ReActAgent`，把 `run` 委托给它。

```java
public class SpecialistAgent implements Agent {

    private final String name;
    private final String description;
    private final ReActAgent delegate;

    // 便利构造器：给定人设和工具子集，内部建一个带人设的 ReActAgent
    public SpecialistAgent(String name, String description, String persona,
                           LlmClient llmClient, ToolRegistry tools,
                           int maxSteps, int maxTokens) {
        this(name, description,
                new ReActAgent(llmClient, tools, persona, maxSteps, maxTokens));
    }

    public SpecialistAgent(String name, String description, ReActAgent delegate) {
        this.name = name;
        this.description = description;
        this.delegate = delegate;
    }

    @Override public String name() { return name; }
    @Override public String description() { return description; }

    @Override
    public String run(String userMessage) {
        System.out.println("\n>>> [" + name + "] 接手子任务：" + userMessage);
        String result = delegate.run(userMessage);
        System.out.println("<<< [" + name + "] 交回结果");
        return result;
    }
}
```

注意两点。第一，子 Agent 默认不挂会话记忆——它就是个单轮的请求-响应，来一个任务、还一段结果。上一篇说的领域隔离在这儿就体现出来了：每个子 Agent 有自己干净的上下文，商品专家推理时根本看不到售后专家处理过什么。第二，`run()` 里那两行 `>>>` / `<<<` 打印是特意加的边界标记。等会儿主 Agent 调子 Agent、子 Agent 内部又跑自己的 ReAct 循环时，控制台会出现循环套循环，有了这对标记，你一眼就能看出是哪个子 Agent 在干活、从哪儿进、到哪儿出。

`SpecialistAgent` 没有自己的循环、没有自己的工具执行逻辑，全借 `ReActAgent` 的——它只是给这套引擎换了人设、换了工具箱，再挂上一个领域身份。

#### 4. 组建比特严选子 Agent 团队

按上一篇定的三个领域专家，用一个工厂把子 Agent 团队组建出来。划分上守住两条纪律：按人设差异切，不按工具切；每个子 Agent 的工具子集最小充分。

| 子 Agent（name） | 人设关键词 | 工具子集 | 负责场景 |
|-----------|-----------|---------|---------|
| `productSpecialist` | 专业、会对比、有主见的选购顾问 | `compareProducts`、`searchKnowledge` | 规格对比、选购建议、功能咨询 |
| `afterSalesSpecialist` | 严谨、守政策、按流程办事 | `queryOrder`、`queryLogistics`、`applyRefund` | 查订单、查物流、退款换货 |
| `iotSpecialist` | 懂生态、会跨品类组合、算得清组合价 | `recommendBundle`、`searchKnowledge` | IoT 套装推荐、跨品类搭配 |

工厂方法长这样（以商品专家为例，另外两个同构）：

```java
public final class BitMallSpecialists {

    /** 商品咨询专家：专业、会对比、有主见的选购顾问 */
    public static SpecialistAgent product(LlmClient llmClient) {
        ToolRegistry tools = new ToolRegistry();
        tools.register(new CompareProductsTool());
        tools.register(new SearchKnowledgeTool());

        String persona = """
                你是比特严选的选购顾问，专业、懂产品、有主见。
                - 用户要对比商品时，用 compareProducts 拿到两款的结构化规格，再逐项对比，不要凭印象下结论。
                - 需要选购建议、功能介绍、适用人群这类知识性信息时，用 searchKnowledge 检索。
                - 结合用户说的使用场景（通勤、运动、老人用等）给出明确的推荐，别把选择题原样甩回给用户。
                - 回复面向用户，简洁友好，不要暴露工具名、JSON 等内部细节。
                """;

        return new SpecialistAgent(
                "productSpecialist",
                "商品咨询专家：负责商品规格对比、选购建议、功能咨询。用户问某款产品好不好、"
                        + "两款怎么选、参数差异、适合什么人用时找他。",
                persona, llmClient, tools, 8, 6000);
    }

    // afterSales(...)、iot(...) 同理，各自注册自己的工具子集、写自己的人设

    /** 一次性拿到整支子 Agent 团队 */
    public static List<Agent> team(LlmClient llmClient) {
        return List.of(product(llmClient), afterSales(llmClient), iot(llmClient));
    }
}
```

这里有个取舍要交代：知识检索这一槽位，代码里用的是第 5 篇那个 Mock 版 `SearchKnowledgeTool`，好让 Demo 只靠一个 API Key 就能跑起来。正式环境应该换成第 20 篇的向量检索 `RagSearchTool`（需要 pgvector + Embedding），那才是真正把 RAG 当工具用。另外，商品专家和 IoT 专家各自 `new` 一个自己的 `SearchKnowledgeTool` 实例，工具子集之间互不共享，保持隔离。

团队有了，下一步就是：用户的请求进来，怎么让编排者把活派出去、把结果收回来？

### 给团队接上主 Agent

#### 1. 子 Agent 即工具：让架构收敛的同构

概念层说的子 Agent 即工具，这一节来写代码。主 Agent 要能连续跟多个子 Agent 打交道——先问商品专家，看了结果再问 IoT 专家，最后综合。

前面的念头再说一次：主 Agent 反复选择一个对象、调用它、查看结果，再选择下一个，直到收工。这就是 ReAct 循环，只不过被调用的从普通工具换成了子 Agent。

所以关键一步：把子 Agent 包装成工具。只要一个 `Agent` 能被当成 `Tool` 用，主 Agent 就可以是一个普通的 `ReActAgent`，工具箱里装的不是 `queryOrder`、`compareProducts`，而是一个个子 Agent。

```java
public class AgentAsTool implements Tool {

    private final Agent agent;

    public AgentAsTool(Agent agent) {
        this.agent = agent;
    }

    @Override public String name() { return agent.name(); }
    @Override public String description() { return agent.description(); }

    @Override
    public String parameters() {
        return """
                {
                  "type": "object",
                  "properties": {
                    "task": {
                      "type": "string",
                      "description": "交给该子 Agent 处理的完整子任务描述，要自带所有必要上下文（用户原话、涉及的商品名、订单号等），因为子 Agent 看不到主 Agent 这边的对话历史"
                    }
                  },
                  "required": ["task"]
                }""";
    }

    @Override
    public String invoke(String input) {
        String task = ToolUtils.extractRequiredField(input, "task");
        if (task.isBlank()) {
            return ToolUtils.missingRequiredField("task");
        }
        return agent.run(task);
    }
}
```

就这么二十来行。`name()` 和 `description()` 直接透传——agent card 摇身一变成了工具描述，主 Agent 靠它判断该找哪个子 Agent。`invoke()` 把工具入参里的 `task` 取出来，喂给 `agent.run()`，子 Agent 的回答就是这次工具调用的 observation。

![](https://oss.open8gu.com/iShot_2026-07-10_13.44.40.png)

这个同构不是自己拍脑袋想出来的，业界主流框架不约而同都是这么干的：

- **OpenAI Agents SDK** 把它叫 agents as tools——用 `Agent.as_tool()` 把任意 agent 包成一个可调用的工具，由一个 orchestrator 始终掌控对话、调专家做子任务、再综合结果。这和它的另一种模式 handoffs（控制权直接移交给另一个 agent，对应上一篇的去中心化）正好是一对。
- **Anthropic**《Building Effective Agents》里的 orchestrator-workers：一个中央 LLM 动态拆解任务、分派给 worker、再综合它们的结果。
- **LangGraph** 的 supervisor：官方的说法就是 a supervisor agent utilizes other agents as tools，专家把结果回报给 supervisor 决策；它甚至在较新的版本里建议直接用 tools 的方式实现 supervisor，而不必套专门的库。

三家框架，剥开外壳核心是同一个：子 Agent 即工具。咱们手写一遍，就能看清这个同构有多省事——不用为主 Agent 另写循环，复用 `ReActAgent` 就行。

#### 2. LLM Supervisor：agent card 循环选择

有了 `AgentAsTool`，LLM Supervisor（编排者）几乎是免费的。构造它只需三步：把每个子 Agent 用 `AgentAsTool` 包成工具、塞进一个 `ToolRegistry`、再用一份编排者人设构造一个 `ReActAgent`。

```java
public class SupervisorAgent implements Agent {

    private static final String SUPERVISOR_PERSONA = """
            你是比特严选的客服编排者（Orchestrator）。你自己不查订单、不比价、不回答专业问题，
            你的职责是调度团队里的领域子 Agent，并把它们的结论综合成一段面向用户的完整回复。
            你的每一个工具背后都是一个领域子 Agent，也就是一位领域专家，工具描述说明了它擅长什么。

            工作方式：
            - 先分析用户请求涉及哪些领域。一个请求可能横跨多个领域（比如既要对比商品、又要搭配推荐）。
            - 把每个子任务交给对口的子 Agent：调用对应的工具，task 参数里写清这个子任务，
              并带上所有必要上下文（用户原话、涉及的商品名、订单号、预算等）。子 Agent 看不到你这边的对话，
              上下文没给全它就办不了。
            - 无依赖的子任务可以分别派给不同子 Agent；需要前一步结果的子任务，等结果回来再派下一个。
            - 收齐所有子 Agent 的结果后，你负责核对、去重、消解可能的冲突，综合成一段自然、连贯的回复。
            - 不要把子 Agent 返回的原始 JSON、工具名、内部处理过程暴露给用户。

            重要：当所有子任务都已由子 Agent 完成、你已经能给出完整答复时，直接输出面向用户的最终回复，
            不要再调用任何子 Agent。不要为了同一个子任务重复调用同一个子 Agent。
            """;

    private static final String DEFAULT_NAME = "supervisor";
    private static final String DEFAULT_DESCRIPTION =
            "比特严选客服编排者：把用户请求分诊给匹配的子 Agent，收齐结果后综合成完整回复。";

    private final String name;
    private final String description;
    private final ReActAgent delegate;

    public SupervisorAgent(String name, String description,
                           LlmClient llmClient, List<Agent> specialists,
                           int maxSteps, int maxTokens) {
        this.name = name;
        this.description = description;
        ToolRegistry team = new ToolRegistry();
        for (Agent specialist : specialists) {
            team.register(new AgentAsTool(specialist));   // 每个子 Agent 包成一个工具
        }
        this.delegate = new ReActAgent(llmClient, team,
                SUPERVISOR_PERSONA, maxSteps, maxTokens); // 主 Agent 就是一个带人设的 ReActAgent
    }

    // 便利构造器：单层主 Agent 直接用默认 name 和 description
    public SupervisorAgent(LlmClient llmClient, List<Agent> specialists,
                           int maxSteps, int maxTokens) {
        this(DEFAULT_NAME, DEFAULT_DESCRIPTION, llmClient, specialists, maxSteps, maxTokens);
    }

    @Override public String name() { return name; }
    @Override public String description() { return description; }

    @Override
    public String run(String userMessage) {
        System.out.println("\n########## 编排者接手请求：" + userMessage);
        return delegate.run(userMessage);
    }
}
```

注意 `SupervisorAgent` 自己也实现了 `Agent`，而且 `name` 和 `description` 都可以通过六参构造器自定义。这意味着一个编排者也可以作为更高层主 Agent 的子 Agent，被包装成工具（只要给不同的 `name`，就不会在 `ToolRegistry` 里冲突），架构能向上嵌套成上一篇说的混合式（团队的团队）。同构一旦成立，扩展性就是白给的。

它的运行时序是这样的，注意主 Agent 的循环里嵌套着子 Agent 自己的循环：

![](https://oss.open8gu.com/iShot_2026-07-10_13.44.41.png)

几个点展开说说：

所谓 agent card 循环选择直到 done，说白了就是复用 ReAct 循环。主 Agent 每一圈读工具描述（也就是各子 Agent 的 agent card）、挑一个子 Agent 调用、拿到结果作为 observation、再决定下一步；当它判断所有子任务都办完、不再调任何子 Agent、直接输出文本时，`ReActAgent` 的循环就自然收尾返回。一行新循环都没写。

编排者这一步综合，就是上一篇说的中央校验瓶颈。子 Agent 的输出不是直接甩给用户，而是先回到编排者手里，由它核对、去重、消解冲突，再综合成一段回复。上一篇引 DeepMind 论文的数据：无监管的独立架构错误放大到 17.2 倍，有中央校验的主从式只有 4.4 倍——这个校验环节就是主从式的护城河，落到代码里就是主 Agent 的 `run` 最后那次不带工具调用的综合输出。

那 `ReActAgent` 里的重复检测会不会误伤主 Agent？不会。第 9 篇写的 `RepeatDetector` 是按函数名加参数算调用签名的：主 Agent 先调 `productSpecialist` 再调 `iotSpecialist`，函数名不同，签名不同，不算重复；哪怕主 Agent 两次都调同一个子 Agent、但 `task` 不一样，参数不同，签名也不同，照样放行。只有当主 Agent 一字不差地重复同一个调用才会触发提醒和强制停止——而这正好是我们想要的兜底，防止主 Agent 卡在原地空转。连兜底都复用了。

LLM Supervisor 的账也得算清楚：

| 维度 | 优势 | 代价 |
|------|------|------|
| 复合请求 | 能把一句话拆成多个子任务，依次编排多个子 Agent | —— |
| 结果整合 | 有中央综合 + 校验环节，错误可控 | —— |
| 灵活性 | 拆几个子任务、找谁、什么顺序，运行时动态决定 | 路径不确定，调试时不如单体好复现 |
| 成本 | —— | 主 Agent 每一圈都要读全部 agent card + 历史，token 和延迟都涨 |
| 上限 | —— | 高度依赖主 Agent 的分诊质量和综合质量，分诊错了后面白搭 |

选型思路还是那把奥卡姆剃刀：单体够用的场景，别急着上 Supervisor。查询订单 88231 进度这种单域请求，一个 `ReActAgent` 自己就能办完，没必要启动主 Agent 的编排流程。只有当请求确实横跨多个领域、需要人统筹和对齐多方结果时，才值得让编排者多绕几圈。

### Demo：完整运行

把主 Agent 和子 Agent 团队串到一个 Demo 里跑起来：

```java
public class MultiAgentSupervisorDemo {

    public static void main(String[] args) {
        Properties dotEnv = loadDotEnv();
        LlmClient llmClient = new LlmClient(
                setting(dotEnv, "TINYAGENT_API_URL",
                        "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions"),
                requiredSetting(dotEnv, "TINYAGENT_API_KEY"),
                setting(dotEnv, "TINYAGENT_MODEL", "qwen-plus"));

        // 组建一支子 Agent 团队（商品咨询 / 售后服务 / IoT 搭配）
        List<Agent> team = BitMallSpecialists.team(llmClient);

        // LLM Supervisor——跨品类复合请求，主 Agent 循环调多个子 Agent 再综合
        System.out.println("========== LLM Supervisor（跨品类，对比 + 搭配） ==========");
        SupervisorAgent supervisor = new SupervisorAgent(llmClient, team, 8, 8000);
        String answer = supervisor.run(
                "比特 AirX 真无线耳机 和 比特 BandPro 头戴式耳机 哪个好？我通勤用；"
                        + "另外我买了比特 Phone S1 手机，想配一套运动装备，预算 3000");
        System.out.println("\n[最终回复] " + answer);
    }

    // loadDotEnv()、requiredSetting()、setting() 与前几篇一致，省略
}
```

控制台输出（大模型措辞每次会有细微差异，长 JSON 已省略，可以看到主 Agent 的循环里嵌套着子 Agent 各自的循环）：

```text
========== LLM Supervisor（跨品类，对比 + 搭配） ==========
########## 编排者接手请求：比特 AirX 真无线耳机 和 比特 BandPro 头戴式耳机 哪个好？我通勤用；另外……

===== 第 1 圈 =====                              <- 主 Agent 的循环
[工具调用] productSpecialist({"task":"对比比特 AirX 真无线耳机和比特 BandPro 头戴式耳机，用户通勤用，给出推荐"})

  >>> [productSpecialist] 接手子任务：对比比特 AirX……用户通勤用……
  ===== 第 1 圈 =====                            <- 商品子 Agent 自己的循环
  [工具调用] compareProducts({"productA":"比特 AirX 真无线耳机","productB":"比特 BandPro 头戴式耳机"})
  [工具结果] {"productA":{...399 元 IPX4 主动降噪...},"productB":{...699 元 头戴 Hi-Res...}}
  ===== 第 2 圈 =====
  [最终答复] 通勤场景更推荐 AirX：入耳式更便携、IPX4 防汗、主动降噪……
  <<< [productSpecialist] 交回结果
[工具结果] 通勤场景更推荐 AirX：入耳式更便携、IPX4 防汗……

===== 第 2 圈 =====                              <- 主 Agent 的循环，继续派下一个子 Agent
[工具调用] iotSpecialist({"task":"用户已购比特 Phone S1 手机，想配一套运动装备，预算 3000，给搭配方案"})

  >>> [iotSpecialist] 接手子任务：用户已购比特 Phone S1……预算 3000……
  ===== 第 1 圈 =====                            <- IoT 子 Agent 自己的循环
  [工具调用] recommendBundle({"baseProduct":"比特 Phone S1 手机","budget":3000,"preferences":"运动"})
  [工具结果] {"bundles":[{"name":"运动健康套装","items":[...],"bundlePrice":2799,"saving":198,...}]}
  ===== 第 2 圈 =====
  [最终答复] 推荐运动健康套装：Phone S1 + WatchFit 手表 + AirX 耳机，组合价 2799 元，省 198……
  <<< [iotSpecialist] 交回结果
[工具结果] 推荐运动健康套装：Phone S1 + WatchFit 手表 + AirX 耳机，组合价 2799 元……

===== 第 3 圈 =====                              <- 编排者收齐结果，综合输出
[最终答复] 帮您梳理两件事：① 耳机方面，通勤更推荐 AirX……；② 搭配方面，运动健康套装 2799 元……

[最终回复] 帮您梳理两件事：① 耳机方面，通勤更推荐 AirX……；② 搭配方面，运动健康套装 2799 元……
```

主 Agent 第 1 圈派商品子 Agent、第 2 圈派 IoT 子 Agent（两个子任务无依赖，本可以并行，这里先按顺序讲清）、第 3 圈自己不再调任何子 Agent，把两份结果综合成一段面向用户的完整回复。每个子 Agent 的 `>>>`/`<<<` 之间是它独立的循环，上下文互相隔离——商品子 Agent 不知道 IoT 子 Agent 干了啥，全靠编排者在最后把两条线拧到一起。

### 文末总结

这一篇把主从式多智能体的骨架从零搭了出来：

- 一个 `Agent` 接口（`name` / `description` / `run`）把单体 Agent、子 Agent、主 Agent 统一到同一个壳里，`description` 就是分诊和编排要用的 agent card。
- `ReActAgent` 一处小改动——把写死的人设变成可注入的 `systemPrompt`，子 Agent 就能各有各的人格，老代码零改动。坑在人设构造器必须直达主构造器，别中转到会填默认人设的老构造器。
- `SpecialistAgent` 复用带人设的 `ReActAgent` 加一层领域身份，成为一个领域子 Agent，领域隔离就落地了。
- LLM Supervisor 能编排多个子 Agent、有中央综合与校验，专治跨品类复合请求。选型还是奥卡姆剃刀——单体够用就别上 Supervisor。
- 子 Agent 即工具的同构是让这一切收敛的关键——把子 Agent 包成 `AgentAsTool`，主 Agent 就是一个普通的 `ReActAgent`，连重复检测这种兜底都免费复用。OpenAI 的 agents as tools、Anthropic 的 orchestrator-workers、LangGraph 的 supervisor 都是这个路子。

不过你可能已经从转录里发现了一些问题：用户通勤、预算 3000 这些上下文，是靠编排者自己在 `task` 里转述给子 Agent 的——万一它转述时漏了预算呢？子 Agent 彼此隔离、只认自己拿到的那段 `task`，会不会出现两个领域专家各说各话、结论打架？主 Agent 每一圈都要把所有 agent card 和历史重读一遍，token 会不会又爆？

这些就是上一篇预告过的主从式头号痛点——上下文割裂与通信带宽两难。下一篇，咱们就来破它：共享黑板 `AgenticScope`、消息传递 `MessageHub`、结果聚合与依赖 handoff，让子 Agent 之间既不重复劳动、也不各执一词。

