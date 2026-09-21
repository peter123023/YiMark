/**
 * HTML → Markdown 转换（与站点无关）。
 *
 * 从 wechatImport.ts 抽出来共用：抓取/正文提取各站点不同，但「把正文 DOM
 * 转成 Markdown」完全一致，改一处两边都受益。
 *
 * 表格是重点：Turndown 默认丢弃表格结构，只把单元格文本展平成段落
 * （用户反馈过「表格格式都没了」），所以这里先把 <table> 整体转成
 * Markdown 管道表格文本，再交给 Turndown 当普通文本输出。
 */
import TurndownService from 'turndown';

/** 单元格文本：内容常套在多层 <section><span> 里，textContent 已能取全 */
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

/** 共享的 Turndown 实例配置（公众号与其他站点排版习惯一致，无需分叉） */
export function createTurndown(): TurndownService {
  const td = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
    emDelimiter: '*',
  });

  // 网页排版常用 <span style="font-weight:700"> 做加粗而非 <strong>，补一条规则
  td.addRule('boldSpan', {
    filter: (node) => {
      if (node.nodeName !== 'SPAN') return false;
      const m = node.getAttribute('style')?.match(/font-weight:\s*(\d{3}|bold)/);
      if (!m) return false;
      return m[1] === 'bold' || Number(m[1]) >= 600;
    },
    replacement: (c) => `**${c}**`,
  });

  // 行内 code 有时是 <code> 套多层 span，保持默认即可；
  // 但 <pre><code class="language-x"> 需保留语言标记，Turndown 原生已支持。
  return td;
}

/**
 * 把正文 DOM 转成 Markdown。
 *
 * @param root 已清理过的正文容器（**注意：会被就地修改**，调用方应先 clone）
 */
export function toMarkdown(root: Element): string {
  const td = createTurndown();

  // 表格先整体换成管道表格文本，再让 Turndown 当普通文本输出
  root.querySelectorAll('table').forEach((table) => {
    const text = tableToMarkdown(table);
    if (!text) return;
    const doc = table.ownerDocument;
    const holder = doc.createElement('pre');
    // 用 <pre> 承载：Turndown 按原样保留其内部换行；若用 <p> 则换行会被折叠成
    // 一行，整张表挤成 "| a | b | | --- | ... |" 无法渲染。前后补空行做块间隔。
    holder.textContent = `\n${text}\n`;
    table.replaceWith(holder);
  });

  return td
    .turndown(root as HTMLElement)
    .replace(/[ \t]+$/gm, '') // 空 section 会留下"只有空格的行"
    .replace(/\n{3,}/g, '\n\n') // 嵌套容器会留下连续空行，压成一个
    .trim();
}
