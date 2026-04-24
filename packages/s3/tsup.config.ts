import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'es2022',
  external: ['@aws-sdk/client-s3', '@aws-sdk/s3-request-presigner', '@bewdym8/core'],
});
