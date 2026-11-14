# Changelog

## 0.1.4

DSH 0.2.2 compatibility: the persisted-session API became handle-based.

- **Fixed: switching or repairing a session that is not loaded failed.** DSH 0.2.2
  replaced `sessionPersistence.inspect(id)` / `append(id, events)` with
  `open(id, 'read' | 'write')`, which resolves to a `SessionHandle` (`header`,
  `read()`, `append()`, `flush()`, `close()`). Every cold-session path called methods
  the service no longer exposes, so `list` answered `current: null`, `switch` answered
  `not-found` (`session "…" not found or unreadable`), and `repair` reported every
  session as `skipped` with reason `unreadable` — and without a `sessionId`, because
  the old `list()` meta field `.id` is now `snapshot.header.id`. Reads go through a
  `read` handle now; deferred switches and repairs go through a short-lived `write`
  handle that appends one `agent-preset/selected` event at the stored next-seq and
  closes (closing a write handle is the durability barrier). Failures surface as
  `open-failed: …` / `append-failed: …` rows instead of a silent skip.
- **Fixed: session ids.** Persisted ids are `session-<uuid>`; the plugin now uses
  `snapshot.header.id` verbatim instead of assuming a bare uuid.
- **Fixed: repair target fallback.** When the configured default preset is itself
  missing (a removed bundle), the one-click repair no longer dies with
  `repair target preset "…" does not exist`; it falls back to `standard`, else the
  first available preset.
- `scripts/restart-web.ps1` now detects the profile name from the running server's
  command line instead of assuming `web`, and refuses to kill a port served by the
  desktop app (it manages its own profile and cannot be started from the CLI).
- Verified end to end on **DSH 0.2.2-rc.3** against an isolated `DSH_HOME`: `list`
  reports the stored preset, `switch` appends a deferred selection (session file
  grows, re-read reflects it), `repair` reports `ok` for valid references and
  `repaired` (`from` → `to`) for stale ones.

## 0.1.3

Installation and metadata release; no behaviour change in the plugin itself.

- **Verified on DSH 0.2.1-rc.2**: the plugin mounts and all three API methods answer
  as expected (`list` returns the four built-in presets, `repair` reports nothing to
  fix on a clean profile, `switch` validates its `sessionId`/`presetId` arguments).
  No code change was needed for rc.2.
- **Install instructions no longer assume the author's machine.** README told people
  to `dsh plugin add C:\Users\Lenovo\.dsh\plugins\dsh-preset-switcher` and to run a
  script that hard-coded that path and port 5096. Both install paths are now
  machine-independent: `dsh plugin --profile web add github:neutronslime/dsh-preset-switcher-fork`,
  or clone anywhere and `dsh plugin --profile web add .\<dir>`.
- `scripts/restart-web.ps1` is now generic: it discovers the running DSH web port
  (`Get-NetTCPConnection` + process command line) or takes `-Port`, resolves `dsh`
  from PATH, restarts the server, then probes `list` and `repair` and writes
  `web-verify-result.json` next to itself.
- `package.json` now points `repository`/`homepage`/`bugs` at this fork instead of
  upstream, and adds market keywords.

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
