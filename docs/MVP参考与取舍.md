# MVP 参考与取舍

检索日期：2026-10-15（Asia/Taipei）。本轮限定为4个参考，先检索GitHub、官方文档、npm和Product Hunt，再将适合的交互用于已有MVP。没有克隆或安装完整参考项目，也没有复制其业务代码；已安装用户指定的liquid-gooey组件。

## 采用方向

保留标准 Agent 对话骨架：左侧任务、顶部 Bot 切换、中间消息与输入框、按需展开的来源和工作记录。首次结果直接回答“信息改变了什么判断、依据是什么、还有什么未知”；补查后展示实际变化。用户不必阅读 Bot 交流才能完成主要任务。

Gooey 是局部动效库，不是完整聊天组件库。使用真实 `liquid-gooey` React 包，适用于输入区快捷操作或 Bot 切换的小范围合并效果；正文、数字、引用和表格保持稳定、清晰。实际是否已集成及固定版本，以本项目 `package.json`、锁文件和界面检查为准，本检索记录不代替实现验收。

## 参考表

| 参考与原始来源 | 可复用内容 | 许可与依赖成本 | 本次采用与不采用的理由 |
| --- | --- | --- | --- |
| **assistant-ui**：[官方 GitHub](https://github.com/assistant-ui/assistant-ui)、[LICENSE](https://github.com/assistant-ui/assistant-ui/blob/main/LICENSE) | React 聊天的 Thread / Message / Composer / ThreadList 组织；工具返回可渲染为界面组件；支持自定义后端 runtime。 | MIT。完整接入需要 runtime 适配，官方快速路径会添加其 React、AI SDK 适配等包。 | **借交互组织思路**：消息主线、独立输入区、按需呈现工具结果。当前不换整套 runtime，避免为现有任务 API 做额外迁移；本轮未复制代码。 |
| **LangChain Agent Chat UI**：[官方 GitHub](https://github.com/langchain-ai/agent-chat-ui)、[LICENSE](https://github.com/langchain-ai/agent-chat-ui/blob/main/LICENSE) | 标准对话前端；将辅助内容放到右侧 artifact 面板；支持控制哪些内部消息对用户展示。 | MIT。现成应用为 Next.js，围绕 LangGraph server 的消息和线程接口构建；部署另有认证接入工作。 | **借渐进展开与侧栏思路**：默认读结果，按需看资料与 Bot 工作消息。现有后端不为套模板而迁移到 LangGraph；本轮未复制代码。公开工作消息限实际任务请求、资料返回、核验和修正，不展示隐藏推理。 |
| **Libraries.dev / liquid-gooey**：[官方文档](https://libraries.dev/gooey)、[npm 包](https://www.npmjs.com/package/liquid-gooey)、[源包声明](https://github.com/Jakubantalik/Libraries/blob/main/packages/liquid-gooey/package.json)、[MIT 原文](https://github.com/Jakubantalik/Libraries/blob/main/LICENSE) | `Liquid` 与 `Liquid.Item`；`blur`、`contrast`、`fill`、`shadow`；`x`、`y`、`transition` 等接口。 | MIT。源包声明 `react` 与 `react-dom >=18` 为 peer dependencies；没有声明其他运行时 dependencies。npm 与仓库抓取版本不同，必须以实际安装版本类型为准。 | **按用户要求作为本轮实现依赖**，只做少量操作按钮的液态效果。正常文字层保持可读；不将动效覆盖所有内容，不使用 Melt/Bend 等本任务不需要的效果。公开调用示例可按 MIT 使用；本检索没有复制库源码。 |
| **FinChat（Product Hunt 发布页）**：[产品发布页](https://www.producthunt.com/products/finchat-chatgpt-for-finance)、[作者 V3 介绍](https://newsletter.finchat.io/p/introducing-finchat-v3) | 发布方将公司财务指标与报告、电话会等文字材料放到研究问答中；这为“数字、文字材料、追问在同一个任务里”提供产品参照。 | 商业产品，未核实有可复制的开源代码或设计资产许可。页面介绍不能证明准确性、投资收益或用户价值。 | **只借研究入口思路**：围绕问题整合结构化指标与原始材料。此次没有登录体验，官网访问受限、发布页图片抓取失败，因此不声称观察到当前完整交互，更不复制界面资产、代码或营销指标。 |

## Gooey 核实边界

- 用户提供的 `https://libraries.dev/gooey.html` 当前重定向到 `https://libraries.dev/gooey`；页面包含给出的安装命令与主要 API。
- npm 可读页面返回版本 `0.2.2`、MIT；源仓库 `package.json` 的本次抓取为 `0.2.1`。版本差异可能来自抓取缓存或发布节奏，不据此断言安装时的最新版本。直接读取 npm registry 在本机沙箱内因域名解析失败而未完成。
- [源 README](https://github.com/Jakubantalik/Libraries/blob/main/packages/liquid-gooey/README.md) 说明采用独立 silhouette 与 DOM 内容层，支持减少动态效果设置；Safari 兼容属于作者声明，本次检索没有进行 Safari 运行验证。
- 不采用相似名称的第三方移植包；使用用户指定的 `liquid-gooey`。
- 实际安装核实：本项目固定liquid-gooey 0.2.2、React/React DOM 19.3.1；直接读取本地包声明、MIT文件及dist/index.d.ts，按真实API实现Liquid与Liquid.Item。动态效果是否可用另由浏览器验收。

## 转成当前 MVP 的可检查标准

1. 默认只与主 Bot 对话；顶部能进入其他 Bot，看到该任务实际保存的工作消息，并加入提问。
2. 首次回答可直接看懂阶段判断，来源按需展开；关键缺口不能藏在工作记录中。
3. 补查后明确显示新增证据如何改变、强化或保留原判断；没有变化时如实说明原因。
4. 用户修改问题后，旧版本消息仍可查看，但不能冒充当前结论。失败状态明确，上一版有效结果保留。
5. Gooey 不阻挡点击和键盘操作；桌面、移动端下输入区与操作按钮不重叠，正文不因滤镜模糊。

## 本轮能证明什么

检索证明存在可用组件、模板和产品思路，支持快速制作可视、可操作 MVP。后续的构建、接口和视觉检查，只能证明所检查的实现范围。当前没有完成真实用户研究，也不能据这些参考声称多 Bot 优于分步单 Agent，或产品已经验证能改善投资判断。
