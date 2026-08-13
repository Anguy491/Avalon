import { loadConfig } from './config.js';
import { createDependencyChecks } from './dependencies.js';
import { createServer } from './server.js';

const config = loadConfig();
const dependencies = createDependencyChecks(config);
const server = await createServer(config, dependencies);

const shutdown = async (): Promise<void> => {
  await server.close();
};

process.once('SIGINT', () => {
  void shutdown();
});
process.once('SIGTERM', () => {
  void shutdown();
});

await server.app.listen({ host: config.host, port: config.port });
