# 全库速览

> **资料来源**：[Agent Interview 100](https://github.com/BigKunLun/Agent-Interview-100) · 原文件：`docs/index.md`。


> 每篇文章一行，一句话概括即该篇「简短回答」段的核心结论——扫一眼这份索引，就能了解全库 100 题各自讲了什么、当前的知识状态是什么。
>
> **更新日期**：2026-08-12 ｜ **收录**：104 篇 / 11 个模块

### 01-agent-architecture（Agent 架构，12 篇）

- [001-what-is-llm-agent](./chapters/01-模型与提示/agent-interview-100-01-agent-architecture-001-what-is-llm-agent) — Agent 是有状态、目标驱动、能与外界交互的自主系统
- [002-agent-core-components](./chapters/06-上下文与记忆/agent-interview-100-01-agent-architecture-002-agent-core-components) — 感知、推理、行动、记忆四模块构成认知闭环
- [003-agent-architecture-patterns](./chapters/05-编排与多agent/agent-interview-100-01-agent-architecture-003-agent-architecture-pattern) — ReAct/Plan-Execute/LATS 各有侧重，生产多用混合模式
- [005-layered-agent-architecture](./chapters/07-ts产品工程/agent-interview-100-01-agent-architecture-005-layered-agent-architecture) — Orchestrator-Worker 分层实现可扩展的专业化分工
- [006-agent-loop-and-error-recovery](./chapters/07-ts产品工程/agent-interview-100-01-agent-architecture-006-agent-loop-and-error-recov) — 循环终止靠外部强制，容错用四层防御模型
- [007-workflow-vs-agent](./chapters/07-ts产品工程/agent-interview-100-01-agent-architecture-007-workflow-vs-agent) — 工作流与 Agent 是连续光谱，生产常用混合架构
- [009-self-reflection-correction](./chapters/07-ts产品工程/agent-interview-100-01-agent-architecture-009-self-reflection-correction) — Reflexion 把环境反馈化为语言化反思存入记忆
- [010-production-agent-system-design](./chapters/10-项目实战/agent-interview-100-01-agent-architecture-010-production-agent-system-de) — 生产系统须解决五大挑战，架构要 right-size
- [108-interview-deep-dive-chain](./chapters/11-面试与求职/agent-interview-100-01-agent-architecture-108-interview-deep-dive-chain) — 追问链逐层深入，找候选人能力天花板
- [109-what-is-agent-harness](./chapters/09-codingagent/agent-interview-100-01-agent-architecture-109-what-is-agent-harness) — Harness 是模型之外的一切，决定约七成实战表现
- [113-computer-use-agent](./chapters/07-ts产品工程/agent-interview-100-01-agent-architecture-113-computer-use-agent) — 看屏操作 GUI 自动化任意软件，无契约、成本可靠性高
- [114-deep-research-agent](./chapters/03-rag/agent-interview-100-01-agent-architecture-114-deep-research-agent) — 计划-检索-判充分-合成循环，产出带引用长报告

### 02-rag（RAG，9 篇）

- [011-rag-overview-and-pipeline](./chapters/03-rag/agent-interview-100-02-rag-011-rag-overview-and-pipeline) — 检索注入外部知识解三大局限，三条流水线三段演进
- [013-chunking-strategies](./chapters/03-rag/agent-interview-100-02-rag-013-chunking-strategies) — 递归分块是通用默认，核心权衡上下文与精度
- [014-vector-database-comparison](./chapters/03-rag/agent-interview-100-02-rag-014-vector-database-comparison) — 选型看 Recall、尾延迟、过滤与运维，非 Benchmark
- [015-embedding-model-selection](./chapters/03-rag/agent-interview-100-02-rag-015-embedding-model-selection) — Voyage 领先，OpenAI 3-large 是均衡生产默认
- [016-hybrid-retrieval](./chapters/08-评测安全可观测/agent-interview-100-02-rag-016-hybrid-retrieval) — 向量+BM25 经 RRF 融合，再加重排序两阶段
- [017-reranking-strategies](./chapters/03-rag/agent-interview-100-02-rag-017-reranking-strategies) — Bi-Encoder 粗检 Top-100，Cross-Encoder 精排 Top-5
- [018-agentic-rag](./chapters/03-rag/agent-interview-100-02-rag-018-agentic-rag) — 在检索生成流水线上加 Agent 控制循环，多轮自主决策
- [019-advanced-rag-variants](./chapters/03-rag/agent-interview-100-02-rag-019-advanced-rag-variants) — Self-RAG/CRAG/Adaptive 各解一题，可组合多层防御
- [020-rag-evaluation-metrics](./chapters/08-评测安全可观测/agent-interview-100-02-rag-020-rag-evaluation-metrics) — 检索与生成双维度度量，RAGAS 整合为自动流水线

### 03-tool-use（工具使用，10 篇）

- [021-function-calling-basics](./chapters/04-工具与mcp/agent-interview-100-03-tool-use-021-function-calling-basics) — LLM 只生成调用 JSON，实际执行由应用代码完成
- [022-tool-schema-design](./chapters/01-模型与提示/agent-interview-100-03-tool-use-022-tool-schema-design) — Schema 三要素中描述最关键，直接影响选择准确率
- [023-common-tool-patterns](./chapters/04-工具与mcp/agent-interview-100-03-tool-use-023-common-tool-patterns) — 数据访问、代码执行、写操作三类，安全级别不同
- [024-tool-gateway-permissions](./chapters/07-ts产品工程/agent-interview-100-03-tool-use-024-tool-gateway-permissions) — Gateway 中间层做鉴权限流审计，Agent 视为不可信
- [025-tool-selection-strategy](./chapters/01-模型与提示/agent-interview-100-03-tool-use-025-tool-selection-strategy) — 意图与描述语义匹配，描述质量是第一影响因素
- [026-tool-failure-handling](./chapters/04-工具与mcp/agent-interview-100-03-tool-use-026-tool-failure-handling) — 超时+退避重试+断路器+降级分层防御，禁无限重试
- [027-model-context-protocol](./chapters/04-工具与mcp/agent-interview-100-03-tool-use-027-model-context-protocol) — MCP 是 AI 界 USB-C，统一协议解决 N×M 集成问题
- [028-parallel-vs-sequential-tools](./chapters/04-工具与mcp/agent-interview-100-03-tool-use-028-parallel-vs-sequential-tools) — 无依赖并行降延迟，有依赖顺序，生产用混合模式
- [029-dynamic-tool-discovery](./chapters/07-ts产品工程/agent-interview-100-03-tool-use-029-dynamic-tool-discovery) — 运行时发现工具，解决上下文浪费与选择准确率下降
- [030-tool-use-security](./chapters/08-评测安全可观测/agent-interview-100-03-tool-use-030-tool-use-security) — 工具是最危险攻击面，纵深防御、不信任 LLM 输出

### 04-multi-agent（多 Agent，10 篇）

- [031-what-is-multi-agent](./chapters/05-编排与多agent/agent-interview-100-04-multi-agent-031-what-is-multi-agent) — 多 Agent 专精分工并行协作，代价是通信与复杂度
- [032-communication-patterns](./chapters/05-编排与多agent/agent-interview-100-04-multi-agent-032-communication-patterns) — 消息传递、共享状态、黑板三模式，黑板效率更优
- [033-orchestration-patterns](./chapters/05-编排与多agent/agent-interview-100-04-multi-agent-033-orchestration-patterns) — Pipeline/Hub-Spoke/层级三种编排，按依赖与并行度选
- [034-task-allocation-coordination](./chapters/05-编排与多agent/agent-interview-100-04-multi-agent-034-task-allocation-coordination) — 任务拆分分配协调，明确角色边界与通信模式
- [035-conflict-resolution](./chapters/05-编排与多agent/agent-interview-100-04-multi-agent-035-conflict-resolution) — 投票、共识、仲裁解冲突，警惕 Agent 趋同效应
- [036-multi-agent-frameworks](./chapters/05-编排与多agent/agent-interview-100-04-multi-agent-036-multi-agent-frameworks) — CrewAI 角色、LangGraph 图控制，MAF 已取代 AutoGen
- [037-agent-handoff](./chapters/05-编排与多agent/agent-interview-100-04-multi-agent-037-agent-handoff) — transfer_to 工具化交接，难点在上下文可靠传递
- [038-emergent-behavior](./chapters/05-编排与多agent/agent-interview-100-04-multi-agent-038-emergent-behavior) — 涌现既是优势也是风险，需拓扑与监控做可控设计
- [039-debugging-monitoring-multi-agent](./chapters/05-编排与多agent/agent-interview-100-04-multi-agent-039-debugging-monitoring-multi-agent) — 分布式追踪是核心方法，行业收敛到 OTel 标准
- [101-a2a-protocol](./chapters/05-编排与多agent/agent-interview-100-04-multi-agent-101-a2a-protocol) — A2A 管 Agent 横向协作，与 MCP 互补成双层标准

### 05-memory-and-state（记忆与状态，7 篇）

- [040-memory-types](./chapters/06-上下文与记忆/agent-interview-100-05-memory-and-state-040-memory-types) — 短期/长期/工作记忆三类，LLM 无状态全靠外部工程
- [041-context-window-management](./chapters/06-上下文与记忆/agent-interview-100-05-memory-and-state-041-context-window-management) — 截断到分层摘要多种策略，简单策略常不逊于复杂
- [043-persistent-memory](./chapters/06-上下文与记忆/agent-interview-100-05-memory-and-state-043-persistent-memory) — 双层存储跨会话保留，关键挑战是选择性存储与遗忘
- [044-state-management-patterns](./chapters/06-上下文与记忆/agent-interview-100-05-memory-and-state-044-state-management-patterns) — LangGraph State+Reducer+Checkpoint 已成业界主流
- [045-cross-session-preferences](./chapters/06-上下文与记忆/agent-interview-100-05-memory-and-state-045-cross-session-preferences) — 已废弃，独特内容迁入 #043 用户偏好学习小节
- [046-long-term-memory-storage](./chapters/06-上下文与记忆/agent-interview-100-05-memory-and-state-046-long-term-memory-storage) — 向量语义、结构化精确、图谱关系推理，生产混合
- [048-memory-forgetting-updating](./chapters/06-上下文与记忆/agent-interview-100-05-memory-and-state-048-memory-forgetting-updating) — 时间衰减、频率淘汰、冲突更新，效用删除更优

### 06-planning-and-reasoning（规划与推理，9 篇）

- [049-cot-and-tot](./chapters/02-agent原理/agent-interview-100-06-planning-and-reasoning-049-cot-and-tot) — CoT 线性推理，ToT 探索回溯，按任务路径明确度选
- [050-task-decomposition](./chapters/02-agent原理/agent-interview-100-06-planning-and-reasoning-050-task-decomposition) — LLM/程序化/HTN/ADaPT 分解，核心权衡拆分粒度
- [052-plan-and-solve-replanning](./chapters/02-agent原理/agent-interview-100-06-planning-and-reasoning-052-plan-and-solve-replann) — 先规划后执行，配合动态重规划形成完整闭环
- [053-llm-planning-limitations](./chapters/02-agent原理/agent-interview-100-06-planning-and-reasoning-053-llm-planning-limitatio) — LLM 不能真正规划，LLM-Modulo 外部验证器补救
- [055-reasoning-models](./chapters/02-agent原理/agent-interview-100-06-planning-and-reasoning-055-reasoning-models) — 推理与通用模型合流，thinking 成旗舰内置可调模式
- [056-mcts-in-agent-planning](./chapters/02-agent原理/agent-interview-100-06-planning-and-reasoning-056-mcts-in-agent-planning) — MCTS 四步循环补 LLM 无法回溯之短，LATS 为代表
- [057-reasoning-quality-evaluation](./chapters/08-评测安全可观测/agent-interview-100-06-planning-and-reasoning-057-reasoning-quality-eval) — 已废弃，独特内容迁入 #069 推理过程评估小节
- [058-causal-reasoning](./chapters/02-agent原理/agent-interview-100-06-planning-and-reasoning-058-causal-reasoning) — 已废弃，主线相关度低、无生产落地，主题移除
- [103-agentic-rl-grpo](./chapters/02-agent原理/agent-interview-100-06-planning-and-reasoning-103-agentic-rl-grpo) — 任务完成度做奖励训 Agent，GRPO 免 Critic 降成本

### 07-prompt-engineering（Prompt 工程，10 篇）

- [059-system-prompt-principles](./chapters/01-模型与提示/agent-interview-100-07-prompt-engineering-059-system-prompt-principles) — System Prompt 是宪法：角色、约束、示例、分层结构
- [060-few-shot-vs-zero-shot](./chapters/01-模型与提示/agent-interview-100-07-prompt-engineering-060-few-shot-vs-zero-shot) — 简单任务 Zero-shot，特定格式 Few-shot，边界在扩大
- [061-structured-output](./chapters/01-模型与提示/agent-interview-100-07-prompt-engineering-061-structured-output) — 四种实现，生产推荐 Function Calling+Pydantic 验证
- [062-agentic-prompting](./chapters/01-模型与提示/agent-interview-100-07-prompt-engineering-062-agentic-prompting) — 优化多步决策链而非单次输出，含工具描述与护栏
- [063-prompt-chaining](./chapters/05-编排与多agent/agent-interview-100-07-prompt-engineering-063-prompt-chaining) — 任务拆为顺序 LLM 调用链，可控可靠可观测
- [064-prompt-injection-defense](./chapters/08-评测安全可观测/agent-interview-100-07-prompt-engineering-064-prompt-injection-defense) — 头号安全威胁，无银弹，必须多层纵深防御
- [065-programmatic-prompt-optimization](./chapters/01-模型与提示/agent-interview-100-07-prompt-engineering-065-programmatic-prompt-optimi) — DSPy 优化结构化组件，元提示流派直接优化字符串
- [066-prompt-versioning-ab-testing](./chapters/01-模型与提示/agent-interview-100-07-prompt-engineering-066-prompt-versioning-ab-testi) — Prompt 即代码：版本控制、A/B 测试、渐进发布
- [068-cross-model-prompt-portability](./chapters/01-模型与提示/agent-interview-100-07-prompt-engineering-068-cross-model-prompt-portabi) — Prompt 高度模型特异，核心层+模型适配层解决
- [102-context-engineering](./chapters/06-上下文与记忆/agent-interview-100-07-prompt-engineering-102-context-engineering) — 从写好 Prompt 转向上下文的选择、组装与管理

### 08-evaluation（评估，9 篇）

- [069-evaluation-methodology](./chapters/08-评测安全可观测/agent-interview-100-08-evaluation-069-evaluation-methodology) — 自动指标、人工、Judge 混用；Agent 评估看多步轨迹
- [071-llm-as-judge](./chapters/08-评测安全可观测/agent-interview-100-08-evaluation-071-llm-as-judge) — 与人工一致性 80%+，需缓解位置、冗长等偏差
- [072-agent-benchmarks](./chapters/08-评测安全可观测/agent-interview-100-08-evaluation-072-agent-benchmarks) — SWE-bench/WebArena/GAIA 评完整任务执行过程
- [073-regression-testing](./chapters/08-评测安全可观测/agent-interview-100-08-evaluation-073-regression-testing) — Golden Dataset+Judge 评分+CI 集成防性能退化
- [074-traces-and-spans](./chapters/08-评测安全可观测/agent-interview-100-08-evaluation-074-traces-and-spans) — Trace/Span 树形结构展决策链，OTel 成行业标准
- [075-evaluation-tools-comparison](./chapters/08-评测安全可观测/agent-interview-100-08-evaluation-075-evaluation-tools-comparison) — Ragas 专 RAG，LangSmith 全栈，Langfuse 开源首选
- [076-static-benchmark-trap](./chapters/08-评测安全可观测/agent-interview-100-08-evaluation-076-static-benchmark-trap) — 高分不等于高能力，必须用自己的数据测试
- [077-continuous-evaluation-pipeline](./chapters/08-评测安全可观测/agent-interview-100-08-evaluation-077-continuous-evaluation-pipeline) — 评估贯穿开发、上线、运行期的持续闭环
- [111-eval-harness-design](./chapters/09-codingagent/agent-interview-100-08-evaluation-111-eval-harness-design) — Harness 是考场非题库，先固定 harness 再换模型测

### 09-safety-and-alignment（安全与对齐，9 篇）

- [078-agent-safety-risks](./chapters/08-评测安全可观测/agent-interview-100-09-safety-and-alignment-078-agent-safety-risks) — 四类风险，Prompt Injection 居首，警惕致命三角
- [079-guardrails-basics](./chapters/08-评测安全可观测/agent-interview-100-09-safety-and-alignment-079-guardrails-basics) — 输入输出双侧护栏，规则型与模型型组合多层防御
- [080-human-in-the-loop](./chapters/07-ts产品工程/agent-interview-100-09-safety-and-alignment-080-human-in-the-loop) — 审批、置信度路由等模式，平衡自动化与人类监督
- [081-least-privilege-sandboxing](./chapters/07-ts产品工程/agent-interview-100-09-safety-and-alignment-081-least-privilege-sandboxi) — 最小权限+沙箱隔离，Agent 需动态运行时权限
- [082-hallucination-detection](./chapters/07-ts产品工程/agent-interview-100-09-safety-and-alignment-082-hallucination-detection) — 不确定性估计、知识验证、一致性检查三类检测
- [083-content-filtering-toxicity](./chapters/07-ts产品工程/agent-interview-100-09-safety-and-alignment-083-content-filtering-toxici) — 已废弃，独特内容迁入 #079 毒性检测小节
- [084-agent-alignment](./chapters/07-ts产品工程/agent-interview-100-09-safety-and-alignment-084-agent-alignment) — 对齐失败是做错事，防规格游戏与欺骗性规划
- [085-red-teaming-agents](./chapters/07-ts产品工程/agent-interview-100-09-safety-and-alignment-085-red-teaming-agents) — 攻击者视角主动测漏洞，已从可选变为合规必需
- [115-agent-compliance-eu-ai-act](./chapters/07-ts产品工程/agent-interview-100-09-safety-and-alignment-115-agent-compliance-eu-ai-a) — 风险分级、高风险义务 2026.8 生效，合规做成架构层

### 10-production-and-deployment（生产与部署，13 篇）

- [086-llmops-and-deployment](./chapters/08-评测安全可观测/agent-interview-100-10-production-and-deployment-086-llmops-and-deployme) — LLMOps 以使用模型为核心，五层生产部署架构
- [088-cost-optimization](./chapters/01-模型与提示/agent-interview-100-10-production-and-deployment-088-cost-optimization) — 缓存、路由、批处理等六策略组合可省 80-90%
- [089-model-routing](./chapters/07-ts产品工程/agent-interview-100-10-production-and-deployment-089-model-routing) — 按请求复杂度动态选模型，RouteLLM 省 85% 成本
- [090-latency-optimization](./chapters/07-ts产品工程/agent-interview-100-10-production-and-deployment-090-latency-optimizatio) — 流式、多层缓存、批处理三大手段降感知延迟
- [091-prompt-drift-management](./chapters/01-模型与提示/agent-interview-100-10-production-and-deployment-091-prompt-drift-manage) — Prompt 未改输出也会漂移，需版本控制+持续监控
- [092-logging-monitoring-alerting](./chapters/07-ts产品工程/agent-interview-100-10-production-and-deployment-092-logging-monitoring-) — 结构化日志、分布式追踪、多维指标三层可观测
- [093-canary-ab-testing](./chapters/07-ts产品工程/agent-interview-100-10-production-and-deployment-093-canary-ab-testing) — 灰度小流量+自动回滚，A/B 测试数据驱动决策
- [094-scaling-strategies](./chapters/07-ts产品工程/agent-interview-100-10-production-and-deployment-094-scaling-strategies) — 无状态设计、队列解耦、按队列深度智能扩缩容
- [095-disaster-recovery-ha](./chapters/07-ts产品工程/agent-interview-100-10-production-and-deployment-095-disaster-recovery-h) — 多提供商冗余、检查点恢复、优雅降级保高可用
- [104-agent-production-troubleshooting](./chapters/07-ts产品工程/agent-interview-100-10-production-and-deployment-104-agent-production-tr) — Trace 驱动排查配 OODA 循环，用数据不猜测
- [107-agent-code-review](./chapters/07-ts产品工程/agent-interview-100-10-production-and-deployment-107-agent-code-review) — 循环保护、超时、错误处理等六维度检查清单
- [112-agent-sandbox-runtime](./chapters/07-ts产品工程/agent-interview-100-10-production-and-deployment-112-agent-sandbox-runti) — 隔离强度三档，Egress 须 default-deny 三层防御
- [116-12-factor-agents](./chapters/07-ts产品工程/agent-interview-100-10-production-and-deployment-116-12-factor-agents) — Agent 是 LLM 决策+确定性代码循环，12 原则收归己有

### 11-frameworks（框架，6 篇）

- [096-framework-overview](./chapters/05-编排与多agent/agent-interview-100-11-frameworks-096-framework-overview) — LangChain 全能、LlamaIndex 专数据、Haystack 重生产
- [097-langgraph-concepts](./chapters/05-编排与多agent/agent-interview-100-11-frameworks-097-langgraph-concepts) — State/Node/Edge 建模有状态工作流，1.0 GA 可恢复
- [098-framework-vs-custom](./chapters/07-ts产品工程/agent-interview-100-11-frameworks-098-framework-vs-custom) — 框架价值=省的时间减绕限制的时间，渐进式演进
- [099-assistants-api-vs-claude-sdk](./chapters/07-ts产品工程/agent-interview-100-11-frameworks-099-assistants-api-vs-claude-sdk) — OpenAI 走 SDK 轻云重，Claude SDK 绑 MCP 开放生态
- [100-testable-extensible-framework](./chapters/07-ts产品工程/agent-interview-100-11-frameworks-100-testable-extensible-framework) — 端口-适配器+依赖注入+中间件实现可测可扩展
- [110-coding-agent-harness-comparison](./chapters/09-codingagent/agent-interview-100-11-frameworks-110-coding-agent-harness-comparison) — 五大 harness 在 Context/工具/权限/沙箱四维各异

