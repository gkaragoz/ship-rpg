import js from '@eslint/js';
import tseslint from 'typescript-eslint';

const MODULES = ['core', 'ships', 'world', 'render', 'gameplay', 'ui', 'audio', 'settings'];

/** Allowed imports per module; mirrors docs/ARCHITECTURE.md. */
const ALLOWED = {
  core: [],
  ships: ['core'],
  world: ['core'],
  render: ['core', 'ships', 'world', 'settings'],
  gameplay: ['core', 'ships', 'world'],
  ui: ['core', 'gameplay', 'world', 'settings'],
  audio: ['core', 'settings'],
  settings: ['core'],
};

const forbiddenFor = (mod) =>
  MODULES.filter((m) => m !== mod && !ALLOWED[mod].includes(m)).map((m) => ({
    group: [`**/${m}`, `**/${m}/**`],
    message: `${mod} must not import ${m} (see docs/ARCHITECTURE.md).`,
  }));

const moduleRules = MODULES.map((mod) => ({
  files: [`src/${mod}/**/*.ts`],
  rules: {
    'no-restricted-imports': [
      'error',
      {
        patterns: [
          ...forbiddenFor(mod),
          {
            group: MODULES.filter((m) => m !== mod).map((m) => `**/${m}/*`),
            message: 'Import other modules only via their index.ts.',
          },
        ],
      },
    ],
  },
}));

export default tseslint.config(
  { ignores: ['dist', 'node_modules'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...moduleRules,
  {
    files: ['src/**/*.ts'],
    rules: { 'max-lines': ['warn', { max: 300, skipBlankLines: true, skipComments: true }] },
  },
);
