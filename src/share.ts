/**
 * 文章分享 —— 把当前草稿上传成一条可公开访问的链接。
 *
 * 生产：POST /yimark/api/share（nginx 反代到本机 share 服务，存 JSON 文件）
 * 开发：vite.config.ts 里的同名 stub（内存 Map，约定与生产一致）。
 * 阅读端走 hash 路由 #/read/<id>，由 ReadView 拉取渲染，无需任何登录。
 */

export interface SharePayload {
  title: string;
  markdown: string;
  /** 阅读端按文章自带的排版主题渲染，与分享者所见一致 */
  themeId: string;
  densityId: string;
  /** 正文引用到的本地图片（文件名 → data URI），公众号外链图不需要 */
  images: Record<string, string>;
}

export interface SharedArticle extends SharePayload {
  id: string;
  createdAt: number;
}

const SHARE_API = '/yimark/api/share';
const READ_API = '/yimark/api/read';

/** 创建分享，返回可公开访问的阅读链接 */
export async function createShareLink(payload: SharePayload): Promise<string> {
  const res = await fetch(SHARE_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const msg = res.status === 413 ? '内容过大（含图片超过 6MB），无法分享' : `分享失败（HTTP ${res.status}）`;
    throw new Error(msg);
  }
  const data = (await res.json()) as { id?: string };
  if (!data.id) throw new Error('分享失败：服务端响应异常');
  return buildReadUrl(data.id);
}

/** 拉取分享的文章；404 抛出可读错误，由阅读页展示 */
export async function fetchSharedArticle(id: string): Promise<SharedArticle> {
  const res = await fetch(`${READ_API}/${encodeURIComponent(id)}`);
  if (res.status === 404) throw new Error('文章不存在或已被删除');
  if (!res.ok) throw new Error(`加载失败（HTTP ${res.status}）`);
  return (await res.json()) as SharedArticle;
}

/** 阅读链接：当前站点 + hash 路由（base './' 相对路径，hash 不影响静态资源加载） */
export function buildReadUrl(id: string): string {
  return `${window.location.origin}${window.location.pathname}#/read/${id}`;
}
