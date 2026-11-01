# Tavily Search for DeepSeek Harness

> **非官方插件**：本插件由 MIKUSCAT 个人开发维护，与 Tavily 及 DeepSeek（深度求索）没有任何隶属、合作或背书关系。"Tavily"、"DeepSeek" 等名称仅用于说明兼容对象，归各自权利人所有。

独立的 Cordis 搜索提供方，包名 `dsh-web-search-tavily`，provider id 为 `tavily`。继续使用 DSH 原有的 `web_search` 工具和搜索结果卡片，不要求聊天模型支持原生搜索，不依赖 DeepSeek 搜索 API 或 Codex 登录。另外可选注册一个模型可直接调用的 `tavily_search` 工具（见下文）。

对照并测试的宿主版本为 DSH `0.2.1-rc.5`。使用 DSH 已提供的 peer 包，没有安装脚本和额外运行时依赖。常规应用更新不会覆盖 profile 中安装的插件；未来宿主接口发生不兼容变更时仍需适配。

## 安装与启用

桌面版：在 DSH 侧栏的插件管理界面安装交付的 `.tgz` 文件，可以在安装来源中填写文件的绝对路径。`desktop` profile 由 Electron 应用独占管理，外部 CLI 会拒绝修改它；不要通过修改保护开关强行安装。

也可以直接从 GitHub 安装：在插件管理界面的安装来源中填 `github:MIKUSCAT/dsh-web-search-tavily`（源码仓库：<https://github.com/MIKUSCAT/dsh-web-search-tavily>）。

命令行版的 `web`、`headless` 等 profile 可以使用实际安装的 `dsh` 命令，例如：

```powershell
dsh plugin --profile web add "C:\path\dsh-web-search-tavily-0.2.0.tgz"
```

插件组合包仅注册 `tavily` 提供方，不擅自接管其它 profile 的搜索或网页抓取设置。安装后，把所用 profile 的 `web` 配置中的 `searchProvider` 改为 `tavily`。保留其余已有字段；DSH 默认网页抓取配置的例子是：

```yaml
- id: web
  config:
    searchProvider: tavily
    fetchProvider: http
```

如果已有 `web` 节点，请在原节点中修改，不要覆盖其它配置或额外添加冲突的节点。配置属于该 profile，所有使用它的会话都会采用所选搜索提供方。

## 密钥

推荐设置 Windows **用户环境变量** `TAVILY_API_KEY`，值为自己的 Tavily key，不要修改 `PATH`。设置后完整退出 DSH（包括托盘进程）再启动，让新的进程继承环境；必要时从新打开的终端启动。macOS/Linux 则在启动 DSH 的环境中导出同名变量。

密钥不应放入插件代码、安装包、聊天记录或版本控制。优先级为：本插件显式配置的 `apiKey` → 启动环境中的 `apiKeyEnv` → DSH 凭据服务中的同名引用。默认引用是 `TAVILY_API_KEY`。插件不读取其它提供方的配置，也不自动改用其它 key。

## 可配置项

这些字段属于 `web-search-tavily` 插件配置，可由宿主设置服务实时更新；每次查询开始时固定一份设置。示例：

```yaml
- id: web-search-tavily
  config:
    apiKeyEnv: TAVILY_API_KEY
    searchDepth: basic
    topic: general
    # timeRange: week
    maxResults: 8
    # includeDomains: [example.com]
    # excludeDomains: [spam.example]
    # chunksPerSource: 3
    includeAnswer: false
    timeoutMs: 30000
    registerTool: true
```

| 字段 | 取值 | 默认 | 说明 |
|---|---|---|---|
| `searchDepth` | `basic` / `advanced` / `fast` / `ultra-fast` | `basic` | 默认搜索强度。`advanced` 相关性最高，但消耗约 2 倍额度、更慢；`fast`/`ultra-fast` 延迟更低 |
| `topic` | `general` / `news` / `finance` | `general` | 搜索类别。`news` 适合近期新闻（会带发布日期），`finance` 适合金融/公司信息 |
| `timeRange` | `day` / `week` / `month` / `year` | 不设置 | 只返回最近一天/周/月/年的结果；留空表示不限，留空时不会发送该字段 |
| `includeDomains` | 域名列表 | 空 | 只在这些域名内搜索（最多 300 个）；为空时不发送 |
| `excludeDomains` | 域名列表 | 空 | 排除这些域名（最多 150 个）；为空时不发送 |
| `chunksPerSource` | 1–3 | 不设置 | 每个来源返回的摘要片段数。Tavily 只在 `advanced` 下支持，其它强度下不发送 |
| `registerTool` | 布尔 | `true` | 是否注册 `tavily_search` 工具；关闭后插件只作为 `web_search` 的提供方 |

除 `registerTool` 外，这些字段都可在设置界面实时修改（下一次查询生效）；修改 `registerTool` 会让插件重新加载。

`searchDepth` 支持 `basic`、`advanced`、`fast`、`ultra-fast`；默认 `basic`。`maxResults` 为 1–20，默认 8；DSH 工具请求的结果上限优先，提供方最多向 Tavily 请求 20 条。`includeAnswer` 默认关闭。`timeoutMs` 为 1–120000 毫秒，默认 30000，覆盖凭据读取、连接和响应体读取。`apiKey` 是可选的宿主 secret 字段，但通常应使用环境变量或凭据服务。

每个查询仅调用一次 Tavily `/search`。默认不让 Tavily 自动升级搜索参数、不请求完整原文或图片。多查询仍由 DSH 自己并行、合并、去重和限制结果。返回 URL、标题、摘要以及存在时的发布日期；真正的空结果保持为空。

## `tavily_search` 工具

`registerTool` 为 `true`（默认）时，插件通过 DSH 的 `tools` 服务注册一个全局工具 `tavily_search`，注册方式与官方 `@deepseek-ai/dsh-tool-web` 相同（`defineTool` + `ctx.tools.register`）。它与 `web.searchProvider` 选的是哪个提供方无关，始终直接走 Tavily，复用同一套请求、超时、错误脱敏和结果转换代码。如果当前组合里没有 `tools` 服务，插件只注册提供方，不会报错。

参数：

| 参数 | 必填 | 说明 |
|---|---|---|
| `query` | 是 | 一条搜索查询 |
| `depth` | 否 | `basic` / `advanced` / `fast` / `ultra-fast`，省略时用配置的 `searchDepth` |
| `topic` | 否 | `general` / `news` / `finance`，省略时用配置的 `topic` |
| `timeRange` | 否 | `day` / `week` / `month` / `year`，省略时用配置的 `timeRange` |
| `maxResults` | 否 | 1–20 的整数，省略时用配置的 `maxResults` |

工具说明会告诉模型：普通事实查询用 `basic`；深度研究、冷门或含糊的问题，或者 `basic` 结果太少/跑题时才用 `advanced`；`fast`/`ultra-fast` 用于对速度敏感的简单查询；近期事件用 `topic: news` 加 `timeRange`。工具返回的网页内容同样标注为外部不可信数据。

注意：如果某个 agent 预设用白名单限制了可用工具，需要把 `tavily_search` 加进白名单才能看到它；`includeDomains`、`excludeDomains`、`chunksPerSource`、`includeAnswer` 只能在插件配置里设置，模型不能按次修改。

## 费用与安全

搜索消耗 Tavily 账户额度，按 Tavily 的现行规则计费。插件不额外调用聊天模型；搜索结果进入后续对话后仍会占用正常模型上下文和 token。

请求固定发到 `https://api.tavily.com/search`，禁止跟随重定向。密钥只放在 Authorization 请求头，不放在 URL 或查询 JSON。错误提示不回显上游响应正文、请求头或密钥。响应体上限为 2 MiB；超时、取消、无效凭据、配额或网络故障会明确失败，不自动重试、不回退到 DeepSeek/Codex。网络代理沿用 DSH 启动时的网络策略。

网页摘要属于外部不可信内容。DSH 原有工具仍负责外部内容标识、来源引用提示、结果展示和会话记录。

## 停用或卸载

先把 `web.searchProvider` 切回原来的提供方，例如默认的 `deepseek-official`；保留 `fetchProvider`。然后在插件管理界面关闭或移除本插件。关闭后 `tavily` 不再注册；如果路由还指向它，DSH 会报告提供方不可用，而不会静默改用其它服务。卸载不删除用户环境变量或凭据。

插件正常随 profile 加载，不需要修改应用归档、打安装包补丁、添加计划任务或启动额外搜索服务器。源代码在 [index.mjs](<./index.mjs>)，组合包入口在 [cordis.patch.yml](<./cordis.patch.yml>)。

## 验证

[离线测试](<./tests/provider.test.mjs>)（仅在源码仓库中，不随 npm 包发布）覆盖 HTTP 请求字段、新配置项的请求体构建、`tavily_search` 工具注册与参数校验、来源转换、专用凭据引用、取消与完整超时、错误脱敏、结果/字节上限和 Cordis 配置。开发目录运行：

```powershell
node --experimental-vm-modules --test tests/provider.test.mjs
```

测试需要能解析 `@deepseek-ai/schemastery`：设置环境变量 `DSH_PROFILE_DIR` 指向一个 DSH profile 目录（例如 `$env:DSH_PROFILE_DIR="$HOME\.dsh\profiles\desktop"`），或在本目录安装该包；都没有时所有测试会被跳过而不是失败。测试使用虚拟 key 和模拟 fetch，不发送真实 Tavily 请求，不消耗额度。安装后的真实搜索需另外验证，缺少 key 时不把离线测试称为联网成功。

## 源码依据

DSH 官方源码版本 `dsh-v0.2.1-rc.5` 的 `packages/web/web`、`packages/web/tool-web`、`packages/web/web-search-deepseek` 定义提供方、工具输出与注册方式。Tavily 请求字段参考 [Tavily 官方 Python 客户端](https://github.com/tavily-ai/tavily-python/blob/46505f119e6ac0f30d63a4dce0ed9f923705ad97/tavily/tavily.py)。源码阅读副本和本插件目录相互独立；无需构建或替换整套 DSH。

## 许可证

[MIT](<./LICENSE>) © 2026 MIKUSCAT
