/**
 * 导入 / 导出：把草稿与图片库搬进搬出浏览器。
 *
 * 正常写作时数据只躺在 localStorage（草稿）与 IndexedDB（图片）里，
 * 换电脑、清缓存就全没了。这里提供两条通路：
 * - 单篇 `.md`：给外部工具用，纯文本，图片引用保持 `![[名字]]`
 * - 全量 `.zip`：草稿 + 图片原始文件 + manifest.json，可以完整导回
 */

import type { Draft, Folder } from './components/FileTree';
import { createZip, readZip, type ZipEntry } from './zip';

/** 备份包结构版本；将来改格式靠它区分 */
const BACKUP_VERSION = 1;
const MANIFEST = 'manifest.json';

interface Manifest {
  app: string;
  version: number;
  exportedAt: number;
  drafts: { id: string; name: string; file: string; updatedAt: number; folderId?: string }[];
  images: { name: string; file: string; mime: string }[];
  /** 文件夹（v1 起）；老备份包没有这个字段，读取时兜底为空数组 */
  folders?: Folder[];
}

/** 导入结果：草稿、文件夹与图片分开交给调用方合并 */
export interface ImportResult {
  drafts: Draft[];
  folders: Folder[];
  images: Record<string, string>;
  /** 无法识别的文件名 */
  skipped: string[];
}

const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  avif: 'image/avif',
};

const EXT_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'image/bmp': 'bmp',
  'image/avif': 'avif',
};

/** 触发浏览器下载 */
export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // 立即 revoke 在部分浏览器上会打断下载，推迟一轮
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** 文件名安全化：去掉路径分隔符等非法字符 */
export function safeFileName(name: string): string {
  const cleaned = name
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '');
  return cleaned || '未命名';
}

/** `YYYYMMDD-HHmm`，用于备份文件名 */
function stamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

/* ---------------- data URI ⇄ 字节 ---------------- */

function decodeDataUrl(dataUrl: string): { bytes: Uint8Array; mime: string } {
  const comma = dataUrl.indexOf(',');
  const header = dataUrl.slice(5, comma); // 去掉 `data:`
  const mime = header.split(';')[0] || 'application/octet-stream';
  const payload = dataUrl.slice(comma + 1);
  if (!header.includes('base64')) {
    return { bytes: new TextEncoder().encode(decodeURIComponent(payload)), mime };
  }
  const bin = atob(payload);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { bytes, mime };
}

function encodeDataUrl(bytes: Uint8Array, mime: string): string {
  // 一次 String.fromCharCode(...整个数组) 会爆调用栈，分块拼
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return `data:${mime};base64,${btoa(bin)}`;
}

/** 按文件名后缀猜 mime（zip 里的图片没有 mime 信息时兜底） */
function mimeFromName(name: string): string {
  const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
  return MIME_BY_EXT[ext] ?? 'image/png';
}

/** 图片名带合适的后缀（原名没后缀时按 mime 补上） */
function imageFileName(name: string, mime: string): string {
  const safe = safeFileName(name);
  return /\.[a-z0-9]+$/i.test(safe) ? safe : `${safe}.${EXT_BY_MIME[mime] ?? 'png'}`;
}

/* ---------------- 导出 ---------------- */

/** 导出单篇草稿为 .md */
export function exportDraftMarkdown(draft: Draft): void {
  const blob = new Blob([draft.content], { type: 'text/markdown;charset=utf-8' });
  downloadBlob(`${safeFileName(draft.name)}.md`, blob);
}

/**
 * 导出全量备份 zip。
 * 草稿文件名带序号前缀，保证解压后顺序与列表一致、且重名不互相覆盖。
 */
export async function exportBackupZip(
  drafts: Draft[],
  images: Record<string, string>,
  folders: Folder[] = [],
): Promise<void> {
  const enc = new TextEncoder();
  const entries: ZipEntry[] = [];
  const manifest: Manifest = {
    app: 'yimark',
    version: BACKUP_VERSION,
    exportedAt: Date.now(),
    drafts: [],
    images: [],
    folders,
  };

  drafts.forEach((d, i) => {
    // 文件夹归属记进 manifest 而不是目录结构：md 文件保持平铺，外部工具好读
    const file = `drafts/${String(i + 1).padStart(2, '0')}-${safeFileName(d.name)}.md`;
    entries.push({ name: file, data: enc.encode(d.content) });
    manifest.drafts.push({ id: d.id, name: d.name, file, updatedAt: d.updatedAt, folderId: d.folderId });
  });

  for (const [name, dataUrl] of Object.entries(images)) {
    const { bytes, mime } = decodeDataUrl(dataUrl);
    const file = `images/${imageFileName(name, mime)}`;
    entries.push({ name: file, data: bytes });
    manifest.images.push({ name, file, mime });
  }

  entries.unshift({ name: MANIFEST, data: enc.encode(JSON.stringify(manifest, null, 2)) });
  const blob = await createZip(entries);
  downloadBlob(`易码备份-${stamp()}.zip`, blob);
}

/* ---------------- 导入 ---------------- */

/** 去掉扩展名，作为草稿名 */
function draftNameFromFile(fileName: string): string {
  return fileName.replace(/\.(md|markdown|txt)$/i, '') || '未命名草稿';
}

let idSeq = 0;
/** 生成不重复的草稿 id（同一毫秒内批量导入也不会撞） */
function newDraftId(): string {
  idSeq += 1;
  return `draft-${Date.now()}-${idSeq}`;
}

/** 生成不重复的文件夹 id */
function newFolderId(): string {
  idSeq += 1;
  return `folder-${Date.now()}-${idSeq}`;
}

async function importBackupZip(file: File): Promise<ImportResult> {
  const entries = await readZip(file);
  const byName = new Map(entries.map((e) => [e.name, e.data]));
  const dec = new TextDecoder();
  const result: ImportResult = { drafts: [], folders: [], images: {}, skipped: [] };

  const manifestBytes = byName.get(MANIFEST);
  const manifest: Manifest | null = manifestBytes
    ? (JSON.parse(dec.decode(manifestBytes)) as Manifest)
    : null;

  if (manifest) {
    // 文件夹 id 也要重编：导入是「追加」，沿用原 id 会和现有文件夹冲突
    const folderMap = new Map<string, string>();
    for (const f of manifest.folders ?? []) {
      if (!f?.id || !f.name) continue;
      const nid = newFolderId();
      folderMap.set(f.id, nid);
      result.folders.push({ id: nid, name: f.name });
    }
    for (const d of manifest.drafts) {
      const data = byName.get(d.file);
      if (!data) {
        result.skipped.push(d.file);
        continue;
      }
      result.drafts.push({
        id: newDraftId(), // 不沿用原 id：导入是「追加」，撞上现有草稿会互相覆盖
        name: d.name,
        content: dec.decode(data),
        updatedAt: d.updatedAt || Date.now(),
        // 归属的文件夹若不在本次导入内，就落到根层
        folderId: d.folderId ? folderMap.get(d.folderId) : undefined,
      });
    }
    for (const img of manifest.images) {
      const data = byName.get(img.file);
      if (!data) {
        result.skipped.push(img.file);
        continue;
      }
      result.images[img.name] = encodeDataUrl(data, img.mime);
    }
    return result;
  }

  // 没有 manifest（比如手工打的包）：按目录 / 后缀猜
  for (const entry of entries) {
    const base = entry.name.slice(entry.name.lastIndexOf('/') + 1);
    if (base.startsWith('.') || base.startsWith('__MACOSX')) continue;
    if (/\.(md|markdown|txt)$/i.test(base)) {
      result.drafts.push({
        id: newDraftId(),
        name: draftNameFromFile(base),
        content: dec.decode(entry.data),
        updatedAt: Date.now(),
      });
    } else if (/\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i.test(base)) {
      result.images[base] = encodeDataUrl(entry.data, mimeFromName(base));
    } else {
      result.skipped.push(entry.name);
    }
  }
  return result;
}

/**
 * 导入用户选中的文件：`.md` / `.markdown` / `.txt` 各建一篇草稿，
 * `.zip` 按备份包整体还原。返回的草稿与图片由调用方决定怎么合并。
 */
export async function importFiles(files: File[]): Promise<ImportResult> {
  const merged: ImportResult = { drafts: [], folders: [], images: {}, skipped: [] };
  for (const file of files) {
    if (/\.zip$/i.test(file.name)) {
      try {
        const part = await importBackupZip(file);
        merged.drafts.push(...part.drafts);
        merged.folders.push(...part.folders);
        Object.assign(merged.images, part.images);
        merged.skipped.push(...part.skipped);
      } catch (err) {
        console.warn('备份包解析失败', file.name, err);
        merged.skipped.push(file.name);
      }
    } else if (/\.(md|markdown|txt)$/i.test(file.name)) {
      merged.drafts.push({
        id: newDraftId(),
        name: draftNameFromFile(file.name),
        content: await file.text(),
        updatedAt: file.lastModified || Date.now(),
      });
    } else {
      merged.skipped.push(file.name);
    }
  }
  return merged;
}
