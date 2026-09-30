# Changelog

本文件记录 `dsh-web-search-bing` 的版本变更。

## [1.2.0] — 双通道：RSS 优先 + HTML 兜底

### 新增

- **RSS 通道（默认优先）**：Bing 的 `&format=rss` 输出。每个 `<item>` 直接给出
  `<title>` / `<link>` / `<description>` / `<pubDate>`，无需 HTML 启发式解析。
  - 体积从 ~100 KB HTML 降到 ~4 KB XML。
  - 摘要为**完整段落**，从结构上杜绝「实体解码」「阅读更多 UI 尾巴」这类问题。
  - `<pubDate>` 映射为 `publishedAt`（**这是 HTML 通道拿不到的新字段**）。
  - 抗变化：Bing 改 HTML class 名不再影响主路径。
- **HTML 通道保留为兜底**：RSS 返回 0 条、非 feed 内容、或请求失败时自动回退。
  取消信号（`AbortSignal`）**不会**被兜底吞掉。
- 新配置项 `preferRss`（默认 `true`，`.volatile()`）：设为 `false` 可强制走 HTML。

### 修复

- **`search()` 返回合约**：HTML 分支此前直接返回 sources 数组，未包成
  `{ sources, truncated }`，会导致 seam 拿到 `undefined`。由真实网络 e2e 测试发现。

### 说明（实测结论）

- **RSS 不改变相关性**：同一 query 下 HTML 与 RSS 返回**完全相同的 10 条结果**，
  顺序一致。RSS 的收益在健壮性、体积与摘要质量，不在排序。
- `&count=` 对两种通道均无效，Bing 每页固定约 10 条。
- RSS 的 `pubDate` 是**本地化** RFC-822（`周三, 30 9月 2026 13:31:00 GMT`），
  `new Date()` 解析为 `Invalid Date`（已实测）；英文形式可原生解析。故
  `parseRssDate()` 先试原生、再手工组装中文月份/星期。

### 校验

- 单元测试 **40 项**通过（HTML 解析 / 实体 / UI 清理 / RSS feed / 本地化 pubDate）。
- 真实网络 e2e **12 项**通过（RSS 优先、强制 HTML、RSS 非 feed 回退、RSS 抛错回退、
  取消不被吞、空 query）。
- 真实 seam 集成：`ctx.web.search()` 命中 `bing-free`，339ms，4 条 + `truncated: true`，
  每条带 `publishedAt`。

## [1.1.1] — 适配 DSH 0.2.x 配置 API + 实测修复

### 变更（Breaking，针对旧 DSH）

- **适配 DSH 0.2.0-rc.2 的新配置模型**：`@deepseek-ai/dsh-settings` 已移除
  `settingsNamespace()` 与 `installSettingsSection()`，继续使用会在模块链接阶段
  抛 `SyntaxError: ... does not provide an export named 'installSettingsSection'`。
  - 移除对 `@deepseek-ai/dsh-settings` 的依赖与 import。
  - 三个配置字段改为 `.volatile()`，由 host 从导出的 `Config` schema
    自动生成设置表单；运行时通过 `config.field.get()` 读取实时值。
  - 新增 `readField()`：同时兼容 `.get()` 访问器与纯值配置对象。
  - `inject` 回到 `["web"]`（与官方 `dsh-web-search-deepseek` 一致）。
- `peerDependencies` 收敛为 `dsh-web` / `cordis` / `schemastery`
  （移除已不使用的 `dsh-agent`、`dsh-settings`）。
- 类型定义同步：新增 `BingSearchConfig`、`ConfigField<T>`；
  `WEB_SEARCH_BING_SETTINGS_NAMESPACE` 标注为 `string`。

### 兼容性

| DSH | 状态 |
|---|---|
| 0.2.x（0.2.0-rc.2 实测） | ✅ |
| 0.1.7 ~ 0.1.x | ✅（`readField` 兼容两种配置形态） |
| ≤ 0.1.6 | ❌（老 `installSettingsSection` 写法已不适用） |

### 校验

- 端到端 35 项通过（三种配置形态 × 注册/搜索/解析/截断/错误码）。
- 解析器单测 25 项通过。
- 真实启动验证：`dsh web --port 3099` 正常，无插件报错。
- **真实网络实测**：直连 cn.bing.com，300ms 级返回；多个中文/英文 query 均解析出
  标题 + 直链 + 摘要，无残留 HTML 实体、无 UI 尾巴。
- **真实 seam 集成**：以官方 `@deepseek-ai/dsh-web` 的 `WebRuntime` 挂载本插件，
  `ctx.web.search()` 正确选中 `bing-free` 并返回归一化结果，`maxResults` 由 seam
  正确截断（`truncated: true`）。
- **DSH 内实测**：重启后的 web 实例中，`web_search` 工具返回干净的 Bing 结果
  （摘要 `·` 分隔符正常、无 `&ensp;`），全程零 LLM 额度消耗。

### 修复（实测发现）

- **命名实体解码**：真实 Bing 摘要含 `&ensp;`、`&middot;`、`&nbsp;`、`&mdash;`
  等命名实体，原实现只处理少数几个，导致摘要出现 `&ensp;` 字样。现引入
  `NAMED_ENTITIES` 表统一解码，并保持单遍替换（`&amp;lt;` 不会被二次解码成 `<`）。
- **摘要 UI 尾巴**：Bing 每条摘要尾部带「阅读更多」/「Read more」链接文字（常以
  `…` 截断符收尾），属页面 UI 而非正文。新增 `cleanSnippet()` 去除；仅清尾部的
  标签与省略号，**句末的真实句号保留**。

## [1.0.2]

- 由维护流程同步的发布版本（沿用旧的 `installSettingsSection` 配置写法）。

## [0.1.0]

- 首个版本：把免费搜索 provider 从 DuckDuckGo 切换为 **Bing**（cn.bing.com），
  以适配中国大陆网络环境。
- provider id `bing-free`；HTML 解析 `<li class="b_algo">`；浏览器 UA；
  captcha/风控检测；`AbortSignal` 取消支持。
