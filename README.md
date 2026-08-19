# dsh-web-search-bing

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![DSH Compatible](https://img.shields.io/badge/DSH-1.x-brightgreen)](https://github.com/deepseek-ai/deepseek-harness)

> 鍏嶈垂鐨?Bing 鎼滅储 provider 鎻掍欢锛屼负 DeepSeek Harness 鎻愪緵缃戦〉鎼滅储鑳藉姏锛屾棤闇€ API Key锛屼笉娑堣€?DeepSeek 鎼滅储閰嶉銆?
<p align="right">
  <a href="README_EN.md">English</a> | <b>涓枃</b>
</p>

## 鉁?鐗圭偣

- **瀹屽叏鍏嶈垂**锛氫娇鐢?Bing 鍏叡 HTML 鎼滅储椤甸潰锛屾棤闇€ API Key
- **鍥藉唴鍙揪**锛氶粯璁や娇鐢?`cn.bing.com`锛屼腑鍥藉ぇ闄嗗彲鐩存帴璁块棶
- **闆堕厤棰濇秷鑰?*锛氫笉娑堣€?DeepSeek 鎴栦换浣?LLM 鐨勬悳绱㈤厤棰?- **鍗虫彃鍗崇敤**锛氬畨瑁呭悗鑷姩鏇挎崲榛樿鎼滅储 provider
- **鍙厤缃?*锛氭敮鎸佸垏鎹㈡悳绱㈢鐐广€佷腑鑻辨枃缁撴灉銆佺粨鏋滄暟閲?
## 馃殌 瀹夎

```bash
cd $DSH_HOME/profiles/web
pnpm add github:godchen520/dsh-web-search-bing
```

鍦?`package.json` 鐨?`dsh.profile.bundles` 鏁扮粍涓坊鍔?`"dsh-web-search-bing"`锛岄噸鍚?DSH銆?
## 鈿欙笍 閰嶇疆

鍙湪 DSH 璁剧疆 鈫?Plugins 涓皟鏁达細

| 鍙傛暟 | 榛樿鍊?| 璇存槑 |
|------|--------|------|
| `endpoint` | `https://cn.bing.com/search` | 鎼滅储绔偣 |
| `maxResults` | `20` | 姣忔鎼滅储鏈€澶х粨鏋滄暟 |
| `ensearch` | `0` | `0`=涓枃锛宍1`=鑻辨枃 |

涔熷彲鍦?`cordis.patch.yml` 涓鐩栵細

```yaml
- id: web-search-duckduckgo
  config:
    endpoint: https://cn.bing.com/search
    maxResults: 15
    ensearch: 0
```

## 馃敡 宸ヤ綔鍘熺悊

璋冪敤 `cn.bing.com/search` 鈫?瑙ｆ瀽 HTML 鎼滅储缁撴灉 鈫?鎻愬彇鏍囬/URL/鎽樿 鈫?杩斿洖缁?DSH 鐨?`web_search` 宸ュ叿銆?
**鏃犻渶 API Key锛屾棤闇€娉ㄥ唽锛屽畨瑁呭嵆鐢ㄣ€?*

## 馃搫 License

[MIT](LICENSE)

