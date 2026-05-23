import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: { compilerOptions: { composite: false } },
  clean: true,
  sourcemap: true,
  target: 'es2022',
  external: [
    '@aws-sdk/client-dynamodb-streams',
    '@aws-sdk/util-dynamodb',
    '@bm8/aws-dynamodb',
  ],
});
