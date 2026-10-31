import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { BokehPass } from 'three/examples/jsm/postprocessing/BokehPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export type ProceduralModelOptions = {
  wireframe?: boolean;
  castShadow?: boolean;
  receiveShadow?: boolean;
  textureSize?: number;
  textureAnisotropy?: number;
  qualityPriority?: 'reference-fidelity' | 'balanced';
};

export type ProceduralModelRuntime = {
  nodes: Record<string, THREE.Object3D>;
  meshes: Record<string, THREE.Mesh>;
  sockets: Record<string, THREE.Object3D>;
  colliders: Record<string, unknown>;
  destructionGroups: Record<string, THREE.Object3D[]>;
};

type SculptMaterialSpec = Record<string, any>;

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function readLayerNumber(value: unknown, keys: string[], fallback: number): number {
  if (typeof value === 'number') return value;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    for (const key of keys) {
      if (typeof record[key] === 'number') return record[key] as number;
    }
  }
  return fallback;
}

function hexToRgb(hex: string): [number, number, number] {
  const normalized = /^#[0-9a-f]{3}$/i.test(hex)
    ? '#' + hex.slice(1).split('').map((part) => part + part).join('')
    : hex;
  const value = /^#[0-9a-f]{6}$/i.test(normalized) ? Number.parseInt(normalized.slice(1), 16) : 0x8a7a5f;
  return [clampAlbedoChannel((value >> 16) & 255), clampAlbedoChannel((value >> 8) & 255), clampAlbedoChannel(value & 255)];
}

function materialPalette(spec: SculptMaterialSpec): string[] {
  const palette = spec.colorVariation?.palette;
  if (Array.isArray(palette) && palette.length > 0) return palette.filter((value) => typeof value === 'string');
  const secondary = spec.albedo?.secondary;
  const colors = [spec.baseColor ?? spec.color ?? spec.albedo?.dominant, ...(Array.isArray(secondary) ? secondary : [])];
  return colors.filter((value): value is string => typeof value === 'string' && value.startsWith('#'));
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function clampAlbedoChannel(value: number): number {
  return Math.max(30, Math.min(240, Math.round(value)));
}

function clampPbrF0(value: number): number {
  return Math.max(0.02, Math.min(1, value));
}

function clampPbrIor(value: number): number {
  return Math.max(1, Math.min(2.5, value));
}

function clampPbrMetalness(value: number): number {
  return value >= 0.5 ? 1 : 0;
}

function clampedAlbedoColor(spec: SculptMaterialSpec): THREE.Color {
  const source = typeof spec.baseColor === 'string' ? spec.baseColor : '#8A7A5F';
  // setStyle with an explicit SRGBColorSpace, NOT the numeric constructor.
  //
  // `new THREE.Color(r, g, b)` treats its arguments as LINEAR working-space components,
  // while an authored `baseColor` hex is sRGB. Feeding one to the other skipped the
  // transfer function and lifted every dark albedo: #2e2a28, authored as a near-black
  // vinyl, rendered at roughly sRGB 0.46 — a mid grey. The error is largest exactly where
  // it matters most, because the transfer curve is steepest near black.
  return new THREE.Color().setStyle(source, THREE.SRGBColorSpace);
}

function smoothCurve(value: number): number {
  return value * value * (3 - 2 * value);
}

function periodicHash(x: number, y: number, seed: number, periodX: number, periodY: number): number {
  const wrappedX = ((x % periodX) + periodX) % periodX;
  const wrappedY = ((y % periodY) + periodY) % periodY;
  let value = Math.imul(wrappedX + seed * 17, 374761393) ^ Math.imul(wrappedY + seed * 31, 668265263);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
}

function periodicValueNoise(u: number, v: number, seed: number, periodX: number, periodY: number): number {
  const x = u * periodX;
  const y = v * periodY;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = smoothCurve(x - x0);
  const ty = smoothCurve(y - y0);
  const a = periodicHash(x0, y0, seed, periodX, periodY);
  const b = periodicHash(x0 + 1, y0, seed, periodX, periodY);
  const c = periodicHash(x0, y0 + 1, seed, periodX, periodY);
  const d = periodicHash(x0 + 1, y0 + 1, seed, periodX, periodY);
  return THREE.MathUtils.lerp(THREE.MathUtils.lerp(a, b, tx), THREE.MathUtils.lerp(c, d, tx), ty);
}

type SurfaceBand = {
  frequency: number;
  amplitude: number;
  stretchX: number;
  stretchY: number;
  ridge: boolean;
};

function surfaceBands(spec: SculptMaterialSpec): SurfaceBand[] {
  const source = Array.isArray(spec.surfaceFrequencyBands) ? spec.surfaceFrequencyBands : [];
  const parsed = source.flatMap((item: unknown) => {
    if (!item || typeof item !== 'object') return [];
    const band = item as Record<string, unknown>;
    const frequency = typeof band.frequency === 'number' ? band.frequency : 0;
    const amplitude = typeof band.amplitude === 'number' ? band.amplitude : 0;
    if (frequency <= 0 || amplitude <= 0) return [];
    const stretch = Array.isArray(band.stretch) ? band.stretch : [1, 1];
    const description = `${String(band.pattern ?? '')} ${String(band.role ?? '')}`.toLowerCase();
    return [{
      frequency,
      amplitude,
      stretchX: typeof stretch[0] === 'number' ? Math.max(0.1, stretch[0]) : 1,
      stretchY: typeof stretch[1] === 'number' ? Math.max(0.1, stretch[1]) : 1,
      ridge: /(ridge|groove|grain|fiber|striated|crack)/.test(description),
    }];
  });
  return parsed.length > 0 ? parsed : [
    { frequency: 2, amplitude: 0.42, stretchX: 1, stretchY: 1, ridge: false },
    { frequency: 12, amplitude: 0.22, stretchX: 1, stretchY: 1, ridge: false },
    { frequency: 56, amplitude: 0.08, stretchX: 1, stretchY: 1, ridge: false },
  ];
}

function sampleSurface(u: number, v: number, bands: SurfaceBand[], seed: number): number {
  let value = 0;
  let weight = 0;
  for (let index = 0; index < bands.length; index += 1) {
    const band = bands[index];
    const periodX = Math.max(1, Math.round(band.frequency * band.stretchX));
    const periodY = Math.max(1, Math.round(band.frequency * band.stretchY));
    let sample = periodicValueNoise(u, v, seed + index * 1013, periodX, periodY);
    if (band.ridge) sample = 1 - Math.abs(sample * 2 - 1);
    value += sample * band.amplitude;
    weight += band.amplitude;
  }
  return weight > 0 ? clamp01(value / weight) : 0.5;
}

function mixPalette(colors: [number, number, number][], value: number): [number, number, number] {
  if (colors.length === 1) return colors[0];
  const scaled = clamp01(value) * (colors.length - 1);
  const index = Math.min(colors.length - 2, Math.floor(scaled));
  const mix = scaled - index;
  const a = colors[index];
  const b = colors[index + 1];
  return [
    Math.round(THREE.MathUtils.lerp(a[0], b[0], mix)),
    Math.round(THREE.MathUtils.lerp(a[1], b[1], mix)),
    Math.round(THREE.MathUtils.lerp(a[2], b[2], mix)),
  ];
}

type ColorGradientStop = { offset: number; color: string };
type ColorGradientSpec = {
  type: 'linear' | 'radial';
  axis: [number, number];
  stops: ColorGradientStop[];
};

function parseRgba(value: string): [number, number, number] {
  const match = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(value);
  if (!match) return [138, 122, 95];
  return [clampAlbedoChannel(Number(match[1])), clampAlbedoChannel(Number(match[2])), clampAlbedoChannel(Number(match[3]))];
}

// Analytical per-pixel gradient sample. The extraction schema's colorGradient carries
// exact rgba(...) stop colors (see extract_part_color_recipe.py), so this samples the
// same trend directly in JS math rather than round-tripping through a Canvas 2D
// createLinearGradient/createRadialGradient object — same visual result, and it composes
// directly with the existing noise/height-correlated colorVariation blend below.
function sampleColorGradient(gradient: ColorGradientSpec, u: number, v: number): [number, number, number] {
  const stops = gradient.stops.length >= 2 ? gradient.stops : [{ offset: 0, color: 'rgba(138,122,95,1)' }, { offset: 1, color: 'rgba(138,122,95,1)' }];
  let t: number;
  if (gradient.type === 'radial') {
    const [cx, cy] = gradient.axis;
    const dx = u - cx;
    const dy = v - cy;
    const maxRadius = Math.max(0.001, Math.hypot(Math.max(cx, 1 - cx), Math.max(cy, 1 - cy)));
    t = clamp01(Math.hypot(dx, dy) / maxRadius);
  } else {
    const [ax, ay] = gradient.axis;
    const projection = (u - 0.5) * ax + (v - 0.5) * ay;
    const maxProjection = 0.5 * (Math.abs(ax) + Math.abs(ay)) || 0.5;
    t = clamp01(projection / maxProjection + 0.5);
  }
  const scaled = t * (stops.length - 1);
  const index = Math.min(stops.length - 2, Math.max(0, Math.floor(scaled)));
  const mix = scaled - index;
  const a = parseRgba(stops[index].color);
  const b = parseRgba(stops[index + 1].color);
  return [
    THREE.MathUtils.lerp(a[0], b[0], mix),
    THREE.MathUtils.lerp(a[1], b[1], mix),
    THREE.MathUtils.lerp(a[2], b[2], mix),
  ];
}

function writePixel(data: Uint8ClampedArray, offset: number, red: number, green: number, blue: number): void {
  data[offset] = Math.max(0, Math.min(255, Math.round(red)));
  data[offset + 1] = Math.max(0, Math.min(255, Math.round(green)));
  data[offset + 2] = Math.max(0, Math.min(255, Math.round(blue)));
  data[offset + 3] = 255;
}

function makeCanvas(size: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  return canvas;
}

function createMapTexture(
  canvas: HTMLCanvasElement,
  colorSpace: THREE.ColorSpace,
  spec: SculptMaterialSpec,
  options: ProceduralModelOptions,
): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas);
  const projection = spec.textureProjection && typeof spec.textureProjection === 'object' ? spec.textureProjection : {};
  const repeat = Array.isArray(projection.repeat) ? projection.repeat : [2, 2];
  texture.colorSpace = colorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(
    typeof repeat[0] === 'number' ? repeat[0] : 2,
    typeof repeat[1] === 'number' ? repeat[1] : 2,
  );
  texture.anisotropy = Math.max(1, Math.round(options.textureAnisotropy ?? projection.anisotropy ?? 8));
  texture.needsUpdate = true;
  return texture;
}

type ProceduralTextureSet = {
  albedo: THREE.Texture;
  roughness: THREE.Texture;
  height: THREE.Texture;
  normal: THREE.Texture;
  ao: THREE.Texture;
  source: 'reference-pixel-extraction' | 'procedural';
};

function referenceMapUrl(spec: SculptMaterialSpec, channel: string): string | null {
  const reference = spec.referencePbr;
  if (!reference || typeof reference !== 'object') return null;
  if (reference.usable === false) return null;
  const confidence = typeof reference.confidence === 'number'
    ? reference.confidence
    : (typeof reference.estimatedFidelity === 'number' ? reference.estimatedFidelity : 0);
  const threshold = typeof reference.targetThreshold === 'number' ? reference.targetThreshold : 0.7;
  if (confidence < threshold) return null;
  const maps = reference.maps;
  if (!maps || typeof maps !== 'object') return null;
  const map = (maps as Record<string, unknown>)[channel];
  if (!map || typeof map !== 'object') return null;
  const record = map as Record<string, unknown>;
  const url = typeof record.url === 'string' && record.url.trim() ? record.url : record.path;
  return typeof url === 'string' && url.trim() ? url : null;
}

function createLoadedMapTexture(
  url: string,
  colorSpace: THREE.ColorSpace,
  spec: SculptMaterialSpec,
  options: ProceduralModelOptions,
): THREE.Texture {
  const texture = new THREE.TextureLoader().load(url);
  const projection = spec.textureProjection && typeof spec.textureProjection === 'object' ? spec.textureProjection : {};
  const repeat = Array.isArray(projection.repeat) ? projection.repeat : [1, 1];
  texture.colorSpace = colorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(
    typeof repeat[0] === 'number' ? repeat[0] : 1,
    typeof repeat[1] === 'number' ? repeat[1] : 1,
  );
  texture.anisotropy = Math.max(1, Math.round(options.textureAnisotropy ?? projection.anisotropy ?? 8));
  texture.needsUpdate = true;
  return texture;
}

function makeReferenceTextureSet(spec: SculptMaterialSpec, options: ProceduralModelOptions): ProceduralTextureSet | null {
  const albedo = referenceMapUrl(spec, 'albedo');
  const roughness = referenceMapUrl(spec, 'roughness');
  const height = referenceMapUrl(spec, 'height');
  const normal = referenceMapUrl(spec, 'normal');
  const ao = referenceMapUrl(spec, 'ao');
  if (!albedo || !roughness || !height || !normal || !ao) return null;
  return {
    albedo: createLoadedMapTexture(albedo, THREE.SRGBColorSpace, spec, options),
    roughness: createLoadedMapTexture(roughness, THREE.NoColorSpace, spec, options),
    height: createLoadedMapTexture(height, THREE.NoColorSpace, spec, options),
    normal: createLoadedMapTexture(normal, THREE.NoColorSpace, spec, options),
    ao: createLoadedMapTexture(ao, THREE.NoColorSpace, spec, options),
    source: 'reference-pixel-extraction',
  };
}

function makeProceduralTextureSet(
  id: string,
  spec: SculptMaterialSpec,
  options: ProceduralModelOptions,
): ProceduralTextureSet | null {
  if (typeof document === 'undefined') return null;
  const qualityFirst = (options.qualityPriority ?? 'reference-fidelity') === 'reference-fidelity';
  const requested = options.textureSize ?? spec.textureResolution;
  const requestedSize = typeof requested === 'number' && Number.isFinite(requested)
    ? requested
    : (qualityFirst ? 1024 : 512);
  const size = Math.max(256, Math.min(2048, 2 ** Math.round(Math.log2(requestedSize))));
  const canvases = {
    albedo: makeCanvas(size),
    roughness: makeCanvas(size),
    height: makeCanvas(size),
    normal: makeCanvas(size),
    ao: makeCanvas(size),
  };
  const contexts = {
    albedo: canvases.albedo.getContext('2d'),
    roughness: canvases.roughness.getContext('2d'),
    height: canvases.height.getContext('2d'),
    normal: canvases.normal.getContext('2d'),
    ao: canvases.ao.getContext('2d'),
  };
  if (!contexts.albedo || !contexts.roughness || !contexts.height || !contexts.normal || !contexts.ao) return null;
  const images = {
    albedo: contexts.albedo.createImageData(size, size),
    roughness: contexts.roughness.createImageData(size, size),
    height: contexts.height.createImageData(size, size),
    normal: contexts.normal.createImageData(size, size),
    ao: contexts.ao.createImageData(size, size),
  };
  const seed = hashString(id);
  const bands = surfaceBands(spec);
  const heightField = new Float32Array(size * size);
  const roughnessField = new Float32Array(size * size);
  const palette = materialPalette(spec);
  const fallback = typeof spec.baseColor === 'string' ? spec.baseColor : '#8A7A5F';
  const colors = (palette.length >= 2 ? palette : [fallback, '#6E614B', '#A08F70']).map(hexToRgb);
  const baseRoughness = clamp01(readLayerNumber(spec.roughness, ['base'], 0.76));
  const roughnessVariation = clamp01(readLayerNumber(spec.roughness, ['variation'], 0.18));
  const colorAmplitude = clamp01(readLayerNumber(spec.colorVariation, ['amplitude', 'variation'], 0.18));
  const heightCorrelation = clamp01(readLayerNumber(spec.colorVariation, ['heightCorrelation'], 0.3));
  const colorGradient: ColorGradientSpec | undefined = spec.colorGradient;
  for (let y = 0; y < size; y += 1) {
    const v = y / size;
    for (let x = 0; x < size; x += 1) {
      const u = x / size;
      const index = y * size + x;
      const height = sampleSurface(u, v, bands, seed + 101);
      const roughNoise = sampleSurface(u, v, bands, seed + 7001);
      const colorNoise = sampleSurface(u, v, bands, seed + 15013);
      heightField[index] = height;
      roughnessField[index] = clamp01(baseRoughness + (roughNoise - 0.5) * roughnessVariation * 2);
      let color: [number, number, number];
      if (colorGradient) {
        // Evidence-derived spatial gradient (Plan 1.3 Workstream C) takes priority
        // over the noise-based palette blend below — it is a measured trend, not a guess.
        color = sampleColorGradient(colorGradient, u, v);
      } else {
        const paletteValue = clamp01(
          0.5 + (colorNoise - 0.5) * colorAmplitude * 2 + (height - 0.5) * heightCorrelation
        );
        color = mixPalette(colors, paletteValue);
      }
      writePixel(images.albedo.data, index * 4, color[0], color[1], color[2]);
    }
  }
  const normalStrength = Math.max(0.05, readLayerNumber(spec.normal, ['strength', 'amplitude'], 0.35));
  const aoStrength = clamp01(readLayerNumber(spec.ambientOcclusion, ['cavityStrength', 'strength'], 0.35));
  for (let y = 0; y < size; y += 1) {
    const up = ((y - 1 + size) % size) * size;
    const down = ((y + 1) % size) * size;
    for (let x = 0; x < size; x += 1) {
      const left = (x - 1 + size) % size;
      const right = (x + 1) % size;
      const index = y * size + x;
      const center = heightField[index];
      const dx = (heightField[y * size + right] - heightField[y * size + left]) * normalStrength * 6;
      const dy = (heightField[down + x] - heightField[up + x]) * normalStrength * 6;
      const inverseLength = 1 / Math.sqrt(dx * dx + dy * dy + 1);
      const normalX = -dx * inverseLength;
      const normalY = -dy * inverseLength;
      const normalZ = inverseLength;
      const neighborAverage = (
        heightField[y * size + left] + heightField[y * size + right]
        + heightField[up + x] + heightField[down + x]
      ) * 0.25;
      const cavity = Math.max(0, neighborAverage - center);
      const ao = clamp01(1 - aoStrength * (cavity * 12 + (1 - center) * 0.16));
      const offset = index * 4;
      const heightByte = center * 255;
      const roughnessByte = roughnessField[index] * 255;
      writePixel(images.height.data, offset, heightByte, heightByte, heightByte);
      writePixel(images.roughness.data, offset, roughnessByte, roughnessByte, roughnessByte);
      writePixel(
        images.normal.data, offset,
        (normalX * 0.5 + 0.5) * 255,
        (normalY * 0.5 + 0.5) * 255,
        (normalZ * 0.5 + 0.5) * 255,
      );
      writePixel(images.ao.data, offset, ao * 255, ao * 255, ao * 255);
    }
  }
  contexts.albedo.putImageData(images.albedo, 0, 0);
  contexts.roughness.putImageData(images.roughness, 0, 0);
  contexts.height.putImageData(images.height, 0, 0);
  contexts.normal.putImageData(images.normal, 0, 0);
  contexts.ao.putImageData(images.ao, 0, 0);
  return {
    albedo: createMapTexture(canvases.albedo, THREE.SRGBColorSpace, spec, options),
    roughness: createMapTexture(canvases.roughness, THREE.NoColorSpace, spec, options),
    height: createMapTexture(canvases.height, THREE.NoColorSpace, spec, options),
    normal: createMapTexture(canvases.normal, THREE.NoColorSpace, spec, options),
    ao: createMapTexture(canvases.ao, THREE.NoColorSpace, spec, options),
    source: 'procedural',
  };
}

function createSculptMaterial(id: string, spec: SculptMaterialSpec, options: ProceduralModelOptions, denseComponent = false): THREE.MeshPhysicalMaterial {
  // A material that declares -- with evidence -- that its subject carries no texture
  // detail gets NO texture set. Synthesising one anyway is not a harmless default: the
  // branch below then forces color to white and roughness to 1 and reads both from the
  // generated maps, so the authored albedo and the reference-derived roughness are both
  // discarded, and the model gains mottling the reference does not have. Measured on the
  // tuxedo cat, whose black fur rendered as speckled grey-and-white from a palette that
  // only ever described two flat regions.
  const textureless = (spec.textureless as { declared?: boolean } | undefined)?.declared === true;
  const textures = textureless
    ? null
    : makeReferenceTextureSet(spec, options) ?? makeProceduralTextureSet(id, spec, options);
  const material = new THREE.MeshPhysicalMaterial({
    color: textures ? 0xffffff : clampedAlbedoColor(spec),
    roughness: textures ? 1 : clamp01(readLayerNumber(spec.roughness, ['base'], 0.76)),
    metalness: clampPbrMetalness(readLayerNumber(spec.metalness, ['base'], 0.0)),
    clearcoat: clamp01(readLayerNumber(spec.clearcoat, ['base', 'amount'], 0)),
    clearcoatRoughness: clamp01(readLayerNumber(spec.clearcoatRoughness, ['base'], 0.25)),
    transmission: clamp01(readLayerNumber(spec.transmission, ['base', 'amount'], 0)),
    ior: clampPbrIor(readLayerNumber(spec.ior, ['base', 'value'], 1.5)),
    thickness: Math.max(0, readLayerNumber(spec.thickness, ['base', 'amount'], 0)),
    attenuationDistance: Math.max(0.001, readLayerNumber(spec.attenuationDistance, ['base', 'value'], Infinity)),
    attenuationColor: new THREE.Color(typeof spec.attenuationColor === 'string' ? spec.attenuationColor : '#ffffff'),
    sheen: clamp01(readLayerNumber(spec.sheen, ['base', 'amount'], 0)),
    sheenColor: new THREE.Color(typeof spec.sheenColor === 'string' ? spec.sheenColor : '#ffffff'),
    sheenRoughness: clamp01(readLayerNumber(spec.sheenRoughness, ['base'], 1.0)),
    iridescence: clamp01(readLayerNumber(spec.iridescence, ['base', 'amount'], 0)),
    iridescenceIOR: clampPbrIor(readLayerNumber(spec.iridescenceIOR, ['base', 'value'], 1.3)),
    anisotropy: clamp01(readLayerNumber(spec.anisotropy, ['base', 'amount'], 0)),
    anisotropyRotation: readLayerNumber(spec.anisotropy, ['rotation'], 0),
    specularIntensity: clampPbrF0(readLayerNumber(spec.specularF0 ?? spec.f0 ?? spec.specularIntensity, ['base', 'value'], 1.0)),
    specularColor: new THREE.Color(typeof spec.specularColor === 'string' ? spec.specularColor : '#ffffff'),
    emissive: new THREE.Color(typeof spec.emissive === 'string' ? spec.emissive : '#000000'),
    emissiveIntensity: Math.max(0, readLayerNumber(spec.emissiveIntensity, ['base'], 1.0)),
    opacity: clamp01(readLayerNumber(spec.opacity, ['base'], 1)),
    transparent: readLayerNumber(spec.transmission, ['base', 'amount'], 0) > 0 || readLayerNumber(spec.opacity, ['base'], 1) < 1,
    alphaTest: Math.max(0, readLayerNumber(spec.alpha, ['cutoff', 'alphaTest'], 0)),
    wireframe: options.wireframe ?? false,
    side: spec.doubleSided === true ? THREE.DoubleSide : THREE.FrontSide,
    flatShading: spec.flatShading === true,
  });
  if (textures) {
    material.map = textures.albedo;
    material.roughnessMap = textures.roughness;
    material.normalMap = textures.normal;
    material.normalScale.setScalar(Math.max(0.05, readLayerNumber(spec.normal, ['strength', 'amplitude'], 0.35)));
    material.aoMap = textures.ao;
    material.aoMap.channel = 0;
    material.aoMapIntensity = readLayerNumber(spec.ambientOcclusion, ['cavityStrength', 'strength'], 0.35);
    const denseMesh = denseComponent || spec.denseMesh === true || spec.geometryDensity === 'dense' || spec.topologyClass === 'dense';
    const bumpScale = Math.max(0, readLayerNumber(spec.bump, ['amplitude', 'strength'], 0));
    const effectiveBumpScale = denseMesh ? Math.max(0.05, bumpScale) : bumpScale;
    if (effectiveBumpScale > 0) {
      material.bumpMap = textures.height;
      material.bumpScale = effectiveBumpScale;
    }
    const displacementScale = Math.max(0, readLayerNumber(spec.displacement, ['amplitude', 'strength'], 0));
    const effectiveDisplacementScale = denseMesh ? Math.max(0.005, displacementScale) : displacementScale;
    if (effectiveDisplacementScale > 0) {
      material.displacementMap = textures.height;
      material.displacementScale = effectiveDisplacementScale;
      material.displacementBias = -effectiveDisplacementScale * 0.5;
    }
  }
  material.envMapIntensity = readLayerNumber(spec, ['envMapIntensity'], 0.8);
  material.userData.sculptMaterial = spec;
  material.userData.proceduralMapsIndependent = true;
  material.userData.pbrConstraints = { albedoRange: [30, 240], binaryMetalness: true, f0Range: [0.02, 1], iorRange: [1, 2.5] };
  material.userData.pbrTextureSource = textures?.source ?? 'flat-fallback';
  material.userData.referencePbr = spec.referencePbr ?? null;
  material.userData.referenceMaterialId = spec.referenceMaterialId ?? spec.materialReference?.profileId ?? null;
  material.userData.materialEvidence = spec.materialEvidence ?? null;
  material.userData.validationViews = spec.materialReference?.validationViews ?? [];
  material.needsUpdate = true;
  return material;
}

type AttachmentEndpoint = {
  start: THREE.Vector3;
  midpoint: THREE.Vector3;
  quaternion: THREE.Quaternion;
  length: number;
  baseRadius: number;
  endRadius: number;
};

function readVector3(value: unknown, fallback: [number, number, number]): THREE.Vector3 {
  if (Array.isArray(value) && value.length === 3 && value.every((item) => typeof item === 'number')) {
    return new THREE.Vector3(value[0], value[1], value[2]);
  }
  return new THREE.Vector3(fallback[0], fallback[1], fallback[2]);
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function makeAttachmentEndpoint(attachment: unknown): AttachmentEndpoint | null {
  if (!attachment || typeof attachment !== 'object') return null;
  const record = attachment as Record<string, unknown>;
  const start = readVector3(record.localStart, [0, 0, 0]);
  const end = readVector3(record.localEnd, [0, 1, 0]);
  const delta = end.clone().sub(start);
  const length = delta.length();
  if (length <= 0.0001) return null;
  const direction = delta.clone().normalize();
  const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
  const baseRadius = Math.max(0.005, readNumber(record.baseRadius, 0.06));
  const endRadius = Math.max(0.003, readNumber(record.endRadius, baseRadius * 0.55));
  return {
    start,
    midpoint: delta.multiplyScalar(0.5),
    quaternion,
    length,
    baseRadius,
    endRadius,
  };
}

// Generated from ObjectSculptSpec target: orange four-door crew-cab pickup
// Sculpt build pass: form-refinement
// This factory is intentionally pass-gated. Finish browser screenshot review before unlocking deeper passes.
export function createOrangeFourDoorCrewCabPickupModel(options: ProceduralModelOptions = {}): THREE.Group {
  const root = new THREE.Group();
  root.name = "orange four-door crew-cab pickup";
  root.userData.reconstructionEvidence = {"itemFamily": null, "subtype": null, "componentAdapter": null, "route": null, "exactnessTier": null, "referenceCamera": {"family": "pickup", "yaw": -0.7198707736017249, "pitch": 0.028203590971125625, "fov": 15, "distance": 12.250157448066414, "lookY": 0.947993691472284, "offsetX": -56.78167834544249, "width": 1536, "height": 1024, "normalizedRms": 1.2291403025089904, "projected": {"box": [2.6260174539555408, 240.7284563400978, 1486.5663348802977, 881.665323665946], "centers": [[675.7918171963006, 730.5467962414536], [1362.384763654064, 667.2529136828017]], "radii": [149.0980687470282, 120.40101280546565]}, "reference": {"front": [670, 749], "rear": [1340, 677], "radii": [167, 130], "width": 1536, "height": 1024, "bbox": [30, 207, 1509, 865], "confidence": 0.7, "note": "Wheel landmarks estimated visually, +/- 15 pixels; alpha bbox measured from generated isolated reference. No claim of calibrated real camera."}, "note": "Camera-only least-squares fit, not geometry deformation. Visually estimated wheel landmarks; requires browser comparison before acceptance."}, "approximationNotes": []};
  root.userData.materialPipeline = {};
  root.userData.materialReferenceRegistry = null;

  const materialMap: Record<string, THREE.Material> = {};
  materialMap["hidden"] = createSculptMaterial(
    "hidden",
    {"id": "hidden", "name": "hidden", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#000000", "color": "#000000", "albedo": {"dominant": "#000000", "secondary": ["#000000"]}, "colorVariation": {"palette": ["#000000"], "pattern": "none", "amplitude": 0, "heightCorrelation": 0.3}, "roughness": {"base": 1}, "metalness": {"base": 0, "variation": 0}, "ambientOcclusion": {"cavityStrength": 0.25, "contactShadowBias": 0.35, "notes": "Darken creases, seams, intersections, and recessed local features."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [{"id": "hidden-finish", "region": "whole component", "roughness": 1, "evidenceRefs": ["canonical"]}], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Generated concept has unpatterned solid materials; scalar PBR approximation, no baked studio highlight in albedo.", "opacity": 0, "transparent": true, "clearcoat": 0, "textureless": {"declared": true, "evidence": ["C:\\Users\\recto\\Documents\\Codex\\2026-10-15\\voic\\work\\BrawlAcademy3D\\experiments\\fleet-lab\\reference-pickup.png: clean uniform original concept; studio reflections are not albedo patterns."]}},
    options
  );
  materialMap["paint"] = createSculptMaterial(
    "paint",
    {"id": "paint", "name": "paint", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#c76b21", "color": "#c76b21", "albedo": {"dominant": "#c76b21", "secondary": ["#398c92"]}, "colorVariation": {"palette": ["#398c92"], "pattern": "none", "amplitude": 0, "heightCorrelation": 0.3}, "roughness": {"base": 0.32}, "metalness": {"base": 0.18, "variation": 0}, "ambientOcclusion": {"cavityStrength": 0.25, "contactShadowBias": 0.35, "notes": "Darken creases, seams, intersections, and recessed local features."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [{"id": "paint-finish", "region": "whole component", "roughness": 0.32, "evidenceRefs": ["canonical"]}], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Generated concept has unpatterned solid materials; scalar PBR approximation, no baked studio highlight in albedo.", "opacity": 1, "transparent": false, "clearcoat": 0.35, "textureless": {"declared": true, "evidence": ["C:\\Users\\recto\\Documents\\Codex\\2026-10-15\\voic\\work\\BrawlAcademy3D\\experiments\\fleet-lab\\reference-pickup.png: clean uniform original concept; studio reflections are not albedo patterns."]}},
    options
  );
  materialMap["rubber"] = createSculptMaterial(
    "rubber",
    {"id": "rubber", "name": "rubber", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#24292c", "color": "#24292c", "albedo": {"dominant": "#24292c", "secondary": ["#24292c"]}, "colorVariation": {"palette": ["#24292c"], "pattern": "none", "amplitude": 0, "heightCorrelation": 0.3}, "roughness": {"base": 0.85}, "metalness": {"base": 0, "variation": 0}, "ambientOcclusion": {"cavityStrength": 0.25, "contactShadowBias": 0.35, "notes": "Darken creases, seams, intersections, and recessed local features."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [{"id": "rubber-finish", "region": "whole component", "roughness": 0.85, "evidenceRefs": ["canonical"]}], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Generated concept has unpatterned solid materials; scalar PBR approximation, no baked studio highlight in albedo.", "opacity": 1, "transparent": false, "clearcoat": 0, "textureless": {"declared": true, "evidence": ["C:\\Users\\recto\\Documents\\Codex\\2026-10-15\\voic\\work\\BrawlAcademy3D\\experiments\\fleet-lab\\reference-pickup.png: clean uniform original concept; studio reflections are not albedo patterns."]}},
    options
  );
  materialMap["metal"] = createSculptMaterial(
    "metal",
    {"id": "metal", "name": "metal", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#b3bfc5", "color": "#b3bfc5", "albedo": {"dominant": "#b3bfc5", "secondary": ["#b3bfc5"]}, "colorVariation": {"palette": ["#b3bfc5"], "pattern": "none", "amplitude": 0, "heightCorrelation": 0.3}, "roughness": {"base": 0.28}, "metalness": {"base": 0.75, "variation": 0}, "ambientOcclusion": {"cavityStrength": 0.25, "contactShadowBias": 0.35, "notes": "Darken creases, seams, intersections, and recessed local features."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [{"id": "metal-finish", "region": "whole component", "roughness": 0.28, "evidenceRefs": ["canonical"]}], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Generated concept has unpatterned solid materials; scalar PBR approximation, no baked studio highlight in albedo.", "opacity": 1, "transparent": false, "clearcoat": 0, "textureless": {"declared": true, "evidence": ["C:\\Users\\recto\\Documents\\Codex\\2026-10-15\\voic\\work\\BrawlAcademy3D\\experiments\\fleet-lab\\reference-pickup.png: clean uniform original concept; studio reflections are not albedo patterns."]}},
    options
  );
  materialMap["dark"] = createSculptMaterial(
    "dark",
    {"id": "dark", "name": "dark", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#29343b", "color": "#29343b", "albedo": {"dominant": "#29343b", "secondary": ["#29343b"]}, "colorVariation": {"palette": ["#29343b"], "pattern": "none", "amplitude": 0, "heightCorrelation": 0.3}, "roughness": {"base": 0.7}, "metalness": {"base": 0, "variation": 0}, "ambientOcclusion": {"cavityStrength": 0.25, "contactShadowBias": 0.35, "notes": "Darken creases, seams, intersections, and recessed local features."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [{"id": "dark-finish", "region": "whole component", "roughness": 0.7, "evidenceRefs": ["canonical"]}], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Generated concept has unpatterned solid materials; scalar PBR approximation, no baked studio highlight in albedo.", "opacity": 1, "transparent": false, "clearcoat": 0, "textureless": {"declared": true, "evidence": ["C:\\Users\\recto\\Documents\\Codex\\2026-10-15\\voic\\work\\BrawlAcademy3D\\experiments\\fleet-lab\\reference-pickup.png: clean uniform original concept; studio reflections are not albedo patterns."]}},
    options
  );
  materialMap["glass"] = createSculptMaterial(
    "glass",
    {"id": "glass", "name": "glass", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#accbd4", "color": "#accbd4", "albedo": {"dominant": "#accbd4", "secondary": ["#accbd4"]}, "colorVariation": {"palette": ["#accbd4"], "pattern": "none", "amplitude": 0, "heightCorrelation": 0.3}, "roughness": {"base": 0.16}, "metalness": {"base": 0.02, "variation": 0}, "ambientOcclusion": {"cavityStrength": 0.25, "contactShadowBias": 0.35, "notes": "Darken creases, seams, intersections, and recessed local features."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [{"id": "glass-finish", "region": "whole component", "roughness": 0.16, "evidenceRefs": ["canonical"]}], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Generated concept has unpatterned solid materials; scalar PBR approximation, no baked studio highlight in albedo.", "opacity": 0.24, "transparent": true, "clearcoat": 0, "textureless": {"declared": true, "evidence": ["C:\\Users\\recto\\Documents\\Codex\\2026-10-15\\voic\\work\\BrawlAcademy3D\\experiments\\fleet-lab\\reference-pickup.png: clean uniform original concept; studio reflections are not albedo patterns."]}},
    options
  );
  materialMap["lamp"] = createSculptMaterial(
    "lamp",
    {"id": "lamp", "name": "lamp", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#eceddf", "color": "#eceddf", "albedo": {"dominant": "#eceddf", "secondary": ["#eceddf"]}, "colorVariation": {"palette": ["#eceddf"], "pattern": "none", "amplitude": 0, "heightCorrelation": 0.3}, "roughness": {"base": 0.23}, "metalness": {"base": 0.1, "variation": 0}, "ambientOcclusion": {"cavityStrength": 0.25, "contactShadowBias": 0.35, "notes": "Darken creases, seams, intersections, and recessed local features."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [{"id": "lamp-finish", "region": "whole component", "roughness": 0.23, "evidenceRefs": ["canonical"]}], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Generated concept has unpatterned solid materials; scalar PBR approximation, no baked studio highlight in albedo.", "opacity": 1, "transparent": false, "clearcoat": 0, "textureless": {"declared": true, "evidence": ["C:\\Users\\recto\\Documents\\Codex\\2026-10-15\\voic\\work\\BrawlAcademy3D\\experiments\\fleet-lab\\reference-pickup.png: clean uniform original concept; studio reflections are not albedo patterns."]}},
    options
  );
  materialMap["red"] = createSculptMaterial(
    "red",
    {"id": "red", "name": "red", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#b52d35", "color": "#b52d35", "albedo": {"dominant": "#b52d35", "secondary": ["#b52d35"]}, "colorVariation": {"palette": ["#b52d35"], "pattern": "none", "amplitude": 0, "heightCorrelation": 0.3}, "roughness": {"base": 0.32}, "metalness": {"base": 0.05, "variation": 0}, "ambientOcclusion": {"cavityStrength": 0.25, "contactShadowBias": 0.35, "notes": "Darken creases, seams, intersections, and recessed local features."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [{"id": "red-finish", "region": "whole component", "roughness": 0.32, "evidenceRefs": ["canonical"]}], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Generated concept has unpatterned solid materials; scalar PBR approximation, no baked studio highlight in albedo.", "opacity": 1, "transparent": false, "clearcoat": 0, "textureless": {"declared": true, "evidence": ["C:\\Users\\recto\\Documents\\Codex\\2026-10-15\\voic\\work\\BrawlAcademy3D\\experiments\\fleet-lab\\reference-pickup.png: clean uniform original concept; studio reflections are not albedo patterns."]}},
    options
  );
  materialMap["amber"] = createSculptMaterial(
    "amber",
    {"id": "amber", "name": "amber", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#d58b30", "color": "#d58b30", "albedo": {"dominant": "#d58b30", "secondary": ["#d58b30"]}, "colorVariation": {"palette": ["#d58b30"], "pattern": "none", "amplitude": 0, "heightCorrelation": 0.3}, "roughness": {"base": 0.4}, "metalness": {"base": 0.05, "variation": 0}, "ambientOcclusion": {"cavityStrength": 0.25, "contactShadowBias": 0.35, "notes": "Darken creases, seams, intersections, and recessed local features."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [{"id": "amber-finish", "region": "whole component", "roughness": 0.4, "evidenceRefs": ["canonical"]}], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Generated concept has unpatterned solid materials; scalar PBR approximation, no baked studio highlight in albedo.", "opacity": 1, "transparent": false, "clearcoat": 0, "textureless": {"declared": true, "evidence": ["C:\\Users\\recto\\Documents\\Codex\\2026-10-15\\voic\\work\\BrawlAcademy3D\\experiments\\fleet-lab\\reference-pickup.png: clean uniform original concept; studio reflections are not albedo patterns."]}},
    options
  );

  const nodes: Record<string, THREE.Object3D> = { root };
  const meshes: Record<string, THREE.Mesh> = {};
  const sockets: Record<string, THREE.Object3D> = {};
  const colliders: Record<string, unknown> = {};
  const destructionGroups: Record<string, THREE.Object3D[]> = {};

  const endpoint_root_0 = makeAttachmentEndpoint(null);
  const node_root_0 = new THREE.Group();
  node_root_0.name = "root__pivot";
  node_root_0.scale.set(1, 1, 1);
  if (endpoint_root_0) {
    node_root_0.position.copy(endpoint_root_0.start);
    node_root_0.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_root_0.position.set(0.0, 0.0, 0.0);
    node_root_0.rotation.set(0.0, 0.0, 0.0);
  }
  node_root_0.userData.sculptComponent = {"id": "root", "name": "root", "level": "macro", "role": "rigid mechanical part", "importance": 1, "confidence": 0.86, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Separate rigid hardware has its own mechanical boundary.", "geometryDescriptor": {"normalStrategy": "smooth indexed normals", "uvStrategy": "procedural solid color", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.012, "segments": 2}, "deformationStack": [], "roadSurface": {"kind": "root"}}, "parent": null, "attachment": null, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.85}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "root-mount", "position": [0, 0, 0], "axis": [0, 1, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": ["root"], "breakImpulse": 12, "debrisMaterial": "hidden"}}, "material": "hidden", "materialLayers": ["hidden"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {}, "evidenceRefs": ["canonical", "profile", "rear"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(0, 0, 0, 1)", "secondaryAlbedo": "rgba(0, 0, 0, 1)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRefs": ["full-object"], "componentId": "root"}};
  node_root_0.userData.actionProfile = {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "root-mount", "position": [0, 0, 0], "axis": [0, 1, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": ["root"], "breakImpulse": 12, "debrisMaterial": "hidden"}};
  (nodes["root"] ?? root).add(node_root_0);
  nodes["root"] = node_root_0;
  const mesh_root_0Geometry = endpoint_root_0
    ? new THREE.CylinderGeometry(endpoint_root_0.endRadius, endpoint_root_0.baseRadius, endpoint_root_0.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_root_0) {
    mesh_root_0Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_root_0 = new THREE.Mesh(
    mesh_root_0Geometry,
    materialMap["hidden"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_root_0.name = "root";
  if (endpoint_root_0) {
    mesh_root_0.position.copy(endpoint_root_0.midpoint);
    mesh_root_0.quaternion.copy(endpoint_root_0.quaternion);
  }
  mesh_root_0.castShadow = options.castShadow ?? true;
  mesh_root_0.receiveShadow = options.receiveShadow ?? true;
  mesh_root_0.userData.sculptComponent = {"id": "root", "name": "root", "level": "macro", "role": "rigid mechanical part", "importance": 1, "confidence": 0.86, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Separate rigid hardware has its own mechanical boundary.", "geometryDescriptor": {"normalStrategy": "smooth indexed normals", "uvStrategy": "procedural solid color", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.012, "segments": 2}, "deformationStack": [], "roadSurface": {"kind": "root"}}, "parent": null, "attachment": null, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.85}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "root-mount", "position": [0, 0, 0], "axis": [0, 1, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": ["root"], "breakImpulse": 12, "debrisMaterial": "hidden"}}, "material": "hidden", "materialLayers": ["hidden"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {}, "evidenceRefs": ["canonical", "profile", "rear"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(0, 0, 0, 1)", "secondaryAlbedo": "rgba(0, 0, 0, 1)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRefs": ["full-object"], "componentId": "root"}};
  node_root_0.add(mesh_root_0);
  meshes["root"] = mesh_root_0;
  colliders["root"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_root_0);
  const socket_root_root_mount_0 = new THREE.Object3D();
  socket_root_root_mount_0.name = "root-mount";
  socket_root_root_mount_0.position.set(0.0, 0.0, 0.0);
  socket_root_root_mount_0.rotation.set(0, 0, 0);
  socket_root_root_mount_0.userData.socket = {"id": "root-mount", "position": [0, 0, 0], "axis": [0, 1, 0]};
  node_root_0.add(socket_root_root_mount_0);
  sockets["root:root-mount"] = socket_root_root_mount_0;

  const endpoint_chassis_1 = makeAttachmentEndpoint(null);
  const node_chassis_1 = new THREE.Group();
  node_chassis_1.name = "chassis__pivot";
  node_chassis_1.scale.set(1, 1, 1);
  if (endpoint_chassis_1) {
    node_chassis_1.position.copy(endpoint_chassis_1.start);
    node_chassis_1.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_chassis_1.position.set(0.0, 0.0, 0.0);
    node_chassis_1.rotation.set(0.0, 0.0, 0.0);
  }
  node_chassis_1.userData.sculptComponent = {"id": "chassis", "name": "chassis", "level": "macro", "role": "rigid mechanical part", "importance": 1, "confidence": 0.86, "primitive": "plane-card", "topologyClass": "assembled-solid", "topologyRationale": "Separate rigid hardware has its own mechanical boundary.", "geometryDescriptor": {"normalStrategy": "smooth indexed normals", "uvStrategy": "procedural solid color", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.012, "segments": 2}, "deformationStack": [], "roadSurface": {"kind": "floor"}}, "parent": "root", "attachment": {"parentSocket": "root-to-chassis", "localStart": [0, 0.20000000298023224, 0], "localEnd": [0, 0.20000000298023224, 0], "contactType": "overlap", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.012, "parentId": "root"}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.85}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "rigid", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "chassis-mount", "position": [0, 0, 0], "axis": [0, 1, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "chassis", "seamRefs": [], "detachableFragments": ["chassis"], "breakImpulse": 12, "debrisMaterial": "hidden"}}, "material": "dark", "materialLayers": ["dark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {}, "evidenceRefs": ["canonical", "profile", "rear"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(41, 52, 59, 1)", "secondaryAlbedo": "rgba(41, 52, 59, 1)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRefs": ["full-object"], "componentId": "chassis"}};
  node_chassis_1.userData.actionProfile = {"animationRole": "rigid", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "chassis-mount", "position": [0, 0, 0], "axis": [0, 1, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "chassis", "seamRefs": [], "detachableFragments": ["chassis"], "breakImpulse": 12, "debrisMaterial": "hidden"}};
  (nodes["root"] ?? root).add(node_chassis_1);
  nodes["chassis"] = node_chassis_1;
  const mesh_chassis_1Geometry = endpoint_chassis_1
    ? new THREE.CylinderGeometry(endpoint_chassis_1.endRadius, endpoint_chassis_1.baseRadius, endpoint_chassis_1.length, 16, 6)
    : new THREE.PlaneGeometry(1, 1, 12, 12);
  if (!endpoint_chassis_1) {
    mesh_chassis_1Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_chassis_1 = new THREE.Mesh(
    mesh_chassis_1Geometry,
    materialMap["dark"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_chassis_1.name = "chassis";
  if (endpoint_chassis_1) {
    mesh_chassis_1.position.copy(endpoint_chassis_1.midpoint);
    mesh_chassis_1.quaternion.copy(endpoint_chassis_1.quaternion);
  }
  mesh_chassis_1.castShadow = options.castShadow ?? true;
  mesh_chassis_1.receiveShadow = options.receiveShadow ?? true;
  mesh_chassis_1.userData.sculptComponent = {"id": "chassis", "name": "chassis", "level": "macro", "role": "rigid mechanical part", "importance": 1, "confidence": 0.86, "primitive": "plane-card", "topologyClass": "assembled-solid", "topologyRationale": "Separate rigid hardware has its own mechanical boundary.", "geometryDescriptor": {"normalStrategy": "smooth indexed normals", "uvStrategy": "procedural solid color", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.012, "segments": 2}, "deformationStack": [], "roadSurface": {"kind": "floor"}}, "parent": "root", "attachment": {"parentSocket": "root-to-chassis", "localStart": [0, 0.20000000298023224, 0], "localEnd": [0, 0.20000000298023224, 0], "contactType": "overlap", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.012, "parentId": "root"}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.85}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "rigid", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "chassis-mount", "position": [0, 0, 0], "axis": [0, 1, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "chassis", "seamRefs": [], "detachableFragments": ["chassis"], "breakImpulse": 12, "debrisMaterial": "hidden"}}, "material": "dark", "materialLayers": ["dark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {}, "evidenceRefs": ["canonical", "profile", "rear"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(41, 52, 59, 1)", "secondaryAlbedo": "rgba(41, 52, 59, 1)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRefs": ["full-object"], "componentId": "chassis"}};
  node_chassis_1.add(mesh_chassis_1);
  meshes["chassis"] = mesh_chassis_1;
  colliders["chassis"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["chassis"] ??= [];
  destructionGroups["chassis"].push(node_chassis_1);
  const socket_chassis_chassis_mount_0 = new THREE.Object3D();
  socket_chassis_chassis_mount_0.name = "chassis-mount";
  socket_chassis_chassis_mount_0.position.set(0.0, 0.0, 0.0);
  socket_chassis_chassis_mount_0.rotation.set(0, 0, 0);
  socket_chassis_chassis_mount_0.userData.socket = {"id": "chassis-mount", "position": [0, 0, 0], "axis": [0, 1, 0]};
  node_chassis_1.add(socket_chassis_chassis_mount_0);
  sockets["chassis:chassis-mount"] = socket_chassis_chassis_mount_0;

  const endpoint_hood_2 = makeAttachmentEndpoint(null);
  const node_hood_2 = new THREE.Group();
  node_hood_2.name = "hood__pivot";
  node_hood_2.scale.set(1, 1, 1);
  if (endpoint_hood_2) {
    node_hood_2.position.copy(endpoint_hood_2.start);
    node_hood_2.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_hood_2.position.set(0.0, 0.0, 0.0);
    node_hood_2.rotation.set(0.0, 0.0, 0.0);
  }
  node_hood_2.userData.sculptComponent = {"id": "hood", "name": "hood", "level": "macro", "role": "rigid mechanical part", "importance": 1, "confidence": 0.86, "primitive": "plane-card", "topologyClass": "conforming-shell", "topologyRationale": "Conforming analytic automotive skin follows continuous section profile.", "geometryDescriptor": {"normalStrategy": "smooth indexed normals", "uvStrategy": "procedural solid color", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.012, "segments": 2}, "deformationStack": [], "roadSurface": {"kind": "deck", "z0": -2.2, "z1": -0.72}}, "parent": "root", "attachment": {"parentSocket": "root-to-hood", "localStart": [0, 0.755, -0.73], "localEnd": [0, 0.8098893748223782, -1.4650000238418577], "contactType": "hinge", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.012, "parentId": "root"}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.85}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "rigid", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "hood-mount", "position": [0, 0, 0], "axis": [0, 1, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "hood", "seamRefs": [], "detachableFragments": ["hood"], "breakImpulse": 12, "debrisMaterial": "hidden"}}, "material": "paint", "materialLayers": ["paint"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "crowned-hood", "kind": "contour", "description": "crowned-hood", "evidenceRefs": ["canonical"]}], "surfaceDetail": {}, "evidenceRefs": ["canonical", "profile", "rear"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(199, 107, 33, 1)", "secondaryAlbedo": "rgba(199, 107, 33, 1)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRefs": ["full-object"], "componentId": "hood"}};
  node_hood_2.userData.actionProfile = {"animationRole": "rigid", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "hood-mount", "position": [0, 0, 0], "axis": [0, 1, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "hood", "seamRefs": [], "detachableFragments": ["hood"], "breakImpulse": 12, "debrisMaterial": "hidden"}};
  (nodes["root"] ?? root).add(node_hood_2);
  nodes["hood"] = node_hood_2;
  const mesh_hood_2Geometry = endpoint_hood_2
    ? new THREE.CylinderGeometry(endpoint_hood_2.endRadius, endpoint_hood_2.baseRadius, endpoint_hood_2.length, 16, 6)
    : new THREE.PlaneGeometry(1, 1, 12, 12);
  if (!endpoint_hood_2) {
    mesh_hood_2Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_hood_2 = new THREE.Mesh(
    mesh_hood_2Geometry,
    materialMap["paint"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_hood_2.name = "hood";
  if (endpoint_hood_2) {
    mesh_hood_2.position.copy(endpoint_hood_2.midpoint);
    mesh_hood_2.quaternion.copy(endpoint_hood_2.quaternion);
  }
  mesh_hood_2.castShadow = options.castShadow ?? true;
  mesh_hood_2.receiveShadow = options.receiveShadow ?? true;
  mesh_hood_2.userData.sculptComponent = {"id": "hood", "name": "hood", "level": "macro", "role": "rigid mechanical part", "importance": 1, "confidence": 0.86, "primitive": "plane-card", "topologyClass": "conforming-shell", "topologyRationale": "Conforming analytic automotive skin follows continuous section profile.", "geometryDescriptor": {"normalStrategy": "smooth indexed normals", "uvStrategy": "procedural solid color", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.012, "segments": 2}, "deformationStack": [], "roadSurface": {"kind": "deck", "z0": -2.2, "z1": -0.72}}, "parent": "root", "attachment": {"parentSocket": "root-to-hood", "localStart": [0, 0.755, -0.73], "localEnd": [0, 0.8098893748223782, -1.4650000238418577], "contactType": "hinge", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.012, "parentId": "root"}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.85}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "rigid", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "hood-mount", "position": [0, 0, 0], "axis": [0, 1, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "hood", "seamRefs": [], "detachableFragments": ["hood"], "breakImpulse": 12, "debrisMaterial": "hidden"}}, "material": "paint", "materialLayers": ["paint"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "crowned-hood", "kind": "contour", "description": "crowned-hood", "evidenceRefs": ["canonical"]}], "surfaceDetail": {}, "evidenceRefs": ["canonical", "profile", "rear"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(199, 107, 33, 1)", "secondaryAlbedo": "rgba(199, 107, 33, 1)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRefs": ["full-object"], "componentId": "hood"}};
  node_hood_2.add(mesh_hood_2);
  meshes["hood"] = mesh_hood_2;
  colliders["hood"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["hood"] ??= [];
  destructionGroups["hood"].push(node_hood_2);
  const socket_hood_hood_mount_0 = new THREE.Object3D();
  socket_hood_hood_mount_0.name = "hood-mount";
  socket_hood_hood_mount_0.position.set(0.0, 0.0, 0.0);
  socket_hood_hood_mount_0.rotation.set(0, 0, 0);
  socket_hood_hood_mount_0.userData.socket = {"id": "hood-mount", "position": [0, 0, 0], "axis": [0, 1, 0]};
  node_hood_2.add(socket_hood_hood_mount_0);
  sockets["hood:hood-mount"] = socket_hood_hood_mount_0;

  const endpoint_trunk_3 = makeAttachmentEndpoint(null);
  const node_trunk_3 = new THREE.Group();
  node_trunk_3.name = "trunk__pivot";
  node_trunk_3.scale.set(1, 1, 1);
  if (endpoint_trunk_3) {
    node_trunk_3.position.copy(endpoint_trunk_3.start);
    node_trunk_3.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_trunk_3.position.set(0.0, 0.0, 0.0);
    node_trunk_3.rotation.set(0.0, 0.0, 0.0);
  }
  node_trunk_3.userData.sculptComponent = {"id": "trunk", "name": "trunk", "level": "macro", "role": "rigid mechanical part", "importance": 1, "confidence": 0.86, "primitive": "plane-card", "topologyClass": "conforming-shell", "topologyRationale": "Conforming analytic automotive skin follows continuous section profile.", "geometryDescriptor": {"normalStrategy": "smooth indexed normals", "uvStrategy": "procedural solid color", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.012, "segments": 2}, "deformationStack": [], "roadSurface": {"kind": "deck", "z0": 1.28, "z1": 2.2}}, "parent": "root", "attachment": {"parentSocket": "root-to-trunk", "localStart": [0, 0.8052146012935635, 1.35], "localEnd": [0, 0.8076072919223305, 1.7750000238418582], "contactType": "hinge", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.012, "parentId": "root"}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.85}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "rigid", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "trunk-mount", "position": [0, 0, 0], "axis": [0, 1, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "trunk", "seamRefs": [], "detachableFragments": ["trunk"], "breakImpulse": 12, "debrisMaterial": "hidden"}}, "material": "paint", "materialLayers": ["paint"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {}, "evidenceRefs": ["canonical", "profile", "rear"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(199, 107, 33, 1)", "secondaryAlbedo": "rgba(199, 107, 33, 1)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRefs": ["full-object"], "componentId": "trunk"}};
  node_trunk_3.userData.actionProfile = {"animationRole": "rigid", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "trunk-mount", "position": [0, 0, 0], "axis": [0, 1, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "trunk", "seamRefs": [], "detachableFragments": ["trunk"], "breakImpulse": 12, "debrisMaterial": "hidden"}};
  (nodes["root"] ?? root).add(node_trunk_3);
  nodes["trunk"] = node_trunk_3;
  const mesh_trunk_3Geometry = endpoint_trunk_3
    ? new THREE.CylinderGeometry(endpoint_trunk_3.endRadius, endpoint_trunk_3.baseRadius, endpoint_trunk_3.length, 16, 6)
    : new THREE.PlaneGeometry(1, 1, 12, 12);
  if (!endpoint_trunk_3) {
    mesh_trunk_3Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_trunk_3 = new THREE.Mesh(
    mesh_trunk_3Geometry,
    materialMap["paint"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_trunk_3.name = "trunk";
  if (endpoint_trunk_3) {
    mesh_trunk_3.position.copy(endpoint_trunk_3.midpoint);
    mesh_trunk_3.quaternion.copy(endpoint_trunk_3.quaternion);
  }
  mesh_trunk_3.castShadow = options.castShadow ?? true;
  mesh_trunk_3.receiveShadow = options.receiveShadow ?? true;
  mesh_trunk_3.userData.sculptComponent = {"id": "trunk", "name": "trunk", "level": "macro", "role": "rigid mechanical part", "importance": 1, "confidence": 0.86, "primitive": "plane-card", "topologyClass": "conforming-shell", "topologyRationale": "Conforming analytic automotive skin follows continuous section profile.", "geometryDescriptor": {"normalStrategy": "smooth indexed normals", "uvStrategy": "procedural solid color", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.012, "segments": 2}, "deformationStack": [], "roadSurface": {"kind": "deck", "z0": 1.28, "z1": 2.2}}, "parent": "root", "attachment": {"parentSocket": "root-to-trunk", "localStart": [0, 0.8052146012935635, 1.35], "localEnd": [0, 0.8076072919223305, 1.7750000238418582], "contactType": "hinge", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.012, "parentId": "root"}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.85}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "rigid", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "trunk-mount", "position": [0, 0, 0], "axis": [0, 1, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "trunk", "seamRefs": [], "detachableFragments": ["trunk"], "breakImpulse": 12, "debrisMaterial": "hidden"}}, "material": "paint", "materialLayers": ["paint"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {}, "evidenceRefs": ["canonical", "profile", "rear"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(199, 107, 33, 1)", "secondaryAlbedo": "rgba(199, 107, 33, 1)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRefs": ["full-object"], "componentId": "trunk"}};
  node_trunk_3.add(mesh_trunk_3);
  meshes["trunk"] = mesh_trunk_3;
  colliders["trunk"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["trunk"] ??= [];
  destructionGroups["trunk"].push(node_trunk_3);
  const socket_trunk_trunk_mount_0 = new THREE.Object3D();
  socket_trunk_trunk_mount_0.name = "trunk-mount";
  socket_trunk_trunk_mount_0.position.set(0.0, 0.0, 0.0);
  socket_trunk_trunk_mount_0.rotation.set(0, 0, 0);
  socket_trunk_trunk_mount_0.userData.socket = {"id": "trunk-mount", "position": [0, 0, 0], "axis": [0, 1, 0]};
  node_trunk_3.add(socket_trunk_trunk_mount_0);
  sockets["trunk:trunk-mount"] = socket_trunk_trunk_mount_0;

  const endpoint_roof_4 = makeAttachmentEndpoint(null);
  const node_roof_4 = new THREE.Group();
  node_roof_4.name = "roof__pivot";
  node_roof_4.scale.set(1, 1, 1);
  if (endpoint_roof_4) {
    node_roof_4.position.copy(endpoint_roof_4.start);
    node_roof_4.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_roof_4.position.set(0.0, 0.0, 0.0);
    node_roof_4.rotation.set(0.0, 0.0, 0.0);
  }
  node_roof_4.userData.sculptComponent = {"id": "roof", "name": "roof", "level": "macro", "role": "rigid mechanical part", "importance": 1, "confidence": 0.86, "primitive": "plane-card", "topologyClass": "conforming-shell", "topologyRationale": "Conforming analytic automotive skin follows continuous section profile.", "geometryDescriptor": {"normalStrategy": "smooth indexed normals", "uvStrategy": "procedural solid color", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.012, "segments": 2}, "deformationStack": [], "roadSurface": {"kind": "roof"}}, "parent": "root", "attachment": {"parentSocket": "root-to-roof", "localStart": [0, 1.1160868108272552, 0.3100000023841858], "localEnd": [0, 1.1160868108272552, 0.3100000023841858], "contactType": "overlap", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.012, "parentId": "root"}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.85}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "rigid", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "roof-mount", "position": [0, 0, 0], "axis": [0, 1, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "roof", "seamRefs": [], "detachableFragments": ["roof"], "breakImpulse": 12, "debrisMaterial": "hidden"}}, "material": "paint", "materialLayers": ["paint"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "roof-camber", "kind": "contour", "description": "roof-camber", "evidenceRefs": ["canonical"]}], "surfaceDetail": {}, "evidenceRefs": ["canonical", "profile", "rear"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(199, 107, 33, 1)", "secondaryAlbedo": "rgba(199, 107, 33, 1)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRefs": ["full-object"], "componentId": "roof"}};
  node_roof_4.userData.actionProfile = {"animationRole": "rigid", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "roof-mount", "position": [0, 0, 0], "axis": [0, 1, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "roof", "seamRefs": [], "detachableFragments": ["roof"], "breakImpulse": 12, "debrisMaterial": "hidden"}};
  (nodes["root"] ?? root).add(node_roof_4);
  nodes["roof"] = node_roof_4;
  const mesh_roof_4Geometry = endpoint_roof_4
    ? new THREE.CylinderGeometry(endpoint_roof_4.endRadius, endpoint_roof_4.baseRadius, endpoint_roof_4.length, 16, 6)
    : new THREE.PlaneGeometry(1, 1, 12, 12);
  if (!endpoint_roof_4) {
    mesh_roof_4Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_roof_4 = new THREE.Mesh(
    mesh_roof_4Geometry,
    materialMap["paint"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_roof_4.name = "roof";
  if (endpoint_roof_4) {
    mesh_roof_4.position.copy(endpoint_roof_4.midpoint);
    mesh_roof_4.quaternion.copy(endpoint_roof_4.quaternion);
  }
  mesh_roof_4.castShadow = options.castShadow ?? true;
  mesh_roof_4.receiveShadow = options.receiveShadow ?? true;
  mesh_roof_4.userData.sculptComponent = {"id": "roof", "name": "roof", "level": "macro", "role": "rigid mechanical part", "importance": 1, "confidence": 0.86, "primitive": "plane-card", "topologyClass": "conforming-shell", "topologyRationale": "Conforming analytic automotive skin follows continuous section profile.", "geometryDescriptor": {"normalStrategy": "smooth indexed normals", "uvStrategy": "procedural solid color", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.012, "segments": 2}, "deformationStack": [], "roadSurface": {"kind": "roof"}}, "parent": "root", "attachment": {"parentSocket": "root-to-roof", "localStart": [0, 1.1160868108272552, 0.3100000023841858], "localEnd": [0, 1.1160868108272552, 0.3100000023841858], "contactType": "overlap", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.012, "parentId": "root"}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.85}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "rigid", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "roof-mount", "position": [0, 0, 0], "axis": [0, 1, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "roof", "seamRefs": [], "detachableFragments": ["roof"], "breakImpulse": 12, "debrisMaterial": "hidden"}}, "material": "paint", "materialLayers": ["paint"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "roof-camber", "kind": "contour", "description": "roof-camber", "evidenceRefs": ["canonical"]}], "surfaceDetail": {}, "evidenceRefs": ["canonical", "profile", "rear"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(199, 107, 33, 1)", "secondaryAlbedo": "rgba(199, 107, 33, 1)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRefs": ["full-object"], "componentId": "roof"}};
  node_roof_4.add(mesh_roof_4);
  meshes["roof"] = mesh_roof_4;
  colliders["roof"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["roof"] ??= [];
  destructionGroups["roof"].push(node_roof_4);
  const socket_roof_roof_mount_0 = new THREE.Object3D();
  socket_roof_roof_mount_0.name = "roof-mount";
  socket_roof_roof_mount_0.position.set(0.0, 0.0, 0.0);
  socket_roof_roof_mount_0.rotation.set(0, 0, 0);
  socket_roof_roof_mount_0.userData.socket = {"id": "roof-mount", "position": [0, 0, 0], "axis": [0, 1, 0]};
  node_roof_4.add(socket_roof_roof_mount_0);
  sockets["roof:roof-mount"] = socket_roof_roof_mount_0;

  const endpoint_front_fascia_5 = makeAttachmentEndpoint(null);
  const node_front_fascia_5 = new THREE.Group();
  node_front_fascia_5.name = "front-fascia__pivot";
  node_front_fascia_5.scale.set(1, 1, 1);
  if (endpoint_front_fascia_5) {
    node_front_fascia_5.position.copy(endpoint_front_fascia_5.start);
    node_front_fascia_5.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_front_fascia_5.position.set(0.0, 0.0, 0.0);
    node_front_fascia_5.rotation.set(0.0, 0.0, 0.0);
  }
  node_front_fascia_5.userData.sculptComponent = {"id": "front-fascia", "name": "front-fascia", "level": "meso", "role": "rigid mechanical part", "importance": 1, "confidence": 0.86, "primitive": "plane-card", "topologyClass": "assembled-solid", "topologyRationale": "Separate rigid hardware has its own mechanical boundary.", "geometryDescriptor": {"normalStrategy": "smooth indexed normals", "uvStrategy": "procedural solid color", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.012, "segments": 2}, "deformationStack": [], "roadSurface": {"kind": "end", "z": -2.2}}, "parent": "root", "attachment": {"parentSocket": "root-to-front-fascia", "localStart": [0, 0.5299240946769714, -2.184859275817871], "localEnd": [0, 0.5299240946769714, -2.184859275817871], "contactType": "overlap", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.012, "parentId": "root"}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.85}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "rigid", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "front-fascia-mount", "position": [0, 0, 0], "axis": [0, 1, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "front-fascia", "seamRefs": [], "detachableFragments": ["front-fascia"], "breakImpulse": 12, "debrisMaterial": "hidden"}}, "material": "paint", "materialLayers": ["paint"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {}, "evidenceRefs": ["canonical", "profile", "rear"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(199, 107, 33, 1)", "secondaryAlbedo": "rgba(199, 107, 33, 1)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRefs": ["full-object"], "componentId": "front-fascia"}};
  node_front_fascia_5.userData.actionProfile = {"animationRole": "rigid", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "front-fascia-mount", "position": [0, 0, 0], "axis": [0, 1, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "front-fascia", "seamRefs": [], "detachableFragments": ["front-fascia"], "breakImpulse": 12, "debrisMaterial": "hidden"}};
  (nodes["root"] ?? root).add(node_front_fascia_5);
  nodes["front-fascia"] = node_front_fascia_5;
  const mesh_front_fascia_5Geometry = endpoint_front_fascia_5
    ? new THREE.CylinderGeometry(endpoint_front_fascia_5.endRadius, endpoint_front_fascia_5.baseRadius, endpoint_front_fascia_5.length, 16, 6)
    : new THREE.PlaneGeometry(1, 1, 12, 12);
  if (!endpoint_front_fascia_5) {
    mesh_front_fascia_5Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_front_fascia_5 = new THREE.Mesh(
    mesh_front_fascia_5Geometry,
    materialMap["paint"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_front_fascia_5.name = "front-fascia";
  if (endpoint_front_fascia_5) {
    mesh_front_fascia_5.position.copy(endpoint_front_fascia_5.midpoint);
    mesh_front_fascia_5.quaternion.copy(endpoint_front_fascia_5.quaternion);
  }
  mesh_front_fascia_5.castShadow = options.castShadow ?? true;
  mesh_front_fascia_5.receiveShadow = options.receiveShadow ?? true;
  mesh_front_fascia_5.userData.sculptComponent = {"id": "front-fascia", "name": "front-fascia", "level": "meso", "role": "rigid mechanical part", "importance": 1, "confidence": 0.86, "primitive": "plane-card", "topologyClass": "assembled-solid", "topologyRationale": "Separate rigid hardware has its own mechanical boundary.", "geometryDescriptor": {"normalStrategy": "smooth indexed normals", "uvStrategy": "procedural solid color", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.012, "segments": 2}, "deformationStack": [], "roadSurface": {"kind": "end", "z": -2.2}}, "parent": "root", "attachment": {"parentSocket": "root-to-front-fascia", "localStart": [0, 0.5299240946769714, -2.184859275817871], "localEnd": [0, 0.5299240946769714, -2.184859275817871], "contactType": "overlap", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.012, "parentId": "root"}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.85}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "rigid", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "front-fascia-mount", "position": [0, 0, 0], "axis": [0, 1, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "front-fascia", "seamRefs": [], "detachableFragments": ["front-fascia"], "breakImpulse": 12, "debrisMaterial": "hidden"}}, "material": "paint", "materialLayers": ["paint"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {}, "evidenceRefs": ["canonical", "profile", "rear"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(199, 107, 33, 1)", "secondaryAlbedo": "rgba(199, 107, 33, 1)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRefs": ["full-object"], "componentId": "front-fascia"}};
  node_front_fascia_5.add(mesh_front_fascia_5);
  meshes["front-fascia"] = mesh_front_fascia_5;
  colliders["front-fascia"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["front-fascia"] ??= [];
  destructionGroups["front-fascia"].push(node_front_fascia_5);
  const socket_front_fascia_front_fascia_mount_0 = new THREE.Object3D();
  socket_front_fascia_front_fascia_mount_0.name = "front-fascia-mount";
  socket_front_fascia_front_fascia_mount_0.position.set(0.0, 0.0, 0.0);
  socket_front_fascia_front_fascia_mount_0.rotation.set(0, 0, 0);
  socket_front_fascia_front_fascia_mount_0.userData.socket = {"id": "front-fascia-mount", "position": [0, 0, 0], "axis": [0, 1, 0]};
  node_front_fascia_5.add(socket_front_fascia_front_fascia_mount_0);
  sockets["front-fascia:front-fascia-mount"] = socket_front_fascia_front_fascia_mount_0;

  const endpoint_rear_fascia_6 = makeAttachmentEndpoint(null);
  const node_rear_fascia_6 = new THREE.Group();
  node_rear_fascia_6.name = "rear-fascia__pivot";
  node_rear_fascia_6.scale.set(1, 1, 1);
  if (endpoint_rear_fascia_6) {
    node_rear_fascia_6.position.copy(endpoint_rear_fascia_6.start);
    node_rear_fascia_6.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_rear_fascia_6.position.set(0.0, 0.0, 0.0);
    node_rear_fascia_6.rotation.set(0.0, 0.0, 0.0);
  }
  node_rear_fascia_6.userData.sculptComponent = {"id": "rear-fascia", "name": "rear-fascia", "level": "meso", "role": "rigid mechanical part", "importance": 1, "confidence": 0.86, "primitive": "plane-card", "topologyClass": "assembled-solid", "topologyRationale": "Separate rigid hardware has its own mechanical boundary.", "geometryDescriptor": {"normalStrategy": "smooth indexed normals", "uvStrategy": "procedural solid color", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.012, "segments": 2}, "deformationStack": [], "roadSurface": {"kind": "end", "z": 2.2}}, "parent": "root", "attachment": {"parentSocket": "root-to-rear-fascia", "localStart": [0, 0.5299240946769714, 2.184859275817871], "localEnd": [0, 0.5299240946769714, 2.184859275817871], "contactType": "overlap", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.012, "parentId": "root"}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.85}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "rigid", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "rear-fascia-mount", "position": [0, 0, 0], "axis": [0, 1, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "rear-fascia", "seamRefs": [], "detachableFragments": ["rear-fascia"], "breakImpulse": 12, "debrisMaterial": "hidden"}}, "material": "paint", "materialLayers": ["paint"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {}, "evidenceRefs": ["canonical", "profile", "rear"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(199, 107, 33, 1)", "secondaryAlbedo": "rgba(199, 107, 33, 1)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRefs": ["full-object"], "componentId": "rear-fascia"}};
  node_rear_fascia_6.userData.actionProfile = {"animationRole": "rigid", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "rear-fascia-mount", "position": [0, 0, 0], "axis": [0, 1, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "rear-fascia", "seamRefs": [], "detachableFragments": ["rear-fascia"], "breakImpulse": 12, "debrisMaterial": "hidden"}};
  (nodes["root"] ?? root).add(node_rear_fascia_6);
  nodes["rear-fascia"] = node_rear_fascia_6;
  const mesh_rear_fascia_6Geometry = endpoint_rear_fascia_6
    ? new THREE.CylinderGeometry(endpoint_rear_fascia_6.endRadius, endpoint_rear_fascia_6.baseRadius, endpoint_rear_fascia_6.length, 16, 6)
    : new THREE.PlaneGeometry(1, 1, 12, 12);
  if (!endpoint_rear_fascia_6) {
    mesh_rear_fascia_6Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_rear_fascia_6 = new THREE.Mesh(
    mesh_rear_fascia_6Geometry,
    materialMap["paint"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_rear_fascia_6.name = "rear-fascia";
  if (endpoint_rear_fascia_6) {
    mesh_rear_fascia_6.position.copy(endpoint_rear_fascia_6.midpoint);
    mesh_rear_fascia_6.quaternion.copy(endpoint_rear_fascia_6.quaternion);
  }
  mesh_rear_fascia_6.castShadow = options.castShadow ?? true;
  mesh_rear_fascia_6.receiveShadow = options.receiveShadow ?? true;
  mesh_rear_fascia_6.userData.sculptComponent = {"id": "rear-fascia", "name": "rear-fascia", "level": "meso", "role": "rigid mechanical part", "importance": 1, "confidence": 0.86, "primitive": "plane-card", "topologyClass": "assembled-solid", "topologyRationale": "Separate rigid hardware has its own mechanical boundary.", "geometryDescriptor": {"normalStrategy": "smooth indexed normals", "uvStrategy": "procedural solid color", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.012, "segments": 2}, "deformationStack": [], "roadSurface": {"kind": "end", "z": 2.2}}, "parent": "root", "attachment": {"parentSocket": "root-to-rear-fascia", "localStart": [0, 0.5299240946769714, 2.184859275817871], "localEnd": [0, 0.5299240946769714, 2.184859275817871], "contactType": "overlap", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.012, "parentId": "root"}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.85}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "rigid", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "rear-fascia-mount", "position": [0, 0, 0], "axis": [0, 1, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "rear-fascia", "seamRefs": [], "detachableFragments": ["rear-fascia"], "breakImpulse": 12, "debrisMaterial": "hidden"}}, "material": "paint", "materialLayers": ["paint"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {}, "evidenceRefs": ["canonical", "profile", "rear"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(199, 107, 33, 1)", "secondaryAlbedo": "rgba(199, 107, 33, 1)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRefs": ["full-object"], "componentId": "rear-fascia"}};
  node_rear_fascia_6.add(mesh_rear_fascia_6);
  meshes["rear-fascia"] = mesh_rear_fascia_6;
  colliders["rear-fascia"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["rear-fascia"] ??= [];
  destructionGroups["rear-fascia"].push(node_rear_fascia_6);
  const socket_rear_fascia_rear_fascia_mount_0 = new THREE.Object3D();
  socket_rear_fascia_rear_fascia_mount_0.name = "rear-fascia-mount";
  socket_rear_fascia_rear_fascia_mount_0.position.set(0.0, 0.0, 0.0);
  socket_rear_fascia_rear_fascia_mount_0.rotation.set(0, 0, 0);
  socket_rear_fascia_rear_fascia_mount_0.userData.socket = {"id": "rear-fascia-mount", "position": [0, 0, 0], "axis": [0, 1, 0]};
  node_rear_fascia_6.add(socket_rear_fascia_rear_fascia_mount_0);
  sockets["rear-fascia:rear-fascia-mount"] = socket_rear_fascia_rear_fascia_mount_0;

  const endpoint_fender_left_7 = makeAttachmentEndpoint(null);
  const node_fender_left_7 = new THREE.Group();
  node_fender_left_7.name = "fender-left__pivot";
  node_fender_left_7.scale.set(1, 1, 1);
  if (endpoint_fender_left_7) {
    node_fender_left_7.position.copy(endpoint_fender_left_7.start);
    node_fender_left_7.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_fender_left_7.position.set(0.0, 0.0, 0.0);
    node_fender_left_7.rotation.set(0.0, 0.0, 0.0);
  }
  node_fender_left_7.userData.sculptComponent = {"id": "fender-left", "name": "fender-left", "level": "macro", "role": "rigid mechanical part", "importance": 1, "confidence": 0.86, "primitive": "plane-card", "topologyClass": "conforming-shell", "topologyRationale": "Conforming analytic automotive skin follows continuous section profile.", "geometryDescriptor": {"normalStrategy": "smooth indexed normals", "uvStrategy": "procedural solid color", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.012, "segments": 2}, "deformationStack": [], "roadSurface": {"kind": "side", "side": -1}}, "parent": "root", "attachment": {"parentSocket": "root-to-fender-left", "localStart": [-0.7948340773582458, 0.5138981938362122, 0], "localEnd": [-0.7948340773582458, 0.5138981938362122, 0], "contactType": "overlap", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.012, "parentId": "root"}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.85}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "rigid", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "fender-left-mount", "position": [0, 0, 0], "axis": [0, 1, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "fender-left", "seamRefs": [], "detachableFragments": ["fender-left"], "breakImpulse": 12, "debrisMaterial": "hidden"}}, "material": "paint", "materialLayers": ["paint"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "continuous-arches", "kind": "cutout", "description": "continuous-arches", "evidenceRefs": ["canonical"]}], "surfaceDetail": {}, "evidenceRefs": ["canonical", "profile", "rear"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(199, 107, 33, 1)", "secondaryAlbedo": "rgba(199, 107, 33, 1)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRefs": ["full-object"], "componentId": "fender-left"}};
  node_fender_left_7.userData.actionProfile = {"animationRole": "rigid", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "fender-left-mount", "position": [0, 0, 0], "axis": [0, 1, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "fender-left", "seamRefs": [], "detachableFragments": ["fender-left"], "breakImpulse": 12, "debrisMaterial": "hidden"}};
  (nodes["root"] ?? root).add(node_fender_left_7);
  nodes["fender-left"] = node_fender_left_7;
  const mesh_fender_left_7Geometry = endpoint_fender_left_7
    ? new THREE.CylinderGeometry(endpoint_fender_left_7.endRadius, endpoint_fender_left_7.baseRadius, endpoint_fender_left_7.length, 16, 6)
    : new THREE.PlaneGeometry(1, 1, 12, 12);
  if (!endpoint_fender_left_7) {
    mesh_fender_left_7Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_fender_left_7 = new THREE.Mesh(
    mesh_fender_left_7Geometry,
    materialMap["paint"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_fender_left_7.name = "fender-left";
  if (endpoint_fender_left_7) {
    mesh_fender_left_7.position.copy(endpoint_fender_left_7.midpoint);
    mesh_fender_left_7.quaternion.copy(endpoint_fender_left_7.quaternion);
  }
  mesh_fender_left_7.castShadow = options.castShadow ?? true;
  mesh_fender_left_7.receiveShadow = options.receiveShadow ?? true;
  mesh_fender_left_7.userData.sculptComponent = {"id": "fender-left", "name": "fender-left", "level": "macro", "role": "rigid mechanical part", "importance": 1, "confidence": 0.86, "primitive": "plane-card", "topologyClass": "conforming-shell", "topologyRationale": "Conforming analytic automotive skin follows continuous section profile.", "geometryDescriptor": {"normalStrategy": "smooth indexed normals", "uvStrategy": "procedural solid color", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.012, "segments": 2}, "deformationStack": [], "roadSurface": {"kind": "side", "side": -1}}, "parent": "root", "attachment": {"parentSocket": "root-to-fender-left", "localStart": [-0.7948340773582458, 0.5138981938362122, 0], "localEnd": [-0.7948340773582458, 0.5138981938362122, 0], "contactType": "overlap", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.012, "parentId": "root"}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.85}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "rigid", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "fender-left-mount", "position": [0, 0, 0], "axis": [0, 1, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "fender-left", "seamRefs": [], "detachableFragments": ["fender-left"], "breakImpulse": 12, "debrisMaterial": "hidden"}}, "material": "paint", "materialLayers": ["paint"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "continuous-arches", "kind": "cutout", "description": "continuous-arches", "evidenceRefs": ["canonical"]}], "surfaceDetail": {}, "evidenceRefs": ["canonical", "profile", "rear"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(199, 107, 33, 1)", "secondaryAlbedo": "rgba(199, 107, 33, 1)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRefs": ["full-object"], "componentId": "fender-left"}};
  node_fender_left_7.add(mesh_fender_left_7);
  meshes["fender-left"] = mesh_fender_left_7;
  colliders["fender-left"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["fender-left"] ??= [];
  destructionGroups["fender-left"].push(node_fender_left_7);
  const socket_fender_left_fender_left_mount_0 = new THREE.Object3D();
  socket_fender_left_fender_left_mount_0.name = "fender-left-mount";
  socket_fender_left_fender_left_mount_0.position.set(0.0, 0.0, 0.0);
  socket_fender_left_fender_left_mount_0.rotation.set(0, 0, 0);
  socket_fender_left_fender_left_mount_0.userData.socket = {"id": "fender-left-mount", "position": [0, 0, 0], "axis": [0, 1, 0]};
  node_fender_left_7.add(socket_fender_left_fender_left_mount_0);
  sockets["fender-left:fender-left-mount"] = socket_fender_left_fender_left_mount_0;

  const endpoint_wheel_well_left_8 = makeAttachmentEndpoint(null);
  const node_wheel_well_left_8 = new THREE.Group();
  node_wheel_well_left_8.name = "wheel-well-left__pivot";
  node_wheel_well_left_8.scale.set(1, 1, 1);
  if (endpoint_wheel_well_left_8) {
    node_wheel_well_left_8.position.copy(endpoint_wheel_well_left_8.start);
    node_wheel_well_left_8.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_wheel_well_left_8.position.set(0.0, 0.0, 0.0);
    node_wheel_well_left_8.rotation.set(0.0, 0.0, 0.0);
  }
  node_wheel_well_left_8.userData.sculptComponent = {"id": "wheel-well-left", "name": "wheel-well-left", "level": "meso", "role": "rigid mechanical part", "importance": 1, "confidence": 0.86, "primitive": "plane-card", "topologyClass": "conforming-shell", "topologyRationale": "Conforming analytic automotive skin follows continuous section profile.", "geometryDescriptor": {"normalStrategy": "smooth indexed normals", "uvStrategy": "procedural solid color", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.012, "segments": 2}, "deformationStack": [], "roadSurface": {"kind": "well", "side": -1}}, "parent": "root", "attachment": {"parentSocket": "root-to-wheel-well-left", "localStart": [-0.754749983549118, 0.5610000193119049, -0.004999995231628418], "localEnd": [-0.754749983549118, 0.5610000193119049, -0.004999995231628418], "contactType": "overlap", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.012, "parentId": "root"}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.85}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "rigid", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "wheel-well-left-mount", "position": [0, 0, 0], "axis": [0, 1, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "wheel-well-left", "seamRefs": [], "detachableFragments": ["wheel-well-left"], "breakImpulse": 12, "debrisMaterial": "hidden"}}, "material": "dark", "materialLayers": ["dark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {}, "evidenceRefs": ["canonical", "profile", "rear"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(41, 52, 59, 1)", "secondaryAlbedo": "rgba(41, 52, 59, 1)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRefs": ["full-object"], "componentId": "wheel-well-left"}};
  node_wheel_well_left_8.userData.actionProfile = {"animationRole": "rigid", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "wheel-well-left-mount", "position": [0, 0, 0], "axis": [0, 1, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "wheel-well-left", "seamRefs": [], "detachableFragments": ["wheel-well-left"], "breakImpulse": 12, "debrisMaterial": "hidden"}};
  (nodes["root"] ?? root).add(node_wheel_well_left_8);
  nodes["wheel-well-left"] = node_wheel_well_left_8;
  const mesh_wheel_well_left_8Geometry = endpoint_wheel_well_left_8
    ? new THREE.CylinderGeometry(endpoint_wheel_well_left_8.endRadius, endpoint_wheel_well_left_8.baseRadius, endpoint_wheel_well_left_8.length, 16, 6)
    : new THREE.PlaneGeometry(1, 1, 12, 12);
  if (!endpoint_wheel_well_left_8) {
    mesh_wheel_well_left_8Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_wheel_well_left_8 = new THREE.Mesh(
    mesh_wheel_well_left_8Geometry,
    materialMap["dark"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_wheel_well_left_8.name = "wheel-well-left";
  if (endpoint_wheel_well_left_8) {
    mesh_wheel_well_left_8.position.copy(endpoint_wheel_well_left_8.midpoint);
    mesh_wheel_well_left_8.quaternion.copy(endpoint_wheel_well_left_8.quaternion);
  }
  mesh_wheel_well_left_8.castShadow = options.castShadow ?? true;
  mesh_wheel_well_left_8.receiveShadow = options.receiveShadow ?? true;
  mesh_wheel_well_left_8.userData.sculptComponent = {"id": "wheel-well-left", "name": "wheel-well-left", "level": "meso", "role": "rigid mechanical part", "importance": 1, "confidence": 0.86, "primitive": "plane-card", "topologyClass": "conforming-shell", "topologyRationale": "Conforming analytic automotive skin follows continuous section profile.", "geometryDescriptor": {"normalStrategy": "smooth indexed normals", "uvStrategy": "procedural solid color", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.012, "segments": 2}, "deformationStack": [], "roadSurface": {"kind": "well", "side": -1}}, "parent": "root", "attachment": {"parentSocket": "root-to-wheel-well-left", "localStart": [-0.754749983549118, 0.5610000193119049, -0.004999995231628418], "localEnd": [-0.754749983549118, 0.5610000193119049, -0.004999995231628418], "contactType": "overlap", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.012, "parentId": "root"}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.85}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "rigid", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "wheel-well-left-mount", "position": [0, 0, 0], "axis": [0, 1, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "wheel-well-left", "seamRefs": [], "detachableFragments": ["wheel-well-left"], "breakImpulse": 12, "debrisMaterial": "hidden"}}, "material": "dark", "materialLayers": ["dark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {}, "evidenceRefs": ["canonical", "profile", "rear"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(41, 52, 59, 1)", "secondaryAlbedo": "rgba(41, 52, 59, 1)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRefs": ["full-object"], "componentId": "wheel-well-left"}};
  node_wheel_well_left_8.add(mesh_wheel_well_left_8);
  meshes["wheel-well-left"] = mesh_wheel_well_left_8;
  colliders["wheel-well-left"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["wheel-well-left"] ??= [];
  destructionGroups["wheel-well-left"].push(node_wheel_well_left_8);
  const socket_wheel_well_left_wheel_well_left_mount_0 = new THREE.Object3D();
  socket_wheel_well_left_wheel_well_left_mount_0.name = "wheel-well-left-mount";
  socket_wheel_well_left_wheel_well_left_mount_0.position.set(0.0, 0.0, 0.0);
  socket_wheel_well_left_wheel_well_left_mount_0.rotation.set(0, 0, 0);
  socket_wheel_well_left_wheel_well_left_mount_0.userData.socket = {"id": "wheel-well-left-mount", "position": [0, 0, 0], "axis": [0, 1, 0]};
  node_wheel_well_left_8.add(socket_wheel_well_left_wheel_well_left_mount_0);
  sockets["wheel-well-left:wheel-well-left-mount"] = socket_wheel_well_left_wheel_well_left_mount_0;

  const endpoint_door_left_0_9 = makeAttachmentEndpoint(null);
  const node_door_left_0_9 = new THREE.Group();
  node_door_left_0_9.name = "door-left-0__pivot";
  node_door_left_0_9.scale.set(1, 1, 1);
  if (endpoint_door_left_0_9) {
    node_door_left_0_9.position.copy(endpoint_door_left_0_9.start);
    node_door_left_0_9.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_door_left_0_9.position.set(0.0, 0.0, 0.0);
    node_door_left_0_9.rotation.set(0.0, 0.0, 0.0);
  }
  node_door_left_0_9.userData.sculptComponent = {"id": "door-left-0", "name": "door-left-0", "level": "macro", "role": "rigid mechanical part", "importance": 1, "confidence": 0.86, "primitive": "plane-card", "topologyClass": "conforming-shell", "topologyRationale": "Conforming analytic automotive skin follows continuous section profile.", "geometryDescriptor": {"normalStrategy": "smooth indexed normals", "uvStrategy": "procedural solid color", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.012, "segments": 2}, "deformationStack": [], "roadSurface": {"kind": "door", "side": -1, "door": 0}}, "parent": "root", "attachment": {"parentSocket": "root-to-door-left-0", "localStart": [-0.9099866265694496, 0.6478230080260059, -0.73], "localEnd": [-0.8244000060747263, 0.78693166586292, -0.26000001072883583], "contactType": "hinge", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.012, "parentId": "root"}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.85}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "rigid", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "door-left-0-mount", "position": [0, 0, 0], "axis": [0, 1, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "door-left-0", "seamRefs": [], "detachableFragments": ["door-left-0"], "breakImpulse": 12, "debrisMaterial": "hidden"}}, "material": "paint", "materialLayers": ["paint"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "four-door-proportion", "kind": "contour", "description": "four-door-proportion", "evidenceRefs": ["canonical"]}], "surfaceDetail": {}, "evidenceRefs": ["canonical", "profile", "rear"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(199, 107, 33, 1)", "secondaryAlbedo": "rgba(199, 107, 33, 1)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRefs": ["full-object"], "componentId": "door-left-0"}};
  node_door_left_0_9.userData.actionProfile = {"animationRole": "rigid", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "door-left-0-mount", "position": [0, 0, 0], "axis": [0, 1, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "door-left-0", "seamRefs": [], "detachableFragments": ["door-left-0"], "breakImpulse": 12, "debrisMaterial": "hidden"}};
  (nodes["root"] ?? root).add(node_door_left_0_9);
  nodes["door-left-0"] = node_door_left_0_9;
  const mesh_door_left_0_9Geometry = endpoint_door_left_0_9
    ? new THREE.CylinderGeometry(endpoint_door_left_0_9.endRadius, endpoint_door_left_0_9.baseRadius, endpoint_door_left_0_9.length, 16, 6)
    : new THREE.PlaneGeometry(1, 1, 12, 12);
  if (!endpoint_door_left_0_9) {
    mesh_door_left_0_9Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_door_left_0_9 = new THREE.Mesh(
    mesh_door_left_0_9Geometry,
    materialMap["paint"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_door_left_0_9.name = "door-left-0";
  if (endpoint_door_left_0_9) {
    mesh_door_left_0_9.position.copy(endpoint_door_left_0_9.midpoint);
    mesh_door_left_0_9.quaternion.copy(endpoint_door_left_0_9.quaternion);
  }
  mesh_door_left_0_9.castShadow = options.castShadow ?? true;
  mesh_door_left_0_9.receiveShadow = options.receiveShadow ?? true;
  mesh_door_left_0_9.userData.sculptComponent = {"id": "door-left-0", "name": "door-left-0", "level": "macro", "role": "rigid mechanical part", "importance": 1, "confidence": 0.86, "primitive": "plane-card", "topologyClass": "conforming-shell", "topologyRationale": "Conforming analytic automotive skin follows continuous section profile.", "geometryDescriptor": {"normalStrategy": "smooth indexed normals", "uvStrategy": "procedural solid color", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.012, "segments": 2}, "deformationStack": [], "roadSurface": {"kind": "door", "side": -1, "door": 0}}, "parent": "root", "attachment": {"parentSocket": "root-to-door-left-0", "localStart": [-0.9099866265694496, 0.6478230080260059, -0.73], "localEnd": [-0.8244000060747263, 0.78693166586292, -0.26000001072883583], "contactType": "hinge", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.012, "parentId": "root"}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.85}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "rigid", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "door-left-0-mount", "position": [0, 0, 0], "axis": [0, 1, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "door-left-0", "seamRefs": [], "detachableFragments": ["door-left-0"], "breakImpulse": 12, "debrisMaterial": "hidden"}}, "material": "paint", "materialLayers": ["paint"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "four-door-proportion", "kind": "contour", "description": "four-door-proportion", "evidenceRefs": ["canonical"]}], "surfaceDetail": {}, "evidenceRefs": ["canonical", "profile", "rear"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(199, 107, 33, 1)", "secondaryAlbedo": "rgba(199, 107, 33, 1)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRefs": ["full-object"], "componentId": "door-left-0"}};
  node_door_left_0_9.add(mesh_door_left_0_9);
  meshes["door-left-0"] = mesh_door_left_0_9;
  colliders["door-left-0"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["door-left-0"] ??= [];
  destructionGroups["door-left-0"].push(node_door_left_0_9);
  const socket_door_left_0_door_left_0_mount_0 = new THREE.Object3D();
  socket_door_left_0_door_left_0_mount_0.name = "door-left-0-mount";
  socket_door_left_0_door_left_0_mount_0.position.set(0.0, 0.0, 0.0);
  socket_door_left_0_door_left_0_mount_0.rotation.set(0, 0, 0);
  socket_door_left_0_door_left_0_mount_0.userData.socket = {"id": "door-left-0-mount", "position": [0, 0, 0], "axis": [0, 1, 0]};
  node_door_left_0_9.add(socket_door_left_0_door_left_0_mount_0);
  sockets["door-left-0:door-left-0-mount"] = socket_door_left_0_door_left_0_mount_0;

  const endpoint_glass_left_0_10 = makeAttachmentEndpoint(null);
  const node_glass_left_0_10 = new THREE.Group();
  node_glass_left_0_10.name = "glass-left-0__pivot";
  node_glass_left_0_10.scale.set(1, 1, 1);
  if (endpoint_glass_left_0_10) {
    node_glass_left_0_10.position.copy(endpoint_glass_left_0_10.start);
    node_glass_left_0_10.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_glass_left_0_10.position.set(0.0, 0.0, 0.0);
    node_glass_left_0_10.rotation.set(0.0, 0.0, 0.0);
  }
  node_glass_left_0_10.userData.sculptComponent = {"id": "glass-left-0", "name": "glass-left-0", "level": "meso", "role": "rigid mechanical part", "importance": 1, "confidence": 0.86, "primitive": "plane-card", "topologyClass": "conforming-shell", "topologyRationale": "Conforming analytic automotive skin follows continuous section profile.", "geometryDescriptor": {"normalStrategy": "smooth indexed normals", "uvStrategy": "procedural solid color", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.012, "segments": 2}, "deformationStack": [], "roadSurface": {"kind": "glass", "side": -1, "door": 0}}, "parent": "door-left-0", "attachment": {"parentSocket": "door-left-0-to-glass-left-0", "localStart": [0.09865443222224712, 0.44001828134059906, 0.471780052408576], "localEnd": [0.09865443222224712, 0.44001828134059906, 0.471780052408576], "contactType": "overlap", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.012, "parentId": "door-left-0"}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.85}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "rigid", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "glass-left-0-mount", "position": [0, 0, 0], "axis": [0, 1, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "door-left-0", "seamRefs": [], "detachableFragments": ["glass-left-0"], "breakImpulse": 12, "debrisMaterial": "hidden"}}, "material": "glass", "materialLayers": ["glass"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {}, "evidenceRefs": ["canonical", "profile", "rear"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(172, 203, 212, 1)", "secondaryAlbedo": "rgba(172, 203, 212, 1)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRefs": ["full-object"], "componentId": "glass-left-0"}};
  node_glass_left_0_10.userData.actionProfile = {"animationRole": "rigid", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "glass-left-0-mount", "position": [0, 0, 0], "axis": [0, 1, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "door-left-0", "seamRefs": [], "detachableFragments": ["glass-left-0"], "breakImpulse": 12, "debrisMaterial": "hidden"}};
  (nodes["door-left-0"] ?? root).add(node_glass_left_0_10);
  nodes["glass-left-0"] = node_glass_left_0_10;
  const mesh_glass_left_0_10Geometry = endpoint_glass_left_0_10
    ? new THREE.CylinderGeometry(endpoint_glass_left_0_10.endRadius, endpoint_glass_left_0_10.baseRadius, endpoint_glass_left_0_10.length, 16, 6)
    : new THREE.PlaneGeometry(1, 1, 12, 12);
  if (!endpoint_glass_left_0_10) {
    mesh_glass_left_0_10Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_glass_left_0_10 = new THREE.Mesh(
    mesh_glass_left_0_10Geometry,
    materialMap["glass"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_glass_left_0_10.name = "glass-left-0";
  if (endpoint_glass_left_0_10) {
    mesh_glass_left_0_10.position.copy(endpoint_glass_left_0_10.midpoint);
    mesh_glass_left_0_10.quaternion.copy(endpoint_glass_left_0_10.quaternion);
  }
  mesh_glass_left_0_10.castShadow = options.castShadow ?? true;
  mesh_glass_left_0_10.receiveShadow = options.receiveShadow ?? true;
  mesh_glass_left_0_10.userData.sculptComponent = {"id": "glass-left-0", "name": "glass-left-0", "level": "meso", "role": "rigid mechanical part", "importance": 1, "confidence": 0.86, "primitive": "plane-card", "topologyClass": "conforming-shell", "topologyRationale": "Conforming analytic automotive skin follows continuous section profile.", "geometryDescriptor": {"normalStrategy": "smooth indexed normals", "uvStrategy": "procedural solid color", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.012, "segments": 2}, "deformationStack": [], "roadSurface": {"kind": "glass", "side": -1, "door": 0}}, "parent": "door-left-0", "attachment": {"parentSocket": "door-left-0-to-glass-left-0", "localStart": [0.09865443222224712, 0.44001828134059906, 0.471780052408576], "localEnd": [0.09865443222224712, 0.44001828134059906, 0.471780052408576], "contactType": "overlap", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.012, "parentId": "door-left-0"}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.85}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "rigid", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "glass-left-0-mount", "position": [0, 0, 0], "axis": [0, 1, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "door-left-0", "seamRefs": [], "detachableFragments": ["glass-left-0"], "breakImpulse": 12, "debrisMaterial": "hidden"}}, "material": "glass", "materialLayers": ["glass"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {}, "evidenceRefs": ["canonical", "profile", "rear"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(172, 203, 212, 1)", "secondaryAlbedo": "rgba(172, 203, 212, 1)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRefs": ["full-object"], "componentId": "glass-left-0"}};
  node_glass_left_0_10.add(mesh_glass_left_0_10);
  meshes["glass-left-0"] = mesh_glass_left_0_10;
  colliders["glass-left-0"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["door-left-0"] ??= [];
  destructionGroups["door-left-0"].push(node_glass_left_0_10);
  const socket_glass_left_0_glass_left_0_mount_0 = new THREE.Object3D();
  socket_glass_left_0_glass_left_0_mount_0.name = "glass-left-0-mount";
  socket_glass_left_0_glass_left_0_mount_0.position.set(0.0, 0.0, 0.0);
  socket_glass_left_0_glass_left_0_mount_0.rotation.set(0, 0, 0);
  socket_glass_left_0_glass_left_0_mount_0.userData.socket = {"id": "glass-left-0-mount", "position": [0, 0, 0], "axis": [0, 1, 0]};
  node_glass_left_0_10.add(socket_glass_left_0_glass_left_0_mount_0);
  sockets["glass-left-0:glass-left-0-mount"] = socket_glass_left_0_glass_left_0_mount_0;

  const endpoint_frame_left_0_11 = makeAttachmentEndpoint(null);
  const node_frame_left_0_11 = new THREE.Group();
  node_frame_left_0_11.name = "frame-left-0__pivot";
  node_frame_left_0_11.scale.set(1, 1, 1);
  if (endpoint_frame_left_0_11) {
    node_frame_left_0_11.position.copy(endpoint_frame_left_0_11.start);
    node_frame_left_0_11.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_frame_left_0_11.position.set(0.0, 0.0, 0.0);
    node_frame_left_0_11.rotation.set(0.0, 0.0, 0.0);
  }
  node_frame_left_0_11.userData.sculptComponent = {"id": "frame-left-0", "name": "frame-left-0", "level": "meso", "role": "rigid mechanical part", "importance": 1, "confidence": 0.86, "primitive": "plane-card", "topologyClass": "assembled-solid", "topologyRationale": "Separate rigid hardware has its own mechanical boundary.", "geometryDescriptor": {"normalStrategy": "smooth indexed normals", "uvStrategy": "procedural solid color", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.012, "segments": 2}, "deformationStack": [], "roadSurface": {"kind": "frame", "side": -1, "door": 0}}, "parent": "door-left-0", "attachment": {"parentSocket": "door-left-0-to-frame-left-0", "localStart": [0.09808663837611675, 0.4429980367422104, 0.46999998927116415], "localEnd": [0.09808663837611675, 0.4429980367422104, 0.46999998927116415], "contactType": "overlap", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.012, "parentId": "door-left-0"}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.85}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "rigid", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "frame-left-0-mount", "position": [0, 0, 0], "axis": [0, 1, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "door-left-0", "seamRefs": [], "detachableFragments": ["frame-left-0"], "breakImpulse": 12, "debrisMaterial": "hidden"}}, "material": "paint", "materialLayers": ["paint"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {}, "evidenceRefs": ["canonical", "profile", "rear"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(199, 107, 33, 1)", "secondaryAlbedo": "rgba(199, 107, 33, 1)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRefs": ["full-object"], "componentId": "frame-left-0"}};
  node_frame_left_0_11.userData.actionProfile = {"animationRole": "rigid", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "frame-left-0-mount", "position": [0, 0, 0], "axis": [0, 1, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "door-left-0", "seamRefs": [], "detachableFragments": ["frame-left-0"], "breakImpulse": 12, "debrisMaterial": "hidden"}};
  (nodes["door-left-0"] ?? root).add(node_frame_left_0_11);
  nodes["frame-left-0"] = node_frame_left_0_11;
  const mesh_frame_left_0_11Geometry = endpoint_frame_left_0_11
    ? new THREE.CylinderGeometry(endpoint_frame_left_0_11.endRadius, endpoint_frame_left_0_11.baseRadius, endpoint_frame_left_0_11.length, 16, 6)
    : new THREE.PlaneGeometry(1, 1, 12, 12);
  if (!endpoint_frame_left_0_11) {
    mesh_frame_left_0_11Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_frame_left_0_11 = new THREE.Mesh(
    mesh_frame_left_0_11Geometry,
    materialMap["paint"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_frame_left_0_11.name = "frame-left-0";
  if (endpoint_frame_left_0_11) {
    mesh_frame_left_0_11.position.copy(endpoint_frame_left_0_11.midpoint);
    mesh_frame_left_0_11.quaternion.copy(endpoint_frame_left_0_11.quaternion);
  }
  mesh_frame_left_0_11.castShadow = options.castShadow ?? true;
  mesh_frame_left_0_11.receiveShadow = options.receiveShadow ?? true;
  mesh_frame_left_0_11.userData.sculptComponent = {"id": "frame-left-0", "name": "frame-left-0", "level": "meso", "role": "rigid mechanical part", "importance": 1, "confidence": 0.86, "primitive": "plane-card", "topologyClass": "assembled-solid", "topologyRationale": "Separate rigid hardware has its own mechanical boundary.", "geometryDescriptor": {"normalStrategy": "smooth indexed normals", "uvStrategy": "procedural solid color", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.012, "segments": 2}, "deformationStack": [], "roadSurface": {"kind": "frame", "side": -1, "door": 0}}, "parent": "door-left-0", "attachment": {"parentSocket": "door-left-0-to-frame-left-0", "localStart": [0.09808663837611675, 0.4429980367422104, 0.46999998927116415], "localEnd": [0.09808663837611675, 0.4429980367422104, 0.46999998927116415], "contactType": "overlap", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.012, "parentId": "door-left-0"}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.85}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "rigid", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "frame-left-0-mount", "position": [0, 0, 0], "axis": [0, 1, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "door-left-0", "seamRefs": [], "detachableFragments": ["frame-left-0"], "breakImpulse": 12, "debrisMaterial": "hidden"}}, "material": "paint", "materialLayers": ["paint"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {}, "evidenceRefs": ["canonical", "profile", "rear"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(199, 107, 33, 1)", "secondaryAlbedo": "rgba(199, 107, 33, 1)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRefs": ["full-object"], "componentId": "frame-left-0"}};
  node_frame_left_0_11.add(mesh_frame_left_0_11);
  meshes["frame-left-0"] = mesh_frame_left_0_11;
  colliders["frame-left-0"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["door-left-0"] ??= [];
  destructionGroups["door-left-0"].push(node_frame_left_0_11);
  const socket_frame_left_0_frame_left_0_mount_0 = new THREE.Object3D();
  socket_frame_left_0_frame_left_0_mount_0.name = "frame-left-0-mount";
  socket_frame_left_0_frame_left_0_mount_0.position.set(0.0, 0.0, 0.0);
  socket_frame_left_0_frame_left_0_mount_0.rotation.set(0, 0, 0);
  socket_frame_left_0_frame_left_0_mount_0.userData.socket = {"id": "frame-left-0-mount", "position": [0, 0, 0], "axis": [0, 1, 0]};
  node_frame_left_0_11.add(socket_frame_left_0_frame_left_0_mount_0);
  sockets["frame-left-0:frame-left-0-mount"] = socket_frame_left_0_frame_left_0_mount_0;

  const endpoint_handle_left_0_12 = makeAttachmentEndpoint(null);
  const node_handle_left_0_12 = new THREE.Group();
  node_handle_left_0_12.name = "handle-left-0__pivot";
  node_handle_left_0_12.scale.set(1, 1, 1);
  if (endpoint_handle_left_0_12) {
    node_handle_left_0_12.position.copy(endpoint_handle_left_0_12.start);
    node_handle_left_0_12.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_handle_left_0_12.position.set(0.0, 0.0, 0.0);
    node_handle_left_0_12.rotation.set(0.0, 0.0, 0.0);
  }
  node_handle_left_0_12.userData.sculptComponent = {"id": "handle-left-0", "name": "handle-left-0", "level": "micro", "role": "rigid mechanical part", "importance": 1, "confidence": 0.86, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Separate rigid hardware has its own mechanical boundary.", "geometryDescriptor": {"normalStrategy": "smooth indexed normals", "uvStrategy": "procedural solid color", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.012, "segments": 2}, "deformationStack": [], "roadSurface": {"kind": "handle", "side": -1, "door": 0}}, "parent": "door-left-0", "attachment": {"parentSocket": "door-left-0-to-handle-left-0", "localStart": [-0.018013376742601395, 0.042176988907158375, 0.7799999713897705], "localEnd": [-0.018013376742601395, 0.042176988907158375, 0.7799999713897705], "contactType": "overlap", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.012, "parentId": "door-left-0"}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.85}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "rigid", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "handle-left-0-mount", "position": [0, 0, 0], "axis": [0, 1, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "door-left-0", "seamRefs": [], "detachableFragments": ["handle-left-0"], "breakImpulse": 12, "debrisMaterial": "hidden"}}, "material": "metal", "materialLayers": ["metal"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {}, "evidenceRefs": ["canonical", "profile", "rear"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(179, 191, 197, 1)", "secondaryAlbedo": "rgba(179, 191, 197, 1)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRefs": ["full-object"], "componentId": "handle-left-0"}};
  node_handle_left_0_12.userData.actionProfile = {"animationRole": "rigid", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "handle-left-0-mount", "position": [0, 0, 0], "axis": [0, 1, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "door-left-0", "seamRefs": [], "detachableFragments": ["handle-left-0"], "breakImpulse": 12, "debrisMaterial": "hidden"}};
  (nodes["door-left-0"] ?? root).add(node_handle_left_0_12);
  nodes["handle-left-0"] = node_handle_left_0_12;
  const mesh_handle_left_0_12Geometry = endpoint_handle_left_0_12
    ? new THREE.CylinderGeometry(endpoint_handle_left_0_12.endRadius, endpoint_handle_left_0_12.baseRadius, endpoint_handle_left_0_12.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_handle_left_0_12) {
    mesh_handle_left_0_12Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_handle_left_0_12 = new THREE.Mesh(
    mesh_handle_left_0_12Geometry,
    materialMap["metal"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_handle_left_0_12.name = "handle-left-0";
  if (endpoint_handle_left_0_12) {
    mesh_handle_left_0_12.position.copy(endpoint_handle_left_0_12.midpoint);
    mesh_handle_left_0_12.quaternion.copy(endpoint_handle_left_0_12.quaternion);
  }
  mesh_handle_left_0_12.castShadow = options.castShadow ?? true;
  mesh_handle_left_0_12.receiveShadow = options.receiveShadow ?? true;
  mesh_handle_left_0_12.userData.sculptComponent = {"id": "handle-left-0", "name": "handle-left-0", "level": "micro", "role": "rigid mechanical part", "importance": 1, "confidence": 0.86, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Separate rigid hardware has its own mechanical boundary.", "geometryDescriptor": {"normalStrategy": "smooth indexed normals", "uvStrategy": "procedural solid color", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.012, "segments": 2}, "deformationStack": [], "roadSurface": {"kind": "handle", "side": -1, "door": 0}}, "parent": "door-left-0", "attachment": {"parentSocket": "door-left-0-to-handle-left-0", "localStart": [-0.018013376742601395, 0.042176988907158375, 0.7799999713897705], "localEnd": [-0.018013376742601395, 0.042176988907158375, 0.7799999713897705], "contactType": "overlap", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.012, "parentId": "door-left-0"}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.85}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "rigid", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "handle-left-0-mount", "position": [0, 0, 0], "axis": [0, 1, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "door-left-0", "seamRefs": [], "detachableFragments": ["handle-left-0"], "breakImpulse": 12, "debrisMaterial": "hidden"}}, "material": "metal", "materialLayers": ["metal"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {}, "evidenceRefs": ["canonical", "profile", "rear"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(179, 191, 197, 1)", "secondaryAlbedo": "rgba(179, 191, 197, 1)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRefs": ["full-object"], "componentId": "handle-left-0"}};
  node_handle_left_0_12.add(mesh_handle_left_0_12);
  meshes["handle-left-0"] = mesh_handle_left_0_12;
  colliders["handle-left-0"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["door-left-0"] ??= [];
  destructionGroups["door-left-0"].push(node_handle_left_0_12);
  const socket_handle_left_0_handle_left_0_mount_0 = new THREE.Object3D();
  socket_handle_left_0_handle_left_0_mount_0.name = "handle-left-0-mount";
  socket_handle_left_0_handle_left_0_mount_0.position.set(0.0, 0.0, 0.0);
  socket_handle_left_0_handle_left_0_mount_0.rotation.set(0, 0, 0);
  socket_handle_left_0_handle_left_0_mount_0.userData.socket = {"id": "handle-left-0-mount", "position": [0, 0, 0], "axis": [0, 1, 0]};
  node_handle_left_0_12.add(socket_handle_left_0_handle_left_0_mount_0);
  sockets["handle-left-0:handle-left-0-mount"] = socket_handle_left_0_handle_left_0_mount_0;

  const endpoint_door_left_1_13 = makeAttachmentEndpoint(null);
  const node_door_left_1_13 = new THREE.Group();
  node_door_left_1_13.name = "door-left-1__pivot";
  node_door_left_1_13.scale.set(1, 1, 1);
  if (endpoint_door_left_1_13) {
    node_door_left_1_13.position.copy(endpoint_door_left_1_13.start);
    node_door_left_1_13.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_door_left_1_13.position.set(0.0, 0.0, 0.0);
    node_door_left_1_13.rotation.set(0.0, 0.0, 0.0);
  }
  node_door_left_1_13.userData.sculptComponent = {"id": "door-left-1", "name": "door-left-1", "level": "macro", "role": "rigid mechanical part", "importance": 1, "confidence": 0.86, "primitive": "plane-card", "topologyClass": "conforming-shell", "topologyRationale": "Conforming analytic automotive skin follows continuous section profile.", "geometryDescriptor": {"normalStrategy": "smooth indexed normals", "uvStrategy": "procedural solid color", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.012, "segments": 2}, "deformationStack": [], "roadSurface": {"kind": "door", "side": -1, "door": 1}}, "parent": "root", "attachment": {"parentSocket": "root-to-door-left-1", "localStart": [-0.9099999993727881, 0.6479996513130081, 0.21000000000000008], "localEnd": [-0.8259478818313557, 0.7869960587026488, 0.6512019215524196], "contactType": "hinge", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.012, "parentId": "root"}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.85}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "rigid", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "door-left-1-mount", "position": [0, 0, 0], "axis": [0, 1, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "door-left-1", "seamRefs": [], "detachableFragments": ["door-left-1"], "breakImpulse": 12, "debrisMaterial": "hidden"}}, "material": "paint", "materialLayers": ["paint"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {}, "evidenceRefs": ["canonical", "profile", "rear"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(199, 107, 33, 1)", "secondaryAlbedo": "rgba(199, 107, 33, 1)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRefs": ["full-object"], "componentId": "door-left-1"}};
  node_door_left_1_13.userData.actionProfile = {"animationRole": "rigid", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "door-left-1-mount", "position": [0, 0, 0], "axis": [0, 1, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "door-left-1", "seamRefs": [], "detachableFragments": ["door-left-1"], "breakImpulse": 12, "debrisMaterial": "hidden"}};
  (nodes["root"] ?? root).add(node_door_left_1_13);
  nodes["door-left-1"] = node_door_left_1_13;
  const mesh_door_left_1_13Geometry = endpoint_door_left_1_13
    ? new THREE.CylinderGeometry(endpoint_door_left_1_13.endRadius, endpoint_door_left_1_13.baseRadius, endpoint_door_left_1_13.length, 16, 6)
    : new THREE.PlaneGeometry(1, 1, 12, 12);
  if (!endpoint_door_left_1_13) {
    mesh_door_left_1_13Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_door_left_1_13 = new THREE.Mesh(
    mesh_door_left_1_13Geometry,
    materialMap["paint"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_door_left_1_13.name = "door-left-1";
  if (endpoint_door_left_1_13) {
    mesh_door_left_1_13.position.copy(endpoint_door_left_1_13.midpoint);
    mesh_door_left_1_13.quaternion.copy(endpoint_door_left_1_13.quaternion);
  }
  mesh_door_left_1_13.castShadow = options.castShadow ?? true;
  mesh_door_left_1_13.receiveShadow = options.receiveShadow ?? true;
  mesh_door_left_1_13.userData.sculptComponent = {"id": "door-left-1", "name": "door-left-1", "level": "macro", "role": "rigid mechanical part", "importance": 1, "confidence": 0.86, "primitive": "plane-card", "topologyClass": "conforming-shell", "topologyRationale": "Conforming analytic automotive skin follows continuous section profile.", "geometryDescriptor": {"normalStrategy": "smooth indexed normals", "uvStrategy": "procedural solid color", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.012, "segments": 2}, "deformationStack": [], "roadSurface": {"kind": "door", "side": -1, "door": 1}}, "parent": "root", "attachment": {"parentSocket": "root-to-door-left-1", "localStart": [-0.9099999993727881, 0.6479996513130081, 0.21000000000000008], "localEnd": [-0.8259478818313557, 0.7869960587026488, 0.6512019215524196], "contactType": "hinge", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.012, "parentId": "root"}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.85}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "rigid", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "door-left-1-mount", "position": [0, 0, 0], "axis": [0, 1, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "door-left-1", "seamRefs": [], "detachableFragments": ["door-left-1"], "breakImpulse": 12, "debrisMaterial": "hidden"}}, "material": "paint", "materialLayers": ["paint"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {}, "evidenceRefs": ["canonical", "profile", "rear"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(199, 107, 33, 1)", "secondaryAlbedo": "rgba(199, 107, 33, 1)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRefs": ["full-object"], "componentId": "door-left-1"}};
  node_door_left_1_13.add(mesh_door_left_1_13);
  meshes["door-left-1"] = mesh_door_left_1_13;
  colliders["door-left-1"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["door-left-1"] ??= [];
  destructionGroups["door-left-1"].push(node_door_left_1_13);
  const socket_door_left_1_door_left_1_mount_0 = new THREE.Object3D();
  socket_door_left_1_door_left_1_mount_0.name = "door-left-1-mount";
  socket_door_left_1_door_left_1_mount_0.position.set(0.0, 0.0, 0.0);
  socket_door_left_1_door_left_1_mount_0.rotation.set(0, 0, 0);
  socket_door_left_1_door_left_1_mount_0.userData.socket = {"id": "door-left-1-mount", "position": [0, 0, 0], "axis": [0, 1, 0]};
  node_door_left_1_13.add(socket_door_left_1_door_left_1_mount_0);
  sockets["door-left-1:door-left-1-mount"] = socket_door_left_1_door_left_1_mount_0;

  const endpoint_glass_left_1_14 = makeAttachmentEndpoint(null);
  const node_glass_left_1_14 = new THREE.Group();
  node_glass_left_1_14.name = "glass-left-1__pivot";
  node_glass_left_1_14.scale.set(1, 1, 1);
  if (endpoint_glass_left_1_14) {
    node_glass_left_1_14.position.copy(endpoint_glass_left_1_14.start);
    node_glass_left_1_14.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_glass_left_1_14.position.set(0.0, 0.0, 0.0);
    node_glass_left_1_14.rotation.set(0.0, 0.0, 0.0);
  }
  node_glass_left_1_14.userData.sculptComponent = {"id": "glass-left-1", "name": "glass-left-1", "level": "meso", "role": "rigid mechanical part", "importance": 1, "confidence": 0.86, "primitive": "plane-card", "topologyClass": "conforming-shell", "topologyRationale": "Conforming analytic automotive skin follows continuous section profile.", "geometryDescriptor": {"normalStrategy": "smooth indexed normals", "uvStrategy": "procedural solid color", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.012, "segments": 2}, "deformationStack": [], "roadSurface": {"kind": "glass", "side": -1, "door": 1}}, "parent": "door-left-1", "attachment": {"parentSocket": "door-left-1-to-glass-left-1", "localStart": [0.09712010761722922, 0.43920227885246266, 0.43344777449965466], "localEnd": [0.09712010761722922, 0.43920227885246266, 0.43344777449965466], "contactType": "overlap", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.012, "parentId": "door-left-1"}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.85}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "rigid", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "glass-left-1-mount", "position": [0, 0, 0], "axis": [0, 1, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "door-left-1", "seamRefs": [], "detachableFragments": ["glass-left-1"], "breakImpulse": 12, "debrisMaterial": "hidden"}}, "material": "glass", "materialLayers": ["glass"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {}, "evidenceRefs": ["canonical", "profile", "rear"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(172, 203, 212, 1)", "secondaryAlbedo": "rgba(172, 203, 212, 1)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRefs": ["full-object"], "componentId": "glass-left-1"}};
  node_glass_left_1_14.userData.actionProfile = {"animationRole": "rigid", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "glass-left-1-mount", "position": [0, 0, 0], "axis": [0, 1, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "door-left-1", "seamRefs": [], "detachableFragments": ["glass-left-1"], "breakImpulse": 12, "debrisMaterial": "hidden"}};
  (nodes["door-left-1"] ?? root).add(node_glass_left_1_14);
  nodes["glass-left-1"] = node_glass_left_1_14;
  const mesh_glass_left_1_14Geometry = endpoint_glass_left_1_14
    ? new THREE.CylinderGeometry(endpoint_glass_left_1_14.endRadius, endpoint_glass_left_1_14.baseRadius, endpoint_glass_left_1_14.length, 16, 6)
    : new THREE.PlaneGeometry(1, 1, 12, 12);
  if (!endpoint_glass_left_1_14) {
    mesh_glass_left_1_14Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_glass_left_1_14 = new THREE.Mesh(
    mesh_glass_left_1_14Geometry,
    materialMap["glass"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_glass_left_1_14.name = "glass-left-1";
  if (endpoint_glass_left_1_14) {
    mesh_glass_left_1_14.position.copy(endpoint_glass_left_1_14.midpoint);
    mesh_glass_left_1_14.quaternion.copy(endpoint_glass_left_1_14.quaternion);
  }
  mesh_glass_left_1_14.castShadow = options.castShadow ?? true;
  mesh_glass_left_1_14.receiveShadow = options.receiveShadow ?? true;
  mesh_glass_left_1_14.userData.sculptComponent = {"id": "glass-left-1", "name": "glass-left-1", "level": "meso", "role": "rigid mechanical part", "importance": 1, "confidence": 0.86, "primitive": "plane-card", "topologyClass": "conforming-shell", "topologyRationale": "Conforming analytic automotive skin follows continuous section profile.", "geometryDescriptor": {"normalStrategy": "smooth indexed normals", "uvStrategy": "procedural solid color", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.012, "segments": 2}, "deformationStack": [], "roadSurface": {"kind": "glass", "side": -1, "door": 1}}, "parent": "door-left-1", "attachment": {"parentSocket": "door-left-1-to-glass-left-1", "localStart": [0.09712010761722922, 0.43920227885246266, 0.43344777449965466], "localEnd": [0.09712010761722922, 0.43920227885246266, 0.43344777449965466], "contactType": "overlap", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.012, "parentId": "door-left-1"}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.85}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "rigid", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "glass-left-1-mount", "position": [0, 0, 0], "axis": [0, 1, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "door-left-1", "seamRefs": [], "detachableFragments": ["glass-left-1"], "breakImpulse": 12, "debrisMaterial": "hidden"}}, "material": "glass", "materialLayers": ["glass"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {}, "evidenceRefs": ["canonical", "profile", "rear"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(172, 203, 212, 1)", "secondaryAlbedo": "rgba(172, 203, 212, 1)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRefs": ["full-object"], "componentId": "glass-left-1"}};
  node_glass_left_1_14.add(mesh_glass_left_1_14);
  meshes["glass-left-1"] = mesh_glass_left_1_14;
  colliders["glass-left-1"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["door-left-1"] ??= [];
  destructionGroups["door-left-1"].push(node_glass_left_1_14);
  const socket_glass_left_1_glass_left_1_mount_0 = new THREE.Object3D();
  socket_glass_left_1_glass_left_1_mount_0.name = "glass-left-1-mount";
  socket_glass_left_1_glass_left_1_mount_0.position.set(0.0, 0.0, 0.0);
  socket_glass_left_1_glass_left_1_mount_0.rotation.set(0, 0, 0);
  socket_glass_left_1_glass_left_1_mount_0.userData.socket = {"id": "glass-left-1-mount", "position": [0, 0, 0], "axis": [0, 1, 0]};
  node_glass_left_1_14.add(socket_glass_left_1_glass_left_1_mount_0);
  sockets["glass-left-1:glass-left-1-mount"] = socket_glass_left_1_glass_left_1_mount_0;

  const endpoint_frame_left_1_15 = makeAttachmentEndpoint(null);
  const node_frame_left_1_15 = new THREE.Group();
  node_frame_left_1_15.name = "frame-left-1__pivot";
  node_frame_left_1_15.scale.set(1, 1, 1);
  if (endpoint_frame_left_1_15) {
    node_frame_left_1_15.position.copy(endpoint_frame_left_1_15.start);
    node_frame_left_1_15.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_frame_left_1_15.position.set(0.0, 0.0, 0.0);
    node_frame_left_1_15.rotation.set(0.0, 0.0, 0.0);
  }
  node_frame_left_1_15.userData.sculptComponent = {"id": "frame-left-1", "name": "frame-left-1", "level": "meso", "role": "rigid mechanical part", "importance": 1, "confidence": 0.86, "primitive": "plane-card", "topologyClass": "assembled-solid", "topologyRationale": "Separate rigid hardware has its own mechanical boundary.", "geometryDescriptor": {"normalStrategy": "smooth indexed normals", "uvStrategy": "procedural solid color", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.012, "segments": 2}, "deformationStack": [], "roadSurface": {"kind": "frame", "side": -1, "door": 1}}, "parent": "door-left-1", "attachment": {"parentSocket": "door-left-1-to-frame-left-1", "localStart": [0.09647563239559531, 0.4419231414794921, 0.44120192155241955], "localEnd": [0.09647563239559531, 0.4419231414794921, 0.44120192155241955], "contactType": "overlap", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.012, "parentId": "door-left-1"}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.85}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "rigid", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "frame-left-1-mount", "position": [0, 0, 0], "axis": [0, 1, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "door-left-1", "seamRefs": [], "detachableFragments": ["frame-left-1"], "breakImpulse": 12, "debrisMaterial": "hidden"}}, "material": "paint", "materialLayers": ["paint"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {}, "evidenceRefs": ["canonical", "profile", "rear"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(199, 107, 33, 1)", "secondaryAlbedo": "rgba(199, 107, 33, 1)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRefs": ["full-object"], "componentId": "frame-left-1"}};
  node_frame_left_1_15.userData.actionProfile = {"animationRole": "rigid", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "frame-left-1-mount", "position": [0, 0, 0], "axis": [0, 1, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "door-left-1", "seamRefs": [], "detachableFragments": ["frame-left-1"], "breakImpulse": 12, "debrisMaterial": "hidden"}};
  (nodes["door-left-1"] ?? root).add(node_frame_left_1_15);
  nodes["frame-left-1"] = node_frame_left_1_15;
  const mesh_frame_left_1_15Geometry = endpoint_frame_left_1_15
    ? new THREE.CylinderGeometry(endpoint_frame_left_1_15.endRadius, endpoint_frame_left_1_15.baseRadius, endpoint_frame_left_1_15.length, 16, 6)
    : new THREE.PlaneGeometry(1, 1, 12, 12);
  if (!endpoint_frame_left_1_15) {
    mesh_frame_left_1_15Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_frame_left_1_15 = new THREE.Mesh(
    mesh_frame_left_1_15Geometry,
    materialMap["paint"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_frame_left_1_15.name = "frame-left-1";
  if (endpoint_frame_left_1_15) {
    mesh_frame_left_1_15.position.copy(endpoint_frame_left_1_15.midpoint);
    mesh_frame_left_1_15.quaternion.copy(endpoint_frame_left_1_15.quaternion);
  }
  mesh_frame_left_1_15.castShadow = options.castShadow ?? true;
  mesh_frame_left_1_15.receiveShadow = options.receiveShadow ?? true;
  mesh_frame_left_1_15.userData.sculptComponent = {"id": "frame-left-1", "name": "frame-left-1", "level": "meso", "role": "rigid mechanical part", "importance": 1, "confidence": 0.86, "primitive": "plane-card", "topologyClass": "assembled-solid", "topologyRationale": "Separate rigid hardware has its own mechanical boundary.", "geometryDescriptor": {"normalStrategy": "smooth indexed normals", "uvStrategy": "procedural solid color", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.012, "segments": 2}, "deformationStack": [], "roadSurface": {"kind": "frame", "side": -1, "door": 1}}, "parent": "door-left-1", "attachment": {"parentSocket": "door-left-1-to-frame-left-1", "localStart": [0.09647563239559531, 0.4419231414794921, 0.44120192155241955], "localEnd": [0.09647563239559531, 0.4419231414794921, 0.44120192155241955], "contactType": "overlap", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.012, "parentId": "door-left-1"}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.85}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "rigid", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "frame-left-1-mount", "position": [0, 0, 0], "axis": [0, 1, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "door-left-1", "seamRefs": [], "detachableFragments": ["frame-left-1"], "breakImpulse": 12, "debrisMaterial": "hidden"}}, "material": "paint", "materialLayers": ["paint"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {}, "evidenceRefs": ["canonical", "profile", "rear"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(199, 107, 33, 1)", "secondaryAlbedo": "rgba(199, 107, 33, 1)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRefs": ["full-object"], "componentId": "frame-left-1"}};
  node_frame_left_1_15.add(mesh_frame_left_1_15);
  meshes["frame-left-1"] = mesh_frame_left_1_15;
  colliders["frame-left-1"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["door-left-1"] ??= [];
  destructionGroups["door-left-1"].push(node_frame_left_1_15);
  const socket_frame_left_1_frame_left_1_mount_0 = new THREE.Object3D();
  socket_frame_left_1_frame_left_1_mount_0.name = "frame-left-1-mount";
  socket_frame_left_1_frame_left_1_mount_0.position.set(0.0, 0.0, 0.0);
  socket_frame_left_1_frame_left_1_mount_0.rotation.set(0, 0, 0);
  socket_frame_left_1_frame_left_1_mount_0.userData.socket = {"id": "frame-left-1-mount", "position": [0, 0, 0], "axis": [0, 1, 0]};
  node_frame_left_1_15.add(socket_frame_left_1_frame_left_1_mount_0);
  sockets["frame-left-1:frame-left-1-mount"] = socket_frame_left_1_frame_left_1_mount_0;

  const endpoint_handle_left_1_16 = makeAttachmentEndpoint(null);
  const node_handle_left_1_16 = new THREE.Group();
  node_handle_left_1_16.name = "handle-left-1__pivot";
  node_handle_left_1_16.scale.set(1, 1, 1);
  if (endpoint_handle_left_1_16) {
    node_handle_left_1_16.position.copy(endpoint_handle_left_1_16.start);
    node_handle_left_1_16.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_handle_left_1_16.position.set(0.0, 0.0, 0.0);
    node_handle_left_1_16.rotation.set(0.0, 0.0, 0.0);
  }
  node_handle_left_1_16.userData.sculptComponent = {"id": "handle-left-1", "name": "handle-left-1", "level": "micro", "role": "rigid mechanical part", "importance": 1, "confidence": 0.86, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Separate rigid hardware has its own mechanical boundary.", "geometryDescriptor": {"normalStrategy": "smooth indexed normals", "uvStrategy": "procedural solid color", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.012, "segments": 2}, "deformationStack": [], "roadSurface": {"kind": "handle", "side": -1, "door": 1}}, "parent": "door-left-1", "attachment": {"parentSocket": "door-left-1-to-handle-left-1", "localStart": [-0.017846998292952776, 0.04098542779684067, 0.7800000011920928], "localEnd": [-0.017846998292952776, 0.04098542779684067, 0.7800000011920928], "contactType": "overlap", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.012, "parentId": "door-left-1"}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.85}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "rigid", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "handle-left-1-mount", "position": [0, 0, 0], "axis": [0, 1, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "door-left-1", "seamRefs": [], "detachableFragments": ["handle-left-1"], "breakImpulse": 12, "debrisMaterial": "hidden"}}, "material": "metal", "materialLayers": ["metal"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {}, "evidenceRefs": ["canonical", "profile", "rear"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(179, 191, 197, 1)", "secondaryAlbedo": "rgba(179, 191, 197, 1)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRefs": ["full-object"], "componentId": "handle-left-1"}};
  node_handle_left_1_16.userData.actionProfile = {"animationRole": "rigid", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "handle-left-1-mount", "position": [0, 0, 0], "axis": [0, 1, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "door-left-1", "seamRefs": [], "detachableFragments": ["handle-left-1"], "breakImpulse": 12, "debrisMaterial": "hidden"}};
  (nodes["door-left-1"] ?? root).add(node_handle_left_1_16);
  nodes["handle-left-1"] = node_handle_left_1_16;
  const mesh_handle_left_1_16Geometry = endpoint_handle_left_1_16
    ? new THREE.CylinderGeometry(endpoint_handle_left_1_16.endRadius, endpoint_handle_left_1_16.baseRadius, endpoint_handle_left_1_16.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_handle_left_1_16) {
    mesh_handle_left_1_16Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_handle_left_1_16 = new THREE.Mesh(
    mesh_handle_left_1_16Geometry,
    materialMap["metal"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_handle_left_1_16.name = "handle-left-1";
  if (endpoint_handle_left_1_16) {
    mesh_handle_left_1_16.position.copy(endpoint_handle_left_1_16.midpoint);
    mesh_handle_left_1_16.quaternion.copy(endpoint_handle_left_1_16.quaternion);
  }
  mesh_handle_left_1_16.castShadow = options.castShadow ?? true;
  mesh_handle_left_1_16.receiveShadow = options.receiveShadow ?? true;
  mesh_handle_left_1_16.userData.sculptComponent = {"id": "handle-left-1", "name": "handle-left-1", "level": "micro", "role": "rigid mechanical part", "importance": 1, "confidence": 0.86, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Separate rigid hardware has its own mechanical boundary.", "geometryDescriptor": {"normalStrategy": "smooth indexed normals", "uvStrategy": "procedural solid color", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.012, "segments": 2}, "deformationStack": [], "roadSurface": {"kind": "handle", "side": -1, "door": 1}}, "parent": "door-left-1", "attachment": {"parentSocket": "door-left-1-to-handle-left-1", "localStart": [-0.017846998292952776, 0.04098542779684067, 0.7800000011920928], "localEnd": [-0.017846998292952776, 0.04098542779684067, 0.7800000011920928], "contactType": "overlap", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.012, "parentId": "door-left-1"}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.85}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "rigid", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "handle-left-1-mount", "position": [0, 0, 0], "axis": [0, 1, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "door-left-1", "seamRefs": [], "detachableFragments": ["handle-left-1"], "breakImpulse": 12, "debrisMaterial": "hidden"}}, "material": "metal", "materialLayers": ["metal"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {}, "evidenceRefs": ["canonical", "profile", "rear"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(179, 191, 197, 1)", "secondaryAlbedo": "rgba(179, 191, 197, 1)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRefs": ["full-object"], "componentId": "handle-left-1"}};
  node_handle_left_1_16.add(mesh_handle_left_1_16);
  meshes["handle-left-1"] = mesh_handle_left_1_16;
  colliders["handle-left-1"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["door-left-1"] ??= [];
  destructionGroups["door-left-1"].push(node_handle_left_1_16);
  const socket_handle_left_1_handle_left_1_mount_0 = new THREE.Object3D();
  socket_handle_left_1_handle_left_1_mount_0.name = "handle-left-1-mount";
  socket_handle_left_1_handle_left_1_mount_0.position.set(0.0, 0.0, 0.0);
  socket_handle_left_1_handle_left_1_mount_0.rotation.set(0, 0, 0);
  socket_handle_left_1_handle_left_1_mount_0.userData.socket = {"id": "handle-left-1-mount", "position": [0, 0, 0], "axis": [0, 1, 0]};
  node_handle_left_1_16.add(socket_handle_left_1_handle_left_1_mount_0);
  sockets["handle-left-1:handle-left-1-mount"] = socket_handle_left_1_handle_left_1_mount_0;

  const endpoint_quarter_left_17 = makeAttachmentEndpoint(null);
  const node_quarter_left_17 = new THREE.Group();
  node_quarter_left_17.name = "quarter-left__pivot";
  node_quarter_left_17.scale.set(1, 1, 1);
  if (endpoint_quarter_left_17) {
    node_quarter_left_17.position.copy(endpoint_quarter_left_17.start);
    node_quarter_left_17.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_quarter_left_17.position.set(0.0, 0.0, 0.0);
    node_quarter_left_17.rotation.set(0.0, 0.0, 0.0);
  }
  node_quarter_left_17.userData.sculptComponent = {"id": "quarter-left", "name": "quarter-left", "level": "meso", "role": "rigid mechanical part", "importance": 1, "confidence": 0.86, "primitive": "plane-card", "topologyClass": "conforming-shell", "topologyRationale": "Conforming analytic automotive skin follows continuous section profile.", "geometryDescriptor": {"normalStrategy": "smooth indexed normals", "uvStrategy": "procedural solid color", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.012, "segments": 2}, "deformationStack": [], "roadSurface": {"kind": "glass", "side": -1, "quarter": true}}, "parent": "root", "attachment": {"parentSocket": "root-to-quarter-left", "localStart": [-0.8117795288562775, 1.0824353694915771, 1.030173122882843], "localEnd": [-0.8117795288562775, 1.0824353694915771, 1.030173122882843], "contactType": "overlap", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.012, "parentId": "root"}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.85}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "rigid", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "quarter-left-mount", "position": [0, 0, 0], "axis": [0, 1, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "quarter-left", "seamRefs": [], "detachableFragments": ["quarter-left"], "breakImpulse": 12, "debrisMaterial": "hidden"}}, "material": "glass", "materialLayers": ["glass"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {}, "evidenceRefs": ["canonical", "profile", "rear"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(172, 203, 212, 1)", "secondaryAlbedo": "rgba(172, 203, 212, 1)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRefs": ["full-object"], "componentId": "quarter-left"}};
  node_quarter_left_17.userData.actionProfile = {"animationRole": "rigid", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "quarter-left-mount", "position": [0, 0, 0], "axis": [0, 1, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "quarter-left", "seamRefs": [], "detachableFragments": ["quarter-left"], "breakImpulse": 12, "debrisMaterial": "hidden"}};
  (nodes["root"] ?? root).add(node_quarter_left_17);
  nodes["quarter-left"] = node_quarter_left_17;
  const mesh_quarter_left_17Geometry = endpoint_quarter_left_17
    ? new THREE.CylinderGeometry(endpoint_quarter_left_17.endRadius, endpoint_quarter_left_17.baseRadius, endpoint_quarter_left_17.length, 16, 6)
    : new THREE.PlaneGeometry(1, 1, 12, 12);
  if (!endpoint_quarter_left_17) {
    mesh_quarter_left_17Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_quarter_left_17 = new THREE.Mesh(
    mesh_quarter_left_17Geometry,
    materialMap["glass"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_quarter_left_17.name = "quarter-left";
  if (endpoint_quarter_left_17) {
    mesh_quarter_left_17.position.copy(endpoint_quarter_left_17.midpoint);
    mesh_quarter_left_17.quaternion.copy(endpoint_quarter_left_17.quaternion);
  }
  mesh_quarter_left_17.castShadow = options.castShadow ?? true;
  mesh_quarter_left_17.receiveShadow = options.receiveShadow ?? true;
  mesh_quarter_left_17.userData.sculptComponent = {"id": "quarter-left", "name": "quarter-left", "level": "meso", "role": "rigid mechanical part", "importance": 1, "confidence": 0.86, "primitive": "plane-card", "topologyClass": "conforming-shell", "topologyRationale": "Conforming analytic automotive skin follows continuous section profile.", "geometryDescriptor": {"normalStrategy": "smooth indexed normals", "uvStrategy": "procedural solid color", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.012, "segments": 2}, "deformationStack": [], "roadSurface": {"kind": "glass", "side": -1, "quarter": true}}, "parent": "root", "attachment": {"parentSocket": "root-to-quarter-left", "localStart": [-0.8117795288562775, 1.0824353694915771, 1.030173122882843], "localEnd": [-0.8117795288562775, 1.0824353694915771, 1.030173122882843], "contactType": "overlap", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.012, "parentId": "root"}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.85}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "rigid", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "quarter-left-mount", "position": [0, 0, 0], "axis": [0, 1, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "quarter-left", "seamRefs": [], "detachableFragments": ["quarter-left"], "breakImpulse": 12, "debrisMaterial": "hidden"}}, "material": "glass", "materialLayers": ["glass"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {}, "evidenceRefs": ["canonical", "profile", "rear"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(172, 203, 212, 1)", "secondaryAlbedo": "rgba(172, 203, 212, 1)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRefs": ["full-object"], "componentId": "quarter-left"}};
  node_quarter_left_17.add(mesh_quarter_left_17);
  meshes["quarter-left"] = mesh_quarter_left_17;
  colliders["quarter-left"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["quarter-left"] ??= [];
  destructionGroups["quarter-left"].push(node_quarter_left_17);
  const socket_quarter_left_quarter_left_mount_0 = new THREE.Object3D();
  socket_quarter_left_quarter_left_mount_0.name = "quarter-left-mount";
  socket_quarter_left_quarter_left_mount_0.position.set(0.0, 0.0, 0.0);
  socket_quarter_left_quarter_left_mount_0.rotation.set(0, 0, 0);
  socket_quarter_left_quarter_left_mount_0.userData.socket = {"id": "quarter-left-mount", "position": [0, 0, 0], "axis": [0, 1, 0]};
  node_quarter_left_17.add(socket_quarter_left_quarter_left_mount_0);
  sockets["quarter-left:quarter-left-mount"] = socket_quarter_left_quarter_left_mount_0;

  const endpoint_mirror_left_18 = makeAttachmentEndpoint(null);
  const node_mirror_left_18 = new THREE.Group();
  node_mirror_left_18.name = "mirror-left__pivot";
  node_mirror_left_18.scale.set(1, 1, 1);
  if (endpoint_mirror_left_18) {
    node_mirror_left_18.position.copy(endpoint_mirror_left_18.start);
    node_mirror_left_18.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_mirror_left_18.position.set(0.0, 0.0, 0.0);
    node_mirror_left_18.rotation.set(0.0, 0.0, 0.0);
  }
  node_mirror_left_18.userData.sculptComponent = {"id": "mirror-left", "name": "mirror-left", "level": "meso", "role": "rigid mechanical part", "importance": 1, "confidence": 0.86, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Separate rigid hardware has its own mechanical boundary.", "geometryDescriptor": {"normalStrategy": "smooth indexed normals", "uvStrategy": "procedural solid color", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.012, "segments": 2}, "deformationStack": [], "roadSurface": {"kind": "mirror", "side": -1}}, "parent": "root", "attachment": {"parentSocket": "root-to-mirror-left", "localStart": [-0.91, 0.93, -0.6], "localEnd": [-0.9850000011175872, 0.93, -0.5965000003576278], "contactType": "hinge", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.012, "parentId": "root"}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.85}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "rigid", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "mirror-left-mount", "position": [0, 0, 0], "axis": [0, 1, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "mirror-left", "seamRefs": [], "detachableFragments": ["mirror-left"], "breakImpulse": 12, "debrisMaterial": "hidden"}}, "material": "paint", "materialLayers": ["paint"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {}, "evidenceRefs": ["canonical", "profile", "rear"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(199, 107, 33, 1)", "secondaryAlbedo": "rgba(199, 107, 33, 1)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRefs": ["full-object"], "componentId": "mirror-left"}};
  node_mirror_left_18.userData.actionProfile = {"animationRole": "rigid", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "mirror-left-mount", "position": [0, 0, 0], "axis": [0, 1, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "mirror-left", "seamRefs": [], "detachableFragments": ["mirror-left"], "breakImpulse": 12, "debrisMaterial": "hidden"}};
  (nodes["root"] ?? root).add(node_mirror_left_18);
  nodes["mirror-left"] = node_mirror_left_18;
  const mesh_mirror_left_18Geometry = endpoint_mirror_left_18
    ? new THREE.CylinderGeometry(endpoint_mirror_left_18.endRadius, endpoint_mirror_left_18.baseRadius, endpoint_mirror_left_18.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_mirror_left_18) {
    mesh_mirror_left_18Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_mirror_left_18 = new THREE.Mesh(
    mesh_mirror_left_18Geometry,
    materialMap["paint"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_mirror_left_18.name = "mirror-left";
  if (endpoint_mirror_left_18) {
    mesh_mirror_left_18.position.copy(endpoint_mirror_left_18.midpoint);
    mesh_mirror_left_18.quaternion.copy(endpoint_mirror_left_18.quaternion);
  }
  mesh_mirror_left_18.castShadow = options.castShadow ?? true;
  mesh_mirror_left_18.receiveShadow = options.receiveShadow ?? true;
  mesh_mirror_left_18.userData.sculptComponent = {"id": "mirror-left", "name": "mirror-left", "level": "meso", "role": "rigid mechanical part", "importance": 1, "confidence": 0.86, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Separate rigid hardware has its own mechanical boundary.", "geometryDescriptor": {"normalStrategy": "smooth indexed normals", "uvStrategy": "procedural solid color", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.012, "segments": 2}, "deformationStack": [], "roadSurface": {"kind": "mirror", "side": -1}}, "parent": "root", "attachment": {"parentSocket": "root-to-mirror-left", "localStart": [-0.91, 0.93, -0.6], "localEnd": [-0.9850000011175872, 0.93, -0.5965000003576278], "contactType": "hinge", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.012, "parentId": "root"}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.85}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "rigid", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "mirror-left-mount", "position": [0, 0, 0], "axis": [0, 1, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "mirror-left", "seamRefs": [], "detachableFragments": ["mirror-left"], "breakImpulse": 12, "debrisMaterial": "hidden"}}, "material": "paint", "materialLayers": ["paint"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {}, "evidenceRefs": ["canonical", "profile", "rear"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(199, 107, 33, 1)", "secondaryAlbedo": "rgba(199, 107, 33, 1)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRefs": ["full-object"], "componentId": "mirror-left"}};
  node_mirror_left_18.add(mesh_mirror_left_18);
  meshes["mirror-left"] = mesh_mirror_left_18;
  colliders["mirror-left"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["mirror-left"] ??= [];
  destructionGroups["mirror-left"].push(node_mirror_left_18);
  const socket_mirror_left_mirror_left_mount_0 = new THREE.Object3D();
  socket_mirror_left_mirror_left_mount_0.name = "mirror-left-mount";
  socket_mirror_left_mirror_left_mount_0.position.set(0.0, 0.0, 0.0);
  socket_mirror_left_mirror_left_mount_0.rotation.set(0, 0, 0);
  socket_mirror_left_mirror_left_mount_0.userData.socket = {"id": "mirror-left-mount", "position": [0, 0, 0], "axis": [0, 1, 0]};
  node_mirror_left_18.add(socket_mirror_left_mirror_left_mount_0);
  sockets["mirror-left:mirror-left-mount"] = socket_mirror_left_mirror_left_mount_0;

  const endpoint_wheel_left_front_19 = makeAttachmentEndpoint(null);
  const node_wheel_left_front_19 = new THREE.Group();
  node_wheel_left_front_19.name = "wheel-left-front__pivot";
  node_wheel_left_front_19.scale.set(1, 1, 1);
  if (endpoint_wheel_left_front_19) {
    node_wheel_left_front_19.position.copy(endpoint_wheel_left_front_19.start);
    node_wheel_left_front_19.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_wheel_left_front_19.position.set(0.0, 0.0, 0.0);
    node_wheel_left_front_19.rotation.set(0.0, 0.0, 0.0);
  }
  node_wheel_left_front_19.userData.sculptComponent = {"id": "wheel-left-front", "name": "wheel-left-front", "level": "macro", "role": "rigid mechanical part", "importance": 1, "confidence": 0.86, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Separate rigid hardware has its own mechanical boundary.", "geometryDescriptor": {"normalStrategy": "smooth indexed normals", "uvStrategy": "procedural solid color", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.012, "segments": 2}, "deformationStack": [], "roadSurface": {"kind": "wheel", "side": -1, "axle": "front"}}, "parent": "root", "attachment": {"parentSocket": "root-to-wheel-left-front", "localStart": [-0.875, 0.365, -1.38], "localEnd": [-0.875, 0.365, -1.38], "contactType": "hinge", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.012, "parentId": "root"}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.85}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "rigid", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "wheel-left-front-mount", "position": [0, 0, 0], "axis": [0, 1, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "wheel-left-front", "seamRefs": [], "detachableFragments": ["wheel-left-front"], "breakImpulse": 12, "debrisMaterial": "hidden"}}, "material": "rubber", "materialLayers": ["rubber"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {}, "evidenceRefs": ["canonical", "profile", "rear"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(36, 41, 44, 1)", "secondaryAlbedo": "rgba(36, 41, 44, 1)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRefs": ["full-object"], "componentId": "wheel-left-front"}};
  node_wheel_left_front_19.userData.actionProfile = {"animationRole": "rigid", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "wheel-left-front-mount", "position": [0, 0, 0], "axis": [0, 1, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "wheel-left-front", "seamRefs": [], "detachableFragments": ["wheel-left-front"], "breakImpulse": 12, "debrisMaterial": "hidden"}};
  (nodes["root"] ?? root).add(node_wheel_left_front_19);
  nodes["wheel-left-front"] = node_wheel_left_front_19;
  const mesh_wheel_left_front_19Geometry = endpoint_wheel_left_front_19
    ? new THREE.CylinderGeometry(endpoint_wheel_left_front_19.endRadius, endpoint_wheel_left_front_19.baseRadius, endpoint_wheel_left_front_19.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_wheel_left_front_19) {
    mesh_wheel_left_front_19Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_wheel_left_front_19 = new THREE.Mesh(
    mesh_wheel_left_front_19Geometry,
    materialMap["rubber"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_wheel_left_front_19.name = "wheel-left-front";
  if (endpoint_wheel_left_front_19) {
    mesh_wheel_left_front_19.position.copy(endpoint_wheel_left_front_19.midpoint);
    mesh_wheel_left_front_19.quaternion.copy(endpoint_wheel_left_front_19.quaternion);
  }
  mesh_wheel_left_front_19.castShadow = options.castShadow ?? true;
  mesh_wheel_left_front_19.receiveShadow = options.receiveShadow ?? true;
  mesh_wheel_left_front_19.userData.sculptComponent = {"id": "wheel-left-front", "name": "wheel-left-front", "level": "macro", "role": "rigid mechanical part", "importance": 1, "confidence": 0.86, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Separate rigid hardware has its own mechanical boundary.", "geometryDescriptor": {"normalStrategy": "smooth indexed normals", "uvStrategy": "procedural solid color", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.012, "segments": 2}, "deformationStack": [], "roadSurface": {"kind": "wheel", "side": -1, "axle": "front"}}, "parent": "root", "attachment": {"parentSocket": "root-to-wheel-left-front", "localStart": [-0.875, 0.365, -1.38], "localEnd": [-0.875, 0.365, -1.38], "contactType": "hinge", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.012, "parentId": "root"}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.85}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "rigid", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "wheel-left-front-mount", "position": [0, 0, 0], "axis": [0, 1, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "wheel-left-front", "seamRefs": [], "detachableFragments": ["wheel-left-front"], "breakImpulse": 12, "debrisMaterial": "hidden"}}, "material": "rubber", "materialLayers": ["rubber"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {}, "evidenceRefs": ["canonical", "profile", "rear"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(36, 41, 44, 1)", "secondaryAlbedo": "rgba(36, 41, 44, 1)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRefs": ["full-object"], "componentId": "wheel-left-front"}};
  node_wheel_left_front_19.add(mesh_wheel_left_front_19);
  meshes["wheel-left-front"] = mesh_wheel_left_front_19;
  colliders["wheel-left-front"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["wheel-left-front"] ??= [];
  destructionGroups["wheel-left-front"].push(node_wheel_left_front_19);
  const socket_wheel_left_front_wheel_left_front_mount_0 = new THREE.Object3D();
  socket_wheel_left_front_wheel_left_front_mount_0.name = "wheel-left-front-mount";
  socket_wheel_left_front_wheel_left_front_mount_0.position.set(0.0, 0.0, 0.0);
  socket_wheel_left_front_wheel_left_front_mount_0.rotation.set(0, 0, 0);
  socket_wheel_left_front_wheel_left_front_mount_0.userData.socket = {"id": "wheel-left-front-mount", "position": [0, 0, 0], "axis": [0, 1, 0]};
  node_wheel_left_front_19.add(socket_wheel_left_front_wheel_left_front_mount_0);
  sockets["wheel-left-front:wheel-left-front-mount"] = socket_wheel_left_front_wheel_left_front_mount_0;

  const endpoint_rim_left_front_20 = makeAttachmentEndpoint(null);
  const node_rim_left_front_20 = new THREE.Group();
  node_rim_left_front_20.name = "rim-left-front__pivot";
  node_rim_left_front_20.scale.set(1, 1, 1);
  if (endpoint_rim_left_front_20) {
    node_rim_left_front_20.position.copy(endpoint_rim_left_front_20.start);
    node_rim_left_front_20.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_rim_left_front_20.position.set(0.0, 0.0, 0.0);
    node_rim_left_front_20.rotation.set(0.0, 0.0, 0.0);
  }
  node_rim_left_front_20.userData.sculptComponent = {"id": "rim-left-front", "name": "rim-left-front", "level": "meso", "role": "rigid mechanical part", "importance": 1, "confidence": 0.86, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Separate rigid hardware has its own mechanical boundary.", "geometryDescriptor": {"normalStrategy": "smooth indexed normals", "uvStrategy": "procedural solid color", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.012, "segments": 2}, "deformationStack": [], "roadSurface": {"kind": "rim", "side": -1, "axle": "front"}}, "parent": "wheel-left-front", "attachment": {"parentSocket": "wheel-left-front-to-rim-left-front", "localStart": [-0.003696151077747345, 0, 0], "localEnd": [-0.003696151077747345, 0, 0], "contactType": "overlap", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.012, "parentId": "wheel-left-front"}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.85}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "rigid", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "rim-left-front-mount", "position": [0, 0, 0], "axis": [0, 1, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "wheel-left-front", "seamRefs": [], "detachableFragments": ["rim-left-front"], "breakImpulse": 12, "debrisMaterial": "hidden"}}, "material": "metal", "materialLayers": ["metal"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "recessed-rims", "kind": "relief", "description": "recessed-rims", "evidenceRefs": ["canonical"]}], "surfaceDetail": {}, "evidenceRefs": ["canonical", "profile", "rear"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(179, 191, 197, 1)", "secondaryAlbedo": "rgba(179, 191, 197, 1)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRefs": ["full-object"], "componentId": "rim-left-front"}};
  node_rim_left_front_20.userData.actionProfile = {"animationRole": "rigid", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "rim-left-front-mount", "position": [0, 0, 0], "axis": [0, 1, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "wheel-left-front", "seamRefs": [], "detachableFragments": ["rim-left-front"], "breakImpulse": 12, "debrisMaterial": "hidden"}};
  (nodes["wheel-left-front"] ?? root).add(node_rim_left_front_20);
  nodes["rim-left-front"] = node_rim_left_front_20;
  const mesh_rim_left_front_20Geometry = endpoint_rim_left_front_20
    ? new THREE.CylinderGeometry(endpoint_rim_left_front_20.endRadius, endpoint_rim_left_front_20.baseRadius, endpoint_rim_left_front_20.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_rim_left_front_20) {
    mesh_rim_left_front_20Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_rim_left_front_20 = new THREE.Mesh(
    mesh_rim_left_front_20Geometry,
    materialMap["metal"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_rim_left_front_20.name = "rim-left-front";
  if (endpoint_rim_left_front_20) {
    mesh_rim_left_front_20.position.copy(endpoint_rim_left_front_20.midpoint);
    mesh_rim_left_front_20.quaternion.copy(endpoint_rim_left_front_20.quaternion);
  }
  mesh_rim_left_front_20.castShadow = options.castShadow ?? true;
  mesh_rim_left_front_20.receiveShadow = options.receiveShadow ?? true;
  mesh_rim_left_front_20.userData.sculptComponent = {"id": "rim-left-front", "name": "rim-left-front", "level": "meso", "role": "rigid mechanical part", "importance": 1, "confidence": 0.86, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Separate rigid hardware has its own mechanical boundary.", "geometryDescriptor": {"normalStrategy": "smooth indexed normals", "uvStrategy": "procedural solid color", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.012, "segments": 2}, "deformationStack": [], "roadSurface": {"kind": "rim", "side": -1, "axle": "front"}}, "parent": "wheel-left-front", "attachment": {"parentSocket": "wheel-left-front-to-rim-left-front", "localStart": [-0.003696151077747345, 0, 0], "localEnd": [-0.003696151077747345, 0, 0], "contactType": "overlap", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.012, "parentId": "wheel-left-front"}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.85}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "rigid", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "rim-left-front-mount", "position": [0, 0, 0], "axis": [0, 1, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "wheel-left-front", "seamRefs": [], "detachableFragments": ["rim-left-front"], "breakImpulse": 12, "debrisMaterial": "hidden"}}, "material": "metal", "materialLayers": ["metal"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "recessed-rims", "kind": "relief", "description": "recessed-rims", "evidenceRefs": ["canonical"]}], "surfaceDetail": {}, "evidenceRefs": ["canonical", "profile", "rear"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(179, 191, 197, 1)", "secondaryAlbedo": "rgba(179, 191, 197, 1)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRefs": ["full-object"], "componentId": "rim-left-front"}};
  node_rim_left_front_20.add(mesh_rim_left_front_20);
  meshes["rim-left-front"] = mesh_rim_left_front_20;
  colliders["rim-left-front"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["wheel-left-front"] ??= [];
  destructionGroups["wheel-left-front"].push(node_rim_left_front_20);
  const socket_rim_left_front_rim_left_front_mount_0 = new THREE.Object3D();
  socket_rim_left_front_rim_left_front_mount_0.name = "rim-left-front-mount";
  socket_rim_left_front_rim_left_front_mount_0.position.set(0.0, 0.0, 0.0);
  socket_rim_left_front_rim_left_front_mount_0.rotation.set(0, 0, 0);
  socket_rim_left_front_rim_left_front_mount_0.userData.socket = {"id": "rim-left-front-mount", "position": [0, 0, 0], "axis": [0, 1, 0]};
  node_rim_left_front_20.add(socket_rim_left_front_rim_left_front_mount_0);
  sockets["rim-left-front:rim-left-front-mount"] = socket_rim_left_front_rim_left_front_mount_0;

  const endpoint_wheel_left_rear_21 = makeAttachmentEndpoint(null);
  const node_wheel_left_rear_21 = new THREE.Group();
  node_wheel_left_rear_21.name = "wheel-left-rear__pivot";
  node_wheel_left_rear_21.scale.set(1, 1, 1);
  if (endpoint_wheel_left_rear_21) {
    node_wheel_left_rear_21.position.copy(endpoint_wheel_left_rear_21.start);
    node_wheel_left_rear_21.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_wheel_left_rear_21.position.set(0.0, 0.0, 0.0);
    node_wheel_left_rear_21.rotation.set(0.0, 0.0, 0.0);
  }
  node_wheel_left_rear_21.userData.sculptComponent = {"id": "wheel-left-rear", "name": "wheel-left-rear", "level": "macro", "role": "rigid mechanical part", "importance": 1, "confidence": 0.86, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Separate rigid hardware has its own mechanical boundary.", "geometryDescriptor": {"normalStrategy": "smooth indexed normals", "uvStrategy": "procedural solid color", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.012, "segments": 2}, "deformationStack": [], "roadSurface": {"kind": "wheel", "side": -1, "axle": "rear"}}, "parent": "root", "attachment": {"parentSocket": "root-to-wheel-left-rear", "localStart": [-0.875, 0.365, 1.37], "localEnd": [-0.875, 0.365, 1.37], "contactType": "hinge", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.012, "parentId": "root"}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.85}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "rigid", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "wheel-left-rear-mount", "position": [0, 0, 0], "axis": [0, 1, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "wheel-left-rear", "seamRefs": [], "detachableFragments": ["wheel-left-rear"], "breakImpulse": 12, "debrisMaterial": "hidden"}}, "material": "rubber", "materialLayers": ["rubber"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {}, "evidenceRefs": ["canonical", "profile", "rear"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(36, 41, 44, 1)", "secondaryAlbedo": "rgba(36, 41, 44, 1)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRefs": ["full-object"], "componentId": "wheel-left-rear"}};
  node_wheel_left_rear_21.userData.actionProfile = {"animationRole": "rigid", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "wheel-left-rear-mount", "position": [0, 0, 0], "axis": [0, 1, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "wheel-left-rear", "seamRefs": [], "detachableFragments": ["wheel-left-rear"], "breakImpulse": 12, "debrisMaterial": "hidden"}};
  (nodes["root"] ?? root).add(node_wheel_left_rear_21);
  nodes["wheel-left-rear"] = node_wheel_left_rear_21;
  const mesh_wheel_left_rear_21Geometry = endpoint_wheel_left_rear_21
    ? new THREE.CylinderGeometry(endpoint_wheel_left_rear_21.endRadius, endpoint_wheel_left_rear_21.baseRadius, endpoint_wheel_left_rear_21.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_wheel_left_rear_21) {
    mesh_wheel_left_rear_21Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_wheel_left_rear_21 = new THREE.Mesh(
    mesh_wheel_left_rear_21Geometry,
    materialMap["rubber"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_wheel_left_rear_21.name = "wheel-left-rear";
  if (endpoint_wheel_left_rear_21) {
    mesh_wheel_left_rear_21.position.copy(endpoint_wheel_left_rear_21.midpoint);
    mesh_wheel_left_rear_21.quaternion.copy(endpoint_wheel_left_rear_21.quaternion);
  }
  mesh_wheel_left_rear_21.castShadow = options.castShadow ?? true;
  mesh_wheel_left_rear_21.receiveShadow = options.receiveShadow ?? true;
  mesh_wheel_left_rear_21.userData.sculptComponent = {"id": "wheel-left-rear", "name": "wheel-left-rear", "level": "macro", "role": "rigid mechanical part", "importance": 1, "confidence": 0.86, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Separate rigid hardware has its own mechanical boundary.", "geometryDescriptor": {"normalStrategy": "smooth indexed normals", "uvStrategy": "procedural solid color", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.012, "segments": 2}, "deformationStack": [], "roadSurface": {"kind": "wheel", "side": -1, "axle": "rear"}}, "parent": "root", "attachment": {"parentSocket": "root-to-wheel-left-rear", "localStart": [-0.875, 0.365, 1.37], "localEnd": [-0.875, 0.365, 1.37], "contactType": "hinge", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.012, "parentId": "root"}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.85}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "rigid", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "wheel-left-rear-mount", "position": [0, 0, 0], "axis": [0, 1, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "wheel-left-rear", "seamRefs": [], "detachableFragments": ["wheel-left-rear"], "breakImpulse": 12, "debrisMaterial": "hidden"}}, "material": "rubber", "materialLayers": ["rubber"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {}, "evidenceRefs": ["canonical", "profile", "rear"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(36, 41, 44, 1)", "secondaryAlbedo": "rgba(36, 41, 44, 1)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRefs": ["full-object"], "componentId": "wheel-left-rear"}};
  node_wheel_left_rear_21.add(mesh_wheel_left_rear_21);
  meshes["wheel-left-rear"] = mesh_wheel_left_rear_21;
  colliders["wheel-left-rear"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["wheel-left-rear"] ??= [];
  destructionGroups["wheel-left-rear"].push(node_wheel_left_rear_21);
  const socket_wheel_left_rear_wheel_left_rear_mount_0 = new THREE.Object3D();
  socket_wheel_left_rear_wheel_left_rear_mount_0.name = "wheel-left-rear-mount";
  socket_wheel_left_rear_wheel_left_rear_mount_0.position.set(0.0, 0.0, 0.0);
  socket_wheel_left_rear_wheel_left_rear_mount_0.rotation.set(0, 0, 0);
  socket_wheel_left_rear_wheel_left_rear_mount_0.userData.socket = {"id": "wheel-left-rear-mount", "position": [0, 0, 0], "axis": [0, 1, 0]};
  node_wheel_left_rear_21.add(socket_wheel_left_rear_wheel_left_rear_mount_0);
  sockets["wheel-left-rear:wheel-left-rear-mount"] = socket_wheel_left_rear_wheel_left_rear_mount_0;

  const endpoint_rim_left_rear_22 = makeAttachmentEndpoint(null);
  const node_rim_left_rear_22 = new THREE.Group();
  node_rim_left_rear_22.name = "rim-left-rear__pivot";
  node_rim_left_rear_22.scale.set(1, 1, 1);
  if (endpoint_rim_left_rear_22) {
    node_rim_left_rear_22.position.copy(endpoint_rim_left_rear_22.start);
    node_rim_left_rear_22.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_rim_left_rear_22.position.set(0.0, 0.0, 0.0);
    node_rim_left_rear_22.rotation.set(0.0, 0.0, 0.0);
  }
  node_rim_left_rear_22.userData.sculptComponent = {"id": "rim-left-rear", "name": "rim-left-rear", "level": "meso", "role": "rigid mechanical part", "importance": 1, "confidence": 0.86, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Separate rigid hardware has its own mechanical boundary.", "geometryDescriptor": {"normalStrategy": "smooth indexed normals", "uvStrategy": "procedural solid color", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.012, "segments": 2}, "deformationStack": [], "roadSurface": {"kind": "rim", "side": -1, "axle": "rear"}}, "parent": "wheel-left-rear", "attachment": {"parentSocket": "wheel-left-rear-to-rim-left-rear", "localStart": [-0.003696151077747345, 0, 0], "localEnd": [-0.003696151077747345, 0, 0], "contactType": "overlap", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.012, "parentId": "wheel-left-rear"}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.85}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "rigid", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "rim-left-rear-mount", "position": [0, 0, 0], "axis": [0, 1, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "wheel-left-rear", "seamRefs": [], "detachableFragments": ["rim-left-rear"], "breakImpulse": 12, "debrisMaterial": "hidden"}}, "material": "metal", "materialLayers": ["metal"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {}, "evidenceRefs": ["canonical", "profile", "rear"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(179, 191, 197, 1)", "secondaryAlbedo": "rgba(179, 191, 197, 1)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRefs": ["full-object"], "componentId": "rim-left-rear"}};
  node_rim_left_rear_22.userData.actionProfile = {"animationRole": "rigid", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "rim-left-rear-mount", "position": [0, 0, 0], "axis": [0, 1, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "wheel-left-rear", "seamRefs": [], "detachableFragments": ["rim-left-rear"], "breakImpulse": 12, "debrisMaterial": "hidden"}};
  (nodes["wheel-left-rear"] ?? root).add(node_rim_left_rear_22);
  nodes["rim-left-rear"] = node_rim_left_rear_22;
  const mesh_rim_left_rear_22Geometry = endpoint_rim_left_rear_22
    ? new THREE.CylinderGeometry(endpoint_rim_left_rear_22.endRadius, endpoint_rim_left_rear_22.baseRadius, endpoint_rim_left_rear_22.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_rim_left_rear_22) {
    mesh_rim_left_rear_22Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_rim_left_rear_22 = new THREE.Mesh(
    mesh_rim_left_rear_22Geometry,
    materialMap["metal"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_rim_left_rear_22.name = "rim-left-rear";
  if (endpoint_rim_left_rear_22) {
    mesh_rim_left_rear_22.position.copy(endpoint_rim_left_rear_22.midpoint);
    mesh_rim_left_rear_22.quaternion.copy(endpoint_rim_left_rear_22.quaternion);
  }
  mesh_rim_left_rear_22.castShadow = options.castShadow ?? true;
  mesh_rim_left_rear_22.receiveShadow = options.receiveShadow ?? true;
  mesh_rim_left_rear_22.userData.sculptComponent = {"id": "rim-left-rear", "name": "rim-left-rear", "level": "meso", "role": "rigid mechanical part", "importance": 1, "confidence": 0.86, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Separate rigid hardware has its own mechanical boundary.", "geometryDescriptor": {"normalStrategy": "smooth indexed normals", "uvStrategy": "procedural solid color", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.012, "segments": 2}, "deformationStack": [], "roadSurface": {"kind": "rim", "side": -1, "axle": "rear"}}, "parent": "wheel-left-rear", "attachment": {"parentSocket": "wheel-left-rear-to-rim-left-rear", "localStart": [-0.003696151077747345, 0, 0], "localEnd": [-0.003696151077747345, 0, 0], "contactType": "overlap", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.012, "parentId": "wheel-left-rear"}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.85}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "rigid", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "rim-left-rear-mount", "position": [0, 0, 0], "axis": [0, 1, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "wheel-left-rear", "seamRefs": [], "detachableFragments": ["rim-left-rear"], "breakImpulse": 12, "debrisMaterial": "hidden"}}, "material": "metal", "materialLayers": ["metal"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {}, "evidenceRefs": ["canonical", "profile", "rear"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(179, 191, 197, 1)", "secondaryAlbedo": "rgba(179, 191, 197, 1)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRefs": ["full-object"], "componentId": "rim-left-rear"}};
  node_rim_left_rear_22.add(mesh_rim_left_rear_22);
  meshes["rim-left-rear"] = mesh_rim_left_rear_22;
  colliders["rim-left-rear"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["wheel-left-rear"] ??= [];
  destructionGroups["wheel-left-rear"].push(node_rim_left_rear_22);
  const socket_rim_left_rear_rim_left_rear_mount_0 = new THREE.Object3D();
  socket_rim_left_rear_rim_left_rear_mount_0.name = "rim-left-rear-mount";
  socket_rim_left_rear_rim_left_rear_mount_0.position.set(0.0, 0.0, 0.0);
  socket_rim_left_rear_rim_left_rear_mount_0.rotation.set(0, 0, 0);
  socket_rim_left_rear_rim_left_rear_mount_0.userData.socket = {"id": "rim-left-rear-mount", "position": [0, 0, 0], "axis": [0, 1, 0]};
  node_rim_left_rear_22.add(socket_rim_left_rear_rim_left_rear_mount_0);
  sockets["rim-left-rear:rim-left-rear-mount"] = socket_rim_left_rear_rim_left_rear_mount_0;

  const endpoint_fender_right_23 = makeAttachmentEndpoint(null);
  const node_fender_right_23 = new THREE.Group();
  node_fender_right_23.name = "fender-right__pivot";
  node_fender_right_23.scale.set(1, 1, 1);
  if (endpoint_fender_right_23) {
    node_fender_right_23.position.copy(endpoint_fender_right_23.start);
    node_fender_right_23.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_fender_right_23.position.set(0.0, 0.0, 0.0);
    node_fender_right_23.rotation.set(0.0, 0.0, 0.0);
  }
  node_fender_right_23.userData.sculptComponent = {"id": "fender-right", "name": "fender-right", "level": "macro", "role": "rigid mechanical part", "importance": 1, "confidence": 0.86, "primitive": "plane-card", "topologyClass": "conforming-shell", "topologyRationale": "Conforming analytic automotive skin follows continuous section profile.", "geometryDescriptor": {"normalStrategy": "smooth indexed normals", "uvStrategy": "procedural solid color", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.012, "segments": 2}, "deformationStack": [], "roadSurface": {"kind": "side", "side": 1}}, "parent": "root", "attachment": {"parentSocket": "root-to-fender-right", "localStart": [0.7948340773582458, 0.5138981938362122, 0], "localEnd": [0.7948340773582458, 0.5138981938362122, 0], "contactType": "overlap", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.012, "parentId": "root"}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.85}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "rigid", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "fender-right-mount", "position": [0, 0, 0], "axis": [0, 1, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "fender-right", "seamRefs": [], "detachableFragments": ["fender-right"], "breakImpulse": 12, "debrisMaterial": "hidden"}}, "material": "paint", "materialLayers": ["paint"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {}, "evidenceRefs": ["canonical", "profile", "rear"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(199, 107, 33, 1)", "secondaryAlbedo": "rgba(199, 107, 33, 1)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRefs": ["full-object"], "componentId": "fender-right"}};
  node_fender_right_23.userData.actionProfile = {"animationRole": "rigid", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "fender-right-mount", "position": [0, 0, 0], "axis": [0, 1, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "fender-right", "seamRefs": [], "detachableFragments": ["fender-right"], "breakImpulse": 12, "debrisMaterial": "hidden"}};
  (nodes["root"] ?? root).add(node_fender_right_23);
  nodes["fender-right"] = node_fender_right_23;
  const mesh_fender_right_23Geometry = endpoint_fender_right_23
    ? new THREE.CylinderGeometry(endpoint_fender_right_23.endRadius, endpoint_fender_right_23.baseRadius, endpoint_fender_right_23.length, 16, 6)
    : new THREE.PlaneGeometry(1, 1, 12, 12);
  if (!endpoint_fender_right_23) {
    mesh_fender_right_23Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_fender_right_23 = new THREE.Mesh(
    mesh_fender_right_23Geometry,
    materialMap["paint"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_fender_right_23.name = "fender-right";
  if (endpoint_fender_right_23) {
    mesh_fender_right_23.position.copy(endpoint_fender_right_23.midpoint);
    mesh_fender_right_23.quaternion.copy(endpoint_fender_right_23.quaternion);
  }
  mesh_fender_right_23.castShadow = options.castShadow ?? true;
  mesh_fender_right_23.receiveShadow = options.receiveShadow ?? true;
  mesh_fender_right_23.userData.sculptComponent = {"id": "fender-right", "name": "fender-right", "level": "macro", "role": "rigid mechanical part", "importance": 1, "confidence": 0.86, "primitive": "plane-card", "topologyClass": "conforming-shell", "topologyRationale": "Conforming analytic automotive skin follows continuous section profile.", "geometryDescriptor": {"normalStrategy": "smooth indexed normals", "uvStrategy": "procedural solid color", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.012, "segments": 2}, "deformationStack": [], "roadSurface": {"kind": "side", "side": 1}}, "parent": "root", "attachment": {"parentSocket": "root-to-fender-right", "localStart": [0.7948340773582458, 0.5138981938362122, 0], "localEnd": [0.7948340773582458, 0.5138981938362122, 0], "contactType": "overlap", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.012, "parentId": "root"}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.85}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "rigid", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "fender-right-mount", "position": [0, 0, 0], "axis": [0, 1, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "fender-right", "seamRefs": [], "detachableFragments": ["fender-right"], "breakImpulse": 12, "debrisMaterial": "hidden"}}, "material": "paint", "materialLayers": ["paint"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {}, "evidenceRefs": ["canonical", "profile", "rear"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(199, 107, 33, 1)", "secondaryAlbedo": "rgba(199, 107, 33, 1)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRefs": ["full-object"], "componentId": "fender-right"}};
  node_fender_right_23.add(mesh_fender_right_23);
  meshes["fender-right"] = mesh_fender_right_23;
  colliders["fender-right"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["fender-right"] ??= [];
  destructionGroups["fender-right"].push(node_fender_right_23);
  const socket_fender_right_fender_right_mount_0 = new THREE.Object3D();
  socket_fender_right_fender_right_mount_0.name = "fender-right-mount";
  socket_fender_right_fender_right_mount_0.position.set(0.0, 0.0, 0.0);
  socket_fender_right_fender_right_mount_0.rotation.set(0, 0, 0);
  socket_fender_right_fender_right_mount_0.userData.socket = {"id": "fender-right-mount", "position": [0, 0, 0], "axis": [0, 1, 0]};
  node_fender_right_23.add(socket_fender_right_fender_right_mount_0);
  sockets["fender-right:fender-right-mount"] = socket_fender_right_fender_right_mount_0;

  const endpoint_wheel_well_right_24 = makeAttachmentEndpoint(null);
  const node_wheel_well_right_24 = new THREE.Group();
  node_wheel_well_right_24.name = "wheel-well-right__pivot";
  node_wheel_well_right_24.scale.set(1, 1, 1);
  if (endpoint_wheel_well_right_24) {
    node_wheel_well_right_24.position.copy(endpoint_wheel_well_right_24.start);
    node_wheel_well_right_24.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_wheel_well_right_24.position.set(0.0, 0.0, 0.0);
    node_wheel_well_right_24.rotation.set(0.0, 0.0, 0.0);
  }
  node_wheel_well_right_24.userData.sculptComponent = {"id": "wheel-well-right", "name": "wheel-well-right", "level": "meso", "role": "rigid mechanical part", "importance": 1, "confidence": 0.86, "primitive": "plane-card", "topologyClass": "conforming-shell", "topologyRationale": "Conforming analytic automotive skin follows continuous section profile.", "geometryDescriptor": {"normalStrategy": "smooth indexed normals", "uvStrategy": "procedural solid color", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.012, "segments": 2}, "deformationStack": [], "roadSurface": {"kind": "well", "side": 1}}, "parent": "root", "attachment": {"parentSocket": "root-to-wheel-well-right", "localStart": [0.754749983549118, 0.5610000193119049, -0.004999995231628418], "localEnd": [0.754749983549118, 0.5610000193119049, -0.004999995231628418], "contactType": "overlap", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.012, "parentId": "root"}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.85}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "rigid", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "wheel-well-right-mount", "position": [0, 0, 0], "axis": [0, 1, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "wheel-well-right", "seamRefs": [], "detachableFragments": ["wheel-well-right"], "breakImpulse": 12, "debrisMaterial": "hidden"}}, "material": "dark", "materialLayers": ["dark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "closed-wells", "kind": "cavity", "description": "closed-wells", "evidenceRefs": ["canonical"]}], "surfaceDetail": {}, "evidenceRefs": ["canonical", "profile", "rear"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(41, 52, 59, 1)", "secondaryAlbedo": "rgba(41, 52, 59, 1)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRefs": ["full-object"], "componentId": "wheel-well-right"}};
  node_wheel_well_right_24.userData.actionProfile = {"animationRole": "rigid", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "wheel-well-right-mount", "position": [0, 0, 0], "axis": [0, 1, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "wheel-well-right", "seamRefs": [], "detachableFragments": ["wheel-well-right"], "breakImpulse": 12, "debrisMaterial": "hidden"}};
  (nodes["root"] ?? root).add(node_wheel_well_right_24);
  nodes["wheel-well-right"] = node_wheel_well_right_24;
  const mesh_wheel_well_right_24Geometry = endpoint_wheel_well_right_24
    ? new THREE.CylinderGeometry(endpoint_wheel_well_right_24.endRadius, endpoint_wheel_well_right_24.baseRadius, endpoint_wheel_well_right_24.length, 16, 6)
    : new THREE.PlaneGeometry(1, 1, 12, 12);
  if (!endpoint_wheel_well_right_24) {
    mesh_wheel_well_right_24Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_wheel_well_right_24 = new THREE.Mesh(
    mesh_wheel_well_right_24Geometry,
    materialMap["dark"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_wheel_well_right_24.name = "wheel-well-right";
  if (endpoint_wheel_well_right_24) {
    mesh_wheel_well_right_24.position.copy(endpoint_wheel_well_right_24.midpoint);
    mesh_wheel_well_right_24.quaternion.copy(endpoint_wheel_well_right_24.quaternion);
  }
  mesh_wheel_well_right_24.castShadow = options.castShadow ?? true;
  mesh_wheel_well_right_24.receiveShadow = options.receiveShadow ?? true;
  mesh_wheel_well_right_24.userData.sculptComponent = {"id": "wheel-well-right", "name": "wheel-well-right", "level": "meso", "role": "rigid mechanical part", "importance": 1, "confidence": 0.86, "primitive": "plane-card", "topologyClass": "conforming-shell", "topologyRationale": "Conforming analytic automotive skin follows continuous section profile.", "geometryDescriptor": {"normalStrategy": "smooth indexed normals", "uvStrategy": "procedural solid color", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.012, "segments": 2}, "deformationStack": [], "roadSurface": {"kind": "well", "side": 1}}, "parent": "root", "attachment": {"parentSocket": "root-to-wheel-well-right", "localStart": [0.754749983549118, 0.5610000193119049, -0.004999995231628418], "localEnd": [0.754749983549118, 0.5610000193119049, -0.004999995231628418], "contactType": "overlap", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.012, "parentId": "root"}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.85}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "rigid", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "wheel-well-right-mount", "position": [0, 0, 0], "axis": [0, 1, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "wheel-well-right", "seamRefs": [], "detachableFragments": ["wheel-well-right"], "breakImpulse": 12, "debrisMaterial": "hidden"}}, "material": "dark", "materialLayers": ["dark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "closed-wells", "kind": "cavity", "description": "closed-wells", "evidenceRefs": ["canonical"]}], "surfaceDetail": {}, "evidenceRefs": ["canonical", "profile", "rear"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(41, 52, 59, 1)", "secondaryAlbedo": "rgba(41, 52, 59, 1)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRefs": ["full-object"], "componentId": "wheel-well-right"}};
  node_wheel_well_right_24.add(mesh_wheel_well_right_24);
  meshes["wheel-well-right"] = mesh_wheel_well_right_24;
  colliders["wheel-well-right"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["wheel-well-right"] ??= [];
  destructionGroups["wheel-well-right"].push(node_wheel_well_right_24);
  const socket_wheel_well_right_wheel_well_right_mount_0 = new THREE.Object3D();
  socket_wheel_well_right_wheel_well_right_mount_0.name = "wheel-well-right-mount";
  socket_wheel_well_right_wheel_well_right_mount_0.position.set(0.0, 0.0, 0.0);
  socket_wheel_well_right_wheel_well_right_mount_0.rotation.set(0, 0, 0);
  socket_wheel_well_right_wheel_well_right_mount_0.userData.socket = {"id": "wheel-well-right-mount", "position": [0, 0, 0], "axis": [0, 1, 0]};
  node_wheel_well_right_24.add(socket_wheel_well_right_wheel_well_right_mount_0);
  sockets["wheel-well-right:wheel-well-right-mount"] = socket_wheel_well_right_wheel_well_right_mount_0;

  const endpoint_door_right_0_25 = makeAttachmentEndpoint(null);
  const node_door_right_0_25 = new THREE.Group();
  node_door_right_0_25.name = "door-right-0__pivot";
  node_door_right_0_25.scale.set(1, 1, 1);
  if (endpoint_door_right_0_25) {
    node_door_right_0_25.position.copy(endpoint_door_right_0_25.start);
    node_door_right_0_25.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_door_right_0_25.position.set(0.0, 0.0, 0.0);
    node_door_right_0_25.rotation.set(0.0, 0.0, 0.0);
  }
  node_door_right_0_25.userData.sculptComponent = {"id": "door-right-0", "name": "door-right-0", "level": "macro", "role": "rigid mechanical part", "importance": 1, "confidence": 0.86, "primitive": "plane-card", "topologyClass": "conforming-shell", "topologyRationale": "Conforming analytic automotive skin follows continuous section profile.", "geometryDescriptor": {"normalStrategy": "smooth indexed normals", "uvStrategy": "procedural solid color", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.012, "segments": 2}, "deformationStack": [], "roadSurface": {"kind": "door", "side": 1, "door": 0}}, "parent": "root", "attachment": {"parentSocket": "root-to-door-right-0", "localStart": [0.9099866265694496, 0.6478230080260059, -0.73], "localEnd": [0.8244000060747263, 0.78693166586292, -0.26000001072883583], "contactType": "hinge", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.012, "parentId": "root"}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.85}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "rigid", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "door-right-0-mount", "position": [0, 0, 0], "axis": [0, 1, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "door-right-0", "seamRefs": [], "detachableFragments": ["door-right-0"], "breakImpulse": 12, "debrisMaterial": "hidden"}}, "material": "paint", "materialLayers": ["paint"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {}, "evidenceRefs": ["canonical", "profile", "rear"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(199, 107, 33, 1)", "secondaryAlbedo": "rgba(199, 107, 33, 1)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRefs": ["full-object"], "componentId": "door-right-0"}};
  node_door_right_0_25.userData.actionProfile = {"animationRole": "rigid", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "door-right-0-mount", "position": [0, 0, 0], "axis": [0, 1, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "door-right-0", "seamRefs": [], "detachableFragments": ["door-right-0"], "breakImpulse": 12, "debrisMaterial": "hidden"}};
  (nodes["root"] ?? root).add(node_door_right_0_25);
  nodes["door-right-0"] = node_door_right_0_25;
  const mesh_door_right_0_25Geometry = endpoint_door_right_0_25
    ? new THREE.CylinderGeometry(endpoint_door_right_0_25.endRadius, endpoint_door_right_0_25.baseRadius, endpoint_door_right_0_25.length, 16, 6)
    : new THREE.PlaneGeometry(1, 1, 12, 12);
  if (!endpoint_door_right_0_25) {
    mesh_door_right_0_25Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_door_right_0_25 = new THREE.Mesh(
    mesh_door_right_0_25Geometry,
    materialMap["paint"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_door_right_0_25.name = "door-right-0";
  if (endpoint_door_right_0_25) {
    mesh_door_right_0_25.position.copy(endpoint_door_right_0_25.midpoint);
    mesh_door_right_0_25.quaternion.copy(endpoint_door_right_0_25.quaternion);
  }
  mesh_door_right_0_25.castShadow = options.castShadow ?? true;
  mesh_door_right_0_25.receiveShadow = options.receiveShadow ?? true;
  mesh_door_right_0_25.userData.sculptComponent = {"id": "door-right-0", "name": "door-right-0", "level": "macro", "role": "rigid mechanical part", "importance": 1, "confidence": 0.86, "primitive": "plane-card", "topologyClass": "conforming-shell", "topologyRationale": "Conforming analytic automotive skin follows continuous section profile.", "geometryDescriptor": {"normalStrategy": "smooth indexed normals", "uvStrategy": "procedural solid color", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.012, "segments": 2}, "deformationStack": [], "roadSurface": {"kind": "door", "side": 1, "door": 0}}, "parent": "root", "attachment": {"parentSocket": "root-to-door-right-0", "localStart": [0.9099866265694496, 0.6478230080260059, -0.73], "localEnd": [0.8244000060747263, 0.78693166586292, -0.26000001072883583], "contactType": "hinge", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.012, "parentId": "root"}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.85}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "rigid", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "door-right-0-mount", "position": [0, 0, 0], "axis": [0, 1, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "door-right-0", "seamRefs": [], "detachableFragments": ["door-right-0"], "breakImpulse": 12, "debrisMaterial": "hidden"}}, "material": "paint", "materialLayers": ["paint"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {}, "evidenceRefs": ["canonical", "profile", "rear"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(199, 107, 33, 1)", "secondaryAlbedo": "rgba(199, 107, 33, 1)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRefs": ["full-object"], "componentId": "door-right-0"}};
  node_door_right_0_25.add(mesh_door_right_0_25);
  meshes["door-right-0"] = mesh_door_right_0_25;
  colliders["door-right-0"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["door-right-0"] ??= [];
  destructionGroups["door-right-0"].push(node_door_right_0_25);
  const socket_door_right_0_door_right_0_mount_0 = new THREE.Object3D();
  socket_door_right_0_door_right_0_mount_0.name = "door-right-0-mount";
  socket_door_right_0_door_right_0_mount_0.position.set(0.0, 0.0, 0.0);
  socket_door_right_0_door_right_0_mount_0.rotation.set(0, 0, 0);
  socket_door_right_0_door_right_0_mount_0.userData.socket = {"id": "door-right-0-mount", "position": [0, 0, 0], "axis": [0, 1, 0]};
  node_door_right_0_25.add(socket_door_right_0_door_right_0_mount_0);
  sockets["door-right-0:door-right-0-mount"] = socket_door_right_0_door_right_0_mount_0;

  const endpoint_glass_right_0_26 = makeAttachmentEndpoint(null);
  const node_glass_right_0_26 = new THREE.Group();
  node_glass_right_0_26.name = "glass-right-0__pivot";
  node_glass_right_0_26.scale.set(1, 1, 1);
  if (endpoint_glass_right_0_26) {
    node_glass_right_0_26.position.copy(endpoint_glass_right_0_26.start);
    node_glass_right_0_26.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_glass_right_0_26.position.set(0.0, 0.0, 0.0);
    node_glass_right_0_26.rotation.set(0.0, 0.0, 0.0);
  }
  node_glass_right_0_26.userData.sculptComponent = {"id": "glass-right-0", "name": "glass-right-0", "level": "meso", "role": "rigid mechanical part", "importance": 1, "confidence": 0.86, "primitive": "plane-card", "topologyClass": "conforming-shell", "topologyRationale": "Conforming analytic automotive skin follows continuous section profile.", "geometryDescriptor": {"normalStrategy": "smooth indexed normals", "uvStrategy": "procedural solid color", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.012, "segments": 2}, "deformationStack": [], "roadSurface": {"kind": "glass", "side": 1, "door": 0}}, "parent": "door-right-0", "attachment": {"parentSocket": "door-right-0-to-glass-right-0", "localStart": [-0.09865443222224712, 0.44001828134059906, 0.471780052408576], "localEnd": [-0.09865443222224712, 0.44001828134059906, 0.471780052408576], "contactType": "overlap", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.012, "parentId": "door-right-0"}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.85}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "rigid", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "glass-right-0-mount", "position": [0, 0, 0], "axis": [0, 1, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "door-right-0", "seamRefs": [], "detachableFragments": ["glass-right-0"], "breakImpulse": 12, "debrisMaterial": "hidden"}}, "material": "glass", "materialLayers": ["glass"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {}, "evidenceRefs": ["canonical", "profile", "rear"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(172, 203, 212, 1)", "secondaryAlbedo": "rgba(172, 203, 212, 1)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRefs": ["full-object"], "componentId": "glass-right-0"}};
  node_glass_right_0_26.userData.actionProfile = {"animationRole": "rigid", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "glass-right-0-mount", "position": [0, 0, 0], "axis": [0, 1, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "door-right-0", "seamRefs": [], "detachableFragments": ["glass-right-0"], "breakImpulse": 12, "debrisMaterial": "hidden"}};
  (nodes["door-right-0"] ?? root).add(node_glass_right_0_26);
  nodes["glass-right-0"] = node_glass_right_0_26;
  const mesh_glass_right_0_26Geometry = endpoint_glass_right_0_26
    ? new THREE.CylinderGeometry(endpoint_glass_right_0_26.endRadius, endpoint_glass_right_0_26.baseRadius, endpoint_glass_right_0_26.length, 16, 6)
    : new THREE.PlaneGeometry(1, 1, 12, 12);
  if (!endpoint_glass_right_0_26) {
    mesh_glass_right_0_26Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_glass_right_0_26 = new THREE.Mesh(
    mesh_glass_right_0_26Geometry,
    materialMap["glass"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_glass_right_0_26.name = "glass-right-0";
  if (endpoint_glass_right_0_26) {
    mesh_glass_right_0_26.position.copy(endpoint_glass_right_0_26.midpoint);
    mesh_glass_right_0_26.quaternion.copy(endpoint_glass_right_0_26.quaternion);
  }
  mesh_glass_right_0_26.castShadow = options.castShadow ?? true;
  mesh_glass_right_0_26.receiveShadow = options.receiveShadow ?? true;
  mesh_glass_right_0_26.userData.sculptComponent = {"id": "glass-right-0", "name": "glass-right-0", "level": "meso", "role": "rigid mechanical part", "importance": 1, "confidence": 0.86, "primitive": "plane-card", "topologyClass": "conforming-shell", "topologyRationale": "Conforming analytic automotive skin follows continuous section profile.", "geometryDescriptor": {"normalStrategy": "smooth indexed normals", "uvStrategy": "procedural solid color", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.012, "segments": 2}, "deformationStack": [], "roadSurface": {"kind": "glass", "side": 1, "door": 0}}, "parent": "door-right-0", "attachment": {"parentSocket": "door-right-0-to-glass-right-0", "localStart": [-0.09865443222224712, 0.44001828134059906, 0.471780052408576], "localEnd": [-0.09865443222224712, 0.44001828134059906, 0.471780052408576], "contactType": "overlap", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.012, "parentId": "door-right-0"}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.85}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "rigid", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "glass-right-0-mount", "position": [0, 0, 0], "axis": [0, 1, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "door-right-0", "seamRefs": [], "detachableFragments": ["glass-right-0"], "breakImpulse": 12, "debrisMaterial": "hidden"}}, "material": "glass", "materialLayers": ["glass"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {}, "evidenceRefs": ["canonical", "profile", "rear"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(172, 203, 212, 1)", "secondaryAlbedo": "rgba(172, 203, 212, 1)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRefs": ["full-object"], "componentId": "glass-right-0"}};
  node_glass_right_0_26.add(mesh_glass_right_0_26);
  meshes["glass-right-0"] = mesh_glass_right_0_26;
  colliders["glass-right-0"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["door-right-0"] ??= [];
  destructionGroups["door-right-0"].push(node_glass_right_0_26);
  const socket_glass_right_0_glass_right_0_mount_0 = new THREE.Object3D();
  socket_glass_right_0_glass_right_0_mount_0.name = "glass-right-0-mount";
  socket_glass_right_0_glass_right_0_mount_0.position.set(0.0, 0.0, 0.0);
  socket_glass_right_0_glass_right_0_mount_0.rotation.set(0, 0, 0);
  socket_glass_right_0_glass_right_0_mount_0.userData.socket = {"id": "glass-right-0-mount", "position": [0, 0, 0], "axis": [0, 1, 0]};
  node_glass_right_0_26.add(socket_glass_right_0_glass_right_0_mount_0);
  sockets["glass-right-0:glass-right-0-mount"] = socket_glass_right_0_glass_right_0_mount_0;

  const endpoint_frame_right_0_27 = makeAttachmentEndpoint(null);
  const node_frame_right_0_27 = new THREE.Group();
  node_frame_right_0_27.name = "frame-right-0__pivot";
  node_frame_right_0_27.scale.set(1, 1, 1);
  if (endpoint_frame_right_0_27) {
    node_frame_right_0_27.position.copy(endpoint_frame_right_0_27.start);
    node_frame_right_0_27.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_frame_right_0_27.position.set(0.0, 0.0, 0.0);
    node_frame_right_0_27.rotation.set(0.0, 0.0, 0.0);
  }
  node_frame_right_0_27.userData.sculptComponent = {"id": "frame-right-0", "name": "frame-right-0", "level": "meso", "role": "rigid mechanical part", "importance": 1, "confidence": 0.86, "primitive": "plane-card", "topologyClass": "assembled-solid", "topologyRationale": "Separate rigid hardware has its own mechanical boundary.", "geometryDescriptor": {"normalStrategy": "smooth indexed normals", "uvStrategy": "procedural solid color", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.012, "segments": 2}, "deformationStack": [], "roadSurface": {"kind": "frame", "side": 1, "door": 0}}, "parent": "door-right-0", "attachment": {"parentSocket": "door-right-0-to-frame-right-0", "localStart": [-0.09808663837611675, 0.4429980367422104, 0.46999998927116415], "localEnd": [-0.09808663837611675, 0.4429980367422104, 0.46999998927116415], "contactType": "overlap", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.012, "parentId": "door-right-0"}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.85}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "rigid", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "frame-right-0-mount", "position": [0, 0, 0], "axis": [0, 1, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "door-right-0", "seamRefs": [], "detachableFragments": ["frame-right-0"], "breakImpulse": 12, "debrisMaterial": "hidden"}}, "material": "paint", "materialLayers": ["paint"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {}, "evidenceRefs": ["canonical", "profile", "rear"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(199, 107, 33, 1)", "secondaryAlbedo": "rgba(199, 107, 33, 1)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRefs": ["full-object"], "componentId": "frame-right-0"}};
  node_frame_right_0_27.userData.actionProfile = {"animationRole": "rigid", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "frame-right-0-mount", "position": [0, 0, 0], "axis": [0, 1, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "door-right-0", "seamRefs": [], "detachableFragments": ["frame-right-0"], "breakImpulse": 12, "debrisMaterial": "hidden"}};
  (nodes["door-right-0"] ?? root).add(node_frame_right_0_27);
  nodes["frame-right-0"] = node_frame_right_0_27;
  const mesh_frame_right_0_27Geometry = endpoint_frame_right_0_27
    ? new THREE.CylinderGeometry(endpoint_frame_right_0_27.endRadius, endpoint_frame_right_0_27.baseRadius, endpoint_frame_right_0_27.length, 16, 6)
    : new THREE.PlaneGeometry(1, 1, 12, 12);
  if (!endpoint_frame_right_0_27) {
    mesh_frame_right_0_27Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_frame_right_0_27 = new THREE.Mesh(
    mesh_frame_right_0_27Geometry,
    materialMap["paint"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_frame_right_0_27.name = "frame-right-0";
  if (endpoint_frame_right_0_27) {
    mesh_frame_right_0_27.position.copy(endpoint_frame_right_0_27.midpoint);
    mesh_frame_right_0_27.quaternion.copy(endpoint_frame_right_0_27.quaternion);
  }
  mesh_frame_right_0_27.castShadow = options.castShadow ?? true;
  mesh_frame_right_0_27.receiveShadow = options.receiveShadow ?? true;
  mesh_frame_right_0_27.userData.sculptComponent = {"id": "frame-right-0", "name": "frame-right-0", "level": "meso", "role": "rigid mechanical part", "importance": 1, "confidence": 0.86, "primitive": "plane-card", "topologyClass": "assembled-solid", "topologyRationale": "Separate rigid hardware has its own mechanical boundary.", "geometryDescriptor": {"normalStrategy": "smooth indexed normals", "uvStrategy": "procedural solid color", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.012, "segments": 2}, "deformationStack": [], "roadSurface": {"kind": "frame", "side": 1, "door": 0}}, "parent": "door-right-0", "attachment": {"parentSocket": "door-right-0-to-frame-right-0", "localStart": [-0.09808663837611675, 0.4429980367422104, 0.46999998927116415], "localEnd": [-0.09808663837611675, 0.4429980367422104, 0.46999998927116415], "contactType": "overlap", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.012, "parentId": "door-right-0"}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.85}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "rigid", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "frame-right-0-mount", "position": [0, 0, 0], "axis": [0, 1, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "door-right-0", "seamRefs": [], "detachableFragments": ["frame-right-0"], "breakImpulse": 12, "debrisMaterial": "hidden"}}, "material": "paint", "materialLayers": ["paint"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {}, "evidenceRefs": ["canonical", "profile", "rear"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(199, 107, 33, 1)", "secondaryAlbedo": "rgba(199, 107, 33, 1)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRefs": ["full-object"], "componentId": "frame-right-0"}};
  node_frame_right_0_27.add(mesh_frame_right_0_27);
  meshes["frame-right-0"] = mesh_frame_right_0_27;
  colliders["frame-right-0"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["door-right-0"] ??= [];
  destructionGroups["door-right-0"].push(node_frame_right_0_27);
  const socket_frame_right_0_frame_right_0_mount_0 = new THREE.Object3D();
  socket_frame_right_0_frame_right_0_mount_0.name = "frame-right-0-mount";
  socket_frame_right_0_frame_right_0_mount_0.position.set(0.0, 0.0, 0.0);
  socket_frame_right_0_frame_right_0_mount_0.rotation.set(0, 0, 0);
  socket_frame_right_0_frame_right_0_mount_0.userData.socket = {"id": "frame-right-0-mount", "position": [0, 0, 0], "axis": [0, 1, 0]};
  node_frame_right_0_27.add(socket_frame_right_0_frame_right_0_mount_0);
  sockets["frame-right-0:frame-right-0-mount"] = socket_frame_right_0_frame_right_0_mount_0;

  const endpoint_handle_right_0_28 = makeAttachmentEndpoint(null);
  const node_handle_right_0_28 = new THREE.Group();
  node_handle_right_0_28.name = "handle-right-0__pivot";
  node_handle_right_0_28.scale.set(1, 1, 1);
  if (endpoint_handle_right_0_28) {
    node_handle_right_0_28.position.copy(endpoint_handle_right_0_28.start);
    node_handle_right_0_28.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_handle_right_0_28.position.set(0.0, 0.0, 0.0);
    node_handle_right_0_28.rotation.set(0.0, 0.0, 0.0);
  }
  node_handle_right_0_28.userData.sculptComponent = {"id": "handle-right-0", "name": "handle-right-0", "level": "micro", "role": "rigid mechanical part", "importance": 1, "confidence": 0.86, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Separate rigid hardware has its own mechanical boundary.", "geometryDescriptor": {"normalStrategy": "smooth indexed normals", "uvStrategy": "procedural solid color", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.012, "segments": 2}, "deformationStack": [], "roadSurface": {"kind": "handle", "side": 1, "door": 0}}, "parent": "door-right-0", "attachment": {"parentSocket": "door-right-0-to-handle-right-0", "localStart": [0.018013376742601395, 0.042176988907158375, 0.7799999713897705], "localEnd": [0.018013376742601395, 0.042176988907158375, 0.7799999713897705], "contactType": "overlap", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.012, "parentId": "door-right-0"}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.85}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "rigid", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "handle-right-0-mount", "position": [0, 0, 0], "axis": [0, 1, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "door-right-0", "seamRefs": [], "detachableFragments": ["handle-right-0"], "breakImpulse": 12, "debrisMaterial": "hidden"}}, "material": "metal", "materialLayers": ["metal"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {}, "evidenceRefs": ["canonical", "profile", "rear"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(179, 191, 197, 1)", "secondaryAlbedo": "rgba(179, 191, 197, 1)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRefs": ["full-object"], "componentId": "handle-right-0"}};
  node_handle_right_0_28.userData.actionProfile = {"animationRole": "rigid", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "handle-right-0-mount", "position": [0, 0, 0], "axis": [0, 1, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "door-right-0", "seamRefs": [], "detachableFragments": ["handle-right-0"], "breakImpulse": 12, "debrisMaterial": "hidden"}};
  (nodes["door-right-0"] ?? root).add(node_handle_right_0_28);
  nodes["handle-right-0"] = node_handle_right_0_28;
  const mesh_handle_right_0_28Geometry = endpoint_handle_right_0_28
    ? new THREE.CylinderGeometry(endpoint_handle_right_0_28.endRadius, endpoint_handle_right_0_28.baseRadius, endpoint_handle_right_0_28.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_handle_right_0_28) {
    mesh_handle_right_0_28Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_handle_right_0_28 = new THREE.Mesh(
    mesh_handle_right_0_28Geometry,
    materialMap["metal"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_handle_right_0_28.name = "handle-right-0";
  if (endpoint_handle_right_0_28) {
    mesh_handle_right_0_28.position.copy(endpoint_handle_right_0_28.midpoint);
    mesh_handle_right_0_28.quaternion.copy(endpoint_handle_right_0_28.quaternion);
  }
  mesh_handle_right_0_28.castShadow = options.castShadow ?? true;
  mesh_handle_right_0_28.receiveShadow = options.receiveShadow ?? true;
  mesh_handle_right_0_28.userData.sculptComponent = {"id": "handle-right-0", "name": "handle-right-0", "level": "micro", "role": "rigid mechanical part", "importance": 1, "confidence": 0.86, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Separate rigid hardware has its own mechanical boundary.", "geometryDescriptor": {"normalStrategy": "smooth indexed normals", "uvStrategy": "procedural solid color", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.012, "segments": 2}, "deformationStack": [], "roadSurface": {"kind": "handle", "side": 1, "door": 0}}, "parent": "door-right-0", "attachment": {"parentSocket": "door-right-0-to-handle-right-0", "localStart": [0.018013376742601395, 0.042176988907158375, 0.7799999713897705], "localEnd": [0.018013376742601395, 0.042176988907158375, 0.7799999713897705], "contactType": "overlap", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.012, "parentId": "door-right-0"}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.85}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "rigid", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "handle-right-0-mount", "position": [0, 0, 0], "axis": [0, 1, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "door-right-0", "seamRefs": [], "detachableFragments": ["handle-right-0"], "breakImpulse": 12, "debrisMaterial": "hidden"}}, "material": "metal", "materialLayers": ["metal"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {}, "evidenceRefs": ["canonical", "profile", "rear"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(179, 191, 197, 1)", "secondaryAlbedo": "rgba(179, 191, 197, 1)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRefs": ["full-object"], "componentId": "handle-right-0"}};
  node_handle_right_0_28.add(mesh_handle_right_0_28);
  meshes["handle-right-0"] = mesh_handle_right_0_28;
  colliders["handle-right-0"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["door-right-0"] ??= [];
  destructionGroups["door-right-0"].push(node_handle_right_0_28);
  const socket_handle_right_0_handle_right_0_mount_0 = new THREE.Object3D();
  socket_handle_right_0_handle_right_0_mount_0.name = "handle-right-0-mount";
  socket_handle_right_0_handle_right_0_mount_0.position.set(0.0, 0.0, 0.0);
  socket_handle_right_0_handle_right_0_mount_0.rotation.set(0, 0, 0);
  socket_handle_right_0_handle_right_0_mount_0.userData.socket = {"id": "handle-right-0-mount", "position": [0, 0, 0], "axis": [0, 1, 0]};
  node_handle_right_0_28.add(socket_handle_right_0_handle_right_0_mount_0);
  sockets["handle-right-0:handle-right-0-mount"] = socket_handle_right_0_handle_right_0_mount_0;

  const endpoint_door_right_1_29 = makeAttachmentEndpoint(null);
  const node_door_right_1_29 = new THREE.Group();
  node_door_right_1_29.name = "door-right-1__pivot";
  node_door_right_1_29.scale.set(1, 1, 1);
  if (endpoint_door_right_1_29) {
    node_door_right_1_29.position.copy(endpoint_door_right_1_29.start);
    node_door_right_1_29.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_door_right_1_29.position.set(0.0, 0.0, 0.0);
    node_door_right_1_29.rotation.set(0.0, 0.0, 0.0);
  }
  node_door_right_1_29.userData.sculptComponent = {"id": "door-right-1", "name": "door-right-1", "level": "macro", "role": "rigid mechanical part", "importance": 1, "confidence": 0.86, "primitive": "plane-card", "topologyClass": "conforming-shell", "topologyRationale": "Conforming analytic automotive skin follows continuous section profile.", "geometryDescriptor": {"normalStrategy": "smooth indexed normals", "uvStrategy": "procedural solid color", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.012, "segments": 2}, "deformationStack": [], "roadSurface": {"kind": "door", "side": 1, "door": 1}}, "parent": "root", "attachment": {"parentSocket": "root-to-door-right-1", "localStart": [0.9099999993727881, 0.6479996513130081, 0.21000000000000008], "localEnd": [0.8259478818313557, 0.7869960587026488, 0.6512019215524196], "contactType": "hinge", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.012, "parentId": "root"}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.85}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "rigid", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "door-right-1-mount", "position": [0, 0, 0], "axis": [0, 1, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "door-right-1", "seamRefs": [], "detachableFragments": ["door-right-1"], "breakImpulse": 12, "debrisMaterial": "hidden"}}, "material": "paint", "materialLayers": ["paint"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "door-seams", "kind": "linework", "description": "door-seams", "evidenceRefs": ["canonical"]}], "surfaceDetail": {}, "evidenceRefs": ["canonical", "profile", "rear"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(199, 107, 33, 1)", "secondaryAlbedo": "rgba(199, 107, 33, 1)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRefs": ["full-object"], "componentId": "door-right-1"}};
  node_door_right_1_29.userData.actionProfile = {"animationRole": "rigid", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "door-right-1-mount", "position": [0, 0, 0], "axis": [0, 1, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "door-right-1", "seamRefs": [], "detachableFragments": ["door-right-1"], "breakImpulse": 12, "debrisMaterial": "hidden"}};
  (nodes["root"] ?? root).add(node_door_right_1_29);
  nodes["door-right-1"] = node_door_right_1_29;
  const mesh_door_right_1_29Geometry = endpoint_door_right_1_29
    ? new THREE.CylinderGeometry(endpoint_door_right_1_29.endRadius, endpoint_door_right_1_29.baseRadius, endpoint_door_right_1_29.length, 16, 6)
    : new THREE.PlaneGeometry(1, 1, 12, 12);
  if (!endpoint_door_right_1_29) {
    mesh_door_right_1_29Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_door_right_1_29 = new THREE.Mesh(
    mesh_door_right_1_29Geometry,
    materialMap["paint"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_door_right_1_29.name = "door-right-1";
  if (endpoint_door_right_1_29) {
    mesh_door_right_1_29.position.copy(endpoint_door_right_1_29.midpoint);
    mesh_door_right_1_29.quaternion.copy(endpoint_door_right_1_29.quaternion);
  }
  mesh_door_right_1_29.castShadow = options.castShadow ?? true;
  mesh_door_right_1_29.receiveShadow = options.receiveShadow ?? true;
  mesh_door_right_1_29.userData.sculptComponent = {"id": "door-right-1", "name": "door-right-1", "level": "macro", "role": "rigid mechanical part", "importance": 1, "confidence": 0.86, "primitive": "plane-card", "topologyClass": "conforming-shell", "topologyRationale": "Conforming analytic automotive skin follows continuous section profile.", "geometryDescriptor": {"normalStrategy": "smooth indexed normals", "uvStrategy": "procedural solid color", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.012, "segments": 2}, "deformationStack": [], "roadSurface": {"kind": "door", "side": 1, "door": 1}}, "parent": "root", "attachment": {"parentSocket": "root-to-door-right-1", "localStart": [0.9099999993727881, 0.6479996513130081, 0.21000000000000008], "localEnd": [0.8259478818313557, 0.7869960587026488, 0.6512019215524196], "contactType": "hinge", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.012, "parentId": "root"}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.85}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "rigid", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "door-right-1-mount", "position": [0, 0, 0], "axis": [0, 1, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "door-right-1", "seamRefs": [], "detachableFragments": ["door-right-1"], "breakImpulse": 12, "debrisMaterial": "hidden"}}, "material": "paint", "materialLayers": ["paint"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "door-seams", "kind": "linework", "description": "door-seams", "evidenceRefs": ["canonical"]}], "surfaceDetail": {}, "evidenceRefs": ["canonical", "profile", "rear"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(199, 107, 33, 1)", "secondaryAlbedo": "rgba(199, 107, 33, 1)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRefs": ["full-object"], "componentId": "door-right-1"}};
  node_door_right_1_29.add(mesh_door_right_1_29);
  meshes["door-right-1"] = mesh_door_right_1_29;
  colliders["door-right-1"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["door-right-1"] ??= [];
  destructionGroups["door-right-1"].push(node_door_right_1_29);
  const socket_door_right_1_door_right_1_mount_0 = new THREE.Object3D();
  socket_door_right_1_door_right_1_mount_0.name = "door-right-1-mount";
  socket_door_right_1_door_right_1_mount_0.position.set(0.0, 0.0, 0.0);
  socket_door_right_1_door_right_1_mount_0.rotation.set(0, 0, 0);
  socket_door_right_1_door_right_1_mount_0.userData.socket = {"id": "door-right-1-mount", "position": [0, 0, 0], "axis": [0, 1, 0]};
  node_door_right_1_29.add(socket_door_right_1_door_right_1_mount_0);
  sockets["door-right-1:door-right-1-mount"] = socket_door_right_1_door_right_1_mount_0;

  const endpoint_glass_right_1_30 = makeAttachmentEndpoint(null);
  const node_glass_right_1_30 = new THREE.Group();
  node_glass_right_1_30.name = "glass-right-1__pivot";
  node_glass_right_1_30.scale.set(1, 1, 1);
  if (endpoint_glass_right_1_30) {
    node_glass_right_1_30.position.copy(endpoint_glass_right_1_30.start);
    node_glass_right_1_30.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_glass_right_1_30.position.set(0.0, 0.0, 0.0);
    node_glass_right_1_30.rotation.set(0.0, 0.0, 0.0);
  }
  node_glass_right_1_30.userData.sculptComponent = {"id": "glass-right-1", "name": "glass-right-1", "level": "meso", "role": "rigid mechanical part", "importance": 1, "confidence": 0.86, "primitive": "plane-card", "topologyClass": "conforming-shell", "topologyRationale": "Conforming analytic automotive skin follows continuous section profile.", "geometryDescriptor": {"normalStrategy": "smooth indexed normals", "uvStrategy": "procedural solid color", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.012, "segments": 2}, "deformationStack": [], "roadSurface": {"kind": "glass", "side": 1, "door": 1}}, "parent": "door-right-1", "attachment": {"parentSocket": "door-right-1-to-glass-right-1", "localStart": [-0.09712010761722922, 0.43920227885246266, 0.43344777449965466], "localEnd": [-0.09712010761722922, 0.43920227885246266, 0.43344777449965466], "contactType": "overlap", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.012, "parentId": "door-right-1"}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.85}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "rigid", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "glass-right-1-mount", "position": [0, 0, 0], "axis": [0, 1, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "door-right-1", "seamRefs": [], "detachableFragments": ["glass-right-1"], "breakImpulse": 12, "debrisMaterial": "hidden"}}, "material": "glass", "materialLayers": ["glass"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {}, "evidenceRefs": ["canonical", "profile", "rear"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(172, 203, 212, 1)", "secondaryAlbedo": "rgba(172, 203, 212, 1)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRefs": ["full-object"], "componentId": "glass-right-1"}};
  node_glass_right_1_30.userData.actionProfile = {"animationRole": "rigid", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "glass-right-1-mount", "position": [0, 0, 0], "axis": [0, 1, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "door-right-1", "seamRefs": [], "detachableFragments": ["glass-right-1"], "breakImpulse": 12, "debrisMaterial": "hidden"}};
  (nodes["door-right-1"] ?? root).add(node_glass_right_1_30);
  nodes["glass-right-1"] = node_glass_right_1_30;
  const mesh_glass_right_1_30Geometry = endpoint_glass_right_1_30
    ? new THREE.CylinderGeometry(endpoint_glass_right_1_30.endRadius, endpoint_glass_right_1_30.baseRadius, endpoint_glass_right_1_30.length, 16, 6)
    : new THREE.PlaneGeometry(1, 1, 12, 12);
  if (!endpoint_glass_right_1_30) {
    mesh_glass_right_1_30Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_glass_right_1_30 = new THREE.Mesh(
    mesh_glass_right_1_30Geometry,
    materialMap["glass"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_glass_right_1_30.name = "glass-right-1";
  if (endpoint_glass_right_1_30) {
    mesh_glass_right_1_30.position.copy(endpoint_glass_right_1_30.midpoint);
    mesh_glass_right_1_30.quaternion.copy(endpoint_glass_right_1_30.quaternion);
  }
  mesh_glass_right_1_30.castShadow = options.castShadow ?? true;
  mesh_glass_right_1_30.receiveShadow = options.receiveShadow ?? true;
  mesh_glass_right_1_30.userData.sculptComponent = {"id": "glass-right-1", "name": "glass-right-1", "level": "meso", "role": "rigid mechanical part", "importance": 1, "confidence": 0.86, "primitive": "plane-card", "topologyClass": "conforming-shell", "topologyRationale": "Conforming analytic automotive skin follows continuous section profile.", "geometryDescriptor": {"normalStrategy": "smooth indexed normals", "uvStrategy": "procedural solid color", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.012, "segments": 2}, "deformationStack": [], "roadSurface": {"kind": "glass", "side": 1, "door": 1}}, "parent": "door-right-1", "attachment": {"parentSocket": "door-right-1-to-glass-right-1", "localStart": [-0.09712010761722922, 0.43920227885246266, 0.43344777449965466], "localEnd": [-0.09712010761722922, 0.43920227885246266, 0.43344777449965466], "contactType": "overlap", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.012, "parentId": "door-right-1"}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.85}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "rigid", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "glass-right-1-mount", "position": [0, 0, 0], "axis": [0, 1, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "door-right-1", "seamRefs": [], "detachableFragments": ["glass-right-1"], "breakImpulse": 12, "debrisMaterial": "hidden"}}, "material": "glass", "materialLayers": ["glass"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {}, "evidenceRefs": ["canonical", "profile", "rear"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(172, 203, 212, 1)", "secondaryAlbedo": "rgba(172, 203, 212, 1)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRefs": ["full-object"], "componentId": "glass-right-1"}};
  node_glass_right_1_30.add(mesh_glass_right_1_30);
  meshes["glass-right-1"] = mesh_glass_right_1_30;
  colliders["glass-right-1"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["door-right-1"] ??= [];
  destructionGroups["door-right-1"].push(node_glass_right_1_30);
  const socket_glass_right_1_glass_right_1_mount_0 = new THREE.Object3D();
  socket_glass_right_1_glass_right_1_mount_0.name = "glass-right-1-mount";
  socket_glass_right_1_glass_right_1_mount_0.position.set(0.0, 0.0, 0.0);
  socket_glass_right_1_glass_right_1_mount_0.rotation.set(0, 0, 0);
  socket_glass_right_1_glass_right_1_mount_0.userData.socket = {"id": "glass-right-1-mount", "position": [0, 0, 0], "axis": [0, 1, 0]};
  node_glass_right_1_30.add(socket_glass_right_1_glass_right_1_mount_0);
  sockets["glass-right-1:glass-right-1-mount"] = socket_glass_right_1_glass_right_1_mount_0;

  const endpoint_frame_right_1_31 = makeAttachmentEndpoint(null);
  const node_frame_right_1_31 = new THREE.Group();
  node_frame_right_1_31.name = "frame-right-1__pivot";
  node_frame_right_1_31.scale.set(1, 1, 1);
  if (endpoint_frame_right_1_31) {
    node_frame_right_1_31.position.copy(endpoint_frame_right_1_31.start);
    node_frame_right_1_31.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_frame_right_1_31.position.set(0.0, 0.0, 0.0);
    node_frame_right_1_31.rotation.set(0.0, 0.0, 0.0);
  }
  node_frame_right_1_31.userData.sculptComponent = {"id": "frame-right-1", "name": "frame-right-1", "level": "meso", "role": "rigid mechanical part", "importance": 1, "confidence": 0.86, "primitive": "plane-card", "topologyClass": "assembled-solid", "topologyRationale": "Separate rigid hardware has its own mechanical boundary.", "geometryDescriptor": {"normalStrategy": "smooth indexed normals", "uvStrategy": "procedural solid color", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.012, "segments": 2}, "deformationStack": [], "roadSurface": {"kind": "frame", "side": 1, "door": 1}}, "parent": "door-right-1", "attachment": {"parentSocket": "door-right-1-to-frame-right-1", "localStart": [-0.09647563239559531, 0.4419231414794921, 0.44120192155241955], "localEnd": [-0.09647563239559531, 0.4419231414794921, 0.44120192155241955], "contactType": "overlap", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.012, "parentId": "door-right-1"}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.85}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "rigid", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "frame-right-1-mount", "position": [0, 0, 0], "axis": [0, 1, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "door-right-1", "seamRefs": [], "detachableFragments": ["frame-right-1"], "breakImpulse": 12, "debrisMaterial": "hidden"}}, "material": "paint", "materialLayers": ["paint"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {}, "evidenceRefs": ["canonical", "profile", "rear"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(199, 107, 33, 1)", "secondaryAlbedo": "rgba(199, 107, 33, 1)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRefs": ["full-object"], "componentId": "frame-right-1"}};
  node_frame_right_1_31.userData.actionProfile = {"animationRole": "rigid", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "frame-right-1-mount", "position": [0, 0, 0], "axis": [0, 1, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "door-right-1", "seamRefs": [], "detachableFragments": ["frame-right-1"], "breakImpulse": 12, "debrisMaterial": "hidden"}};
  (nodes["door-right-1"] ?? root).add(node_frame_right_1_31);
  nodes["frame-right-1"] = node_frame_right_1_31;
  const mesh_frame_right_1_31Geometry = endpoint_frame_right_1_31
    ? new THREE.CylinderGeometry(endpoint_frame_right_1_31.endRadius, endpoint_frame_right_1_31.baseRadius, endpoint_frame_right_1_31.length, 16, 6)
    : new THREE.PlaneGeometry(1, 1, 12, 12);
  if (!endpoint_frame_right_1_31) {
    mesh_frame_right_1_31Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_frame_right_1_31 = new THREE.Mesh(
    mesh_frame_right_1_31Geometry,
    materialMap["paint"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_frame_right_1_31.name = "frame-right-1";
  if (endpoint_frame_right_1_31) {
    mesh_frame_right_1_31.position.copy(endpoint_frame_right_1_31.midpoint);
    mesh_frame_right_1_31.quaternion.copy(endpoint_frame_right_1_31.quaternion);
  }
  mesh_frame_right_1_31.castShadow = options.castShadow ?? true;
  mesh_frame_right_1_31.receiveShadow = options.receiveShadow ?? true;
  mesh_frame_right_1_31.userData.sculptComponent = {"id": "frame-right-1", "name": "frame-right-1", "level": "meso", "role": "rigid mechanical part", "importance": 1, "confidence": 0.86, "primitive": "plane-card", "topologyClass": "assembled-solid", "topologyRationale": "Separate rigid hardware has its own mechanical boundary.", "geometryDescriptor": {"normalStrategy": "smooth indexed normals", "uvStrategy": "procedural solid color", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.012, "segments": 2}, "deformationStack": [], "roadSurface": {"kind": "frame", "side": 1, "door": 1}}, "parent": "door-right-1", "attachment": {"parentSocket": "door-right-1-to-frame-right-1", "localStart": [-0.09647563239559531, 0.4419231414794921, 0.44120192155241955], "localEnd": [-0.09647563239559531, 0.4419231414794921, 0.44120192155241955], "contactType": "overlap", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.012, "parentId": "door-right-1"}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.85}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "rigid", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "frame-right-1-mount", "position": [0, 0, 0], "axis": [0, 1, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "door-right-1", "seamRefs": [], "detachableFragments": ["frame-right-1"], "breakImpulse": 12, "debrisMaterial": "hidden"}}, "material": "paint", "materialLayers": ["paint"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {}, "evidenceRefs": ["canonical", "profile", "rear"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(199, 107, 33, 1)", "secondaryAlbedo": "rgba(199, 107, 33, 1)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRefs": ["full-object"], "componentId": "frame-right-1"}};
  node_frame_right_1_31.add(mesh_frame_right_1_31);
  meshes["frame-right-1"] = mesh_frame_right_1_31;
  colliders["frame-right-1"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["door-right-1"] ??= [];
  destructionGroups["door-right-1"].push(node_frame_right_1_31);
  const socket_frame_right_1_frame_right_1_mount_0 = new THREE.Object3D();
  socket_frame_right_1_frame_right_1_mount_0.name = "frame-right-1-mount";
  socket_frame_right_1_frame_right_1_mount_0.position.set(0.0, 0.0, 0.0);
  socket_frame_right_1_frame_right_1_mount_0.rotation.set(0, 0, 0);
  socket_frame_right_1_frame_right_1_mount_0.userData.socket = {"id": "frame-right-1-mount", "position": [0, 0, 0], "axis": [0, 1, 0]};
  node_frame_right_1_31.add(socket_frame_right_1_frame_right_1_mount_0);
  sockets["frame-right-1:frame-right-1-mount"] = socket_frame_right_1_frame_right_1_mount_0;

  const endpoint_handle_right_1_32 = makeAttachmentEndpoint(null);
  const node_handle_right_1_32 = new THREE.Group();
  node_handle_right_1_32.name = "handle-right-1__pivot";
  node_handle_right_1_32.scale.set(1, 1, 1);
  if (endpoint_handle_right_1_32) {
    node_handle_right_1_32.position.copy(endpoint_handle_right_1_32.start);
    node_handle_right_1_32.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_handle_right_1_32.position.set(0.0, 0.0, 0.0);
    node_handle_right_1_32.rotation.set(0.0, 0.0, 0.0);
  }
  node_handle_right_1_32.userData.sculptComponent = {"id": "handle-right-1", "name": "handle-right-1", "level": "micro", "role": "rigid mechanical part", "importance": 1, "confidence": 0.86, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Separate rigid hardware has its own mechanical boundary.", "geometryDescriptor": {"normalStrategy": "smooth indexed normals", "uvStrategy": "procedural solid color", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.012, "segments": 2}, "deformationStack": [], "roadSurface": {"kind": "handle", "side": 1, "door": 1}}, "parent": "door-right-1", "attachment": {"parentSocket": "door-right-1-to-handle-right-1", "localStart": [0.017846998292952776, 0.04098542779684067, 0.7800000011920928], "localEnd": [0.017846998292952776, 0.04098542779684067, 0.7800000011920928], "contactType": "overlap", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.012, "parentId": "door-right-1"}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.85}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "rigid", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "handle-right-1-mount", "position": [0, 0, 0], "axis": [0, 1, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "door-right-1", "seamRefs": [], "detachableFragments": ["handle-right-1"], "breakImpulse": 12, "debrisMaterial": "hidden"}}, "material": "metal", "materialLayers": ["metal"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {}, "evidenceRefs": ["canonical", "profile", "rear"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(179, 191, 197, 1)", "secondaryAlbedo": "rgba(179, 191, 197, 1)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRefs": ["full-object"], "componentId": "handle-right-1"}};
  node_handle_right_1_32.userData.actionProfile = {"animationRole": "rigid", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "handle-right-1-mount", "position": [0, 0, 0], "axis": [0, 1, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "door-right-1", "seamRefs": [], "detachableFragments": ["handle-right-1"], "breakImpulse": 12, "debrisMaterial": "hidden"}};
  (nodes["door-right-1"] ?? root).add(node_handle_right_1_32);
  nodes["handle-right-1"] = node_handle_right_1_32;
  const mesh_handle_right_1_32Geometry = endpoint_handle_right_1_32
    ? new THREE.CylinderGeometry(endpoint_handle_right_1_32.endRadius, endpoint_handle_right_1_32.baseRadius, endpoint_handle_right_1_32.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_handle_right_1_32) {
    mesh_handle_right_1_32Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_handle_right_1_32 = new THREE.Mesh(
    mesh_handle_right_1_32Geometry,
    materialMap["metal"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_handle_right_1_32.name = "handle-right-1";
  if (endpoint_handle_right_1_32) {
    mesh_handle_right_1_32.position.copy(endpoint_handle_right_1_32.midpoint);
    mesh_handle_right_1_32.quaternion.copy(endpoint_handle_right_1_32.quaternion);
  }
  mesh_handle_right_1_32.castShadow = options.castShadow ?? true;
  mesh_handle_right_1_32.receiveShadow = options.receiveShadow ?? true;
  mesh_handle_right_1_32.userData.sculptComponent = {"id": "handle-right-1", "name": "handle-right-1", "level": "micro", "role": "rigid mechanical part", "importance": 1, "confidence": 0.86, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Separate rigid hardware has its own mechanical boundary.", "geometryDescriptor": {"normalStrategy": "smooth indexed normals", "uvStrategy": "procedural solid color", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.012, "segments": 2}, "deformationStack": [], "roadSurface": {"kind": "handle", "side": 1, "door": 1}}, "parent": "door-right-1", "attachment": {"parentSocket": "door-right-1-to-handle-right-1", "localStart": [0.017846998292952776, 0.04098542779684067, 0.7800000011920928], "localEnd": [0.017846998292952776, 0.04098542779684067, 0.7800000011920928], "contactType": "overlap", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.012, "parentId": "door-right-1"}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.85}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "rigid", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "handle-right-1-mount", "position": [0, 0, 0], "axis": [0, 1, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "door-right-1", "seamRefs": [], "detachableFragments": ["handle-right-1"], "breakImpulse": 12, "debrisMaterial": "hidden"}}, "material": "metal", "materialLayers": ["metal"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {}, "evidenceRefs": ["canonical", "profile", "rear"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(179, 191, 197, 1)", "secondaryAlbedo": "rgba(179, 191, 197, 1)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRefs": ["full-object"], "componentId": "handle-right-1"}};
  node_handle_right_1_32.add(mesh_handle_right_1_32);
  meshes["handle-right-1"] = mesh_handle_right_1_32;
  colliders["handle-right-1"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["door-right-1"] ??= [];
  destructionGroups["door-right-1"].push(node_handle_right_1_32);
  const socket_handle_right_1_handle_right_1_mount_0 = new THREE.Object3D();
  socket_handle_right_1_handle_right_1_mount_0.name = "handle-right-1-mount";
  socket_handle_right_1_handle_right_1_mount_0.position.set(0.0, 0.0, 0.0);
  socket_handle_right_1_handle_right_1_mount_0.rotation.set(0, 0, 0);
  socket_handle_right_1_handle_right_1_mount_0.userData.socket = {"id": "handle-right-1-mount", "position": [0, 0, 0], "axis": [0, 1, 0]};
  node_handle_right_1_32.add(socket_handle_right_1_handle_right_1_mount_0);
  sockets["handle-right-1:handle-right-1-mount"] = socket_handle_right_1_handle_right_1_mount_0;

  const endpoint_quarter_right_33 = makeAttachmentEndpoint(null);
  const node_quarter_right_33 = new THREE.Group();
  node_quarter_right_33.name = "quarter-right__pivot";
  node_quarter_right_33.scale.set(1, 1, 1);
  if (endpoint_quarter_right_33) {
    node_quarter_right_33.position.copy(endpoint_quarter_right_33.start);
    node_quarter_right_33.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_quarter_right_33.position.set(0.0, 0.0, 0.0);
    node_quarter_right_33.rotation.set(0.0, 0.0, 0.0);
  }
  node_quarter_right_33.userData.sculptComponent = {"id": "quarter-right", "name": "quarter-right", "level": "meso", "role": "rigid mechanical part", "importance": 1, "confidence": 0.86, "primitive": "plane-card", "topologyClass": "conforming-shell", "topologyRationale": "Conforming analytic automotive skin follows continuous section profile.", "geometryDescriptor": {"normalStrategy": "smooth indexed normals", "uvStrategy": "procedural solid color", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.012, "segments": 2}, "deformationStack": [], "roadSurface": {"kind": "glass", "side": 1, "quarter": true}}, "parent": "root", "attachment": {"parentSocket": "root-to-quarter-right", "localStart": [0.8117795288562775, 1.0824353694915771, 1.030173122882843], "localEnd": [0.8117795288562775, 1.0824353694915771, 1.030173122882843], "contactType": "overlap", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.012, "parentId": "root"}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.85}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "rigid", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "quarter-right-mount", "position": [0, 0, 0], "axis": [0, 1, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "quarter-right", "seamRefs": [], "detachableFragments": ["quarter-right"], "breakImpulse": 12, "debrisMaterial": "hidden"}}, "material": "glass", "materialLayers": ["glass"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {}, "evidenceRefs": ["canonical", "profile", "rear"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(172, 203, 212, 1)", "secondaryAlbedo": "rgba(172, 203, 212, 1)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRefs": ["full-object"], "componentId": "quarter-right"}};
  node_quarter_right_33.userData.actionProfile = {"animationRole": "rigid", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "quarter-right-mount", "position": [0, 0, 0], "axis": [0, 1, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "quarter-right", "seamRefs": [], "detachableFragments": ["quarter-right"], "breakImpulse": 12, "debrisMaterial": "hidden"}};
  (nodes["root"] ?? root).add(node_quarter_right_33);
  nodes["quarter-right"] = node_quarter_right_33;
  const mesh_quarter_right_33Geometry = endpoint_quarter_right_33
    ? new THREE.CylinderGeometry(endpoint_quarter_right_33.endRadius, endpoint_quarter_right_33.baseRadius, endpoint_quarter_right_33.length, 16, 6)
    : new THREE.PlaneGeometry(1, 1, 12, 12);
  if (!endpoint_quarter_right_33) {
    mesh_quarter_right_33Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_quarter_right_33 = new THREE.Mesh(
    mesh_quarter_right_33Geometry,
    materialMap["glass"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_quarter_right_33.name = "quarter-right";
  if (endpoint_quarter_right_33) {
    mesh_quarter_right_33.position.copy(endpoint_quarter_right_33.midpoint);
    mesh_quarter_right_33.quaternion.copy(endpoint_quarter_right_33.quaternion);
  }
  mesh_quarter_right_33.castShadow = options.castShadow ?? true;
  mesh_quarter_right_33.receiveShadow = options.receiveShadow ?? true;
  mesh_quarter_right_33.userData.sculptComponent = {"id": "quarter-right", "name": "quarter-right", "level": "meso", "role": "rigid mechanical part", "importance": 1, "confidence": 0.86, "primitive": "plane-card", "topologyClass": "conforming-shell", "topologyRationale": "Conforming analytic automotive skin follows continuous section profile.", "geometryDescriptor": {"normalStrategy": "smooth indexed normals", "uvStrategy": "procedural solid color", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.012, "segments": 2}, "deformationStack": [], "roadSurface": {"kind": "glass", "side": 1, "quarter": true}}, "parent": "root", "attachment": {"parentSocket": "root-to-quarter-right", "localStart": [0.8117795288562775, 1.0824353694915771, 1.030173122882843], "localEnd": [0.8117795288562775, 1.0824353694915771, 1.030173122882843], "contactType": "overlap", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.012, "parentId": "root"}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.85}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "rigid", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "quarter-right-mount", "position": [0, 0, 0], "axis": [0, 1, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "quarter-right", "seamRefs": [], "detachableFragments": ["quarter-right"], "breakImpulse": 12, "debrisMaterial": "hidden"}}, "material": "glass", "materialLayers": ["glass"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {}, "evidenceRefs": ["canonical", "profile", "rear"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(172, 203, 212, 1)", "secondaryAlbedo": "rgba(172, 203, 212, 1)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRefs": ["full-object"], "componentId": "quarter-right"}};
  node_quarter_right_33.add(mesh_quarter_right_33);
  meshes["quarter-right"] = mesh_quarter_right_33;
  colliders["quarter-right"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["quarter-right"] ??= [];
  destructionGroups["quarter-right"].push(node_quarter_right_33);
  const socket_quarter_right_quarter_right_mount_0 = new THREE.Object3D();
  socket_quarter_right_quarter_right_mount_0.name = "quarter-right-mount";
  socket_quarter_right_quarter_right_mount_0.position.set(0.0, 0.0, 0.0);
  socket_quarter_right_quarter_right_mount_0.rotation.set(0, 0, 0);
  socket_quarter_right_quarter_right_mount_0.userData.socket = {"id": "quarter-right-mount", "position": [0, 0, 0], "axis": [0, 1, 0]};
  node_quarter_right_33.add(socket_quarter_right_quarter_right_mount_0);
  sockets["quarter-right:quarter-right-mount"] = socket_quarter_right_quarter_right_mount_0;

  const endpoint_mirror_right_34 = makeAttachmentEndpoint(null);
  const node_mirror_right_34 = new THREE.Group();
  node_mirror_right_34.name = "mirror-right__pivot";
  node_mirror_right_34.scale.set(1, 1, 1);
  if (endpoint_mirror_right_34) {
    node_mirror_right_34.position.copy(endpoint_mirror_right_34.start);
    node_mirror_right_34.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_mirror_right_34.position.set(0.0, 0.0, 0.0);
    node_mirror_right_34.rotation.set(0.0, 0.0, 0.0);
  }
  node_mirror_right_34.userData.sculptComponent = {"id": "mirror-right", "name": "mirror-right", "level": "meso", "role": "rigid mechanical part", "importance": 1, "confidence": 0.86, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Separate rigid hardware has its own mechanical boundary.", "geometryDescriptor": {"normalStrategy": "smooth indexed normals", "uvStrategy": "procedural solid color", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.012, "segments": 2}, "deformationStack": [], "roadSurface": {"kind": "mirror", "side": 1}}, "parent": "root", "attachment": {"parentSocket": "root-to-mirror-right", "localStart": [0.91, 0.93, -0.6], "localEnd": [0.9850000011175872, 0.93, -0.5965000003576278], "contactType": "hinge", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.012, "parentId": "root"}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.85}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "rigid", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "mirror-right-mount", "position": [0, 0, 0], "axis": [0, 1, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "mirror-right", "seamRefs": [], "detachableFragments": ["mirror-right"], "breakImpulse": 12, "debrisMaterial": "hidden"}}, "material": "paint", "materialLayers": ["paint"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {}, "evidenceRefs": ["canonical", "profile", "rear"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(199, 107, 33, 1)", "secondaryAlbedo": "rgba(199, 107, 33, 1)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRefs": ["full-object"], "componentId": "mirror-right"}};
  node_mirror_right_34.userData.actionProfile = {"animationRole": "rigid", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "mirror-right-mount", "position": [0, 0, 0], "axis": [0, 1, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "mirror-right", "seamRefs": [], "detachableFragments": ["mirror-right"], "breakImpulse": 12, "debrisMaterial": "hidden"}};
  (nodes["root"] ?? root).add(node_mirror_right_34);
  nodes["mirror-right"] = node_mirror_right_34;
  const mesh_mirror_right_34Geometry = endpoint_mirror_right_34
    ? new THREE.CylinderGeometry(endpoint_mirror_right_34.endRadius, endpoint_mirror_right_34.baseRadius, endpoint_mirror_right_34.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_mirror_right_34) {
    mesh_mirror_right_34Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_mirror_right_34 = new THREE.Mesh(
    mesh_mirror_right_34Geometry,
    materialMap["paint"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_mirror_right_34.name = "mirror-right";
  if (endpoint_mirror_right_34) {
    mesh_mirror_right_34.position.copy(endpoint_mirror_right_34.midpoint);
    mesh_mirror_right_34.quaternion.copy(endpoint_mirror_right_34.quaternion);
  }
  mesh_mirror_right_34.castShadow = options.castShadow ?? true;
  mesh_mirror_right_34.receiveShadow = options.receiveShadow ?? true;
  mesh_mirror_right_34.userData.sculptComponent = {"id": "mirror-right", "name": "mirror-right", "level": "meso", "role": "rigid mechanical part", "importance": 1, "confidence": 0.86, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Separate rigid hardware has its own mechanical boundary.", "geometryDescriptor": {"normalStrategy": "smooth indexed normals", "uvStrategy": "procedural solid color", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.012, "segments": 2}, "deformationStack": [], "roadSurface": {"kind": "mirror", "side": 1}}, "parent": "root", "attachment": {"parentSocket": "root-to-mirror-right", "localStart": [0.91, 0.93, -0.6], "localEnd": [0.9850000011175872, 0.93, -0.5965000003576278], "contactType": "hinge", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.012, "parentId": "root"}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.85}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "rigid", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "mirror-right-mount", "position": [0, 0, 0], "axis": [0, 1, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "mirror-right", "seamRefs": [], "detachableFragments": ["mirror-right"], "breakImpulse": 12, "debrisMaterial": "hidden"}}, "material": "paint", "materialLayers": ["paint"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {}, "evidenceRefs": ["canonical", "profile", "rear"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(199, 107, 33, 1)", "secondaryAlbedo": "rgba(199, 107, 33, 1)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRefs": ["full-object"], "componentId": "mirror-right"}};
  node_mirror_right_34.add(mesh_mirror_right_34);
  meshes["mirror-right"] = mesh_mirror_right_34;
  colliders["mirror-right"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["mirror-right"] ??= [];
  destructionGroups["mirror-right"].push(node_mirror_right_34);
  const socket_mirror_right_mirror_right_mount_0 = new THREE.Object3D();
  socket_mirror_right_mirror_right_mount_0.name = "mirror-right-mount";
  socket_mirror_right_mirror_right_mount_0.position.set(0.0, 0.0, 0.0);
  socket_mirror_right_mirror_right_mount_0.rotation.set(0, 0, 0);
  socket_mirror_right_mirror_right_mount_0.userData.socket = {"id": "mirror-right-mount", "position": [0, 0, 0], "axis": [0, 1, 0]};
  node_mirror_right_34.add(socket_mirror_right_mirror_right_mount_0);
  sockets["mirror-right:mirror-right-mount"] = socket_mirror_right_mirror_right_mount_0;

  const endpoint_wheel_right_front_35 = makeAttachmentEndpoint(null);
  const node_wheel_right_front_35 = new THREE.Group();
  node_wheel_right_front_35.name = "wheel-right-front__pivot";
  node_wheel_right_front_35.scale.set(1, 1, 1);
  if (endpoint_wheel_right_front_35) {
    node_wheel_right_front_35.position.copy(endpoint_wheel_right_front_35.start);
    node_wheel_right_front_35.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_wheel_right_front_35.position.set(0.0, 0.0, 0.0);
    node_wheel_right_front_35.rotation.set(0.0, 0.0, 0.0);
  }
  node_wheel_right_front_35.userData.sculptComponent = {"id": "wheel-right-front", "name": "wheel-right-front", "level": "macro", "role": "rigid mechanical part", "importance": 1, "confidence": 0.86, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Separate rigid hardware has its own mechanical boundary.", "geometryDescriptor": {"normalStrategy": "smooth indexed normals", "uvStrategy": "procedural solid color", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.012, "segments": 2}, "deformationStack": [], "roadSurface": {"kind": "wheel", "side": 1, "axle": "front"}}, "parent": "root", "attachment": {"parentSocket": "root-to-wheel-right-front", "localStart": [0.875, 0.365, -1.38], "localEnd": [0.875, 0.365, -1.38], "contactType": "hinge", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.012, "parentId": "root"}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.85}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "rigid", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "wheel-right-front-mount", "position": [0, 0, 0], "axis": [0, 1, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "wheel-right-front", "seamRefs": [], "detachableFragments": ["wheel-right-front"], "breakImpulse": 12, "debrisMaterial": "hidden"}}, "material": "rubber", "materialLayers": ["rubber"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {}, "evidenceRefs": ["canonical", "profile", "rear"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(36, 41, 44, 1)", "secondaryAlbedo": "rgba(36, 41, 44, 1)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRefs": ["full-object"], "componentId": "wheel-right-front"}};
  node_wheel_right_front_35.userData.actionProfile = {"animationRole": "rigid", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "wheel-right-front-mount", "position": [0, 0, 0], "axis": [0, 1, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "wheel-right-front", "seamRefs": [], "detachableFragments": ["wheel-right-front"], "breakImpulse": 12, "debrisMaterial": "hidden"}};
  (nodes["root"] ?? root).add(node_wheel_right_front_35);
  nodes["wheel-right-front"] = node_wheel_right_front_35;
  const mesh_wheel_right_front_35Geometry = endpoint_wheel_right_front_35
    ? new THREE.CylinderGeometry(endpoint_wheel_right_front_35.endRadius, endpoint_wheel_right_front_35.baseRadius, endpoint_wheel_right_front_35.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_wheel_right_front_35) {
    mesh_wheel_right_front_35Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_wheel_right_front_35 = new THREE.Mesh(
    mesh_wheel_right_front_35Geometry,
    materialMap["rubber"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_wheel_right_front_35.name = "wheel-right-front";
  if (endpoint_wheel_right_front_35) {
    mesh_wheel_right_front_35.position.copy(endpoint_wheel_right_front_35.midpoint);
    mesh_wheel_right_front_35.quaternion.copy(endpoint_wheel_right_front_35.quaternion);
  }
  mesh_wheel_right_front_35.castShadow = options.castShadow ?? true;
  mesh_wheel_right_front_35.receiveShadow = options.receiveShadow ?? true;
  mesh_wheel_right_front_35.userData.sculptComponent = {"id": "wheel-right-front", "name": "wheel-right-front", "level": "macro", "role": "rigid mechanical part", "importance": 1, "confidence": 0.86, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Separate rigid hardware has its own mechanical boundary.", "geometryDescriptor": {"normalStrategy": "smooth indexed normals", "uvStrategy": "procedural solid color", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.012, "segments": 2}, "deformationStack": [], "roadSurface": {"kind": "wheel", "side": 1, "axle": "front"}}, "parent": "root", "attachment": {"parentSocket": "root-to-wheel-right-front", "localStart": [0.875, 0.365, -1.38], "localEnd": [0.875, 0.365, -1.38], "contactType": "hinge", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.012, "parentId": "root"}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.85}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "rigid", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "wheel-right-front-mount", "position": [0, 0, 0], "axis": [0, 1, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "wheel-right-front", "seamRefs": [], "detachableFragments": ["wheel-right-front"], "breakImpulse": 12, "debrisMaterial": "hidden"}}, "material": "rubber", "materialLayers": ["rubber"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {}, "evidenceRefs": ["canonical", "profile", "rear"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(36, 41, 44, 1)", "secondaryAlbedo": "rgba(36, 41, 44, 1)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRefs": ["full-object"], "componentId": "wheel-right-front"}};
  node_wheel_right_front_35.add(mesh_wheel_right_front_35);
  meshes["wheel-right-front"] = mesh_wheel_right_front_35;
  colliders["wheel-right-front"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["wheel-right-front"] ??= [];
  destructionGroups["wheel-right-front"].push(node_wheel_right_front_35);
  const socket_wheel_right_front_wheel_right_front_mount_0 = new THREE.Object3D();
  socket_wheel_right_front_wheel_right_front_mount_0.name = "wheel-right-front-mount";
  socket_wheel_right_front_wheel_right_front_mount_0.position.set(0.0, 0.0, 0.0);
  socket_wheel_right_front_wheel_right_front_mount_0.rotation.set(0, 0, 0);
  socket_wheel_right_front_wheel_right_front_mount_0.userData.socket = {"id": "wheel-right-front-mount", "position": [0, 0, 0], "axis": [0, 1, 0]};
  node_wheel_right_front_35.add(socket_wheel_right_front_wheel_right_front_mount_0);
  sockets["wheel-right-front:wheel-right-front-mount"] = socket_wheel_right_front_wheel_right_front_mount_0;

  const endpoint_rim_right_front_36 = makeAttachmentEndpoint(null);
  const node_rim_right_front_36 = new THREE.Group();
  node_rim_right_front_36.name = "rim-right-front__pivot";
  node_rim_right_front_36.scale.set(1, 1, 1);
  if (endpoint_rim_right_front_36) {
    node_rim_right_front_36.position.copy(endpoint_rim_right_front_36.start);
    node_rim_right_front_36.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_rim_right_front_36.position.set(0.0, 0.0, 0.0);
    node_rim_right_front_36.rotation.set(0.0, 0.0, 0.0);
  }
  node_rim_right_front_36.userData.sculptComponent = {"id": "rim-right-front", "name": "rim-right-front", "level": "meso", "role": "rigid mechanical part", "importance": 1, "confidence": 0.86, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Separate rigid hardware has its own mechanical boundary.", "geometryDescriptor": {"normalStrategy": "smooth indexed normals", "uvStrategy": "procedural solid color", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.012, "segments": 2}, "deformationStack": [], "roadSurface": {"kind": "rim", "side": 1, "axle": "front"}}, "parent": "wheel-right-front", "attachment": {"parentSocket": "wheel-right-front-to-rim-right-front", "localStart": [0.003696151077747345, 0, 0], "localEnd": [0.003696151077747345, 0, 0], "contactType": "overlap", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.012, "parentId": "wheel-right-front"}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.85}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "rigid", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "rim-right-front-mount", "position": [0, 0, 0], "axis": [0, 1, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "wheel-right-front", "seamRefs": [], "detachableFragments": ["rim-right-front"], "breakImpulse": 12, "debrisMaterial": "hidden"}}, "material": "metal", "materialLayers": ["metal"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "five-spokes", "kind": "repetition", "description": "five-spokes", "evidenceRefs": ["canonical"]}], "surfaceDetail": {}, "evidenceRefs": ["canonical", "profile", "rear"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(179, 191, 197, 1)", "secondaryAlbedo": "rgba(179, 191, 197, 1)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRefs": ["full-object"], "componentId": "rim-right-front"}};
  node_rim_right_front_36.userData.actionProfile = {"animationRole": "rigid", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "rim-right-front-mount", "position": [0, 0, 0], "axis": [0, 1, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "wheel-right-front", "seamRefs": [], "detachableFragments": ["rim-right-front"], "breakImpulse": 12, "debrisMaterial": "hidden"}};
  (nodes["wheel-right-front"] ?? root).add(node_rim_right_front_36);
  nodes["rim-right-front"] = node_rim_right_front_36;
  const mesh_rim_right_front_36Geometry = endpoint_rim_right_front_36
    ? new THREE.CylinderGeometry(endpoint_rim_right_front_36.endRadius, endpoint_rim_right_front_36.baseRadius, endpoint_rim_right_front_36.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_rim_right_front_36) {
    mesh_rim_right_front_36Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_rim_right_front_36 = new THREE.Mesh(
    mesh_rim_right_front_36Geometry,
    materialMap["metal"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_rim_right_front_36.name = "rim-right-front";
  if (endpoint_rim_right_front_36) {
    mesh_rim_right_front_36.position.copy(endpoint_rim_right_front_36.midpoint);
    mesh_rim_right_front_36.quaternion.copy(endpoint_rim_right_front_36.quaternion);
  }
  mesh_rim_right_front_36.castShadow = options.castShadow ?? true;
  mesh_rim_right_front_36.receiveShadow = options.receiveShadow ?? true;
  mesh_rim_right_front_36.userData.sculptComponent = {"id": "rim-right-front", "name": "rim-right-front", "level": "meso", "role": "rigid mechanical part", "importance": 1, "confidence": 0.86, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Separate rigid hardware has its own mechanical boundary.", "geometryDescriptor": {"normalStrategy": "smooth indexed normals", "uvStrategy": "procedural solid color", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.012, "segments": 2}, "deformationStack": [], "roadSurface": {"kind": "rim", "side": 1, "axle": "front"}}, "parent": "wheel-right-front", "attachment": {"parentSocket": "wheel-right-front-to-rim-right-front", "localStart": [0.003696151077747345, 0, 0], "localEnd": [0.003696151077747345, 0, 0], "contactType": "overlap", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.012, "parentId": "wheel-right-front"}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.85}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "rigid", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "rim-right-front-mount", "position": [0, 0, 0], "axis": [0, 1, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "wheel-right-front", "seamRefs": [], "detachableFragments": ["rim-right-front"], "breakImpulse": 12, "debrisMaterial": "hidden"}}, "material": "metal", "materialLayers": ["metal"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "five-spokes", "kind": "repetition", "description": "five-spokes", "evidenceRefs": ["canonical"]}], "surfaceDetail": {}, "evidenceRefs": ["canonical", "profile", "rear"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(179, 191, 197, 1)", "secondaryAlbedo": "rgba(179, 191, 197, 1)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRefs": ["full-object"], "componentId": "rim-right-front"}};
  node_rim_right_front_36.add(mesh_rim_right_front_36);
  meshes["rim-right-front"] = mesh_rim_right_front_36;
  colliders["rim-right-front"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["wheel-right-front"] ??= [];
  destructionGroups["wheel-right-front"].push(node_rim_right_front_36);
  const socket_rim_right_front_rim_right_front_mount_0 = new THREE.Object3D();
  socket_rim_right_front_rim_right_front_mount_0.name = "rim-right-front-mount";
  socket_rim_right_front_rim_right_front_mount_0.position.set(0.0, 0.0, 0.0);
  socket_rim_right_front_rim_right_front_mount_0.rotation.set(0, 0, 0);
  socket_rim_right_front_rim_right_front_mount_0.userData.socket = {"id": "rim-right-front-mount", "position": [0, 0, 0], "axis": [0, 1, 0]};
  node_rim_right_front_36.add(socket_rim_right_front_rim_right_front_mount_0);
  sockets["rim-right-front:rim-right-front-mount"] = socket_rim_right_front_rim_right_front_mount_0;

  const endpoint_wheel_right_rear_37 = makeAttachmentEndpoint(null);
  const node_wheel_right_rear_37 = new THREE.Group();
  node_wheel_right_rear_37.name = "wheel-right-rear__pivot";
  node_wheel_right_rear_37.scale.set(1, 1, 1);
  if (endpoint_wheel_right_rear_37) {
    node_wheel_right_rear_37.position.copy(endpoint_wheel_right_rear_37.start);
    node_wheel_right_rear_37.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_wheel_right_rear_37.position.set(0.0, 0.0, 0.0);
    node_wheel_right_rear_37.rotation.set(0.0, 0.0, 0.0);
  }
  node_wheel_right_rear_37.userData.sculptComponent = {"id": "wheel-right-rear", "name": "wheel-right-rear", "level": "macro", "role": "rigid mechanical part", "importance": 1, "confidence": 0.86, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Separate rigid hardware has its own mechanical boundary.", "geometryDescriptor": {"normalStrategy": "smooth indexed normals", "uvStrategy": "procedural solid color", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.012, "segments": 2}, "deformationStack": [], "roadSurface": {"kind": "wheel", "side": 1, "axle": "rear"}}, "parent": "root", "attachment": {"parentSocket": "root-to-wheel-right-rear", "localStart": [0.875, 0.365, 1.37], "localEnd": [0.875, 0.365, 1.37], "contactType": "hinge", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.012, "parentId": "root"}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.85}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "rigid", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "wheel-right-rear-mount", "position": [0, 0, 0], "axis": [0, 1, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "wheel-right-rear", "seamRefs": [], "detachableFragments": ["wheel-right-rear"], "breakImpulse": 12, "debrisMaterial": "hidden"}}, "material": "rubber", "materialLayers": ["rubber"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {}, "evidenceRefs": ["canonical", "profile", "rear"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(36, 41, 44, 1)", "secondaryAlbedo": "rgba(36, 41, 44, 1)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRefs": ["full-object"], "componentId": "wheel-right-rear"}};
  node_wheel_right_rear_37.userData.actionProfile = {"animationRole": "rigid", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "wheel-right-rear-mount", "position": [0, 0, 0], "axis": [0, 1, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "wheel-right-rear", "seamRefs": [], "detachableFragments": ["wheel-right-rear"], "breakImpulse": 12, "debrisMaterial": "hidden"}};
  (nodes["root"] ?? root).add(node_wheel_right_rear_37);
  nodes["wheel-right-rear"] = node_wheel_right_rear_37;
  const mesh_wheel_right_rear_37Geometry = endpoint_wheel_right_rear_37
    ? new THREE.CylinderGeometry(endpoint_wheel_right_rear_37.endRadius, endpoint_wheel_right_rear_37.baseRadius, endpoint_wheel_right_rear_37.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_wheel_right_rear_37) {
    mesh_wheel_right_rear_37Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_wheel_right_rear_37 = new THREE.Mesh(
    mesh_wheel_right_rear_37Geometry,
    materialMap["rubber"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_wheel_right_rear_37.name = "wheel-right-rear";
  if (endpoint_wheel_right_rear_37) {
    mesh_wheel_right_rear_37.position.copy(endpoint_wheel_right_rear_37.midpoint);
    mesh_wheel_right_rear_37.quaternion.copy(endpoint_wheel_right_rear_37.quaternion);
  }
  mesh_wheel_right_rear_37.castShadow = options.castShadow ?? true;
  mesh_wheel_right_rear_37.receiveShadow = options.receiveShadow ?? true;
  mesh_wheel_right_rear_37.userData.sculptComponent = {"id": "wheel-right-rear", "name": "wheel-right-rear", "level": "macro", "role": "rigid mechanical part", "importance": 1, "confidence": 0.86, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Separate rigid hardware has its own mechanical boundary.", "geometryDescriptor": {"normalStrategy": "smooth indexed normals", "uvStrategy": "procedural solid color", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.012, "segments": 2}, "deformationStack": [], "roadSurface": {"kind": "wheel", "side": 1, "axle": "rear"}}, "parent": "root", "attachment": {"parentSocket": "root-to-wheel-right-rear", "localStart": [0.875, 0.365, 1.37], "localEnd": [0.875, 0.365, 1.37], "contactType": "hinge", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.012, "parentId": "root"}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.85}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "rigid", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "wheel-right-rear-mount", "position": [0, 0, 0], "axis": [0, 1, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "wheel-right-rear", "seamRefs": [], "detachableFragments": ["wheel-right-rear"], "breakImpulse": 12, "debrisMaterial": "hidden"}}, "material": "rubber", "materialLayers": ["rubber"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {}, "evidenceRefs": ["canonical", "profile", "rear"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(36, 41, 44, 1)", "secondaryAlbedo": "rgba(36, 41, 44, 1)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRefs": ["full-object"], "componentId": "wheel-right-rear"}};
  node_wheel_right_rear_37.add(mesh_wheel_right_rear_37);
  meshes["wheel-right-rear"] = mesh_wheel_right_rear_37;
  colliders["wheel-right-rear"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["wheel-right-rear"] ??= [];
  destructionGroups["wheel-right-rear"].push(node_wheel_right_rear_37);
  const socket_wheel_right_rear_wheel_right_rear_mount_0 = new THREE.Object3D();
  socket_wheel_right_rear_wheel_right_rear_mount_0.name = "wheel-right-rear-mount";
  socket_wheel_right_rear_wheel_right_rear_mount_0.position.set(0.0, 0.0, 0.0);
  socket_wheel_right_rear_wheel_right_rear_mount_0.rotation.set(0, 0, 0);
  socket_wheel_right_rear_wheel_right_rear_mount_0.userData.socket = {"id": "wheel-right-rear-mount", "position": [0, 0, 0], "axis": [0, 1, 0]};
  node_wheel_right_rear_37.add(socket_wheel_right_rear_wheel_right_rear_mount_0);
  sockets["wheel-right-rear:wheel-right-rear-mount"] = socket_wheel_right_rear_wheel_right_rear_mount_0;

  const endpoint_rim_right_rear_38 = makeAttachmentEndpoint(null);
  const node_rim_right_rear_38 = new THREE.Group();
  node_rim_right_rear_38.name = "rim-right-rear__pivot";
  node_rim_right_rear_38.scale.set(1, 1, 1);
  if (endpoint_rim_right_rear_38) {
    node_rim_right_rear_38.position.copy(endpoint_rim_right_rear_38.start);
    node_rim_right_rear_38.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_rim_right_rear_38.position.set(0.0, 0.0, 0.0);
    node_rim_right_rear_38.rotation.set(0.0, 0.0, 0.0);
  }
  node_rim_right_rear_38.userData.sculptComponent = {"id": "rim-right-rear", "name": "rim-right-rear", "level": "meso", "role": "rigid mechanical part", "importance": 1, "confidence": 0.86, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Separate rigid hardware has its own mechanical boundary.", "geometryDescriptor": {"normalStrategy": "smooth indexed normals", "uvStrategy": "procedural solid color", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.012, "segments": 2}, "deformationStack": [], "roadSurface": {"kind": "rim", "side": 1, "axle": "rear"}}, "parent": "wheel-right-rear", "attachment": {"parentSocket": "wheel-right-rear-to-rim-right-rear", "localStart": [0.003696151077747345, 0, 0], "localEnd": [0.003696151077747345, 0, 0], "contactType": "overlap", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.012, "parentId": "wheel-right-rear"}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.85}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "rigid", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "rim-right-rear-mount", "position": [0, 0, 0], "axis": [0, 1, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "wheel-right-rear", "seamRefs": [], "detachableFragments": ["rim-right-rear"], "breakImpulse": 12, "debrisMaterial": "hidden"}}, "material": "metal", "materialLayers": ["metal"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {}, "evidenceRefs": ["canonical", "profile", "rear"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(179, 191, 197, 1)", "secondaryAlbedo": "rgba(179, 191, 197, 1)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRefs": ["full-object"], "componentId": "rim-right-rear"}};
  node_rim_right_rear_38.userData.actionProfile = {"animationRole": "rigid", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "rim-right-rear-mount", "position": [0, 0, 0], "axis": [0, 1, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "wheel-right-rear", "seamRefs": [], "detachableFragments": ["rim-right-rear"], "breakImpulse": 12, "debrisMaterial": "hidden"}};
  (nodes["wheel-right-rear"] ?? root).add(node_rim_right_rear_38);
  nodes["rim-right-rear"] = node_rim_right_rear_38;
  const mesh_rim_right_rear_38Geometry = endpoint_rim_right_rear_38
    ? new THREE.CylinderGeometry(endpoint_rim_right_rear_38.endRadius, endpoint_rim_right_rear_38.baseRadius, endpoint_rim_right_rear_38.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_rim_right_rear_38) {
    mesh_rim_right_rear_38Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_rim_right_rear_38 = new THREE.Mesh(
    mesh_rim_right_rear_38Geometry,
    materialMap["metal"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_rim_right_rear_38.name = "rim-right-rear";
  if (endpoint_rim_right_rear_38) {
    mesh_rim_right_rear_38.position.copy(endpoint_rim_right_rear_38.midpoint);
    mesh_rim_right_rear_38.quaternion.copy(endpoint_rim_right_rear_38.quaternion);
  }
  mesh_rim_right_rear_38.castShadow = options.castShadow ?? true;
  mesh_rim_right_rear_38.receiveShadow = options.receiveShadow ?? true;
  mesh_rim_right_rear_38.userData.sculptComponent = {"id": "rim-right-rear", "name": "rim-right-rear", "level": "meso", "role": "rigid mechanical part", "importance": 1, "confidence": 0.86, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Separate rigid hardware has its own mechanical boundary.", "geometryDescriptor": {"normalStrategy": "smooth indexed normals", "uvStrategy": "procedural solid color", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.012, "segments": 2}, "deformationStack": [], "roadSurface": {"kind": "rim", "side": 1, "axle": "rear"}}, "parent": "wheel-right-rear", "attachment": {"parentSocket": "wheel-right-rear-to-rim-right-rear", "localStart": [0.003696151077747345, 0, 0], "localEnd": [0.003696151077747345, 0, 0], "contactType": "overlap", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.012, "parentId": "wheel-right-rear"}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.85}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "rigid", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "rim-right-rear-mount", "position": [0, 0, 0], "axis": [0, 1, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "wheel-right-rear", "seamRefs": [], "detachableFragments": ["rim-right-rear"], "breakImpulse": 12, "debrisMaterial": "hidden"}}, "material": "metal", "materialLayers": ["metal"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {}, "evidenceRefs": ["canonical", "profile", "rear"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(179, 191, 197, 1)", "secondaryAlbedo": "rgba(179, 191, 197, 1)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRefs": ["full-object"], "componentId": "rim-right-rear"}};
  node_rim_right_rear_38.add(mesh_rim_right_rear_38);
  meshes["rim-right-rear"] = mesh_rim_right_rear_38;
  colliders["rim-right-rear"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["wheel-right-rear"] ??= [];
  destructionGroups["wheel-right-rear"].push(node_rim_right_rear_38);
  const socket_rim_right_rear_rim_right_rear_mount_0 = new THREE.Object3D();
  socket_rim_right_rear_rim_right_rear_mount_0.name = "rim-right-rear-mount";
  socket_rim_right_rear_rim_right_rear_mount_0.position.set(0.0, 0.0, 0.0);
  socket_rim_right_rear_rim_right_rear_mount_0.rotation.set(0, 0, 0);
  socket_rim_right_rear_rim_right_rear_mount_0.userData.socket = {"id": "rim-right-rear-mount", "position": [0, 0, 0], "axis": [0, 1, 0]};
  node_rim_right_rear_38.add(socket_rim_right_rear_rim_right_rear_mount_0);
  sockets["rim-right-rear:rim-right-rear-mount"] = socket_rim_right_rear_rim_right_rear_mount_0;

  const endpoint_windshield_39 = makeAttachmentEndpoint(null);
  const node_windshield_39 = new THREE.Group();
  node_windshield_39.name = "windshield__pivot";
  node_windshield_39.scale.set(1, 1, 1);
  if (endpoint_windshield_39) {
    node_windshield_39.position.copy(endpoint_windshield_39.start);
    node_windshield_39.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_windshield_39.position.set(0.0, 0.0, 0.0);
    node_windshield_39.rotation.set(0.0, 0.0, 0.0);
  }
  node_windshield_39.userData.sculptComponent = {"id": "windshield", "name": "windshield", "level": "meso", "role": "rigid mechanical part", "importance": 1, "confidence": 0.86, "primitive": "plane-card", "topologyClass": "conforming-shell", "topologyRationale": "Conforming analytic automotive skin follows continuous section profile.", "geometryDescriptor": {"normalStrategy": "smooth indexed normals", "uvStrategy": "procedural solid color", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.012, "segments": 2}, "deformationStack": [], "roadSurface": {"kind": "glass", "front": true}}, "parent": "root", "attachment": {"parentSocket": "root-to-windshield", "localStart": [0, 1.1123893558979034, -0.6299999952316284], "localEnd": [0, 1.1123893558979034, -0.6299999952316284], "contactType": "overlap", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.012, "parentId": "root"}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.85}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "rigid", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "windshield-mount", "position": [0, 0, 0], "axis": [0, 1, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "windshield", "seamRefs": [], "detachableFragments": ["windshield"], "breakImpulse": 12, "debrisMaterial": "hidden"}}, "material": "glass", "materialLayers": ["glass"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "fitted-panes", "kind": "contour", "description": "fitted-panes", "evidenceRefs": ["canonical"]}], "surfaceDetail": {}, "evidenceRefs": ["canonical", "profile", "rear"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(172, 203, 212, 1)", "secondaryAlbedo": "rgba(172, 203, 212, 1)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRefs": ["full-object"], "componentId": "windshield"}};
  node_windshield_39.userData.actionProfile = {"animationRole": "rigid", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "windshield-mount", "position": [0, 0, 0], "axis": [0, 1, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "windshield", "seamRefs": [], "detachableFragments": ["windshield"], "breakImpulse": 12, "debrisMaterial": "hidden"}};
  (nodes["root"] ?? root).add(node_windshield_39);
  nodes["windshield"] = node_windshield_39;
  const mesh_windshield_39Geometry = endpoint_windshield_39
    ? new THREE.CylinderGeometry(endpoint_windshield_39.endRadius, endpoint_windshield_39.baseRadius, endpoint_windshield_39.length, 16, 6)
    : new THREE.PlaneGeometry(1, 1, 12, 12);
  if (!endpoint_windshield_39) {
    mesh_windshield_39Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_windshield_39 = new THREE.Mesh(
    mesh_windshield_39Geometry,
    materialMap["glass"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_windshield_39.name = "windshield";
  if (endpoint_windshield_39) {
    mesh_windshield_39.position.copy(endpoint_windshield_39.midpoint);
    mesh_windshield_39.quaternion.copy(endpoint_windshield_39.quaternion);
  }
  mesh_windshield_39.castShadow = options.castShadow ?? true;
  mesh_windshield_39.receiveShadow = options.receiveShadow ?? true;
  mesh_windshield_39.userData.sculptComponent = {"id": "windshield", "name": "windshield", "level": "meso", "role": "rigid mechanical part", "importance": 1, "confidence": 0.86, "primitive": "plane-card", "topologyClass": "conforming-shell", "topologyRationale": "Conforming analytic automotive skin follows continuous section profile.", "geometryDescriptor": {"normalStrategy": "smooth indexed normals", "uvStrategy": "procedural solid color", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.012, "segments": 2}, "deformationStack": [], "roadSurface": {"kind": "glass", "front": true}}, "parent": "root", "attachment": {"parentSocket": "root-to-windshield", "localStart": [0, 1.1123893558979034, -0.6299999952316284], "localEnd": [0, 1.1123893558979034, -0.6299999952316284], "contactType": "overlap", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.012, "parentId": "root"}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.85}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "rigid", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "windshield-mount", "position": [0, 0, 0], "axis": [0, 1, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "windshield", "seamRefs": [], "detachableFragments": ["windshield"], "breakImpulse": 12, "debrisMaterial": "hidden"}}, "material": "glass", "materialLayers": ["glass"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "fitted-panes", "kind": "contour", "description": "fitted-panes", "evidenceRefs": ["canonical"]}], "surfaceDetail": {}, "evidenceRefs": ["canonical", "profile", "rear"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(172, 203, 212, 1)", "secondaryAlbedo": "rgba(172, 203, 212, 1)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRefs": ["full-object"], "componentId": "windshield"}};
  node_windshield_39.add(mesh_windshield_39);
  meshes["windshield"] = mesh_windshield_39;
  colliders["windshield"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["windshield"] ??= [];
  destructionGroups["windshield"].push(node_windshield_39);
  const socket_windshield_windshield_mount_0 = new THREE.Object3D();
  socket_windshield_windshield_mount_0.name = "windshield-mount";
  socket_windshield_windshield_mount_0.position.set(0.0, 0.0, 0.0);
  socket_windshield_windshield_mount_0.rotation.set(0, 0, 0);
  socket_windshield_windshield_mount_0.userData.socket = {"id": "windshield-mount", "position": [0, 0, 0], "axis": [0, 1, 0]};
  node_windshield_39.add(socket_windshield_windshield_mount_0);
  sockets["windshield:windshield-mount"] = socket_windshield_windshield_mount_0;

  const endpoint_rear_window_40 = makeAttachmentEndpoint(null);
  const node_rear_window_40 = new THREE.Group();
  node_rear_window_40.name = "rear-window__pivot";
  node_rear_window_40.scale.set(1, 1, 1);
  if (endpoint_rear_window_40) {
    node_rear_window_40.position.copy(endpoint_rear_window_40.start);
    node_rear_window_40.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_rear_window_40.position.set(0.0, 0.0, 0.0);
    node_rear_window_40.rotation.set(0.0, 0.0, 0.0);
  }
  node_rear_window_40.userData.sculptComponent = {"id": "rear-window", "name": "rear-window", "level": "meso", "role": "rigid mechanical part", "importance": 1, "confidence": 0.86, "primitive": "plane-card", "topologyClass": "conforming-shell", "topologyRationale": "Conforming analytic automotive skin follows continuous section profile.", "geometryDescriptor": {"normalStrategy": "smooth indexed normals", "uvStrategy": "procedural solid color", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.012, "segments": 2}, "deformationStack": [], "roadSurface": {"kind": "glass", "rear": true}}, "parent": "root", "attachment": {"parentSocket": "root-to-rear-window", "localStart": [0, 1.110107272863388, 1.1650000214576721], "localEnd": [0, 1.110107272863388, 1.1650000214576721], "contactType": "overlap", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.012, "parentId": "root"}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.85}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "rigid", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "rear-window-mount", "position": [0, 0, 0], "axis": [0, 1, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "rear-window", "seamRefs": [], "detachableFragments": ["rear-window"], "breakImpulse": 12, "debrisMaterial": "hidden"}}, "material": "glass", "materialLayers": ["glass"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {}, "evidenceRefs": ["canonical", "profile", "rear"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(172, 203, 212, 1)", "secondaryAlbedo": "rgba(172, 203, 212, 1)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRefs": ["full-object"], "componentId": "rear-window"}};
  node_rear_window_40.userData.actionProfile = {"animationRole": "rigid", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "rear-window-mount", "position": [0, 0, 0], "axis": [0, 1, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "rear-window", "seamRefs": [], "detachableFragments": ["rear-window"], "breakImpulse": 12, "debrisMaterial": "hidden"}};
  (nodes["root"] ?? root).add(node_rear_window_40);
  nodes["rear-window"] = node_rear_window_40;
  const mesh_rear_window_40Geometry = endpoint_rear_window_40
    ? new THREE.CylinderGeometry(endpoint_rear_window_40.endRadius, endpoint_rear_window_40.baseRadius, endpoint_rear_window_40.length, 16, 6)
    : new THREE.PlaneGeometry(1, 1, 12, 12);
  if (!endpoint_rear_window_40) {
    mesh_rear_window_40Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_rear_window_40 = new THREE.Mesh(
    mesh_rear_window_40Geometry,
    materialMap["glass"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_rear_window_40.name = "rear-window";
  if (endpoint_rear_window_40) {
    mesh_rear_window_40.position.copy(endpoint_rear_window_40.midpoint);
    mesh_rear_window_40.quaternion.copy(endpoint_rear_window_40.quaternion);
  }
  mesh_rear_window_40.castShadow = options.castShadow ?? true;
  mesh_rear_window_40.receiveShadow = options.receiveShadow ?? true;
  mesh_rear_window_40.userData.sculptComponent = {"id": "rear-window", "name": "rear-window", "level": "meso", "role": "rigid mechanical part", "importance": 1, "confidence": 0.86, "primitive": "plane-card", "topologyClass": "conforming-shell", "topologyRationale": "Conforming analytic automotive skin follows continuous section profile.", "geometryDescriptor": {"normalStrategy": "smooth indexed normals", "uvStrategy": "procedural solid color", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.012, "segments": 2}, "deformationStack": [], "roadSurface": {"kind": "glass", "rear": true}}, "parent": "root", "attachment": {"parentSocket": "root-to-rear-window", "localStart": [0, 1.110107272863388, 1.1650000214576721], "localEnd": [0, 1.110107272863388, 1.1650000214576721], "contactType": "overlap", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.012, "parentId": "root"}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.85}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "rigid", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "rear-window-mount", "position": [0, 0, 0], "axis": [0, 1, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "rear-window", "seamRefs": [], "detachableFragments": ["rear-window"], "breakImpulse": 12, "debrisMaterial": "hidden"}}, "material": "glass", "materialLayers": ["glass"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {}, "evidenceRefs": ["canonical", "profile", "rear"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(172, 203, 212, 1)", "secondaryAlbedo": "rgba(172, 203, 212, 1)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRefs": ["full-object"], "componentId": "rear-window"}};
  node_rear_window_40.add(mesh_rear_window_40);
  meshes["rear-window"] = mesh_rear_window_40;
  colliders["rear-window"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["rear-window"] ??= [];
  destructionGroups["rear-window"].push(node_rear_window_40);
  const socket_rear_window_rear_window_mount_0 = new THREE.Object3D();
  socket_rear_window_rear_window_mount_0.name = "rear-window-mount";
  socket_rear_window_rear_window_mount_0.position.set(0.0, 0.0, 0.0);
  socket_rear_window_rear_window_mount_0.rotation.set(0, 0, 0);
  socket_rear_window_rear_window_mount_0.userData.socket = {"id": "rear-window-mount", "position": [0, 0, 0], "axis": [0, 1, 0]};
  node_rear_window_40.add(socket_rear_window_rear_window_mount_0);
  sockets["rear-window:rear-window-mount"] = socket_rear_window_rear_window_mount_0;

  const endpoint_engine_bay_41 = makeAttachmentEndpoint(null);
  const node_engine_bay_41 = new THREE.Group();
  node_engine_bay_41.name = "engine-bay__pivot";
  node_engine_bay_41.scale.set(1, 1, 1);
  if (endpoint_engine_bay_41) {
    node_engine_bay_41.position.copy(endpoint_engine_bay_41.start);
    node_engine_bay_41.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_engine_bay_41.position.set(0.0, 0.0, 0.0);
    node_engine_bay_41.rotation.set(0.0, 0.0, 0.0);
  }
  node_engine_bay_41.userData.sculptComponent = {"id": "engine-bay", "name": "engine-bay", "level": "meso", "role": "rigid mechanical part", "importance": 1, "confidence": 0.86, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Separate rigid hardware has its own mechanical boundary.", "geometryDescriptor": {"normalStrategy": "smooth indexed normals", "uvStrategy": "procedural solid color", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.012, "segments": 2}, "deformationStack": [], "roadSurface": {"kind": "interior"}}, "parent": "root", "attachment": {"parentSocket": "root-to-engine-bay", "localStart": [0, 0.5200000032782555, -1.3874999582767487], "localEnd": [0, 0.5200000032782555, -1.3874999582767487], "contactType": "overlap", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.012, "parentId": "root"}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.85}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "rigid", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "engine-bay-mount", "position": [0, 0, 0], "axis": [0, 1, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "engine-bay", "seamRefs": [], "detachableFragments": ["engine-bay"], "breakImpulse": 12, "debrisMaterial": "hidden"}}, "material": "dark", "materialLayers": ["dark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {}, "evidenceRefs": ["canonical", "profile", "rear"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(41, 52, 59, 1)", "secondaryAlbedo": "rgba(41, 52, 59, 1)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRefs": ["full-object"], "componentId": "engine-bay"}};
  node_engine_bay_41.userData.actionProfile = {"animationRole": "rigid", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "engine-bay-mount", "position": [0, 0, 0], "axis": [0, 1, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "engine-bay", "seamRefs": [], "detachableFragments": ["engine-bay"], "breakImpulse": 12, "debrisMaterial": "hidden"}};
  (nodes["root"] ?? root).add(node_engine_bay_41);
  nodes["engine-bay"] = node_engine_bay_41;
  const mesh_engine_bay_41Geometry = endpoint_engine_bay_41
    ? new THREE.CylinderGeometry(endpoint_engine_bay_41.endRadius, endpoint_engine_bay_41.baseRadius, endpoint_engine_bay_41.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_engine_bay_41) {
    mesh_engine_bay_41Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_engine_bay_41 = new THREE.Mesh(
    mesh_engine_bay_41Geometry,
    materialMap["dark"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_engine_bay_41.name = "engine-bay";
  if (endpoint_engine_bay_41) {
    mesh_engine_bay_41.position.copy(endpoint_engine_bay_41.midpoint);
    mesh_engine_bay_41.quaternion.copy(endpoint_engine_bay_41.quaternion);
  }
  mesh_engine_bay_41.castShadow = options.castShadow ?? true;
  mesh_engine_bay_41.receiveShadow = options.receiveShadow ?? true;
  mesh_engine_bay_41.userData.sculptComponent = {"id": "engine-bay", "name": "engine-bay", "level": "meso", "role": "rigid mechanical part", "importance": 1, "confidence": 0.86, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Separate rigid hardware has its own mechanical boundary.", "geometryDescriptor": {"normalStrategy": "smooth indexed normals", "uvStrategy": "procedural solid color", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.012, "segments": 2}, "deformationStack": [], "roadSurface": {"kind": "interior"}}, "parent": "root", "attachment": {"parentSocket": "root-to-engine-bay", "localStart": [0, 0.5200000032782555, -1.3874999582767487], "localEnd": [0, 0.5200000032782555, -1.3874999582767487], "contactType": "overlap", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.012, "parentId": "root"}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.85}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "rigid", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "engine-bay-mount", "position": [0, 0, 0], "axis": [0, 1, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "engine-bay", "seamRefs": [], "detachableFragments": ["engine-bay"], "breakImpulse": 12, "debrisMaterial": "hidden"}}, "material": "dark", "materialLayers": ["dark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {}, "evidenceRefs": ["canonical", "profile", "rear"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(41, 52, 59, 1)", "secondaryAlbedo": "rgba(41, 52, 59, 1)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRefs": ["full-object"], "componentId": "engine-bay"}};
  node_engine_bay_41.add(mesh_engine_bay_41);
  meshes["engine-bay"] = mesh_engine_bay_41;
  colliders["engine-bay"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["engine-bay"] ??= [];
  destructionGroups["engine-bay"].push(node_engine_bay_41);
  const socket_engine_bay_engine_bay_mount_0 = new THREE.Object3D();
  socket_engine_bay_engine_bay_mount_0.name = "engine-bay-mount";
  socket_engine_bay_engine_bay_mount_0.position.set(0.0, 0.0, 0.0);
  socket_engine_bay_engine_bay_mount_0.rotation.set(0, 0, 0);
  socket_engine_bay_engine_bay_mount_0.userData.socket = {"id": "engine-bay-mount", "position": [0, 0, 0], "axis": [0, 1, 0]};
  node_engine_bay_41.add(socket_engine_bay_engine_bay_mount_0);
  sockets["engine-bay:engine-bay-mount"] = socket_engine_bay_engine_bay_mount_0;

  const endpoint_engine_42 = makeAttachmentEndpoint(null);
  const node_engine_42 = new THREE.Group();
  node_engine_42.name = "engine__pivot";
  node_engine_42.scale.set(1, 1, 1);
  if (endpoint_engine_42) {
    node_engine_42.position.copy(endpoint_engine_42.start);
    node_engine_42.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_engine_42.position.set(0.0, 0.0, 0.0);
    node_engine_42.rotation.set(0.0, 0.0, 0.0);
  }
  node_engine_42.userData.sculptComponent = {"id": "engine", "name": "engine", "level": "meso", "role": "rigid mechanical part", "importance": 1, "confidence": 0.86, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Separate rigid hardware has its own mechanical boundary.", "geometryDescriptor": {"normalStrategy": "smooth indexed normals", "uvStrategy": "procedural solid color", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.012, "segments": 2}, "deformationStack": [], "roadSurface": {"kind": "interior"}}, "parent": "root", "attachment": {"parentSocket": "root-to-engine", "localStart": [0.1553250104188919, 0.49000000953674316, -1.3880000114440918], "localEnd": [0.1553250104188919, 0.49000000953674316, -1.3880000114440918], "contactType": "overlap", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.012, "parentId": "root"}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.85}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "rigid", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "engine-mount", "position": [0, 0, 0], "axis": [0, 1, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "engine", "seamRefs": [], "detachableFragments": ["engine"], "breakImpulse": 12, "debrisMaterial": "hidden"}}, "material": "dark", "materialLayers": ["dark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {}, "evidenceRefs": ["canonical", "profile", "rear"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(41, 52, 59, 1)", "secondaryAlbedo": "rgba(41, 52, 59, 1)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRefs": ["full-object"], "componentId": "engine"}};
  node_engine_42.userData.actionProfile = {"animationRole": "rigid", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "engine-mount", "position": [0, 0, 0], "axis": [0, 1, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "engine", "seamRefs": [], "detachableFragments": ["engine"], "breakImpulse": 12, "debrisMaterial": "hidden"}};
  (nodes["root"] ?? root).add(node_engine_42);
  nodes["engine"] = node_engine_42;
  const mesh_engine_42Geometry = endpoint_engine_42
    ? new THREE.CylinderGeometry(endpoint_engine_42.endRadius, endpoint_engine_42.baseRadius, endpoint_engine_42.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_engine_42) {
    mesh_engine_42Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_engine_42 = new THREE.Mesh(
    mesh_engine_42Geometry,
    materialMap["dark"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_engine_42.name = "engine";
  if (endpoint_engine_42) {
    mesh_engine_42.position.copy(endpoint_engine_42.midpoint);
    mesh_engine_42.quaternion.copy(endpoint_engine_42.quaternion);
  }
  mesh_engine_42.castShadow = options.castShadow ?? true;
  mesh_engine_42.receiveShadow = options.receiveShadow ?? true;
  mesh_engine_42.userData.sculptComponent = {"id": "engine", "name": "engine", "level": "meso", "role": "rigid mechanical part", "importance": 1, "confidence": 0.86, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Separate rigid hardware has its own mechanical boundary.", "geometryDescriptor": {"normalStrategy": "smooth indexed normals", "uvStrategy": "procedural solid color", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.012, "segments": 2}, "deformationStack": [], "roadSurface": {"kind": "interior"}}, "parent": "root", "attachment": {"parentSocket": "root-to-engine", "localStart": [0.1553250104188919, 0.49000000953674316, -1.3880000114440918], "localEnd": [0.1553250104188919, 0.49000000953674316, -1.3880000114440918], "contactType": "overlap", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.012, "parentId": "root"}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.85}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "rigid", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "engine-mount", "position": [0, 0, 0], "axis": [0, 1, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "engine", "seamRefs": [], "detachableFragments": ["engine"], "breakImpulse": 12, "debrisMaterial": "hidden"}}, "material": "dark", "materialLayers": ["dark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {}, "evidenceRefs": ["canonical", "profile", "rear"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(41, 52, 59, 1)", "secondaryAlbedo": "rgba(41, 52, 59, 1)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRefs": ["full-object"], "componentId": "engine"}};
  node_engine_42.add(mesh_engine_42);
  meshes["engine"] = mesh_engine_42;
  colliders["engine"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["engine"] ??= [];
  destructionGroups["engine"].push(node_engine_42);
  const socket_engine_engine_mount_0 = new THREE.Object3D();
  socket_engine_engine_mount_0.name = "engine-mount";
  socket_engine_engine_mount_0.position.set(0.0, 0.0, 0.0);
  socket_engine_engine_mount_0.rotation.set(0, 0, 0);
  socket_engine_engine_mount_0.userData.socket = {"id": "engine-mount", "position": [0, 0, 0], "axis": [0, 1, 0]};
  node_engine_42.add(socket_engine_engine_mount_0);
  sockets["engine:engine-mount"] = socket_engine_engine_mount_0;

  const endpoint_cargo_liner_43 = makeAttachmentEndpoint(null);
  const node_cargo_liner_43 = new THREE.Group();
  node_cargo_liner_43.name = "cargo-liner__pivot";
  node_cargo_liner_43.scale.set(1, 1, 1);
  if (endpoint_cargo_liner_43) {
    node_cargo_liner_43.position.copy(endpoint_cargo_liner_43.start);
    node_cargo_liner_43.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_cargo_liner_43.position.set(0.0, 0.0, 0.0);
    node_cargo_liner_43.rotation.set(0.0, 0.0, 0.0);
  }
  node_cargo_liner_43.userData.sculptComponent = {"id": "cargo-liner", "name": "cargo-liner", "level": "meso", "role": "rigid mechanical part", "importance": 1, "confidence": 0.86, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Separate rigid hardware has its own mechanical boundary.", "geometryDescriptor": {"normalStrategy": "smooth indexed normals", "uvStrategy": "procedural solid color", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.012, "segments": 2}, "deformationStack": [], "roadSurface": {"kind": "interior"}}, "parent": "root", "attachment": {"parentSocket": "root-to-cargo-liner", "localStart": [0, 0.4725000113248825, 1.7750000357627869], "localEnd": [0, 0.4725000113248825, 1.7750000357627869], "contactType": "overlap", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.012, "parentId": "root"}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.85}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "rigid", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "cargo-liner-mount", "position": [0, 0, 0], "axis": [0, 1, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "cargo-liner", "seamRefs": [], "detachableFragments": ["cargo-liner"], "breakImpulse": 12, "debrisMaterial": "hidden"}}, "material": "dark", "materialLayers": ["dark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {}, "evidenceRefs": ["canonical", "profile", "rear"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(41, 52, 59, 1)", "secondaryAlbedo": "rgba(41, 52, 59, 1)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRefs": ["full-object"], "componentId": "cargo-liner"}};
  node_cargo_liner_43.userData.actionProfile = {"animationRole": "rigid", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "cargo-liner-mount", "position": [0, 0, 0], "axis": [0, 1, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "cargo-liner", "seamRefs": [], "detachableFragments": ["cargo-liner"], "breakImpulse": 12, "debrisMaterial": "hidden"}};
  (nodes["root"] ?? root).add(node_cargo_liner_43);
  nodes["cargo-liner"] = node_cargo_liner_43;
  const mesh_cargo_liner_43Geometry = endpoint_cargo_liner_43
    ? new THREE.CylinderGeometry(endpoint_cargo_liner_43.endRadius, endpoint_cargo_liner_43.baseRadius, endpoint_cargo_liner_43.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_cargo_liner_43) {
    mesh_cargo_liner_43Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_cargo_liner_43 = new THREE.Mesh(
    mesh_cargo_liner_43Geometry,
    materialMap["dark"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_cargo_liner_43.name = "cargo-liner";
  if (endpoint_cargo_liner_43) {
    mesh_cargo_liner_43.position.copy(endpoint_cargo_liner_43.midpoint);
    mesh_cargo_liner_43.quaternion.copy(endpoint_cargo_liner_43.quaternion);
  }
  mesh_cargo_liner_43.castShadow = options.castShadow ?? true;
  mesh_cargo_liner_43.receiveShadow = options.receiveShadow ?? true;
  mesh_cargo_liner_43.userData.sculptComponent = {"id": "cargo-liner", "name": "cargo-liner", "level": "meso", "role": "rigid mechanical part", "importance": 1, "confidence": 0.86, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Separate rigid hardware has its own mechanical boundary.", "geometryDescriptor": {"normalStrategy": "smooth indexed normals", "uvStrategy": "procedural solid color", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.012, "segments": 2}, "deformationStack": [], "roadSurface": {"kind": "interior"}}, "parent": "root", "attachment": {"parentSocket": "root-to-cargo-liner", "localStart": [0, 0.4725000113248825, 1.7750000357627869], "localEnd": [0, 0.4725000113248825, 1.7750000357627869], "contactType": "overlap", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.012, "parentId": "root"}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.85}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "rigid", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "cargo-liner-mount", "position": [0, 0, 0], "axis": [0, 1, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "cargo-liner", "seamRefs": [], "detachableFragments": ["cargo-liner"], "breakImpulse": 12, "debrisMaterial": "hidden"}}, "material": "dark", "materialLayers": ["dark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {}, "evidenceRefs": ["canonical", "profile", "rear"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(41, 52, 59, 1)", "secondaryAlbedo": "rgba(41, 52, 59, 1)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRefs": ["full-object"], "componentId": "cargo-liner"}};
  node_cargo_liner_43.add(mesh_cargo_liner_43);
  meshes["cargo-liner"] = mesh_cargo_liner_43;
  colliders["cargo-liner"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["cargo-liner"] ??= [];
  destructionGroups["cargo-liner"].push(node_cargo_liner_43);
  const socket_cargo_liner_cargo_liner_mount_0 = new THREE.Object3D();
  socket_cargo_liner_cargo_liner_mount_0.name = "cargo-liner-mount";
  socket_cargo_liner_cargo_liner_mount_0.position.set(0.0, 0.0, 0.0);
  socket_cargo_liner_cargo_liner_mount_0.rotation.set(0, 0, 0);
  socket_cargo_liner_cargo_liner_mount_0.userData.socket = {"id": "cargo-liner-mount", "position": [0, 0, 0], "axis": [0, 1, 0]};
  node_cargo_liner_43.add(socket_cargo_liner_cargo_liner_mount_0);
  sockets["cargo-liner:cargo-liner-mount"] = socket_cargo_liner_cargo_liner_mount_0;

  const endpoint_dashboard_44 = makeAttachmentEndpoint(null);
  const node_dashboard_44 = new THREE.Group();
  node_dashboard_44.name = "dashboard__pivot";
  node_dashboard_44.scale.set(1, 1, 1);
  if (endpoint_dashboard_44) {
    node_dashboard_44.position.copy(endpoint_dashboard_44.start);
    node_dashboard_44.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_dashboard_44.position.set(0.0, 0.0, 0.0);
    node_dashboard_44.rotation.set(0.0, 0.0, 0.0);
  }
  node_dashboard_44.userData.sculptComponent = {"id": "dashboard", "name": "dashboard", "level": "meso", "role": "rigid mechanical part", "importance": 1, "confidence": 0.86, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Separate rigid hardware has its own mechanical boundary.", "geometryDescriptor": {"normalStrategy": "smooth indexed normals", "uvStrategy": "procedural solid color", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.012, "segments": 2}, "deformationStack": [], "roadSurface": {"kind": "interior"}}, "parent": "root", "attachment": {"parentSocket": "root-to-dashboard", "localStart": [0, 0.7400000095367432, -0.6499999761581421], "localEnd": [0, 0.7400000095367432, -0.6499999761581421], "contactType": "overlap", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.012, "parentId": "root"}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.85}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "rigid", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "dashboard-mount", "position": [0, 0, 0], "axis": [0, 1, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "dashboard", "seamRefs": [], "detachableFragments": ["dashboard"], "breakImpulse": 12, "debrisMaterial": "hidden"}}, "material": "dark", "materialLayers": ["dark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {}, "evidenceRefs": ["canonical", "profile", "rear"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(41, 52, 59, 1)", "secondaryAlbedo": "rgba(41, 52, 59, 1)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRefs": ["full-object"], "componentId": "dashboard"}};
  node_dashboard_44.userData.actionProfile = {"animationRole": "rigid", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "dashboard-mount", "position": [0, 0, 0], "axis": [0, 1, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "dashboard", "seamRefs": [], "detachableFragments": ["dashboard"], "breakImpulse": 12, "debrisMaterial": "hidden"}};
  (nodes["root"] ?? root).add(node_dashboard_44);
  nodes["dashboard"] = node_dashboard_44;
  const mesh_dashboard_44Geometry = endpoint_dashboard_44
    ? new THREE.CylinderGeometry(endpoint_dashboard_44.endRadius, endpoint_dashboard_44.baseRadius, endpoint_dashboard_44.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_dashboard_44) {
    mesh_dashboard_44Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_dashboard_44 = new THREE.Mesh(
    mesh_dashboard_44Geometry,
    materialMap["dark"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_dashboard_44.name = "dashboard";
  if (endpoint_dashboard_44) {
    mesh_dashboard_44.position.copy(endpoint_dashboard_44.midpoint);
    mesh_dashboard_44.quaternion.copy(endpoint_dashboard_44.quaternion);
  }
  mesh_dashboard_44.castShadow = options.castShadow ?? true;
  mesh_dashboard_44.receiveShadow = options.receiveShadow ?? true;
  mesh_dashboard_44.userData.sculptComponent = {"id": "dashboard", "name": "dashboard", "level": "meso", "role": "rigid mechanical part", "importance": 1, "confidence": 0.86, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Separate rigid hardware has its own mechanical boundary.", "geometryDescriptor": {"normalStrategy": "smooth indexed normals", "uvStrategy": "procedural solid color", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.012, "segments": 2}, "deformationStack": [], "roadSurface": {"kind": "interior"}}, "parent": "root", "attachment": {"parentSocket": "root-to-dashboard", "localStart": [0, 0.7400000095367432, -0.6499999761581421], "localEnd": [0, 0.7400000095367432, -0.6499999761581421], "contactType": "overlap", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.012, "parentId": "root"}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.85}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "rigid", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "dashboard-mount", "position": [0, 0, 0], "axis": [0, 1, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "dashboard", "seamRefs": [], "detachableFragments": ["dashboard"], "breakImpulse": 12, "debrisMaterial": "hidden"}}, "material": "dark", "materialLayers": ["dark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {}, "evidenceRefs": ["canonical", "profile", "rear"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(41, 52, 59, 1)", "secondaryAlbedo": "rgba(41, 52, 59, 1)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRefs": ["full-object"], "componentId": "dashboard"}};
  node_dashboard_44.add(mesh_dashboard_44);
  meshes["dashboard"] = mesh_dashboard_44;
  colliders["dashboard"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["dashboard"] ??= [];
  destructionGroups["dashboard"].push(node_dashboard_44);
  const socket_dashboard_dashboard_mount_0 = new THREE.Object3D();
  socket_dashboard_dashboard_mount_0.name = "dashboard-mount";
  socket_dashboard_dashboard_mount_0.position.set(0.0, 0.0, 0.0);
  socket_dashboard_dashboard_mount_0.rotation.set(0, 0, 0);
  socket_dashboard_dashboard_mount_0.userData.socket = {"id": "dashboard-mount", "position": [0, 0, 0], "axis": [0, 1, 0]};
  node_dashboard_44.add(socket_dashboard_dashboard_mount_0);
  sockets["dashboard:dashboard-mount"] = socket_dashboard_dashboard_mount_0;

  const endpoint_seat_front_left_45 = makeAttachmentEndpoint(null);
  const node_seat_front_left_45 = new THREE.Group();
  node_seat_front_left_45.name = "seat-front-left__pivot";
  node_seat_front_left_45.scale.set(1, 1, 1);
  if (endpoint_seat_front_left_45) {
    node_seat_front_left_45.position.copy(endpoint_seat_front_left_45.start);
    node_seat_front_left_45.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_seat_front_left_45.position.set(0.0, 0.0, 0.0);
    node_seat_front_left_45.rotation.set(0.0, 0.0, 0.0);
  }
  node_seat_front_left_45.userData.sculptComponent = {"id": "seat-front-left", "name": "seat-front-left", "level": "meso", "role": "rigid mechanical part", "importance": 1, "confidence": 0.86, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Separate rigid hardware has its own mechanical boundary.", "geometryDescriptor": {"normalStrategy": "smooth indexed normals", "uvStrategy": "procedural solid color", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.012, "segments": 2}, "deformationStack": [], "roadSurface": {"kind": "interior"}}, "parent": "root", "attachment": {"parentSocket": "root-to-seat-front-left", "localStart": [-0.3912999853491783, 0.6350000277161598, -0.07000000029802322], "localEnd": [-0.3912999853491783, 0.6350000277161598, -0.07000000029802322], "contactType": "overlap", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.012, "parentId": "root"}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.85}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "rigid", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "seat-front-left-mount", "position": [0, 0, 0], "axis": [0, 1, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "seat-front-left", "seamRefs": [], "detachableFragments": ["seat-front-left"], "breakImpulse": 12, "debrisMaterial": "hidden"}}, "material": "dark", "materialLayers": ["dark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "padded-seats", "kind": "contour", "description": "padded-seats", "evidenceRefs": ["canonical"]}], "surfaceDetail": {}, "evidenceRefs": ["canonical", "profile", "rear"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(41, 52, 59, 1)", "secondaryAlbedo": "rgba(41, 52, 59, 1)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRefs": ["full-object"], "componentId": "seat-front-left"}};
  node_seat_front_left_45.userData.actionProfile = {"animationRole": "rigid", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "seat-front-left-mount", "position": [0, 0, 0], "axis": [0, 1, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "seat-front-left", "seamRefs": [], "detachableFragments": ["seat-front-left"], "breakImpulse": 12, "debrisMaterial": "hidden"}};
  (nodes["root"] ?? root).add(node_seat_front_left_45);
  nodes["seat-front-left"] = node_seat_front_left_45;
  const mesh_seat_front_left_45Geometry = endpoint_seat_front_left_45
    ? new THREE.CylinderGeometry(endpoint_seat_front_left_45.endRadius, endpoint_seat_front_left_45.baseRadius, endpoint_seat_front_left_45.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_seat_front_left_45) {
    mesh_seat_front_left_45Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_seat_front_left_45 = new THREE.Mesh(
    mesh_seat_front_left_45Geometry,
    materialMap["dark"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_seat_front_left_45.name = "seat-front-left";
  if (endpoint_seat_front_left_45) {
    mesh_seat_front_left_45.position.copy(endpoint_seat_front_left_45.midpoint);
    mesh_seat_front_left_45.quaternion.copy(endpoint_seat_front_left_45.quaternion);
  }
  mesh_seat_front_left_45.castShadow = options.castShadow ?? true;
  mesh_seat_front_left_45.receiveShadow = options.receiveShadow ?? true;
  mesh_seat_front_left_45.userData.sculptComponent = {"id": "seat-front-left", "name": "seat-front-left", "level": "meso", "role": "rigid mechanical part", "importance": 1, "confidence": 0.86, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Separate rigid hardware has its own mechanical boundary.", "geometryDescriptor": {"normalStrategy": "smooth indexed normals", "uvStrategy": "procedural solid color", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.012, "segments": 2}, "deformationStack": [], "roadSurface": {"kind": "interior"}}, "parent": "root", "attachment": {"parentSocket": "root-to-seat-front-left", "localStart": [-0.3912999853491783, 0.6350000277161598, -0.07000000029802322], "localEnd": [-0.3912999853491783, 0.6350000277161598, -0.07000000029802322], "contactType": "overlap", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.012, "parentId": "root"}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.85}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "rigid", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "seat-front-left-mount", "position": [0, 0, 0], "axis": [0, 1, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "seat-front-left", "seamRefs": [], "detachableFragments": ["seat-front-left"], "breakImpulse": 12, "debrisMaterial": "hidden"}}, "material": "dark", "materialLayers": ["dark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "padded-seats", "kind": "contour", "description": "padded-seats", "evidenceRefs": ["canonical"]}], "surfaceDetail": {}, "evidenceRefs": ["canonical", "profile", "rear"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(41, 52, 59, 1)", "secondaryAlbedo": "rgba(41, 52, 59, 1)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRefs": ["full-object"], "componentId": "seat-front-left"}};
  node_seat_front_left_45.add(mesh_seat_front_left_45);
  meshes["seat-front-left"] = mesh_seat_front_left_45;
  colliders["seat-front-left"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["seat-front-left"] ??= [];
  destructionGroups["seat-front-left"].push(node_seat_front_left_45);
  const socket_seat_front_left_seat_front_left_mount_0 = new THREE.Object3D();
  socket_seat_front_left_seat_front_left_mount_0.name = "seat-front-left-mount";
  socket_seat_front_left_seat_front_left_mount_0.position.set(0.0, 0.0, 0.0);
  socket_seat_front_left_seat_front_left_mount_0.rotation.set(0, 0, 0);
  socket_seat_front_left_seat_front_left_mount_0.userData.socket = {"id": "seat-front-left-mount", "position": [0, 0, 0], "axis": [0, 1, 0]};
  node_seat_front_left_45.add(socket_seat_front_left_seat_front_left_mount_0);
  sockets["seat-front-left:seat-front-left-mount"] = socket_seat_front_left_seat_front_left_mount_0;

  const endpoint_seat_front_right_46 = makeAttachmentEndpoint(null);
  const node_seat_front_right_46 = new THREE.Group();
  node_seat_front_right_46.name = "seat-front-right__pivot";
  node_seat_front_right_46.scale.set(1, 1, 1);
  if (endpoint_seat_front_right_46) {
    node_seat_front_right_46.position.copy(endpoint_seat_front_right_46.start);
    node_seat_front_right_46.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_seat_front_right_46.position.set(0.0, 0.0, 0.0);
    node_seat_front_right_46.rotation.set(0.0, 0.0, 0.0);
  }
  node_seat_front_right_46.userData.sculptComponent = {"id": "seat-front-right", "name": "seat-front-right", "level": "meso", "role": "rigid mechanical part", "importance": 1, "confidence": 0.86, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Separate rigid hardware has its own mechanical boundary.", "geometryDescriptor": {"normalStrategy": "smooth indexed normals", "uvStrategy": "procedural solid color", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.012, "segments": 2}, "deformationStack": [], "roadSurface": {"kind": "interior"}}, "parent": "root", "attachment": {"parentSocket": "root-to-seat-front-right", "localStart": [0.3912999853491783, 0.6350000277161598, -0.07000000029802322], "localEnd": [0.3912999853491783, 0.6350000277161598, -0.07000000029802322], "contactType": "overlap", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.012, "parentId": "root"}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.85}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "rigid", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "seat-front-right-mount", "position": [0, 0, 0], "axis": [0, 1, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "seat-front-right", "seamRefs": [], "detachableFragments": ["seat-front-right"], "breakImpulse": 12, "debrisMaterial": "hidden"}}, "material": "dark", "materialLayers": ["dark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {}, "evidenceRefs": ["canonical", "profile", "rear"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(41, 52, 59, 1)", "secondaryAlbedo": "rgba(41, 52, 59, 1)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRefs": ["full-object"], "componentId": "seat-front-right"}};
  node_seat_front_right_46.userData.actionProfile = {"animationRole": "rigid", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "seat-front-right-mount", "position": [0, 0, 0], "axis": [0, 1, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "seat-front-right", "seamRefs": [], "detachableFragments": ["seat-front-right"], "breakImpulse": 12, "debrisMaterial": "hidden"}};
  (nodes["root"] ?? root).add(node_seat_front_right_46);
  nodes["seat-front-right"] = node_seat_front_right_46;
  const mesh_seat_front_right_46Geometry = endpoint_seat_front_right_46
    ? new THREE.CylinderGeometry(endpoint_seat_front_right_46.endRadius, endpoint_seat_front_right_46.baseRadius, endpoint_seat_front_right_46.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_seat_front_right_46) {
    mesh_seat_front_right_46Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_seat_front_right_46 = new THREE.Mesh(
    mesh_seat_front_right_46Geometry,
    materialMap["dark"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_seat_front_right_46.name = "seat-front-right";
  if (endpoint_seat_front_right_46) {
    mesh_seat_front_right_46.position.copy(endpoint_seat_front_right_46.midpoint);
    mesh_seat_front_right_46.quaternion.copy(endpoint_seat_front_right_46.quaternion);
  }
  mesh_seat_front_right_46.castShadow = options.castShadow ?? true;
  mesh_seat_front_right_46.receiveShadow = options.receiveShadow ?? true;
  mesh_seat_front_right_46.userData.sculptComponent = {"id": "seat-front-right", "name": "seat-front-right", "level": "meso", "role": "rigid mechanical part", "importance": 1, "confidence": 0.86, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Separate rigid hardware has its own mechanical boundary.", "geometryDescriptor": {"normalStrategy": "smooth indexed normals", "uvStrategy": "procedural solid color", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.012, "segments": 2}, "deformationStack": [], "roadSurface": {"kind": "interior"}}, "parent": "root", "attachment": {"parentSocket": "root-to-seat-front-right", "localStart": [0.3912999853491783, 0.6350000277161598, -0.07000000029802322], "localEnd": [0.3912999853491783, 0.6350000277161598, -0.07000000029802322], "contactType": "overlap", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.012, "parentId": "root"}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.85}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "rigid", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "seat-front-right-mount", "position": [0, 0, 0], "axis": [0, 1, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "seat-front-right", "seamRefs": [], "detachableFragments": ["seat-front-right"], "breakImpulse": 12, "debrisMaterial": "hidden"}}, "material": "dark", "materialLayers": ["dark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {}, "evidenceRefs": ["canonical", "profile", "rear"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(41, 52, 59, 1)", "secondaryAlbedo": "rgba(41, 52, 59, 1)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRefs": ["full-object"], "componentId": "seat-front-right"}};
  node_seat_front_right_46.add(mesh_seat_front_right_46);
  meshes["seat-front-right"] = mesh_seat_front_right_46;
  colliders["seat-front-right"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["seat-front-right"] ??= [];
  destructionGroups["seat-front-right"].push(node_seat_front_right_46);
  const socket_seat_front_right_seat_front_right_mount_0 = new THREE.Object3D();
  socket_seat_front_right_seat_front_right_mount_0.name = "seat-front-right-mount";
  socket_seat_front_right_seat_front_right_mount_0.position.set(0.0, 0.0, 0.0);
  socket_seat_front_right_seat_front_right_mount_0.rotation.set(0, 0, 0);
  socket_seat_front_right_seat_front_right_mount_0.userData.socket = {"id": "seat-front-right-mount", "position": [0, 0, 0], "axis": [0, 1, 0]};
  node_seat_front_right_46.add(socket_seat_front_right_seat_front_right_mount_0);
  sockets["seat-front-right:seat-front-right-mount"] = socket_seat_front_right_seat_front_right_mount_0;

  const endpoint_seat_rear_47 = makeAttachmentEndpoint(null);
  const node_seat_rear_47 = new THREE.Group();
  node_seat_rear_47.name = "seat-rear__pivot";
  node_seat_rear_47.scale.set(1, 1, 1);
  if (endpoint_seat_rear_47) {
    node_seat_rear_47.position.copy(endpoint_seat_rear_47.start);
    node_seat_rear_47.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_seat_rear_47.position.set(0.0, 0.0, 0.0);
    node_seat_rear_47.rotation.set(0.0, 0.0, 0.0);
  }
  node_seat_rear_47.userData.sculptComponent = {"id": "seat-rear", "name": "seat-rear", "level": "meso", "role": "rigid mechanical part", "importance": 1, "confidence": 0.86, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Separate rigid hardware has its own mechanical boundary.", "geometryDescriptor": {"normalStrategy": "smooth indexed normals", "uvStrategy": "procedural solid color", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.012, "segments": 2}, "deformationStack": [], "roadSurface": {"kind": "interior"}}, "parent": "root", "attachment": {"parentSocket": "root-to-seat-rear", "localStart": [0, 0.5300000011920929, 1.0499999821186066], "localEnd": [0, 0.5300000011920929, 1.0499999821186066], "contactType": "overlap", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.012, "parentId": "root"}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.85}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "rigid", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "seat-rear-mount", "position": [0, 0, 0], "axis": [0, 1, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "seat-rear", "seamRefs": [], "detachableFragments": ["seat-rear"], "breakImpulse": 12, "debrisMaterial": "hidden"}}, "material": "dark", "materialLayers": ["dark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {}, "evidenceRefs": ["canonical", "profile", "rear"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(41, 52, 59, 1)", "secondaryAlbedo": "rgba(41, 52, 59, 1)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRefs": ["full-object"], "componentId": "seat-rear"}};
  node_seat_rear_47.userData.actionProfile = {"animationRole": "rigid", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "seat-rear-mount", "position": [0, 0, 0], "axis": [0, 1, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "seat-rear", "seamRefs": [], "detachableFragments": ["seat-rear"], "breakImpulse": 12, "debrisMaterial": "hidden"}};
  (nodes["root"] ?? root).add(node_seat_rear_47);
  nodes["seat-rear"] = node_seat_rear_47;
  const mesh_seat_rear_47Geometry = endpoint_seat_rear_47
    ? new THREE.CylinderGeometry(endpoint_seat_rear_47.endRadius, endpoint_seat_rear_47.baseRadius, endpoint_seat_rear_47.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_seat_rear_47) {
    mesh_seat_rear_47Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_seat_rear_47 = new THREE.Mesh(
    mesh_seat_rear_47Geometry,
    materialMap["dark"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_seat_rear_47.name = "seat-rear";
  if (endpoint_seat_rear_47) {
    mesh_seat_rear_47.position.copy(endpoint_seat_rear_47.midpoint);
    mesh_seat_rear_47.quaternion.copy(endpoint_seat_rear_47.quaternion);
  }
  mesh_seat_rear_47.castShadow = options.castShadow ?? true;
  mesh_seat_rear_47.receiveShadow = options.receiveShadow ?? true;
  mesh_seat_rear_47.userData.sculptComponent = {"id": "seat-rear", "name": "seat-rear", "level": "meso", "role": "rigid mechanical part", "importance": 1, "confidence": 0.86, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Separate rigid hardware has its own mechanical boundary.", "geometryDescriptor": {"normalStrategy": "smooth indexed normals", "uvStrategy": "procedural solid color", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.012, "segments": 2}, "deformationStack": [], "roadSurface": {"kind": "interior"}}, "parent": "root", "attachment": {"parentSocket": "root-to-seat-rear", "localStart": [0, 0.5300000011920929, 1.0499999821186066], "localEnd": [0, 0.5300000011920929, 1.0499999821186066], "contactType": "overlap", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.012, "parentId": "root"}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.85}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "rigid", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "seat-rear-mount", "position": [0, 0, 0], "axis": [0, 1, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "seat-rear", "seamRefs": [], "detachableFragments": ["seat-rear"], "breakImpulse": 12, "debrisMaterial": "hidden"}}, "material": "dark", "materialLayers": ["dark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {}, "evidenceRefs": ["canonical", "profile", "rear"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(41, 52, 59, 1)", "secondaryAlbedo": "rgba(41, 52, 59, 1)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRefs": ["full-object"], "componentId": "seat-rear"}};
  node_seat_rear_47.add(mesh_seat_rear_47);
  meshes["seat-rear"] = mesh_seat_rear_47;
  colliders["seat-rear"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["seat-rear"] ??= [];
  destructionGroups["seat-rear"].push(node_seat_rear_47);
  const socket_seat_rear_seat_rear_mount_0 = new THREE.Object3D();
  socket_seat_rear_seat_rear_mount_0.name = "seat-rear-mount";
  socket_seat_rear_seat_rear_mount_0.position.set(0.0, 0.0, 0.0);
  socket_seat_rear_seat_rear_mount_0.rotation.set(0, 0, 0);
  socket_seat_rear_seat_rear_mount_0.userData.socket = {"id": "seat-rear-mount", "position": [0, 0, 0], "axis": [0, 1, 0]};
  node_seat_rear_47.add(socket_seat_rear_seat_rear_mount_0);
  sockets["seat-rear:seat-rear-mount"] = socket_seat_rear_seat_rear_mount_0;

  const endpoint_steering_wheel_48 = makeAttachmentEndpoint(null);
  const node_steering_wheel_48 = new THREE.Group();
  node_steering_wheel_48.name = "steering-wheel__pivot";
  node_steering_wheel_48.scale.set(1, 1, 1);
  if (endpoint_steering_wheel_48) {
    node_steering_wheel_48.position.copy(endpoint_steering_wheel_48.start);
    node_steering_wheel_48.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_steering_wheel_48.position.set(0.0, 0.0, 0.0);
    node_steering_wheel_48.rotation.set(0.0, 0.0, 0.0);
  }
  node_steering_wheel_48.userData.sculptComponent = {"id": "steering-wheel", "name": "steering-wheel", "level": "meso", "role": "rigid mechanical part", "importance": 1, "confidence": 0.86, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Separate rigid hardware has its own mechanical boundary.", "geometryDescriptor": {"normalStrategy": "smooth indexed normals", "uvStrategy": "procedural solid color", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.012, "segments": 2}, "deformationStack": [], "roadSurface": {"kind": "interior"}}, "parent": "root", "attachment": {"parentSocket": "root-to-steering-wheel", "localStart": [-0.3913, 0.85, -0.5319910895540693], "localEnd": [-0.3913, 0.85, -0.5319910895540693], "contactType": "overlap", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.012, "parentId": "root"}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.85}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "rigid", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "steering-wheel-mount", "position": [0, 0, 0], "axis": [0, 1, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "steering-wheel", "seamRefs": [], "detachableFragments": ["steering-wheel"], "breakImpulse": 12, "debrisMaterial": "hidden"}}, "material": "dark", "materialLayers": ["dark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {}, "evidenceRefs": ["canonical", "profile", "rear"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(41, 52, 59, 1)", "secondaryAlbedo": "rgba(41, 52, 59, 1)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRefs": ["full-object"], "componentId": "steering-wheel"}};
  node_steering_wheel_48.userData.actionProfile = {"animationRole": "rigid", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "steering-wheel-mount", "position": [0, 0, 0], "axis": [0, 1, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "steering-wheel", "seamRefs": [], "detachableFragments": ["steering-wheel"], "breakImpulse": 12, "debrisMaterial": "hidden"}};
  (nodes["root"] ?? root).add(node_steering_wheel_48);
  nodes["steering-wheel"] = node_steering_wheel_48;
  const mesh_steering_wheel_48Geometry = endpoint_steering_wheel_48
    ? new THREE.CylinderGeometry(endpoint_steering_wheel_48.endRadius, endpoint_steering_wheel_48.baseRadius, endpoint_steering_wheel_48.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_steering_wheel_48) {
    mesh_steering_wheel_48Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_steering_wheel_48 = new THREE.Mesh(
    mesh_steering_wheel_48Geometry,
    materialMap["dark"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_steering_wheel_48.name = "steering-wheel";
  if (endpoint_steering_wheel_48) {
    mesh_steering_wheel_48.position.copy(endpoint_steering_wheel_48.midpoint);
    mesh_steering_wheel_48.quaternion.copy(endpoint_steering_wheel_48.quaternion);
  }
  mesh_steering_wheel_48.castShadow = options.castShadow ?? true;
  mesh_steering_wheel_48.receiveShadow = options.receiveShadow ?? true;
  mesh_steering_wheel_48.userData.sculptComponent = {"id": "steering-wheel", "name": "steering-wheel", "level": "meso", "role": "rigid mechanical part", "importance": 1, "confidence": 0.86, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Separate rigid hardware has its own mechanical boundary.", "geometryDescriptor": {"normalStrategy": "smooth indexed normals", "uvStrategy": "procedural solid color", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.012, "segments": 2}, "deformationStack": [], "roadSurface": {"kind": "interior"}}, "parent": "root", "attachment": {"parentSocket": "root-to-steering-wheel", "localStart": [-0.3913, 0.85, -0.5319910895540693], "localEnd": [-0.3913, 0.85, -0.5319910895540693], "contactType": "overlap", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.012, "parentId": "root"}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.85}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "rigid", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "steering-wheel-mount", "position": [0, 0, 0], "axis": [0, 1, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "steering-wheel", "seamRefs": [], "detachableFragments": ["steering-wheel"], "breakImpulse": 12, "debrisMaterial": "hidden"}}, "material": "dark", "materialLayers": ["dark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {}, "evidenceRefs": ["canonical", "profile", "rear"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(41, 52, 59, 1)", "secondaryAlbedo": "rgba(41, 52, 59, 1)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRefs": ["full-object"], "componentId": "steering-wheel"}};
  node_steering_wheel_48.add(mesh_steering_wheel_48);
  meshes["steering-wheel"] = mesh_steering_wheel_48;
  colliders["steering-wheel"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["steering-wheel"] ??= [];
  destructionGroups["steering-wheel"].push(node_steering_wheel_48);
  const socket_steering_wheel_steering_wheel_mount_0 = new THREE.Object3D();
  socket_steering_wheel_steering_wheel_mount_0.name = "steering-wheel-mount";
  socket_steering_wheel_steering_wheel_mount_0.position.set(0.0, 0.0, 0.0);
  socket_steering_wheel_steering_wheel_mount_0.rotation.set(0, 0, 0);
  socket_steering_wheel_steering_wheel_mount_0.userData.socket = {"id": "steering-wheel-mount", "position": [0, 0, 0], "axis": [0, 1, 0]};
  node_steering_wheel_48.add(socket_steering_wheel_steering_wheel_mount_0);
  sockets["steering-wheel:steering-wheel-mount"] = socket_steering_wheel_steering_wheel_mount_0;

  const endpoint_grille_49 = makeAttachmentEndpoint(null);
  const node_grille_49 = new THREE.Group();
  node_grille_49.name = "grille__pivot";
  node_grille_49.scale.set(1, 1, 1);
  if (endpoint_grille_49) {
    node_grille_49.position.copy(endpoint_grille_49.start);
    node_grille_49.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_grille_49.position.set(0.0, 0.0, 0.0);
    node_grille_49.rotation.set(0.0, 0.0, 0.0);
  }
  node_grille_49.userData.sculptComponent = {"id": "grille", "name": "grille", "level": "micro", "role": "rigid mechanical part", "importance": 1, "confidence": 0.86, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Separate rigid hardware has its own mechanical boundary.", "geometryDescriptor": {"normalStrategy": "smooth indexed normals", "uvStrategy": "procedural solid color", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.012, "segments": 2}, "deformationStack": [], "roadSurface": {"kind": "hardware"}}, "parent": "root", "attachment": {"parentSocket": "root-to-grille", "localStart": [0, 0.5137500017881393, -2.2177499532699585], "localEnd": [0, 0.5137500017881393, -2.2177499532699585], "contactType": "overlap", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.012, "parentId": "root"}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.85}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "rigid", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "grille-mount", "position": [0, 0, 0], "axis": [0, 1, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "grille", "seamRefs": [], "detachableFragments": ["grille"], "breakImpulse": 12, "debrisMaterial": "hidden"}}, "material": "dark", "materialLayers": ["dark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "inset-grille", "kind": "cavity", "description": "inset-grille", "evidenceRefs": ["canonical"]}], "surfaceDetail": {}, "evidenceRefs": ["canonical", "profile", "rear"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(41, 52, 59, 1)", "secondaryAlbedo": "rgba(41, 52, 59, 1)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRefs": ["full-object"], "componentId": "grille"}};
  node_grille_49.userData.actionProfile = {"animationRole": "rigid", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "grille-mount", "position": [0, 0, 0], "axis": [0, 1, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "grille", "seamRefs": [], "detachableFragments": ["grille"], "breakImpulse": 12, "debrisMaterial": "hidden"}};
  (nodes["root"] ?? root).add(node_grille_49);
  nodes["grille"] = node_grille_49;
  const mesh_grille_49Geometry = endpoint_grille_49
    ? new THREE.CylinderGeometry(endpoint_grille_49.endRadius, endpoint_grille_49.baseRadius, endpoint_grille_49.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_grille_49) {
    mesh_grille_49Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_grille_49 = new THREE.Mesh(
    mesh_grille_49Geometry,
    materialMap["dark"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_grille_49.name = "grille";
  if (endpoint_grille_49) {
    mesh_grille_49.position.copy(endpoint_grille_49.midpoint);
    mesh_grille_49.quaternion.copy(endpoint_grille_49.quaternion);
  }
  mesh_grille_49.castShadow = options.castShadow ?? true;
  mesh_grille_49.receiveShadow = options.receiveShadow ?? true;
  mesh_grille_49.userData.sculptComponent = {"id": "grille", "name": "grille", "level": "micro", "role": "rigid mechanical part", "importance": 1, "confidence": 0.86, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Separate rigid hardware has its own mechanical boundary.", "geometryDescriptor": {"normalStrategy": "smooth indexed normals", "uvStrategy": "procedural solid color", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.012, "segments": 2}, "deformationStack": [], "roadSurface": {"kind": "hardware"}}, "parent": "root", "attachment": {"parentSocket": "root-to-grille", "localStart": [0, 0.5137500017881393, -2.2177499532699585], "localEnd": [0, 0.5137500017881393, -2.2177499532699585], "contactType": "overlap", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.012, "parentId": "root"}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.85}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "rigid", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "grille-mount", "position": [0, 0, 0], "axis": [0, 1, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "grille", "seamRefs": [], "detachableFragments": ["grille"], "breakImpulse": 12, "debrisMaterial": "hidden"}}, "material": "dark", "materialLayers": ["dark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "inset-grille", "kind": "cavity", "description": "inset-grille", "evidenceRefs": ["canonical"]}], "surfaceDetail": {}, "evidenceRefs": ["canonical", "profile", "rear"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(41, 52, 59, 1)", "secondaryAlbedo": "rgba(41, 52, 59, 1)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRefs": ["full-object"], "componentId": "grille"}};
  node_grille_49.add(mesh_grille_49);
  meshes["grille"] = mesh_grille_49;
  colliders["grille"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["grille"] ??= [];
  destructionGroups["grille"].push(node_grille_49);
  const socket_grille_grille_mount_0 = new THREE.Object3D();
  socket_grille_grille_mount_0.name = "grille-mount";
  socket_grille_grille_mount_0.position.set(0.0, 0.0, 0.0);
  socket_grille_grille_mount_0.rotation.set(0, 0, 0);
  socket_grille_grille_mount_0.userData.socket = {"id": "grille-mount", "position": [0, 0, 0], "axis": [0, 1, 0]};
  node_grille_49.add(socket_grille_grille_mount_0);
  sockets["grille:grille-mount"] = socket_grille_grille_mount_0;

  const endpoint_headlights_50 = makeAttachmentEndpoint(null);
  const node_headlights_50 = new THREE.Group();
  node_headlights_50.name = "headlights__pivot";
  node_headlights_50.scale.set(1, 1, 1);
  if (endpoint_headlights_50) {
    node_headlights_50.position.copy(endpoint_headlights_50.start);
    node_headlights_50.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_headlights_50.position.set(0.0, 0.0, 0.0);
    node_headlights_50.rotation.set(0.0, 0.0, 0.0);
  }
  node_headlights_50.userData.sculptComponent = {"id": "headlights", "name": "headlights", "level": "micro", "role": "rigid mechanical part", "importance": 1, "confidence": 0.86, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Separate rigid hardware has its own mechanical boundary.", "geometryDescriptor": {"normalStrategy": "smooth indexed normals", "uvStrategy": "procedural solid color", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.012, "segments": 2}, "deformationStack": [], "roadSurface": {"kind": "hardware"}}, "parent": "root", "attachment": {"parentSocket": "root-to-headlights", "localStart": [0, 0.625, -2.2416800260543823], "localEnd": [0, 0.625, -2.2416800260543823], "contactType": "overlap", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.012, "parentId": "root"}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.85}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "rigid", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "headlights-mount", "position": [0, 0, 0], "axis": [0, 1, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "headlights", "seamRefs": [], "detachableFragments": ["headlights"], "breakImpulse": 12, "debrisMaterial": "hidden"}}, "material": "lamp", "materialLayers": ["lamp"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "paired-square-lamps", "kind": "repetition", "description": "paired-square-lamps", "evidenceRefs": ["canonical"]}], "surfaceDetail": {}, "evidenceRefs": ["canonical", "profile", "rear"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(236, 237, 223, 1)", "secondaryAlbedo": "rgba(236, 237, 223, 1)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRefs": ["full-object"], "componentId": "headlights"}};
  node_headlights_50.userData.actionProfile = {"animationRole": "rigid", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "headlights-mount", "position": [0, 0, 0], "axis": [0, 1, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "headlights", "seamRefs": [], "detachableFragments": ["headlights"], "breakImpulse": 12, "debrisMaterial": "hidden"}};
  (nodes["root"] ?? root).add(node_headlights_50);
  nodes["headlights"] = node_headlights_50;
  const mesh_headlights_50Geometry = endpoint_headlights_50
    ? new THREE.CylinderGeometry(endpoint_headlights_50.endRadius, endpoint_headlights_50.baseRadius, endpoint_headlights_50.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_headlights_50) {
    mesh_headlights_50Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_headlights_50 = new THREE.Mesh(
    mesh_headlights_50Geometry,
    materialMap["lamp"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_headlights_50.name = "headlights";
  if (endpoint_headlights_50) {
    mesh_headlights_50.position.copy(endpoint_headlights_50.midpoint);
    mesh_headlights_50.quaternion.copy(endpoint_headlights_50.quaternion);
  }
  mesh_headlights_50.castShadow = options.castShadow ?? true;
  mesh_headlights_50.receiveShadow = options.receiveShadow ?? true;
  mesh_headlights_50.userData.sculptComponent = {"id": "headlights", "name": "headlights", "level": "micro", "role": "rigid mechanical part", "importance": 1, "confidence": 0.86, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Separate rigid hardware has its own mechanical boundary.", "geometryDescriptor": {"normalStrategy": "smooth indexed normals", "uvStrategy": "procedural solid color", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.012, "segments": 2}, "deformationStack": [], "roadSurface": {"kind": "hardware"}}, "parent": "root", "attachment": {"parentSocket": "root-to-headlights", "localStart": [0, 0.625, -2.2416800260543823], "localEnd": [0, 0.625, -2.2416800260543823], "contactType": "overlap", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.012, "parentId": "root"}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.85}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "rigid", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "headlights-mount", "position": [0, 0, 0], "axis": [0, 1, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "headlights", "seamRefs": [], "detachableFragments": ["headlights"], "breakImpulse": 12, "debrisMaterial": "hidden"}}, "material": "lamp", "materialLayers": ["lamp"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "paired-square-lamps", "kind": "repetition", "description": "paired-square-lamps", "evidenceRefs": ["canonical"]}], "surfaceDetail": {}, "evidenceRefs": ["canonical", "profile", "rear"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(236, 237, 223, 1)", "secondaryAlbedo": "rgba(236, 237, 223, 1)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRefs": ["full-object"], "componentId": "headlights"}};
  node_headlights_50.add(mesh_headlights_50);
  meshes["headlights"] = mesh_headlights_50;
  colliders["headlights"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["headlights"] ??= [];
  destructionGroups["headlights"].push(node_headlights_50);
  const socket_headlights_headlights_mount_0 = new THREE.Object3D();
  socket_headlights_headlights_mount_0.name = "headlights-mount";
  socket_headlights_headlights_mount_0.position.set(0.0, 0.0, 0.0);
  socket_headlights_headlights_mount_0.rotation.set(0, 0, 0);
  socket_headlights_headlights_mount_0.userData.socket = {"id": "headlights-mount", "position": [0, 0, 0], "axis": [0, 1, 0]};
  node_headlights_50.add(socket_headlights_headlights_mount_0);
  sockets["headlights:headlights-mount"] = socket_headlights_headlights_mount_0;

  const endpoint_tail_lamps_51 = makeAttachmentEndpoint(null);
  const node_tail_lamps_51 = new THREE.Group();
  node_tail_lamps_51.name = "tail-lamps__pivot";
  node_tail_lamps_51.scale.set(1, 1, 1);
  if (endpoint_tail_lamps_51) {
    node_tail_lamps_51.position.copy(endpoint_tail_lamps_51.start);
    node_tail_lamps_51.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_tail_lamps_51.position.set(0.0, 0.0, 0.0);
    node_tail_lamps_51.rotation.set(0.0, 0.0, 0.0);
  }
  node_tail_lamps_51.userData.sculptComponent = {"id": "tail-lamps", "name": "tail-lamps", "level": "micro", "role": "rigid mechanical part", "importance": 1, "confidence": 0.86, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Separate rigid hardware has its own mechanical boundary.", "geometryDescriptor": {"normalStrategy": "smooth indexed normals", "uvStrategy": "procedural solid color", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.012, "segments": 2}, "deformationStack": [], "roadSurface": {"kind": "hardware"}}, "parent": "root", "attachment": {"parentSocket": "root-to-tail-lamps", "localStart": [0, 0.625, 2.215499997138977], "localEnd": [0, 0.625, 2.215499997138977], "contactType": "overlap", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.012, "parentId": "root"}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.85}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "rigid", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "tail-lamps-mount", "position": [0, 0, 0], "axis": [0, 1, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "tail-lamps", "seamRefs": [], "detachableFragments": ["tail-lamps"], "breakImpulse": 12, "debrisMaterial": "hidden"}}, "material": "red", "materialLayers": ["red"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "rear-lenses", "kind": "color", "description": "rear-lenses", "evidenceRefs": ["canonical"]}], "surfaceDetail": {}, "evidenceRefs": ["canonical", "profile", "rear"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(181, 45, 53, 1)", "secondaryAlbedo": "rgba(181, 45, 53, 1)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRefs": ["full-object"], "componentId": "tail-lamps"}};
  node_tail_lamps_51.userData.actionProfile = {"animationRole": "rigid", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "tail-lamps-mount", "position": [0, 0, 0], "axis": [0, 1, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "tail-lamps", "seamRefs": [], "detachableFragments": ["tail-lamps"], "breakImpulse": 12, "debrisMaterial": "hidden"}};
  (nodes["root"] ?? root).add(node_tail_lamps_51);
  nodes["tail-lamps"] = node_tail_lamps_51;
  const mesh_tail_lamps_51Geometry = endpoint_tail_lamps_51
    ? new THREE.CylinderGeometry(endpoint_tail_lamps_51.endRadius, endpoint_tail_lamps_51.baseRadius, endpoint_tail_lamps_51.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_tail_lamps_51) {
    mesh_tail_lamps_51Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_tail_lamps_51 = new THREE.Mesh(
    mesh_tail_lamps_51Geometry,
    materialMap["red"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_tail_lamps_51.name = "tail-lamps";
  if (endpoint_tail_lamps_51) {
    mesh_tail_lamps_51.position.copy(endpoint_tail_lamps_51.midpoint);
    mesh_tail_lamps_51.quaternion.copy(endpoint_tail_lamps_51.quaternion);
  }
  mesh_tail_lamps_51.castShadow = options.castShadow ?? true;
  mesh_tail_lamps_51.receiveShadow = options.receiveShadow ?? true;
  mesh_tail_lamps_51.userData.sculptComponent = {"id": "tail-lamps", "name": "tail-lamps", "level": "micro", "role": "rigid mechanical part", "importance": 1, "confidence": 0.86, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Separate rigid hardware has its own mechanical boundary.", "geometryDescriptor": {"normalStrategy": "smooth indexed normals", "uvStrategy": "procedural solid color", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.012, "segments": 2}, "deformationStack": [], "roadSurface": {"kind": "hardware"}}, "parent": "root", "attachment": {"parentSocket": "root-to-tail-lamps", "localStart": [0, 0.625, 2.215499997138977], "localEnd": [0, 0.625, 2.215499997138977], "contactType": "overlap", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.012, "parentId": "root"}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.85}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "rigid", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "tail-lamps-mount", "position": [0, 0, 0], "axis": [0, 1, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "tail-lamps", "seamRefs": [], "detachableFragments": ["tail-lamps"], "breakImpulse": 12, "debrisMaterial": "hidden"}}, "material": "red", "materialLayers": ["red"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "rear-lenses", "kind": "color", "description": "rear-lenses", "evidenceRefs": ["canonical"]}], "surfaceDetail": {}, "evidenceRefs": ["canonical", "profile", "rear"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(181, 45, 53, 1)", "secondaryAlbedo": "rgba(181, 45, 53, 1)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRefs": ["full-object"], "componentId": "tail-lamps"}};
  node_tail_lamps_51.add(mesh_tail_lamps_51);
  meshes["tail-lamps"] = mesh_tail_lamps_51;
  colliders["tail-lamps"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["tail-lamps"] ??= [];
  destructionGroups["tail-lamps"].push(node_tail_lamps_51);
  const socket_tail_lamps_tail_lamps_mount_0 = new THREE.Object3D();
  socket_tail_lamps_tail_lamps_mount_0.name = "tail-lamps-mount";
  socket_tail_lamps_tail_lamps_mount_0.position.set(0.0, 0.0, 0.0);
  socket_tail_lamps_tail_lamps_mount_0.rotation.set(0, 0, 0);
  socket_tail_lamps_tail_lamps_mount_0.userData.socket = {"id": "tail-lamps-mount", "position": [0, 0, 0], "axis": [0, 1, 0]};
  node_tail_lamps_51.add(socket_tail_lamps_tail_lamps_mount_0);
  sockets["tail-lamps:tail-lamps-mount"] = socket_tail_lamps_tail_lamps_mount_0;

  const endpoint_indicators_52 = makeAttachmentEndpoint(null);
  const node_indicators_52 = new THREE.Group();
  node_indicators_52.name = "indicators__pivot";
  node_indicators_52.scale.set(1, 1, 1);
  if (endpoint_indicators_52) {
    node_indicators_52.position.copy(endpoint_indicators_52.start);
    node_indicators_52.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_indicators_52.position.set(0.0, 0.0, 0.0);
    node_indicators_52.rotation.set(0.0, 0.0, 0.0);
  }
  node_indicators_52.userData.sculptComponent = {"id": "indicators", "name": "indicators", "level": "micro", "role": "rigid mechanical part", "importance": 1, "confidence": 0.86, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Separate rigid hardware has its own mechanical boundary.", "geometryDescriptor": {"normalStrategy": "smooth indexed normals", "uvStrategy": "procedural solid color", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.012, "segments": 2}, "deformationStack": [], "roadSurface": {"kind": "hardware"}}, "parent": "root", "attachment": {"parentSocket": "root-to-indicators", "localStart": [0, 0.48874999582767487, 0.006000041961669922], "localEnd": [0, 0.48874999582767487, 0.006000041961669922], "contactType": "overlap", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.012, "parentId": "root"}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.85}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "rigid", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "indicators-mount", "position": [0, 0, 0], "axis": [0, 1, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "indicators", "seamRefs": [], "detachableFragments": ["indicators"], "breakImpulse": 12, "debrisMaterial": "hidden"}}, "material": "amber", "materialLayers": ["amber"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {}, "evidenceRefs": ["canonical", "profile", "rear"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(213, 139, 48, 1)", "secondaryAlbedo": "rgba(213, 139, 48, 1)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRefs": ["full-object"], "componentId": "indicators"}};
  node_indicators_52.userData.actionProfile = {"animationRole": "rigid", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "indicators-mount", "position": [0, 0, 0], "axis": [0, 1, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "indicators", "seamRefs": [], "detachableFragments": ["indicators"], "breakImpulse": 12, "debrisMaterial": "hidden"}};
  (nodes["root"] ?? root).add(node_indicators_52);
  nodes["indicators"] = node_indicators_52;
  const mesh_indicators_52Geometry = endpoint_indicators_52
    ? new THREE.CylinderGeometry(endpoint_indicators_52.endRadius, endpoint_indicators_52.baseRadius, endpoint_indicators_52.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_indicators_52) {
    mesh_indicators_52Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_indicators_52 = new THREE.Mesh(
    mesh_indicators_52Geometry,
    materialMap["amber"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_indicators_52.name = "indicators";
  if (endpoint_indicators_52) {
    mesh_indicators_52.position.copy(endpoint_indicators_52.midpoint);
    mesh_indicators_52.quaternion.copy(endpoint_indicators_52.quaternion);
  }
  mesh_indicators_52.castShadow = options.castShadow ?? true;
  mesh_indicators_52.receiveShadow = options.receiveShadow ?? true;
  mesh_indicators_52.userData.sculptComponent = {"id": "indicators", "name": "indicators", "level": "micro", "role": "rigid mechanical part", "importance": 1, "confidence": 0.86, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Separate rigid hardware has its own mechanical boundary.", "geometryDescriptor": {"normalStrategy": "smooth indexed normals", "uvStrategy": "procedural solid color", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.012, "segments": 2}, "deformationStack": [], "roadSurface": {"kind": "hardware"}}, "parent": "root", "attachment": {"parentSocket": "root-to-indicators", "localStart": [0, 0.48874999582767487, 0.006000041961669922], "localEnd": [0, 0.48874999582767487, 0.006000041961669922], "contactType": "overlap", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.012, "parentId": "root"}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.85}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "rigid", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "indicators-mount", "position": [0, 0, 0], "axis": [0, 1, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "indicators", "seamRefs": [], "detachableFragments": ["indicators"], "breakImpulse": 12, "debrisMaterial": "hidden"}}, "material": "amber", "materialLayers": ["amber"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {}, "evidenceRefs": ["canonical", "profile", "rear"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(213, 139, 48, 1)", "secondaryAlbedo": "rgba(213, 139, 48, 1)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRefs": ["full-object"], "componentId": "indicators"}};
  node_indicators_52.add(mesh_indicators_52);
  meshes["indicators"] = mesh_indicators_52;
  colliders["indicators"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["indicators"] ??= [];
  destructionGroups["indicators"].push(node_indicators_52);
  const socket_indicators_indicators_mount_0 = new THREE.Object3D();
  socket_indicators_indicators_mount_0.name = "indicators-mount";
  socket_indicators_indicators_mount_0.position.set(0.0, 0.0, 0.0);
  socket_indicators_indicators_mount_0.rotation.set(0, 0, 0);
  socket_indicators_indicators_mount_0.userData.socket = {"id": "indicators-mount", "position": [0, 0, 0], "axis": [0, 1, 0]};
  node_indicators_52.add(socket_indicators_indicators_mount_0);
  sockets["indicators:indicators-mount"] = socket_indicators_indicators_mount_0;

  const endpoint_bumpers_53 = makeAttachmentEndpoint(null);
  const node_bumpers_53 = new THREE.Group();
  node_bumpers_53.name = "bumpers__pivot";
  node_bumpers_53.scale.set(1, 1, 1);
  if (endpoint_bumpers_53) {
    node_bumpers_53.position.copy(endpoint_bumpers_53.start);
    node_bumpers_53.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_bumpers_53.position.set(0.0, 0.0, 0.0);
    node_bumpers_53.rotation.set(0.0, 0.0, 0.0);
  }
  node_bumpers_53.userData.sculptComponent = {"id": "bumpers", "name": "bumpers", "level": "micro", "role": "rigid mechanical part", "importance": 1, "confidence": 0.86, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Separate rigid hardware has its own mechanical boundary.", "geometryDescriptor": {"normalStrategy": "smooth indexed normals", "uvStrategy": "procedural solid color", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.012, "segments": 2}, "deformationStack": [], "roadSurface": {"kind": "hardware"}}, "parent": "root", "attachment": {"parentSocket": "root-to-bumpers", "localStart": [0, 0.4299999922513962, 0], "localEnd": [0, 0.4299999922513962, 0], "contactType": "overlap", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.012, "parentId": "root"}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.85}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "rigid", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "bumpers-mount", "position": [0, 0, 0], "axis": [0, 1, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "bumpers", "seamRefs": [], "detachableFragments": ["bumpers"], "breakImpulse": 12, "debrisMaterial": "hidden"}}, "material": "metal", "materialLayers": ["metal"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "integrated-trim", "kind": "bevel", "description": "integrated-trim", "evidenceRefs": ["canonical"]}], "surfaceDetail": {}, "evidenceRefs": ["canonical", "profile", "rear"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(179, 191, 197, 1)", "secondaryAlbedo": "rgba(179, 191, 197, 1)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRefs": ["full-object"], "componentId": "bumpers"}};
  node_bumpers_53.userData.actionProfile = {"animationRole": "rigid", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "bumpers-mount", "position": [0, 0, 0], "axis": [0, 1, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "bumpers", "seamRefs": [], "detachableFragments": ["bumpers"], "breakImpulse": 12, "debrisMaterial": "hidden"}};
  (nodes["root"] ?? root).add(node_bumpers_53);
  nodes["bumpers"] = node_bumpers_53;
  const mesh_bumpers_53Geometry = endpoint_bumpers_53
    ? new THREE.CylinderGeometry(endpoint_bumpers_53.endRadius, endpoint_bumpers_53.baseRadius, endpoint_bumpers_53.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_bumpers_53) {
    mesh_bumpers_53Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_bumpers_53 = new THREE.Mesh(
    mesh_bumpers_53Geometry,
    materialMap["metal"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_bumpers_53.name = "bumpers";
  if (endpoint_bumpers_53) {
    mesh_bumpers_53.position.copy(endpoint_bumpers_53.midpoint);
    mesh_bumpers_53.quaternion.copy(endpoint_bumpers_53.quaternion);
  }
  mesh_bumpers_53.castShadow = options.castShadow ?? true;
  mesh_bumpers_53.receiveShadow = options.receiveShadow ?? true;
  mesh_bumpers_53.userData.sculptComponent = {"id": "bumpers", "name": "bumpers", "level": "micro", "role": "rigid mechanical part", "importance": 1, "confidence": 0.86, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Separate rigid hardware has its own mechanical boundary.", "geometryDescriptor": {"normalStrategy": "smooth indexed normals", "uvStrategy": "procedural solid color", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.012, "segments": 2}, "deformationStack": [], "roadSurface": {"kind": "hardware"}}, "parent": "root", "attachment": {"parentSocket": "root-to-bumpers", "localStart": [0, 0.4299999922513962, 0], "localEnd": [0, 0.4299999922513962, 0], "contactType": "overlap", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.012, "parentId": "root"}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.85}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "rigid", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "bumpers-mount", "position": [0, 0, 0], "axis": [0, 1, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "bumpers", "seamRefs": [], "detachableFragments": ["bumpers"], "breakImpulse": 12, "debrisMaterial": "hidden"}}, "material": "metal", "materialLayers": ["metal"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "integrated-trim", "kind": "bevel", "description": "integrated-trim", "evidenceRefs": ["canonical"]}], "surfaceDetail": {}, "evidenceRefs": ["canonical", "profile", "rear"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(179, 191, 197, 1)", "secondaryAlbedo": "rgba(179, 191, 197, 1)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRefs": ["full-object"], "componentId": "bumpers"}};
  node_bumpers_53.add(mesh_bumpers_53);
  meshes["bumpers"] = mesh_bumpers_53;
  colliders["bumpers"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["bumpers"] ??= [];
  destructionGroups["bumpers"].push(node_bumpers_53);
  const socket_bumpers_bumpers_mount_0 = new THREE.Object3D();
  socket_bumpers_bumpers_mount_0.name = "bumpers-mount";
  socket_bumpers_bumpers_mount_0.position.set(0.0, 0.0, 0.0);
  socket_bumpers_bumpers_mount_0.rotation.set(0, 0, 0);
  socket_bumpers_bumpers_mount_0.userData.socket = {"id": "bumpers-mount", "position": [0, 0, 0], "axis": [0, 1, 0]};
  node_bumpers_53.add(socket_bumpers_bumpers_mount_0);
  sockets["bumpers:bumpers-mount"] = socket_bumpers_bumpers_mount_0;

  const endpoint_window_gaskets_54 = makeAttachmentEndpoint(null);
  const node_window_gaskets_54 = new THREE.Group();
  node_window_gaskets_54.name = "window-gaskets__pivot";
  node_window_gaskets_54.scale.set(1, 1, 1);
  if (endpoint_window_gaskets_54) {
    node_window_gaskets_54.position.copy(endpoint_window_gaskets_54.start);
    node_window_gaskets_54.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_window_gaskets_54.position.set(0.0, 0.0, 0.0);
    node_window_gaskets_54.rotation.set(0.0, 0.0, 0.0);
  }
  node_window_gaskets_54.userData.sculptComponent = {"id": "window-gaskets", "name": "window-gaskets", "level": "micro", "role": "rigid mechanical part", "importance": 1, "confidence": 0.86, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Separate rigid hardware has its own mechanical boundary.", "geometryDescriptor": {"normalStrategy": "smooth indexed normals", "uvStrategy": "procedural solid color", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.012, "segments": 2}, "deformationStack": [], "roadSurface": {"kind": "hardware"}}, "parent": "root", "attachment": {"parentSocket": "root-to-window-gaskets", "localStart": [0, 1.110107272863388, 0.3099999725818634], "localEnd": [0, 1.110107272863388, 0.3099999725818634], "contactType": "overlap", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.012, "parentId": "root"}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.85}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "rigid", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "window-gaskets-mount", "position": [0, 0, 0], "axis": [0, 1, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "window-gaskets", "seamRefs": [], "detachableFragments": ["window-gaskets"], "breakImpulse": 12, "debrisMaterial": "hidden"}}, "material": "rubber", "materialLayers": ["rubber"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {}, "evidenceRefs": ["canonical", "profile", "rear"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(36, 41, 44, 1)", "secondaryAlbedo": "rgba(36, 41, 44, 1)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRefs": ["full-object"], "componentId": "window-gaskets"}};
  node_window_gaskets_54.userData.actionProfile = {"animationRole": "rigid", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "window-gaskets-mount", "position": [0, 0, 0], "axis": [0, 1, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "window-gaskets", "seamRefs": [], "detachableFragments": ["window-gaskets"], "breakImpulse": 12, "debrisMaterial": "hidden"}};
  (nodes["root"] ?? root).add(node_window_gaskets_54);
  nodes["window-gaskets"] = node_window_gaskets_54;
  const mesh_window_gaskets_54Geometry = endpoint_window_gaskets_54
    ? new THREE.CylinderGeometry(endpoint_window_gaskets_54.endRadius, endpoint_window_gaskets_54.baseRadius, endpoint_window_gaskets_54.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_window_gaskets_54) {
    mesh_window_gaskets_54Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_window_gaskets_54 = new THREE.Mesh(
    mesh_window_gaskets_54Geometry,
    materialMap["rubber"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_window_gaskets_54.name = "window-gaskets";
  if (endpoint_window_gaskets_54) {
    mesh_window_gaskets_54.position.copy(endpoint_window_gaskets_54.midpoint);
    mesh_window_gaskets_54.quaternion.copy(endpoint_window_gaskets_54.quaternion);
  }
  mesh_window_gaskets_54.castShadow = options.castShadow ?? true;
  mesh_window_gaskets_54.receiveShadow = options.receiveShadow ?? true;
  mesh_window_gaskets_54.userData.sculptComponent = {"id": "window-gaskets", "name": "window-gaskets", "level": "micro", "role": "rigid mechanical part", "importance": 1, "confidence": 0.86, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Separate rigid hardware has its own mechanical boundary.", "geometryDescriptor": {"normalStrategy": "smooth indexed normals", "uvStrategy": "procedural solid color", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.012, "segments": 2}, "deformationStack": [], "roadSurface": {"kind": "hardware"}}, "parent": "root", "attachment": {"parentSocket": "root-to-window-gaskets", "localStart": [0, 1.110107272863388, 0.3099999725818634], "localEnd": [0, 1.110107272863388, 0.3099999725818634], "contactType": "overlap", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.012, "parentId": "root"}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.85}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "rigid", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "window-gaskets-mount", "position": [0, 0, 0], "axis": [0, 1, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "window-gaskets", "seamRefs": [], "detachableFragments": ["window-gaskets"], "breakImpulse": 12, "debrisMaterial": "hidden"}}, "material": "rubber", "materialLayers": ["rubber"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {}, "evidenceRefs": ["canonical", "profile", "rear"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(36, 41, 44, 1)", "secondaryAlbedo": "rgba(36, 41, 44, 1)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRefs": ["full-object"], "componentId": "window-gaskets"}};
  node_window_gaskets_54.add(mesh_window_gaskets_54);
  meshes["window-gaskets"] = mesh_window_gaskets_54;
  colliders["window-gaskets"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["window-gaskets"] ??= [];
  destructionGroups["window-gaskets"].push(node_window_gaskets_54);
  const socket_window_gaskets_window_gaskets_mount_0 = new THREE.Object3D();
  socket_window_gaskets_window_gaskets_mount_0.name = "window-gaskets-mount";
  socket_window_gaskets_window_gaskets_mount_0.position.set(0.0, 0.0, 0.0);
  socket_window_gaskets_window_gaskets_mount_0.rotation.set(0, 0, 0);
  socket_window_gaskets_window_gaskets_mount_0.userData.socket = {"id": "window-gaskets-mount", "position": [0, 0, 0], "axis": [0, 1, 0]};
  node_window_gaskets_54.add(socket_window_gaskets_window_gaskets_mount_0);
  sockets["window-gaskets:window-gaskets-mount"] = socket_window_gaskets_window_gaskets_mount_0;

  // repetition system: wheels (InstancedMesh, radial, count=4, level=meso)
  {
    const parent = nodes["root"] ?? root;
    const geo = new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
    const mat = materialMap["hidden"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 });
    // Contract (PLAN_1.5 WS-E): instanceScale is ABSOLUTE, in the parent pivot's
    // local units -- it is never multiplied by the parent component's own declared
    // dimensional scale. This falls out of the same fix as componentTree: the pivot
    // Group this cluster is parented to always carries identity scale (dimensions are
    // baked into that component's OWN geometry, not exposed on the Group), so an
    // instanced fastener/tooth/spoke sized [0.05, 0.05, 0.05] renders at exactly that
    // size regardless of how non-uniformly its host component is shaped, and a
    // `radial` ring's placement stays circular instead of being squashed into an
    // ellipse by a non-uniform host.
    const scl = [0.1, 0.1, 0.1];
    const axis = new THREE.Vector3(0.0, 0.0, 1.0).normalize();
    const radius = 0.0;
    const seed = Math.abs(axis.z) < 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
    const perp = new THREE.Vector3().crossVectors(axis, seed).normalize();
    // One InstancedMesh = one draw call for all repeated parts (teeth/fasteners/spokes),
    // replacing the former per-instance Mesh clone loop (real-time perf principle).
    const cluster = new THREE.InstancedMesh(geo, mat, 4);
    const _m = new THREE.Matrix4();
    const _p = new THREE.Vector3();
    const _q = new THREE.Quaternion();
    const _s = new THREE.Vector3(scl[0], scl[1], scl[2]);
    for (let i = 0; i < 4; i++) {
      const ang = ((0.0) + (i * 360) / 4) * Math.PI / 180;
      const dir = perp.clone().applyQuaternion(new THREE.Quaternion().setFromAxisAngle(axis, ang));
      _p.copy(radius > 0 ? dir.clone().multiplyScalar(radius * 0.5) : new THREE.Vector3());
      _q.setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir);
      _m.compose(_p, _q, _s);
      cluster.setMatrixAt(i, _m);
    }
    cluster.instanceMatrix.needsUpdate = true;
    cluster.castShadow = options.castShadow ?? true;
    cluster.receiveShadow = options.receiveShadow ?? true;
    cluster.name = "wheels";
    parent.add(cluster);
  }

  // repetition system: doors (InstancedMesh, radial, count=4, level=meso)
  {
    const parent = nodes["root"] ?? root;
    const geo = new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
    const mat = materialMap["hidden"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 });
    // Contract (PLAN_1.5 WS-E): instanceScale is ABSOLUTE, in the parent pivot's
    // local units -- it is never multiplied by the parent component's own declared
    // dimensional scale. This falls out of the same fix as componentTree: the pivot
    // Group this cluster is parented to always carries identity scale (dimensions are
    // baked into that component's OWN geometry, not exposed on the Group), so an
    // instanced fastener/tooth/spoke sized [0.05, 0.05, 0.05] renders at exactly that
    // size regardless of how non-uniformly its host component is shaped, and a
    // `radial` ring's placement stays circular instead of being squashed into an
    // ellipse by a non-uniform host.
    const scl = [0.1, 0.1, 0.1];
    const axis = new THREE.Vector3(0.0, 0.0, 1.0).normalize();
    const radius = 0.0;
    const seed = Math.abs(axis.z) < 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
    const perp = new THREE.Vector3().crossVectors(axis, seed).normalize();
    // One InstancedMesh = one draw call for all repeated parts (teeth/fasteners/spokes),
    // replacing the former per-instance Mesh clone loop (real-time perf principle).
    const cluster = new THREE.InstancedMesh(geo, mat, 4);
    const _m = new THREE.Matrix4();
    const _p = new THREE.Vector3();
    const _q = new THREE.Quaternion();
    const _s = new THREE.Vector3(scl[0], scl[1], scl[2]);
    for (let i = 0; i < 4; i++) {
      const ang = ((0.0) + (i * 360) / 4) * Math.PI / 180;
      const dir = perp.clone().applyQuaternion(new THREE.Quaternion().setFromAxisAngle(axis, ang));
      _p.copy(radius > 0 ? dir.clone().multiplyScalar(radius * 0.5) : new THREE.Vector3());
      _q.setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir);
      _m.compose(_p, _q, _s);
      cluster.setMatrixAt(i, _m);
    }
    cluster.instanceMatrix.needsUpdate = true;
    cluster.castShadow = options.castShadow ?? true;
    cluster.receiveShadow = options.receiveShadow ?? true;
    cluster.name = "doors";
    parent.add(cluster);
  }

  // repetition system: rims (InstancedMesh, radial, count=4, level=meso)
  {
    const parent = nodes["root"] ?? root;
    const geo = new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
    const mat = materialMap["hidden"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 });
    // Contract (PLAN_1.5 WS-E): instanceScale is ABSOLUTE, in the parent pivot's
    // local units -- it is never multiplied by the parent component's own declared
    // dimensional scale. This falls out of the same fix as componentTree: the pivot
    // Group this cluster is parented to always carries identity scale (dimensions are
    // baked into that component's OWN geometry, not exposed on the Group), so an
    // instanced fastener/tooth/spoke sized [0.05, 0.05, 0.05] renders at exactly that
    // size regardless of how non-uniformly its host component is shaped, and a
    // `radial` ring's placement stays circular instead of being squashed into an
    // ellipse by a non-uniform host.
    const scl = [0.1, 0.1, 0.1];
    const axis = new THREE.Vector3(0.0, 0.0, 1.0).normalize();
    const radius = 0.0;
    const seed = Math.abs(axis.z) < 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
    const perp = new THREE.Vector3().crossVectors(axis, seed).normalize();
    // One InstancedMesh = one draw call for all repeated parts (teeth/fasteners/spokes),
    // replacing the former per-instance Mesh clone loop (real-time perf principle).
    const cluster = new THREE.InstancedMesh(geo, mat, 4);
    const _m = new THREE.Matrix4();
    const _p = new THREE.Vector3();
    const _q = new THREE.Quaternion();
    const _s = new THREE.Vector3(scl[0], scl[1], scl[2]);
    for (let i = 0; i < 4; i++) {
      const ang = ((0.0) + (i * 360) / 4) * Math.PI / 180;
      const dir = perp.clone().applyQuaternion(new THREE.Quaternion().setFromAxisAngle(axis, ang));
      _p.copy(radius > 0 ? dir.clone().multiplyScalar(radius * 0.5) : new THREE.Vector3());
      _q.setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir);
      _m.compose(_p, _q, _s);
      cluster.setMatrixAt(i, _m);
    }
    cluster.instanceMatrix.needsUpdate = true;
    cluster.castShadow = options.castShadow ?? true;
    cluster.receiveShadow = options.receiveShadow ?? true;
    cluster.name = "rims";
    parent.add(cluster);
  }

  root.userData.sculptRuntime = { nodes, meshes, sockets, colliders, destructionGroups } satisfies ProceduralModelRuntime;
  root.userData.lookDevTargets = {"qualityPriority": "reference-fidelity", "materialPass": {"albedoPaletteRequired": true, "roughnessVariationRequired": true, "normalOrBumpRequired": true, "localOverridesRequired": true, "minimumTextureResolution": 1024, "preferredTextureResolution": 2048, "independentMapChannels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "requiredSurfaceFrequencyBands": ["macro", "meso", "micro"], "geometryReliefRequiredWhenSilhouetteAffected": true, "referencePbrExtraction": {"requiredWhenSourceImagePresent": true, "targetThreshold": 0.7, "stopOnLowConfidence": true, "script": "forge/stage1_intake/extract_pbr_evidence.py", "acceptedLimitation": "single-image extraction is reference-derived inference, not exact photogrammetry"}, "mustAvoid": ["single flat albedo per material", "uniform roughness", "albedo texture reused as roughness/height/normal/AO", "single-frequency random noise", "plastic-looking smooth bark, stone, cloth, foliage, or aged material", "local color/detail described only in prose without material masks", "claiming exact PBR recovery when confidence is below the target threshold"], "texturelessRationale": "Uniform paint, unpatterned lenses and rubber in original generated sedan reference: preserve geometric highlights, use solid PBR values and procedural studio environment; no projected photograph."}, "lightingPass": {"requiredTerms": ["key light", "fill light", "rim or environment light", "exposure", "tone mapping", "background", "contact shadow"], "mustAvoid": ["ambient-only lighting", "flat value range", "missing contact shadow", "reference lighting copied without separating material readability"]}, "screenshotReview": ["Compare albedo palette and local color zones.", "Compare roughness/normal/bump response under light.", "Compare cavity dirt, edge wear, stains, moss, scratches, or other local masks.", "Compare key/fill/rim structure, exposure, tone mapping, background, and contact shadows.", "Capture a neutral-light render to verify material readability without reference lighting.", "Capture a grazing-light close-up to expose flat normals, uniform roughness, tiling, and plastic highlights.", "Capture a reference-matched render from the same camera framing as the source."]};
  root.userData.actionReadiness = {
    note: 'Use root.userData.sculptRuntime.nodes for transforms, sockets for attachments, colliders for physics proxies, and destructionGroups for breakable sets.',
  };
  return root;
}

export function createOrangeFourDoorCrewCabPickupLookDevLights(
  mode: 'neutral' | 'grazing' | 'reference' = 'neutral',
): THREE.Group {
  const lights = new THREE.Group();
  lights.name = "orange four-door crew-cab pickup look-dev lights";
  const hemi = new THREE.HemisphereLight(
    mode === 'reference' ? 0xfff0d6 : 0xf2f4ff,
    0x363b42,
    mode === 'grazing' ? 0.28 : mode === 'reference' ? 0.72 : 0.85,
  );
  lights.add(hemi);
  const key = new THREE.DirectionalLight(
    mode === 'reference' ? 0xffcf8a : 0xfff4e8,
    mode === 'grazing' ? 4.2 : mode === 'reference' ? 2.6 : 2.15,
  );
  if (mode === 'grazing') key.position.set(7.5, 1.1, 4.0);
  else if (mode === 'reference') key.position.set(-4.5, 7.5, 5.0);
  else key.position.set(-4.0, 6.0, 5.5);
  key.castShadow = true;
  key.shadow.mapSize.set(4096, 4096);
  key.shadow.bias = -0.00025;
  key.shadow.normalBias = 0.018;
  key.shadow.radius = 7;
  key.shadow.blurSamples = 24;
  key.shadow.camera.near = 0.5;
  key.shadow.camera.far = 30;
  key.shadow.camera.left = -2.6;
  key.shadow.camera.right = 2.6;
  key.shadow.camera.top = 2.6;
  key.shadow.camera.bottom = -2.6;
  key.shadow.camera.updateProjectionMatrix();
  lights.add(key);
  const fill = new THREE.DirectionalLight(0xa8c4ff, mode === 'grazing' ? 0.12 : 0.42);
  fill.position.set(4.0, 3.0, 3.5);
  lights.add(fill);
  const rim = new THREE.DirectionalLight(0xfff1c4, mode === 'grazing' ? 0.28 : 0.85);
  rim.position.set(0.5, 4.5, -6.0);
  lights.add(rim);
  lights.userData.reviewMode = mode;
  lights.userData.lightingFromPhoto = ["Key light warm [4,7,-5], intensity3.3; cool fill [-5,4,3] .8; hemisphere1.1.", "Procedural studio PMREM reflections; exposure1.0 ACES Filmic tone mapping, sRGB output, background #c4c8cd.", "Ground #afb4ba, soft PCF contact shadow 2048, bias-.00015; selectable neutral and grazing controls provide relief checks."];
  lights.userData.lookDevTargets = {"qualityPriority": "reference-fidelity", "materialPass": {"albedoPaletteRequired": true, "roughnessVariationRequired": true, "normalOrBumpRequired": true, "localOverridesRequired": true, "minimumTextureResolution": 1024, "preferredTextureResolution": 2048, "independentMapChannels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "requiredSurfaceFrequencyBands": ["macro", "meso", "micro"], "geometryReliefRequiredWhenSilhouetteAffected": true, "referencePbrExtraction": {"requiredWhenSourceImagePresent": true, "targetThreshold": 0.7, "stopOnLowConfidence": true, "script": "forge/stage1_intake/extract_pbr_evidence.py", "acceptedLimitation": "single-image extraction is reference-derived inference, not exact photogrammetry"}, "mustAvoid": ["single flat albedo per material", "uniform roughness", "albedo texture reused as roughness/height/normal/AO", "single-frequency random noise", "plastic-looking smooth bark, stone, cloth, foliage, or aged material", "local color/detail described only in prose without material masks", "claiming exact PBR recovery when confidence is below the target threshold"], "texturelessRationale": "Uniform paint, unpatterned lenses and rubber in original generated sedan reference: preserve geometric highlights, use solid PBR values and procedural studio environment; no projected photograph."}, "lightingPass": {"requiredTerms": ["key light", "fill light", "rim or environment light", "exposure", "tone mapping", "background", "contact shadow"], "mustAvoid": ["ambient-only lighting", "flat value range", "missing contact shadow", "reference lighting copied without separating material readability"]}, "screenshotReview": ["Compare albedo palette and local color zones.", "Compare roughness/normal/bump response under light.", "Compare cavity dirt, edge wear, stains, moss, scratches, or other local masks.", "Compare key/fill/rim structure, exposure, tone mapping, background, and contact shadows.", "Capture a neutral-light render to verify material readability without reference lighting.", "Capture a grazing-light close-up to expose flat normals, uniform roughness, tiling, and plastic highlights.", "Capture a reference-matched render from the same camera framing as the source."]};
  return lights;
}

// PBR materials (clearcoat/iridescence/transmission/anisotropy) need an environment
// map to visually behave as intended — call this once per renderer and assign the
// result to scene.environment before rendering. No external HDR asset required.
export function createOrangeFourDoorCrewCabPickupEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const texture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
  return texture;
}

// Plan 1.3 §3.2 — auto-framing by bounding box. The Divine Eye can only compare a
// render to the reference if the object is FRAMED consistently (an object framed
// differently scores as wrong even when its shape is right). This positions the camera
// deterministically from the object's bounding box so it fills the frame at a stable
// margin, and sets near/far to the object scale. Call after adding the model to the
// scene, and again on resize (after updating camera.aspect).
export function frameOrangeFourDoorCrewCabPickupCamera(
  camera: THREE.PerspectiveCamera,
  object: THREE.Object3D,
  options: { margin?: number; azimuthDeg?: number; elevationDeg?: number } = {},
): void {
  const box = new THREE.Box3().setFromObject(object);
  if (box.isEmpty()) return;
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const margin = options.margin ?? 1.15;
  const maxDim = Math.max(size.x, size.y, size.z) * margin;
  const fov = (camera.fov * Math.PI) / 180;
  // distance so the largest object dimension fits vertically in the frame
  const distance = (maxDim / 2) / Math.tan(fov / 2);
  const az = ((options.azimuthDeg ?? 0) * Math.PI) / 180;
  const el = ((options.elevationDeg ?? 0) * Math.PI) / 180;
  const dir = new THREE.Vector3(
    Math.sin(az) * Math.cos(el),
    Math.sin(el),
    Math.cos(az) * Math.cos(el),
  );
  camera.position.copy(center).addScaledVector(dir, distance);
  camera.near = Math.max(0.01, distance - maxDim);
  camera.far = distance + maxDim * 2;
  camera.lookAt(center);
  camera.updateProjectionMatrix();
}

// Plan 1.3 §3.2c — PRESENTATION composer (DOF + bloom). CRITICAL (R-POSTFX): this is
// for the showcase/hero render ONLY. The Divine Eye's EVALUATION render MUST use a
// plain renderer with NO composer — bloom blows highlights and DOF blurs edges, which
// would corrupt the deterministic IoU/DCD/edge/blowout signals. Enable dof/bloom ONLY
// when the reference photo actually exhibits them (detect_reference_effects.py authorizes).
export function createOrangeFourDoorCrewCabPickupPresentationComposer(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  options: { dof?: boolean; bloom?: boolean; bloomStrength?: number; dofFocus?: number; dofAperture?: number } = {},
): EffectComposer {
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  if (options.dof) {
    composer.addPass(new BokehPass(scene, camera, {
      focus: options.dofFocus ?? 10.0,
      aperture: options.dofAperture ?? 0.0002,
      maxblur: 0.01,
    }));
  }
  if (options.bloom) {
    const size = new THREE.Vector2();
    renderer.getSize(size);
    composer.addPass(new UnrealBloomPass(size, options.bloomStrength ?? 0.4, 0.4, 0.85));
  }
  return composer;
}

export function configureOrangeFourDoorCrewCabPickupRenderer(renderer: THREE.WebGLRenderer): void {
  // Load-bearing for view-dependent finishes (anodized / Doppler): without ACES + sRGB
  // the environment reflection reads flat/washed instead of a believable metal response.
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
}

export function createOrangeFourDoorCrewCabPickupInspectControls(
  camera: THREE.Camera,
  domElement: HTMLElement,
): OrbitControls {
  // View-dependent finishes only read correctly once the user orbits — their color
  // comes from the environment reflection, not albedo, so free rotation matters here.
  const controls = new OrbitControls(camera, domElement);
  controls.enableDamping = true;
  controls.minDistance = 1.0;
  controls.maxDistance = 8.0;
  controls.autoRotate = false;
  return controls;
}
