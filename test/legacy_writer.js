// Test-only writer for the legacy (default) export path: Exporter.prepareDefinition + ModelPartAnimation(Editor)
const { W, encodePNG } = require('./writer.js');
const PLAYER_PARTS = ['HEAD', 'BODY', 'LEFT_ARM', 'RIGHT_ARM', 'LEFT_LEG', 'RIGHT_LEG', 'CUSTOM_PART'];
const ROOT_TYPES = ['CAPE', 'ELYTRA_LEFT', 'ELYTRA_RIGHT', 'ARMOR_HELMET', 'ARMOR_BODY', 'ARMOR_LEFT_ARM', 'ARMOR_RIGHT_ARM', 'ARMOR_LEGGINGS_BODY', 'ARMOR_LEFT_LEG', 'ARMOR_RIGHT_LEG', 'ARMOR_LEFT_FOOT', 'ARMOR_RIGHT_FOOT'];
const LAYERS = ['hat', 'jacket', 'left_pants_leg', 'right_pants_leg', 'left_sleeve', 'right_sleeve'];
const EFFECTS = ['GLOW', 'SCALE', 'HIDE', 'COLOR', 'SINGLE_TEX', 'PER_FACE_UV', 'UV_OVERFLOW', 'ITEM', 'HIDE_SKULL', 'REMOVE_ARMOR_OFFSET', 'EXTRUDE', 'PLAYER_SCALE', 'MODEL_SCALE', 'SCALING', 'COPY_TRANSFORM', 'FIRST_PERSON_HAND', 'DISABLE_VANILLA', 'REMOVE_BED_OFFSET', 'INVIS_GLOW'];
const VANILLA_POSES = require('./harness.js').VANILLA_POSES;
const T = { END: 0, POSE: 1, GESTURE: 2, ROT: 3, POS: 4, VIS: 5, COLOR: 6, INFO: 7, ENCODING: 8, CTRL_IDS: 9, EXTRA: 10, INTERP: 11, SCALE: 12, LAYER_DEFAULT: 13, ORDER: 14, IS_PROPERTY: 15, GROUP: 16, PROFILES: 17, COMMAND: 18, ENC: 19, MUST_FINISH: 20, SLIDER: 21, HIDDEN: 22 };

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function writeAngleDeg(w, r) { for (const k of ['x', 'y', 'z']) w.writeShort(clamp(Math.trunc(r[k] / 360 * 65535), 0, 65535)); }
function wrapDeg(r) { const o = { ...r }; for (const k of ['x', 'y', 'z']) { if (o[k] < 0 || o[k] > 360) { o[k] %= 360; if (o[k] < 0) o[k] += 360; } } return o; }

function fdPosCh(a, el, d) { return a.add ? (Math.abs(d.pos.x) > 0.01 || Math.abs(d.pos.y) > 0.01 || Math.abs(d.pos.z) > 0.01) : (Math.abs(d.pos.x - el.pos.x) > 0.01 || Math.abs(d.pos.y - el.pos.y) > 0.01 || Math.abs(d.pos.z - el.pos.z) > 0.01); }
function fdRotCh(a, el, d) { return a.add ? (Math.abs(d.rot.x) > 0.01 || Math.abs(d.rot.y) > 0.01 || Math.abs(d.rot.z) > 0.01) : (Math.abs(d.rot.x - el.rotation.x) > 0.01 || Math.abs(d.rot.y - el.rotation.y) > 0.01 || Math.abs(d.rot.z - el.rotation.z) > 0.01); }
function fdScaleCh(d) { return Math.abs(d.scale.x - 1) > 0.01 || Math.abs(d.scale.y - 1) > 0.01 || Math.abs(d.scale.z - 1) > 0.01; }
function fdColorCh(el, d) { if (el.kind === 'root') return false; if (!el.texture || el.recolor) { const rgb = ((d.color.x | 0) << 16) | ((d.color.y | 0) << 8) | (d.color.z | 0); return (el.rgb & 0xffffff) !== (rgb & 0xffffff); } return false; }
function fdVisCh(el, d) { return !!el.hidden === d.show; }

function encodeTypeInName(n, type) { return ({ LAYER: '$layer$', VALUE_LAYER: '$value$', SETUP: '$pre$', FINISH: '$post$' }[type] || '') + n; }

function buildLegacyAnim(E) {
	const enc = E.animEnc;
	const layerIdx = (n) => LAYERS.indexOf(n);
	const valMask = enc ? enc.freeLayers.reduce((m, l) => m | (1 << layerIdx(l)), 0) : 0;
	const defMask = enc ? (Object.entries(enc.defaultValues).reduce((m, [k, v]) => v ? m | (1 << layerIdx(k)) : m, 0) & ~valMask) : 0;
	const resetId = defMask | valMask, blankId = defMask;
	const allLayers = enc ? enc.freeLayers.map(layerIdx).sort((a, b) => a - b) : [];
	const idc = [0, 1];
	const parsed = [];
	const notLC = [];
	const addedPoses = new Set(), addedGestures = new Set();
	const allElems = new Set([...E.elements, ...E.roots]);
	const resolveEnc = (rd, id) => {
		if (allLayers.length < 2) throw new Error('custom anims not supported');
		let g = 0; allLayers.forEach((l, i) => { if (id & (1 << i)) g |= 1 << l; });
		rd.gid = g; rd.layerCtrl = true;
	};
	for (const ea of E.anims) {
		const id = idc[0]++;
		let rd;
		if (ea.type === 'POSE') rd = { pose: ea.pose, add: ea.add, gid: -1 };
		else if (ea.type === 'CUSTOM_POSE') {
			rd = { custom: ea.displayName, add: ea.add, gid: -1 };
			if (ea.layerControlled) { if (!addedPoses.has(ea.displayName)) { addedPoses.add(ea.displayName); resolveEnc(rd, idc[1]++); } else rd.gid = -1; }
			else if (!addedPoses.has(ea.displayName)) { addedPoses.add(ea.displayName); notLC.push(rd); }
		} else {
			rd = { name: encodeTypeInName(ea.id, ea.type), loop: ea.loop, add: ea.add, gid: -1 };
			if (ea.type === 'LAYER' || ea.type === 'VALUE_LAYER') rd.defaultValue = Math.trunc(ea.layerDefault * 255) << 24 >> 24;
			if (ea.type !== 'SETUP' && ea.type !== 'FINISH' && ea.type !== 'LAYER' && ea.type !== 'VALUE_LAYER') {
				if (ea.layerControlled) { if (!addedGestures.has(rd.name)) { addedGestures.add(rd.name); resolveEnc(rd, idc[1]++); } else rd.gid = -1; }
				else if (!addedGestures.has(rd.name)) { addedGestures.add(rd.name); notLC.push(rd); }
			}
		}
		rd.gid &= valMask; rd.gid |= defMask;
		if (['SETUP', 'FINISH', 'LAYER', 'VALUE_LAYER'].includes(ea.type)) rd.gid = -1;
		rd.id = id;
		const comps = [];
		for (const f of ea.frames) for (const [el, d] of f) if (!comps.includes(el) && (fdPosCh(ea, el, d) || fdRotCh(ea, el, d) || fdColorCh(el, d) || fdVisCh(el, d) || fdScaleCh(d))) comps.push(el);
		rd.frames = ea.frames.length; rd.duration = ea.duration; rd.components = comps.map(c => allElems.has(c) ? c.id : 0);
		rd.priority = ea.priority; rd.it = ea.intType; rd.finish = ea.mustFinish;
		if (ea.type === 'VALUE_LAYER') { rd.maxValue = ea.maxValue << 24 >> 24; rd.interpolateVal = ea.interpolateValue; }
		if (ea.type !== 'POSE' && ea.type !== 'SETUP' && ea.type !== 'FINISH') { rd.command = ea.command; if (!ea.command) rd.order = ea.order; rd.hidden = ea.hidden; }
		if ((ea.type === 'LAYER' || ea.type === 'VALUE_LAYER') && !ea.command) rd.isProperty = ea.isProperty;
		if (ea.type === 'LAYER' && ea.group && !ea.command) rd.group = ea.group;
		const fill = (el, fn, empty, getEl) => ea.frames.map(f => { const d = f.get(el); if (!d) return ea.add ? empty : getEl(el); return fn(d); });
		rd.data = comps.map(el => {
			const has = (fn) => ea.frames.some(f => { const d = f.get(el); return d && fn(d); });
			return {
				pos: has(d => fdPosCh(ea, el, d)) ? fill(el, d => d.pos, { x: 0, y: 0, z: 0 }, e => e.pos) : null,
				rot: has(d => fdRotCh(ea, el, d)) ? fill(el, d => d.rot, { x: 0, y: 0, z: 0 }, e => e.rotation) : null,
				color: has(d => fdColorCh(el, d)) ? fill(el, d => d.color, { x: 0, y: 0, z: 0 }, e => ({ x: (e.rgb >> 16) & 255, y: (e.rgb >> 8) & 255, z: e.rgb & 255 })) : null,
				show: has(d => fdVisCh(el, d)) ? fill(el, d => d.show, !el.hidden, e => !e.hidden) : null,
				scale: has(d => fdScaleCh(d)) ? fill(el, d => d.scale, { x: 1, y: 1, z: 1 }, () => ({ x: 1, y: 1, z: 1 })) : null,
			};
		});
		parsed.push(rd);
	}
	notLC.forEach(rd => { let n = idc[1]++; if (n === resetId) n = idc[1]++; rd.gid = n; });
	return { parsed, blankId, resetId, profileId: E.cfg.modelId || null };
}

function writeLegacyAnim(w, A) {
	const obj = (t, cb) => w.obj(t, cb);
	for (const rd of A.parsed) {
		const id = rd.id;
		if (rd.pose || rd.custom != null) obj(T.POSE, d => { d.write(rd.custom != null ? 0 : VANILLA_POSES.indexOf(rd.pose)); d.write(id); d.write(rd.add ? 1 : 0); if (rd.custom != null) { const i = rd.custom.indexOf('#'); d.writeUTF(i === -1 ? rd.custom : rd.custom.substring(0, i)); } });
		else obj(T.GESTURE, d => { d.write(id); d.writeUTF(rd.name); d.write((rd.add ? 1 : 0) | (rd.loop ? 2 : 0)); });
		obj(T.INFO, d => { d.write(id); d.write(rd.components.length); d.write(rd.frames); d.writeShort(rd.duration); rd.components.forEach(c => d.writeVarInt(c)); });
		if (rd.gid !== -1) obj(rd.layerCtrl ? T.ENCODING : T.ENC, d => { d.write(id); d.write(rd.gid); });
		rd.data.forEach((cd, i) => {
			if (cd.pos) obj(T.POS, d => { d.write(id); d.write(i); cd.pos.forEach(v => d.writeVec6b(v)); });
			if (cd.rot) obj(T.ROT, d => { d.write(id); d.write(i); cd.rot.forEach(v => writeAngleDeg(d, v)); });
			if (cd.color) obj(T.COLOR, d => { d.write(id); d.write(i); cd.color.forEach(v => { d.write(v.x | 0); d.write(v.y | 0); d.write(v.z | 0); }); });
			if (cd.show) obj(T.VIS, d => { d.write(id); d.write(i); for (let f = 0; f < rd.frames; f += 8) { let fl = 0; for (let j = 0; f + j < rd.frames && j < 8; j++) if (cd.show[f + j]) fl |= 1 << j; d.write(fl); } });
			if (cd.scale) obj(T.SCALE, d => { d.write(id); d.write(i); cd.scale.forEach(v => d.writeVec6b(v)); });
		});
		if (rd.priority) obj(T.EXTRA, d => { d.write(id); d.write(rd.priority); });
		if (rd.it !== 0) obj(T.INTERP, d => { d.write(id); d.write(rd.it); });
		if (rd.defaultValue) obj(T.LAYER_DEFAULT, d => { d.write(id); d.write(rd.defaultValue); });
		if (rd.order) obj(T.ORDER, d => { d.write(id); d.write(rd.order); });
		if (rd.isProperty) obj(T.IS_PROPERTY, d => d.write(id));
		if (rd.group != null) obj(T.GROUP, d => { d.write(id); d.writeUTF(rd.group); });
		if (rd.command) obj(T.COMMAND, d => d.write(id));
		if (rd.finish) obj(T.MUST_FINISH, d => d.write(id));
		if (rd.maxValue) obj(T.SLIDER, d => { d.write(id); d.writeBoolean(rd.interpolateVal); d.write(rd.maxValue); });
		if (rd.hidden) obj(T.HIDDEN, d => d.write(id));
	}
	obj(T.CTRL_IDS, d => { d.write(A.blankId); d.write(A.resetId); });
	if (A.profileId != null) obj(T.PROFILES, d => d.writeUTF(A.profileId));
	w.write(T.END);
}

function writeEffect(w, e, cb) { w.obj(8, d => { d.write(EFFECTS.indexOf(e)); cb(d); }); }

// returns the DEFINITION part bytes block writer
function writeLegacyDefinition(w, pr) {
	const E = pr._editor;
	const cubes = pr.parts[0].cubes; // CUBES part from loadProject, same ids
	const byId = new Map(); E.elements.forEach(e => byId.set(e.id, e));
	w.obj(3, d => {
		d.writeVarInt(cubes.length);
		for (const c of [...cubes].sort((a, b) => a.id - b.id)) {
			const el = byId.get(c.id);
			const fake = !el;
			const root = fake ? E.roots.find(r => r.id === c.id) : null;
			const size = fake ? { x: 0, y: 0, z: 0 } : el.size;
			for (const k of ['x', 'y', 'z']) d.write(clamp(Math.trunc(size[k] * 10), 0, 255));
			const pos = fake ? root.pos : el.pos, off = fake ? { x: 0, y: 0, z: 0 } : el.offset;
			d.writeVec6b(pos); d.writeVec6b(off);
			writeAngleDeg(d, wrapDeg(fake ? root.rotation : el.rotation));
			d.writeVarInt(fake ? 6 : el.parentId);
			const ts = fake ? 0 : (el.texture ? (el.mirror ? -el.textureSize : el.textureSize) : 0);
			d.write(ts);
			if (ts === 0) { const rgb = fake ? 0 : el.rgb; d.write(rgb >> 16); d.write(rgb >> 8); d.write(rgb); }
			else { d.write(el.u); d.write(el.v); }
		}
		// other parts
		d.obj(1, b => { let k = 0; E.roots.forEach(r => { if (PLAYER_PARTS.includes(r.part) && !r.dup && !r.hidden) k |= 1 << PLAYER_PARTS.indexOf(r.part); }); b.write(k); });
		const skinTex = pr.parts.find(p => p.t === 'TEXTURE' && p.sheet === 'SKIN');
		if (skinTex) d.obj(5, b => { b.write2s(skinTex.tex.size); b.block(x => x.writeBytes(encodePNG(skinTex.tex.img))); });
		for (const r of E.roots) {
			if (PLAYER_PARTS.includes(r.part) && !r.dup) {
				const eps = (v, e) => Math.abs(v.x) <= e && Math.abs(v.y) <= e && Math.abs(v.z) <= e;
				if (!eps(r.pos, 0.1) || !eps(r.rotation, 0.1)) d.obj(7, b => { b.writeVarInt(r.id); b.writeVec6b(r.pos); writeAngleDeg(b, wrapDeg(r.rotation)); });
			}
		}
		const copies = [];
		const walk = (list) => { for (const el of list) { if (el.kind === 'normal') {
			if (el.glow) writeEffect(d, 'GLOW', b => b.writeVarInt(el.id));
			if (Math.abs(el.mcScale) > 0.0001 || Math.abs(el.meshScale.x - 1) > 0.01 || Math.abs(el.meshScale.y - 1) > 0.01 || Math.abs(el.meshScale.z - 1) > 0.01) writeEffect(d, 'SCALE', b => { b.writeVarInt(el.id); b.writeFloat2(el.mcScale); b.writeVec6b(el.meshScale); });
			if (el.hidden) writeEffect(d, 'HIDE', b => b.writeVarInt(el.id));
			if (el.recolor) writeEffect(d, 'COLOR', b => { b.writeVarInt(el.id); b.write(el.rgb >> 16); b.write(el.rgb >> 8); b.write(el.rgb); });
			if (el.singleTex) writeEffect(d, 'SINGLE_TEX', b => b.writeVarInt(el.id));
			if (el.extrude) writeEffect(d, 'EXTRUDE', b => b.writeVarInt(el.id));
			if (el.faceUV) { const fp = pr.parts.find(p => p.t === 'RENDER_EFFECT' && p.effect.e === 'PER_FACE_UV' && p.effect.id === el.id); const D = ['UP', 'DOWN', 'NORTH', 'SOUTH', 'EAST', 'WEST']; writeEffect(d, 'PER_FACE_UV', b => { b.writeVarInt(el.id); let h = 0; D.forEach((k, i) => { if (fp.effect.faces[k]) h |= 1 << i; }); b.write(h); D.forEach(k => { const f = fp.effect.faces[k]; if (f) { b.writeVarInt(f.sx); b.writeVarInt(f.sy); b.writeVarInt(f.ex); b.writeVarInt(f.ey); b.write(f.rot); } }); }); }
			else if (el.u > 255 || el.v > 255) writeEffect(d, 'UV_OVERFLOW', b => { b.writeVarInt(el.id); b.writeVarInt(el.u); b.writeVarInt(el.v); });
			const cp = pr.parts.find(p => p.t === 'RENDER_EFFECT' && p.effect.e === 'COPY_TRANSFORM' && p.effect.to === el.id);
			if (cp) copies.push(cp.effect);
		} walk(el.children || []); } };
		walk(E.roots);
		for (const r of E.roots) {
			if (r.dup && PLAYER_PARTS.includes(r.part)) { if (r.hidden) writeEffect(d, 'HIDE', b => b.writeVarInt(r.id)); d.obj(14, b => { b.writeVarInt(r.id); b.write(PLAYER_PARTS.indexOf(r.part)); }); }
			else if (ROOT_TYPES.includes(r.part)) { if (r.hidden) writeEffect(d, 'HIDE', b => b.writeVarInt(r.id)); d.obj(12, b => { b.writeVarInt(r.id); b.write(ROOT_TYPES.indexOf(r.part)); }); }
			if (r.disableVanilla) writeEffect(d, 'DISABLE_VANILLA', b => b.writeVarInt(r.id));
		}
		copies.forEach(e => writeEffect(d, 'COPY_TRANSFORM', b => { b.writeVarInt(e.from); b.writeVarInt(e.to); let c = e.copy; if (e.multiply !== 1) c |= 1 << 14; b.writeVarInt(c); if (e.multiply !== 1) b.writeFloat(e.multiply); }));
		if (E.anims.length) d.obj(10, b => writeLegacyAnim(b, buildLegacyAnim(E)));
		for (const p of pr.parts) {
			if (p.t === 'TEXTURE' && p.sheet !== 'SKIN') d.obj(17, b => { b.write(['SKIN', 'LIST_ICON', 'CAPE', 'ELYTRA'].indexOf(p.sheet)); b.write2s(p.tex.size); b.block(x => x.writeBytes(encodePNG(p.tex.img))); });
			if (p.t === 'ANIMATED_TEX') d.obj(18, b => { const a = p.at; b.write(['SKIN', 'LIST_ICON', 'CAPE', 'ELYTRA'].indexOf(a.sheet)); b.write2v(a.uvStart); b.write2v(a.uvSize); b.write2v(a.animStart); b.writeVarInt(a.frameCount); b.writeVarInt(a.frameTime); b.write((a.anX ? 1 : 0) | (a.interpolate ? 2 : 0)); });
		}
		if (E.cfg.hideHeadIfSkull === false) writeEffect(d, 'HIDE_SKULL', b => b.writeBoolean(false));
		if (E.removeArmorOffset) writeEffect(d, 'REMOVE_ARMOR_OFFSET', b => b.writeBoolean(true));
		d.obj(0);
	});
}

module.exports = { writeLegacyDefinition, buildLegacyAnim };
