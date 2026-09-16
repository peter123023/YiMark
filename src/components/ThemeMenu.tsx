import { DENSITIES, darkThemes, lightThemes, type Theme } from '../theme';

interface Props {
  themeId: string;
  onThemeChange: (id: string) => void;
  /** 排版密度档位 id（见 theme.ts 的 DENSITIES） */
  densityId: string;
  onDensityChange: (id: string) => void;
}

/**
 * 顶栏「主题」下拉的内容（开关与定位由 Toolbar 负责）。
 *
 * 每张卡片是用该主题自己的令牌画出来的迷你纸样 —— 纸底、衬线/等宽的「Aa」、
 * 强调色短条、两根正文线。比一个只有名字的下拉更直观：不用切换就能看出风格差异。
 *
 * 浅色与深色分区：深色卡片视觉重量大，混在浅色里会显得突兀，单独归到「深色」小节。
 *
 * 选主题 / 换密度都不关闭菜单 —— 预览是实时变的，留着方便来回比对。
 */
export default function ThemeMenu({ themeId, onThemeChange, densityId, onDensityChange }: Props) {
  const renderCard = (th: Theme) => {
    const active = th.id === themeId;
    return (
      <button
        key={th.id}
        role="radio"
        aria-checked={active}
        className={`theme-card ${active ? 'active' : ''}`}
        title={`${th.name} — ${th.description}`}
        onClick={() => onThemeChange(th.id)}
      >
        <span className="swatch" style={{ background: th.body.bg ?? '#ffffff' }}>
          <span className="swatch-aa" style={{ fontFamily: th.heading.font, color: th.heading.color }}>
            Aa
          </span>
          <span className="swatch-bar" style={{ background: th.accent }} />
          <span className="swatch-line" style={{ background: th.body.color }} />
          <span className="swatch-line short" style={{ background: th.body.color }} />
        </span>
        <span className="theme-card-name">{th.name}</span>
      </button>
    );
  };

  return (
    <div className="theme-menu">
      <div className="menu-section-label">浅色</div>
      <div className="theme-grid" role="radiogroup" aria-label="浅色主题">
        {lightThemes.map(renderCard)}
      </div>

      <div className="menu-section-label">深色</div>
      <div className="theme-grid" role="radiogroup" aria-label="深色主题">
        {darkThemes.map(renderCard)}
      </div>

      {/* 密度：同一套主题下的字号 / 行距 / 段距整体缩放，「标准」即主题原设计值 */}
      <div className="theme-menu-foot">
        <div className="menu-section-label">密度</div>
        <div className="density-group row" role="radiogroup" aria-label="排版密度">
          {DENSITIES.map((d) => (
            <button
              key={d.id}
              role="radio"
              aria-checked={densityId === d.id}
              className={`density-btn ${densityId === d.id ? 'active' : ''}`}
              onClick={() => onDensityChange(d.id)}
            >
              {d.name}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
