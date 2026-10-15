# Agent UI 基础组件调研：assistant-ui、AI Elements、prompt-kit

核查日期：2026-10-15。范围是前端组件与现有工程的适配，不安装依赖、不修改产品代码。下述迁移成本是基于已读源码的判断，没有通过安装实验验证。官方 Demo 能打开链接，不等于已经实测其完整交互。

## 给选型的结论

**当前最适合先看 assistant-ui 的独立组件，以及 prompt-kit 的完整聊天样例。**前者尤其适合“回答保持可见、工作过程折叠、记忆可纠正”的产品结构；后者适合在保留现有任务状态与后端的情况下，统一聊天输入、消息、滚动和工具卡片。

**旧 Vercel AI Elements 正处于迁移期，不能与新的 shadcn/ui AI Elements 混为一谈。**其官网和官方仓库均已公告：当前项目将在 2026 年 11 月底弃用并转向 shadcn/ui。新项目应评估新版本，旧组件主要作为设计和迁移参考。这不是说已复制的源码届时不能运行，而是后续维护路径改变。[官方公告](https://github.com/vercel/ai-elements#readme)

| 候选 | 最突出的适配价值 | 主要成本 | 建议角色 |
| --- | --- | --- | --- |
| assistant-ui | 完整聊天交互框架；也能只用 props 驱动的 RunActivity、Sources、MemoryChips | 整体接入要写外部状态适配；成套样式需与当前 CSS 协调 | 若要长期做通用 Agent 工作台，值得优先试听与试装；首步可只换独立组件 |
| 旧 Vercel AI Elements | 工具状态、来源、输入附件、流式文本的视觉组件完整 | Tailwind 4 / shadcn 引入；官方示例围绕 AI SDK；当前有弃用迁移公告 | 不建议现在把旧仓库作为新一轮整体重构基础 |
| prompt-kit | 轻量、可组合、源码归自己；聊天和工具展示很直接 | 需引入 shadcn / Tailwind 依赖并继续自管任务状态；完整示例的 AI SDK 版本需检查 | 若先追求界面一致性并保留现有后端，适合低耦合替换 |

## 当前工程的事实边界

当前 `package.json` 是 React 19.3.1、Vite 8.3.4、JSX、定制 CSS；没有 Tailwind、shadcn、AI SDK。`src/App.jsx` 通过 `/api/tasks` 和 `/api/tasks/:id/messages` 发起任务，再轮询任务状态；`RunStatus.jsx` 和 `PersonalMemory.jsx` 已有运行记录与个人记忆接口。**这些现成能力不应为换 UI 被推倒。**组件库也不会自动实现 MCP、证据核验、记忆禁用、版本归属和失败恢复。

## 1. assistant-ui

### 直接看什么

- [官网与完整聊天预览](https://www.assistant-ui.com/)
- [Thread 实际组件 Demo](https://www.assistant-ui.com/elements/thread)
- [RunActivity 实际组件 Demo](https://www.assistant-ui.com/elements/run-activity)
- [Sources 实际组件 Demo](https://www.assistant-ui.com/elements/sources)
- [MemoryChips 实际组件 Demo](https://www.assistant-ui.com/elements/memory-chips)
- [官方文档](https://www.assistant-ui.com/docs)
- [官方仓库](https://github.com/assistant-ui/assistant-ui)
- [MIT 许可证](https://github.com/assistant-ui/assistant-ui/blob/main/LICENSE)

### 已核实的能力

它有不带固定视觉样式的组合式 primitives 和带样式的、复制到项目里的 Elements。现有后端可通过 `ExternalStoreRuntime` 接入：由应用提供消息、转换方法、发送、取消、编辑等 callbacks。AI SDK 是可选集成路径，**不是必须替换后端的前提**；自己的状态、同步与持久化仍可保留。[架构](https://www.assistant-ui.com/docs/architecture)、[ExternalStoreRuntime](https://www.assistant-ui.com/docs/runtimes/custom/external-store)

Thread、Composer、消息操作、滚动、附件、工具 renderer、会话列表等有现成接口；能显示流式更新，但传输、工具执行、附件存储和历史数据库仍需接线。React 包明确声明兼容 React 18 或 19；未做当前 Vite 8 的安装验证。[React 包声明](https://github.com/assistant-ui/assistant-ui/blob/main/packages/react/package.json)、[API 目录](https://www.assistant-ui.com/docs/api-reference/overview)

**最贴合本产品的三个现成部件：**

- `RunActivity` 可以把公开工作消息与工具过程收成一条可展开记录，最终回答留在外面。它也有不要求 runtime 的 props 版；需要由我们提供稳定 ID、真实运行状态、时间、内容分类，不能把停止或失败映射成完成。[组件机制](https://www.assistant-ui.com/elements/run-activity)
- `Sources` 有 runtime 来源 chip 和独立卡片两条路径。现有证据可映射成来源卡，但财报期间、指标口径、定位字段、主张支持关系仍要保持我们的领域展示。[来源组件](https://www.assistant-ui.com/elements/sources)
- `MemoryChips` 有独立 `chips` / `onForget` 接口。**官方明确说明它没有内建长期记忆概念**；示例从 `remember` 工具调用取值，并不会替我们管理历史事实。可以轻量显示“本次沿用/刚更新”，但不能替代当前带出处、版本、禁用状态的记忆管理。[记忆组件](https://www.assistant-ui.com/elements/memory-chips)

### 适配建议与代价（推断）

最小接入是仅用独立的活动、来源组件，保留当前请求与轮询，不产生第二份任务真源。若全量换 Thread，需要把任务 revision、历史结果、研究/核验记录、停止和错误转换成 runtime 消息与回调；必须避免默认的“消息编辑/重试”绕过现有版本检查。

优点是交互基础较完整、可逐步接入、适合未来多会话。代价是 runtime 心智和适配层比纯 UI 多；“会话持久化”不等于我们的个人研究记忆。独立组件局部替换成本较低，完整聊天 runtime 迁移成本中等至高。

## 2. Vercel AI Elements（旧项目）

### 直接看什么

- [首页与视觉预览](https://elements.ai-sdk.dev/)
- [完整 Chatbot 示例](https://elements.ai-sdk.dev/examples/chatbot)
- [Tool 状态 Demo](https://elements.ai-sdk.dev/components/tool)
- [PromptInput 附件输入 Demo](https://elements.ai-sdk.dev/components/prompt-input)
- [官方文档与安装前提](https://elements.ai-sdk.dev/docs/setup)
- [官方仓库与迁移公告](https://github.com/vercel/ai-elements)
- [Apache-2.0 许可证](https://github.com/vercel/ai-elements/blob/main/LICENSE)
- [新的 shadcn/ui AI Elements 入口](https://ui.shadcn.com/docs/ai-elements)（新版本应单独评估）

### 已核实的能力与边界

这是基于 shadcn 的源码组件 registry，复制到自己的代码库中，能改布局和样式。官方当前安装文档要求 React 19、Tailwind CSS 4、shadcn、已配置的 AI SDK，并以 Next.js 为标准前提；因此不能承诺 CLI 在现有裸 Vite 项目直接无改动安装。[安装说明](https://elements.ai-sdk.dev/docs/setup)、[使用说明](https://elements.ai-sdk.dev/docs/usage)

现成展示覆盖消息、Conversation 滚动、附件输入、工具输入/输出/错误、来源、任务与推理区块；工具组件采用 AI SDK 的 `ToolUIPart` 状态约定。[Tool](https://elements.ai-sdk.dev/components/tool)、[Sources](https://elements.ai-sdk.dev/components/sources)、[PromptInput](https://elements.ai-sdk.dev/components/prompt-input)

**源码层面不必为了渲染一张 Tool 卡更换 Node 后端。**例如 Tool 源码对 `ai` 使用的是 type import；我们可以给它映射好的状态和内容。不过整套照搬 `useChat` 示例则需要实现它期待的消息/流协议，现有任务 API 不能直接当作兼容接口。[Tool 源码](https://github.com/vercel/ai-elements/blob/main/packages/elements/src/tool.tsx)

### 适配判断（推断）

优点是标准聊天/工具/来源视觉语言统一，与 shadcn 生态搭配直接；定制表格、财报卡等仍须我们设计。缺点是现有 custom CSS 到 Tailwind 4 的协调成本，以及当前明确的维护迁移。局部搬组件成本中等；用旧完整示例重建聊天成本较高，当前不建议。

## 3. prompt-kit

### 直接看什么

- [官方站](https://www.prompt-kit.com/)
- [官方安装文档](https://www.prompt-kit.com/docs/installation)
- [完整 Chatbot 样例](https://www.prompt-kit.com/primitives/chatbot)
- [Tool calling 样例](https://www.prompt-kit.com/primitives/tool-calling)
- [官方仓库](https://github.com/ibelick/prompt-kit)
- [MIT 许可证](https://github.com/ibelick/prompt-kit/blob/main/LICENCE.md)

可点击的样例地址由官方 `llms.txt` 提供；本次 web 抓取官方站及样例被 403/不可访问阻断，**没有实测其线上渲染或聊天**。组件能力改由官方仓库源码交叉检查，视觉选择前应由主 Agent 或用户在浏览器里看实际样例。[官方地址索引](https://github.com/ibelick/prompt-kit/blob/main/llms.txt)

### 已核实的能力与边界

安装方式是先配置 shadcn，再逐个复制组件。官方项目使用 React 19、Tailwind 和 Next.js，但查到的 `Message`、`ChatContainer`、`FileUpload`、`Tool` 组件本身并不调用 Next 后端 API 或强制 `useChat`。[README](https://github.com/ibelick/prompt-kit#readme)、[依赖](https://github.com/ibelick/prompt-kit/blob/main/package.json)

具体可用：

- `Message` 提供头像、正文、Markdown 与操作槽。[消息源码](https://github.com/ibelick/prompt-kit/blob/main/components/prompt-kit/message.tsx)
- `ChatContainer` 用 `use-stick-to-bottom` 处理聊天滚动。[滚动源码](https://github.com/ibelick/prompt-kit/blob/main/components/prompt-kit/chat-container.tsx)
- `PromptInput` 提供受控输入和组合式操作。[输入源码](https://github.com/ibelick/prompt-kit/blob/main/components/prompt-kit/prompt-input.tsx)
- `Tool` 接收输入、输出、错误与四类处理状态，可接我们的工具记录，不负责执行工具。[工具源码](https://github.com/ibelick/prompt-kit/blob/main/components/prompt-kit/tool.tsx)
- `FileUpload` 负责拖拽/选择并通过 `onFilesAdded` 回调交给业务；不代表附件已经上传、解析或进入研究依据。[附件源码](https://github.com/ibelick/prompt-kit/blob/main/components/prompt-kit/file-upload.tsx)

官方还列出 Source、Steps、ThinkingBar、FeedbackBar 等组件；没有据此确认它提供了持久化会话管理或长期记忆引擎。`response-stream` 官方描述是客户端模拟逐步显示，**不能把这种动画当成真实模型流式输出**。[组件索引](https://github.com/ibelick/prompt-kit/blob/main/llms.txt)

### 适配判断（推断）

对现有后端最轻的路径是只复制 Input / Message / ChatContainer / Tool，并以现有 task 状态驱动，不接完整 AI SDK 样例。React 19 匹配；Vite 的 JSX/路径别名、TSX 类型移除或配置、Tailwind 与 shadcn 依赖要实际处理。没有发现必须更换服务器的理由，但也没有做 Vite 8 的装包验证。

优点是易分步替换，保留当前个人记忆、Trace 和版本逻辑；缺点是会话持久化、运行恢复、错误重试、记忆编辑仍需自己维护，库不会替我们统一这些状态。局部替换成本低至中等，整体视觉统一成本中等。

## 不论选择哪家，都应保留的产品机制

1. 阶段结论与用户下一步判断保持可见，取证过程按需展开。
2. 记忆提示区分“本次沿用”“正在保存”“已停用”；成功保存由后端结果决定。
3. 每条证据保留公司、期间、字段/口径及来源定位，通用链接 chip 不足以代替。
4. 停止、失败、过期结果、用户修正和当前版本沿用现有契约；UI 能力按后端真实支持打开。
5. 不同时装多个聊天 runtime；先选一个主体系，再补少量无状态视觉部件，避免两套滚动、输入、消息存储互相控制。

以上是选型审查建议，不是新增功能已实现的声明。
