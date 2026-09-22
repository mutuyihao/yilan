const { run } = require('./harness');
const featureMatrix = require('./feature-matrix');

// Resolve UI copy through the zh_CN catalog in Node tests so modules that call
// YilanI18n render the same strings the pinned E2E locale sees.
require('../shared/i18n.js').setCatalog(require('../_locales/zh_CN/messages.json'));

require('./unit-core.test');
require('./unit-adapters-transport.test');
require('./unit-background-entrypoints.test');
require('./unit-background-run-state.test');
require('./unit-background-reader-sessions.test');
require('./unit-background-caches.test');
require('./unit-endpoint-probe.test');
require('./unit-sidebar-export.test');
require('./unit-sidebar-reader-session.test');
require('./unit-sidebar-generation.test');
require('./unit-sidebar-mode-control.test');
require('./unit-sidebar-render.test');
require('./unit-sidebar-events.test');
require('./unit-sidebar-state.test');
require('./unit-record-store.test');
require('./unit-chrome-api.test');
require('./unit-popup-profiles.test');
require('./unit-i18n.test');
require('./unit-prompt-locale.test');
require('./static-contracts.test');

run(featureMatrix).catch((error) => {
  console.error(error);
  process.exit(1);
});
