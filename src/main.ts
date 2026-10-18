import * as THREE from 'three';
import { startLoop } from './core';

const host = document.getElementById('app');
if (!host) throw new Error('#app not found');

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
host.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x7fb2c9);
const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
camera.position.set(0, 5, 12);
camera.lookAt(0, 0, 0);

const resize = (): void => {
  renderer.setSize(host.clientWidth, host.clientHeight);
  camera.aspect = host.clientWidth / host.clientHeight;
  camera.updateProjectionMatrix();
};
window.addEventListener('resize', resize);
resize();

startLoop({
  update: () => {},
  render: () => renderer.render(scene, camera),
});
