/**
 * 公众号文章导入 —— 保留公众号特有的那点差异，其余交给 webImport。
 *
 * 微信正文页不允许跨域抓取（无 CORS 头），因此统一走同源代理
 * `/yimark/api/fetch`（目标地址放 X-Target-Url 请求头——header 值不经
 * URL 编码，nginx 反代才能原样取出做白名单校验）：生产环境由 nginx
 * 反代实现（只放行白名单域名），开发环境由 vite.config.ts 里的
 * 同名插件实现，两边只做转发，解析全部在前端完成。
 *
 * 微信文章的两个关键点：
 * 1. 图片懒加载 —— 真实地址在 data-src，src 是灰占位图，必须换过来；
 * 2. 图床（mmbiz.qpic.cn）校验 Referer，预览渲染时需要
 *    referrerpolicy="no-referrer"（见 markdown.ts 的 renderImg）。
 */
import { importWebArticle, isSupportedArticleUrl, matchSite, type ImportedArticle } from './webImport';

export type { ImportedArticle };

/** 兼容旧调用：文章解析结果（标题 + Markdown） */
export interface WechatArticle {
  title: string;
  markdown: string;
}

/** 是否为公众号文章链接 */
export function isWechatArticleUrl(url: string): boolean {
  return matchSite(url)?.url.hostname === 'mp.weixin.qq.com';
}

/**
 * 抓取并解析文章，正文转成 Markdown。
 *
 * 名字保留为「wechat」是为兼容既有调用；实现上已支持白名单内的所有站点，
 * 公众号只是其中一条规则（见 webImport.ts 的 SITES）。
 */
export async function importWechatArticle(rawUrl: string): Promise<WechatArticle> {
  const article = await importWebArticle(rawUrl);
  return { title: article.title, markdown: article.markdown };
}

export { isSupportedArticleUrl };
