// ---------------------------------------------------------------------------
// Static assets (template textures, example model).
// Loaded with fetch from assets/; a single-file build can predefine
// ASSET_DATA = {name: base64} to embed them instead.
// ---------------------------------------------------------------------------
'use strict';

const ASSET_PATHS = {
	free_space_template: 'assets/textures/free_space_template.png', // skin data layout used by CPM
	default_skin: 'assets/textures/default.png',
	slim_skin: 'assets/textures/slim.png',
	cape: 'assets/textures/cape.png',
	elytra: 'assets/textures/elytra.png',
	armor1: 'assets/textures/armor1.png',
	armor2: 'assets/textures/armor2.png',
	demo_project: 'assets/examples/animation_status_test.cpmproject',
};
const _assetCache = {};

async function getAsset(name) {
	if (_assetCache[name]) return _assetCache[name];
	let bytes;
	if (typeof ASSET_DATA !== 'undefined' && ASSET_DATA[name]) bytes = b64ToBytes(ASSET_DATA[name]);
	else {
		const r = await fetch(ASSET_PATHS[name]);
		if (!r.ok) throw new CPMError('Missing asset ' + ASSET_PATHS[name] + ' (HTTP ' + r.status + ')');
		bytes = new Uint8Array(await r.arrayBuffer());
	}
	_assetCache[name] = bytes;
	return bytes;
}
