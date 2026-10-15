import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ExternalLink, FileSearch, FileText, LoaderCircle, Upload } from 'lucide-react';
import { Button } from './components/ui/button';

const MAX_PDF_BYTES = 16 * 1024 * 1024;
const failedStatus = status => ['blocked', 'failed'].includes(status);

export function DisclosurePanel({ task, busy = false, onSearch, onUpload }) {
  const inputRef = useRef(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(() => failedStatus(task?.supplement?.status));
  const scope = task?.researchScope || task?.result?.researchScope;
  const supplement = task?.supplement;
  const status = supplement?.status;
  const isBeijing = /\.BJ$/i.test(scope?.thscode || '');

  useEffect(() => {
    setError('');
    setOpen(failedStatus(status));
  }, [task?.id]);
  useEffect(() => {
    if (failedStatus(status)) setOpen(true);
  }, [status, supplement?.revision]);

  if (task?.dataSource !== 'fuyao' || !task?.result || !/^\d{6}\.(SH|SZ|BJ)$/i.test(scope?.thscode || '')
    || !Number.isInteger(Number(scope.year)) || Number(scope.year) < 1990
    || !['annual', 'quarterly'].includes(scope.period)
    || (scope.period === 'quarterly' && ![1, 2, 3, 4].includes(Number(scope.quarter)))) return null;

  const documents = [...(task.documents || [])].slice(-3).reverse();
  const runSearch = async () => {
    if (busy || isBeijing || !onSearch) return;
    setError('');
    try { await onSearch(); }
    catch (cause) { setError(cause?.message || '未能完成公告补查，请重试。原分析保留。'); }
  };
  const upload = async event => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || busy || !onUpload) return;
    setError('');
    if (!/\.pdf$/i.test(file.name) || (file.type && !['application/pdf', 'application/octet-stream'].includes(file.type))) {
      setError('请选择 PDF 文件；当前只支持文本型财报 PDF。');
      return;
    }
    if (!file.size) { setError('这个 PDF 是空文件，请重新选择。'); return; }
    if (file.size > MAX_PDF_BYTES) { setError('文件超过 16 MB，请选择较小的文本型财报 PDF。'); return; }
    try { await onUpload(file); }
    catch (cause) { setError(cause?.message || '未能完成上传补查，请重试。原分析保留。'); }
  };

  return (
    <details className="disclosure-panel" open={open} onToggle={event => setOpen(event.currentTarget.open)}>
      <summary>
        <span><FileText size={15} aria-hidden="true" />补充原始财报</span>
        <ChevronDown size={14} aria-hidden="true" />
      </summary>
      <div className="disclosure-content">
        <p className="disclosure-description">取得原始报表分项，继续核查当前研究中尚未解决的问题。</p>
        <div className="disclosure-actions">
          <Button type="button" size="sm" variant="outline" onClick={runSearch} disabled={busy || isBeijing || !onSearch}>
            {busy ? <LoaderCircle size={14} className="spin" aria-hidden="true" /> : <FileSearch size={14} aria-hidden="true" />}
            检索原始财报并补查
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => inputRef.current?.click()} disabled={busy || !onUpload}>
            <Upload size={14} aria-hidden="true" />上传 PDF 并补查
          </Button>
          <input ref={inputRef} type="file" accept=".pdf,application/pdf" hidden disabled={busy || !onUpload} onChange={upload} aria-label="选择待补查的财报 PDF" />
        </div>
        <p className="disclosure-help">文本型 PDF · 最大16MB · 上传后核对公司、期间和合并口径</p>
        {isBeijing && <p className="disclosure-help">当前公告检索支持沪深 A 股；北交所公司可上传原始财报补查。</p>}
        {busy && <p className="disclosure-status" role="status">正在补查，请等待本轮取证与判断更新。</p>}
        {supplement?.message && <p className={`disclosure-status${failedStatus(status) ? ' is-blocked' : ''}`} role={failedStatus(status) ? 'alert' : 'status'}>{supplement.message}</p>}
        {failedStatus(status) && <p className="disclosure-help">本次补查未完成，原分析保留。</p>}
        {error && <p className="disclosure-error" role="alert">{error}</p>}
        {documents.length > 0 && (
          <ul className="disclosure-files" aria-label="最近补充的财报">
            {documents.map(document => {
              const verified = document.status === 'verified' && Number.isInteger(document.verifiedRevision);
              return (
                <li className="disclosure-file" key={document.id}>
                  <FileText size={15} aria-hidden="true" />
                  <div className="disclosure-file-info">
                    <span className="disclosure-filename">{document.filename || '财报 PDF'}</span>
                    <span className="disclosure-file-meta">
                      {Number.isInteger(document.pageCount) && `${document.pageCount} 页 · `}
                      {verified ? '已核验' : '待核验'}
                      {verified && ` · 第 ${document.verifiedRevision} 版`}
                    </span>
                  </div>
                  <a className="disclosure-original" href={`/api/tasks/${encodeURIComponent(task.id)}/documents/${encodeURIComponent(document.id)}.pdf`} target="_blank" rel="noreferrer" aria-label={`查看原文：${document.filename || '财报 PDF'}`}>原文<ExternalLink size={12} aria-hidden="true" /></a>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </details>
  );
}
