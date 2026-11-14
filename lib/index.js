/**
* dsh-preset-switcher host half: serves the fenced `/preset-switch/api`
* JSON routes the browser half uses to list agent presets, to switch the
* CURRENT session's preset at any time - including after the conversation
* has started - and to repair sessions whose recorded preset no longer
* exists (a deleted custom preset would otherwise break resume).
*
* The stock API proxy (`agentPresets.select`) refuses to recompose a
* session once it has produced history. This plugin intentionally bypasses
* that blank-session check by calling the same atomic primitive the proxy
* uses underneath: `agentPresets.recompose(agent.ctx, presetId)`. The swap
* is a parent re-link of the agent's scope - the new preset's standing
* mount is ensured BEFORE the link moves, so an unknown or broken preset
* throws with the session exactly as it was. On success the plugin appends
* the same `agent-preset/selected` session event the proxy records, so
* projections and the header label follow.
*
* A session that is NOT currently loaded (no live agent) can still be
* switched: the selection is appended to its log as a deferred
* `agent-preset/selected` event (seq = stored event count), and resume
* composes from the LAST such event, so the new mode applies the next time
* the session is opened. The same append mechanism repairs stale
* references: a session whose recorded preset was deleted gets a corrective
* selection event instead of failing resume - no log rewriting, append-only
* throughout. All reads/writes go through the `sessionPersistence` API
* (which handles the backend's multi-frame zstd container), never the raw
* files.
*
* Trust: loopback-only plus the web runtime's trustedHosts fence, same as
* dsh-sounds. Live sessions are recomposed in place; subagent-owned
* sessions are refused.
* @module dsh-preset-switcher
*/

/** Stable Cordis plugin name (matches the loader row and the client bundle id). */
const name = 'dsh-preset-switcher';
/**
 * Services required before mounting: the webserver route host only.
 * DSH 0.2.1-rc.1 removed the `webRuntime` service (the web runtime now
 * provides `webApp`), so also requiring it left this plugin permanently
 * unmounted: `apply` never ran and `/preset-switch/api` never existed.
 */
const inject = ['webServer'];

/** Structured route failure. */
class PresetSwitchError extends Error {
	code;
	status;
	constructor(code, message, status = 400) {
		super(message);
		this.code = code;
		this.status = status;
	}
}

/** Read and JSON-parse a request body (empty body parses as {}). */
function readJson(req) {
	return new Promise((resolve, reject) => {
		const chunks = [];
		req.on('data', (chunk) => {
			chunks.push(chunk);
		});
		req.on('end', () => {
			try {
				resolve(chunks.length === 0 ? {} : JSON.parse(Buffer.concat(chunks).toString('utf8')));
			} catch {
				reject(new PresetSwitchError('bad-request', 'request body is not valid JSON'));
			}
		});
		req.on('error', reject);
	});
}

/** Write a JSON response with the given status. */
function writeJson(res, status, body) {
	const payload = JSON.stringify(body);
	res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
	res.end(payload);
}

/** Write the success envelope. */
function writeOk(res, value) {
	writeJson(res, 200, { ok: true, value });
}

/** Write the failure envelope for any thrown value (unknown → internal 500). */
function writeError(res, error) {
	if (error instanceof PresetSwitchError) {
		writeJson(res, error.status, {
			ok: false,
			error: { code: error.code, message: error.message }
		});
		return;
	}
	writeJson(res, 500, {
		ok: false,
		error: { code: 'internal', message: error instanceof Error ? error.message : String(error) }
	});
}

/** Normalize one trustedHosts entry (string host, or { hostname }) to a hostname. */
function canonicalHost(entry) {
	if (typeof entry === 'string') {
		try {
			return new URL(`http://${entry}`).hostname.toLowerCase();
		} catch {
			return entry.toLowerCase();
		}
	}
	if (entry !== null && typeof entry === 'object' && typeof entry.hostname === 'string') return entry.hostname.toLowerCase();
	return '';
}

/** Loopback / trusted-host / sec-fetch-site fence for the API route. */
function isTrustedApiRequest(req, trustedHosts) {
	const hostHeader = typeof req.headers?.host === 'string' ? req.headers.host : '';
	const hostname = hostHeader.split(':')[0].toLowerCase();
	if (hostname === 'localhost' || hostname === '[::1]' || hostname === '::1' || hostname.startsWith('127.')) return true;
	if (Array.isArray(trustedHosts) && trustedHosts.some((entry) => canonicalHost(entry) === hostname)) {
		if (req.headers['sec-fetch-site'] === 'cross-site') return false;
		const origin = req.headers['origin'];
		if (typeof origin === 'string' && origin !== '' && origin !== 'null') {
			try {
				if (new URL(origin).host !== hostHeader) return false;
			} catch {
				return false;
			}
		}
		return true;
	}
	return false;
}

//#region stored-session preset helpers (official persistence API only)
/**
* DSH 0.2.2 replaced the old `inspect(id)` / `append(id, events)` pair with
* per-session handles: `open(id, 'read'|'write')` returns a handle whose
* `read()` slices the logical log and whose `append()` continues it. A
* `read` handle never takes write ownership, so reading a session that
* another handle or process holds for writing stays allowed; a `write`
* handle claims the session's single mutator slot and its `close()` is the
* durability barrier that drains pending appends.
*/
/**
* Read one stored session through the persistence service, which owns the
* backend's multi-frame zstd container. Returns { header, events, nextSeq }
* or null when the session is unknown or unreadable.
*/
async function readStored(scope, sessionId) {
	let handle;
	try {
		handle = await scope.sessionPersistence.open(sessionId, 'read');
		const slice = await handle.read();
		const events = Array.isArray(slice?.events) ? slice.events : [];
		return { header: handle.header ?? {}, events, nextSeq: nextSeqOf(events) };
	} catch {
		return null;
	} finally {
		await closeQuietly(handle);
	}
}

/** The seq an append must start at: one past the logical end of the log. */
function nextSeqOf(events) {
	const last = events.length === 0 ? undefined : events[events.length - 1];
	if (last !== null && typeof last === 'object' && typeof last.seq === 'number' && Number.isSafeInteger(last.seq)) {
		return last.seq + 1;
	}
	return events.length;
}

/** Close a handle without letting a teardown failure mask the real result. */
async function closeQuietly(handle) {
	if (handle === undefined || handle === null) return;
	try {
		await handle.close();
	} catch {
		// Released either way: close() is idempotent.
	}
}

/** Human-readable message of an unknown thrown value. */
function describeError(error) {
	return error instanceof Error ? error.message : String(error);
}

/**
* The preset a stored (not-loaded) session will resume with: the LAST
* `agent-preset/selected` event (newest wins, mirroring
* resolveSessionPreset), else the header's `agentPreset`.
* @returns { kind: 'event'|'header'|'none', value }
*/
function storedPresetOf(stored) {
	const events = stored.events;
	for (let i = events.length - 1; i >= 0; i -= 1) {
		const event = events[i];
		if (event !== null && typeof event === 'object' && event.type === 'agent-preset/selected'
			&& event.data !== null && typeof event.data === 'object' && typeof event.data.agentPreset === 'string') {
			return { kind: 'event', value: event.data.agentPreset };
		}
	}
	const header = stored.header;
	if (header !== null && typeof header === 'object' && typeof header.agentPreset === 'string') {
		return { kind: 'header', value: header.agentPreset };
	}
	return { kind: 'none', value: undefined };
}

/** The selection event appended to a stored session (seq = its next-seq). */
function selectionEvent(seq, presetId) {
	return { type: 'agent-preset/selected', seq, time: Date.now(), data: { agentPreset: presetId } };
}

/**
* Append a deferred selection event to a stored session through a
* short-lived `write` handle (append-only: the stale reference stays in the
* log and the newest selection wins on resume). Returns null on success,
* else a message describing why the append could not be made - typically
* `SessionAlreadyOwnedError` because another process is running that
* session.
*/
async function appendStoredSelection(scope, sessionId, presetId) {
	let handle;
	try {
		handle = await scope.sessionPersistence.open(sessionId, 'write');
	} catch (error) {
		return `open-failed: ${describeError(error)}`;
	}
	try {
		const slice = await handle.read();
		const events = Array.isArray(slice?.events) ? slice.events : [];
		await handle.append([selectionEvent(nextSeqOf(events), presetId)]);
		return null;
	} catch (error) {
		return `append-failed: ${describeError(error)}`;
	} finally {
		await closeQuietly(handle);
	}
}

/**
* Repair ONE stored session whose persisted preset reference no longer
* exists: append a corrective selection event (append-only, supersedes the
* stale reference on resume). Skips live sessions. Returns a report row.
*/
async function repairOne(scope, sessionId, validIds, targetId) {
	const row = { sessionId, status: 'skipped', reason: 'no-preset-ref' };
	if (scope.agents.get(sessionId) !== undefined) return { ...row, reason: 'live' };
	const stored = await readStored(scope, sessionId);
	if (stored === null) return { ...row, reason: 'unreadable' };
	const ref = storedPresetOf(stored);
	if (ref.kind === 'none' || typeof ref.value !== 'string') return { ...row, reason: 'no-preset-ref' };
	if (validIds.has(ref.value)) return { ...row, status: 'ok', preset: ref.value, reason: undefined };
	const failure = await appendStoredSelection(scope, sessionId, targetId);
	if (failure !== null) return { ...row, reason: failure };
	return { sessionId, status: 'repaired', from: ref.value, to: targetId };
}
//#endregion

/**
 * Plugin body: mount the fenced routes once agents + agentPresets +
 * sessionPersistence are up.
 * @param ctx - host plugin context (webServer).
 */
function apply(ctx) {
	ctx.inject(['agents', 'agentPresets', 'sessionPersistence'], (scope) => {
		ctx.effect(() => scope.webServer.register({
			kind: 'prefix',
			path: '/preset-switch/api',
			handler: async (req, res) => {
				// DSH 0.2.1-rc.1's web server already enforces Host/Origin/
				// sec-fetch-site trust for every route, so the extra
				// `webRuntime.trustedHosts` list is no longer available; keep the
				// loopback-only fence this helper applies on its own.
				if (!isTrustedApiRequest(req, [])) {
					writeJson(res, 403, { ok: false, error: { code: 'forbidden', message: 'forbidden' } });
					return;
				}
				if (req.method !== 'POST') {
					writeJson(res, 405, { ok: false, error: { code: 'method-not-allowed', message: 'method not allowed' } });
					return;
				}
				let body;
				try {
					body = await readJson(req);
				} catch (error) {
					writeError(res, error);
					return;
				}
				const method = typeof body?.method === 'string' ? body.method : '';
				try {
					switch (method) {
						case 'list': {
							const sessionId = typeof body?.sessionId === 'string' ? body.sessionId : undefined;
							const rows = (await scope.agentPresets.list()).map((preset) => ({
								id: preset.id,
								name: preset.name === undefined ? preset.id : preset.name,
								isDefault: preset.id === scope.agentPresets.defaultId
							}));
							let current = null;
							if (sessionId !== undefined) {
								const agent = scope.agents.get(sessionId);
								// A live agent that IS bound to a preset answers directly. DSH
								// 0.2.1-rc.1 can answer undefined even while the agent runs a
								// preset (the binding is read off the agent's preset
								// generation, which a re-link can leave unattached), so fall
								// through to the persisted reference instead of reporting
								// null and leaving the header label without a mode name.
								const composed = agent === undefined ? undefined : scope.agentPresets.composedPreset(agent.ctx);
								if (composed !== undefined) {
									current = composed;
								} else {
									// Not loaded, or bound state unavailable: report the persisted
									// reference (last selection event, else header) so the UI
									// still shows the mode the session runs or will resume with.
									const stored = await readStored(scope, sessionId);
									if (stored !== null) {
										const ref = storedPresetOf(stored);
										if (ref.kind !== 'none' && typeof ref.value === 'string') current = ref.value;
									}
								}
							}
							writeOk(res, { presets: rows, current });
							break;
						}
						case 'switch': {
							const sessionId = typeof body?.sessionId === 'string' ? body.sessionId : '';
							const presetId = typeof body?.presetId === 'string' ? body.presetId : '';
							if (sessionId === '' || presetId === '') {
								throw new PresetSwitchError('bad-request', 'missing or invalid "sessionId"/"presetId"');
							}
							const agent = scope.agents.get(sessionId);
							if (agent !== undefined) {
								if (agent.session?.header?.origin === 'subagent') {
									throw new PresetSwitchError('forbidden', `session "${sessionId}" is a subagent session and cannot be re-preset`, 403);
								}
								const preset = await scope.agentPresets.recompose(agent.ctx, presetId);
								agent.session.append('agent-preset/selected', { agentPreset: preset.id });
								writeOk(res, {
									ok: true,
									sessionId,
									agentPreset: preset.id,
									name: preset.name === undefined ? preset.id : preset.name
								});
								break;
							}
							// Not loaded: no live agent to recompose, but the selection can
							// still be recorded as a DEFERRED log event. Resume composes from
							// the last agent-preset/selected event, so reopening the session
							// applies the new mode; a stale reference is superseded too.
							const presets = await scope.agentPresets.list();
							if (!presets.some((preset) => preset.id === presetId)) {
								throw new PresetSwitchError('bad-request', `preset "${presetId}" does not exist`);
							}
							const stored = await readStored(scope, sessionId);
							if (stored === null) {
								throw new PresetSwitchError('not-found', `session "${sessionId}" not found or unreadable`, 404);
							}
							const failure = await appendStoredSelection(scope, sessionId, presetId);
							if (failure !== null) {
								throw new PresetSwitchError('append-failed', `could not record the mode on session "${sessionId}": ${failure}`, 409);
							}
							const displayName = presets.find((preset) => preset.id === presetId)?.name ?? presetId;
							writeOk(res, {
								ok: true,
								deferred: true,
								sessionId,
								agentPreset: presetId,
								name: displayName,
								message: `会话 "${sessionId}" 未打开：已将模式记录为 "${displayName}"，重新打开该会话时生效。`
							});
							break;
						}
						case 'repair': {
							const requestedId = typeof body?.sessionId === 'string' ? body.sessionId : undefined;
							const targetId = typeof body?.target === 'string' && body.target !== '' ? body.target : undefined;
							const presets = await scope.agentPresets.list();
							const validIds = new Set(presets.map((preset) => preset.id));
							const defaultId = scope.agentPresets.defaultId;
							// The configured default can itself point at a preset that is no longer
							// installed (e.g. a removed bundle); fall back to a preset that exists so
							// the one-click repair keeps working instead of failing on the default.
							const fallbackTarget = typeof defaultId === 'string' && validIds.has(defaultId)
								? defaultId
								: (validIds.has('standard') ? 'standard' : (presets[0]?.id ?? 'standard'));
							const repairTarget = targetId === undefined ? fallbackTarget : targetId;
							if (!validIds.has(repairTarget)) {
								throw new PresetSwitchError('bad-request', `repair target preset "${repairTarget}" does not exist`);
							}
							const snapshots = await scope.sessionPersistence.list();
							const ids = new Set();
							for (const snapshot of snapshots) {
								const id = snapshot?.header?.id;
								if (typeof id === 'string' && id !== '') ids.add(id);
							}
							const candidates = requestedId === undefined
								? [...ids]
								: [...ids].filter((id) => id === requestedId);
							if (requestedId !== undefined && candidates.length === 0) {
								throw new PresetSwitchError('not-found', `session "${requestedId}" not found`, 404);
							}
							const repaired = [];
							const checked = [];
							for (const sessionId of candidates) {
								const row = await repairOne(scope, sessionId, validIds, repairTarget);
								checked.push(row);
								if (row.status === 'repaired') repaired.push(row);
							}
							writeOk(res, { repaired, checked, target: repairTarget });
							break;
						}
						default:
							throw new PresetSwitchError('not-found', `unknown method ${JSON.stringify(method)}`, 404);
					}
				} catch (error) {
					writeError(res, error);
				}
			}
		}), 'dsh-preset-switcher: api routes');
	});
}

export { apply, inject, name };
