// ---------------------------------------------------------------------------
// Input detection and loading (files, base64 text, links, skins)
// ---------------------------------------------------------------------------
'use strict';

const LINK_LOADERS = {
	git: (p) => 'https://gist.githubusercontent.com/' + p + '/raw',
	gh: (p) => 'https://raw.githubusercontent.com/' + p,
	pb: (p) => 'https://pastebin.com/raw/' + p,
	p: (p) => 'https://paste.tom5454.com/raw/' + p,
	ms: (p) => 'https://cdn-cpmmodels.tom5454.com/content/' + p,
};

// URL -> CPM link (ResourceLoader.Validator patterns)
function urlToLink(url) {
	let m;
	if ((m = url.match(/^https?:\/\/gist\.github\.com\/([a-zA-Z_0-9-]+)\/(\w+)/))) return { loader: 'git', path: m[1] + '/' + m[2], full: 'git:' + m[1] + '/' + m[2] };
	if ((m = url.match(/^https?:\/\/gist\.githubusercontent\.com\/([a-zA-Z_0-9-]+)\/(\w+)/))) return { loader: 'git', path: m[1] + '/' + m[2], full: 'git:' + m[1] + '/' + m[2] };
	if ((m = url.match(/^https?:\/\/github\.com\/([a-zA-Z_0-9-]+)\/([a-zA-Z_0-9-]+)\/blob\/([a-zA-Z_0-9\-/]+?)\/([a-zA-Z_0-9\-/.]+)/))) { const p = m[1] + '/' + m[2] + '/' + m[3] + '/' + m[4]; return { loader: 'gh', path: p, full: 'gh:' + p }; }
	if ((m = url.match(/^https?:\/\/pastebin\.com\/(?:raw\/)?([a-zA-Z_0-9-]+)/))) return { loader: 'pb', path: m[1], full: 'pb:' + m[1] };
	if ((m = url.match(/^https?:\/\/(?:cf-)?paste\.tom5454\.com\/(?:raw\/)?([a-zA-Z_0-9-]+)/))) return { loader: 'p', path: m[1], full: 'p:' + m[1] };
	return null;
}

function linkUrl(link) {
	const f = LINK_LOADERS[link.loader];
	return f ? f(link.path) : null;
}

class Loader {
	constructor(opts) {
		this.proxy = opts.proxy || (() => '');
		this.onNeedLink = opts.onNeedLink || null; // async (link, url) => text|null  (manual paste fallback)
		this.localLinks = new Map();
		this.warnings = [];
	}
	warn(msg) { if (!this.warnings.includes(msg)) this.warnings.push(msg); }
	async fetchText(url) {
		const tries = [url];
		const px = this.proxy();
		if (px) tries.push(px.includes('{url}') ? px.replace('{url}', encodeURIComponent(url)) : px + url);
		let lastErr = null;
		for (const u of tries) {
			try {
				const r = await fetch(u, { cache: 'no-store' });
				if (!r.ok) throw new Error('HTTP ' + r.status);
				return await r.text();
			} catch (e) { lastErr = e; }
		}
		throw lastErr || new Error('Network error');
	}
	async fetchLink(link) {
		if (this.localLinks.has(link.full)) return this.localLinks.get(link.full);
		const url = linkUrl(link);
		if (!url) throw new CPMError('Unknown link type: ' + link.full);
		let text = null, err = null;
		try { text = await this.fetchText(url); } catch (e) { err = e; }
		if (text == null && this.onNeedLink) text = await this.onNeedLink(link, url, err);
		if (text == null) throw new CPMError('Could not download ' + url + (err ? ' (' + err.message + ')' : ''));
		const bytes = b64ToBytes(text.trim());
		this.localLinks.set(link.full, bytes);
		return bytes;
	}
	ctx() { return { warn: (m) => this.warn(m), fetchLink: (l) => this.fetchLink(l) }; }
}

// Parse raw model bytes that start with the 0x53 header: full model stream,
// a package (overflow data) or a legacy definition.
function parseRawModel(bytes, ctx) {
	if (bytes[0] !== HEADER) throw new CPMError('This data is not a CPM model (missing header byte)');
	const errors = [];
	try { return { parts: parseModelParts(new ArraySource(bytes.subarray(1)), ctx), kind: 'model' }; } catch (e) { errors.push(e); }
	for (const kind of ['PACKAGE_LINK', 'DEFINITION_LINK']) {
		try { return { parts: [parseLinkedData(bytes, kind, ctx)], kind: 'package' }; } catch (e) { errors.push(e); }
	}
	throw new CPMError('Could not read the model data: ' + errors[0].message);
}

function parseCpmModelFile(bytes, loader) {
	if (bytes[0] !== HEADER) throw new CPMError('Not a .cpmmodel file');
	const cs = new ChecksumSource(new ArraySource(bytes.subarray(1)));
	const io = new IO(cs);
	const name = io.readUTF(), desc = io.readUTF();
	const data = io.readByteArray();
	const ovf = io.readByteArray();
	let link = null;
	if (ovf.length) { link = readLink(io); loader.localLinks.set(link.full, ovf); }
	const icon = io.readImageBytes().slice();
	try { cs.checkSum(); } catch (e) { loader.warn('The .cpmmodel checksum did not match; the file may be damaged.'); }
	return { name, desc, data, icon: icon.length ? icon : null, link };
}

let TEMPLATE_IMG = null;
async function getTemplate() {
	if (!TEMPLATE_IMG) TEMPLATE_IMG = await decodePNG(await getAsset('free_space_template'));
	return TEMPLATE_IMG;
}

// Reads a model embedded into a 64x64 skin (returns null if there is none)
async function readSkinModel(img, ctx, preferChannel) {
	if (img.width !== 64 || img.height !== 64) return null;
	const tmpl = await getTemplate();
	const chans = preferChannel === 0 ? [0, 1] : [1, 0];
	let lastErr = null;
	for (const ch of chans) {
		const skin = new SkinSource(img, tmpl, ch);
		if (skin.read() !== HEADER) continue;
		try {
			const parts = parseModelParts(skin, ctx, skin);
			const st = parts.find(p => p.t === 'SKIN_TYPE');
			return { parts, skinType: st && st.skinType !== 'UNKNOWN' ? st.skinType : (ch === 0 ? 'SLIM' : 'DEFAULT') };
		} catch (e) { lastErr = e; }
	}
	if (lastErr) throw lastErr;
	return null;
}

// MC legacy (64x32) skin conversion for display
function convertLegacySkin(img) {
	if (img.width !== 64 || img.height !== 32) return img;
	const out = new Img(64, 64);
	for (let y = 0; y < 32; y++) for (let x = 0; x < 64; x++) out.setRGB(x, y, img.getRGB(x, y));
	const cr = (x, y, dx, dy, w, h) => {
		for (let i = 0; i < h; i++) for (let j = 0; j < w; j++) out.setRGB(x + dx + (w - 1 - j), y + dy + i, out.getRGB(x + j, y + i));
	};
	cr(4, 16, 16, 32, 4, 4); cr(8, 16, 16, 32, 4, 4); cr(0, 20, 24, 32, 4, 12); cr(4, 20, 16, 32, 4, 12); cr(8, 20, 8, 32, 4, 12); cr(12, 20, 16, 32, 4, 12);
	cr(44, 16, -8, 32, 4, 4); cr(48, 16, -8, 32, 4, 4); cr(40, 20, 0, 32, 4, 12); cr(44, 20, -8, 32, 4, 12); cr(48, 20, -16, 32, 4, 12); cr(52, 20, -8, 32, 4, 12);
	return out;
}

let DEFAULT_SKINS = null;
async function defaultSkin(type) {
	if (!DEFAULT_SKINS) DEFAULT_SKINS = { DEFAULT: await decodePNG(await getAsset('default_skin')), SLIM: await decodePNG(await getAsset('slim_skin')) };
	return (type === 'SLIM' ? DEFAULT_SKINS.SLIM : DEFAULT_SKINS.DEFAULT).copy();
}

/**
 * Loads any supported input. `input` is {bytes, name} or {text}.
 * Returns {def, info, warnings, source}
 */
async function loadInput(input, loader, opts) {
	loader.warnings = [];
	const ctx = loader.ctx();
	let parts = null, skinType = opts.skinType || null, skinImage = opts.skinImage || null, info = { kind: '', name: null, desc: null, icon: null };
	let bytes = input.bytes || null;
	const name = input.name || '';
	if (!bytes && input.text != null) {
		const t = input.text.trim();
		if (/^https?:\/\//i.test(t)) {
			const link = urlToLink(t);
			if (link) {
				const data = await loader.fetchLink(link);
				const r = parseRawModel(data, ctx);
				parts = r.parts; info.kind = 'Model from ' + link.full;
			} else {
				// direct file URL (skin png / cpmmodel / raw text)
				const r = await fetch(t);
				if (!r.ok) throw new CPMError('Download failed (HTTP ' + r.status + ')');
				bytes = new Uint8Array(await r.arrayBuffer());
				const tn = t.split('?')[0].split('/').pop();
				return loadInput({ bytes, name: tn }, loader, opts);
			}
		} else if (/^(git|gh|pb|p|ms):/.test(t)) {
			const i = t.indexOf(':');
			const link = { loader: t.substring(0, i), path: t.substring(i + 1), full: t };
			parts = parseRawModel(await loader.fetchLink(link), ctx).parts;
			info.kind = 'Model from ' + t;
		} else {
			let b;
			try { b = b64ToBytes(t); } catch (e) { b = null; }
			if (!b || b[0] !== HEADER) throw new CPMError('That text is not a supported link or a CPM model string. Paste a Gist, Pastebin or GitHub link, or the base64 text from a model export.');
			const r = parseRawModel(b, ctx);
			parts = r.parts; info.kind = r.kind === 'model' ? 'Model string' : 'Model package';
		}
	}
	if (!parts && bytes) {
		const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
		const isPng = bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78;
		if (isZip) {
			const pr = await loadProject(bytes, ctx);
			parts = pr.parts; info = Object.assign(info, pr.info); info.kind = 'Project file';
			if (pr.skinType) skinType = pr.skinType;
		} else if (isPng) {
			let img = await decodePNG(bytes);
			const sm = await readSkinModel(img, ctx, skinType === 'SLIM' ? 0 : 1);
			skinImage = convertLegacySkin(img);
			if (sm) { parts = sm.parts; skinType = sm.skinType; info.kind = 'Skin with embedded model'; }
			else { parts = []; info.kind = 'Plain skin (no CPM model inside)'; }
		} else if (bytes[0] === HEADER && /\.cpmmodel$/i.test(name)) {
			const mf = parseCpmModelFile(bytes, loader);
			parts = parseRawModel(mf.data, ctx).parts;
			info.name = mf.name; info.desc = mf.desc; info.icon = mf.icon; info.kind = 'Exported model file';
		} else if (bytes[0] === HEADER) {
			try {
				const mf = parseCpmModelFile(bytes, loader);
				parts = parseRawModel(mf.data, ctx).parts;
				info.name = mf.name; info.desc = mf.desc; info.icon = mf.icon; info.kind = 'Exported model file';
			} catch (e) {
				parts = parseRawModel(bytes, ctx).parts; info.kind = 'Model data';
			}
		} else {
			// maybe a text file with base64 or a link
			const text = utf8.decode(bytes);
			return loadInput({ text }, loader, opts);
		}
	}
	const cl = (function find(list) { for (const p of list) { if (p.t === 'CLONEABLE') return p.info; if (p.parts) { const r = find(p.parts); if (r) return r; } } return null; })(parts);
	if (cl) { info.name = info.name || cl.name; info.desc = info.desc || cl.desc; info.icon = info.icon || cl.icon; }
	const stPart = parts.find(p => p.t === 'SKIN_TYPE');
	if (stPart && stPart.skinType !== 'UNKNOWN' && !opts.forceSkinType) skinType = stPart.skinType;
	if (opts.forceSkinType) skinType = opts.forceSkinType;
	skinType = skinType || 'DEFAULT';
	if (!skinImage) skinImage = await defaultSkin(skinType);
	const def = await buildDefinition(parts, ctx, { skinType, skinImage });
	return { def, info, warnings: loader.warnings.slice(), skinType };
}
