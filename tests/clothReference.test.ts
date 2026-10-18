import { describe, expect, it } from 'vitest';
import { clothShaderSource } from '../src/ships/clothShader';

/**
 * `tests/clothReference.ts` (the CPU copy of the shader's gather that the frozen-vertex tests use) cannot run the GLSL,
 * so this pins the exact GLSL expressions it mirrors: editing one of them in `clothShader.ts` fails here until the
 * reference is updated to match.
 */
describe('the GLSL gather the CPU reference mirrors', () => {
  const norm = (s: string): string => s.replace(/\s+/g, ' ');
  const src = norm(clothShaderSource);
  const lines = [
    'float g = clamp(furl * 0.93 * (1.0 + 0.22 * abs(2.0 * u - 1.0)), 0.0, 0.96);',
    'float tear = uTear * 0.35 * smoothstep(0.1, 1.0, 1.0 - clothA.y);',
    'float keep = (1.0 - g) * (1.0 - tear);',
    'float margin = rigid > 0.5 ? min(0.25, 0.08 * H) : 0.0;',
    'float d2 = d <= margin ? d : margin + (d - margin) * keep;',
    'float dy = above > 0.0 ? d - d2 : 0.0;',
    'float H = max(clothB.y, 0.05);',
    'float d = max(yTop - p.y, 0.0);',
    'float tip = (aft && rigid < 0.5) ? 1.0 - clothC.w : 0.0;',
    'vec2 shrunk = clothC.xy + (p0 - clothC.xy) * (1.0 - 0.93 * g);',
    'p.xy = mix(p.xy, shrunk, tip);',
    'p.xy = tack + (p.xy - tack) * (1.0 - g);',
    'float rigid = step(10.0, code);',
    'float slot = mod(code, 10.0);',
  ];
  it.each(lines)('contains %s', (line) => {
    expect(src).toContain(norm(line));
  });

  it('gathers a jib with its own furl by index', () => {
    expect(src).toContain(norm('float jib = clothA.x - 5.0;'));
    expect(src).toContain(norm('(jib < 0.5 ? uJibFurl.x : jib < 1.5 ? uJibFurl.y : uJibFurl.z) * 0.93'));
  });
});
