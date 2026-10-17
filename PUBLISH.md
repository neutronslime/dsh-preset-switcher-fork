# 发布 / 安装说明（0.1.3 fork）

本仓库已经推到 <https://github.com/neutronslime/dsh-preset-switcher-fork>（`master`，
最新提交见 `git log -1`），并在 **DSH 0.2.1-rc.2** 上实测挂载成功。下面是三条分发路线
的现状，不需要本机有任何写死的路径。

## 路线 A：GitHub 直装（已可用，推荐）

```powershell
dsh plugin --profile web add github:neutronslime/dsh-preset-switcher-fork
# 或用某个提交固定版本（可复现）：
dsh plugin --profile web add github:neutronslime/dsh-preset-switcher-fork#<sha>
```

或者克隆到任意目录后从本地目录安装（路径由使用者决定）：

```powershell
git clone https://github.com/neutronslime/dsh-preset-switcher-fork.git
dsh plugin --profile web add .\dsh-preset-switcher-fork
```

装完重启 `dsh web`：`.\scripts\restart-web.ps1`（通用版，自动发现端口；在普通终端里跑，
不要在 DSH 会话里跑——它要停掉当前宿主进程），或自己 `dsh --profile web --port <端口> --no-open`。

### 验证插件真的挂载了

```powershell
# GET 无方法：405 = 路由已注册；404 = 插件没挂载
curl.exe -i http://127.0.0.1:<端口>/preset-switch/api

# 三个方法
curl.exe -s -X POST http://127.0.0.1:<端口>/preset-switch/api -H "content-type: application/json" -d "{\"method\":\"list\"}"
curl.exe -s -X POST http://127.0.0.1:<端口>/preset-switch/api -H "content-type: application/json" -d "{\"method\":\"repair\"}"
```

0.2.1-rc.2 上的实测结果（本次验证记录）：

| 请求 | 响应 |
|------|------|
| `GET /` | 401（服务正常，需要鉴权） |
| `GET /preset-switch/api` | 405 |
| `POST {"method":"list"}` | 200 `{"ok":true,"value":{"presets":[standard,ptc,minimal,cordis],"current":null}}` |
| `POST {"method":"repair"}` | 200 `{"ok":true,"value":{"repaired":[],"checked":[],"target":"standard"}}` |
| `POST {"method":"switch"}`（缺参） | 400 `missing or invalid "sessionId"/"presetId"` |
| `POST {"method":"nope"}` | 404 `unknown method "nope"` |

注意：未知路径的 POST 也会得到 405（服务器兜底），所以判定要结合 GET 是否 404 和
响应体里的 `"ok":true`。

## 路线 B：npm（可选，当前脚本无改动必需）

- 本机 `npm` 已可用：npm 11.19.1 / node v26.10.0，满足 `engines`（node ^20.17 或 >=22.9）；
  `npm pack --dry-run` 成功（7 files，约 13 kB）。`npm whoami` 仍是 `ENEEDAUTH`，即没登录。
- 名称问题：`dsh-preset-switcher` 在 npm 上是空的（404），但直接占用会和上游将来发版撞名，
  建议发 `@<scope>/dsh-preset-switcher` 或 `dsh-preset-switcher-fixed`。
- 改名要同步四处，否则 Cordis 行/客户端模块注册表/包名对不上、插件不加载：
  `package.json` 的 `name`、`cordis.patch.yml` 的 `- id:` / `name:`、
  `lib/client.js` 顶部 `window.__ModuleLoader__.load({ id })` 与 `exports.name`。
  用脚本一次改完：`node scripts/rename-package.mjs @<scope>/dsh-preset-switcher`。
- 发布：

  ```powershell
  npm login --registry https://registry.npmjs.org/
  npm publish --registry https://registry.npmjs.org/ --access public
  ```

  国内镜像不支持 publish，必须直连 registry.npmjs.org。

## 路线 C：进 dshmarket 目录（本次目标）

目录数据来自 awesome-dsh-plugin，收录走 PR：
<https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/blob/main/contributing.md>

PR 内容只有**一个**文件：`data/plugins/neutronslime__dsh-preset-switcher-fork.yml`，
内容就是本仓库 `market-entry/` 下的同名文件（字段仅 `url` / `name` / `category` /
`description.en|zh`；**不要**加 `npm:` 字段，CI 会拒；`tarball:` 只能是 GitHub Release 上的 .tgz）。

前置条件：

- [x] `package.json` 声明 `dsh.bundle.patch`（CI 会读；只有 `dsh.client` 会失败）
- [x] 仓库有真实代码、公开
- [x] 仓库加 `dsh-plugin` topic、写清 description（否则维护者会退回）
- [ ] **仓库创建满 24 小时**：fork 创建于 2026-10-17T09:37:43Z，门槛在
      **2026-10-18T09:37Z** 之后才过；在此之前跑 CI 会直接失败

提交步骤：fork `awesome-dsh-plugin/awesome-dsh-plugin` → 新建分支 → 放入上面那个 yml →
提 PR（标题形如 `Add neutronslime/dsh-preset-switcher-fork`）。README 由脚本生成，不用手改。

## 已做的兼容修复

统一记在 [CHANGELOG.md](CHANGELOG.md)。摘要：

| 版本 | 位置 | 改动 |
|------|------|------|
| 0.1.1 | `lib/index.js` `inject` | `['webServer','webRuntime']` → `['webServer']`（0.2.1-rc.1 删除了 `webRuntime` 服务，缺失的注入会让插件整个不执行） |
| 0.1.1 | `lib/index.js` 路由守卫 | `isTrustedApiRequest(req, scope.webRuntime.trustedHosts)` → `isTrustedApiRequest(req, [])`（宿主 web server 已统一做 Host/Origin/sec-fetch-site 校验，这里保留 loopback 检查） |
| 0.1.2 | `lib/index.js` `list` 分支 | 活会话 `composedPreset()` 返回 `undefined` 时回退到"最后一条 `agent-preset/selected`"，修掉按钮显示"模式"而不是当前模式名的问题 |
| 0.1.3 | README / `scripts/restart-web.ps1` / `package.json` | 安装方式去掉写死路径，脚本改成通用版；`repository`/`homepage`/`bugs` 指向本 fork；rc.2 实测通过 |
