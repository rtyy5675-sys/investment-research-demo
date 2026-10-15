# Agent UI 组件库补充调研

核查日期：2026-10-15。范围：官方文档、官方仓库、包声明及许可文件；未安装、未跑接入实验，也未对演示页做视觉实测。本文不以 Star 数排名。X 发现线索由主任务另行整理。

现有工程为 React 19.3.1、Vite 8.3.4、普通 CSS、`react-markdown`，后端为现有 Node 任务 API。以下方案均按“保留 MCP、研究任务版本、个人记忆和 Trace，只适配展示组件”评价。**适配成本与自建缺口属于基于文档和当前工程的推断，不是已完成迁移的结论。**

## 先给判断

| 方案 | 适合本产品的理由 | 当前工程需要付出的主要成本 | 建议位置 |
| --- | --- | --- | --- |
| Ant Design X | 会话、发送器、工具状态、来源和富文本组件覆盖完整；中文文档丰富 | 增加 Ant Design 6 及主题系统，替换现有控件并适配任务数据 | 希望聊天和研究工作状态一起统一时优先预览 |
| Lobe UI | 同时有聊天与文档式回答、可调宽面板、Markdown，可覆盖整个工作台 | 增加 antd、motion、主题 Provider；核对现有 CSS 与主题边界 | 偏成熟 AI 工作台视觉时优先预览 |
| prompt-kit | 组件源码归项目，Tool / Source / Message 较容易做精细定制 | 增加 shadcn / Tailwind 环境，应用壳与复杂状态仍需自己组织 | 偏克制的 Claude 类对话视觉时优先预览 |
| coss ui | 通用控件、Composer、Chat UI 可统一侧栏/弹层/输入区 | 引入 Base UI + Tailwind；AI 工具与研究证据呈现需自己补 | 可选基础设计系统，不宜当成完整 Agent 运行界面 |

## 1. Ant Design X

类型：React AI 交互组件库；`x-sdk` 是可选数据流工具，`x-card` 是另一套动态卡片渲染能力，不能把三个包当成必须整体替换的后端。

官方核实：`Bubble`、`Conversations`、`Sender` 能承接消息、会话列表与发送器；`ThoughtChain` 可展示工具/动作节点的 loading、success、error、abort；`XMarkdown` 支持扩展组件映射。库当前包声明为 React ≥18、antd ^6.1.1，因此 React 19 在其声明范围内，仍需实际构建确认。

适配判断：保留现有 API 请求与状态管理，直接把 task/messages/trace 映射到受控组件即可；不必先切 `useXChat`。研究记忆、观点归属、版本失效和保存失败语义仍归现有应用。默认 Ant 风格需要调排版、间距、颜色，不能认为安装后就自动获得本产品的视觉。

许可：官方包声明 MIT。

- [官方文档](https://x.ant.design/) · [中文组件技能目录（可核对组件范围）](https://x.ant.design/x-skills/skills-cn)
- [官方仓库](https://github.com/ant-design/x) · [包与依赖声明](https://github.com/ant-design/x/blob/main/packages/x/package.json)
- [完整对话 Demo](https://x.ant.design/docs/playground/independent/) · [Bubble 示例](https://ant-design-x.antgroup.com/components/bubble) · [工具调用状态示例](https://x.ant.design/components/thought-chain-cn/)
- [Markdown 扩展接口](https://x.ant.design/x-markdowns/components/)

## 2. Lobe UI

类型：`@lobehub/ui` React 组件库，**区别于 LobeHub / LobeChat 整套产品**。整套产品的 MCP 市场、知识库、账号、记忆和模型连接能力不能直接算入 UI 库。

官方核实：独立 `/chat` 导出下有 `ChatList`、`ChatItem`、`ChatInputArea`；ChatList 支持 bubble/docs 布局、角色内容与动作自定义、历史分隔及错误显示。ChatInputArea 提供中文输入组合事件、发送/停止和附加操作区域。另有 Markdown、Drawer、DraggablePanel、SideNav，及中英文 i18n 资源。当前仓库 peer 声明 React ^19、antd ^6.1.1、motion ^12，并标注 ESM only。

适配判断：文档式长回答和可调宽证据/记忆栏与现有工作台匹配；需要映射原任务结构及 Tool/Trace 卡片。组件库具备替换整套通用控件的条件，但依赖和 Provider 比纯源码组件多。记忆编辑、失效、来源和任务 revision 必须继续调用现有实现。

许可：Lobe UI 仓库 LICENSE 为 MIT；不可用它推断 LobeHub 整套产品许可证。

- [官方文档与组件总览](https://ui.lobehub.com/)
- [官方仓库](https://github.com/lobehub/lobe-ui) · [包声明](https://github.com/lobehub/lobe-ui/blob/master/package.json) · [MIT 许可](https://github.com/lobehub/lobe-ui/blob/master/LICENSE)
- [聊天列表 Demo/API](https://ui.lobehub.com/components/chat/chat-list) · [输入区 Demo/API](https://ui.lobehub.com/components/chat/chat-input-area)
- [可调宽侧栏 Demo/API](https://ui.lobehub.com/components/draggable-panel) · [Markdown Demo/API](https://ui.lobehub.com/components/markdown) · [中文资源](https://ui.lobehub.com/components/i18n)

## 3. prompt-kit

类型：基于 shadcn/ui 的 AI 界面源码组件集合，不是 Agent 编排框架。官方 README 要求先配置 shadcn/ui，再逐项添加组件。

官方核实：官方 `llms.txt` 列出 PromptInput、Message、ChatContainer、Markdown、Loader、Tool、Source。Tool 负责展示输入、输出、状态与错误；Source 是引用来源的悬浮信息。官方仓库使用 React 19 与 Tailwind。文档站本次被搜索抓取工具返回 403；组件身份和能力由官方 GitHub 的索引及源码佐证，**未宣称已经打开或视觉验收其在线 Demo**。

适配判断：对现有定制 CSS 改动较大，需要建立 Tailwind/shadcn 基础。组件源码可自己改，适合精修本产品排版、引用和工具状态；现有 Node API 可继续受控传入。完整会话侧栏、研究记忆管理及重试/取消/版本语义依然需要自己组织。仓库内 Next.js 是文档站实现，不能据此认定使用单个组件必须迁移到 Next.js；具体 Vite 接入仍需小实验。

许可：MIT。

- [官方文档](https://www.prompt-kit.com/docs/installation) · [官方 Demo 入口](https://www.prompt-kit.com/)
- [官方仓库](https://github.com/ibelick/prompt-kit) · [MIT 许可](https://github.com/ibelick/prompt-kit/blob/main/LICENCE.md)
- [官方组件索引与源码链接](https://github.com/ibelick/prompt-kit/blob/main/llms.txt)
- [Tool 源码](https://github.com/ibelick/prompt-kit/blob/main/components/prompt-kit/tool.tsx) · [Source 源码](https://github.com/ibelick/prompt-kit/blob/main/components/prompt-kit/source.tsx)

## 4. coss ui：身份核查后作为基础库备选

已核实的项目是 `cosscom/ui`，即 Cal.com 设计系统；未查到可确认为同一维护方的独立 **“Coss AI Kit”**。网上同名 AI Kit 还可能是 AI SDK、编码 Agent 技能集，不能混用名称或能力。

官方核实：coss ui 使用 Base UI、Tailwind CSS 4，采用拷入组件源码的方式；Composer 支持自动增高、固定动作区、mentions/slash 命令和 textarea。当前还有 Chat UI 组件家族：消息行、滚动跟随、跳到最新、引用、分组、反应与抽屉示例。该家族使用 React 19；官方明确消息、持久化和授权归应用所有，Demo 使用合成对话及模拟动作。

适配判断：非常适合统一菜单、弹层、表单与 Composer，但现成 Chat UI 的主要场景包含群聊/私聊。研究证据、工具执行链和阶段判断仍需定制；不能仅凭聊天演示认为它已覆盖 Agent 功能。中文文案可受控替换，但中文 IME、移动输入和长 Markdown 需要实际验收。

许可需要按目录定位：仓库默认 AGPL；官方 LICENSING 声明 `apps/ui/`、`apps/origin/` 为 MIT。不能把仓库顶层 AGPL 或“全项目 MIT”简单套到所有文件。接入时记录实际复制的组件路径和许可。

- [官方文档](https://coss.com/ui/docs/get-started) · [官方组件与 Demo](https://coss.com/ui)
- [官方仓库](https://github.com/cosscom/ui) · [目录级许可说明](https://github.com/cosscom/ui/blob/main/LICENSING.md)
- [Chat UI 指南与交互 Showcase 入口](https://coss.com/ui/docs/chat) · [Composer 示例](https://coss.com/ui/docs/components/composer)

## 给主任务的实施建议

先让用户看同一份研究内容在候选库中的真实呈现，再决定库。建议比较同一个完整界面状态：长答案、折叠工具调用、可核对引用、任务失败/取消、记忆暂停、证据抽屉、手机输入。普通库 Demo 的“漂亮首页”不足以判断本产品是否更易读。

本轮未安装依赖、未改 UI 代码、未修改 MCP/记忆/Trace/后端，未进行迁移或视觉实测。上述官方能力与工程适配推断分开记录，等待用户选型。
