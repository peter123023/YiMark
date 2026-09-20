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

/** 单元格文本：微信把内容套在 <section><span leaf> 里，textContent 已能取全 */
function cellText(cell: Element): string {
  return (cell.textContent || '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\|/g, '\\|'); // 管道符是表格分隔符，必须转义
}

/**
 * 把 HTML <table> 转成 Markdown 管道表格。
 * 处理要点：
 * - rowspan / colspan 通过占位补齐，保证每行列数一致（Markdown 表格必须有规整网格）；
 * - 首行（thead 或第一行 tr）作表头，无表头时用空表头占位；
 * - 单列或结构异常时退化为逐行文本，避免产出非法 Markdown。
 */
function tableToMarkdown(table: Element): string {
  const trs = Array.from(table.querySelectorAll<HTMLTableRowElement>('tr'));
  if (!trs.length) return '';

  // 展开成规整网格
  const grid: string[][] = [];
  const pending: (string | null)[] = []; // 被 rowspan 占住、待下方行填补的位置

  trs.forEach((tr, rowIdx) => {
    const row: string[] = [];
    let col = 0;
    const takePending = () => {
      while (pending[col] !== undefined) {
        if (pending[col] !== null) {
          const v = pending[col] as string;
          row[col] = v;
          pending[col] = null; // 已消费，后续行不再补
        }
        col++;
      }
    };

    Array.from(tr.children).forEach((cell) => {
      const name = cell.nodeName;
      if (name !== 'TD' && name !== 'TH') return;
      takePending();
      const text = cellText(cell);
      const colspan = Math.min(Number(cell.getAttribute('colspan')) || 1, 20);
      const rowspan = Math.min(Number(cell.getAttribute('rowspan')) || 1, 50);
      for (let i = 0; i < colspan; i++) {
        row[col] = i === 0 ? text : ''; // 合并列只保留第一格内容
        if (rowspan > 1) pending[col] = text; // 下方 rowspan-1 行补齐
        col++;
      }
    });
    takePending();
    // 补齐本行可能缺失的列（前面的 rowspan 造成）
    for (let i = 0; i < row.length; i++) if (row[i] === undefined) row[i] = '';
    grid[rowIdx] = row;
  });

  // 统一列数到最大值
  const width = grid.reduce((m, r) => Math.max(m, r.length), 0);
  if (width < 2) return grid.flat().filter(Boolean).join('\n'); // 单列：退化为文本
  grid.forEach((r) => {
    for (let i = r.length; i < width; i++) r.push('');
  });

  const headTr = table.querySelector<HTMLTableRowElement>('thead tr');
  // 无 thead 时用第一行作表头；单行表格则表头留空，把内容放进数据行
  const header = headTr ? grid[trs.indexOf(headTr)] : grid[0];
  const body = grid.slice(1);
  const headRow = !header || (!header.some((c) => c) && body.length === 0)
    ? new Array(width).fill('')
    : header;

  const lines = [
    `| ${headRow.join(' | ')} |`,
    `| ${new Array(width).fill('---').join(' | ')} |`,
    ...body.map((r) => `| ${r.join(' | ')} |`),
  ];
  return lines.join('\n');
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

  // 表格：微信用标准 <table><thead><tr><th>，但 Turndown 默认丢弃表格结构、
  // 只把单元格文本展平成段落（用户反馈"表格格式都没了"）。这里先整体转成
  // Markdown 管道表格文本、挂到 table 元素自身，再让 Turndown 当普通文本输出。
  content.querySelectorAll('table').forEach((table) => {
    const text = tableToMarkdown(table);
    if (!text) return;
    const holder = doc.createElement('pre');
    // 用 <pre> 承载：Turndown 按原样保留其内部换行；若用 <p> 则换行会被折叠成
    // 一行，整张表挤成 "| a | b | | --- | ... |" 无法渲染。前后补空行做块间隔。
    holder.textContent = `\n${text}\n`;
    table.replaceWith(holder);
  });

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
