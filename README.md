# dsh-web-search-bing

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![DSH Compatible](https://img.shields.io/badge/DSH-1.x-brightgreen)](https://github.com/deepseek-ai/deepseek-harness)

> Free Bing-backed web search provider for DeepSeek Harness (DSH). No API key needed.

<p align="right">
  <a href="README_EN.md">English</a> | <b>中文</b>
</p>

## 特点

- **完全免费**：使用 Bing 公共 HTML 搜索页面，无需 API Key
- **国内可达**：默认使用 cn.bing.com，中国大陆可直接访问
- **零配额消耗**：不消耗 DeepSeek 或任何 LLM 的搜索配额
- **即插即用**：安装后自动替换默认搜索 provider
- **可配置**：支持切换搜索端点、中英文结果、结果数量

## 安装

`ash
cd $DSH_HOME/profiles/web
pnpm add github:godchen520/dsh-web-search-bing
`

在 package.json 的 dsh.profile.bundles 数组中添加 "dsh-web-search-bing"，重启 DSH。

## 配置

可在 DSH 设置 - Plugins 中调整：

| 参数 | 默认值 | 说明 |
|------|--------|------|
| endpoint | https://cn.bing.com/search | 搜索端点 |
| maxResults | 20 | 每次搜索最大结果数 |
| ensearch | 0 | 0=中文，1=英文 |

## 工作原理

调用 cn.bing.com/search -> 解析 HTML 搜索结果 -> 提取标题/URL/摘要 -> 返回给 DSH 的 web_search 工具。

**无需 API Key，无需注册，安装即用。**

## License

MIT