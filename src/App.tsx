import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import EditorPane from './components/EditorPane';
import FileTree from './components/FileTree';
import PreviewPane from './components/PreviewPane';
import Toolbar from './components/Toolbar';
import WechatImportDialog from './components/WechatImportDialog';
import ReadView from './components/ReadView';
import ShareDialog from './components/ShareDialog';
import { importWechatArticle } from './wechatImport';
import { createShareLink } from './share';
import {
  collectImageRefs,
  ensureHighlighter,
  isHighlighterReady,
  lineReferencesImage,
  renderArticle,
} from './markdown';
import { copyRichText } from './clipboard';
import { downloadBlob, exportBackupZip, exportDraftMarkdown, importFiles, safeFileName } from './exchange';
import { renderLongImage } from './longimage';
import { SAMPLE_MARKDOWN } from './sample';
import { getDensity, getTheme } from './theme';
import { DEFAULT_ACCENT_ID, getAccent, MODE_DEFAULTS } from './accents';
import { deleteImage, getAllImages, putImage } from './imagedb';
import { createScrollSyncChannel } from './scrollSync';
import './styles.css';

const STORAGE_KEY = 'yimark:md';
const STORAGE_THEME = 'yimark:theme';
const STORAGE_DENSITY = 'yimark:density';
const STORAGE_DRAFTS = 'yimark:drafts';
const STORAGE_ACTIVE_DRAFT = 'yimark:active-draft';
/** 左侧文件面板是否收起 */
const STORAGE_TREE_COLLAPSED = 'yimark:tree-collapsed';
/** 界面配色（见 accents.ts） */
const STORAGE_ACCENT = 'yimark:accent';
/** 工作区模式（edit/split/preview），刷新后要停在用户上次用的那档 */
const STORAGE_VIEW_MODE = 'yimark:view-mode';
/** 分栏位置（编辑器侧宽度百分比），拖完刷新要保留 */
const STORAGE_SPLIT = 'yimark:split';
/** 旧版图片注册表存放位置（localStorage），仅用于一次性迁移 */
const STORAGE_IMAGES = 'yimark:imgs';
/** 改名前的 key 前缀（Mars Editor / wechat-mp-editor 时代），迁移完即弃 */
const LEGACY_PREFIX = 'wechat-mp-editor:';

/**
 * 一次性迁移：把改名前的 key 整体搬到新前缀下。
 * 只在目标 key 不存在时写入，老用户草稿/主题/排版密度不会因为改名消失。
 */
function migrateStorageKeys(): void {
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key == null || !key.startsWith(LEGACY_PREFIX)) continue;
    const next = `yimark:${key.slice(LEGACY_PREFIX.length)}`;
    const value = localStorage.getItem(key);
    if (value != null && localStorage.getItem(next) == null) localStorage.setItem(next, value);
    localStorage.removeItem(key);
    i--;
  }
}
try {
  migrateStorageKeys();
} catch {
  // 存储不可用（隐私模式等）时跳过，不影响当次使用
}
/** 编辑器侧最小宽度（拖拽时保留，预览因此可达 desktop 宽度） */
const MIN_EDITOR_PX = 180;
/** 预览最小宽度（容纳真实手机宽度） */
const MIN_PREVIEW_PX = 430;

interface Draft {
  id: string;
  name: string;
  content: string;
  updatedAt: number;
}

/** 读草稿列表（localStorage） */
function loadDrafts(): Draft[] {
  try {
    const raw = localStorage.getItem(STORAGE_DRAFTS);
    if (raw) {
      const parsed = JSON.parse(raw) as Draft[];
      if (Array.isArray(parsed) && parsed.length) return parsed;
    }
  } catch {
    // 损坏则重建
  }
  return [];
}

/** 迁移旧单草稿：首次使用多草稿时把旧内容变成第一篇草稿 */
function migrateLegacy(): Draft[] {
  const legacy = localStorage.getItem(STORAGE_KEY);
  const initial: Draft = {
    id: `draft-${Date.now()}`,
    name: '未命名草稿',
    content: legacy != null ? legacy : SAMPLE_MARKDOWN,
    updatedAt: Date.now(),
  };
  const drafts = [initial];
  try {
    localStorage.setItem(STORAGE_DRAFTS, JSON.stringify(drafts));
    localStorage.setItem(STORAGE_ACTIVE_DRAFT, initial.id);
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // 存储失败不影响内存使用
  }
  return drafts;
}

/** 找出正文里第一处引用该图片的行号（0-based），没有则返回 -1 */
function findEmbedLine(content: string, name: string): number {
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (lineReferencesImage(lines[i], name)) return i;
  }
  return -1;
}

/** 解析 hash 路由：#/read/<id> → 分享阅读页；其余返回 null 走编辑器 */
function parseReadHash(): string | null {
  const m = window.location.hash.match(/^#\/read\/([A-Za-z0-9]+)/);
  return m ? m[1] : null;
}

/** 启动初始化：草稿列表（必要时迁移旧数据）与选中项一次算完，localStorage 只解析一次 */
function initDraftState(): { drafts: Draft[]; activeId: string } {
  const existing = loadDrafts();
  const list = existing.length ? existing : migrateLegacy();
  const saved = localStorage.getItem(STORAGE_ACTIVE_DRAFT);
  const activeId = saved && list.some((d) => d.id === saved) ? saved : list[0]?.id ?? '';
  return { drafts: list, activeId };
}

export default function App() {
  const [initial] = useState(initDraftState);
  const [drafts, setDrafts] = useState<Draft[]>(initial.drafts);
  const [activeDraftId, setActiveDraftId] = useState<string>(initial.activeId);
  // 选中项兜底：id 万一失效就回落到第一篇，且后续写入都用这个真实存在的 id
  const activeDraft = drafts.find((d) => d.id === activeDraftId) ?? drafts[0];
  const activeId = activeDraft?.id ?? '';
  const markdown = activeDraft?.content ?? '';
  const setMarkdown = (v: string) => {
    setDrafts((prev) => {
      const now = Date.now();
      return prev.map((d) => (d.id === activeId ? { ...d, content: v, updatedAt: now } : d));
    });
  };
  const setActiveDraft = (id: string) => {
    setActiveDraftId(id);
    localStorage.setItem(STORAGE_ACTIVE_DRAFT, id);
  };
  // 图片注册表存 IndexedDB（容量大），挂载后异步加载到内存供同步渲染
  const [images, setImages] = useState<Record<string, string>>({});
  const [themeId, setThemeId] = useState<string>(() => localStorage.getItem(STORAGE_THEME) ?? 'classic');
  const [densityId, setDensityId] = useState<string>(() => localStorage.getItem(STORAGE_DENSITY) ?? 'standard');
  /** 文件面板整体收起/展开，窄屏下能明显腾出编辑区 */
  const [treeCollapsed, setTreeCollapsed] = useState<boolean>(
    () => localStorage.getItem(STORAGE_TREE_COLLAPSED) === '1',
  );
  /** 界面配色（外壳强调色），与文章主题是两套东西 */
  const [accentId, setAccentId] = useState<string>(
    () => localStorage.getItem(STORAGE_ACCENT) ?? DEFAULT_ACCENT_ID,
  );
  const [status, setStatus] = useState<string | null>(null);
  /** 导出进行中（长图 / 备份包都要跑一会儿） */
  const [exporting, setExporting] = useState(false);
  /** 从公众号文章导入弹窗 */
  const [wechatOpen, setWechatOpen] = useState(false);
  /** 分享弹窗（打开即上传当前草稿生成链接） */
  const [shareOpen, setShareOpen] = useState(false);
  /** 分享阅读路由：#/read/<id> 时全屏渲染 ReadView（编辑器不挂载） */
  const [readId, setReadId] = useState<string | null>(() => parseReadHash());
  useEffect(() => {
    const onHash = () => setReadId(parseReadHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  /** 对照 / 预览模式 */
  /** 编辑 = 渲染后直接改（Live Preview）；对照 = 源码 + 预览并排；预览 = 只看成品 */
  const [viewMode, setViewMode] = useState<'edit' | 'split' | 'preview'>(() => {
    const saved = localStorage.getItem(STORAGE_VIEW_MODE);
    return saved === 'edit' || saved === 'split' || saved === 'preview' ? saved : 'split';
  });
  /** 切档即落盘：localStorage 里存过坏值时读侧已经兜底，这里无需再校验 */
  const changeViewMode = (m: 'edit' | 'split' | 'preview') => {
    setViewMode(m);
    try {
      localStorage.setItem(STORAGE_VIEW_MODE, m);
    } catch {
      // 存不进去不影响本次会话使用
    }
  };
  /** 编辑器侧宽度（百分比，默认预览最小宽度）；上次拖的位置从 localStorage 恢复 */
  const [editorPct, setEditorPct] = useState<number>(() => {
    const saved = Number(localStorage.getItem(STORAGE_SPLIT));
    return Number.isFinite(saved) && saved > 0 && saved < 100 ? saved : (() => {
      const w = window.innerWidth;
      return Math.round(((w - MIN_PREVIEW_PX) / w) * 1000) / 10;
    })();
  });
  /** 写 state 的同时落盘 —— 拖拽结束 / 双击复位共用 */
  const applyEditorPct = (v: number) => {
    setEditorPct(v);
    try {
      localStorage.setItem(STORAGE_SPLIT, String(v));
    } catch {
      // 存不进去不影响本次会话使用
    }
  };
  /** 拖拽中禁用宽度过渡 */
  const draggingRef = useRef(false);
  const splitRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<HTMLElement>(null);

  const theme = useMemo(() => getTheme(themeId), [themeId]);
  const density = useMemo(() => getDensity(densityId), [densityId]);
  /** 高亮器就绪后翻转一次，触发补高亮的重渲染 */
  const [hlReady, setHlReady] = useState(isHighlighterReady);
  // 整篇重渲染让给输入：打字时先用上一版预览，空闲时再补算新版
  const deferredMarkdown = useDeferredValue(markdown);
  const result = useMemo(
    () => renderArticle(deferredMarkdown, theme, images, density),
    // hlReady 只作为「重算一次」的信号，不参与渲染入参
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [deferredMarkdown, theme, images, density, hlReady],
  );

  // highlight.js 懒加载（不阻塞首屏），就绪后补上代码高亮
  useEffect(() => {
    if (hlReady) return;
    let cancelled = false;
    void ensureHighlighter().then(() => {
      if (!cancelled) setHlReady(isHighlighterReady());
    });
    return () => {
      cancelled = true;
    };
  }, [hlReady]);

  const statusTimer = useRef<number | null>(null);
  const flash = (msg: string) => {
    setStatus(msg);
    if (statusTimer.current) window.clearTimeout(statusTimer.current);
    statusTimer.current = window.setTimeout(() => setStatus(null), 2200);
  };
  useEffect(
    () => () => {
      if (statusTimer.current) window.clearTimeout(statusTimer.current);
    },
    [],
  );

  // 挂载时：迁移旧 localStorage 图片 → IndexedDB，再加载全部图片
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const legacy = localStorage.getItem(STORAGE_IMAGES);
        if (legacy) {
          const legacyMap = JSON.parse(legacy) as Record<string, string>;
          for (const [name, dataUrl] of Object.entries(legacyMap)) {
            await putImage(name, dataUrl);
          }
          localStorage.removeItem(STORAGE_IMAGES);
        }
      } catch {
        // 迁移失败不影响后续加载
      }
      if (cancelled) return;
      try {
        const all = await getAllImages();
        if (!cancelled) setImages(all);
      } catch {
        if (!cancelled) flash('图片库加载失败');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // 防抖自动保存草稿（多草稿列表）
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const ok = saveDraftsSafe();
      if (!ok) flash('草稿过大，本地保存失败');
    }, 300);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drafts]);

  // 记住主题与密度
  useEffect(() => {
    localStorage.setItem(STORAGE_THEME, theme.id);
  }, [theme.id]);
  useEffect(() => {
    localStorage.setItem(STORAGE_DENSITY, densityId);
  }, [densityId]);
  // 记住文件面板的收起状态
  useEffect(() => {
    localStorage.setItem(STORAGE_TREE_COLLAPSED, treeCollapsed ? '1' : '0');
  }, [treeCollapsed]);

  /**
   * 应用界面配色：把强调色与纸面色写成 CSS 变量挂在 <html> 上。
   * 走变量而不是切 class，是为了让新配色即时生效、且不用在 CSS 里再抄一遍色值。
   * 顺手同步 theme-color（手机浏览器地址栏取色）。
   */
  useEffect(() => {
    const a = getAccent(accentId);
    const m = MODE_DEFAULTS[a.mode];
    const root = document.documentElement;
    const vars: Record<string, string> = {
      '--accent': a.accent,
      '--accent-strong': a.strong,
      '--accent-soft': a.soft,
      // 纸面三件套：画布底 + 两团氛围光，只换色相、明度保持一致
      '--bg': a.bg,
      '--bg-glow-1': a.glow1,
      '--bg-glow-2': a.glow2,
      '--panel': a.panel,
      '--panel-solid': a.panelSolid,
      // 墨色相：冷色系配冷墨，描边才不会在冷纸底上泛棕
      '--tint': a.tint,
      // 中性色与材质整套跟着亮度模式走（深色下墨色、阴影、噪点都要反过来）
      '--ink': m.ink,
      '--muted': m.muted,
      '--faint': m.faint,
      '--noise': m.noise,
      '--shadow-sm': m.shadowSm,
      '--shadow-lg': m.shadowLg,
      '--shadow-pop': m.shadowPop,
      '--btn-bg': m.btnBg,
      '--on-accent': m.onAccent,
      '--warn': m.warn,
      '--danger': m.danger,
    };
    for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
    // 亮暗模式标记：CSS 选不中内联变量，靠这个属性切代码高亮等深色分支
    root.dataset.accentMode = a.mode;
    // 让原生滚动条、表单控件也跟着深浅走
    root.style.colorScheme = a.mode;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', a.accent);
    localStorage.setItem(STORAGE_ACCENT, accentId);
  }, [accentId]);

  /** 安全保存草稿列表，返回是否成功 */
  const saveDraftsSafe = (): boolean => {
    try {
      localStorage.setItem(STORAGE_DRAFTS, JSON.stringify(drafts));
      return true;
    } catch {
      return false;
    }
  };

  /** 新建草稿 */
  const handleNewDraft = () => {
    const id = `draft-${Date.now()}`;
    const name = `草稿 ${drafts.length + 1}`;
    setDrafts((prev) => [...prev, { id, name, content: '', updatedAt: Date.now() }]);
    setActiveDraft(id); // 内部已写入 STORAGE_ACTIVE_DRAFT
    flash(`已新建「${name}」`);
  };

  /** 重命名草稿 */
  const handleRenameDraft = (id: string, name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setDrafts((prev) => prev.map((d) => (d.id === id ? { ...d, name: trimmed } : d)));
  };

  /** 删除草稿 */
  const handleDeleteDraft = (id: string) => {
    const target = drafts.find((d) => d.id === id);
    if (!target) return;
    if (!window.confirm(`删除草稿「${target.name}」？此操作不可恢复。`)) return;
    const remaining = drafts.filter((d) => d.id !== id);
    // 删光了就补一篇空草稿；选中项必须落在新列表里，否则后续编辑会写不进任何草稿
    const next = remaining.length
      ? remaining
      : [{ id: `draft-${Date.now()}`, name: '未命名草稿', content: '', updatedAt: Date.now() }];
    setDrafts(next);
    if (id === activeId) setActiveDraft(next[0].id);
    flash(`已删除「${target.name}」`);
  };

  /** 正文里被引用到的图片名（两种语法都算，跨全部草稿） */
  const usedImageNames = useMemo(() => {
    const used = new Set<string>();
    for (const d of drafts) {
      for (const name of collectImageRefs(d.content)) used.add(name);
    }
    return used;
  }, [drafts]);

  /** 编辑器跳转请求（文件树点击图片定位用） */
  const [jumpRequest, setJumpRequest] = useState<{ line: number; nonce: number } | null>(null);
  const jumpNonce = useRef(0);

  /** 点击图片：定位到引用它的那一行（必要时先切到对应草稿） */
  const handleLocateImage = (name: string) => {
    const inActive = activeDraft ? findEmbedLine(activeDraft.content, name) : -1;
    let line = inActive;
    let jumpedTo: Draft | null = null;
    if (line < 0) {
      // 当前草稿里没有，再找其它草稿
      for (const d of drafts) {
        if (d.id === activeId) continue;
        const l = findEmbedLine(d.content, name);
        if (l >= 0) {
          line = l;
          jumpedTo = d;
          break;
        }
      }
    }
    if (line < 0) {
      flash(`「${name}」还没有被任何草稿引用`);
      return;
    }
    if (jumpedTo) {
      setActiveDraft(jumpedTo.id);
      flash(`已跳到「${jumpedTo.name}」`);
    }
    jumpNonce.current += 1;
    setJumpRequest({ line, nonce: jumpNonce.current });
  };

  /** 删除单张图片；仍被引用时先确认（删掉后正文会退回占位提示） */
  const handleDeleteImage = (name: string) => {
    if (usedImageNames.has(name) && !window.confirm(`「${name}」还被正文引用，删除后那里会变成占位提示。仍要删除？`)) {
      return;
    }
    setImages((prev) => {
      const next = { ...prev };
      delete next[name];
      return next;
    });
    deleteImage(name).catch(() => flash('图片删除失败'));
    flash(`已删除「${name}」`);
  };

  /** 一键清理所有草稿都没引用的图片（长期使用后这些是占用大头） */
  const handleCleanupImages = () => {
    const unused = Object.keys(images).filter((n) => !usedImageNames.has(n));
    if (!unused.length) {
      flash('没有未引用的图片');
      return;
    }
    if (!window.confirm(`删除 ${unused.length} 张未被任何草稿引用的图片？`)) return;
    setImages((prev) => {
      const next = { ...prev };
      for (const n of unused) delete next[n];
      return next;
    });
    void Promise.all(unused.map((n) => deleteImage(n))).catch(() => flash('部分图片删除失败'));
    flash(`已清理 ${unused.length} 张未引用图片`);
  };

  /** 编辑器拖入/粘贴图片后注册到注册表（写 IndexedDB） */
  const handleAddImage = (name: string, dataUrl: string) => {
    setImages((prev) => (prev[name] === dataUrl ? prev : { ...prev, [name]: dataUrl }));
    putImage(name, dataUrl).catch(() => flash('图片保存失败，存储空间可能已满'));
  };

  const handleCopy = async () => {
    // 预览走的是延迟值、且高亮可能还没加载完，导出必须按当前正文重新渲染一次
    await ensureHighlighter();
    const { html } = renderArticle(markdown, theme, images, density);
    const ok = await copyRichText(html);
    flash(ok ? '已复制，去公众号 ⌘V 粘贴' : '复制失败，请用浏览器 Chrome/Edge');
  };

  /* ---------------- 导入 / 导出 ---------------- */

  /** 导入 .md / .zip：草稿追加到列表末尾并跳过去，图片并入图片库 */
  const handleImport = async (files: File[]) => {
    try {
      const { drafts: incoming, images: incomingImages, skipped } = await importFiles(files);
      const imageCount = Object.keys(incomingImages).length;
      if (!incoming.length && !imageCount) {
        flash(skipped.length ? '没有可导入的 Markdown 或备份文件' : '文件是空的');
        return;
      }
      if (incoming.length) {
        setDrafts((prev) => [...prev, ...incoming]);
        setActiveDraft(incoming[0].id);
      }
      if (imageCount) {
        setImages((prev) => ({ ...prev, ...incomingImages }));
        // 写盘失败不该拦住已经进内存的内容，只提示
        await Promise.all(Object.entries(incomingImages).map(([n, url]) => putImage(n, url))).catch(() =>
          flash('部分图片写入本地库失败'),
        );
      }
      const parts = [incoming.length ? `${incoming.length} 篇草稿` : '', imageCount ? `${imageCount} 张图片` : ''];
      flash(`已导入 ${parts.filter(Boolean).join(' · ')}${skipped.length ? `（跳过 ${skipped.length} 个文件）` : ''}`);
    } catch (err) {
      console.warn('导入失败', err);
      flash('导入失败，文件可能已损坏');
    }
  };

  /** 从公众号文章导入：抓取转 Markdown 后新建草稿并跳过去（错误抛给弹窗展示） */
  const handleWechatImport = async (url: string) => {
    const article = await importWechatArticle(url);
    const id = `draft-${Date.now()}`;
    const name = article.title.slice(0, 40);
    setDrafts((prev) => [...prev, { id, name, content: article.markdown, updatedAt: Date.now() }]);
    setActiveDraft(id);
    flash(`已导入「${name}」`);
  };

  /** 分享入口：空草稿不开弹窗；上传逻辑在弹窗挂载后执行 */
  const handleShareClick = () => {
    if (!markdown.trim()) {
      flash('当前草稿是空的，先写点内容');
      return;
    }
    setShareOpen(true);
  };

  /** 创建分享：附上正文引用到的本地图（公众号外链图不带），按当前排版主题渲染给读者 */
  const handleShare = async (): Promise<string> => {
    const used = collectImageRefs(markdown);
    const shareImages = Object.fromEntries(Object.entries(images).filter(([n]) => used.has(n)));
    const link = await createShareLink({
      title: activeDraft?.name ?? '未命名文章',
      markdown,
      themeId,
      densityId,
      images: shareImages,
    });
    flash('分享链接已生成');
    return link;
  };

  /** 导出当前草稿为 .md */
  const handleExportMarkdown = () => {
    if (!activeDraft) return;
    exportDraftMarkdown(activeDraft);
    flash(`已导出「${activeDraft.name}.md」`);
  };

  /** 导出全部草稿 + 图片为 zip 备份 */
  const handleExportBackup = async () => {
    setExporting(true);
    try {
      await exportBackupZip(drafts, images);
      flash(`已导出备份（${drafts.length} 篇草稿 · ${Object.keys(images).length} 张图片）`);
    } catch (err) {
      console.warn('备份失败', err);
      flash('备份导出失败');
    } finally {
      setExporting(false);
    }
  };

  /** 导出正文长图 PNG（按当前正文重新渲染，不用延迟预览值） */
  const handleExportImage = async () => {
    setExporting(true);
    try {
      await ensureHighlighter();
      const { body } = renderArticle(markdown, theme, images, density);
      const blob = await renderLongImage({ body, theme, author: '易码' });
      downloadBlob(`${safeFileName(activeDraft?.name ?? '长图')}.png`, blob);
      flash('长图已导出');
    } catch (err) {
      console.warn('长图导出失败', err);
      flash(err instanceof Error ? err.message : '长图导出失败');
    } finally {
      setExporting(false);
    }
  };

  /** 拖拽分割条：同步更新编辑器 DOM 宽度（跟手），mouseup 时落回 state */
  const handleDrag = (clientX: number) => {
    const split = splitRef.current;
    const editor = editorRef.current;
    if (!split || !editor) return;
    const rect = split.getBoundingClientRect();
    const pct = ((clientX - rect.left) / rect.width) * 100;
    // 编辑器宽度范围：[MIN_EDITOR_PX, W - MIN_PREVIEW_PX]（预览最小保留真实手机宽度）
    const minPct = (MIN_EDITOR_PX / rect.width) * 100;
    const maxPct = ((rect.width - MIN_PREVIEW_PX) / rect.width) * 100;
    const clamped = Math.max(minPct, Math.min(maxPct, pct));
    editor.style.width = `${clamped}%`; // 直接改 DOM，跳过 React 渲染延迟
    void editor.offsetHeight; // 强制 reflow，跳过宽度过渡
  };

  /** 拖拽开始/结束：直接控制 DOM 类（ref 不触发渲染，类必须手动切换） */
  const setDraggingUi = (on: boolean) => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.classList.toggle('no-transition', on);
  };

  const endDrag = () => {
    draggingRef.current = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    document.documentElement.classList.remove('split-dragging');
    setDraggingUi(false);
    const editor = editorRef.current;
    const split = splitRef.current;
    if (editor && split) {
      const rect = split.getBoundingClientRect();
      // 把最终宽度写回 state 并落盘（供预览模式切换 / 复位引用）
      applyEditorPct(Math.max(0, Math.min(100, (editor.getBoundingClientRect().width / rect.width) * 100)));
    }
  };

  // 全局拖拽监听（常驻挂载，回调内检查拖拽标志）
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (draggingRef.current) handleDrag(e.clientX);
    };
    const onUp = () => {
      if (draggingRef.current) endDrag();
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, []);

  /** 双击分割条复位（预览最小宽度） */
  const resetSplit = () => {
    const editor = editorRef.current;
    const split = splitRef.current;
    if (!editor || !split) return;
    setDraggingUi(true);
    const rect = split.getBoundingClientRect();
    const pct = Math.round(((rect.width - MIN_PREVIEW_PX) / rect.width) * 1000) / 10;
    editor.style.width = `${pct}%`;
    void editor.offsetHeight;
    setDraggingUi(false);
    applyEditorPct(pct);
  };

  /**
   * 滚动同步通道：编辑器发布位置、预览订阅。
   * 走可变对象而非 state —— 滚动不该让整棵树重渲染一次。
   */
  const scrollSync = useRef(createScrollSyncChannel()).current;

  // 编辑与对照都保留右侧预览（区别只在左侧是渲染态还是源码），只有「预览」模式收起源码
  const isPreviewOnly = viewMode === 'preview';
  const isLive = viewMode === 'edit';

  // 分享阅读页：全屏替换编辑器（所有 hook 已在上方执行，这里才能安全提前返回）
  if (readId) return <ReadView id={readId} />;

  return (
    <div className="app">
      <Toolbar
        viewMode={viewMode}
        onViewMode={changeViewMode}
        status={status}
        onCopy={handleCopy}
        accentId={accentId}
        onAccentChange={setAccentId}
        themeId={themeId}
        onThemeChange={setThemeId}
        densityId={densityId}
        onDensityChange={setDensityId}
        onImport={(files) => void handleImport(files)}
        onWechatImport={() => setWechatOpen(true)}
        onShare={handleShareClick}
        onExportMarkdown={handleExportMarkdown}
        onExportBackup={() => void handleExportBackup()}
        onExportImage={() => void handleExportImage()}
        exporting={exporting}
      />
      <main className={`workspace ${isPreviewOnly ? 'mode-preview' : ''}`}>
        <FileTree
          drafts={drafts}
          activeId={activeId}
          onSelect={setActiveDraft}
          onNew={handleNewDraft}
          onRename={handleRenameDraft}
          onDelete={handleDeleteDraft}
          images={images}
          usedImageNames={usedImageNames}
          onDeleteImage={handleDeleteImage}
          onCleanupImages={handleCleanupImages}
          onLocateImage={handleLocateImage}
          collapsed={treeCollapsed}
          onToggleCollapsed={() => setTreeCollapsed((v) => !v)}
        />
        <div className="split" ref={splitRef}>
          <EditorPane
            ref={editorRef}
            value={markdown}
            onChange={setMarkdown}
            onAddImage={handleAddImage}
            imageNames={Object.keys(images)}
            draftId={activeId}
            sync={scrollSync}
            jumpRequest={jumpRequest}
            collapsed={isPreviewOnly}
            live={isLive}
            images={images}
            widthPct={editorPct}
            mode={viewMode}
          />
          <div
            className="split-bar"
            title="拖动调整 · 双击复位"
            onMouseDown={(e) => {
              draggingRef.current = true;
              document.body.style.cursor = 'col-resize';
              document.body.style.userSelect = 'none';
              document.documentElement.classList.add('split-dragging');
              setDraggingUi(true);
              handleDrag(e.clientX);
            }}
            onDoubleClick={resetSplit}
          />
          <PreviewPane
            body={result.body}
            theme={theme}
            hasImage={result.hasImage}
            resizeKey={`${viewMode}:${editorPct}`}
            sync={scrollSync}
          />
        </div>
      </main>
      <WechatImportDialog open={wechatOpen} onClose={() => setWechatOpen(false)} onImport={handleWechatImport} />
      <ShareDialog open={shareOpen} onClose={() => setShareOpen(false)} onShare={handleShare} />
    </div>
  );
}
