/**
 * 公众号文章导入 —— 抓取 + 正文提取 + HTML→Markdown。
 *
 * 微信正文页不允许跨域抓取（无 CORS 头），因此统一走同源代理
 * `/yimark/api/fetch`（目标地址放 X-Target-Url 请求头——header 值不经
 * URL 编码，nginx 反代才能原样取出做白名单校验）：生产环境由 nginx
 * 反代实现（只放行 mp.weixin.qq.com），开发环境由 vite.config.ts 里的
 * 同名插件实现，两边只做转发，解析全部在前端完成。
 *
 * 微信文章的两个关键点：
 * 1. 图片懒加载 —— 真实地址在 data-src，src 是灰占位图，必须换过来；
 * 2. 图床（mmbiz.qpic.cn）校验 Referer，预览渲染时需要
 *    referrerpolicy="no-referrer"（见 markdown.ts 的 renderImg）。
 */
import TurndownService from 'turndown';

const PROXY_PATH = '/yimark/api/fetch';

/** 是否为公众号文章链接：只认 mp.weixin.qq.com，防止代理被滥用到任意站点 */
export function isWechatArticleUrl(url: string): boolean {
  try {
    const u = new URL(url.trim());
    return u.protocol === 'https:' && u.hostname === 'mp.weixin.qq.com';
  } catch {
    return false;
  }
}

export interface WechatArticle {
  title: string;
  markdown: string;
}

/** 抓取并解析公众号文章，正文转成 Markdown。失败时抛出可读的错误信息 */
export async function importWechatArticle(rawUrl: string): Promise<WechatArticle> {
  const url = rawUrl.trim();
  if (!isWechatArticleUrl(url)) throw new Error('请输入 https://mp.weixin.qq.com/ 开头的文章链接');

  const res = await fetch(PROXY_PATH, { headers: { 'X-Target-Url': url } });
  if (!res.ok) throw new Error(`抓取失败（HTTP ${res.status}），请稍后重试`);
  const html = await res.text();

  const doc = new DOMParser().parseFromString(html, 'text/html');
  const title =
    doc.querySelector('#activity-name')?.textContent?.trim() ||
    doc.querySelector('meta[property="og:title"]')?.getAttribute('content')?.trim() ||
    doc.querySelector('h1.rich_media_title')?.textContent?.trim() ||
    '';

  const content = doc.querySelector('#js_content');
  if (!content) {
    // 风控验证页 / 文章已删除页都没有 #js_content
    throw new Error('没有找到文章正文：链接可能已失效，或微信要求验证，请稍后重试');
  }

  // 图片懒加载：data-src 才是真实地址；顺手剔除脚本、样式与嵌入媒体
  content.querySelectorAll('img').forEach((img) => {
    const real = img.getAttribute('data-src') || img.getAttribute('src') || '';
    if (real) img.setAttribute('src', real);
    img.removeAttribute('data-src');
  });
  content.querySelectorAll('script, style, svg, iframe, mpvoice, mpvideosnap').forEach((n) => n.remove());

  const td = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
    emDelimiter: '*',
  });
  // 公众号排版常用 <span style="font-weight:700"> 做加粗而非 <strong>，补一条规则
  td.addRule('wechatBoldSpan', {
    filter: (node) => {
      if (node.nodeName !== 'SPAN') return false;
      const m = node.getAttribute('style')?.match(/font-weight:\s*(\d{3}|bold)/);
      if (!m) return false;
      return m[1] === 'bold' || Number(m[1]) >= 600;
    },
    replacement: (c) => `**${c}**`,
  });

  const markdown = td
    .turndown(content as HTMLElement)
    .replace(/[ \t]+$/gm, '') // 空 section 会留下"只有空格的行"
    .replace(/\n{3,}/g, '\n\n') // 嵌套 section 会留下连续空行，压成一个
    .trim();
  if (!markdown) throw new Error('文章正文是空的');

  return { title: title || '公众号文章', markdown };
}
