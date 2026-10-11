// ---------------------------------------------------------------------------
// GLB export: the current model as a glTF binary, with animations baked from
// the same engine the viewer uses (one clip per state, sampled per frame).
// Visibility changes are baked as scale 0, since glTF has no visibility track.
// ---------------------------------------------------------------------------
'use strict';

const GLTF_FPS = 20;

function gltfNodeName(obj, i) {
	const base = obj.userData.cpmName || obj.type.toLowerCase();
	return THREE.PropertyBinding.sanitizeNodeName(base).replace(/\./g, '_') + '_' + i;
}

// clips: [{name, vs, buttons:[button objects], duration?}]
async function exportGLB(viewer, def, clips, opts = {}) {
	const entity = viewer.entity;
	const poseGroup = viewer.poseGroup;
	const nodes = [];
	entity.traverse(o => { if (o !== entity) nodes.push(o); });
	const savedNames = nodes.map(o => o.name);
	const savedVisible = nodes.map(o => o.visible);
	nodes.forEach((o, i) => { o.name = gltfNodeName(o, i); });
	poseGroup.matrixAutoUpdate = true;

	const step = () => { poseGroup.matrix.decompose(poseGroup.position, poseGroup.quaternion, poseGroup.scale); };
	const capture = () => nodes.map(o => {
		const vis = o.visible;
		return { p: o.position.toArray(), q: o.quaternion.toArray(), s: vis ? o.scale.toArray() : [0, 0, 0] };
	});
	const runState = (clip, t, driver) => {
		const vp = driver.update(clip.vs, t);
		viewer.sync(vp, clip.vs);
		step();
	};
	const newDriver = (clip) => {
		const d = new AnimationDriver(def);
		for (const b of (clip.buttons || [])) {
			if (b.type === 'VALUE_PARAMETER_SLIDER') d.setSlider(b, b._exportValue != null ? b._exportValue : b.maxValue);
			else if (b.type === 'DROPDOWN' || b.type === 'LEGACY_DROPDOWN') d.setDropdown(b, b._exportValue);
			else d.activateButton(b, 0);
		}
		if (clip.gestureData) d.gestureData.set(clip.gestureData.subarray(0, d.gestureData.length));
		return d;
	};

	try {
		// rest pose: the given state (still export) or standing with no controls
		const restClip = opts.rest || { vs: Object.assign(defaultViewState(), { flags: {} }) };
		runState(restClip, opts.rest ? (opts.rest.time || 0) : 0, newDriver(restClip));
		const rest = capture();

		const animations = [];
		for (const clip of clips) {
			const driver = newDriver(clip);
			runState(clip, 0, driver);
			let dur = clip.duration;
			if (!dur) {
				dur = 0;
				for (const a of driver.handler.current) {
					const d = a.anim.getDuration();
					if (d > 0 && d < 60000 && d !== DYNAMIC_DURATION_DIV) dur = Math.max(dur, d);
				}
				if (!dur) dur = 2000;
				const mv = clip.vs.movement;
				if (['WALKING', 'RUNNING', 'SNEAK_WALK', 'SWIMMING', 'CRAWLING', 'JUMPING', 'DYING'].includes(mv)) dur = Math.max(dur, 3000);
				dur = Math.min(dur, 10000);
			}
			const times = [], samples = [];
			const frames = Math.max(1, Math.round(dur / 1000 * GLTF_FPS));
			for (let f = 0; f <= frames; f++) {
				const t = f * dur / frames;
				runState(clip, t, driver);
				times.push(t / 1000);
				samples.push(capture());
			}
			const tracks = [];
			const same = (a, b) => a.every((v, k) => Math.abs(v - b[k]) < 1e-5);
			nodes.forEach((o, i) => {
				for (const [key, type, prop] of [['p', THREE.VectorKeyframeTrack, 'position'], ['q', THREE.QuaternionKeyframeTrack, 'quaternion'], ['s', THREE.VectorKeyframeTrack, 'scale']]) {
					const vals = samples.map(s => s[i][key]);
					if (vals.every(v => same(v, rest[i][key]))) continue;
					// keep quaternions on one hemisphere so interpolation does not flip
					if (key === 'q') for (let k = 1; k < vals.length; k++) { const a = vals[k - 1], b = vals[k]; if (a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3] < 0) vals[k] = b.map(x => -x); }
					tracks.push(new type(o.name + '.' + prop, times, vals.flat()));
				}
			});
			animations.push(new THREE.AnimationClip(clip.name, dur / 1000, tracks));
		}

		// put the scene in the rest pose, visibility baked into scale
		nodes.forEach((o, i) => {
			o.position.fromArray(rest[i].p); o.quaternion.fromArray(rest[i].q); o.scale.fromArray(rest[i].s);
			o.visible = true;
		});
		entity.updateMatrixWorld(true);
		const exporter = new THREE.GLTFExporter();
		const result = await new Promise((resolve, reject) => {
			exporter.parse(entity, resolve, reject, { binary: true, animations, onlyVisible: false, trs: true });
		});
		return new Uint8Array(result);
	} finally {
		nodes.forEach((o, i) => { o.name = savedNames[i]; o.visible = savedVisible[i]; });
		poseGroup.matrixAutoUpdate = false;
	}
}

// Clip lists for the export menu
function gltfClipCurrent(vs, driver, label) {
	return { name: label || 'Current', vs: JSON.parse(JSON.stringify(vs)), gestureData: Int8Array.from(driver.gestureData) };
}

function gltfClipsAll(def) {
	const clips = [];
	const base = () => Object.assign(defaultViewState(), { flags: {} });
	for (const m of MOVEMENTS) {
		if (m.id !== 'STANDING' && m.id !== 'WALKING' && !def.reg.hasPoseAnimations(m.id)) continue;
		clips.push({ name: m.label, vs: Object.assign(base(), { movement: m.id }) });
	}
	for (const b of def.reg.namedActions) {
		if (b.type === 'POSE' || b.type === 'GESTURE' || b.type === 'BOOL_PARAMETER_TOGGLE') {
			clips.push({ name: (b.type === 'POSE' ? 'Pose ' : b.type === 'GESTURE' ? 'Gesture ' : 'Toggle ') + b.name, vs: base(), buttons: [b] });
		} else if (b.type === 'VALUE_PARAMETER_SLIDER') {
			clips.push({ name: 'Slider ' + b.name, vs: base(), buttons: [Object.assign(Object.create(b), { _exportValue: b.maxValue || 255 })] });
		} else if (b.type === 'DROPDOWN' || b.type === 'LEGACY_DROPDOWN') {
			const opts = b.type === 'DROPDOWN' ? b.opts : [...b.params.keys()];
			for (const o of opts) if (o) clips.push({ name: b.name + ' ' + o, vs: base(), buttons: [Object.assign(Object.create(b), { _exportValue: o })] });
		}
	}
	return clips;
}
