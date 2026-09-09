# Agent 学习书架

基于 [VitePress](https://github.com/vuejs/vitepress)（MIT）的本地 Markdown 阅读库：左侧为章节树，中间是正文，右侧为当前页标题索引。

## 启动

```bash
npm install
npm run docs:dev -- --host 127.0.0.1 --port 5174
```

浏览器打开 `http://127.0.0.1:5174/`。

## 内容结构

- `docs/chapters/`：按 11 个学习章节重新编排的完整内容，而非按仓库镜像。
- `source-references/`：上游仓库的原始克隆，不会被同步脚本修改。

执行 `npm run sync:sources` 会重新把原始资料导入阅读库，并自动生成左侧目录。详见站内「来源、许可与使用边界」：未声明许可证的来源仅保留为本地学习资料，不应公开再分发。
