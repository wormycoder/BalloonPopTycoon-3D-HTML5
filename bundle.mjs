#!/usr/bin/env node
/* Inlines index.html + style.css + src/*.js into a single portable HTML file.
   Optional: the game runs fine straight from index.html, this is just a
   convenience build for sharing one file. Run: node tools/bundle.mjs */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'style.css'), 'utf8');

html = html.replace('<link rel="stylesheet" href="style.css">', '<style>\n' + css + '\n</style>');
html = html.replace(/<script src="(src\/[^"]+)"><\/script>\s*/g, (_, src) =>
  '<script>\n' + fs.readFileSync(path.join(root, src), 'utf8') + '\n</script>\n');

fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
const out = path.join(root, 'dist', 'balloon-pop-tycoon-3d.html');
fs.writeFileSync(out, html);
console.log('wrote', path.relative(root, out), (html.length / 1024).toFixed(1) + ' KB');
