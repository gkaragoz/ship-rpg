import * as THREE from 'three';
import type { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { FullScreenQuad, Pass } from 'three/examples/jsm/postprocessing/Pass.js';

const vertexShader = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

/**
 * One bounce of light in screen space: every pixel gathers the colour of the lit surfaces around it that face it
 * (a sail's cream onto the deck under it, a sunlit hull side onto its neighbour) and adds it to its own colour,
 * weighted by how squarely the two surfaces face each other and by distance. Samples are spread on a rotated
 * spiral, with a per-pixel rotation, so the leftover grain is fine; it is a cheap stand-in for real path tracing,
 * good for colour bleeding and for lifting the shadowed sides that the sky light alone leaves flat.
 */
const fragmentShader = /* glsl */ `
uniform sampler2D tDiffuse;
uniform sampler2D tNormal;
uniform sampler2D tDepth;
uniform mat4 uProjInv;
uniform mat4 uProj;
uniform vec2 uResolution;
uniform float uRadius;
uniform float uStrength;
uniform float uTime;
varying vec2 vUv;

vec3 viewPos(vec2 uv, float depth) {
  vec4 p = uProjInv * vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
  return p.xyz / p.w;
}

float ign(vec2 p) {
  return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
}

void main() {
  vec4 base = texture2D(tDiffuse, vUv);
  float depth = texture2D(tDepth, vUv).x;
  if (depth >= 0.9999) { gl_FragColor = base; return; } // sky and sea are not in the normal pass
  vec3 n = normalize(texture2D(tNormal, vUv).xyz * 2.0 - 1.0);
  vec3 p = viewPos(vUv, depth);
  // radius in pixels: the world radius seen from this far away
  float pixels = clamp(uRadius * uProj[1][1] * 0.5 * uResolution.y / max(-p.z, 0.5), 3.0, 90.0);
  float rot = ign(gl_FragCoord.xy + uTime) * 6.2831853;
  vec3 sum = vec3(0.0);
  const int N = 12;
  for (int i = 0; i < N; i++) {
    float t = (float(i) + 0.5) / float(N);
    float a = rot + float(i) * 2.399963;
    vec2 uv = vUv + vec2(cos(a), sin(a)) * (sqrt(t) * pixels) / uResolution;
    if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) continue;
    float d = texture2D(tDepth, uv).x;
    if (d >= 0.9999) continue;
    vec3 q = viewPos(uv, d);
    vec3 v = q - p;
    float dist2 = dot(v, v) + 0.05;
    vec3 dir = v * inversesqrt(dist2);
    vec3 nq = normalize(texture2D(tNormal, uv).xyz * 2.0 - 1.0);
    float rx = max(dot(n, dir), 0.0);     // the receiver faces the emitter
    float em = max(dot(nq, -dir), 0.0);   // the emitter faces the receiver
    sum += texture2D(tDiffuse, uv).rgb * (rx * em) / (1.0 + dist2 * 0.15);
  }
  vec3 bounce = sum / float(N);
  // the pixel's own colour stands in for its albedo, with a floor so dark surfaces still pick light up
  gl_FragColor = vec4(base.rgb + bounce * (0.35 + base.rgb) * uStrength, base.a);
}`;

/** The screen-space global illumination pass; it needs the depth and normal buffers of the occlusion pass. */
export class SsgiPass extends Pass {
  private readonly material: THREE.ShaderMaterial;
  private readonly quad: FullScreenQuad;

  /** The occlusion pass whose depth and normal buffers this reads. */
  readonly source: GTAOPass;

  constructor(private readonly camera: THREE.PerspectiveCamera, source: GTAOPass, width: number, height: number) {
    super();
    this.source = source;
    const normals = source.normalTexture;
    const depth = source.depthTexture;
    this.material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tDiffuse: { value: null },
        tNormal: { value: normals },
        tDepth: { value: depth },
        uProjInv: { value: new THREE.Matrix4() },
        uProj: { value: new THREE.Matrix4() },
        uResolution: { value: new THREE.Vector2(width, height) },
        uRadius: { value: 4 },
        uStrength: { value: 1.2 },
        uTime: { value: 0 },
      },
    });
    this.quad = new FullScreenQuad(this.material);
  }

  override setSize(width: number, height: number): void {
    (this.material.uniforms.uResolution!.value as THREE.Vector2).set(width, height);
  }

  override render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget): void {
    const u = this.material.uniforms;
    u.tDiffuse!.value = readBuffer.texture;
    (u.uProj!.value as THREE.Matrix4).copy(this.camera.projectionMatrix);
    (u.uProjInv!.value as THREE.Matrix4).copy(this.camera.projectionMatrixInverse);
    u.uTime!.value = (u.uTime!.value as number) + 1;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }

  override dispose(): void {
    this.material.dispose();
    this.quad.dispose();
  }
}
