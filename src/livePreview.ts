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

import { EditorState, Range, StateEffect, StateField, type Extension, type Text } from '@codemirror/state';
import {
  Decoration,
  type DecorationSet,
  EditorView,
  keymap,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from '@codemirror/view';

/** 图片表（文件名 → data URI）；草稿切换、增删图片时派发这个 effect 刷新 */
export const setLiveImages = StateEffect.define<Record<string, string>>();

const imagesField = StateField.define<Record<string, string>>({
  create: () => ({}),
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setLiveImages)) return e.value;
    return value;
  },
});

/** 藏起一段标记（复用同一实例：Decoration 是不可变值，可以多处引用） */
const HIDE = Decoration.replace({});
/** 藏 + atomic：光标不允许落在被藏字符的外侧（表格首尾竖线用，防 End 键把内容写到表格语法外） */
const HIDE_ATOMIC = Decoration.replace({ atomic: true });

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

/** GFM 表格：光标不在块内时整块渲染成真表格；点一下光标进块，切回源码行编辑 */
class TableWidget extends WidgetType {
  constructor(
    private readonly src: string,
    private readonly s: number,
    private readonly e: number,
  ) {
    super();
  }

  eq(other: TableWidget): boolean {
    // s/e 也要比：文档其他位置变了会让块平移，只比 src 会拿到过期的点击坐标
    return other.src === this.src && other.s === this.s && other.e === this.e;
  }

  toDOM(): HTMLElement {
    const el = document.createElement('div');
    el.className = 'cm-lp-table';
    el.dataset.blkS = String(this.s);
    el.dataset.blkE = String(this.e);
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
        th.textContent = c;
        tr.appendChild(th);
      }
    }
    const tbody = table.createTBody();
    for (const r of body) {
      const tr = tbody.insertRow();
      for (const c of r) {
        const td = tr.insertCell();
        td.textContent = c;
      }
    }
    el.appendChild(table);
    return el;
  }

  // 必须 false：true 会让 CM 跳过整条事件处理链（含 tableClick 的 mousedown），
  // 编辑器未聚焦时点表格就毫无反应
  ignoreEvent(): boolean {
    return false;
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
 * 光标在块内时不产 widget，显示源码行编辑；selection 变化即重算以切换显隐。
 */
const tableField = StateField.define<DecorationSet>({
  create: (state) => buildTableDecos(state),
  update(value, tr) {
    return !tr.docChanged && !tr.selection ? value : buildTableDecos(tr.state);
  },
  provide: (f) => EditorView.decorations.compute([f], (state) => state.field(f)),
});

function buildTableDecos(state: EditorState): DecorationSet {
  const doc = state.doc;
  const inCode = new Uint8Array(doc.lines + 1);
  let fence = false;
  for (let n = 1; n <= doc.lines; n++) {
    const isFence = /^\s*(```|~~~)/.test(doc.line(n).text);
    inCode[n] = isFence ? 2 : fence ? 1 : 0;
    if (isFence) fence = !fence;
  }
  const head = state.selection.main.head;
  const decos: Range<Decoration>[] = [];
  for (const { s, e } of scanTables(doc, inCode)) {
    const from = doc.line(s).from;
    const to = doc.line(e).to;
    if (head >= from && head <= to) continue; // 光标在块内：显示源码行
    decos.push(
      Decoration.replace({ widget: new TableWidget(doc.sliceString(from, to), s, e), block: true, atomic: true }).range(
        from,
        to,
      ),
    );
  }
  return Decoration.set(decos, true);
}

/** 点击表格 widget → 光标进块（落到第一行数据行），widget 消失、源码行出现供编辑 */
const tableClick = EditorView.domEventHandlers({
  mousedown(event, view) {
    const el = (event.target as HTMLElement).closest('.cm-lp-table') as HTMLElement | null;
    if (!el) return false;
    const s = Number(el.dataset.blkS);
    const e = Number(el.dataset.blkE);
    if (!Number.isFinite(s) || !Number.isFinite(e)) return false;
    event.preventDefault();
    const line = view.state.doc.line(Math.min(s + 2, e));
    view.dispatch({ selection: { anchor: line.from } });
    view.focus();
    return true;
  },
});

/* ---------------- 行内语法 ---------------- */

/**
 * 一条正则匹配所有行内语法，按分组判断命中哪一种。
 * 用单条而不是多条分别扫：多条会互相重叠（**a** 同时命中 *em*），
 * 而「替换型装饰重叠」会让 CodeMirror 直接报错。
 */
const INLINE_RE = new RegExp(
  [
    '!\\[\\[([^\\[\\]\\n]+)\\]\\]', // 1: ![[图片名]]
    '==([^=\\n]+)==', // 2: ==高亮==
    '\\*\\*([^*\\n]+)\\*\\*', // 3: **加粗**
    '__([^_\\n]+)__', // 4: __加粗__
    '~~([^~\\n]+)~~', // 5: ~~删除线~~
    '\\*([^*\\n]+)\\*', // 6: *斜体*
    '(?<![\\w])_([^_\\n]+)_(?![\\w])', // 7: _斜体_（避开 snake_case）
    '\\[([^\\]\\n]*)\\]\\(([^)\\n]*)\\)', // 8,9: [文字](链接)
    '\\[\\^([^\\]\\n]+)\\]', // 10: [^脚注]
  ].join('|'),
  'g',
);

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

const liveKeymap = keymap.of([
  { key: 'Enter', run: continueBlock },
  { key: 'Backspace', run: eatBlockMark },
]);

/**
 * 表格行守卫：表格的首尾竖线是隐藏的语法字符，光标落在行尾（末尾竖线之后）
 * 打字会把内容写到表格语法外，整行当场掉出表格。
 * 这里把这种「纯插入」改写到末尾竖线之前；分隔行是结构行，直接禁止改动。
 */
const tableGuard = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged) return tr;
  const start = tr.startState;
  const doc = start.doc;
  const sel = start.selection.main;
  if (!sel.empty) return tr;
  const line = doc.lineAt(sel.head);
  const inCode = new Uint8Array(doc.lines + 1);
  let fence = false;
  for (let n = 1; n <= doc.lines; n++) {
    const isF = /^\s*(```|~~~)/.test(doc.line(n).text);
    inCode[n] = isF ? 2 : fence ? 1 : 0;
    if (isF) fence = !fence;
  }
  const blk = scanTables(doc, inCode).find((b) => line.number >= b.s && line.number <= b.e);
  if (!blk) return tr;
  if (line.number === blk.s + 1) return []; // 分隔行：只许看不许改
  const pipePos = line.from + line.text.lastIndexOf('|');
  if (sel.head <= pipePos) return tr;
  // 只改写「单一纯插入」；替换/删除/多光标放行（后者由用户自己承担）
  let ok = true;
  let text = '';
  let count = 0;
  tr.changes.iterChanges((fromA, toA, _fb, _tb, inserted) => {
    count++;
    if (count === 1 && fromA === toA) text = inserted.toString();
    else ok = false;
  });
  if (!ok || count !== 1) return tr;
  return { changes: { from: pipePos, insert: text }, selection: { anchor: pipePos + text.length } };
});

/* ---------------- 装饰构建 ---------------- */

function build(view: EditorView): DecorationSet {
  const { state } = view;
  const doc = state.doc;
  const images = state.field(imagesField, false) ?? {};
  const decos: Range<Decoration>[] = [];

  /**
   * 围栏代码块：必须从文档开头扫一遍才知道某一行在不在代码里，
   * 只扫可见区会在滚到代码中间时被误判。
   * 取值：0 = 不在代码里，1 = 代码内容，2 = 围栏行本身（渲染时弱化）。
   */
  const inCode = new Uint8Array(doc.lines + 1);
  let fence = false;
  for (let n = 1; n <= doc.lines; n++) {
    const isFence = /^\s*(```|~~~)/.test(doc.line(n).text);
    inCode[n] = isFence ? 2 : fence ? 1 : 0;
    if (isFence) fence = !fence;
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

  /** 表格块：光标在块内时按「表格样子的可编辑行」装饰（widget 态由 tableField 负责） */
  const tblByLine = new Map<number, { s: number; e: number }>();
  for (const b of scanTables(doc, inCode)) {
    for (let k = b.s; k <= b.e; k++) tblByLine.set(k, b);
  }
  const head = state.selection.main.head;

  for (let n = 1; n <= doc.lines; n++) {
    const line = doc.line(n);
    const text = line.text;

      if (inCode[n]) {
        const cls = inCode[n] === 2 ? 'cm-lp-codeblock cm-lp-fence' : 'cm-lp-codeblock';
        decos.push(Decoration.line({ class: cls }).range(line.from));
        continue; // 代码块里不做任何替换，原样编辑
      }

      // 表格块：widget 态（光标在外）不加行内装饰，整块留给 tableField 的块替换；
      // 源码态（光标进块编辑）把管道行整理成「表格样子的可编辑行」——
      // 藏首尾竖线、内竖线变淡分隔、单元格加内边距、--- 分隔行整行隐藏
      const tbl = tblByLine.get(n);
      if (tbl) {
        const bFrom = doc.line(tbl.s).from;
        const bTo = doc.line(tbl.e).to;
        if (head < bFrom || head > bTo) continue; // widget 态
        if (n === tbl.s + 1) {
          decos.push(HIDE_ATOMIC.range(line.from, line.to)); // 分隔行：整行隐掉，留一个空行当行距
          continue;
        }
        const rowCls = ['cm-lp-trow'];
        if (n === tbl.s) rowCls.push('cm-lp-trow-first');
        if (n === tbl.e) rowCls.push('cm-lp-trow-last');
        decos.push(Decoration.line({ class: rowCls.join(' ') }).range(line.from));
        const text = line.text;
        const pipeIdx: number[] = [];
        for (let i = 0; i < text.length; i++) if (text[i] === '|') pipeIdx.push(i);
        if (pipeIdx.length >= 2) {
          const first = pipeIdx[0];
          const last = pipeIdx[pipeIdx.length - 1];
          for (const idx of pipeIdx) {
            const at = line.from + idx;
            if (idx === first || idx === last) {
              decos.push(HIDE_ATOMIC.range(at, at + 1)); // 首尾竖线：藏，且光标进不来（End/Home 不会落到表格语法外）
            } else {
              decos.push(Decoration.mark({ class: 'cm-lp-pipe' }).range(at, at + 1)); // 内竖线：淡分隔
            }
          }
          for (let i = 0; i < pipeIdx.length - 1; i++) {
            const cs = line.from + pipeIdx[i] + 1;
            const ce = line.from + (i + 1 < pipeIdx.length - 1 ? pipeIdx[i + 1] : last);
            if (ce > cs) decos.push(Decoration.mark({ class: 'cm-lp-cell' }).range(cs, ce));
          }
        }
        continue;
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
          decos.push(Decoration.mark({ class: 'cm-lp-mark' }).range(s + 2, e - 2));
          decos.push(HIDE.range(s, s + 2));
          decos.push(HIDE.range(e - 2, e));
          continue;
        }
        if (m[3] !== undefined || m[4] !== undefined) {
          decos.push(Decoration.mark({ class: 'cm-lp-strong' }).range(s + 2, e - 2));
          decos.push(HIDE.range(s, s + 2));
          decos.push(HIDE.range(e - 2, e));
          continue;
        }
        if (m[5] !== undefined) {
          decos.push(Decoration.mark({ class: 'cm-lp-del' }).range(s + 2, e - 2));
          decos.push(HIDE.range(s, s + 2));
          decos.push(HIDE.range(e - 2, e));
          continue;
        }
        if (m[6] !== undefined || m[7] !== undefined) {
          decos.push(Decoration.mark({ class: 'cm-lp-em' }).range(s + 1, e - 1));
          decos.push(HIDE.range(s, s + 1));
          decos.push(HIDE.range(e - 1, e));
          continue;
        }
        if (m[8] !== undefined) {
          // [文字](链接)：藏掉方括号和 (url)，只留文字
          const textEnd = s + 1 + m[8].length;
          decos.push(Decoration.mark({ class: 'cm-lp-link' }).range(s + 1, textEnd));
          decos.push(HIDE.range(s, s + 1));
          decos.push(HIDE.range(textEnd, e));
          continue;
        }
        if (m[10] !== undefined) {
          decos.push(Decoration.mark({ class: 'cm-lp-fnref' }).range(s, e));
        }
      }
  }

  // DecorationSet 是 RangeSet<Decoration> 的类型别名，构造走 Decoration.set
  return Decoration.set(decos, true);
}

const livePlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = build(view);
    }

    update(u: ViewUpdate) {
      const imagesChanged = u.transactions.some((t) =>
        t.effects.some((e) => e.is(setLiveImages)),
      );
      // selectionSet 也要重建：表格 widget 的显隐取决于光标在不在块内
      if (u.docChanged || u.viewportChanged || u.selectionSet || imagesChanged) {
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
  return [imagesField, tableField, tableClick, tableGuard, livePlugin, checkboxClick, liveKeymap];
}
