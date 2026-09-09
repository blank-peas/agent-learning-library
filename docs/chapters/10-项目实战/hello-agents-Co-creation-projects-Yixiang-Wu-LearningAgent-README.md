# LearningAgent - AI 智能学习助手

> **资料来源**：[Hello-Agents](https://github.com/datawhalechina/hello-agents) · 原文件：`Co-creation-projects/Yixiang-Wu-LearningAgent/README.md`。


> 基于 HelloAgents 框架的个性化学习助手，通过 AI 对话帮助你创建学习计划、记录知识和追踪学习进度

### 📝 项目简介

LearningAgent 是一个智能学习助手，旨在帮助学习者：
- **系统化学习**：根据领域描述、GitHub 项目或学术论文自动生成个性化学习路径
- **知识管理**：智能分类和标签化学习笔记，支持多种输入方式（文本/文件/URL）
- **互动学习**：通过对话和问答巩固知识，提供自由对话和结构化测验两种模式
- **进度追踪**：自动评估学习进度，提供个性化学习建议

**适用场景**：编程学习、技能提升、学术论文研读、开源项目分析等

### ✨ 核心功能

- [x] **智能学习计划生成** - 基于领域描述、GitHub 仓库或 PDF 论文自动生成学习路径
- [x] **智能知识笔记** - LLM 自动分析、分类和标签化，支持文本/文件/URL 三种输入
- [x] **互动式学习** - Free 模式（自由对话）和 Quiz 模式（结构化测验）
- [x] **学习进度评估** - 分析学习计划、知识笔记和会话记录，生成进度报告
- [x] **流式输出** - 实时显示 AI 响应，提升用户体验

### 🛠️ 技术栈

- **HelloAgents 框架**：
  - SimpleAgent（MainAgent、SummaryAgent）
  - ReActAgent（CreatePlanAgent）
  - ReflectionAgent（VibeLearningAgent）
- **专业层智能体**：RepoAnalyzerAgent、PaperAnalyzerAgent、QuizGeneratorAgent
- **核心技术**：
  - 三层 Agent 架构设计
  - 混合策略摘要更新（<5个文件完全重写，≥5个增量更新）
  - 流式输出支持
- **LLM 提供商**：支持 OpenAI、DeepSeek、Qwen、ModelScope 等 10+ 服务
- **开发工具**：pytest、black、mypy、flake8

### 🚀 快速开始

#### 环境要求

- Python 3.10+
- Conda（推荐）或 venv

#### 安装依赖

```bash
## 克隆仓库
git clone https://github.com/Yixiang-Wu/learningAgent.git
cd learningAgent

## 创建 conda 虚拟环境
conda create -n learning-agent python=3.10
conda activate learning-agent

## 安装依赖
pip install -r requirements.txt
```

#### 配置 API 密钥

```bash
## 复制环境变量模板
cp .env.example .env

## 编辑 .env 文件，填入你的 API 密钥
## LLM_MODEL_ID=gpt-4o-mini
## LLM_API_KEY=your_api_key_here
## LLM_BASE_URL=https://api.openai.com/v1
```

#### 运行项目

```bash
## 启动 LearningAgent REPL
python main.py

## 在 REPL 中使用命令
> /help                    # 显示帮助
> /create Python           # 创建学习计划
> /add Python # 装饰器模式  # 添加知识笔记
> /vibe Python             # 开始互动学习
> /vibe Python --mode quiz # 开始测验模式
> /summary Python          # 查看学习总结
> /list                    # 列出所有学习领域
> /exit                    # 退出
```

### 📖 使用示例

#### 示例 1：创建学习计划

```bash
> /create Python
```

AI 会引导你：
1. 询问学习目标（如："想在工作中应用"、"想达到研究生水平"）
2. 分析领域/GitHub 项目/PDF 论文
3. 搜索最佳学习资源
4. 生成结构化的学习计划（保存到 `~/.learningAgent/{domain}/plan.md`）

**生成计划示例**：
```markdown
## Python 学习计划

### 领域概述
Python 是一种高级编程语言...

### 前置知识检查清单
- [ ] 基本计算机概念
- [ ] 逻辑思维能力

### 分阶段学习路径
#### 阶段 1：Python 基础（2-3周）
- 变量和数据类型
- 控制流和函数
...

### 推荐资源
- 书籍：《Python 编程：从入门到实践》
- 课程：廖雪峰 Python 教程
...
```

#### 示例 2：添加知识笔记

```bash
## 文本输入
> /add Python # 装饰器模式
> /add 机器学习 决策树是一种监督学习算法...

## 文件输入
> /add ~/notes/react-hooks.md

## URL 输入
> /add https://blog.example.com/post
```

AI 会自动：
1. 分析内容并识别领域
2. 提取关键概念和标签
3. 生成带时间戳的文件名
4. 保存到 `~/.learningAgent/{domain}/knowledge/`
5. 更新知识摘要文件

**保存示例**：
```
~/.learningAgent/
├── Python/
│   ├── knowledge/
│   │   ├── 20250111-算法-Python-装饰器.md
│   │   └── 20250111-通用-列表推导式.md
│   └── knowledge_summary.md
```

#### 示例 3：互动学习

```bash
## Free 模式 - 自由对话
> /vibe Python

## Quiz 模式 - 结构化测验
> /vibe Python --mode quiz
```

**Free 模式**：
- AI 生成开放性问题，鼓励讨论
- 动态调整对话方向
- 引导深入思考

**Quiz 模式**：
- 结构化测验题
- 自动评估答案
- 难度逐步递增

每次会话自动记录并生成总结。

#### 示例 4：查看学习总结

```bash
> /summary Python
```

生成进度报告包含：
1. **当前水平评估** - 整体掌握度百分比、所处学习阶段
2. **知识点分析** - 掌握良好的知识点、需要加强的知识点
3. **下一步建议** - 具体学习主题推荐
4. **总体建议** - 鼓励和指导、学习策略调整

### 🎯 项目亮点

#### 1. 三层 Agent 架构设计

清晰的职责分离：
- **协调层**（Layer 1）：MainAgent - 意图识别和路由
- **功能层**（Layer 2）：CreatePlanAgent、VibeLearningAgent、SummaryAgent
- **专业层**（Layer 3）：RepoAnalyzerAgent、PaperAnalyzerAgent、QuizGeneratorAgent

#### 2. 混合策略摘要更新

优化性能和存储：
- **< 5 个文件**：完全重写摘要
- **≥ 5 个文件**：增量更新摘要

#### 3. 流式输出支持

实时显示 AI 响应，提升用户体验：
- 自动检测终端能力
- 可配置启用/禁用
- 优雅处理累积块

#### 4. 智能知识管理

- LLM 自动分析和分类
- 支持多种输入方式（文本/文件/URL）
- 提取关键概念和标签
- 生成结构化摘要

#### 5. 完整的测试覆盖

- 单元测试 > 80% 覆盖率
- 集成测试
- 真实环境测试

### 📊 项目结构

```
learningAgent/
├── core/                      # 核心层（基础设施）
│   ├── main_agent.py          # 主 Agent（协调层）
│   ├── file_manager.py        # 文件管理
│   └── summary_manager.py     # 摘要管理（混合策略）
├── agents/                    # 功能层（业务逻辑）
│   ├── create_plan_agent.py   # 创建学习计划（ReAct）
│   ├── vibe_learning_agent.py # 互动学习（Reflection）
│   └── summary_agent.py       # 学习总结（Simple）
├── specialist/                # 专业层（专项能力）
│   ├── repo_analyzer.py       # GitHub 仓库分析
│   ├── paper_analyzer.py      # PDF 论文分析
│   └── quiz_generator.py      # 测验生成
├── processors/                # 处理器
│   └── add_knowledge.py       # 添加知识笔记
├── cli/                       # 命令行界面
│   └── repl.py                # REPL 循环
├── utils/                     # 工具类
│   ├── streaming.py           # 流式输出
│   ├── error_handlers.py      # 错误处理
│   └── exceptions.py          # 异常定义
├── tests/                     # 测试套件
├── main.py                    # 入口文件
├── requirements.txt           # 依赖列表
└── README.md                  # 项目文档
```

### 🧪 运行测试

```bash
## 运行所有测试
pytest tests/ -v

## 运行特定测试
pytest tests/test_agents/test_create_plan_agent.py -v

## 查看测试覆盖率
pytest tests/ --cov=. --cov-report=term-missing
```

### 🔮 未来计划

- [ ] Web UI 界面（基于 FastAPI + Vue）
- [ ] 多语言支持
- [ ] 导出学习报告为 PDF
- [ ] 集成更多 LLM 提供商
- [ ] 学习数据可视化
- [ ] 社区学习计划分享

### 🤝 贡献指南

欢迎提交 Issue 和 Pull Request！

#### 开发流程

1. Fork 本仓库
2. 创建特性分支（`git checkout -b feature/AmazingFeature`）
3. 提交更改（`git commit -m 'feat: Add some AmazingFeature'`）
4. 推送到分支（`git push origin feature/AmazingFeature`）
5. 开启 Pull Request

#### 代码规范

- 使用 `black` 格式化代码
- 使用 `mypy` 进行类型检查
- 使用 `flake8` 检查代码质量
- 编写单元测试

### 📄 许可证

MIT License

### 👤 作者

- GitHub: [@Yixiang-Wu](https://github.com/Yixiang-Wu)
- 项目链接: [learningAgent](https://github.com/Yixiang-Wu/learningAgent)

### 🙏 致谢

- [Datawhale](https://github.com/datawhalechina) 社区
- [Hello-Agents](https://github.com/datawhalechina/hello-agents) 框架
- 所有贡献者和学习者

---

**注意**：本项目作为 Hello-Agents 教程的毕业设计项目，旨在展示如何使用 HelloAgents 框架构建完整的多智能体应用。

