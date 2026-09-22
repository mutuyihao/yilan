const { test, assert, freshRequire } = require('./harness');

const Errors = freshRequire('shared/errors.js');
global.AISummaryErrors = Errors;

const UrlUtils = freshRequire('shared/url-utils.js');
global.AISummaryUrlUtils = UrlUtils;

const EndpointProbe = freshRequire('background/endpoint-probe.js');

function httpError(status, message) {
  return Errors.createHttpError(status, message || '', { stage: 'primary', provider: 'openai' });
}

test('endpoint probe classifies compatibility-switch errors the way the run engine expects', 'transport.errors', () => {
  assert.strictEqual(EndpointProbe.isAutoEndpointNotSupportedError(Errors.createError(Errors.ERROR_CODES.ENDPOINT_NOT_SUPPORTED)), true);
  assert.strictEqual(EndpointProbe.isAutoEndpointNotSupportedError(Errors.createError(Errors.ERROR_CODES.UNSUPPORTED_RESPONSE_FORMAT)), true);
  assert.strictEqual(EndpointProbe.isAutoEndpointNotSupportedError(httpError(404)), true);
  assert.strictEqual(EndpointProbe.isAutoEndpointNotSupportedError(httpError(400, 'no route matched')), true);
  assert.strictEqual(EndpointProbe.isAutoEndpointNotSupportedError(httpError(405, 'Cannot POST /v2/x')), true);
  assert.strictEqual(EndpointProbe.isAutoEndpointNotSupportedError(httpError(400, 'invalid api key')), false);
  assert.strictEqual(EndpointProbe.isAutoEndpointNotSupportedError(httpError(500)), false);
  assert.strictEqual(EndpointProbe.isAutoEndpointNotSupportedError(Errors.createError(Errors.ERROR_CODES.RUN_CANCELLED)), false);
});

test('endpoint probe only offers bare-origin or /v1 base URLs for the trailing-v1 toggle', 'transport.errors', () => {
  assert.strictEqual(EndpointProbe.canAutoToggleTrailingV1('https://api.example.com/'), true);
  assert.strictEqual(EndpointProbe.canAutoToggleTrailingV1('https://api.example.com/v1'), true);
  assert.strictEqual(EndpointProbe.canAutoToggleTrailingV1('https://api.example.com/v1/chat/completions'), false);
  assert.strictEqual(EndpointProbe.canAutoToggleTrailingV1('https://api.example.com/deeper/path/'), false);
  assert.strictEqual(EndpointProbe.canAutoToggleTrailingV1(''), false);
});

test('compatibility state machine probes endpoint modes then toggles /v1 without consuming retries', 'transport.errors', () => {
  const compat = EndpointProbe.createCompatibilityStateMachine({
    isOpenAiProvider: true,
    endpointMode: 'auto',
    baseUrl: 'https://api.example.com/'
  });

  assert.strictEqual(compat.wantsAutoEndpointMode, true);
  assert.strictEqual(compat.canTryV1Toggle, true);
  compat.markEndpointModeTried('responses');

  // First failure: probe chat_completions, then legacy_completions.
  const first = compat.nextCompatibilityAttempt(httpError(404), { baseInput: 'https://api.example.com/' });
  assert.deepStrictEqual(first, { kind: 'endpoint_mode', nextMode: 'chat_completions' });
  compat.applySwitch(first, { endpointMode: 'chat_completions', baseUrl: 'https://api.example.com/chat/completions' });

  const second = compat.nextCompatibilityAttempt(httpError(404), { baseInput: 'https://api.example.com/' });
  assert.deepStrictEqual(second, { kind: 'endpoint_mode', nextMode: 'legacy_completions' });
  compat.applySwitch(second, { endpointMode: 'legacy_completions', baseUrl: 'https://api.example.com/completions' });

  // All modes tried: fall through to the /v1 toggle of the user-facing base.
  const third = compat.nextCompatibilityAttempt(httpError(404), { baseInput: 'https://api.example.com/' });
  assert.deepStrictEqual(third, { kind: 'base_url_v1', nextBase: 'https://api.example.com/v1' });
  compat.applySwitch(third, { endpointMode: 'legacy_completions', baseUrl: 'https://api.example.com/v1/completions' });

  // The /v1 switch resets the mode budget except the mode already active on
  // the new URL shape (mirrors the run engine's original clear+add semantics).
  const reprobe = compat.nextCompatibilityAttempt(httpError(404), { baseInput: 'https://api.example.com/' });
  assert.deepStrictEqual(reprobe, { kind: 'endpoint_mode', nextMode: 'responses' });
  compat.applySwitch(reprobe, { endpointMode: 'responses', baseUrl: 'https://api.example.com/v1/responses' });

  const reprobe2 = compat.nextCompatibilityAttempt(httpError(404), { baseInput: 'https://api.example.com/' });
  assert.deepStrictEqual(reprobe2, { kind: 'endpoint_mode', nextMode: 'chat_completions' });
  compat.applySwitch(reprobe2, { endpointMode: 'chat_completions', baseUrl: 'https://api.example.com/v1/chat/completions' });

  // responses + chat_completions probed, legacy_completions already marked
  // from the pre-toggle attempt: budget exhausted on the /v1 shape.
  const exhausted = compat.nextCompatibilityAttempt(httpError(404), { baseInput: 'https://api.example.com/' });
  assert.strictEqual(exhausted, null);

  // Non-switch errors never trigger a switch.
  const nonSwitch = EndpointProbe.createCompatibilityStateMachine({
    isOpenAiProvider: true,
    endpointMode: 'auto',
    baseUrl: 'https://api.example.com/'
  });
  nonSwitch.markEndpointModeTried('responses');
  assert.strictEqual(nonSwitch.nextCompatibilityAttempt(httpError(401), { baseInput: 'https://api.example.com/' }), null);
});

test('compatibility state machine stays inert for non-openai providers and fixed endpoint modes', 'transport.errors', () => {
  const anthropic = EndpointProbe.createCompatibilityStateMachine({
    isOpenAiProvider: false,
    endpointMode: 'auto',
    baseUrl: 'https://api.anthropic.com'
  });
  assert.strictEqual(anthropic.wantsAutoEndpointMode, false);
  assert.strictEqual(anthropic.canTryV1Toggle, false);
  assert.strictEqual(anthropic.nextCompatibilityAttempt(httpError(404), { baseUrl: 'https://api.anthropic.com' }), null);

  const fixedMode = EndpointProbe.createCompatibilityStateMachine({
    isOpenAiProvider: true,
    endpointMode: 'chat_completions',
    baseUrl: 'https://api.example.com/'
  });
  assert.strictEqual(fixedMode.wantsAutoEndpointMode, false);
  assert.strictEqual(fixedMode.canTryV1Toggle, true);

  const toggleOnly = fixedMode.nextCompatibilityAttempt(httpError(404), { baseInput: 'https://api.example.com/' });
  assert.deepStrictEqual(toggleOnly, { kind: 'base_url_v1', nextBase: 'https://api.example.com/v1' });
});
