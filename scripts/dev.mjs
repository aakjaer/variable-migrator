/**
 * Dev script: writes a manifest pointing to the Vite dev server, then starts
 * Vite (HMR for the UI) and esbuild --watch (rebuilds code.ts on save).
 *
 * In Figma: Plugins → Development → Import plugin from manifest → pick dist/manifest.json
 * UI changes (App.tsx etc.) reload instantly via HMR.
 * code.ts changes require closing and re-running the plugin in Figma.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { spawn } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

mkdirSync(resolve(root, 'dist'), { recursive: true });

// Write a manifest that loads the UI from the Vite dev server
const manifest = JSON.parse(readFileSync(resolve(root, 'manifest.json'), 'utf-8'));
manifest.ui = 'http://localhost:5173/ui.html';
writeFileSync(resolve(root, 'dist/manifest.json'), JSON.stringify(manifest, null, 2));

console.log('Dev manifest written to dist/manifest.json');
console.log('Load the plugin in Figma from: Plugins → Development → Import plugin from manifest\n');

const procs = [
  spawn('npx', ['vite'], { stdio: 'inherit', shell: true, cwd: root }),
  spawn('npx', ['esbuild', 'code.ts', '--bundle', '--outfile=dist/code.js',
    '--platform=browser', '--target=es2017', '--watch'],
    { stdio: 'inherit', shell: true, cwd: root }),
];

process.on('SIGINT', () => { procs.forEach(p => p.kill()); process.exit(0); });
