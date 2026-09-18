# 易码 (Yimark)

Markdown 写作，Markdown 写作，支持所见所得、对比和预览模式，方便的做公众号等文章创作。

微信公众号编辑器会丢弃 `class` 与 `<style>`，只保留内联 `style`。本项目的主题系统因此不产出任何 CSS 类，只产出内联样式字符串，保证预览与粘贴结果一致。

## 功能

- Markdown 所见即所得、实时预览，编辑区与预览区滚动同步
- 多套内置主题（浅色 / 深色纸底），可切换
- 排版密度三档（紧凑 / 标准 / 宽松），「标准」即主题原设计值
- 一键复制为公众号可用的富文本
- 图片本地存储（IndexedDB），粘贴 / 拖拽上传
- 代码高亮、脚注、`==高亮==` 等扩展语法

### 导入 / 导出

浏览器存储清掉就没了，所以草稿要能搬出去：

- **导入** `.md` / `.markdown` / `.txt`：每个文件建一篇草稿；`.zip`：按备份包整体还原
- **导出当前草稿 `.md`**：纯文本，图片引用保持 `![[名字]]`
- **导出全部备份 `.zip`**：草稿 + 图片原始文件 + `manifest.json`，可完整导回（zip 读写自己实现，压缩交给浏览器原生 `CompressionStream`，不引第三方库）
- **导出正文长图 `.png`**：750px 宽，正文直接画成一张图。走 `<foreignObject>` 序列化真实 DOM —— 正文样式全内联、图片全是 data URI，正好满足它的限制

## 图片粘贴

图片以 data URI 内嵌，**实测粘进公众号后台后原样保留** —— 带图文章不需要先传图床，
写完直接「复制到公众号」就行。

`tools/wechat-paste-test.html` 是当时用的实测页，四个用例（data URI 图片 / https 远程图片 /
图文混排 / 外链）各一个复制按钮，留着备用：微信哪天改了粘贴行为，复测一遍就知道。

## 技术栈

React 19 · TypeScript · Vite 7 · CodeMirror 6 · markdown-it · highlight.js

## 开发

```bash
npm install
npm run dev      # 开发服务器
npm run build    # 类型检查 + 生产构建
npm run preview  # 预览构建产物
npm run deploy   # 构建并发到 Cloudflare Pages（yimark.pages.dev）
```

## 发版

线上是 Cloudflare Pages 项目 `yimark`，**直传部署，没有接 GitHub 自动构建** ——
推代码到 main 不会更新线上，必须跑一次：

```bash
npm run deploy
```

发完可以用 `npx wrangler pages deployment list --project-name yimark` 核对，
最新一条的 Source 应当是刚推上去的 commit。

## 存储位置

草稿与偏好存在 localStorage（`yimark:` 前缀），图片存在 IndexedDB 库 `yimark`。

**改名前的数据不用手动搬**：应用启动时会一次性把 `wechat-mp-editor:` 前缀的 localStorage
搬到 `yimark:` 下，并把旧图片库 `wechat-mp-editor` 整体迁进 `yimark` 后删掉旧库。
