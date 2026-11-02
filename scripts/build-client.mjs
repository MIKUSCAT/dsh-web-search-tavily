import { build } from 'esbuild';
import { mkdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
await mkdir(new URL('../lib', import.meta.url), { recursive: true });
await build({
  entryPoints: [fileURLToPath(new URL('../client/index.tsx', import.meta.url))],
  outfile: fileURLToPath(new URL('../lib/client.js', import.meta.url)),
  bundle: true, format: 'cjs', platform: 'browser', target: 'es2022',
  external: ['react', 'react/jsx-runtime'], jsx: 'automatic',
  loader: { '.css': 'text' }, minify: true, legalComments: 'none',
  define: { 'process.env.NODE_ENV': '"production"' },
  banner: { js: `window.__ModuleLoader__.load({id:${JSON.stringify(manifest.name)},factory:(require)=>{var module={exports:{}};var exports=module.exports;` },
  footer: { js: 'return module.exports;}});' }
});
