# assistant-ui RunActivity 接入记录

## 已复用什么

复用 [assistant-ui 官方 RunActivity 源码](https://github.com/assistant-ui/assistant-ui/blob/2bdd534a3d8da45e6c7a9ee6553862b83713059d/packages/ui/src/components/react/assistant-ui/elements/run-activity.tsx)，固定版本 `2bdd534a3d8da45e6c7a9ee6553862b83713059d`。官方说明：[Run activity](https://www.assistant-ui.com/elements/run-activity)。

本地文件：`src/components/assistant-ui/elements/run-activity.tsx`。保留官方 props、活动顺序、运行时仅播报状态而不播报计时、无活动时不提供空折叠按钮、attention 与最终回答位于折叠区外的行为。无需 assistant-ui runtime、provider、云服务或 AI SDK。

改动仅包括：使用项目共享的 shadcn/Radix Collapsible；用局部 `.aui-run-*` 样式适配 prompt-kit 为主的界面；entry 增加可选应用状态 `status`，仅输出 data 属性，不根据消息内容猜测成功、失败或进度。官方源码、MIT 版权与完整许可保留在 `src/components/assistant-ui/LICENSE`。

## 调用契约

```jsx
import { RunActivity } from './components/assistant-ui/elements/run-activity';

<RunActivity
  status="complete"
  statusLabel="已完成"
  durationLabel="27 秒"
  entries={entries}
  open={activityOpen}
  onOpenChange={setActivityOpen}
  attention={recoveryControls}
/>
```

`entries` 每项为 `{ id, kind: 'commentary' | 'tool', label, content, status? }`。`status?` 可取 `running | error | cancelled | pending | complete`。只传后端真实公开工作消息或工具记录，保留原顺序及稳定 ID；不填充预设的“已规划→已核验”步骤，不展示或编造模型隐式思考。

根组件持有展开状态，按 task ID 与 revision 区分研究轮次。主回答继续由外部 ResearchDecision 显示；不要在 `children` 再复制一次回答。工具参数、大段原始返回可保留在 entry.content 的二级 details 中；来源进入现有证据抽屉。

## 数据边界

- 只选择当前 revision 的公开工作消息；`from === 'user'` 不是 Agent 的运行活动，历史 superseded 消息不属于当前轮。
- `execution.stage` 是当前阶段，可作为运行摘要；不能把当前阶段推导成所有前序阶段都成功。
- task `complete` → `complete`；`running` → `running`；`cancelled` → `cancelled`；`failed` → `error`；`partial`/`budget_exhausted` → `incomplete`；需用户澄清 → `requires-action`。
- 只有 `endedAt` 存在才使用已结束计时；运行中可用持久化 `startedAt` 派生。缺少时间就不显示，不补造耗时。
- `tool_result` 是消息种类，不保证工具成功：现有 general-research 将真实 failed/cancelled 编为 `tool_error`，但 querying/complete 可同为 `tool_result`。没有显式事件状态时不要为单项标“完成”。
- 保存失败、权限拒绝、工具失败、停止恢复等需要操作的内容放在 `attention` 或外部已有错误区，不藏进折叠记录。
- 保留 `/api/tasks/:id/trace` 链接。RunActivity 只是展示组件，不记录 Trace、不执行工具、不重试。

## 依赖与验证范围

组件依赖 React、lucide-react、共享 `cn`、共享 Collapsible；底层 Radix/clsx/tailwind-merge 由根 Agent 统一安装。未添加新依赖，未更改 API、个人记忆或模型调用。构建与真实界面检查由根 Agent 集成后执行。
