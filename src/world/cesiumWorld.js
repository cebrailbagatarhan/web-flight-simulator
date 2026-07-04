import * as Cesium from 'cesium';

let viewer;
let miniViewer;
let pauseMiniViewer;
let googlePhotorealisticTileset = null;
let osmBuildingsTileset = null;
let googlePhotorealisticActive = false;

const ARCGIS_WORLD_IMAGERY_URL = 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer';
const GOOGLE_MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY?.trim();
const CESIUM_ION_TOKEN = import.meta.env.VITE_CESIUM_ION_TOKEN?.trim();

function applyBaseMap(viewInstance, useSatellite = false) {
	viewInstance.imageryLayers.removeAll();
	viewInstance.imageryLayers.addImageryProvider(new Cesium.OpenStreetMapImageryProvider({
		url: 'https://tile.openstreetmap.org/'
	}));

	if (useSatellite) {
		viewInstance.imageryLayers.add(Cesium.ImageryLayer.fromProviderAsync(
			Cesium.ArcGisMapServerImageryProvider.fromUrl(ARCGIS_WORLD_IMAGERY_URL, {
				enablePickFeatures: false
			})
		));
	}

	viewInstance.scene.globe.baseColor = Cesium.Color.fromCssColorString('#13222b');
	viewInstance.scene.backgroundColor = Cesium.Color.fromCssColorString('#0b1720');
}

function configureViewer(viewInstance, { hideCredits = false } = {}) {
	viewInstance.scene.requestRenderMode = false;
	viewInstance.scene.maximumRenderTimeChange = 0;
	viewInstance.scene.globe.maximumScreenSpaceError = 2;
	viewInstance.resolutionScale = 0.75;

	viewInstance.scene.screenSpaceCameraController.enableRotate = false;
	viewInstance.scene.screenSpaceCameraController.enableTranslate = false;
	viewInstance.scene.screenSpaceCameraController.enableZoom = false;
	viewInstance.scene.screenSpaceCameraController.enableTilt = false;
	viewInstance.scene.screenSpaceCameraController.enableLook = false;
	viewInstance.scene.screenSpaceCameraController.maximumZoomDistance = 25000000;

	viewInstance.scene.globe.tileCacheSize = 2048;
	viewInstance.scene.globe.preloadAncestors = true;
	viewInstance.scene.globe.preloadSiblings = true;
	viewInstance.scene.globe.loadingDescendantLimit = 20;
	viewInstance.scene.globe.skipLevelOfDetail = true;
	viewInstance.scene.globe.baseScreenSpaceError = 1024;
	viewInstance.scene.globe.skipScreenSpaceErrorFactor = 16;
	viewInstance.scene.globe.skipLevels = 1;

	if (hideCredits) {
		viewInstance._cesiumWidget._creditContainer.style.display = 'none';
	}
}

export function initCesium() {
	if (CESIUM_ION_TOKEN) {
		Cesium.Ion.defaultAccessToken = CESIUM_ION_TOKEN;
	}

	if (GOOGLE_MAPS_API_KEY) {
		Cesium.GoogleMaps.defaultApiKey = GOOGLE_MAPS_API_KEY;
	}

	viewer = new Cesium.Viewer('cesiumContainer', {
		terrainProvider: new Cesium.EllipsoidTerrainProvider(),
		timeline: false,
		animation: false,
		baseLayerPicker: false,
		geocoder: false,
		homeButton: false,
		infoBox: false,
		sceneModePicker: false,
		selectionIndicator: false,
		navigationHelpButton: false,
		fullscreenButton: false,
		shouldAnimate: false
	});

	miniViewer = new Cesium.Viewer('minimapCesium', {
		terrainProvider: new Cesium.EllipsoidTerrainProvider(),
		timeline: false,
		animation: false,
		baseLayerPicker: false,
		geocoder: false,
		homeButton: false,
		infoBox: false,
		sceneModePicker: false,
		selectionIndicator: false,
		navigationHelpButton: false,
		fullscreenButton: false,
		shouldAnimate: false,
		skyBox: false,
		skyAtmosphere: false,
		contextOptions: {
			webgl: {
				preserveDrawingBuffer: true
			}
		}
	});

	pauseMiniViewer = new Cesium.Viewer('pauseMinimapCesium', {
		terrainProvider: new Cesium.EllipsoidTerrainProvider(),
		timeline: false,
		animation: false,
		baseLayerPicker: false,
		geocoder: false,
		homeButton: false,
		infoBox: false,
		sceneModePicker: false,
		selectionIndicator: false,
		navigationHelpButton: false,
		fullscreenButton: false,
		shouldAnimate: false,
		skyBox: false,
		skyAtmosphere: false,
		contextOptions: {
			webgl: {
				preserveDrawingBuffer: true
			}
		}
	});

	applyBaseMap(viewer, true);
	applyBaseMap(miniViewer, false);
	applyBaseMap(pauseMiniViewer, false);

	configureViewer(viewer, { hideCredits: false });
	configureViewer(miniViewer, { hideCredits: true });
	configureViewer(pauseMiniViewer, { hideCredits: true });

	[miniViewer, pauseMiniViewer].forEach(v => {
		v.scene.globe.enableLighting = false;
		v.scene.globe.showGroundAtmosphere = false;
		v.scene.fog.enabled = false;
		v.scene.highDynamicRange = false;
		v.scene.postProcessStages.fxaa.enabled = false;
		v.resolutionScale = 1.0;
		v.scene.globe.maximumScreenSpaceError = 2;
		v.scene.globe.baseColor = Cesium.Color.BLACK;
		if (v.scene.skyAtmosphere) {
			v.scene.skyAtmosphere.show = false;
		}
	});

	viewer.scene.globe.enableLighting = false;
	viewer.scene.globe.showGroundAtmosphere = true;
	viewer.scene.globe.depthTestAgainstTerrain = true;
	viewer.scene.highDynamicRange = false;
	viewer.scene.postProcessStages.fxaa.enabled = true;
	viewer.scene.skyAtmosphere = new Cesium.SkyAtmosphere();
	viewer.scene.fog.enabled = true;
	viewer.scene.fog.density = 0.0001;

	setControlsEnabled(false);

	return viewer;
}

export async function enableGooglePhotorealistic3D() {
	if (!viewer || googlePhotorealisticTileset) {
		return googlePhotorealisticActive;
	}

	try {
		const tileset = await Cesium.createGooglePhotorealistic3DTileset(
			{
				key: GOOGLE_MAPS_API_KEY || undefined,
				onlyUsingWithGoogleGeocoder: true
			},
			{
				showCreditsOnScreen: true,
				enableCollision: true,
				maximumScreenSpaceError: 2,
				dynamicScreenSpaceError: true,
				preloadFlightDestinations: true,
				preferLeaves: true
			}
		);

		googlePhotorealisticTileset = viewer.scene.primitives.add(tileset);
		viewer.scene.globe.show = false;
		viewer.scene.skyAtmosphere.show = false;
		viewer.scene.fog.enabled = false;
		googlePhotorealisticActive = true;
		viewer.scene.requestRender();
		return true;
	} catch (error) {
		console.warn('Google Photorealistic 3D Tiles could not be enabled.', error);
		googlePhotorealisticTileset = null;
		googlePhotorealisticActive = false;
		viewer.scene.globe.show = true;
		if (viewer.scene.skyAtmosphere) {
			viewer.scene.skyAtmosphere.show = true;
		}
		enableOsmBuildings3D().catch(() => { });
		return false;
	}
}

export async function enableOsmBuildings3D() {
	if (!viewer || osmBuildingsTileset || googlePhotorealisticActive) {
		return Boolean(osmBuildingsTileset);
	}

	try {
		const tileset = await Cesium.createOsmBuildingsAsync({
			showCreditsOnScreen: true,
			enableShowOutline: false,
			showOutline: false,
			maximumScreenSpaceError: 2
		});

		tileset.maximumScreenSpaceError = 1;
		tileset.dynamicScreenSpaceError = true;
		tileset.shadows = Cesium.ShadowMode.ENABLED;
		osmBuildingsTileset = viewer.scene.primitives.add(tileset);
		viewer.scene.requestRender();
		return true;
	} catch (error) {
		console.warn('Cesium OSM Buildings could not be enabled.', error);
		osmBuildingsTileset = null;
		return false;
	}
}

export function isGooglePhotorealisticConfigured() {
	return Boolean(GOOGLE_MAPS_API_KEY || CESIUM_ION_TOKEN);
}

export function isGooglePhotorealisticActive() {
	return googlePhotorealisticActive;
}

export function setRenderOptimization(isMenu) {
	if (!viewer || !miniViewer || !pauseMiniViewer) return;

	[viewer, miniViewer, pauseMiniViewer].forEach(v => {
		v.scene.requestRenderMode = !isMenu;
		v.scene.maximumRenderTimeChange = !isMenu ? Infinity : 0;
	});
}

export function setControlsEnabled(enabled) {
	if (!viewer) return;
	const ctrl = viewer.scene.screenSpaceCameraController;
	ctrl.enableRotate = enabled;
	ctrl.enableTranslate = enabled;
	ctrl.enableZoom = enabled;
	ctrl.enableTilt = enabled;
	ctrl.enableLook = enabled;
}

export function setCameraToPlane(lon, lat, alt, heading, pitch, roll) {
	if (!viewer) return;

	viewer.camera.setView({
		destination: Cesium.Cartesian3.fromDegrees(lon, lat, alt),
		orientation: {
			heading: Cesium.Math.toRadians(heading),
			pitch: Cesium.Math.toRadians(pitch),
			roll: Cesium.Math.toRadians(roll)
		}
	});

	viewer.scene.requestRender();
}

export function setMinimapCamera(lon, lat, altitude, heading) {
	if (!miniViewer) return;

	if (miniViewer.canvas.width === 0 || miniViewer.canvas.height === 0) {
		return;
	}

	miniViewer.camera.setView({
		destination: Cesium.Cartesian3.fromDegrees(lon, lat, altitude),
		orientation: {
			heading: Cesium.Math.toRadians(heading),
			pitch: Cesium.Math.toRadians(-90),
			roll: 0
		}
	});

	miniViewer.scene.requestRender();
}

export function setPauseMinimapCamera(lon, lat, altitude, heading) {
	if (!pauseMiniViewer) return;

	if (pauseMiniViewer.canvas.width === 0 || pauseMiniViewer.canvas.height === 0) {
		return;
	}

	pauseMiniViewer.camera.setView({
		destination: Cesium.Cartesian3.fromDegrees(lon, lat, altitude),
		orientation: {
			heading: Cesium.Math.toRadians(heading),
			pitch: Cesium.Math.toRadians(-90),
			roll: 0
		}
	});

	pauseMiniViewer.scene.requestRender();
}

export function getViewer() {
	return viewer;
}

export function getMiniViewer() {
	return miniViewer;
}

export function getPauseMiniViewer() {
	return pauseMiniViewer;
}
