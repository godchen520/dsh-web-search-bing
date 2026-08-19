# dsh-web-search-bing

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![DSH Compatible](https://img.shields.io/badge/DSH-1.x-brightgreen)](https://github.com/deepseek-ai/deepseek-harness)

> Free Bing-backed web search provider for DeepSeek Harness (DSH). No API key needed, no search quota consumed.

<p align="right">
  <b>English</b> | <a href="README.md">涓枃</a>
</p>

## 鉁?Features

- **Completely Free** 鈥?Uses Bing's public HTML search page, no API key required
- **China Accessible** 鈥?Defaults to `cn.bing.com`, works in mainland China
- **Zero Quota** 鈥?Doesn't consume DeepSeek or any LLM search quota
- **Plug & Play** 鈥?Automatically replaces the default search provider after install
- **Configurable** 鈥?Switch endpoints, language, and result count

## 馃殌 Installation

```bash
cd $DSH_HOME/profiles/web
pnpm add github:godchen520/dsh-web-search-bing
```

Add `"dsh-web-search-bing"` to `dsh.profile.bundles` in `package.json`, restart DSH.

## 鈿欙笍 Configuration

Adjust in DSH Settings 鈫?Plugins:

| Option | Default | Description |
|--------|---------|-------------|
| `endpoint` | `https://cn.bing.com/search` | Search endpoint |
| `maxResults` | `20` | Max results per search |
| `ensearch` | `0` | `0`=Chinese, `1`=English |

Or override in `cordis.patch.yml`:

```yaml
- id: web-search-duckduckgo
  config:
    endpoint: https://cn.bing.com/search
    maxResults: 15
    ensearch: 0
```

## 馃敡 How It Works

Queries `cn.bing.com/search` 鈫?parses HTML results 鈫?extracts title/URL/snippet 鈫?returns to DSH's `web_search` tool.

**No API key, no registration, works out of the box.**

## 馃搫 License

[MIT](LICENSE)

