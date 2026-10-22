import { parseArgs, USAGE, UsageError } from './args.js';
import { type CliDeps, defaultDeps, dispatch } from './commands.js';
import { loadConfig } from './config.js';

/** Process-exit codes: 0 ok, 1 runtime failure, 2 misuse. */
export const EXIT = { ok: 0, failure: 1, usage: 2 } as const;

export interface MainOptions {
  /** Working directory used to locate the config file. Defaults to `process.cwd()`. */
  cwd?: string;
  /** Injected collaborators; defaults to the real core + console logger. */
  deps?: CliDeps;
}

/**
 * Extract a leading-or-anywhere `--config <path>` pair so {@link parseArgs} only
 * sees per-command args. Returns the path (if any) and the remaining argv.
 */
const extractConfigFlag = (argv: readonly string[]): { configPath?: string; rest: string[] } => {
  const rest: string[] = [];
  let configPath: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--config') {
      configPath = argv[i + 1];
      if (!configPath) throw new UsageError('--config requires a path');
      i++; // skip the consumed value
      continue;
    }
    rest.push(argv[i]!);
  }
  return { configPath, rest };
};

/**
 * The CLI entry point: parse argv, load config for the commands that need it,
 * and dispatch to the matching handler. Returns a process-exit code rather than
 * calling `process.exit`, so it stays testable. A {@link UsageError} prints usage
 * and exits 2; any other failure prints its message and exits 1.
 */
export const main = async (argv: readonly string[], options: MainOptions = {}): Promise<number> => {
  const deps = options.deps ?? defaultDeps();

  let configPath: string | undefined;
  let command;
  try {
    const extracted = extractConfigFlag(argv);
    configPath = extracted.configPath;
    command = parseArgs(extracted.rest);
  } catch (error) {
    if (error instanceof UsageError) {
      console.error(error.message);
      console.error(`\n${USAGE}`);
      return EXIT.usage;
    }
    throw error;
  }

  if (command.kind === 'help') {
    console.log(USAGE);
    return EXIT.ok;
  }

  try {
    const config = await loadConfig(options.cwd ?? process.cwd(), configPath);
    await dispatch(command, config, deps);
    return EXIT.ok;
  } catch (error) {
    if (error instanceof UsageError) {
      console.error(error.message);
      return EXIT.usage;
    }
    console.error(error instanceof Error ? error.message : String(error));
    return EXIT.failure;
  }
};
