import { Check } from '@phosphor-icons/react';
import { ACCENTS, accentSwatch } from '../accents';

interface Props {
  /** 当前界面配色 id（见 accents.ts） */
  accentId: string;
  onAccentChange: (id: string) => void;
}

/**
 * 顶栏「界面配色」下拉的内容（开关与定位由 Toolbar 负责）。
 *
 * 换的是工作台自己的强调色 —— 按钮、图标、激活态、画布氛围光。
 * 文章排版主题在隔壁「主题」下拉里，两套互不干涉。
 */
export default function AccentMenu({ accentId, onAccentChange }: Props) {
  return (
    <>
      {ACCENTS.map((a) => {
        const active = a.id === accentId;
        return (
          <button
            key={a.id}
            role="menuitemradio"
            aria-checked={active}
            className={`accent-item ${active ? 'active' : ''}`}
            title={a.description}
            onClick={() => onAccentChange(a.id)}
          >
            <span className="accent-dot" style={{ background: accentSwatch(a) }} />
            {a.name}
            {active && <Check size={13} weight="bold" className="accent-check" />}
          </button>
        );
      })}
    </>
  );
}
