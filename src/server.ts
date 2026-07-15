import { createApp } from './app.js';
import { config } from './config.js';
import { log } from './observability/logger.js';

const app = createApp();

app.listen(config.port, () => {
  log.info('server.start', {
    port: config.port,
    env: config.nodeEnv,
    asp: config.service.asp,
    service: config.service.name,
    classifier: config.classifier.llmEnabled ? 'hybrid' : 'deterministic',
    payments_enabled: config.payments.enabled,
  });
});
