// ---------------------------------------------------------------------------
// GLB export: the current model as a glTF binary, with animations baked from
// the same engine the viewer uses (one clip per state, sampled per frame).
//
// Two rigs:
// - 'armature' (default): a skeleton with one bone per body part and cube.
//   All geometry is merged into skinned meshes (one per material), each vertex
//   weighted fully to the bone it belongs to. Bones carry no rest scale, so the
//   armature imports cleanly into Blender and game engines.
// - 'nodes': the viewer's scene graph as plain nodes, each animated directly.
//
// Visibility changes are baked as scale 0, since glTF has no visibility track.
// ---------------------------------------------------------------------------
'use strict';

const GLTF_FPS = 20;

function gltfNamer() {
	const used = new Set();
	return (base) => {
		const n = THREE.PropertyBinding.sanitizeNodeName(String(base || 'node')).replace(/[.\s]+/g, '_') || 'node';
		let name = n, i = 2;
		while (used.has(name)) name = n + '_' + (i++);
		used.add(name);
		return name;
	};
}

// Runs the viewer's animation engine for export clips.
function gltfSampler(viewer, def) {
	const poseGroup = viewer.poseGroup;
	const run = (clip, t, driver) => {
		const vp = driver.update(clip.vs, t);
		viewer.sync(vp, clip.vs);
		// the pose group is driven by a matrix; export needs it as TRS
		poseGroup.matrix.decompose(poseGroup.position, poseGroup.quaternion, poseGroup.scale);
		viewer.entity.updateMatrixWorld(true);
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
	const durationOf = (clip, driver) => {
		if (clip.duration) return clip.duration;
		let dur = 0;
		for (const a of driver.handler.current) {
			const d = a.anim.getDuration();
			if (d > 0 && d < 60000 && d !== DYNAMIC_DURATION_DIV) dur = Math.max(dur, d);
		}
		if (!dur) dur = 2000;
		if (['WALKING', 'RUNNING', 'SNEAK_WALK', 'SWIMMING', 'CRAWLING', 'JUMPING', 'DYING'].includes(clip.vs.movement)) dur = Math.max(dur, 3000);
		return Math.min(dur, 10000);
	};
	// Samples the rest state and every clip with `capture()`.
	const bake = (clips, restClip, restTime, capture) => {
		run(restClip, restTime, newDriver(restClip));
		const rest = capture();
		const baked = clips.map(clip => {
			const driver = newDriver(clip);
			run(clip, 0, driver);
			const dur = durationOf(clip, driver);
			const frames = Math.max(1, Math.round(dur / 1000 * GLTF_FPS));
			const times = [], samples = [];
			for (let f = 0; f <= frames; f++) {
				const t = f * dur / frames;
				run(clip, t, driver);
				times.push(t / 1000);
				samples.push(capture());
			}
			return { name: clip.name, dur, times, samples };
		});
		// leave the scene (positions, vertex colours) in the rest state
		run(restClip, restTime, newDriver(restClip));
		return { rest, baked };
	};
	return { bake };
}

// clips: [{name, vs, buttons?, gestureData?, duration?}]
// opts: {rest: clip with optional .time (still export), rig: 'armature' | 'nodes'}
async function exportGLB(viewer, def, clips, opts = {}) {
	const poseGroup = viewer.poseGroup;
	poseGroup.matrixAutoUpdate = true;
	try {
		const restClip = opts.rest || { vs: Object.assign(defaultViewState(), { flags: {} }) };
		const restTime = opts.rest ? (opts.rest.time || 0) : 0;
		const { root, animations } = opts.rig === 'nodes'
			? gltfBuildNodes(viewer, def, clips, restClip, restTime)
			: gltfBuildArmature(viewer, def, clips, restClip, restTime);
		const exporter = new THREE.GLTFExporter();
		const result = await new Promise((resolve, reject) => {
			exporter.parse(root, resolve, reject, { binary: true, animations, onlyVisible: false, trs: true });
		});
		return new Uint8Array(result);
	} finally {
		poseGroup.matrixAutoUpdate = false;
	}
}

const gltfSame = (a, b) => a.every((v, k) => Math.abs(v - b[k]) < 1e-5);
// keep quaternions on one hemisphere so interpolation does not flip
function gltfUnflip(vals) {
	for (let k = 1; k < vals.length; k++) {
		const a = vals[k - 1], b = vals[k];
		if (a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3] < 0) vals[k] = b.map(x => -x);
	}
	return vals;
}
// one TRS track per changed channel; `get(sample)` returns {p, q, s}, `restTrs` the node's default
function gltfTracks(name, times, samples, get, restTrs, out) {
	const trs = samples.map(get);
	for (const [key, Type, prop] of [['p', THREE.VectorKeyframeTrack, 'position'], ['q', THREE.QuaternionKeyframeTrack, 'quaternion'], ['s', THREE.VectorKeyframeTrack, 'scale']]) {
		let vals = trs.map(t => t[key]);
		if (vals.every(v => gltfSame(v, restTrs[key]))) continue;
		if (key === 'q') vals = gltfUnflip(vals);
		out.push(new Type(name + '.' + prop, times, vals.flat()));
	}
}

// Viewer materials -> glTF friendly MeshStandardMaterial (glow as emissive)
function gltfMaterials(viewer) {
	const sheetOf = new Map();
	for (const k in viewer.textures) { const t = viewer.textures[k]; sheetOf.set(t.mat, { name: k, t, glow: false }); sheetOf.set(t.glow, { name: k, t, glow: true }); }
	const matCache = new Map();
	const exportMat = (src) => {
		if (matCache.has(src)) return matCache.get(src);
		const sh = sheetOf.get(src);
		const glow = sh ? sh.glow : src.type === 'MeshBasicMaterial';
		const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, side: THREE.DoubleSide });
		if (sh) {
			m.map = sh.t.tex;
			if (sh.t.partial) m.transparent = true; else m.alphaTest = 0.1;
		}
		if (glow) { m.emissive = new THREE.Color(1, 1, 1); if (sh) m.emissiveMap = sh.t.tex; }
		m.name = (sh ? sh.name.toLowerCase() : 'color') + (glow ? '_glow' : '');
		matCache.set(src, m);
		return m;
	};

	return exportMat;
}

// ---------------------------------------------------------------------------
// Armature rig
// ---------------------------------------------------------------------------
function gltfBuildArmature(viewer, def, clips, restClip, restTime) {
	const px = viewer.pxGroup; // root of all body parts, pixel units
	// collect bone candidates (groups) and meshes under the pixel group
	const nodes = [], meshes = [];
	const walk = (obj, parent) => {
		for (const child of obj.children) {
			if (child.isMesh) meshes.push({ mesh: child, node: parent });
			else { const i = nodes.length; nodes.push({ obj: child, parent }); walk(child, i); }
		}
	};
	walk(px, -1);

	const v3a = (v) => [v.x, v.y, v.z];
	const tmp = { p: new THREE.Vector3(), q: new THREE.Quaternion(), s: new THREE.Vector3() };
	const capture = () => {
		px.matrixWorld.decompose(tmp.p, tmp.q, tmp.s);
		const eff = [];
		return {
			body: { p: tmp.p.toArray(), q: tmp.q.toArray(), s: tmp.s.toArray() },
			nodes: nodes.map((n, i) => {
				const o = n.obj;
				eff[i] = o.visible && (n.parent < 0 || eff[n.parent]);
				return { p: v3a(o.position), q: o.quaternion.toArray(), s: v3a(o.scale), v: o.visible };
			}),
			meshes: meshes.map(m => ({ v: m.mesh.visible, eff: m.mesh.visible && (m.node < 0 || eff[m.node]) })),
		};
	};
	const { bake } = gltfSampler(viewer, def);
	const { rest, baked } = bake(clips, restClip, restTime, capture);

	// which meshes ever show, and which need their own bone for visibility
	const sets = baked.length ? baked.flatMap(b => b.samples) : [rest];
	const include = meshes.map((m, i) => sets.some(s => s.meshes[i].eff));
	const ownBone = meshes.map((m, i) => include[i] && sets.some(s => !s.meshes[i].v));
	const keep = nodes.map(() => false);
	meshes.forEach((m, i) => { if (!include[i]) return; for (let n = m.node; n >= 0 && !keep[n]; n = nodes[n].parent) keep[n] = true; });

	// uniform rest scale of every bone's world matrix; bones store everything relative to it,
	// so the bind pose carries no scale
	const avg = (s) => (Math.abs(s[0]) + Math.abs(s[1]) + Math.abs(s[2])) / 3 || 1;
	const kBody = avg(rest.body.s);
	const kNode = [];
	nodes.forEach((n, i) => { kNode[i] = (n.parent < 0 ? kBody : kNode[n.parent]) * avg(rest.nodes[i].s); });
	const kParent = (i) => nodes[i].parent < 0 ? kBody : kNode[nodes[i].parent];

	const bodyTrs = (s) => ({ p: s.body.p, q: s.body.q, s: s.body.s.map(x => x / kBody) });
	const nodeTrs = (s, i, withVis) => {
		const n = s.nodes[i], kp = kParent(i);
		const vis = !withVis || n.v;
		return { p: n.p.map(x => x * kp), q: n.q, s: vis ? n.s.map(x => x * kp / kNode[i]) : [0, 0, 0] };
	};
	const meshTrs = (s, i) => ({ p: [0, 0, 0], q: [0, 0, 0, 1], s: s.meshes[i].v ? [1, 1, 1] : [0, 0, 0] });
	const apply = (b, t) => { b.position.fromArray(t.p); b.quaternion.fromArray(t.q); b.scale.fromArray(t.s); };

	// bones
	const name = gltfNamer();
	const bones = [];
	const mkBone = (n, parent) => { const b = new THREE.Bone(); b.name = name(n); if (parent) parent.add(b); bones.push(b); return b; };
	const rootBone = mkBone('Root', null);
	const bodyBone = mkBone('Model', rootBone);
	apply(bodyBone, bodyTrs(rest));
	const nodeBone = [];
	nodes.forEach((n, i) => {
		if (!keep[i]) return;
		const b = mkBone(n.obj.userData.cpmName || 'part', n.parent < 0 ? bodyBone : nodeBone[n.parent]);
		apply(b, nodeTrs(rest, i, false));
		nodeBone[i] = b;
	});
	const meshBone = [];
	meshes.forEach((m, i) => {
		if (!ownBone[i]) return;
		meshBone[i] = mkBone(m.mesh.userData.cpmName || 'mesh', m.node < 0 ? bodyBone : nodeBone[m.node]);
	});

	// skinned meshes must be scene roots (glTF ignores their parents' transforms)
	rootBone.updateMatrixWorld(true);
	const roots = [rootBone];
	const skeleton = new THREE.Skeleton(bones); // inverse bind matrices from the rest pose

	const exportMat = gltfMaterials(viewer);
	// merge geometry per material, baked into the rest pose
	const buckets = new Map();
	const nm = new THREE.Matrix3();
	const v = new THREE.Vector3();
	meshes.forEach((m, i) => {
		if (!include[i]) return;
		const mat = exportMat(m.mesh.material);
		if (!buckets.has(mat)) buckets.set(mat, { pos: [], nor: [], uv: [], col: [], idx: [], ji: [], jw: [], n: 0 });
		const B = buckets.get(mat);
		const g = m.mesh.geometry, P = g.getAttribute('position'), N = g.getAttribute('normal'), U = g.getAttribute('uv'), C = g.getAttribute('color');
		const world = m.mesh.matrixWorld;
		nm.getNormalMatrix(world);
		const bone = meshBone[i] || (m.node < 0 ? bodyBone : nodeBone[m.node]);
		const bi = bones.indexOf(bone);
		for (let k = 0; k < P.count; k++) {
			v.fromBufferAttribute(P, k).applyMatrix4(world); B.pos.push(v.x, v.y, v.z);
			v.fromBufferAttribute(N, k).applyMatrix3(nm).normalize(); B.nor.push(v.x, v.y, v.z);
			B.uv.push(U.getX(k), U.getY(k));
			B.col.push(C ? C.getX(k) : 1, C ? C.getY(k) : 1, C ? C.getZ(k) : 1);
			B.ji.push(bi, 0, 0, 0); B.jw.push(1, 0, 0, 0);
		}
		const I = g.getIndex();
		for (let k = 0; k < I.count; k++) B.idx.push(I.getX(k) + B.n);
		B.n += P.count;
	});
	for (const [mat, B] of buckets) {
		const g = new THREE.BufferGeometry();
		g.setAttribute('position', new THREE.Float32BufferAttribute(B.pos, 3));
		g.setAttribute('normal', new THREE.Float32BufferAttribute(B.nor, 3));
		g.setAttribute('uv', new THREE.Float32BufferAttribute(B.uv, 2));
		g.setAttribute('color', new THREE.Float32BufferAttribute(B.col, 3));
		g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(B.ji, 4));
		g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(B.jw, 4));
		g.setIndex(B.n > 65535 ? new THREE.Uint32BufferAttribute(B.idx, 1) : new THREE.Uint16BufferAttribute(B.idx, 1));
		const sm = new THREE.SkinnedMesh(g, mat);
		sm.name = name('mesh_' + mat.name);
		sm.updateMatrixWorld(true);
		sm.bind(skeleton);
		roots.push(sm);
	}

	// default pose (no clip playing) shows the rest state with its visibility
	nodes.forEach((n, i) => { if (nodeBone[i]) apply(nodeBone[i], nodeTrs(rest, i, true)); });
	meshes.forEach((m, i) => { if (meshBone[i]) apply(meshBone[i], meshTrs(rest, i)); });

	// animation clips on the bones, relative to the default pose
	const animations = baked.map(b => {
		const tracks = [];
		gltfTracks(bodyBone.name, b.times, b.samples, bodyTrs, bodyTrs(rest), tracks);
		nodes.forEach((n, i) => { if (nodeBone[i]) gltfTracks(nodeBone[i].name, b.times, b.samples, s => nodeTrs(s, i, true), nodeTrs(rest, i, true), tracks); });
		meshes.forEach((m, i) => { if (meshBone[i]) gltfTracks(meshBone[i].name, b.times, b.samples, s => meshTrs(s, i), meshTrs(rest, i), tracks); });
		return new THREE.AnimationClip(b.name, b.dur / 1000, tracks);
	});
	return { root: roots, animations }; // animations are looked up under roots[0]
}

// ---------------------------------------------------------------------------
// Node hierarchy rig (no skinning)
// ---------------------------------------------------------------------------
function gltfBuildNodes(viewer, def, clips, restClip, restTime) {
	const entity = viewer.entity;
	const nodes = [];
	entity.traverse(o => { if (o !== entity && !(o.isMesh && o.parent && o.parent.isMesh)) nodes.push(o); });
	const capture = () => nodes.map(o => ({ p: o.position.toArray(), q: o.quaternion.toArray(), s: o.visible ? o.scale.toArray() : [0, 0, 0] }));
	const { bake } = gltfSampler(viewer, def);
	const { rest, baked } = bake(clips, restClip, restTime, capture);

	// copy the scene so the live view is untouched
	const name = gltfNamer();
	const exportMat = gltfMaterials(viewer);
	const copyOf = new Map();
	const root = new THREE.Group();
	root.name = name('CPM_Model');
	copyOf.set(entity, root);
	nodes.forEach((o, i) => {
		const c = o.isMesh ? new THREE.Mesh(o.geometry, exportMat(o.material)) : new THREE.Group();
		c.name = name(o.userData.cpmName || (o.isMesh ? 'mesh' : 'node'));
		c.position.fromArray(rest[i].p); c.quaternion.fromArray(rest[i].q); c.scale.fromArray(rest[i].s);
		copyOf.get(o.parent).add(c);
		copyOf.set(o, c);
	});
	const animations = baked.map(b => {
		const tracks = [];
		nodes.forEach((o, i) => gltfTracks(copyOf.get(o).name, b.times, b.samples, s => s[i], rest[i], tracks));
		return new THREE.AnimationClip(b.name, b.dur / 1000, tracks);
	});
	return { root, animations };
}

// ---------------------------------------------------------------------------
// Clip lists for the export menu
// ---------------------------------------------------------------------------
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
