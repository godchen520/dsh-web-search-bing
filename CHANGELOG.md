# Changelog

本文件记录 `dsh-web-search-bing` 的版本变更。

## [1.2.2] — 发布到 npm（改用组织作用域名）

**运行时行为与 1.2.1 完全一致**，本版只改包的身份与分发方式。

### 改动

- **包名改为 `@godchen520/dsh-web-search-bing`** —— npm 上的 `dsh-web-search-bing`
  已被其他开发者占用，因此改用组织作用域名。GitHub 仓库名不变。
- `cordis.patch.yml` 中插入行的 `name` 同步改为作用域名（该名字从 profile 的
  `node_modules` 解析，必须与包名一致）
- `package.json` 补齐 `repository` / `homepage`（已发布包必须指回收录仓库，否则不会关联）
- README / README_EN 安装章节：改为 `pnpm add @godchen520/dsh-web-search-bing`

### 升级注意

老名字 `dsh-web-search-bing` 与新名字**不能并存**。升级时请把 profile 里
`dependencies` 的键和 `dsh.profile.bundles` 里的条目**一起**换成作用域名。

## [1.2.1] — 补齐端到端测试与开发依赖

纯开发侧改动，**运行时行为与 1.2.0 完全一致**（发布产物 `lib/` 未变）。

### 新增

- **`tests/e2e.provider.test.mjs`** —— 端到端测试，直接 `import` 真实的
  `BingFreeSearchProvider`（不复制解析逻辑），用桩 `fetch` 驱动两种传输：
  - **离线 41 项**（确定性，可进 CI）：RSS 优先、强制 HTML、RSS 非 feed 回退、
    RSS 抛错回退、两通道皆失败、取消不被吞、空 query、captcha 页、`maxResults` 截断、
    provider 元数据
  - **`--live` 加 7 项**：真实请求 cn.bing.com，验证两条通道的线上行为，并断言标题/摘要
    无残留实体、无「阅读更多」UI 尾巴
- **`devDependencies`**：`@deepseek-ai/dsh-web`、`@deepseek-ai/schemastery`
  —— 测试需要 import 真实插件代码，而插件会 import 这两个官方包；它们**不进发布产物**
- **npm 脚本**：`npm test`（离线）、`npm run test:live`（含真实网络）
- `package-lock.json`：锁定开发依赖版本

### 说明

- 此前 CHANGELOG 里写的「真实网络 e2e 12 项」是开发时临时脚本跑的，**代码未入库、
  无法复跑**。本次把它固化为可重复执行的测试，任何人 clone 后 `npm install && npm test`
  即可验证。
- `tests/parse.smoke.test.cjs` 保持自包含（复制纯解析函数），因此即使没有
  `node_modules` 也能单独运行。

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
