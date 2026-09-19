import { useEffect, useMemo, useState } from 'react';
import { ArrowClockwise, WarningCircle } from '@phosphor-icons/react';
import { ensureHighlighter, isHighlighterReady, renderArticle, stripFirstH1 } from '../markdown';
import { fetchSharedArticle, type SharedArticle } from '../share';
import { getDensity, getTheme } from '../theme';

interface Props {
  /** 分享 id（来自 #/read/<id>） */
  id: string;
}

/**
 * 分享阅读页：hash 路由 #/read/<id> 时全屏替换编辑器。
 * 按文章自带的排版主题/密度渲染（与分享者所见一致），
 * 公众号外链图靠渲染器内置的 no-referrer 绕过防盗链，手机上也可直接读。
 */
export default function ReadView({ id }: Props) {
  const [article, setArticle] = useState<SharedArticle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  // 代码高亮懒加载：就绪后翻转载态补一次渲染
  const [hlReady, setHlReady] = useState(isHighlighterReady);

  useEffect(() => {
    let cancelled = false;
    setArticle(null);
    setError(null);
    fetchSharedArticle(id)
      .then((a) => {
        if (!cancelled) setArticle(a);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : '加载失败');
      });
    return () => {
      cancelled = true;
    };
  }, [id, reload]);

  useEffect(() => {
    if (hlReady) return;
    let cancelled = false;
    void ensureHighlighter().then(() => {
      if (!cancelled) setHlReady(isHighlighterReady());
    });
    return () => {
      cancelled = true;
    };
  }, [hlReady]);

  // 阅读端没有本地图片库：渲染用的 images 来自分享时附带的那份
  const body = useMemo(() => {
    if (!article) return '';
    const theme = getTheme(article.themeId);
    const result = renderArticle(article.markdown, theme, article.images, getDensity(article.densityId));
    // 标题单独展示（草稿名），正文里重复的首个 h1 去掉
    return stripFirstH1(result.body);
  }, [article, hlReady]);

  useEffect(() => {
    document.title = article?.title ? `${article.title} · 易码` : '易码 · 阅读';
  }, [article?.title]);

  if (error) {
    return (
      <div className="read-page">
        <div className="read-state">
          <WarningCircle size={28} weight="bold" />
          <p>{error}</p>
          <button className="btn" onClick={() => setReload((v) => v + 1)}>
            <ArrowClockwise size={14} weight="bold" />
            重试
          </button>
        </div>
      </div>
    );
  }

  if (!article) {
    return (
      <div className="read-page">
        <div className="read-state">
          <p>加载中…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="read-page">
      <article className="read-card">
        <h1 className="read-title">{article.title || '未命名文章'}</h1>
        <div className="read-meta">
          {new Date(article.createdAt).toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })}
        </div>
        {/* renderArticle 输出全内联样式 HTML，微信粘贴与网页阅读同一份 */}
        <div className="read-body" dangerouslySetInnerHTML={{ __html: body }} />
        <footer className="read-footer">
          由{' '}
          <a href={`${window.location.origin}${window.location.pathname}`} target="_blank" rel="noreferrer">
            易码
          </a>{' '}
          排版
        </footer>
      </article>
    </div>
  );
}
