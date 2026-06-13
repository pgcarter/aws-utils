/**
 * Injectable progress sink for a migration run. The core reports which
 * migrations it is applying, has applied, or is skipping through {@link info},
 * and surfaces non-fatal concerns (e.g. a checksum mismatch under
 * `onChecksumMismatch: 'warn'`) through {@link warn}.
 *
 * The default is {@link noopLogger} — silent — so the core emits nothing unless
 * a caller opts in. The CLI passes a console-backed logger; a Lambda passes a
 * structured one.
 */
export interface MigrationLogger {
  /** Progress: a migration is about to run, has run, or was skipped. */
  info(message: string): void;
  /** A non-fatal concern the operator should see (does not halt the run). */
  warn(message: string): void;
}

/** The default logger: discards everything, so the core is silent by default. */
export const noopLogger: MigrationLogger = {
  info: () => {},
  warn: () => {},
};
