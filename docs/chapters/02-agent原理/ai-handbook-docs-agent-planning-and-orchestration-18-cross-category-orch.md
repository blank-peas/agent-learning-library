# 商品对比

> **资料来源**：[AI Handbook](https://github.com/nageoffer/ai-handbook) · 原文件：`docs/agent/planning-and-orchestration/18-cross-category-orchestration.md`。

上一篇实现了 TinyAgent 的技能系统——`activate_skill` 加载 SKILL.md 指令到主上下文，技能专属工具动态注入，LLM 在指令引导下按步骤执行。结尾留了一个悬念：之前的例子一直在处理单品类的需求，退一台扫地机、查一个订单。如果用户的一句话横跨多个品类，涉及对比、搭配、售后多种任务类型，TinyAgent 现有的能力能接得住吗？

这一篇就来回答这个问题。用跨品类场景来验证 Tool、Skill 和 Plan-and-Execute 的组合编排能力——对比 + 搭配 + 售后一起跑。

> 本项目中具体代码已上传 GitHub [TinyAgent](https://github.com/nageoffer/tinyagent)，大家 Clone 项目后，将代码分支切换到 1.12.x，默认主分支是最新代码。运行前复制 `.env.example` 为 `.env`，把自己的 API Key 填进去，默认阿里云百炼平台；`.env` 已加入 `.gitignore`，切分支时不会丢。

### 单品类够了，跨品类才是真考验

#### 1. 比特严选的跨品类特性

回顾一下比特严选的品类结构：手机、平板电脑、笔记本、智能穿戴（手表、手环、耳机）、智能家居（扫地机、智能音箱、摄像头等）、影音配件——6 大品类，300-500 个 SKU。

之前的 Demo 都在同一个品类内打转：退扫地机走退款技能，查订单走查询技能，推荐扫地机搜知识库。但比特严选的核心竞争力不在单品类——而在跨品类的 IoT 生态体验。用户的真实需求经常是这样的：

> 比特 AirX 耳机和 BandPro 耳机哪个好？我主要通勤用。另外我手机是比特 Phone S1，想配一套运动装备，预算 1000 以内。顺便帮我查一下订单 88231 到了没。

一句话包含了三个子任务：

- **商品对比**：耳机品类内的规格对比（AirX vs BandPro）
- **IoT 搭配推荐**：基于已有手机，跨品类推荐智能穿戴设备组合
- **订单查询**：查一个订单的物流状态

三个子任务涉及智能穿戴、手机、售后三个领域，调用的工具也不一样——对比要用 `compareProducts`，搭配推荐要用 `recommendBundle`，查订单要用 `queryOrder`。更关键的是，这三个子任务之间没有依赖关系，可以按任意顺序执行。

#### 2. 现有能力够不够

TinyAgent 目前有三种执行能力：ReAct（单步推理）、Skill（指令驱动执行）、Plan-and-Execute（动态规划）。面对上面这个跨品类需求，每种能力各有擅长和短板：

| 能力 | 能不能做 | 怎么做 | 问题在哪 |
|------|---------|-------|---------|
| ReAct | 能 | 一步一步推理，先对比、再推荐、再查订单 | 三个独立任务混在一条推理链里，容易遗漏后面的子任务 |
| ReAct + Skill | 能 | 激活对比技能完成对比，再激活搭配技能完成推荐，最后查订单 | 连续激活多个技能会导致指令堆叠，上下文膨胀 |
| Plan-and-Execute | 能 | Planner 一次性拆解三个子任务，Executor 逐步执行 | 最稳，总 LLM 调用反而更少（后文有详细对比） |

用一句话概括：**单子任务用 ReAct + Skill 足够；跨品类复合任务用 Plan-and-Execute 更可靠**。

这不是理论推导——下面用代码和实际执行轨迹来验证。但在跑 Demo 之前，先要给 TinyAgent 补两个跨品类才需要的工具。

### 新增两个跨品类工具

之前 TinyAgent 只有 5 个基础工具：`queryOrder`、`queryLogistics`、`applyRefund`、`searchKnowledge`、`getCurrentTime`。这些工具覆盖了订单和售后场景，但做不了商品规格对比和 IoT 搭配推荐。现在要补两个：

#### 1. CompareProductsTool：商品规格对比

用户问比特 AirX 耳机和 BandPro 耳机哪个好时，Agent 需要拿到两个商品的详细规格参数才能做对比分析。`searchKnowledge` 返回的是粗粒度的产品简介，不够对比用——对比需要精确到续航时间、重量、降噪方式这些具体参数。

```java
public class CompareProductsTool implements Tool {

    private static final Map<String, String> PRODUCTS = new LinkedHashMap<>();

    static {
        PRODUCTS.put("比特 AirX 真无线耳机",
                "{\"name\":\"比特 AirX 真无线耳机\",\"category\":\"智能穿戴\","
                + "\"price\":399,\"type\":\"真无线入耳式\","
                + "\"noiseCancelling\":\"主动降噪 ANC\","
                + "\"battery\":\"单次 8 小时，总续航 30 小时\","
                + "\"weight\":\"5.2g（单耳）\",\"waterproof\":\"IPX4\","
                + "\"features\":\"蓝牙 5.3，通话降噪，触控操作，支持快充\"}");
        PRODUCTS.put("比特 BandPro 头戴式耳机",
                "{\"name\":\"比特 BandPro 头戴式耳机\",\"category\":\"智能穿戴\","
                + "\"price\":699,\"type\":\"头戴式包耳\","
                + "\"noiseCancelling\":\"混合主动降噪 + 通透模式\","
                + "\"battery\":\"40 小时\","
                + "\"weight\":\"258g\",\"waterproof\":\"无\","
                + "\"features\":\"Hi-Res 认证，可折叠，3.5mm 有线模式，多设备连接\"}");
        PRODUCTS.put("比特 Phone S1 手机",
                "{\"name\":\"比特 Phone S1 手机\",\"category\":\"手机\","
                + "\"price\":1999,\"screenSize\":\"6.7 英寸 AMOLED\","
                + "\"processor\":\"骁龙 7 Gen3\","
                + "\"ram\":\"12GB\",\"storage\":\"256GB\","
                + "\"battery\":\"5000mAh\","
                + "\"features\":\"120Hz 刷新率，NFC，红外遥控\"}");
        PRODUCTS.put("比特 WatchFit 智能手表",
                "{\"name\":\"比特 WatchFit 智能手表\",\"category\":\"智能穿戴\","
                + "\"price\":599,\"screenSize\":\"1.82 英寸 AMOLED\","
                + "\"battery\":\"典型使用 14 天\",\"waterproof\":\"5ATM\","
                + "\"features\":\"心率血氧监测，100+ 运动模式，"
                + "NFC 公交支付，消息通知\"}");
        // ...... 更多商品
    }

    @Override
    public String name() { return "compareProducts"; }

    @Override
    public String description() {
        return "对比两个比特严选商品的规格参数，"
                + "返回两者的详细规格信息供对比分析。";
    }

    @Override
    public String parameters() {
        return """
                {
                  "type": "object",
                  "properties": {
                    "productA": {
                      "type": "string",
                      "description": "第一个商品名称，如 比特 AirX 真无线耳机"
                    },
                    "productB": {
                      "type": "string",
                      "description": "第二个商品名称，如 比特 BandPro 头戴式耳机"
                    }
                  },
                  "required": ["productA", "productB"]
                }""";
    }

    @Override
    public String invoke(String input) {
        String nameA = ToolUtils.extractRequiredField(input, "productA");
        if (nameA.isBlank()) {
            return ToolUtils.missingRequiredField("productA");
        }
        String nameB = ToolUtils.extractRequiredField(input, "productB");
        if (nameB.isBlank()) {
            return ToolUtils.missingRequiredField("productB");
        }

        String specA = fuzzyMatch(nameA);
        String specB = fuzzyMatch(nameB);

        if (specA == null && specB == null) {
            return "{\"error\":" + ToolUtils.toJsonString(
                    "未找到商品：" + nameA + " 和 " + nameB) + "}";
        }
        if (specA == null) {
            return "{\"error\":" + ToolUtils.toJsonString(
                    "未找到商品：" + nameA) + ",\"productB\":" + specB + "}";
        }
        if (specB == null) {
            return "{\"error\":" + ToolUtils.toJsonString(
                    "未找到商品：" + nameB) + ",\"productA\":" + specA + "}";
        }
        return "{\"productA\":" + specA + ",\"productB\":" + specB + "}";
    }

    // fuzzyMatch：模糊匹配商品名，兼容用户简写
    // ......
}
```

`PRODUCTS` 是一个静态 Map，存放比特严选商品的规格 Mock 数据——实际项目中这部分应该对接商品数据库。关键设计点：

**入参是两个商品名，返回两者的完整规格 JSON**。Agent 拿到结构化的规格数据后，自己做对比分析和推荐——对比逻辑由 LLM 完成，工具只负责提供数据。这种职责分离和 RAG 系列里的检索增强生成是同一个思路：工具提供事实，LLM 做推理。

**模糊匹配兼容简写**。用户说 AirX 耳机而不是比特 AirX 真无线耳机，`fuzzyMatch` 方法用关键词拆分匹配来处理。

#### 2. RecommendBundleTool：IoT 搭配推荐

用户说想给手机配一套运动装备时，Agent 需要知道有哪些搭配组合可选、每个组合包含什么、组合价多少。这个工具根据基础商品推荐跨品类搭配方案：

```java
public class RecommendBundleTool implements Tool {

    @Override
    public String name() { return "recommendBundle"; }

    @Override
    public String description() {
        return "根据用户已有或感兴趣的商品，推荐 IoT 生态搭配组合"
                + "（手机 + 手表 + 音箱等跨品类组合），"
                + "返回搭配方案和组合价。";
    }

    @Override
    public String parameters() {
        return """
                {
                  "type": "object",
                  "properties": {
                    "baseProduct": {
                      "type": "string",
                      "description": "用户已有或感兴趣的基础商品名称"
                    },
                    "budget": {
                      "type": "number",
                      "description": "搭配总预算（元），可选"
                    },
                    "preferences": {
                      "type": "string",
                      "description": "用户偏好描述，如 运动健康监测、全屋智能控制"
                    }
                  },
                  "required": ["baseProduct"]
                }""";
    }

    @Override
    public String invoke(String input) {
        String baseProduct =
                ToolUtils.extractRequiredField(input, "baseProduct");
        if (baseProduct.isBlank()) {
            return ToolUtils.missingRequiredField("baseProduct");
        }

        // 根据基础商品匹配搭配方案
        if (baseProduct.contains("Phone") || baseProduct.contains("手机")) {
            return "{\"baseProduct\":\"比特 Phone S1 手机\","
                + "\"bundles\":["
                + "{\"name\":\"运动健康套装\","
                + "\"items\":[\"比特 Phone S1 手机（¥1999）\","
                + "\"比特 WatchFit 智能手表（¥599）\","
                + "\"比特 AirX 真无线耳机（¥399）\"],"
                + "\"totalPrice\":2997,\"bundlePrice\":2799,"
                + "\"saving\":198,"
                + "\"scenario\":\"手机接收手表的运动和健康数据，"
                + "耳机连接手机听歌跑步\"},"
                + "{\"name\":\"全屋智能套装\","
                + "\"items\":[\"比特 Phone S1 手机（¥1999）\","
                + "\"比特 SoundBox Mini 智能音箱（¥299）\","
                + "\"比特 WatchFit 智能手表（¥599）\"],"
                + "\"totalPrice\":2897,\"bundlePrice\":2699,"
                + "\"saving\":198,"
                + "\"scenario\":\"手机作为智能家居控制中心，"
                + "音箱做语音控制入口，手表随身提醒\"}"
                + "]}";
        }
        // ...... 其他商品的搭配方案
    }
}
```

返回的 JSON 里每个搭配方案包含四个关键信息：**包含商品（items）、原价（totalPrice）、组合价（bundlePrice）、适用场景（scenario）**。这些结构化数据给了 LLM 足够的素材来做推荐——LLM 可以根据用户的预算和偏好从多个方案中筛选。

> 注意一个细节：`bundlePrice` 包含了基础商品（如手机）的价格，但用户可能已经拥有基础商品，不需要重复购买。LLM 需要结合对话上下文判断哪些商品用户已有，再做预算计算——这也是工具只提供数据、推理交给 LLM 的好处。

#### 3. 工具全景

加上新增的两个工具，TinyAgent 现在有 7 个基础工具：

| 工具名 | 品类覆盖 | 职责 |
|-------|---------|------|
| `queryOrder` | 订单/售后 | 查订单详情 |
| `queryLogistics` | 订单/售后 | 查物流轨迹 |
| `applyRefund` | 订单/售后 | 申请退款 |
| `searchKnowledge` | 全品类 | 检索知识库（产品信息、政策） |
| `getCurrentTime` | 通用 | 获取当前时间 |
| `compareProducts` | 跨品类 | 对比两个商品的规格参数 |
| `recommendBundle` | 跨品类 | 推荐 IoT 搭配组合 |

前 5 个是之前就有的，后 2 个是本篇新增的。`searchKnowledge` 是粗粒度的知识检索（返回产品简介和政策文档），`compareProducts` 是细粒度的规格对比（返回详细参数 JSON），两者不冲突——知识检索用于回答用户扫地机推荐这类开放问题，规格对比用于 A vs B 这类明确的对比需求。

### 新增两个跨品类技能

有了工具，还要给它们配上技能——这样 ReAct + Skill 模式下，LLM 可以按预定义的流程执行对比和搭配推荐，而不是自己临时决定步骤。

#### 1. product-comparison：商品对比技能

```markdown
<!-- resources/skills/product-comparison.md -->
---
name: product-comparison
description: >
  商品对比技能：查询两个商品的详细规格参数并进行对比分析，
  给出结构化的对比结论和购买建议。适用于用户要求对比两个商品、
  不知道选哪个的场景。
tools:
  - compareProducts
---

## 商品对比

### 概述

你是比特严选的选购顾问。当用户要求对比两个商品时，按照以下流程处理。

### 处理步骤

#### Step 1: 对比商品规格
使用 compareProducts 查询两个商品的详细规格参数。

#### Step 2: 给出对比结论
根据返回的规格数据，从以下维度进行对比分析：
- 价格差异
- 核心功能差异（针对品类特点选择关键维度）
- 各自适合的使用场景

### 输出要求
给出清晰的对比表格或分点说明，最后根据用户提到的需求偏好
给出购买建议。如果用户没有明确偏好，列出两者各自的优势场景
让用户自行选择。
```

这个技能只声明了一个专属工具 `compareProducts`——对比场景只需要这一个。技能指令要求 LLM 从价格、核心功能、使用场景三个维度做对比分析，这比让 LLM 自由发挥更有结构感，输出质量也更稳定。

#### 2. iot-bundle：IoT 搭配推荐技能

```markdown
<!-- resources/skills/iot-bundle.md -->
---
name: iot-bundle
description: >
  IoT 搭配推荐技能：根据用户已有或感兴趣的商品，推荐跨品类 IoT 生态
  搭配组合，包含组合价和使用场景说明。适用于用户提到搭配、套装、组合、
  生态等需求的场景。
tools:
  - recommendBundle
---

## IoT 搭配推荐

### 概述

你是比特严选的 IoT 生态顾问。当用户想了解商品搭配方案时，
按照以下流程处理。

### 处理步骤

#### Step 1: 获取搭配方案
使用 recommendBundle 查询基于用户已有或感兴趣商品的搭配组合方案。
如果用户提到了预算，传入 budget 参数。
如果用户提到了使用偏好（如运动健康、全屋智能），传入 preferences 参数。

#### Step 2: 给出搭配建议
根据返回的搭配方案，说明每个组合包含哪些商品、组合价省多少、
适合什么场景。

### 输出要求
列出推荐的搭配方案，每个方案说清楚包含商品、原价、组合价、省多少钱、
适合什么场景。如果有多个方案，根据用户偏好排序推荐。
```

#### 3. 技能全景

加上新增的两个，TinyAgent 现在有 4 个技能：

| 技能名 | 专属工具 | 适用场景 |
|-------|---------|---------|
| `process-refund` | `queryOrder`、`applyRefund` | 退款处理 |
| `order-inquiry` | `queryOrder`、`queryLogistics` | 订单全流程查询 |
| `product-comparison` | `compareProducts` | 商品对比 |
| `iot-bundle` | `recommendBundle` | IoT 搭配推荐 |

4 个技能覆盖了比特严选客服的四大高频场景。注意 `queryOrder` 同时出现在 `process-refund` 和 `order-inquiry` 两个技能里——上一篇讲过，`DynamicToolProvider` 注入时会去重，不会在 LLM 可见列表里出现两次。

现在 LLM 初始可见的工具列表变成了 3 个：`searchKnowledge`、`getCurrentTime`、`activate_skill`——通用工具不变，`activate_skill` 的 description 里多了两个技能的说明。7 个基础工具中，除 `searchKnowledge` 和 `getCurrentTime` 外的 5 个都被至少一个技能声明为专属工具，激活前不可见。

下面这张图把工具和技能的可见性机制画清楚了——左边是 LLM 一开始就能看到的 3 个工具，右边是被 4 个技能封装起来的 5 个专属工具，中间的 `activate_skill` 是唯一的桥梁：

![](https://oss.open8gu.com/iShot_2026-07-10_13.44.15.png)

### 场景一：ReAct + Skill 跑单任务

先用最简单的方式验证新工具和新技能是否工作——ReAct + Skill 模式处理单个跨品类任务。

#### 1. 耳机对比

```java
// CrossCategoryDemo.java（简化）
ToolRegistry toolRegistry = new ToolRegistry();
toolRegistry.register(new QueryOrderTool());
toolRegistry.register(new QueryLogisticsTool());
toolRegistry.register(new ApplyRefundTool());
toolRegistry.register(new SearchKnowledgeTool());
toolRegistry.register(new GetCurrentTimeTool());
toolRegistry.register(new CompareProductsTool());    // 新增
toolRegistry.register(new RecommendBundleTool());    // 新增

SkillRegistry skillRegistry = new SkillRegistry();
skillRegistry.loadFromDirectory(Path.of("src/main/resources/skills"));

ToolRegistry agentTools = skillRegistry.buildAgentRegistry(toolRegistry);

ReActAgent reactAgent = new ReActAgent(llmClient, agentTools, 10, 8000);

// 耳机对比
String answer = reactAgent.run(
        "比特 AirX 耳机和 BandPro 耳机哪个好？我主要通勤用");
```

预期执行轨迹：

```text
[SkillRegistry] 加载技能：process-refund（process-refund.md）
[SkillRegistry] 加载技能：order-inquiry（order-inquiry.md）
[SkillRegistry] 加载技能：product-comparison（product-comparison.md）
[SkillRegistry] 加载技能：iot-bundle（iot-bundle.md）
[SkillRegistry] 技能专属工具（激活前不可见）：
  [queryOrder, applyRefund, queryLogistics, compareProducts, recommendBundle]

========== 场景 1：耳机对比（ReAct + Skill） ==========

===== 第 1 圈 =====
[工具调用] activate_skill({"name":"product-comparison"})
[Skill] 激活技能：product-comparison，解锁工具：[compareProducts]
[动态工具] 解锁 1 个技能专属工具：[compareProducts]

===== 第 2 圈 =====
[工具调用] compareProducts({"productA":"比特 AirX 真无线耳机",
  "productB":"比特 BandPro 头戴式耳机"})
[工具结果] {"productA":{"name":"比特 AirX 真无线耳机","price":399,
  "type":"真无线入耳式","battery":"单次 8 小时，总续航 30 小时",
  "weight":"5.2g（单耳）","waterproof":"IPX4",...},
  "productB":{"name":"比特 BandPro 头戴式耳机","price":699,
  "type":"头戴式包耳","battery":"40 小时","weight":"258g",...}}

===== 第 3 圈 =====
[最终答复] 两款耳机各有优势，以下是对比分析：

| 维度 | AirX 真无线 | BandPro 头戴式 |
|------|-----------|-------------|
| 价格 | ¥399 | ¥699 |
| 佩戴方式 | 入耳式，轻便 | 包耳式，舒适但较重 |
| 续航 | 总续航 30 小时 | 40 小时 |
| 降噪 | 主动降噪 ANC | 混合降噪 + 通透模式 |
| 防水 | IPX4 | 无 |

通勤推荐：AirX 真无线耳机。理由是轻便便携、IPX4 防水防汗、
价格更友好，通勤场景下入耳式比头戴式方便很多。
```

LLM 的行为完全符合预期：识别到对比需求 → 激活 `product-comparison` 技能 → 调 `compareProducts` 拿到规格数据 → 按技能指令的三个维度做对比分析 → 结合用户的通勤偏好给出推荐。整个过程 3 圈搞定。

#### 2. IoT 搭配推荐

```java
String answer = reactAgent.run(
        "我刚买了比特 Phone S1，想配一些智能设备，主要想运动时用");
```

预期执行轨迹：

```text
===== 第 1 圈 =====
[工具调用] activate_skill({"name":"iot-bundle"})
[Skill] 激活技能：iot-bundle，解锁工具：[recommendBundle]
[动态工具] 解锁 1 个技能专属工具：[recommendBundle]

===== 第 2 圈 =====
[工具调用] recommendBundle({"baseProduct":"比特 Phone S1 手机",
  "preferences":"运动"})
[工具结果] {"baseProduct":"比特 Phone S1 手机","bundles":[
  {"name":"运动健康套装",
   "items":["比特 Phone S1 手机（¥1999）","比特 WatchFit 智能手表（¥599）",
            "比特 AirX 真无线耳机（¥399）"],
   "totalPrice":2997,"bundlePrice":2799,"saving":198,
   "scenario":"手机接收手表的运动和健康数据，耳机连接手机听歌跑步"},
  {"name":"全屋智能套装",...}]}

===== 第 3 圈 =====
[最终答复] 配合您的比特 Phone S1，推荐运动健康套装：
- 比特 WatchFit 智能手表（¥599）：记录运动数据，心率血氧监测
- 比特 AirX 真无线耳机（¥399）：运动时听歌，IPX4 防汗
- 套装组合价 ¥2799（省 ¥198）
三件设备互联：手表记录运动数据同步到手机，耳机连接手机听歌跑步。
```

LLM 准确地识别了搭配需求，激活了 `iot-bundle` 技能，还把用户的运动偏好传入了 `preferences` 参数，最终从两个方案中筛选了更匹配的运动健康套装。

两个单任务场景都跑通了。ReAct + Skill 在单品类和单跨品类任务上表现稳定——激活一个技能，按指令走完流程，3 圈搞定。

### 场景二：Plan-and-Execute 跑复合任务

现在来真正的考验——一句话包含三个跨品类子任务。

#### 1. 为什么不用 ReAct + Skill

先想一下 ReAct + Skill 处理这个复合任务会怎么走。用户说：

> 帮我对比一下比特 AirX 耳机和 BandPro 耳机，另外我买的比特 Phone S1 手机想配一套运动装备，预算 1000 以内，顺便帮我查一下订单 88231 到了没。

LLM 初始可见 4 个工具：`searchKnowledge`、`getCurrentTime`、`activate_skill`。它需要：

1. 激活 `product-comparison`，调 `compareProducts`，完成对比
2. 激活 `iot-bundle`，调 `recommendBundle`，完成搭配推荐
3. 激活 `order-inquiry`，调 `queryOrder`，完成订单查询

这意味着 LLM 要在一次 `run()` 里连续激活三个技能。上一篇的进阶思考部分提过：**连续激活多个技能会导致指令堆叠**。三个技能的 Markdown 指令加起来约 1500-2000 Token，全部进入主上下文后，LLM 可能搞混不同技能的步骤——对比技能要求使用 `compareProducts`，搭配技能要求使用 `recommendBundle`，LLM 面对两份同时生效的指令，选择正确工具的难度显著上升。

更麻烦的是，上一篇提到 `dynamicToolMap` 是 `run()` 的局部变量，每次 `run()` 调用独立。所以在同一次 `run()` 内，三个技能的专属工具会逐步叠加到可见列表——第一个技能解锁 `compareProducts`，第二个再解锁 `recommendBundle`，第三个再解锁 `queryOrder` 和 `queryLogistics`。这在技术上是可行的，但 LLM 看到一堆工具和一堆指令，决策质量容易下降。

ReAct + Skill 更适合一次一技能的场景。多技能协作，还是交给 Plan-and-Execute。

#### 2. Plan-and-Execute 的优势

Plan-and-Execute 处理这个场景的方式完全不同——它不走技能路径，而是直接用基础工具：

```java
// 场景 3：跨品类复合任务
PlanAndExecuteAgent planAgent =
        new PlanAndExecuteAgent(llmClient, toolRegistry, 2);

String answer = planAgent.run(
        "帮我对比一下比特 AirX 耳机和 BandPro 耳机，"
        + "另外我买的比特 Phone S1 手机想配一套运动装备，预算 1000 以内，"
        + "顺便帮我查一下订单 88231 到了没");
```

注意这里传入的是 `toolRegistry`（全量注册表，7 个基础工具全部可见），而不是 `agentTools`（经过技能过滤的注册表）。**Plan-and-Execute 不需要技能——Planner 自己拆步骤，Executor 直接调基础工具**。

这一点很重要。Skill 的价值是把高频、稳定的编排沉淀下来，避免每次都临时规划；但 Plan-and-Execute 的 Planner 本身就能根据工具列表生成合理的步骤编排。对于跨品类复合任务这种低频、非标的需求，Planner 临时规划反而比套用预定义技能更灵活。

下面这张时序图展示了 Plan-and-Execute 处理跨品类复合任务的完整流程——从用户输入到三个子任务分步执行，再到最终综合回复：

![](https://oss.open8gu.com/iShot_2026-07-10_13.44.16.png)

#### 3. 完整执行轨迹

预期控制台输出（最终回复的措辞和排版因模型而异，以下为示意）：

```text
========== 场景 3：跨品类复合任务（Plan-and-Execute） ==========

[Plan] 正在规划...
[Plan] 计划生成完成：
  ○ Step 1: 对比比特 AirX 耳机和 BandPro 耳机的规格参数  → compareProducts
  ○ Step 2: 根据比特 Phone S1 查询运动装备搭配推荐        → recommendBundle
  ○ Step 3: 查询订单 88231 的状态                         → queryOrder
  ○ Step 4: 综合对比结论、搭配推荐和订单状态，给出最终回复  → null

[Execute] ▶ Step 1: 对比比特 AirX 耳机和 BandPro 耳机的规格参数
[工具调用] compareProducts({"productA":"比特 AirX 真无线耳机",
  "productB":"比特 BandPro 头戴式耳机"})
[工具结果] {"productA":{...},"productB":{...}}
[Execute] ✓ Step 1 完成

[Execute] ▶ Step 2: 根据比特 Phone S1 查询运动装备搭配推荐
[工具调用] recommendBundle({"baseProduct":"比特 Phone S1 手机",
  "budget":1000,"preferences":"运动"})
[工具结果] {"baseProduct":"比特 Phone S1 手机","bundles":[...]}
[Execute] ✓ Step 2 完成

[Execute] ▶ Step 3: 查询订单 88231 的状态
[工具调用] queryOrder({"orderId":"88231"})
[工具结果] {"orderId":"88231","product":"比特 S10 Pro 扫地机",
  "status":"已签收",...}
[Execute] ✓ Step 3 完成

[Execute] ▶ Step 4: 综合对比结论、搭配推荐和订单状态，给出最终回复
[Execute] ✓ Step 4 完成

[Plan] 执行完成：
  ✓ Step 1: 对比耳机规格 → AirX 399 元入耳式 vs BandPro 699 元头戴式...
  ✓ Step 2: 搭配推荐 → 运动健康套装（手表 ¥599 + 耳机 ¥399）...
  ✓ Step 3: 查订单 → 88231 已签收...
  ✓ Step 4: 综合回复 → 已处理...

========== 最终结果 ==========
为您汇总三个问题的处理结果：

【耳机对比】AirX vs BandPro
| 维度 | AirX 真无线（¥399） | BandPro 头戴式（¥699） |
|------|-------------------|---------------------|
| 佩戴 | 入耳式，5.2g 超轻 | 包耳式，258g |
| 续航 | 总续航 30 小时 | 40 小时 |
| 降噪 | 主动降噪 | 混合降噪 + 通透模式 |
| 防水 | IPX4 | 无 |
| 音质 | 蓝牙 5.3 | Hi-Res 认证 |
两款定位不同：AirX 轻便防水，适合运动通勤；BandPro 音质更强，
适合长时间音乐欣赏。

【运动装备搭配】
考虑到您 1000 元以内的预算，推荐单独搭配比特 WatchFit 智能手表
（¥599）：心率血氧监测 + 100 种运动模式，与 Phone S1 数据互通。
如果预算放宽，还可以加一副 AirX 耳机（¥399），凑成运动健康套装
组合价 ¥2799（省 ¥198）。

【订单 88231】
您购买的比特 S10 Pro 扫地机已于 6 月 22 日签收。
如需其他帮助，随时联系！
```

整个过程 4 步搞定，三个子任务一个不漏。来看几个关键细节：

**Planner 自动识别了三个独立子任务**。规划阶段一次性拆出 4 步，每步对应一个独立目标。因为三个子任务没有依赖关系（对比结果不影响搭配推荐，搭配推荐不影响订单查询），Planner 可以按任意顺序编排。

**Executor 直接调基础工具，不走技能**。Step 1 直接调 `compareProducts`，不需要先 `activate_skill` 再调工具。Plan-and-Execute 模式下，Planner 已经把步骤和工具对应关系写清楚了，不需要技能指令来引导。

**Step 2 的 budget 参数被正确传入**。Executor 看到步骤描述里有预算 1000 以内的信息，结合 `recommendBundle` 的参数 Schema 里有 `budget` 字段，自动组装了 `{"baseProduct":"比特 Phone S1 手机","budget":1000,"preferences":"运动"}`。这是 Executor 的 LLM 理解能力在起作用——步骤描述和工具参数 Schema 共同约束了参数组装。

**综合步骤把三个结果组织得有条理**。Step 4 不是简单拼凑三个工具的 JSON 返回值，而是用 LLM 重新组织成面向用户的自然语言回复。

### Plan-and-Execute vs ReAct + Skill：跨品类场景的执行对比

用同一个复合任务，对比两种方式的执行过程：

#### 1. 执行轨迹对比

**Plan-and-Execute**（上面已展示）：

```text
[规划] Step 1: 对比耳机 → compareProducts
       Step 2: 搭配推荐 → recommendBundle
       Step 3: 查订单   → queryOrder
       Step 4: 综合回复 → null
[执行] 4 步，前 3 步各调 1 次工具，第 4 步纯文本综合，共 5 次 LLM 调用（含 1 次规划）
```

**ReAct + Skill**（假设 LLM 表现理想）：

```text
第 1 圈: activate_skill("product-comparison")
第 2 圈: compareProducts(AirX, BandPro)
第 3 圈: activate_skill("iot-bundle")
第 4 圈: recommendBundle(Phone S1)
第 5 圈: activate_skill("order-inquiry")
第 6 圈: queryOrder(88231)
第 7 圈: 综合回复
```

7 圈 ReAct 循环，其中 3 圈是激活技能（不产生业务结果），4 圈是实际的工具调用和综合。

#### 2. 关键指标对比

| 维度 | Plan-and-Execute | ReAct + Skill |
|------|-----------------|---------------|
| LLM 调用次数 | 5 次（1 规划 + 4 执行） | 7 次（7 圈主循环） |
| 实际工具调用 | 3 次 | 3 次 + 3 次 activate_skill |
| 指令堆叠风险 | 无（每步独立上下文） | 高（三份技能指令叠加） |
| 遗漏子任务风险 | 低（计划覆盖全部子任务） | 中（走到第 5 圈可能遗忘第三个任务） |
| 上下文消耗 | 中等（步骤结果逐步累积） | 高（技能指令 + 所有 Observation 线性累积） |
| 可观测性 | 好（计划清单 + 步骤状态） | 一般（只能看工具调用日志） |

#### 3. 什么时候该用哪种

这个对比不是要否定 ReAct + Skill——它们各有最佳场景：

```text
确定性高 ◀━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━▶ 灵活性高

  Skill                              Plan-and-Execute
  （单技能场景最优）                   （多子任务场景最优）

  退掉订单 88231                     对比耳机 + 配运动装备
  查订单和物流                        + 查订单
  对比 AirX 和 BandPro               
```

**单子任务用 ReAct + Skill**。退款、查单、对比、搭配推荐——每个场景独立处理时，Skill 的指令引导能保证流程稳定，3 圈搞定。不需要规划的额外开销。

**跨品类复合任务用 Plan-and-Execute**。一句话包含多个独立子任务，且横跨不同品类、调用不同工具时，Planner 的全局视角能确保不遗漏、不混淆。

**两者可以组合**。AgentRouter 先判断任务复杂度：单技能匹配就走 ReAct + Skill，多目标复合就走 Plan-and-Execute。第 15 篇的 `AgentRouter` 已经实现了 ReAct 和 Plan-and-Execute 的路由，现在加上 Skill 维度，决策逻辑变为：

```text
用户输入
  ↓
[AgentRouter]
  ├── 知识问答？ → 固定 RAG Workflow
  ├── 匹配单个技能？ → ReAct + Skill
  ├── 简单工具任务？ → ReAct
  └── 多目标复合？ → Plan-and-Execute
```

### 跨品类编排的三种典型模式

通过上面的分析和实战，可以归纳出比特严选场景下跨品类编排的三种典型模式。上面的 Demo 已经完整展示了并行编排（三个独立子任务），下面补充串行和混合两种模式——它们用同一套 Plan-and-Execute 架构，区别仅在 Planner 对步骤顺序的安排。

先用一张图把三种模式的执行拓扑画出来，看完图再逐个展开：

![](https://oss.open8gu.com/iShot_2026-07-10_13.44.17.png)

#### 1. 串行编排：步骤有依赖

有些跨品类任务的子步骤之间存在依赖关系——后一步必须依赖前一步的结果。

举个例子：用户说“帮我查一下订单 88231 的扫地机还在不在保修期内，如果过保了就推荐一台新的”。这句话的两个子任务有明确的先后依赖：

```text
Step 1: queryOrder(88231) → 拿到签收时间
Step 2: getCurrentTime()  → 拿到当前时间
Step 3: 判断是否过保（签收时间 + 保修期 vs 当前时间）
Step 4: 如果过保 → searchKnowledge("扫地机推荐")
Step 5: 综合回复
```

Step 3 依赖 Step 1 和 Step 2 的结果，Step 4 依赖 Step 3 的判断。这种模式只能串行执行——Planner 按依赖关系排好顺序，Executor 逐步执行。

#### 2. 并行编排：步骤无依赖

前面的复合任务（对比 + 搭配 + 查订单）就是典型的并行场景——三个子任务之间没有数据依赖，理论上可以同时执行。

当前 TinyAgent 的 `PlanAndExecuteAgent` 是串行执行的——Step 1 完成后才执行 Step 2。在生产环境中，如果要优化响应时间，可以让 Planner 在计划中标注步骤之间的依赖关系，Executor 对无依赖的步骤并行执行：

```text
[规划]
  Step 1: 对比耳机        → compareProducts   （无依赖）
  Step 2: 搭配推荐        → recommendBundle   （无依赖）
  Step 3: 查订单          → queryOrder        （无依赖）
  Step 4: 综合回复        → null              （依赖 1, 2, 3）

[执行]
  Step 1 ──┐
  Step 2 ──┼── 并行执行 ── Step 4（串行）
  Step 3 ──┘
```

> 并行执行需要在 `PlanStep` 中新增 `dependsOn` 字段标注依赖，Executor 用线程池同时提交无依赖的步骤。这不在本篇实现范围内，但数据结构上只需要给 `PlanStep` 加一个 `List<Integer> dependsOn` 字段，Planner 的提示词增加依赖标注要求。

#### 3. 混合编排：部分串行 + 部分并行

现实中更常见的是混合模式。举个例子：

> 帮我对比 AirX 和 BandPro 耳机，选好后推荐一个搭配手机的方案，另外查一下订单 88231。

这里对比（Step 1）和查订单（Step 3）可以并行，但搭配推荐（Step 2）依赖对比结论——用户说“选好后推荐搭配”，意味着推荐的基础商品取决于对比结果：

```text
[执行]
  Step 1（对比耳机）──┬── Step 2（根据选定的耳机推荐搭配）── Step 4（综合）
  Step 3（查订单）  ──┘
```

对于 TinyAgent 当前的串行 Executor 来说，这三种模式在执行上没有区别——都是逐步执行。区别在于 Planner 对步骤顺序的编排：串行模式按依赖排序，并行模式可以按任意顺序（反正结果互不影响），混合模式需要把有依赖的步骤排在后面。

| 编排模式 | 特征 | 典型场景 | Planner 要求 |
|---------|------|---------|-------------|
| 串行 | 后一步依赖前一步结果 | 查订单 → 判断保修 → 推荐新品 | 按依赖排序 |
| 并行 | 子任务之间无依赖 | 对比 + 搭配 + 查订单 | 顺序无关 |
| 混合 | 部分有依赖，部分无依赖 | 对比 → 根据对比结果推荐搭配，同时查订单 | 有依赖的排后面 |

### 跨品类编排的工程注意事项

#### 1. 工具描述是编排质量的基础

Planner 根据工具描述来决定每步该用什么工具。如果 `compareProducts` 的描述写得模糊（比如只写“商品工具”），Planner 可能把对比和搜索混为一谈，步骤编排就会出错。

好的工具描述要回答三个问题：**做什么（WHAT）、输入什么（INPUT）、返回什么（OUTPUT）**。

| 写法 | 问题 |
|------|------|
| 商品工具 | 太模糊，Planner 无法区分对比和搜索 |
| 对比两个商品的规格参数，返回两者的详细规格信息供对比分析 | 做什么 + 返回什么都清楚 |

`searchKnowledge` 和 `compareProducts` 的描述要明确区分各自的职责：前者是粗粒度的知识检索（产品简介、政策文档），后者是细粒度的规格对比（详细参数 JSON）。Planner 看到这两段描述，就能判断对比 AirX 和 BandPro 用 `compareProducts`，而退货政策是什么用 `searchKnowledge`。

#### 2. Mock 数据的品类覆盖

本篇的 `CompareProductsTool` 和 `RecommendBundleTool` 都用 Mock 数据——`PRODUCTS` 静态 Map 和硬编码的搭配方案。这在 Demo 里足够，但有两个隐含假设需要在生产环境解决：

**商品数据的实时性**。静态 Map 里的价格和库存不会变，但真实场景中商品可能下架、调价、缺货。生产环境应该对接商品数据库或商品微服务 API。

**搭配推荐的个性化**。当前的搭配方案是固定的——手机对应两个套装。生产环境的推荐应该结合用户画像（上一篇讲的长期记忆）、购买历史、当前促销活动来动态生成。

#### 3. 工具数量与 Planner 质量的关系

TinyAgent 从 5 个工具扩展到了 7 个。当前体量下 Planner 的表现很稳——7 个工具的描述加起来约 400 Token，Planner 能准确地把工具和步骤对应起来。

但如果工具数量继续增长到 15-20 个，Planner 的规划质量可能下降——工具描述占据的上下文空间增加，两个功能相近的工具容易被混淆。应对方式有两个：

**一是用 ToolFilter 做预筛选**。第 14 篇的 `ToolFilter` 根据用户问题的语义相关性筛选工具，只把相关工具传给 Planner。

**二是合并功能相近的工具**。比如如果有 `comparePhones`、`compareTablets`、`compareEarphones` 三个对比工具，不如合并成一个 `compareProducts`，内部根据商品品类路由——减少 Planner 的选择空间。

| 工具数量 | Planner 表现 | 建议 |
|---------|-------------|------|
| 5-10 个 | 稳定 | 直接传全量工具列表 |
| 10-15 个 | 基本稳定，偶尔混淆 | 用 ToolFilter 预筛选 |
| 15 个以上 | 容易混淆相近工具 | 合并同类工具 + ToolFilter |

### Demo：完整代码串联

把所有组件串起来，跑三个场景验证：

```java
public class CrossCategoryDemo {

    public static void main(String[] args) {
        // 注册全部 7 个基础工具
        ToolRegistry toolRegistry = new ToolRegistry();
        toolRegistry.register(new QueryOrderTool());
        toolRegistry.register(new QueryLogisticsTool());
        toolRegistry.register(new ApplyRefundTool());
        toolRegistry.register(new SearchKnowledgeTool());
        toolRegistry.register(new GetCurrentTimeTool());
        toolRegistry.register(new CompareProductsTool());
        toolRegistry.register(new RecommendBundleTool());

        Properties dotEnv = loadDotEnv();
        LlmClient llmClient = new LlmClient(
                setting(dotEnv, "TINYAGENT_API_URL",
                        "https://dashscope.aliyuncs.com/compatible-mode"
                        + "/v1/chat/completions"),
                requiredSetting(dotEnv, "TINYAGENT_API_KEY"),
                setting(dotEnv, "TINYAGENT_MODEL", "qwen-plus")
        );

        // 加载全部 4 个技能
        SkillRegistry skillRegistry = new SkillRegistry();
        skillRegistry.loadFromDirectory(
                Path.of("src/main/resources/skills"));
        ToolRegistry agentTools =
                skillRegistry.buildAgentRegistry(toolRegistry);

        // 场景 1：ReAct + Skill —— 耳机对比
        System.out.println(
                "========== 场景 1：耳机对比 ==========");
        ReActAgent reactAgent =
                new ReActAgent(llmClient, agentTools, 10, 8000);
        String answer1 = reactAgent.run(
                "比特 AirX 耳机和 BandPro 耳机哪个好？"
                + "我主要通勤用");
        System.out.println("\n[最终结果] " + answer1);

        // 场景 2：ReAct + Skill —— IoT 搭配推荐
        System.out.println(
                "\n\n========== 场景 2：IoT 搭配推荐 ==========");
        String answer2 = reactAgent.run(
                "我刚买了比特 Phone S1，"
                + "想配一些智能设备，主要想运动时用");
        System.out.println("\n[最终结果] " + answer2);

        // 场景 3：Plan-and-Execute —— 跨品类复合任务
        System.out.println(
                "\n\n========== 场景 3：跨品类复合任务 ==========");
        PlanAndExecuteAgent planAgent =
                new PlanAndExecuteAgent(llmClient, toolRegistry, 2);
        String answer3 = planAgent.run(
                "帮我对比一下比特 AirX 耳机和 BandPro 耳机，"
                + "另外我买的比特 Phone S1 手机想配一套运动装备，"
                + "预算 1000 以内，"
                + "顺便帮我查一下订单 88231 到了没");
        System.out.println("\n[最终结果] " + answer3);
    }

    // loadDotEnv()、requiredSetting()、setting() ......
}
```

三个场景分别验证了：

- **场景 1**：ReAct + Skill 处理单品类对比（`product-comparison` 技能 + `compareProducts` 工具）
- **场景 2**：ReAct + Skill 处理跨品类搭配推荐（`iot-bundle` 技能 + `recommendBundle` 工具）
- **场景 3**：Plan-and-Execute 处理跨品类复合任务（Planner 拆步骤 + Executor 调多个基础工具）

注意场景 3 传入 `toolRegistry` 而不是 `agentTools`——Plan-and-Execute 直接用全量工具，不走技能路径。

### 文末总结

这一篇用跨品类场景验证了 TinyAgent 三种能力的组合编排：

- **新增两个跨品类工具**：`CompareProductsTool` 返回两个商品的详细规格 JSON，供 LLM 做对比分析；`RecommendBundleTool` 根据基础商品返回 IoT 搭配组合方案，包含组合价和场景说明。TinyAgent 的工具从 5 个扩展到 7 个，覆盖了订单售后、知识检索和跨品类对比搭配三大场景。
- **新增两个跨品类技能**：`product-comparison` 引导 LLM 从价格、功能、场景三个维度做对比分析；`iot-bundle` 引导 LLM 根据用户偏好筛选搭配方案。技能从 2 个扩展到 4 个。
- **单任务用 ReAct + Skill，复合任务用 Plan-and-Execute**。单品类对比、单次搭配推荐——Skill 指令引导，3 圈搞定。跨品类复合任务（对比 + 搭配 + 售后）——Planner 一次性拆解全部子任务，Executor 逐步执行，不遗漏、不混淆。
- **三种编排模式**：串行（步骤有依赖）、并行（步骤无依赖）、混合（部分有依赖）。当前 Executor 统一串行执行，生产环境可扩展为依赖标注 + 并行执行。

用一句话概括：**跨品类编排不是新机制，而是 Tool、Skill、Plan-and-Execute 三种已有能力在多品类场景下的组合验证——单任务用 Skill 保稳定，复合任务用 Plan-and-Execute 保完整**。

到这里，TinyAgent 的执行能力——从单步 ReAct 到预定义 Skill 再到动态 Plan-and-Execute——已经能覆盖比特严选绝大多数客服场景。但有一个问题一直悬着没解决：如果 Agent 在执行过程中翻车了——工具返回错误、LLM 理解偏差、步骤执行结果不符合预期——怎么办？第 15 篇的 Re-plan 只是在步骤失败时重新规划，还没有让 Agent 自己反思哪里做错了、为什么做错、下次怎么避免。下一篇，咱们给 TinyAgent 装上 Reflection（反思）机制——让 Agent 不只是执行，还能自我纠错。

