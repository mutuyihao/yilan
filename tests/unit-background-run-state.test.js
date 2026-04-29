const { test, assert, freshRequire } = require('./harness');

function createAbortSpy() {
  const calls = [];
  return {
    calls,
    abort(reason) {
      calls.push(reason);
    }
  };
}

test('background run state tracks controllers, cancellation, and finish cleanup', 'run.cancellation', () => {
  const RunState = freshRequire('background/run-state.js');
  const controller = createAbortSpy();

  const entry = RunState.prepareRun('run_1', {
    portId: 'port_1',
    stage: 'primary',
    runtime: { provider: 'openai' }
  });
  assert.strictEqual(entry.runId, 'run_1');
  assert.strictEqual(entry.cancelled, false);

  RunState.setRunController('run_1', controller);
  assert.strictEqual(RunState.cancelRun('missing', 'user'), false);
  assert.strictEqual(RunState.cancelRun('run_1', 'user'), true);
  assert.deepStrictEqual(controller.calls, ['user']);
  assert.strictEqual(RunState.isRunCancelled('run_1'), true);

  RunState.finishRun('run_1');
  assert.strictEqual(RunState.isRunCancelled('run_1'), false);
  assert.strictEqual(RunState.cancelRun('run_1', 'user'), false);
});

test('background run state cancels all runs attached to a disconnected port', 'run.cancellation', () => {
  const RunState = freshRequire('background/run-state.js');
  const first = createAbortSpy();
  const second = createAbortSpy();
  const other = createAbortSpy();

  RunState.prepareRun('run_a', { portId: 'port_shared' });
  RunState.setRunController('run_a', first);
  RunState.prepareRun('run_b', { portId: 'port_shared' });
  RunState.setRunController('run_b', second);
  RunState.prepareRun('run_c', { portId: 'port_other' });
  RunState.setRunController('run_c', other);

  RunState.cancelPortRuns('port_shared');

  assert.strictEqual(RunState.isRunCancelled('run_a'), true);
  assert.strictEqual(RunState.isRunCancelled('run_b'), true);
  assert.strictEqual(RunState.isRunCancelled('run_c'), false);
  assert.deepStrictEqual(first.calls, ['port_disconnected']);
  assert.deepStrictEqual(second.calls, ['port_disconnected']);
  assert.deepStrictEqual(other.calls, []);

  RunState.finishRun('run_a');
  RunState.finishRun('run_b');
  RunState.finishRun('run_c');
  assert.strictEqual(RunState.cancelRun('run_a', 'user'), false);
  assert.strictEqual(RunState.cancelRun('run_b', 'user'), false);
  assert.strictEqual(RunState.cancelRun('run_c', 'user'), false);
});
