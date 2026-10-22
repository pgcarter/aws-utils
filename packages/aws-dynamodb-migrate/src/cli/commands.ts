import { writeFile as fsWriteFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import type { MigrationLogger } from '../logger.js';
import { repair as coreRepair } from '../repair.js';
import { runMigrations as coreRunMigrations } from '../runMigrations.js';
import { status as coreStatus } from '../status.js';
import { forceUnlock as coreForceUnlock } from '../lock.js';
import type { ParsedCommand } from './args.js';
import { consoleLogger } from './logger.js';
import { scaffoldMigration } from './scaffold.js';

/**
 * The runtime configuration a command needs, supplied by the user's config file:
 * the typed client forwarded to each `up`, the table the ledger lives in, the
 * raw client carrying region/creds, and where the migration files are.
 */
export interface CliConfig {
  /** The user's `@bm8/aws-dynamodb` client, forwarded to each migration's `up({ db })`. */
  client: unknown;
  /** The table the ledger and lock live in. */
  tableName: string;
  /** Raw client carrying region/creds/endpoint, used for the internal ledger/lock clients. */
  dynamoClient?: DynamoDBClient;
  /** Absolute path to the directory of migration modules. */
  migrationsDir: string;
}

/**
 * Collaborators a handler depends on, injected so tests can assert the
 * args→core-options mapping without a database, a clock, or the filesystem.
 * Defaults wire the real core functions and console logger.
 */
export interface CliDeps {
  runMigrations: typeof coreRunMigrations;
  status: typeof coreStatus;
  repair: typeof coreRepair;
  forceUnlock: typeof coreForceUnlock;
  writeFile: (path: string, contents: string) => Promise<void>;
  logger: MigrationLogger;
  now: () => Date;
}

export const defaultDeps = (): CliDeps => ({
  runMigrations: coreRunMigrations,
  status: coreStatus,
  repair: coreRepair,
  forceUnlock: coreForceUnlock,
  writeFile: (path, contents) => fsWriteFile(path, contents, 'utf8'),
  logger: consoleLogger,
  now: () => new Date(),
});

const runUp = async (
  command: Extract<ParsedCommand, { kind: 'up' }>,
  config: CliConfig,
  deps: CliDeps,
): Promise<void> => {
  const summary = await deps.runMigrations({
    client: config.client,
    tableName: config.tableName,
    dynamoClient: config.dynamoClient,
    migrationsDir: config.migrationsDir,
    dryRun: command.dryRun,
    logger: deps.logger,
  });
  const verb = command.dryRun ? 'would apply' : 'applied';
  deps.logger.info(
    `${verb} ${summary.applied.length}, skipped ${summary.skipped.length}`,
  );
};

const runStatus = async (config: CliConfig, deps: CliDeps): Promise<void> => {
  const report = await deps.status({
    tableName: config.tableName,
    dynamoClient: config.dynamoClient,
    migrationsDir: config.migrationsDir,
  });
  for (const row of report.migrations) {
    const suffix = row.error ? ` (${row.error})` : '';
    deps.logger.info(`${row.state.padEnd(7)} ${row.name}${suffix}`);
  }
  deps.logger.info(
    report.lock.held
      ? `lock: HELD by ${report.lock.actor ?? 'unknown'}${report.lock.acquiredAt ? ` since ${report.lock.acquiredAt}` : ''}`
      : 'lock: free',
  );
};

const runNew = async (
  command: Extract<ParsedCommand, { kind: 'new' }>,
  config: CliConfig,
  deps: CliDeps,
): Promise<string> => {
  const { filename, contents } = scaffoldMigration(command.description, deps.now());
  const path = join(config.migrationsDir, filename);
  await deps.writeFile(path, contents);
  deps.logger.info(`created ${path}`);
  return path;
};

const runRepair = async (
  command: Extract<ParsedCommand, { kind: 'repair' }>,
  config: CliConfig,
  deps: CliDeps,
): Promise<void> => {
  await deps.repair({
    tableName: config.tableName,
    dynamoClient: config.dynamoClient,
    id: command.id,
    mode: command.mode,
  });
  deps.logger.info(`repaired ${command.id} (${command.mode})`);
};

const runUnlock = async (config: CliConfig, deps: CliDeps): Promise<void> => {
  const cleared = await deps.forceUnlock({
    tableName: config.tableName,
    dynamoClient: config.dynamoClient,
  });
  deps.logger.info(cleared ? 'lock cleared' : 'no lock was held');
};

/**
 * Route a parsed command to its handler. Each handler does no orchestration of
 * its own — it maps the parsed args onto the corresponding core capability and
 * reports through the logger. `help` is handled before dispatch (it needs no
 * config), so it never reaches here.
 */
export const dispatch = async (
  command: Exclude<ParsedCommand, { kind: 'help' }>,
  config: CliConfig,
  deps: CliDeps = defaultDeps(),
): Promise<void> => {
  switch (command.kind) {
    case 'up':
      return runUp(command, config, deps);
    case 'status':
      return runStatus(config, deps);
    case 'new':
      await runNew(command, config, deps);
      return;
    case 'repair':
      return runRepair(command, config, deps);
    case 'unlock':
      return runUnlock(config, deps);
  }
};

export { runUp, runStatus, runNew, runRepair, runUnlock };
