# 发布 / 安装说明（0.1.1 fork）

本目录已是可直接发布的状态：版本 0.1.1、LICENSE、CHANGELOG、git 首次提交都齐了，
`dsh-preset-switcher-0.1.1.tgz` 是已打好包、可直接安装的 tarball。

## 路线 A：GitHub（推荐，无需 npm 账号）

1. 在 <https://github.com/new> 建一个仓库，名字随意（建议 `dsh-preset-switcher`），**不要**勾选初始化 README。
2. 推送：

   ```powershell
   cd C:\Users\npc23\Documents\deepseek-harness\default-workspace\dsh-preset-switcher-fork
   git remote add origin https://github.com/<你的账号>/dsh-preset-switcher.git
   git push -u origin master
   ```

3. 安装（把 `<你的账号>` 和 `<sha>` 换成实际值；带 sha 是为了可复现）：

   ```powershell
   dsh plugin add "github:<你的账号>/dsh-preset-switcher#<sha>"
   ```

   或者直接用已经打好的 tarball（完全离线）：

   ```powershell
   dsh plugin add "C:\Users\npc23\Documents\deepseek-harness\default-workspace\dsh-preset-switcher-fork\dsh-preset-switcher-0.1.1.tgz"
   ```

4. 重启 DSH。验证插件是否真的挂载（端口用你当前的 GUI 地址）：

   ```powershell
   # GET：404 = 路由不存在（插件没挂载）；405 + JSON 体 = 路由已注册
   curl.exe -i http://127.0.0.1:<端口>/preset-switch/api

   # POST：200 + {"ok":true,...} = 完全可用
   curl.exe -i -X POST http://127.0.0.1:<端口>/preset-switch/api -H "content-type: application/json" -d "{\"method\":\"list\"}"
   ```

   注意：未知路径的 POST 也会得到 405（服务器的兜底响应），所以判定要看 **GET 是否 404**，
   以及 POST 的响应体里有没有 `"ok":true`。

## 路线 B：npm

- `dsh-preset-switcher` 这个名字在 npm 上仍是空的（404）。直接占用会和上游作者将来的发版撞名，
  建议发成 `@<你的scope>/dsh-preset-switcher` 或 `dsh-preset-switcher-fixed`。
- **改名的连带修改**（重要）：`package.json` 的 `name`、`cordis.patch.yml` 里 `- id:` / `name:` 行、
  `lib/client.js` 顶部 `window.__ModuleLoader__.load({ id: ... })` 与 `exports.name` 必须一致，
  否则 Cordis 行、客户端模块注册表和包名对不上，插件同样不会加载。
  这些位置由脚本一次改完，别手改漏：

  ```powershell
  node scripts/rename-package.mjs @<你的scope>/dsh-preset-switcher
  ```

  它会重写四个文件并打印结果；YAML 里的标量会自动加引号（`@scope/name` 裸写会破坏 YAML 解析）。
  已有 `node` 的机器直接跑 `node`；本机没有则用宿主自带的：
  `$env:ELECTRON_RUN_AS_NODE=1` 后 `<DeepSeek Harness.exe> scripts\rename-package.mjs @scope/name`。
- **在一台有 npm 的机器上发布**（本机 PATH 无 `npm`，也没有 `~/.npmrc`，这条路只能在别的机器走）：

  ```powershell
  cd <本仓库>
  node scripts/rename-package.mjs @<你的scope>/dsh-preset-switcher   # 可选，决定包名
  npm login --registry https://registry.npmjs.org/
  npm publish --registry https://registry.npmjs.org/ --access public
  ```

  国内镜像（npmmirror）不支持 publish，必须直连 `registry.npmjs.org`。
  若坚持在本机发，宿主自带 pnpm 也能发：`$env:ELECTRON_RUN_AS_NODE=1` 后用
  `& $exe --expose-internals $pnpm login` / `... publish --access public --no-git-checks`。

## 路线 C：进 dshmarket 目录

目录数据来自 awesome-dsh-plugin，收录走 PR：
<https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/blob/main/contributing.md>
发 npm 不会自动上架。

## 已做的兼容修复

统一记在 [CHANGELOG.md](CHANGELOG.md)。摘要：

| 版本 | 位置 | 改动 |
|------|------|------|
| 0.1.1 | `lib/index.js` `inject` | `['webServer','webRuntime']` → `['webServer']`（0.2.1-rc.1 删除了 `webRuntime` 服务，缺失的注入会让插件整个不执行） |
| 0.1.1 | `lib/index.js` 路由守卫 | `isTrustedApiRequest(req, scope.webRuntime.trustedHosts)` → `isTrustedApiRequest(req, [])`（宿主 web server 已统一做 Host/Origin/sec-fetch-site 校验，这里保留 loopback 检查） |
| 0.1.2 | `lib/index.js` `list` 分支 | 活会话 `composedPreset()` 返回 `undefined` 时回退到"最后一条 `agent-preset/selected`"，修掉按钮显示"模式"而不是当前模式名的问题 |
