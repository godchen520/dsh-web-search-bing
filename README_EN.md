# dsh-web-search-bing

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![DSH Compatible](https://img.shields.io/badge/DSH-1.x-brightgreen)](https://github.com/deepseek-ai/deepseek-harness)

> Free Bing-backed web search provider for DeepSeek Harness (DSH). No API key needed, no search quota consumed.

<p align="right">
  <b>English</b> | <a href="README.md">中文</a>
</p>

## ✅ Features

- **Completely Free** — Uses Bing's public HTML search page, no API key required
- **China Accessible** — Defaults to `cn.bing.com`, works in mainland China
- **Zero Quota** — Doesn't consume DeepSeek or any LLM search quota
- **Plug & Play** — Automatically replaces the default search provider after install
- **Configurable** — Switch endpoints, language, and result count

## 📦 Installation

```bash
cd $DSH_HOME/profiles/web
pnpm add github:godchen520/dsh-web-search-bing
```

Add `"dsh-web-search-bing"` to `dsh.profile.bundles` in `package.json`, restart DSH.

## ⚙️ Configuration

Adjust in DSH Settings → Plugins:

| Option | Default | Description |
|--------|---------|-------------|
| `endpoint` | `https://cn.bing.com/search` | Search endpoint |
| `maxResults` | `20` | Max results per search |
| `ensearch` | `0` | `0`=Chinese, `1`=English |

Or override in `cordis.patch.yml`:

```yaml
- id: web-search-bing
  config:
    endpoint: https://cn.bing.com/search
    maxResults: 15
    ensearch: 0
```

## 🔍 How It Works

Queries `cn.bing.com/search` → parses HTML results → extracts title/URL/snippet → returns to DSH's `web_search` tool.

**No API key, no registration, works out of the box.**

## 📄 License

[MIT](LICENSE)
