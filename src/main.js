import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import {
	enableOsmBuildings3D,
	enableGooglePhotorealistic3D,
	getViewer,
	initCesium,
	isGooglePhotorealisticActive,
	setCameraToPlane,
	setControlsEnabled,
	setRenderOptimization
} from './world/cesiumWorld';
import { PlanePhysics } from './plane/planePhysics';
import { PlaneController } from './plane/planeController';
import { movePosition } from './utils/math';
import { calculateDistance, reverseGeocode } from './world/regions';
import { HUD } from './ui/hud';
import { JetFlame } from './plane/jetFlame';
import { WeaponSystem } from './systems/weaponSystem';
import { soundManager } from './utils/soundManager';
import { NPCSystem } from './systems/npcSystem';
import { DialogueSystem } from './systems/dialogueSystem';
import * as Cesium from 'cesium';
import { particles } from './utils/particles';

const States = {
	MENU: 'MENU',
	PICK_SPAWN: 'PICK_SPAWN',
	TRANSITIONING: 'TRANSITIONING',
	FLYING: 'FLYING',
	PAUSED: 'PAUSED',
	CRASHED: 'CRASHED',
	LANDED: 'LANDED'
};

let currentState = States.MENU;

let gameSettings = {
	graphicsQuality: 'medium',
	antialiasing: true,
	fogEffects: true,
	mouseSensitivity: 0.2,
	showHud: true,
	showHorizonLines: false,
	soundEnabled: true,
	minimapRange: 10
};

function loadSettings() {
	const saved = localStorage.getItem('flightSimSettings');
	if (saved) {
		try {
			const parsed = JSON.parse(saved);
			gameSettings = { ...gameSettings, ...parsed };
		} catch (e) {
			console.error('Failed to load settings', e);
		}
	}
	applySettings();
	updateSettingsUI();
}

function saveSettings() {
	localStorage.setItem('flightSimSettings', JSON.stringify(gameSettings));
}

function updateSettingsUI() {
	document.getElementById('graphicsQuality').value = gameSettings.graphicsQuality;
	document.getElementById('antialiasing').checked = gameSettings.antialiasing;
	document.getElementById('fogEffects').checked = gameSettings.fogEffects;
	document.getElementById('sensitivitySlider').value = gameSettings.mouseSensitivity;
	document.getElementById('sensitivityValue').textContent = gameSettings.mouseSensitivity;
	document.getElementById('showHud').checked = gameSettings.showHud;
	document.getElementById('showHorizonLines').checked = gameSettings.showHorizonLines;
	document.getElementById('soundEnabled').checked = gameSettings.soundEnabled;
	document.getElementById('minimapRange').value = gameSettings.minimapRange.toString();
}

function applySettings() {


	if (controller) {
		controller.setSensitivity(gameSettings.mouseSensitivity);
	}

	if (hud) {
		hud.setMinimapRange(gameSettings.minimapRange);
		hud.setShowHorizonLines(gameSettings.showHorizonLines);
	}

	if (soundManager && soundManager.listener) {
		soundManager.listener.setMasterVolume(gameSettings.soundEnabled ? 1.0 : 0.0);
	}

	const viewer = getViewer();
	if (viewer) {
		if (gameSettings.graphicsQuality === 'low') {
			viewer.resolutionScale = 0.5;
			viewer.scene.globe.maximumScreenSpaceError = 4;
		} else if (gameSettings.graphicsQuality === 'medium') {
			viewer.resolutionScale = 0.75;
			viewer.scene.globe.maximumScreenSpaceError = 2;
		} else {
			viewer.resolutionScale = 1.0;
			viewer.scene.globe.maximumScreenSpaceError = 1.3;
		}

		viewer.scene.postProcessStages.fxaa.enabled = gameSettings.antialiasing;

		const useAtmosphericEffects = gameSettings.fogEffects && !isGooglePhotorealisticActive();
		viewer.scene.fog.enabled = useAtmosphericEffects;
		if (viewer.scene.skyAtmosphere) {
			viewer.scene.skyAtmosphere.show = useAtmosphericEffects;
		}
	}

	const hudElements = [
		document.getElementById('hud-top-left'),
		document.getElementById('hud-top-right'),
		document.getElementById('hud-speed-box'),
		document.getElementById('hud-alt-box'),
		document.getElementById('coords'),
		document.getElementById('minimap-container')
	];

	hudElements.forEach(el => {
		if (el) {
			el.style.display = gameSettings.showHud ? 'block' : 'none';
		}
	});
}

let state = {
	lon: 28.9784,
	lat: 41.0082,
	alt: 1500,
	heading: 0,
	pitch: 0,
	roll: 0,
	speed: 0,
	throttle: 0,
	score: 0,
	bestScore: 0,
	radarAltitude: null,
	verticalSpeedFpm: 0,
	flightAssistEnabled: false,
	weaponSystem: null
};

let lastGroundHeight;
let lastGroundHeightSampleTime = 0;
let groundHeightRequest = null;
let bestScore = parseInt(localStorage.getItem('flightSimBestScore') || '0', 10) || 0;

const ANTALYA_LANDING_ZONE = {
	name: 'ANTALYA AIRPORT',
	lon: 30.8006,
	lat: 36.8987,
	runwayHeadings: [0, 180],
	touchdownRadiusMeters: 2400,
	headingToleranceDegrees: 28,
	touchdownHeightWindowMeters: 10,
	maxRollDegrees: 10,
	minPitchDegrees: -7,
	maxPitchDegrees: 12,
	minSpeed: 100,
	maxSpeed: 220,
	maxSinkRateFpm: 1100,
	bonusScore: 1500
};

const TURKEY_SPAWN_PRESETS = [
	{ name: 'ISTANBUL', subtitle: 'BOSPHORUS RUN', lon: 29.0400, lat: 41.0439 },
	{ name: 'ANKARA', subtitle: 'CAPITAL AIRSPACE', lon: 32.8597, lat: 39.9334 },
	{ name: 'IZMIR', subtitle: 'AEGEAN COAST', lon: 27.1384, lat: 38.4237 },
	{ name: 'ANTALYA', subtitle: 'AIRPORT APPROACH', lon: 30.8006, lat: 36.9475, cameraAltitude: 9000, cameraHeading: 180, cameraPitch: -22, spawnAltitude: 900 },
	{ name: 'CAPPADOCIA', subtitle: 'VALLEY LOW LEVEL', lon: 34.8467, lat: 38.6431 },
	{ name: 'TRABZON', subtitle: 'BLACK SEA RIDGE', lon: 39.7208, lat: 41.0015 },
	{ name: 'ARARAT', subtitle: 'HIGH ALTITUDE START', lon: 44.2980, lat: 39.7026 },
	{ name: 'PAMUKKALE', subtitle: 'INLAND STRIKE', lon: 29.1179, lat: 37.9137 }
];

async function initUserLocation() {
	try {
		const data = await (await fetch('https://ipapi.co/json/')).json();
		const isTurkey = data.country_code === 'TR' || data.country_name === 'Turkey' || data.country === 'Turkey';
		if (isTurkey && data.latitude && data.longitude) {
			state.lat = data.latitude;
			state.lon = data.longitude;
		}
	} catch (e) { }
}

initUserLocation();

function syncBestScoreUI() {
	state.bestScore = bestScore;

	const menuBestScoreElem = document.getElementById('menu-best-score');
	if (menuBestScoreElem) {
		menuBestScoreElem.textContent = bestScore.toString().padStart(6, '0');
	}
}

function updateBestScore(candidateScore = state.score) {
	if (candidateScore <= bestScore) {
		state.bestScore = bestScore;
		return;
	}

	bestScore = candidateScore;
	localStorage.setItem('flightSimBestScore', String(bestScore));
	syncBestScoreUI();
}

function normalizeHeading(degrees) {
	return ((degrees % 360) + 360) % 360;
}

function getHeadingDelta(firstHeading, secondHeading) {
	const delta = Math.abs(normalizeHeading(firstHeading) - normalizeHeading(secondHeading));
	return delta > 180 ? 360 - delta : delta;
}

function isSafeLandingAtAntalya(terrainHeight) {
	const distanceToRunway = calculateDistance(
		state.lon,
		state.lat,
		ANTALYA_LANDING_ZONE.lon,
		ANTALYA_LANDING_ZONE.lat
	);
	const headingAligned = ANTALYA_LANDING_ZONE.runwayHeadings.some((heading) =>
		getHeadingDelta(state.heading, heading) <= ANTALYA_LANDING_ZONE.headingToleranceDegrees
	);
	const touchdownOffset = Math.abs(state.alt - terrainHeight);

	return distanceToRunway <= ANTALYA_LANDING_ZONE.touchdownRadiusMeters &&
		headingAligned &&
		touchdownOffset <= ANTALYA_LANDING_ZONE.touchdownHeightWindowMeters &&
		Math.abs(state.roll) <= ANTALYA_LANDING_ZONE.maxRollDegrees &&
		state.pitch >= ANTALYA_LANDING_ZONE.minPitchDegrees &&
		state.pitch <= ANTALYA_LANDING_ZONE.maxPitchDegrees &&
		state.speed >= ANTALYA_LANDING_ZONE.minSpeed &&
		state.speed <= ANTALYA_LANDING_ZONE.maxSpeed &&
		Math.abs(state.verticalSpeedFpm) <= ANTALYA_LANDING_ZONE.maxSinkRateFpm &&
		!state.isBoosting;
}

function handleSuccessfulLanding(terrainHeight) {
	state.alt = terrainHeight;
	state.speed = 0;
	state.throttle = 0;
	state.radarAltitude = 0;
	state.verticalSpeedFpm = 0;
	state.score += ANTALYA_LANDING_ZONE.bonusScore;
	updateBestScore(state.score);

	currentState = States.LANDED;
	if (dialogueSystem) dialogueSystem.stop();

	uiContainer.classList.add('hidden');
	const weaponsHud = document.getElementById('weapons-hud');
	if (weaponsHud) weaponsHud.classList.add('hidden');
	threeContainer.classList.add('hidden');
	crashMenu.classList.add('hidden');

	const landingLocation = document.getElementById('landing-location');
	if (landingLocation) {
		landingLocation.textContent = ANTALYA_LANDING_ZONE.name;
	}

	const landingBonus = document.getElementById('landing-bonus');
	if (landingBonus) {
		landingBonus.textContent = `+${ANTALYA_LANDING_ZONE.bonusScore}`;
	}

	const landingMenu = document.getElementById('landingMenu');
	if (landingMenu) {
		landingMenu.classList.remove('hidden');
	}

	hud.update(state, []);
	stopAllFlyingSounds(0.2);
}

async function setSpawnSelection({
	lon,
	lat,
	label,
	cameraAltitude = 15000,
	cameraHeading,
	cameraPitch,
	spawnAltitude = 1500
}) {
	const viewer = getViewer();
	if (!viewer) return;

	state.lon = lon;
	state.lat = lat;
	state.alt = spawnAltitude;

	const cartographic = Cesium.Cartographic.fromDegrees(lon, lat);
	let surfaceHeight = 0;

	try {
		surfaceHeight = Math.max(0, (await sampleSurfaceHeight(viewer, cartographic)) || 0);
		state.alt = surfaceHeight + spawnAltitude;
	} catch (e) { }

	const markerPosition = Cesium.Cartesian3.fromDegrees(lon, lat, surfaceHeight + 25);

	if (spawnMarker) {
		viewer.entities.remove(spawnMarker);
	}

	spawnMarker = viewer.entities.add({
		position: markerPosition,
		point: {
			pixelSize: 15,
			color: Cesium.Color.RED,
			outlineColor: Cesium.Color.WHITE,
			outlineWidth: 2,
			disableDepthTestDistance: Number.POSITIVE_INFINITY
		},
		label: {
			text: label,
			font: `14pt ${getComputedStyle(document.body).fontFamily}`,
			style: Cesium.LabelStyle.FILL_AND_OUTLINE,
			outlineWidth: 2,
			verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
			pixelOffset: new Cesium.Cartesian2(0, -20),
			disableDepthTestDistance: Number.POSITIVE_INFINITY
		}
	});

	const instructionText = document.getElementById('instruction-text');
	if (instructionText) {
		instructionText.textContent = label;
	}

	const confirmBtn = document.getElementById('confirmSpawnBtn');
	if (confirmBtn) {
		confirmBtn.classList.remove('hidden');
	}

	viewer.camera.flyTo({
		destination: Cesium.Cartesian3.fromDegrees(lon, lat, cameraAltitude),
		orientation: {
			heading: Cesium.Math.toRadians(cameraHeading ?? Cesium.Math.toDegrees(viewer.camera.heading)),
			pitch: Cesium.Math.toRadians(cameraPitch ?? Cesium.Math.toDegrees(viewer.camera.pitch)),
			roll: 0
		},
		duration: 1.5
	});
}

function setupSpawnPresets() {
	const presetsContainer = document.getElementById('spawn-presets');
	if (!presetsContainer) return;

	presetsContainer.innerHTML = '';

	TURKEY_SPAWN_PRESETS.forEach((preset) => {
		const button = document.createElement('button');
		button.className = 'spawn-preset-btn';
		button.type = 'button';
		button.innerHTML = `<span class="spawn-preset-name">${preset.name}</span><span class="spawn-preset-meta">${preset.subtitle}</span>`;
		button.onclick = () => {
			setSpawnSelection({
				lon: preset.lon,
				lat: preset.lat,
				label: `${preset.name} - ${preset.subtitle}`,
				cameraAltitude: preset.cameraAltitude,
				cameraHeading: preset.cameraHeading,
				cameraPitch: preset.cameraPitch,
				spawnAltitude: preset.spawnAltitude
			});
		};
		presetsContainer.appendChild(button);
	});
}

function applyGoogle3DModeUI() {
	const searchToggleBtn = document.getElementById('search-toggle-btn');
	const searchInput = document.getElementById('locationSearch');
	const resultsContainer = document.getElementById('search-results');
	const instructionText = document.getElementById('instruction-text');

	if (searchToggleBtn) {
		searchToggleBtn.style.display = 'none';
	}

	if (searchInput) {
		searchInput.value = '';
		searchInput.style.display = 'none';
	}

	if (resultsContainer) {
		resultsContainer.innerHTML = '';
		resultsContainer.style.display = 'none';
	}

	if (instructionText) {
		instructionText.style.display = 'block';
		instructionText.textContent = 'CLICK ANYWHERE ON THE 3D MAP TO CHOOSE SPAWN POINT';
	}
}

function pickSurfacePosition(viewer, windowPosition) {
	if (isGooglePhotorealisticActive()) {
		if (viewer.scene.pickPositionSupported) {
			const pickedPosition = viewer.scene.pickPosition(windowPosition);
			if (Cesium.defined(pickedPosition)) {
				return pickedPosition;
			}
		}

		return viewer.camera.pickEllipsoid(windowPosition, viewer.scene.globe.ellipsoid);
	}

	const ray = viewer.camera.getPickRay(windowPosition);
	return viewer.scene.globe.pick(ray, viewer.scene) || viewer.camera.pickEllipsoid(windowPosition, viewer.scene.globe.ellipsoid);
}

async function sampleSurfaceHeight(viewer, cartographic) {
	const queryPosition = Cesium.Cartographic.clone(cartographic);

	if (isGooglePhotorealisticActive() && viewer.scene.sampleHeightSupported) {
		try {
			const [sampled] = await viewer.scene.sampleHeightMostDetailed([queryPosition]);
			if (sampled && typeof sampled.height === 'number') {
				return sampled.height;
			}
		} catch (e) { }

		const sampledHeight = viewer.scene.sampleHeight(queryPosition);
		if (sampledHeight !== undefined) {
			return sampledHeight;
		}
	}

	try {
		const [sampled] = await Cesium.sampleTerrainMostDetailed(viewer.terrainProvider, [queryPosition]);
		if (sampled && typeof sampled.height === 'number') {
			return sampled.height;
		}
	} catch (e) { }

	return queryPosition.height || 0;
}

function requestGroundHeightUpdate(force = false) {
	const viewer = getViewer();
	if (!viewer) return;

	const now = Date.now();
	if (!force && groundHeightRequest) return;
	if (!force && now - lastGroundHeightSampleTime < 300) return;
	lastGroundHeightSampleTime = now;

	const cartographic = Cesium.Cartographic.fromDegrees(state.lon, state.lat);

	if (isGooglePhotorealisticActive() && viewer.scene.sampleHeightSupported) {
		groundHeightRequest = viewer.scene.sampleHeightMostDetailed([cartographic])
			.then(([sampled]) => {
				if (sampled && typeof sampled.height === 'number') {
					lastGroundHeight = sampled.height;
					return;
				}

				const fallbackHeight = viewer.scene.sampleHeight(cartographic);
				if (fallbackHeight !== undefined) {
					lastGroundHeight = fallbackHeight;
				}
			})
			.catch(() => {
				const fallbackHeight = viewer.scene.sampleHeight(cartographic);
				if (fallbackHeight !== undefined) {
					lastGroundHeight = fallbackHeight;
				}
			})
			.finally(() => {
				groundHeightRequest = null;
			});
		return;
	}

	const terrainHeight = viewer.scene.globe.getHeight(cartographic);
	if (terrainHeight !== undefined) {
		lastGroundHeight = terrainHeight;
	}
}

function getGroundHeightEstimate() {
	if (typeof lastGroundHeight === 'number') {
		return lastGroundHeight;
	}

	const viewer = getViewer();
	if (!viewer) return undefined;

	const cartographic = Cesium.Cartographic.fromDegrees(state.lon, state.lat);

	if (isGooglePhotorealisticActive() && viewer.scene.sampleHeightSupported) {
		const sampledHeight = viewer.scene.sampleHeight(cartographic);
		if (sampledHeight !== undefined) {
			return sampledHeight;
		}
	}

	return viewer.scene.globe.getHeight(cartographic);
}

let currentRegionName = null;
let lastGeocodeTime = 0;
let lastGeocodePos = { lon: 0, lat: 0 };
const GEOCODE_INTERVAL = 10000;
const GEOCODE_MIN_DIST = 1000;

let lastGPWSWarningTime = 0;
const GPWS_COOLDOWN = 1800;
let gpwsActive = false;
let pauseStartTime = 0;

let scene, camera, renderer;
let planeModel;
let jetFlames = [];
let mixer, clock;
let physics = new PlanePhysics();
let controller = new PlaneController();
let hud = new HUD();
let npcSystem;
let weaponSystem;
let dialogueSystem = new DialogueSystem();

let fps = 0;
let frameCount = 0;
let lastFpsUpdate = 0;

const BASE_PLANE_POS = new THREE.Vector3(0, -0.8, -2.75);
let visualOffset = new THREE.Vector3().copy(BASE_PLANE_POS);
let visualRotation = new THREE.Euler(0, 0, 0);
let boostRoll = 0;
let currentBoostZOffset = 0;
let boostRollDirection = 1;
let lastIsBoosting = false;
let initialCameraView = null;
let lastThrottleLevel = 0;

const mainMenu = document.getElementById('mainMenu');
const pauseMenu = document.getElementById('pauseMenu');
const crashMenu = document.getElementById('crashMenu');
const landingMenu = document.getElementById('landingMenu');
const uiContainer = document.getElementById('uiContainer');
const threeContainer = document.getElementById('threeContainer');
const spawnInstruction = document.getElementById('spawnInstruction');
const confirmSpawnBtn = document.getElementById('confirmSpawnBtn');

let spawnMarker = null;

const startBtn = document.getElementById('startBtn');

const loadingIndicator = document.getElementById('loadingIndicator');
const loadingText = document.getElementById('loadingText');

const loadingStatus = {
	audio: false,
	model: false,
	cesium: false,
	globe: false,
	failed: false
};

function markLoadingFailed(error, context) {
	loadingStatus.failed = true;
	console.error(`Failed to load ${context}`, error);
	updateLoadingUI();
}

function updateLoadingUI() {
	if (!loadingIndicator || !loadingText || !startBtn) return;

	if (currentState === States.FLYING || currentState === States.TRANSITIONING) {
		loadingIndicator.classList.add('hidden');
		return;
	}

	let msg = "";
	const isAllLoaded = loadingStatus.audio && loadingStatus.model && loadingStatus.cesium && loadingStatus.globe;

	if (loadingStatus.failed) {
		msg = "Loading Failed. Please Refresh.";
	} else if (!isAllLoaded) {
		if (!loadingStatus.audio) msg = "Loading Audio...";
		else if (!loadingStatus.model) msg = "Loading Aircraft Model...";
		else if (!loadingStatus.cesium) msg = "Loading Satellite Imagery...";
		else if (!loadingStatus.globe) msg = "Loading Globe Surface...";
	}

	if (msg) {
		loadingText.textContent = msg;
		startBtn.disabled = true;
		startBtn.style.pointerEvents = "none";
		loadingIndicator.classList.remove('hidden');

		if (loadingStatus.failed) {
			loadingText.style.color = "#f00";
			const spinner = loadingIndicator.querySelector('.spinner');
			if (spinner) {
				spinner.style.borderColor = "rgba(255, 0, 0, 0.3)";
				spinner.style.borderTopColor = "#f00";
			}
		}
	} else {
		loadingIndicator.classList.add('hidden');
		startBtn.disabled = false;
		startBtn.style.pointerEvents = "auto";
	}
}

async function initSounds() {
	soundManager.init(camera);

	await Promise.all([
		soundManager.loadSound('boost', '/assets/sounds/boost.mp3', false, 0.35),
		soundManager.loadSound('throttle', '/assets/sounds/throttle.mp3', false, 0.4),
		soundManager.loadSound('explode', '/assets/sounds/explode.mp3', false, 0.75),
		soundManager.loadSound('explosion-1', '/assets/sounds/explosion-1.mp3', false, 0.8),
		soundManager.loadSound('explosion-2', '/assets/sounds/explosion-2.mp3', false, 0.8),
		soundManager.loadSound('explosion-3', '/assets/sounds/explosion-3.mp3', false, 0.8),
		soundManager.loadSound('ambient-crash', '/assets/sounds/ambient.mp3', true, 0.5),
		soundManager.loadSound('weapon-warning', '/assets/sounds/weapon-warning-1.mp3', false, 1.0),
		soundManager.loadSound('jet-engine', '/assets/sounds/jet-engine.mp3', true, 0.5),
		soundManager.loadSound('spawn', '/assets/sounds/spawn.mp3', false, 0.5),
		soundManager.loadSound('roll', '/assets/sounds/roll.mp3', true, 0.75),
		soundManager.loadSound('pitch', '/assets/sounds/pitch.mp3', true, 0.75),
		soundManager.loadSound('button-click', '/assets/sounds/button-click.mp3', false, 1.0),
		soundManager.loadSound('weapon-switch', '/assets/sounds/weapon-switch.mp3', false, 0.75),
		soundManager.loadSound('button-hover', '/assets/sounds/button-hover.mp3', false, 0.25),
		soundManager.loadSound('zoom-in', '/assets/sounds/zoom-in.mp3', false, 0.5),
		soundManager.loadSound('missile-fire', '/assets/sounds/missile-firing-1.mp3', false, 0.75),
		soundManager.loadSound('m61-firing', '/assets/sounds/m61-firing.mp3', true, 0.75),
		soundManager.loadSound('rwr-tws', '/assets/sounds/rwr-tws.mp3', true, 0.2),
		soundManager.loadSound('rwr-lock', '/assets/sounds/rwr-lock.mp3', false, 0.2),
		soundManager.loadSound('wind', '/assets/sounds/wind.mp3', true, 0.25),
		soundManager.loadSound('terrain-pull-up', '/assets/sounds/terrain-pull-up.mp3', false, 0.9),
		soundManager.loadSound('warning', '/assets/sounds/warning.mp3', false, 0.6),
		soundManager.loadSound('glitch-1', '/assets/sounds/glitch-transition-1.mp3', false, 0.25),
		soundManager.loadSound('glitch-2', '/assets/sounds/glitch-transition-2.mp3', false, 0.25),
		soundManager.loadSound('glitch-3', '/assets/sounds/glitch-transition-3.mp3', false, 0.25),
		soundManager.loadSound('glitch-4', '/assets/sounds/glitch-transition-4.mp3', false, 0.25)
	]);

	loadingStatus.audio = true;
	updateLoadingUI();
	setupButtonSounds();
}

function stopAllFlyingSounds(fadeOut = 0.5) {
	soundManager.stopAll(fadeOut);
}

function pauseGameplaySounds() {
	pauseStartTime = Date.now();
	soundManager.pauseAll();
}

function resumeGameplaySounds() {
	const pauseDuration = Date.now() - pauseStartTime;
	if (lastGPWSWarningTime > 0) {
		lastGPWSWarningTime += pauseDuration;
	}
	soundManager.resumeAll();
}

function setupButtonSounds() {
	document.addEventListener('mouseover', (e) => {
		const target = e.target.closest('button, .menu-btn, .clickable-ui');
		if (target && !target._hovered) {
			soundManager.play('button-hover');
			target._hovered = true;
			target.addEventListener('mouseleave', () => { target._hovered = false; }, { once: true });
		}
	}, true);

	document.addEventListener('click', (e) => {
		const target = e.target.closest('button, .menu-btn, .clickable-ui, #search-toggle-btn');
		if (target) {
			soundManager.play('button-click');
		}
	}, true);
}

function initThree() {
	clock = new THREE.Clock();
	scene = new THREE.Scene();
	camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 100000);

	renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
	renderer.setSize(window.innerWidth, window.innerHeight);
	renderer.setPixelRatio(window.devicePixelRatio);
	renderer.setClearColor(0x000000, 0);
	threeContainer.appendChild(renderer.domElement);

	threeContainer.classList.add('hidden');

	const ambientLight = new THREE.AmbientLight(0xffffff, 1.0);
	scene.add(ambientLight);
	const directionalLight = new THREE.DirectionalLight(0xffffff, 1.0);
	directionalLight.position.set(5, 10, 5);
	scene.add(directionalLight);

	ambientLight.layers.enable(1);
	directionalLight.layers.enable(1);

	try { particles.init(scene, getViewer()); } catch (e) { }

	initSounds().catch(err => markLoadingFailed(err, 'audio assets'));

	const loader = new GLTFLoader();
	loader.load('/assets/models/f-15.glb', (gltf) => {
		const mesh = gltf.scene;

		planeModel = new THREE.Group();
		planeModel.add(mesh);
		scene.add(planeModel);

		planeModel.layers.set(1);
		planeModel.traverse(child => {
			child.layers.set(1);
		});

		const box = new THREE.Box3().setFromObject(mesh);
		const center = box.getCenter(new THREE.Vector3());
		mesh.position.sub(center);

		planeModel.position.copy(BASE_PLANE_POS);
		planeModel.scale.set(0.2, 0.2, 0.2);

		const flameL = new JetFlame();
		const flameR = new JetFlame();

		flameL.group.position.set(-0.4, -0.065, 5);
		flameR.group.position.set(0.4, -0.065, 5);


		planeModel.add(flameL.group);
		planeModel.add(flameR.group);
		jetFlames.push(flameL, flameR);

		weaponSystem = new WeaponSystem(getViewer(), scene, planeModel);
		weaponSystem.onKill = (npc) => {
			state.score += 1000;
			updateBestScore(state.score);
			try { soundManager.play('glitch-random'); } catch (e) { }
			if (hud) {
				hud.showKillNotification(npc.name, 1000);
			}
		};

		planeModel.traverse(child => {
			child.layers.set(1);
		});

		mixer = new THREE.AnimationMixer(mesh);
		const clip = THREE.AnimationClip.findByName(gltf.animations, 'flight_mode');
		if (clip) {
			const action = mixer.clipAction(clip);
			action.setLoop(THREE.LoopOnce);
			action.clampWhenFinished = true;
			action.play();
		}

		loadingStatus.model = true;
		updateLoadingUI();
	}, undefined, (error) => {
		markLoadingFailed(error, 'aircraft model');
	});
}

function update(dt) {
	if (currentState !== States.FLYING) return;

	const input = controller.update(dt);
	const physicsResult = physics.update(input, dt);
	const prevAlt = state.alt;

	const prevSpeed = state.speed;
	state.speed = physicsResult.speed;
	state.pitch = physicsResult.pitch;
	state.roll = physicsResult.roll;
	state.heading = physicsResult.heading;
	state.throttle = input.throttle;
	state.yaw = input.yaw;
	state.isBoosting = physicsResult.isBoosting;
	state.flightAssistEnabled = input.flightAssistEnabled;
	state.weaponSystem = weaponSystem;
	state.npcs = npcSystem ? npcSystem.npcs : [];

	if (weaponSystem) {
		if (input.weaponIndex !== -1) {
			weaponSystem.selectWeapon(input.weaponIndex);
		}
		if (input.toggleWeapon) {
			weaponSystem.toggleWeapon();
		}
		if (input.fire) {
			weaponSystem.fire(state);
		}
		if (input.fireFlare) {
			weaponSystem.fireFlare(state);
		}
		weaponSystem.update(dt, state, input);
	}

	const newPos = movePosition(state.lon, state.lat, state.alt, state.heading, state.pitch, state.speed * dt);
	state.lon = newPos.lon;
	state.lat = newPos.lat;
	state.alt = newPos.alt;
	state.verticalSpeedFpm = ((state.alt - prevAlt) / Math.max(dt, 0.001)) * 196.850394;

	const nowTime = Date.now();
	const distFromLast = calculateDistance(state.lon, state.lat, lastGeocodePos.lon, lastGeocodePos.lat);

	if (!isGooglePhotorealisticActive() && (nowTime - lastGeocodeTime > GEOCODE_INTERVAL || distFromLast > GEOCODE_MIN_DIST)) {
		lastGeocodeTime = nowTime;
		lastGeocodePos = { lon: state.lon, lat: state.lat };

		reverseGeocode(state.lon, state.lat).then(name => {
			if (name && name !== currentRegionName) {
				currentRegionName = name;
				hud.showRegion(name);
			}
		});
	}

	requestGroundHeightUpdate();
	const groundHeight = getGroundHeightEstimate();
	state.radarAltitude = typeof groundHeight === 'number' ? Math.max(0, state.alt - groundHeight) : null;
	checkCrash();
	checkGPWS();

	if (soundManager.isPlaying('jet-engine')) {
		const minSpeed = 100;
		const maxSpeed = 1000;
		const minVol = 0.5;
		const maxVol = 0.6;
		const speedFactor = Math.max(0, Math.min(1.0, (state.speed - minSpeed) / (maxSpeed - minSpeed)));
		const engineVol = minVol + speedFactor * (maxVol - minVol);
		soundManager.setVolume('jet-engine', engineVol);
	}

	if (state.isBoosting && !lastIsBoosting) {
		soundManager.play('boost');
	}

	if (state.throttle > lastThrottleLevel + 0.01) {
		if (!soundManager.isPlaying('throttle')) {
			soundManager.play('throttle');
		}
	}
	lastThrottleLevel = state.throttle;

	if (Math.abs(input.pitch) > 0.5) {
		if (!soundManager.isPlaying('pitch')) {
			soundManager.play('pitch', 0.1);
		}
	} else {
		if (soundManager.isPlaying('pitch')) {
			soundManager.stop('pitch', 0.1);
		}
	}

	if (Math.abs(input.roll) > 0.5 || Math.abs(input.yaw) > 0.5) {
		if (!soundManager.isPlaying('roll')) {
			soundManager.play('roll', 0.1);
		}
	} else {
		if (soundManager.isPlaying('roll')) {
			soundManager.stop('roll', 0.1);
		}
	}

	const planeHPR = new Cesium.HeadingPitchRoll(
		Cesium.Math.toRadians(state.heading),
		Cesium.Math.toRadians(state.pitch),
		Cesium.Math.toRadians(state.roll)
	);
	const planeQuat = Cesium.Quaternion.fromHeadingPitchRoll(planeHPR);

	const orbitHPR = new Cesium.HeadingPitchRoll(
		Cesium.Math.toRadians(input.cameraYaw),
		Cesium.Math.toRadians(-input.cameraPitch),
		0
	);
	const orbitQuat = Cesium.Quaternion.fromHeadingPitchRoll(orbitHPR);

	const finalQuat = Cesium.Quaternion.multiply(planeQuat, orbitQuat, new Cesium.Quaternion());
	const finalHPR = Cesium.HeadingPitchRoll.fromQuaternion(finalQuat);

	setCameraToPlane(
		state.lon, state.lat, state.alt,
		Cesium.Math.toDegrees(finalHPR.heading),
		Cesium.Math.toDegrees(finalHPR.pitch),
		Cesium.Math.toDegrees(finalHPR.roll)
	);

	if (npcSystem) {
		npcSystem.update(dt, state);
	}
	hud.update(state, currentState === States.FLYING ? (npcSystem ? npcSystem.npcs : []) : []);

	if (planeModel) {
		const accel = (state.speed - prevSpeed) / dt;
		const accelInertia = input.isDragging ? 0 : Math.max(-0.5, Math.min(1.5, accel * 0.001));
		let targetZ = BASE_PLANE_POS.z - accelInertia;

		let boostZOffset = 0;
		if (physicsResult.isBoosting) {
			if (!lastIsBoosting) {
				boostRollDirection = Math.random() > 0.5 ? 1 : -1;
			}

			const T = physicsResult.boostDuration;
			const p = Math.max(0, Math.min(1.0, 1.0 - (physicsResult.boostTimeRemaining / T)));

			const totalRotationRad = Math.PI * 2 * physicsResult.boostRotations * boostRollDirection;

			if (p < 0.2) {
				const localP = p / 0.2;
				boostZOffset = -(localP * localP) * 1.5;
				boostRoll = 0;
			}
			else if (p < 0.8) {
				const localP = (p - 0.2) / 0.6;
				boostZOffset = -1.5;
				const easedP = localP < 0.5
					? 4 * localP * localP * localP
					: 1 - Math.pow(-2 * localP + 2, 3) / 2;
				boostRoll = easedP * (Math.PI * 2 * physicsResult.boostRotations) * boostRollDirection;
			}
			else {
				const localP = (p - 0.8) / 0.2;
				const easedReturn = localP * localP * (3 - 2 * localP);
				boostZOffset = -1.5 + (easedReturn * 0.7);
				boostRoll = (Math.PI * 2 * physicsResult.boostRotations) * boostRollDirection;
			}
		} else {
			boostRoll = 0;
			boostZOffset = 0;
		}
		lastIsBoosting = physicsResult.isBoosting;

		const zLerp = physicsResult.isBoosting ? 10.0 * dt : 2.0 * dt;
		currentBoostZOffset += (boostZOffset - currentBoostZOffset) * zLerp;
		targetZ += currentBoostZOffset;


		const time = performance.now() * 0.001;
		const idleX = Math.sin(time * 0.8) * 0.035;
		const idleY = Math.cos(time * 0.6) * 0.025;
		const idleRotX = Math.sin(time * 0.5) * 0.015;
		const idleRotY = Math.cos(time * 0.4) * 0.015;
		const idleRotZ = Math.sin(time * 0.7) * 0.025;

		const targetX = input.isDragging ? BASE_PLANE_POS.x : BASE_PLANE_POS.x - (input.roll * 0.6) - (input.yaw * 0.12) + idleX;
		const targetY = input.isDragging ? BASE_PLANE_POS.y : BASE_PLANE_POS.y - (input.pitch * 0.1) + idleY;

		let targetRotZ = input.isDragging ? 0 : THREE.MathUtils.degToRad(-input.roll * 15) + idleRotZ;
		const targetRotX = input.isDragging ? 0 : THREE.MathUtils.degToRad(input.pitch * 10) + idleRotX;
		const targetRotY = input.isDragging ? 0 : THREE.MathUtils.degToRad(-input.yaw * 4) + idleRotY;

		const lerpFactor = physicsResult.isBoosting ? 3.0 * dt : 5.0 * dt;
		visualOffset.x += (targetX - visualOffset.x) * lerpFactor;
		visualOffset.y += (targetY - visualOffset.y) * lerpFactor;
		visualOffset.z += (targetZ - visualOffset.z) * lerpFactor;

		visualRotation.z += (targetRotZ - visualRotation.z) * lerpFactor;
		visualRotation.x += (targetRotX - visualRotation.x) * lerpFactor;
		visualRotation.y += (targetRotY - visualRotation.y) * lerpFactor;

		const orbitQ = new THREE.Quaternion().setFromEuler(
			new THREE.Euler(
				THREE.MathUtils.degToRad(-input.cameraPitch),
				THREE.MathUtils.degToRad(-input.cameraYaw),
				0,
				'YXZ'
			)
		);

		planeModel.position.copy(visualOffset);

		const flightLagQ = new THREE.Quaternion().setFromEuler(
			new THREE.Euler(visualRotation.x, visualRotation.y, visualRotation.z + boostRoll)
		);

		const combinedQ = orbitQ.clone().invert().multiply(flightLagQ);
		planeModel.quaternion.copy(combinedQ);

		if (jetFlames.length > 0) {
			jetFlames.forEach(flame => {
				flame.update(state.throttle, state.isBoosting, clock.getElapsedTime(), dt);
			});
		}
	}
}

function checkGPWS() {
	if (currentState !== States.FLYING) {
		hud.setPullUpWarning(false);
		return;
	}

	const viewer = getViewer();
	if (!viewer) return;

	const terrainHeight = getGroundHeightEstimate();

	if (terrainHeight === undefined) return;

	const agl = state.alt - terrainHeight;
	const pitchRad = Cesium.Math.toRadians(state.pitch);
	const verticalSpeed = state.speed * Math.sin(pitchRad);

	let showWarning = false;

	if (state.pitch < -1) {
		if (agl < 450) {
			if (agl < 150) {
				showWarning = true;
			}

			if (verticalSpeed < -20) {
				showWarning = true;
			}
		}
	}

	hud.setPullUpWarning(showWarning);

	if (showWarning) {
		const now = Date.now();
		if (!gpwsActive || (now - lastGPWSWarningTime > GPWS_COOLDOWN && !soundManager.isPlaying('terrain-pull-up'))) {
			soundManager.play('terrain-pull-up');
			lastGPWSWarningTime = now;
		}
		gpwsActive = true;
	} else {
		if (gpwsActive) {
			soundManager.stop('terrain-pull-up', 0.1);
			gpwsActive = false;
		}
	}
}

let lastCrashCheck = 0;
let flightStartTime = 0;

function checkCrash() {
	if (currentState !== States.FLYING) return;

	const now = Date.now();
	if (now - lastCrashCheck < 100) return;
	lastCrashCheck = now;

	if (now - flightStartTime < 3000) return;

	const viewer = getViewer();
	if (!viewer) return;

	const terrainHeight = getGroundHeightEstimate();

	if (terrainHeight !== undefined && state.alt <= terrainHeight + 5) {
		if (isSafeLandingAtAntalya(terrainHeight)) {
			handleSuccessfulLanding(terrainHeight);
			return;
		}

		updateBestScore(state.score);
		currentState = States.CRASHED;
		if (dialogueSystem) dialogueSystem.stop();
		uiContainer.classList.add('hidden');
		const weaponsHud = document.getElementById('weapons-hud');
		if (weaponsHud) weaponsHud.classList.add('hidden');
		threeContainer.classList.add('hidden');
		crashMenu.classList.remove('hidden');
		hud.update(state, []);

		stopAllFlyingSounds(0.1);
		setTimeout(() => {
			soundManager.play('explode');
			soundManager.play('ambient-crash');
		}, 50);
	}
}

function animate() {
	requestAnimationFrame(animate);

	const dt = clock ? clock.getDelta() : 0.016;
	const now = performance.now();

	frameCount++;
	if (now - lastFpsUpdate >= 1000) {
		fps = (frameCount * 1000) / (now - lastFpsUpdate);
		frameCount = 0;
		lastFpsUpdate = now;
		hud.updateFPS(fps);

		const menuTimeElem = document.getElementById('menu-time');
		if (menuTimeElem) {
			menuTimeElem.textContent = new Date().toISOString().split('.')[0] + 'Z';
		}
	}

	if (currentState === States.FLYING || currentState === States.PAUSED || currentState === States.TRANSITIONING) {
		const viewer = getViewer();

		renderer.autoClear = false;
		renderer.clear();

		if (viewer && viewer.camera && viewer.camera.frustum.fovy) {
			const targetFov = Cesium.Math.toDegrees(viewer.camera.frustum.fovy);
			camera.fov = targetFov;
			camera.aspect = window.innerWidth / window.innerHeight;
			camera.updateProjectionMatrix();
		}

		camera.layers.set(0);

		if (currentState === States.FLYING) {
			update(dt);
		} else if (currentState === States.PAUSED) {
			hud.updatePauseMenu(state, currentRegionName, npcSystem ? npcSystem.npcs : []);
		}

		if (mixer) mixer.update(dt);

		try { if (currentState === States.FLYING) particles.update(dt); } catch (e) { }

		renderer.render(scene, camera);

		renderer.clearDepth();

		camera.fov = 75;
		camera.updateProjectionMatrix();

		camera.layers.set(1);

		renderer.render(scene, camera);

	} else {
		threeContainer.classList.add('hidden');
	}
}

function closeAllModals() {
	document.querySelectorAll('.modal').forEach(m => m.classList.add('hidden'));
}

function setupModalListeners() {
	document.getElementById('helpBtn').onclick = () => {
		closeAllModals();
		document.getElementById('helpModal').classList.remove('hidden');
	};

	document.getElementById('optionsBtn').onclick = () => {
		closeAllModals();
		updateSettingsUI();
		document.getElementById('optionsModal').classList.remove('hidden');
	};

	document.getElementById('pauseOptionsBtn').onclick = () => {
		closeAllModals();
		updateSettingsUI();
		document.getElementById('optionsModal').classList.remove('hidden');
	};

	document.getElementById('pauseHelpBtn').onclick = () => {
		closeAllModals();
		document.getElementById('helpModal').classList.remove('hidden');
	};

	document.getElementById('creditsBtn').onclick = () => {
		closeAllModals();
		document.getElementById('creditsModal').classList.remove('hidden');
	};

	document.getElementById('aboutBtn').onclick = () => {
		closeAllModals();
		document.getElementById('aboutBtnModal').classList.remove('hidden');
	};



	document.getElementById('sensitivitySlider').oninput = (e) => {
		document.getElementById('sensitivityValue').textContent = e.target.value;
	};

	document.getElementById('saveOptionsBtn').onclick = () => {
		gameSettings.graphicsQuality = document.getElementById('graphicsQuality').value;
		gameSettings.antialiasing = document.getElementById('antialiasing').checked;
		gameSettings.fogEffects = document.getElementById('fogEffects').checked;
		gameSettings.mouseSensitivity = parseFloat(document.getElementById('sensitivitySlider').value);
		gameSettings.showHud = document.getElementById('showHud').checked;
		gameSettings.showHorizonLines = document.getElementById('showHorizonLines').checked;
		gameSettings.soundEnabled = document.getElementById('soundEnabled').checked;
		gameSettings.minimapRange = parseInt(document.getElementById('minimapRange').value);

		saveSettings();
		applySettings();
		closeAllModals();
	};

	document.querySelectorAll('.close-modal').forEach(btn => {
		btn.onclick = (e) => {
			e.stopPropagation();
			btn.closest('.modal').classList.add('hidden');
		};
	});

	window.addEventListener('click', (event) => {
		if (event.target.classList.contains('modal')) {
			event.target.classList.add('hidden');
		}
	});
}

document.getElementById('startBtn').onclick = () => {
	closeAllModals();
	mainMenu.classList.add('hidden');
	enterSpawnPicking(false);
};

setupModalListeners();

document.getElementById('resumeBtn').onclick = () => {
	closeAllModals();
	pauseMenu.classList.add('hidden');
	uiContainer.classList.remove('hidden');
	const weaponsHud = document.getElementById('weapons-hud');
	if (weaponsHud) weaponsHud.classList.remove('hidden');
	currentState = States.FLYING;
	if (dialogueSystem) dialogueSystem.resume();
	resumeGameplaySounds();
};

document.getElementById('restartBtn').onclick = () => {
	closeAllModals();
	pauseMenu.classList.add('hidden');
	if (dialogueSystem) dialogueSystem.stop();
	enterSpawnPicking(true);
};

document.getElementById('quitBtn').onclick = () => {
	closeAllModals();
	if (dialogueSystem) dialogueSystem.stop();
	setRenderOptimization(true);
	location.reload();
};

document.getElementById('respawnBtn').onclick = () => {
	closeAllModals();
	crashMenu.classList.add('hidden');
	if (dialogueSystem) dialogueSystem.stop();
	enterSpawnPicking(true);
};

document.getElementById('landingRespawnBtn').onclick = () => {
	closeAllModals();
	if (landingMenu) {
		landingMenu.classList.add('hidden');
	}
	if (dialogueSystem) dialogueSystem.stop();
	enterSpawnPicking(true);
};

function enterSpawnPicking(useVignette = true) {
	state.score = 0;
	if (npcSystem) npcSystem.clear();
	stopAllFlyingSounds(0.3);
	soundManager.play('zoom-in');
	soundManager.play('wind', 1.0);
	if (landingMenu) {
		landingMenu.classList.add('hidden');
	}
	const vignette = document.getElementById('transition-vignette');
	if (useVignette && vignette) vignette.style.opacity = '1';

	const delay = useVignette ? 500 : 0;

	setTimeout(() => {
		spawnInstruction.classList.remove('hidden');
		threeContainer.classList.add('hidden');
		uiContainer.classList.add('hidden');
		const weaponsHud = document.getElementById('weapons-hud');
		if (weaponsHud) weaponsHud.classList.add('hidden');
		currentState = States.PICK_SPAWN;
		confirmSpawnBtn.classList.add('hidden');

		const searchInput = document.getElementById('locationSearch');
		const instructionText = document.getElementById('instruction-text');
		const resultsContainer = document.getElementById('search-results');

		if (searchInput) {
			searchInput.value = '';
			searchInput.style.display = 'none';
		}
		if (instructionText) {
			instructionText.style.display = 'block';
			instructionText.textContent = isGooglePhotorealisticActive()
				? 'CLICK ANYWHERE ON THE 3D MAP TO CHOOSE SPAWN POINT'
				: 'CLICK ANYWHERE ON THE MAP TO CHOOSE SPAWN POINT';
		}
		if (resultsContainer) {
			resultsContainer.style.display = 'none';
		}

		setControlsEnabled(true);

		if (spawnMarker) {
			const viewer = getViewer();
			viewer.entities.remove(spawnMarker);
			spawnMarker = null;
		}

		const viewer = getViewer();
		viewer.camera.flyTo({
			destination: Cesium.Cartesian3.fromDegrees(state.lon, state.lat, 15000),
			duration: 2.0,
			complete: () => {
				if (vignette) vignette.style.opacity = '0';
			}
		});
	}, delay);
}

function exitSpawnPicking() {
	soundManager.play('zoom-in');
	soundManager.stop('wind', 1.0);
	stopAllFlyingSounds(0.3);
	spawnInstruction.classList.add('hidden');
	confirmSpawnBtn.classList.add('hidden');
	mainMenu.classList.remove('hidden');
	currentState = States.MENU;
	loadingIndicator.classList.add('hidden');
	setRenderOptimization(true);

	setControlsEnabled(false);

	if (spawnMarker) {
		const viewer = getViewer();
		viewer.entities.remove(spawnMarker);
		spawnMarker = null;
	}

	const viewer = getViewer();
	viewer.camera.flyTo({
		...initialCameraView,
		duration: 2.5
	});
}

function setupSpawnPicker() {
	const viewer = getViewer();
	const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
	const instructionText = document.getElementById('instruction-text');

	handler.setInputAction((click) => {
		if (currentState !== States.PICK_SPAWN) return;

		const cartesian = pickSurfacePosition(viewer, click.position);

		if (cartesian) {
			const cartographic = Cesium.Cartographic.fromCartesian(cartesian);
			const lon = Cesium.Math.toDegrees(cartographic.longitude);
			const lat = Cesium.Math.toDegrees(cartographic.latitude);

			state.lon = lon;
			state.lat = lat;
			state.alt = Math.max(0, cartographic.height) + 1500;

			if (isGooglePhotorealisticActive()) {
				instructionText.textContent = 'SPAWN POINT SELECTED';
			} else {
				instructionText.textContent = 'FETCHING LOCATION INFO...';
				reverseGeocode(lon, lat).then(regionName => {
					if (regionName && currentState === States.PICK_SPAWN) {
						instructionText.textContent = regionName;
						if (spawnMarker) {
							spawnMarker.label.text = regionName;
						}
					}
				}).catch(() => { });
			}

			sampleSurfaceHeight(viewer, cartographic)
				.then((height) => {
					state.alt = Math.max(0, height || 0) + 1500;
				})
				.catch(() => { });

			if (spawnMarker) {
				viewer.entities.remove(spawnMarker);
			}
			spawnMarker = viewer.entities.add({
				position: cartesian,
				point: {
					pixelSize: 15,
					color: Cesium.Color.RED,
					outlineColor: Cesium.Color.WHITE,
					outlineWidth: 2,
					disableDepthTestDistance: Number.POSITIVE_INFINITY
				},
				label: {
					text: "Target Spawn Location",
					font: `14pt ${getComputedStyle(document.body).fontFamily}`,
					style: Cesium.LabelStyle.FILL_AND_OUTLINE,
					outlineWidth: 2,
					verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
					pixelOffset: new Cesium.Cartesian2(0, -20),
					disableDepthTestDistance: Number.POSITIVE_INFINITY
				}
			});

			confirmSpawnBtn.classList.remove('hidden');
		}
	}, Cesium.ScreenSpaceEventType.LEFT_CLICK);
}

function setupLocationSearch() {
	const searchInput = document.getElementById('locationSearch');
	const resultsContainer = document.getElementById('search-results');
	const instructionText = document.getElementById('instruction-text');
	const searchToggleBtn = document.getElementById('search-toggle-btn');
	const originalSearchIcon = searchToggleBtn ? searchToggleBtn.innerHTML : '';
	let debounceTimer;

	if (searchToggleBtn) {
		searchToggleBtn.onclick = (e) => {
			e.stopPropagation();
			if (isGooglePhotorealisticActive()) return;
			const isSearching = searchInput.style.display === 'block';

			if (isSearching) {
				searchInput.style.display = 'none';
				instructionText.style.display = 'block';
				resultsContainer.style.display = 'none';
			} else {
				searchInput.style.display = 'block';
				instructionText.style.display = 'none';
				searchInput.focus();
			}
		};
	}

	searchInput.addEventListener('input', (e) => {
		if (isGooglePhotorealisticActive()) return;
		clearTimeout(debounceTimer);
		const query = e.target.value.trim();

		if (query.length < 3) {
			resultsContainer.style.display = 'none';
			return;
		}

		debounceTimer = setTimeout(async () => {
			if (searchToggleBtn) {
				searchToggleBtn.innerHTML = '<div class="loader-spinner"></div>';
			}

			try {
				const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=5`);
				const data = await response.json();

				resultsContainer.innerHTML = '';
				if (data.length > 0) {
					data.forEach(item => {
						const div = document.createElement('div');
						div.textContent = item.display_name;
						div.style.padding = '10px';
						div.style.cursor = 'pointer';
						div.onclick = () => {
							const lon = parseFloat(item.lon);
							const lat = parseFloat(item.lat);
							setSpawnSelection({
								lon,
								lat,
								label: item.display_name.split(',')[0].toUpperCase()
							});
							resultsContainer.style.display = 'none';

							searchInput.style.display = 'none';
							instructionText.style.display = 'block';
							instructionText.textContent = item.display_name.split(',')[0].toUpperCase();
							searchInput.value = item.display_name;
						};
						resultsContainer.appendChild(div);
					});
					resultsContainer.style.display = 'block';
				} else {
					resultsContainer.style.display = 'none';
				}
			} catch (error) {
				console.error('Search error:', error);
			} finally {
				if (searchToggleBtn) {
					searchToggleBtn.innerHTML = originalSearchIcon;
				}
			}
		}, 500);
	});

	document.addEventListener('click', (e) => {
		if (!searchInput.contains(e.target) && !resultsContainer.contains(e.target) && !searchToggleBtn.contains(e.target)) {
			resultsContainer.style.display = 'none';
			if (searchInput.style.display === 'block') {
				searchInput.style.display = 'none';
				instructionText.style.display = 'block';
			}
		}
	});
}

document.getElementById('confirmSpawnBtn').onclick = () => {
	const vignette = document.getElementById('transition-vignette');
	if (vignette) vignette.style.opacity = '1';

	soundManager.play('spawn');

	setTimeout(() => {
		const viewer = getViewer();
		if (spawnMarker) {
			viewer.entities.remove(spawnMarker);
			spawnMarker = null;
		}

		setControlsEnabled(false);

		state.speed = 100;
		state.pitch = 0;
		state.roll = 0;

		try {
			const cam = viewer && viewer.camera;
			if (cam && typeof cam.heading === 'number') {
				state.heading = Cesium.Math.toDegrees(cam.heading);
			} else {
				state.heading = 0;
			}
		} catch (e) {
			state.heading = 0;
		}

		currentRegionName = null;
		lastGeocodeTime = 0;
		lastGeocodePos = { lon: 0, lat: 0 };

		visualOffset.copy(BASE_PLANE_POS);
		visualRotation.set(0, 0, 0);
		boostRoll = 0;
		currentBoostZOffset = 0;
		lastIsBoosting = false;

		controller.reset();
		physics = new PlanePhysics();
		physics.reset(state.lon, state.lat, state.alt, state.heading, state.pitch, state.roll);
		state.flightAssistEnabled = controller.input.flightAssistEnabled;
		state.bestScore = bestScore;
		state.radarAltitude = null;
		state.verticalSpeedFpm = 0;

		hud.resetTime();
		hud.resizeMinimap();

		if (weaponSystem && typeof weaponSystem.resetAmmo === 'function') {
			weaponSystem.resetAmmo();
		}

		if (npcSystem) {
			npcSystem.spawnNPC(state.lon, state.lat, state.alt);
		}

		spawnInstruction.classList.add('hidden');
		confirmSpawnBtn.classList.add('hidden');
		loadingIndicator.classList.add('hidden');

		currentState = States.TRANSITIONING;
		setRenderOptimization(false);

		viewer.camera.flyTo({
			destination: Cesium.Cartesian3.fromDegrees(state.lon, state.lat, state.alt),
			orientation: {
				heading: Cesium.Math.toRadians(state.heading),
				pitch: Cesium.Math.toRadians(state.pitch),
				roll: Cesium.Math.toRadians(state.roll)
			},
			duration: 2.0,
			easingFunction: Cesium.EasingFunction.QUADRATIC_IN_OUT,
			complete: () => {
				flightStartTime = Date.now();
				uiContainer.classList.remove('hidden');
				const weaponsHud = document.getElementById('weapons-hud');
				if (weaponsHud) weaponsHud.classList.remove('hidden');
				threeContainer.classList.remove('hidden');
				hud.resizeMinimap();
				currentState = States.FLYING;
				soundManager.play('jet-engine', 1.0);
				if (vignette) vignette.style.opacity = '0';

				if (dialogueSystem) {
					dialogueSystem.start();
				}
			}
		});
	}, 500);
};

window.addEventListener('keydown', (e) => {
	const key = e.key.toLowerCase();
	if (key === 'escape') {
		const openModals = document.querySelectorAll('.modal:not(.hidden)');
		if (openModals.length > 0) {
			openModals.forEach(m => m.classList.add('hidden'));
			return;
		}
	}

	if (key === 'escape' || key === 'p') {
		if (currentState === States.FLYING) {
			currentState = States.PAUSED;
			if (dialogueSystem) dialogueSystem.pause();
			uiContainer.classList.add('hidden');
			const weaponsHud = document.getElementById('weapons-hud');
			if (weaponsHud) weaponsHud.classList.add('hidden');
			pauseMenu.classList.remove('hidden');
			hud.resizeMinimap();
			pauseGameplaySounds();
			hud.update(state, []);
		} else if (currentState === States.PAUSED) {
			currentState = States.FLYING;
			if (dialogueSystem) dialogueSystem.resume();
			pauseMenu.classList.add('hidden');
			uiContainer.classList.remove('hidden');
			const weaponsHud = document.getElementById('weapons-hud');
			if (weaponsHud) weaponsHud.classList.remove('hidden');
			resumeGameplaySounds();
		} else if (currentState === States.PICK_SPAWN && key === 'escape') {
			exitSpawnPicking();
		}
	}

	if (key === 'z' && currentState === States.FLYING) {
		if (dialogueSystem) dialogueSystem.skip();
	}
});

document.addEventListener('visibilitychange', () => {
	if (document.hidden && currentState === States.FLYING) {
		currentState = States.PAUSED;
		if (dialogueSystem) dialogueSystem.pause();
		uiContainer.classList.add('hidden');
		pauseMenu.classList.remove('hidden');
		hud.resizeMinimap();
		pauseGameplaySounds();
		hud.update(state, []);
	}
});

window.addEventListener('blur', () => {
	if (currentState === States.FLYING) {
		currentState = States.PAUSED;
		if (dialogueSystem) dialogueSystem.pause();
		uiContainer.classList.add('hidden');
		pauseMenu.classList.remove('hidden');
		hud.resizeMinimap();
		pauseGameplaySounds();
		hud.update(state, []);
	}
});

const viewer = initCesium();

enableGooglePhotorealistic3D()
	.then((enabled) => {
		if (enabled) {
			applyGoogle3DModeUI();
			loadingStatus.globe = true;
			updateLoadingUI();
			requestGroundHeightUpdate(true);
			return;
		}

		enableOsmBuildings3D().catch(() => { });
	})
	.catch(() => { });

viewer.camera.setView({
	destination: Cesium.Cartesian3.fromDegrees(28.9784, 41.0082, 1800000),
	orientation: {
		heading: Cesium.Math.toRadians(10),
		pitch: Cesium.Math.toRadians(-55),
		roll: 0
	}
});

loadingStatus.cesium = true;
updateLoadingUI();

let globeLoadingStarted = false;
let globeTrackerDisposed = false;
let globeFallbackTimer = 0;

const markGlobeLoaded = () => {
	if (loadingStatus.globe) return;

	loadingStatus.globe = true;
	updateLoadingUI();

	if (globeFallbackTimer) {
		window.clearTimeout(globeFallbackTimer);
		globeFallbackTimer = 0;
	}

	if (!globeTrackerDisposed) {
		unregisterGlobeTracker();
		globeTrackerDisposed = true;
	}
};

const unregisterGlobeTracker = viewer.scene.postRender.addEventListener(() => {
	const tilesLoaded = viewer.scene.globe.tilesLoaded;

	if (!tilesLoaded) {
		globeLoadingStarted = true;
	}

	if (tilesLoaded && globeLoadingStarted) {
		markGlobeLoaded();
	}
});

globeFallbackTimer = window.setTimeout(() => {
	if (!loadingStatus.globe && !loadingStatus.failed) {
		console.warn('Globe surface load timed out; continuing without blocking the menu.');
		markGlobeLoaded();
	}
}, 8000);

viewer.scene.globe.tileLoadProgressEvent.addEventListener((queueLength) => {
	if (queueLength > 0) {
		globeLoadingStarted = true;
	}

	if (queueLength === 0 && globeLoadingStarted) {
		markGlobeLoaded();
	}

	if (loadingIndicator && loadingText) {
		if (currentState === States.PICK_SPAWN) {
			if (queueLength > 0) {
				loadingText.textContent = "Loading Terrain...";
				loadingIndicator.classList.remove('hidden');
			} else {
				loadingIndicator.classList.add('hidden');
			}
		} else {
			const isAllLoaded = loadingStatus.audio && loadingStatus.model && loadingStatus.cesium && loadingStatus.globe;
			if (isAllLoaded) {
				loadingIndicator.classList.add('hidden');
			}
		}
	}
});

const resumeAudio = () => {
	if (soundManager.listener.context.state === 'suspended') {
		soundManager.listener.context.resume();
	}
	window.removeEventListener('mousedown', resumeAudio);
	window.removeEventListener('keydown', resumeAudio);
};
window.addEventListener('mousedown', resumeAudio);
window.addEventListener('keydown', resumeAudio);

initialCameraView = {
	destination: viewer.camera.position.clone(),
	orientation: {
		heading: viewer.camera.heading,
		pitch: viewer.camera.pitch,
		roll: viewer.camera.roll
	}
};

initThree();
npcSystem = new NPCSystem(viewer, scene, new GLTFLoader());
setupSpawnPicker();
setupLocationSearch();
setupSpawnPresets();
syncBestScoreUI();
loadSettings();

uiContainer.classList.add('hidden');
threeContainer.classList.add('hidden');

updateLoadingUI();
animate();

window.addEventListener('resize', () => {
	camera.aspect = window.innerWidth / window.innerHeight;
	camera.updateProjectionMatrix();
	renderer.setSize(window.innerWidth, window.innerHeight);

	const viewer = getViewer();
	if (viewer) viewer.resize();
});

window.addEventListener('contextmenu', (e) => {
	e.preventDefault();
}, false);
