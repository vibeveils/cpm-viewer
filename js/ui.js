// ---------------------------------------------------------------------------
// UI wiring
// ---------------------------------------------------------------------------
'use strict';

(function () {
	const $ = (id) => document.getElementById(id);
	const el = (tag, attrs, ...kids) => {
		const e = document.createElement(tag);
		if (attrs) for (const k in attrs) {
			if (k === 'class') e.className = attrs[k];
			else if (k === 'text') e.textContent = attrs[k];
			else if (k.startsWith('on')) e.addEventListener(k.substring(2), attrs[k]);
			else if (attrs[k] !== undefined && attrs[k] !== null && attrs[k] !== false) e.setAttribute(k, attrs[k] === true ? '' : attrs[k]);
		}
		for (const k of kids) if (k != null) e.append(k);
		return e;
	};
	const store = {
		get(k, d) { try { const v = localStorage.getItem('cpmv.' + k); return v == null ? d : v; } catch (e) { return d; } },
		set(k, v) { try { localStorage.setItem('cpmv.' + k, v); } catch (e) { /* ignore */ } },
	};

	// brand mark: tiny pixel head
	(() => {
		const c = $('brandMark').getContext('2d');
		const px = ['33333333', '33333333', '34444443', '45544554', '44444444', '44466444', '44544544', '44444444'];
		const col = { 3: '#5b3a1d', 4: '#c99a72', 5: '#ffffff', 6: '#8a5a3a' };
		px.forEach((r, y) => [...r].forEach((ch, x) => { c.fillStyle = col[ch]; c.fillRect(x, y, 1, 1); }));
	})();

	const viewer = new Viewer($('viewport'));
	const vs = defaultViewState();
	let driver = null, def = null;
	let playing = true, speed = 1, clock = 0, last = performance.now();
	let baseSkin = null; // user supplied skin for models without their own texture
	let lastInput = null;

	const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
	const applyTheme = () => {
		const t = document.documentElement.getAttribute('data-theme');
		viewer.setTheme(t ? t === 'dark' : darkQuery.matches);
	};
	darkQuery.addEventListener('change', applyTheme);
	new MutationObserver(applyTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
	applyTheme();

	// ---------------- loading ----------------
	const proxyInput = $('proxy');
	proxyInput.value = store.get('proxy', '');
	proxyInput.addEventListener('change', () => store.set('proxy', proxyInput.value.trim()));

	const linkFix = $('linkFix');
	const loader = new Loader({
		proxy: () => proxyInput.value.trim(),
		onNeedLink: (link, url, err) => new Promise((resolve) => {
			linkFix.hidden = false;
			linkFix.replaceChildren(el('div', { class: 'notice linkfix' },
				el('div', null, 'The model data at ', el('b', { text: link.full }), ' could not be downloaded' + (err ? ' (' + err.message + ')' : '') + '.'),
				el('div', null, 'Open ', el('a', { href: url, target: '_blank', rel: 'noopener', text: url }), ', copy all of its text and paste it below.'),
				el('textarea', { id: 'linkFixText', placeholder: 'Paste the base64 text here', 'aria-label': 'Linked model data' }),
				el('div', { class: 'link-row' },
					el('button', { class: 'btn primary small', type: 'button', onclick: () => { const t = $('linkFixText').value.trim(); linkFix.hidden = true; resolve(t || null); } }, 'Continue'),
					el('button', { class: 'btn small', type: 'button', onclick: () => { linkFix.hidden = true; resolve(null); } }, 'Cancel'))));
			$('linkFixText').focus();
		}),
	});

	function showMsg(text, kind) {
		const m = $('loadMsg');
		if (!text) { m.hidden = true; return; }
		m.hidden = false;
		m.replaceChildren(el('div', { class: 'notice ' + (kind || '') }, text));
	}

	async function load(input, label, opts2) {
		$('busy').hidden = false;
		showMsg(null);
		try {
			const opts = { forceSkinType: $('skinType').value || null, skinImage: baseSkin ? baseSkin.copy() : null };
			const r = await loadInput(input, loader, opts);
			lastInput = { input, label };
			setModel(r, label);
			$('loadSummary').textContent = $('mTitle').textContent;
			if (!(opts2 && opts2.keepOpen)) $('loadSec').open = false;
			if (r.warnings.length === 0) showMsg(null);
		} catch (e) {
			console.error(e);
			showMsg((e instanceof CPMError ? '' : 'Unexpected error: ') + (e.message || String(e)), 'err');
		} finally {
			$('busy').hidden = true;
		}
	}

	let lastInfo = {};
	function setModel(r, label) {
		lastInfo = Object.assign({}, r.info || {}, { label });
		def = r.def;
		driver = new AnimationDriver(def);
		viewer.setModel(def);
		const info = r.info || {};
		const name = info.name || label || 'Untitled model';
		$('mTitle').textContent = name;
		$('mKind').textContent = info.kind + ' · ' + (def.skinType === 'SLIM' ? 'slim arms' : 'classic arms');
		// model section
		const head = $('modelHead');
		if (info.icon || info.name || info.desc) {
			head.hidden = false;
			$('modelName').textContent = info.name || name;
			$('modelDesc').textContent = info.desc || '';
			const ic = $('modelIcon');
			if (info.icon) { ic.hidden = false; ic.src = URL.createObjectURL(new Blob([info.icon], { type: 'image/png' })); } else ic.hidden = true;
		} else head.hidden = true;
		const cubes = def.cubes.filter(c => !c.isRoot).length;
		const roots = [...def.roots.entries()].filter(([k, v]) => k !== 'CUSTOM_PART' && v.elements.some(e => e.children && e.children.length)).map(([k]) => k.toLowerCase().replace(/_/g, ' '));
		const triggers = def.reg.triggers;
		const anims = new Set(); triggers.forEach(t => t.animations.forEach(a => anims.add(a)));
		const poses = [...def.reg.poseToTriggers.keys()].filter(p => p !== 'GLOBAL');
		const meta = $('modelMeta');
		const add = (k, v) => meta.append(el('dt', { text: k }), el('dd', { text: v }));
		meta.replaceChildren();
		add('Source', info.kind);
		add('Cubes', String(cubes));
		add('Animations', String(anims.size));
		add('Parts used', roots.length ? roots.join(', ') : 'none');
		const tex = def.textures.SKIN;
		add('Texture', def.skinFromPlayer ? 'player skin (64×64)' : (tex && tex.img ? tex.img.width + '×' + tex.img.height + ' (grid ' + tex.size[0] + '×' + tex.size[1] + ')' : '–'));
		if (def.reg.profileId) add('Model id', def.reg.profileId);
		if (def.scale && def.scale.scaling && def.scale.scaling.ENTITY) add('Scale', def.scale.scaling.ENTITY.toFixed(2) + '×');
		$('modelStats').textContent = poses.length ? poses.length + ' poses animated' : '';
		const w = $('warnings');
		w.replaceChildren(...r.warnings.map(t => el('div', { class: 'notice' }, t)));
		const hasCape = def.roots.has('CAPE') || !!(def.textures.CAPE && def.textures.CAPE.img);
		$('optCape').checked = hasCape; viewer.opts.cape = hasCape;
		buildControls();
		refreshMarks();
	}

	// ---------------- controls built from the model ----------------
	const controlsEl = $('controls');
	function buildControls() {
		controlsEl.replaceChildren();
		if (!def) return;
		const showHidden = $('showHidden').checked;
		const btns = def.reg.namedActions.filter(b => showHidden || buttonCanShow(b));
		$('dockCount').textContent = btns.length ? btns.length + (btns.length === 1 ? ' control' : ' controls') : '';
		$('ctrlHint').hidden = btns.length > 0;
		if (!btns.length) {
			$('ctrlHint').hidden = false;
			$('ctrlHint').textContent = def.reg.namedActions.length ? 'This model only has hidden or command controlled actions. Tick "show hidden" to use them.' : 'This model has no gestures, poses or toggles.';
		}
		const groups = { POSE: [], GESTURE: [], TOGGLE: [], OTHER: [] };
		for (const b of btns) {
			if (b.type === 'POSE') groups.POSE.push(b);
			else if (b.type === 'GESTURE') groups.GESTURE.push(b);
			else if (b.type === 'BOOL_PARAMETER_TOGGLE') groups.TOGGLE.push(b);
			else groups.OTHER.push(b);
		}
		const tag = (b) => (b.command ? ' (command)' : '') + (b.hidden ? ' (hidden)' : '');
		const chipGroup = (label, list) => {
			if (!list.length) return;
			controlsEl.append(el('div', { class: 'ctrl-group-label', text: label }));
			const box = el('div', { class: 'chips' });
			for (const b of list) {
				const c = el('button', { class: 'chip', type: 'button', 'aria-pressed': 'false', title: b.name + tag(b) }, b.name || '(unnamed)');
				c.addEventListener('click', () => { driver.activateButton(b, clock); refreshControls(); });
				c._btn = b;
				box.append(c);
			}
			controlsEl.append(box);
		};
		chipGroup('Poses', groups.POSE);
		chipGroup('Gestures', groups.GESTURE);
		chipGroup('Toggles', groups.TOGGLE);
		for (const b of groups.OTHER) {
			if (b.type === 'VALUE_PARAMETER_SLIDER') {
				const id = 'ms' + Math.random().toString(36).slice(2);
				const max = b.maxValue || 255;
				const out = el('output', { for: id });
				const inp = el('input', { type: 'range', id, min: 0, max, step: 1, value: driver.getSlider(b) });
				inp.addEventListener('input', () => { driver.setSlider(b, +inp.value); out.textContent = inp.value; });
				inp._btn = b; inp._out = out;
				out.textContent = inp.value;
				controlsEl.append(el('div', { class: 'row' }, el('label', { for: id, text: b.name + tag(b) }), inp, out));
			} else if (b.type === 'DROPDOWN' || b.type === 'LEGACY_DROPDOWN') {
				const id = 'md' + Math.random().toString(36).slice(2);
				const opts = b.type === 'DROPDOWN' ? b.opts : [...b.params.keys()];
				const sel = el('select', { id });
				for (const o of opts) sel.append(el('option', { value: o, text: o === '' ? '(none)' : o }));
				sel.value = driver.getDropdown(b);
				sel.addEventListener('change', () => driver.setDropdown(b, sel.value));
				sel._btn = b;
				controlsEl.append(el('div', { class: 'row two' }, el('label', { for: id, text: b.name + tag(b) }), sel));
			}
		}
		refreshControls();
	}
	function refreshControls() {
		if (!driver) return;
		controlsEl.querySelectorAll('.chip').forEach(c => c.setAttribute('aria-pressed', driver.isActive(c._btn) ? 'true' : 'false'));
		controlsEl.querySelectorAll('input[type=range]').forEach(i => { if (document.activeElement !== i) { i.value = driver.getSlider(i._btn); i._out.textContent = i.value; } });
		controlsEl.querySelectorAll('select').forEach(s => { if (document.activeElement !== s) s.value = driver.getDropdown(s._btn); });
	}
	$('showHidden').addEventListener('change', buildControls);
	$('resetParams').addEventListener('click', () => { if (driver) { driver.resetParams(); refreshControls(); } });

	// ---------------- vanilla state controls ----------------
	const moveChips = $('moveChips');
	for (const m of MOVEMENTS) {
		const c = el('button', { class: 'chip', type: 'button', 'aria-pressed': m.id === vs.movement ? 'true' : 'false' }, el('span', { class: 'dot', hidden: true }), m.label);
		c.dataset.pose = m.id;
		c.addEventListener('click', () => setMovement(m.id));
		moveChips.append(c);
	}
	function setMovement(id) {
		vs.movement = id;
		moveChips.querySelectorAll('.chip').forEach(x => x.setAttribute('aria-pressed', x.dataset.pose === id ? 'true' : 'false'));
		$('hudMove').value = id;
	}
	const handPoseIds = { ITEM: ['HOLDING'], EAT: ['EATING', 'HOLDING'], PUNCH: ['PUNCH'], BLOCK: ['BLOCKING'], BOW: ['BOW'], CROSSBOW_CHARGE: ['CROSSBOW_CH'], CROSSBOW_HOLD: ['CROSSBOW'], TRIDENT: ['TRIDENT'], SPYGLASS: ['SPYGLASS'], TOOT_HORN: ['TOOT_HORN'], BRUSH: ['BRUSH'], SPEAR: ['SPEAR'] };
	for (const side of ['rightHand', 'leftHand']) {
		const s = $(side);
		for (const h of HAND_ACTIONS) s.append(el('option', { value: h.id, text: h.label }));
		s.addEventListener('change', () => { vs[side] = s.value; });
	}
	const statusChips = $('statusChips');
	for (const f of STATUS_FLAGS) {
		const c = el('button', { class: 'chip', type: 'button', 'aria-pressed': 'false' }, el('span', { class: 'dot', hidden: true }), f.label);
		c.dataset.pose = f.pose;
		c.addEventListener('click', () => { vs.flags[f.id] = !vs.flags[f.id]; c.setAttribute('aria-pressed', vs.flags[f.id] ? 'true' : 'false'); });
		statusChips.append(c);
	}
	const valueDefs = [
		{ key: 'headYaw', label: 'Head yaw', min: -90, max: 90, step: 1, fmt: v => v + '°', pose: 'HEAD_ROTATION_YAW' },
		{ key: 'headPitch', label: 'Head pitch', min: -90, max: 90, step: 1, fmt: v => v + '°', pose: 'HEAD_ROTATION_PITCH' },
		{ key: 'health', label: 'Health', min: 0, max: 1, step: 0.01, fmt: v => Math.round(v * 20) + '/20', pose: 'HEALTH' },
		{ key: 'hunger', label: 'Hunger', min: 0, max: 1, step: 0.01, fmt: v => Math.round(v * 20) + '/20', pose: 'HUNGER' },
		{ key: 'air', label: 'Air', min: 0, max: 1, step: 0.01, fmt: v => Math.round(v * 100) + '%', pose: 'AIR' },
		{ key: 'light', label: 'Light level', min: 0, max: 15, step: 1, fmt: v => String(v), pose: 'LIGHT' },
		{ key: 'speakLevel', label: 'Voice level', min: 0, max: 1, step: 0.01, fmt: v => Math.round(v * 100) + '%', pose: 'SPEAKING' },
		{ key: 'bowPull', label: 'Bow pull', min: -0.05, max: 1, step: 0.05, fmt: v => v < 0 ? 'auto' : Math.round(v * 100) + '%', pose: 'BOW_RIGHT' },
		{ key: 'crossbowPull', label: 'Crossbow pull', min: -0.05, max: 1, step: 0.05, fmt: v => v < 0 ? 'auto' : Math.round(v * 100) + '%', pose: 'CROSSBOW_CH_RIGHT' },
	];
	const valueRows = $('valueRows');
	for (const d of valueDefs) {
		const id = 'v_' + d.key;
		const inp = el('input', { type: 'range', id, min: d.min, max: d.max, step: d.step, value: vs[d.key] < 0 ? d.min : vs[d.key] });
		const out = el('output', { for: id, text: d.fmt(vs[d.key]) });
		inp.addEventListener('input', () => { let v = +inp.value; if (d.min < 0 && d.key.endsWith('Pull') && v < 0) v = -1; vs[d.key] = v; out.textContent = d.fmt(v); });
		const lab = el('label', { for: id }, d.label);
		lab.dataset.pose = d.pose;
		valueRows.append(el('div', { class: 'row' }, lab, inp, out));
	}

	function refreshMarks() {
		const has = (p) => def && def.reg.hasPoseAnimations(p);
		moveChips.querySelectorAll('.chip').forEach(c => { c.querySelector('.dot').hidden = !has(c.dataset.pose); });
		[...$('hudMove').options].forEach(o => { o.textContent = MOVEMENTS.find(m => m.id === o.value).label + (has(o.value) ? '  ■' : ''); });
		statusChips.querySelectorAll('.chip').forEach(c => { c.querySelector('.dot').hidden = !has(c.dataset.pose); });
		valueRows.querySelectorAll('label').forEach(l => { l.style.color = has(l.dataset.pose) ? 'var(--ink)' : ''; l.style.fontWeight = has(l.dataset.pose) ? '600' : ''; });
		for (const side of ['rightHand', 'leftHand']) {
			const sfx = side === 'rightHand' ? '_RIGHT' : '_LEFT';
			[...$(side).options].forEach(o => {
				const base = HAND_ACTIONS.find(h => h.id === o.value).label;
				const ids = handPoseIds[o.value] || [];
				o.textContent = base + (ids.some(i => has(i + sfx)) ? '  ■' : '');
			});
		}
	}

	// ---------------- dock ----------------
	const dock = $('dock'), dockToggle = $('dockToggle');
	const setDockOpen = (o) => { dockToggle.setAttribute('aria-expanded', o ? 'true' : 'false'); $('dockBody').hidden = !o; store.set('dock', o ? '1' : '0'); };
	dockToggle.addEventListener('click', () => setDockOpen(dockToggle.getAttribute('aria-expanded') !== 'true'));
	setDockOpen(store.get('dock', '1') === '1');
	const narrow = window.matchMedia('(max-width: 860px)');
	const placeDock = () => { if (narrow.matches) $('panel').prepend(dock); else $('viewport').insertBefore(dock, $('dropHint')); };
	narrow.addEventListener('change', placeDock); placeDock();
	const hudMove = $('hudMove');
	for (const m of MOVEMENTS) hudMove.append(el('option', { value: m.id, text: m.label }));
	hudMove.addEventListener('change', () => setMovement(hudMove.value));

	// ---------------- export ----------------
	// Inside a claude.ai artifact, downloads go through the platform's save dialog
	// (window.claude may appear after this script first runs, so look it up on click).
	let downloadsP = null;
	const getDownloads = () => {
		if (!downloadsP && window.claude && typeof window.claude.use === 'function') {
			try { downloadsP = window.claude.use('downloads'); } catch (e) { downloadsP = null; }
		}
		return downloadsP;
	};
	const inSandbox = (() => { try { return window.self !== window.top; } catch (e) { return true; } })();
	function exportMsg(text, kind) {
		const m = $('exportMsg');
		if (!text) { m.hidden = true; return; }
		m.hidden = false;
		m.replaceChildren(el('div', { class: 'notice ' + (kind || '') }, text));
	}
	// Saves bytes as a download (claude.ai artifact: platform save dialog, which only accepts some extensions)
	async function saveFile(filename, bytes, mime, detail) {
		const dp = getDownloads();
		const dl = dp ? await dp : null;
		if (dl) {
			const allowed = /\.(zip|json|txt|png)$/i.test(filename);
			const name = allowed ? filename : filename + '.zip';
			let data = bytes;
			if (!allowed) data = await writeZip([{ name: filename, data: bytes }]);
			try {
				await dl.save({ filename: name, data: new Blob([data]) });
				exportMsg('Saved ' + name + (allowed ? '' : ' (unzip it to get ' + filename + ')') + '.', 'ok');
			} catch (e) { if (e && e.code !== 'declined') exportMsg('The download could not be saved here (' + (e.code || e.message) + ').', 'err'); else exportMsg(null); }
		} else if (inSandbox && window.claude) {
			exportMsg('Downloads are not available in this view.', 'err');
		} else {
			const a = document.createElement('a');
			a.href = URL.createObjectURL(new Blob([bytes], { type: mime }));
			a.download = filename;
			document.body.append(a); a.click(); a.remove();
			setTimeout(() => URL.revokeObjectURL(a.href), 5000);
			exportMsg('Exported ' + filename + (detail ? ' (' + detail + ')' : '') + '.', 'ok');
		}
	}
	$('exportBtn').addEventListener('click', async () => {
		if (!def) return;
		const btn = $('exportBtn');
		btn.disabled = true;
		exportMsg(null);
		try {
			const zip = await exportProject(def, { name: lastInfo.name || lastInfo.label || '', desc: lastInfo.desc || '', icon: lastInfo.icon || null });
			const base = safeName((lastInfo.name || lastInfo.label || 'model').replace(/\s+/g, '_')) || 'model';
			const dp = getDownloads();
			const dl = dp ? await dp : null;
			if (dl) {
				try {
					await dl.save({ filename: base + '.cpmproject.zip', data: new Blob([zip]) });
					exportMsg('Saved ' + base + '.cpmproject.zip. Remove the .zip ending so the CPM editor opens it as a project.', 'ok');
				} catch (e) { if (e && e.code !== 'declined') exportMsg('The download could not be saved here (' + (e.code || e.message) + ').', 'err'); }
			} else if (inSandbox && window.claude) {
				exportMsg('Downloads are not available in this view. Open the standalone viewer file to export.', 'err');
			} else {
				const a = document.createElement('a');
				a.href = URL.createObjectURL(new Blob([zip], { type: 'application/zip' }));
				a.download = base + '.cpmproject';
				document.body.append(a); a.click(); a.remove();
				setTimeout(() => URL.revokeObjectURL(a.href), 5000);
				exportMsg('Exported ' + base + '.cpmproject.', 'ok');
			}
		} catch (e) {
			console.error(e);
			exportMsg('Export failed: ' + (e.message || e), 'err');
		} finally { btn.disabled = false; }
	});

	$('glbBtn').addEventListener('click', async () => {
		if (!def) return;
		const btn = $('glbBtn');
		btn.disabled = true;
		exportMsg('Building GLB…');
		await new Promise(r => setTimeout(r, 30));
		try {
			const mode = $('glbMode').value;
			let clips = [], opts = {};
			const cur = gltfClipCurrent(vs, driver, 'Current');
			if (mode === 'still') opts.rest = Object.assign(cur, { time: Math.floor(clock) });
			else if (mode === 'current') clips = [cur];
			else clips = gltfClipsAll(def);
			const glb = await exportGLB(viewer, def, clips, opts);
			const base = safeName((lastInfo.name || lastInfo.label || 'model').replace(/\s+/g, '_')) || 'model';
			await saveFile(base + '.glb', glb, 'model/gltf-binary', clips.length ? clips.length + (clips.length === 1 ? ' animation' : ' animations') : 'no animation');
		} catch (e) {
			console.error(e);
			exportMsg('GLB export failed: ' + (e.message || e), 'err');
		} finally { btn.disabled = false; }
	});

	// ---------------- view options ----------------
	const bindOpt = (id, fn) => { const c = $(id); c.addEventListener('change', () => fn(c.checked)); };
	bindOpt('optOuter', v => viewer.opts.outerLayer = v);
	bindOpt('optVanilla', v => viewer.opts.vanillaParts = v);
	bindOpt('optCape', v => viewer.opts.cape = v);
	bindOpt('optFloor', v => viewer.opts.floor = v);
	bindOpt('optVanillaAnim', v => vs.noVanilla = !v);
	let spin = false; bindOpt('optSpin', v => spin = v);

	const playBtn = $('playBtn');
	const setPlaying = (p) => { playing = p; playBtn.textContent = p ? 'Pause' : 'Play'; playBtn.setAttribute('aria-label', p ? 'Pause animations' : 'Play animations'); };
	playBtn.addEventListener('click', () => setPlaying(!playing));
	$('speed').addEventListener('input', (e) => { speed = +e.target.value; $('speedOut').textContent = speed.toFixed(2) + '×'; });
	document.addEventListener('keydown', (e) => {
		if (e.code === 'Space' && !/INPUT|TEXTAREA|SELECT|BUTTON/.test(document.activeElement.tagName)) { e.preventDefault(); setPlaying(!playing); }
	});
	$('resetCamBtn').addEventListener('click', () => { viewer.camera.position.set(2.6, 1.9, 3.6); viewer.controls.target.set(0, 1.0, 0); viewer.controls.update(); });

	// ---------------- file inputs ----------------
	const fileInput = $('fileInput');
	const openFile = () => fileInput.click();
	$('openBtn').addEventListener('click', openFile);
	$('dropzone').addEventListener('click', openFile);
	$('dropzone').addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openFile(); } });
	async function loadFile(f) {
		const bytes = new Uint8Array(await f.arrayBuffer());
		await load({ bytes, name: f.name }, f.name.replace(/\.(cpmproject|cpmmodel|png|txt)$/i, ''));
	}
	fileInput.addEventListener('change', () => { if (fileInput.files[0]) loadFile(fileInput.files[0]); fileInput.value = ''; });
	$('linkBtn').addEventListener('click', () => { const t = $('linkInput').value.trim(); if (t) load({ text: t }, null); });
	$('linkInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('linkBtn').click(); });
	$('skinType').addEventListener('change', () => { if (lastInput) load(lastInput.input, lastInput.label); });
	$('baseSkinBtn').addEventListener('click', () => $('baseSkinInput').click());
	$('baseSkinInput').addEventListener('change', async () => {
		const f = $('baseSkinInput').files[0]; $('baseSkinInput').value = '';
		if (!f) return;
		try { baseSkin = convertLegacySkin(await decodeImage(new Uint8Array(await f.arrayBuffer()))); if (lastInput) load(lastInput.input, lastInput.label); }
		catch (e) { showMsg('That image could not be read as a skin.', 'err'); }
	});
	$('baseSkinReset').addEventListener('click', () => { baseSkin = null; if (lastInput) load(lastInput.input, lastInput.label); });

	const vp = $('viewport'), hint = $('dropHint');
	let dragDepth = 0;
	window.addEventListener('dragenter', (e) => { if ([...e.dataTransfer.types].includes('Files')) { dragDepth++; hint.hidden = false; e.preventDefault(); } });
	window.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) hint.hidden = true; });
	window.addEventListener('dragover', (e) => e.preventDefault());
	window.addEventListener('drop', (e) => {
		e.preventDefault(); dragDepth = 0; hint.hidden = true;
		const f = e.dataTransfer.files && e.dataTransfer.files[0];
		if (f) loadFile(f);
		else { const t = e.dataTransfer.getData('text'); if (t) load({ text: t }, null); }
	});
	document.addEventListener('paste', (e) => {
		if (/INPUT|TEXTAREA/.test(document.activeElement.tagName)) return;
		const items = [...(e.clipboardData ? e.clipboardData.items : [])];
		const fi = items.find(i => i.kind === 'file');
		if (fi) { e.preventDefault(); loadFile(fi.getAsFile()); return; }
		const t = e.clipboardData.getData('text');
		if (t && t.trim()) { e.preventDefault(); $('linkInput').value = t.trim().slice(0, 300); load({ text: t }, null); }
	});

	// ---------------- frame loop ----------------
	const playingEl = $('playing');
	let lastUi = 0;
	function frame(now) {
		const dt = Math.min(100, now - last); last = now;
		if (playing) clock += dt * speed;
		if (spin) { const a = dt * 0.0004; const p = viewer.camera.position, t = viewer.controls.target; const x = p.x - t.x, z = p.z - t.z; p.x = t.x + x * Math.cos(a) - z * Math.sin(a); p.z = t.z + x * Math.sin(a) + z * Math.cos(a); }
		if (driver) {
			const vpose = driver.update(vs, Math.floor(clock));
			viewer.sync(vpose, vs);
			if (now - lastUi > 250) { lastUi = now; updateUi(); }
		}
		viewer.render();
		requestAnimationFrame(frame);
	}
	function updateUi() {
		const cur = driver.currentPose;
		$('poseBadge').textContent = (cur && cur.startsWith('c:') ? 'Custom pose: ' + cur.substring(2) : cur) + (driver.getValue(1) ? ' · gesture' : '');
		const list = driver.handler.current.filter(a => !a.finished).map(a => a.anim).filter(a => !(a.owner && a.owner.currentStage !== a.stage));
		const info = list.map(a => def.reg.animInfo.get(a) || def.reg.animInfo.get(a.parent) || { label: 'animation', kind: '' });
		$('playCount').textContent = list.length + ' active';
		const pretty = (l) => l.startsWith('c:') ? l.substring(2) : (/^[A-Z_]+$/.test(l) ? l.charAt(0) + l.slice(1).toLowerCase().replace(/_/g, ' ') : l);
		const items = info.map(i => el('li', null, el('span', { text: pretty(i.label) }), el('span', { text: i.kind === 'pose' ? 'vanilla pose' : i.kind })));
		if (!items.length) items.push(el('li', { class: 'empty' }, el('span', { text: 'No custom animation is playing' })));
		playingEl.replaceChildren(...items);
		refreshControls();
	}

	window.cpmViewer = { viewer, vs, get def() { return def; }, get driver() { return driver; } };
	// ---------------- start ----------------
	(async () => {
		await viewer.loadAssets();
		requestAnimationFrame((t) => { last = t; frame(t); });
		await load({ bytes: await getAsset('demo_project'), name: 'animation_status_test.cpmproject' }, 'Animation status test (example)', { keepOpen: true });
	})();
})();
