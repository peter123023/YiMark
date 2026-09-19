import { useEffect, useRef, useState } from 'react';
import { Check, CopySimple, PaperPlaneTilt, WarningCircle, X } from '@phosphor-icons/react';

interface Props {
  open: boolean;
  onClose: () => void;
  /** 创建分享并返回阅读链接；抛错时错误展示在弹窗内 */
  onShare: () => Promise<string>;
}

/**
 * 分享弹窗：打开即创建（链接是给别人的，不改变当前页 hash），
 * 成功后展示只读链接 + 复制按钮。样式复用公众号导入弹窗的一套。
 */
export default function ShareDialog({ open, onClose, onShare }: Props) {
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<number | null>(null);

  // 打开即创建；卸载/关闭时清理复制提示
  useEffect(() => {
    if (!open) return;
    setLink('');
    setError(null);
    setCopied(false);
    setBusy(true);
    let cancelled = false;
    onShare()
      .then((url) => {
        if (!cancelled) setLink(url);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : '分享失败，请稍后重试');
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
      if (copiedTimer.current) window.clearTimeout(copiedTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, busy, onClose]);

  if (!open) return null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      if (copiedTimer.current) window.clearTimeout(copiedTimer.current);
      copiedTimer.current = window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('复制失败，请手动选择链接复制');
    }
  };

  return (
    <div
      className="wechat-dialog-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div className="wechat-dialog" role="dialog" aria-modal="true" aria-label="分享文章">
        <div className="wechat-dialog-head">
          <PaperPlaneTilt size={15} weight="bold" />
          <span>分享文章</span>
          <button className="wechat-dialog-close" onClick={onClose} disabled={busy} aria-label="关闭">
            <X size={13} weight="bold" />
          </button>
        </div>

        {busy && <div className="share-hint">正在生成分享链接…</div>}

        {!busy && !error && (
          <>
            <div className="share-hint">任何人拿到这个链接，无需登录即可阅读排版好的原文。</div>
            <div className="share-link-row">
              <input
                className="wechat-dialog-input share-link-input"
                readOnly
                value={link}
                onFocus={(e) => e.target.select()}
              />
              <button className="btn primary share-copy-btn" onClick={() => void copy()} disabled={!link}>
                {copied ? <Check size={14} weight="bold" /> : <CopySimple size={14} weight="bold" />}
                {copied ? '已复制' : '复制'}
              </button>
            </div>
          </>
        )}

        {error && (
          <div className="wechat-dialog-error">
            <WarningCircle size={13} weight="bold" />
            {error}
          </div>
        )}

        <div className="wechat-dialog-actions">
          <button className="btn" onClick={onClose} disabled={busy}>
            {error ? '关闭' : '完成'}
          </button>
        </div>
      </div>
    </div>
  );
}
