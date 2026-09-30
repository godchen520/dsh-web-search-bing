# dsh-web-search-bing

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![DSH Compatible](https://img.shields.io/badge/DSH-0.2.x-brightgreen)](https://github.com/deepseek-ai/deepseek-harness)

> 面向 DeepSeek Harness (DSH) 的**免费 Bing 搜索 provider**。无需 API Key，不消耗模型额度。

## 特点

- **完全免费**：走 Bing 公共 HTML 搜索页面，无需 API Key、无需注册
- **国内可达**：默认 `cn.bing.com`，中国大陆可直连（DuckDuckGo 在此不可达）
- **零配额消耗**：不消耗 DeepSeek 或任何 LLM 的搜索配额
- **可配置**：搜索端点、中英文结果、单页结果数，且设置**热生效**（改完不用重载插件）
- **适配 DSH 0.2.x**：使用新版 schema 驱动的设置模型（导出 `Config`，由 host 自动生成设置表单）

## 与内置 DeepSeek 搜索的区别

| | 内置 `dsh-web-search-deepseek`（`deepseek-official`） | 本插件（`bing-free`） |
|---|---|---|
| 原理 | 调 DeepSeek Messages API + 原生 `web_search` 工具，**每次搜索是一次 LLM 请求** | GET `cn.bing.com/search`，解析 HTML |
| 凭证 | 需 API Key | **零凭证** |
| 配额 | **消耗 DeepSeek 模型额度** | **不消耗任何额度** |
| 设置项 | key / endpoint / model / maxTokens / maxUses | endpoint / maxResults / ensearch |

内置的是「用模型额度换高质量检索」，本插件是「用网页抓取换零成本」。两者可共存，通过 `web.searchProvider` 选择。

## 安装

```bash
# 1. 放进 profile 目录（路径无空格，避免 pnpm 拆参数）
#    或直接 pnpm add github:godchen520/dsh-web-search-bing
cd $DSH_HOME/profiles/web

# 2. package.json 的 dependencies 加：
#    "dsh-web-search-bing": "file:dsh-web-search-bing"
#    （或 "github:godchen520/dsh-web-search-bing"）

# 3. package.json 的 dsh.profile.bundles 里加上 "dsh-web-search-bing"

# 4. 安装并重启
dsh plugin --profile web install
dsh web
```

> **注意**：只加进 `dependencies` 而**不加进 `dsh.profile.bundles`** 的话，插件的
> `cordis.patch.yml` 不会被应用——插件是「装了但没启用」，搜索仍走内置 provider。

## 配置

设置项由 host 从插件导出的 `Config` schema 自动生成，出现在 **设置 → Plugins** 页面
（注意：专属的「网页搜索」设置页是内置 DeepSeek provider 的，本插件不在那里）。

四个字段都是 `.volatile()`，保存后**下一次搜索即时生效**：

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `endpoint` | `https://cn.bing.com/search` | 搜索端点（可换镜像/代理） |
| `maxResults` | `10` | 单页解析结果上限（seam 还会按 `searchMaxResults` 再截断） |
| `ensearch` | `0` | `0`=中文结果，`1`=英文 |
| `preferRss` | `true` | 优先走 RSS；设 `false` 强制走 HTML 抓取 |

## 工作原理

**双通道：RSS 优先，HTML 兜底。**

```
web_search 工具 → ctx.web.search() → bing-free provider
   │
   ├─ 1) GET cn.bing.com/search?q=...&ensearch=0&format=rss   ← 默认主路径
   │     结构化 XML：<title> / <link> / <description> / <pubDate>
   │     有 <item> → 直接映射（含 publishedAt），完成
   │     无 <item> / 非 feed / 请求失败 ↓
   │
   └─ 2) GET cn.bing.com/search?q=...&ensearch=0              ← 兜底
         解析 <li class="b_algo"> → {url, title, snippet}
```

| | RSS 通道（主） | HTML 通道（兜底） |
|---|---|---|
| 体积 | ~4 KB | ~100 KB |
| 摘要 | 完整段落 | 被 lineclamp 截断 + 需清 UI 尾巴 |
| `publishedAt` | ✅ 有（`<pubDate>`） | ❌ 无 |
| 抗变化 | 标准 RSS 字段 | 依赖 `b_algo` / `b_lineclamp*` class 名 |
| 相关性 | — **两者完全相同**（同一批结果、同一顺序） | — |

其他行为：

- 带浏览器 UA（Bing 会拒绝裸 Node/undici agent）。
- 命中 captcha/风控页时抛结构化 `WEB_PROVIDER_ERROR`，**不会**伪装成「无结果」。
- 支持 `AbortSignal` 取消，且**取消不会被兜底吞掉**。
- `&count=` 对两种通道都无效，Bing 每页固定约 10 条。

## 兼容性

| DSH 版本 | 状态 |
|---|---|
| **0.2.x（如 0.2.0-rc.2）** | ✅ 支持（当前版本） |
| 0.1.7 ~ 0.1.x | ✅ 支持（`readField` 同时兼容 `.get()` 访问器与纯值） |
| ≤ 0.1.6 | ❌ 不支持（那时用 `installSettingsSection` 手写注册，API 已移除） |

本插件只 `import` 两个包：`@deepseek-ai/schemastery`、`@deepseek-ai/dsh-web`。
不再依赖 `@deepseek-ai/dsh-settings`（新版已移除 `settingsNamespace` / `installSettingsSection`）。

## 测试

```bash
node tests/parse.smoke.test.cjs   # 40 项：HTML 解析 / 实体 / UI 清理 / RSS feed / 本地化 pubDate
```

## License

MIT
