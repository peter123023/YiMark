/**
 * Markdown → 全内联样式 HTML 渲染器。
 *
 * 覆盖 markdown-it 的全部 open/close rule（含脚注），让每个元素直接输出内联 style，
 * 不用任何 CSS 类 —— 预览与导出共用同一份 HTML，微信粘贴后样式无损。
 * 主题通过 markdown-it 的 env 传入，渲染时逐规则读取。
 */
import MarkdownIt from 'markdown-it';
import markdownItFootnote from 'markdown-it-footnote';
import markdownItMark from 'markdown-it-mark';
import type { HLJSApi } from 'highlight.js';
import { applyDensity, getTheme, type DensityScale, type Theme, st } from './theme';

/**
 * highlight.js 懒加载。
 *
 * common 包含 30+ 语言定义（压缩后仍有数百 KB），全量进首屏主包会拖慢冷启动，
 * 而首屏往往根本没有代码块。这里改成动态导入：
 * 就绪前代码块按原文转义输出（版式不变，只是没有配色），
 * 就绪后由调用方（App）触发一次重渲染补上高亮。
 */
let hljs: HLJSApi | null = null;
let hljsLoading: Promise<void> | null = null;

/** 高亮器是否已就绪（同步渲染路径用） */
export function isHighlighterReady(): boolean {
  return hljs !== null;
}

/** 触发/等待高亮器加载；重复调用共享同一个 Promise */
export function ensureHighlighter(): Promise<void> {
  if (hljs) return Promise.resolve();
  if (!hljsLoading) {
    hljsLoading = import('highlight.js/lib/common')
      .then((m) => {
        hljs = m.default;
      })
      .catch(() => {
        // 加载失败：保持无高亮渲染，不影响正文
        hljsLoading = null;
      });
  }
  return hljsLoading;
}

/** 渲染规则实际用到的 Token 字段（markdown-it Token 的结构化子集） */
interface Token {
  tag: string;
  type: string;
  level: number;
  content: string;
  /** 代码围栏语言标注（fence 的 info 字符串，如 "```ts" 里的 ts） */
  info?: string;
  /** 源码起止行号 [start, end]（markdown-it 提供，用于预览同步滚动） */
  map: [number, number] | null;
  /** meta.tip：提示条 blockquote；meta.title：提示条标题（无标题时缺省） */
  meta: { id?: number; subId?: number; name?: string; tip?: boolean; title?: string } | null;
  attrGet(name: string): string | null;
}

interface Env {
  theme: Theme;
  /** 本地图片注册表：文件名 → data URI（Obsidian ![[name]] 嵌入用） */
  images?: Record<string, string>;
  /** 渲染时标记当前是否处于脚注条目内（用于跳过插件的段落包裹） */
  footnote?: boolean;
  /** 渲染时标记当前是否处于表格内（用于把单元格里的 <br> 还原成真换行，见 text 规则） */
  inTable?: boolean;
}

type RenderRule = (tokens: Token[], idx: number, options: unknown, env: Env) => string;

const md = new MarkdownIt({
  html: true,
  // 单换行也断行：粘贴多行文本 / 手动回车都按用户预期成行，
  // 不必再靠「空行分段」或行尾反斜杠。表格单元格另走 <br> 还原规则（见 text）。
  breaks: true,
  linkify: false,
  typographer: false,
});
md.use(markdownItFootnote);
md.use(markdownItMark);

/**
 * markdown-it 默认只放行位图类 data URI（防 XSS 白名单，见 validateLink）。
 * <img> 标签里的 svg 不会执行脚本，本地编辑器内容自足可信，放行 svg
 * 让预览与编辑态对 `![](data:image/svg+xml,…)` 的表现一致。
 */
const defaultValidateLink = md.validateLink;
md.validateLink = (src: string) =>
  /^data:image\/svg\+xml[;,]/i.test(src.trim()) || defaultValidateLink(src);

/* Obsidian 图片嵌入：![[文件名]] → 本地注册表里的图片；未注册时渲染占位提示 */
md.inline.ruler.before('image', 'obsidian_embed', (state: any, silent: boolean) => {
  const start = state.pos;
  if (state.src.charCodeAt(start) !== 0x21 /* ! */) return false;
  if (state.src.slice(start, start + 3) !== '![[') return false;
  const end = state.src.indexOf(']]', start + 3);
  if (end < 0) return false;
  if (!silent) {
    const name = state.src.slice(start + 3, end).trim();
    const token = state.push('obsidian_embed', 'span', 0);
    token.meta = { name };
    token.content = name;
  }
  state.pos = end + 2;
  return true;
});

/**
 * 从 `(` 之后开始扫描，找到配对的 `)`，返回其中的内容。
 * 允许目标里出现成对括号（`截图 (1).png`），不跨行；找不到返回 null。
 */
function scanParen(text: string, openAt: number): { inner: string; end: number } | null {
  let depth = 1;
  for (let i = openAt + 1; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    if (ch === 0x0a) return null;
    if (ch === 0x28) depth++;
    else if (ch === 0x29) {
      depth--;
      if (depth === 0) return { inner: text.slice(openAt + 1, i), end: i };
    }
  }
  return null;
}

/** 把 `dest "title"` 拆成两部分（title 可缺省） */
function splitDestTitle(inner: string): { dest: string; title: string } {
  const trimmed = inner.trim();
  const m = trimmed.match(/^([\s\S]*?)\s+(["'])([\s\S]*?)\2$/);
  if (m) return { dest: m[1].trim(), title: m[3] };
  return { dest: trimmed, title: '' };
}

/*
 * 文件名带空格的原生图片语法：`![](Grok 4.6 评测.png)`。
 *
 * CommonMark 规定不加尖括号的链接目标不能含空格，markdown-it 会把整段当普通文字，
 * 图根本不会渲染 —— 但 Obsidian / Typora 里带空格的截图文件名非常常见。
 * 这条规则只接管「标准语法必然失败」的情况（目标含空格且没写尖括号），
 * 其余一律放行给内置规则。
 */
md.inline.ruler.before('image', 'image_spaced', (state: any, silent: boolean) => {
  const src: string = state.src;
  const start: number = state.pos;
  if (src.charCodeAt(start) !== 0x21 /* ! */) return false;
  if (src.charCodeAt(start + 1) !== 0x5b /* [ */) return false;
  if (src.charCodeAt(start + 2) === 0x5b /* [ */) return false; // ![[ ]] 交给 obsidian_embed
  const labelEnd = src.indexOf(']', start + 2);
  if (labelEnd < 0) return false;
  if (src.charCodeAt(labelEnd + 1) !== 0x28 /* ( */) return false;
  const paren = scanParen(src, labelEnd + 1);
  if (!paren) return false;
  if (paren.inner.trim().startsWith('<')) return false; // 尖括号写法内置规则能处理
  const { dest, title } = splitDestTitle(paren.inner);
  if (!dest || !/\s/.test(dest)) return false; // 目标没空格 ⇒ 内置规则本来就正常
  if (!silent) {
    const token = state.push('image', 'img', 0);
    token.attrs = title
      ? [['src', dest], ['alt', ''], ['title', title]]
      : [['src', dest], ['alt', '']];
    token.content = src.slice(start + 2, labelEnd);
    token.children = [];
  }
  state.pos = paren.end + 1;
  return true;
});

const esc = md.utils.escapeHtml;

/* ---------------- 块级 ---------------- */

md.renderer.rules.heading_open = ((tokens, idx, _o, env) => {
  const th = env.theme;
  const tag = tokens[idx].tag;
  const styles: Record<string, string> = {
    'font-family': th.heading.font,
    'font-weight': th.heading.fontWeight,
    color: th.heading.color,
    'font-size': th.headingSizes[tag as keyof typeof th.headingSizes] ?? th.headingSizes.h3,
    'line-height': th.heading.lineHeight,
    'margin-top': idx === 0 ? '0' : th.heading.marginTop,
    'margin-bottom': th.heading.marginBottom,
  };
  if (th.heading.letterSpacing) styles['letter-spacing'] = th.heading.letterSpacing;
  const decor = th.heading.decor ?? 'none';
  if (decor === 'accent-bar' && idx > 0) {
    styles['border-top'] = `3px solid ${th.accent}`;
    styles['padding-top'] = '10px';
  } else if (decor === 'underline') {
    styles['border-bottom'] = `2px solid ${th.accent}`;
    styles['padding-bottom'] = '6px';
  } else if (decor === 'rule') {
    // 杂志粗规则线：更重的版面分割
    styles['border-bottom'] = `3px solid ${th.accent}`;
    styles['padding-bottom'] = '8px';
    styles['display'] = 'inline-block';
  } else if (decor === 'band') {
    styles['background'] = th.accentSoft ?? 'rgba(217,119,87,.12)';
    styles['padding'] = '4px 10px';
    styles['border-radius'] = '6px';
  }
  // 源码行号锚点（预览同步滚动用；map 是 0-based，CodeMirror 行号 1-based，+1 对齐）
  const line = tokens[idx].map?.[0];
  return `<${tag}${line != null ? ` data-line="${line}"` : ''} style="${st(styles)}">`;
}) as RenderRule;

md.renderer.rules.paragraph_open = ((tokens, idx, _o, env) => {
  // 脚注内容段已由 footnote_open 打开，跳过插件的段落包裹
  if (env.footnote) return '';
  const th = env.theme;
  const b = th.body;
  const nested = tokens[idx].level > 0;
  const line = tokens[idx].map?.[0];
  const dl = line != null ? ` data-line="${line}"` : '';
  return nested
    ? `<p${dl} style="${st({ 'font-family': b.font, 'font-size': b.fontSize, 'line-height': b.lineHeight, color: 'inherit', margin: '0' })}">`
    : `<p${dl} style="${st({
        'font-family': b.font,
        'font-size': b.fontSize,
        'line-height': b.lineHeight,
        color: b.color,
        margin: `0 0 ${env.theme.pMargin}`,
      })}">`;
}) as RenderRule;

md.renderer.rules.paragraph_close = ((_t, _i, _o, env) => {
  if (env.footnote) return '';
  return '</p>';
}) as RenderRule;

const listOpen =
  (ordered: boolean): RenderRule =>
  (tokens, idx, _o, env) => {
    const b = env.theme.body;
    const tag = ordered ? 'ol' : 'ul';
    // 待办清单检测：preprocess 已把 `- [x]` 转成 `☑`/`☐`，
    // 列表项内容包在 inline token 里，向前扫描首个 inline 判断
    let isTask = false;
    for (let i = idx + 1; i < Math.min(idx + 8, tokens.length); i++) {
      const t = tokens[i];
      if (t.type === 'bullet_list_close') break;
      if (t.type === 'inline' && /^[☑☐]/.test(t.content)) {
        isTask = true;
        break;
      }
    }
    const styles: Record<string, string> = {
      'font-family': b.font,
      'font-size': b.fontSize,
      'line-height': b.lineHeight,
      color: b.color,
      'padding-left': env.theme.listPaddingLeft,
      margin: tokens[idx].level > 0 ? '0' : `0 0 ${env.theme.pMargin}`,
    };
    if (isTask) {
      // 任务清单：无列表圆点（真实公众号样式），符号带左侧缩进
      styles['list-style'] = 'none';
      styles['padding-left'] = '8px';
    }
    return `<${tag} style="${st(styles)}">`;
  };

md.renderer.rules.bullet_list_open = listOpen(false);
md.renderer.rules.ordered_list_open = listOpen(true);
md.renderer.rules.bullet_list_close = (() => '</ul>') as RenderRule;
md.renderer.rules.ordered_list_close = (() => '</ol>') as RenderRule;

md.renderer.rules.list_item_open = ((tokens, idx, _o, env) => {
  const line = tokens[idx].map?.[0];
  return `<li${line != null ? ` data-line="${line}"` : ''} style="${st({ margin: env.theme.listItemMargin })}">`;
}) as RenderRule;
md.renderer.rules.list_item_close = (() => '</li>') as RenderRule;

/**
 * 提示条：preprocess 把 `> [!tip] 标题` 展开为 `> <!--TIP:标题-->` 标记行。
 * 标记行是独立的 html_block token（位于 blockquote 内容首部）。
 * 核心规则把所属 blockquote 标为 tip（渲染 callout 样式）、隐藏标记行本身、
 * 并把标题存进 meta 供渲染。
 */
md.core.ruler.push('tip_callout', (state) => {
  const tokens = state.tokens;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type !== 'html_block') continue;
    const m = t.content.match(/^<!--TIP:(.*)-->\n?$/s);
    if (!m) continue;
    const bq = i > 0 && tokens[i - 1].type === 'blockquote_open' ? tokens[i - 1] : null;
    if (!bq) continue;
    const title = m[1].trim().replace(/&#45;/g, '-');
    bq.meta = { ...(bq.meta ?? {}), tip: true, ...(title ? { title } : {}) };
    t.content = ''; // 隐藏标记行
  }
  return state;
});

md.renderer.rules.blockquote_open = ((tokens, idx, _o, env) => {
  const th = env.theme;
  const line = tokens[idx].map?.[0];
  const tip = tokens[idx].meta?.tip;
  if (tip) {
    // 提示条：整体用 callout 令牌渲染（含边框/底色/圆角/边距）
    const c = th.callout;
    // 无标题时用默认标题兜底 —— 否则 `> [!tip]` 不带标题的盒子首行是空的，
    // 标记被吃掉又没有任何视觉元素，看起来就像没渲染
    const title = tokens[idx].meta?.title ?? '提示';
    let s = `<blockquote data-tip${line != null ? ` data-line="${line}"` : ''} style="${st({
      'border-left': c.borderLeft,
      background: c.background,
      color: c.color,
      'border-radius': c.borderRadius,
      padding: c.padding,
      margin: c.margin,
      ...(c.extra ?? {}),
    })}">`;
    s += `<span style="${st({
      display: 'block',
      'font-weight': '700',
      color: c.badgeColor ?? th.accent,
      'margin-bottom': '8px',
    })}">💡 ${esc(title)}</span>`;
    return s;
  }
  const q = th.quote;
  let s = `<blockquote${line != null ? ` data-line="${line}"` : ''} style="${st({
    'border-left': q.borderLeft,
    background: q.background,
    color: q.color,
    'border-radius': q.borderRadius,
    padding: q.padding,
    margin: q.margin,
    ...(q.fontStyle ? { 'font-style': q.fontStyle } : {}),
    ...(q.extra ?? {}),
  })}">`;
  if (q.bigMark) {
    s += `<span style="${st({
      'font-family': 'Georgia, serif',
      'font-size': '26px',
      'line-height': '0',
      color: env.theme.accent,
      'margin-right': '6px',
      'vertical-align': '-4px',
    })}">“</span>`;
  }
  return s;
}) as RenderRule;

md.renderer.rules.blockquote_close = (() => '</blockquote>') as RenderRule;

/** 把 hljs 输出的 <span class="hljs-xxx"> 转成内联 color（微信粘贴无损），
 *  非高亮标签保留原文。palette: theme.codePalette（token class → 颜色） */
function inlineHighlight(html: string, palette: Record<string, string>): string {
  return html.replace(/<span class="([^"]+)">/g, (_m, cls: string) => {
    const tokens = cls.split(/\s+/);
    let color = '';
    for (const t of tokens) {
      if (palette[t]) {
        color = palette[t];
        break;
      }
    }
    return color ? `<span style="color:${color}">` : '<span>';
  });
}

/**
 * 把高亮后的 HTML 按行拆开：span 标签在行尾闭合、下一行重新打开。
 * 公众号粘贴会把 <pre> 里的 \n 拆散成独立段落导致换行错乱/内容丢失，
 * 逐行块级 <code> 不存在裸 \n，就没有被拆的可能。
 */
function splitCodeLines(html: string): string[] {
  const lines: string[] = [];
  const open: string[] = [];
  let cur = '';
  let hasText = false;
  const flush = () => {
    const body = cur + open.map(() => '</span>').join('');
    lines.push(hasText ? body : '&nbsp;');
    cur = open.join('');
    hasText = false;
  };
  let i = 0;
  while (i < html.length) {
    const ch = html[i];
    if (ch === '<') {
      const end = html.indexOf('>', i);
      const tag = html.slice(i, end + 1);
      if (tag.startsWith('</')) open.pop();
      else open.push(tag);
      cur += tag;
      i = end + 1;
    } else if (ch === '\n') {
      flush();
      i++;
    } else {
      cur += ch;
      // 逐字符正则（/\s/）在长代码块上开销可观，这里直接比对空白字符
      if (ch !== ' ' && ch !== '\t' && ch !== '\r') hasText = true;
      i++;
    }
  }
  if (cur && (hasText || lines.length === 0)) flush();
  return lines;
}

/**
 * 高亮结果缓存（LRU）。
 *
 * 每次按键都会整篇重渲染，同一段代码会被反复 tokenize —— 高亮是渲染里最贵的一步。
 * 这里按 (语言, 源码) 缓存 hljs 的原始输出（class 版），
 * 主题相关的内联着色（inlineHighlight）留在缓存外，切主题不必重新 tokenize。
 */
const HL_CACHE_MAX = 128;
const hlCache = new Map<string, string>();

/** 取高亮后的 class 版 HTML；未标注语言 / 高亮器未就绪 / 失败时返回 null */
function highlightCached(code: string, lang: string): string | null {
  if (!lang || !hljs) return null;
  const key = `${lang}\u0000${code}`;
  const hit = hlCache.get(key);
  if (hit !== undefined) {
    // 命中后移到队尾，维持 LRU 顺序
    hlCache.delete(key);
    hlCache.set(key, hit);
    return hit;
  }
  let out: string;
  try {
    out = hljs.getLanguage(lang)
      ? hljs.highlight(code, { language: lang, ignoreIllegals: true }).value
      : // 语言标签存在但未注册：退回自动检测
        hljs.highlightAuto(code).value;
  } catch {
    return null;
  }
  hlCache.set(key, out);
  if (hlCache.size > HL_CACHE_MAX) hlCache.delete(hlCache.keys().next().value as string);
  return out;
}

/**
 * 把 hljs 输出里的 HTML 实体解码回原字符。
 * 解码后文本必须与源码逐字符对齐，编辑态代码块才能按偏移映射回文档位置。
 */
function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_m, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_m, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

/** 一段着色区间：from/to 是相对代码源串的偏移（解码后口径，与源码逐字符对齐） */
export interface SyntaxSpan {
  from: number;
  to: number;
  /** hljs token 类名（多类取第一个，如 hljs-keyword） */
  cls: string;
}

/**
 * 把一段代码按 hljs tokenize 结果拆成着色区间（编辑态代码块高亮用）。
 * 复用 highlightCached 的 LRU 缓存 —— 编辑时每次按键都会重算，不能反复 tokenize。
 * 未标注语言 / 高亮器未就绪 / tokenize 失败返回 null，调用方按无高亮处理。
 */
export function highlightSpans(code: string, lang: string): SyntaxSpan[] | null {
  if (!lang || !hljs) return null;
  const html = highlightCached(code, lang);
  if (html == null) return null;
  const spans: SyntaxSpan[] = [];
  /** 开着的 span 类名栈；hljs 会嵌套（hljs-string 里包 hljs-subst），最内层为准 */
  const stack: string[] = [];
  let i = 0;
  let off = 0;
  while (i < html.length) {
    if (html[i] === '<') {
      const end = html.indexOf('>', i);
      if (end < 0) break;
      const tag = html.slice(i, end + 1);
      if (tag.startsWith('</')) stack.pop();
      else stack.push(/^<span class="([^"]*)"/.exec(tag)?.[1] ?? '');
      i = end + 1;
      continue;
    }
    let j = i;
    while (j < html.length && html[j] !== '<') j++;
    const text = decodeHtmlEntities(html.slice(i, j));
    if (text) {
      for (let k = stack.length - 1; k >= 0; k--) {
        const cls = stack[k].split(/\s+/)[0];
        if (cls) {
          spans.push({ from: off, to: off + text.length, cls });
          break;
        }
      }
      off += text.length;
    }
    i = j;
  }
  return spans;
}

const renderCode: RenderRule = (tokens, idx, _o, env) => {
  const c = env.theme.codeBlock;
  const raw = tokens[idx].content;
  const lang = (tokens[idx].info || '').trim().split(/\s+/)[0];
  const highlighted = highlightCached(raw, lang);
  const inner = highlighted !== null ? inlineHighlight(highlighted, env.theme.codePalette) : esc(raw);
  const line = tokens[idx].map?.[0];
  // 每行的 style 都一样，提到循环外算一次（长代码块能省掉成百次字符串拼接）
  const lineStyle = st({
    display: 'block',
    'font-family': env.theme.mono,
    'font-size': c.fontSize,
    'line-height': c.lineHeight,
    color: 'inherit',
    'white-space': 'pre',
  });
  // 逐行块级 <code>：无裸 \n，公众号粘贴不会拆行/丢内容
  const linesHtml = splitCodeLines(inner)
    .map((l) => `<code style="${lineStyle}">${l}</code>`)
    .join('');
  return `<pre${line != null ? ` data-line="${line}"` : ''} style="${st({
    background: c.background,
    color: c.color,
    'border-radius': c.borderRadius,
    padding: c.padding,
    'overflow-x': 'auto',
    margin: `0 0 ${env.theme.pMargin}`,
    'font-family': env.theme.mono,
    'font-size': c.fontSize,
    'line-height': c.lineHeight,
    ...(c.extra ?? {}),
  })}">${linesHtml}</pre>`;
};
md.renderer.rules.fence = renderCode;
md.renderer.rules.code_block = renderCode;

md.renderer.rules.hr = ((_t, _i, _o, env) =>
  `<hr style="${st({
    border: 'none',
    'border-top': `1px solid ${env.theme.hr.color}`,
    margin: env.theme.hr.margin,
  })}" />`) as RenderRule;

/* ---------------- 表格 ---------------- */

md.renderer.rules.table_open = ((_t, _i, _o, env) => {
  const b = env.theme.body;
  // 标记进入表格：单元格内容在 text 规则里要把 <br> 还原成真换行
  env.inTable = true;
  return `<table style="${st({
    'font-family': b.font,
    'font-size': env.theme.table.fontSize,
    'line-height': b.lineHeight,
    color: b.color,
    'border-collapse': 'collapse',
    width: '100%',
    margin: `0 0 ${env.theme.pMargin}`,
  })}">`;
}) as RenderRule;

md.renderer.rules.table_close = ((_t, _i, _o, env) => {
  env.inTable = false;
  return '</table>';
}) as RenderRule;

/**
 * 单元格里的 `<br>` 还原成真换行。
 *
 * MarkdownIt 的表格单元格内容以纯文本模式解析，html 规则不参与，
 * 所以源码里的 `<br>` 会被 escapeHtml 成 `&lt;br&gt;` 原样显示 ——
 * 用户粘贴的多行文本落到预览就挤成一坨。这里只在表格内把转义形态
 * 换回标签；表格外的 `<br>` 保持原样，免得正文里手写的 <br> 意外生变。
 *
 * 只在 table 上下文中生效，所以不会影响正文换行语义（正文靠段落/软换行）。
 */
md.renderer.rules.text = ((tokens, idx, _o, env) => {
  const content = tokens[idx].content;
  if (!env.inTable) return esc(content);
  return esc(content).replace(/&lt;br\s*\/?&gt;/gi, '<br>');
}) as RenderRule;

md.renderer.rules.thead_open = (() => '<thead>') as RenderRule;

md.renderer.rules.th_open = ((_t, _i, _o, env) => {
  const tb = env.theme.table;
  return `<th style="${st({
    border: `1px solid ${tb.borderColor}`,
    padding: tb.cellPadding,
    'text-align': 'left',
    'font-weight': '700',
    background: tb.headBg,
    color: tb.headColor,
  })}">`;
}) as RenderRule;

md.renderer.rules.td_open = ((_t, _i, _o, env) => {
  const tb = env.theme.table;
  return `<td style="${st({
    border: `1px solid ${tb.borderColor}`,
    padding: tb.cellPadding,
  })}">`;
}) as RenderRule;

/* ---------------- 行内 ---------------- */

md.renderer.rules.code_inline = ((tokens, idx, _o, env) => {
  const c = env.theme.code;
  return `<code style="${st({
    background: c.background,
    color: c.color,
    'border-radius': c.borderRadius,
    padding: c.padding,
    'font-family': env.theme.mono,
    'font-size': c.fontSize,
    ...(c.extra ?? {}),
  })}">${esc(tokens[idx].content)}</code>`;
}) as RenderRule;

md.renderer.rules.strong_open = ((_t, _i, _o, env) =>
  `<strong style="${st({ 'font-weight': '700', color: env.theme.strongColor })}">`) as RenderRule;
md.renderer.rules.strong_close = (() => '</strong>') as RenderRule;

md.renderer.rules.em_open = (() => '<em style="font-style: italic;">') as RenderRule;
md.renderer.rules.em_close = (() => '</em>') as RenderRule;

md.renderer.rules.del_open = ((_t, _i, _o, env) =>
  `<del style="${st({ color: env.theme.delColor })}">`) as RenderRule;
md.renderer.rules.del_close = (() => '</del>') as RenderRule;

/* ==高亮== 标记（markdown-it-mark） */
md.renderer.rules.mark_open = ((_t, _i, _o, env) => {
  const m = env.theme.mark;
  return `<mark style="${st({
    background: m.background,
    color: m.color,
    'border-radius': m.borderRadius,
    padding: m.padding,
  })}">`;
}) as RenderRule;
md.renderer.rules.mark_close = (() => '</mark>') as RenderRule;

md.renderer.rules.link_open = ((tokens, idx, _o, env) => {
  const l = env.theme.link;
  const href = esc(tokens[idx].attrGet('href') ?? '');
  return `<a href="${href}" target="_blank" rel="noopener noreferrer" style="${st({
    color: l.color,
    'text-decoration': l.textDecoration,
    'word-break': 'break-all',
  })}">`;
}) as RenderRule;
md.renderer.rules.link_close = (() => '</a>') as RenderRule;

/** 绝对地址（含协议相对、data、blob）直接使用，不去图片库里找 */
function isAbsoluteUrl(src: string): boolean {
  return /^(?:https?:)?\/\//i.test(src) || /^(?:data|blob):/i.test(src);
}

/**
 * 把本地相对路径解析成图片库里的 data URI。
 *
 * 两点要注意：
 * - markdown-it 会对 src 做百分号编码，中文文件名会变成 %E5%9B%BE…，得先解码；
 * - Obsidian/Typora 常写成 `assets/图.png` 这类带目录的路径，
 *   而图片库只按文件名索引，所以也要退回到 basename 再找一次。
 */
function lookupLocalImage(src: string, images?: Record<string, string>): string | null {
  if (!images || !src) return null;
  let decoded = src;
  try {
    decoded = decodeURIComponent(src);
  } catch {
    // 编码不合法就用原值
  }
  for (const candidate of [decoded, src]) {
    if (images[candidate]) return images[candidate];
    const base = candidate.split(/[\\/]/).pop() ?? candidate;
    if (images[base]) return images[base];
  }
  return null;
}

/** 把本地路径归一化成图片库的键（解码 + 去目录） */
function localImageKey(src: string): string {
  let decoded = src;
  try {
    decoded = decodeURIComponent(src);
  } catch {
    // 编码不合法就用原值
  }
  return decoded.split(/[\\/]/).pop() ?? decoded;
}

/**
 * 收集正文里引用到的本地图片文件名（两种语法都算）。
 *
 * 图片库的「是否被引用」判断必须和渲染时的解析口径一致，
 * 否则用原生语法引用的图会被当成未引用、被一键清理误删。
 */
export function collectImageRefs(markdown: string): Set<string> {
  const names = new Set<string>();
  // Obsidian 嵌入 ![[name]]
  for (const m of markdown.matchAll(/!\[\[\s*([^\]\n]+?)\s*\]\]/g)) {
    names.add(m[1]);
    names.add(localImageKey(m[1]));
  }
  // 原生语法 ![alt](src "title")：与渲染同一套扫描口径，含空格/括号的文件名也要认
  let i = 0;
  while (i < markdown.length) {
    const bang = markdown.indexOf('![', i);
    if (bang < 0) break;
    if (markdown.charCodeAt(bang + 2) === 0x5b) {
      i = bang + 2;
      continue;
    }
    const labelEnd = markdown.indexOf(']', bang + 2);
    if (labelEnd < 0) break;
    if (markdown.charCodeAt(labelEnd + 1) !== 0x28) {
      i = labelEnd + 1;
      continue;
    }
    const paren = scanParen(markdown, labelEnd + 1);
    if (!paren) {
      i = labelEnd + 1;
      continue;
    }
    const raw = paren.inner.trim().replace(/^<|>$/g, '');
    const { dest } = splitDestTitle(raw);
    if (dest && !isAbsoluteUrl(dest)) names.add(localImageKey(dest));
    i = paren.end + 1;
  }
  return names;
}

/** 某一行是否引用了指定图片（定位用，与上面同一套口径） */
export function lineReferencesImage(line: string, name: string): boolean {
  return collectImageRefs(line).has(name);
}

/** 图片未找到时的占位提示（原生语法与 ![[ ]] 共用） */
function missingImage(name: string, th: Theme): string {
  return `<span style="${st({
    display: 'block',
    border: `1px dashed ${th.hr.color}`,
    'border-radius': '8px',
    padding: '12px 14px',
    color: th.footnote.textColor,
    'font-size': '13px',
    margin: th.img.margin,
  })}">${esc(name)} — 本地图片库里没有这张图，把图片文件拖进左侧编辑器即可</span>`;
}

/** 渲染一张图；inline 为 true 时不独占一行（句子中间的图不该被拆开） */
function renderImg(src: string, alt: string, title: string | null, th: Theme, inline: boolean): string {
  const style = inline
    ? st({ 'max-width': '100%', 'border-radius': th.img.borderRadius, display: 'inline-block', 'vertical-align': 'middle' })
    : st({ 'max-width': '100%', 'border-radius': th.img.borderRadius, display: 'block', margin: th.img.margin });
  // 外链图（微信 mmbiz 等图床校验 Referer 防盗链）不带 referrer 才能加载
  const refPolicy = /^https?:\/\//i.test(src) ? ' referrerpolicy="no-referrer"' : '';
  return `<img src="${esc(src)}" alt="${esc(alt)}"${title ? ` title="${esc(title)}"` : ''}${refPolicy} style="${style}" />`;
}

/** 同一个 inline 容器里除了图片还有别的可见内容 ⇒ 这张图是夹在文字中间的 */
function isInlineImage(tokens: Token[], idx: number): boolean {
  for (let i = 0; i < tokens.length; i++) {
    if (i === idx) continue;
    const t = tokens[i];
    if (t.type === 'image' || t.type === 'obsidian_embed') continue;
    if (t.type === 'softbreak' || t.type === 'hardbreak') continue;
    if (t.type === 'text') {
      if (t.content.trim()) return true;
      continue;
    }
    return true;
  }
  return false;
}

md.renderer.rules.image = ((tokens, idx, _o, env) => {
  const token = tokens[idx];
  const rawSrc = token.attrGet('src') ?? '';
  const alt = token.content;
  const title = token.attrGet('title');
  const inline = isInlineImage(tokens, idx);
  if (isAbsoluteUrl(rawSrc)) {
    return renderImg(rawSrc, alt, title, env.theme, inline);
  }
  // 相对路径：先按文件名去本地图片库找，这样 ![](图.png) 与 ![[图.png]] 行为一致
  const local = lookupLocalImage(rawSrc, env.images);
  if (local) return renderImg(local, alt || rawSrc, title, env.theme, inline);
  if (!rawSrc) return '';
  let label = rawSrc;
  try {
    label = decodeURIComponent(rawSrc);
  } catch {
    // 保留原值
  }
  return missingImage(label, env.theme);
}) as RenderRule;

md.renderer.rules.obsidian_embed = ((tokens, idx, _o, env) => {
  const name = tokens[idx].meta?.name ?? tokens[idx].content ?? '';
  const uri = env.images?.[name] ?? lookupLocalImage(name, env.images);
  if (uri) return renderImg(uri, name, null, env.theme, isInlineImage(tokens, idx));
  return missingImage(name, env.theme);
}) as RenderRule;

/* ---------------- 脚注 ---------------- */

md.renderer.rules.footnote_ref = ((tokens, idx, _o, env) => {
  const n = Number(tokens[idx].meta?.id ?? 0) + 1;
  return `<sup style="${st({
    'font-size': '0.72em',
    'line-height': '1',
    color: env.theme.footnote.refColor,
  })}"><a href="#fn${n}" style="${st({
    color: env.theme.footnote.refColor,
    'text-decoration': 'none',
  })}">[${n}]</a></sup>`;
}) as RenderRule;

md.renderer.rules.footnote_block_open = ((_t, _i, _o, env) => {
  const f = env.theme.footnote;
  return `<section style="${st({
    'margin-top': '36px',
    'padding-top': '14px',
    'border-top': `1px solid ${f.blockBorder}`,
  })}">`;
}) as RenderRule;
md.renderer.rules.footnote_block_close = (() => '</section>') as RenderRule;

md.renderer.rules.footnote_open = ((tokens, idx, _o, env) => {
  const f = env.theme.footnote;
  const n = Number(tokens[idx].meta?.id ?? 0) + 1;
  env.footnote = true;
  return `<p style="${st({
    margin: '3px 0',
    'font-size': f.textSize,
    'line-height': '1.6',
    color: f.textColor,
  })}"><span style="${st({
    color: f.numColor,
    'font-weight': '700',
    'margin-right': '4px',
  })}">[${n}]</span> `;
}) as RenderRule;
md.renderer.rules.footnote_close = ((_t, _i, _o, env) => {
  env.footnote = false;
  return '</p>';
}) as RenderRule;

md.renderer.rules.footnote_anchor = ((tokens, idx, _o, env) => {
  const f = env.theme.footnote;
  const n = Number(tokens[idx].meta?.id ?? 0) + 1;
  return ` <a href="#fnref${n}" style="${st({
    color: f.textColor,
    'text-decoration': 'none',
    'margin-left': '4px',
  })}">↩</a>`;
}) as RenderRule;

/* ---------------- 待办清单预处理 ---------------- */

/**
 * markdown-it 原生不支持任务清单与提示条。这里在渲染前预替换：
 * - `- [ ]` / `- [x]` → ☐ / ☑（任务清单）
 * - `> [!tip]` → `> <!--TIP:标题-->`（提示条标记；HTML 注释不参与渲染，
 *   核心规则再读取标题，详情见 tip_callout）
 * 均为纯文本、微信安全，并跳过代码围栏内的内容。
 */
function preprocess(src: string): string {
  let inFence = false;
  const lines = src.split('\n').map((line) => {
    const trimmed = line.trimStart();
    if (trimmed.startsWith('```') || trimmed.startsWith('~~~')) {
      inFence = !inFence;
      return line;
    }
    if (inFence) return line;
    return line
      .replace(/^(\s*)-\s+\[ \]\s+/, '$1- ☐ ')
      .replace(/^(\s*)-\s+\[[xX]\]\s+/, '$1- ☑ ')
      .replace(/^\s*>\s*\[!tip\]\s*(.*)$/i, (_m, title: string) => {
        // 展开为标记行：`> [!tip]` 单独成行时标题进注释，跟行内则标记 + 标题同段；
        // 标题里的连字符转义，避免提前终止 HTML 注释（读取时还原）
        const safe = title.trim().replace(/-/g, '&#45;');
        return safe ? `> <!--TIP:${safe}-->` : '> <!--TIP:-->';
      });
  });
  return lines.join('\n');
}

/** 待办符号着色：☑ 用强调色、☐ 用浅灰（原样替换 ☐/☑ 字符） */
function colorTasks(html: string, th: Theme): string {
  return html
    .replace(/☑/g, `<span style="color:${th.accent};font-weight:700">☑</span>`)
    .replace(/☐/g, `<span style="color:${th.delColor};font-weight:400">☐</span>`);
}

/* ---------------- 渲染入口 ---------------- */

export interface RenderResult {
  /** 正文 HTML（不含外层包裹，供预览 / 导出检查共用） */
  body: string;
  /** 完整导出 HTML（含带基础字体的 section 包裹） */
  html: string;
  /** 正文是否包含图片 */
  hasImage: boolean;
}

export function renderArticle(
  markdown: string,
  theme?: Theme,
  images?: Record<string, string>,
  density?: DensityScale,
): RenderResult {
  const th = density ? applyDensity(theme ?? getTheme(), density) : theme ?? getTheme();
  const body = colorTasks(md.render(preprocess(markdown), { theme: th, images }), th);
  const html = `<section style="${st({
    'font-family': th.body.font,
    'font-size': th.body.fontSize,
    'line-height': th.body.lineHeight,
    color: th.body.color,
    'word-break': 'break-word',
    ...(th.body.bg ? { background: th.body.bg } : {}),
  })}">${body}</section>`;
  return {
    body,
    html,
    hasImage: /<img\s/i.test(body),
  };
}

/* ---------------- 正文 HTML 小工具（预览 / 长图共用） ---------------- */

/** 从正文 HTML 提取第一个一级标题作为文章标题 */
export function extractTitle(body: string): string {
  const m = body.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (!m) return '';
  return m[1]
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

/** 移除正文中的第一个 h1（文章头已单独展示标题，避免重复；导出到公众号不受影响） */
export function stripFirstH1(body: string): string {
  return body.replace(/<h1[^>]*>[\s\S]*?<\/h1>/i, '');
}
