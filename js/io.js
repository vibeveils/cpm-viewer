// ---------------------------------------------------------------------------
// Binary IO, PNG and ZIP decoding (no dependencies)
// ---------------------------------------------------------------------------
'use strict';

class CPMError extends Error {}

const utf8 = new TextDecoder('utf-8');

function b64ToBytes(str) {
	str = String(str).replace(/[^A-Za-z0-9+/=_-]/g, '').replace(/-/g, '+').replace(/_/g, '/');
	while (str.length % 4) str += '=';
	const bin = atob(str);
	const out = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
	return out;
}

class ArraySource {
	constructor(u8) { this.d = u8; this.p = 0; }
	read() { return this.p < this.d.length ? this.d[this.p++] : -1; }
}

// Mirrors ChecksumInputStream: 16 bit running sum of every byte read
class ChecksumSource {
	constructor(src) { this.s = src; this.sum = 0; }
	read() {
		const v = this.s.read();
		if (v !== -1) this.sum = (this.sum + v) & 0xffff;
		return v;
	}
	checkSum() {
		const a = this.s.read(), b = this.s.read();
		if (a < 0 || b < 0) throw new CPMError('Unexpected end of data (checksum)');
		const exp = ((a << 8) | b) & 0xffff;
		if (exp !== this.sum) throw new CPMError('Checksum mismatch: expected ' + exp + ' got ' + this.sum);
	}
}

const DIV = Math.floor(32767 / 48); // Short.MAX_VALUE / Vec3f.MAX_POS
const f32buf = new DataView(new ArrayBuffer(4));

// Mirrors com.tom.cpm.shared.io.IOHelper (read side)
class IO {
	constructor(src) {
		if (src instanceof Uint8Array) { this.bytes = src; this.src = new ArraySource(src); }
		else this.src = src;
	}
	read() { return this.src.read(); }
	u8() { const v = this.src.read(); if (v < 0) throw new CPMError('Unexpected end of data'); return v; }
	i8() { const v = this.u8(); return v > 127 ? v - 256 : v; }
	readBoolean() { return this.u8() !== 0; }
	readShort() { const v = (this.u8() << 8) | this.u8(); return v > 32767 ? v - 65536 : v; }
	readUShort() { return (this.u8() << 8) | this.u8(); }
	readInt() { return ((this.u8() << 24) | (this.u8() << 16) | (this.u8() << 8) | this.u8()) | 0; }
	readFloat() { for (let i = 0; i < 4; i++) f32buf.setUint8(i, this.u8()); return f32buf.getFloat32(0); }
	readFully(n) {
		if (this.src instanceof ArraySource) {
			const s = this.src;
			if (s.p + n > s.d.length) throw new CPMError('Unexpected end of data');
			const r = s.d.subarray(s.p, s.p + n); s.p += n; return r;
		}
		const r = new Uint8Array(n);
		for (let i = 0; i < n; i++) r[i] = this.u8();
		return r;
	}
	readVarInt() {
		let i = 0, j = 0, b;
		do {
			b = this.i8();
			i |= (b & 127) << (j++ * 7);
			if (j > 5) throw new CPMError('VarInt too big');
		} while ((b & 128) === 128);
		return i;
	}
	readSignedVarInt() {
		let b = this.i8();
		const sign = (b & 0x40) ? -1 : 1;
		let i = b & 0x3f, j = 6;
		while ((b & 0x80) !== 0) {
			b = this.i8();
			i |= (b & 127) << j;
			j += 7;
			if (j > 34) throw new CPMError('SignedVarInt too big');
		}
		return i * sign;
	}
	readUTF() {
		const n = this.readVarInt();
		if (n < 0) throw new CPMError('Bad string');
		if (n === 0) return '';
		return utf8.decode(this.readFully(n));
	}
	readFloat2() { return this.readShort() / DIV; }
	readVarFloat() { return this.readSignedVarInt() / DIV; }
	readVec3ub() { return { x: this.u8() / 10, y: this.u8() / 10, z: this.u8() / 10 }; }
	readVec6b() { return { x: this.readFloat2(), y: this.readFloat2(), z: this.readFloat2() }; }
	readVarVec3() { return { x: this.readVarFloat(), y: this.readVarFloat(), z: this.readVarFloat() }; }
	readAngle() {
		const k = 2 * Math.PI / 65535;
		return { x: this.readShort() * k, y: this.readShort() * k, z: this.readShort() * k };
	}
	read2s() { return { x: this.readShort(), y: this.readShort() }; }
	read2v() { return { x: this.readVarInt(), y: this.readVarInt() }; }
	readNextBlock() {
		const size = this.readVarInt();
		if (size > 16 * 1024 * 1024 || size < 0) throw new CPMError('Invalid block size: ' + size);
		return new IO(this.readFully(size));
	}
	// returns enum ordinal or -1 (Java returns null)
	readEnum(count) { const id = this.i8(); return (id >= count || id < 0) ? -1 : id; }
	readObjectBlock(count, reader) {
		const t = this.readEnum(count);
		const b = this.readNextBlock();
		if (t < 0) return null;
		return reader(t, b);
	}
	readByteArray() { const n = this.readVarInt(); if (n < 0) throw new CPMError('Bad array'); return this.readFully(n).slice(); }
	readBoolArray(size) {
		const f = new Array(size).fill(false);
		for (let j = 0; j < size; j += 8) {
			const dt = this.read();
			for (let k = 0; j + k < size && k < 8; k++) f[j + k] = (dt & (1 << k)) !== 0;
		}
		return f;
	}
	// ImageBlock: length prefixed PNG bytes
	readImageBytes() { const b = this.readNextBlock(); return b.bytes; }
	size() { return this.bytes ? this.bytes.length : 0; }
	available() { return this.bytes ? this.bytes.length - this.src.p : 0; }
	reset() { this.src.p = 0; }
	get pos() { return this.src.p; }
}

// ---------------------------------------------------------------------------
// Image: RGBA pixel buffer with Java style ARGB accessors
// ---------------------------------------------------------------------------
class Img {
	constructor(w, h, data) {
		this.width = w; this.height = h;
		this.data = data || new Uint8ClampedArray(w * h * 4);
		this.version = 0;
	}
	getRGB(x, y) {
		const i = (y * this.width + x) * 4, d = this.data;
		return ((d[i + 3] << 24) | (d[i] << 16) | (d[i + 1] << 8) | d[i + 2]) >>> 0;
	}
	setRGB(x, y, c) {
		const i = (y * this.width + x) * 4, d = this.data;
		d[i] = (c >>> 16) & 255; d[i + 1] = (c >>> 8) & 255; d[i + 2] = c & 255; d[i + 3] = (c >>> 24) & 255;
	}
	copy() { return new Img(this.width, this.height, new Uint8ClampedArray(this.data)); }
}

async function inflate(bytes, format) {
	const ds = new DecompressionStream(format);
	const stream = new Blob([bytes]).stream().pipeThrough(ds);
	const buf = await new Response(stream).arrayBuffer();
	return new Uint8Array(buf);
}

// Exact PNG decoder (no premultiplied alpha). Skin embedded model data lives
// in RGB+A bytes, so the browser canvas path (premultiplied) can corrupt it.
async function decodePNG(bytes) {
	const sig = [137, 80, 78, 71, 13, 10, 26, 10];
	for (let i = 0; i < 8; i++) if (bytes[i] !== sig[i]) throw new CPMError('Not a PNG image');
	const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	let p = 8, w = 0, h = 0, depth = 0, ctype = 0, interlace = 0;
	let palette = null, trns = null;
	const idat = [];
	while (p < bytes.length) {
		const len = dv.getUint32(p); const type = String.fromCharCode(bytes[p + 4], bytes[p + 5], bytes[p + 6], bytes[p + 7]);
		const data = bytes.subarray(p + 8, p + 8 + len);
		if (type === 'IHDR') { w = dv.getUint32(p + 8); h = dv.getUint32(p + 12); depth = data[8]; ctype = data[9]; interlace = data[12]; }
		else if (type === 'PLTE') palette = data;
		else if (type === 'tRNS') trns = data;
		else if (type === 'IDAT') idat.push(data);
		else if (type === 'IEND') break;
		p += 12 + len;
	}
	if (!w || !h) throw new CPMError('Bad PNG header');
	if (interlace || (depth !== 8 && !(ctype === 3 && depth < 8) && !(ctype === 0 && depth < 8) && depth !== 16)) {
		return decodeViaCanvas(bytes);
	}
	let total = 0; idat.forEach(c => total += c.length);
	const z = new Uint8Array(total); let o = 0; idat.forEach(c => { z.set(c, o); o += c.length; });
	const raw = await inflate(z, 'deflate');
	const chans = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ctype];
	const bpp = Math.max(1, (chans * depth) >> 3); // bytes per complete pixel (for filters)
	const stride = Math.ceil(w * chans * depth / 8);
	const cur = new Uint8Array(stride), prev = new Uint8Array(stride);
	const out = new Uint8ClampedArray(w * h * 4);
	let rp = 0;
	for (let y = 0; y < h; y++) {
		const ft = raw[rp++];
		for (let x = 0; x < stride; x++) {
			const rx = raw[rp++];
			const a = x >= bpp ? cur[x - bpp] : 0, b = prev[x], c = x >= bpp ? prev[x - bpp] : 0;
			let v;
			switch (ft) {
				case 0: v = rx; break;
				case 1: v = rx + a; break;
				case 2: v = rx + b; break;
				case 3: v = rx + ((a + b) >> 1); break;
				case 4: { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); v = rx + ((pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c)); break; }
				default: throw new CPMError('Bad PNG filter');
			}
			cur[x] = v & 255;
		}
		for (let x = 0; x < w; x++) {
			const oi = (y * w + x) * 4;
			let r, g, bb, al = 255;
			const sample = (ci) => { // 8 or 16 bit sample, returns 8 bit
				if (depth === 16) return cur[(x * chans + ci) * 2];
				return cur[x * chans + ci];
			};
			if (ctype === 6) { r = sample(0); g = sample(1); bb = sample(2); al = sample(3); }
			else if (ctype === 2) {
				r = sample(0); g = sample(1); bb = sample(2);
				if (trns && depth === 8 && trns.length >= 6 && r === trns[1] && g === trns[3] && bb === trns[5]) al = 0;
			}
			else if (ctype === 4) { r = g = bb = sample(0); al = sample(1); }
			else if (ctype === 0) {
				if (depth < 8) { const per = 8 / depth, byte = cur[Math.floor(x / per)], sh = (per - 1 - (x % per)) * depth; const val = (byte >> sh) & ((1 << depth) - 1); r = g = bb = Math.round(val * 255 / ((1 << depth) - 1)); }
				else r = g = bb = sample(0);
			}
			else if (ctype === 3) {
				let idx;
				if (depth < 8) { const per = 8 / depth, byte = cur[Math.floor(x / per)], sh = (per - 1 - (x % per)) * depth; idx = (byte >> sh) & ((1 << depth) - 1); }
				else idx = cur[x];
				r = palette[idx * 3]; g = palette[idx * 3 + 1]; bb = palette[idx * 3 + 2];
				al = trns && idx < trns.length ? trns[idx] : 255;
			}
			out[oi] = r; out[oi + 1] = g; out[oi + 2] = bb; out[oi + 3] = al;
		}
		prev.set(cur);
	}
	return new Img(w, h, out);
}

async function decodeViaCanvas(bytes) {
	const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
	const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
	const g = c.getContext('2d'); g.drawImage(bmp, 0, 0);
	return new Img(bmp.width, bmp.height, new Uint8ClampedArray(g.getImageData(0, 0, bmp.width, bmp.height).data));
}

async function decodeImage(bytes) {
	if (bytes[0] === 137 && bytes[1] === 80) return decodePNG(bytes);
	return decodeViaCanvas(bytes);
}

// ---------------------------------------------------------------------------
// ZIP (cpmproject files)
// ---------------------------------------------------------------------------
async function readZip(bytes) {
	const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	let eocd = -1;
	for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
		if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
	}
	if (eocd < 0) throw new CPMError('Not a zip archive');
	const count = dv.getUint16(eocd + 10, true);
	let p = dv.getUint32(eocd + 16, true);
	const files = new Map();
	for (let n = 0; n < count; n++) {
		if (dv.getUint32(p, true) !== 0x02014b50) throw new CPMError('Bad zip directory');
		const method = dv.getUint16(p + 10, true);
		const csize = dv.getUint32(p + 20, true);
		const nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
		const lho = dv.getUint32(p + 42, true);
		const name = utf8.decode(bytes.subarray(p + 46, p + 46 + nlen)).replace(/\\/g, '/');
		p += 46 + nlen + xlen + clen;
		if (name.endsWith('/')) continue;
		const lnlen = dv.getUint16(lho + 26, true), lxlen = dv.getUint16(lho + 28, true);
		const start = lho + 30 + lnlen + lxlen;
		const raw = bytes.subarray(start, start + csize);
		files.set(name, { method, raw });
	}
	return {
		names: () => [...files.keys()],
		has: (n) => files.has(n),
		async get(n) {
			const f = files.get(n);
			if (!f) return null;
			if (f.method === 0) return f.raw;
			if (f.method === 8) return inflate(f.raw, 'deflate-raw');
			throw new CPMError('Unsupported zip compression in ' + n);
		}
	};
}

// JSON parse keeping 64-bit storeIDs exact (they are longs in Java)
function parseJsonLong(text) {
	text = text.replace(/("storeID"\s*:\s*)(-?\d+)/g, '$1"$2"');
	return JSON.parse(text);
}
