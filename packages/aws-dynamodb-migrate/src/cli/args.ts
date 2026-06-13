import type { RepairMode } from '../repair.js';

/**
 * A bad invocation: a missing subcommand, an unknown flag, a missing required
 * argument, or a mutually-exclusive flag pair. Carried distinct from runtime
 * failures so the CLI can print usage and exit with a usage code rather than a
 * stack trace.
 */
export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsageError';
  }
}

/** The parsed shape of a CLI invocation — a discriminated union per subcommand. */
export type ParsedCommand =
  | { kind: 'up'; dryRun: boolean }
  | { kind: 'status' }
  | { kind: 'new'; description: string }
  | { kind: 'repair'; id: string; mode: RepairMode }
  | { kind: 'unlock' }
  | { kind: 'help' };

const KNOWN_COMMANDS = ['up', 'status', 'new', 'repair', 'unlock', 'help'] as const;

const partition = (rest: readonly string[]): { positionals: string[]; flags: Set<string> } => {
  const positionals: string[] = [];
  const flags = new Set<string>();
  for (const arg of rest) {
    if (arg.startsWith('--')) flags.add(arg);
    else positionals.push(arg);
  }
  return { positionals, flags };
};

const rejectUnknownFlags = (flags: Set<string>, allowed: readonly string[]): void => {
  for (const flag of flags) {
    if (!allowed.includes(flag)) throw new UsageError(`Unknown option ${flag}`);
  }
};

/**
 * Parse argv (already sliced past `node` and the script) into a {@link ParsedCommand}.
 * Pure and total: every valid invocation maps to a command, every invalid one
 * throws {@link UsageError}. This is the CLI's single tested surface — handlers
 * receive the result and only map it onto core options.
 */
export const parseArgs = (argv: readonly string[]): ParsedCommand => {
  const [command, ...rest] = argv;

  if (command === undefined || command === 'help' || command === '--help' || command === '-h') {
    return { kind: 'help' };
  }
  if (!KNOWN_COMMANDS.includes(command as (typeof KNOWN_COMMANDS)[number])) {
    throw new UsageError(`Unknown command "${command}"`);
  }

  const { positionals, flags } = partition(rest);

  switch (command) {
    case 'up': {
      rejectUnknownFlags(flags, ['--dry-run']);
      if (positionals.length > 0) throw new UsageError('up takes no arguments');
      return { kind: 'up', dryRun: flags.has('--dry-run') };
    }
    case 'status': {
      rejectUnknownFlags(flags, []);
      if (positionals.length > 0) throw new UsageError('status takes no arguments');
      return { kind: 'status' };
    }
    case 'new': {
      rejectUnknownFlags(flags, []);
      const description = positionals.join(' ').trim();
      if (!description) throw new UsageError('new requires a <description>');
      return { kind: 'new', description };
    }
    case 'repair': {
      rejectUnknownFlags(flags, ['--retry', '--resolve']);
      const id = positionals[0];
      if (!id) throw new UsageError('repair requires an <id>');
      if (positionals.length > 1) throw new UsageError('repair takes a single <id>');
      const retry = flags.has('--retry');
      const resolve = flags.has('--resolve');
      if (retry === resolve) {
        throw new UsageError('repair requires exactly one of --retry or --resolve');
      }
      return { kind: 'repair', id, mode: retry ? 'retry' : 'resolve' };
    }
    case 'unlock': {
      rejectUnknownFlags(flags, ['--force']);
      if (!flags.has('--force')) {
        throw new UsageError('unlock requires --force to clear the lock');
      }
      return { kind: 'unlock' };
    }
    default:
      // Unreachable: command is one of KNOWN_COMMANDS, all handled above.
      throw new UsageError(`Unknown command "${command}"`);
  }
};

/** One-screen usage text, printed for `help` and on a {@link UsageError}. */
export const USAGE = `dynamodb-migrate — Flyway-style data migrations for DynamoDB

Usage:
  dynamodb-migrate up [--dry-run]        Apply all pending migrations (--dry-run reports only)
  dynamodb-migrate status                List every migration's state and whether the lock is held
  dynamodb-migrate new <description>     Scaffold a new <timestamp>__<description>.ts migration
  dynamodb-migrate repair <id> --retry   Re-run a failed migration from the top
  dynamodb-migrate repair <id> --resolve Mark a failed migration applied (skip it forever)
  dynamodb-migrate unlock --force        Clear a stale lock left by a crashed run

Configuration is read from dynamodb-migrate.config.{ts,js,mjs} in the working
directory (or --config <path>), exporting { client, tableName, migrationsDir }.`;
