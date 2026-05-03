const { test, assert, freshRequire } = require('./harness');

const Errors = freshRequire('shared/errors.js');
global.AISummaryErrors = Errors;

const ProviderPresets = freshRequire('shared/provider-presets.js');
global.AISummaryProviderPresets = ProviderPresets;

const OpenAIAdapter = freshRequire('adapters/openai-adapter.js');
const AnthropicAdapter = freshRequire('adapters/anthropic-adapter.js');
global.AISummaryOpenAIAdapter = OpenAIAdapter;
global.AISummaryAnthropicAdapter = AnthropicAdapter;

const AdapterRegistry = freshRequire('adapters/registry.js');
const TransportUtils = freshRequire('shared/transport-utils.js');

test('openai adapter resolves endpoint modes, headers, bodies, text, deltas, and usage', 'provider.openai', () => {
  const responses = OpenAIAdapter.resolve({ aiProvider: 'openai' });
  assert.strictEqual(responses.endpointMode, 'responses');
  assert.strictEqual(responses.baseUrl, 'https://api.openai.com/v1/responses');
  assert.strictEqual(responses.adapterId, 'openai_responses');

  const chat = OpenAIAdapter.resolve({
    aiProvider: 'openai',
    endpointMode: 'chat_completions',
    aiBaseURL: 'https://api.example.com/v1'
  });
  assert.strictEqual(chat.endpointMode, 'chat_completions');
  assert.strictEqual(chat.baseUrl, 'https://api.example.com/v1/chat/completions');

  const detected = OpenAIAdapter.resolve({
    aiProvider: 'openai',
    aiBaseURL: 'https://api.example.com/v1/chat/completions'
  });
  assert.strictEqual(detected.endpointMode, 'chat_completions');
  assert.strictEqual(detected.baseUrl, 'https://api.example.com/v1/chat/completions');

  const legacy = OpenAIAdapter.resolve({
    aiProvider: 'openai',
    endpointMode: 'legacy_completions',
    aiBaseURL: 'https://api.example.com/v1'
  });
  assert.strictEqual(legacy.endpointMode, 'legacy_completions');
  assert.strictEqual(legacy.defaultModel, 'gpt-3.5-turbo-instruct');
  assert.strictEqual(legacy.baseUrl, 'https://api.example.com/v1/completions');

  const customRoot = OpenAIAdapter.resolve({
    aiProvider: 'openai',
    aiBaseURL: 'https://api.example.com/v1'
  });
  assert.strictEqual(customRoot.baseUrl, 'https://api.example.com/v1/responses');

  const customExact = OpenAIAdapter.resolve({
    providerPreset: 'custom',
    aiProvider: 'openai',
    aiBaseURL: 'https://api.example.com/custom'
  });
  assert.strictEqual(customExact.baseUrl, 'https://api.example.com/custom/responses');

  const preset = OpenAIAdapter.resolve({
    providerPreset: 'deepseek',
    aiProvider: 'openai',
    endpointMode: 'chat_completions',
    aiBaseURL: 'https://api.deepseek.com'
  });
  assert.strictEqual(preset.baseUrl, 'https://api.deepseek.com/chat/completions');

  const headers = OpenAIAdapter.buildHeaders({ apiKey: 'key' }, responses, true);
  assert.strictEqual(headers.Authorization, 'Bearer key');
  assert.strictEqual(headers.Accept, 'text/event-stream, application/json');
  assert.strictEqual(headers['OpenAI-Beta'], 'responses=v1');

  assert.deepStrictEqual(OpenAIAdapter.buildBody({ runtime: responses, prompt: 'hello', stream: true }), {
    model: 'gpt-4o-mini',
    stream: true,
    input: 'hello'
  });
  assert.deepStrictEqual(OpenAIAdapter.buildBody({ runtime: chat, prompt: 'hello', stream: false }), {
    model: 'gpt-4o-mini',
    stream: false,
    messages: [{ role: 'user', content: 'hello' }]
  });
  assert.deepStrictEqual(OpenAIAdapter.buildBody({ runtime: legacy, prompt: 'hello', stream: false }), {
    model: 'gpt-3.5-turbo-instruct',
    stream: false,
    prompt: 'hello',
    max_tokens: 4096
  });

  assert.strictEqual(OpenAIAdapter.extractText({ output_text: 'direct' }, responses), 'direct');
  assert.strictEqual(OpenAIAdapter.extractText({ response: { output_text: 'nested' } }, responses), 'nested');
  assert.strictEqual(OpenAIAdapter.extractText({ choices: [{ message: { content: [{ text: 'chat' }] } }] }, chat), 'chat');
  assert.strictEqual(OpenAIAdapter.extractDelta({ type: 'response.output_text.delta', delta: 'A' }, responses, 'message'), 'A');
  assert.strictEqual(OpenAIAdapter.extractDelta({ type: 'response.output_item.added', item: { text: 'B' } }, responses, 'message'), 'B');
  assert.strictEqual(OpenAIAdapter.extractDelta({ choices: [{ delta: { content: 'C' } }] }, chat), 'C');
  assert.deepStrictEqual(OpenAIAdapter.extractUsage({ response: { usage: { input_tokens: 1 } } }), { input_tokens: 1 });
});

test('anthropic adapter resolves endpoints, official headers, bodies, text, deltas, and usage', 'provider.anthropic', () => {
  const official = AnthropicAdapter.resolve({ aiProvider: 'anthropic' });
  assert.strictEqual(official.endpointMode, 'messages');
  assert.strictEqual(official.baseUrl, 'https://api.anthropic.com/v1/messages');
  assert.strictEqual(official.adapterId, 'anthropic_messages');

  const exact = AnthropicAdapter.resolve({
    aiProvider: 'anthropic',
    aiBaseURL: 'https://api.example.com/v1/messages'
  });
  assert.strictEqual(exact.baseUrl, 'https://api.example.com/v1/messages');

  const root = AnthropicAdapter.resolve({
    providerPreset: 'qwen',
    aiProvider: 'anthropic',
    endpointMode: 'messages',
    aiBaseURL: 'https://dashscope.aliyuncs.com/apps/anthropic'
  });
  assert.strictEqual(root.baseUrl, 'https://dashscope.aliyuncs.com/apps/anthropic/v1/messages');

  const officialHeaders = AnthropicAdapter.buildHeaders({ apiKey: 'key' }, official, true);
  assert.strictEqual(officialHeaders['x-api-key'], 'key');
  assert.strictEqual(officialHeaders['anthropic-version'], '2023-06-01');
  assert.strictEqual(officialHeaders.Accept, 'text/event-stream, application/json');

  const proxyHeaders = AnthropicAdapter.buildHeaders({ apiKey: 'key' }, root, false);
  assert.ok(!Object.prototype.hasOwnProperty.call(proxyHeaders, 'anthropic-version'));

  assert.deepStrictEqual(AnthropicAdapter.buildBody({ runtime: official, prompt: 'hello', stream: true }), {
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4096,
    stream: true,
    messages: [{ role: 'user', content: 'hello' }]
  });

  assert.strictEqual(AnthropicAdapter.extractText({ content: [{ type: 'text', text: 'A' }, { type: 'image', text: 'B' }] }), 'A');
  assert.strictEqual(AnthropicAdapter.extractDelta({ type: 'content_block_delta', delta: { text: 'C' } }), 'C');
  assert.deepStrictEqual(AnthropicAdapter.extractUsage({ message: { usage: { input_tokens: 1 } } }), { input_tokens: 1 });
});

test('adapter registry lists, resolves, and rejects unsupported providers', 'provider.registry', () => {
  assert.deepStrictEqual(AdapterRegistry.listAdapters().map((adapter) => adapter.provider).sort(), ['anthropic', 'openai']);
  assert.strictEqual(AdapterRegistry.getAdapter({ aiProvider: 'openai' }).provider, 'openai');
  assert.strictEqual(AdapterRegistry.getAdapter({ aiProvider: 'anthropic' }).provider, 'anthropic');
  assert.strictEqual(AdapterRegistry.getAdapter({ aiProvider: 'missing' }), null);
  assert.strictEqual(AdapterRegistry.resolve({ aiProvider: 'openai' }).snapshot.provider, 'openai');
  assert.strictEqual(AdapterRegistry.resolve({ aiProvider: 'missing' }), null);
});

test('transport parser and raw body helpers cover streaming and non-stream responses', [
  'transport.streaming',
  'transport.non_stream'
], () => {
  assert.strictEqual(TransportUtils.normalizePreview(' a\n b\t c '.repeat(80)).length, 300);

  const events = [];
  const parser = TransportUtils.createSseParser((eventName, data) => events.push([eventName, data]));
  parser.push(': keepalive\r\nevent: response.output_text.delta\r\n', false);
  parser.push('data: {"type":"response.output_text.delta","delta":"Hi"}\r\n\r\n', false);
  parser.push('data: {"type":"response.output_text.delta","delta":"!"}', true);
  assert.deepStrictEqual(events, [
    ['response.output_text.delta', '{"type":"response.output_text.delta","delta":"Hi"}'],
    ['message', '{"type":"response.output_text.delta","delta":"!"}']
  ]);

  const runtime = OpenAIAdapter.resolve({ aiProvider: 'openai' });
  const raw = [
    'event: response.output_text.delta',
    'data: {"type":"response.output_text.delta","delta":"Hello "}',
    '',
    'event: response.output_text.delta',
    'data: {"type":"response.output_text.delta","delta":"world","usage":{"output_tokens":2}}',
    '',
    'data: [DONE]'
  ].join('\n');

  assert.strictEqual(TransportUtils.extractTextFromRawBody(raw, OpenAIAdapter, runtime), 'Hello world');
  assert.deepStrictEqual(TransportUtils.extractUsageFromRawBody(raw, OpenAIAdapter, runtime), { output_tokens: 2 });

  assert.strictEqual(
    TransportUtils.extractTextFromRawBody(JSON.stringify({ output_text: 'json text' }), OpenAIAdapter, runtime),
    'json text'
  );
  assert.strictEqual(TransportUtils.extractTextFromRawBody('', OpenAIAdapter, runtime), '');
  assert.strictEqual(TransportUtils.extractUsageFromRawBody('', OpenAIAdapter, runtime), null);
});

test('transport errors normalize abort, CORS, DNS, TLS, network, stream, endpoint, and unknown cases', 'transport.errors', () => {
  const runtime = OpenAIAdapter.resolve({
    aiProvider: 'openai',
    endpointMode: 'responses',
    aiBaseURL: 'https://proxy.example.com/v1'
  });

  assert.strictEqual(
    TransportUtils.normalizeTransportError({ name: 'AbortError', message: 'aborted' }, runtime, 'primary', { runCancelled: true }).code,
    Errors.ERROR_CODES.RUN_CANCELLED
  );
  assert.strictEqual(
    TransportUtils.normalizeTransportError({ name: 'AbortError', message: 'timeout' }, runtime, 'primary', {}).code,
    Errors.ERROR_CODES.NETWORK_TIMEOUT
  );
  assert.strictEqual(
    TransportUtils.normalizeTransportError(new Error('CORS preflight failed'), runtime, 'primary', {}).code,
    Errors.ERROR_CODES.NETWORK_CORS_ERROR
  );
  assert.strictEqual(
    TransportUtils.normalizeTransportError(new Error('getaddrinfo ENOTFOUND'), runtime, 'primary', {}).code,
    Errors.ERROR_CODES.NETWORK_DNS_ERROR
  );
  assert.strictEqual(
    TransportUtils.normalizeTransportError(new Error('SSL certificate failed'), runtime, 'primary', {}).code,
    Errors.ERROR_CODES.NETWORK_TLS_ERROR
  );
  assert.strictEqual(
    TransportUtils.normalizeTransportError(new Error('Failed to fetch'), runtime, 'chunk', {}).code,
    Errors.ERROR_CODES.NETWORK_CONNECTION_ERROR
  );
  assert.strictEqual(
    TransportUtils.normalizeTransportError({ message: 'stream_disconnected' }, runtime, 'chunk', { reason: 'stream_disconnected' }).code,
    Errors.ERROR_CODES.NETWORK_STREAM_DISCONNECTED
  );

  assert.strictEqual(TransportUtils.isLikelyResponsesCompatibilityFailure(404, '', runtime), true);
  assert.strictEqual(TransportUtils.isLikelyResponsesCompatibilityFailure(400, 'messages is required', runtime), true);
  assert.strictEqual(TransportUtils.isLikelyResponsesCompatibilityFailure(400, 'ok', Object.assign({}, runtime, { endpointMode: 'chat_completions' })), false);

  const compatibility = TransportUtils.createEndpointCompatibilityError(404, 'Not Found', runtime, 'chunk');
  assert.strictEqual(compatibility.code, Errors.ERROR_CODES.ENDPOINT_NOT_SUPPORTED);
  assert.strictEqual(compatibility.httpStatus, 404);
  assert.strictEqual(compatibility.retriable, false);

  assert.strictEqual(
    TransportUtils.normalizeTransportError(new Error('weird'), runtime, 'primary', {}).code,
    Errors.ERROR_CODES.UNKNOWN_ERROR
  );
});
