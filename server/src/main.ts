import { createApp } from './app.js';
import { config } from './config.js';

const app = await createApp();
await app.listen(config.port, config.host);
console.log(`CMG Inventory API listening on http://${config.host}:${config.port}/api`);
