// Builds dist/cpm-viewer.html: one self-contained file (CSS, scripts and assets inlined).
// Usage: node tools/build-single.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
let html = read('index.html');

html = html.replace(/<link rel="stylesheet" href="css\/style\.css">/, () => '<style>\n' + read('css/style.css') + '</style>');

// embed assets as base64 so the file works without a server
const assetsJs = read('js/assets.js');
const paths = Object.fromEntries([...assetsJs.matchAll(/^\s*(\w+): '([^']+)'/gm)].map(m => [m[1], m[2]]));
const data = Object.fromEntries(Object.entries(paths).map(([k, p]) => [k, fs.readFileSync(path.join(root, p)).toString('base64')]));
const embed = '<script>\nconst ASSET_DATA = ' + JSON.stringify(data) + ';\n</script>\n';

let first = true;
html = html.replace(/<script src="js\/([\w-]+)\.js"><\/script>/g, (m, name) => {
	const s = (first ? embed : '') + '<script>\n' + read('js/' + name + '.js').replace(/<\/script/gi, '<\\/script') + '\n</script>';
	first = false;
	return s;
});

fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist/cpm-viewer.html'), html);
console.log('wrote dist/cpm-viewer.html (' + Math.round(html.length / 1024) + ' KB)');
