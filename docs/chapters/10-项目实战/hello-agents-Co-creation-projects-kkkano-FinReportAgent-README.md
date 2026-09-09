# FinReportAgent - 金融研报智能体

> **资料来源**：[Hello-Agents](https://github.com/datawhalechina/hello-agents) · 原文件：`Co-creation-projects/kkkano-FinReportAgent/README.md`。


> 基于 HelloAgents 框架的金融研报生成智能体，自动收集多源数据并生成投资分析报告

### 项目简介

FinReportAgent 是一个基于 [HelloAgents](https://github.com/datawhalechina/hello-agents) 框架构建的金融研报生成智能体。它能够：

- **自动收集数据**：通过 DuckDuckGo 搜索、Yahoo Finance API 获取实时行情和新闻
- **智能分析推理**：基于 ReAct 范式进行多步推理，生成专业的投资分析
- **结构化报告**：自动生成带情绪判断的 Markdown 格式研报

### 核心功能

- 📊 **股票价格查询** - Yahoo Finance 实时行情
- 📰 **金融新闻搜索** - DuckDuckGo 新闻抓取
- 🔍 **多源信息检索** - DuckDuckGo 网络搜索
- 📄 **Markdown 报告生成** - 自动生成结构化投资分析报告
- 📈 **情绪判断** - 自动识别看涨/看跌/中性情绪

### 技术栈

| 组件 | 技术 |
|------|------|
| 智能体框架 | [HelloAgents](https://github.com/datawhalechina/hello-agents) |
| 智能体范式 | ReAct (Reasoning and Acting) |
| 搜索工具 | DuckDuckGo Search |
| 金融数据 | Yahoo Finance API (yfinance) |
| LLM | DeepSeek / OpenAI 兼容 API |

### 快速开始

#### 环境要求

- Python 3.10+
- Jupyter Notebook / JupyterLab

#### 安装依赖

```bash
pip install -r requirements.txt
```

#### 配置 API 密钥

**方式一：使用 .env 文件（推荐）**

```bash
## 复制配置模板
cp .env.example .env

## 编辑 .env 文件，填入你的 API 密钥
```

**方式二：直接在 Notebook 中配置**

打开 `main.ipynb`，在第一个代码 Cell 中修改：
```python
os.environ["LLM_API_KEY"] = "your-api-key-here"  # 替换为你的 API Key
```

#### 运行项目

```bash
## 启动 Jupyter
jupyter lab

## 打开 main.ipynb 并按顺序运行所有 Cell
```

### 项目结构

```
kkkano-FinReportAgent/
├── main.ipynb         # 主程序
├── README.md          # 项目说明
├── requirements.txt   # 依赖列表
└── .env.example       # 环境变量示例
```

### HelloAgents 框架组件

本项目使用了 HelloAgents 框架的以下核心组件：

| 组件 | 用途 |
|------|------|
| `ReActAgent` | ReAct 循环框架（推理-行动-观察） |
| `HelloAgentsLLM` | 统一的 LLM 调用接口 |
| `ToolRegistry` | 工具注册和管理 |
| `Tool` / `ToolParameter` | 工具定义基类 |

### 许可证

MIT License

### 作者

- **姓名**: kkkano
- **GitHub**: [@kkkano](https://github.com/kkkano)
- **日期**: 2026-01-25

### 致谢

- 感谢 [Datawhale](https://github.com/datawhalechina) 社区
- 感谢 [HelloAgents 框架](https://github.com/datawhalechina/hello-agents) 提供的智能体开发基础设施

