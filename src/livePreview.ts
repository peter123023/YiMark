/**
 * 直接编辑模式（所见即所得）：在 CodeMirror 里把 Markdown 标记「渲染」掉，但文本本身不变。
 *
 * 与源码模式的区别是**标记永远不露出来** —— 不像 Obsidian 那样光标移到那一行就还原成 `**粗体**`。
 * 看到的就是排版后的样子，可以直接在上面改：
 * - 标记（#、**、>、` 等）一律用 Decoration.replace 藏起来
 * - 内容用 Decoration.mark 加类，由 CSS 决定长什么样
 * - 图片 ![[name]] / 任务勾选框 / 分割线用 Widget 换成真实元素
 * - 回车自动续列表 / 引用，行首退格自动去掉列表标记（标记看不见了，得靠这些把编辑补回来）
 *
 * 需要看源码时用「对照」模式 —— 左边就是原文。
 *
 * 文档始终是纯 Markdown：复制到公众号、导出、字数统计都走同一份文本，不会因为渲染而失真。
 */

import { Annotation, EditorState, Range, StateEffect, StateField, type Extension, type Text } from '@codemirror/state';
import {
  Decoration,
  type DecorationSet,
  EditorView,
  keymap,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from '@codemirror/view';
import { ensureHighlighter, highlightSpans, isHighlighterReady } from './markdown';

/** 图片表（文件名 → data URI）；草稿切换、增删图片时派发这个 effect 刷新 */
export const setLiveImages = StateEffect.define<Record<string, string>>();

/** 标记「这个事务来自表格 widget 自己」：tableField 据此只映射位置、不重建 widget */
const tableSync = Annotation.define<number>();
/** 表格 widget 的自持监听派发事务时要用 view；本应用同一时刻只有一个编辑器实例 */
let liveEditorView: EditorView | null = null;

const imagesField = StateField.define<Record<string, string>>({
  create: () => ({}),
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setLiveImages)) return e.value;
    return value;
  },
});

/** 藏起一段标记（复用同一实例：Decoration 是不可变值，可以多处引用） */
const HIDE = Decoration.replace({});

/* ---------------- 替换用的小部件 ---------------- */

class ImageWidget extends WidgetType {
  constructor(
    private readonly src: string,
    private readonly alt: string,
  ) {
    super();
  }

  eq(other: ImageWidget): boolean {
    return other.src === this.src && other.alt === this.alt;
  }

  toDOM(): HTMLElement {
    const wrap = document.createElement('span');
    wrap.className = 'cm-lp-image';
    const img = document.createElement('img');
    img.src = this.src;
    img.alt = this.alt;
    wrap.appendChild(img);
    return wrap;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

/** 列表符号：无序统一渲染成圆点，有序保留序号 */
class GlyphWidget extends WidgetType {
  constructor(private readonly glyph: string) {
    super();
  }

  eq(other: GlyphWidget): boolean {
    return other.glyph === this.glyph;
  }

  toDOM(): HTMLElement {
    const el = document.createElement('span');
    el.className = 'cm-lp-bullet';
    el.textContent = this.glyph;
    return el;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

/** 任务勾选框：点击直接改文档里的 [ ] / [x] */
class CheckboxWidget extends WidgetType {
  constructor(
    private readonly checked: boolean,
    private readonly from: number,
    private readonly to: number,
  ) {
    super();
  }

  eq(other: CheckboxWidget): boolean {
    return other.checked === this.checked && other.from === this.from && other.to === this.to;
  }

  toDOM(): HTMLElement {
    const el = document.createElement('span');
    el.className = `cm-lp-checkbox ${this.checked ? 'checked' : ''}`;
    // 位置存进 DOM：点击时按文档坐标改回文本
    el.dataset.from = String(this.from);
    el.dataset.to = String(this.to);
    el.textContent = this.checked ? '✓' : '';
    return el;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

/** 分割线：整行替换成一条线 */
class HrWidget extends WidgetType {
  eq(): boolean {
    return true;
  }

  toDOM(): HTMLElement {
    const el = document.createElement('span');
    el.className = 'cm-lp-hr';
    return el;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

/** 提示条灯泡：`> [!tip]` 不带标题时标记位显示它，与预览里的「💡 提示」标题对应 */
class TipIconWidget extends WidgetType {
  eq(): boolean {
    return true;
  }

  toDOM(): HTMLElement {
    const el = document.createElement('span');
    el.className = 'cm-lp-tip-icon';
    el.textContent = '💡';
    return el;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

/** 代码块语言标签：开围栏整行被藏掉后，语言标注就靠它（同时充当卡片的圆角顶边） */
class CodeLabelWidget extends WidgetType {
  constructor(private readonly lang: string) {
    super();
  }

  eq(other: CodeLabelWidget): boolean {
    return other.lang === this.lang;
  }

  toDOM(): HTMLElement {
    const el = document.createElement('span');
    el.className = 'cm-lp-lang';
    el.textContent = this.lang;
    return el;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

/**
 * 单元格内换行在源码里的写法。
 *
 * Markdown 表格一行就是一行，真换行会把表格拆散，所以单元格里只能用 `<br>`
 * 表达分行；markdown.ts 开了 html:true，渲染时会把它当标签换行。
 * 抽成常量是因为读写两侧都要用，改一处必须同时生效。
 */
const CELL_BR = '<br>';

/**
 * 把单元格源码文本填进 DOM：`<br>` 渲染成真实换行，其余字符按纯文本处理。
 *
 * 不用 innerHTML 整体赋值 —— 单元格里的 `<` `&` 这类字符是用户正文，
 * 直接塞会被当 HTML 解析。这里只把 <br> 拆出来当换行，别的都走 textContent。
 */
function setCellContent(cell: HTMLElement, text: string) {
  cell.textContent = '';
  const parts = text.split(CELL_BR);
  parts.forEach((seg, i) => {
    if (i > 0) cell.appendChild(document.createElement('br'));
    if (seg) cell.appendChild(document.createTextNode(seg));
  });
}

/**
 * 单元格 DOM → 源码文本。
 *
 * 单元格是 plaintext-only，内部换行以 \n 形式存在（execCommand insertHTML
 * 在这里也会被降级成纯文本，产不出 <br> 标签）。读的时候必须走 innerText —— 
 * innerHTML 里 \n 只是普通空白，会被折叠掉，用户的换行就丢了。
 *
 * 拿到 \n 后转成 <br> 字面量写进源码：这样表格结构不破，预览里保留分行。
 * 半角 | 是列分隔符，换全角，否则表格会多出一列。
 */
function cellTextFrom(el: HTMLElement | null): string {
  if (!el) return '';
  // innerText 会按渲染结果给换行（<br> 与块级边界都算），正好是我们要的分行语义
  const text = el.innerText ?? '';
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/\n/g, CELL_BR)
    .replace(/\|/g, '｜')
    .trim();
}

/**
 * GFM 表格：整块渲染成真表格，单元格直接可编辑（contentEditable）。
 * 编辑产生的文本通过 tableSync 事务写回文档；tableField 对这类事务只映射
 * 位置、复用同一 widget 实例（不换 DOM），光标和输入法组合状态才不会丢。
 */
class TableWidget extends WidgetType {
  /** 可变字段：posFrom/posTo 由 tableField 在文档变化时更新；src 同步后更新 */
  src: string;
  s: number;
  e: number;
  posFrom = 0;
  posTo = 0;
  private el: HTMLElement | null = null;
  /** 原始分隔行（含对齐冒号），序列化时原样保留 */
  private readonly sepLine: string;

  constructor(src: string, s: number, e: number) {
    super();
    this.src = src;
    this.s = s;
    this.e = e;
    this.sepLine = src.split('\n')[1] ?? '| --- |';
  }

  eq(other: TableWidget): boolean {
    return other.src === this.src && other.s === this.s && other.e === this.e;
  }

  toDOM(): HTMLElement {
    const el = document.createElement('div');
    el.className = 'cm-lp-table';
    this.el = el;
    const rows = this.src.split('\n').filter((_, i) => i !== 1); // 第二行是分隔行，不渲染
    const cells = rows.map((r) =>
      r
        .replace(/^\s*\|/, '')
        .replace(/\|\s*$/, '')
        .split('|')
        .map((c) => c.trim()),
    );
    const table = document.createElement('table');
    const [head, ...body] = cells;
    if (head) {
      const tr = table.createTHead().insertRow();
      for (const c of head) {
        const th = document.createElement('th');
        setCellContent(th, c);
        tr.appendChild(th);
      }
    }
    const tbody = table.createTBody();
    for (const r of body) {
      const tr = tbody.insertRow();
      for (const c of r) {
        const td = tr.insertCell();
        setCellContent(td, c);
      }
    }
    el.appendChild(table);
    for (const cell of el.querySelectorAll<HTMLElement>('th, td')) {
      this.makeEditable(cell);
    }
    el.addEventListener('input', () => this.sync());
    el.addEventListener('keydown', (e) => this.onKeyDown(e));
    el.addEventListener('paste', (e) => this.onPaste(e));
    return el;
  }

  /** 单元格可编辑：优先 plaintext-only（纯文本、无富文本残留），不支持则退回 true */
  private makeEditable(cell: HTMLElement) {
    try {
      cell.contentEditable = 'plaintext-only';
    } catch {
      cell.contentEditable = 'true';
    }
    if (cell.contentEditable !== 'plaintext-only') cell.contentEditable = 'true';
    cell.spellcheck = false;
  }

  private onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      this.focusNextCell(1);
    } else if (e.key === 'Tab') {
      e.preventDefault();
      this.focusNextCell(e.shiftKey ? -1 : 1);
    } else if (e.key === '|') {
      // 半角竖线会破坏列结构，替换成全角
      e.preventDefault();
      document.execCommand('insertText', false, '｜');
    }
  }

  /**
   * 单元格粘入纯文本。
   *
   * 以前把换行一律替换成空格：从网页/文档复制的多行文字被压成一坨，读不了。
   * 现在把 \n 原样插进单元格（plaintext-only 下会真实分行显示），
   * sync() 落回源码时再转成 <br> —— 表格结构不破，预览里也保留分行。
   *
   * 不用 insertHTML：plaintext-only 单元格会把它降级成纯文本，捏不出 <br> 标签。
   * 半角 | 是列分隔符，仍必须换全角，否则表格会多出一列。
   */
  private onPaste(e: ClipboardEvent) {
    e.preventDefault();
    const text = e.clipboardData?.getData('text/plain') ?? '';
    document.execCommand('insertText', false, text.replace(/\|/g, '｜').replace(/\r\n?/g, '\n').trim());
  }

  private focusNextCell(dir: 1 | -1) {
    const cells = [...(this.el?.querySelectorAll<HTMLElement>('th, td') ?? [])];
    const i = cells.indexOf(document.activeElement as HTMLElement);
    const next = cells[i + dir];
    if (!next) {
      (document.activeElement as HTMLElement | null)?.blur();
      return;
    }
    next.focus();
    const range = document.createRange();
    range.selectNodeContents(next);
    range.collapse(false);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
  }

  /** 读当前 DOM 单元格 → 还原成表格 Markdown → 写回文档 */
  private sync() {
    const view = liveEditorView;
    if (!view || !this.el || this.posTo <= this.posFrom) return;
    const table = this.el.querySelector('table');
    if (!table) return;
    // 单元格内的换行在源码里写成 <br>（粘贴时转的），这里把它读回来，
    // 不能压成空格 —— 否则用户粘贴的多行文字一编辑就被重新拍平
    const clean = (el: HTMLElement | null) => cellTextFrom(el);
    const rowEls = [...table.querySelectorAll('tr')];
    if (!rowEls.length) return;
    const lines = [
      `| ${[...(rowEls[0].children ?? [])].map((c) => clean(c as HTMLElement)).join(' | ')} |`,
      this.sepLine,
      ...rowEls.slice(1).map((tr) => `| ${[...tr.children].map((c) => clean(c as HTMLElement)).join(' | ')} |`),
    ];
    const md = lines.join('\n');
    if (md === this.src) return;
    this.src = md;
    view.dispatch({
      changes: { from: this.posFrom, to: this.posTo, insert: md },
      annotations: tableSync.of(1),
    });
  }

  // true：CM 不插手 widget 内部的点击/输入，单元格的 contentEditable 全权接管
  ignoreEvent(): boolean {
    return true;
  }
}

/* ---------------- 表格块装饰（StateField） ---------------- */

/**
 * GFM 表格块：连续的 | 行（≥2 行）且第二行是 --- 分隔行。
 * 只认首尾都有竖线的写法 —— 省略首尾竖线的 GFM 变体太容易误伤普通含 | 的文本。
 */
function scanTables(doc: Text, inCode: Uint8Array) {
  const isTableLine = (t: string) => /^\s*\|.*\|\s*$/.test(t);
  const isSepRow = (t: string) => /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|?\s*$/.test(t);
  const blocks: { s: number; e: number }[] = [];
  for (let n = 1; n <= doc.lines; n++) {
    if (inCode[n]) continue;
    if (!isTableLine(doc.line(n).text)) continue;
    let e = n;
    while (e + 1 <= doc.lines && !inCode[e + 1] && isTableLine(doc.line(e + 1).text)) e++;
    if (e >= n + 1 && isSepRow(doc.line(n + 1).text)) {
      blocks.push({ s: n, e });
      n = e;
    }
  }
  return blocks;
}

/**
 * 表格块装饰必须住在 StateField 里 —— CM6 明令禁止 ViewPlugin 提供 block 装饰
 * （RangeError: Block decorations may not be specified via plugins）。
 * 光标在块内时不产 widget（源码态，仅在方向键硬闯时出现）；
 * widget 自己的同步事务只映射位置、复用 widget 实例，编辑中的光标才不会丢。
 */
const tableField = StateField.define<DecorationSet>({
  create: (state) => buildTableDecos(state),
  update(value, tr) {
    if (tr.annotation(tableSync) !== undefined) {
      const mapped = value.map(tr.changes);
      // 把映射后的块位置写回 widget（它的自持监听派发下一次同步时要用）
      const it = mapped.iter();
      while (it.value) {
        const w = (it.value.spec as { widget?: TableWidget }).widget;
        if (w instanceof TableWidget) {
          w.posFrom = it.from;
          w.posTo = it.to;
        }
        it.next();
      }
      return mapped;
    }
    return !tr.docChanged && !tr.selection ? value : buildTableDecos(tr.state, value);
  },
  provide: (f) => EditorView.decorations.compute([f], (state) => state.field(f)),
});

function buildTableDecos(state: EditorState, previous?: DecorationSet): DecorationSet {
  const doc = state.doc;
  const inCode = new Uint8Array(doc.lines + 1);
  let fence = false;
  for (let n = 1; n <= doc.lines; n++) {
    const isFence = /^\s*(```|~~~)/.test(doc.line(n).text);
    inCode[n] = isFence ? 2 : fence ? 1 : 0;
    if (isFence) fence = !fence;
  }
  const head = state.selection.main.head;
  // 旧 widget 按「块起点」登记：内容没变就复用同一实例，DOM（编辑中的光标）不重建
  const reused = new Map<number, TableWidget>();
  if (previous) {
    const it = previous.iter();
    while (it.value) {
      const w = (it.value.spec as { widget?: TableWidget }).widget;
      if (w instanceof TableWidget) reused.set(w.posFrom, w);
      it.next();
    }
  }
  const decos: Range<Decoration>[] = [];
  for (const { s, e } of scanTables(doc, inCode)) {
    const from = doc.line(s).from;
    const to = doc.line(e).to;
    if (head >= from && head <= to) continue; // 光标在块内：显示源码行
    const src = doc.sliceString(from, to);
    const old = reused.get(from);
    const w = old && old.src === src ? old : new TableWidget(src, s, e);
    w.posFrom = from;
    w.posTo = to;
    w.s = s;
    w.e = e;
    decos.push(Decoration.replace({ widget: w, block: true, atomic: true }).range(from, to));
  }
  return Decoration.set(decos, true);
}

/* ---------------- 行内语法 ---------------- */

/**
 * 一条正则匹配所有行内语法，按分组判断命中哪一种。
 * 用单条而不是多条分别扫：多条会互相重叠（**a** 同时命中 *em*），
 * 而「替换型装饰重叠」会让 CodeMirror 直接报错。
 */
const INLINE_RE = new RegExp(
  [
    '!\\[\\[([^\\[\\]\\n]+)\\]\\]', // 1: ![[图片名]]
    '!\\[([^\\]\\n]*)\\]\\(((?:[^()\\n]|\\([^)\\n]*\\))*)\\)', // 2,3: ![alt](src) —— 目标放行一层成对括号（`截图 (1).png`）
    '==([^=\\n]+)==', // 4: ==高亮==
    '\\*\\*([^*\\n]+)\\*\\*', // 5: **加粗**
    '__([^_\\n]+)__', // 6: __加粗__
    '~~([^~\\n]+)~~', // 7: ~~删除线~~
    '\\*([^*\\n]+)\\*', // 8: *斜体*
    '(?<![\\w])_([^_\\n]+)_(?![\\w])', // 9: _斜体_（避开 snake_case）
    '\\[([^\\]\\n]*)\\]\\(([^)\\n]*)\\)', // 10,11: [文字](链接)
    '\\[\\^([^\\]\\n]+)\\]', // 12: [^脚注]
  ].join('|'),
  'g',
);

/**
 * 只匹配两种图片语法的正则（删除时用，见 eatImageAtCursor）。
 * 不复用 INLINE_RE：那里一个分组对应一种语法，拿它去删会把**加粗**之类的
 * 整段也吃掉。图片这两条的前两个分组与 INLINE_RE 保持一致，便于对照维护。
 */
const IMAGE_RE = new RegExp(
  [
    '!\\[\\[([^\\[\\]\\n]+)\\]\\]', // ![[图片名]]
    '!\\[([^\\]\\n]*)\\]\\(((?:[^()\\n]|\\([^)\\n]*\\))*)\\)', // ![alt](src)
  ].join('|'),
  'g',
);

/**
 * 原生图片目标 → 可显示地址。口径与 markdown.ts 的渲染规则一致：
 * 绝对地址（http/协议相对/data/blob）直接用，本地路径解码后按文件名（含去目录）查图片库。
 */
function resolveImageSrc(raw: string, images: Record<string, string>): string | null {
  if (/^(?:https?:)?\/\//i.test(raw) || /^(?:data|blob):/i.test(raw)) return raw;
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    // 编码不合法就用原值
  }
  for (const candidate of [decoded, raw]) {
    if (images[candidate]) return images[candidate];
    const base = candidate.split(/[\\/]/).pop() ?? candidate;
    if (images[base]) return images[base];
  }
  return null;
}

/* ---------------- 块级编辑辅助（标记看不见了，得补回来） ---------------- */

const LIST_RE = /^(\s*)([-*+]|\d+[.)])(\s+)(\[[ xX]\]\s+)?/;
const QUOTE_RE = /^(\s*)(>+\s?)/;
const FENCE_RE = /^\s*(```|~~~)/;
/**
 * 提示条续行：单个 `>` 后跟正文或为空。
 * 内容部分用 `[^>\s[]` 起头 —— 既排除 `>>`/`> >`（嵌套引用算新盒子），
 * 也排除 `[!tip]`（那是新盒子首行，本来也走不到这里）。
 */
const QUOTE_CONT_RE = /^\s*>\s*(?:[^>\s[].*)?$/;

/** 某一行是否在围栏代码块里（含围栏行本身）—— 代码里的内容不该被当成列表/引用 */
function isInFence(doc: Text, line: number): boolean {
  let open = false;
  for (let n = 1; n <= doc.lines; n++) {
    if (n === line) return open || FENCE_RE.test(doc.line(n).text);
    if (FENCE_RE.test(doc.line(n).text)) open = !open;
  }
  return open;
}

/** 回车：续列表 / 续引用；空列表项则退出列表（标记是被藏起来的，用户看不见，只能靠回车语义） */
function continueBlock(view: EditorView): boolean {
  const { state } = view;
  const range = state.selection.main;
  if (!range.empty) return false;
  const line = state.doc.lineAt(range.head);
  const text = line.text;
  if (isInFence(state.doc, line.number)) return false;
  const list = LIST_RE.exec(text);
  const rest = list ? text.slice(list[0].length) : '';

  if (list) {
    const [, indent, mark, space, task] = list;
    // 空列表项：把标记删掉，退出列表
    if (!rest.trim()) {
      const keep = indent;
      view.dispatch({
        changes: { from: line.from, to: line.to, insert: keep },
        selection: { anchor: line.from + keep.length },
        scrollIntoView: true,
      });
      return true;
    }
    const nextMark = /^\d+[.)]$/.test(mark)
      ? `${Number(mark.slice(0, -1)) + 1}${mark.slice(-1)}`
      : mark;
    const insert = `\n${indent}${nextMark}${space}${task ? '[ ] ' : ''}`;
    view.dispatch({
      changes: { from: range.head, insert },
      selection: { anchor: range.head + insert.length },
      scrollIntoView: true,
    });
    return true;
  }

  const quote = QUOTE_RE.exec(text);
  if (quote) {
    const [, indent, marks] = quote;
    if (!text.slice(quote[0].length).trim()) {
      view.dispatch({
        changes: { from: line.from, to: line.to, insert: indent },
        selection: { anchor: line.from + indent.length },
        scrollIntoView: true,
      });
      return true;
    }
    // 保留原有的 > 层数
    const level = (marks.match(/>/g) ?? []).length;
    const insert = `\n${indent}${'>'.repeat(level)} `;
    view.dispatch({
      changes: { from: range.head, insert },
      selection: { anchor: range.head + insert.length },
      scrollIntoView: true,
    });
    return true;
  }

  return false;
}

/** 行首退格：先吃掉看不见的块标记，避免留下一个「看起来是空行其实带着 # 」的行 */
function eatBlockMark(view: EditorView): boolean {
  const { state } = view;
  const range = state.selection.main;
  if (!range.empty) return false;
  const line = state.doc.lineAt(range.head);
  if (range.head !== line.from) return false;
  if (isInFence(state.doc, line.number)) return false;
  const text = line.text;
  const list = LIST_RE.exec(text);
  if (list && !text.slice(list[0].length).trim()) {
    view.dispatch({ changes: { from: line.from, to: line.to, insert: list[1] } });
    return true;
  }
  const heading = /^(#{1,6}\s+)/.exec(text);
  if (heading) {
    view.dispatch({ changes: { from: line.from, to: line.from + heading[0].length, insert: '' } });
    return true;
  }
  const quote = QUOTE_RE.exec(text);
  if (quote && !text.slice(quote[0].length).trim()) {
    view.dispatch({ changes: { from: line.from, to: line.from + quote[0].length, insert: '' } });
    return true;
  }
  return false;
}

/**
 * 找到紧邻光标的图片语法段（![[name]] 或 ![alt](src)）。
 *
 * 为什么需要这个：图片被 atomic 的 replace 装饰换成了 widget，光标永远停不进
 * `![[name]]` 内部，落在图片两侧。此时按退格，CodeMirror 会把整个 widget 当作
 * 一个原子跳过 —— 结果是图片渲染消失、但源码文本原样留下，用户看到的就是
 * 「图没了，残留一串 ![[xxx.gif]]」。这里显式把整段文本一起删掉。
 *
 * dir = -1：退格，光标紧贴图片**右**边（即 head 落在图片结束处）
 * dir = 1：Delete，光标紧贴图片**左**边（即 head 落在图片起始处）
 */
function eatImageAtCursor(view: EditorView, dir: -1 | 1): boolean {
  const { state } = view;
  const range = state.selection.main;
  if (!range.empty) return false;
  const head = range.head;
  const line = state.doc.lineAt(head);
  if (/^\s*$/.test(line.text)) return false;
  const images = state.field(imagesField, false) ?? {};

  for (const m of line.text.matchAll(IMAGE_RE)) {
    const s = line.from + (m.index ?? 0);
    const e = s + m[0].length;
    if (head !== (dir === -1 ? e : s)) continue;
    // 解析不到图的引用（坏名字、外链失效）在编辑器里显示为原文，
    // 那种情况该按字删，交给默认行为，别把用户正在编辑的一段一口气吃掉
    const src = m[1] !== undefined ? images[m[1]] : resolveImageSrc(m[3], images);
    if (!src) return false;
    view.dispatch({ changes: { from: s, to: e, insert: '' } });
    return true;
  }
  return false;
}

const liveKeymap = keymap.of([
  { key: 'Enter', run: continueBlock },
  { key: 'Backspace', run: (v) => eatImageAtCursor(v, -1) || eatBlockMark(v) },
  { key: 'Delete', run: (v) => eatImageAtCursor(v, 1) },
]);

/* ---------------- 装饰构建 ---------------- */

function build(view: EditorView): DecorationSet {
  const { state } = view;
  const doc = state.doc;
  const images = state.field(imagesField, false) ?? {};
  const decos: Range<Decoration>[] = [];

  /**
   * 围栏代码块：必须从文档开头扫一遍才知道某一行在不在代码里，
   * 只扫可见区会在滚到代码中间时被误判。
   * 取值：0 = 不在代码里，1 = 代码内容，2 = 围栏行本身。
   */
  const inCode = new Uint8Array(doc.lines + 1);
  /** 开围栏行 → 收围栏行与语言（渲染语言标签、做语法高亮要用块边界） */
  const fenceBlocks = new Map<number, { close: number; lang: string }>();
  const fenceClose = new Set<number>();
  let fence = false;
  let openLine = 0;
  let openLang = '';
  for (let n = 1; n <= doc.lines; n++) {
    const isFence = /^\s*(```|~~~)/.test(doc.line(n).text);
    inCode[n] = isFence ? 2 : fence ? 1 : 0;
    if (isFence) {
      if (!fence) {
        fence = true;
        openLine = n;
        openLang = /^\s*(?:```|~~~)\s*(\S*)/.exec(doc.line(n).text)?.[1] ?? '';
      } else {
        fence = false;
        fenceBlocks.set(openLine, { close: n, lang: openLang });
        fenceClose.add(n);
      }
    }
  }

  /**
   * 引用/提示条逐行角色：与 inCode 一样必须整篇扫。
   * 只扫可见区的话，滚到盒子中间时状态丢失，续行会被误判成普通引用，
   * 颜色跟着滚动位置漂移（同一个盒子滚出首行就变灰）。
   * 取值：0 = 普通行，1 = 普通引用行，2 = 提示条盒子行（含首行/续行/空尾巴）。
   */
  const quoteRole = new Uint8Array(doc.lines + 1);
  /** 盒子首行标记：1 = 带标题，2 = 无标题（无标题时标记位要放灯泡） */
  const boxFirst = new Uint8Array(doc.lines + 1);
  let inCallout = false;
  for (let n = 1; n <= doc.lines; n++) {
    if (inCode[n]) {
      inCallout = false;
      continue;
    }
    const quote = QUOTE_RE.exec(doc.line(n).text);
    if (!quote) {
      // 空行/普通行都结束盒子 —— 与 markdown 的块引用语义一致
      inCallout = false;
      continue;
    }
    const body = doc.line(n).text.slice(quote[0].length);
    if (/^\[![a-zA-Z]+\]/.test(body)) {
      quoteRole[n] = 2;
      // 标题有无要看标记之后是否还有内容 —— [!tip] 本身不是标题，
      // 判错会把无标题盒子的灯泡 widget 弄丢，标记藏掉后整行变空
      boxFirst[n] = body.replace(/^\[![a-zA-Z]+\]\s*/, '').trim() ? 1 : 2;
      inCallout = true;
    } else if (inCallout) {
      quoteRole[n] = 2;
      // 匹配不上续行的（如 `>>` 嵌套）当作盒子的空尾巴，到此收口
      if (!QUOTE_CONT_RE.test(doc.line(n).text)) inCallout = false;
    } else {
      quoteRole[n] = 1;
    }
  }

  for (let n = 1; n <= doc.lines; n++) {
    const line = doc.line(n);
    const text = line.text;

      if (inCode[n]) {
        const block = fenceBlocks.get(n);
        if (block) {
          // 开围栏行：整行换成语言标签 widget（atomic：光标进不了看不见的围栏行，
          // 改语言去「对照/源码」模式改）。未配对的开围栏不进这里，仍显示原文提示用户补收尾
          decos.push(Decoration.line({ class: 'cm-lp-codeblock cm-lp-fence-open' }).range(line.from));
          decos.push(
            Decoration.replace({ widget: new CodeLabelWidget(block.lang), atomic: true }).range(line.from, line.to),
          );
        } else if (fenceClose.has(n)) {
          // 收围栏行：整行藏掉、行高压成代码卡的圆角底边（留白走 padding，绝不加 margin）
          decos.push(Decoration.line({ class: 'cm-lp-codeblock cm-lp-fence-close' }).range(line.from));
          decos.push(Decoration.replace({ atomic: true }).range(line.from, line.to));
        } else {
          // 代码内容行：卡片底 + 圆角交给首行（顶边由标签行充当）
          const isFirst = inCode[n - 1] === 2;
          decos.push(
            Decoration.line({ class: `cm-lp-codeblock${isFirst ? ' cm-lp-code-first' : ''}` }).range(line.from),
          );
        }
        continue; // 代码块里不做行内替换，原样编辑
      }

      // 分割线：整行替换成一条线
      if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(text)) {
        decos.push(Decoration.line({ class: 'cm-lp-hr-line' }).range(line.from));
        decos.push(Decoration.replace({ widget: new HrWidget(), atomic: true }).range(line.from, line.to));
        continue;
      }

      const heading = /^(#{1,6})(\s+)/.exec(text);
      if (heading) {
        decos.push(Decoration.line({ class: `cm-lp-h${heading[1].length}` }).range(line.from));
        decos.push(HIDE.range(line.from, line.from + heading[0].length));
      }

      const quote = QUOTE_RE.exec(text);
      if (quote && quoteRole[n]) {
        const cls = ['cm-lp-quote'];
        if (quoteRole[n] === 2) {
          cls.push('cm-lp-callout');
          // 圆角只出现在整个盒子的上下两端，行与行之间保持方正
          if (boxFirst[n]) cls.push(boxFirst[n] === 2 ? 'cm-lp-callout-open' : 'cm-lp-callout-first');
          else cls.push('cm-lp-callout-cont');
          // 下一行不再属于同一个盒子（空行/普通行/新盒子/文档结尾）时收口 ——
          // 盒子以空行结尾时没有「`>` 空行」可打 -last，必须靠前瞻补上
          if (n === doc.lines || quoteRole[n + 1] !== 2 || boxFirst[n + 1]) {
            cls.push('cm-lp-callout-last');
          }
        } else {
          // 普通引用块同样标出首尾行：底色圆角只落在块的两端，中间行保持方正
          if (quoteRole[n - 1] !== 1) cls.push('cm-lp-quote-first');
          if (n === doc.lines || quoteRole[n + 1] !== 1) cls.push('cm-lp-quote-last');
        }
        decos.push(Decoration.line({ class: cls.join(' ') }).range(line.from));
        const s = line.from + quote[1].length;
        decos.push(HIDE.range(s, s + quote[2].length));

        // 提示条 > [!tip] xxx：连 [!tip] 一起藏掉，换成强调色边框（与预览里的盒子对应）
        if (boxFirst[n]) {
          const m = /^\[![a-zA-Z]+\]\s*/.exec(text.slice(quote[0].length));
          if (m) {
            const cs = line.from + quote[0].length;
            decos.push(HIDE.range(cs, cs + m[0].length));
            if (boxFirst[n] === 2) {
              // 无标题的盒子：标记位放一个灯泡，否则这行只剩空样式，看着像没渲染
              decos.push(Decoration.widget({ widget: new TipIconWidget(), side: 1 }).range(cs + m[0].length));
            }
          }
        }
      }

      const task = /^(\s*)([-*+])\s+\[([ xX])\](\s+)/.exec(text);
      const bullet = /^(\s*)([-*+]|\d+[.)])(\s+)/.exec(text);
      if (task) {
        decos.push(Decoration.line({ class: 'cm-lp-li cm-lp-task' }).range(line.from));
        const markStart = line.from + task[1].length;
        // 待办项不再画圆点：勾选框已经说明这是列表，两个符号并排只会更吵
        decos.push(
          Decoration.replace({ atomic: true }).range(markStart, markStart + 1),
        );
        const cbStart = line.from + text.indexOf('[', task[1].length);
        decos.push(
          Decoration.replace({
            widget: new CheckboxWidget(task[3] !== ' ', cbStart, cbStart + 3),
            atomic: true,
          }).range(cbStart, cbStart + 3),
        );
      } else if (bullet) {
        decos.push(Decoration.line({ class: 'cm-lp-li' }).range(line.from));
        const markStart = line.from + bullet[1].length;
        const glyph = /^[-*+]$/.test(bullet[2]) ? '•' : bullet[2];
        decos.push(
          Decoration.replace({ widget: new GlyphWidget(glyph), atomic: true }).range(
            markStart,
            markStart + bullet[2].length,
          ),
        );
      }

      // 行内代码：先圈出范围，后面的行内语法要避开它们（代码里的 * 不是斜体）
      const codeSpans: Array<[number, number]> = [];
      for (const m of text.matchAll(/`([^`\n]+)`/g)) {
        const s = line.from + (m.index ?? 0);
        const e = s + m[0].length;
        codeSpans.push([s, e]);
        decos.push(Decoration.mark({ class: 'cm-lp-code' }).range(s + 1, e - 1));
        decos.push(HIDE.range(s, s + 1));
        decos.push(HIDE.range(e - 1, e));
      }

      for (const m of text.matchAll(INLINE_RE)) {
        const s = line.from + (m.index ?? 0);
        const e = s + m[0].length;
        if (codeSpans.some(([cs, ce]) => s < ce && e > cs)) continue;

        if (m[1] !== undefined) {
          // ![[图片名]]：只在能取到图时替换，否则留原文（不然就是个破图占位）
          const src = images[m[1]];
          if (src) {
            decos.push(Decoration.replace({ widget: new ImageWidget(src, m[1]), atomic: true }).range(s, e));
          }
          continue;
        }
        if (m[2] !== undefined) {
          // ![alt](src)：原生图片语法，地址口径与预览渲染一致（绝对地址直用、本地查库）；
          // 解析不到就留原文 —— 与 ![[ ]] 的兜底行为一致
          const src = resolveImageSrc(m[3], images);
          if (src) {
            decos.push(Decoration.replace({ widget: new ImageWidget(src, m[2]), atomic: true }).range(s, e));
          }
          continue;
        }
        if (m[4] !== undefined) {
          decos.push(Decoration.mark({ class: 'cm-lp-mark' }).range(s + 2, e - 2));
          decos.push(HIDE.range(s, s + 2));
          decos.push(HIDE.range(e - 2, e));
          continue;
        }
        if (m[5] !== undefined || m[6] !== undefined) {
          decos.push(Decoration.mark({ class: 'cm-lp-strong' }).range(s + 2, e - 2));
          decos.push(HIDE.range(s, s + 2));
          decos.push(HIDE.range(e - 2, e));
          continue;
        }
        if (m[7] !== undefined) {
          decos.push(Decoration.mark({ class: 'cm-lp-del' }).range(s + 2, e - 2));
          decos.push(HIDE.range(s, s + 2));
          decos.push(HIDE.range(e - 2, e));
          continue;
        }
        if (m[8] !== undefined || m[9] !== undefined) {
          decos.push(Decoration.mark({ class: 'cm-lp-em' }).range(s + 1, e - 1));
          decos.push(HIDE.range(s, s + 1));
          decos.push(HIDE.range(e - 1, e));
          continue;
        }
        if (m[10] !== undefined) {
          // [文字](链接)：藏掉方括号和 (url)，只留文字
          const textEnd = s + 1 + m[10].length;
          decos.push(Decoration.mark({ class: 'cm-lp-link' }).range(s + 1, textEnd));
          decos.push(HIDE.range(s, s + 1));
          decos.push(HIDE.range(textEnd, e));
          continue;
        }
        if (m[12] !== undefined) {
          decos.push(Decoration.mark({ class: 'cm-lp-fnref' }).range(s, e));
        }
      }
  }

  /**
   * 代码块语法高亮：整块取文本 → hljs tokenize → 按偏移映射回文档位置。
   * mark 装饰只上色不替换文本，代码仍然可以直接编辑；
   * tokenize 结果走 markdown.ts 的 LRU 缓存，每次按键不会反复解析。
   */
  for (const [open, block] of fenceBlocks) {
    if (!isHighlighterReady() || !block.lang) continue;
    const blockFrom = doc.line(open).to;
    const blockTo = doc.line(block.close).from;
    if (blockTo <= blockFrom) continue;
    const spans = highlightSpans(doc.sliceString(blockFrom, blockTo), block.lang);
    if (!spans) continue;
    for (const sp of spans) {
      const s = blockFrom + sp.from;
      const e = Math.min(blockFrom + sp.to, blockTo);
      if (e > s) decos.push(Decoration.mark({ class: sp.cls }).range(s, e));
    }
  }

  // DecorationSet 是 RangeSet<Decoration> 的类型别名，构造走 Decoration.set
  return Decoration.set(decos, true);
}

const livePlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    /** hljs 就绪状态：懒加载完成的那一拍要整篇补一次高亮装饰 */
    private wasHlReady = isHighlighterReady();

    constructor(view: EditorView) {
      liveEditorView = view; // 表格 widget 的自持监听派发事务时要用
      this.decorations = build(view);
      if (!this.wasHlReady) {
        // 高亮器懒加载就绪后派发一次空事务触发重建，代码块高亮才能补上
        void ensureHighlighter().then(() => {
          try {
            view.dispatch({});
          } catch {
            // 编辑器已销毁（切模式/卸载竞态），忽略
          }
        });
      }
    }

    update(u: ViewUpdate) {
      const imagesChanged = u.transactions.some((t) =>
        t.effects.some((e) => e.is(setLiveImages)),
      );
      const hlReady = isHighlighterReady();
      const hlJustReady = hlReady && !this.wasHlReady;
      this.wasHlReady = hlReady;
      // selectionSet 也要重建：表格 widget 的显隐取决于光标在不在块内
      if (u.docChanged || u.viewportChanged || u.selectionSet || imagesChanged || hlJustReady) {
        this.decorations = build(u.view);
      }
    }
  },
  { decorations: (v) => v.decorations },
);

/** 点勾选框直接改文档：装饰里的元素拿不到事件，统一在 view 层按 data-from/to 处理 */
const checkboxClick = EditorView.domEventHandlers({
  mousedown(event, view) {
    const target = event.target as HTMLElement | null;
    const el = target?.closest?.('.cm-lp-checkbox') as HTMLElement | null;
    if (!el) return false;
    const from = Number(el.dataset.from);
    const to = Number(el.dataset.to);
    if (!Number.isFinite(from) || !Number.isFinite(to) || to > view.state.doc.length) return false;
    const cur = view.state.sliceDoc(from, to);
    if (cur !== '[ ]' && cur !== '[x]' && cur !== '[X]') return false; // 位置已过期，交给默认行为
    event.preventDefault();
    view.dispatch({ changes: { from, to, insert: /^\[[xX]\]$/.test(cur) ? '[ ]' : '[x]' } });
    return true;
  },
});

/** 直接编辑模式的全部扩展；用 Compartment 装载，才能在不重建编辑器开关 */
export function livePreview(): Extension {
  return [imagesField, tableField, livePlugin, checkboxClick, liveKeymap];
}
