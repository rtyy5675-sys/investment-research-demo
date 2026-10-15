# MCP接入与验证

> 此页保留此前固定案例版本的记录。当前通用产品见[通用研究产品](通用研究产品.md)。
## 当前状态

扶摇MCP客户端与产品研究流程已实现。用户填写Key后，已实际完成利润表、现金流量表、资产负债表取数，三类报表均严格筛选2024/2023年度。当前账号工具发现返回21项；此前匿名发现为22项，不假定账号权限与匿名目录相同。

此前缺Key的记录保留；用户已填写Key后，发现上游区间取数的默认参数冲突并修复。三类报表真实取数已通过，MCP模式的完整模型研究与补查仍需分别记录。此前年报资料包实例保持原来源，没有改标为MCP输出。

## 填写后如何操作

1. 本机 `.env.local` 中填写 `FUYAO_API_KEY=你的Key` 并保存。文件被Git忽略，密钥不发送到浏览器；不需要重启后端。
2. 打开产品顶部“扶摇MCP”或更多菜单“数据连接与验证”，点“刷新配置状态”，再点“验证连接与取数”。“已配置”只表示有值；只有实际利润表查询成功才显示验证成功。
3. 新会话选择扶摇MCP并发送研究问题。已有会话保留原数据来源。取数权限错误、业务错误、超时、空数据、缺失关键字段会明确失败；补查失败保留上一版有效结果。

## 已实现的实际调用

使用官方SDK的StreamableHTTP传输，初始化、发现工具、通过tools/call查询：

- 利润表：`get_a_share_financials_income_statements`
- 现金流量表：`get_a_share_financials_cash_flow_statements`
- 资产负债表：`get_a_share_financials_balance_sheets`

参数固定为TEST-COMPANY.SZ、annual、limit=20，不传start/end；在实际响应中只保留并验证2023/2024年度。托管MCP会在区间请求时补默认limit，导致code=1004，因此改用单一最近N期模式；目标年度缺失仍失败，不取最近年份替代。首次利润表，补查由模型选择现金流和资产负债工具；不将任意工具或外部写操作交给模型。首次证据仍需年报实物销量，后续产销存和分部资料亦来自年报摘录，这些清楚保留CATL来源，MCP证据另有FUYAO前缀。

真实响应按业务code而不是HTTP状态判断。上游鉴权错误的data:null与其成功输出schema不一致，因此使用官方SDK的低层request验证MCP返回外形，再显式检查业务信封、年度、公司、币种及必需字段。null不补零，元不当成千元，未取得的证据不能引用。证据保存原始字段、披露日、查询时间、工具名和参数；任务toolRuns保留每次工具执行状态。

本次MCP查询不能还原2025-03-15当时数据库里的值，可能包括后续重述，界面和提示均说明这个边界。“购建长期资产支付的现金”不等于全部资本投入；资产负债表财务金额不替代电池库存实物量。

## 已检查与未检查

已完成构建、语法检查、本机API联调及浏览器界面检查。缺Key的新任务明确failed、result=null、evidence=0、modelCalls=0；验证面板显示未配置/尚未验证通过；旧实例仍能加载。没有在缺凭据时重跑消耗模型的完整对照。

最初鉴权检查（原始记录本地保留；参见[公开测试摘要](evidence/public-test-summary.json)）；有效Key参数修复与三表取数检查（原始记录本地保留；参见[公开测试摘要](evidence/public-test-summary.json)）；界面（历史附件未随公开版本分发）。三类财务取数和字段校验现已通过（见参数修复记录）；完整模型研究与补查链路仍需独立验证，不能用单独取数代替。

## iFinD

已核实实际地址为`https://api-mcp.51ifind.com:8643/ds-mcp-servers/hexin-ifind-ds-mcp`，需要`Authorization`携带个人MCP密钥原文。无凭据实际initialize返回HTTP401、Gateway authentication failed。目前没有接入其查询，不把附件中的门户页当作MCP端点。

官方依据：[扶摇MCP概览](https://fuyao.aicubes.cn/docs/mcp/overview/)、[财务字段](https://fuyao.aicubes.cn/docs/api-reference/financials/)、[iFinD官方门户](https://mcp.51ifind.com/)、[官方客户端SDK](https://github.com/modelcontextprotocol/typescript-sdk)。

公开版附件说明：上述未分发的历史附件不作为本包可点击文件；当前可用图片见[精选截图索引](提交材料/06_截图索引.md)。
