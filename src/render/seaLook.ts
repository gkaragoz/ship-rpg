import * as THREE from 'three';

export const SUN_DIR = new THREE.Vector3(-0.45, 0.5, -0.35).normalize();
export const HORIZON_COLOR = new THREE.Color(0xb7d4e0);
/** Distant islands fade into the haze; the far sea is fully fogged before its own edge. */
export const FOG_NEAR = 250;
export const FOG_FAR = 2400;
