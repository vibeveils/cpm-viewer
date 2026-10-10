// Round-trip tests: project -> (new binary | legacy binary | skin + link | exported project) must animate identically.
// Run: npm test
const C = require('./harness.js');
const Wr = require('./writer.js');
const LW = require('./legacy_writer.js');
const fs = require('fs');
const path = require('path');

let failed = 0;
function snapshot(def) {
	const o = {};
	for (const c of def.cubes) {
		if (c.isRoot && c.part === 'CUSTOM_PART') continue;
		const k = c.isRoot ? 'R' + c.part : c.cube.id;
		const p = c.isRoot ? c.getPos() : c.pos, r = c.isRoot ? c.getRot() : c.rotation;
		o[k] = [p.x, p.y, p.z, r.x, r.y, r.z, c.renderScale.x, c.renderScale.y, c.renderScale.z, c.display ? 1 : 0, (c.color >> 16) & 255, (c.color >> 8) & 255, c.color & 255];
	}
	return o;
}
// cubes without a mesh keep no texture flag in exported formats; their colour is never visible
const meshless = (def, k) => { const rc = def.cubes.find(c => !c.isRoot && c.cube.id === +k); return rc && rc.cube.size.x === 0 && rc.cube.size.y === 0 && rc.cube.size.z === 0; };

function compare(name, def1, def2) {
	const d1 = new C.AnimationDriver(def1), d2 = new C.AnimationDriver(def2);
	const vs = C.defaultViewState();
	const b1 = def1.reg.namedActions, b2 = def2.reg.namedActions;
	const diffs = [];
	for (let bi = -1; bi < b1.length; bi++) {
		if (bi >= 0) {
			const x = b1[bi], y = b2.find(b => b.name === x.name && b.type === x.type) || b2.find(b => b.name === x.name);
			if (!y) { diffs.push('missing button ' + x.name); continue; }
			if (x.type === 'VALUE_PARAMETER_SLIDER') { d1.setSlider(x, 30); d2.setSlider(y, Math.round(30 * y.maxValue / x.maxValue)); }
			else if (x.type.includes('DROPDOWN')) { const o = (x.opts || [...x.params.keys()])[1]; d1.setDropdown(x, o); d2.setDropdown(y, o); }
			else { d1.activateButton(x, 0); d2.activateButton(y, 0); }
		}
		for (const mv of ['STANDING', 'WALKING', 'SNEAKING', 'FLYING']) {
			vs.movement = mv;
			for (let t = 0; t < 2500; t += 41) {
				d1.update(vs, t); d2.update(vs, t);
				const a = snapshot(def1), b = snapshot(def2);
				for (const k in a) {
					if (!b[k]) { diffs.push('missing ' + k); continue; }
					for (let i = 0; i < 13; i++) {
						let d = Math.abs(a[k][i] - b[k][i]);
						if (i >= 3 && i < 6) d = Math.abs(Math.atan2(Math.sin(a[k][i] - b[k][i]), Math.cos(a[k][i] - b[k][i])));
						if (i >= 10) { if (meshless(def1, k)) continue; d /= 50; }
						if (d > 0.05) diffs.push(k + '[' + i + '] btn ' + bi + ' ' + mv + ' t' + t);
					}
				}
			}
		}
	}
	const uniq = [...new Set(diffs)];
	console.log((uniq.length ? 'FAIL ' : 'ok   ') + name + (uniq.length ? ' (' + uniq.length + ' differences, e.g. ' + uniq.slice(0, 3).join('; ') + ')' : ''));
	if (uniq.length) failed++;
}

(async () => {
	const L = () => new C.Loader({});
	for (const file of ['assets/examples/animation_status_test.cpmproject', ...process.argv.slice(2)]) {
		const bytes = new Uint8Array(fs.readFileSync(path.join(__dirname, '..', file)));
		const ref = (await C.loadInput({ bytes, name: 'x.cpmproject' }, L(), {})).def;
		const pr = await C.loadProject(bytes, { warn: console.log });
		const st = pr.skinType === 'SLIM' ? 0 : 1;
		console.log('# ' + path.basename(file));

		const full = Wr.checksummed(0x53, w => { w.obj(11, d => d.write(st)); Wr.writePackageParts(w, pr.parts); w.obj(0); });
		compare('new binary format', ref, (await C.loadInput({ text: Buffer.from(full).toString('base64') }, L(), {})).def);

		const legacy = Wr.checksummed(0x53, w => { w.obj(11, d => d.write(st)); LW.writeLegacyDefinition(w, pr); w.obj(0); });
		const legDef = (await C.loadInput({ text: Buffer.from(legacy).toString('base64') }, L(), {})).def;
		compare('legacy binary format', ref, legDef);

		const pack = Wr.checksummed(0x53, w => { Wr.writePackageParts(w, pr.parts); w.obj(0); });
		const top = Wr.checksummed(0x53, w => { w.obj(11, d => d.write(st)); const l = Buffer.from('git:test/abc'); w.obj(20, d => { d.write(l.length); d.writeBytes(l); }); w.obj(0); });
		const tmpl = await C.decodePNG(await C.getAsset('free_space_template'));
		const skin = await C.decodePNG(await C.getAsset(st === 0 ? 'slim_skin' : 'default_skin'));
		const sh = 8 * (2 - st);
		for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) { const t = tmpl.getRGB(x, y); if (((t >>> sh) & 255) === 255) skin.setRGB(x, y, (t & 255) === 255 ? 0xff000000 : 0); }
		let bx = -1, by = 0, block = -1;
		const find = () => { for (let y = by; y < 64; y++) { for (let x = bx + 1; x < 64; x++) { const t = tmpl.getRGB(x, y); if (((t >>> sh) & 255) === 255) { bx = x; by = y; return true; } } bx = -1; } return false; };
		for (const b of top) {
			if (block === -1 || block > 3) { find(); block = 0; }
			let dt = skin.getRGB(bx, by); const s = (block++) * 8; dt &= ~(255 << s); dt |= (b << s);
			if ((tmpl.getRGB(bx, by) & 255) === 255 && block > 2) { block++; dt |= 0xff000000; }
			skin.setRGB(bx, by, dt >>> 0);
		}
		const sl = L(); sl.localLinks.set('git:test/abc', pack);
		compare('skin with link', ref, (await C.loadInput({ bytes: new Uint8Array(Wr.encodePNG(skin)), name: 's.png' }, sl, {})).def);

		compare('export from project', ref, (await C.loadInput({ bytes: await C.exportProject(ref, {}), name: 'e.cpmproject' }, L(), {})).def);
		compare('export from legacy model', legDef, (await C.loadInput({ bytes: await C.exportProject(legDef, {}), name: 'e.cpmproject' }, L(), {})).def);
	}
	if (failed) { console.log(failed + ' test(s) failed'); process.exit(1); }
	console.log('all tests passed');
})().catch(e => { console.error(e); process.exit(1); });
