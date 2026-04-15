const { run } = require('./harness');
const featureMatrix = require('./feature-matrix');

require('./unit-core.test');
require('./unit-adapters-transport.test');
require('./unit-record-store.test');
require('./static-contracts.test');

run(featureMatrix).catch((error) => {
  console.error(error);
  process.exit(1);
});

