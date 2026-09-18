/**
 * 图片工具：把本地图片文件缩放到指定尺寸内并转为 data URL，
 * 内嵌进 markdown 实现本地预览。
 */
export function downscaleImage(file: File, maxDim = 1280, quality = 0.82): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('无法创建画布');
        ctx.drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(url);
        // PNG 保留透明通道；其余转 JPEG 压缩
        const mime = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
        resolve(canvas.toDataURL(mime, quality));
      } catch (err) {
        URL.revokeObjectURL(url);
        reject(err);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('图片解码失败'));
    };
    img.src = url;
  });
}

/**
 * 给新图片挑一个不与现有注册表冲突的名字。
 *
 * 必须做这件事的原因：粘贴的截图文件名几乎都叫 `image.png`（macOS/Windows 截图、
 * 聊天工具复制的图都是），而注册表是以文件名为键的 —— 直接用文件名会把旧图覆盖掉，
 * 文档里所有引用 `![[image.png]]` 的旧图会集体变成新粘的这张。
 *
 * 规则：内容与已有图片完全一致就复用那个名字（同一张图重复粘贴不该产生副本）；
 * 否则加 `-2`/`-3` 后缀直到没被占用。reserved 收集本批次已分配的名字，
 * 因为 onAdd 走的是 React state，同一批里的后续文件看不到前一个的写入。
 */
export function uniqueImageName(
  rawName: string,
  dataUrl: string,
  existing: Record<string, string>,
  reserved: Set<string>,
): string {
  const same = Object.entries(existing).find(([, url]) => url === dataUrl);
  if (same) return same[0];
  const taken = (n: string) => n in existing || reserved.has(n);
  const name = rawName || 'image.png';
  if (!taken(name)) return name;
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  for (let i = 2; i < 1000; i++) {
    const candidate = `${stem}-${i}${ext}`;
    if (!taken(candidate)) return candidate;
  }
  return `${stem}-${Date.now()}${ext}`;
}

/**
 * 批量注册图片文件：逐张降采样后调用 onAdd(name, dataUrl)。
 * 返回成功/失败的文件名，便于插入 ![[name]] 或提示。
 * existing 传当前注册表（文件名 → data URI），用于重名去冲突。
 */
export async function registerImageFiles(
  files: File[],
  onAdd: (name: string, dataUrl: string) => void,
  existing: Record<string, string> = {},
): Promise<{ names: string[]; failures: string[] }> {
  const names: string[] = [];
  const failures: string[] = [];
  const reserved = new Set<string>();
  for (const f of files) {
    try {
      const dataUrl = await downscaleImage(f);
      const name = uniqueImageName(f.name, dataUrl, existing, reserved);
      reserved.add(name);
      onAdd(name, dataUrl);
      names.push(name);
    } catch (err) {
      console.warn('图片处理失败', f.name, err);
      failures.push(f.name);
    }
  }
  return { names, failures };
}
