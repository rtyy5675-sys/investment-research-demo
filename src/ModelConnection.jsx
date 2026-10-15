import React, { useEffect, useId, useRef, useState } from 'react';
import { Cpu, LoaderCircle, RotateCcw, Save, ShieldCheck } from 'lucide-react';
import './model-connection.css';

const sourceLabels = { local: '本机配置', environment: '环境配置', default: '默认配置' };

async function requestSettings(path, body, signal) {
  let response;
  try {
    response = await fetch(path, {
      method: body === undefined ? 'GET' : 'POST',
      credentials: 'same-origin',
      ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
      signal,
    });
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    throw new Error('无法连接本机服务，请稍后重试。');
  }
  const result = await response.json().catch(() => ({}));
  // Only the API's safe message is shown; upstream errors and credentials never enter the UI.
  if (!response.ok) throw new Error(typeof result.message === 'string' ? result.message : typeof result.error === 'string' ? result.error : '操作未完成，请刷新配置后重试。');
  return result;
}

export function ModelConnection({ onChanged, disabled = false }) {
  const fieldId = useId();
  const mounted = useRef(false);
  const [settings, setSettings] = useState(null);
  const [provider, setProvider] = useState('codex');
  const [baseUrl, setBaseUrl] = useState('');
  const [modelName, setModelName] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState('loading');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [check, setCheck] = useState(null);

  function applySettings(next) {
    setSettings(next);
    setProvider(next.provider);
    setBaseUrl(next.baseUrl || '');
    setModelName(next.modelName || '');
    setApiKey('');
  }

  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    requestSettings('/api/model-settings', undefined, controller.signal)
      .then(next => { if (mounted.current) applySettings(next); })
      .catch(cause => { if (mounted.current && cause.name !== 'AbortError') setError(cause.message); })
      .finally(() => { if (mounted.current) setBusy(''); });
    return () => { mounted.current = false; controller.abort(); };
  }, []);

  const dirty = !!settings && (provider !== settings.provider || baseUrl !== (settings.baseUrl || '') || modelName !== (settings.modelName || '') || !!apiKey);
  const locked = disabled || !!busy;
  const compatible = provider === 'openai-compatible';

  function edit(setter, value) {
    setter(value);
    setError('');
    setNotice('');
    setCheck(null);
  }

  async function reload() {
    if (locked) return;
    setBusy('loading'); setError(''); setNotice(''); setCheck(null);
    try {
      const next = await requestSettings('/api/model-settings');
      if (mounted.current) applySettings(next);
    } catch (cause) { if (mounted.current) setError(cause.message); }
    finally { if (mounted.current) setBusy(''); }
  }

  async function save(event) {
    event.preventDefault();
    if (locked || !settings) return;
    setBusy('saving'); setError(''); setNotice(''); setCheck(null);
    try {
      const next = await requestSettings('/api/model-settings/save', {
        provider, baseUrl: baseUrl.trim(), modelName: modelName.trim(), apiKey: apiKey.trim(), expectedVersion: settings.version,
      });
      if (!mounted.current) return;
      applySettings(next);
      setNotice('配置已保存。可以验证一次模型连接。');
      onChanged?.({ provider: next.provider, label: next.modelName, settings: next });
    } catch (cause) { if (mounted.current) setError(cause.message); }
    finally { if (mounted.current) setBusy(''); }
  }

  async function verify() {
    if (locked || !settings || dirty) return;
    setBusy('checking'); setError(''); setNotice(''); setCheck(null);
    try {
      const next = await requestSettings('/api/model-settings/check', { expectedVersion: settings.version });
      if (!mounted.current) return;
      setCheck(next);
      if (next.ok) setSettings(current => ({ ...current, verifiedAt: next.checkedAt }));
      onChanged?.(next.model);
    } catch (cause) { if (mounted.current) setError(cause.message); }
    finally { if (mounted.current) setBusy(''); }
  }

  return <section className="connection-card model-connection" aria-busy={!!busy}>
    <div className="connection-card-title"><h3><Cpu size={15} aria-hidden="true" />分析模型</h3><span className={`connection-status ${check?.ok ? 'verified' : ''}`}>{settings ? sourceLabels[settings.source] || '本机配置' : '读取配置'}</span></div>
    <p>选择本机 Codex，或连接自己的 OpenAI 兼容模型服务。</p>
    <small className="model-tested-note">目前仅测试过 DeepSeek 和 Codex CLI，其他模型服务尚未验证。</small>
    {busy === 'loading' && <p className="model-loading" role="status"><LoaderCircle size={13} className="spin" aria-hidden="true" />正在读取模型配置…</p>}
    {settings && <form onSubmit={save}>
      <fieldset disabled={locked} className="model-fields">
        <label htmlFor={`${fieldId}-provider`}>调用方式</label>
        <select id={`${fieldId}-provider`} value={provider} onChange={event => { edit(setProvider, event.target.value); setModelName(event.target.value === settings.provider ? settings.modelName || '' : ''); }}>
          <option value="codex">本机 Codex</option>
          <option value="openai-compatible">OpenAI 兼容 API</option>
        </select>
        {compatible ? <>
          <label htmlFor={`${fieldId}-url`}>API 基址</label>
          <input id={`${fieldId}-url`} type="url" inputMode="url" required value={baseUrl} placeholder="https://api.example.com/v1" autoComplete="off" onChange={event => edit(setBaseUrl, event.target.value)} aria-describedby={`${fieldId}-url-hint`} />
          <small id={`${fieldId}-url-hint`}>填写服务商的 /v1 基址，无需填写 /chat/completions。</small>
          <label htmlFor={`${fieldId}-model`}>模型名称</label>
          <input id={`${fieldId}-model`} value={modelName} required placeholder="服务商提供的模型 ID" autoComplete="off" spellCheck={false} onChange={event => edit(setModelName, event.target.value)} />
          <label htmlFor={`${fieldId}-key`}>API Key <span className="model-key-state">{settings.keyConfigured ? '已有密钥，留空保留' : '尚未配置'}</span></label>
          <input id={`${fieldId}-key`} type="password" value={apiKey} placeholder={settings.keyConfigured ? '填写新 Key 可替换；留空保留现有 Key' : '粘贴 API Key'} autoComplete="new-password" spellCheck={false} onChange={event => edit(setApiKey, event.target.value)} aria-describedby={`${fieldId}-privacy`} />
          <small id={`${fieldId}-privacy`}>密钥仅提交给本机服务端保存；保存后清空输入，不会读取或展示已有密钥。</small>
          <p className="model-schema-note">支持 OpenAI 严格 JSON Schema，以及 DeepSeek JSON Object 模式；服务端会校验返回结构。</p>
        </> : <>
          <p className="model-schema-note">使用这台电脑已安装并登录的 Codex。{settings.provider === 'codex' && settings.modelName ? `当前模型：${settings.modelName}。` : '切换后沿用本机配置的模型。'}无需在此填写 API Key。</p>
        </>}
        <div className="connection-actions">
          <button type="submit" className="primary">{busy === 'saving' ? <LoaderCircle size={13} className="spin" aria-hidden="true" /> : <Save size={13} aria-hidden="true" />}{busy === 'saving' ? '正在保存…' : '保存配置'}</button>
          <button type="button" onClick={verify} disabled={dirty}>{busy === 'checking' ? <LoaderCircle size={13} className="spin" aria-hidden="true" /> : <ShieldCheck size={13} aria-hidden="true" />}{busy === 'checking' ? '正在验证…' : '验证模型'}</button>
        </div>
      </fieldset>
      <p className="model-verification-note">{dirty ? '有尚未保存的修改，请先保存再验证。' : '验证会发起一次小额模型调用，可能产生少量 Token 费用。'}验证通过仅说明基础连通，不代表整条投研流程已通过。</p>
      {settings.verifiedAt && !dirty && !check && <small className="model-last-verified">上次验证：{new Date(settings.verifiedAt).toLocaleString('zh-CN')}</small>}
    </form>}
    {notice && <p className="model-notice" role="status">{notice}</p>}
    {check && <div className={`connection-check ${check.ok ? 'success' : 'error'}`} role="status"><strong>{check.ok ? '模型基础连接通过' : '模型尚未验证通过'}</strong><p>{check.message || (check.ok ? '模型已返回验证结果。' : '请检查地址、模型名称和凭证后重试。')}</p>{check.checkedAt && <small>验证时间：{new Date(check.checkedAt).toLocaleString('zh-CN')}</small>}</div>}
    {error && <div className="model-error" role="alert"><p>{error}</p><button type="button" onClick={reload} disabled={locked}><RotateCcw size={12} aria-hidden="true" />重新读取配置</button><small>重新读取会放弃尚未保存的修改。</small></div>}
  </section>;
}
