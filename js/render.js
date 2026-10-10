// ---------------------------------------------------------------------------
// three.js renderer (BoxRender + ModelRenderManager port)
// ---------------------------------------------------------------------------
'use strict';

// ---- mesh builders: return arrays of quads {p:[[x,y,z]x4], uv:[[u,v]x4], n:[x,y,z]} in pixel units, uv normalized
function quadUV(verts, u1, v1, u2, v2, tw, th, mirror, normal) {
	const uv = [[u2 / tw, v1 / th], [u1 / tw, v1 / th], [u1 / tw, v2 / th], [u2 / tw, v2 / th]];
	return { p: verts, uv, n: mirror ? [-normal[0], normal[1], normal[2]] : normal };
}
function quadFace(verts, f, tw, th, normal) {
	const uv = [];
	for (let i = 0; i < 4; i++) {
		const r = (i + f.rot + 3) % 4;
		const u = (r !== 0 && r !== 1) ? f.ex : f.sx;
		const v = (r !== 0 && r !== 3) ? f.ey : f.sy;
		uv.push([u / tw, v / th]);
	}
	return { p: verts, uv, n: normal };
}
const NX = [-1, 0, 0], PX = [1, 0, 0], NY = [0, -1, 0], PY = [0, 1, 0], NZ = [0, 0, -1], PZ = [0, 0, 1];

function boxCorners(x, y, z, ex, ey, ez) {
	return {
		v7: [x, y, z], v0: [ex, y, z], v1: [ex, ey, z], v2: [x, ey, z],
		v3: [x, y, ez], v4: [ex, y, ez], v5: [ex, ey, ez], v6: [x, ey, ez],
	};
}

function createTextured(pos, size, sc, delta, texU, texV, texSize, tw, th) {
	let x = pos.x, y = pos.y, z = pos.z;
	const w = size.x, h = size.y, d = size.z;
	const ts = Math.abs(texSize);
	const dx = Math.ceil(w * ts), dy = Math.ceil(h * ts), dz = Math.ceil(d * ts);
	let ex = x + w * sc.x, ey = y + h * sc.y, ez = z + d * sc.z;
	x -= delta; y -= delta; z -= delta; ex += delta; ey += delta; ez += delta;
	texU *= ts; texV *= ts;
	if (texSize < 0) { const s = ex; ex = x; x = s; }
	const c = boxCorners(x, y, z, ex, ey, ez);
	const m = texSize < 0;
	const f4 = texU, f5 = texU + dz, f6 = texU + dz + dx, f7 = texU + dz + dx + dx, f8 = texU + dz + dx + dz, f9 = texU + dz + dx + dz + dx;
	const f10 = texV, f11 = texV + dz, f12 = texV + dz + dy;
	return [
		quadUV([c.v4, c.v0, c.v1, c.v5], f6, f11, f8, f12, tw, th, m, PX),
		quadUV([c.v7, c.v3, c.v6, c.v2], f4, f11, f5, f12, tw, th, m, NX),
		quadUV([c.v4, c.v3, c.v7, c.v0], f5, f10, f6, f11, tw, th, m, NY),
		quadUV([c.v1, c.v2, c.v6, c.v5], f6, f11, f7, f10, tw, th, m, PY),
		quadUV([c.v0, c.v7, c.v2, c.v1], f5, f11, f6, f12, tw, th, m, NZ),
		quadUV([c.v3, c.v4, c.v5, c.v6], f8, f11, f9, f12, tw, th, m, PZ),
	];
}

function createTexturedSingle(pos, size, sc, delta, texU, texV, texSize, tw, th) {
	let x = pos.x, y = pos.y, z = pos.z;
	const w = size.x, h = size.y, d = size.z;
	const ts = Math.abs(texSize);
	const dx = Math.ceil(w * ts), dy = Math.ceil(h * ts), dz = Math.ceil(d * ts);
	let ex = x + w * sc.x, ey = y + h * sc.y, ez = z + d * sc.z;
	x -= delta; y -= delta; z -= delta; ex += delta; ey += delta; ez += delta;
	texU *= ts; texV *= ts;
	if (texSize < 0) { const s = ex; ex = x; x = s; }
	const m = texSize < 0;
	if (ex === x || ey === y || ez === z) {
		if (ex === x) {
			ex += 0.001; const c = boxCorners(x, y, z, ex, ey, ez);
			const tu = texU + dz, tv = texV + dy;
			return [quadUV([c.v4, c.v0, c.v1, c.v5], tu, texV, texU, tv, tw, th, m, PX), quadUV([c.v7, c.v3, c.v6, c.v2], texU, texV, tu, tv, tw, th, m, NX)];
		} else if (ey === y) {
			ey += 0.001; const c = boxCorners(x, y, z, ex, ey, ez);
			const tu = texU + dx, tv = texV + dz;
			return [quadUV([c.v4, c.v3, c.v7, c.v0], texU, texV, tu, tv, tw, th, m, NY), quadUV([c.v1, c.v2, c.v6, c.v5], tu, texV, texU, tv, tw, th, m, PY)];
		} else {
			ez += 0.001; const c = boxCorners(x, y, z, ex, ey, ez);
			const tu = texU + dx, tv = texV + dy;
			return [quadUV([c.v0, c.v7, c.v2, c.v1], texU, texV, tu, tv, tw, th, m, NZ), quadUV([c.v3, c.v4, c.v5, c.v6], tu, texV, texU, tv, tw, th, m, PZ)];
		}
	}
	const c = boxCorners(x, y, z, ex, ey, ez);
	const txS = Math.max(dx, dy, dz);
	const tu = texU + txS, tv = texV + txS;
	return [
		quadUV([c.v4, c.v0, c.v1, c.v5], texU, texV, tu, tv, tw, th, m, PX),
		quadUV([c.v7, c.v3, c.v6, c.v2], texU, texV, tu, tv, tw, th, m, NX),
		quadUV([c.v4, c.v3, c.v7, c.v0], texU, texV, tu, tv, tw, th, m, NY),
		quadUV([c.v1, c.v2, c.v6, c.v5], texU, texV, tu, tv, tw, th, m, PY),
		quadUV([c.v0, c.v7, c.v2, c.v1], texU, texV, tu, tv, tw, th, m, NZ),
		quadUV([c.v3, c.v4, c.v5, c.v6], texU, texV, tu, tv, tw, th, m, PZ),
	];
}

function createTexturedFaces(pos, size, sc, delta, faces, tw, th) {
	let x = pos.x, y = pos.y, z = pos.z;
	let ex = x + size.x * sc.x, ey = y + size.y * sc.y, ez = z + size.z * sc.z;
	x -= delta; y -= delta; z -= delta; ex += delta; ey += delta; ez += delta;
	const c = boxCorners(x, y, z, ex, ey, ez);
	const q = [];
	if (faces.EAST) q.push(quadFace([c.v4, c.v0, c.v1, c.v5], faces.EAST, tw, th, PX));
	if (faces.WEST) q.push(quadFace([c.v7, c.v3, c.v6, c.v2], faces.WEST, tw, th, NX));
	if (faces.UP) q.push(quadFace([c.v4, c.v3, c.v7, c.v0], faces.UP, tw, th, NY));
	if (faces.DOWN) q.push(quadFace([c.v1, c.v2, c.v6, c.v5], faces.DOWN, tw, th, PY));
	if (faces.NORTH) q.push(quadFace([c.v0, c.v7, c.v2, c.v1], faces.NORTH, tw, th, NZ));
	if (faces.SOUTH) q.push(quadFace([c.v3, c.v4, c.v5, c.v6], faces.SOUTH, tw, th, PZ));
	return q;
}

function createColored(x, y, z, w, h, d, delta) {
	let ex = x + w, ey = y + h, ez = z + d;
	x -= delta; y -= delta; z -= delta; ex += delta; ey += delta; ez += delta;
	const c = boxCorners(x, y, z, ex, ey, ez);
	const u = [[0, 0], [0, 0], [0, 0], [0, 0]];
	return [
		{ p: [c.v4, c.v0, c.v1, c.v5], uv: u, n: PX }, { p: [c.v7, c.v3, c.v6, c.v2], uv: u, n: NX },
		{ p: [c.v4, c.v3, c.v7, c.v0], uv: u, n: NY }, { p: [c.v1, c.v2, c.v6, c.v5], uv: u, n: PY },
		{ p: [c.v0, c.v7, c.v2, c.v1], uv: u, n: NZ }, { p: [c.v3, c.v4, c.v5, c.v6], uv: u, n: PZ },
	];
}

function createTexturedExtruded(pos, size, sc, delta, texU, texV, texSize, tw, th) {
	let x = pos.x, y = pos.y, z = pos.z;
	let w = size.x, h = size.y, d = size.z;
	const ts = Math.abs(texSize);
	const dx = Math.ceil(w * ts), dy = Math.ceil(h * ts);
	x -= delta; y -= delta; z -= delta;
	w = w * sc.x + delta * 2; h = h * sc.y + delta * 2; d = d * sc.z + delta * 2;
	texU *= ts; texV *= ts;
	// matrix: translate + scale (pixel units, BoxRender works in /16 then we undo)
	let T, S;
	if (texSize < 0) { T = [x, y + h, z]; S = [w, -h, -d]; }
	else { T = [x + w, y + h, z + d]; S = [-w, -h, d]; }
	const minU = texU / tw, minV = texV / th, maxU = (texU + dx) / tw, maxV = (texV + dy) / th;
	const quads = [];
	const tr = (p) => [T[0] + p[0] * S[0], T[1] + p[1] * S[1], T[2] + p[2] * S[2]];
	const tn = (n) => { const v = [n[0] / S[0], n[1] / S[1], n[2] / S[2]]; const l = Math.hypot(...v) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
	const Q = (pts, uvs, n) => quads.push({ p: pts.map(tr), uv: uvs, n: tn(n) });
	Q([[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]], [[maxU, maxV], [minU, maxV], [minU, minV], [maxU, minV]], [0, 0, 1]);
	Q([[0, 1, -1], [1, 1, -1], [1, 0, -1], [0, 0, -1]], [[maxU, minV], [minU, minV], [minU, maxV], [maxU, maxV]], [0, 0, -1]);
	const f5 = 0.5 * (maxU - minU) / Math.max(1, dx), f6 = 0.5 * (maxV - minV) / Math.max(1, dy);
	for (let k = 0; k < dx; k++) {
		const f7 = k / dx, f8 = maxU + (minU - maxU) * f7 - f5;
		Q([[f7, 0, -1], [f7, 0, 0], [f7, 1, 0], [f7, 1, -1]], [[f8, maxV], [f8, maxV], [f8, minV], [f8, minV]], [-1, 0, 0]);
		const f9 = f7 + 1 / dx;
		Q([[f9, 1, -1], [f9, 1, 0], [f9, 0, 0], [f9, 0, -1]], [[f8, minV], [f8, minV], [f8, maxV], [f8, maxV]], [1, 0, 0]);
	}
	for (let k = 0; k < dy; k++) {
		const f7 = k / dy, f8 = maxV + (minV - maxV) * f7 - f6, f9 = f7 + 1 / dy;
		Q([[0, f9, 0], [1, f9, 0], [1, f9, -1], [0, f9, -1]], [[maxU, f8], [minU, f8], [minU, f8], [maxU, f8]], [0, 1, 0]);
		Q([[1, f7, 0], [0, f7, 0], [0, f7, -1], [1, f7, -1]], [[minU, f8], [maxU, f8], [maxU, f8], [minU, f8]], [0, -1, 0]);
	}
	return quads;
}

function quadsToGeometry(quads) {
	const n = quads.length;
	const pos = new Float32Array(n * 12), uv = new Float32Array(n * 8), nor = new Float32Array(n * 12), col = new Float32Array(n * 12).fill(1);
	const idx = new Uint32Array(n * 6);
	quads.forEach((q, i) => {
		for (let j = 0; j < 4; j++) {
			pos.set(q.p[j], i * 12 + j * 3);
			uv.set(q.uv[j], i * 8 + j * 2);
			nor.set(q.n, i * 12 + j * 3);
		}
		idx.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6);
	});
	const g = new THREE.BufferGeometry();
	g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
	g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
	g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
	g.setAttribute('color', new THREE.BufferAttribute(col, 3));
	g.setIndex(new THREE.BufferAttribute(idx, 1));
	return g;
}

function cubeQuads(rc, tw, th) {
	const c = rc.cube;
	if (rc.itemRenderer) return null;
	if (c.size.x === 0 && c.size.y === 0 && c.size.z === 0 && c.mcScale === 0) return null;
	if (c.texSize === 0) return { quads: createColored(c.offset.x, c.offset.y, c.offset.z, c.size.x * c.meshScale.x, c.size.y * c.meshScale.y, c.size.z * c.meshScale.z, c.mcScale), colored: true };
	if (rc.singleTex) return { quads: createTexturedSingle(c.offset, c.size, c.meshScale, c.mcScale, c.u, c.v, c.texSize, tw, th) };
	if (rc.extrude) return { quads: createTexturedExtruded(c.offset, c.size, c.meshScale, c.mcScale, c.u, c.v, c.texSize, tw, th) };
	if (rc.faceUVs) return { quads: createTexturedFaces(c.offset, c.size, c.meshScale, c.mcScale, rc.faceUVs, tw, th) };
	return { quads: createTextured(c.offset, c.size, c.meshScale, c.mcScale, c.u, c.v, c.texSize, tw, th) };
}

// ---------------------------------------------------------------------------
class Viewer {
	constructor(container) {
		this.container = container;
		const r = this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
		r.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
		r.outputEncoding = THREE.sRGBEncoding;
		container.appendChild(r.domElement);
		this.scene = new THREE.Scene();
		this.camera = new THREE.PerspectiveCamera(40, 1, 0.05, 200);
		this.camera.position.set(2.6, 1.9, 3.6);
		this.controls = new THREE.OrbitControls(this.camera, r.domElement);
		this.controls.target.set(0, 1.0, 0);
		this.controls.enableDamping = true;
		this.controls.dampingFactor = 0.12;
		this.controls.minDistance = 0.6; this.controls.maxDistance = 30;
		this.controls.update();
		this.scene.add(new THREE.AmbientLight(0xffffff, 0.62));
		const l1 = new THREE.DirectionalLight(0xffffff, 0.42); l1.position.set(0.2, 1, 0.7); this.scene.add(l1);
		const l2 = new THREE.DirectionalLight(0xffffff, 0.3); l2.position.set(-0.2, 0.6, -0.7); this.scene.add(l2);
		this.floor = this.makeFloor();
		this.scene.add(this.floor);
		this.entity = new THREE.Group();
		this.scene.add(this.entity);
		this.textures = {};
		this.nodes = new Map();
		this.opts = { cape: true, outerLayer: true, vanillaParts: true, floor: true };
		this.resize();
		new ResizeObserver(() => this.resize()).observe(container);
	}
	setTheme(dark) {
		this.floorMat.color.set(dark ? 0x8fa3b8 : 0x4d5b6b);
		this.floorMat.opacity = dark ? 0.22 : 0.18;
	}
	makeFloor() {
		const g = new THREE.Group();
		const pts = [];
		const N = 4;
		for (let i = -N; i <= N; i++) { pts.push(-N, 0, i, N, 0, i, i, 0, -N, i, 0, N); }
		const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
		this.floorMat = new THREE.LineBasicMaterial({ color: 0x4d5b6b, transparent: true, opacity: 0.18 });
		g.add(new THREE.LineSegments(geo, this.floorMat));
		const c = document.createElement('canvas'); c.width = c.height = 128;
		const x = c.getContext('2d'); const gr = x.createRadialGradient(64, 64, 4, 64, 64, 64);
		gr.addColorStop(0, 'rgba(0,0,0,0.35)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = gr; x.fillRect(0, 0, 128, 128);
		const sh = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.1), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }));
		sh.rotation.x = -Math.PI / 2; sh.position.y = 0.002;
		this.shadow = sh; g.add(sh);
		return g;
	}
	resize() {
		const w = this.container.clientWidth || 1, h = this.container.clientHeight || 1;
		this.renderer.setSize(w, h, false);
		this.camera.aspect = w / h;
		this.camera.updateProjectionMatrix();
	}
	makeTexture(img) {
		const t = new THREE.DataTexture(new Uint8Array(img.data.buffer.slice(0)), img.width, img.height, THREE.RGBAFormat);
		t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.generateMipmaps = false;
		t.encoding = THREE.sRGBEncoding; t.flipY = false; t.needsUpdate = true;
		t.userData.img = img; t.userData.version = img.version;
		return t;
	}
	clearModel() {
		while (this.entity.children.length) this.entity.remove(this.entity.children[0]);
		for (const k in this.textures) { const t = this.textures[k]; t.tex.dispose(); t.mat.dispose(); t.glow.dispose(); if (t.matBlend) { t.matBlend.dispose(); t.glowBlend.dispose(); } }
		this.textures = {};
		this.entity.traverse(o => { if (o.geometry) o.geometry.dispose(); });
		this.nodes = new Map();
	}
	sheet(name) {
		if (this.textures[name]) return this.textures[name];
		const def = this.def;
		let t = def.textures[name];
		if (!t || !t.img) {
			const fallback = { CAPE: 'cape', ELYTRA: 'elytra', ARMOR1: 'armor1', ARMOR2: 'armor2' }[name];
			t = { size: TEX_DEF_SIZE[name] || [64, 64], img: fallback ? this.assetImgs[fallback] : this.assetImgs.white };
		}
		const tex = this.makeTexture(t.img);
		// MC renders entities with an alpha cutoff of 0.1. Opaque/cutout pixels go in a depth-writing
		// pass; semi transparent pixels (if the texture has any) go in a second blended pass.
		let partial = false;
		const d = t.img.data;
		for (let i = 3; i < d.length; i += 4) { if (d[i] > 25 && d[i] < 250) { partial = true; break; } }
		const opaque = { map: tex, vertexColors: true, transparent: false, alphaTest: partial ? 0.98 : 0.1, side: THREE.DoubleSide };
		const blend = { map: tex, vertexColors: true, transparent: true, depthWrite: false, alphaTest: 0.1, side: THREE.DoubleSide };
		const discardOpaque = (m) => { m.onBeforeCompile = (sh) => { sh.fragmentShader = sh.fragmentShader.replace('#include <alphatest_fragment>', '#include <alphatest_fragment>\n\tif ( diffuseColor.a >= 0.98 ) discard;'); }; m.customProgramCacheKey = () => 'cpm-blend'; return m; };
		const entry = {
			tex, size: t.size, src: t, partial,
			mat: new THREE.MeshLambertMaterial(opaque),
			glow: new THREE.MeshBasicMaterial(opaque),
			matBlend: partial ? discardOpaque(new THREE.MeshLambertMaterial(blend)) : null,
			glowBlend: partial ? discardOpaque(new THREE.MeshBasicMaterial(blend)) : null,
		};
		this.textures[name] = entry;
		return entry;
	}
	texMesh(geo, sh, glow) {
		const m = new THREE.Mesh(geo, glow ? sh.glow : sh.mat);
		const bm = glow ? sh.glowBlend : sh.matBlend;
		if (bm) { const b = new THREE.Mesh(geo, bm); b.renderOrder = 1; m.add(b); }
		return m;
	}
	colorMats() {
		if (!this._colorMats) this._colorMats = {
			mat: new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }),
			glow: new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }),
		};
		return this._colorMats;
	}
	async loadAssets() {
		this.assetImgs = {};
		for (const k of ['cape', 'elytra', 'armor1', 'armor2']) this.assetImgs[k] = await decodePNG(await getAsset(k));
		const w = new Img(1, 1); w.setRGB(0, 0, 0xffffffff); this.assetImgs.white = w;
	}
	setModel(def) {
		this.clearModel();
		this.def = def;
		// entity transform chain
		this.yawGroup = new THREE.Group(); this.entity.add(this.yawGroup);
		this.poseGroup = new THREE.Group(); this.poseGroup.matrixAutoUpdate = false; this.yawGroup.add(this.poseGroup);
		this.modelGroup = new THREE.Group(); this.poseGroup.add(this.modelGroup);
		this.offsetGroup = new THREE.Group(); this.offsetGroup.position.y = -1.501; this.modelGroup.add(this.offsetGroup);
		this.renderScaleGroup = new THREE.Group(); this.renderScaleGroup.rotation.order = 'ZYX'; this.offsetGroup.add(this.renderScaleGroup);
		this.pxGroup = new THREE.Group(); this.pxGroup.scale.setScalar(1 / 16); this.renderScaleGroup.add(this.pxGroup);
		// roots: model roots + synthetic vanilla roots for cape/elytra/armor
		this.rootList = [];
		const all = [...PLAYER_PARTS.slice(0, 6), ...ROOT_TYPES];
		for (const part of all) {
			const pr = def.getModelElementFor(part);
			const elems = pr ? pr.elements : [];
			if (elems.length === 0) {
				const syn = new RootModelElement(part, def);
				syn.synthetic = true;
				this.addRoot(syn, true);
			} else elems.forEach((e) => this.addRoot(e, true));
		}
	}
	addRoot(root, vanilla) {
		const node = new THREE.Group();
		node.rotation.order = 'ZYX';
		this.pxGroup.add(node);
		const entry = { rc: root, node, vanillaMeshes: [], children: [] };
		const part = root.part;
		const sheetName = sheetForRoot(part);
		if (vanilla) {
			const sh = this.sheet(sheetName);
			const [tw, th] = sh.size;
			const mk = (quads, layer) => {
				const m = this.texMesh(quadsToGeometry(quads), sh, false);
				m.userData.layer = layer;
				node.add(m); entry.vanillaMeshes.push(m);
			};
			if (PLAYER_PART_VALUES[part]) {
				const v = partValues(part, this.def.skinType);
				const off = { x: v.off[0], y: v.off[1], z: v.off[2] }, sz = { x: v.size[0], y: v.size[1], z: v.size[2] };
				mk(createTextured(off, sz, { x: 1, y: 1, z: 1 }, 0, v.uv[0], v.uv[1], 1, tw, th), 'base');
				mk(createTextured(off, sz, { x: 1, y: 1, z: 1 }, v.d2, v.uv2[0], v.uv2[1], 1, tw, th), 'outer');
			} else if (ROOT_MODEL_VALUES[part]) {
				const v = ROOT_MODEL_VALUES[part];
				mk(createTextured({ x: v.off[0], y: v.off[1], z: v.off[2] }, { x: v.size[0], y: v.size[1], z: v.size[2] }, { x: 1, y: 1, z: 1 }, v.mcs, v.uv[0], v.uv[1], v.mirror ? -1 : 1, tw, th), 'base');
			}
		}
		this.rootList.push(entry);
		if (root.children) for (const c of root.children) this.addCube(c, node, sheetName);
	}
	addCube(rc, parentNode, sheetName) {
		const node = new THREE.Group();
		node.rotation.order = 'ZYX';
		parentNode.add(node);
		const sh = this.sheet(sheetName);
		const q = cubeQuads(rc, sh.size[0], sh.size[1]);
		let mesh = null;
		if (q && q.quads.length) {
			const cm = this.colorMats();
			mesh = q.colored ? new THREE.Mesh(quadsToGeometry(q.quads), rc.glow ? cm.glow : cm.mat) : this.texMesh(quadsToGeometry(q.quads), sh, rc.glow);
			mesh.userData.lastColor = 0xffffff;
			node.add(mesh);
		}
		this.nodes.set(rc, { node, mesh });
		if (rc.children) for (const c of rc.children) this.addCube(c, node, sheetName);
	}
	// called each frame after the animation driver ran
	sync(vp, vs) {
		const def = this.def;
		// textures (animated)
		for (const k in this.textures) {
			const t = this.textures[k];
			const img = t.tex.userData.img;
			if (img.version !== t.tex.userData.version) {
				t.tex.image.data.set(img.data); t.tex.needsUpdate = true; t.tex.userData.version = img.version;
			}
		}
		const f = vs.flags;
		for (const e of this.rootList) {
			const r = e.rc;
			if (r.synthetic) {
				const v = vp.parts[r.part];
				if (v) r.setPosAndRot(v.x, v.y, v.z, v.rx, v.ry, v.rz);
				r.reset();
			}
			const p = r.getPos(), rot = r.getRot();
			e.node.position.set(p.x, p.y, p.z);
			e.node.rotation.set(rot.x, rot.y, rot.z, 'ZYX');
			let visible = true;
			switch (r.part) {
				case 'CAPE': visible = this.opts.cape && !f.elytra; break;
				case 'ELYTRA_LEFT': case 'ELYTRA_RIGHT': visible = !!f.elytra; break;
				case 'ARMOR_HELMET': visible = !!f.armorHead && !f.skull; break;
				case 'ARMOR_BODY': case 'ARMOR_LEFT_ARM': case 'ARMOR_RIGHT_ARM': visible = !!f.armorBody; break;
				case 'ARMOR_LEGGINGS_BODY': case 'ARMOR_LEFT_LEG': case 'ARMOR_RIGHT_LEG': visible = !!f.armorLegs; break;
				case 'ARMOR_LEFT_FOOT': case 'ARMOR_RIGHT_FOOT': visible = !!f.armorBoots; break;
				case 'HEAD': visible = !(f.skull && def.hideHeadIfSkull); break;
				default: break;
			}
			if (f.invisible) visible = false;
			e.node.visible = visible;
			const disp = r.doDisplay() && this.opts.vanillaParts;
			for (const m of e.vanillaMeshes) m.visible = disp && (m.userData.layer !== 'outer' || this.opts.outerLayer);
		}
		for (const [rc, n] of this.nodes) {
			n.node.position.set(rc.pos.x, rc.pos.y, rc.pos.z);
			n.node.rotation.set(rc.rotation.x, rc.rotation.y, rc.rotation.z, 'ZYX');
			const s = rc.renderScale;
			n.node.scale.set(Math.max(s.x, 0.01), Math.max(s.y, 0.01), Math.max(s.z, 0.01));
			n.node.visible = rc.display;
			if (n.mesh && n.mesh.userData.lastColor !== rc.color) {
				const c = rc.color, a = n.mesh.geometry.getAttribute('color');
				const toLin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
				const R = toLin((c >> 16) & 255), G = toLin((c >> 8) & 255), B = toLin(c & 255);
				for (let i = 0; i < a.count; i++) a.setXYZ(i, R, G, B);
				a.needsUpdate = true;
				n.mesh.userData.lastColor = c;
			}
		}
		// entity transform
		const E = vp.entity;
		const m = new THREE.Matrix4();
		const tmp = new THREE.Matrix4();
		for (const st of E.steps) {
			if (st[0] === 't') tmp.makeTranslation(st[1], st[2], st[3]);
			else if (st[0] === 'x') tmp.makeRotationX(st[1] * Math.PI / 180);
			else if (st[0] === 'y') tmp.makeRotationY(st[1] * Math.PI / 180);
			else tmp.makeRotationZ(st[1] * Math.PI / 180);
			m.multiply(tmp);
		}
		this.poseGroup.matrix.copy(m);
		this.poseGroup.matrixWorldNeedsUpdate = true;
		this.yawGroup.rotation.y = E.sleeping ? 0 : Math.PI;
		this.yawGroup.position.y = (E.lift || 0) + (E.sleeping ? 0.3 : 0);
		let es = 1;
		if (def.scale && def.scale.scaling && def.scale.scaling.ENTITY) es = def.scale.scaling.ENTITY;
		const s = 0.9375 * es;
		this.modelGroup.scale.set(-s, -s, s);
		// model render transform (EffectModelScale)
		const sc = def.scale;
		const rg = this.renderScaleGroup;
		if (sc && sc.rPos) {
			rg.position.set(sc.rPos.x / 16, sc.rPos.y / 16, sc.rPos.z / 16);
			rg.rotation.set(sc.rRot.x, sc.rRot.y, sc.rRot.z, 'ZYX');
			const f2 = (v) => (v < 0.1 || v > 10) ? 1 : v;
			rg.scale.set(f2(sc.rScale.x), f2(sc.rScale.y), f2(sc.rScale.z));
		} else { rg.position.set(0, 0, 0); rg.rotation.set(0, 0, 0); rg.scale.set(1, 1, 1); }
		this.shadow.visible = !E.sleeping;
		this.floor.visible = this.opts.floor;
	}
	render() {
		this.controls.update();
		this.renderer.render(this.scene, this.camera);
	}
}
