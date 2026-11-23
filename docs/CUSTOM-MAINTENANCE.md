# Our Free Model · xiaoasi 定制版 — 维护手册

> 这份文档写给**以后要改这个定制版的人**（大概率是你自己，隔几个月回来看）。
> 它记录那些「不知道就会踩坑」的事：私钥在哪、哪些东西不能提交、
> 改完代码怎么发版、遇到报错怎么办。
>
> 本文件位于 `docs/` 下，**不会进入 npm 包、也不会进发布清单**，
> 因此可以放心写内部信息（但**绝不要**把私钥本身贴进来）。

---

## 0. 一页速查

| 事项 | 值 / 位置 |
|---|---|
| 源码仓库（本地） | `C:\Users\xiaoasi\Documents\deepseek-harness\default-workspace\ofm-fork` |
| 源码仓库（远端） | https://github.com/xiaoasi-2023/dsh-our-free-model-custom |
| 当前分支 | `clean-main`（推送到远端 `main`） |
| 签名私钥 | `..\ofm-manifest-key.pem`（workspace 根目录，**勿删勿提交**） |
| 安装位置 | `C:\Users\xiaoasi\.dsh\profiles\desktop\node_modules\dsh-our-free-model` |
| 用户数据 | `C:\Users\xiaoasi\.dsh\our-free-model\`（settings.json / catalog.json 等） |
| 打包产物 | `C:\Users\xiaoasi\.dsh\profiles\desktop\vendor\dsh-our-free-model-<版本>.tgz` |
| Kiro 网关 | https://kiro.xiaoasi.xyz/v1 |
| WorkBuddy 渠道 | **本插件内建**（`src/workbuddy.js`）；独立插件 `dsh-connect-workbuddy` 可选，不再是必需 |

---

## 1. ⚠️ 三样东西绝对不要动

### 1.1 `ofm-manifest-key.pem` — 发布签名私钥

位置：`C:\Users\xiaoasi\Documents\deepseek-harness\default-workspace\ofm-manifest-key.pem`

这是 Ed25519 私钥，用来给 `feed/manifest.json` 签名。插件的更新器内置了对应的**公钥**
（`src/updater.js` 的 `PINNED_MANIFEST_PUBLIC_KEY`），只会安装用这把私钥签过的版本。

**丢了会怎样**：以后再也发不了能被现有安装识别的更新，只能手动重装。

**不要做的事**：
- 不要删除
- 不要提交到任何 git 仓库（包括这个 fork）
- 不要发给别人
- 不要贴进聊天记录 / issue / 文档

**校验它是否还是原配**（公钥应打印 `MCowBQYDK2VwAyEAI8uXjEgPDmjbthdvXVMFCU9bUHXGksJwJ3bta5ts1io=`）：

```powershell
node --input-type=module -e "import{createPrivateKey,createPublicKey}from'node:crypto';import{readFileSync}from'node:fs';const k=createPrivateKey(readFileSync('C:/Users/xiaoasi/Documents/deepseek-harness/default-workspace/ofm-manifest-key.pem'));console.log(createPublicKey(k).export({format:'der',type:'spki'}).toString('base64'))"
```

### 1.2 `vendor/channel-pack/pack.js` — 不进仓库

这是渠道包的**预打包产物**（约 2.8 MB），由 `vendor/channel-pack/src/**`（148 个 TS 文件）
经 esbuild 打成一个文件。

**为什么不提交**：它内嵌了上游 Gemini 渠道的 Google OAuth 客户端凭据
（`GEMINI_DEFAULT_CLIENT_ID` / `GEMINI_DEFAULT_CLIENT_SECRET`，
这些值本来就在上游 MIT 项目里公开），GitHub 的推送保护会**直接拒绝推送**：

```
GH013: Push cannot contain secrets — Google OAuth Client ID
```

所以它被写进 `.gitignore`。**这完全不影响使用**，因为：

- 本地工作副本里它一直在（打包、安装都用它）
- 需要重建时跑下面的命令即可

### 1.3 `vendor/magpie/bin/magpie-win32-x64.exe` — 不进仓库

97 MB 的模型工作台引擎二进制，超过 GitHub 单文件推荐上限。
**插件运行时并不用它** —— 实际用的是 `src/engine-parts/win32-x64.NNN.part`
那 11 个分片（共约 42 MB，这些**是**在仓库里的，也是打包必带的）。

---

## 2. 改了代码之后怎么发版

### 2.1 完整流程（按顺序）

```powershell
# 变量（每次开新终端都要设）
$node  = "C:\Users\xiaoasi\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
$pnpm  = "C:\Users\xiaoasi\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\pnpm\bin\pnpm.mjs"
$fork  = "C:\Users\xiaoasi\Documents\deepseek-harness\default-workspace\ofm-fork"
$dest  = "C:\Users\xiaoasi\.dsh\profiles\desktop\vendor"

# ① 【只有改了 vendor/channel-pack/src/** 才需要】重建渠道包
cd $fork
& $node scripts/build-channel-pack.mjs
#    注意：这个脚本有一道「marker gate」，见 §3.1

# ② 打包 tgz
& $node $pnpm pack --pack-destination $dest

# ③ 签发布清单（必须带 --key 或设 OFM_MANIFEST_KEY）
& $node scripts/build-manifest.mjs --key "C:\Users\xiaoasi\Documents\deepseek-harness\default-workspace\ofm-manifest-key.pem" --force

# ④ 安装到 profile（必须删目录，见 §3.2）
Remove-Item "C:\Users\xiaoasi\.dsh\profiles\desktop\node_modules\dsh-our-free-model" -Recurse -Force
cd "C:\Users\xiaoasi\.dsh\profiles\desktop"
& $node $pnpm install

# ⑤ 重启桌面端（见 §2.3）

# ⑥ 提交并推送
cd $fork
git add -A
git -c user.name="xiaoasi" -c user.email="2371716819@qq.com" commit -m "说明这次改了什么"
#    推送见 §3.3（必须走独立进程 + HTTP/1.1）
```

### 2.2 改版本号时注意

`package.json` 的 `version` 必须和下面**四个**文件一致，否则
`scripts/build-manifest.mjs` 会直接报错退出（这是上游设的发布门禁，防止桌面安装包版本错位）：

- `package.json`
- `packages/desktop/package.json`
- `packages/desktop/src-tauri/tauri.conf.json`
- `packages/desktop/src-tauri/Cargo.toml`
- `packages/desktop/src-tauri/Cargo.lock`（搜 `name = "ofm-desktop"` 下面那行）

### 2.3 重启桌面端

插件的 `distribution` 是 `managed`，**代码改动必须重启才生效**（热重载是关的）。

⚠️ **有个坑**：直接杀进程的话，旧实例 `dispose()` 会把**内存里的旧 settings
写回磁盘**，覆盖你刚改的配置。所以正确顺序是：

1. 先把当前正确的 settings 备份成 `settings.phase1.staged.json`
2. 杀掉所有 DeepSeek Harness 进程
3. **等进程完全退出后**，把 staged 文件复制回 `settings.json`
4. 启动 `DeepSeek Harness.exe`

另外：`Start-Process` 起的进程会随 harness 的工具调用一起被杀。要让它活下来，
必须用 WMI 创建 + `cmd.exe /c` 包装（注意 `C:\Program Files\...` 带空格，
pwsh 路径要加引号、**ps1 路径不要加引号**）：

```powershell
$cmdLine = 'cmd.exe /c "C:\Program Files\PowerShell\7\pwsh.exe" -NoProfile -ExecutionPolicy Bypass -File <脚本路径>'
Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = $cmdLine }
```

---

## 3. 已知的坑

### 3.1 `build-channel-pack.mjs` 的 marker gate

脚本会把**新构建的包**和**当前已发布的 pack.js** 做逻辑标记比对。
如果新包「丢了」某段已有逻辑，它会拒绝写入并报：

```
build-channel-pack: refusing to write a bundle that drops existing logic (#572)
```

这通常意味着 `vendor/channel-pack/src` 比 `pack.js` 旧。
如果你**确实**是有意重构（比如我们做渠道裁剪时），加环境变量跳过：

```powershell
$env:OFM_PACK_GATE = "off"
& $node scripts/build-channel-pack.mjs
```

单纯「src 比 pack.js 新」的正常重建**不会**触发它。

### 3.2 `file:` 依赖同版本不刷新

profile 的 `package.json` 里依赖写的是 `file:./vendor/dsh-our-free-model-2.9.1.tgz`。
**如果版本号没变**，pnpm 会认为「已经装过了」而**跳过解包** —— 结果是
你改了代码、打了包、跑了 install，但 `node_modules` 里还是旧的。

所以每次都必须先删目录：

```powershell
Remove-Item "C:\Users\xiaoasi\.dsh\profiles\desktop\node_modules\dsh-our-free-model" -Recurse -Force
```

### 3.3 推送 GitHub（三个坑连在一起）

**坑 1 — workflow scope**：OAuth token 没有 `workflow` scope，推 `.github/workflows/` 会被拒。
已删除上游 CI，**不要再加回来**。

**坑 2 — 推送保护**：见 §1.2。`pack.js` 不能进仓库。

**坑 3 — TLS 中断**：直接 `git push` 大包会报
`curl 56 schannel: server closed abruptly` 或
`RPC failed; curl 65`。解决：

```powershell
cd $fork
git config http.version HTTP/1.1
git config http.postBuffer 104857600
git config core.compression 9
```

而且**必须用独立进程推**（`cmd.exe /c` + WMI），否则推送会随工具调用结束被杀。
完整做法见 §2.1 的 ⑥ 和 §2.3 的 WMI 片段。

### 3.4 历史里的大文件

这个 fork 的分支（`clean-main`）是**单个孤立提交**，不含上游 319 MB 历史
（上游历史里有 97 MB 的 magpie 二进制）。如果你在本地建了新分支再推，
注意别把旧历史带上去，否则又会触发大文件警告和超时。

### 3.5 GitHub 账号名

`gh` 登录的账号是 **`xiaoasi-2023`**，不是 `xiaoasi`。
`src/updater.js` 里的 `REPO` 常量必须是 `xiaoasi-2023/dsh-our-free-model-custom`。

---

## 4. 这个定制版到底改了什么

相对上游官方 v2.9.0，改了这些（全部集中在 `ofm-fork`）：

| 模块 | 改动 | 目的 |
|---|---|---|
| `src/providers/registry.json` | 新增 `kiro` 条目（公网地址 + 8 模型 + modelsUrl）；`workbuddy` / `workbuddy-global` 两条内建渠道（`auth.kind: vault`，19 个模型） | Kiro 网关 + WorkBuddy 并入 |
| `src/providers/index.js` | `AUTH_KINDS` 增加 `vault`；`OFFERED_PROVIDERS` 过滤 `source === 'external'` 的纯声明行 | 支撑 vault 渠道 |
| `src/aggregate.js` | 无改动（复用上游聚合逻辑） | — |
| `src/adapter.js` | ① 匿名免费车道硬拒（`CONFIG_DISABLED`，中文提示）② 429 时追加 Kiro 充值引导 | 停用免费车道；额度用尽给指引 |
| `src/store.js` | `hideFreeModels: true`；默认 combo 改 `combo:recommended-kiro`（kiro/auto → claude-sonnet-4.5 → deepseek-3.2） | 默认走 Kiro |
| `src/magpie-policy.js` | 只保留华为云排除（WorkBuddy 不再被拒） | 解封 WorkBuddy |
| `src/disclaimer.js` | 版本 4，8 个 section | 变更说明 |
| `src/updater.js` | `REPO` → `xiaoasi-2023/dsh-our-free-model-custom` | 自签名更新链 |
| `src/plugins.js` | `CHANNEL_PACK_CHANNELS` 裁到 5 个；`CHANNEL_PACK_DISABLED` 扩到 6 个 | 渠道裁剪 |
| `client.js` | `CHANNEL_PROVIDERS` / `CHANNEL_CREDITS` 裁到 5 个；品牌名改 `Our Free Model · xiaoasi` | 渠道裁剪 + 品牌 |
| `index.js` | `pack.apply()` 传 `disabledChannels`；新增 WorkBuddy 登录 4 个 API 路由 | 渠道裁剪 + 内建登录 |
| `client.js` | `CHANNEL_PROVIDERS` 裁到 5 个；品牌名；聚合页新增 WorkBuddy 登录卡片 | 渠道裁剪 + 内建登录 |
| `src/workbuddy.js` | **新增**：WorkBuddy 凭据读取 / 目录 / 对话 / 扫码登录 | WorkBuddy 内建 |
| `vendor/channel-pack/src/index.ts` | `apply()` 新增 `disabledChannels` 配置 + `channelDisabled()` 守卫；5 个 adapter 注册加条件 + `modelAdapters` 改条件展开 | 渠道裁剪实现 |
| `locale/zh.json`, `locale/en.json` | 标题改带 `· xiaoasi` | 品牌 |
| `package.json` 等 5 处 | 版本 2.9.0 → **2.9.1** | 版本 |

### 渠道裁剪的语义（重要）

被裁掉的 5 个渠道（LobsterAI / Qoder 中国版 / Cline / Loomy / Raccoon）：
**代码仍然随包发布，只是不注册 LLM adapter**。

- 它们的模型不会出现在模型选择器
- 无法登录 / 添加账号
- 但已有的凭据文件不会被删除

这样做的好处：改动小、可逆（把 id 从 `disabledChannels` 数组里删掉就恢复）。

---

## 5. WorkBuddy 是内建渠道，不是外部插件

**结论：本插件自己实现了 WorkBuddy 的完整能力，安装这一个包就够了。**

### 5.1 为什么不能「直接接入」别的插件的端点

`dsh-connect-workbuddy`（独立插件，作者 dingminhua，MIT）内部确实有个 OpenAI 兼容端点，
但两个关键值是**每进程随机**的：

- 端口：`server.listen(0, '127.0.0.1')` —— 内核分配
- Bearer：`const SHARED_SECRET = randomBytes(32).toString('base64url')` —— 只在内存里

所以聚合目录**没法**静态写一条 registry 记录去访问它（写完下次启动端口就变了）。
这也是为什么早先的做法只能「声明但不提供」。

### 5.2 现在怎么做的：读协议、自己重写

我们没有复制它的代码，而是**读懂上游协议后在 `src/workbuddy.js` 里重新实现**。
WorkBuddy 真正的上游是两个普通 HTTP 端点（2026-11-24 实测）：

```
GET  {chatBase}/v2/enterprises/personal/models   -> 模型目录 + 积分倍率
POST {chatBase}/v2/chat/completions              -> 标准 OpenAI SSE
```

| 区域 | chatBase | 计费域 |
|---|---|---|
| 国内版 | `https://copilot.tencent.com` | `www.codebuddy.cn` |
| 国际版 | `https://www.workbuddy.ai` | `www.workbuddy.ai` |

凭据是本机已登录账号的 OAuth token，落在
`$DSH_HOME/workbuddy-vault/<region>/<accountId>.json`（accessToken / refreshToken /
expiresAt / account）。**读这个文件**意味着：用户只要在任一插件登录过，这里立刻可用。

实现清单：

| 文件 | 内容 |
|---|---|
| `src/workbuddy.js` | 凭据读取、目录拉取、模型归一化、**扫码登录握手** |
| `src/providers/registry.json` | `workbuddy`（19 个模型）/ `workbuddy-global` 两条渠道 |
| `src/aggregate.js` | 支持 `auth.kind: 'vault'`（凭据来自文件而非粘贴的 Key） |
| `index.js` | 4 个登录 API：`status` / `login/start` / `login/poll` / `logout` |
| `client.js` | 聚合渠道页的 WorkBuddy 登录卡片（扫码 + 自动轮询 + 退登） |

### 5.3 登录握手（自己实现的）

三步，全部在 `src/workbuddy.js`：

1. `POST {billing}/v2/plugin/auth/state?platform=workbuddy` → 拿 `state` 和授权 URL
2. 用户在浏览器扫码/确认
3. `GET {billing}/v2/plugin/auth/token?state={state}` → 拿 accessToken / refreshToken
   → 再 `GET /v2/plugin/account` 取昵称 → 写入 vault（0600 权限）

会话只存在进程内存（`loginSessions` Map），重启即失效——半截的握手留在磁盘上没有意义。

### 5.4 与独立插件的关系

两者**互不冲突**：它们读同一个 vault、连同一个上游，但各自独立。
装了本插件就已经有 WorkBuddy 全部能力（模型可选、能对话、能扫码登录），
独立插件可以卸掉。

**但注意**：独立插件负责**自动续期**（token 快过期时自动换新）。
本插件目前只做「读取 + 登录」，还没做 refresh。当前 token 有效期约 27 天，
到期前在 OFM 的 WorkBuddy 卡片里重新扫码即可。要彻底不依赖它，
下一步需要在 `src/workbuddy.js` 里补 refreshToken 流程。

---

## 6. 验证脚本

workspace 根目录留了一套验证脚本，改完代码可以随时跑：

| 脚本 | 验什么 | 断言数 |
|---|---|---|
| `verify-phase1.mjs` | Kiro 聚合目录构建、免费车道隐藏逻辑、默认 combo | 11 |
| `verify-phase2.mjs` | 渠道裁剪（列表 / bundle 守卫 / host 传参） | 20 |
| `verify-phase3.mjs` | WorkBuddy 是内建渠道（声明、vault 凭据、聚合行、无 vendored 代码） | 20 |
| `verify-workbuddy-module.mjs` | `src/workbuddy.js`：纯函数 + 真实目录 + 真实对话 | 24 |
| `verify-workbuddy-lane.mjs` | WorkBuddy 走聚合渠道的端到端（含真实流式对话） | 12 |
| `verify-workbuddy-login.mjs` | 扫码登录握手（真实拿到授权 URL） | 8 |
| `verify-workbuddy-merged.mjs` | 用真实磁盘 settings 验收合并结果 | 17 |
| `verify-real-settings.mjs` | 用**真实磁盘 settings** 驱动运行时（模型选择器同款数据源） | 17 |
| `verify-kiro-real.mjs` | **真实网关**拉模型 + 流式对话 + 坏 Key 401 | 11 |
| `verify-manifest.mjs` | 本地 manifest 验签 | — |
| `verify-update-chain.mjs` | 从 **GitHub 公网**拉 manifest + 验签 + 文件 SHA-256 | 7 |
| `verify-kiro-protocol.mjs` | 对本地 mock 网关的协议级测试（不依赖真实网关） | 12 |
| `verify-e2e-real.mjs` | 真实网关端到端对话（auto / deepseek-3.2） | 2 |

跑法（node 用 runtime 里的，不要用系统 PATH 的）：

```powershell
$node = "C:\Users\xiaoasi\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
& $node "C:\Users\xiaoasi\Documents\deepseek-harness\default-workspace\verify-phase2.mjs"
```

**注意**：`verify-real-settings.mjs` 里有两个断言跟随你的**个人偏好**，不是硬编码：

- `hideFreeModels`：你可以在界面里显示或隐藏免费模型
- `disclaimerAck`：必须等于当前 `DISCLAIMER_VERSION`

如果你在界面里改了这些开关，脚本仍然会通过（它检查的是「渲染结果与设置一致」）。

---

## 7. 出问题时看哪里

| 症状 | 先查 |
|---|---|
| 改完代码没生效 | 是不是忘了重启？是不是忘了删 `node_modules\dsh-our-free-model` 再 install？ |
| 设置被重置 / 回退 | 是不是没按 §2.3 的 staged 流程重启？旧进程 dispose 覆盖了 |
| 模型选择器里没有 Kiro | `settings.json` 里 `aggregate.providers.kiro.apiKey` 是不是空的？（空 Key 会隐藏该渠道） |
| Kiro 报错 | 网关通不通：`curl https://kiro.xiaoasi.xyz/v1/models -H "Authorization: Bearer <key>"` |
| 推送 GitHub 失败 | 看 §3.3 的三个坑 |
| 打包报版本不一致 | 看 §2.2 的五个文件 |
| 更新器说签名不对 | 私钥用错了，或 manifest 没用 `--key` 签（§1.1） |
| 不知道当前装的是哪版 | 看 `node_modules\dsh-our-free-model\package.json` 的 `version` |

日志位置：

- 插件宿主日志：桌面端开发者工具 / DSH 日志目录
- OFM 运行日志：设置页 →「运行日志」标签
- 重启看门日志：workspace 根目录的 `harness-restart-v*.log`（脚本用完会删）

---

## 8. 免责与合规

本定制版是**个人学习与技术研究项目**，相对上游的差异全部在本文 §4 记录。
使用时请注意：

- WorkBuddy / Kiro 等第三方渠道的使用风险与额度由你自行承担
- 华为云 Huawei Cloud MaaS 在本定制版中**不提供**（`src/magpie-policy.js` 强制排除）
- 请遵守各服务商的条款与所在地法律

完整说明见插件内的免责声明（`src/disclaimer.js`，当前 v4），
在设置页首次打开时会弹出，之后可从页脚重新查看。
