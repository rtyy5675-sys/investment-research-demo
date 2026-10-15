# 源码链接与 Web URL 获取操作路径

本文说明怎样从当前本地工程得到评审可访问的 GitHub 源码链接和 Render 公网 Web URL。链接只有完成 GitHub 推送和 Render 首次部署后才会产生；本文件不代表已经发布或部署。

## 当前状态

- 本地工程分支为 `main`，目前没有配置 GitHub remote。
- 发布前必须先清理案例内容：当前工作树和已有提交历史仍能检索到“原测试公司”示例。即使只删掉当前文件再推送 `main`，旧提交仍会随仓库公开。
- 根目录已有 `render.yaml`，声明了 Render Node Web Service；它是部署配置，不会自行创建服务或 URL。
- 生产环境使用 HTTP Basic Auth。Render 预览服务配置会生成密码，评审需要单独收到账号和密码。
- Render 配置使用 `RESEARCH_STORAGE_MODE=ephemeral`，适合公网界面预览；服务重启或重新部署后，本机式任务记录不保证保留。

## 一、发布源码并取得 GitHub 链接

### 1. 发布前检查本地工程

在项目根目录打开终端：

```sh
git status --short --branch
git diff --check
npm test
npm run build
git check-ignore -v .env.local artifacts/model-settings.json
git ls-files .env.local artifacts/
```

检查工作区变更和待提交文件，确认删除、截图、验证记录和文档都属于本次交付。检查 `docs/evidence/`、截图和示例资料没有密钥、个人账号信息或不应公开的原始数据。`.env.local` 与 `artifacts/` 应被忽略；如果 `git ls-files .env.local artifacts/` 输出了其中任何文件，先停止发布并从 Git 跟踪中移除敏感文件，再检查提交历史是否曾包含密钥。

当前工程历史包含早期示例内容，因此公开源码应从**清理后的当前工作树**建立新的 GitHub 仓库，不要把本地 `.git` 历史推上去。完成案例清理并检查工作树后，在项目目录的上一级执行以下命令，复制 Git 跟踪文件和未忽略的新文件，但不复制 `.git`、被忽略的本地配置、依赖和构建产物：

```sh
mkdir ../investment-research-demo-source
git ls-files --cached --others --exclude-standard -z | while IFS= read -r -d '' file; do
  if [ -f "$file" ]; then
    mkdir -p "../investment-research-demo-source/$(dirname "$file")"
    cp "$file" "../investment-research-demo-source/$file"
  fi
done
cd ../investment-research-demo-source
```

在这个新目录里重新执行 `git status --short`、测试、构建和敏感文件检查；确认案例清理结果也已进入副本，再初始化新仓库。这样 GitHub 不会获得当前仓库的旧提交历史。

### 2. 在 GitHub 创建空仓库

1. 登录 GitHub，点击右上角 `+` → `New repository`。
2. 仓库名可用 `investment-research-demo`；仓库所有者选自己的账号或组织。
3. 根据评审访问方式选可见性：评审必须免登录查看源码时选 `Public`；选 `Private` 时需把评审账号加入仓库访问名单。
4. 新源码副本会在下一步本地初始化，因此创建时不要勾选初始化 README、`.gitignore` 或 License。
5. 点击 `Create repository`。复制 GitHub 页面提供的 HTTPS 仓库地址，格式类似 `https://github.com/<owner>/<repo>.git`。

### 3. 初始化新历史并推送

在 `investment-research-demo-source` 目录中，将 `<owner>` 和 `<repo>` 换成刚创建的实际值：

```sh
git init -b main
git add -A
git status --short
git diff --cached --name-only
git diff --cached --check
git commit -m "Prepare investment research demo source"
git remote add origin https://github.com/<owner>/<repo>.git
git push -u origin main
```

推送前再次查看暂存文件清单，确认没有 `.env.local`、`artifacts/` 下的本地配置、API Key 或不属于交付的个人文件。只有确认清单无误后才执行 `git push`。若终端要求认证，按 GitHub 页面提示使用浏览器授权或 GitHub CLI；不要把 Personal Access Token 写进命令、文档或仓库。

推送成功后，浏览器打开 `https://github.com/<owner>/<repo>`，确认默认分支 `main` 和 README 正常显示。这个仓库页面地址就是源码链接；不要提交本机路径或 `.git` 克隆后缀作为评审链接。

## 二、在 Render 部署并取得 Web URL

### 1. 连接 GitHub 仓库

1. 登录 Render，点击 `New` → `Blueprint`。
2. 连接 GitHub 账号；如需授权仓库访问，只勾选本项目仓库。
3. 选择刚推送的仓库和 `main` 分支，Blueprint 文件使用仓库根目录的 `render.yaml`。
4. 检查服务名 `jianwei-investment-research-preview` 及构建、启动、健康检查配置，点击应用或创建服务。

`render.yaml` 当前配置的健康检查路径是 `/healthz`；该路径只用于检查服务存活。不要把本机地址 `http://127.0.0.1:8791` 或内部 API 地址当作公网产品 URL。

### 2. 设置模型和扶摇环境变量

在 Render 服务的 Environment 配置中填入当前本机已验证可用的同一组模型参数和扶摇 Key：

| 变量名 | 填写内容 |
| --- | --- |
| `MODEL_PROVIDER` | `openai-compatible` |
| `MODEL_BASE_URL` | 模型服务商提供的 API 基础地址（按官方配置；DeepSeek 可用 `https://api.deepseek.com`） |
| `MODEL_API_KEY` | 模型服务商 API Key |
| `MODEL_NAME` | 服务商实际支持的模型名称 |
| `FUYAO_API_KEY` | 扶摇数据服务 API Key |

Key 只填写到 Render 的服务端环境变量，不放进 GitHub、README、URL 或截图。保存环境变量后按控制台提示重新部署。`PREVIEW_ACCESS_USERNAME` 当前设为 `reviewer`；`PREVIEW_ACCESS_PASSWORD` 由 Blueprint 生成。到 Render 服务的 Environment 页面查看并安全保存生成的密码；如果没有生成值，手动设置一个新的预览密码并重新部署。

### 3. 等部署成功并验证

1. 在 Render 的 Events/Logs 中确认构建和部署完成，服务状态为 `Live`，且 `/healthz` 检查通过。
2. 从 Render 服务页面复制实际分配的 `onrender.com` 域名。Render 可能调整服务域名，必须以控制台当前显示值为准。
3. 在无痕窗口打开根页面，使用账号 `reviewer` 和单独保存的预览密码登录。
4. 确认页面资源正常加载；通过界面配置或确认模型设置，再实际跑通一条研究任务，检查模型调用和扶摇取数。`/api/health` 是应用状态接口，需按页面认证要求访问；它与 Render 的 `/healthz` 存活检查不是同一个用途。
5. 若有代码修改，推送到 GitHub 的 `main` 分支后等待 Render 自动重新部署，再重复验证。

部署后得到的 Web URL 类似 `https://<实际服务名>.onrender.com`。只有从 Render 控制台复制并实际打开验证后，才将其填入提交材料。

## 三、提交时填写

```text
源码仓库： https://github.com/<owner>/<repo>
Web 产品： https://<实际服务名>.onrender.com
预览账号： reviewer
预览密码： 单独提供，不写入公开仓库或公开提交材料
```

如果部署尚未完成，应明确标记为“待部署”，不要用 localhost、Render 配置文件地址或猜测的域名替代 Web URL。更详细的 Render 配置边界见[部署配置说明](Web_URL部署配置.md)。
