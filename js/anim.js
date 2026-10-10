// ---------------------------------------------------------------------------
// Animation system (ports of com.tom.cpm.shared.animation.* and parts.anim.*)
// ---------------------------------------------------------------------------
'use strict';

const VANILLA_POSES = ['CUSTOM', 'STANDING', 'WALKING', 'RUNNING', 'SNEAKING', 'SWIMMING', 'FALLING', 'SLEEPING', 'RIDING',
	'FLYING', 'DYING', 'SKULL_RENDER', 'GLOBAL', 'CREATIVE_FLYING', 'EATING_LEFT', 'EATING_RIGHT', 'RETRO_SWIMMING', 'JUMPING',
	'SNEAK_WALK', 'PUNCH_LEFT', 'PUNCH_RIGHT', 'ARMOR_HEAD', 'ARMOR_BODY', 'ARMOR_LEGS', 'ARMOR_BOOTS', 'WEARING_ELYTRA',
	'BOW_LEFT', 'BOW_RIGHT', 'CROSSBOW_LEFT', 'CROSSBOW_RIGHT', 'CROSSBOW_CH_LEFT', 'CROSSBOW_CH_RIGHT', 'TRIDENT_LEFT',
	'TRIDENT_RIGHT', 'TRIDENT_SPIN', 'SPYGLASS_LEFT', 'SPYGLASS_RIGHT', 'HOLDING_LEFT', 'HOLDING_RIGHT', 'WEARING_SKULL',
	'BLOCKING_LEFT', 'BLOCKING_RIGHT', 'PARROT_LEFT', 'PARROT_RIGHT', 'HURT', 'ON_FIRE', 'FREEZING', 'ON_LADDER',
	'CLIMBING_ON_LADDER', 'SPEAKING', 'TOOT_HORN_LEFT', 'TOOT_HORN_RIGHT', 'IN_GUI', 'FIRST_PERSON_MOD', 'VOICE_MUTED',
	'VR_FIRST_PERSON', 'VR_THIRD_PERSON_SITTING', 'VR_THIRD_PERSON_STANDING', 'FIRST_PERSON_HAND', 'HEALTH', 'HUNGER', 'AIR',
	'IN_MENU', 'INVISIBLE', 'LIGHT', 'HEAD_ROTATION_YAW', 'HEAD_ROTATION_PITCH', 'BRUSH_LEFT', 'BRUSH_RIGHT', 'CRAWLING',
	'SPEAR_LEFT', 'SPEAR_RIGHT'];

const clamp = (v, a, b) => v < a ? a : (v > b ? b : v);

// Value driven poses: time = value * 1000, animation duration 1001
const POSE_STATE_GETTERS = {
	PUNCH_LEFT: s => s.attackTime, PUNCH_RIGHT: s => s.attackTime,
	BOW_LEFT: s => s.bowPullback, BOW_RIGHT: s => s.bowPullback,
	CROSSBOW_CH_LEFT: s => s.crossbowPullback, CROSSBOW_CH_RIGHT: s => s.crossbowPullback,
	SPEAKING: s => s.speakLevel,
	HEALTH: s => s.health, HUNGER: s => s.hunger, AIR: s => s.air,
	LIGHT: s => Math.max(s.skyLight, s.blockLight) / 15,
	HEAD_ROTATION_YAW: s => {
		let yaw = s.yaw % 360; if (yaw < 0) yaw += 360;
		let bodyYaw = s.bodyYaw % 360; if (bodyYaw < 0) bodyYaw += 360;
		let d = Math.abs(yaw - bodyYaw);
		if (d > 180) d = 360 - d;
		const cd = (bodyYaw - yaw + 360) % 360, ccd = (yaw - bodyYaw + 360) % 360;
		if (cd < ccd) d = -d;
		return clamp((d + 90) / 180, 0, 1);
	},
	HEAD_ROTATION_PITCH: s => clamp((s.pitch + 90) / 180, 0, 1),
};
const DYNAMIC_DURATION_DIV = 1001;
function poseHasStateGetter(p) { return !!POSE_STATE_GETTERS[p]; }
function poseGetTime(p, state, time) {
	const g = POSE_STATE_GETTERS[p];
	if (g && state) return Math.floor(g(state) * 1000);
	return time;
}
// Pose keys: vanilla poses use their enum name, custom poses use "c:" + name
const customPoseKey = (name) => 'c:' + name;

// --------------------------- interpolators --------------------------------
function rotationSetup(fullRot) {
	let prev = null, mul = 0;
	return (value) => {
		if (prev === null) { prev = value; return value; }
		const v1 = Math.abs(value - prev), v2 = Math.abs(fullRot - prev + value), v3_ = Math.abs(fullRot + prev - value);
		prev = value;
		if (v1 < v2 && v1 < v3_) return value + mul;
		else if (v1 > v2 && v2 < v3_) { mul += fullRot; return value + mul; }
		else if (v1 > v3_ && v2 > v3_) { mul -= fullRot; return value + mul; }
		return value;
	};
}
const identitySetup = () => (v) => v;
// InterpolatorChannel: POS_X..SCALE_Z (0..11)
const CHANNEL_SETUP = (ch) => (ch >= 3 && ch <= 5) ? rotationSetup(2 * Math.PI) : identitySetup();

function splineFunction(xs, ys) { // Apache commons SplineInterpolator (natural cubic)
	const n = xs.length - 1;
	const h = new Float64Array(n), mu = new Float64Array(n), z = new Float64Array(n + 1);
	for (let i = 0; i < n; i++) h[i] = xs[i + 1] - xs[i];
	for (let i = 1; i < n; i++) {
		const g = 2 * (xs[i + 1] - xs[i - 1]) - h[i - 1] * mu[i - 1];
		mu[i] = h[i] / g;
		z[i] = (3 * (ys[i + 1] * h[i - 1] - ys[i] * (xs[i + 1] - xs[i - 1]) + ys[i - 1] * h[i]) / (h[i - 1] * h[i]) - h[i - 1] * z[i - 1]) / g;
	}
	const b = new Float64Array(n), c = new Float64Array(n + 1), d = new Float64Array(n);
	for (let j = n - 1; j >= 0; j--) {
		c[j] = z[j] - mu[j] * c[j + 1];
		b[j] = (ys[j + 1] - ys[j]) / h[j] - h[j] * (c[j + 1] + 2 * c[j]) / 3;
		d[j] = (c[j + 1] - c[j]) / (3 * h[j]);
	}
	return (v) => {
		if (v < xs[0] || v > xs[n]) v = clamp(v, xs[0], xs[n]);
		let i = Math.floor(v - xs[0]); // knots are consecutive integers
		if (i >= n) i = n - 1;
		if (i < 0) i = 0;
		const t = v - xs[i];
		return ys[i] + t * (b[i] + t * (c[i] + t * d[i]));
	};
}

const INTERPOLATORS = [
	// POLY_LOOP
	(values, setup) => {
		const frames = values.length;
		if (frames === 0) return () => 0;
		const xs = [], ys = [];
		setup(values[0]); setup(values[frames - 1]);
		for (let j = 0; j < frames + 5; j++) { xs.push(j - 2); ys.push(setup(values[(j + frames - 2) % frames])); }
		return splineFunction(xs, ys);
	},
	// POLY_SINGLE
	(values, setup) => {
		const frames = values.length;
		if (frames === 0) return () => 0;
		const xs = [], ys = [];
		for (let j = 0; j < frames + 2; j++) { xs.push(j - 1); ys.push(setup(values[clamp(j - 1, 0, frames - 1)])); }
		return splineFunction(xs, ys);
	},
	// LINEAR_LOOP
	(values, setup) => {
		const n = values.length;
		if (n === 0) return () => 0;
		setup(values[((n - 2) % n + n) % n]); setup(values[(n - 1) % n]);
		const v = values.map(x => setup(x));
		return (op) => { const frm = Math.abs(Math.floor(op)); const f = op - Math.floor(op); const a = v[frm % n], b = v[(frm + 1) % n]; return a + f * (b - a); };
	},
	// LINEAR_SINGLE
	(values, setup) => {
		const n = values.length;
		if (n === 0) return () => 0;
		const v = values.map(x => setup(x));
		return (op) => { const vv = op / n * (n - 1); const frm = Math.abs(Math.floor(vv)); const f = vv - Math.floor(vv); const a = v[Math.min(frm, n - 1)], b = v[Math.min(frm + 1, n - 1)]; return a + f * (b - a); };
	},
	// NO_INTERPOLATE
	(values) => (op) => values.length ? values[Math.abs(Math.trunc(op)) % values.length] : 0,
	// TRIG_LOOP
	(values, setup) => {
		const n = values.length;
		if (n === 0) return () => 0;
		setup(values[((n - 2) % n + n) % n]); setup(values[(n - 1) % n]);
		const v = values.map(x => setup(x));
		return (op) => { const frm = Math.abs(Math.floor(op)); const f = Math.sin((op - Math.floor(op)) * Math.PI / 2); const a = v[frm % n], b = v[(frm + 1) % n]; return a + f * (b - a); };
	},
	// TRIG_SINGLE
	(values, setup) => {
		const n = values.length;
		if (n === 0) return () => 0;
		const v = values.map(x => setup(x));
		return (op) => { const vv = op / n * (n - 1); const frm = Math.abs(Math.floor(vv)); const f = Math.sin((vv - Math.floor(vv)) * Math.PI / 2); const a = v[Math.min(frm, n - 1)], b = v[Math.min(frm + 1, n - 1)]; return a + f * (b - a); };
	},
];
const INTERPOLATOR_NAMES = ['poly_loop', 'poly_single', 'linear_loop', 'linear_single', 'no_interpolate', 'trig_loop', 'trig_single'];
function makeInterpolator(type, values, ch) {
	const f = INTERPOLATORS[type] || INTERPOLATORS[0];
	return f(values, CHANNEL_SETUP(ch));
}

// --------------------------- legacy Animation --------------------------------
class LegacyAnimation {
	constructor(components, data, show, duration, priority, add, itType) {
		this.components = components; this.show = show; this.duration = duration; this.priority = priority; this.add = add;
		if (components.length === 0) { this.frames = 0; return; }
		this.frames = data[0][0].length;
		this.psfs = data.map(chs => chs.map((vals, ch) => makeInterpolator(itType, vals, ch)));
	}
	getDuration() { return this.duration; }
	getPriority() { return this.priority; }
	animate(state, millis) {
		if (this.frames === 0) return;
		const step = (millis % this.duration) / this.duration * this.frames;
		for (let i = 0; i < this.components.length; i++) {
			const c = this.components[i];
			if (!c) continue;
			const p = this.psfs[i];
			c.setRotation(this.add, p[3](step), p[4](step), p[5](step));
			c.setPosition(this.add, p[0](step), p[1](step), p[2](step));
			c.setColor(p[6](step), p[7](step), p[8](step));
			c.setVisible(this.show[i][Math.floor(step)]);
			c.setRenderScale(this.add, p[9](step), p[10](step), p[11](step));
		}
	}
	prepare() {}
	checkAndUpdateRemove() { return true; }
	useTriggerTime() { return true; }
}

// --------------------------- AnimationNew --------------------------------
class AnimationNew {
	constructor(priority, duration) { this.priority = priority; this.duration = duration; this.handlers = []; }
	getDuration() { return this.duration; }
	getPriority() { return this.priority; }
	animate(state, millis) {
		const step = (millis % this.duration) / this.duration;
		for (const h of this.handlers) h(step);
	}
	prepare() {}
	checkAndUpdateRemove() { return true; }
	useTriggerTime() { return true; }
}

// --------------------------- triggers --------------------------------
class AnimationTrigger {
	constructor(reg, onPoses, valuePose, animations, looping, mustFinish) {
		this.reg = reg; this.onPoses = onPoses; this.valuePose = valuePose; this.animations = animations; this.looping = looping; this.mustFinish = mustFinish;
	}
	getTime(state, time) { return this.valuePose ? poseGetTime(this.valuePose, state, time) : time; }
	canPlay() { return true; }
}
class LayerTrigger extends AnimationTrigger {
	constructor(reg, animations, id, mask, bitmask, mustFinish) { super(reg, ['GLOBAL'], null, animations, true, mustFinish); this.id = id; this.mask = mask; this.bitmask = bitmask; }
	canPlay(state) {
		const gd = state.gestureData;
		const v = gd && gd.length > this.id ? gd[this.id] : this.reg.params.getDefaultParam(this.id);
		if (this.bitmask) return (v & this.mask) === this.mask;
		return v === this.mask;
	}
}
class GestureTrigger extends AnimationTrigger {
	constructor(reg, animations, value, gid, looping, mustFinish) { super(reg, ['GLOBAL'], null, animations, looping, mustFinish); this.value = value; this.gid = gid; }
	canPlay(state) {
		const gd = state.gestureData;
		if (gd && gd.length > 1) return gd[1] === ((this.value << 24) >> 24);
		return false;
	}
}
class ValueTrigger extends AnimationTrigger {
	constructor(reg, animations, id, interpolate) { super(reg, ['GLOBAL'], null, animations, true, false); this.id = id; this.interpolate = interpolate; }
	getTime(state) {
		const gd = state && state.gestureData;
		let val;
		if (gd && gd.length > this.id) val = (gd[this.id] & 255) / 256;
		else val = (this.reg.params.getDefaultParam(this.id) & 255) / 256;
		return Math.floor(val * 1000);
	}
}

class ParameterDetails {
	constructor(sync, local) { this.syncDefault = sync || new Int8Array(2); this.localDefault = local || new Int8Array(0); }
	getDefaultParam(p) { return p >= 0 && p < this.syncDefault.length ? this.syncDefault[p] : 0; }
	createSyncParams() { return Int8Array.from(this.syncDefault); }
}

// --------------------------- StagedAnimation --------------------------------
class StagedAnimation {
	constructor() { this.pre = []; this.play = []; this.post = []; this.all = []; this.currentStage = null; }
	_add(list, tr, anim, stage, legacyMustFinish) {
		const a = new StagedPart(this, tr, anim, stage, legacyMustFinish);
		list.push(a); this.all.push(a); return a;
	}
	addPreTrigger(tr) { tr.animations.forEach(a => this._add(this.pre, tr, a, 'SETUP')); }
	addPlayTrigger(tr) { tr.animations.forEach(a => this._add(this.play, tr, a, 'PLAY')); }
	addPostTrigger(tr) { tr.animations.forEach(a => this._add(this.post, tr, a, 'FINISH')); }
	addPre(anim) { return this._add(this.pre, null, anim, 'SETUP'); }
	addPlay(anim, mustFinish) { if (anim instanceof StagedPart) return anim; return this._add(this.play, null, anim, 'PLAY', mustFinish); }
	addPost(anim) { return this._add(this.post, null, anim, 'FINISH'); }
	getAll() { return this.all; }
}
class StagedPart {
	constructor(owner, tr, parent, stage, legacyMustFinish) {
		this.owner = owner; this.tr = tr; this.parent = parent; this.stage = stage;
		this.mustFinish = tr ? (stage === 'PLAY' && tr.mustFinish) : !!legacyMustFinish;
		this.d = null;
	}
	getDuration() { return this.stage === 'FINISH' ? Number.MAX_SAFE_INTEGER : this.parent.getDuration(); }
	getPriority() { return this.parent.getPriority(); }
	animate(state, millis, def) {
		const d = this.d, o = this.owner;
		const lf = d.lastFrame;
		d.lastFrame = millis;
		const dur = this.parent.getDuration();
		if (o.currentStage === this.stage) {
			if (this.stage === 'FINISH' && millis >= d.offset + dur) return;
			if (this.stage === 'SETUP' && (millis - d.offset) >= dur) {
				d.finished = true;
				if (o.pre.every(a => a.d && a.d.finished)) o.currentStage = 'PLAY';
			} else if (this.stage === 'PLAY' && d.finishing && Math.floor((millis - d.offset) / dur) !== Math.floor((lf - d.offset) / dur)) {
				d.finished = true;
			} else if (!this.tr || this.tr.canPlay(state)) {
				this.parent.animate(state, millis - d.offset, def);
			}
		} else d.offset = millis;
	}
	checkAndUpdateRemove() {
		const d = this.d;
		if (!d) return true;
		const o = this.owner;
		if (this.stage === 'FINISH') {
			if (o.play.every(a => !a.mustFinish || (a.d && a.d.finished))) {
				o.currentStage = 'FINISH';
				if (d.lastFrame >= d.offset + this.parent.getDuration()) { d.offset = 0; return true; }
			}
			return false;
		} else if (this.stage === 'PLAY' && this.mustFinish) {
			d.finishing = true;
			return d.finished;
		}
		d.finished = false; d.offset = 0;
		return true;
	}
	prepare() {
		this.owner.currentStage = this.owner.pre.length === 0 ? 'PLAY' : 'SETUP';
		this.owner.all.forEach(a => { a.d = { offset: 0, lastFrame: 0, finished: false, finishing: false }; });
	}
	useTriggerTime() { return this.stage !== 'FINISH'; }
}

// --------------------------- AnimationHandler --------------------------------
class AnimationHandler {
	constructor() { this.current = []; this.next = []; }
	addAnimations(state, triggers) {
		for (const t of triggers) {
			if (!t.canPlay(state)) continue;
			for (const a of t.animations) this.next.push({ animation: a, trigger: t });
		}
	}
	clear() { this.next = []; this.current = []; }
	animate(state, time, def) {
		let needsSort = false;
		this.current = this.current.filter(a => !(this.next.every(n => n.animation !== a.anim) && a.checkAndUpdateRemove()));
		for (const n of this.next) {
			if (!this.current.some(c => c.anim === n.animation)) {
				n.animation.prepare();
				this.current.push({
					anim: n.animation, trigger: n.trigger, start: time, lastFrame: 0, loop: n.trigger.looping, finished: false, mustFinish: n.trigger.mustFinish,
					checkAndUpdateRemove() {
						if (this.mustFinish) { this.loop = false; return this.anim.checkAndUpdateRemove() && this.finished; }
						return this.anim.checkAndUpdateRemove();
					}
				});
				needsSort = true;
			}
		}
		if (needsSort) this.current.sort((a, b) => a.anim.getPriority() - b.anim.getPriority());
		def.resetAnimationPos();
		for (const a of this.current) {
			if (a.finished) continue;
			const step = time - a.start;
			const t = (!a.trigger || !a.anim.useTriggerTime()) ? step : a.trigger.getTime(state, step);
			a.anim.animate(state, t, def);
			const dur = a.anim.getDuration();
			if (!a.loop && Math.floor(step / dur) !== Math.floor(a.lastFrame / dur)) a.finished = true;
			a.lastFrame = step;
		}
		this.next = [];
	}
	// for UI: which animations are currently playing
	playing() { return this.current.filter(a => !a.finished).map(a => a.anim); }
}

// --------------------------- buttons (gesture menu) --------------------------------
// type: POSE, GESTURE, BOOL_PARAMETER_TOGGLE, VALUE_PARAMETER_SLIDER, DROPDOWN, LEGACY_DROPDOWN
function makeButton(type, props) {
	return Object.assign({ type, name: '', command: false, layerCtrl: false, isProperty: false, hidden: false }, props);
}
function buttonCanShow(b) { return !b.command && !b.hidden; }

// --------------------------- AnimationRegistry --------------------------------
class AnimationRegistry {
	constructor() {
		this.params = new ParameterDetails();
		this.animatedTextures = [];
		this.namedActions = [];
		this.poseToTriggers = new Map();
		this.triggers = [];
		this.poseById = new Map();
		this.customPoseByName = new Map();
		this.copyTransforms = [];
		this.blankGesture = 0; this.poseResetId = 0; this.profileId = null;
		this.legacyParser = null;
		this.animInfo = new Map(); // IAnimation -> descriptive info for the UI
	}
	getPoseById(id, def) { return this.poseById.has(id) ? this.poseById.get(id) : def; }
	getPoseAnimations(p) { return this.poseToTriggers.get(p) || []; }
	hasPoseAnimations(p) { return this.getPoseAnimations(p).length > 0; }
	addAnimatedTexture(t) { this.animatedTextures.push(t); }
	tickAnimated(time) { this.animatedTextures.forEach(t => t.update(time)); }
	addCopy(c) { this.copyTransforms.push(c); }
	applyCopy() { this.copyTransforms.forEach(c => c.apply()); }
	registerButton(btn) {
		this.namedActions.push(btn);
		if (btn.type === 'POSE') {
			const key = customPoseKey(btn.name);
			this.poseById.set(btn.id, key);
			this.customPoseByName.set(btn.name, key);
		}
	}
	register(trigger) {
		this.triggers.push(trigger);
		for (const p of trigger.onPoses) {
			if (!this.poseToTriggers.has(p)) this.poseToTriggers.set(p, []);
			this.poseToTriggers.get(p).push(trigger);
		}
	}
	getLegacyParser(def) { if (!this.legacyParser) this.legacyParser = new LegacyAnimationParser(def); return this.legacyParser; }
	finishLoading() { if (this.legacyParser) this.legacyParser.register(); this.legacyParser = null; }
}

// --------------------------- legacy ANIMATION_DATA --------------------------------
const LEGACY_ANIM_TYPES = ['END', 'POSE', 'GESTURE', 'ANIMATION_DATA_ROTATION', 'ANIMATION_DATA_POS', 'ANIMATION_DATA_VIS',
	'ANIMATION_DATA_COLOR', 'ANIMATION_INFO', 'ENCODING', 'CTRL_IDS', 'ANIMATION_DATA_EXTRA', 'ANIMATION_DATA_INTERPOLATION',
	'ANIMATION_DATA_SCALE', 'ANIMATION_DATA_LAYER_DEFAULT', 'ANIMATION_DATA_ORDER', 'ANIMATION_DATA_IS_PROPERTY',
	'ANIMATION_DATA_GROUP', 'MODEL_PROFILES_ID', 'ANIMATION_DATA_COMMAND', 'ANIMATION_DATA_ENC', 'ANIMATION_MUST_FINISH',
	'ANIMATION_SLIDER_OPT', 'ANIMATION_BUTTON_HIDDEN'];

function parseLegacyAnimation(din) {
	const parsed = new Map();
	let blankId = 0, resetId = 0, profileId = null;
	const rdNew = (o) => Object.assign({ gid: -1, components: [], pos: [], rot: [], scale: [], color: [], show: [], frames: 0, duration: 0, loop: false, add: false, priority: 0, it: 0, defaultValue: 0, order: 0, isProperty: false, group: null, command: false, layerCtrl: false, finish: false, maxValue: 0, interpolateVal: false, buttonHidden: false }, o);
	for (;;) {
		const type = din.readEnum(LEGACY_ANIM_TYPES.length);
		if (type === 0) break;
		const block = din.readNextBlock();
		if (type < 0) continue;
		const T = LEGACY_ANIM_TYPES[type];
		const getRd = () => parsed.get(block.u8());
		switch (T) {
			case 'GESTURE': {
				const id = block.u8(); const name = block.readUTF(); const flags = block.u8();
				parsed.set(id, rdNew({ name, loop: (flags & 2) !== 0, add: (flags & 1) !== 0 }));
				break;
			}
			case 'POSE': {
				const pi = block.readEnum(VANILLA_POSES.length); const id = block.u8(); const flags = block.u8();
				const pose = VANILLA_POSES[pi];
				if (pose === 'CUSTOM') {
					const name = block.readUTF();
					parsed.set(id, rdNew({ pose: customPoseKey(name), customName: name, add: (flags & 1) !== 0 }));
				} else parsed.set(id, rdNew({ pose, add: (flags & 1) !== 0 }));
				break;
			}
			case 'ANIMATION_DATA_COLOR': { const rd = getRd(); if (!rd) break; const cid = block.u8(); rd.color[cid] = []; for (let i = 0; i < rd.frames; i++) rd.color[cid].push({ x: block.u8(), y: block.u8(), z: block.u8() }); break; }
			case 'ANIMATION_DATA_POS': { const rd = getRd(); if (!rd) break; const cid = block.u8(); rd.pos[cid] = []; for (let i = 0; i < rd.frames; i++) rd.pos[cid].push(block.readVec6b()); break; }
			case 'ANIMATION_DATA_ROTATION': { const rd = getRd(); if (!rd) break; const cid = block.u8(); rd.rot[cid] = []; for (let i = 0; i < rd.frames; i++) rd.rot[cid].push(block.readAngle()); break; }
			case 'ANIMATION_DATA_SCALE': { const rd = getRd(); if (!rd) break; const cid = block.u8(); rd.scale[cid] = []; for (let i = 0; i < rd.frames; i++) rd.scale[cid].push(block.readVec6b()); break; }
			case 'ANIMATION_DATA_VIS': {
				const rd = getRd(); if (!rd) break; const cid = block.u8();
				rd.show[cid] = new Array(rd.frames);
				for (let i = 0; i < rd.frames; i += 8) { const dt = block.u8(); for (let j = 0; i + j < rd.frames && j < 8; j++) rd.show[cid][i + j] = (dt & (1 << j)) !== 0; }
				break;
			}
			case 'ANIMATION_INFO': {
				const rd = getRd(); if (!rd) break;
				const count = block.u8(), frames = block.u8(), duration = block.readShort();
				rd.components = []; for (let i = 0; i < count; i++) rd.components.push(block.readVarInt());
				rd.pos = new Array(count); rd.rot = new Array(count); rd.scale = new Array(count); rd.color = new Array(count); rd.show = new Array(count);
				rd.frames = frames; rd.duration = duration;
				break;
			}
			case 'ENCODING': case 'ANIMATION_DATA_ENC': { const rd = getRd(); if (!rd) break; rd.gid = block.u8(); rd.layerCtrl = T === 'ENCODING'; break; }
			case 'CTRL_IDS': blankId = block.u8(); resetId = block.u8(); break;
			case 'ANIMATION_DATA_EXTRA': { const rd = getRd(); if (rd) rd.priority = block.i8(); break; }
			case 'ANIMATION_DATA_INTERPOLATION': { const rd = getRd(); if (rd) rd.it = Math.max(0, block.readEnum(7)); break; }
			case 'ANIMATION_DATA_LAYER_DEFAULT': { const rd = getRd(); if (rd) rd.defaultValue = block.i8(); break; }
			case 'ANIMATION_DATA_ORDER': { const rd = getRd(); if (rd) rd.order = block.i8(); break; }
			case 'ANIMATION_DATA_IS_PROPERTY': { const rd = getRd(); if (rd) rd.isProperty = true; break; }
			case 'ANIMATION_DATA_GROUP': { const rd = getRd(); if (rd) rd.group = block.readUTF(); break; }
			case 'MODEL_PROFILES_ID': profileId = block.readUTF(); break;
			case 'ANIMATION_DATA_COMMAND': { const rd = getRd(); if (rd) rd.command = true; break; }
			case 'ANIMATION_MUST_FINISH': { const rd = getRd(); if (rd) rd.finish = true; break; }
			case 'ANIMATION_SLIDER_OPT': { const rd = getRd(); if (rd) { rd.interpolateVal = block.readBoolean(); rd.maxValue = block.i8(); } break; }
			case 'ANIMATION_BUTTON_HIDDEN': { const rd = getRd(); if (rd) rd.buttonHidden = true; break; }
			default: break;
		}
	}
	return { parsed, blankId, resetId, profileId };
}

const LAYER_PREFIX = '$layer$', VALUE_LAYER_PREFIX = '$value$', SETUP_PREFIX = '$pre$', FINISH_PREFIX = '$post$';
function animTypeFromName(n) {
	if (n.startsWith(LAYER_PREFIX)) return 'LAYER';
	if (n.startsWith(VALUE_LAYER_PREFIX)) return 'VALUE_LAYER';
	if (n.startsWith(SETUP_PREFIX)) return 'SETUP';
	if (n.startsWith(FINISH_PREFIX)) return 'FINISH';
	return 'GESTURE';
}
function cleanAnimName(n) {
	for (const p of [LAYER_PREFIX, VALUE_LAYER_PREFIX, SETUP_PREFIX, FINISH_PREFIX]) if (n.startsWith(p)) return n.substring(p.length);
	return n;
}
const poseIdOf = (name) => { const i = name.indexOf('#'); if (i === -1) return name; if (i === 0) return ''; return name.substring(0, i); };

function applyLegacyAnimation(L, def) {
	for (const rd of L.parsed.values()) {
		const comp = rd.components.map(id => def.getElementById(id) || null);
		const data = [];
		for (let i = 0; i < comp.length; i++) {
			const c = comp[i];
			const dt = []; for (let ch = 0; ch < 12; ch++) dt.push(new Array(rd.frames).fill(0));
			const pos = rd.pos[i], rot = rd.rot[i], scale = rd.scale[i], color = rd.color[i];
			for (let f = 0; f < rd.frames; f++) {
				if (pos) { dt[0][f] = pos[f].x; dt[1][f] = pos[f].y; dt[2][f] = pos[f].z; }
				else if (!rd.add && c) { const p = c.getPosition(); dt[0][f] = p.x; dt[1][f] = p.y; dt[2][f] = p.z; }
				if (rot) { dt[3][f] = rot[f].x; dt[4][f] = rot[f].y; dt[5][f] = rot[f].z; }
				else if (!rd.add && c) { const r = c.getRotation(); dt[3][f] = r.x; dt[4][f] = r.y; dt[5][f] = r.z; }
				if (color) { dt[6][f] = color[f].x; dt[7][f] = color[f].y; dt[8][f] = color[f].z; }
				else if (c && c.getRGB() !== -1) { const rgb = c.getRGB(); dt[6][f] = (rgb >> 16) & 255; dt[7][f] = (rgb >> 8) & 255; dt[8][f] = rgb & 255; }
				if (scale) { dt[9][f] = scale[f].x; dt[10][f] = scale[f].y; dt[11][f] = scale[f].z; }
				else if (!rd.add) { dt[9][f] = 1; dt[10][f] = 1; dt[11][f] = 1; }
			}
			if (!rd.show[i]) rd.show[i] = new Array(rd.frames).fill(c ? c.isVisible() : true);
			data.push(dt);
		}
		if (rd.pose && !rd.pose.startsWith('c:') && poseHasStateGetter(rd.pose)) rd.duration = DYNAMIC_DURATION_DIV;
		rd.anim = new LegacyAnimation(comp, data, rd.show, Math.max(1, rd.duration), rd.priority, rd.add, rd.it);
	}
	const reg = def.reg;
	const state = reg.getLegacyParser(def);
	for (const rd of L.parsed.values()) {
		if (rd.pose && !rd.pose.startsWith('c:')) {
			state.addPose(rd.pose, rd.anim, rd.finish);
			reg.animInfo.set(rd.anim, { label: rd.pose, kind: 'pose' });
		} else if (rd.name != null) {
			if (!state.gestures.has(rd.name)) {
				const g = { type: animTypeFromName(rd.name), animation: [], name: cleanAnimName(rd.name), isLoop: rd.loop, order: rd.order, mustFinish: rd.finish,
					defVal: rd.defaultValue, isProperty: rd.isProperty, group: rd.group, command: rd.command, layerCtrl: rd.layerCtrl,
					maxValue: rd.maxValue, interpolateVal: rd.interpolateVal, hidden: rd.buttonHidden, gid: 0 };
				state.addGesture(g, rd.gid);
				state.gestures.set(rd.name, g.animation);
			}
			state.gestures.get(rd.name).push(rd.anim);
			reg.animInfo.set(rd.anim, { label: cleanAnimName(rd.name), kind: animTypeFromName(rd.name).toLowerCase() });
		} else {
			state.addPose(rd.pose, rd.anim, rd.finish);
			const name = rd.customName;
			state.addCustomPose({ name, order: rd.order, hidden: rd.buttonHidden, command: rd.command, layerCtrl: rd.layerCtrl, pose: rd.pose }, rd.gid);
			reg.animInfo.set(rd.anim, { label: name, kind: 'custom pose' });
		}
	}
	reg.blankGesture = L.blankId; reg.poseResetId = L.resetId; reg.profileId = L.profileId;
	(def.exportLegacy || (def.exportLegacy = [])).push(L);
}

class LegacyAnimationParser {
	constructor(def) {
		this.def = def; this.reg = def.reg;
		this.layerToId = new Map(); this.poseGid = new Map(); this.stageGestures = [];
		this.gestures = new Map(); this.animations = new Map(); this.gesturesMap = new Map(); this.customPoses = new Map();
		this.mustFinishPoses = new Set();
	}
	addPose(pose, anim, finish) {
		if (!this.animations.has(pose)) this.animations.set(pose, []);
		this.animations.get(pose).push(anim);
		if (finish) this.mustFinishPoses.add(pose);
	}
	addCustomPose(p, gid) {
		if (!this.customPoses.has(p.name)) this.customPoses.set(p.name, p);
		if (gid !== -1) this.poseGid.set(p.pose, gid);
	}
	addGesture(g, gid) {
		if (g.type === 'SETUP' || g.type === 'FINISH') this.stageGestures.push(g);
		else {
			this.gesturesMap.set(g.name, g);
			if (g.type === 'LAYER' || g.type === 'VALUE_LAYER') this.layerToId.set(g, this.layerToId.size + 2);
			if (gid !== -1) g.gid = gid;
		}
	}
	finishLoading() {
		const anims = new Map();
		for (const g of this.stageGestures) {
			const nm = g.name.split(':');
			if (nm.length < 2) continue;
			const rest = g.name.substring(nm[0].length + 1);
			if (!anims.has(g.name)) anims.set(g.name, new StagedAnimation());
			const san = anims.get(g.name);
			if (g.type === 'SETUP') g.animation.forEach(a => san.addPre(a));
			else g.animation.forEach(a => san.addPost(a));
			let pose = null;
			if (nm[0] === 'p' || nm[0] === 'c') {
				if (nm[0] === 'p') pose = VANILLA_POSES.find(p => p.toLowerCase() === rest) || null;
				if (!pose) { const p = this.customPoses.get(rest); if (p) pose = p.pose; }
				if (pose && this.animations.has(pose)) {
					const mf = this.mustFinishPoses.has(pose);
					this.animations.get(pose).forEach(a => san.addPlay(a, mf));
					if (mf) this.mustFinishPoses.delete(pose);
					this.animations.set(pose, san.getAll());
				}
			} else if (nm[0] === 'g') {
				const gs = this.gesturesMap.get(rest);
				if (gs) {
					gs.animation.forEach(a => san.addPlay(a, gs.mustFinish));
					gs.animation = san.getAll();
					gs.mustFinish = false;
				}
			}
		}
	}
	register() {
		this.finishLoading();
		const reg = this.reg;
		const groups = new Map();
		const items = [...[...this.gesturesMap.values()].map(g => ({ g, kind: 'g' })), ...[...this.customPoses.values()].map(p => ({ p, kind: 'p' }))];
		items.sort((a, b) => (a.kind === 'g' ? a.g.order : a.p.order) - (b.kind === 'g' ? b.g.order : b.p.order));
		const order = [];
		for (const it of items) {
			if (it.kind === 'g' && it.g.group != null) {
				if (!groups.has(it.g.group)) { const gr = { kind: 'group', id: it.g.group, gs: [it.g] }; groups.set(it.g.group, gr); order.push(gr); }
				else groups.get(it.g.group).gs.push(it.g);
			} else order.push(it);
		}
		for (const it of order) {
			if (it.kind === 'group') {
				const params = new Map(); params.set('', -1);
				for (const g of it.gs) {
					const l = this.layerToId.get(g);
					reg.register(new LayerTrigger(reg, g.animation, l, 1, true, g.mustFinish));
					params.set(g.name, l);
				}
				reg.registerButton(makeButton('LEGACY_DROPDOWN', { name: it.id, params, command: it.gs.some(g => g.command), isProperty: it.gs.some(g => g.isProperty) }));
			} else if (it.kind === 'p') {
				const p = it.p;
				const id = this.poseGid.has(p.pose) ? this.poseGid.get(p.pose) : 0;
				reg.registerButton(makeButton('POSE', { name: poseIdOf(p.name), id, gid: p.layerCtrl ? id : 0, layerCtrl: p.layerCtrl, command: p.command, hidden: p.hidden, parameter: 0 }));
			} else {
				const g = it.g;
				if (g.type === 'GESTURE') {
					let timeout = 0;
					if (!g.isLoop) { const len = g.animation.reduce((m, a) => Math.max(m, a.getDuration()), -1); timeout = len === -1 ? -1 : Math.ceil(len / 50) + 5; }
					reg.registerButton(makeButton('GESTURE', { name: g.name, id: g.gid, gid: g.layerCtrl ? g.gid : 0, layerCtrl: g.layerCtrl, command: g.command, hidden: g.hidden, gestureTimeout: timeout, parameter: 1 }));
					reg.register(new GestureTrigger(reg, g.animation, g.gid, g.gid, g.isLoop, g.mustFinish));
				} else if (g.type === 'LAYER') {
					const param = this.layerToId.get(g);
					reg.registerButton(makeButton('BOOL_PARAMETER_TOGGLE', { name: g.name, command: g.command, isProperty: g.isProperty, parameter: param, mask: 1, hidden: g.hidden }));
					reg.register(new LayerTrigger(reg, g.animation, param, 1, true, g.mustFinish));
				} else if (g.type === 'VALUE_LAYER') {
					const param = this.layerToId.get(g);
					reg.registerButton(makeButton('VALUE_PARAMETER_SLIDER', { name: g.name, command: g.command, isProperty: g.isProperty, parameter: param, maxValue: g.maxValue === 0 ? 255 : (g.maxValue & 255), hidden: g.hidden }));
					reg.register(new ValueTrigger(reg, g.animation, param, g.maxValue === 0 ? true : g.interpolateVal));
				}
			}
		}
		const sync = new Int8Array(this.layerToId.size + 2);
		this.layerToId.forEach((i, g) => { sync[i] = g.defVal; });
		reg.params = new ParameterDetails(sync, new Int8Array(0));
		this.animations.forEach((an, p) => {
			const isVanilla = !p.startsWith('c:');
			reg.register(new AnimationTrigger(reg, [p], isVanilla ? p : null, an, true, this.mustFinishPoses.has(p)));
		});
	}
}

// --------------------------- ANIMATION_NEW --------------------------------
const TAG_TYPES = ['END', 'NEW_ANIM', 'NEW_TRIGGER', 'INIT_BUILTIN_TRIGGER', 'INIT_NAMED_TRIGGER', 'INIT_PARAMETER_TRIGGER',
	'INIT_STAGED_TRIGGER', 'CONSTANT_FRAME_TIME_FLOAT', 'CONSTANT_FRAME_TIME_BOOLEAN', 'CUBES_TO_CHANNELS', 'CONTROL_INFO',
	'GESTURE_BUTTON', 'PARAMETERS', 'INIT_STAGED_ANIM'];
const ANIM_TYPES = ['POSE', 'CUSTOM_POSE', 'GESTURE', 'LAYER', 'VALUE_LAYER', 'SETUP', 'FINISH'];
const STAGE_TYPES = ['SETUP', 'PLAY', 'FINISH'];
const BUTTON_TYPES = ['POSE', 'GESTURE', 'BOOL_PARAMETER_TOGGLE', 'VALUE_PARAMETER_SLIDER', 'DROPDOWN'];

function newAnimState() {
	return { params: null, buttons: [], anims: [], triggers: [], cA: null, cT: null, blankId: 0, resetId: 0, profileId: null, staged: [] };
}
function newTriggerObj() {
	return { stage: null, stagingID: -1, anim: null, pose: null, looping: false, layerCtrl: false, parameter: -1, value: 0, gid: -1, bitMask: false, parameterInterpolate: false, mustFinish: false };
}
// Channel descriptors: {kind:'f3', group:{cube, type:'pos'|'rot'|'color'|'scale', additive}, axis, frame} or {kind:'vis', cube, frame}
function addCubeChannels(anim, cubeId, additive) {
	const map = {};
	for (const type of ['pos', 'rot', 'color', 'scale']) {
		const group = { cube: cubeId, type, additive, ch: [] };
		for (let a = 0; a < 3; a++) {
			const ch = { kind: 'f3', group, axis: a, frame: null };
			group.ch.push(ch);
			map[type + a] = anim.channels.length;
			anim.channels.push(ch);
		}
	}
	map.vis = anim.channels.length;
	anim.channels.push({ kind: 'vis', cube: cubeId, frame: null });
	return map;
}

function parseAnimationNew(din) {
	const st = newAnimState();
	for (;;) {
		const t = din.readObjectBlock(TAG_TYPES.length, (type, b) => { parseAnimTag(TAG_TYPES[type], b, st); return TAG_TYPES[type]; });
		if (t === 'END') break;
	}
	return st;
}

function parseAnimTag(T, b, st) {
	switch (T) {
		case 'NEW_ANIM': {
			const a = { triggerID: b.readVarInt(), priority: b.readSignedVarInt(), duration: b.readVarInt(), channels: [] };
			st.anims.push(a); st.cA = a; break;
		}
		case 'NEW_TRIGGER': { const t = newTriggerObj(); st.triggers.push(t); st.cT = t; break; }
		case 'INIT_BUILTIN_TRIGGER': {
			const t = st.cT; t.pose = VANILLA_POSES[b.readEnum(VANILLA_POSES.length)]; t.anim = 'POSE';
			const flags = b.u8(); t.mustFinish = (flags & 16) !== 0; t.looping = true; break;
		}
		case 'INIT_NAMED_TRIGGER': {
			const t = st.cT; t.anim = ANIM_TYPES[b.readEnum(ANIM_TYPES.length)];
			t.parameter = t.anim === 'GESTURE' ? 1 : 0;
			const flags = b.u8();
			t.layerCtrl = (flags & 1) !== 0; t.looping = (flags & 2) !== 0; t.mustFinish = (flags & 16) !== 0;
			t.value = b.u8();
			if (t.layerCtrl) t.gid = b.u8();
			break;
		}
		case 'INIT_PARAMETER_TRIGGER': {
			const t = st.cT; t.anim = ANIM_TYPES[b.readEnum(ANIM_TYPES.length)];
			const flags = b.u8();
			t.looping = (flags & 2) !== 0; t.bitMask = (flags & 4) !== 0; t.parameterInterpolate = (flags & 8) !== 0; t.mustFinish = (flags & 16) !== 0;
			t.parameter = b.readVarInt(); t.value = b.u8();
			break;
		}
		case 'INIT_STAGED_TRIGGER': {
			const t = st.cT; t.anim = 'SETUP'; t.stage = STAGE_TYPES[b.readEnum(3)]; t.stagingID = b.readVarInt();
			const flags = b.u8(); t.mustFinish = (flags & 16) !== 0; break;
		}
		case 'CONSTANT_FRAME_TIME_FLOAT': {
			const a = st.cA; const it = Math.max(0, b.readEnum(7)); const frames = b.readVarInt(); const count = b.readVarInt();
			for (let i = 0; i < count; i++) {
				const chID = b.readVarInt();
				const f = new Array(frames); for (let j = 0; j < frames; j++) f[j] = b.readVarFloat();
				if (a.channels[chID]) a.channels[chID].frame = { kind: 'float', it, frames: f };
			}
			break;
		}
		case 'CONSTANT_FRAME_TIME_BOOLEAN': {
			const a = st.cA; const frames = b.readVarInt(); const count = b.readVarInt();
			for (let i = 0; i < count; i++) {
				const chID = b.readVarInt(); const f = b.readBoolArray(frames);
				if (a.channels[chID]) a.channels[chID].frame = { kind: 'bool', frames: f };
			}
			break;
		}
		case 'CUBES_TO_CHANNELS': {
			const a = st.cA; const cubes = b.readVarInt(); const intCh = b.readVarInt(); const flags = b.u8();
			for (let i = 0; i < cubes; i++) {
				const id = b.readVarInt();
				const additive = (flags & 1) !== 0;
				if (intCh === 12) addCubeChannels(a, id, additive);
				else a.channels.push({ kind: 'vis', cube: id, frame: null });
			}
			break;
		}
		case 'CONTROL_INFO': st.blankId = b.u8(); st.resetId = b.u8(); st.profileId = b.readUTF() || null; break;
		case 'GESTURE_BUTTON': {
			const ty = BUTTON_TYPES[b.readEnum(BUTTON_TYPES.length)];
			if (!ty) throw new CPMError('Unknown gesture button type');
			const btn = makeButton(ty, {});
			btn.name = b.readUTF();
			const flags = b.u8();
			btn.layerCtrl = (flags & 1) !== 0; btn.command = (flags & 2) !== 0; btn.isProperty = (flags & 4) !== 0; btn.hidden = (flags & 16) !== 0;
			if (ty === 'POSE' || ty === 'GESTURE') {
				btn.id = b.u8(); if (btn.layerCtrl) btn.gid = b.u8();
				if (ty === 'GESTURE') btn.gestureTimeout = b.readVarInt();
				btn.parameter = ty === 'POSE' ? 0 : 1;
			} else if (ty === 'BOOL_PARAMETER_TOGGLE') { btn.parameter = b.readVarInt(); btn.mask = b.u8(); }
			else if (ty === 'VALUE_PARAMETER_SLIDER') { btn.parameter = b.readVarInt(); btn.maxValue = b.u8(); }
			else if (ty === 'DROPDOWN') {
				btn.parameter = b.readVarInt(); const n = b.i8(); btn.opts = [];
				for (let i = 0; i < n; i++) btn.opts.push(b.readUTF());
			}
			st.buttons.push(btn);
			break;
		}
		case 'PARAMETERS': {
			const sync = b.readByteArray(), local = b.readByteArray();
			st.params = new ParameterDetails(new Int8Array(sync.buffer, sync.byteOffset, sync.length).slice(), new Int8Array(local.buffer, local.byteOffset, local.length).slice());
			break;
		}
		case 'INIT_STAGED_ANIM': st.staged.push(b.readVarInt()); break;
		default: break;
	}
}

function compileAnimNew(a, def) {
	const an = new AnimationNew(a.priority, Math.max(1, a.duration));
	const groups = new Set();
	for (const ch of a.channels) {
		if (ch.kind === 'vis') {
			if (!ch.frame) continue;
			const cube = def.getElementById(ch.cube);
			if (!cube) continue;
			const fr = ch.frame.frames;
			if (ch.frame.kind === 'bool') an.handlers.push(t => cube.setVisible(!!fr[Math.floor(t * fr.length)]));
			else { const ip = makeInterpolator(ch.frame.it, fr, -1); an.handlers.push(t => cube.setVisible(ip(t * fr.length) > 0.5)); }
		} else if (ch.kind === 'f3' && !groups.has(ch.group)) {
			const g = ch.group;
			groups.add(g);
			if (!g.ch.some(c => c.frame)) continue;
			const cube = def.getElementById(g.cube);
			if (!cube) continue;
			const chBase = { pos: 0, rot: 3, color: 6, scale: 9 }[g.type];
			const getters = {
				pos: [() => g.additive ? 0 : cube.getPosition().x, () => g.additive ? 0 : cube.getPosition().y, () => g.additive ? 0 : cube.getPosition().z],
				rot: [() => g.additive ? 0 : cube.getRotation().x, () => g.additive ? 0 : cube.getRotation().y, () => g.additive ? 0 : cube.getRotation().z],
				color: [() => (cube.getRGB() >> 16) & 255, () => (cube.getRGB() >> 8) & 255, () => cube.getRGB() & 255],
				scale: [() => g.additive ? 0 : cube.getRenderScale().x, () => g.additive ? 0 : cube.getRenderScale().y, () => g.additive ? 0 : cube.getRenderScale().z],
			}[g.type];
			const drv = g.ch.map((c, i) => {
				if (!c.frame) return getters[i];
				const fr = c.frame.frames;
				if (c.frame.kind === 'bool') return (t) => fr[Math.floor(t * fr.length)] ? 1 : 0;
				const ip = makeInterpolator(c.frame.it, fr, chBase + i);
				return (t) => fr.length === 0 ? 0 : ip(t * fr.length);
			});
			const set = {
				pos: (x, y, z) => cube.setPosition(g.additive, x, y, z),
				rot: (x, y, z) => cube.setRotation(g.additive, x, y, z),
				color: (x, y, z) => cube.setColor(x, y, z),
				scale: (x, y, z) => cube.setRenderScale(g.additive, x, y, z),
			}[g.type];
			an.handlers.push(t => set(drv[0](t), drv[1](t), drv[2](t)));
		}
	}
	return an;
}

function triggerKey(t) {
	return [t.anim, t.stagingID, t.stage, t.parameter, t.value, t.bitMask, t.mustFinish, t.pose].join('|');
}

function describeTrigger(t, reg) {
	if (t.pose) return { label: t.pose, kind: 'pose' };
	if (t.stage) return { label: 'staged ' + t.stage.toLowerCase(), kind: 'staged' };
	const btn = reg.namedActions.find(b => {
		if (t.anim === 'CUSTOM_POSE') return b.type === 'POSE' && b.id === t.value;
		if (t.anim === 'GESTURE') return b.type === 'GESTURE' && b.id === t.value;
		if (t.anim === 'VALUE_LAYER') return b.type === 'VALUE_PARAMETER_SLIDER' && b.parameter === t.parameter;
		if (t.anim === 'LAYER') {
			if (b.type === 'BOOL_PARAMETER_TOGGLE') return b.parameter === t.parameter && b.mask === t.value;
			if (b.type === 'DROPDOWN') return b.parameter === t.parameter;
		}
		return false;
	});
	let label = btn ? btn.name : (t.anim || 'animation').toLowerCase();
	if (btn && btn.type === 'DROPDOWN') label = btn.name + ': ' + (btn.opts[t.value] || '#' + t.value);
	return { label, kind: (t.anim || '').toLowerCase().replace('_', ' ') };
}

function applyAnimationNew(st, def) {
	(def.exportNew || (def.exportNew = [])).push(st);
	const reg = def.reg;
	st.buttons.forEach(b => reg.registerButton(b));
	reg.blankGesture = st.blankId; reg.poseResetId = st.resetId; reg.profileId = st.profileId;
	if (st.params) reg.params = st.params;
	// group animations by trigger (Java uses SerializedTrigger.equals)
	const groups = new Map(); // key -> {trigger, list}
	const byId = (id) => st.triggers[id];
	const keyOf = (t) => triggerKey(t);
	for (const a of st.anims) {
		const tr = byId(a.triggerID);
		if (!tr) continue;
		const k = keyOf(tr);
		if (!groups.has(k)) groups.set(k, { tr, list: [] });
		const an = compileAnimNew(a, def);
		groups.get(k).list.push(an);
		reg.animInfo.set(an, describeTrigger(tr, reg));
	}
	st.staged.forEach((tId, i) => {
		const san = new StagedAnimation();
		for (const g of groups.values()) {
			if (g.tr.stagingID === i && g.tr.stage) {
				const trig = new AnimationTrigger(reg, ['GLOBAL'], g.tr.pose, g.list, g.tr.looping, g.tr.mustFinish);
				if (g.tr.stage === 'FINISH') san.addPostTrigger(trig);
				else if (g.tr.stage === 'PLAY') san.addPlayTrigger(trig);
				else san.addPreTrigger(trig);
			}
		}
		const tr = byId(tId);
		if (!tr) return;
		const k = keyOf(tr);
		if (!groups.has(k)) groups.set(k, { tr, list: [] });
		groups.get(k).list.push(...san.getAll());
		const main = describeTrigger(tr, reg);
		san.getAll().forEach(sp => reg.animInfo.set(sp, { label: main.label + ' (' + sp.stage.toLowerCase() + ')', kind: main.kind, stagePart: sp }));
	});
	for (const g of groups.values()) {
		const t = g.tr, list = g.list;
		let trig = null;
		switch (t.anim) {
			case 'CUSTOM_POSE': { const p = reg.getPoseById(t.value, null); if (p) trig = new AnimationTrigger(reg, [p], null, list, t.looping, t.mustFinish); break; }
			case 'POSE': trig = new AnimationTrigger(reg, [t.pose], t.pose, list, t.looping, t.mustFinish); break;
			case 'SETUP': case 'FINISH': break;
			case 'LAYER': trig = new LayerTrigger(reg, list, t.parameter, t.value, t.bitMask, t.mustFinish); break;
			case 'VALUE_LAYER': trig = new ValueTrigger(reg, list, t.parameter, t.parameterInterpolate); break;
			case 'GESTURE': trig = new GestureTrigger(reg, list, t.value, t.gid, t.looping, t.mustFinish); break;
			default: trig = new AnimationTrigger(reg, ['GLOBAL'], t.pose, list, t.looping, t.mustFinish); break;
		}
		if (trig) reg.register(trig);
	}
}
