import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Broom,
  CaretDoubleLeft,
  CaretDown,
  CaretRight,
  FileMd,
  FilePlus,
  FolderOpen,
  Image,
  PencilSimple,
  SidebarSimple,
  Trash,
} from '@phosphor-icons/react';

export interface Draft {
  id: string;
  name: string;
  content: string;
  updatedAt: number;
}

interface Props {
  drafts: Draft[];
  activeId: string;
  onSelect: (id: string) => void;
  onNew: () => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  /** 本地图片库：文件名 → data URI */
  images: Record<string, string>;
  /** 被任意草稿以 ![[name]] 引用到的图片名 */
  usedImageNames: Set<string>;
  onDeleteImage: (name: string) => void;
  onCleanupImages: () => void;
  /** 点击图片：定位到正文里引用它的位置 */
  onLocateImage: (name: string) => void;
  /** 面板是否收起（收起后缩成一条窄栏，只留展开按钮） */
  collapsed: boolean;
  onToggleCollapsed: () => void;
}

/** 相对时间：列表里比绝对时间戳更好读 */
function relativeTime(ts: number, now: number): string {
  const diff = Math.max(0, now - ts);
  const min = Math.floor(diff / 60000);
  if (min < 1) return '刚刚';
  if (min < 60) return `${min} 分钟前`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour} 小时前`;
  const day = Math.floor(hour / 24);
  if (day < 30) return `${day} 天前`;
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

/** data URI 的实际字节数（base64 每 4 字符表示 3 字节） */
function dataUrlBytes(dataUrl: string): number {
  const i = dataUrl.indexOf(',');
  const b64 = i >= 0 ? dataUrl.slice(i + 1) : dataUrl;
  const padding = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((b64.length * 3) / 4) - padding);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * 文件树面板：常驻管理草稿与本地图片库。
 * 图片存在 IndexedDB 里，不清理会一直堆积，所以这里要能看见占用并删除。
 */
export default function FileTree({
  drafts,
  activeId,
  onSelect,
  onNew,
  onRename,
  onDelete,
  images,
  usedImageNames,
  onDeleteImage,
  onCleanupImages,
  onLocateImage,
  collapsed,
  onToggleCollapsed,
}: Props) {
  const [draftsOpen, setDraftsOpen] = useState(true);
  const [imagesOpen, setImagesOpen] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);
  /** 时间戳只在挂载时取一次，避免每次渲染都读时钟 */
  const [now] = useState(() => Date.now());

  useEffect(() => {
    if (renamingId) renameInputRef.current?.select();
  }, [renamingId]);

  const imageList = useMemo(
    () =>
      Object.entries(images)
        .map(([name, dataUrl]) => ({ name, bytes: dataUrlBytes(dataUrl), used: usedImageNames.has(name) }))
        .sort((a, b) => b.bytes - a.bytes),
    [images, usedImageNames],
  );
  const totalBytes = imageList.reduce((sum, i) => sum + i.bytes, 0);
  const unusedCount = imageList.filter((i) => !i.used).length;

  const submitRename = () => {
    if (renamingId && renameValue.trim()) onRename(renamingId, renameValue);
    setRenamingId(null);
    setRenameValue('');
  };

  return (
    <nav className={`file-tree ${collapsed ? 'collapsed' : ''}`} aria-label="文件">
      <div className="tree-head">
        {!collapsed && <span className="tree-head-label">文件</span>}
        {!collapsed && (
          <button className="tree-new" title="新建草稿" aria-label="新建草稿" onClick={onNew}>
            <FilePlus size={14} />
          </button>
        )}
        <button
          className="tree-collapse"
          title={collapsed ? '展开文件面板' : '收起文件面板'}
          aria-label={collapsed ? '展开文件面板' : '收起文件面板'}
          aria-expanded={!collapsed}
          onClick={onToggleCollapsed}
        >
          {collapsed ? <SidebarSimple size={15} /> : <CaretDoubleLeft size={15} />}
        </button>
      </div>

      {!collapsed && (
      <div className="tree-body" role="tree" aria-label="文件">
        {/* ---- 草稿 ---- */}
        <div className="tree-group" role="treeitem" aria-expanded={draftsOpen}>
          <button className="tree-folder" onClick={() => setDraftsOpen((v) => !v)}>
            {draftsOpen ? <CaretDown size={11} weight="bold" /> : <CaretRight size={11} weight="bold" />}
            <FolderOpen size={14} />
            <span className="tree-folder-name">草稿</span>
            <span className="tree-count">{drafts.length}</span>
          </button>

          {draftsOpen && (
            <div className="tree-children" role="group">
              {drafts.map((d) => {
                const active = d.id === activeId;
                if (renamingId === d.id) {
                  return (
                    <div key={d.id} className="tree-file renaming">
                      <FileMd size={14} />
                      <input
                        ref={renameInputRef}
                        className="tree-rename-input"
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') submitRename();
                          if (e.key === 'Escape') setRenamingId(null);
                        }}
                        onBlur={submitRename}
                      />
                    </div>
                  );
                }
                return (
                  <div
                    key={d.id}
                    className={`tree-file ${active ? 'active' : ''}`}
                    role="treeitem"
                    aria-selected={active}
                  >
                    <button className="tree-file-main" onClick={() => onSelect(d.id)} title={d.name}>
                      <FileMd size={14} />
                      <span className="tree-file-text">
                        <span className="tree-file-name">{d.name}</span>
                        <span className="tree-file-meta">
                          {d.content.replace(/\s/g, '').length} 字 · {relativeTime(d.updatedAt, now)}
                        </span>
                      </span>
                    </button>
                    <span className="tree-file-actions">
                      <button
                        title="重命名"
                        aria-label={`重命名 ${d.name}`}
                        onClick={() => {
                          setRenamingId(d.id);
                          setRenameValue(d.name);
                        }}
                      >
                        <PencilSimple size={12} />
                      </button>
                      <button title="删除" aria-label={`删除 ${d.name}`} onClick={() => onDelete(d.id)}>
                        <Trash size={12} />
                      </button>
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ---- 图片库 ---- */}
        <div className="tree-group" role="treeitem" aria-expanded={imagesOpen}>
          <button className="tree-folder" onClick={() => setImagesOpen((v) => !v)}>
            {imagesOpen ? <CaretDown size={11} weight="bold" /> : <CaretRight size={11} weight="bold" />}
            <Image size={14} />
            <span className="tree-folder-name">图片</span>
            {totalBytes > 0 && <span className="tree-size">{formatBytes(totalBytes)}</span>}
            <span className="tree-count">{imageList.length}</span>
          </button>

          {imagesOpen && (
            <div className="tree-children" role="group">
              {imageList.length === 0 ? (
                <p className="tree-empty">把图片拖进编辑器即可加入</p>
              ) : (
                <>
                  {imageList.map((img) => (
                    <div key={img.name} className={`tree-file ${img.used ? '' : 'unused'}`} role="treeitem">
                      <button
                        className="tree-file-main"
                        title={img.used ? `${img.name} — 点击定位到正文` : `${img.name} — 未被任何草稿引用`}
                        onClick={() => onLocateImage(img.name)}
                      >
                        <Image size={14} />
                        <span className="tree-file-text">
                          <span className="tree-file-name">{img.name}</span>
                          <span className="tree-file-meta">
                            {formatBytes(img.bytes)}
                            {img.used ? '' : ' · 未引用'}
                          </span>
                        </span>
                      </button>
                      <span className="tree-file-actions">
                        <button
                          title="删除图片"
                          aria-label={`删除图片 ${img.name}`}
                          onClick={() => onDeleteImage(img.name)}
                        >
                          <Trash size={12} />
                        </button>
                      </span>
                    </div>
                  ))}
                  {unusedCount > 0 && (
                    <button className="tree-cleanup" onClick={onCleanupImages}>
                      <Broom size={13} />
                      清理 {unusedCount} 张未引用
                    </button>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>
      )}
    </nav>
  );
}
