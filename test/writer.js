// Test-only binary writer mirroring the Java write() methods (new export format)
const zlib = require('zlib');
const DIV = Math.floor(32767 / 48);
class W {
	constructor() { this.b = []; }
	write(v) { this.b.push(v & 255); }
	writeByte(v) { this.write(v); }
	writeBoolean(v) { this.write(v ? 1 : 0); }
	writeShort(v) { this.write(v >> 8); this.write(v); }
	writeInt(v) { this.write(v >>> 24); this.write(v >>> 16); this.write(v >>> 8); this.write(v); }
	writeFloat(f) { const dv = new DataView(new ArrayBuffer(4)); dv.setFloat32(0, f); for (let i = 0; i < 4; i++) this.write(dv.getUint8(i)); }
	writeBytes(arr) { for (const x of arr) this.write(x); }
	writeVarInt(v) { v = v | 0; while ((v & -128) !== 0) { this.write((v & 127) | 128); v >>>= 7; } this.write(v); }
	writeSignedVarInt(v) {
		v = v | 0; const sign = v < 0 ? 0x40 : 0; v = Math.abs(v);
		let b = (v & 0x3f) | sign; v >>>= 6;
		while (v !== 0) { this.write(b | 128); b = v & 127; v >>>= 7; }
		this.write(b);
	}
	writeUTF(s) { const e = Buffer.from(s, 'utf8'); this.writeVarInt(e.length); this.writeBytes(e); }
	writeVarFloat(f) { this.writeSignedVarInt(Math.trunc(f * DIV)); }
	writeFloat2(f) { this.writeShort(Math.max(-32768, Math.min(32767, Math.trunc(f * DIV)))); }
	writeVarVec3(v) { this.writeVarFloat(v.x); this.writeVarFloat(v.y); this.writeVarFloat(v.z); }
	writeVec6b(v) { this.writeFloat2(v.x); this.writeFloat2(v.y); this.writeFloat2(v.z); }
	writeAngleRad(v) { // radians -> limitVec(0..360) -> writeAngle
		for (const k of ['x', 'y', 'z']) {
			let d = v[k] * 180 / Math.PI;
			if (d < 0 || d > 360) { d = d % 360; if (d < 0) d += 360; }
			this.writeShort(Math.max(0, Math.min(65535, Math.trunc(d / 360 * 65535))));
		}
	}
	write2v(v) { this.writeVarInt(v.x); this.writeVarInt(v.y); }
	write2s(v) { this.writeShort(v[0]); this.writeShort(v[1]); }
	block(cb) { const w = new W(); cb(w); this.writeVarInt(w.b.length); this.writeBytes(w.b); }
	obj(type, cb) { this.write(type); this.block(cb || (() => {})); }
	byteArray(a) { this.writeVarInt(a.length); this.writeBytes(a); }
	bytes() { return Uint8Array.from(this.b); }
}

function crc32(buf) { let c, crc = 0xffffffff; for (let n = 0; n < buf.length; n++) { c = (crc ^ buf[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; } return (crc ^ 0xffffffff) >>> 0; }
function encodePNG(img) {
	const raw = Buffer.alloc((img.width * 4 + 1) * img.height);
	for (let y = 0; y < img.height; y++) { raw[y * (img.width * 4 + 1)] = 0; Buffer.from(img.data.buffer, img.data.byteOffset + y * img.width * 4, img.width * 4).copy(raw, y * (img.width * 4 + 1) + 1); }
	const chunk = (t, d) => { const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, c]); };
	const ih = Buffer.alloc(13); ih.writeUInt32BE(img.width, 0); ih.writeUInt32BE(img.height, 4); ih[8] = 8; ih[9] = 6;
	return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const PART = { END: 0, PLAYER: 1, DEFINITION: 3, SKIN_TYPE: 11, TEXTURE: 17, ANIMATED_TEX: 18, PACKAGE_LINK: 20, CUBES: 21, ROOT_INFO: 22, ANIMATION_NEW: 23, RENDER_EFFECT: 8 };
const PLAYER_PARTS = ['HEAD', 'BODY', 'LEFT_ARM', 'RIGHT_ARM', 'LEFT_LEG', 'RIGHT_LEG', 'CUSTOM_PART'];
const ROOT_TYPES = ['CAPE', 'ELYTRA_LEFT', 'ELYTRA_RIGHT', 'ARMOR_HELMET', 'ARMOR_BODY', 'ARMOR_LEFT_ARM', 'ARMOR_RIGHT_ARM', 'ARMOR_LEGGINGS_BODY', 'ARMOR_LEFT_LEG', 'ARMOR_RIGHT_LEG', 'ARMOR_LEFT_FOOT', 'ARMOR_RIGHT_FOOT'];
const EFFECTS = ['GLOW', 'SCALE', 'HIDE', 'COLOR', 'SINGLE_TEX', 'PER_FACE_UV', 'UV_OVERFLOW', 'ITEM', 'HIDE_SKULL', 'REMOVE_ARMOR_OFFSET', 'EXTRUDE', 'PLAYER_SCALE', 'MODEL_SCALE', 'SCALING', 'COPY_TRANSFORM', 'FIRST_PERSON_HAND', 'DISABLE_VANILLA', 'REMOVE_BED_OFFSET', 'INVIS_GLOW'];
const TEX = ['SKIN', 'LIST_ICON', 'CAPE', 'ELYTRA', 'ARMOR1', 'ARMOR2'];
const SCAL = ['ENTITY', 'EYE_HEIGHT', 'HITBOX_WIDTH', 'HITBOX_HEIGHT'];
const C = { VP: null };

function eps(v, e) { return Math.abs(v.x) <= e && Math.abs(v.y) <= e && Math.abs(v.z) <= e; }
function writeCubeV2(w, c) {
	const hasMesh = !eps(c.size, 0.001), texture = hasMesh && c.texSize !== 0, hidden = c.hidden;
	const ms = !eps({ x: c.meshScale.x - 1, y: c.meshScale.y - 1, z: c.meshScale.z - 1 }, 0.001);
	const sc = !eps({ x: c.scale.x - 1, y: c.scale.y - 1, z: c.scale.z - 1 }, 0.001);
	const uvs = texture && c.texSize !== 1, mcs = hasMesh && Math.abs(c.mcScale) > 0.0001;
	const flags = (hasMesh ? 1 : 0) | (texture ? 2 : 0) | (hidden ? 4 : 0) | (ms ? 8 : 0) | (uvs ? 16 : 0) | (mcs ? 32 : 0) | (sc ? 64 : 0);
	w.writeByte(flags); w.writeVarInt(c.parentId); w.writeVarVec3(c.pos); w.writeAngleRad(c.rotation);
	if (hasMesh) {
		w.writeVarVec3(c.size); w.writeVarVec3(c.offset);
		if (texture) { if (uvs) w.writeByte(c.texSize); w.writeVarInt(c.u); w.writeVarInt(c.v); }
		else { w.write(c.rgb >>> 16); w.write(c.rgb >>> 8); w.write(c.rgb); }
		if (mcs) w.writeFloat2(c.mcScale);
	}
	if (ms) w.writeVarVec3(c.meshScale);
	if (sc) w.writeVarVec3(c.scale);
}

const VANILLA_POSES = require('./harness.js').VANILLA_POSES;
const ANIM_TYPES = ['POSE', 'CUSTOM_POSE', 'GESTURE', 'LAYER', 'VALUE_LAYER', 'SETUP', 'FINISH'];
const BTN = ['POSE', 'GESTURE', 'BOOL_PARAMETER_TOGGLE', 'VALUE_PARAMETER_SLIDER', 'DROPDOWN'];
function writeAnimNew(w, st) {
	w.obj(10, d => { d.write(st.blankId); d.write(st.resetId); if (st.profileId == null) d.writeVarInt(0); else d.writeUTF(st.profileId); });
	if (st.params) w.obj(12, d => { d.byteArray(Array.from(st.params.syncDefault)); d.byteArray(Array.from(st.params.localDefault)); });
	for (const t of st.triggers) {
		w.obj(2);
		if (t.pose) w.obj(3, d => { d.write(VANILLA_POSES.indexOf(t.pose)); d.write(t.mustFinish ? 16 : 0); });
		else if (t.anim === 'POSE' || t.anim === 'GESTURE') w.obj(4, d => { d.write(ANIM_TYPES.indexOf(t.anim)); d.write((t.bitMask ? 4 : 0) | (t.looping ? 2 : 0) | (t.layerCtrl ? 1 : 0) | (t.mustFinish ? 16 : 0)); d.write(t.value); if (t.layerCtrl) d.write(t.gid); });
		else if (t.parameter !== -1) w.obj(5, d => { d.write(ANIM_TYPES.indexOf(t.anim)); d.write((t.bitMask ? 4 : 0) | (t.looping ? 2 : 0) | (t.parameterInterpolate ? 8 : 0) | (t.mustFinish ? 16 : 0)); d.writeVarInt(t.parameter); d.write(t.value); });
		else if (t.stage) w.obj(6, d => { d.write(['SETUP', 'PLAY', 'FINISH'].indexOf(t.stage)); d.writeVarInt(t.stagingID); d.write(t.mustFinish ? 16 : 0); });
	}
	for (const a of st.anims) {
		w.obj(1, d => { d.writeVarInt(a.triggerID); d.writeSignedVarInt(a.priority); d.writeVarInt(a.duration); });
		const cubes = []; let add = false;
		for (let j = 0; j < a.channels.length; j++) { const ch = a.channels[j]; if (ch.kind === 'f3' && ch.axis === 0 && ch.group.type === 'pos') { cubes.push(ch.group.cube); add = ch.group.additive; j += 12; } }
		if (cubes.length) w.obj(9, d => { d.writeVarInt(cubes.length); d.writeVarInt(12); d.writeVarInt(add ? 1 : 0); cubes.forEach(c => d.writeVarInt(c)); });
		const fl = new Map(), bl = new Map();
		a.channels.forEach((ch, i) => {
			if (!ch.frame) return;
			if (ch.frame.kind === 'float') { const k = ch.frame.it + ':' + ch.frame.frames.length; if (!fl.has(k)) fl.set(k, []); fl.get(k).push([i, ch.frame]); }
			else { const k = ch.frame.frames.length; if (!bl.has(k)) bl.set(k, []); bl.get(k).push([i, ch.frame]); }
		});
		for (const [k, list] of fl) w.obj(7, d => { const [it, n] = k.split(':').map(Number); d.write(it); d.writeVarInt(n); d.writeVarInt(list.length); list.forEach(([i, f]) => { d.writeVarInt(i); f.frames.forEach(v => d.writeVarFloat(v)); }); });
		for (const [n, list] of bl) w.obj(8, d => { d.writeVarInt(n); d.writeVarInt(list.length); list.forEach(([i, f]) => { d.writeVarInt(i); for (let j = 0; j < n; j += 8) { let fl2 = 0; for (let k = 0; j + k < n && k < 8; k++) if (f.frames[j + k]) fl2 |= 1 << k; d.write(fl2); } }); });
	}
	for (const b of st.buttons) {
		w.obj(11, d => {
			d.write(BTN.indexOf(b.type)); d.writeUTF(b.name);
			d.write((b.layerCtrl ? 1 : 0) | (b.command ? 2 : 0) | (b.isProperty ? 4 : 0) | (b.hidden ? 16 : 0));
			if (b.type === 'POSE' || b.type === 'GESTURE') { d.write(b.id); if (b.layerCtrl) d.write(b.gid || 0); if (b.type === 'GESTURE') d.writeVarInt(b.gestureTimeout || 0); }
			else if (b.type === 'BOOL_PARAMETER_TOGGLE') { d.writeVarInt(b.parameter); d.write(b.mask); }
			else if (b.type === 'VALUE_PARAMETER_SLIDER') { d.writeVarInt(b.parameter); d.writeByte(b.maxValue); }
			else if (b.type === 'DROPDOWN') { d.writeVarInt(b.parameter); d.writeByte(b.opts.length); b.opts.forEach(o => d.writeUTF(o)); }
		});
	}
	for (const s of st.staged) w.obj(13, d => d.writeVarInt(s));
	w.write(0); w.writeVarInt(0);
}

function writeEffect(d, e) {
	d.write(EFFECTS.indexOf(e.e));
	switch (e.e) {
		case 'GLOW': case 'SINGLE_TEX': case 'EXTRUDE': d.writeVarInt(e.id); break;
		case 'COLOR': d.writeVarInt(e.id); d.write(e.color >> 16); d.write(e.color >> 8); d.write(e.color); break;
		case 'PER_FACE_UV': { d.writeVarInt(e.id); const D = ['UP', 'DOWN', 'NORTH', 'SOUTH', 'EAST', 'WEST']; let h = 0; D.forEach((k, i) => { if (e.faces[k]) h |= 1 << i; }); d.write(h); D.forEach(k => { const f = e.faces[k]; if (f) { d.writeVarInt(f.sx); d.writeVarInt(f.sy); d.writeVarInt(f.ex); d.writeVarInt(f.ey); d.write(f.rot); } }); break; }
		case 'ITEM': d.writeVarInt(e.id); d.write(e.slot); d.write(e.slotID); break;
		case 'HIDE_SKULL': case 'REMOVE_ARMOR_OFFSET': d.writeBoolean(e.value); break;
		case 'COPY_TRANSFORM': d.writeVarInt(e.from); d.writeVarInt(e.to); { let c = e.copy; if (e.multiply !== 1) c |= 1 << 14; d.writeVarInt(c); if (e.multiply !== 1) d.writeFloat(e.multiply); } break;
		case 'SCALING': for (const [k, v] of Object.entries(e.scaling)) { const i = SCAL.indexOf(k); if (i < 0) continue; d.write(i); d.writeFloat2(v); } break;
		case 'MODEL_SCALE': d.writeVec6b(e.pos); d.writeAngleRad(e.rot); d.writeVec6b(e.scale); break;
		default: break;
	}
}

// parts as produced by loadProject -> package bytes (writePackage)
function writePackageParts(w, parts) {
	for (const p of parts) {
		switch (p.t) {
			case 'CUBES': w.obj(PART.CUBES, d => { d.writeVarInt(p.cubes.length); p.cubes.forEach(c => writeCubeV2(d, c)); }); break;
			case 'ROOT_INFO': w.obj(PART.ROOT_INFO, d => {
				const tr = !eps(p.pos, 0.1) || !eps(p.rot, 0.1 * Math.PI / 180);
				const isRoot = ROOT_TYPES.includes(p.root);
				const flags = (isRoot ? 4 : 0) | (tr ? 8 : 0) | (p.hidden ? 1 : 0) | (p.createFrom ? 2 : 0) | (p.disableVanilla ? 16 : 0);
				d.write(flags); d.write(isRoot ? ROOT_TYPES.indexOf(p.root) : PLAYER_PARTS.indexOf(p.root));
				if (tr) { d.writeVarVec3(p.pos); d.writeAngleRad(p.rot); }
				if (p.createFrom) d.writeVarInt(p.createFrom);
			}); break;
			case 'RENDER_EFFECT': w.obj(PART.RENDER_EFFECT, d => writeEffect(d, p.effect)); break;
			case 'TEXTURE': w.obj(PART.TEXTURE, d => { d.write(TEX.indexOf(p.sheet)); d.write2s(p.tex.size); d.block(b => b.writeBytes(encodePNG(p.tex.img))); }); break;
			case 'ANIMATED_TEX': w.obj(PART.ANIMATED_TEX, d => { const a = p.at; d.write(TEX.indexOf(a.sheet)); d.write2v(a.uvStart); d.write2v(a.uvSize); d.write2v(a.animStart); d.writeVarInt(a.frameCount); d.writeVarInt(a.frameTime); d.write((a.anX ? 1 : 0) | (a.interpolate ? 2 : 0)); }); break;
			case 'ANIMATION_NEW': w.obj(PART.ANIMATION_NEW, d => writeAnimNew(d, p.state)); break;
			default: throw new Error('cannot write ' + p.t);
		}
	}
}

function checksummed(header, cb) {
	const w = new W(); cb(w);
	let sum = 0; for (const b of w.b) sum = (sum + b) & 0xffff;
	return Uint8Array.from([header, ...w.b, sum >> 8, sum & 255]);
}

module.exports = { W, writePackageParts, checksummed, encodePNG, PART };
