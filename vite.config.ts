import { defineConfig } from 'vite';

// Relative base: the same build works at the root (dev, preview) and under a GitHub Pages sub-path (/ship-rpg/).
export default defineConfig({ base: './' });
