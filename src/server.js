require('dotenv').config();

// Local-dev workaround: some networks/ISPs refuse SRV lookups, which breaks
// mongodb+srv:// URIs. Set DNS_SERVERS=8.8.8.8,1.1.1.1 in your local .env to enable.
if (process.env.DNS_SERVERS) {
  require('node:dns').setServers(
    process.env.DNS_SERVERS.split(',').map((s) => s.trim()).filter(Boolean)
  );
}

const { createApp } = require('./app');
const { connectDatabase, disconnectDatabase } = require('./config/database');
const { getEnv } = require('./config/env');

async function start() {
  const env = getEnv();
  await connectDatabase(env.MONGODB_URI);
  const app = createApp({ env });
  const server = app.listen(env.PORT, () => {
    console.info(`EKŌ API listening on http://localhost:${env.PORT}/api/v1`);
  });

  let shuttingDown = false;
  async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.info(`${signal} received; closing API`);
    server.close(async (error) => {
      if (error) {
        console.error('Failed to close HTTP server cleanly', error);
        process.exitCode = 1;
      }
      try {
        await disconnectDatabase();
      } catch (disconnectError) {
        console.error('Failed to disconnect from MongoDB', disconnectError);
        process.exitCode = 1;
      }
    });
  }
  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
}

start().catch((error) => {
  console.error('Failed to start EKŌ API', error);
  process.exitCode = 1;
});