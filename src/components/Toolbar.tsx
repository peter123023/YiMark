import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  Archive,
  CaretDown,
  ClipboardText,
  DownloadSimple,
  FileMd,
  ImageSquare,
  LinkSimple,
  Palette,
  UploadSimple,
} from '@phosphor-icons/react';
import AccentMenu from './AccentMenu';
import ThemeMenu from './ThemeMenu';
import { accentSwatch, getAccent } from '../accents';

interface Props {
  viewMode: 'edit' | 'split' | 'preview';
  onViewMode: (m: 'edit' | 'split' | 'preview') => void;
  status: string | null;
  onCopy: () => void;
  /** 当前界面配色 id（见 accents.ts，与文章主题无关） */
  accentId: string;
  onAccentChange: (id: string) => void;
  /** 当前文章主题 id */
  themeId: string;
  onThemeChange: (id: string) => void;
  /** 排版密度档位 id（见 theme.ts 的 DENSITIES） */
  densityId: string;
  onDensityChange: (id: string) => void;
  /** 导入 .md / .zip 备份 */
  onImport: (files: File[]) => void;
  /** 打开"从公众号文章导入"弹窗 */
  onWechatImport: () => void;
  /** 导出当前草稿为 .md */
  onExportMarkdown: () => void;
  /** 导出全部草稿 + 图片为 zip 备份 */
  onExportBackup: () => void;
  /** 导出正文长图 PNG */
  onExportImage: () => void;
  /** 导出进行中：禁用菜单，避免重复触发 */
  exporting: boolean;
}

/** 点击菜单外 / Esc 关闭下拉：主题与导出两个菜单共用 */
function useDismiss(open: boolean, ref: React.RefObject<HTMLElement | null>, close: () => void) {
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) close();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('click', onDocClick);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('click', onDocClick);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, ref, close]);
}

export default function Toolbar({
  viewMode,
  onViewMode,
  status,
  onCopy,
  accentId,
  onAccentChange,
  themeId,
  onThemeChange,
  densityId,
  onDensityChange,
  onImport,
  onWechatImport,
  onExportMarkdown,
  onExportBackup,
  onExportImage,
  exporting,
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [themeOpen, setThemeOpen] = useState(false);
  const [accentOpen, setAccentOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const themeRef = useRef<HTMLDivElement>(null);
  const accentRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const closeMenu = useCallback(() => setMenuOpen(false), []);
  const closeTheme = useCallback(() => setThemeOpen(false), []);
  const closeAccent = useCallback(() => setAccentOpen(false), []);
  useDismiss(menuOpen, menuRef, closeMenu);
  useDismiss(themeOpen, themeRef, closeTheme);
  useDismiss(accentOpen, accentRef, closeAccent);

  /**
   * 主题下拉默认向下弹出，但下拉又高又宽，会盖住下方的预览窗口。
   * 打开后先量一次：与预览内容（手机框 / 文章区）相交，就把下拉的右边缘
   * 平移到预览内容左缘的左侧 8px —— 「贴着预览边缘往左弹」。
   * 用 layout effect 在绘制前定位，避免先向下闪一帧再跳。
   */
  useLayoutEffect(() => {
    if (!themeOpen) return;
    const wrap = themeRef.current;
    const dd = wrap?.querySelector<HTMLElement>('.theme-dropdown');
    if (!wrap || !dd) return;
    const target =
      document.querySelector('.phone-frame') ??
      document.querySelector('.article-scroll') ??
      document.querySelector('.preview-side');
    if (!target) return;
    const r = dd.getBoundingClientRect();
    const p = target.getBoundingClientRect();
    const hits = r.left < p.right && r.right > p.left && r.top < p.bottom && r.bottom > p.top;
    if (!hits) return;
    const w = wrap.getBoundingClientRect();
    // 下拉右边缘 = 预览内容左缘 - 8；左移过头（出屏）则钳在屏幕内
    const right = Math.min(w.right - (p.left - 8), w.right - r.width - 12);
    dd.style.right = `${right}px`;
  }, [themeOpen, viewMode]);

  const runExport = (fn: () => void) => {
    setMenuOpen(false);
    fn();
  };

  return (
    <header className="toolbar">
      <div className="brand">
        {/* 印章式字标：平涂描边，不用发光徽标 */}
        <span className="brand-mark" aria-hidden="true">易</span>
        <span className="title">易码</span>
      </div>

      {/* 界面配色：只换外壳强调色，与右侧「主题」下拉的文章排版样式无关 */}
      <div className="menu-wrap" ref={accentRef}>
        <button
          className="btn"
          aria-haspopup="menu"
          aria-expanded={accentOpen}
          aria-label="界面配色"
          title="界面配色（不影响文章排版）"
          onClick={() => setAccentOpen((v) => !v)}
        >
          <span className="accent-dot" style={{ background: accentSwatch(getAccent(accentId)) }} />
          <CaretDown size={11} weight="bold" />
        </button>
        {accentOpen && (
          <div className="dropdown-menu accent-dropdown" role="menu">
            <AccentMenu
              accentId={accentId}
              onAccentChange={(id) => {
                onAccentChange(id);
                setAccentOpen(false);
              }}
            />
          </div>
        )}
      </div>

      {/* 编辑 / 对照 / 预览 */}
      <div className="segmented" role="tablist" aria-label="工作区模式">
        {(['edit', 'split', 'preview'] as const).map((m) => (
          <button
            key={m}
            role="tab"
            aria-selected={viewMode === m}
            className={`seg-btn ${viewMode === m ? 'active' : ''}`}
            onClick={() => onViewMode(m)}
          >
            {m === 'edit' ? '编辑' : m === 'split' ? '对照' : '预览'}
          </button>
        ))}
      </div>

      <div className="toolbar-right">
        {/* 主题：原左侧竖栏，收进顶栏下拉，腾出横向空间给正文 */}
        <div className="menu-wrap" ref={themeRef}>
          <button
            className="btn"
            aria-haspopup="menu"
            aria-expanded={themeOpen}
            onClick={() => setThemeOpen((v) => !v)}
          >
            <Palette size={15} weight="bold" />
            主题
            <CaretDown size={11} weight="bold" />
          </button>
          {themeOpen && (
            <div className="theme-dropdown" role="group" aria-label="排版主题">
              <ThemeMenu
                themeId={themeId}
                onThemeChange={onThemeChange}
                densityId={densityId}
                onDensityChange={onDensityChange}
              />
            </div>
          )}
        </div>

        {/* 导入：.md 各建一篇草稿，.zip 按备份包整体还原 */}
        <input
          ref={fileRef}
          type="file"
          multiple
          accept=".md,.markdown,.txt,.zip"
          hidden
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            if (files.length) onImport(files);
            e.target.value = ''; // 同一文件连选两次也要触发
          }}
        />
        <button className="btn" onClick={() => fileRef.current?.click()} title="导入 Markdown 文件或备份包">
          <UploadSimple size={15} weight="bold" />
          导入
        </button>
        <button className="btn" onClick={onWechatImport} title="从公众号文章导入：粘贴 mp.weixin.qq.com 链接">
          <LinkSimple size={15} weight="bold" />
          公众号
        </button>

        <div className="menu-wrap" ref={menuRef}>
          <button
            className="btn"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            disabled={exporting}
            onClick={() => setMenuOpen((v) => !v)}
          >
            <DownloadSimple size={15} weight="bold" />
            {exporting ? '导出中…' : '导出'}
            <CaretDown size={11} weight="bold" />
          </button>
          {menuOpen && (
            <div className="dropdown-menu" role="menu">
              <button role="menuitem" onClick={() => runExport(onExportMarkdown)}>
                <FileMd size={16} className="menu-icon" />
                当前草稿 .md
              </button>
              <button role="menuitem" onClick={() => runExport(onExportImage)}>
                <ImageSquare size={16} className="menu-icon" />
                正文长图 .png
              </button>
              <div className="dropdown-divider" />
              <button role="menuitem" onClick={() => runExport(onExportBackup)}>
                <Archive size={16} className="menu-icon" />
                全部备份 .zip
                <span className="menu-hint">草稿 + 图片</span>
              </button>
            </div>
          )}
        </div>

        <button className="btn primary" onClick={onCopy}>
          <ClipboardText size={15} weight="bold" />
          复制到公众号
        </button>

        {status && <span className="status show">{status}</span>}
      </div>
    </header>
  );
}
