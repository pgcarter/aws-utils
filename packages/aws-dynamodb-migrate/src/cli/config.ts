import { existsSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { UsageError } from './args.js';
import type { CliConfig } from './commands.js';

const CONFIG_CANDIDATES = [
  'dynamodb-migrate.config.ts',
  'dynamodb-migrate.config.js',
  'dynamodb-migrate.config.mjs',
] as const;

const locateConfig = (cwd: string, explicitPath?: string): string => {
  if (explicitPath) {
    const path = resolve(cwd, explicitPath);
    if (!existsSync(path)) throw new UsageError(`Config file not found: ${path}`);
    return path;
  }
  for (const candidate of CONFIG_CANDIDATES) {
    const path = resolve(cwd, candidate);
    if (existsSync(path)) return path;
  }
  throw new UsageError(
    `No config file found (looked for ${CONFIG_CANDIDATES.join(', ')} in ${cwd}). ` +
      `Pass --config <path> or add one exporting { client, tableName, migrationsDir }.`,
  );
};

/**
 * Load the user's config module and normalise it into a {@link CliConfig}. The
 * module exports a default (or named `config`) object carrying the typed client,
 * table name and migrations directory; `migrationsDir` is resolved relative to
 * the config file so it does not depend on the working directory. The core does
 * the same loader-agnostic `import(...)` for migrations themselves (ADR-0002),
 * so a `.ts` config works under `tsx` and a `.js` config under plain node.
 */
export const loadConfig = async (cwd: string, explicitPath?: string): Promise<CliConfig> => {
  const configPath = locateConfig(cwd, explicitPath);
  const mod: unknown = await import(pathToFileURL(configPath).href);
  const raw = (mod as { default?: unknown; config?: unknown }).default ??
    (mod as { config?: unknown }).config;

  if (!raw || typeof raw !== 'object') {
    throw new UsageError(`Config at ${configPath} must default-export an object.`);
  }
  const config = raw as Partial<CliConfig>;
  if (!config.client) throw new UsageError(`Config at ${configPath} is missing "client".`);
  if (!config.tableName) throw new UsageError(`Config at ${configPath} is missing "tableName".`);
  if (!config.migrationsDir) {
    throw new UsageError(`Config at ${configPath} is missing "migrationsDir".`);
  }

  const migrationsDir = isAbsolute(config.migrationsDir)
    ? config.migrationsDir
    : resolve(dirname(configPath), config.migrationsDir);

  return {
    client: config.client,
    tableName: config.tableName,
    dynamoClient: config.dynamoClient,
    migrationsDir,
  };
};
