# Loader-agnostic core with two runtime modes (tsx CLI, compiled-JS Lambda)

The core discovers migrations by reading `migrationsDir` at runtime and executes each via `import(filePath)`. It is agnostic to whether the file is `.ts` or `.js` and bundles no transpiler. How those imports resolve is the host environment's concern, giving two supported v1 modes:

- **CLI / local / CI:** run under `tsx`, point `migrationsDir` at `.ts` sources.
- **Lambda-on-deploy:** pre-compile migrations to `.js`, package the migrations dir as Lambda **assets** (on disk in the zip, not bundled code), and point `migrationsDir` at the compiled directory. Plain Node `import()` resolves them with no `tsx`.

## Why

Node cannot `import` TypeScript without a loader, and a bundled Lambda artifact only includes files the bundler sees at build time — but migrations are discovered by a runtime directory scan, so a bundler would omit them entirely. Owning a transpiler (jiti/esbuild) inside the package would solve the loader half but pull a transpiler into the dependency tree and still not fix the "bundler can't see runtime-discovered files" half. Keeping the core to `import(filePath)` and pushing both concerns to the environment keeps the package small and makes the Lambda path a documented first-class mode rather than a silent breakage.

## Consequences

- Lambda users MUST package the migrations directory as assets and point at compiled `.js`; this is documented, not enforced.
- The package never gains a transpiler dependency. If one runtime mode needs richer loading later, it is added at the edge (CLI), not the core.
