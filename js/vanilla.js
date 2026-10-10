// ---------------------------------------------------------------------------
// Vanilla Minecraft player animation (HumanoidModel.setupAnim + renderer
// rotations) and the per-frame animation driver.
// ---------------------------------------------------------------------------
'use strict';

const PI = Math.PI;
const lerp = (t, a, b) => a + t * (b - a);
function rotlerpRad(t, a, b) {
	let d = (b - a) % (2 * PI);
	if (d < -PI) d += 2 * PI;
	if (d >= PI) d -= 2 * PI;
	return a + t * d;
}
const quadArm = (x) => -65 * x + x * x;

// Movement presets selectable in the UI
const MOVEMENTS = [
	{ id: 'STANDING', label: 'Standing' },
	{ id: 'WALKING', label: 'Walking' },
	{ id: 'RUNNING', label: 'Running' },
	{ id: 'SNEAKING', label: 'Sneaking' },
	{ id: 'SNEAK_WALK', label: 'Sneak walking' },
	{ id: 'JUMPING', label: 'Jumping' },
	{ id: 'FALLING', label: 'Falling' },
	{ id: 'SWIMMING', label: 'Swimming' },
	{ id: 'CRAWLING', label: 'Crawling' },
	{ id: 'RETRO_SWIMMING', label: 'Retro swimming' },
	{ id: 'FLYING', label: 'Elytra flying' },
	{ id: 'CREATIVE_FLYING', label: 'Creative flying' },
	{ id: 'RIDING', label: 'Riding' },
	{ id: 'SLEEPING', label: 'Sleeping' },
	{ id: 'DYING', label: 'Dying' },
	{ id: 'ON_LADDER', label: 'On ladder' },
	{ id: 'CLIMBING_ON_LADDER', label: 'Climbing ladder' },
	{ id: 'TRIDENT_SPIN', label: 'Riptide spin' },
];

const HAND_ACTIONS = [
	{ id: 'NONE', label: 'Empty' },
	{ id: 'ITEM', label: 'Holding item' },
	{ id: 'PUNCH', label: 'Punching' },
	{ id: 'BLOCK', label: 'Blocking' },
	{ id: 'BOW', label: 'Drawing bow' },
	{ id: 'CROSSBOW_CHARGE', label: 'Charging crossbow' },
	{ id: 'CROSSBOW_HOLD', label: 'Aiming crossbow' },
	{ id: 'TRIDENT', label: 'Throwing trident' },
	{ id: 'SPYGLASS', label: 'Spyglass' },
	{ id: 'TOOT_HORN', label: 'Goat horn' },
	{ id: 'BRUSH', label: 'Brushing' },
	{ id: 'EAT', label: 'Eating' },
	{ id: 'SPEAR', label: 'Spear' },
];

const STATUS_FLAGS = [
	{ id: 'armorHead', label: 'Helmet', pose: 'ARMOR_HEAD' },
	{ id: 'armorBody', label: 'Chestplate', pose: 'ARMOR_BODY' },
	{ id: 'armorLegs', label: 'Leggings', pose: 'ARMOR_LEGS' },
	{ id: 'armorBoots', label: 'Boots', pose: 'ARMOR_BOOTS' },
	{ id: 'elytra', label: 'Elytra', pose: 'WEARING_ELYTRA' },
	{ id: 'skull', label: 'Skull on head', pose: 'WEARING_SKULL' },
	{ id: 'parrotLeft', label: 'Parrot left', pose: 'PARROT_LEFT' },
	{ id: 'parrotRight', label: 'Parrot right', pose: 'PARROT_RIGHT' },
	{ id: 'hurt', label: 'Hurt', pose: 'HURT' },
	{ id: 'onFire', label: 'On fire', pose: 'ON_FIRE' },
	{ id: 'freezing', label: 'Freezing', pose: 'FREEZING' },
	{ id: 'speaking', label: 'Speaking', pose: 'SPEAKING' },
	{ id: 'voiceMuted', label: 'Voice muted', pose: 'VOICE_MUTED' },
	{ id: 'invisible', label: 'Invisible', pose: 'INVISIBLE' },
	{ id: 'inGui', label: 'In inventory', pose: 'IN_GUI' },
	{ id: 'inMenu', label: 'In menu', pose: 'IN_MENU' },
	{ id: 'firstPersonMod', label: 'First person mod', pose: 'FIRST_PERSON_MOD' },
	{ id: 'vrFirst', label: 'VR first person', pose: 'VR_FIRST_PERSON' },
	{ id: 'vrSitting', label: 'VR sitting', pose: 'VR_THIRD_PERSON_SITTING' },
	{ id: 'vrStanding', label: 'VR standing', pose: 'VR_THIRD_PERSON_STANDING' },
];

function defaultViewState() {
	return {
		movement: 'STANDING',
		leftHand: 'NONE', rightHand: 'NONE',
		flags: {},
		headYaw: 0, headPitch: 0,
		health: 1, hunger: 1, air: 1, light: 15, speakLevel: 0.6,
		bowPull: -1, crossbowPull: -1, // -1 = animate automatically
	};
}

// Build an AnimationState (CPM) for the current time from the UI state
function buildAnimState(vs, time, gestureData, reg) {
	const f = vs.flags;
	const mv = vs.movement;
	const s = {
		gestureData, health: vs.health, hunger: vs.hunger, air: vs.air, skyLight: vs.light, blockLight: 0,
		yaw: vs.headYaw, bodyYaw: 0, pitch: vs.headPitch, speakLevel: f.speaking ? vs.speakLevel : 0,
		attackTime: 0, bowPullback: 0, crossbowPullback: 0, swingingHand: 'RIGHT', activeHand: 'RIGHT',
		moveAmountX: 0, moveAmountY: 0, moveAmountZ: 0,
		sleeping: mv === 'SLEEPING', dying: mv === 'DYING', elytraFlying: mv === 'FLYING', tridentSpin: mv === 'TRIDENT_SPIN',
		falling: mv === 'FALLING' ? 10 : 0, riding: mv === 'RIDING', creativeFlying: mv === 'CREATIVE_FLYING',
		crawling: mv === 'CRAWLING', swimming: mv === 'SWIMMING' || mv === 'CRAWLING', retroSwimming: mv === 'RETRO_SWIMMING',
		isOnLadder: mv === 'ON_LADDER' || mv === 'CLIMBING_ON_LADDER', sneaking: mv === 'SNEAKING' || mv === 'SNEAK_WALK',
		sprinting: mv === 'RUNNING', jumping: -1e9,
	};
	if (mv === 'WALKING' || mv === 'RUNNING' || mv === 'SNEAK_WALK' || mv === 'RETRO_SWIMMING') s.moveAmountZ = 0.2;
	if (mv === 'CLIMBING_ON_LADDER') s.moveAmountY = 0.1;
	if (mv === 'JUMPING') s.jumping = time - (time % 1000);
	// hands
	const handPose = (h) => ({ ITEM: 'ITEM', EAT: 'ITEM', BLOCK: 'BLOCK', BOW: 'BOW_AND_ARROW', CROSSBOW_CHARGE: 'CROSSBOW_CHARGE', CROSSBOW_HOLD: 'CROSSBOW_HOLD', TRIDENT: 'THROW_SPEAR', SPYGLASS: 'SPYGLASS', TOOT_HORN: 'TOOT_HORN', BRUSH: 'BRUSH', SPEAR: 'SPEAR' }[h] || 'EMPTY');
	s.leftArm = handPose(vs.leftHand); s.rightArm = handPose(vs.rightHand);
	s.usingAnimation = 'NONE';
	if (vs.rightHand === 'EAT' || vs.leftHand === 'EAT') { s.usingAnimation = 'EAT'; s.activeHand = vs.rightHand === 'EAT' ? 'RIGHT' : 'LEFT'; }
	if (vs.rightHand === 'SPEAR' || vs.leftHand === 'SPEAR') s.usingAnimation = 'SPEAR';
	const punch = vs.rightHand === 'PUNCH' ? 'RIGHT' : vs.leftHand === 'PUNCH' ? 'LEFT' : null;
	if (punch) { const c = (time % 600) / 300; s.attackTime = c < 1 ? c : 0; s.swingingHand = punch; }
	const cyc = (time % 1500) / 1200;
	s.bowPullback = vs.bowPull >= 0 ? vs.bowPull : Math.min(1, cyc);
	s.crossbowPullback = vs.crossbowPull >= 0 ? vs.crossbowPull : Math.min(1, cyc);
	s.hasSkullOnHead = !!f.skull; s.wearingHelm = !!f.armorHead; s.wearingBody = !!f.armorBody; s.wearingLegs = !!f.armorLegs; s.wearingBoots = !!f.armorBoots; s.wearingElytra = !!f.elytra;
	s.parrotLeft = !!f.parrotLeft; s.parrotRight = !!f.parrotRight;
	s.hurtTime = f.hurt ? ((time % 1000) < 500 ? 10 : 0) : 0;
	s.isBurning = !!f.onFire; s.isFreezing = !!f.freezing; s.inGui = !!f.inGui; s.firstPersonMod = !!f.firstPersonMod; s.voiceMuted = !!f.voiceMuted; s.invisible = !!f.invisible;
	s.inMenu = !!f.inMenu;
	s.vrState = f.vrFirst ? 'FIRST_PERSON' : f.vrSitting ? 'THIRD_PERSON_SITTING' : f.vrStanding ? 'THIRD_PERSON_STANDING' : null;
	return s;
}

// AnimationState.getMainPose
function getMainPose(s, time, reg) {
	if (s.sleeping) return 'SLEEPING';
	if (s.dying) return 'DYING';
	if (s.elytraFlying) return 'FLYING';
	if (s.tridentSpin) return 'TRIDENT_SPIN';
	if (s.falling > 4) return 'FALLING';
	if (s.riding) return 'RIDING';
	if (s.creativeFlying) return 'CREATIVE_FLYING';
	if (s.crawling && reg.hasPoseAnimations('CRAWLING')) return 'CRAWLING';
	if (s.swimming) return 'SWIMMING';
	if (s.retroSwimming && reg.hasPoseAnimations('RETRO_SWIMMING')) return 'RETRO_SWIMMING';
	if (s.isOnLadder && Math.abs(s.moveAmountY) > 0.05 && reg.hasPoseAnimations('CLIMBING_ON_LADDER')) return 'CLIMBING_ON_LADDER';
	if (s.isOnLadder && reg.hasPoseAnimations('ON_LADDER')) return 'ON_LADDER';
	if (s.jumping + 500 > time && reg.hasPoseAnimations('JUMPING')) return 'JUMPING';
	if (s.sneaking) return (Math.abs(s.moveAmountX) > 0 || Math.abs(s.moveAmountZ) > 0) && reg.hasPoseAnimations('SNEAK_WALK') ? 'SNEAK_WALK' : 'SNEAKING';
	if (s.sprinting) return 'RUNNING';
	if (Math.abs(s.moveAmountX) > 0 || Math.abs(s.moveAmountZ) > 0) return 'WALKING';
	return 'STANDING';
}

function armPoseToVanilla(pose, left, s) {
	switch (pose) {
		case 'BLOCK': return left ? 'BLOCKING_LEFT' : 'BLOCKING_RIGHT';
		case 'BOW_AND_ARROW': return left ? 'BOW_LEFT' : 'BOW_RIGHT';
		case 'CROSSBOW_CHARGE': return left ? 'CROSSBOW_CH_LEFT' : 'CROSSBOW_CH_RIGHT';
		case 'CROSSBOW_HOLD': return left ? 'CROSSBOW_LEFT' : 'CROSSBOW_RIGHT';
		case 'ITEM': return left ? 'HOLDING_LEFT' : 'HOLDING_RIGHT';
		case 'SPYGLASS': return left ? 'SPYGLASS_LEFT' : 'SPYGLASS_RIGHT';
		case 'THROW_SPEAR': return left ? 'TRIDENT_LEFT' : 'TRIDENT_RIGHT';
		case 'TOOT_HORN': return left ? 'TOOT_HORN_LEFT' : 'TOOT_HORN_RIGHT';
		case 'BRUSH': return left ? 'BRUSH_LEFT' : 'BRUSH_RIGHT';
		case 'SPEAR': return s.usingAnimation === 'SPEAR' ? (left ? 'SPEAR_LEFT' : 'SPEAR_RIGHT') : (left ? 'HOLDING_LEFT' : 'HOLDING_RIGHT');
		default: return null;
	}
}

// AnimationState.collectAnimations
function collectPoses(s, h) {
	h('GLOBAL');
	if (s.attackTime > 0) h(s.swingingHand === 'LEFT' ? 'PUNCH_LEFT' : 'PUNCH_RIGHT');
	if (s.hasSkullOnHead) h('WEARING_SKULL'); else if (s.wearingHelm) h('ARMOR_HEAD');
	if (s.wearingElytra) h('WEARING_ELYTRA'); else if (s.wearingBody) h('ARMOR_BODY');
	if (s.wearingLegs) h('ARMOR_LEGS');
	if (s.wearingBoots) h('ARMOR_BOOTS');
	let p = armPoseToVanilla(s.leftArm, true, s); if (p) h(p);
	p = armPoseToVanilla(s.rightArm, false, s); if (p) h(p);
	if (s.usingAnimation === 'EAT' || s.usingAnimation === 'DRINK') h(s.activeHand === 'LEFT' ? 'EATING_LEFT' : 'EATING_RIGHT');
	if (s.parrotLeft) h('PARROT_LEFT');
	if (s.parrotRight) h('PARROT_RIGHT');
	if (s.hurtTime > 0) h('HURT');
	if (s.isBurning) h('ON_FIRE');
	if (s.isFreezing) h('FREEZING');
	if (s.speakLevel > 0.1) h('SPEAKING');
	if (s.inGui) h('IN_GUI');
	if (s.firstPersonMod) h('FIRST_PERSON_MOD');
	if (s.voiceMuted) h('VOICE_MUTED');
	if (s.vrState === 'FIRST_PERSON') h('VR_FIRST_PERSON');
	else if (s.vrState === 'THIRD_PERSON_SITTING') h('VR_THIRD_PERSON_SITTING');
	else if (s.vrState === 'THIRD_PERSON_STANDING') h('VR_THIRD_PERSON_STANDING');
	if (s.inMenu) h('IN_MENU');
	h('HEALTH'); h('HUNGER'); h('AIR');
	if (s.invisible) h('INVISIBLE');
	h('LIGHT'); h('HEAD_ROTATION_YAW'); h('HEAD_ROTATION_PITCH');
}

// ---------------------------------------------------------------------------
// Vanilla model pose. Returns {parts:{HEAD:{x,y,z,rx,ry,rz},...}, entity:{...}}
// ---------------------------------------------------------------------------
function vanillaPose(vs, s, time, slim) {
	const ticks = time / 50;
	const mv = vs.movement;
	const P = {};
	const part = (x, y, z) => ({ x, y, z, rx: 0, ry: 0, rz: 0 });
	P.HEAD = part(0, 0, 0); P.BODY = part(0, 0, 0);
	P.RIGHT_ARM = part(-5, 2, 0); P.LEFT_ARM = part(5, 2, 0);
	P.RIGHT_LEG = part(-1.9, 12, 0); P.LEFT_LEG = part(1.9, 12, 0);
	const crouching = s.sneaking && !s.swimming && !s.elytraFlying && !s.sleeping;
	let lsa = 0, ls = 0;
	if (mv === 'WALKING' || mv === 'CLIMBING_ON_LADDER') { lsa = 0.85; ls = ticks * 0.85 * 0.85; }
	else if (mv === 'RUNNING') { lsa = 1; ls = ticks * 1.1; }
	else if (mv === 'SNEAK_WALK') { lsa = 0.35; ls = ticks * 0.35 * 1.0; }
	else if (mv === 'SWIMMING' || mv === 'CRAWLING') { lsa = 0.6; ls = ticks * 0.6; }
	else if (mv === 'RETRO_SWIMMING') { lsa = 0.4; ls = ticks * 0.4; }
	if (mv === 'SLEEPING' || mv === 'DYING' || mv === 'RIDING') { lsa = 0; ls = 0; }
	const flying = s.elytraFlying;
	let swimAmount = (mv === 'SWIMMING' || mv === 'CRAWLING') ? 1 : 0;
	const netHeadYaw = mv === 'SLEEPING' ? 0 : vs.headYaw, headPitch = mv === 'SLEEPING' ? 0 : vs.headPitch;
	const H = P.HEAD;
	H.ry = netHeadYaw * PI / 180;
	if (flying) H.rx = -PI / 4;
	else if (swimAmount > 0) H.rx = (mv === 'SWIMMING' || mv === 'CRAWLING') ? rotlerpRad(swimAmount, headPitch * PI / 180, -PI / 4) : headPitch * PI / 180;
	else H.rx = headPitch * PI / 180;
	P.BODY.ry = 0;
	let fdiv = 1;
	if (flying) fdiv = 1;
	const RA = P.RIGHT_ARM, LA = P.LEFT_ARM, RL = P.RIGHT_LEG, LL = P.LEFT_LEG;
	RA.rx = Math.cos(ls * 0.6662 + PI) * 2 * lsa * 0.5 / fdiv;
	LA.rx = Math.cos(ls * 0.6662) * 2 * lsa * 0.5 / fdiv;
	RL.rx = Math.cos(ls * 0.6662) * 1.4 * lsa / fdiv;
	LL.rx = Math.cos(ls * 0.6662 + PI) * 1.4 * lsa / fdiv;
	RL.ry = 0.005; LL.ry = -0.005; RL.rz = 0.005; LL.rz = -0.005;
	if (s.riding) {
		RA.rx += -PI / 5; LA.rx += -PI / 5;
		RL.rx = -1.4137167; RL.ry = PI / 10; RL.rz = 0.07853982;
		LL.rx = -1.4137167; LL.ry = -PI / 10; LL.rz = -0.07853982;
	}
	RA.ry = 0; LA.ry = 0;
	const poseArm = (arm, pose, right) => {
		const sg = right ? 1 : -1;
		switch (pose) {
			case 'EMPTY': arm.ry = 0; break;
			case 'BLOCK': arm.rx = arm.rx * 0.5 - 0.9424779; arm.ry = -sg * PI / 6; break;
			case 'ITEM': case 'SPEAR': arm.rx = arm.rx * 0.5 - PI / 10; arm.ry = 0; break;
			case 'THROW_SPEAR': arm.rx = arm.rx * 0.5 - PI; arm.ry = 0; break;
			case 'BOW_AND_ARROW':
				if (right) { RA.ry = -0.1 + H.ry; LA.ry = 0.1 + H.ry + 0.4; } else { RA.ry = -0.1 + H.ry - 0.4; LA.ry = 0.1 + H.ry; }
				RA.rx = -PI / 2 + H.rx; LA.rx = -PI / 2 + H.rx; break;
			case 'CROSSBOW_CHARGE': {
				const main = right ? RA : LA, off = right ? LA : RA;
				main.ry = right ? -0.8 : 0.8; main.rx = -0.97079635; off.rx = main.rx;
				const f = clamp(s.crossbowPullback, 0, 1);
				off.ry = lerp(f, 0.4, 0.85) * (right ? 1 : -1);
				off.rx = lerp(f, off.rx, -PI / 2);
				break;
			}
			case 'CROSSBOW_HOLD': {
				const main = right ? RA : LA, off = right ? LA : RA;
				main.ry = (right ? -0.3 : 0.3) + H.ry; off.ry = (right ? 0.6 : -0.6) + H.ry;
				main.rx = -PI / 2 + H.rx + 0.1; off.rx = -1.5 + H.rx; break;
			}
			case 'SPYGLASS': arm.rx = clamp(H.rx - 1.9198622 - (crouching ? 0.2617994 : 0), -2.4, 3.3); arm.ry = H.ry - sg * 0.2617994; break;
			case 'TOOT_HORN': arm.rx = clamp(H.rx, -1.2, 1.2) - 1.4835298; arm.ry = H.ry - sg * PI / 6; break;
			case 'BRUSH': arm.rx = arm.rx * 0.5 - PI / 5; arm.ry = 0; break;
			default: break;
		}
	};
	// two handed poses take priority (right handed player)
	const twoHanded = (p) => p === 'BOW_AND_ARROW' || p === 'CROSSBOW_CHARGE' || p === 'CROSSBOW_HOLD';
	if (twoHanded(s.leftArm) && !twoHanded(s.rightArm)) { poseArm(RA, s.rightArm, true); poseArm(LA, s.leftArm, false); }
	else { poseArm(LA, s.leftArm, false); poseArm(RA, s.rightArm, true); }
	// attack
	if (s.attackTime > 0) {
		const left = s.swingingHand === 'LEFT';
		const arm = left ? LA : RA;
		let f = s.attackTime;
		P.BODY.ry = Math.sin(Math.sqrt(f) * 2 * PI) * 0.2;
		if (left) P.BODY.ry *= -1;
		RA.z = Math.sin(P.BODY.ry) * 5; RA.x = -Math.cos(P.BODY.ry) * 5;
		LA.z = -Math.sin(P.BODY.ry) * 5; LA.x = Math.cos(P.BODY.ry) * 5;
		RA.ry += P.BODY.ry; LA.ry += P.BODY.ry; LA.rx += P.BODY.ry;
		f = 1 - s.attackTime; f *= f; f *= f; f = 1 - f;
		const f1 = Math.sin(f * PI);
		const f2 = Math.sin(s.attackTime * PI) * -(H.rx - 0.7) * 0.75;
		arm.rx -= f1 * 1.2 + f2;
		arm.ry += P.BODY.ry * 2;
		arm.rz += Math.sin(s.attackTime * PI) * -0.4;
	}
	if (crouching) {
		P.BODY.rx = 0.5; RA.rx += 0.4; LA.rx += 0.4;
		RL.z = 4; LL.z = 4; RL.y = 12.2; LL.y = 12.2; H.y = 4.2; P.BODY.y = 3.2; LA.y = 5.2; RA.y = 5.2;
	}
	if (s.rightArm !== 'SPYGLASS') { RA.rz += Math.cos(ticks * 0.09) * 0.05 + 0.05; RA.rx += Math.sin(ticks * 0.067) * 0.05; }
	if (s.leftArm !== 'SPYGLASS') { LA.rz -= Math.cos(ticks * 0.09) * 0.05 + 0.05; LA.rx -= Math.sin(ticks * 0.067) * 0.05; }
	if (swimAmount > 0) {
		const f5 = ls % 26;
		const f1 = (s.swingingHand === 'RIGHT' && s.attackTime > 0) ? 0 : swimAmount;
		const f2 = (s.swingingHand === 'LEFT' && s.attackTime > 0) ? 0 : swimAmount;
		if (f5 < 14) {
			LA.rx = rotlerpRad(f2, LA.rx, 0); RA.rx = lerp(f1, RA.rx, 0);
			LA.ry = rotlerpRad(f2, LA.ry, PI); RA.ry = lerp(f1, RA.ry, PI);
			LA.rz = rotlerpRad(f2, LA.rz, PI + 1.8707964 * quadArm(f5) / quadArm(14));
			RA.rz = lerp(f1, RA.rz, PI - 1.8707964 * quadArm(f5) / quadArm(14));
		} else if (f5 < 22) {
			const f6 = (f5 - 14) / 8;
			LA.rx = rotlerpRad(f2, LA.rx, PI / 2 * f6); RA.rx = lerp(f1, RA.rx, PI / 2 * f6);
			LA.ry = rotlerpRad(f2, LA.ry, PI); RA.ry = lerp(f1, RA.ry, PI);
			LA.rz = rotlerpRad(f2, LA.rz, 5.012389 - 1.8707964 * f6); RA.rz = lerp(f1, RA.rz, 1.2707963 + 1.8707964 * f6);
		} else {
			const f3 = (f5 - 22) / 4;
			LA.rx = rotlerpRad(f2, LA.rx, PI / 2 - PI / 2 * f3); RA.rx = lerp(f1, RA.rx, PI / 2 - PI / 2 * f3);
			LA.ry = rotlerpRad(f2, LA.ry, PI); RA.ry = lerp(f1, RA.ry, PI);
			LA.rz = rotlerpRad(f2, LA.rz, PI); RA.rz = lerp(f1, RA.rz, PI);
		}
		LL.rx = lerp(swimAmount, LL.rx, 0.3 * Math.cos(ls * 0.33333334 + PI));
		RL.rx = lerp(swimAmount, RL.rx, 0.3 * Math.cos(ls * 0.33333334));
	}
	if (mv === 'SLEEPING') { // arms/legs relaxed
		for (const k of ['RIGHT_ARM', 'LEFT_ARM']) { P[k].rx = 0; P[k].ry = 0; P[k].rz = k === 'RIGHT_ARM' ? 0.05 : -0.05; }
	}
	// cape (CapeLayer, no chestplate)
	const capeBob = (lsa > 0 && !swimAmount) ? Math.sin(ls * 0.6662 * 0.5) * 6 * lsa : 0;
	let q = capeBob + (crouching ? 25 : 0), r = (mv === 'RUNNING' ? 60 : (lsa > 0 ? 30 * lsa : 0)) + (mv === 'FALLING' ? 0 : 0);
	if (mv === 'FALLING' || mv === 'JUMPING') q -= 3;
	r = clamp(r, 0, 150);
	P.CAPE = { x: 0, y: crouching ? 1.85 + 1 - 0.5 : 0, z: crouching ? 1.4 + 0.375 : 2, rx: -(6 + q / 2 + r) * PI / 180, ry: PI, rz: 0 };
	if (!s.wearingBody && !crouching) { P.CAPE.y = 0; P.CAPE.z = 2; }
	if (s.wearingBody) { P.CAPE.z = crouching ? 0.3 + 2 : -1.1 + 4; P.CAPE.y = crouching ? 1.1 : 0.15; }
	// elytra (ElytraModel.setupAnim, ElytraLayer translates 2px back)
	let ex = 0.2617994, ez = -0.2617994, ey = 0, eyr = 0;
	if (flying) { ex = 0.34906584 + 0.6 * 0.3; ez = -PI / 2 * 0.95; }
	else if (crouching) { ex = 0.6981317; ez = -PI / 4; ey = 3; eyr = 0.08726646; }
	P.ELYTRA_LEFT = { x: 5, y: ey + (crouching ? P.BODY.y - 3 : 0), z: 2, rx: ex, ry: eyr, rz: ez };
	P.ELYTRA_RIGHT = { x: -5, y: P.ELYTRA_LEFT.y, z: 2, rx: ex, ry: -eyr, rz: -ez };
	if (crouching) { P.ELYTRA_LEFT.rx += 0; }
	if (vs.noVanilla) {
		P.HEAD = part(0, 0, 0); P.BODY = part(0, 0, 0);
		P.RIGHT_ARM = part(-5, 2, 0); P.LEFT_ARM = part(5, 2, 0);
		P.RIGHT_LEG = part(-1.9, 12, 0); P.LEFT_LEG = part(1.9, 12, 0);
	}
	// armor parts copy the player part they belong to
	for (const k of Object.keys(ROOT_COPY_FROM)) P[k] = { ...P[ROOT_COPY_FROM[k]] };

	// whole entity transform (LivingEntityRenderer / PlayerRenderer.setupRotations)
	const E = { y: 0, z: 0, rotX: 0, rotY: 0, rotZ: 0, steps: [] };
	if (mv === 'DYING') {
		const dt = (time % 3000) / 50;
		let f = (dt - 1) / 20 * 1.6; f = Math.sqrt(Math.max(0, f)); if (f > 1) f = 1;
		E.steps.push(['z', f * 90]);
	} else if (mv === 'SLEEPING') {
		E.steps.push(['y', 0], ['z', 90], ['y', 270]);
		E.sleeping = true;
	} else if (flying) {
		E.steps.push(['x', -90]);
	} else if (mv === 'TRIDENT_SPIN') {
		E.steps.push(['x', -90], ['y', ticks * -75]);
	} else if (swimAmount > 0) {
		E.steps.push(['x', -90]);
		E.steps.push(['t', 0, -1, 0.3]);
	}
	if (mv === 'JUMPING') { const t = (time % 1000) / 1000; E.lift = t < 0.45 ? Math.sin(t / 0.45 * PI) * 1.25 : 0; }
	if (mv === 'RIDING') E.lift = 0.5;
	return { parts: P, entity: E };
}

// ---------------------------------------------------------------------------
// Animation driver for one loaded definition (AnimationEngine port)
// ---------------------------------------------------------------------------
class AnimationDriver {
	constructor(def) {
		this.def = def;
		this.handler = new AnimationHandler();
		this.gestureData = def.reg.params.createSyncParams();
		if (this.gestureData.length < 2) { const g = new Int8Array(2); g.set(this.gestureData); this.gestureData = g; }
		this.currentPose = 'STANDING'; this.prevPose = null;
		this.gestureTimer = -1;
		this.state = null;
	}
	getValue(id) { return id >= 0 && id < this.gestureData.length ? this.gestureData[id] : 0; }
	setValue(id, v) { if (id >= 0 && id < this.gestureData.length) this.gestureData[id] = (v << 24) >> 24; }
	// SimpleParameterValueAction semantics (toggle)
	toggleSimple(param, value) {
		const sv = (value << 24) >> 24;
		if (this.getValue(param) === sv) this.setValue(param, 0); else this.setValue(param, value);
	}
	activateButton(btn, time) {
		if (btn.type === 'POSE' || btn.type === 'GESTURE') {
			this.toggleSimple(btn.parameter, btn.id);
			if (btn.type === 'GESTURE' && btn.gestureTimeout > 0 && this.getValue(1) !== 0) this.gestureTimer = time + btn.gestureTimeout * 50;
		} else if (btn.type === 'BOOL_PARAMETER_TOGGLE') {
			let v = this.getValue(btn.parameter); v ^= btn.mask; this.setValue(btn.parameter, v);
		}
	}
	isActive(btn) {
		if (btn.type === 'POSE' || btn.type === 'GESTURE') return this.getValue(btn.parameter) === ((btn.id << 24) >> 24);
		if (btn.type === 'BOOL_PARAMETER_TOGGLE') return (this.getValue(btn.parameter) & btn.mask) === btn.mask;
		return false;
	}
	getSlider(btn) { const max = btn.maxValue || 255; return Math.round((this.getValue(btn.parameter) & 255) * max / 255); }
	setSlider(btn, v) { const max = btn.maxValue || 255; this.setValue(btn.parameter, Math.round(v * 255 / max)); }
	getDropdown(btn) {
		if (btn.type === 'LEGACY_DROPDOWN') { for (const [k, p] of btn.params) if (p >= 0 && this.getValue(p) > 0) return k; return ''; }
		const v = this.getValue(btn.parameter) & 255; return btn.opts[v] != null ? btn.opts[v] : '';
	}
	setDropdown(btn, sel) {
		if (btn.type === 'LEGACY_DROPDOWN') { for (const [k, p] of btn.params) if (p >= 0) this.setValue(p, k === sel ? 1 : 0); return; }
		const i = btn.opts.indexOf(sel); this.setValue(btn.parameter, i === -1 ? 0 : i);
	}
	resetParams() {
		this.gestureData = this.def.reg.params.createSyncParams();
		if (this.gestureData.length < 2) { const g = new Int8Array(2); g.set(this.gestureData); this.gestureData = g; }
		this.handler.clear();
	}
	// one frame: returns vanilla pose info for rendering
	update(vs, time) {
		const def = this.def, reg = def.reg;
		if (this.gestureTimer >= 0 && time >= this.gestureTimer) { this.setValue(1, 0); this.gestureTimer = -1; }
		const s = buildAnimState(vs, time, this.gestureData, reg);
		this.state = s;
		const main = getMainPose(s, time, reg);
		this.mainPose = main;
		if (this.gestureData[0] === 0) this.currentPose = main;
		else this.currentPose = reg.getPoseById(this.gestureData[0], this.currentPose);
		reg.tickAnimated(time);
		const h = this.handler;
		h.addAnimations(s, reg.getPoseAnimations(this.currentPose));
		this.activePoses = [this.currentPose];
		collectPoses(s, (p) => { this.activePoses.push(p); h.addAnimations(s, reg.getPoseAnimations(p)); });
		try { h.animate(s, time, def); }
		catch (e) { console.warn('Animation error', e); def.resetAnimationPos(); h.clear(); }
		const vp = vanillaPose(vs, s, time, def.skinType === 'SLIM');
		// root parts: vanilla pose + offsets
		for (const [part, pr] of def.roots) {
			const v = vp.parts[part];
			if (!v) continue;
			pr.elements.forEach(e => e.setPosAndRot(v.x, v.y, v.z, v.rx, v.ry, v.rz));
		}
		if (def.removeArmorOffset) {
			for (const [part, pr] of def.roots) {
				const from = ROOT_COPY_FROM[part];
				if (!from) continue;
				const src = def.getModelElementFor(from).getMainRoot();
				pr.elements.forEach(e => {
					if (pr.getMainRoot() === e) return;
					if (!e.disableVanilla) {
						e.defPos = v3(src.defPos.x - src.posN.x + e.posN.x, src.defPos.y - src.posN.y + e.posN.y, src.defPos.z - src.posN.z + e.posN.z);
						e.defRot = v3(src.defRot.x - src.rotN.x + e.rotN.x, src.defRot.y - src.rotN.y + e.rotN.y, src.defRot.z - src.rotN.z + e.rotN.z);
					}
				});
			}
		}
		reg.applyCopy();
		return vp;
	}
}
