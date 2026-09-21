import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Broom,
  CaretDoubleLeft,
  CaretDown,
  CaretRight,
  FileMd,
  FilePlus,
  FolderOpen,
  FolderPlus,
  FolderSimple,
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
  /** 所属文件夹 id；未归属（在根层）时不带该字段 */
  folderId?: string;
}

export interface Folder {
  id: string;
  name: string;
}

/** 根层分组的虚拟 id：既用于折叠状态，也用于拖拽落点 */
export const ROOT_FOLDER_ID = '__root__';

interface Props {
  drafts: Draft[];
  folders: Folder[];
  activeId: string;
  onSelect: (id: string) => void;
  onNew: () => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  /** 新建文件夹 */
  onNewFolder: () => void;
  onRenameFolder: (id: string, name: string) => void;
  onDeleteFolder: (id: string) => void;
  /** 把草稿移动到目标文件夹（id 传 ROOT_FOLDER_ID 表示移回列表顶层） */
  onMoveDraft: (draftId: string, folderId: string) => void;
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
 * 文件树面板：常驻管理草稿、文件夹与本地图片库。
 * 图片存在 IndexedDB 里，不清理会一直堆积，所以这里要能看见占用并删除。
 * 文件夹只做单层（文件夹 → 草稿），不嵌套，够用且交互简单。
 */
export default function FileTree({
  drafts,
  folders,
  activeId,
  onSelect,
  onNew,
  onRename,
  onDelete,
  onNewFolder,
  onRenameFolder,
  onDeleteFolder,
  onMoveDraft,
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
  /** 被折叠起来的文件夹 id 集合（默认全展开） */
  const [closedFolders, setClosedFolders] = useState<Set<string>>(() => new Set());
  /** 正在重命名的草稿 / 文件夹 id（两者不会同时进行） */
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);
  /** 打开「移动到…」菜单的草稿 id */
  const [moveMenuId, setMoveMenuId] = useState<string | null>(null);
  /** 拖拽中的草稿 id 与当前悬停的落点分组 id */
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  /** 时间戳只在挂载时取一次，避免每次渲染都读时钟 */
  const [now] = useState(() => Date.now());

  useEffect(() => {
    if (renamingId) renameInputRef.current?.select();
  }, [renamingId]);

  // 菜单点外部就关：用捕获阶段监听，避免被条目自身的 onClick 抢先
  useEffect(() => {
    if (!moveMenuId) return;
    const close = () => setMoveMenuId(null);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [moveMenuId]);

  const toggleFolder = (id: string) => {
    setClosedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  /** 落点处理：把拖拽中的草稿移动过去 */
  const handleDrop = (targetFolderId: string) => {
    if (dragId) {
      const d = drafts.find((x) => x.id === dragId);
      // 已经在目标分组里就不动，避免无意义的状态更新
      if (d && (d.folderId ?? ROOT_FOLDER_ID) !== targetFolderId) onMoveDraft(dragId, targetFolderId);
    }
    setDragId(null);
    setDropTarget(null);
  };

  /** 分组容器需要的一组拖拽事件（根层与每个文件夹共用） */
  const dropZoneProps = (folderId: string) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!dragId) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (dropTarget !== folderId) setDropTarget(folderId);
    },
    onDragLeave: (e: React.DragEvent) => {
      // 只在真正离开这个容器时清除，掠过子元素不算
      if (e.currentTarget.contains(e.relatedTarget as Node)) return;
      setDropTarget((t) => (t === folderId ? null : t));
    },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      handleDrop(folderId);
    },
  });

  const imageList = useMemo(
    () =>
      Object.entries(images)
        .map(([name, dataUrl]) => ({ name, bytes: dataUrlBytes(dataUrl), used: usedImageNames.has(name) }))
        .sort((a, b) => b.bytes - a.bytes),
    [images, usedImageNames],
  );
  const totalBytes = imageList.reduce((sum, i) => sum + i.bytes, 0);
  const unusedCount = imageList.filter((i) => !i.used).length;

  /** 按所属文件夹归类；文件夹被删除后可能残留失效 id，这类草稿回落到根层 */
  const grouped = useMemo(() => {
    const valid = new Set(folders.map((f) => f.id));
    const map = new Map<string, Draft[]>();
    map.set(ROOT_FOLDER_ID, []);
    for (const f of folders) map.set(f.id, []);
    for (const d of drafts) {
      const key = d.folderId && valid.has(d.folderId) ? d.folderId : ROOT_FOLDER_ID;
      map.get(key)!.push(d);
    }
    return map;
  }, [drafts, folders]);

  const submitRename = () => {
    if (!renamingId || !renameValue.trim()) {
      setRenamingId(null);
      setRenameValue('');
      return;
    }
    // 文件夹与草稿共用一个重命名输入框，按是否是已知文件夹 id 分流
    if (folders.some((f) => f.id === renamingId)) onRenameFolder(renamingId, renameValue);
    else onRename(renamingId, renameValue);
    setRenamingId(null);
    setRenameValue('');
  };

  /** 渲染一篇草稿（根层与文件夹内共用） */
  const renderDraft = (d: Draft) => {
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
    const currentFolder = d.folderId ?? ROOT_FOLDER_ID;
    return (
      <div
        key={d.id}
        className={`tree-file ${active ? 'active' : ''} ${dragId === d.id ? 'dragging' : ''}`}
        role="treeitem"
        aria-selected={active}
        draggable
        onDragStart={(e) => {
          setDragId(d.id);
          e.dataTransfer.effectAllowed = 'move';
          // Firefox 必须有数据才启动拖拽
          e.dataTransfer.setData('text/plain', d.name);
        }}
        onDragEnd={() => {
          setDragId(null);
          setDropTarget(null);
        }}
      >
        <button className="tree-file-main" onClick={() => onSelect(d.id)} data-tip={d.name}>
          <FileMd size={14} />
          <span className="tree-file-text">
            <span className="tree-file-name">{d.name}</span>
            <span className="tree-file-meta">
              {d.content.replace(/\s/g, '').length} 字 · {relativeTime(d.updatedAt, now)}
            </span>
          </span>
        </button>
        <span className="tree-file-actions">
          <span className="tree-move-wrap">
            <button
              title="移动到…"
              aria-label={`移动 ${d.name} 到文件夹`}
              aria-haspopup="menu"
              aria-expanded={moveMenuId === d.id}
              onClick={(e) => {
                e.stopPropagation();
                setMoveMenuId((v) => (v === d.id ? null : d.id));
              }}
            >
              <FolderSimple size={12} />
            </button>
            {moveMenuId === d.id && (
              <div className="tree-move-menu" role="menu">
                {[{ id: ROOT_FOLDER_ID, name: '列表顶层' }, ...folders].map((f) => (
                  <button
                    key={f.id}
                    role="menuitem"
                    className={currentFolder === f.id ? 'current' : ''}
                    disabled={currentFolder === f.id}
                    onClick={() => {
                      onMoveDraft(d.id, f.id);
                      setMoveMenuId(null);
                    }}
                  >
                    {f.name}
                  </button>
                ))}
              </div>
            )}
          </span>
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
  };

  return (
    <nav className={`file-tree ${collapsed ? 'collapsed' : ''}`} aria-label="文件">
      <div className="tree-head">
        {!collapsed && <span className="tree-head-label">文件</span>}
        {!collapsed && (
          <button className="tree-new" data-tip="新建草稿" aria-label="新建草稿" onClick={onNew}>
            <FilePlus size={14} />
          </button>
        )}
        {!collapsed && (
          <button className="tree-new" data-tip="新建文件夹" aria-label="新建文件夹" onClick={onNewFolder}>
            <FolderPlus size={14} />
          </button>
        )}
        <button
          className="tree-collapse"
          data-tip={collapsed ? '展开文件面板' : '收起文件面板'}
          aria-label={collapsed ? '展开文件面板' : '收起文件面板'}
          aria-expanded={!collapsed}
          onClick={onToggleCollapsed}
        >
          {collapsed ? <SidebarSimple size={15} /> : <CaretDoubleLeft size={15} />}
        </button>
      </div>

      {/* 收起态：窄栏里直接列出每篇草稿的图标，点击切换，鼠标悬停看标题 */}
      {collapsed && (
        <div className="tree-rail" role="tree" aria-label="文件">
          {drafts.map((d) => {
            const active = d.id === activeId;
            return (
              <button
                key={d.id}
                className={`tree-rail-item ${active ? 'active' : ''}`}
                data-tip={d.name}
                aria-label={d.name}
                aria-selected={active}
                role="treeitem"
                onClick={() => onSelect(d.id)}
              >
                <FileMd size={16} />
              </button>
            );
          })}
        </div>
      )}

      {!collapsed && (
        <div className="tree-body" role="tree" aria-label="文件">
          {/* ---- 草稿（未归档的根层） ---- */}
          <div
            className={`tree-group ${dropTarget === ROOT_FOLDER_ID ? 'drop-target' : ''}`}
            role="treeitem"
            aria-expanded={draftsOpen}
            {...dropZoneProps(ROOT_FOLDER_ID)}
          >
            <button className="tree-folder" onClick={() => setDraftsOpen((v) => !v)}>
              {draftsOpen ? <CaretDown size={11} weight="bold" /> : <CaretRight size={11} weight="bold" />}
              <FolderOpen size={14} />
              <span className="tree-folder-name">草稿</span>
              <span className="tree-count">{grouped.get(ROOT_FOLDER_ID)?.length ?? 0}</span>
            </button>

            {draftsOpen && (
              <div className="tree-children" role="group">
                {(grouped.get(ROOT_FOLDER_ID) ?? []).map(renderDraft)}
                {dragId && (grouped.get(ROOT_FOLDER_ID) ?? []).length === 0 && (
                  <p className="tree-hint">拖到这里移出文件夹</p>
                )}
              </div>
            )}
          </div>

          {/* ---- 用户文件夹（单层，不可嵌套） ---- */}
          {folders.map((f) => {
            const items = grouped.get(f.id) ?? [];
            const open = !closedFolders.has(f.id);
            const renaming = renamingId === f.id;
            return (
              <div
                key={f.id}
                className={`tree-group ${dropTarget === f.id ? 'drop-target' : ''}`}
                role="treeitem"
                aria-expanded={open}
                {...dropZoneProps(f.id)}
              >
                {renaming ? (
                  <div className="tree-folder renaming">
                    <CaretDown size={11} weight="bold" />
                    <FolderOpen size={14} />
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
                ) : (
                  <div className="tree-folder-row">
                    <button className="tree-folder" onClick={() => toggleFolder(f.id)}>
                      {open ? (
                        <CaretDown size={11} weight="bold" />
                      ) : (
                        <CaretRight size={11} weight="bold" />
                      )}
                      <FolderOpen size={14} />
                      <span className="tree-folder-name">{f.name}</span>
                      <span className="tree-count">{items.length}</span>
                    </button>
                    <span className="tree-file-actions">
                      <button
                        title="重命名文件夹"
                        aria-label={`重命名文件夹 ${f.name}`}
                        onClick={() => {
                          setRenamingId(f.id);
                          setRenameValue(f.name);
                        }}
                      >
                        <PencilSimple size={12} />
                      </button>
                      <button
                        title="删除文件夹"
                        aria-label={`删除文件夹 ${f.name}`}
                        onClick={() => onDeleteFolder(f.id)}
                      >
                        <Trash size={12} />
                      </button>
                    </span>
                  </div>
                )}

                {open && (
                  <div className="tree-children" role="group">
                    {items.map(renderDraft)}
                    {items.length === 0 && <p className="tree-hint">拖草稿进来</p>}
                  </div>
                )}
              </div>
            );
          })}

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
