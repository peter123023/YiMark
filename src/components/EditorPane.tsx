import { forwardRef, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowCounterClockwise, Code, CodeBlock, Link, ListBullets, ListChecks, ListDashes, LockSimple, LockSimpleOpen, Minus, Quotes, Table, TextB, TextH, TextHFour, TextHOne, TextHThree, TextHTwo, TextItalic } from '@phosphor-icons/react';
import { EditorView, keymap, lineNumbers } from '@codemirror/view';
import { Compartment, EditorState } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap, indentWithTab, undo } from '@codemirror/commands';
import { searchKeymap } from '@codemirror/search';
import { autocompletion } from '@codemirror/autocomplete';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { registerImageFiles } from '../images';
import { livePreview, setLiveImages } from '../livePreview';
import type { ScrollSyncChannel } from '../scrollSync';

/* Phosphor 图标统一尺寸；H1–H4 菜单项各用对应字号图标 */
const ICON = 16;
const HEADING_ICON = { 1: TextHOne, 2: TextHTwo, 3: TextHThree, 4: TextHFour } as const;

interface Props {
  value: string;
  onChange: (v: string) => void;
  /** 注册本地图片：文件名 → data URI（供 ![[name]] 渲染） */
  onAddImage: (name: string, dataUrl: string) => void;
  /** 已导入图片名列表（![[ 自动补全用） */
  imageNames: string[];
  /** 当前草稿 id：切换草稿时强制同步 doc */
  draftId: string;
  /** 滚动同步通道：把编辑器顶部对应的源码位置发布给预览 */
  sync: ScrollSyncChannel;
  /** 预览模式：面板收起 */
  collapsed: boolean;
  /**
   * 直接编辑模式：把 Markdown 标记渲染掉但保留可编辑（见 livePreview.ts）。
   * 关掉就是纯源码模式。
   */
  live: boolean;
  /** 本地图片 data URI（直接编辑模式下把 ![[name]] 画成真图） */
  images: Record<string, string>;
  /** 编辑器侧宽度（百分比） */
  widthPct: number;
  /**
   * 外部跳转请求（文件树点击图片时定位到引用处）。
   * nonce 用来区分「同一行被再次请求」，否则重复点同一张图不会触发 effect。
   */
  jumpRequest: { line: number; nonce: number } | null;
}

const EditorPane = forwardRef<HTMLElement, Props>(function EditorPane(
  { value, onChange, onAddImage, imageNames, draftId, sync, collapsed, live, images, widthPct, jumpRequest },
  ref,
) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  /** 直接编辑模式是热开关：装在 Compartment 里，不用重建编辑器 */
  const liveComp = useRef(new Compartment()).current;
  /** 锁定编辑也是热开关（readOnly + editable 双保险，挡键盘输入也挡拖选改写） */
  const readonlyComp = useRef(new Compartment()).current;
  /** 锁定状态：默认开锁；ref 供 keymap 等挂载期闭包读取，避免拿到过期值 */
  const [locked, setLocked] = useState(false);
  const lockedRef = useRef(false);
  lockedRef.current = locked;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const syncRef = useRef(sync);
  syncRef.current = sync;
  // 补全候选走 ref：CodeMirror 扩展只在挂载时建一次，直接闭包会永远停在挂载时的空列表
  const imageNamesRef = useRef(imageNames);
  imageNamesRef.current = imageNames;
  /** 编辑器最近一次上报给父组件的文本（用来区分「自己改的」和「外部改的」） */
  const lastEmittedRef = useRef(value);
  const [saved, setSaved] = useState(true);

  // 防抖展示「已自动保存」（与 App 的 300ms 防抖保存联动）
  useEffect(() => {
    setSaved(false);
    const timer = window.setTimeout(() => setSaved(true), 700);
    return () => window.clearTimeout(timer);
  }, [value]);

  /** 注册图片，并在当前光标处插入 Obsidian 嵌入 ![[name]] */
  const insertImages = async (files: File[]) => {
    const view = viewRef.current;
    if (!view || lockedRef.current) return;
    const { names } = await registerImageFiles(files, onAddImage);
    if (!names.length || !view) return;
    const block = names.map((n) => `![[${n}]]\n`).join('');
    view.dispatch({
      changes: { from: view.state.selection.main.head, insert: block },
      selection: { anchor: view.state.selection.main.head + block.length },
    });
  };

  // 初始化 CodeMirror 编辑器
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(),
          history(),
          keymap.of([
            ...defaultKeymap,
            ...historyKeymap,
            ...searchKeymap,
            indentWithTab,
            // ⌘B 加粗 / ⌘I 斜体：选中包裹，未选中插入成对标记光标居中
            {
              key: 'Mod-b',
              run: () => {
                toggleWrap('**', '**');
                return true;
              },
            },
            {
              key: 'Mod-i',
              run: () => {
                toggleWrap('*', '*');
                return true;
              },
            },
          ]),
          EditorView.lineWrapping,
          markdown({
            base: markdownLanguage,
            codeLanguages: languages,
          }),
          liveComp.of(live ? livePreview() : []),
          readonlyComp.of([]),
          // ![[ 图片名自动补全
          autocompletion({
            override: [
              (ctx) => {
                const before = ctx.matchBefore(/!\[\[[\w一-龥.-]*$/);
                if (!before) return null;
                return {
                  from: before.from + 3,
                  options: imageNamesRef.current.map((name) => ({
                    label: name,
                    type: 'image',
                    apply: `${name}]]`,
                  })),
                };
              },
            ],
          }),
          EditorView.theme({
            '&': { height: '100%', fontSize: '13.5px' },
            '.cm-scroller': {
              fontFamily: "ui-monospace, 'SF Mono', Menlo, Consolas, monospace",
              lineHeight: '1.75',
              overflow: 'auto',
            },
            /* 走 CSS 变量而不是写死色值：切界面配色（含深色模式）时编辑器要跟着变，
               而 CodeMirror 的 theme 只在挂载时生成一次 */
            '.cm-content': {
              padding: '20px 22px 20px 24px',
              color: 'var(--ink)',
              caretColor: 'var(--accent)',
            },
            '.cm-line': { padding: '0' },
            '.cm-gutters': {
              background: 'transparent',
              color: 'var(--faint)',
              fontSize: '13.5px',
              paddingLeft: '12px',
              paddingRight: '14px',
              borderRight: 'none',
            },
            '.cm-activeLineGutter': { background: 'transparent' },
            '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
              background: 'rgba(var(--tint), 0.18)',
            },
            '&.cm-focused': { outline: 'none' },
            '.cm-activeLine': { background: 'transparent' },
          }),
          EditorView.updateListener.of((update) => {
            if (!update.docChanged) return;
            const next = update.state.doc.toString();
            lastEmittedRef.current = next;
            onChangeRef.current(next);
          }),
        ],
      }),
    });
    viewRef.current = view;

    // 编辑滚动 → 预览同步：上报「行号 + 行内比例」这样一个连续量。
    // 只报整数行号会让预览等一整行翻过去才跳一次，观感就是一顿一顿的。
    const scroller = view.scrollDOM;
    /** 某个 scrollTop 对应的源码位置（行号 + 行内比例） */
    const positionAt = (scrollTop: number) => {
      // lineBlockAtHeight 用的是「文档高度」坐标系，需先扣掉内容区上边距
      const docTop = Math.max(0, scrollTop - view.documentPadding.top);
      const block = view.lineBlockAtHeight(docTop);
      const line = view.state.doc.lineAt(block.from).number - 1;
      const frac = block.height > 0 ? Math.min(1, Math.max(0, (docTop - block.top) / block.height)) : 0;
      return line + frac;
    };
    const onScroll = () => {
      const max = scroller.scrollHeight - scroller.clientHeight;
      const atBottom = max > 0 && scroller.scrollTop >= max - 2;
      const atTop = scroller.scrollTop <= 2;
      const position = positionAt(scroller.scrollTop);
      // 顺带上报「滚到底时的位置」，预览用它把文末当虚拟锚点
      syncRef.current.publish({
        position,
        endPosition: max > 0 ? positionAt(max) : position,
        atTop,
        atBottom,
      });
    };
    scroller.addEventListener('scroll', onScroll, { passive: true });
    onScroll();

    return () => {
      scroller.removeEventListener('scroll', onScroll);
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 直接编辑模式热开关：只换这个 Compartment 的内容，编辑器实例与光标都不动
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({ effects: liveComp.reconfigure(live ? livePreview() : []) });
  }, [live, liveComp]);

  // 锁定热开关：readOnly 挡输入类事务，editable=false 连光标都不给
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: readonlyComp.reconfigure(
        locked ? [EditorState.readOnly.of(true), EditorView.editable.of(false)] : [],
      ),
    });
  }, [locked, readonlyComp]);

  // 图片表变了要重画 ![[name]]：装饰缓存在插件里，靠 effect 触发重算
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({ effects: setLiveImages.of(images) });
  }, [images]);

  // 内容同步：草稿切换（draftId 变化）或外部 value 变化（导入/清理）时，
  // 若 doc 与 value 不同则全量替换并尽量保持光标。
  // 编辑/撤销产生的变化经 updateListener 已即时写回 value（cur === value），
  // 不会触发这里的同步，因此不影响输入与撤销。
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    // 自己敲出来的改动已经在 updateListener 里上报过，直接跳过 —— 
    // 否则每次按键都要把整篇文档 toString 出来比一遍
    if (lastEmittedRef.current === value) return;
    const cur = view.state.doc.toString();
    if (cur === value) {
      lastEmittedRef.current = value;
      return;
    }
    const { anchor, head } = view.state.selection.main;
    lastEmittedRef.current = value;
    view.dispatch({
      changes: { from: 0, to: cur.length, insert: value },
      selection: { anchor: Math.min(anchor, value.length), head: Math.min(head, value.length) },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftId, value]);

  // 外部跳转：定位到指定行并居中。
  // 声明顺序在内容同步之后 —— 跨草稿跳转时新文档已经就位，行号才对得上。
  useEffect(() => {
    if (!jumpRequest) return;
    const view = viewRef.current;
    if (!view) return;
    const lineNo = Math.min(Math.max(1, jumpRequest.line + 1), view.state.doc.lines);
    const pos = view.state.doc.line(lineNo).from;
    view.dispatch({
      selection: { anchor: pos },
      effects: EditorView.scrollIntoView(pos, { y: 'center' }),
    });
    view.focus();
  }, [jumpRequest]);

  // 粘贴图片（截图后直接 ⌘V）
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const dom = view.dom;
    const onPaste = (e: ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.items ?? [])
        .filter((it) => it.type.startsWith('image/'))
        .map((it) => it.getAsFile())
        .filter((f): f is File => !!f);
      if (!files.length) return;
      e.preventDefault();
      void insertImages(files);
    };
    const onDrop = (e: DragEvent) => {
      const files = Array.from(e.dataTransfer?.files ?? []).filter((f) => f.type.startsWith('image/'));
      if (!files.length) return;
      e.preventDefault();
      void insertImages(files);
    };
    const onDragover = (e: DragEvent) => e.preventDefault();
    dom.addEventListener('paste', onPaste);
    dom.addEventListener('drop', onDrop);
    dom.addEventListener('dragover', onDragover);
    return () => {
      dom.removeEventListener('paste', onPaste);
      dom.removeEventListener('drop', onDrop);
      dom.removeEventListener('dragover', onDragover);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const charCount = useMemo(() => value.replace(/\s/g, '').length, [value]);
  /** 微信正文上限 2 万字：18000 预警、20000 红线 */
  const WARN_LIMIT = 18000;
  const HARD_LIMIT = 20000;
  const countLevel: 'normal' | 'warn' | 'over' =
    charCount >= HARD_LIMIT ? 'over' : charCount >= WARN_LIMIT ? 'warn' : 'normal';
  const countClass = `pane-stat count ${countLevel === 'warn' ? 'count-warn' : countLevel === 'over' ? 'count-over' : ''}`;

  /* ---------------- Markdown 格式工具栏 ---------------- */

  /** 取编辑器 view，未挂载或锁定时返回 null（全部格式按钮的统一守卫） */
  const withView = <T,>(fn: (view: EditorView) => T): T | null => {
    if (lockedRef.current) return null;
    const view = viewRef.current;
    return view ? fn(view) : null;
  };

  /** 包裹选区（加粗/斜体/行内码）；无选区时插入成对标记并置光标于中间 */
  /** 正则元字符转义（标记里有 * 和 ` 这类） */
  const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  /**
   * 加 / 去标记。
   *
   * 所见即所得下用户看不到 `**`，所以「再点一次 B 取消加粗」有三种可能：
   * 选区连标记一起选中了、标记在选区外侧（渲染后最常见）、光标就落在加粗词中间。
   * 三种都要能去掉，否则格式一旦加上就只能在源码模式里删。
   */
  const toggleWrap = (before: string, after: string) =>
    withView((view) => {
      const { from, to } = view.state.selection.main;
      const doc = view.state.doc;

      // ① 选区自身带着标记
      if (to > from) {
        const text = doc.sliceString(from, to);
        if (
          text.length >= before.length + after.length &&
          text.startsWith(before) &&
          text.endsWith(after)
        ) {
          const inner = text.slice(before.length, text.length - after.length);
          view.dispatch({
            changes: { from, to, insert: inner },
            selection: { anchor: from, head: from + inner.length },
          });
          view.focus();
          return;
        }
      }

      // ② 标记在选区外侧
      const outFrom = from - before.length;
      const outTo = to + after.length;
      if (
        outFrom >= 0 &&
        outTo <= doc.length &&
        doc.sliceString(outFrom, from) === before &&
        doc.sliceString(to, outTo) === after
      ) {
        view.dispatch({
          changes: [
            { from: outFrom, to: from, insert: '' },
            { from: to, to: outTo, insert: '' },
          ],
          selection: { anchor: outFrom, head: to - before.length },
        });
        view.focus();
        return;
      }

      // ③ 光标在某个带标记的词内部
      if (from === to) {
        const line = doc.lineAt(from);
        const re = new RegExp(`${escapeRe(before)}([^\\n]+?)${escapeRe(after)}`, 'g');
        for (const m of line.text.matchAll(re)) {
          const s = line.from + (m.index ?? 0);
          const e = s + m[0].length;
          if (from > s && from < e) {
            view.dispatch({
              changes: [
                { from: s, to: s + before.length, insert: '' },
                { from: e - after.length, to: e, insert: '' },
              ],
              selection: { anchor: from - before.length, head: to - before.length },
            });
            view.focus();
            return;
          }
        }
      }

      // 都没有 → 正常包裹
      const text = from === to ? '' : doc.sliceString(from, to);
      const anchor = from + before.length;
      view.dispatch({
        changes: { from, to, insert: before + text + after },
        selection: text ? { anchor, head: to + before.length } : { anchor },
      });
      view.focus();
    });

  /** 行首加前缀（标题/引用/列表/待办）；光标所在行整行加 */
  const prefixLine = (prefix: string) =>
    withView((view) => {
      const line = view.state.doc.lineAt(view.state.selection.main.head);
      view.dispatch({ changes: { from: line.from, insert: prefix }, selection: { anchor: line.from + prefix.length } });
      view.focus();
    });

  /** 光标处插入块（代码围栏/分割线/表格） */
  const insertBlock = (text: string) =>
    withView((view) => {
      const head = view.state.selection.main.head;
      view.dispatch({ changes: { from: head, insert: text }, selection: { anchor: head + text.length } });
      view.focus();
    });

  /** 撤销（CodeMirror 历史栈） */
  const undoEdit = () => withView((view) => { undo(view); view.focus(); });

  /** 插入 3×3 表格模板（光标置于表体首格） */
  const insertTable = () =>
    withView((view) => {
      const head = view.state.selection.main.head;
      const table = '\n| 列 1 | 列 2 | 列 3 |\n| --- | --- | --- |\n|  |  |  |\n';
      const bodyStart = head + table.indexOf('|  |');
      view.dispatch({ changes: { from: head, insert: table }, selection: { anchor: bodyStart + 2 } });
      view.focus();
    });

  /** 标题层级菜单开关 */
  const [headingOpen, setHeadingOpen] = useState(false);
  /** 大纲抽屉开关 */
  const [outlineOpen, setOutlineOpen] = useState(false);
  const headingWrapRef = useRef<HTMLDivElement>(null);
  // 点击菜单外关闭
  useEffect(() => {
    if (!headingOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (!headingWrapRef.current?.contains(e.target as Node)) setHeadingOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setHeadingOpen(false);
    };
    document.addEventListener('click', onDocClick);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('click', onDocClick);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [headingOpen]);

  /** 从 markdown 提取标题大纲（行号 → 标题）；抽屉关闭时不扫描全文 */
  const outline = useMemo(() => {
    if (!outlineOpen) return [];
    const items: { level: number; text: string; line: number }[] = [];
    value.split('\n').forEach((line, i) => {
      const m = line.match(/^(#{1,4})\s+(.+)$/);
      if (m) items.push({ level: m[1].length, text: m[2].trim(), line: i });
    });
    return items;
  }, [value, outlineOpen]);

  /** 点击大纲项：跳转编辑器对应行 */
  const jumpToLine = (line: number) =>
    withView((view) => {
      view.dispatch({
        selection: { anchor: view.state.doc.line(line + 1).from },
        scrollIntoView: true,
        effects: EditorView.scrollIntoView(view.state.doc.line(line + 1).from, { y: 'center' }),
      });
      view.focus();
    });

  const headingLevels = [
    { level: 1, label: 'H1 · 一级标题', prefix: '# ' },
    { level: 2, label: 'H2 · 二级标题', prefix: '## ' },
    { level: 3, label: 'H3 · 三级标题', prefix: '### ' },
    { level: 4, label: 'H4 · 四级标题', prefix: '#### ' },
  ];

  const toolbarBtns: { key: string; title: string; icon: React.ReactNode; onClick: () => void }[] = [
    { key: 'bold', title: '加粗', icon: <TextB size={ICON} />, onClick: () => toggleWrap('**', '**') },
    { key: 'italic', title: '斜体', icon: <TextItalic size={ICON} />, onClick: () => toggleWrap('*', '*') },
    { key: 'code', title: '行内代码', icon: <Code size={ICON} />, onClick: () => toggleWrap('`', '`') },
    { key: 'quote', title: '引用', icon: <Quotes size={ICON} />, onClick: () => prefixLine('> ') },
    { key: 'list', title: '无序列表', icon: <ListBullets size={ICON} />, onClick: () => prefixLine('- ') },
    { key: 'task', title: '待办事项', icon: <ListChecks size={ICON} />, onClick: () => prefixLine('- [ ] ') },
    { key: 'fence', title: '代码块', icon: <CodeBlock size={ICON} />, onClick: () => insertBlock('\n```ts\n\n```\n') },
    { key: 'table', title: '表格', icon: <Table size={ICON} />, onClick: insertTable },
    { key: 'link', title: '链接', icon: <Link size={ICON} />, onClick: () => toggleWrap('[', '](https://)') },
    { key: 'hr', title: '分割线', icon: <Minus size={ICON} />, onClick: () => insertBlock('\n---\n') },
    { key: 'undo', title: '撤销', icon: <ArrowCounterClockwise size={ICON} />, onClick: undoEdit },
  ];

  return (
    <section
      ref={ref}
      className={`split-pane editor-side ${collapsed ? 'collapsed' : ''} ${live ? 'live' : ''}`}
      style={{ width: `${widthPct}%` }}
    >
      <div className="pane-head">
        <span className="pane-title">
          {live ? '编辑' : '源码'}
        </span>
        <div className="pane-head-right">
          <button
            className={`outline-toggle ${outlineOpen ? 'active' : ''}`}
            title="大纲"
            aria-label="大纲"
            aria-expanded={outlineOpen}
            onClick={() => setOutlineOpen((v) => !v)}
          >
            <ListDashes size={15} />
          </button>
          <span className="pane-stat">{saved ? '已保存' : '保存中'}</span>
          <span
            className={countClass}
            title={countLevel === 'over' ? '已超过微信 2 万字上限' : countLevel === 'warn' ? '接近微信 2 万字上限' : undefined}
          >
            {charCount} 字
          </span>
        </div>
      </div>
      {outlineOpen && (
        <div className="outline-drawer">
          {outline.length === 0 ? (
            <p className="outline-empty">暂无标题，用 `# ` 开始编写大纲</p>
          ) : (
            outline.map((item, idx) => (
              <button
                key={idx}
                className={`outline-item lv${item.level}`}
                style={{ paddingLeft: `${8 + (item.level - 1) * 14}px` }}
                onClick={() => jumpToLine(item.line)}
              >
                {item.text}
              </button>
            ))
          )}
        </div>
      )}
      {/* Markdown 格式工具栏 */}
      <div className="md-toolbar" role="toolbar" aria-label="Markdown 格式">
        {/* 编辑锁：锁住后编辑器 readOnly、格式按钮全部失效 */}
        <button
          className={`md-toolbar-btn lock-btn ${locked ? 'locked' : ''}`}
          title={locked ? '已锁定 · 点击解锁编辑' : '锁定编辑，防止误改'}
          aria-label={locked ? '解锁编辑器' : '锁定编辑器'}
          aria-pressed={locked}
          onClick={() => setLocked((v) => !v)}
        >
          {locked ? <LockSimple size={ICON} weight="bold" /> : <LockSimpleOpen size={ICON} weight="bold" />}
        </button>
        <span className="md-toolbar-divider" />
        {/* 标题层级下拉 */}
        <div className="md-toolbar-dropdown" ref={headingWrapRef}>
          <button
            className="md-toolbar-btn"
            title="标题（H1–H4）"
            aria-label="标题"
            aria-expanded={headingOpen}
            aria-haspopup="menu"
            disabled={locked}
            onClick={(e) => {
              e.stopPropagation();
              setHeadingOpen((v) => !v);
            }}
          >
            <TextH size={ICON} />
          </button>
          {headingOpen && (
            <div className="md-toolbar-menu" role="menu">
              {headingLevels.map((h) => {
                const HeadingIcon = HEADING_ICON[h.level as keyof typeof HEADING_ICON];
                return (
                  <button
                    key={h.level}
                    role="menuitem"
                    onClick={() => {
                      setHeadingOpen(false);
                      prefixLine(h.prefix);
                    }}
                  >
                    <HeadingIcon size={17} className="menu-heading" />
                    {h.label.split('·')[1]?.trim()}
                  </button>
                );
              })}
            </div>
          )}
        </div>
        {toolbarBtns.map((b) => (
          <button key={b.key} className="md-toolbar-btn" title={b.title} aria-label={b.title} disabled={locked} onClick={b.onClick}>
            {b.icon}
          </button>
        )).reduce<React.ReactNode[]>((acc, btn, i) => {
          // 逻辑分组：加粗|斜体|行内码 ｜ 引用|列表|待办 ｜ 代码块|表格|链接|分割线 | 撤销
          const groupEnd = [2, 5, 9];
          acc.push(btn);
          if (groupEnd.includes(i)) acc.push(<span key={`d${i}`} className="md-toolbar-divider"></span>);
          return acc;
        }, [])}
      </div>
      <div className="code-edit" ref={hostRef}></div>
    </section>
  );
});

export default EditorPane;
