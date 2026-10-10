// Loads the browser scripts into Node (no DOM needed for parsing / animation / export).
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const files = ['io', 'assets', 'model', 'anim', 'project', 'vanilla', 'load', 'export'];
const assetsSrc = fs.readFileSync(path.join(root, 'js/assets.js'), 'utf8');
const paths = Object.fromEntries([...assetsSrc.matchAll(/^\s*(\w+): '([^']+)'/gm)].map(m => [m[1], m[2]]));
const ASSET_DATA = Object.fromEntries(Object.entries(paths).map(([k, p]) => [k, fs.readFileSync(path.join(root, p)).toString('base64')]));
let code = files.map(f => fs.readFileSync(path.join(root, 'js', f + '.js'), 'utf8').replace(/'use strict';/, '')).join('\n');
code += '\nmodule.exports = { exportProject, loadProject, loadInput, Loader, AnimationDriver, defaultViewState, b64ToBytes, decodePNG, getAsset, VANILLA_POSES };';
const m = { exports: {} };
new Function('module', 'require', 'atob', 'ASSET_DATA', code)(m, require, (s) => Buffer.from(s, 'base64').toString('binary'), ASSET_DATA);
module.exports = m.exports;
