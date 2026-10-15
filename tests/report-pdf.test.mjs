import test from 'node:test';
import assert from 'node:assert/strict';
import { parseReportPdf, buildCashPacket, cashExtractionSchema, cashExtractionInstructions, validateCashExtraction } from '../lib/report-pdf.mjs';

const scope = { name: '示例科技', thscode: '300123.SZ', year: 2025, period: 'annual', quarter: null };
const definitions = {
 operating_cash_inflow: ['经营活动现金流入小计', '1,200.00', '1,000.00'],
 operating_cash_outflow: ['经营活动现金流出小计', '900.00', '800.00'],
 sales_cash: ['销售商品、提供劳务收到的现金', '1,100.00', '950.00'],
 purchase_cash: ['购买商品、接受劳务支付的现金', '700.00', '600.00'],
 act_cash_flow_net: ['经营活动产生的现金流量净额', '300.00', '200.00'],
};
function fixture({ unit = '元', current = '2025年度', previous = '2024年度' } = {}) {
 const header = `${current} ${previous}`;
 const rows = Object.fromEntries(Object.entries(definitions).map(([field, [label, a, b]]) => [field, { label, page: 11, quote: `${label} ${a} ${b}`, current: a, previous: b }]));
 const cover = '示例科技股份有限公司\n股票代码：300123\n2025年年度报告';
 const table = `合并现金流量表\n${header}\n单位：${unit} 币种：人民币\n${Object.values(rows).map(item => item.quote).join('\n')}`;
 const parsed = { pageCount: 12, pages: [{ page: 1, text: cover }, { page: 10, text: '合并利润表\n2025年度 2024年度' }, { page: 11, text: table }, { page: 12, text: '母公司现金流量表\n2025年度 2024年度\n单位：元 币种：人民币' }], sha256: 'test' };
 const at = (text, page, quote = text) => ({ text, page, quote });
 const extraction = { issuerName: at('示例科技股份有限公司', 1), securityCode: at('300123', 1, '股票代码：300123'), tableTitle: at('合并现金流量表', 11), unit: at(unit, 11, `单位：${unit} 币种：人民币`), currentPeriod: at(current, 11, header), previousPeriod: at(previous, 11, header), columns: { count: 2, currentIndex: 1, previousIndex: 2, page: 11, quote: header }, rows };
 return { parsed, packet: buildCashPacket(parsed, scope), extraction };
}
const copy = value => structuredClone(value);

test('通用合并现金分项：当前与同期以元归一，并给出净额变化两侧贡献', () => {
 const { packet, extraction } = fixture();
 const result = validateCashExtraction(extraction, packet, scope);
 assert.deepEqual(result.rawFields, [{ fiscal_year: 2024, operating_cash_inflow: 1000, operating_cash_outflow: 800, sales_cash: 950, purchase_cash: 600, act_cash_flow_net: 200 }, { fiscal_year: 2025, operating_cash_inflow: 1200, operating_cash_outflow: 900, sales_cash: 1100, purchase_cash: 700, act_cash_flow_net: 300 }]);
 assert.deepEqual(result.decomposition, { inflowChange: 200, outflowChange: 100, inflowContribution: 200, outflowContribution: -100, netChange: 100, reconciled: true });
 assert.equal(result.citations.length, 12);
});
test('万元和千元必须有原文单位，按明确单位换算，不补小数', () => {
 for (const [unit, multiplier] of [['千元', 1000], ['万元', 10000]]) {
  const { extraction, packet } = fixture({ unit });
  const result = validateCashExtraction(extraction, packet, scope);
  assert.equal(result.rawFields[1].sales_cash, 1100 * multiplier);
  assert.equal(result.unit, unit); assert.equal(result.normalizedUnit, '元');
 }
});
test('季度必须是明确年份的累计同期，不能将单季度当作累计', () => {
 const { extraction, packet } = fixture({ current: '2025年1—9月', previous: '2024年1—9月' });
 assert.equal(validateCashExtraction(extraction, packet, { ...scope, period: 'quarterly', quarter: 3 }).rawFields[1].fiscal_year, 2025);
 assert.throws(() => validateCashExtraction(extraction, packet, { ...scope, period: 'quarterly', quarter: 2 }), /期间不一致/);
});
test('“本期”不能猜出年份，年报不能套用半年度表', () => {
 for (const pair of [['本期发生额', '上期发生额'], ['2025年1-6月', '2024年1-6月']]) {
  const { extraction, packet } = fixture({ current: pair[0], previous: pair[1] });
  assert.throws(() => validateCashExtraction(extraction, packet, scope), /期间不一致/);
 }
});
test('原文不包含的引用、页码或金额都拒绝', () => {
 const base = fixture();
 for (const mutate of [e => { e.rows.sales_cash.quote = '销售商品、提供劳务收到的现金 1,199.00 950.00'; e.rows.sales_cash.current = '1,199.00'; }, e => { e.rows.sales_cash.page = 99; }, e => { e.rows.sales_cash.current = '1100.00'; }]) {
  const extraction = copy(base.extraction); mutate(extraction);
  assert.throws(() => validateCashExtraction(extraction, base.packet, scope), /引用不在|金额与原文/);
 }
});
test('公司名称和证券代码双重锚定，换公司失败', () => {
 const { extraction, packet } = fixture();
 assert.throws(() => validateCashExtraction(extraction, packet, { ...scope, name: '别家科技' }), /公司名称/);
 assert.throws(() => validateCashExtraction(extraction, packet, { ...scope, thscode: '600000.SH' }), /证券代码/);
 const changed = copy(extraction); changed.securityCode.quote = '300123';
 assert.throws(() => validateCashExtraction(changed, packet, scope), /明确代码标识/);
});
test('原文中即使有母公司表，也不能将其行冒充合并数据', () => {
 const { extraction, packet } = fixture();
 const row = extraction.rows.sales_cash; row.page = 12;
 packet.tablePages.find(page => page.page === 12).text += '\n' + row.quote;
 assert.throws(() => validateCashExtraction(extraction, packet, scope), /母公司/);
 extraction.tableTitle.text = '母公司现金流量表'; extraction.tableTitle.page = 12; extraction.tableTitle.quote = '母公司现金流量表';
 assert.throws(() => validateCashExtraction(extraction, packet, scope), /必须取合并/);
});
test('精确校验现金流入减流出等于净额，原文真实但不平的表也阻断', () => {
 const { extraction, packet } = fixture();
 const row = extraction.rows.act_cash_flow_net;
 packet.tablePages.find(page => page.page === row.page).text = packet.tablePages.find(page => page.page === row.page).text.replace(row.quote, row.quote.replace('300.00', '299.99'));
 row.quote = row.quote.replace('300.00', '299.99'); row.current = '299.99';
 assert.throws(() => validateCashExtraction(extraction, packet, scope), /不等于经营现金流净额/);
});
test('空白、破折号不补零；负净额保留并精确勾稽', () => {
 const base = fixture();
 for (const bad of ['', '-', '—', '0']) {
  const extraction = copy(base.extraction); extraction.rows.sales_cash.current = bad;
  assert.throws(() => validateCashExtraction(extraction, base.packet, scope));
 }
 const { extraction, packet } = fixture();
 const changes = { operating_cash_outflow: ['1,500.00', '1,100.00'], act_cash_flow_net: ['(300.00)', '(100.00)'] };
 for (const [field, [current, previous]] of Object.entries(changes)) {
  const item = extraction.rows[field], old = item.quote;
  Object.assign(item, { current, previous, quote: `${item.label} ${current} ${previous}` });
  const page = packet.tablePages.find(page => page.page === item.page); page.text = page.text.replace(old, item.quote);
 }
 assert.equal(validateCashExtraction(extraction, packet, scope).rawFields[1].act_cash_flow_net, -300);
});
test('本期/同期金额交换即使同在原文也拒绝', () => {
 const { extraction, packet } = fixture();
 [extraction.rows.sales_cash.current, extraction.rows.sales_cash.previous] = [extraction.rows.sales_cash.previous, extraction.rows.sales_cash.current];
 assert.throws(() => validateCashExtraction(extraction, packet, scope), /列顺序/);
});
test('不允许通过改写单位跨币种取数', () => {
 const { extraction, packet } = fixture();
 extraction.unit.text = '万元';
 assert.throws(() => validateCashExtraction(extraction, packet, scope), /字段与引用/);
 const foreign = fixture();
 foreign.packet.tablePages.find(page => page.page === 11).text = foreign.packet.tablePages.find(page => page.page === 11).text.replace('币种：人民币', '币种：美元');
 foreign.extraction.unit.quote = '单位：元 币种：美元';
 assert.throws(() => validateCashExtraction(foreign.extraction, foreign.packet, scope), /人民币/);
});
test('包只保留身份页和合并现金流附近页；不把整本交给模型', () => {
 const { parsed } = fixture();
 for (let n = 13; n < 100; n++) parsed.pages.push({ page: n, text: '与现金流无关的说明'.repeat(100) });
 const packet = buildCashPacket(parsed, scope);
 assert.equal(packet.identityPages.length, 1); assert.equal(packet.tablePages.length, 4);
 assert.ok(JSON.stringify(packet).length < 20000);
});
test('只有目录、母公司表或净额摘要不足以构建取数包', () => {
 const { parsed } = fixture();
 for (const text of ['目录\n合并现金流量表……11', '母公司现金流量表\n经营活动现金流入小计\n经营活动现金流出小计\n经营活动产生的现金流量净额', '合并现金流量表\n经营活动产生的现金流量净额 300 200']) {
  const changed = copy(parsed); changed.pages = [changed.pages[0], { page: 11, text }];
  assert.throws(() => buildCashPacket(changed, scope), /未找到/);
 }
});
test('超长现金表包明确失败，不静默截断金额或表头', () => {
 const { parsed } = fixture(); parsed.pages.find(page => page.page === 11).text += '\n' + '过长文字'.repeat(6000);
 assert.throws(() => buildCashPacket(parsed, scope), /20000/);
});
test('schema 所有对象都 strict 且全部键必填；提取指令隔离文档指令', () => {
 function inspect(schema) { if (schema.type === 'object') { assert.equal(schema.additionalProperties, false); assert.deepEqual([...schema.required].sort(), Object.keys(schema.properties).sort()); Object.values(schema.properties).forEach(inspect); } }
 inspect(cashExtractionSchema); assert.match(cashExtractionInstructions, /非可信资料/); assert.match(cashExtractionInstructions, /不补零/);
});
test('PDF 入口拒绝非 PDF、无效限额和已取消任务，不触发模型或网络', async () => {
 await assert.rejects(parseReportPdf(Buffer.from('not a pdf')), /不是可识别/);
 await assert.rejects(parseReportPdf(Buffer.from('%PDF-1.7'), { maxPages: 0 }), /上限配置无效/);
 const controller = new AbortController(); controller.abort();
 await assert.rejects(parseReportPdf(Buffer.from('%PDF-1.7'), { signal: controller.signal }), error => error.name === 'AbortError');
});
test('合并及公司四列表保留全行，只能选表头指明的合并两列并归一负支出', () => {
 const { extraction, packet } = fixture({ unit: '千元' });
 const page = packet.tablePages.find(page => page.page === 11);
 page.text = page.text.replace('合并现金流量表', '2025年度合并及公司现金流量表').replace('2025年度 2024年度', '2025年度 2024年度 2025年度 2024年度\n项目 附注 合并 合并 公司 公司');
 extraction.tableTitle = { text: '2025年度合并及公司现金流量表', page: 11, quote: '2025年度合并及公司现金流量表' };
 extraction.currentPeriod.quote = extraction.previousPeriod.quote = '2025年度 2024年度 2025年度 2024年度\n项目 附注 合并 合并 公司 公司';
 extraction.columns = { count: 4, currentIndex: 1, previousIndex: 2, page: 11, quote: extraction.currentPeriod.quote };
 for (const [field, item] of Object.entries(extraction.rows)) {
  const old = item.quote;
  if (['operating_cash_outflow', 'purchase_cash'].includes(field)) { item.current = `(${item.current})`; item.previous = `(${item.previous})`; }
  item.quote = `${item.label} ${item.current} ${item.previous} - -`;
  page.text = page.text.replace(old, item.quote);
 }
 const result = validateCashExtraction(extraction, packet, scope);
 assert.equal(result.rawFields[1].operating_cash_outflow, 900000);
 assert.equal(result.rawFields[1].purchase_cash, 700000);
 assert.equal(result.sourceOutflowConvention.current, 'signed-negative');
 extraction.columns.currentIndex = 3; extraction.columns.previousIndex = 4;
 assert.throws(() => validateCashExtraction(extraction, packet, scope), /四列表头/);
});
test('行名断行且金额夹在中间仍可精确锚定，不能将其他行混进引用', () => {
 const { extraction, packet } = fixture();
 const page = packet.tablePages.find(page => page.page === 11), item = extraction.rows.sales_cash;
 const old = item.quote; item.quote = `销售商品、提供劳务收到的现\n${item.current} ${item.previous}\n金`;
 page.text = page.text.replace(old, item.quote);
 assert.equal(validateCashExtraction(extraction, packet, scope).rawFields[1].sales_cash, 1100);
 item.quote += '\n' + extraction.rows.purchase_cash.quote;
 assert.throws(() => validateCashExtraction(extraction, packet, scope), /行名称不一致/);
});
