// ---------------------------------------------------------------------------
// Export the loaded model as an editable .cpmproject (zip) file
// ---------------------------------------------------------------------------
'use strict';

const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(b) { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

async function deflate(bytes, format) {
	const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream(format));
	return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function encodePNG(img) {
	const w = img.width, h = img.height, raw = new Uint8Array((w * 4 + 1) * h);
	for (let y = 0; y < h; y++) raw.set(img.data.subarray(y * w * 4, (y + 1) * w * 4), y * (w * 4 + 1) + 1);
	const chunk = (type, data) => {
		const out = new Uint8Array(12 + data.length), dv = new DataView(out.buffer);
		dv.setUint32(0, data.length);
		for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
		out.set(data, 8);
		dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
		return out;
	};
	const ih = new Uint8Array(13), dv = new DataView(ih.buffer);
	dv.setUint32(0, w); dv.setUint32(4, h); ih[8] = 8; ih[9] = 6;
	const parts = [Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', await deflate(raw, 'deflate')), chunk('IEND', new Uint8Array(0))];
	return concatBytes(parts);
}
function concatBytes(parts) {
	let n = 0; parts.forEach(p => n += p.length);
	const out = new Uint8Array(n); let o = 0; parts.forEach(p => { out.set(p, o); o += p.length; });
	return out;
}

async function writeZip(files) { // [{name, data:Uint8Array}]
	const enc = new TextEncoder();
	const locals = [], centrals = [];
	let offset = 0;
	for (const f of files) {
		const name = enc.encode(f.name), crc = crc32(f.data);
		const comp = await deflate(f.data, 'deflate-raw');
		const useDeflate = comp.length < f.data.length;
		const body = useDeflate ? comp : f.data;
		const lh = new Uint8Array(30 + name.length), l = new DataView(lh.buffer);
		l.setUint32(0, 0x04034b50, true); l.setUint16(4, 20, true); l.setUint16(6, 0x0800, true); l.setUint16(8, useDeflate ? 8 : 0, true);
		l.setUint16(10, 0, true); l.setUint16(12, 0x21, true); l.setUint32(14, crc, true); l.setUint32(18, body.length, true); l.setUint32(22, f.data.length, true);
		l.setUint16(26, name.length, true); lh.set(name, 30);
		const ch = new Uint8Array(46 + name.length), c = new DataView(ch.buffer);
		c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, useDeflate ? 8 : 0, true);
		c.setUint16(14, 0x21, true); c.setUint32(16, crc, true); c.setUint32(20, body.length, true); c.setUint32(24, f.data.length, true);
		c.setUint16(28, name.length, true); c.setUint32(42, offset, true); ch.set(name, 46);
		locals.push(lh, body); centrals.push(ch);
		offset += lh.length + body.length;
	}
	const cd = concatBytes(centrals);
	const end = new Uint8Array(22), e = new DataView(end.buffer);
	e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true);
	e.setUint32(12, cd.length, true); e.setUint32(16, offset, true);
	return concatBytes([...locals, cd, end]);
}

const RAD = 180 / Math.PI;
const degV = (v) => { const w = (a) => { let d = a * RAD; d %= 360; if (d < 0) d += 360; if (Math.abs(d - 360) < 1e-4) d = 0; return Math.round(d * 1000) / 1000; }; return { x: w(v.x), y: w(v.y), z: w(v.z) }; };
const r3 = (v) => ({ x: Math.round(v.x * 1000) / 1000, y: Math.round(v.y * 1000) / 1000, z: Math.round(v.z * 1000) / 1000 });
const hex = (c) => (c & 0xffffff).toString(16);
const ITEM_SLOTS = ['left_hand', 'right_hand', 'head', 'any_slot', 'tool_slot', 'left_shoulder', 'right_shoulder', 'api_slot'];
const safeName = (s) => String(s || '').replace(/[^a-zA-Z0-9.-]/g, '');

async function exportProject(def, info) {
	const files = [];
	const enc = new TextEncoder();
	const addJson = (name, obj) => files.push({ name, data: enc.encode(JSON.stringify(obj, null, 2).replace(/"storeID": "(\d+)"/g, '"storeID": $1')) });

	// ---- store ids ----
	const sid = new Map();
	let next = 1000;
	const idOf = (rc) => {
		if (!sid.has(rc)) {
			if (rc.isRoot && PLAYER_PARTS.includes(rc.part) && def.getModelElementFor(rc.part).getMainRoot() === rc) sid.set(rc, String(PLAYER_PARTS.indexOf(rc.part)));
			else sid.set(rc, String(next++));
		}
		return sid.get(rc);
	};
	const copyTo = new Map();
	for (const ct of def.reg.copyTransforms) copyTo.set(ct.to, ct);

	let cubeN = 0;
	const cubeJson = (rc) => {
		const c = rc.cube;
		const textured = c.texSize !== 0;
		const m = {
			name: c.name || ('Cube ' + (++cubeN)), show: true, texture: textured, textureSize: textured ? Math.abs(c.texSize) : 1,
			offset: r3(c.offset), pos: r3(c.pos), rotation: degV(c.rotation), size: r3(c.size), rscale: r3(c.scale), scale: r3(c.meshScale),
			u: c.u, v: c.v, color: hex(c.rgb), mirror: c.texSize < 0, mcScale: c.mcScale, glow: !!rc.glow, recolor: !!rc.recolor,
			hidden: !!c.hidden, singleTex: !!rc.singleTex, extrude: !!rc.extrude, locked: false, nameColor: 0, storeID: idOf(rc),
		};
		if (rc.faceUVs) {
			m.faceUV = {};
			for (const d of DIRECTIONS) { const f = rc.faceUVs[d]; if (f) m.faceUV[d.toLowerCase()] = { sx: f.sx, sy: f.sy, ex: f.ex, ey: f.ey, rot: ['0', '90', '180', '270'][f.rot | 0], autoUV: false }; }
		}
		if (rc.itemRenderer) m.itemRenderer = ITEM_SLOTS[rc.itemRenderer.slot] || 'right_hand';
		const ct = copyTo.get(rc);
		if (ct) m.copyTransform = { storeID: idOf(ct.from), px: ct.px, py: ct.py, pz: ct.pz, rx: ct.rx, ry: ct.ry, rz: ct.rz, sx: ct.sx, sy: ct.sy, sz: ct.sz, cv: ct.vis, r: ct.color, additive: ct.additive, multiply: ct.multiply };
		if (rc.children && rc.children.length) m.children = rc.children.map(cubeJson);
		return m;
	};
	const elements = [];
	for (const [part, pr] of def.roots) {
		if (part === 'CUSTOM_PART') continue;
		pr.elements.forEach((r) => {
			const isVanilla = PLAYER_PARTS.includes(part);
			const main = isVanilla && pr.getMainRoot() === r;
			const m = { id: part.toLowerCase(), show: !r.hidden, showInEditor: true, locked: false, pos: r3(r.posN), rotation: degV(r.rotN),
				dup: isVanilla && !main, disableVanillaAnim: !!r.disableVanilla, name: '', nameColor: 0 };
			if (!isVanilla) m.customPart = true;
			if (!main) m.storeID = idOf(r);
			else idOf(r);
			if (r.children && r.children.length) m.children = r.children.map(cubeJson);
			if (!isVanilla && !(r.children && r.children.length) && pr.elements.length === 1) return;
			elements.push(m);
		});
	}

	// ---- textures ----
	const cfg = { version: 1, elements, skinType: def.skinType === 'SLIM' ? 'slim' : 'default', hideHeadIfSkull: def.hideHeadIfSkull,
		removeArmorOffset: def.removeArmorOffset, removeBedOffset: def.removeBedOffset, enableInvisGlow: def.enableInvisGlow, textures: {} };
	if (def.reg.profileId) cfg.modelId = def.reg.profileId;
	for (const [sheet, file] of [['SKIN', 'skin'], ['CAPE', 'cape'], ['ELYTRA', 'elytra'], ['LIST_ICON', 'list_icon']]) {
		const t = def.textures[sheet];
		if (!t || !(t.orig || t.img)) continue;
		files.push({ name: file + '.png', data: await encodePNG(t.orig || t.img) });
		cfg[file + 'Size'] = { x: t.size[0], y: t.size[1] };
		const anims = def.reg.animatedTextures.filter(a => a.sheet === sheet).map(a => ({ frameTime: a.frameTime, frameCount: a.frameCount,
			start: { x: a.uvStart.x, y: a.uvStart.y }, size: { x: a.uvSize.x, y: a.uvSize.y }, from: { x: a.animStart.x, y: a.animStart.y }, anX: a.anX, interpolate: a.interpolate }));
		const img = t.orig || t.img;
		cfg.textures[file] = { customGridSize: img.width !== t.size[0] || img.height !== t.size[1], anim: anims };
	}
	const sc = def.scale && def.scale.scaling;
	if (sc) {
		cfg.scaling = sc.ENTITY || 0;
		cfg.scalingEx = {};
		for (const o of SCALING_OPTIONS) if (o !== 'ENTITY' && sc[o]) cfg.scalingEx[o.toLowerCase()] = sc[o];
		if (def.scale.rPos) { cfg.scalingEx.render_position = r3(def.scale.rPos); cfg.scalingEx.render_rotation = degV(def.scale.rRot); cfg.scalingEx.render_scale = r3(def.scale.rScale); }
	}

	// ---- animations ----
	const anims = [];
	const reg = def.reg;
	const params = reg.params;
	const baseOf = (rc) => {
		if (rc.isRoot) return { pos: rc.posN, rot: rc.rotN, rgb: 0, show: !rc.hidden };
		return { pos: rc.cube.pos, rot: rc.cube.rotation, rgb: rc.cube.rgb & 0xffffff, show: !rc.cube.hidden };
	};
	const btnIndex = (b) => reg.namedActions.indexOf(b);
	const layerDefaultOf = (b, value) => {
		if (!b) return 0;
		const p = params.getDefaultParam(b.parameter);
		if (b.type === 'BOOL_PARAMETER_TOGGLE') return (p & b.mask) === b.mask ? 1 : 0;
		if (b.type === 'VALUE_PARAMETER_SLIDER') return Math.round((p & 255) / 255 * 100) / 100;
		if (b.type === 'DROPDOWN') return (p & 255) === value ? 1 : 0;
		return 0;
	};
	const flagsOf = (b) => b ? { command: !!b.command, hidden: !!b.hidden, isProperty: !!b.isProperty, layerControlled: !!b.layerCtrl, order: btnIndex(b) } : {};

	for (const st of (def.exportNew || [])) {
		const findBtn = (t) => {
			const bs = st.buttons;
			if (t.anim === 'CUSTOM_POSE') return bs.find(b => b.type === 'POSE' && b.id === t.value);
			if (t.anim === 'GESTURE') return bs.find(b => b.type === 'GESTURE' && b.id === t.value);
			if (t.anim === 'VALUE_LAYER') return bs.find(b => b.type === 'VALUE_PARAMETER_SLIDER' && b.parameter === t.parameter);
			if (t.anim === 'LAYER') return bs.find(b => (b.type === 'BOOL_PARAMETER_TOGGLE' && b.parameter === t.parameter && b.mask === t.value) || (b.type === 'DROPDOWN' && b.parameter === t.parameter));
			return null;
		};
		const describe = (t) => {
			if (t.pose) return { type: 'POSE', pose: t.pose, link: 'p:' + t.pose.toLowerCase() };
			const b = findBtn(t);
			const name = b ? (b.type === 'DROPDOWN' ? (b.opts[t.value] || 'option' + t.value) : b.name) : (t.anim || 'anim').toLowerCase();
			const d = { type: t.anim, name, button: b, loop: t.looping, link: (t.anim === 'CUSTOM_POSE' ? 'c:' : 'g:') + name };
			if (b && b.type === 'DROPDOWN') d.group = b.name;
			if (b) d.layerDefault = layerDefaultOf(b, t.value);
			if (b && b.type === 'VALUE_PARAMETER_SLIDER') { d.maxValue = b.maxValue; d.interpolateVal = t.parameterInterpolate; }
			return d;
		};
		for (const a of st.anims) {
			const tr = st.triggers[a.triggerID];
			if (!tr) continue;
			let d;
			if (tr.stage) {
				const main = st.triggers[st.staged[tr.stagingID]];
				if (!main) continue;
				const md = describe(main);
				if (tr.stage === 'PLAY') d = md;
				else d = { type: tr.stage === 'SETUP' ? 'SETUP' : 'FINISH', name: md.link, link: md.link };
			} else d = describe(tr);
			// cubes with channel data
			const groups = new Map();
			for (const ch of a.channels) {
				const cube = ch.kind === 'vis' ? ch.cube : ch.group.cube;
				if (!groups.has(cube)) groups.set(cube, { pos: null, rot: null, color: null, scale: null, vis: null, additive: false });
				const g = groups.get(cube);
				if (ch.kind === 'vis') g.vis = ch.frame;
				else { if (!g[ch.group.type]) g[ch.group.type] = [null, null, null]; g[ch.group.type][ch.axis] = ch.frame; g.additive = ch.group.additive; }
			}
			let F = 0, it = 0, add = false;
			for (const g of groups.values()) for (const k of ['pos', 'rot', 'color', 'scale']) if (g[k]) g[k].forEach(f => { if (f) { F = Math.max(F, f.frames.length); if (f.kind === 'float') it = f.it; add = add || g.additive; } });
			for (const g of groups.values()) { if (g.vis) F = Math.max(F, g.vis.frames.length); add = add || g.additive; }
			if (F === 0) F = 1;
			const sample = (f, i) => { const n = f.frames.length; return f.frames[Math.min(n - 1, Math.floor(i * n / F))]; };
			const frames = [];
			for (let i = 0; i < F; i++) {
				const comps = [];
				for (const [id, g] of groups) {
					const rc = def.getElementById(id);
					if (!rc) continue;
					const has = (k) => g[k] && g[k].some(x => x);
					if (!has('pos') && !has('rot') && !has('color') && !has('scale') && !g.vis) continue;
					const base = baseOf(rc);
					const vec = (k, b, emptyAdd) => ['x', 'y', 'z'].map((ax, j) => { const f = g[k] && g[k][j]; return f ? sample(f, i) : (g.additive ? emptyAdd : b[ax]); });
					const p = vec('pos', base.pos, 0), r = vec('rot', base.rot, 0);
					const cb = { x: (base.rgb >> 16) & 255, y: (base.rgb >> 8) & 255, z: base.rgb & 255 };
					const c = ['x', 'y', 'z'].map((ax, j) => { const f = g.color && g.color[j]; return f ? sample(f, i) : cb[ax]; });
					const s = ['x', 'y', 'z'].map((ax, j) => { const f = g.scale && g.scale[j]; return f ? sample(f, i) : 1; });
					const show = g.vis ? !!sample(g.vis, i) : base.show;
					comps.push({ storeID: idOf(rc), pos: r3({ x: p[0], y: p[1], z: p[2] }), rotation: degV({ x: r[0], y: r[1], z: r[2] }),
						color: hex((Math.round(c[0]) << 16) | (Math.round(c[1]) << 8) | Math.round(c[2])), show, scale: r3({ x: s[0], y: s[1], z: s[2] }) });
				}
				frames.push({ components: comps });
			}
			anims.push({ d, add, duration: a.duration, priority: a.priority, it, frames, mustFinish: tr.mustFinish });
		}
	}

	for (const L of (def.exportLegacy || [])) {
		for (const rd of L.parsed.values()) {
			let d;
			if (rd.pose && !rd.pose.startsWith('c:')) d = { type: 'POSE', pose: rd.pose };
			else if (rd.name != null) {
				const type = animTypeFromName(rd.name), name = cleanAnimName(rd.name);
				d = { type, name, loop: rd.loop, group: rd.group, layerDefault: (rd.defaultValue & 255) / 255, maxValue: rd.maxValue ? rd.maxValue & 255 : 100, interpolateVal: rd.interpolateVal };
			} else d = { type: 'CUSTOM_POSE', name: rd.customName };
			const flags = { command: rd.command, hidden: rd.buttonHidden, isProperty: rd.isProperty, layerControlled: rd.layerCtrl, order: rd.order };
			const frames = [];
			for (let f = 0; f < rd.frames; f++) {
				const comps = [];
				rd.components.forEach((id, i) => {
					const rc = def.getElementById(id);
					if (!rc) return;
					const pos = rd.pos[i] ? rd.pos[i][f] : (rd.add ? { x: 0, y: 0, z: 0 } : baseOf(rc).pos);
					const rot = rd.rot[i] ? rd.rot[i][f] : (rd.add ? { x: 0, y: 0, z: 0 } : baseOf(rc).rot);
					const col = rd.color[i] ? rd.color[i][f] : null;
					const rgb = col ? (col.x << 16) | (col.y << 8) | col.z : baseOf(rc).rgb;
					comps.push({ storeID: idOf(rc), pos: r3(pos), rotation: degV(rot), color: hex(rgb), show: rd.show[i] ? !!rd.show[i][f] : baseOf(rc).show, scale: r3(rd.scale[i] ? rd.scale[i][f] : { x: 1, y: 1, z: 1 }) });
				});
				frames.push({ components: comps });
			}
			anims.push({ d, flags, add: rd.add, duration: rd.duration, priority: rd.priority, it: rd.it, frames, mustFinish: rd.finish });
		}
	}

	let n = 0;
	for (const a of anims) {
		const d = a.d;
		const flags = a.flags || flagsOf(d.button);
		const data = {
			additive: !!a.add, duration: a.duration === DYNAMIC_DURATION_DIV ? 1000 : a.duration, priority: a.priority, loop: !!d.loop,
			interpolator: INTERPOLATOR_NAMES[a.it] || 'poly_loop', layerDefault: d.layerDefault || 0, order: flags.order > 0 ? flags.order : 0,
			isProperty: !!flags.isProperty, command: !!flags.command, layerControlled: !!flags.layerControlled, maxValue: d.maxValue || 100,
			interpolateVal: d.interpolateVal !== false, mustFinish: !!a.mustFinish, hidden: !!flags.hidden, frames: a.frames,
		};
		if (d.group) data.group = d.group;
		const uid = (++n).toString(16).padStart(8, '0') + '-0000-4000-8000-' + Date.now().toString(16).padStart(12, '0').slice(-12);
		let file;
		if (d.type === 'POSE') { data.name = ''; file = 'v_' + d.pose.toLowerCase() + '__' + uid + '.json'; }
		else if (d.type === 'CUSTOM_POSE') { data.name = d.name; file = 'c_' + safeName(d.name) + '_' + uid + '.json'; }
		else { data.name = ({ LAYER: '$layer$', VALUE_LAYER: '$value$', SETUP: '$pre$', FINISH: '$post$' }[d.type] || '') + d.name; file = 'g_' + safeName(d.name) + '_' + uid + '.json'; }
		addJson('animations/' + file, data);
	}

	addJson('config.json', cfg);
	addJson('description.json', { name: info.name || '', desc: info.desc || '', cam: { zoom: 64, look: { x: 0.25, y: 0.5, z: 0.25 }, pos: { x: 0.5, y: 1, z: 0.5 }, copyProt: 'normal' } });
	if (info.icon) files.push({ name: 'desc_icon.png', data: info.icon });
	return writeZip(files);
}
