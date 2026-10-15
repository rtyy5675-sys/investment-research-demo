# Web URL 部署配置（Render）

本文件准备 Render Web Service 配置。它不会自动创建服务或产生费用；真实 URL 只会在源码稳定、仓库连接并完成首次部署后由 Render 分配。

## 当前配置

仓库根目录的 `render.yaml` 声明了 Node Web Service：

- 构建：`npm ci --include=dev && npm run build`
- 启动：`node server.mjs`，不在每次重启时重复构建前端
- Node.js：固定为本机已验证的 `24.21.0`，避免平台默认版本变化
- 监听：`HOST=0.0.0.0`，端口由平台通过 `PORT` 提供
- 健康检查：`/healthz`，只返回服务存活状态
- 访问保护：生产环境强制 HTTP Basic Auth；Render 为评审预览生成独立密码
- 秘钥：模型 API 与扶摇 Key 通过 Render 的未同步变量在控制台填写，不进入 YAML 或 Git
- 保存提示：`RESEARCH_STORAGE_MODE=ephemeral` 通过服务配置返回前端，页面说明当前实例可跨会话延续、实例重启后本地记录不保留；不是承诺已接入持久化。
- 计算：Render Free Web Service，不附加持久盘；当前仅用于评审方从公网打开界面，不把长期记忆或本地文件持久化作为本次展示目标

本机仍默认监听 `127.0.0.1`，本地启动脚本也会强制只绑定本机地址。生产模式若缺少 `PREVIEW_ACCESS_PASSWORD` 会拒绝启动。

## 发布步骤

完整的 GitHub 建仓、检查暂存文件、Render Blueprint 部署、环境变量填写和验收步骤见[源码链接与 Web URL 获取操作路径](源码链接与Web_URL获取操作路径.md)。

本 Blueprint 中的模型变量为 `MODEL_PROVIDER`、`MODEL_BASE_URL`、`MODEL_API_KEY`、`MODEL_NAME`，数据服务变量为 `FUYAO_API_KEY`。这些变量都由 Render 服务端读取，Key 不应写入仓库。健康检查使用 `/healthz`；应用状态接口 `/api/health` 与其用途不同。

部署完成后，Render 域名和预览密码以控制台实际生成值为准。验证公网页面、认证、模型调用和数据查询后再填写提交材料；只配置 Blueprint 不代表已部署或已取得 Web URL。

## 免费实例边界

免费服务空闲 15 分钟后会休眠，下一位评审打开时冷启动可能需要约一分钟；休眠、重启或重新部署会丢失服务本地写入。因此这里的目标是让评审能打开界面，不承诺历史任务与记忆跨重启保留。Render 官方列出了这些免费服务限制：[免费实例说明](https://render.com/docs/free)。

当前只运行单实例；若后续要展示稳定的跨重启研究记忆，再考虑付费计算和持久盘。创建资源前可核对[Render 当前价格](https://render.com/pricing)。

Basic Auth 是给单个评审预览的共享门禁，不是多用户身份与数据隔离。当前版本不应向不特定公众开放；评审链接与密码分开发送，并在评审结束后轮换密码或删除服务。
