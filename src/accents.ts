/**
 * 界面配色（外壳），与 src/theme.ts 的文章主题**完全无关**：
 *
 * - theme.ts 决定「粘贴到公众号后长什么样」，产出的是内联样式
 * - 这里决定「工作台自己长什么样」，产出的是 CSS 变量
 *
 * 取色依据（避免拍脑袋定色值）：
 * - 明度与用途对应关系参考 Radix Colors 的 12 级语义色阶 —— step 9/10 适合实心按钮底、
 *   step 3 适合极浅的 hover 底；这里按同样思路给每个色相配 accent / strong / soft 三档
 * - 深浅衍生方式参考 Ant Design 系统级色板（主色 + 加深一档 + 极浅底）
 * - 色相与命名取自中国传统色（中国色 zhongguose.com / 中国传统色卡），
 *   保证在暖纸底上有国风质感，而不是通用的 Material 蓝
 *
 * 每个色相都必须过一关：主色块上放白色文字（顶栏「复制到公众号」按钮）要看得清，
 * 所以浅底配色统一压在中等明度，不用饱和度过高的亮色。
 *
 * 画布与面板跟着换色相，但**明度保持一致**（浅色档都落在 0.87 上下）——
 * 只改冷暖、不改深浅，切换时不会觉得亮暗跳了一下。
 *
 * 另有两档是亮度模式而非色相：白天（纯白画布）/ 黑夜（深蓝画布）。
 * 深色下主色要反过来用亮色（深蓝底上压深色按钮等于看不见），
 * 所以主色块上的文字色 onAccent 也跟着模式走。
 */

export type AccentMode = 'light' | 'dark';

export interface Accent {
  id: string;
  name: string;
  /** 菜单里的说明 */
  description: string;
  /** 亮度模式：决定中性色、阴影、噪点那一整套 */
  mode: AccentMode;
  /** 主色：实心按钮底、图标、激活态描边 */
  accent: string;
  /** 深一档：hover / 按下 */
  strong: string;
  /** 极浅底：下拉 hover 背景、柔和高亮（深色模式下反过来是很深的一档） */
  soft: string;
  /** 画布底色（最底层，两团氛围光压在它上面） */
  bg: string;
  /** 画布右上角氛围光 */
  glow1: string;
  /** 画布左下角氛围光 */
  glow2: string;
  /** 面板（毛玻璃半透明），色相随主色走 */
  panel: string;
  /** 面板不透明态（下拉菜单、卡片底） */
  panelSolid: string;
  /** 描边与浅底共用的"墨"色相（rgb 三元组，不带 rgb() 包裹），冷色系要换成冷墨 */
  tint: string;
  /**
   * 菜单与触发按钮里那颗色点。默认用主色，但深色模式要另填 ——
   * 深色底上的主色是亮蓝，拿它当色点会让人以为这是「浅蓝」而不是「黑夜」。
   */
  swatch?: string;
}

/** 同一亮度模式下共用的一套中性色与材质；个别配色要改可再加字段覆盖 */
export interface ModeDefaults {
  ink: string;
  muted: string;
  faint: string;
  /** 噪点层不透明度：深色底上要压低，否则整屏发灰 */
  noise: string;
  shadowSm: string;
  shadowLg: string;
  /** 浮层（下拉菜单）投影 */
  shadowPop: string;
  /** 普通按钮底色 */
  btnBg: string;
  /** 主色块上的文字色：浅底配白字，深色底上的亮主色要配深字 */
  onAccent: string;
  /** 警示文字色（接近/超出字数、未引用图片） */
  warn: string;
  /** 危险文字色（超出 2 万字上限） */
  danger: string;
}

export const MODE_DEFAULTS: Record<AccentMode, ModeDefaults> = {
  light: {
    ink: '#34302a',
    muted: '#8a857a',
    faint: '#b0ab9f',
    noise: '0.5',
    shadowSm: '0 1px 2px rgba(52, 40, 28, 0.06)',
    shadowLg: '0 24px 64px rgba(52, 40, 28, 0.14), 0 2px 8px rgba(52, 40, 28, 0.05)',
    shadowPop: '0 12px 32px rgba(45, 40, 30, 0.14)',
    btnBg: 'rgba(255, 253, 250, 0.7)',
    onAccent: '#ffffff',
    warn: '#a8700c',
    danger: '#b3402f',
  },
  dark: {
    ink: '#dfe4ee',
    muted: '#98a2b3',
    faint: '#6b7688',
    noise: '0.26',
    shadowSm: '0 1px 2px rgba(0, 0, 0, 0.4)',
    shadowLg: '0 24px 64px rgba(0, 0, 0, 0.5), 0 2px 8px rgba(0, 0, 0, 0.3)',
    shadowPop: '0 12px 32px rgba(0, 0, 0, 0.55)',
    btnBg: 'rgba(38, 47, 66, 0.7)',
    onAccent: '#0f141f',
    warn: '#e0a53a',
    danger: '#f08b7a',
  },
};

export const ACCENTS: Accent[] = [
  {
    id: 'day',
    name: '白天',
    description: '纯白画布，中性灰阶',
    mode: 'light',
    accent: '#3f6ecc',
    strong: '#335ba8',
    soft: '#e9eefb',
    bg: '#ffffff',
    glow1: '#eff3fb',
    glow2: '#f5f7fa',
    panel: 'rgba(255, 255, 255, 0.86)',
    panelSolid: '#ffffff',
    tint: '40, 48, 60',
  },
  {
    id: 'night',
    name: '黑夜',
    description: '深蓝画布，长读不刺眼',
    mode: 'dark',
    accent: '#6ea8fe',
    strong: '#8bbcfd',
    soft: '#1b2740',
    bg: '#0f141f',
    glow1: '#17243a',
    glow2: '#131a28',
    panel: 'rgba(23, 30, 44, 0.82)',
    panelSolid: '#171e2c',
    tint: '170, 186, 205',
    // 色点用深色而不是主色的亮蓝：色点要回答"这档看起来是亮还是暗"
    swatch: '#151b26',
  },
  {
    id: 'terracotta',
    name: '陶土',
    description: '暖纸原配，陶土橙',
    mode: 'light',
    accent: '#d97757',
    strong: '#c76545',
    soft: '#f9eee7',
    bg: '#f3f0ea',
    glow1: '#f3e6dc',
    glow2: '#eae8e0',
    panel: 'rgba(255, 253, 250, 0.82)',
    panelSolid: '#fffdfa',
    tint: '60, 54, 44',
  },
  {
    id: 'crimson',
    name: '绯红',
    description: '胭脂一脉，暖调不艳',
    mode: 'light',
    accent: '#c2453d',
    strong: '#a5362f',
    soft: '#f9eae8',
    bg: '#f4ecea',
    glow1: '#f5e2df',
    glow2: '#ece1df',
    panel: 'rgba(255, 251, 250, 0.82)',
    panelSolid: '#fffbf9',
    tint: '62, 50, 48',
  },
  {
    id: 'amber',
    name: '琥珀',
    description: '秋日蜜色，沉稳不跳',
    mode: 'light',
    accent: '#b8801a',
    strong: '#9a6812',
    soft: '#faf0dc',
    bg: '#f4f0e5',
    glow1: '#f7ecd6',
    glow2: '#ebe6da',
    panel: 'rgba(255, 253, 246, 0.82)',
    panelSolid: '#fffdf5',
    tint: '58, 52, 38',
  },
  {
    id: 'pine',
    name: '竹青',
    description: '松竹绿，冷而不寒',
    mode: 'light',
    accent: '#4d7c5f',
    strong: '#3d6449',
    soft: '#e9f1eb',
    bg: '#ecf0ec',
    glow1: '#dfeade',
    glow2: '#e4eae4',
    panel: 'rgba(250, 253, 251, 0.82)',
    panelSolid: '#fbfdfb',
    tint: '44, 56, 48',
  },
  {
    id: 'celadon',
    name: '青瓷',
    description: '青瓷釉色，清透',
    mode: 'light',
    accent: '#2f8f83',
    strong: '#247a70',
    soft: '#e5f1ef',
    bg: '#eaf1ef',
    glow1: '#dbe9e6',
    glow2: '#e2e9e6',
    panel: 'rgba(249, 253, 252, 0.82)',
    panelSolid: '#fafdfc',
    tint: '40, 56, 54',
  },
  {
    id: 'indigo',
    name: '靛蓝',
    description: '靛缸染就，偏冷',
    mode: 'light',
    accent: '#3f6ecc',
    strong: '#335ba8',
    soft: '#e9eefb',
    bg: '#edf0f6',
    glow1: '#dfe5f3',
    glow2: '#e4e7ee',
    panel: 'rgba(250, 251, 254, 0.82)',
    panelSolid: '#fbfcfe',
    tint: '44, 52, 66',
  },
  {
    id: 'violet',
    name: '黛紫',
    description: '黛色带紫，文气',
    mode: 'light',
    accent: '#7c5cbf',
    strong: '#66499f',
    soft: '#f0ebfa',
    bg: '#f0edf5',
    glow1: '#e7e1f2',
    glow2: '#e7e5ea',
    panel: 'rgba(252, 251, 254, 0.82)',
    panelSolid: '#fcfbfe',
    tint: '54, 48, 66',
  },
  {
    id: 'graphite',
    name: '石墨',
    description: '中性灰阶，零色相',
    mode: 'light',
    accent: '#5c5c5c',
    strong: '#464646',
    soft: '#ececec',
    bg: '#f1f1f0',
    glow1: '#e7e7e6',
    glow2: '#e5e5e4',
    panel: 'rgba(253, 253, 252, 0.82)',
    panelSolid: '#fdfdfc',
    tint: '52, 52, 52',
  },
];

export const DEFAULT_ACCENT_ID = 'day';

/** 找不到（旧值 / 手改坏了）就退回默认色，不要让界面掉进无强调色的状态 */
export function getAccent(id: string): Accent {
  return ACCENTS.find((a) => a.id === id) ?? ACCENTS[0];
}

/** 菜单与触发按钮里的色点颜色（深色模式有自己的色点，见 Accent.swatch） */
export function accentSwatch(a: Accent): string {
  return a.swatch ?? a.accent;
}
