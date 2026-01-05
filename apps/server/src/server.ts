/**
 * Bun server entry point.
 * This file is the runtime entry - starts the server.
 */

import { app } from "./app";
import { env } from "./env";

console.log(`Server starting on port ${env.PORT}...`);

export default {
  port: env.PORT,
  fetch: app.fetch,
};
