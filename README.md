# dsh-preset-switcher

> [English](#english) | **中文**

> **Fork 说明**：上游 `jeffcwj/dsh-preset-switcher` 最后提交是 2026-08-17，未适配
> DSH 0.2.1。该版本移除了宿主 `webRuntime` 服务（现在提供 `webApp`），而上游插件
> `inject: ['webServer', 'webRuntime']` 因此永远不挂载、`/preset-switch/api` 404，
> 前端下拉菜单随之失效。本 fork 只做兼容修复（见 CHANGELOG.md），功能与上游一致。
> 已在 **DSH 0.2.1-rc.2** 上验证：插件正常挂载，`list` / `switch` / `repair` 三个方法
> 均按预期返回。安装方式见下方「安装 / 更新」，一条 `dsh plugin add` 即可。

---

<img width="656" height="350" alt="image" src="https://github.com/user-attachments/assets/c9ecdb1a-446e-48a8-825d-a3e495ff773b" />


## 概述

DSH Web 插件：在**任何时候**切换当前会话的代理预设（模式），包括对话已经开始之后 — 原生 UI 不允许这样做（"已开始的对话的代理预设已固定"）。

### 核心功能

- **顶部下拉菜单**：会话标题操作栏中的「当前模式 ▾」按钮，列出所有预设（如 `standard`=标准模式、`code`=PTC 模式、`minimal`=极简模式、`cordis`=创造模式），用 ✓ 标记当前预设，点击即切换。
- **失效预设修复**：如果会话记录的预设已被删除（自定义预设被移除），恢复将失败导致会话不可用。下拉菜单中的「修复失效模式会话」操作（及 `repair` API）会扫描所有会话日志并重写失效引用 — 最后一个 `agent-preset/selected` 事件，否则是标题 — 重置为默认预设，操作前自动备份日志并跳过活跃会话。切换未加载的会话时若引用失效也会自动修复。
- **受控路由**：`POST /preset-switch/api`，参数 `{ method: 'list' | 'switch' | 'repair', sessionId, presetId, target? }`（回环/可信主机限制，与 dsh-sounds 相同）。

### 工作原理

原生 API（`agentPresets.select`）通过空白会话检查来保护切换操作。本插件底层调用同一原子原语 — `agentPresets.recompose(agent.ctx, presetId)` — 将代理的作用域重新链接到目标预设的常驻挂载点。新组合在链接移动前确保完成，因此损坏的预设不会影响会话。成功后插件追加与代理记录相同的 `agent-preset/selected` 会话事件，使投影和标题标签同步更新。

**限制**：仅已加载的活跃会话可切换；子代理拥有的会话将被拒绝；新的工具集/人设从下一个模型步骤生效。

## 安装 / 更新

需要 DSH 0.2.1-rc.2（或同代 0.2.x）。插件是纯 JavaScript，没有构建步骤，装完即用。

```powershell
# 方式一（推荐）：直接从 GitHub 仓库安装
dsh plugin --profile web add github:neutronslime/dsh-preset-switcher-fork

# 方式二：克隆到你自己选的目录，再从该目录安装（不依赖作者机器上的任何路径）
git clone https://github.com/neutronslime/dsh-preset-switcher-fork.git
dsh plugin --profile web add .\dsh-preset-switcher-fork
```

安装或升级后重启 `dsh web`（profile 启动时会合并 `cordis.patch.yml`），刷新页面，
会话标题栏右侧就会出现「当前模式 ▾」按钮。

`dsh plugin` 把参数转交给 profile 目录里的 pnpm，不需要全局 npm；想自己检查打包内容，
`npm pack --dry-run` 也可以（node 20.17+ 或 22.9+ 即可，npm 11 实测无碍）。

## 文件结构

| 文件 | 说明 |
|------|------|
| `cordis.patch.yml` | Bundle 补丁：将插件行插入 profile 的 cordis 树（`dsh.bundle.patch`） |
| `lib/index.js` | 服务端：受控 `/preset-switch/api` 路由（list / switch / repair）及会话日志修复逻辑 |
| `lib/client.js` | 浏览器端：顶部下拉菜单（ClientModuleSystem bundle，React 通过 module-table externals） |
| `scripts/` | `restart-web.ps1`（通用版重启+探测，路径自动推导）、`inspect-session.mjs` / `repair-session.mjs`（独立日志工具） |

## 许可证

MIT

---

<a id="english"></a>

# dsh-preset-switcher

> **English** | [中文](#概述)

> **Fork note**: upstream `jeffcwj/dsh-preset-switcher` was last committed on 2026-08-17 and does not run on DSH 0.2.1: that release dropped the host `webRuntime` service (the web runtime now provides `webApp`), so the upstream `inject: ['webServer', 'webRuntime']` never mounts, `/preset-switch/api` answers 404, and the header dropdown is dead. This fork is the compatibility fix only (see CHANGELOG.md) — same features as upstream. Verified on **DSH 0.2.1-rc.2**: the plugin mounts and `list` / `switch` / `repair` all answer as expected. Install is a single `dsh plugin add`; see "Install / update" below.

---

## Overview

DSH web plugin: switch the current session's agent preset (mode) at **any time**, including after the conversation has already started — the stock UI refuses that ("a started conversation's agent preset is fixed").

### Features

- **Header dropdown**: a "当前模式 ▾" button in the session header action row lists every preset (e.g. `standard`=标准模式, `code`=PTC 模式, `minimal`=极简模式, `cordis`=创造模式), marks the session's current one with ✓, and switches on click.
- **Stale-preset repair**: if a session's recorded preset was deleted (a custom preset removed), resume fails and the session becomes unusable. The dropdown's "修复失效模式会话" action (and `repair` API) scans every session log and rewrites stale references — the last `agent-preset/selected` event, else the header — to the default preset, backing up the log first and skipping live sessions. Switching a not-loaded session whose reference is stale auto-repairs it too.
- **Fenced route**: `POST /preset-switch/api` with `{ method: 'list' | 'switch' | 'repair', sessionId, presetId, target? }` (loopback/trusted-host fence, same as dsh-sounds).

### How it works

The stock API (`agentPresets.select`) guards its swap with a blank-session check. This plugin calls the same atomic primitive underneath — `agentPresets.recompose(agent.ctx, presetId)` — which re-links the agent's scope to the target preset's standing mount. The new composition is ensured before the link moves, so a broken preset leaves the session untouched. On success the plugin appends the same `agent-preset/selected` session event the proxy records, so projections and the header label follow.

Limits: only live (currently loaded) sessions can switch; subagent-owned sessions are refused; the new toolset/persona applies from the next model step.

## Install / update

Requires DSH 0.2.1-rc.2 (or another 0.2.x build). The plugin is plain JavaScript — there is no build step.

```powershell
# Option 1 (recommended): install straight from the GitHub repository
dsh plugin --profile web add github:neutronslime/dsh-preset-switcher-fork

# Option 2: clone into a directory of your choosing, then install from it
git clone https://github.com/neutronslime/dsh-preset-switcher-fork.git
dsh plugin --profile web add .\dsh-preset-switcher-fork
```

Restart `dsh web` after installing or upgrading (the profile boot merges `cordis.patch.yml`), reload the page, and the "当前模式 ▾" button appears in the session header.

`dsh plugin` forwards to the pnpm inside the profile directory, so no global npm is needed; `npm pack --dry-run` works too if you want to inspect the tarball (node 20.17+ or 22.9+; npm 11 is fine).

## Layout

| File | Description |
|------|-------------|
| `cordis.patch.yml` | Bundle patch: inserts the plugin row into the profile's cordis tree (`dsh.bundle.patch`). |
| `lib/index.js` | Host half: the fenced `/preset-switch/api` routes (list / switch / repair) and the session-log repair logic. |
| `lib/client.js` | Browser half: the header dropdown (ClientModuleSystem bundle, React via module-table externals). |
| `scripts/` | `restart-web.ps1` (port-agnostic restart + probe; all paths derived at runtime), `inspect-session.mjs` / `repair-session.mjs` (standalone log tools). |

## License

MIT
