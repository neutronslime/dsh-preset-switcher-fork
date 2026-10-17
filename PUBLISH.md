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
- 这台机器 PATH 上没有 `npm`，但宿主自带 pnpm 可以发布：

  ```powershell
  $exe='C:\Users\npc23\AppData\Local\Programs\DeepSeek Harness\DeepSeek Harness.exe'
  $pnpm='C:\Users\npc23\AppData\Local\Programs\DeepSeek Harness\resources\runtime\primary-runtime\dependencies\pnpm\bin\pnpm.cjs'
  $env:ELECTRON_RUN_AS_NODE='1'
  cd C:\Users\npc23\Documents\deepseek-harness\default-workspace\dsh-preset-switcher-fork
  & $exe --expose-internals $pnpm login          # 或先设 $env:NPM_TOKEN
  & $exe --expose-internals $pnpm publish --access public --no-git-checks
  ```

  发布必须直连 `registry.npmjs.org`（国内镜像不支持 publish）：
  `& $exe --expose-internals $pnpm publish --registry https://registry.npmjs.org/ --no-git-checks`

## 路线 C：进 dshmarket 目录

目录数据来自 awesome-dsh-plugin，收录走 PR：
<https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/blob/main/contributing.md>
发 npm 不会自动上架。

## 已做的兼容修复（0.1.1）

| 位置 | 改动 |
|------|------|
| `lib/index.js` `inject` | `['webServer','webRuntime']` → `['webServer']`（0.2.1-rc.1 删除了 `webRuntime` 服务，缺失的注入会让插件整个不执行） |
| `lib/index.js` 路由守卫 | `isTrustedApiRequest(req, scope.webRuntime.trustedHosts)` → `isTrustedApiRequest(req, [])`（宿主 web server 已统一做 Host/Origin/sec-fetch-site 校验，这里保留 loopback 检查） |
