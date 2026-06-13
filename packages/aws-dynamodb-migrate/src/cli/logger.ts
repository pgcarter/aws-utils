import type { MigrationLogger } from '../logger.js';

/**
 * The CLI's logger: progress to stdout, non-fatal concerns to stderr. Passed to
 * the core so `up`'s per-migration progress and any checksum-mismatch warnings
 * surface on the console. (A Lambda passes a structured logger instead.)
 */
export const consoleLogger: MigrationLogger = {
  info: (message) => console.log(message),
  warn: (message) => console.warn(message),
};
