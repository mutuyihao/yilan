(function initYilanRunState(global) {
  const activeRuns = new Map();
  const portRuns = new Map();

  function ensurePortRunSet(portId) {
    if (!portRuns.has(portId)) {
      portRuns.set(portId, new Set());
    }
    return portRuns.get(portId);
  }

  function prepareRun(runId, payload) {
    const next = Object.assign({ runId, cancelled: false, controller: null }, activeRuns.get(runId) || {}, payload || {});
    activeRuns.set(runId, next);

    if (next.portId) {
      ensurePortRunSet(next.portId).add(runId);
    }

    return next;
  }

  function setRunController(runId, controller) {
    const entry = activeRuns.get(runId);
    if (!entry) return;
    entry.controller = controller || null;
    activeRuns.set(runId, entry);
  }

  function isRunCancelled(runId) {
    return !!activeRuns.get(runId)?.cancelled;
  }

  function cancelRun(runId, reason) {
    const entry = activeRuns.get(runId);
    if (!entry) return false;

    entry.cancelled = true;
    entry.cancelReason = reason || 'user';
    activeRuns.set(runId, entry);

    try {
      entry.controller?.abort(reason || 'user');
    } catch {}

    return true;
  }

  function finishRun(runId) {
    const entry = activeRuns.get(runId);
    if (entry?.portId) {
      const ids = portRuns.get(entry.portId);
      if (ids) {
        ids.delete(runId);
        if (!ids.size) {
          portRuns.delete(entry.portId);
        }
      }
    }

    activeRuns.delete(runId);
  }

  function cancelPortRuns(portId) {
    const ids = Array.from(portRuns.get(portId) || []);
    ids.forEach((runId) => cancelRun(runId, 'port_disconnected'));
  }

  const api = {
    prepareRun,
    setRunController,
    isRunCancelled,
    cancelRun,
    finishRun,
    cancelPortRuns
  };

  global.YilanRunState = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof self !== 'undefined' ? self : globalThis);
