# Vendored browser libraries

Offline vendor bundle for the Android WebView front-end. Loaded with plain
`<script>` / `<link>` tags - no bundler, no ES modules, no network at runtime.

Downloaded by [`tools/fetch-vendor.mjs`](../../../tools/fetch-vendor.mjs)
(source: [jsDelivr](https://www.jsdelivr.com/) npm mirrors). Contents are
byte-for-byte upstream releases: not minified, rewritten, or patched locally.

## Core files

| File | Library | Version | Bytes | Source URL |
| --- | --- | --- | ---: | --- |
| `markdown-it.min.js` | markdown-it | 14.3.2 | 125,451 | [`cdn.jsdelivr.net/npm/markdown-it@14.3.2/dist/markdown-it.min.js`](https://cdn.jsdelivr.net/npm/markdown-it@14.3.2/dist/markdown-it.min.js) |
| `highlight.min.js` | highlight.js | 11.12.0 | 129,254 | [`cdn.jsdelivr.net/npm/@highlightjs/cdn-assets@11.12.0/highlight.min.js`](https://cdn.jsdelivr.net/npm/@highlightjs/cdn-assets@11.12.0/highlight.min.js) |
| `highlight-github.min.css` | highlight.js | 11.12.0 | 1,309 | [`cdn.jsdelivr.net/npm/@highlightjs/cdn-assets@11.12.0/styles/github.min.css`](https://cdn.jsdelivr.net/npm/@highlightjs/cdn-assets@11.12.0/styles/github.min.css) |
| `highlight-github-dark.min.css` | highlight.js | 11.12.0 | 1,315 | [`cdn.jsdelivr.net/npm/@highlightjs/cdn-assets@11.12.0/styles/github-dark.min.css`](https://cdn.jsdelivr.net/npm/@highlightjs/cdn-assets@11.12.0/styles/github-dark.min.css) |
| `katex.min.js` | katex | 0.16.47 | 272,537 | [`cdn.jsdelivr.net/npm/katex@0.16.47/dist/katex.min.js`](https://cdn.jsdelivr.net/npm/katex@0.16.47/dist/katex.min.js) |
| `katex.min.css` | katex | 0.16.47 | 23,827 | [`cdn.jsdelivr.net/npm/katex@0.16.47/dist/katex.min.css`](https://cdn.jsdelivr.net/npm/katex@0.16.47/dist/katex.min.css) |
| `contrib/auto-render.min.js` | katex | 0.16.47 | 3,486 | [`cdn.jsdelivr.net/npm/katex@0.16.47/dist/contrib/auto-render.min.js`](https://cdn.jsdelivr.net/npm/katex@0.16.47/dist/contrib/auto-render.min.js) |

## KaTeX fonts

`katex.min.css` declares each face as
`src:url(fonts/KaTeX_*.woff2) format("woff2"),url(fonts/KaTeX_*.woff) format("woff"),url(fonts/KaTeX_*.ttf) format("truetype")`.
The stylesheet references 20 `.woff2` files and **all 20 are vendored** below.
The parallel `.woff` / `.ttf` entries in each `src` list are legacy fallbacks
that appear *after* the woff2 source: Android WebView is Chromium-based and
always selects the woff2 face, so the `.woff`/`.ttf` files are never
requested and are deliberately not vendored (~40 files /
several MB saved). No CSS was modified to achieve this.

Source: [`katex@0.16.47/dist/fonts/`](https://cdn.jsdelivr.net/npm/katex@0.16.47/dist/fonts/)

| Font file | Bytes |
| --- | ---: |
| `fonts/KaTeX_AMS-Regular.woff2` | 28,076 |
| `fonts/KaTeX_Caligraphic-Bold.woff2` | 6,912 |
| `fonts/KaTeX_Caligraphic-Regular.woff2` | 6,908 |
| `fonts/KaTeX_Fraktur-Bold.woff2` | 11,348 |
| `fonts/KaTeX_Fraktur-Regular.woff2` | 11,316 |
| `fonts/KaTeX_Main-Bold.woff2` | 25,324 |
| `fonts/KaTeX_Main-BoldItalic.woff2` | 16,780 |
| `fonts/KaTeX_Main-Italic.woff2` | 16,988 |
| `fonts/KaTeX_Main-Regular.woff2` | 26,272 |
| `fonts/KaTeX_Math-BoldItalic.woff2` | 16,400 |
| `fonts/KaTeX_Math-Italic.woff2` | 16,440 |
| `fonts/KaTeX_SansSerif-Bold.woff2` | 12,216 |
| `fonts/KaTeX_SansSerif-Italic.woff2` | 12,028 |
| `fonts/KaTeX_SansSerif-Regular.woff2` | 10,344 |
| `fonts/KaTeX_Script-Regular.woff2` | 9,644 |
| `fonts/KaTeX_Size1-Regular.woff2` | 5,468 |
| `fonts/KaTeX_Size2-Regular.woff2` | 5,208 |
| `fonts/KaTeX_Size3-Regular.woff2` | 3,624 |
| `fonts/KaTeX_Size4-Regular.woff2` | 4,928 |
| `fonts/KaTeX_Typewriter-Regular.woff2` | 13,568 |
| **20 files total** | **259,792** |

## Totals

- files vendored: **27** (7 core + 20 fonts)
- total bytes: **816,971**
- `.woff2` references in `katex.min.css` resolved on disk: **20/20**

## Integrity (sha256)

- `markdown-it.min.js` sha256 `e32488403e2e565ac12a9669bfdf2b1b876eb0a5c84f8e0699884b562d18eb52`
- `highlight.min.js` sha256 `8ab71eb09c51f501e5e25157d9cff100e46cc29bcbfc744d0b746d451fca7f53`
- `highlight-github.min.css` sha256 `3a9a5def8b9c311e5ae43abde85c63133185eed4f0d9f67fea4b00a8308cf066`
- `highlight-github-dark.min.css` sha256 `9f208d022102b1d0c7aebfecd8e42ca7997d5de636649d2b31ea63093d809019`
- `katex.min.js` sha256 `a29d2961d3146de5949d78ac7c1a9d93ae54955bad22a6db4fbe836e88e8bf48`
- `katex.min.css` sha256 `0289a02cf451a44dd73add683a09644252363871ac11713a647b732cee8b1ee3`
- `contrib/auto-render.min.js` sha256 `e5372d199bcdae8b4de71d0f7ceba72a4ba12774a27c60a6f1f77d03b3228ee4`
- `fonts/KaTeX_AMS-Regular.woff2` sha256 `0cdd387c9590a1a9f9794560022dbb59654a7d86f187aa0c81495ad42d3a7308`
- `fonts/KaTeX_Caligraphic-Bold.woff2` sha256 `de7701e42cf1f4cf0b766c03fb27977207eee2f4fd5d76fa82188406da43ea4c`
- `fonts/KaTeX_Caligraphic-Regular.woff2` sha256 `5d53e70ad607c2352162dec9e0923fb54ecdafaccbf604cd8dcf7d00facb989b`
- `fonts/KaTeX_Fraktur-Bold.woff2` sha256 `74444efd593c005e3f4573b44524704c0af0a937fe911cca9e94068d0d140d3f`
- `fonts/KaTeX_Fraktur-Regular.woff2` sha256 `51814d270d06ff0255dba0799994fa4d8c84d11f09951d47595f4abb1f3602dc`
- `fonts/KaTeX_Main-Bold.woff2` sha256 `0f60d1b897938ec918c8ce073092411baf9438f6739465693ff18b0f9d20b021`
- `fonts/KaTeX_Main-BoldItalic.woff2` sha256 `99cd42a3c072d918f2f44984a807cf7aa16e13545fd0875fc07c6c65f99e715b`
- `fonts/KaTeX_Main-Italic.woff2` sha256 `97479ca6cce906abc961ecac96faa5f9ca2e61b8e7670d475826bcdee9a7c267`
- `fonts/KaTeX_Main-Regular.woff2` sha256 `c2342cd8b869e01752a9321dc17213fc40d4d04c79688c1d43f2cf316abd7866`
- `fonts/KaTeX_Math-BoldItalic.woff2` sha256 `dc47344dbb6cb5b655c8460d561f4df5f501b90c804ad3c6cec65fe322351ab1`
- `fonts/KaTeX_Math-Italic.woff2` sha256 `7af58c5ec8f132a2ddde9027c6d7814decce4d3b822a11192a42a20e2e973264`
- `fonts/KaTeX_SansSerif-Bold.woff2` sha256 `e99ae51144bf1232efcc1bfe5add36262c6866b0faab24fa75740e1b98577a62`
- `fonts/KaTeX_SansSerif-Italic.woff2` sha256 `00b26ac825e2095056396e0553b8ac26d3f8ad158c3826e28b4c45b385c4714a`
- `fonts/KaTeX_SansSerif-Regular.woff2` sha256 `68e8c73ef42afd3ccec58bf0fba302cce448938e7fc020a5e31f8a952eee1342`
- `fonts/KaTeX_Script-Regular.woff2` sha256 `036d4e95149b69ff9bcc0cd55771efeb25ffa3947293e69acd78d5ac328c684b`
- `fonts/KaTeX_Size1-Regular.woff2` sha256 `6b47c40166b6dbe21a5dfca7718413f2147fd2399be1ba605d8ad39cedf25dfe`
- `fonts/KaTeX_Size2-Regular.woff2` sha256 `d04c54219f9eaec6d4d4fd42dfb28785975a4794d6b2fc71e566b9cd6db842dd`
- `fonts/KaTeX_Size3-Regular.woff2` sha256 `73d591271b1604960cb10bb90fee021670af7297017e0e98480b332d11f51995`
- `fonts/KaTeX_Size4-Regular.woff2` sha256 `a4af7d414440a1c1790825cfb700cf9cf43b0f2c4b04f0ebc523011ad9853ec0`
- `fonts/KaTeX_Typewriter-Regular.woff2` sha256 `71d517d67827787cfabdf186914cc3358eda539e37931941f2b2fd4a21f68c0b`

## Layout

```
app/web/vendor/
  markdown-it.min.js            -> window.markdownit
  highlight.min.js              -> window.hljs
  highlight-github.min.css
  highlight-github-dark.min.css
  katex.min.js                  -> window.katex
  katex.min.css                 -> url(fonts/...) resolves relative to this file
  contrib/auto-render.min.js    -> window.renderMathInElement
  fonts/KaTeX_*.woff2           -> 20 files
```
