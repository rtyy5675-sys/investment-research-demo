# prompt-kit 本地接入说明

## 来源与边界

- 官方仓库：https://github.com/ibelick/prompt-kit
- 固定提交：`5a9496635cc0e1bf7679fe2a9e35d9b36b99c08a`（2026-10-15 下载时的 `main`）
- 原始目录：[components/prompt-kit](https://github.com/ibelick/prompt-kit/tree/5a9496635cc0e1bf7679fe2a9e35d9b36b99c08a/components/prompt-kit)
- 原始组件：`message.tsx`、`prompt-input.tsx`、`chat-container.tsx`、`tool.tsx`、`source.tsx`。
- MIT 许可、Copyright (c) 2025 Julien Thibeaut。完整原文随源码保存在 `src/components/prompt-kit/LICENCE.md`（上游文件名即 `LICENCE.md`）。
- 这是可编辑的 UI 源码适配，不是安装整个上游应用，也未引入上游示例的 AI SDK、Next.js 或模型运行时。
- 组件只呈现调用方提供的数据与事件。任务提交、停止、MCP、记忆政策、版本、Trace 和保存机制仍由现有产品负责。

## 本地改动

| 组件 | 保留与适配 |
| --- | --- |
| Message | 保留 Message/Avatar/Content/Actions/Action 组合；Avatar 直接使用共同的 Radix 基础；不带入上游另一个 Markdown/Shiki 渲染栈。可继续嵌入产品现有 Markdown。 |
| PromptInput | 保留受控/非受控输入上下文、自动高度和 tooltip action；使用原生 textarea；支持外部 React 19 ref；中文 IME 合成中和 keyCode 229 不进入任一提交处理；其余键先交调用方 onKeyDown；点击内部按钮不抢焦点。 |
| ChatContainer | 保留 `use-stick-to-bottom` 组合；默认 resize 从 smooth 改为 instant，避免持续滚动动画。用户离开底部后由该库暂停自动跟随；调用方不应再每次更新强制 scrollIntoView。 |
| Tool | 保留真实 state、input/output/error/callId 的可展开记录；文案中文化、状态颜色收敛；允许 `title` 展示用户能理解的工具名称，原 toolPart.type 仍由数据保留；output 可为字符串或其他原始 JSON 值。 |
| Source | 保留 hover-card 组合；支持 `onOpen` 打开已有产品依据面板；外部来源仅接受 HTTP(S)；移除 Google favicon 请求；键盘和触屏仍可直接点击，不依赖 hover 才能查看资料。 |

整合补充：ChatContainer 增加共享滚动上下文驱动的“回到对话底部”按钮；外层不再滚动，内部仅保留一个实际滚动容器。Source 点击打开资料抽屉后抑制当前悬浮预览，下一次 pointer enter 才恢复，避免延迟预览覆盖抽屉。

## 依赖与基础

已有或由主 Agent 集中安装：`react`、`react-markdown`、`lucide-react`、`radix-ui`、`use-stick-to-bottom`；共享基础使用 `@/lib/utils` 的 `cn` 和 `@/components/ui/{tooltip,button,collapsible,hover-card}`。Tailwind 的 token（如 background、foreground、muted、border、ring）由全局主题提供。模块统一通过 `src/components/prompt-kit/index.ts` 导出。

## 稳定接口

```jsx
import {
  Message, MessageContent, MessageActions,
  PromptInput, PromptInputTextarea, PromptInputActions, PromptInputAction,
  ChatContainerRoot, ChatContainerContent, ChatContainerScrollAnchor,
  Tool, Source, SourceTrigger, SourceContent,
} from './components/prompt-kit';

// 保留现有的审核、金额检查与 Markdown 接口。
<Message className="assistant-turn">
  <MessageContent className="assistant-body bg-transparent p-0">
    <Markdown>{actualText}</Markdown>
  </MessageContent>
</Message>

// 原 form onSubmit 与 submit 路径保持不变。
// PromptInput 的 onSubmit 仅作 Enter 回调，按钮仍可 type=submit。
<form onSubmit={existingFormSubmit}>
  <PromptInput value={input} onValueChange={setInput}
    onSubmit={() => existingSubmit()} isLoading={posting} maxHeight={180}>
    <PromptInputTextarea ref={inputRef} aria-label="向研究助手提问" />
    <PromptInputActions className="justify-between">
      <div>{/* 附加操作：保留现有 Liquid/资料操作 */}</div>
      <div>{/* 当前研究方式或资料状态 */}</div>
      <div>{/* 现有停止按钮 / type=submit 发送按钮 */}</div>
    </PromptInputActions>
  </PromptInput>
</form>

// 同一模型、资料、任务数据，无第二个运行时。
<Tool title="查询利润表" toolPart={{
  type: actualToolName,
  state: actualState,
  input: actualInput,
  output: actualOutput,
  toolCallId: actualCallId,
  errorText: actualError,
}} />

// 本地证据通过点击/键盘打开原依据面板，不强制外跳。
<Source href={evidence.sourceUrl} onOpen={() => openEvidence(evidence.id)}>
  <SourceTrigger label="利润表" aria-label={`查看依据：${evidence.title}`} />
  <SourceContent title={evidence.title} description={evidence.locator} />
</Source>

// 使用时不要再把 .conversation-scroll 当作真正滚动 DOM；
// StickToBottom 自己拥有内部滚动层，App 的滚动策略需统一。
<ChatContainerRoot initial={false} className="min-h-0 flex-1">
  <ChatContainerContent className="conversation-inner">
    {actualTurns}
    <ChatContainerScrollAnchor />
  </ChatContainerContent>
</ChatContainerRoot>
```

注意：若 App 保留自己的 onKeyDown Enter 发送处理，就不要再给 PromptInput 的 onSubmit 绑定另一条提交路径；若 App onKeyDown 调用 preventDefault，组件会尊重它。`isLoading` 只暴露当前状态，不自动禁用输入、不发送、不停止；是否禁用由产品原规则决定。点击停止必须复用原停止 API。

## 验收责任

本次仅交付组件源码与适配说明。主 Agent 负责在 App 中组合、构建与浏览器检查，包括中文输入法、Enter/Shift+Enter、停止、滚动阅读、依据入口、手机布局。不得因为源码已接入就宣称这些行为已经运行验证。
