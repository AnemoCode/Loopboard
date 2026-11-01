import { defineConfig } from 'tsup';

// Bundle the server and the workspace packages into one ESM file; npm deps stay external.
export default defineConfig({
  entry: ['src/main.ts'],
  format: ['esm'],
  target: 'node24',
  platform: 'node',
  clean: true,
  sourcemap: true,
  noExternal: [/^@cld\//],
});
