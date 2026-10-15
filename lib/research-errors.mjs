const policies = {
  parameter_conflict: [400, false, '修正相互冲突的参数后重试。'],
  invalid_arguments: [400, false, '补充或修正查询参数后重试。'],
  authentication: [401, false, '检查本地服务凭据后重试。'],
  permission: [403, false, '确认服务或工具权限后重试。'],
  empty_result: [422, false, '检查公司和报告期间，或补充其他来源。'],
  rate_limit: [429, true, '稍后重试；已取得的资料保留。'],
  timeout: [504, true, '重试未完成的调用；已取得的资料保留。'],
  network: [502, true, '检查连接后重试未完成的调用。'],
  cancelled: [409, false, '任务已停止，可使用已保存的资料继续研究。'],
  budget_exhausted: [429, false, '本轮预算已用完；可发起下一轮继续研究。'],
  storage_error: [503, false, '保存未完成，请重试保存后继续。'],
  answer_quality: [422, false, '草稿未通过核验，未发布；可修改问题或重试，已取得的资料保留。'],
  context_limit: [422, false, '必要上下文超出预算，请缩短本次问题或减少研究范围；原始记录保留。'],
  output: [422, false, '模型输出无法安全使用，未发布；已取得的资料保留，可重试。'],
  document_error: [422, false, '核对文件公司、期间、合并口径与文本是否可提取；可换一份原始财报，上一版分析保留。'],
  unknown: [502, false, '查看失败记录后重试；不自动重复未知错误。'],
};

export class ResearchError extends Error {
  constructor(message, { category = 'unknown', code, status, retryable, recovery, providerCode = null, cause } = {}) {
    super(String(message || '研究请求失败。'), cause ? { cause } : undefined);
    const policy = policies[category] || policies.unknown;
    this.name = 'ResearchError';
    this.code = code || category.toUpperCase();
    this.category = category;
    this.retryable = retryable ?? policy[1];
    this.status = status ?? policy[0];
    this.recovery = recovery || policy[2];
    this.providerCode = providerCode;
  }
}

export function classifyError(error, { signal } = {}) {
  // AbortController reasons carry runtime cancellation/budget ownership.
  const source = signal?.aborted && signal.reason instanceof Error ? signal.reason : error;
  if (source instanceof ResearchError) {
    if (source !== error) for (const field of ['partialEvidence', 'resolvedScope']) if (error?.[field] !== undefined) source[field] = error[field];
    return source;
  }
  const message = String(source?.message || source || '研究请求失败。');
  const code = source?.code;
  const status = Number(source?.httpStatus ?? source?.status ?? source?.statusCode ?? source?.response?.status);
  let category = policies[source?.category] ? source.category : null;
  if (!category) {
    if (typeof code === 'string' && /^REPORT_/.test(code)) category = 'document_error';
    else if (code === 'BUDGET_EXHAUSTED') category = 'budget_exhausted';
    else if (code === 'CANCELLED' || source?.name === 'AbortError') category = 'cancelled';
    else if (code === 'STORAGE_ERROR' || ['ENOSPC', 'EROFS', 'EDQUOT', 'EIO'].includes(code)) category = 'storage_error';
    else if (/parameter conflict|must not be set together/i.test(message)) category = 'parameter_conflict';
    else if (code === 'NEEDS_CLARIFICATION' || code === -32602 || status === 400 || /invalid (?:arguments?|params?|parameters?)/i.test(message)) category = 'invalid_arguments';
    else if (status === 401 || /unauthorized|invalid api.?key|missing.credentials|未授权/i.test(message)) category = 'authentication';
    else if (status === 403 || /forbidden|permission denied|权限不足/i.test(message)) category = 'permission';
    else if (status === 429 || /rate.?limit|too many requests/i.test(message)) category = 'rate_limit';
    else if (code === -32001 || ['ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT'].includes(code) || source?.name === 'TimeoutError' || /timed?\s*out|timeout/i.test(message)) category = 'timeout';
    else if (['ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'EPIPE'].includes(code) || /fetch failed|network error|socket hang up/i.test(message)) category = 'network';
    else category = 'unknown';
  }
  const result = new ResearchError(message, {
    category, code: typeof code === 'string' ? code : undefined,
    providerCode: source?.providerCode ?? (typeof code === 'number' ? code : null), cause: source,
  });
  for (const field of ['candidates', 'partialEvidence', 'resolvedScope']) {
    const value = error?.[field] ?? source?.[field];
    if (value !== undefined) result[field] = value;
  }
  return result;
}
