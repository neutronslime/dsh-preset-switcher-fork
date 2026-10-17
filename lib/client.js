// dsh-preset-switcher client bundle.
//
// Module-loader format (the shell's ClientModuleSystem): executing this
// script only REGISTERS the factory; materialization runs factory(require)
// and the returned exports must be a Cordis plugin entry { name, inject,
// apply }. React comes from the module table's externals (require("react")).
// Everything else is plain DOM + fetch against the plugin's own fenced
// /preset-switch/api route.
window.__ModuleLoader__.load({
  id: "dsh-preset-switcher",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    var React = require("react");

    exports.name = "dsh-preset-switcher";
    exports.inject = ["slots"];

    //#region api
    /** One wire failure. */
    function apiError(message) {
      return new Error(message);
    }
    /** POST one method to the fenced route; resolves the unwrapped value. */
    function apiCall(method, payload) {
      return fetch("/preset-switch/api", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(Object.assign({ method: method }, payload === void 0 ? {} : payload))
      }).then(function (response) {
        return response.json().catch(function () { return null; }).then(function (parsed) {
          if (!response.ok || parsed === null || parsed.ok !== true || parsed.value === void 0) {
            throw apiError(
              parsed !== null && parsed !== void 0 && parsed.error !== void 0 && typeof parsed.error.message === "string"
                ? parsed.error.message
                : "HTTP " + response.status
            );
          }
          return parsed.value;
        });
      }).catch(function (error) {
        if (error instanceof Error) throw error;
        throw apiError(String(error));
      });
    }
    //#endregion

    //#region header action
    /**
    * The session-header dropdown: lists every agent preset, marks the one
    * the session currently runs, and switches on click. Works on started
    * sessions too - the host half skips the stock blank-session check. The
    * menu also offers a one-click "repair stale presets" action: sessions
    * whose recorded preset was deleted (custom preset removed) are rewritten
    * to the default preset so they can be reopened.
    */
    function PresetSwitchButton(props) {
      var sessionId = props.sessionId;
      var openState = React.useState(false);
      var open = openState[0];
      var setOpen = openState[1];
      var rowsState = React.useState([]);
      var rows = rowsState[0];
      var setRows = rowsState[1];
      var currentState = React.useState(null);
      var current = currentState[0];
      var setCurrent = currentState[1];
      var busyState = React.useState(false);
      var busy = busyState[0];
      var setBusy = busyState[1];
      var errorState = React.useState(null);
      var error = errorState[0];
      var setError = errorState[1];
      var repairState = React.useState(false);
      var repairBusy = repairState[0];
      var setRepairBusy = repairState[1];
      var noteState = React.useState(null);
      var note = noteState[0];
      var setNote = noteState[1];

      function refresh() {
        if (sessionId === void 0 || sessionId === null) return;
        apiCall("list", { sessionId: sessionId }).then(function (value) {
          if (Array.isArray(value.presets)) setRows(value.presets);
          setCurrent(value.current === void 0 || value.current === null ? null : value.current);
          setError(null);
        }).catch(function (e) {
          setError(e instanceof Error ? e.message : String(e));
        });
      }
      React.useEffect(function () { refresh(); }, [sessionId]);

      if (sessionId === void 0 || sessionId === null) return null;

      var currentRow = null;
      for (var i = 0; i < rows.length; i++) {
        if (rows[i].id === current) { currentRow = rows[i]; break; }
      }
      var label = currentRow !== null
        ? String(currentRow.name)
        : (current === null ? "模式" : String(current));

      function onPick(id) {
        if (busy || id === current) { setOpen(false); return; }
        setBusy(true);
        setError(null);
        setNote(null);
        apiCall("switch", { sessionId: sessionId, presetId: id }).then(function (value) {
          if (value !== null && typeof value === "object" && (value.repaired === true || value.deferred === true)) {
            // Not-loaded session: either its stale reference was repaired, or
            // the selection was recorded as a deferred log event. Either way
            // the change applies when the session is reopened.
            setNote(typeof value.message === "string" ? value.message : "已记录，重新打开会话时生效。");
            setOpen(false);
            refresh();
          } else {
            setOpen(false);
            refresh();
          }
        }).catch(function (e) {
          setError(e instanceof Error ? e.message : String(e));
        }).finally(function () { setBusy(false); });
      }

      function onRepair() {
        if (repairBusy) return;
        setRepairBusy(true);
        setNote(null);
        setError(null);
        apiCall("repair", {}).then(function (value) {
          var repaired = Array.isArray(value.repaired) ? value.repaired : [];
          var checked = Array.isArray(value.checked) ? value.checked.length : 0;
          if (repaired.length > 0) {
            var names = repaired.map(function (r) { return String(r.sessionId).slice(0, 8); }).join(", ");
            setNote("已修复 " + repaired.length + " 个会话（" + names + "）→ " + String(value.target) + "。重新打开即可使用。");
          } else {
            setNote("没有发现失效的预设引用（检查了 " + checked + " 个会话）。");
          }
        }).catch(function (e) {
          setError(e instanceof Error ? e.message : String(e));
        }).finally(function () { setRepairBusy(false); });
      }

      var buttonStyle = {
        display: "inline-flex", alignItems: "center", gap: "4px",
        padding: "3px 8px", borderRadius: "6px", border: "1px solid var(--dsw-alias-border-l1)",
        background: "transparent", color: "var(--dsw-alias-label-secondary)",
        cursor: busy ? "progress" : "pointer", fontSize: "12px", lineHeight: "1.4",
        whiteSpace: "nowrap"
      };
      var backdropStyle = { position: "fixed", inset: "0", zIndex: 1000, background: "transparent" };
      var menuStyle = {
        position: "absolute", right: "0", top: "calc(100% + 4px)", zIndex: 1001,
        background: "var(--dsw-alias-bg-overlay)", border: "1px solid var(--dsw-alias-border-l1)",
        borderRadius: "8px", padding: "4px", minWidth: "190px",
        boxShadow: "0 4px 16px rgba(0, 0, 0, 0.3)"
      };
      function itemStyle(isCurrent) {
        return {
          display: "block", width: "100%", textAlign: "left",
          padding: "5px 8px", borderRadius: "5px", border: "none",
          background: "transparent", color: "var(--dsw-alias-label-primary)",
          cursor: "pointer", fontSize: "12px", fontWeight: isCurrent ? "600" : "400",
          whiteSpace: "nowrap"
        };
      }
      var separatorStyle = {
        height: "1px", margin: "4px 6px", background: "var(--dsw-alias-border-l1)"
      };
      var noteStyle = {
        padding: "4px 8px", fontSize: "11px", lineHeight: "1.4",
        color: "var(--dsw-alias-state-success-primary)", maxWidth: "240px", whiteSpace: "normal"
      };

      return React.createElement(
        "div",
        { style: { position: "relative", display: "inline-flex", alignItems: "center" } },
        React.createElement("button", {
          type: "button",
          onClick: function () { setOpen(!open); },
          disabled: busy,
          title: error === null ? "切换会话模式（任意时刻生效）" : String(error),
          style: buttonStyle
        }, label, open ? " ▴" : " ▾"),
        error !== null && React.createElement("span", {
          style: { marginLeft: "4px", color: "var(--dsw-alias-state-error-primary)", fontSize: "11px" }
        }, "⚠"),
        // The menu must be a SIBLING of the backdrop: the backdrop is
        // position:fixed and would otherwise become the menu's containing
        // block, pushing the menu off-screen (top: 100% of the viewport).
        open && React.createElement("div", { style: backdropStyle, onClick: function () { setOpen(false); } }),
        open && React.createElement("div", { style: menuStyle, onClick: function (e) { e.stopPropagation(); } },
          rows.length === 0 && React.createElement("div", {
            style: { padding: "6px 8px", color: "var(--dsw-alias-label-secondary)", fontSize: "12px" }
          }, busy ? "切换中…" : "加载中…"),
          rows.map(function (row) {
            return React.createElement("button", {
              key: row.id,
              type: "button",
              disabled: busy || row.id === current,
              onClick: function () { onPick(row.id); },
              style: itemStyle(row.id === current)
            }, String(row.name), row.id === current ? " ✓" : "");
          }),
          error !== null && React.createElement("div", {
            style: { padding: "4px 8px", color: "var(--dsw-alias-state-error-primary)", fontSize: "11px", maxWidth: "240px", whiteSpace: "normal" }
          }, String(error)),
          React.createElement("div", { style: separatorStyle }),
          React.createElement("button", {
            type: "button",
            disabled: repairBusy,
            onClick: onRepair,
            style: itemStyle(false)
          }, repairBusy ? "修复中…" : "修复失效模式会话"),
          note !== null && React.createElement("div", { style: noteStyle }, String(note))
        )
      );
    }

    exports.apply = function (ctx) {
      ctx.effect(function () {
        return ctx.slots.inject("conversation.session.header.actions", function () {
          return ctx.slots.register({
            name: "conversation.session.header.actions",
            id: "preset-switch",
            order: 15,
            label: "切换模式",
            registrant: "dsh-preset-switcher"
          }, PresetSwitchButton);
        });
      }, "dsh-preset-switcher: header action");
    };
    //#endregion

    return module.exports;
  }
});
