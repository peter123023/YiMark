import { useEffect, useRef, useState } from 'react';
import { LinkSimple, WarningCircle, X } from '@phosphor-icons/react';

interface Props {
  open: boolean;
  onClose: () => void;
  /** 抓取并导入；抛错时错误信息展示在弹窗内 */
  onImport: (url: string) => Promise<void>;
}

/** 从公众号文章导入：输入链接 → 抓取 → 转成新草稿 */
export default function WechatImportDialog({ open, onClose, onImport }: Props) {
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // 每次打开都重置；自动聚焦输入框
  useEffect(() => {
    if (!open) return;
    setUrl('');
    setError(null);
    const t = window.setTimeout(() => inputRef.current?.focus(), 50);
    return () => window.clearTimeout(t);
  }, [open]);

  // Esc 关闭（抓取中不允许关，避免状态错乱）
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, busy, onClose]);

  if (!open) return null;

  const submit = async () => {
    if (busy) return;
    if (!url.trim()) {
      setError('请先粘贴公众号文章链接');
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await onImport(url.trim());
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : '导入失败，请稍后重试');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="wechat-dialog-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div className="wechat-dialog" role="dialog" aria-modal="true" aria-label="从公众号文章导入">
        <div className="wechat-dialog-head">
          <LinkSimple size={15} weight="bold" />
          <span>从公众号文章导入</span>
          <button className="wechat-dialog-close" onClick={onClose} disabled={busy} aria-label="关闭">
            <X size={13} weight="bold" />
          </button>
        </div>
        <input
          ref={inputRef}
          className="wechat-dialog-input"
          placeholder="粘贴 mp.weixin.qq.com 文章链接"
          value={url}
          disabled={busy}
          spellCheck={false}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void submit();
          }}
        />
        {error && (
          <div className="wechat-dialog-error">
            <WarningCircle size={13} weight="bold" />
            {error}
          </div>
        )}
        <div className="wechat-dialog-actions">
          <button className="btn" onClick={onClose} disabled={busy}>
            取消
          </button>
          <button className="btn primary" onClick={() => void submit()} disabled={busy || !url.trim()}>
            {busy ? '抓取中…' : '导入'}
          </button>
        </div>
      </div>
    </div>
  );
}
