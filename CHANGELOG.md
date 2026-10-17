# Changelog

## 0.1.2

- **Fixed: the header button showed "模式" instead of the running mode on DSH
  0.2.1-rc.1.** `list` reported `current: null` for a live session because
  `agentPresets.composedPreset(agent.ctx)` can answer `undefined` even while the
  agent actually runs a preset (its binding reads off a preset generation that a
  re-link may leave unattached). The route now falls back to the persisted
  reference — the last `agent-preset/selected` event in the session log — in that
  case, the same path it already used for sessions that are not loaded. Switching
  itself was unaffected; this only restores the label and the check mark.

## 0.1.1

DSH 0.2.1-rc.1 compatibility (upstream 0.1.0 does not load on it).

- **Fixed: plugin never mounted.** `inject` asked for `['webServer', 'webRuntime']`,
  but DSH 0.2.1-rc.1 removed the `webRuntime` service (the web runtime now provides
  `webApp`). A missing injected service keeps a Cordis plugin from running at all, so
  `apply` never executed and `/preset-switch/api` answered 404 — the header dropdown
  looked dead. `inject` is now `['webServer']`.
- **Fixed: route fence used the removed service.** The handler read
  `scope.webRuntime.trustedHosts`; that would also throw once the route mounted. The
  host web server enforces Host/Origin/`sec-fetch-site` trust for every route on
  0.2.1-rc.1, so the route now calls `isTrustedApiRequest(req, [])`, which still keeps
  the loopback-only check.
- No functional change otherwise: same preset list/switch/repair API, same session
  header dropdown, same append-only `agent-preset/selected` handling.

## 0.1.0

Initial release (upstream `jeffcwj/dsh-preset-switcher`, commit 2eb8d86).
