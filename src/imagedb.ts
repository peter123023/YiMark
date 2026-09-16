/**
 * IndexedDB 图片存储：文件名 → data URI。
 * 容量远大于 localStorage，适合多图长期保存；本地图片注册表存这里。
 */

const DB_NAME = 'yimark';
/** 改名前的图片库名（Mars Editor / wechat-mp-editor 时代），迁移完即删 */
const LEGACY_DB_NAME = 'wechat-mp-editor';
/** 迁移只跑一次的标记位 */
const MIGRATION_FLAG = 'yimark:imgdb-migrated';
const STORE = 'images';

export interface StoredImage {
  name: string;
  dataUrl: string;
  /** dataUrl 字节数，供统计用 */
  size: number;
}

function openDb(name: string = DB_NAME): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE, { keyPath: 'name' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('打开图片库失败'));
  });
}

/** 读出指定库里的全部图片记录（仅迁移用；库不存在或读失败都返回空） */
function readAll(dbName: string): Promise<StoredImage[]> {
  return new Promise((resolve) => {
    const req = indexedDB.open(dbName, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE, { keyPath: 'name' });
      }
    };
    req.onerror = () => resolve([]);
    req.onsuccess = () => {
      const db = req.result;
      const done = (items: StoredImage[]) => {
        db.close();
        resolve(items);
      };
      if (!db.objectStoreNames.contains(STORE)) return done([]);
      const tx = db.transaction(STORE, 'readonly');
      const all = tx.objectStore(STORE).getAll();
      all.onsuccess = () => done(all.result as StoredImage[]);
      all.onerror = () => done([]);
    };
  });
}

/**
 * 一次性迁移：把改名前的图片库整体搬进新库，然后删掉旧库。
 * 先落标记位再干活 —— 迁移失败也不至于每次启动都重试一遍。
 */
async function migrateLegacyDb(): Promise<void> {
  if (localStorage.getItem(MIGRATION_FLAG)) return;
  localStorage.setItem(MIGRATION_FLAG, '1');
  try {
    const items = await readAll(LEGACY_DB_NAME);
    if (!items.length) return;
    const db = await openDb();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, 'readwrite');
      for (const item of items) tx.objectStore(STORE).put(item);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    });
  } finally {
    indexedDB.deleteDatabase(LEGACY_DB_NAME);
  }
}

let dbPromise: Promise<IDBDatabase> | null = null;

function getDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = migrateLegacyDb()
      .catch(() => undefined)
      .then(() => openDb());
  }
  return dbPromise;
}

/** 读出全部图片 → { 文件名: dataUrl } */
export async function getAllImages(): Promise<Record<string, string>> {
  const db = await getDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => {
      const map: Record<string, string> = {};
      for (const item of req.result as StoredImage[]) map[item.name] = item.dataUrl;
      resolve(map);
    };
    req.onerror = () => reject(req.error);
  });
}

/** 保存一张图片（同名覆盖） */
export async function putImage(name: string, dataUrl: string): Promise<void> {
  const db = await getDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put({ name, dataUrl, size: dataUrl.length } satisfies StoredImage);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** 删除一张图片 */
export async function deleteImage(name: string): Promise<void> {
  const db = await getDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(name);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** 统计图片库占用 */
export async function imageUsage(): Promise<{ count: number; bytes: number }> {
  const db = await getDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => {
      const items = req.result as StoredImage[];
      resolve({ count: items.length, bytes: items.reduce((s, i) => s + i.size, 0) });
    };
    req.onerror = () => reject(req.error);
  });
}
