/**
 * 网页文章导入 —— 抓取 + 正文提取 + HTML→Markdown。
 *
 * 抓取与公众号同一套机制：目标站不允许跨域（无 CORS 头），因此统一走
 * 同源代理 `/yimark/api/fetch`，目标地址放 X-Target-Url 请求头。生产环境
 * 由 nginx 反代实现，开发环境由 vite.config.ts 里的同名插件实现，
 * **两侧都必须放行同样的域名白名单**（改这里就要同步改那两处）。
 *
 * 白名单是刻意收窄的：开放代理会被拿去抓任意站点，服务器 IP 容易被拉黑。
 * 新增站点时先确认「直接 fetch 能拿到正文 HTML」，SPA 站点（正文靠 JS
 * 渲染、HTML 里只有空壳）不适合走这条路。
 */
import { toMarkdown } from './htmlToMarkdown';

const PROXY_PATH = '/yimark/api/fetch';

/**
 * 允许抓取的站点。key 是域名，value 给出用于正文提取的选择器。
 *
 * selectors 按优先级尝试，取第一个「命中的同时还有足够文本量」的。
 * 留空数组表示只用通用策略（article / main / 密度启发式）。
 */
interface SiteRule {
  /** 正文容器候选选择器，按优先级排列 */
  selectors: string[];
  /** 已知需要剔除的噪音容器（评论、推荐位等） */
  strip?: string[];
}

const SITES: Record<string, SiteRule> = {
  'mp.weixin.qq.com': { selectors: ['#js_content'] },
  'juejin.cn': {
    selectors: ['.markdown-body', '#article-root', 'article'],
    strip: ['.comment-list', '.recommend-box', '.article-suspended-panel'],
  },
  'sspai.com': {
    // 少数派用 BEM：正文是 .article__main__content（wangEditor-txt），
    // .article__header 的日期/作者等元信息不在容器内，因此不会污染正文
    selectors: ['.article__main__content', '.article-body', '.article__main'],
    strip: ['.article__header', '.article__footer', '.article__share', '.article__charge', '.article__directory', '.comments__feed__main'],
  },
  'zhihu.com': {
    selectors: ['.RichText', '.Post-RichText', '.AnswerItem-content', 'article'],
    strip: ['.CommentListV2', '.Recommendations', '.QuestionAnswer-Recommend'],
  },
  'zhuanlan.zhihu.com': {
    selectors: ['.Post-RichText', '.RichText', 'article'],
    strip: ['.CommentListV2', '.Recommendations'],
  },
  'www.xiaohongshu.com': {
    selectors: ['#detail-desc', '.note-content', '.desc'],
    strip: ['.comments-container', '.interaction-container'],
  },
  'xiaohongshu.com': {
    selectors: ['#detail-desc', '.note-content', '.desc'],
    strip: ['.comments-container', '.interaction-container'],
  },
  'www.jianshu.com': {
    selectors: ['article', '.show-content', '#content'],
    strip: ['.comment-list', '.recommended-notes'],
  },
  'medium.com': {
    selectors: ['article'],
    strip: ['.postFooter', '.js-recommendedReading'],
  },
  'www.36kr.com': {
    selectors: ['.articleDetailContent', '.article-content', 'article'],
    strip: ['.comment-list', '.related'],
  },
  'www.infoq.cn': {
    selectors: ['.article-preview', '.article-detail', 'article'],
    strip: ['.comment-list'],
  },
  'www.cnblogs.com': {
    selectors: ['#cnblogs_post_body', '.postBody', 'article'],
    strip: ['.postDesc', '#blog_post_info_block', '.commentform'],
  },
  'blog.csdn.net': {
    selectors: ['#content_views', '.htmledit_views', 'article'],
    strip: ['.recommend-box', '.comment-list', '.hide-article-box'],
  },
};

/** 支持导入的站点域名（供 UI 展示与校验复用） */
export const SUPPORTED_HOSTS = Object.keys(SITES);

export interface ImportedArticle {
  title: string;
  markdown: string;
  /** 实际命中的站点域名，用于错误提示与来源标注 */
  host: string;
}

/** 命中的站点规则；不在白名单时返回 null */
export function matchSite(rawUrl: string): { url: URL; rule: SiteRule } | null {
  try {
    const u = new URL(rawUrl.trim());
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    // 允许带 www 与不带 www 互相命中
    const host = u.hostname.toLowerCase();
    const rule = SITES[host] ?? SITES[host.replace(/^www\./, '')] ?? SITES[`www.${host}`];
    return rule ? { url: u, rule } : null;
  } catch {
    return null;
  }
}

/** 是否为受支持的链接（公众号 / 已收录站点） */
export function isSupportedArticleUrl(url: string): boolean {
  return matchSite(url) !== null;
}

/** 只留 https，避免明文抓取 */
function normalize(u: URL): string {
  const next = new URL(u.toString());
  next.protocol = 'https:';
  return next.toString();
}

/** 抓取前的兜底校验：拿不到标题或正文就明确报错 */
async function fetchHtml(target: string): Promise<string> {
  const res = await fetch(PROXY_PATH, { headers: { 'X-Target-Url': target } });
  if (res.status === 403) {
    const body = await res.text().catch(() => '');
    throw new Error(
      body.includes('only')
        ? `${new URL(target).hostname} 不在支持列表内`
        : `抓取被拒绝（HTTP 403），该站点可能屏蔽了自动抓取`,
    );
  }
  if (!res.ok) throw new Error(`抓取失败（HTTP ${res.status}），请稍后重试`);
  return res.text();
}

/** 判断某个容器是否「有实质内容」：文本太少的多半是空壳或导航 */
function hasEnoughText(el: Element): boolean {
  const text = (el.textContent ?? '').replace(/\s+/g, '');
  if (text.length < 120) return false;
  // 正文通常段落/换行较多，导航列表段落极少
  return el.querySelectorAll('p, br, li, img, pre, table').length >= 2;
}

/**
 * 通用正文提取（不依赖具体站点）：在候选容器里挑「文本量最大」的那个。
 * 这是 Readability 那类库的简化版——不做 DOM 打分，只按文本密度取舍，
 * 对已收录的主流站点足够；纯 SPA 站点抓不到 HTML 正文，只能拿到空壳。
 */
function pickByDensity(root: Element): Element | null {
  const candidates = Array.from(
    root.querySelectorAll('article, main, [role="main"], .post, .article, .content, .entry-content, div'),
  );
  let best: Element | null = null;
  let bestScore = 0;
  for (const el of candidates) {
    // 段落越多的容器越可能是正文；嵌套容器会被子节点一并计入，
    // 因此用「直接子段落数」而不是全部后代，避免把 body 这种大壳选中
    const direct = el.querySelectorAll(':scope > p, :scope > section > p, :scope > div > p').length;
    const text = (el.textContent ?? '').replace(/\s+/g, '').length;
    if (text < 120 || direct < 2) continue;
    const score = text * Math.min(direct, 30);
    if (score > bestScore) {
      bestScore = score;
      best = el;
    }
  }
  return best;
}

/** 在候选选择器里挑第一个有实质内容的容器 */
function pickBySelectors(doc: Document, selectors: string[]): Element | null {
  for (const sel of selectors) {
    const hits = Array.from(doc.querySelectorAll(sel)).filter(hasEnoughText);
    if (hits.length) {
      // 同选择器命中多个时取文本最多的那个
      return hits.reduce((a, b) =>
        (a.textContent ?? '').length >= (b.textContent ?? '').length ? a : b,
      );
    }
  }
  return null;
}

/** 清理正文容器：去脚本样式、补图片懒加载、剔除噪音块，返回可供转换的克隆 */
function prepare(clone: Element, rule: SiteRule): Element {
  clone.querySelectorAll('script, style, svg, iframe, noscript, form, button').forEach((n) => n.remove());
  for (const sel of rule.strip ?? []) clone.querySelectorAll(sel).forEach((n) => n.remove());

  // 图片懒加载：真实地址常放在 data-src / data-original / srcset 上
  clone.querySelectorAll('img').forEach((img) => {
    const real =
      img.getAttribute('data-src') ||
      img.getAttribute('data-original') ||
      img.getAttribute('data-lazy-src') ||
      img.getAttribute('src') ||
      '';
    // srcset 里挑第一个 URL 作为兜底
    if (!real) {
      const first = img.getAttribute('srcset')?.split(',')[0]?.trim().split(/\s+/)[0];
      if (first) img.setAttribute('src', first);
    } else {
      img.setAttribute('src', real);
    }
    img.removeAttribute('data-src');
    img.removeAttribute('data-original');
    img.removeAttribute('srcset');
    img.removeAttribute('loading');
  });

  // 代码块里行号常见于行内 <span class="line-number">，清掉避免污染代码
  clone.querySelectorAll('.line-number, .hljs-ln-numbers').forEach((n) => n.remove());
  return clone;
}

/** 从 meta 标签兜底取标题 */
function pickTitle(doc: Document, fallbackHost: string): string {
  const meta = (prop: string) =>
    doc.querySelector(`meta[property="${prop}"]`)?.getAttribute('content')?.trim() ||
    doc.querySelector(`meta[name="${prop}"]`)?.getAttribute('content')?.trim() ||
    '';
  const raw =
    meta('og:title') ||
    meta('twitter:title') ||
    doc.querySelector('h1')?.textContent?.trim() ||
    doc.title?.trim() ||
    '';
  // 站点名常以 "标题 - 站点" 或 "标题 | 站点" 结尾，去掉更干净
  const cleaned = raw
    .replace(/\s*[-–|_]\s*[^-–|_]{0,20}$/, (m) => (raw.length - m.length > 6 ? '' : m))
    .trim();
  return cleaned || `${fallbackHost} 文章`;
}

/** 抓取并解析网页文章，正文转成 Markdown。失败时抛出可读的错误信息 */
export async function importWebArticle(rawUrl: string): Promise<ImportedArticle> {
  const matched = matchSite(rawUrl);
  if (!matched) {
    throw new Error('请输入受支持的链接（公众号 / 掘金 / 少数派 / 知乎 / 小红书 等）');
  }
  const { url, rule } = matched;
  const target = normalize(url);
  const host = url.hostname;

  const html = await fetchHtml(target);
  const doc = new DOMParser().parseFromString(html, 'text/html');

  // 风控 / 验证页 / 空壳页特征：正文提取会失败，提前给出更有用的提示
  const content =
    pickBySelectors(doc, rule.selectors) ??
    pickByDensity(doc.body ?? doc.documentElement) ??
    null;
  if (!content) {
    throw new Error('没有找到文章正文：链接可能已失效，或该站点要求验证 / 正文由脚本渲染');
  }

  const title = pickTitle(doc, host);
  const prepared = prepare(content.cloneNode(true) as Element, rule);
  const markdown = toMarkdown(prepared);
  if (!markdown) throw new Error('文章正文是空的');

  return { title, markdown, host };
}
