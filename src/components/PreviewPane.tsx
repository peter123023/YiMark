import { useEffect, useMemo, useRef, useState } from 'react';
import { BatteryFull, CellSignalFull, WifiHigh } from '@phosphor-icons/react';
import { extractTitle, stripFirstH1 } from '../markdown';
import type { ScrollSyncChannel } from '../scrollSync';
import type { Theme } from '../theme';

interface Props {
  body: string;
  theme: Theme;
  /** 草稿名（文件树里显示的名字），作为文章标题的第一来源 */
  name: string;
  /** Whether the body contains images (shows the WeChat paste notice) */
  hasImage: boolean;
  /**
   * Layout-change signal (editor width and mode switching both change it):
   * a backstop for the ResizeObserver — dragging the splitter or switching
   * between side-by-side and preview forces the stage to be re-measured.
   */
  resizeKey: string;
  /** Scroll-sync channel (the editor publishes, this subscribes and writes DOM) */
  sync: ScrollSyncChannel;
}

interface Anchor {
  line: number;
  top: number;
}

/** Tail blend range: the last stretch of editor travel used to converge
 *  smoothly onto the bottom of the preview */
const TAIL_BLEND = 0.18;

/**
 * What the preview is drawn as — always exactly what was picked, whatever the
 * pane's width:
 * - iphone: the phone frame
 * - duo: iPhone Duo lying open, outside up, as in Apple's photos — back half
 *   on the left, outer screen (the article) on the right
 * - duo-open: the Duo's inner screen, held landscape
 * - desktop: a macOS window, for judging the wide measure
 */
type PreviewDevice = 'iphone' | 'duo' | 'duo-open' | 'desktop';
type DuoView = 'duo' | 'duo-open';

const DEVICES: { id: PreviewDevice; name: string; hint: string }[] = [
  { id: 'iphone', name: 'iPhone', hint: 'iPhone 竖屏' },
  {
    id: 'duo',
    name: 'Duo 外屏',
    hint: 'iPhone Duo 摊开、外侧朝上：左边背壳，右边外屏（466×678pt）。面板窄时整台缩小，切到「预览」模式看得更清楚',
  },
  {
    id: 'duo-open',
    name: 'Duo 内屏',
    hint: 'iPhone Duo 展开、内屏横握（890×626pt）。面板窄时整台缩小，切到「预览」模式看得更清楚',
  },
  { id: 'desktop', name: '桌面', hint: '桌面版式：macOS 窗口里的宽排版' },
];

/** Per browser, like the theme choice: it is how you like to look, not part of the draft */
const STORAGE_DEVICE = 'yimark:preview-device';

function readDevice(): PreviewDevice {
  const v = localStorage.getItem(STORAGE_DEVICE);
  return DEVICES.find((d) => d.id === v)?.id ?? 'iphone';
}

/** Unzoomed frame sizes of the two Duo views; keep in step with the
 *  [data-device^='duo'] .phone-frame rules in styles.css */
const DUO_FRAMES: Record<DuoView, { width: number; height: number }> = {
  duo: { width: 897, height: 647 },
  'duo-open': { width: 842, height: 599 },
};

/** The stage's content box, which the Duo views fit into */
function measure(stage: HTMLElement | null) {
  let w = 0;
  let h = 0;
  if (stage) {
    const cs = getComputedStyle(stage);
    // Floored so sub-pixel jitter while dragging doesn't re-render every frame
    w = Math.floor(stage.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight));
    h = Math.floor(stage.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom));
  }
  return { w, h };
}

/** Zoom that fits a Duo view into the stage, keeping its real proportions (1 = real size) */
function fitFor(device: PreviewDevice, w: number, h: number): number {
  if ((device !== 'duo' && device !== 'duo-open') || w <= 0 || h <= 0) return 1;
  const f = DUO_FRAMES[device];
  return Math.max(0.3, Math.round(Math.min(1, w / f.width, h / f.height) * 1000) / 1000);
}

/**
 * Convert a source position into a preview scroll offset.
 *
 * The point is interpolation, not snapping: find the two anchors the position
 * falls between and take a linear value between their offsets, in proportion to
 * the line number. Snapping to the nearest anchor makes the preview jump a
 * paragraph at a time — that was the old stutter. Interpolated, the preview
 * follows the editor continuously.
 */
function offsetForPosition(anchors: Anchor[], position: number, end: Anchor | null): number {
  // Binary search for the last anchor with line <= position
  let lo = 0;
  let hi = anchors.length - 1;
  let i = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (anchors[mid].line <= position) {
      i = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (i < 0) {
    // The position sits above the first anchor (the preview drops the duplicate
    // h1, so the opening lines have no anchor of their own): interpolate from a
    // virtual "top of content" to the first anchor, otherwise reaching it jumps
    // a long way at once
    const first = anchors[0];
    if (first.line <= 0) return 0;
    return Math.max(0, first.top * Math.min(1, Math.max(0, position / first.line)));
  }
  const cur = anchors[i];
  // Past the last anchor, attach a virtual "end of article" anchor so the tail
  // keeps interpolating instead of freezing and then jumping
  const next = anchors[i + 1] ?? (end && end.line > cur.line ? end : null);
  if (!next) return Math.max(0, cur.top);
  const span = next.line - cur.line;
  if (span <= 0) return Math.max(0, cur.top);
  const t = Math.min(1, Math.max(0, (position - cur.line) / span));
  return Math.max(0, cur.top + (next.top - cur.top) * t);
}

/**
 * Build the "source line → preview offset" anchor table.
 * `top` is relative to the top of the scrolled content (it excludes the current
 * scrollTop), so it can be reused while scrolling and only needs rebuilding
 * after the body or the layout changes.
 */
function buildAnchors(scroll: HTMLElement): Anchor[] {
  // Read every geometry value in one pass without writing DOM in between, so
  // the browser is forced through a single reflow
  const box = scroll.getBoundingClientRect();
  // Rects are in visual pixels, scrollTop in the scroller's own layout pixels.
  // They differ by every zoom above the scroller (0.92 on the phone screen,
  // times the fit-to-pane zoom of the Duo views), and engines disagree on
  // whether rects include zoom at all — so measure the ratio, don't assume it.
  const k = scroll.offsetHeight > 0 ? box.height / scroll.offsetHeight : 1;
  const anchors: Anchor[] = [];
  for (const el of scroll.querySelectorAll<HTMLElement>('[data-line]')) {
    const line = Number(el.dataset.line);
    if (anchors.length && anchors[anchors.length - 1].line === line) continue;
    anchors.push({ line, top: (el.getBoundingClientRect().top - box.top) / k + scroll.scrollTop });
  }
  return anchors;
}

/**
 * The right-hand preview, drawn as the chosen device (see PreviewDevice):
 * - the Duo views keep their real proportions and zoom to fit the pane
 * - desktop is a macOS window with a traffic-light title bar
 * - article head on top (title plus byline), action bar at the end of the content
 * Every style in the body HTML is inline ⇒ preview and export (the WeChat
 * paste) are identical.
 */
export default function PreviewPane({ body, theme, name, hasImage, resizeKey, sync }: Props) {
  const paneRef = useRef<HTMLElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  /** Content box of the device stage, for fitting the Duo views */
  const [stage, setStage] = useState({ w: 0, h: 0 });
  const [device, setDeviceState] = useState<PreviewDevice>(readDevice);
  const setDevice = (next: PreviewDevice) => {
    localStorage.setItem(STORAGE_DEVICE, next);
    setDeviceState(next);
  };
  /** What actually gets drawn */
  const layout = device === 'desktop' ? 'desktop' : 'phone';
  const fit = fitFor(device, stage.w, stage.h);
  /**
   * 文章标题只看草稿名（与文件树显示一致），忽略正文里的首个 h1；
   * 草稿名为空才显示占位符。
   */
  const title = useMemo(() => name.trim(), [name]);
  /** 正文里的首个 h1 与草稿名重复，预览时丢掉；导出仍用完整正文 */
  const hasBodyH1 = useMemo(() => Boolean(extractTitle(body)), [body]);
  /** Body used for the preview (duplicate h1 removed; exports still use the full body) */
  const previewBody = useMemo(() => (hasBodyH1 ? stripFirstH1(body) : body), [body, hasBodyH1]);
  /** Date in the article head (a new Date() on every render means nothing) */
  const today = useMemo(() => new Date(), []);

  // Track the stage size as the pane resizes, for fitting the Duo views
  useEffect(() => {
    const pane = paneRef.current;
    if (!pane) return;
    const update = () => {
      const m = measure(stageRef.current);
      setStage((prev) => (prev.w === m.w && prev.h === m.h ? prev : m));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(pane);
    return () => ro.disconnect();
  }, []);

  // Backstop refresh on a layout change (drag, mode switch)
  useEffect(() => {
    const m = measure(stageRef.current);
    setStage((prev) => (prev.w === m.w && prev.h === m.h ? prev : m));
  }, [resizeKey]);

  /** Anchor cache (null means it needs rebuilding) */
  const anchorsRef = useRef<Anchor[] | null>(null);
  /** Request one sync (coalesced onto a rAF); reused when the body changes */
  const scheduleRef = useRef<() => void>(() => {});

  // Editor scroll → preview scroll. None of this path goes through React:
  // subscribe to the channel → coalesce onto a frame → interpolate the anchors
  // → write scrollTop.
  useEffect(() => {
    const apply = () => {
      const scroll = scrollRef.current;
      if (!scroll) return;
      const { position, endPosition, atTop, atBottom } = sync.state;
      // Align the edges exactly, so interpolation error leaves no gap at either
      // end. Snapping at the bottom is now "the interpolation had already
      // converged there", not a jump.
      if (atBottom) {
        scroll.scrollTop = scroll.scrollHeight;
        return;
      }
      if (atTop) {
        if (scroll.scrollTop !== 0) scroll.scrollTop = 0;
        return;
      }
      let anchors = anchorsRef.current;
      if (!anchors) {
        anchors = buildAnchors(scroll);
        anchorsRef.current = anchors;
      }
      if (!anchors.length) return;
      const maxScroll = Math.max(0, scroll.scrollHeight - scroll.clientHeight);
      const end = endPosition > 0 ? { line: endPosition, top: maxScroll } : null;
      let top = offsetForPosition(anchors, position, end);

      // Landing alignment: when the editor hits its bottom, the topmost visible
      // line is still mid-document, and the anchor-derived position falls short
      // of the preview's bottom. That gap used to be closed by "at the bottom,
      // jump to the bottom", which is why the ending lurched. Now it converges
      // over the final stretch instead.
      if (endPosition > 0) {
        const t = Math.min(1, Math.max(0, position / endPosition));
        if (t > 1 - TAIL_BLEND) {
          const w = (t - (1 - TAIL_BLEND)) / TAIL_BLEND;
          const eased = w * w * (3 - 2 * w); // smoothstep: no kink on entering the blend
          top = top + (maxScroll - top) * eased;
        }
      }
      if (Math.abs(scroll.scrollTop - top) < 0.5) return;
      scroll.scrollTop = top;
    };

    let raf = 0;
    const schedule = () => {
      // Collapse several scroll events in one frame into a single read/write
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        apply();
      });
    };
    scheduleRef.current = schedule;
    const unsubscribe = sync.subscribe(schedule);
    schedule();
    return () => {
      unsubscribe();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [sync]);

  // A re-rendered body, a device switch or a refit invalidates every anchor
  // offset, and calls for one realignment
  useEffect(() => {
    anchorsRef.current = null;
    scheduleRef.current();
  }, [body, device, fit]);

  // Async height changes — image decoding, font loading — invalidate them too
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      anchorsRef.current = null;
      scheduleRef.current();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Follow the article theme in the status bar and desktop window chrome
  useEffect(() => {
    document.documentElement.style.setProperty('--art-accent', theme.accent);
    document.documentElement.style.setProperty('--art-heading', theme.heading.color);
    document.documentElement.style.setProperty('--art-ink', theme.body.color);
    document.documentElement.style.setProperty('--art-hr', theme.hr.color);
    document.documentElement.style.setProperty('--art-foot-text', theme.footnote.textColor);
    document.documentElement.style.setProperty('--art-bg', theme.body.bg ?? '#ffffff');
    document.documentElement.style.setProperty('--art-heading-font', theme.heading.font);
    return () => {
      document.documentElement.style.removeProperty('--art-accent');
      document.documentElement.style.removeProperty('--art-heading');
      document.documentElement.style.removeProperty('--art-ink');
      document.documentElement.style.removeProperty('--art-hr');
      document.documentElement.style.removeProperty('--art-foot-text');
      document.documentElement.style.removeProperty('--art-bg');
      document.documentElement.style.removeProperty('--art-heading-font');
    };
  }, [theme]);

  return (
    <section
      className="split-pane preview-side"
      ref={paneRef}
      data-width={layout}
      data-device={device}
      // The web build has no shell dark mode: the paper decides, so a dark
      // theme gets the Night Sky Duo and a light one Star White
      data-appearance={theme.appearance}
    >
      <div className="pane-head">
        <span className="pane-title">预览</span>
        <div className="pane-head-right">
          {hasImage && <span className="pane-stat warn">含图片 · 建议公众号内单独上传</span>}
          <div className="segmented device-switch" role="radiogroup" aria-label="预览机型">
            {DEVICES.map((d) => (
              <button
                key={d.id}
                role="radio"
                aria-checked={device === d.id}
                className={`seg-btn ${device === d.id ? 'active' : ''}`}
                title={d.hint}
                onClick={() => setDevice(d.id)}
              >
                {d.name}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="phone-stage" ref={stageRef}>
        <div className="phone-frame" style={device === 'duo' || device === 'duo-open' ? { zoom: fit } : undefined}>
          {/* Side buttons (phone mode): on the iPhone, action and volume left,
              power right; the Duo views move them to where its edges carry them */}
          <span className="side-btn action" aria-hidden="true"></span>
          <span className="side-btn vol-up" aria-hidden="true"></span>
          <span className="side-btn vol-down" aria-hidden="true"></span>
          <span className="side-btn power" aria-hidden="true"></span>
          {/* iPhone Duo's back half, lying beside the outer screen */}
          {device === 'duo' && (
            <div className="duo-back" aria-hidden="true">
              <div className="duo-plateau">
                <span className="duo-lens l1"></span>
                <span className="duo-lens l2"></span>
                <span className="duo-mic"></span>
                <span className="duo-flash"></span>
              </div>
              {/* The Apple mark — the true outline, from Simple Icons (CC0) —
                  in one quiet tone with a faint diagonal sheen */}
              <svg className="duo-logo" viewBox="0 0 24 24" width="112" height="112" aria-hidden="true">
                <defs>
                  <linearGradient id="duo-logo-sheen" x1="0" y1="0" x2="1" y2="1">
                    <stop className="a" offset="0" />
                    <stop className="sheen" offset="0.46" />
                    <stop className="a" offset="0.54" />
                    <stop className="b" offset="1" />
                  </linearGradient>
                </defs>
                <path
                  fill="url(#duo-logo-sheen)"
                  d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701"
                />
              </svg>
            </div>
          )}
          <div className="phone-screen">
            {/* macOS window title bar (desktop mode) */}
            <div className="desktop-bar">
              <span className="traffic t1"></span>
              <span className="traffic t2"></span>
              <span className="traffic t3"></span>
              <span className="bar-title">文章预览 · {theme.name}</span>
            </div>
            {/* Phone status bar: Dynamic Island centered, real status icons on
                either side. The Duo has no bar: the time and one status ring
                (Wi-Fi inside, signal as dots) stack in the top-right corner. */}
            <div className="statusbar">
              <span className="time">9:41</span>
              <span className="dynamic-island" aria-hidden="true"></span>
              <span className="sb-icons" aria-hidden="true">
                <CellSignalFull size={13} weight="fill" />
                <WifiHigh size={13} weight="bold" />
                <BatteryFull size={17} weight="fill" />
              </span>
              <svg className="sb-orb" viewBox="0 0 32 32" aria-hidden="true">
                {/* Circle outline over the top and down both sides, to just below the middle */}
                <path className="ring" d="M1.99 19.75A14.5 14.5 0 1 1 30.01 19.75" />
                <g className="wifi">
                  <path d="M13.6 16.1A3.4 3.4 0 0 1 18.4 16.1" />
                  <path d="M11.19 13.69A6.8 6.8 0 0 1 20.81 13.69" />
                  <path d="M8.79 11.29A10.2 10.2 0 0 1 23.21 11.29" />
                </g>
                <circle cx="16" cy="18.5" r="1.4" />
                {/* The bottom of the circle, finished in five dots */}
                <circle cx="27.11" cy="25.32" r="1.15" />
                <circle cx="22.13" cy="29.14" r="1.15" />
                <circle cx="16" cy="30.5" r="1.15" />
                <circle cx="9.87" cy="29.14" r="1.15" />
                <circle cx="4.89" cy="25.32" r="1.15" />
              </svg>
            </div>
            <div className="article-scroll" ref={scrollRef}>
              {/* WeChat article head: title (with a placeholder when empty) plus byline */}
              <div className="article-head">
                <h1 className="head-title">{title || '未命名草稿'}</h1>
                <div className="meta">
                  <span className="author">易码</span>
                  <span className="byline">
                    {today.getFullYear()} 年 {today.getMonth() + 1} 月 {today.getDate()} 日
                  </span>
                </div>
              </div>
              <div
                className="check-body"
                ref={bodyRef}
                dangerouslySetInnerHTML={{ __html: previewBody }}
              />
              {/* Article footer: share / save / recommend / like, at the end of the content */}
              <div className="article-footer">
                <div className="actions">
                  <button className="action">分享</button>
                  <button className="action">收藏</button>
                  <button className="action">在看</button>
                  <button className="action">点赞</button>
                </div>
              </div>
            </div>
            {/* The fold down the middle of the Duo's inner screen */}
            <span className="crease" aria-hidden="true"></span>
            {/* Home indicator (phone mode) */}
            <span className="home-indicator" aria-hidden="true"></span>
          </div>
        </div>
      </div>
    </section>
  );
}
