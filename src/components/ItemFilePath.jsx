import { useEffect, useState } from 'react';
import { FolderOpen, Copy, Check } from 'lucide-react';
import { jellyfin } from '../api/jellyfinClient';

/**
 * 原始文件路径展示（三点菜单用）：目录灰、文件名亮，点击整块复制完整路径。
 * 主库列表查询已带 Path（去重用的轻量直存字段）；缺失时（剧集页等）
 * 懒拉单条详情补齐，拉不到（无路径的聚合条目）整块不渲染。
 */
export default function ItemFilePath({ item, label = '文件路径' }) {
  const [path, setPath] = useState(item?.Path || null);
  const [missing, setMissing] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setCopied(false);
    if (item?.Path) {
      setPath(item.Path);
      setMissing(false);
      return;
    }
    setPath(null);
    setMissing(false);
    if (!item?.Id) return;
    jellyfin.getItemDetails(item.Id)
      .then((d) => {
        if (cancelled) return;
        const p = d?.Path || null;
        setPath(p);
        setMissing(!p);
      })
      .catch(() => {
        if (!cancelled) setMissing(true);
      });
    return () => { cancelled = true; };
  }, [item?.Id, item?.Path]);

  if (!path || missing) return null;

  // 兼容 Windows 反斜杠路径：取最后一段为文件名
  const slash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  const dir = slash >= 0 ? path.slice(0, slash + 1) : '';
  const name = slash >= 0 ? path.slice(slash + 1) : path;

  const copy = async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(path);
      } else {
        const ta = document.createElement('textarea');
        ta.value = path;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // 复制失败静默（select-all 的文本仍可手动长按复制）
    }
  };

  return (
    <button
      type="button"
      onClick={copy}
      title="点击复制完整路径"
      className="w-full text-left flex flex-col gap-1 group/path"
    >
      <div className="flex items-center gap-1.5 text-gray-500">
        <FolderOpen size={12} className="flex-shrink-0" />
        <span className={`text-[10px] ${copied ? 'text-emerald-400' : ''}`}>
          {copied ? '已复制' : label}
        </span>
        <span className="flex-1" />
        {copied
          ? <Check size={12} className="text-emerald-400 flex-shrink-0" />
          : <Copy size={12} className="flex-shrink-0 opacity-40" />}
      </div>
      <div className="font-mono text-[10px] leading-relaxed break-all select-all">
        {dir && <span className="text-gray-500">{dir}</span>}
        <span className="text-cyan-300 font-bold">{name}</span>
      </div>
    </button>
  );
}
