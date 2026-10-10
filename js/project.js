// ---------------------------------------------------------------------------
// .cpmproject loader: converts the editor project into the same part list the
// exporter (ExporterImpl + AnimationExporter) would produce.
// ---------------------------------------------------------------------------
'use strict';

const DEG = Math.PI / 180;
const vecFrom = (m, def) => m ? { x: +m.x || 0, y: +m.y || 0, z: +m.z || 0 } : { ...def };
const degToRad = (v) => ({ x: v.x * DEG, y: v.y * DEG, z: v.z * DEG });

async function loadProject(bytes, ctx) {
	const zip = await readZip(bytes);
	const readText = async (n) => { const b = await zip.get(n); return b ? utf8.decode(b) : null; };
	const cfgText = await readText('config.json');
	if (!cfgText) throw new CPMError('This project has no config.json');
	const cfg = parseJsonLong(cfgText);
	const info = { name: null, desc: null, kind: 'Project file', icon: null };
	const descText = await readText('description.json');
	if (descText) { try { const d = JSON.parse(descText); info.name = d.name || null; info.desc = d.desc || null; } catch (e) { /* ignore */ } }
	if (zip.has('desc_icon.png')) info.icon = await zip.get('desc_icon.png');

	const skinType = cfg.skinType ? (String(cfg.skinType).toLowerCase() === 'slim' ? 'SLIM' : 'DEFAULT') : null;

	// ---- elements ----
	const elements = []; // flat list with tree links
	const byStore = new Map();
	const roots = [];
	const loadChildren = (list, parent) => {
		for (const m of (list || [])) {
			const el = {
				kind: 'normal', parent, children: [], name: m.name || '',
				texture: !!m.texture, textureSize: m.textureSize | 0, offset: vecFrom(m.offset, { x: 0, y: 0, z: 0 }),
				pos: vecFrom(m.pos, { x: 0, y: 0, z: 0 }), rotation: vecFrom(m.rotation, { x: 0, y: 0, z: 0 }),
				size: vecFrom(m.size, { x: 1, y: 1, z: 1 }), rscale: vecFrom(m.rscale, { x: 1, y: 1, z: 1 }),
				meshScale: vecFrom(m.scale, { x: 1, y: 1, z: 1 }), u: m.u | 0, v: m.v | 0,
				rgb: parseInt(m.color || '0', 16) >>> 0, mirror: !!m.mirror, mcScale: +m.mcScale || 0,
				glow: !!m.glow, recolor: !!m.recolor, hidden: !!m.hidden, singleTex: !!m.singleTex, extrude: !!m.extrude,
				faceUV: m.faceUV || null, itemRenderer: m.itemRenderer || null, copyTransform: m.copyTransform || null,
				storeID: String(m.storeID ?? '0'),
			};
			parent.children.push(el);
			elements.push(el);
			if (!byStore.has(el.storeID)) byStore.set(el.storeID, []);
			byStore.get(el.storeID).push(el);
			loadChildren(m.children, el);
		}
	};
	// base roots exist in the editor before the file is read
	for (let i = 0; i < 6; i++) {
		const el = { kind: 'root', part: PLAYER_PARTS[i], dup: false, children: [], pos: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, hidden: false, disableVanilla: false, storeID: String(i), rgb: 0 };
		roots.push(el);
	}
	for (const m of (cfg.elements || [])) {
		const key = String(m.id || '').toLowerCase();
		let el = null;
		if (m.customPart) {
			const t = ROOT_TYPES.find(r => r.toLowerCase() === key);
			if (!t) continue;
			el = { kind: 'root', part: t, dup: !!m.dup, children: [], storeID: String(m.storeID ?? '0'), rgb: 0 };
			roots.push(el);
		} else if (m.dup) {
			const t = PLAYER_PARTS.find(r => r.toLowerCase() === key);
			if (!t) continue;
			el = { kind: 'root', part: t, dup: true, children: [], storeID: String(m.storeID ?? '0'), rgb: 0 };
			roots.push(el);
		} else {
			el = roots.find(r => r.part.toLowerCase() === key && !r.dup && PLAYER_PARTS.includes(r.part)) || null;
		}
		if (!el) continue;
		el.hidden = m.show === undefined ? false : !m.show;
		el.pos = vecFrom(m.pos, { x: 0, y: 0, z: 0 });
		el.rotation = vecFrom(m.rotation, { x: 0, y: 0, z: 0 });
		el.disableVanilla = !!m.disableVanillaAnim;
		el.name = m.name || '';
		if (m.children) loadChildren(m.children, el);
	}
	for (const r of roots) {
		if (!byStore.has(r.storeID)) byStore.set(r.storeID, []);
		byStore.get(r.storeID).push(r);
	}

	// ---- flatten (ExportHelper.flattenElements) ----
	const cubes = [];
	let nextId = 10;
	const flatten = (list) => {
		for (const me of list) {
			if (me.kind === 'normal') {
				me.id = nextId++;
				cubes.push(me);
			} else if (me.dup || ROOT_TYPES.includes(me.part)) {
				me.id = nextId++;
				cubes.push({ fake: true, me });
			} else me.id = PLAYER_PARTS.indexOf(me.part);
			if (me.parent) me.parentId = me.parent.id;
			flatten(me.children);
		}
	};
	flatten(roots);

	const parts = [];
	const cubeObjs = cubes.map((c) => {
		if (c.fake) {
			const me = c.me;
			return { id: me.id, parentId: 6, pos: { ...me.pos }, rotation: degToRad(me.rotation), offset: { x: 0, y: 0, z: 0 }, size: { x: 0, y: 0, z: 0 },
				meshScale: { x: 1, y: 1, z: 1 }, scale: { x: 1, y: 1, z: 1 }, rgb: 0, u: 0, v: 0, texSize: 0, mcScale: 0, hidden: false };
		}
		const hasMesh = !(Math.abs(c.size.x) <= 0.001 && Math.abs(c.size.y) <= 0.001 && Math.abs(c.size.z) <= 0.001);
		if (!hasMesh) { // exported cubes without a mesh lose their texture/offset data
			return { id: c.id, name: c.name, parentId: c.parentId, pos: { ...c.pos }, rotation: degToRad(c.rotation), offset: { x: 0, y: 0, z: 0 }, size: { x: 0, y: 0, z: 0 },
				meshScale: { ...c.meshScale }, scale: { ...c.rscale }, rgb: 0, u: 0, v: 0, texSize: 0, mcScale: 0, hidden: c.hidden };
		}
		return {
			id: c.id, name: c.name, parentId: c.parentId, pos: { ...c.pos }, rotation: degToRad(c.rotation), offset: { ...c.offset }, size: { ...c.size },
			meshScale: { ...c.meshScale }, scale: { ...c.rscale }, rgb: c.texture ? 0 : ((0xff000000 | c.rgb) >>> 0),
			u: c.u, v: c.v, texSize: c.texture ? (c.mirror ? -c.textureSize : c.textureSize) : 0, mcScale: c.mcScale, hidden: c.hidden,
		};
	});
	parts.push({ t: 'CUBES', cubes: cubeObjs });
	for (const r of roots) {
		if (PLAYER_PARTS.includes(r.part) && !r.dup) {
			parts.push({ t: 'ROOT_INFO', root: r.part, pos: { ...r.pos }, rot: degToRad(r.rotation), createFrom: 0, hidden: r.hidden, disableVanilla: r.disableVanilla });
		} else {
			parts.push({ t: 'ROOT_INFO', root: r.part, pos: { x: 0, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0 }, createFrom: r.id, hidden: r.hidden, disableVanilla: r.disableVanilla });
		}
	}
	const rotNames = ['0', '90', '180', '270'];
	const copyEffects = [];
	for (const el of elements) {
		if (el.glow) parts.push({ t: 'RENDER_EFFECT', effect: { e: 'GLOW', id: el.id } });
		if (el.recolor) parts.push({ t: 'RENDER_EFFECT', effect: { e: 'COLOR', id: el.id, color: el.rgb & 0xffffff } });
		if (el.singleTex) parts.push({ t: 'RENDER_EFFECT', effect: { e: 'SINGLE_TEX', id: el.id } });
		if (el.extrude) parts.push({ t: 'RENDER_EFFECT', effect: { e: 'EXTRUDE', id: el.id } });
		if (el.faceUV) {
			const faces = {};
			for (const d of DIRECTIONS) {
				const f = el.faceUV[d.toLowerCase()];
				if (f) faces[d] = { sx: f.sx | 0, sy: f.sy | 0, ex: f.ex | 0, ey: f.ey | 0, rot: Math.max(0, rotNames.indexOf(String(f.rot))) };
			}
			parts.push({ t: 'RENDER_EFFECT', effect: { e: 'PER_FACE_UV', id: el.id, faces } });
		}
		if (el.itemRenderer) parts.push({ t: 'RENDER_EFFECT', effect: { e: 'ITEM', id: el.id, slot: 0, slotID: 0 } });
		if (el.copyTransform) {
			const ct = el.copyTransform;
			const from = (byStore.get(String(ct.storeID)) || [])[0];
			if (from) {
				let copy = 0;
				['px', 'py', 'pz', 'rx', 'ry', 'rz', 'sx', 'sy', 'sz', 'cv', 'r', 'additive'].forEach((k, i) => { if (ct[k]) copy |= (1 << i); });
				const multiply = ct.multiply == null ? 1 : +ct.multiply;
				copyEffects.push({ t: 'RENDER_EFFECT', effect: { e: 'COPY_TRANSFORM', from: from.id, to: el.id, copy, multiply } });
			}
		}
	}
	parts.push(...copyEffects);

	// ---- textures ----
	const texSize = (name, img) => {
		const s = cfg[name + 'Size'];
		if (s && s.x && s.y) return [s.x | 0, s.y | 0];
		return TEX_DEF_SIZE[name.toUpperCase()] || [img.width, img.height];
	};
	for (const [file, sheet] of [['skin', 'SKIN'], ['cape', 'CAPE'], ['elytra', 'ELYTRA'], ['list_icon', 'LIST_ICON']]) {
		if (!zip.has(file + '.png')) continue;
		const png = await zip.get(file + '.png');
		const img = await decodeImage(png);
		parts.push({ t: 'TEXTURE', sheet, tex: { size: texSize(file, img), png: null, img } });
		const td = cfg.textures && cfg.textures[file];
		if (td && Array.isArray(td.anim)) {
			for (const a of td.anim) {
				parts.push({ t: 'ANIMATED_TEX', at: {
					sheet, uvStart: { x: a.start?.x | 0, y: a.start?.y | 0 }, uvSize: { x: a.size?.x | 0, y: a.size?.y | 0 },
					animStart: { x: a.from?.x | 0, y: a.from?.y | 0 }, frameCount: a.frameCount | 0, frameTime: a.frameTime | 0,
					anX: !!a.anX, interpolate: !!a.interpolate } });
			}
		}
	}

	// ---- properties ----
	const defScaling = +cfg.scaling || 0;
	if (defScaling !== 0) {
		const scaling = { ENTITY: defScaling };
		const ex = cfg.scalingEx || {};
		for (const o of SCALING_OPTIONS) { if (o === 'ENTITY') continue; const v = +ex[o.toLowerCase()] || 0; if (v !== 0) scaling[o] = v; }
		parts.push({ t: 'RENDER_EFFECT', effect: { e: 'SCALING', scaling } });
		const rp = vecFrom(ex.render_position, { x: 0, y: 0, z: 0 }), rr = vecFrom(ex.render_rotation, { x: 0, y: 0, z: 0 }), rs = vecFrom(ex.render_scale, { x: 0, y: 0, z: 0 });
		if ([rp.x, rp.y, rp.z, rr.x, rr.y, rr.z, rs.x, rs.y, rs.z].some(v => v !== 0)) parts.push({ t: 'RENDER_EFFECT', effect: { e: 'MODEL_SCALE', pos: rp, rot: degToRad(rr), scale: rs } });
	}
	const removeArmorOffset = cfg.removeArmorOffset != null ? !!cfg.removeArmorOffset : !roots.some(r => r.dup);
	if (cfg.hideHeadIfSkull === false) parts.push({ t: 'RENDER_EFFECT', effect: { e: 'HIDE_SKULL', value: false } });
	if (removeArmorOffset) parts.push({ t: 'RENDER_EFFECT', effect: { e: 'REMOVE_ARMOR_OFFSET', value: true } });
	if (cfg.removeBedOffset) parts.push({ t: 'RENDER_EFFECT', effect: { e: 'REMOVE_BED_OFFSET' } });
	if (cfg.enableInvisGlow) parts.push({ t: 'RENDER_EFFECT', effect: { e: 'INVIS_GLOW' } });

	// ---- animations ----
	const animNames = zip.names().filter(n => n.startsWith('animations/') && n.endsWith('.json'));
	const anims = [];
	for (const n of animNames) {
		const file = n.substring('animations/'.length);
		let data;
		try { data = parseJsonLong(await readText(n)); } catch (e) { ctx.warn('Skipped animation ' + file + ': ' + e.message); continue; }
		const a = readEditorAnim(file, data, byStore);
		if (a) anims.push(a);
	}
	if (anims.length) {
		try {
			parts.push({ t: 'ANIMATION_NEW', state: exportAnimations(anims, elements.concat(roots), cfg.modelId || null, ctx) });
		} catch (e) { ctx.warn('Animations could not be converted: ' + e.message); }
	}
	let animEnc = null;
	try { const t = await readText('anim_enc.json'); if (t) animEnc = JSON.parse(t); } catch (e) { /* ignore */ }
	return { parts, skinType, info, hasSkin: zip.has('skin.png'), _editor: { roots, elements, anims, cfg, animEnc, removeArmorOffset } };
}

function readEditorAnim(file, data, byStore) {
	let pose = null, type = null;
	let displayName = data.name != null ? String(data.name) : 'Unnamed';
	const sp = file.split('_');
	const prefix = sp[0], rest = file.substring(prefix.length + 1);
	if (prefix === 'v') {
		const pn = rest.endsWith('.json') ? rest.substring(0, rest.length - 5) : rest;
		for (const p of VANILLA_POSES) { if (pn.startsWith(p.toLowerCase())) { pose = p; type = 'POSE'; break; } }
	} else if (prefix === 'c') { pose = customPoseKey(displayName); type = 'CUSTOM_POSE'; }
	else if (prefix === 'g') { type = animTypeFromName(displayName); displayName = cleanAnimName(displayName); }
	if (!type) return null;
	const a = {
		file, type, pose, displayName,
		add: !!data.additive, duration: data.duration | 0, priority: data.priority | 0, loop: !!data.loop,
		intType: Math.max(0, INTERPOLATOR_NAMES.indexOf(String(data.interpolator || 'poly_loop').toLowerCase())),
		layerDefault: +data.layerDefault || 0, order: data.order | 0, isProperty: !!data.isProperty, group: data.group || null,
		command: !!data.command, layerControlled: data.layerControlled !== false, maxValue: data.maxValue == null ? 100 : data.maxValue | 0,
		interpolateValue: data.interpolateVal !== false, mustFinish: !!data.mustFinish, hidden: !!data.hidden,
		frames: [],
	};
	a.id = poseIdOf(displayName);
	for (const f of (data.frames || [])) {
		const comps = new Map();
		for (const m of (f.components || [])) {
			const els = byStore.get(String(m.storeID)) || [];
			const rgb = parseInt(m.color || '0', 16) >>> 0;
			for (const el of els) {
				comps.set(el, {
					pos: vecFrom(m.pos, { x: 0, y: 0, z: 0 }), rot: vecFrom(m.rotation, { x: 0, y: 0, z: 0 }),
					color: { x: (rgb >> 16) & 255, y: (rgb >> 8) & 255, z: rgb & 255 }, show: m.show !== false,
					scale: vecFrom(m.scale, { x: 1, y: 1, z: 1 }),
				});
			}
		}
		a.frames.push(comps);
	}
	return a;
}

// FrameData change checks (AnimFrame.FrameData)
function fdPosCh(a, el, d) { return a.add ? (Math.abs(d.pos.x) > 0.01 || Math.abs(d.pos.y) > 0.01 || Math.abs(d.pos.z) > 0.01) : (Math.abs(d.pos.x - el.pos.x) > 0.01 || Math.abs(d.pos.y - el.pos.y) > 0.01 || Math.abs(d.pos.z - el.pos.z) > 0.01); }
function fdRotCh(a, el, d) { return a.add ? (Math.abs(d.rot.x) > 0.01 || Math.abs(d.rot.y) > 0.01 || Math.abs(d.rot.z) > 0.01) : (Math.abs(d.rot.x - el.rotation.x) > 0.01 || Math.abs(d.rot.y - el.rotation.y) > 0.01 || Math.abs(d.rot.z - el.rotation.z) > 0.01); }
function fdScaleCh(d) { return Math.abs(d.scale.x - 1) > 0.01 || Math.abs(d.scale.y - 1) > 0.01 || Math.abs(d.scale.z - 1) > 0.01; }
function fdColorCh(el, d) {
	if (el.kind === 'root') return false;
	if (!el.texture || el.recolor) { const rgb = ((d.color.x | 0) << 16) | ((d.color.y | 0) << 8) | (d.color.z | 0); return (el.rgb & 0xffffff) !== (rgb & 0xffffff); }
	return false;
}
function fdVisCh(el, d) { return !!el.hidden === d.show; }
function fdAny(a, el, d) { return fdPosCh(a, el, d) || fdRotCh(a, el, d) || fdColorCh(el, d) || fdVisCh(el, d) || fdScaleCh(d); }
function elPart(el, ch) {
	switch (ch) {
		case 0: return el.pos.x; case 1: return el.pos.y; case 2: return el.pos.z;
		case 3: return el.rotation.x * DEG; case 4: return el.rotation.y * DEG; case 5: return el.rotation.z * DEG;
		case 6: return (el.rgb >> 16) & 255; case 7: return (el.rgb >> 8) & 255; case 8: return el.rgb & 255;
		default: return 1; // ModelElement.getScale() is always 1
	}
}
function fdPart(d, ch) {
	switch (ch) {
		case 0: return d.pos.x; case 1: return d.pos.y; case 2: return d.pos.z;
		case 3: return d.rot.x * DEG; case 4: return d.rot.y * DEG; case 5: return d.rot.z * DEG;
		case 6: return d.color.x; case 7: return d.color.y; case 8: return d.color.z;
		case 9: return d.scale.x; case 10: return d.scale.y; default: return d.scale.z;
	}
}

// AnimationExporter + ParameterAllocator
function exportAnimations(anims, allElems, modelId, ctx) {
	const st = newAnimState();
	st.profileId = modelId;
	const sync = [0, 0];
	let poseCounter = 1, gestureCounter = 1, bitCount = 0, bitMask = 0, bitParam = 0;
	const allocByte = (def) => { sync.push(def & 255); return sync.length - 1; };
	const allocBit = (defVal) => {
		if (bitCount === 0) {
			if (bitParam !== 0) sync[bitParam] = bitMask;
			bitParam = allocByte(0); bitMask = 0; bitCount = 8;
		}
		bitCount--;
		bitMask |= (defVal ? 1 : 0) << bitCount;
		return { param: bitParam, mask: 1 << bitCount };
	};
	const buttons = []; // [order, button]
	const allButtons = new Map();
	const triggerIds = new Map();
	const animTriggers = new Map(), serAnims = new Map();
	const stagingMap = new Map(), stagingList = [];
	const dropdownParams = new Map(), dropdownAnims = new Map();
	const elemSet = new Set(allElems);
	const getTrigger = (tr) => {
		const k = triggerKey(tr);
		if (!triggerIds.has(k)) { triggerIds.set(k, st.triggers.length); st.triggers.push(tr); }
		return triggerIds.get(k);
	};
	const linked = (a) => {
		const nm = a.displayName.split(':');
		if (nm.length < 2) return [];
		const rest = a.displayName.substring(nm[0].length + 1);
		if (nm[0] === 'p') { const p = VANILLA_POSES.find(v => v.toLowerCase() === rest); return p ? anims.filter(x => x.pose === p) : []; }
		if (nm[0] === 'c') return anims.filter(x => x.type === 'CUSTOM_POSE' && x.displayName === rest);
		if (nm[0] === 'g') return anims.filter(x => x.pose == null && x.id === rest);
		return [];
	};
	const makeButtonInfo = (a) => {
		if (a.type === 'CUSTOM_POSE' || a.type === 'GESTURE') {
			const isPose = a.type === 'CUSTOM_POSE';
			const btn = makeButton(isPose ? 'POSE' : 'GESTURE', { name: a.id, id: isPose ? poseCounter++ : gestureCounter++, hidden: a.hidden, parameter: isPose ? 0 : 1, gestureTimeout: 0 });
			const info = { button: btn, parameter: 0, value: btn.id, bitMask: false, interpolate: false };
			allButtons.set(a.id, info); buttons.push([a.order, btn]);
			return info;
		}
		if (a.type === 'LAYER') {
			if (a.group != null) {
				if (!allButtons.has(a.group)) {
					const btn = makeButton('DROPDOWN', { name: a.group, parameter: allocByte(0), opts: [''] });
					allButtons.set(a.group, { button: btn, parameter: btn.parameter, value: 0, bitMask: false });
					buttons.push([a.order, btn]);
					dropdownParams.set(a.group, btn.parameter);
				}
				const gi = allButtons.get(a.group);
				if (gi.button.type !== 'DROPDOWN') throw new CPMError('Animation name conflict ' + a.group);
				const id = gi.button.opts.length; gi.button.opts.push(a.id);
				const info = { button: gi.button, parameter: gi.button.parameter, value: id, bitMask: false };
				allButtons.set(a.id, info);
				dropdownAnims.set(a, id);
				return info;
			}
			const bit = allocBit(a.layerDefault > 0.5);
			const btn = makeButton('BOOL_PARAMETER_TOGGLE', { name: a.id, parameter: bit.param, mask: bit.mask, hidden: a.hidden });
			const info = { button: btn, parameter: bit.param, value: bit.mask, bitMask: true };
			allButtons.set(a.id, info); buttons.push([a.order, btn]);
			return info;
		}
		if (a.type === 'VALUE_LAYER') {
			const btn = makeButton('VALUE_PARAMETER_SLIDER', { name: a.id, parameter: allocByte(Math.trunc(a.layerDefault * 255)), maxValue: a.maxValue, hidden: a.hidden });
			const info = { button: btn, parameter: btn.parameter, value: 0, bitMask: false, interpolate: a.interpolateValue };
			allButtons.set(a.id, info); buttons.push([a.order, btn]);
			return info;
		}
		return null;
	};
	const maxDur = anims.reduce((m, x) => Math.max(m, x.duration), -1);
	for (const a of anims) {
		const tr = newTriggerObj();
		if (a.type === 'POSE') { tr.pose = a.pose; tr.anim = 'POSE'; tr.looping = true; tr.mustFinish = a.mustFinish; }
		else if (a.type === 'CUSTOM_POSE' || a.type === 'GESTURE' || a.type === 'LAYER' || a.type === 'VALUE_LAYER') {
			tr.looping = a.type === 'GESTURE' ? a.loop : true;
			let info = allButtons.get(a.id);
			if (!info) {
				info = makeButtonInfo(a);
				if (a.type !== 'LAYER' && a.type !== 'VALUE_LAYER') info.button.layerCtrl = a.layerControlled;
				info.button.command = a.command;
				info.button.isProperty = a.isProperty;
				if (a.type === 'GESTURE' && !a.loop && maxDur > 0) info.button.gestureTimeout = Math.ceil(maxDur / 50) + 5;
			}
			tr.parameter = info.parameter; tr.value = info.value; tr.bitMask = info.bitMask; tr.parameterInterpolate = !!info.interpolate;
			tr.anim = a.type; tr.mustFinish = a.mustFinish;
			if (a.type === 'GESTURE') tr.parameter = 1;
		} else if (a.type === 'SETUP' || a.type === 'FINISH') {
			const l = linked(a);
			let s = l.map(x => stagingMap.get(x)).find(x => x);
			if (!s) { s = { id: stagingList.length, setup: new Set(), play: new Set(), finish: new Set() }; stagingList.push(s); stagingMap.set(a, s); }
			l.forEach(x => stagingMap.set(x, s));
			stagingMap.set(a, s);
			l.forEach(x => s.play.add(x));
			if (a.type === 'SETUP') s.setup.add(a); else s.finish.add(a);
			tr.anim = 'SETUP'; tr.stage = a.type === 'SETUP' ? 'SETUP' : 'FINISH'; tr.stagingID = s.id;
		}
		const tid = getTrigger(tr);
		animTriggers.set(a, tid);
		const sa = { triggerID: tid, priority: a.priority, duration: (a.type === 'POSE' && poseHasStateGetter(a.pose)) || a.type === 'VALUE_LAYER' ? DYNAMIC_DURATION_DIV : a.duration, channels: [] };
		serAnims.set(a, sa);
		st.anims.push(sa);
		// components with changes, in first-seen order
		const comps = [];
		for (const f of a.frames) for (const [el, d] of f) if (!comps.includes(el) && fdAny(a, el, d)) comps.push(el);
		for (const me of comps) {
			if (!elemSet.has(me) || me.id == null) continue;
			const map = addCubeChannels(sa, me.id, a.add);
			const fill = (chn, empty) => {
				const arr = a.frames.map(f => { const d = f.get(me); if (!d) return a.add ? empty : elPart(me, chn); return fdPart(d, chn); });
				const key = ['pos0', 'pos1', 'pos2', 'rot0', 'rot1', 'rot2', 'color0', 'color1', 'color2', 'scale0', 'scale1', 'scale2'][chn];
				sa.channels[map[key]].frame = { kind: 'float', it: a.intType, frames: arr };
			};
			const has = (fn) => a.frames.some(f => { const d = f.get(me); return d && fn(d); });
			if (has(d => fdPosCh(a, me, d))) { fill(0, 0); fill(1, 0); fill(2, 0); }
			if (has(d => fdRotCh(a, me, d))) { fill(3, 0); fill(4, 0); fill(5, 0); }
			if (has(d => fdColorCh(me, d))) { fill(6, 0); fill(7, 0); fill(8, 0); }
			if (has(d => fdVisCh(me, d))) {
				sa.channels[map.vis].frame = { kind: 'bool', frames: a.frames.map(f => { const d = f.get(me); return d ? d.show : !me.hidden; }) };
			}
			if (has(d => fdScaleCh(d))) { fill(9, 1); fill(10, 1); fill(11, 1); }
		}
	}
	// linkStagingAnims
	for (const s of stagingList) {
		const tr = newTriggerObj();
		tr.anim = 'SETUP'; tr.stagingID = s.id; tr.stage = 'PLAY';
		tr.mustFinish = [...s.play].some(e => e.mustFinish);
		const id = getTrigger(tr);
		const trigs = [...new Set([...s.play].map(e => animTriggers.get(e)).filter(e => e != null))];
		[...s.play].forEach(e => { const sa = serAnims.get(e); if (sa) sa.triggerID = id; });
		if (trigs.length === 1) {
			st.triggers[trigs[0]].mustFinish = false;
			st.staged.push(trigs[0]);
		} else {
			ctx.warn('A staged animation (setup/finish) could not be linked to a single main animation and was skipped.');
		}
	}
	dropdownParams.forEach((p, g) => {
		const defV = anims.find(e => e.group === g && e.layerDefault > 0.5);
		if (defV) sync[p] = dropdownAnims.get(defV) & 255;
	});
	if (bitParam !== 0) sync[bitParam] = bitMask;
	st.params = new ParameterDetails(Int8Array.from(sync.map(v => (v << 24) >> 24)), new Int8Array(0));
	buttons.sort((a, b) => a[0] - b[0]);
	st.buttons = buttons.map(b => b[1]);
	return st;
}
