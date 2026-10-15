// Public company disclosure metadata from CNINFO; no per-company URL/orgId map.
const ORIGIN = 'https://www.cninfo.com.cn';
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const HEADERS = {
  'User-Agent': 'Mozilla/5.0',
  Referer: `${ORIGIN}/`,
  'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
  Accept: 'application/json, text/plain, */*',
};

function sourceError(message, cause) {
  const error = new Error(`公告检索失败：${message}`, { cause });
  error.code = 'DISCLOSURE_SEARCH_FAILED';
  return error;
}

async function readJson(response, signal) {
  if (!response.ok) throw sourceError(`巨潮接口返回 HTTP ${response.status}`);
  if (Number(response.headers.get('content-length')) > MAX_RESPONSE_BYTES) throw sourceError('巨潮响应超过 2 MiB 上限');
  const chunks = [];
  let length = 0;
  const reader = response.body?.getReader();
  if (!reader) throw sourceError('巨潮接口未返回响应正文');
  try {
    for (;;) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_RESPONSE_BYTES) throw sourceError('巨潮响应超过 2 MiB 上限');
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch (error) { throw sourceError('巨潮接口未返回有效 JSON，可能受到访问限制', error); }
}

function reportPattern(year, quarter) {
  if (quarter === 4) return new RegExp(`${year}年?(?:年度报告|年报)`);
  if (quarter === 2) return new RegExp(`${year}年?(?:半年度报告|中期报告|半年报)`);
  return new RegExp(`${year}年?(?:第?${quarter === 1 ? '[一1]' : '[三3]'}季度报告|${quarter === 1 ? '一' : '三'}季报)`);
}

/** Find official complete reports for an exact A-share company and reporting period. */
export async function searchReports(scope, { signal, fetchImpl = fetch } = {}) {
  const match = /^(\d{6})(?:\.(SH|SZ))?$/i.exec(String(scope?.thscode || '').trim());
  if (!match) throw sourceError('需要已确认的沪深 A 股六位股票代码');
  const code = match[1];
  const exchange = match[2]?.toUpperCase() || (/^[569]/.test(code) ? 'SH' : 'SZ');
  if ((exchange === 'SH' && !/^6/.test(code)) || (exchange === 'SZ' && !/^[03]/.test(code))) throw sourceError('当前公告检索仅支持沪深 A 股公司');
  const year = Number(scope.year);
  const currentYear = Number(new Intl.DateTimeFormat('en', { year: 'numeric', timeZone: 'Asia/Shanghai' }).format(new Date()));
  if (!Number.isInteger(year) || year < 1990 || year > currentYear) throw sourceError('需要有效且明确的报告年份');
  const quarter = scope.period === 'annual' ? 4 : Number(scope.quarter);
  if (!['annual', 'quarterly'].includes(scope.period) || ![1, 2, 3, 4].includes(quarter)) throw sourceError('需要明确的全年、一季度、半年或前三季度报告范围');
  const timeout = AbortSignal.timeout(20_000);
  const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const post = async (path, params) => {
    requestSignal.throwIfAborted();
    return readJson(await fetchImpl(`${ORIGIN}${path}`, {
      method: 'POST', headers: HEADERS, body: new URLSearchParams(params), signal: requestSignal, redirect: 'error',
    }), requestSignal);
  };
  try {
    const securities = await post('/new/information/topSearch/query', { keyWord: code, maxNum: '10' });
    if (!Array.isArray(securities)) throw sourceError('巨潮证券检索返回格式变化');
    const security = securities.find(item => item.code === code && item.category === 'A股' && item.orgId && item.zwjc);
    if (!security) throw sourceError(`巨潮未找到股票代码 ${code} 对应的 A 股证券`);
    const category = { 1: 'category_yjdbg_szsh', 2: 'category_bndbg_szsh', 3: 'category_sjdbg_szsh', 4: 'category_ndbg_szsh' }[quarter];
    const result = await post('/new/hisAnnouncement/query', {
      stock: `${code},${security.orgId}`, tabName: 'fulltext', pageSize: '100', pageNum: '1',
      column: exchange === 'SH' ? 'sse' : 'szse', category,
      seDate: `${year}-01-01~${Math.min(year + 2, currentYear)}-12-31`, isHLtitle: 'true',
    });
    if (!result || !Array.isArray(result.announcements)) {
      if (result?.totalAnnouncement === 0) return [];
      throw sourceError('巨潮公告列表返回格式变化或访问被限制');
    }
    const pattern = reportPattern(year, quarter);
    const seen = new Set();
    return result.announcements.flatMap(item => {
      const title = String(item.announcementTitle || '').replace(/<[^>]*>/g, '').replace(/\s/g, '');
      const matchedReport = pattern.exec(title);
      const suffix = matchedReport ? title.slice(matchedReport.index + matchedReport[0].length) : '';
      // Reject audit opinions, explanations and correction notices about a report;
      // retain the complete report itself and explicitly revised report editions.
      const editionSuffix = /^(?:全文)?(?:(?:修订|更新|更正)(?:版|稿|后)?|[（(【\[](?=[^）)】\]]*(?:修订|更新|更正|全文))[^）)】\]]*[）)】\]])?$/;
      if (item.secCode !== code || item.orgId !== security.orgId || item.adjunctType !== 'PDF'
        || !matchedReport || !editionSuffix.test(suffix)
        || /摘要|英文|英语|English|取消|作废|提示性公告/i.test(title)) return [];
      if (!/^finalpage\/\d{4}-\d{2}-\d{2}\/\d+\.PDF$/i.test(item.adjunctUrl || '')
        || !/^\d+$/.test(String(item.announcementId)) || seen.has(String(item.announcementId))) return [];
      seen.add(String(item.announcementId));
      const timestamp = Number(item.announcementTime);
      if (!Number.isFinite(timestamp) || timestamp <= 0) return [];
      return [{
        announcementId: String(item.announcementId), title, companyCode: `${code}.${exchange}`,
        companyName: item.secName || security.zwjc, reportYear: year, period: scope.period,
        quarter: scope.period === 'annual' ? null : quarter,
        sourceUrl: `https://static.cninfo.com.cn/${item.adjunctUrl}`,
        publishedAt: new Date(timestamp).toISOString(),
      }];
    }).sort((a, b) => Number(/修订|更新|更正/.test(b.title)) - Number(/修订|更新|更正/.test(a.title))
      || Date.parse(b.publishedAt) - Date.parse(a.publishedAt)).slice(0, 5);
  } catch (error) {
    if (signal?.aborted) throw signal.reason || error;
    if (timeout.aborted) throw sourceError('巨潮检索在 20 秒内未完成', error);
    if (error.code === 'DISCLOSURE_SEARCH_FAILED') throw error;
    throw sourceError(error.message || '无法连接巨潮公开接口', error);
  }
}
