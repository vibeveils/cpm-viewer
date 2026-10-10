// ---------------------------------------------------------------------------
// CPM model structures, binary part parsing and definition resolving
// (ports of com.tom.cpm.shared.parts.*, model.*, definition.ModelDefinition)
// ---------------------------------------------------------------------------
'use strict';

const HEADER = 0x53;
const PLAYER_PARTS = ['HEAD', 'BODY', 'LEFT_ARM', 'RIGHT_ARM', 'LEFT_LEG', 'RIGHT_LEG', 'CUSTOM_PART'];
const ROOT_TYPES = ['CAPE', 'ELYTRA_LEFT', 'ELYTRA_RIGHT', 'ARMOR_HELMET', 'ARMOR_BODY', 'ARMOR_LEFT_ARM', 'ARMOR_RIGHT_ARM',
	'ARMOR_LEGGINGS_BODY', 'ARMOR_LEFT_LEG', 'ARMOR_RIGHT_LEG', 'ARMOR_LEFT_FOOT', 'ARMOR_RIGHT_FOOT'];
const ROOT_COPY_FROM = {
	ARMOR_HELMET: 'HEAD', ARMOR_BODY: 'BODY', ARMOR_LEFT_ARM: 'LEFT_ARM', ARMOR_RIGHT_ARM: 'RIGHT_ARM',
	ARMOR_LEGGINGS_BODY: 'BODY', ARMOR_LEFT_LEG: 'LEFT_LEG', ARMOR_RIGHT_LEG: 'RIGHT_LEG',
	ARMOR_LEFT_FOOT: 'LEFT_LEG', ARMOR_RIGHT_FOOT: 'RIGHT_LEG'
};
const TEX_SHEETS = ['SKIN', 'LIST_ICON', 'CAPE', 'ELYTRA', 'ARMOR1', 'ARMOR2'];
const TEX_DEF_SIZE = { SKIN: [64, 64], LIST_ICON: [8, 8], CAPE: [64, 32], ELYTRA: [64, 32], ARMOR1: [64, 32], ARMOR2: [64, 32] };
const SKIN_TYPES = ['SLIM', 'DEFAULT', 'UNKNOWN'];
const SKIN_CHANNEL = { SLIM: 0, DEFAULT: 1, UNKNOWN: -1 };
const PART_TYPES = ['END', 'PLAYER', 'TEMPLATE', 'DEFINITION', 'DEFINITION_LINK', 'SKIN', 'SKIN_LINK', 'PLAYER_PARTPOS',
	'RENDER_EFFECT', 'UUID_LOCK', 'ANIMATION_DATA', 'SKIN_TYPE', 'MODEL_ROOT', 'LIST_ICON', 'DUP_ROOT', 'CLONEABLE', 'SCALE',
	'TEXTURE', 'ANIMATED_TEX', 'TAGS', 'PACKAGE_LINK', 'CUBES', 'ROOT_INFO', 'ANIMATION_NEW'];
const SCALING_OPTIONS = ['ENTITY', 'EYE_HEIGHT', 'HITBOX_WIDTH', 'HITBOX_HEIGHT', 'THIRD_PERSON', 'VIEW_BOBBING', 'MOTION',
	'STEP_HEIGHT', 'FLIGHT_SPEED', 'FALL_DAMAGE', 'REACH', 'MINING_SPEED', 'ATTACK_SPEED', 'ATTACK_KNOCKBACK', 'ATTACK_DMG',
	'DEFENSE', 'HEALTH', 'MOB_VISIBILITY', 'WIDTH', 'HEIGHT', 'JUMP_HEIGHT', 'PROJECTILE_DMG', 'EXPLOSION_DMG',
	'KNOCKBACK_RESIST', 'SAFE_FALL_DISTANCE'];
const DIRECTIONS = ['UP', 'DOWN', 'NORTH', 'SOUTH', 'EAST', 'WEST'];

// Root texture sheet used by the cubes below a root part
function sheetForRoot(part) {
	switch (part) {
		case 'CAPE': return 'CAPE';
		case 'ELYTRA_LEFT': case 'ELYTRA_RIGHT': return 'ELYTRA';
		case 'ARMOR_HELMET': case 'ARMOR_BODY': case 'ARMOR_LEFT_ARM': case 'ARMOR_RIGHT_ARM':
		case 'ARMOR_LEFT_FOOT': case 'ARMOR_RIGHT_FOOT': return 'ARMOR1';
		case 'ARMOR_LEGGINGS_BODY': case 'ARMOR_LEFT_LEG': case 'ARMOR_RIGHT_LEG': return 'ARMOR2';
		default: return 'SKIN';
	}
}

// PlayerPartValues / RootModelValues: pos, offset, size, uv, overlay uv / mcScale + mirror
const PLAYER_PART_VALUES = {
	HEAD: { pos: [0, 0, 0], off: [-4, -8, -4], size: [8, 8, 8], uv: [0, 0], uv2: [32, 0], d2: 0.5 },
	BODY: { pos: [0, 0, 0], off: [-4, 0, -2], size: [8, 12, 4], uv: [16, 16], uv2: [16, 32], d2: 0.25 },
	LEFT_ARM: { pos: [5, 2, 0], off: [-1, -2, -2], size: [4, 12, 4], uv: [32, 48], uv2: [48, 48], d2: 0.25 },
	RIGHT_ARM: { pos: [-5, 2, 0], off: [-3, -2, -2], size: [4, 12, 4], uv: [40, 16], uv2: [40, 32], d2: 0.25 },
	LEFT_ARM_S: { pos: [5, 2, 0], off: [-1, -2, -2], size: [3, 12, 4], uv: [32, 48], uv2: [48, 48], d2: 0.25 },
	RIGHT_ARM_S: { pos: [-5, 2, 0], off: [-2, -2, -2], size: [3, 12, 4], uv: [40, 16], uv2: [40, 32], d2: 0.25 },
	LEFT_LEG: { pos: [1.9, 12, 0], off: [-2, 0, -2], size: [4, 12, 4], uv: [16, 48], uv2: [0, 48], d2: 0.25 },
	RIGHT_LEG: { pos: [-1.9, 12, 0], off: [-2, 0, -2], size: [4, 12, 4], uv: [0, 16], uv2: [0, 32], d2: 0.25 },
};
const ROOT_MODEL_VALUES = {
	CAPE: { pos: [0, 0, 0], off: [-5, 0, -1], size: [10, 16, 1], uv: [0, 0], mcs: 0, mirror: false },
	ELYTRA_LEFT: { pos: [0, 0, 0], off: [-10, 0, 0], size: [10, 20, 2], uv: [22, 0], mcs: 1, mirror: false },
	ELYTRA_RIGHT: { pos: [0, 0, 0], off: [0, 0, 0], size: [10, 20, 2], uv: [22, 0], mcs: 1, mirror: true },
	ARMOR_HELMET: { pos: [0, 0, 0], off: [-4, -8, -4], size: [8, 8, 8], uv: [0, 0], mcs: 1, mirror: false },
	ARMOR_BODY: { pos: [0, 0, 0], off: [-4, 0, -2], size: [8, 12, 4], uv: [16, 16], mcs: 1, mirror: false },
	ARMOR_LEFT_ARM: { pos: [5, 2, 0], off: [-1, -2, -2], size: [4, 12, 4], uv: [40, 16], mcs: 1, mirror: true },
	ARMOR_RIGHT_ARM: { pos: [-5, 2, 0], off: [-3, -2, -2], size: [4, 12, 4], uv: [40, 16], mcs: 1, mirror: false },
	ARMOR_LEGGINGS_BODY: { pos: [0, 0, 0], off: [-4, 0, -2], size: [8, 12, 4], uv: [16, 16], mcs: 0.5, mirror: false },
	ARMOR_LEFT_LEG: { pos: [1.9, 12, 0], off: [-2, 0, -2], size: [4, 12, 4], uv: [0, 16], mcs: 0.5, mirror: true },
	ARMOR_RIGHT_LEG: { pos: [-1.9, 12, 0], off: [-2, 0, -2], size: [4, 12, 4], uv: [0, 16], mcs: 0.5, mirror: false },
	ARMOR_LEFT_FOOT: { pos: [1.9, 12, 0], off: [-2, 0, -2], size: [4, 12, 4], uv: [0, 16], mcs: 1, mirror: true },
	ARMOR_RIGHT_FOOT: { pos: [-1.9, 12, 0], off: [-2, 0, -2], size: [4, 12, 4], uv: [0, 16], mcs: 1, mirror: false },
};
function partValues(part, skinType) {
	if (PLAYER_PART_VALUES[part]) {
		if (skinType === 'SLIM' && (part === 'LEFT_ARM' || part === 'RIGHT_ARM')) return PLAYER_PART_VALUES[part + '_S'];
		return PLAYER_PART_VALUES[part];
	}
	return ROOT_MODEL_VALUES[part] || null;
}

const v3 = (x = 0, y = 0, z = 0) => ({ x, y, z });
const v3c = (v) => ({ x: v.x, y: v.y, z: v.z });

// ---------------------------------------------------------------------------
// Cube + RenderedCube + RootModelElement
// ---------------------------------------------------------------------------
function loadDefinitionCube(d) { // legacy
	const c = { hidden: false, rgb: 0, u: 0, v: 0, texSize: 0, mcScale: 0 };
	c.size = d.readVec3ub();
	c.pos = d.readVec6b();
	c.offset = d.readVec6b();
	c.rotation = d.readAngle();
	c.meshScale = v3(1, 1, 1);
	c.scale = v3(1, 1, 1);
	c.parentId = d.readVarInt();
	const tex = d.i8();
	if (tex === 0) {
		const r = d.u8(), g = d.u8(), b = d.u8();
		c.rgb = ((0xff << 24) | (r << 16) | (g << 8) | b) >>> 0;
	} else {
		c.texSize = tex;
		c.u = d.u8();
		c.v = d.u8();
	}
	return c;
}

function loadDefinitionCubeV2(d) {
	const c = { hidden: false, rgb: 0, u: 0, v: 0, texSize: 0, mcScale: 0 };
	const flags = d.i8();
	c.parentId = d.readVarInt();
	c.pos = d.readVarVec3();
	c.rotation = d.readAngle();
	c.hidden = (flags & 4) !== 0;
	if (flags & 1) {
		c.size = d.readVarVec3();
		c.offset = d.readVarVec3();
		if (flags & 2) {
			c.texSize = (flags & 16) ? d.i8() : 1;
			c.u = d.readVarInt();
			c.v = d.readVarInt();
		} else {
			const r = d.u8(), g = d.u8(), b = d.u8();
			c.rgb = ((0xff << 24) | (r << 16) | (g << 8) | b) >>> 0;
		}
		if (flags & 32) c.mcScale = d.readFloat2();
	} else {
		c.size = v3(); c.offset = v3();
	}
	c.meshScale = (flags & 8) ? d.readVarVec3() : v3(1, 1, 1);
	c.scale = (flags & 64) ? d.readVarVec3() : v3(1, 1, 1);
	return c;
}

class RenderedCube {
	constructor(cube) {
		this.cube = cube;
		this.parent = null;
		this.children = null;
		this.glow = false; this.recolor = false; this.singleTex = false; this.extrude = false;
		this.faceUVs = null; this.itemRenderer = null;
		this.meshDirty = true;
		if (cube) this.reset();
	}
	get id() { return this.cube.id; }
	reset() {
		const c = this.cube;
		this.offset = v3c(c.offset);
		this.rotation = v3c(c.rotation);
		this.pos = v3c(c.pos);
		this.renderScale = v3c(c.scale);
		this.color = (this.recolor || c.texSize === 0) ? (c.rgb & 0xffffff) : 0xffffff;
		this.display = !c.hidden;
	}
	addChild(c) { (this.children || (this.children = [])).push(c); }
	setPosition(add, x, y, z) { if (add) { this.pos.x += x; this.pos.y += y; this.pos.z += z; } else { this.pos.x = x; this.pos.y = y; this.pos.z = z; } }
	setRotation(add, x, y, z) { if (add) { this.rotation.x += x; this.rotation.y += y; this.rotation.z += z; } else { this.rotation.x = x; this.rotation.y = y; this.rotation.z = z; } }
	setVisible(v) { this.display = v; }
	setColor(r, g, b) {
		if (this.recolor || this.cube.texSize === 0) {
			const cl = (v) => Math.max(0, Math.min(255, v | 0));
			this.color = (cl(r) << 16) | (cl(g) << 8) | cl(b);
		}
	}
	setColorInt(c) { if (this.recolor || this.cube.texSize === 0) this.color = c & 0xffffff; }
	getRGB() { if (!this.cube) return -1; return (this.recolor || this.cube.texSize === 0) ? (this.cube.rgb & 0xffffff) : -1; }
	getPosition() { return this.pos; }
	getRotation() { return this.rotation; }
	isVisible() { return this.display; }
	getRenderScale() { return this.renderScale; }
	setRenderScale(add, x, y, z) {
		const s = this.renderScale;
		if (add) { if (x !== 0) s.x *= x; if (y !== 0) s.y *= y; if (z !== 0) s.z *= z; }
		else { if (x !== 0) s.x = x; if (y !== 0) s.y = y; if (z !== 0) s.z = z; }
	}
	getTransformPosition() { return this.getPosition(); }
	getTransformRotation() { return this.getRotation(); }
	setHidden(v) { this.cube.hidden = v; }
	isHidden() { return this.cube.hidden; }
	get isRoot() { return false; }
}

class RootModelElement extends RenderedCube {
	constructor(part, def) {
		super(null);
		this.part = part;
		this.def = def;
		this.posN = v3(); this.rotN = v3();
		this.pos = v3(); this.rotation = v3();
		this.defPos = v3(); this.defRot = v3();
		this.renderScale = v3(1, 1, 1);
		this.disableVanilla = false;
		this.hidden = false;
		this.posAdd = true; this.rotAdd = true;
		this.display = true;
		this.color = 0xffffff;
		this.baseId = PLAYER_PARTS.indexOf(part);
	}
	get id() { return this.baseId; }
	get isRoot() { return true; }
	reset() {
		this.pos = v3(); this.rotation = v3(); this.renderScale = v3(1, 1, 1);
		this.display = !this.hidden;
		this.posAdd = true; this.rotAdd = true;
	}
	setColor() {}
	setColorInt() {}
	setVisible() {}
	getRGB() { return -1; }
	setPosition(add, x, y, z) { super.setPosition(add, x, y, z); this.posAdd = this.posAdd && add; }
	setRotation(add, x, y, z) { super.setRotation(add, x, y, z); this.rotAdd = this.rotAdd && add; }
	setPosAndRot(px, py, pz, rx, ry, rz) {
		if (!this.disableVanilla) {
			this.defPos = v3(px + this.posN.x, py + this.posN.y, pz + this.posN.z);
			this.defRot = v3(rx + this.rotN.x, ry + this.rotN.y, rz + this.rotN.z);
		} else {
			const v = partValues(this.part, this.def.skinType);
			const p = v ? v.pos : [0, 0, 0];
			this.defPos = v3(p[0] + this.posN.x, p[1] + this.posN.y, p[2] + this.posN.z);
			this.defRot = v3c(this.rotN);
		}
	}
	getPos() { return this.posAdd ? v3(this.pos.x + this.defPos.x, this.pos.y + this.defPos.y, this.pos.z + this.defPos.z) : this.pos; }
	getRot() { return this.rotAdd ? v3(this.rotation.x + this.defRot.x, this.rotation.y + this.defRot.y, this.rotation.z + this.defRot.z) : this.rotation; }
	getRenderScale() { return v3(1, 1, 1); }
	getTransformPosition() { return this.getPos(); }
	getTransformRotation() { return this.getRot(); }
	setHidden(v) { this.hidden = v; }
	isHidden() { return this.hidden; }
	doDisplay() { return this.display; }
}

class PartRoot {
	constructor(elem) { this.elements = elem ? [elem] : []; this.mainRoot = elem || null; }
	add(e) { if (!this.elements.includes(e)) this.elements.push(e); }
	get() { return this.elements[0]; }
	getMainRoot() { return this.mainRoot; }
}

function resolveCubes(cubes) {
	const r = new Map();
	for (const c of cubes) r.set(c.id, new RenderedCube(c));
	for (const c of cubes) {
		if (c.parentId < 10) continue;
		const cube = r.get(c.id), parent = r.get(c.parentId);
		if (!parent) throw new CPMError('Cube ' + c.id + ' references missing parent ' + c.parentId);
		cube.parent = parent;
		parent.addChild(cube);
	}
	return [...r.values()];
}

// ---------------------------------------------------------------------------
// Part parsing
// ---------------------------------------------------------------------------
function readLink(d) {
	const len = d.u8();
	const s = utf8.decode(d.readFully(len));
	const i = s.indexOf(':');
	return { loader: s.substring(0, i), path: s.substring(i + 1).split(':')[0], full: s };
}

function readTextureProvider(d) {
	const size = d.read2s();
	const png = d.readImageBytes();
	return { size: [size.x, size.y], png: png.slice(), img: null };
}

function readPerFaceUV(d) {
	const hidden = d.u8();
	const faces = {};
	for (let i = 0; i < 6; i++) {
		if (hidden & (1 << i)) {
			const f = { sx: d.readVarInt(), sy: d.readVarInt(), ex: d.readVarInt(), ey: d.readVarInt() };
			f.rot = Math.max(0, d.readEnum(4));
			faces[DIRECTIONS[i]] = f;
		}
	}
	return faces;
}

const EFFECTS = ['GLOW', 'SCALE', 'HIDE', 'COLOR', 'SINGLE_TEX', 'PER_FACE_UV', 'UV_OVERFLOW', 'ITEM', 'HIDE_SKULL',
	'REMOVE_ARMOR_OFFSET', 'EXTRUDE', 'PLAYER_SCALE', 'MODEL_SCALE', 'SCALING', 'COPY_TRANSFORM', 'FIRST_PERSON_HAND',
	'DISABLE_VANILLA', 'REMOVE_BED_OFFSET', 'INVIS_GLOW'];

function readEffect(d) {
	const t = d.readEnum(EFFECTS.length);
	if (t < 0) return null;
	const e = { e: EFFECTS[t] };
	switch (e.e) {
		case 'GLOW': case 'HIDE': case 'SINGLE_TEX': case 'EXTRUDE': case 'DISABLE_VANILLA': e.id = d.readVarInt(); break;
		case 'SCALE': e.id = d.readVarInt(); e.mcScale = d.readFloat2(); e.scale = d.readVec6b(); break;
		case 'COLOR': e.id = d.readVarInt(); { const r = d.u8(), g = d.u8(), b = d.u8(); e.color = (r << 16) | (g << 8) | b; } break;
		case 'PER_FACE_UV': e.id = d.readVarInt(); e.faces = readPerFaceUV(d); break;
		case 'UV_OVERFLOW': e.id = d.readVarInt(); e.u = d.readVarInt(); e.v = d.readVarInt(); break;
		case 'ITEM': e.id = d.readVarInt(); e.slot = d.readEnum(8); e.slotID = d.i8(); break;
		case 'HIDE_SKULL': case 'REMOVE_ARMOR_OFFSET': e.value = d.readBoolean(); break;
		case 'PLAYER_SCALE': d.readShort(); d.readShort(); d.readShort(); break;
		case 'MODEL_SCALE': e.pos = d.readVec6b(); e.rot = d.readAngle(); e.scale = d.readVec6b(); break;
		case 'SCALING': e.scaling = {};
			while (d.available() > 0) { const o = d.readEnum(SCALING_OPTIONS.length); const v = d.readFloat2(); if (o >= 0) e.scaling[SCALING_OPTIONS[o]] = v; }
			break;
		case 'COPY_TRANSFORM':
			e.from = d.readVarInt(); e.to = d.readVarInt();
			e.copy = d.readVarInt() & 0xffff;
			e.multiply = (e.copy & (1 << 14)) ? d.readFloat() : 1;
			break;
		case 'FIRST_PERSON_HAND': for (let i = 0; i < 6; i++) { d.readVec6b(); } break;
		default: break;
	}
	return e;
}

function readCloneable(d) {
	const fields = d.size() === 0 ? 0 : d.i8();
	const c = { name: null, desc: null, icon: null };
	if (fields & 1) c.name = d.readUTF();
	if (fields & 2) c.desc = d.readUTF();
	if (fields & 4) c.icon = d.readImageBytes().slice();
	return c;
}

function parseDefinitionPart(d, ctx) {
	let cubes = [];
	try {
		const count = d.readVarInt();
		for (let i = 0; i < count; i++) { const c = loadDefinitionCube(d); c.id = i + 10; cubes.push(c); }
	} catch (e) {
		d.reset();
		const count = d.u8();
		cubes = [];
		for (let i = 0; i < count; i++) { const c = loadDefinitionCube(d); c.id = i + 10; cubes.push(c); }
	}
	const other = [];
	for (;;) {
		const p = d.readObjectBlock(PART_TYPES.length, (t, b) => parsePart(t, b, ctx));
		if (!p) continue;
		if (p.t === 'END') break;
		if (p.t === 'DEFINITION' || p.t === 'DEFINITION_LINK' || p.t === 'SKIN_LINK') throw new CPMError('Invalid tag in definition');
		other.push(p);
	}
	return { t: 'DEFINITION', cubes, legacyCubes: true, parts: other };
}

function parsePack(d, ctx) {
	const parts = [];
	for (;;) {
		const p = d.readObjectBlock(PART_TYPES.length, (t, b) => parsePart(t, b, ctx));
		if (!p) continue;
		if (p.t === 'END') break;
		if (p.t === 'DEFINITION' || p.t === 'DEFINITION_LINK' || p.t === 'SKIN_LINK' || p.t === 'PACKAGE_LINK') throw new CPMError('Invalid tag in package');
		parts.push(p);
	}
	return { t: 'PACK', parts };
}

function parsePart(type, d, ctx) {
	const t = PART_TYPES[type];
	switch (t) {
		case 'END': return { t };
		case 'PLAYER': { const k = d.u8(); const keep = []; for (let i = 0; i < 8; i++) keep.push((k & (1 << i)) !== 0); return { t, keep }; }
		case 'TEMPLATE': ctx.warn('This model uses templates, which the viewer does not render.'); return { t };
		case 'DEFINITION': return parseDefinitionPart(d, ctx);
		case 'DEFINITION_LINK': case 'SKIN_LINK': case 'PACKAGE_LINK': return { t, link: readLink(d) };
		case 'SKIN': return { t, tex: readTextureProvider(d) };
		case 'PLAYER_PARTPOS': return { t, id: d.readVarInt(), pos: d.readVec6b(), rot: d.readAngle() };
		case 'RENDER_EFFECT': { let effect = null; try { effect = readEffect(d); } catch (e) { ctx.warn('Skipped a render effect: ' + e.message); } return { t, effect }; }
		case 'UUID_LOCK': return { t };
		case 'ANIMATION_DATA': return { t, legacy: parseLegacyAnimation(d) };
		case 'SKIN_TYPE': { const v = d.read(); return { t, skinType: v >= 3 || v < 0 ? 'UNKNOWN' : SKIN_TYPES[v] }; }
		case 'MODEL_ROOT': return { t, id: d.readVarInt(), type: ROOT_TYPES[d.readEnum(ROOT_TYPES.length)] };
		case 'DUP_ROOT': return { t, id: d.readVarInt(), type: PLAYER_PARTS[d.readEnum(PLAYER_PARTS.length)] };
		case 'LIST_ICON': return { t };
		case 'CLONEABLE': return { t, info: readCloneable(d) };
		case 'SCALE': return { t, scale: d.i8() / 10 };
		case 'TEXTURE': { const ty = d.readEnum(TEX_SHEETS.length); return { t, sheet: TEX_SHEETS[ty], tex: readTextureProvider(d) }; }
		case 'ANIMATED_TEX': {
			const sheet = TEX_SHEETS[d.readEnum(TEX_SHEETS.length)];
			const uvStart = d.read2v(), uvSize = d.read2v(), animStart = d.read2v();
			const frameCount = d.readVarInt(), frameTime = d.readVarInt();
			const flags = d.i8();
			return { t, at: { sheet, uvStart, uvSize, animStart, frameCount, frameTime, anX: (flags & 1) !== 0, interpolate: (flags & 2) !== 0 } };
		}
		case 'TAGS': return { t };
		case 'CUBES': {
			const count = d.readVarInt(); const cubes = [];
			for (let i = 0; i < count; i++) { const c = loadDefinitionCubeV2(d); c.id = i + 10; cubes.push(c); }
			return { t, cubes };
		}
		case 'ROOT_INFO': {
			const flags = d.i8();
			const root = (flags & 4) ? ROOT_TYPES[d.readEnum(ROOT_TYPES.length)] : PLAYER_PARTS[d.readEnum(PLAYER_PARTS.length)];
			let pos = v3(), rot = v3(), createFrom = 0;
			if (flags & 8) { pos = d.readVarVec3(); rot = d.readAngle(); }
			if (flags & 2) createFrom = d.readVarInt();
			return { t, root, pos, rot, createFrom, hidden: (flags & 1) !== 0, disableVanilla: (flags & 16) !== 0 };
		}
		case 'ANIMATION_NEW': return { t, state: parseAnimationNew(d) };
		default: return { t: 'UNKNOWN' };
	}
}

// Reads a top-level model stream (after the 0x53 header byte).
// `skin` is an optional SkinSource so SKIN_TYPE can switch the channel.
function parseModelParts(src, ctx, skin) {
	const cs = new ChecksumSource(src);
	const io = new IO(cs);
	const parts = [];
	for (;;) {
		const p = io.readObjectBlock(PART_TYPES.length, (t, b) => parsePart(t, b, ctx));
		if (!p) continue;
		if (p.t === 'SKIN_TYPE' && skin) {
			const ch = SKIN_CHANNEL[p.skinType];
			if (p.skinType !== 'UNKNOWN' && ch !== skin.channel) skin.channel = ch;
		}
		if (p.t === 'END') { cs.checkSum(); break; }
		parts.push(p);
	}
	return parts;
}

// Linked package data (gist/paste): HEADER + checksummed content
function parseLinkedData(bytes, kind, ctx) {
	if (bytes[0] !== HEADER) throw new CPMError('Linked data has an unknown header');
	const cs = new ChecksumSource(new ArraySource(bytes.subarray(1)));
	const io = new IO(cs);
	let part;
	if (kind === 'DEFINITION_LINK') part = parseDefinitionPart(io, ctx);
	else if (kind === 'SKIN_LINK') part = { t: 'SKIN', tex: readTextureProvider(io) };
	else part = parsePack(io, ctx);
	cs.checkSum();
	return part;
}

// ---------------------------------------------------------------------------
// Skin embedded data (SkinDataInputStream)
// ---------------------------------------------------------------------------
class SkinSource {
	constructor(img, template, channel) {
		this.img = img; this.template = template; this.channel = channel;
		this.block = -1; this.x = -1; this.y = 0; this.finished = false;
	}
	read() {
		if (this.finished) return -1;
		if (this.block === -1 || this.block > 3) {
			this.findNextBlock();
			if (this.finished) return -1;
			this.block = 0;
		}
		const dt = this.img.getRGB(this.x, this.y);
		const shift = (this.block++) * 8;
		if ((this.template.getRGB(this.x, this.y) & 0xff) === 0xff && this.block > 2) this.block++;
		return (dt >>> shift) & 0xff;
	}
	findNextBlock() {
		const shift = 8 * (2 - this.channel);
		for (let y = this.y; y < this.img.height && y < this.template.height; y++) {
			for (let x = this.x + 1; x < this.img.width && x < this.template.width; x++) {
				const t = this.template.getRGB(x, y);
				if (((t >>> shift) & 0xff) === 0xff) { this.x = x; this.y = y; return; }
			}
			this.x = -1;
		}
		this.finished = true;
	}
}

// ---------------------------------------------------------------------------
// ModelDefinition
// ---------------------------------------------------------------------------
class ModelDef {
	constructor(skinType) {
		this.skinType = skinType || 'DEFAULT';
		this.cubes = [];
		this.cubeMap = new Map();
		this.roots = new Map();
		this.textures = {};
		this.reg = new AnimationRegistry();
		this.scale = null;
		this.hideHeadIfSkull = true; this.removeArmorOffset = false; this.removeBedOffset = false; this.enableInvisGlow = false;
		this.cloneable = null;
		this.playerParts = [];
		for (let i = 0; i < PLAYER_PARTS.length; i++) {
			const e = new RootModelElement(PLAYER_PARTS[i], this);
			this.roots.set(PLAYER_PARTS[i], new PartRoot(e));
			this.playerParts.push(e);
		}
	}
	addCubes(list) { this.cubes.push(...list); }
	getElementById(id) { return this.cubeMap.get(id); }
	getModelElementFor(part) { return this.roots.get(part); }
	setTexture(sheet, tex) { this.textures[sheet] = tex; }
	addRoot(baseID, type) {
		const e = new RootModelElement(type, this);
		e.children = [];
		e.baseId = baseID;
		if (!this.roots.has(type)) this.roots.set(type, new PartRoot(e));
		else this.roots.get(type).add(e);
		this.cubes.push(e);
		this.cubeMap.set(baseID, e);
		return e;
	}
	resetAnimationPos() { for (const c of this.cubes) c.reset(); }
	// Move a fake cube (child of CUSTOM_PART) to a new root
	makeRootFrom(id, type, hidden, disableVanilla) {
		const custom = this.getModelElementFor('CUSTOM_PART').get();
		const list = custom.children || [];
		for (let i = 0; i < list.length; i++) {
			const rc = list[i];
			if (rc.id === id) {
				list.splice(i, 1);
				const e = this.addRoot(id, type);
				e.posN = rc.pos; e.rotN = rc.rotation;
				e.setHidden(hidden == null ? rc.isHidden() : hidden);
				if (disableVanilla != null) e.disableVanilla = disableVanilla;
				if (rc.children) { rc.children.forEach(p => { p.parent = e; e.children.push(p); }); }
				const ci = this.cubes.indexOf(rc);
				if (ci >= 0) this.cubes.splice(ci, 1);
				return e;
			}
		}
		return null;
	}
}

async function decodeTex(tex) {
	if (!tex.img && tex.png && tex.png.length) tex.img = await decodeImage(tex.png);
	return tex;
}

// ctx: { warn(msg), fetchLink(link) -> Uint8Array|null }
async function resolveParts(parts, ctx, depth = 0) {
	const out = [];
	for (const p of parts) {
		if (p.t === 'DEFINITION_LINK' || p.t === 'PACKAGE_LINK' || p.t === 'SKIN_LINK') {
			const data = await ctx.fetchLink(p.link);
			if (!data) throw new CPMError('Could not load the linked model data (' + p.link.full + ')');
			const lp = parseLinkedData(data, p.t, ctx);
			if (lp.parts) lp.parts = await resolveParts(lp.parts, ctx, depth + 1);
			out.push(lp);
			continue;
		}
		if (p.t === 'DEFINITION') p.parts = await resolveParts(p.parts, ctx, depth + 1);
		if (p.tex) await decodeTex(p.tex);
		out.push(p);
	}
	return out;
}

function preApply(p, def) {
	switch (p.t) {
		case 'DEFINITION': def.addCubes(p.rc); p.parts.forEach(x => preApply(x, def)); break;
		case 'PACK': p.parts.forEach(x => preApply(x, def)); break;
		case 'CUBES': def.addCubes(p.rc); break;
		case 'PLAYER':
			for (let i = 0; i < PLAYER_PARTS.length; i++) def.getModelElementFor(PLAYER_PARTS[i]).getMainRoot().setHidden(!p.keep[i]);
			break;
		case 'SKIN': def.setTexture('SKIN', p.tex); break;
		case 'TEXTURE': if (p.sheet) def.setTexture(p.sheet, p.tex); break;
		case 'ROOT_INFO':
			if (p.createFrom === 0) {
				const r = def.getModelElementFor(p.root);
				if (!r) break;
				const elem = r.getMainRoot();
				elem.setHidden(p.hidden);
				elem.posN = p.pos; elem.rotN = v3c(p.rot);
				elem.disableVanilla = p.disableVanilla;
			}
			break;
		default: break;
	}
}

function applyEffect(e, def) {
	const cube = e.id != null ? def.getElementById(e.id) : null;
	switch (e.e) {
		case 'GLOW': if (cube) cube.glow = true; break;
		case 'SCALE': if (cube && cube.cube) { cube.cube.meshScale = e.scale; cube.cube.mcScale = e.mcScale; } break;
		case 'HIDE': if (cube) cube.setHidden(true); break;
		case 'COLOR': if (cube && cube.cube) { cube.cube.rgb = e.color; cube.recolor = true; } break;
		case 'SINGLE_TEX': if (cube) cube.singleTex = true; break;
		case 'PER_FACE_UV': if (cube) cube.faceUVs = e.faces; break;
		case 'UV_OVERFLOW': if (cube && cube.cube) { cube.cube.u = e.u; cube.cube.v = e.v; } break;
		case 'ITEM': if (cube && cube.cube) { cube.cube.size = v3(); cube.cube.mcScale = 0; cube.itemRenderer = { slot: e.slot, slotID: e.slotID }; } break;
		case 'HIDE_SKULL': def.hideHeadIfSkull = e.value; break;
		case 'REMOVE_ARMOR_OFFSET': def.removeArmorOffset = e.value; break;
		case 'EXTRUDE': if (cube) cube.extrude = true; break;
		case 'MODEL_SCALE': if (def.scale) { def.scale.rPos = e.pos; def.scale.rRot = e.rot; def.scale.rScale = e.scale; } break;
		case 'SCALING': def.scale = { scaling: e.scaling, rPos: v3(), rRot: v3(), rScale: v3() }; break;
		case 'COPY_TRANSFORM': {
			const from = def.getElementById(e.from), to = def.getElementById(e.to);
			if (from && to) def.reg.addCopy(new CopyTransform(from, to, e.copy, e.multiply));
			break;
		}
		case 'DISABLE_VANILLA': if (cube && cube.isRoot) cube.disableVanilla = true; break;
		case 'REMOVE_BED_OFFSET': def.removeBedOffset = true; break;
		case 'INVIS_GLOW': def.enableInvisGlow = true; break;
		default: break;
	}
}

function applyPart(p, def, ctx) {
	switch (p.t) {
		case 'DEFINITION': case 'PACK': p.parts.forEach(x => applyPart(x, def, ctx)); break;
		case 'PLAYER_PARTPOS': {
			const e = def.getElementById(p.id);
			if (e && e.isRoot) { e.posN = p.pos; e.rotN = v3c(p.rot); }
			break;
		}
		case 'MODEL_ROOT': case 'DUP_ROOT': if (p.type) def.makeRootFrom(p.id, p.type, null, null); break;
		case 'ROOT_INFO': if (p.createFrom !== 0 && p.root) def.makeRootFrom(p.createFrom, p.root, p.hidden, p.disableVanilla); break;
		case 'RENDER_EFFECT': if (p.effect) applyEffect(p.effect, def); break;
		case 'ANIMATION_DATA': applyLegacyAnimation(p.legacy, def); break;
		case 'ANIMATION_NEW': applyAnimationNew(p.state, def); break;
		case 'ANIMATED_TEX': def.reg.addAnimatedTexture(new AnimatedTexture(def, p.at)); break;
		case 'SCALE': def.scale = { scaling: { ENTITY: p.scale }, rPos: v3(), rRot: v3(), rScale: v3() }; break;
		case 'CLONEABLE': def.cloneable = p.info; break;
		default: break;
	}
}

function prepareCubes(p) {
	if (p.t === 'DEFINITION') {
		p.rc = resolveCubes(p.cubes);
		p.parts.forEach(prepareCubes);
	} else if (p.t === 'CUBES') p.rc = resolveCubes(p.cubes);
	else if (p.t === 'PACK') p.parts.forEach(prepareCubes);
}

// Builds the runtime definition (ModelDefinition.resolveAll)
async function buildDefinition(parts, ctx, opts) {
	parts = await resolveParts(parts, ctx);
	let skinType = opts.skinType || 'DEFAULT';
	const def = new ModelDef(skinType);
	parts.forEach(prepareCubes);
	parts.forEach(p => preApply(p, def));
	for (const rc of def.cubes) {
		const id = rc.cube.parentId;
		const p = def.playerParts[id];
		if (p && id < 10) { p.addChild(rc); rc.parent = p; }
		if (!rc.parent) throw new CPMError('Cube without parent');
	}
	if (!def.textures.SKIN) {
		const img = opts.skinImage || null;
		def.skinFromPlayer = true;
		def.textures.SKIN = { size: [64, 64], img };
	}
	def.cubes.push(...def.playerParts);
	for (const c of def.cubes) def.cubeMap.set(c.id, c);
	parts.forEach(p => applyPart(p, def, ctx));
	def.reg.finishLoading(def);
	def.resetAnimationPos();
	def.parts = parts;
	return def;
}

class CopyTransform {
	constructor(from, to, copy, multiply) {
		this.from = from; this.to = to; this.multiply = multiply;
		const b = (i) => (copy & (1 << i)) !== 0;
		this.px = b(0); this.py = b(1); this.pz = b(2); this.rx = b(3); this.ry = b(4); this.rz = b(5);
		this.sx = b(6); this.sy = b(7); this.sz = b(8); this.vis = b(9); this.color = b(10); this.additive = b(11);
	}
	apply() {
		const m = this.multiply, from = this.from, to = this.to;
		const pf = from.getTransformPosition(), rf = from.getTransformRotation(), sf = from.getRenderScale();
		let pt, rt, st;
		if (this.additive) { pt = v3(); rt = v3(); st = v3(); }
		else { pt = to.getTransformPosition(); rt = to.getTransformRotation(); st = to.getRenderScale(); }
		to.setPosition(this.additive, this.px ? pf.x * m : pt.x, this.py ? pf.y * m : pt.y, this.pz ? pf.z * m : pt.z);
		to.setRotation(this.additive, this.rx ? rf.x * m : rt.x, this.ry ? rf.y * m : rt.y, this.rz ? rf.z * m : rt.z);
		to.setRenderScale(this.additive, this.sx ? sf.x * m : st.x, this.sy ? sf.y * m : st.y, this.sz ? sf.z * m : st.z);
		if (this.vis) to.setVisible(from.isVisible());
		if (this.color) to.setColorInt(from.getRGB());
	}
}

class AnimatedTexture {
	constructor(def, at) { Object.assign(this, at); this.def = def; this.lastFrame = -1; this.lastUpdate = -1e9; }
	update(time) {
		if (this.frameCount === 0 || this.frameTime === 0) return;
		const tex = this.def.textures[this.sheet];
		if (!tex || !tex.img) return;
		if (!tex.orig) tex.orig = tex.img.copy();
		const frm = Math.floor(time / this.frameTime) % this.frameCount;
		const img = tex.img, src = tex.orig;
		if (this.interpolate) {
			if (time - this.lastUpdate > 50) {
				this.lastUpdate = time;
				const t = frm + (time % this.frameTime) / this.frameTime;
				copyTextureInt(img, src, this.uvStart.x, this.uvStart.y, this.uvSize.x, this.uvSize.y, this.animStart.x, this.animStart.y, t, this.anX, this.frameCount);
				img.version++;
			}
		} else if (frm !== this.lastFrame) {
			this.lastFrame = frm;
			let ax = this.animStart.x, ay = this.animStart.y;
			if (this.anX) ax += this.uvSize.x * frm; else ay += this.uvSize.y * frm;
			for (let x = 0; x < this.uvSize.x; x++) {
				const x1 = x + ax, x2 = x + this.uvStart.x;
				if (x1 < 0 || x1 >= src.width || x2 < 0 || x2 >= img.width) continue;
				for (let y = 0; y < this.uvSize.y; y++) {
					const y1 = y + ay, y2 = y + this.uvStart.y;
					if (y1 >= 0 && y1 < src.height && y2 >= 0 && y2 < img.height) img.setRGB(x2, y2, src.getRGB(x1, y1));
				}
			}
			img.version++;
		}
	}
}

function copyTextureInt(dest, img, uvx, uvy, sx, sy, ax, ay, time, anX, frms) {
	const frame = Math.floor(time);
	const sub = 1 - (time - frame);
	let axf = ax, ayf = ay, axs = ax, ays = ay;
	if (anX) { axf = ax + sx * frame; axs = ax + sx * ((frame + 1) % frms); }
	else { ayf = ay + sy * frame; ays = ay + sy * ((frame + 1) % frms); }
	const mix = (a, b) => (sub * a + (1 - sub) * b) | 0;
	for (let x = 0; x < sx; x++) {
		const xf = x + axf, xs = x + axs, x2 = x + uvx;
		if (xf < 0 || xf >= img.width || xs < 0 || xs >= img.width || x2 < 0 || x2 >= dest.width) continue;
		for (let y = 0; y < sy; y++) {
			const yf = y + ayf, ys = y + ays, y2 = y + uvy;
			if (yf >= 0 && yf < img.height && ys >= 0 && ys < img.height && y2 >= 0 && y2 < dest.height) {
				const a = img.getRGB(xf, yf), b = img.getRGB(xs, ys);
				const r = mix((a >>> 16) & 255, (b >>> 16) & 255), g = mix((a >>> 8) & 255, (b >>> 8) & 255), bl = mix(a & 255, b & 255);
				dest.setRGB(x2, y2, ((a & 0xff000000) | (r << 16) | (g << 8) | bl) >>> 0);
			}
		}
	}
}
