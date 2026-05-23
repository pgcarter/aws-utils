import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'es2022',
  external: ['@aws-sdk/client-dynamodb', '@aws-sdk/lib-dynamodb', '@bm8/aws-core'],
});
