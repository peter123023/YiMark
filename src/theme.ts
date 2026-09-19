/**
 * 主题系统 —— 预览与导出的唯一样式来源。
 * 所有样式必须内联（微信编辑器会丢弃 class 与 <style>，只保留内联 style），
 * 因此这里不产出任何 CSS 类，只产出 style 字符串。
 *
 * 每套主题是一个完整的样式令牌集，渲染器按主题参数化输出内联样式。
 */

export interface Theme {
  id: string;
  name: string;
  description: string;
  /** 预览纸底是浅色还是深色（主题栏据此分组；不要靠 codePaletteMode 推断） */
  appearance: 'light' | 'dark';
  /** 等宽字体（代码） */
  mono: string;
  /** 正文基础（section 包裹 / 段落继承） */
  body: {
    font: string;
    fontSize: string;
    lineHeight: string;
    color: string;
    /** 文章背景（设置后预览卡与导出均采用） */
    bg?: string;
  };
  /** 强调色（标题装饰 / 引用 / 链接等） */
  accent: string;
  /** 强调色的淡色（用于色带等大面积背景） */
  accentSoft?: string;
  /** 标题 */
  heading: {
    font: string;
    fontWeight: string;
    color: string;
    lineHeight: string;
    letterSpacing?: string;
    marginTop: string;
    marginBottom: string;
    /** 标题装饰：accent-bar 顶部强调条 / underline 下划线 / band 色带 / rule 杂志粗规则线 / none */
    decor?: 'none' | 'underline' | 'band' | 'accent-bar' | 'rule';
  };
  headingSizes: { h1: string; h2: string; h3: string; h4: string; h5: string; h6: string };
  /** 段落间距 */
  pMargin: string;
  /** 提示条（> [!tip]） */
  callout: {
    background: string;
    color: string;
    borderLeft: string;
    borderRadius: string;
    padding: string;
    margin: string;
    /** 标题徽标底色（默认取 accentSoft） */
    badgeBg?: string;
    /** 标题徽标文字色（默认取 accent） */
    badgeColor?: string;
    extra?: Record<string, string>;
  };
  /** 引用块 */
  quote: {
    background: string;
    color: string;
    borderLeft: string;
    borderRadius: string;
    padding: string;
    margin: string;
    fontStyle?: string;
    /** 大引号装饰字符 */
    bigMark?: boolean;
    extra?: Record<string, string>;
  };
  /** 行内代码 */
  code: { background: string; color: string; borderRadius: string; padding: string; fontSize: string; extra?: Record<string, string> };
  /** 块级代码 */
  codeBlock: { background: string; color: string; borderRadius: string; padding: string; fontSize: string; lineHeight: string; extra?: Record<string, string> };
  /** 链接 */
  link: { color: string; textDecoration: string };
  listPaddingLeft: string;
  listItemMargin: string;
  /** 表格 */
  table: { borderColor: string; headBg: string; headColor: string; fontSize: string; cellPadding: string };
  /** 分割线 */
  hr: { color: string; margin: string };
  /** 图片 */
  img: { borderRadius: string; margin: string };
  /** 加粗颜色（'inherit' 表示继承正文色） */
  strongColor: string;
  /** 删除线颜色 */
  delColor: string;
  /** ==高亮== 标记 */
  mark: { background: string; color: string; borderRadius: string; padding: string };
  /** 脚注 */
  footnote: { refColor: string; blockBorder: string; textColor: string; numColor: string; textSize: string };
  /** highlight.js 语法高亮色板（key = hljs class，value = 颜色） */
  codePalette: Record<string, string>;
  /** 色板模式（暗夜终端用 dark，其余 light） */
  codePaletteMode: 'light' | 'dark';
}

/* ---------------- 字体栈 ---------------- */

const SANS =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif";
const SERIF = "Georgia, 'Songti SC', 'SimSun', 'Times New Roman', serif";
const MONO = "ui-monospace, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace";

/* ---------------- highlight.js 语法色板（light / dark 各一套） ---------------- */

/** 浅色板：暖纸底代码片上的柔和对比色（经典 / 杂志编辑 / 奶油手账共用） */
const PALETTE_LIGHT: Record<string, string> = {
  'hljs-keyword': '#9a3d9e',
  'hljs-string': '#b4552f',
  'hljs-title': '#7a4a9e',
  'hljs-title.function_': '#7a4a9e',
  'hljs-title.class_': '#7a4a9e',
  'hljs-number': '#c0781a',
  'hljs-literal': '#c0781a',
  'hljs-built_in': '#4a7a9e',
  'hljs-type': '#4a7a9e',
  'hljs-attr': '#8a6d1a',
  'hljs-attribute': '#8a6d1a',
  'hljs-comment': '#a39c90',
  'hljs-meta': '#8a8376',
  'hljs-variable': '#2b6a52',
  'hljs-params': '#6a4a3a',
  'hljs-symbol': '#c0781a',
  'hljs-regexp': '#b4552f',
  'hljs-addition': '#4a7a52',
  'hljs-deletion': '#b44545',
  'hljs-selector-tag': '#9a3d9e',
  'hljs-selector-class': '#7a4a9e',
  'hljs-selector-id': '#7a4a9e',
  'hljs-selector-attr': '#8a6d1a',
  'hljs-selector-pseudo': '#8a6d1a',
  'hljs-tag': '#b4552f',
  'hljs-name': '#9a3d9e',
  'hljs-operator': '#6a5a4a',
  'hljs-bullet': '#c0781a',
  'hljs-quote': '#a39c90',
  'hljs-emphasis': '#6a5a4a',
  'hljs-strong': '#4a443c',
};

/** 深色板：黑底终端上的高对比荧光色（暗夜终端） */
const PALETTE_DARK: Record<string, string> = {
  'hljs-keyword': '#ff7ab2',
  'hljs-string': '#ffd27a',
  'hljs-title': '#7ad0ff',
  'hljs-title.function_': '#7ad0ff',
  'hljs-title.class_': '#7ad0ff',
  'hljs-number': '#ff9e64',
  'hljs-literal': '#ff9e64',
  'hljs-built_in': '#9eceff',
  'hljs-type': '#9eceff',
  'hljs-attr': '#c0e39a',
  'hljs-attribute': '#c0e39a',
  'hljs-comment': '#6a7a68',
  'hljs-meta': '#7a8a76',
  'hljs-variable': '#7adfae',
  'hljs-params': '#d8ceb8',
  'hljs-symbol': '#ff9e64',
  'hljs-regexp': '#ffd27a',
  'hljs-addition': '#7adfae',
  'hljs-deletion': '#ff7a7a',
  'hljs-selector-tag': '#ff7ab2',
  'hljs-selector-class': '#7ad0ff',
  'hljs-selector-id': '#7ad0ff',
  'hljs-selector-attr': '#c0e39a',
  'hljs-selector-pseudo': '#c0e39a',
  'hljs-tag': '#ffd27a',
  'hljs-name': '#ff7ab2',
  'hljs-operator': '#8a9a88',
  'hljs-bullet': '#ff9e64',
  'hljs-quote': '#6a7a68',
  'hljs-emphasis': '#8a9a88',
  'hljs-strong': '#e6ffe9',
};

/* ---------------- 主题预设 ---------------- */

/** 经典：衬线标题 + 陶土橙强调，克制干净 */
export const classicTheme: Theme = {
  id: 'classic',
  name: '经典',
  description: '衬线标题 + 陶土橙强调，克制干净',
  appearance: 'light',
  mono: MONO,
  body: { font: SANS, fontSize: '16px', lineHeight: '1.75', color: '#2b2b2b' },
  accent: '#d97757',
  heading: {
    font: SERIF,
    fontWeight: '700',
    color: '#1a1a1a',
    lineHeight: '1.4',
    letterSpacing: '0.5px',
    marginTop: '28px',
    marginBottom: '12px',
    decor: 'none',
  },
  headingSizes: { h1: '28px', h2: '24px', h3: '21px', h4: '19px', h5: '17px', h6: '16px' },
  pMargin: '16px',
  quote: {
    background: '#faf6f2',
    color: '#4a4a45',
    borderLeft: '4px solid #d97757',
    borderRadius: '0 6px 6px 0',
    padding: '12px 16px',
    margin: '20px 0',
  },
  callout: {
    background: '#f2efe8',
    color: '#4a4a45',
    borderLeft: '4px solid #d97757',
    borderRadius: '0 10px 10px 0',
    padding: '14px 16px',
    margin: '20px 0',
  },
  code: { background: '#f4f1ec', color: '#26231e', borderRadius: '4px', padding: '2px 5px', fontSize: '0.9em' },
  codeBlock: { background: '#f7f5f0', color: '#2b2823', borderRadius: '6px', padding: '14px 16px', fontSize: '14px', lineHeight: '1.6' },
  link: { color: '#d97757', textDecoration: 'underline' },
  listPaddingLeft: '26px',
  listItemMargin: '6px 0',
  table: { borderColor: '#e5e3dc', headBg: '#f4f1ec', headColor: '#26231e', fontSize: '15px', cellPadding: '8px 12px' },
  hr: { color: '#e5e3dc', margin: '28px 0' },
  img: { borderRadius: '8px', margin: '16px auto' },
  strongColor: 'inherit',
  delColor: '#a6a29a',
  mark: { background: '#fff3c4', color: '#4a3a10', borderRadius: '3px', padding: '1px 4px' },
  footnote: { refColor: '#d97757', blockBorder: '#e5e3dc', textColor: '#8a867e', numColor: '#d97757', textSize: '12px' },
  codePalette: PALETTE_LIGHT,
  codePaletteMode: 'light',
};

/** 浅蓝经典：完整拷贝经典版式，仅把陶土橙主色换为浅蓝 */
export const skyblueTheme: Theme = {
  id: 'skyblue',
  name: '浅蓝经典',
  description: '经典版式 + 浅蓝强调，清爽干净',
  appearance: 'light',
  mono: MONO,
  body: { font: SANS, fontSize: '16px', lineHeight: '1.75', color: '#2b2b2b' },
  accent: '#4a90d9',
  heading: {
    font: SERIF,
    fontWeight: '700',
    color: '#1a1a1a',
    lineHeight: '1.4',
    letterSpacing: '0.5px',
    marginTop: '28px',
    marginBottom: '12px',
    decor: 'none',
  },
  headingSizes: { h1: '28px', h2: '24px', h3: '21px', h4: '19px', h5: '17px', h6: '16px' },
  pMargin: '16px',
  quote: {
    background: '#faf6f2',
    color: '#4a4a45',
    borderLeft: '4px solid #4a90d9',
    borderRadius: '0 6px 6px 0',
    padding: '12px 16px',
    margin: '20px 0',
  },
  callout: {
    background: '#f2efe8',
    color: '#4a4a45',
    borderLeft: '4px solid #4a90d9',
    borderRadius: '0 10px 10px 0',
    padding: '14px 16px',
    margin: '20px 0',
  },
  code: { background: '#f4f1ec', color: '#26231e', borderRadius: '4px', padding: '2px 5px', fontSize: '0.9em' },
  codeBlock: { background: '#f7f5f0', color: '#2b2823', borderRadius: '6px', padding: '14px 16px', fontSize: '14px', lineHeight: '1.6' },
  link: { color: '#4a90d9', textDecoration: 'underline' },
  listPaddingLeft: '26px',
  listItemMargin: '6px 0',
  table: { borderColor: '#e5e3dc', headBg: '#f4f1ec', headColor: '#26231e', fontSize: '15px', cellPadding: '8px 12px' },
  hr: { color: '#e5e3dc', margin: '28px 0' },
  img: { borderRadius: '8px', margin: '16px auto' },
  strongColor: 'inherit',
  delColor: '#a6a29a',
  mark: { background: '#fff3c4', color: '#4a3a10', borderRadius: '3px', padding: '1px 4px' },
  footnote: { refColor: '#4a90d9', blockBorder: '#e5e3dc', textColor: '#8a867e', numColor: '#4a90d9', textSize: '12px' },
  codePalette: PALETTE_LIGHT,
  codePaletteMode: 'light',
};

/** 杂志编辑：绯红强调 + 重磅衬线大标题 + 报刊引语，纸媒编辑部气质 */
export const editorialTheme: Theme = {
  id: 'editorial',
  name: '杂志编辑',
  description: '绯红强调 + 重磅衬线标题 + 报刊引语',
  appearance: 'light',
  mono: MONO,
  body: { font: SANS, fontSize: '16px', lineHeight: '1.9', color: '#22211e' },
  accent: '#c43a2d',
  accentSoft: 'rgba(196,58,45,.09)',
  heading: {
    font: "Georgia, 'Songti SC', 'STSong', serif",
    fontWeight: '800',
    color: '#14120e',
    lineHeight: '1.22',
    letterSpacing: '0.5px',
    marginTop: '40px',
    marginBottom: '16px',
    decor: 'rule',
  },
  headingSizes: { h1: '32px', h2: '27px', h3: '22px', h4: '19px', h5: '17px', h6: '16px' },
  pMargin: '20px',
  quote: {
    background: 'transparent',
    color: '#6b4a3f',
    borderLeft: '3px solid #c43a2d',
    borderRadius: '0',
    padding: '6px 0 6px 20px',
    margin: '26px 0',
    fontStyle: 'italic',
    extra: {
      'font-family': "Georgia, 'Songti SC', serif",
      'font-size': '18px',
      'line-height': '1.8',
    },
  },
  callout: {
    background: 'rgba(196,58,45,.05)',
    color: '#5a463c',
    borderLeft: '3px solid #c43a2d',
    borderRadius: '0',
    padding: '14px 18px',
    margin: '26px 0',
  },
  code: { background: '#f0ece5', color: '#c43a2d', borderRadius: '3px', padding: '1px 5px', fontSize: '0.85em' },
  codeBlock: { background: '#f3efe9', color: '#2a2722', borderRadius: '0', padding: '18px 20px', fontSize: '14px', lineHeight: '1.7' },
  link: { color: '#c43a2d', textDecoration: 'underline' },
  listPaddingLeft: '26px',
  listItemMargin: '8px 0',
  table: { borderColor: '#d9d3c8', headBg: '#14120e', headColor: '#f5f0e6', fontSize: '15px', cellPadding: '9px 12px' },
  hr: { color: '#c43a2d', margin: '32px 0' },
  img: { borderRadius: '0', margin: '20px auto' },
  strongColor: '#c43a2d',
  delColor: '#a39c90',
  mark: { background: '#ffe9a8', color: '#4a3a10', borderRadius: '2px', padding: '1px 4px' },
  footnote: { refColor: '#c43a2d', blockBorder: '#d9d3c8', textColor: '#8a8376', numColor: '#c43a2d', textSize: '12px' },
  codePalette: PALETTE_LIGHT,
  codePaletteMode: 'light',
};

/** 奶油手账：蜂蜜琥珀 + 奶油纸底 + 手账贴纸式卡片引用，手账感 */
export const creamTheme: Theme = {
  id: 'cream',
  name: '奶油手账',
  description: '蜂蜜琥珀 + 奶油纸底 + 贴纸式卡片',
  appearance: 'light',
  mono: MONO,
  body: { font: SANS, fontSize: '16px', lineHeight: '1.9', color: '#54422f', bg: '#fbf3e4' },
  accent: '#e0891a',
  accentSoft: 'rgba(224,137,26,.12)',
  heading: {
    font: "Georgia, 'Songti SC', serif",
    fontWeight: '700',
    color: '#7a4a12',
    lineHeight: '1.35',
    letterSpacing: '0.5px',
    marginTop: '34px',
    marginBottom: '12px',
    decor: 'accent-bar',
  },
  headingSizes: { h1: '28px', h2: '24px', h3: '20px', h4: '18px', h5: '17px', h6: '16px' },
  pMargin: '16px',
  quote: {
    background: '#ffffff',
    color: '#6b553a',
    borderLeft: '5px solid #e0891a',
    borderRadius: '14px',
    padding: '16px 20px',
    margin: '22px 0',
    extra: { 'box-shadow': '0 3px 14px rgba(160,110,40,.12)' },
  },
  callout: {
    background: '#fff9ec',
    color: '#6b553a',
    borderLeft: '5px solid #e0891a',
    borderRadius: '14px',
    padding: '14px 18px',
    margin: '22px 0',
    extra: { 'box-shadow': '0 3px 14px rgba(160,110,40,.10)' },
  },
  code: { background: '#f7e8cd', color: '#a06a15', borderRadius: '6px', padding: '2px 6px', fontSize: '0.88em' },
  codeBlock: {
    background: '#f8ecd6',
    color: '#5a4426',
    borderRadius: '12px',
    padding: '16px 18px',
    fontSize: '14px',
    lineHeight: '1.7',
    extra: { 'box-shadow': 'inset 0 0 0 1px rgba(200,140,40,.18)' },
  },
  link: { color: '#e0891a', textDecoration: 'underline' },
  listPaddingLeft: '26px',
  listItemMargin: '7px 0',
  table: { borderColor: '#ecd9b8', headBg: '#f6e3c0', headColor: '#7a4a12', fontSize: '15px', cellPadding: '9px 12px' },
  hr: { color: '#e8d2a8', margin: '30px 0' },
  img: { borderRadius: '14px', margin: '18px auto' },
  strongColor: '#c97a08',
  delColor: '#b8a183',
  mark: { background: '#ffe9b0', color: '#6a4a10', borderRadius: '4px', padding: '1px 5px' },
  footnote: { refColor: '#e0891a', blockBorder: '#e8d2a8', textColor: '#9a8260', numColor: '#c97a08', textSize: '12px' },
  codePalette: PALETTE_LIGHT,
  codePaletteMode: 'light',
};

/** 暗夜终端：终端绿 + 等宽标题 + 黑底发光代码片，黑客终端气质 */
export const darkTheme: Theme = {
  id: 'dark',
  name: '暗夜终端',
  description: '终端绿 + 等宽标题 + 发光代码片',
  appearance: 'dark',
  mono: MONO,
  body: { font: SANS, fontSize: '16px', lineHeight: '1.85', color: '#c9d4c3', bg: '#0d1117' },
  accent: '#4ade80',
  accentSoft: 'rgba(74,222,128,.12)',
  heading: {
    font: MONO,
    fontWeight: '700',
    color: '#e6ffe9',
    lineHeight: '1.4',
    letterSpacing: '0.5px',
    marginTop: '34px',
    marginBottom: '12px',
    decor: 'accent-bar',
  },
  headingSizes: { h1: '27px', h2: '22px', h3: '19px', h4: '17px', h5: '16px', h6: '15px' },
  pMargin: '16px',
  quote: {
    background: '#11161d',
    color: '#a8b8a3',
    borderLeft: '3px solid #4ade80',
    borderRadius: '0 10px 10px 0',
    padding: '13px 17px',
    margin: '22px 0',
    extra: { 'box-shadow': 'inset 0 0 0 1px rgba(74,222,128,.08)' },
  },
  callout: {
    background: 'rgba(74,222,128,.08)',
    color: '#a8b8a3',
    borderLeft: '3px solid #4ade80',
    borderRadius: '0 10px 10px 0',
    padding: '14px 16px',
    margin: '22px 0',
    extra: { 'box-shadow': 'inset 0 0 0 1px rgba(74,222,128,.10)' },
  },
  code: {
    background: '#0a0e13',
    color: '#4ade80',
    borderRadius: '4px',
    padding: '2px 6px',
    fontSize: '0.88em',
    extra: { border: '1px solid rgba(74,222,128,.22)', 'text-shadow': '0 0 8px rgba(74,222,128,.35)' },
  },
  codeBlock: {
    background: '#080b0f',
    color: '#9fdcae',
    borderRadius: '10px',
    padding: '16px 18px',
    fontSize: '14px',
    lineHeight: '1.7',
    extra: { border: '1px solid rgba(74,222,128,.18)', 'box-shadow': '0 0 24px rgba(74,222,128,.06) inset' },
  },
  link: { color: '#4ade80', textDecoration: 'underline' },
  listPaddingLeft: '26px',
  listItemMargin: '6px 0',
  table: { borderColor: '#1e2a24', headBg: '#111c16', headColor: '#b8f2c6', fontSize: '15px', cellPadding: '8px 12px' },
  hr: { color: '#1e2a24', margin: '30px 0' },
  img: { borderRadius: '10px', margin: '16px auto' },
  strongColor: '#4ade80',
  delColor: '#5c6757',
  mark: { background: 'rgba(74,222,128,.22)', color: '#b8f2c6', borderRadius: '3px', padding: '1px 4px' },
  footnote: { refColor: '#4ade80', blockBorder: '#1e2a24', textColor: '#7c8a77', numColor: '#4ade80', textSize: '12px' },
  codePalette: PALETTE_DARK,
  codePaletteMode: 'dark',
};

/** 静蓝笔记：靛蓝强调 + 冷灰正文，技术文档气质 */
export const indigoTheme: Theme = {
  id: 'indigo',
  name: '静蓝笔记',
  description: '靛蓝强调 + 冷灰正文，技术文档气质',
  appearance: 'light',
  mono: MONO,
  body: { font: SANS, fontSize: '16px', lineHeight: '1.8', color: '#2f3540' },
  accent: '#3f6ecc',
  accentSoft: 'rgba(63,110,204,.10)',
  heading: {
    font: SANS,
    fontWeight: '700',
    color: '#1b2430',
    lineHeight: '1.42',
    letterSpacing: '0.2px',
    marginTop: '30px',
    marginBottom: '13px',
    decor: 'accent-bar',
  },
  headingSizes: { h1: '27px', h2: '23px', h3: '20px', h4: '18px', h5: '17px', h6: '16px' },
  pMargin: '17px',
  quote: {
    background: '#f3f6fc',
    color: '#44505f',
    borderLeft: '3px solid #3f6ecc',
    borderRadius: '0 8px 8px 0',
    padding: '12px 16px',
    margin: '22px 0',
  },
  callout: {
    background: 'rgba(63,110,204,.08)',
    color: '#3a4657',
    borderLeft: '3px solid #3f6ecc',
    borderRadius: '0 10px 10px 0',
    padding: '14px 16px',
    margin: '22px 0',
    badgeColor: '#2f58ad',
  },
  code: { background: '#eef2f9', color: '#2b3648', borderRadius: '4px', padding: '2px 5px', fontSize: '0.9em' },
  codeBlock: { background: '#f5f7fb', color: '#2b3648', borderRadius: '8px', padding: '14px 16px', fontSize: '14px', lineHeight: '1.62' },
  link: { color: '#3f6ecc', textDecoration: 'underline' },
  listPaddingLeft: '26px',
  listItemMargin: '6px 0',
  table: { borderColor: '#dde4ef', headBg: '#eef2f9', headColor: '#2b3648', fontSize: '15px', cellPadding: '8px 12px' },
  hr: { color: '#dde4ef', margin: '30px 0' },
  img: { borderRadius: '8px', margin: '18px auto' },
  strongColor: '#1b2430',
  delColor: '#9aa3b0',
  mark: { background: '#dbe7ff', color: '#22355c', borderRadius: '3px', padding: '1px 4px' },
  footnote: { refColor: '#3f6ecc', blockBorder: '#dde4ef', textColor: '#7d8797', numColor: '#3f6ecc', textSize: '12px' },
  codePalette: PALETTE_LIGHT,
  codePaletteMode: 'light',
};

/** 松墨：墨绿强调 + 宋体标题 + 大留白，东方书卷气 */
export const inkTheme: Theme = {
  id: 'ink',
  name: '松墨',
  description: '墨绿强调 + 宋体标题 + 大留白，书卷气',
  appearance: 'light',
  mono: MONO,
  body: { font: SERIF, fontSize: '16.5px', lineHeight: '1.95', color: '#33352f' },
  accent: '#4a6b52',
  accentSoft: 'rgba(74,107,82,.10)',
  heading: {
    font: SERIF,
    fontWeight: '700',
    color: '#232620',
    lineHeight: '1.5',
    letterSpacing: '1.5px',
    marginTop: '34px',
    marginBottom: '15px',
    decor: 'none',
  },
  headingSizes: { h1: '27px', h2: '23px', h3: '20px', h4: '18px', h5: '17px', h6: '16px' },
  pMargin: '19px',
  quote: {
    background: 'transparent',
    color: '#55584f',
    borderLeft: '2px solid #4a6b52',
    borderRadius: '0',
    padding: '4px 0 4px 18px',
    margin: '26px 0',
    fontStyle: 'italic',
  },
  callout: {
    background: 'rgba(74,107,82,.07)',
    color: '#434639',
    borderLeft: '2px solid #4a6b52',
    borderRadius: '0 8px 8px 0',
    padding: '14px 18px',
    margin: '26px 0',
    badgeColor: '#3d5a44',
  },
  code: { background: '#f0f1ea', color: '#2f322b', borderRadius: '3px', padding: '2px 5px', fontSize: '0.88em' },
  codeBlock: { background: '#f4f5ee', color: '#2f322b', borderRadius: '4px', padding: '15px 17px', fontSize: '13.5px', lineHeight: '1.68' },
  link: { color: '#4a6b52', textDecoration: 'underline' },
  listPaddingLeft: '25px',
  listItemMargin: '8px 0',
  table: { borderColor: '#e0e1d8', headBg: '#f0f1ea', headColor: '#2f322b', fontSize: '15px', cellPadding: '9px 13px' },
  hr: { color: '#dcded3', margin: '34px 0' },
  img: { borderRadius: '2px', margin: '20px auto' },
  strongColor: '#232620',
  delColor: '#a3a59b',
  mark: { background: '#e6ecd9', color: '#333720', borderRadius: '2px', padding: '1px 4px' },
  footnote: { refColor: '#4a6b52', blockBorder: '#dcdede', textColor: '#847f76', numColor: '#4a6b52', textSize: '12px' },
  codePalette: PALETTE_LIGHT,
  codePaletteMode: 'light',
};

/** 樱雪：柔粉强调 + 圆润卡片，轻盈少女感 */
export const sakuraTheme: Theme = {
  id: 'sakura',
  name: '樱雪',
  description: '柔粉强调 + 圆润卡片，轻盈通透',
  appearance: 'light',
  mono: MONO,
  body: { font: SANS, fontSize: '16px', lineHeight: '1.85', color: '#4a3f45', bg: '#fffafc' },
  accent: '#d9628a',
  accentSoft: 'rgba(217,98,138,.10)',
  heading: {
    font: SANS,
    fontWeight: '700',
    color: '#3d2f36',
    lineHeight: '1.45',
    letterSpacing: '0.3px',
    marginTop: '30px',
    marginBottom: '13px',
    decor: 'band',
  },
  headingSizes: { h1: '27px', h2: '23px', h3: '20px', h4: '18px', h5: '17px', h6: '16px' },
  pMargin: '17px',
  quote: {
    background: '#fdeef4',
    color: '#5a4a52',
    borderLeft: 'none',
    borderRadius: '12px',
    padding: '14px 18px',
    margin: '22px 0',
  },
  callout: {
    background: '#fce8f0',
    color: '#59444e',
    borderLeft: 'none',
    borderRadius: '14px',
    padding: '15px 18px',
    margin: '22px 0',
    badgeColor: '#c14a76',
  },
  code: { background: '#fbeaf1', color: '#6d3b50', borderRadius: '5px', padding: '2px 6px', fontSize: '0.9em' },
  codeBlock: { background: '#fdf2f6', color: '#4a3540', borderRadius: '12px', padding: '15px 17px', fontSize: '14px', lineHeight: '1.62' },
  link: { color: '#d9628a', textDecoration: 'underline' },
  listPaddingLeft: '26px',
  listItemMargin: '7px 0',
  table: { borderColor: '#f3dae4', headBg: '#fceaf2', headColor: '#5c3f4c', fontSize: '15px', cellPadding: '8px 12px' },
  hr: { color: '#f3dae4', margin: '30px 0' },
  img: { borderRadius: '14px', margin: '18px auto' },
  strongColor: '#c14a76',
  delColor: '#b9a8af',
  mark: { background: '#ffe0ec', color: '#7a2f4d', borderRadius: '4px', padding: '1px 5px' },
  footnote: { refColor: '#d9628a', blockBorder: '#f3dae4', textColor: '#95848c', numColor: '#d9628a', textSize: '12px' },
  codePalette: PALETTE_LIGHT,
  codePaletteMode: 'light',
};

/** 极简灰：无强调装饰 + 中性灰阶，纯粹排版 */
export const minimalTheme: Theme = {
  id: 'minimal',
  name: '极简灰',
  description: '中性灰阶 + 零装饰，只剩排版本身',
  appearance: 'light',
  mono: MONO,
  body: { font: SANS, fontSize: '16px', lineHeight: '1.8', color: '#3a3a3a' },
  accent: '#5c5c5c',
  accentSoft: 'rgba(92,92,92,.08)',
  heading: {
    font: SANS,
    fontWeight: '600',
    color: '#171717',
    lineHeight: '1.4',
    letterSpacing: '-0.2px',
    marginTop: '32px',
    marginBottom: '12px',
    decor: 'none',
  },
  headingSizes: { h1: '26px', h2: '22px', h3: '19px', h4: '17px', h5: '16px', h6: '15px' },
  pMargin: '16px',
  quote: {
    background: 'transparent',
    color: '#5c5c5c',
    borderLeft: '3px solid #d4d4d4',
    borderRadius: '0',
    padding: '2px 0 2px 16px',
    margin: '22px 0',
  },
  callout: {
    background: '#f5f5f5',
    color: '#454545',
    borderLeft: '3px solid #a3a3a3',
    borderRadius: '0 6px 6px 0',
    padding: '13px 16px',
    margin: '22px 0',
    badgeColor: '#262626',
  },
  code: { background: '#f0f0f0', color: '#262626', borderRadius: '3px', padding: '2px 5px', fontSize: '0.9em' },
  codeBlock: { background: '#fafafa', color: '#292929', borderRadius: '6px', padding: '14px 16px', fontSize: '13.5px', lineHeight: '1.62', extra: { border: '1px solid #ebebeb' } },
  link: { color: '#171717', textDecoration: 'underline' },
  listPaddingLeft: '25px',
  listItemMargin: '6px 0',
  table: { borderColor: '#e0e0e0', headBg: '#f5f5f5', headColor: '#262626', fontSize: '15px', cellPadding: '8px 12px' },
  hr: { color: '#e0e0e0', margin: '32px 0' },
  img: { borderRadius: '4px', margin: '18px auto' },
  strongColor: '#171717',
  delColor: '#a3a3a3',
  mark: { background: '#ececec', color: '#171717', borderRadius: '2px', padding: '1px 4px' },
  footnote: { refColor: '#5c5c5c', blockBorder: '#e0e0e0', textColor: '#8a8a8a', numColor: '#5c5c5c', textSize: '12px' },
  codePalette: PALETTE_LIGHT,
  codePaletteMode: 'light',
};

/** 复古打字机：等宽正文 + 牛皮纸底，打字稿气质 */
export const typewriterTheme: Theme = {
  id: 'typewriter',
  name: '打字机',
  description: '等宽正文 + 牛皮纸底，打字稿气质',
  appearance: 'light',
  mono: MONO,
  body: { font: MONO, fontSize: '15px', lineHeight: '1.85', color: '#3c352b', bg: '#f7f2e7' },
  accent: '#8a5a2b',
  accentSoft: 'rgba(138,90,43,.10)',
  heading: {
    font: MONO,
    fontWeight: '700',
    color: '#2b2519',
    lineHeight: '1.4',
    letterSpacing: '0.6px',
    marginTop: '30px',
    marginBottom: '13px',
    decor: 'rule',
  },
  headingSizes: { h1: '24px', h2: '21px', h3: '18px', h4: '17px', h5: '16px', h6: '15px' },
  pMargin: '17px',
  quote: {
    background: 'rgba(138,90,43,.06)',
    color: '#4d4436',
    borderLeft: '3px double #8a5a2b',
    borderRadius: '0',
    padding: '12px 16px',
    margin: '22px 0',
  },
  callout: {
    background: 'rgba(138,90,43,.09)',
    color: '#463d2f',
    borderLeft: '3px double #8a5a2b',
    borderRadius: '0',
    padding: '14px 16px',
    margin: '22px 0',
    badgeColor: '#75471f',
  },
  code: { background: '#ece3d1', color: '#3a3226', borderRadius: '2px', padding: '2px 5px', fontSize: '0.92em' },
  codeBlock: { background: '#efe7d6', color: '#39311f', borderRadius: '2px', padding: '14px 16px', fontSize: '13px', lineHeight: '1.65', extra: { border: '1px dashed #c9b795' } },
  link: { color: '#8a5a2b', textDecoration: 'underline' },
  listPaddingLeft: '24px',
  listItemMargin: '6px 0',
  table: { borderColor: '#d8c9a9', headBg: '#ece3d1', headColor: '#39311f', fontSize: '14px', cellPadding: '8px 12px' },
  hr: { color: '#d8c9a9', margin: '30px 0' },
  img: { borderRadius: '2px', margin: '18px auto' },
  strongColor: '#2b2519',
  delColor: '#a3977f',
  mark: { background: '#e8d79f', color: '#453718', borderRadius: '2px', padding: '1px 4px' },
  footnote: { refColor: '#8a5a2b', blockBorder: '#d8c9a9', textColor: '#867a63', numColor: '#8a5a2b', textSize: '12px' },
  codePalette: PALETTE_LIGHT,
  codePaletteMode: 'light',
};

/** 午夜靛：深靛蓝底 + 青蓝强调，暗色阅读但不刺眼 */
export const midnightTheme: Theme = {
  id: 'midnight',
  name: '午夜靛',
  description: '深靛底 + 青蓝强调，暗色长读不刺眼',
  appearance: 'dark',
  mono: MONO,
  body: { font: SANS, fontSize: '16px', lineHeight: '1.85', color: '#c3cbd9', bg: '#161b26' },
  accent: '#61b6f2',
  accentSoft: 'rgba(97,182,242,.13)',
  heading: {
    font: SANS,
    fontWeight: '700',
    color: '#eaf1fb',
    lineHeight: '1.42',
    letterSpacing: '0.2px',
    marginTop: '30px',
    marginBottom: '13px',
    decor: 'accent-bar',
  },
  headingSizes: { h1: '27px', h2: '23px', h3: '20px', h4: '18px', h5: '17px', h6: '16px' },
  pMargin: '17px',
  quote: {
    background: 'rgba(97,182,242,.07)',
    color: '#aab6c8',
    borderLeft: '3px solid #61b6f2',
    borderRadius: '0 8px 8px 0',
    padding: '12px 16px',
    margin: '22px 0',
  },
  callout: {
    background: 'rgba(97,182,242,.12)',
    color: '#c3cbd9',
    borderLeft: '3px solid #61b6f2',
    borderRadius: '0 10px 10px 0',
    padding: '14px 16px',
    margin: '22px 0',
    badgeColor: '#8fd0ff',
  },
  code: { background: 'rgba(255,255,255,.08)', color: '#d8e3f2', borderRadius: '4px', padding: '2px 5px', fontSize: '0.9em' },
  codeBlock: { background: '#0f131c', color: '#d3dcea', borderRadius: '8px', padding: '15px 17px', fontSize: '13.5px', lineHeight: '1.65', extra: { border: '1px solid rgba(255,255,255,.07)' } },
  link: { color: '#61b6f2', textDecoration: 'underline' },
  listPaddingLeft: '26px',
  listItemMargin: '6px 0',
  table: { borderColor: 'rgba(255,255,255,.12)', headBg: 'rgba(255,255,255,.06)', headColor: '#eaf1fb', fontSize: '15px', cellPadding: '8px 12px' },
  hr: { color: 'rgba(255,255,255,.12)', margin: '30px 0' },
  img: { borderRadius: '8px', margin: '18px auto' },
  strongColor: '#eaf1fb',
  delColor: '#6d7688',
  mark: { background: 'rgba(97,182,242,.25)', color: '#eaf1fb', borderRadius: '3px', padding: '1px 4px' },
  footnote: { refColor: '#61b6f2', blockBorder: 'rgba(255,255,255,.12)', textColor: '#8b95a6', numColor: '#61b6f2', textSize: '12px' },
  codePalette: PALETTE_DARK,
  codePaletteMode: 'dark',
};

/** 石墨：中性暖黑 + 琥珀强调，长时间夜间写作不刺眼 */
export const graphiteTheme: Theme = {
  id: 'graphite',
  name: '石墨',
  description: '中性暖黑 + 琥珀强调，沉稳耐看',
  appearance: 'dark',
  mono: MONO,
  body: { font: SANS, fontSize: '16px', lineHeight: '1.85', color: '#d2cec6', bg: '#1c1c1e' },
  accent: '#e8a33d',
  accentSoft: 'rgba(232,163,61,.13)',
  heading: {
    font: SANS,
    fontWeight: '700',
    color: '#f5f2ec',
    lineHeight: '1.42',
    letterSpacing: '0.2px',
    marginTop: '30px',
    marginBottom: '13px',
    decor: 'accent-bar',
  },
  headingSizes: { h1: '27px', h2: '23px', h3: '20px', h4: '18px', h5: '17px', h6: '16px' },
  pMargin: '17px',
  quote: {
    background: 'rgba(232,163,61,.07)',
    color: '#bab5ab',
    borderLeft: '3px solid #e8a33d',
    borderRadius: '0 8px 8px 0',
    padding: '12px 16px',
    margin: '22px 0',
  },
  callout: {
    background: 'rgba(232,163,61,.12)',
    color: '#d2cec6',
    borderLeft: '3px solid #e8a33d',
    borderRadius: '0 10px 10px 0',
    padding: '14px 16px',
    margin: '22px 0',
    badgeColor: '#f0bc6e',
  },
  code: { background: 'rgba(255,255,255,.08)', color: '#e6e1d8', borderRadius: '4px', padding: '2px 5px', fontSize: '0.9em' },
  codeBlock: { background: '#141416', color: '#ddd8ce', borderRadius: '8px', padding: '15px 17px', fontSize: '13.5px', lineHeight: '1.65', extra: { border: '1px solid rgba(255,255,255,.07)' } },
  link: { color: '#e8a33d', textDecoration: 'underline' },
  listPaddingLeft: '26px',
  listItemMargin: '6px 0',
  table: { borderColor: 'rgba(255,255,255,.12)', headBg: 'rgba(255,255,255,.06)', headColor: '#f5f2ec', fontSize: '15px', cellPadding: '8px 12px' },
  hr: { color: 'rgba(255,255,255,.12)', margin: '30px 0' },
  img: { borderRadius: '8px', margin: '18px auto' },
  strongColor: '#f5f2ec',
  delColor: '#7d786f',
  mark: { background: 'rgba(232,163,61,.25)', color: '#f5f2ec', borderRadius: '3px', padding: '1px 4px' },
  footnote: { refColor: '#e8a33d', blockBorder: 'rgba(255,255,255,.12)', textColor: '#969085', numColor: '#e8a33d', textSize: '12px' },
  codePalette: PALETTE_DARK,
  codePaletteMode: 'dark',
};

/** 夜樱：紫黑纸底 + 樱粉强调 + 衬线标题，暗色里的文艺一挂 */
export const nightSakuraTheme: Theme = {
  id: 'night-sakura',
  name: '夜樱',
  description: '紫黑底 + 樱粉强调 + 衬线标题',
  appearance: 'dark',
  mono: MONO,
  body: { font: SANS, fontSize: '16px', lineHeight: '1.9', color: '#d3c8d6', bg: '#1a1520' },
  accent: '#e07a9f',
  accentSoft: 'rgba(224,122,159,.13)',
  heading: {
    font: SERIF,
    fontWeight: '700',
    color: '#f6ecf2',
    lineHeight: '1.45',
    letterSpacing: '0.6px',
    marginTop: '32px',
    marginBottom: '14px',
    decor: 'underline',
  },
  headingSizes: { h1: '27px', h2: '23px', h3: '20px', h4: '18px', h5: '17px', h6: '16px' },
  pMargin: '18px',
  quote: {
    background: 'rgba(224,122,159,.07)',
    color: '#bcb0c0',
    borderLeft: '3px solid #e07a9f',
    borderRadius: '0 8px 8px 0',
    padding: '12px 16px',
    margin: '24px 0',
    fontStyle: 'italic',
  },
  callout: {
    background: 'rgba(224,122,159,.12)',
    color: '#d3c8d6',
    borderLeft: '3px solid #e07a9f',
    borderRadius: '0 10px 10px 0',
    padding: '14px 16px',
    margin: '24px 0',
    badgeColor: '#f0a3bf',
  },
  code: { background: 'rgba(255,255,255,.08)', color: '#ecdfe6', borderRadius: '4px', padding: '2px 5px', fontSize: '0.9em' },
  codeBlock: { background: '#130f18', color: '#ddd2e0', borderRadius: '8px', padding: '15px 17px', fontSize: '13.5px', lineHeight: '1.65', extra: { border: '1px solid rgba(255,255,255,.07)' } },
  link: { color: '#e07a9f', textDecoration: 'underline' },
  listPaddingLeft: '26px',
  listItemMargin: '7px 0',
  table: { borderColor: 'rgba(255,255,255,.12)', headBg: 'rgba(255,255,255,.06)', headColor: '#f6ecf2', fontSize: '15px', cellPadding: '8px 12px' },
  hr: { color: 'rgba(255,255,255,.12)', margin: '32px 0' },
  img: { borderRadius: '10px', margin: '18px auto' },
  strongColor: '#f6ecf2',
  delColor: '#8a7f8d',
  mark: { background: 'rgba(224,122,159,.25)', color: '#f6ecf2', borderRadius: '3px', padding: '1px 4px' },
  footnote: { refColor: '#e07a9f', blockBorder: 'rgba(255,255,255,.12)', textColor: '#9a8fa0', numColor: '#e07a9f', textSize: '12px' },
  codePalette: PALETTE_DARK,
  codePaletteMode: 'dark',
};

export const themes: Theme[] = [
  classicTheme,
  minimalTheme,
  editorialTheme,
  inkTheme,
  creamTheme,
  sakuraTheme,
  typewriterTheme,
  indigoTheme,
  skyblueTheme,
  darkTheme,
  midnightTheme,
  graphiteTheme,
  nightSakuraTheme,
];

/** 按 id 取主题，找不到回退经典 */
/** 浅色 / 深色分组（主题栏分区展示，深色排在后面需要滚动才看到） */
export const lightThemes: Theme[] = themes.filter((t) => t.appearance === 'light');
export const darkThemes: Theme[] = themes.filter((t) => t.appearance === 'dark');

export function getTheme(id?: string): Theme {
  return themes.find((t) => t.id === id) ?? classicTheme;
}

/* ---------------- 密度缩放（字号/行高/间距） ---------------- */

export interface DensityScale {
  /** 字号倍率 */
  font: number;
  /** 行高倍率（body 与标题） */
  line: number;
  /** 垂直间距倍率（段距 / 标题边距 / 引用边距等） */
  margin: number;
}

/** 把字符串里所有 px 数值乘以 k（0 值不受影响） */
const px = (v: string, k: number) =>
  v.replace(/-?\d+(\.\d+)?(?=px)/g, (m) => `${(parseFloat(m) * k).toFixed(2).replace(/\.?0+$/, '')}`);

/** 按密度倍率生成一份缩放后的主题（不修改原对象） */
export function applyDensity(th: Theme, d: DensityScale): Theme {
  const f = d.font;
  const m = f * d.margin;
  return {
    ...th,
    body: {
      ...th.body,
      fontSize: px(th.body.fontSize, f),
      lineHeight: `${parseFloat(th.body.lineHeight) * d.line}`,
    },
    pMargin: px(th.pMargin, m),
    heading: {
      ...th.heading,
      lineHeight: `${parseFloat(th.heading.lineHeight) * d.line}`,
      marginTop: px(th.heading.marginTop, m),
      marginBottom: px(th.heading.marginBottom, m),
    },
    headingSizes: Object.fromEntries(
      Object.entries(th.headingSizes).map(([k, v]) => [k, px(v, f)]),
    ) as Theme['headingSizes'],
    quote: { ...th.quote, margin: px(th.quote.margin, m) },
    callout: { ...th.callout, margin: px(th.callout.margin, m) },
    hr: { ...th.hr, margin: px(th.hr.margin, m) },
    img: { ...th.img, margin: px(th.img.margin, m) },
    footnote: { ...th.footnote, textSize: px(th.footnote.textSize, f) },
    listItemMargin: px(th.listItemMargin, m),
    table: { ...th.table, fontSize: px(th.table.fontSize, f) },
  };
}

/**
 * 排版密度档位。
 * 「标准」是恒等变换 —— 各主题自己调好的字号/行高/间距就是设计基准，
 * 紧凑与宽松只在它两侧偏移，这样切主题不会因为密度默认值而走样。
 */
export const DENSITIES: { id: string; name: string; scale: DensityScale }[] = [
  { id: 'compact', name: '紧凑', scale: { font: 0.92, line: 0.94, margin: 0.78 } },
  { id: 'standard', name: '标准', scale: { font: 1, line: 1, margin: 1 } },
  { id: 'roomy', name: '宽松', scale: { font: 1.08, line: 1.06, margin: 1.22 } },
];

export function getDensity(id?: string): DensityScale {
  return (DENSITIES.find((d) => d.id === id) ?? DENSITIES[1]).scale;
}

/** 把样式对象拼成 style 字符串：{ color:'red' } → 'color:red;' */
export function st(styles: Record<string, string | number>): string {
  // 渲染热点：整篇文章每个元素都会调一次，避免 Object.entries + map + join 的中间数组
  let out = '';
  for (const k in styles) {
    if (out) out += ';';
    out += k;
    out += ':';
    out += styles[k];
  }
  return out;
}
