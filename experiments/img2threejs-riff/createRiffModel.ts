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

type SdfVector = readonly [number, number, number];
type SdfTransform = { position?: SdfVector; translation?: SdfVector; rotation?: SdfVector; scale?: SdfVector };
type SdfPrimitive = {
  readonly id: string;
  readonly type: 'sphere' | 'capsule' | 'box' | 'cone' | 'ellipsoid';
  readonly center?: SdfVector;
  readonly radius?: number | SdfVector;
  readonly height?: number;
  readonly size?: SdfVector;
  readonly dimensions?: SdfVector;
  readonly radii?: SdfVector;
  readonly transform?: SdfTransform;
};
type SdfOperation = {
  readonly id?: string;
  readonly output?: string;
  readonly type: 'smooth-union' | 'subtract' | 'intersect';
  readonly left: string;
  readonly right: string;
  readonly radius?: number;
};
type SdfDescriptor = {
  readonly primitives: readonly SdfPrimitive[];
  readonly operations?: readonly SdfOperation[];
  readonly resolution: number;
  readonly bounds?: { readonly min: SdfVector; readonly max: SdfVector };
};
type SdfFunction = (point: THREE.Vector3) => number;

function sdfSphere(point: THREE.Vector3, radius: number): number {
  return point.length() - radius;
}

function sdfCapsule(point: THREE.Vector3, radius: number, height: number): number {
  const halfHeight = height * 0.5;
  const y = Math.max(-halfHeight, Math.min(halfHeight, point.y));
  return point.distanceTo(new THREE.Vector3(0, y, 0)) - radius;
}

function sdfBox(point: THREE.Vector3, size: SdfVector): number {
  const q = new THREE.Vector3(Math.abs(point.x), Math.abs(point.y), Math.abs(point.z))
    .sub(new THREE.Vector3(size[0] * 0.5, size[1] * 0.5, size[2] * 0.5));
  return q.clone().max(new THREE.Vector3()).length() + Math.min(Math.max(q.x, q.y, q.z), 0);
}

function sdfCone(point: THREE.Vector3, radius: number, height: number): number {
  const halfHeight = height * 0.5;
  const taper = radius * (1 - (point.y + halfHeight) / height);
  return Math.max(Math.hypot(point.x, point.z) - Math.max(0, taper), Math.abs(point.y) - halfHeight);
}

function sdfEllipsoid(point: THREE.Vector3, radii: SdfVector): number {
  const scaled = new THREE.Vector3(point.x / radii[0], point.y / radii[1], point.z / radii[2]);
  return (scaled.length() - 1) * Math.min(radii[0], radii[1], radii[2]);
}

function sdfRadii(primitive: SdfPrimitive): SdfVector {
  const radius = primitive.radius;
  if (primitive.radii) return primitive.radii;
  if (typeof radius === 'number') return [radius, radius, radius];
  return radius ?? [0.5, 0.5, 0.5];
}

function smin(left: number, right: number, radius: number): number {
  const blend = Math.max(radius - Math.abs(left - right), 0) / radius;
  return Math.min(left, right) - blend * blend * radius * 0.25;
}

function sdfLocalPoint(point: THREE.Vector3, primitive: SdfPrimitive): { point: THREE.Vector3; scale: number } {
  const transform = primitive.transform;
  const translation = transform?.position ?? transform?.translation ?? primitive.center ?? [0, 0, 0];
  const rotation = transform?.rotation ?? [0, 0, 0];
  const scale = transform?.scale ?? [1, 1, 1];
  const local = point.clone().sub(new THREE.Vector3(translation[0], translation[1], translation[2]));
  const inverseRotation = new THREE.Quaternion()
    .setFromEuler(new THREE.Euler(rotation[0], rotation[1], rotation[2]))
    .invert();
  local.applyQuaternion(inverseRotation);
  local.set(local.x / scale[0], local.y / scale[1], local.z / scale[2]);
  return { point: local, scale: Math.min(scale[0], scale[1], scale[2]) };
}

function sdfPrimitive(point: THREE.Vector3, primitive: SdfPrimitive): number {
  const local = sdfLocalPoint(point, primitive);
  let distance: number;
  switch (primitive.type) {
    case 'sphere':
      distance = sdfSphere(local.point, typeof primitive.radius === 'number' ? primitive.radius : 0.5);
      break;
    case 'capsule':
      distance = sdfCapsule(local.point, typeof primitive.radius === 'number' ? primitive.radius : 0.25, primitive.height ?? 1);
      break;
    case 'box':
      distance = sdfBox(local.point, primitive.size ?? primitive.dimensions ?? [1, 1, 1]);
      break;
    case 'cone':
      distance = sdfCone(local.point, typeof primitive.radius === 'number' ? primitive.radius : 0.5, primitive.height ?? 1);
      break;
    case 'ellipsoid':
      distance = sdfEllipsoid(local.point, sdfRadii(primitive));
      break;
  }
  return distance * local.scale;
}

function sdfSample(descriptor: SdfDescriptor): SdfFunction {
  const nodes = new Map<string, SdfFunction>();
  for (const primitive of descriptor.primitives) nodes.set(primitive.id, (point) => sdfPrimitive(point, primitive));
  let result = descriptor.primitives.length > 0 ? nodes.get(descriptor.primitives[0].id) : undefined;
  for (let index = 0; index < (descriptor.operations?.length ?? 0); index += 1) {
    const operation = descriptor.operations?.[index];
    if (!operation) continue;
    const left = nodes.get(operation.left);
    const right = nodes.get(operation.right);
    if (!left || !right) continue;
    let combined: SdfFunction;
    switch (operation.type) {
      case 'smooth-union':
        combined = (point) => smin(left(point), right(point), operation.radius ?? 0.1);
        break;
      case 'subtract':
        combined = (point) => Math.max(left(point), -right(point));
        break;
      case 'intersect':
        combined = (point) => Math.max(left(point), right(point));
        break;
    }
    nodes.set(operation.id ?? operation.output ?? `operation-${index}`, combined);
    result = combined;
  }
  return result ?? (() => Infinity);
}

function polygonizeSdf(descriptor: SdfDescriptor): THREE.BufferGeometry {
  // SURFACE NETS, not a voxel shell.
  //
  // This used to emit one axis-aligned quad per exposed voxel face, which is a Minecraft surface:
  // every face is axis-aligned, every edge is a 90-degree step, and the result is stair-stepped at
  // exactly the scale of the sampling grid. For a subject whose whole identity is smooth blended
  // organic form -- which is the only kind of subject anyone reaches for an implicit surface to
  // build -- that is worse than the assembled primitives it was meant to replace.
  //
  // Naive surface nets places ONE vertex per sign-changing cell, at the average of the linearly
  // interpolated crossings on that cell's edges, and joins the four cells around each crossing
  // edge into a quad. It is compact, manifold, and smooth, and it is a natural fit for a field
  // that can be sampled anywhere rather than only at corners.
  //
  // Normals come from the field GRADIENT, not from face averaging: the gradient is the exact
  // surface normal of the implicit surface, so shading no longer carries the grid's imprint.
  const resolution = Math.max(4, Math.min(64, Math.floor(descriptor.resolution)));
  const defaultBounds: { readonly min: SdfVector; readonly max: SdfVector } = { min: [-2, -2, -2], max: [2, 2, 2] };
  const bounds = descriptor.bounds ?? defaultBounds;
  const min = new THREE.Vector3(bounds.min[0], bounds.min[1], bounds.min[2]);
  const step = new THREE.Vector3(
    (bounds.max[0] - bounds.min[0]) / resolution,
    (bounds.max[1] - bounds.min[1]) / resolution,
    (bounds.max[2] - bounds.min[2]) / resolution,
  );
  const sample = sdfSample(descriptor);
  const scratch = new THREE.Vector3();

  // Corner grid: one more corner than cells on each axis.
  const side = resolution + 1;
  const field = new Float32Array(side * side * side);
  const cornerAt = (x: number, y: number, z: number): number => (z * side + y) * side + x;
  for (let z = 0; z < side; z += 1) {
    for (let y = 0; y < side; y += 1) {
      for (let x = 0; x < side; x += 1) {
        scratch.set(min.x + x * step.x, min.y + y * step.y, min.z + z * step.z);
        field[cornerAt(x, y, z)] = sample(scratch);
      }
    }
  }

  // The 12 cell edges as corner-offset pairs.
  const CUBE_EDGES: readonly (readonly [number, number, number, number, number, number])[] = [
    [0, 0, 0, 1, 0, 0], [1, 0, 0, 1, 1, 0], [0, 1, 0, 1, 1, 0], [0, 0, 0, 0, 1, 0],
    [0, 0, 1, 1, 0, 1], [1, 0, 1, 1, 1, 1], [0, 1, 1, 1, 1, 1], [0, 0, 1, 0, 1, 1],
    [0, 0, 0, 0, 0, 1], [1, 0, 0, 1, 0, 1], [1, 1, 0, 1, 1, 1], [0, 1, 0, 0, 1, 1],
  ];

  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  const cellVertex = new Int32Array(resolution * resolution * resolution).fill(-1);
  const cellAt = (x: number, y: number, z: number): number => (z * resolution + y) * resolution + x;

  // Central-difference gradient, stepped at a fraction of a cell so it follows the field rather
  // than the grid.
  const epsilon = Math.min(step.x, step.y, step.z) * 0.25;
  const gradient = (point: THREE.Vector3): THREE.Vector3 => {
    const gx = sample(scratch.set(point.x + epsilon, point.y, point.z))
      - sample(scratch.set(point.x - epsilon, point.y, point.z));
    const gy = sample(scratch.set(point.x, point.y + epsilon, point.z))
      - sample(scratch.set(point.x, point.y - epsilon, point.z));
    const gz = sample(scratch.set(point.x, point.y, point.z + epsilon))
      - sample(scratch.set(point.x, point.y, point.z - epsilon));
    const normal = new THREE.Vector3(gx, gy, gz);
    // A point where the field is flat has no defined normal; +Y is arbitrary but finite, and
    // leaving a zero vector would poison every lighting calculation downstream.
    return normal.lengthSq() < 1e-20 ? new THREE.Vector3(0, 1, 0) : normal.normalize();
  };

  for (let z = 0; z < resolution; z += 1) {
    for (let y = 0; y < resolution; y += 1) {
      for (let x = 0; x < resolution; x += 1) {
        let crossings = 0;
        let sumX = 0;
        let sumY = 0;
        let sumZ = 0;
        for (const [ax, ay, az, bx, by, bz] of CUBE_EDGES) {
          const a = field[cornerAt(x + ax, y + ay, z + az)];
          const b = field[cornerAt(x + bx, y + by, z + bz)];
          if ((a <= 0) === (b <= 0)) continue;
          const t = a / (a - b);
          sumX += (ax + (bx - ax) * t);
          sumY += (ay + (by - ay) * t);
          sumZ += (az + (bz - az) * t);
          crossings += 1;
        }
        if (crossings === 0) continue;
        const px = min.x + (x + sumX / crossings) * step.x;
        const py = min.y + (y + sumY / crossings) * step.y;
        const pz = min.z + (z + sumZ / crossings) * step.z;
        cellVertex[cellAt(x, y, z)] = positions.length / 3;
        positions.push(px, py, pz);
        const normal = gradient(new THREE.Vector3(px, py, pz));
        normals.push(normal.x, normal.y, normal.z);
      }
    }
  }

  // One quad per sign-changing grid edge, joining the four cells that share it.
  //
  // Winding, worked out rather than guessed. For the +x edge from corner (x,y,z), the four cells
  // around it are (x, y-1, z-1), (x, y, z-1), (x, y, z), (x, y-1, z); in the (y,z) plane that
  // traversal is +y, +z, -y, whose cross product is +x. So when the corner is INSIDE and its
  // neighbour is outside, the unflipped order already faces out, and the flip belongs on the
  // opposite case. Getting this backwards is invisible in the normals -- those come from the
  // gradient and stay correct -- and shows only as back-face culling removing the front surface,
  // i.e. the model rendering as a hollow shell with its interior visible.
  const quad = (a: number, b: number, c: number, d: number, flip: boolean): void => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    if (flip) indices.push(a, c, b, a, d, c);
    else indices.push(a, b, c, a, c, d);
  };
  // Each quad joins the FOUR cells sharing one grid edge, so every one of those cells must exist.
  // Bounding only the edge axis and the lower end of the other two let y/z reach `resolution`, which
  // is a corner index, not a cell index: `cellAt` then strides into an unrelated slot (with
  // resolution 8, `cellAt(3, 8, 1)` is 131 -- the slot for cell (3, 0, 2)) or past the end of the
  // array, where a typed-array read yields `undefined`. `undefined < 0` is false, so the guard in
  // `quad` passed it through to `setIndex`, which coerces it to 0. Measured on a sphere reaching its
  // own bounds at resolution 8: 60 out-of-range reads and 108 aliased reads. A surface that touches
  // the sampling box is therefore left OPEN at that face rather than closed with wrong triangles --
  // pad `bounds` past the surface to get a closed mesh.
  for (let z = 0; z < side; z += 1) {
    for (let y = 0; y < side; y += 1) {
      for (let x = 0; x < side; x += 1) {
        const here = field[cornerAt(x, y, z)] <= 0;
        if (x + 1 < side && y > 0 && z > 0 && y < side - 1 && z < side - 1
          && here !== (field[cornerAt(x + 1, y, z)] <= 0)) {
          quad(
            cellVertex[cellAt(x, y - 1, z - 1)], cellVertex[cellAt(x, y, z - 1)],
            cellVertex[cellAt(x, y, z)], cellVertex[cellAt(x, y - 1, z)], !here,
          );
        }
        if (y + 1 < side && x > 0 && z > 0 && x < side - 1 && z < side - 1
          && here !== (field[cornerAt(x, y + 1, z)] <= 0)) {
          quad(
            cellVertex[cellAt(x - 1, y, z - 1)], cellVertex[cellAt(x - 1, y, z)],
            cellVertex[cellAt(x, y, z)], cellVertex[cellAt(x, y, z - 1)], !here,
          );
        }
        if (z + 1 < side && x > 0 && y > 0 && x < side - 1 && y < side - 1
          && here !== (field[cornerAt(x, y, z + 1)] <= 0)) {
          quad(
            cellVertex[cellAt(x - 1, y - 1, z)], cellVertex[cellAt(x, y - 1, z)],
            cellVertex[cellAt(x, y, z)], cellVertex[cellAt(x - 1, y, z)], !here,
          );
        }
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return geometry;
}

// bevelEnabled defaults to true on THREE.ExtrudeGeometry and rounds every
// corner — sharp/pointed profiles (blades, fork tines, spikes) need
// bevelEnabled: false plus lineTo()-only path segments near the tip, since a
// curve command cannot produce a true converging point.
function buildExtrudeShape(points: [number, number][], holes?: [number, number][][]): THREE.Shape {
  const shape = new THREE.Shape();
  if (points.length > 0) {
    shape.moveTo(points[0][0], points[0][1]);
    for (let i = 1; i < points.length; i += 1) {
      shape.lineTo(points[i][0], points[i][1]);
    }
  }
  // Cutouts (e.g. an oval wire-cutter hole) as THREE.Path added to shape.holes —
  // dep-free boolean subtraction via the tessellator, no CSG library needed.
  for (const loop of holes ?? []) {
    if (loop.length < 3) continue;
    const path = new THREE.Path();
    path.moveTo(loop[0][0], loop[0][1]);
    for (let i = 1; i < loop.length; i += 1) path.lineTo(loop[i][0], loop[i][1]);
    path.closePath();
    shape.holes.push(path);
  }
  return shape;
}

// Build an N-gon oval loop (for hole authoring from a compact {cx,cy,rx,ry} descriptor).
function ovalLoop(cx: number, cy: number, rx: number, ry: number, seg = 24): [number, number][] {
  const loop: [number, number][] = [];
  for (let i = 0; i < seg; i += 1) {
    const a = (i / seg) * Math.PI * 2;
    loop.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
  }
  return loop;
}

function buildExtrudeGeometry(profile: { points: [number, number][]; depth: number; holes?: [number, number][][]; ovalHoles?: { cx: number; cy: number; rx: number; ry: number }[] }): THREE.ExtrudeGeometry {
  const holes = [...(profile.holes ?? []), ...((profile.ovalHoles ?? []).map((o) => ovalLoop(o.cx, o.cy, o.rx, o.ry)))];
  const shape = buildExtrudeShape(profile.points, holes);
  return new THREE.ExtrudeGeometry(shape, {
    depth: profile.depth,
    bevelEnabled: false,
    steps: 1,
  });
}

function buildTubeGeometry(
  path: { points: [number, number, number][]; radius?: number; radialSegments?: number; closed?: boolean },
): THREE.TubeGeometry {
  const vectors = path.points.map(([x, y, z]) => new THREE.Vector3(x, y, z));
  const curve = new THREE.CatmullRomCurve3(vectors, path.closed ?? false);
  const tubularSegments = Math.max(8, path.points.length * 6);
  return new THREE.TubeGeometry(curve, tubularSegments, path.radius ?? 0.05, path.radialSegments ?? 8, path.closed ?? false);
}

type TaperedStation = { position: [number, number, number]; rx: number; rz: number; twist?: number };

// Frames come from PARALLEL TRANSPORT, not from a Frenet frame. A Frenet frame is defined by
// the curve's normal, which flips sign wherever the path has an inflection or straightens out,
// and every flip twists the surface 180 degrees within one segment. Carrying the previous frame
// forward and removing only its along-path component keeps the twist continuous. THREE's own
// extrudePath and TubeGeometry do not expose this, which is why this is hand-built.
function buildTaperedSweepGeometry(
  sweep: { stations: TaperedStation[]; radialSegments?: number; capEnds?: boolean; fixedFrame?: string },
): THREE.BufferGeometry {
  const input = sweep.stations;
  const stations: TaperedStation[] = [];
  for(let i=0;i<input.length-1;i++){
    const a=input[Math.max(0,i-1)], b=input[i], c=input[i+1], d=input[Math.min(input.length-1,i+2)];
    for(let n=0;n<4;n++){const t=n/4;const interp=(x:number,y:number,z:number,w:number)=>.5*((2*y)+(-x+z)*t+(2*x-5*y+4*z-w)*t*t+(-x+3*y-3*z+w)*t*t*t);
      stations.push({position:b.position.map((v,k)=>interp(a.position[k],v,c.position[k],d.position[k])) as [number,number,number],rx:Math.max(0,interp(a.rx,b.rx,c.rx,d.rx)),rz:Math.max(0,interp(a.rz,b.rz,c.rz,d.rz)),twist:interp(a.twist||0,b.twist||0,c.twist||0,d.twist||0)});
    }
  }stations.push(input[input.length-1]);
  if (stations.length < 2) throw new Error('tapered-sweep needs at least two stations');
  const radial = Math.max(3, sweep.radialSegments ?? 10);
  const centres = stations.map((s) => new THREE.Vector3(...s.position));

  const tangents = centres.map((_, i) => {
    const prev = centres[Math.max(0, i - 1)];
    const next = centres[Math.min(centres.length - 1, i + 1)];
    const t = next.clone().sub(prev);
    // Coincident neighbours would normalise to NaN and poison every downstream vertex.
    return t.lengthSq() < 1e-12 ? new THREE.Vector3(0, 1, 0) : t.normalize();
  });

  // Seed a reference axis that is not parallel to the first tangent, or the first cross
  // product is degenerate and the whole sweep collapses to a line.
  let ref = new THREE.Vector3(0, 0, 1);
  if (Math.abs(tangents[0].dot(ref)) > 0.9) ref = new THREE.Vector3(1, 0, 0);

  const normals: THREE.Vector3[] = [];
  const binormals: THREE.Vector3[] = [];
  let carried = ref.clone().sub(tangents[0].clone().multiplyScalar(ref.dot(tangents[0]))).normalize();
  for (let i = 0; i < tangents.length; i += 1) {
    const t = tangents[i];
    // Project the carried frame back onto the plane perpendicular to this tangent.
    const n = carried.clone().sub(t.clone().multiplyScalar(carried.dot(t)));
    if (n.lengthSq() < 1e-12) {
      const fallback = Math.abs(t.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
      n.copy(fallback.sub(t.clone().multiplyScalar(fallback.dot(t))));
    }
    if(sweep.fixedFrame==='horizontal'){normals.push(new THREE.Vector3(0,0,1));binormals.push(new THREE.Vector3(1,0,0));carried=new THREE.Vector3(0,0,1);continue;}
    n.normalize();
    normals.push(n);
    binormals.push(new THREE.Vector3().crossVectors(t, n).normalize());
    carried = n;
  }

  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const ringStart: number[] = [];
  const isPoint: boolean[] = [];

  for (let i = 0; i < stations.length; i += 1) {
    const st = stations[i];
    const v = i / (stations.length - 1);
    ringStart.push(positions.length / 3);
    // A station whose section has collapsed emits ONE vertex, not a ring of radius zero.
    // A degenerate ring still carries `radial` coincident vertices and `radial` zero-area
    // triangles, so the lock ends in a blunt cap the width of the floating-point noise
    // rather than at a point -- and a hair lock, a horn or a blade tip has to reach a point.
    if (st.rx <= 1e-6 && st.rz <= 1e-6) {
      isPoint.push(true);
      positions.push(centres[i].x, centres[i].y, centres[i].z);
      uvs.push(0.5, v);
      continue;
    }
    isPoint.push(false);
    const twist = ((st.twist ?? 0) * Math.PI) / 180;
    for (let j = 0; j <= radial; j += 1) {
      const theta = (j / radial) * Math.PI * 2 + twist;
      const offset = normals[i].clone().multiplyScalar(Math.cos(theta) * st.rx)
        .add(binormals[i].clone().multiplyScalar(Math.sin(theta) * st.rz));
      const p = centres[i].clone().add(offset);
      positions.push(p.x, p.y, p.z);
      uvs.push(j / radial, v);
    }
  }

  for (let i = 0; i < stations.length - 1; i += 1) {
    const a0 = ringStart[i];
    const b0 = ringStart[i + 1];
    if (isPoint[i] && isPoint[i + 1]) continue;   // two collapsed stations bound nothing
    for (let j = 0; j < radial; j += 1) {
      // Wound so the face normal points radially OUTWARD.
      //
      // Ring vertices advance from `normal` toward `binormal`, and binormal is
      // tangent x normal, so increasing theta runs counter-clockwise seen from the
      // far end of the segment. Taking the ring-to-ring edge first therefore puts
      // the cross product on the inside. Measured as signed volume on the built
      // mesh: every tapered-sweep came out negative -- a torso at -0.0674 and a
      // tail at -0.0044 against a positive ellipsoid head -- so every sweep this
      // generator has ever emitted rendered its back faces, with normals pointing
      // into the solid and every lighting judgement made on the wrong surface.
      if (isPoint[i]) indices.push(a0, b0 + j + 1, b0 + j);
      else if (isPoint[i + 1]) indices.push(a0 + j, a0 + j + 1, b0);
      else indices.push(a0 + j, a0 + j + 1, b0 + j, a0 + j + 1, b0 + j + 1, b0 + j);
    }
  }

  if (sweep.capEnds ?? true) {
    for (const end of [0, stations.length - 1]) {
      if (isPoint[end]) continue;   // a point end is already closed
      const centreIndex = positions.length / 3;
      positions.push(centres[end].x, centres[end].y, centres[end].z);
      uvs.push(0.5, end === 0 ? 0 : 1);
      const base = ringStart[end];
      for (let j = 0; j < radial; j += 1) {
        if (end === 0) indices.push(centreIndex, base + j + 1, base + j);
        else indices.push(centreIndex, base + j, base + j + 1);
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

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

// Generated from ObjectSculptSpec target: Riff Nocturne single-character test
// Sculpt build pass: blockout
// This factory is intentionally pass-gated. Finish browser screenshot review before unlocking deeper passes.
export function createRiffNocturneSingleCharacterTestModel(options: ProceduralModelOptions = {}): THREE.Group {
  const root = new THREE.Group();
  root.name = "Riff Nocturne single-character test";
  root.userData.reconstructionEvidence = {"itemFamily": null, "subtype": null, "componentAdapter": null, "route": null, "exactnessTier": null, "referenceCamera": {"solved": false, "fovDegrees": 40.0, "aspect": 1.0, "orientation": {"yaw": 0.0, "pitch": 0.0, "roll": 0.0}, "positionHint": [0.0, 0.0, 3.0], "note": "For likeness work, solve the reference camera (forge/stage1_intake/solve_camera_pose.py) so the review render aligns with the photo and the reference can be projected. Confirm by overlay review."}, "approximationNotes": []};
  root.userData.materialPipeline = {};
  root.userData.materialReferenceRegistry = null;

  const materialMap: Record<string, THREE.Material> = {};
  materialMap["hidden"] = createSculptMaterial(
    "hidden",
    {"id": "hidden", "name": "hidden", "type": "standard", "shaderModel": "MeshStandardMaterial", "baseColor": "#000000", "color": "#000000", "roughness": 0.78, "metalness": 0, "textureless": {"declared": true, "evidence": ["reference-isolated.png: broad smooth color regions, no observable pore/grain pattern at target game distance; simplified art requested by user"]}, "albedo": {"dominant": "#000000", "secondary": ["#000000"]}, "ambientOcclusion": {"cavityStrength": 0.16, "contactShadowBias": 0.25}, "localOverrides": [], "qualityTier": "utility", "opacity": 0},
    options
  );
  materialMap["skin"] = createSculptMaterial(
    "skin",
    {"id": "skin", "name": "skin", "type": "standard", "shaderModel": "MeshStandardMaterial", "baseColor": "#d59a73", "color": "#d59a73", "roughness": 0.78, "metalness": 0, "textureless": {"declared": true, "evidence": ["reference-isolated.png: broad smooth color regions, no observable pore/grain pattern at target game distance; simplified art requested by user"]}, "albedo": {"dominant": "#d59a73", "secondary": ["#d59a73"]}, "ambientOcclusion": {"cavityStrength": 0.16, "contactShadowBias": 0.25}, "localOverrides": []},
    options
  );
  materialMap["hair"] = createSculptMaterial(
    "hair",
    {"id": "hair", "name": "hair", "type": "standard", "shaderModel": "MeshStandardMaterial", "baseColor": "#34282b", "color": "#34282b", "roughness": 0.78, "metalness": 0, "textureless": {"declared": true, "evidence": ["reference-isolated.png: broad smooth color regions, no observable pore/grain pattern at target game distance; simplified art requested by user"]}, "albedo": {"dominant": "#34282b", "secondary": ["#34282b"]}, "ambientOcclusion": {"cavityStrength": 0.16, "contactShadowBias": 0.25}, "localOverrides": []},
    options
  );
  materialMap["shirt"] = createSculptMaterial(
    "shirt",
    {"id": "shirt", "name": "shirt", "type": "standard", "shaderModel": "MeshStandardMaterial", "baseColor": "#22232c", "color": "#22232c", "roughness": 0.78, "metalness": 0, "textureless": {"declared": true, "evidence": ["reference-isolated.png: broad smooth color regions, no observable pore/grain pattern at target game distance; simplified art requested by user"]}, "albedo": {"dominant": "#22232c", "secondary": ["#22232c"]}, "ambientOcclusion": {"cavityStrength": 0.16, "contactShadowBias": 0.25}, "localOverrides": []},
    options
  );
  materialMap["pants"] = createSculptMaterial(
    "pants",
    {"id": "pants", "name": "pants", "type": "standard", "shaderModel": "MeshStandardMaterial", "baseColor": "#242c43", "color": "#242c43", "roughness": 0.78, "metalness": 0, "textureless": {"declared": true, "evidence": ["reference-isolated.png: broad smooth color regions, no observable pore/grain pattern at target game distance; simplified art requested by user"]}, "albedo": {"dominant": "#242c43", "secondary": ["#242c43"]}, "ambientOcclusion": {"cavityStrength": 0.16, "contactShadowBias": 0.25}, "localOverrides": [{"id": "cuff-shadow", "region": "hem seam", "color": "#1b2334", "roughness": 0.88, "evidenceRefs": ["full-object"]}]},
    options
  );
  materialMap["shoes"] = createSculptMaterial(
    "shoes",
    {"id": "shoes", "name": "shoes", "type": "standard", "shaderModel": "MeshStandardMaterial", "baseColor": "#272932", "color": "#272932", "roughness": 0.78, "metalness": 0, "textureless": {"declared": true, "evidence": ["reference-isolated.png: broad smooth color regions, no observable pore/grain pattern at target game distance; simplified art requested by user"]}, "albedo": {"dominant": "#272932", "secondary": ["#272932"]}, "ambientOcclusion": {"cavityStrength": 0.16, "contactShadowBias": 0.25}, "localOverrides": []},
    options
  );
  materialMap["eye"] = createSculptMaterial(
    "eye",
    {"id": "eye", "name": "eye", "type": "standard", "shaderModel": "MeshStandardMaterial", "baseColor": "#eee8de", "color": "#eee8de", "roughness": 0.78, "metalness": 0, "textureless": {"declared": true, "evidence": ["reference-isolated.png: broad smooth color regions, no observable pore/grain pattern at target game distance; simplified art requested by user"]}, "albedo": {"dominant": "#eee8de", "secondary": ["#eee8de"]}, "ambientOcclusion": {"cavityStrength": 0.16, "contactShadowBias": 0.25}, "localOverrides": []},
    options
  );
  materialMap["lips"] = createSculptMaterial(
    "lips",
    {"id": "lips", "name": "lips", "type": "standard", "shaderModel": "MeshStandardMaterial", "baseColor": "#a16a59", "color": "#a16a59", "roughness": 0.78, "metalness": 0, "textureless": {"declared": true, "evidence": ["reference-isolated.png: broad smooth color regions, no observable pore/grain pattern at target game distance; simplified art requested by user"]}, "albedo": {"dominant": "#a16a59", "secondary": ["#a16a59"]}, "ambientOcclusion": {"cavityStrength": 0.16, "contactShadowBias": 0.25}, "localOverrides": []},
    options
  );
  materialMap["glasses-frame"] = createSculptMaterial(
    "glasses-frame",
    {"id": "glasses-frame", "name": "glasses-frame", "type": "standard", "shaderModel": "MeshStandardMaterial", "baseColor": "#191e25", "color": "#191e25", "roughness": 0.78, "metalness": 0, "textureless": {"declared": true, "evidence": ["reference-isolated.png: broad smooth color regions, no observable pore/grain pattern at target game distance; simplified art requested by user"]}, "albedo": {"dominant": "#191e25", "secondary": ["#191e25"]}, "ambientOcclusion": {"cavityStrength": 0.16, "contactShadowBias": 0.25}, "localOverrides": []},
    options
  );
  materialMap["glasses-lens"] = createSculptMaterial(
    "glasses-lens",
    {"id": "glasses-lens", "name": "glasses-lens", "type": "standard", "shaderModel": "MeshStandardMaterial", "baseColor": "#141922", "color": "#141922", "roughness": 0.25, "metalness": 0, "textureless": {"declared": true, "evidence": ["reference-isolated.png: broad smooth color regions, no observable pore/grain pattern at target game distance; simplified art requested by user"]}, "albedo": {"dominant": "#141922", "secondary": ["#141922"]}, "ambientOcclusion": {"cavityStrength": 0.16, "contactShadowBias": 0.25}, "localOverrides": []},
    options
  );
  materialMap["gold"] = createSculptMaterial(
    "gold",
    {"id": "gold", "name": "gold", "type": "standard", "shaderModel": "MeshStandardMaterial", "baseColor": "#cfac5c", "color": "#cfac5c", "roughness": 0.3, "metalness": 1, "textureless": {"declared": true, "evidence": ["reference-isolated.png: broad smooth color regions, no observable pore/grain pattern at target game distance; simplified art requested by user"]}, "albedo": {"dominant": "#cfac5c", "secondary": ["#cfac5c"]}, "ambientOcclusion": {"cavityStrength": 0.16, "contactShadowBias": 0.25}, "localOverrides": []},
    options
  );
  materialMap["cap"] = createSculptMaterial(
    "cap",
    {"id": "cap", "name": "cap", "type": "standard", "shaderModel": "MeshStandardMaterial", "baseColor": "#24232c", "color": "#24232c", "roughness": 0.84, "metalness": 0, "textureless": {"declared": true, "evidence": ["reference-isolated.png: broad smooth color regions, no observable pore/grain pattern at target game distance; simplified art requested by user"]}, "albedo": {"dominant": "#24232c", "secondary": ["#24232c"]}, "ambientOcclusion": {"cavityStrength": 0.16, "contactShadowBias": 0.25}, "localOverrides": []},
    options
  );
  materialMap["sole"] = createSculptMaterial(
    "sole",
    {"id": "sole", "name": "sole", "type": "standard", "shaderModel": "MeshStandardMaterial", "baseColor": "#171a22", "color": "#171a22", "roughness": 0.75, "metalness": 0, "textureless": {"declared": true, "evidence": ["reference-isolated.png: broad smooth color regions, no observable pore/grain pattern at target game distance; simplified art requested by user"]}, "albedo": {"dominant": "#171a22", "secondary": ["#171a22"]}, "ambientOcclusion": {"cavityStrength": 0.16, "contactShadowBias": 0.25}, "localOverrides": []},
    options
  );
  materialMap["ink"] = createSculptMaterial(
    "ink",
    {"id": "ink", "name": "ink", "type": "standard", "shaderModel": "MeshStandardMaterial", "baseColor": "#45424a", "color": "#45424a", "roughness": 0.8, "metalness": 0, "textureless": {"declared": true, "evidence": ["reference-isolated.png: broad smooth color regions, no observable pore/grain pattern at target game distance; simplified art requested by user"]}, "albedo": {"dominant": "#45424a", "secondary": ["#45424a"]}, "ambientOcclusion": {"cavityStrength": 0.16, "contactShadowBias": 0.25}, "localOverrides": []},
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
  node_root_0.userData.sculptComponent = {"id": "root", "name": "root", "level": "macro", "role": "body", "importance": 1.0, "confidence": 0.78, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Contour follows the reference silhouette; depth is inferred and tested in orbit.", "geometryDescriptor": {"normalStrategy": "smooth vertex normals", "uvStrategy": "generated procedural coordinates", "edgeTreatment": {"type": "none", "bevelRadius": 0, "segments": 1}, "deformationStack": []}, "parent": null, "attachment": null, "dimensions": {"width": 0.001, "height": 0.001, "depth": 0.001, "units": "meters", "confidence": 0.78}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [0.001, 0.001, 0.001]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "hidden", "materialLayers": ["hidden"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(0, 0, 0, 1)", "secondaryAlbedo": "rgba(0, 0, 0, 1)", "materialClass": "plastic", "materialClassConfidence": 0.8, "evidenceRefs": ["full-object"]}};
  node_root_0.userData.actionProfile = {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["root"] ?? root).add(node_root_0);
  nodes["root"] = node_root_0;
  const mesh_root_0Geometry = endpoint_root_0
    ? new THREE.CylinderGeometry(endpoint_root_0.endRadius, endpoint_root_0.baseRadius, endpoint_root_0.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_root_0) {
    mesh_root_0Geometry.scale(0.001, 0.001, 0.001);
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
  mesh_root_0.userData.sculptComponent = {"id": "root", "name": "root", "level": "macro", "role": "body", "importance": 1.0, "confidence": 0.78, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Contour follows the reference silhouette; depth is inferred and tested in orbit.", "geometryDescriptor": {"normalStrategy": "smooth vertex normals", "uvStrategy": "generated procedural coordinates", "edgeTreatment": {"type": "none", "bevelRadius": 0, "segments": 1}, "deformationStack": []}, "parent": null, "attachment": null, "dimensions": {"width": 0.001, "height": 0.001, "depth": 0.001, "units": "meters", "confidence": 0.78}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [0.001, 0.001, 0.001]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "hidden", "materialLayers": ["hidden"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(0, 0, 0, 1)", "secondaryAlbedo": "rgba(0, 0, 0, 1)", "materialClass": "plastic", "materialClassConfidence": 0.8, "evidenceRefs": ["full-object"]}};
  node_root_0.add(mesh_root_0);
  meshes["root"] = mesh_root_0;
  colliders["root"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_root_0);

  const endpoint_shirt_1 = makeAttachmentEndpoint(null);
  const node_shirt_1 = new THREE.Group();
  node_shirt_1.name = "shirt__pivot";
  node_shirt_1.scale.set(1, 1, 1);
  if (endpoint_shirt_1) {
    node_shirt_1.position.copy(endpoint_shirt_1.start);
    node_shirt_1.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_shirt_1.position.set(0.0, 0.0, 0.0);
    node_shirt_1.rotation.set(0.0, 0.0, 0.0);
  }
  node_shirt_1.userData.sculptComponent = {"id": "shirt", "name": "shirt", "level": "macro", "role": "body", "importance": 1.0, "confidence": 0.78, "primitive": "tapered-sweep", "topologyClass": "continuous-sculpt", "topologyRationale": "Continuous sculpt volume made from smoothly blended fields, not independently rendered spheres.", "geometryDescriptor": {"taperedSweep": {"stations": [{"position": [0, 1.005, 0], "rx": 0.108, "rz": 0.176}, {"position": [0, 1.035, 0], "rx": 0.111, "rz": 0.179}, {"position": [0, 1.09, 0], "rx": 0.104, "rz": 0.166}, {"position": [0, 1.17, 0], "rx": 0.106, "rz": 0.165}, {"position": [0, 1.26, 0.004], "rx": 0.117, "rz": 0.192}, {"position": [0, 1.35, 0], "rx": 0.117, "rz": 0.218}, {"position": [0, 1.405, -0.008], "rx": 0.101, "rz": 0.231}, {"position": [0, 1.445, -0.014], "rx": 0.089, "rz": 0.201}, {"position": [0, 1.476, -0.014], "rx": 0.06, "rz": 0.103}, {"position": [0, 1.483, -0.014], "rx": 0.046, "rz": 0.053}], "radialSegments": 40, "capEnds": true, "fixedFrame": "horizontal"}, "normalStrategy": "Horizontal anatomical contour sections: preserve world Y cross-section planes to avoid mouth/jaw folding when centre depth changes.", "ringInterpolation": "catmull-rom radius/centre, 4 samples between stations, no inherited old model"}, "parent": "root", "attachment": null, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.78}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "shirt", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "shirt", "materialLayers": ["shirt"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "neckline", "kind": "seam", "description": "neckline", "evidenceRefs": ["full-object"]}, {"id": "sleeve-hem", "kind": "seam", "description": "sleeve-hem", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(34, 35, 44, 1)", "secondaryAlbedo": "rgba(34, 35, 44, 1)", "materialClass": "fabric", "materialClassConfidence": 0.8, "evidenceRefs": ["full-object"]}};
  node_shirt_1.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "shirt", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["root"] ?? root).add(node_shirt_1);
  nodes["shirt"] = node_shirt_1;
  const mesh_shirt_1Geometry = endpoint_shirt_1
    ? new THREE.CylinderGeometry(endpoint_shirt_1.endRadius, endpoint_shirt_1.baseRadius, endpoint_shirt_1.length, 16, 6)
    : buildTaperedSweepGeometry({"stations": [{"position": [0, 1.005, 0], "rx": 0.108, "rz": 0.176}, {"position": [0, 1.035, 0], "rx": 0.111, "rz": 0.179}, {"position": [0, 1.09, 0], "rx": 0.104, "rz": 0.166}, {"position": [0, 1.17, 0], "rx": 0.106, "rz": 0.165}, {"position": [0, 1.26, 0.004], "rx": 0.117, "rz": 0.192}, {"position": [0, 1.35, 0], "rx": 0.117, "rz": 0.218}, {"position": [0, 1.405, -0.008], "rx": 0.101, "rz": 0.231}, {"position": [0, 1.445, -0.014], "rx": 0.089, "rz": 0.201}, {"position": [0, 1.476, -0.014], "rx": 0.06, "rz": 0.103}, {"position": [0, 1.483, -0.014], "rx": 0.046, "rz": 0.053}], "radialSegments": 40, "capEnds": true, "fixedFrame": "horizontal"});
  if (!endpoint_shirt_1) {
    mesh_shirt_1Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_shirt_1 = new THREE.Mesh(
    mesh_shirt_1Geometry,
    materialMap["shirt"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_shirt_1.name = "shirt";
  if (endpoint_shirt_1) {
    mesh_shirt_1.position.copy(endpoint_shirt_1.midpoint);
    mesh_shirt_1.quaternion.copy(endpoint_shirt_1.quaternion);
  }
  mesh_shirt_1.castShadow = options.castShadow ?? true;
  mesh_shirt_1.receiveShadow = options.receiveShadow ?? true;
  mesh_shirt_1.userData.sculptComponent = {"id": "shirt", "name": "shirt", "level": "macro", "role": "body", "importance": 1.0, "confidence": 0.78, "primitive": "tapered-sweep", "topologyClass": "continuous-sculpt", "topologyRationale": "Continuous sculpt volume made from smoothly blended fields, not independently rendered spheres.", "geometryDescriptor": {"taperedSweep": {"stations": [{"position": [0, 1.005, 0], "rx": 0.108, "rz": 0.176}, {"position": [0, 1.035, 0], "rx": 0.111, "rz": 0.179}, {"position": [0, 1.09, 0], "rx": 0.104, "rz": 0.166}, {"position": [0, 1.17, 0], "rx": 0.106, "rz": 0.165}, {"position": [0, 1.26, 0.004], "rx": 0.117, "rz": 0.192}, {"position": [0, 1.35, 0], "rx": 0.117, "rz": 0.218}, {"position": [0, 1.405, -0.008], "rx": 0.101, "rz": 0.231}, {"position": [0, 1.445, -0.014], "rx": 0.089, "rz": 0.201}, {"position": [0, 1.476, -0.014], "rx": 0.06, "rz": 0.103}, {"position": [0, 1.483, -0.014], "rx": 0.046, "rz": 0.053}], "radialSegments": 40, "capEnds": true, "fixedFrame": "horizontal"}, "normalStrategy": "Horizontal anatomical contour sections: preserve world Y cross-section planes to avoid mouth/jaw folding when centre depth changes.", "ringInterpolation": "catmull-rom radius/centre, 4 samples between stations, no inherited old model"}, "parent": "root", "attachment": null, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.78}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "shirt", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "shirt", "materialLayers": ["shirt"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "neckline", "kind": "seam", "description": "neckline", "evidenceRefs": ["full-object"]}, {"id": "sleeve-hem", "kind": "seam", "description": "sleeve-hem", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(34, 35, 44, 1)", "secondaryAlbedo": "rgba(34, 35, 44, 1)", "materialClass": "fabric", "materialClassConfidence": 0.8, "evidenceRefs": ["full-object"]}};
  node_shirt_1.add(mesh_shirt_1);
  meshes["shirt"] = mesh_shirt_1;
  colliders["shirt"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["shirt"] ??= [];
  destructionGroups["shirt"].push(node_shirt_1);

  const endpoint_pants_2 = makeAttachmentEndpoint(null);
  const node_pants_2 = new THREE.Group();
  node_pants_2.name = "pants__pivot";
  node_pants_2.scale.set(1, 1, 1);
  if (endpoint_pants_2) {
    node_pants_2.position.copy(endpoint_pants_2.start);
    node_pants_2.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_pants_2.position.set(0.0, 0.0, 0.0);
    node_pants_2.rotation.set(0.0, 0.0, 0.0);
  }
  node_pants_2.userData.sculptComponent = {"id": "pants", "name": "pants", "level": "macro", "role": "body", "importance": 1.0, "confidence": 0.78, "primitive": "ellipsoid", "topologyClass": "implicit", "topologyRationale": "Continuous trouser volume, smooth union of waist and overlapping thigh, calf contour volumes. All fields use supported primitives; no separate visible leg shells.", "geometryDescriptor": {"sdf": {"primitives": [{"id": "waist", "type": "ellipsoid", "center": [0, 0.973, -0.008], "radii": [0.176, 0.085, 0.106]}, {"id": "hip", "type": "ellipsoid", "center": [0, 0.93, -0.005], "radii": [0.174, 0.092, 0.106]}, {"id": "l-0", "type": "ellipsoid", "center": [0.11261224489795918, 0.82, 0], "radii": [0.097, 0.17, 0.095]}, {"id": "l-1", "type": "ellipsoid", "center": [0.12388775510204081, 0.65, 0], "radii": [0.081, 0.16, 0.082]}, {"id": "l-2", "type": "ellipsoid", "center": [0.14750000000000002, 0.49, 0], "radii": [0.068, 0.1, 0.071]}, {"id": "l-3", "type": "ellipsoid", "center": [0.15678571428571428, 0.35, 0], "radii": [0.073, 0.15, 0.076]}, {"id": "l-4", "type": "ellipsoid", "center": [0.16673469387755102, 0.2, 0], "radii": [0.058, 0.11, 0.061]}, {"id": "r-0", "type": "ellipsoid", "center": [-0.10526530612244897, 0.82, 0], "radii": [0.097, 0.17, 0.095]}, {"id": "r-1", "type": "ellipsoid", "center": [-0.10873469387755101, 0.65, 0], "radii": [0.081, 0.16, 0.082]}, {"id": "r-2", "type": "ellipsoid", "center": [-0.125, 0.49, 0], "radii": [0.068, 0.1, 0.071]}, {"id": "r-3", "type": "ellipsoid", "center": [-0.12785714285714286, 0.35, 0], "radii": [0.073, 0.15, 0.076]}, {"id": "r-4", "type": "ellipsoid", "center": [-0.1309183673469388, 0.2, 0], "radii": [0.058, 0.11, 0.061]}], "operations": [{"id": "pants-join0", "type": "smooth-union", "left": "waist", "right": "hip", "radius": 0.022}, {"id": "pants-join1", "type": "smooth-union", "left": "pants-join0", "right": "l-0", "radius": 0.022}, {"id": "pants-join2", "type": "smooth-union", "left": "pants-join1", "right": "l-1", "radius": 0.022}, {"id": "pants-join3", "type": "smooth-union", "left": "pants-join2", "right": "l-2", "radius": 0.022}, {"id": "pants-join4", "type": "smooth-union", "left": "pants-join3", "right": "l-3", "radius": 0.022}, {"id": "pants-join5", "type": "smooth-union", "left": "pants-join4", "right": "l-4", "radius": 0.022}, {"id": "pants-join6", "type": "smooth-union", "left": "pants-join5", "right": "r-0", "radius": 0.022}, {"id": "pants-join7", "type": "smooth-union", "left": "pants-join6", "right": "r-1", "radius": 0.022}, {"id": "pants-join8", "type": "smooth-union", "left": "pants-join7", "right": "r-2", "radius": 0.022}, {"id": "pants-join9", "type": "smooth-union", "left": "pants-join8", "right": "r-3", "radius": 0.022}, {"id": "pants-join10", "type": "smooth-union", "left": "pants-join9", "right": "r-4", "radius": 0.022}], "resolution": 64, "bounds": {"min": [-0.29, 0.09, -0.16], "max": [0.29, 1.075, 0.16]}}}, "parent": "root", "attachment": null, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.78}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pants-pelvis", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "pants", "materialLayers": ["pants"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(36, 44, 67, 1)", "secondaryAlbedo": "rgba(36, 44, 67, 1)", "materialClass": "fabric", "materialClassConfidence": 0.8, "evidenceRefs": ["full-object"]}};
  node_pants_2.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pants-pelvis", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["root"] ?? root).add(node_pants_2);
  nodes["pants"] = node_pants_2;
  const mesh_pants_2Geometry = polygonizeSdf({"primitives": [{"id": "waist", "type": "ellipsoid", "center": [0, 0.973, -0.008], "radii": [0.176, 0.085, 0.106]}, {"id": "hip", "type": "ellipsoid", "center": [0, 0.93, -0.005], "radii": [0.174, 0.092, 0.106]}, {"id": "l-0", "type": "ellipsoid", "center": [0.11261224489795918, 0.82, 0], "radii": [0.097, 0.17, 0.095]}, {"id": "l-1", "type": "ellipsoid", "center": [0.12388775510204081, 0.65, 0], "radii": [0.081, 0.16, 0.082]}, {"id": "l-2", "type": "ellipsoid", "center": [0.14750000000000002, 0.49, 0], "radii": [0.068, 0.1, 0.071]}, {"id": "l-3", "type": "ellipsoid", "center": [0.15678571428571428, 0.35, 0], "radii": [0.073, 0.15, 0.076]}, {"id": "l-4", "type": "ellipsoid", "center": [0.16673469387755102, 0.2, 0], "radii": [0.058, 0.11, 0.061]}, {"id": "r-0", "type": "ellipsoid", "center": [-0.10526530612244897, 0.82, 0], "radii": [0.097, 0.17, 0.095]}, {"id": "r-1", "type": "ellipsoid", "center": [-0.10873469387755101, 0.65, 0], "radii": [0.081, 0.16, 0.082]}, {"id": "r-2", "type": "ellipsoid", "center": [-0.125, 0.49, 0], "radii": [0.068, 0.1, 0.071]}, {"id": "r-3", "type": "ellipsoid", "center": [-0.12785714285714286, 0.35, 0], "radii": [0.073, 0.15, 0.076]}, {"id": "r-4", "type": "ellipsoid", "center": [-0.1309183673469388, 0.2, 0], "radii": [0.058, 0.11, 0.061]}], "operations": [{"id": "pants-join0", "type": "smooth-union", "left": "waist", "right": "hip", "radius": 0.022}, {"id": "pants-join1", "type": "smooth-union", "left": "pants-join0", "right": "l-0", "radius": 0.022}, {"id": "pants-join2", "type": "smooth-union", "left": "pants-join1", "right": "l-1", "radius": 0.022}, {"id": "pants-join3", "type": "smooth-union", "left": "pants-join2", "right": "l-2", "radius": 0.022}, {"id": "pants-join4", "type": "smooth-union", "left": "pants-join3", "right": "l-3", "radius": 0.022}, {"id": "pants-join5", "type": "smooth-union", "left": "pants-join4", "right": "l-4", "radius": 0.022}, {"id": "pants-join6", "type": "smooth-union", "left": "pants-join5", "right": "r-0", "radius": 0.022}, {"id": "pants-join7", "type": "smooth-union", "left": "pants-join6", "right": "r-1", "radius": 0.022}, {"id": "pants-join8", "type": "smooth-union", "left": "pants-join7", "right": "r-2", "radius": 0.022}, {"id": "pants-join9", "type": "smooth-union", "left": "pants-join8", "right": "r-3", "radius": 0.022}, {"id": "pants-join10", "type": "smooth-union", "left": "pants-join9", "right": "r-4", "radius": 0.022}], "resolution": 40, "bounds": {"min": [-0.29, 0.09, -0.16], "max": [0.29, 1.075, 0.16]}});
  if (!endpoint_pants_2) {
    mesh_pants_2Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_pants_2 = new THREE.Mesh(
    mesh_pants_2Geometry,
    createSculptMaterial("pants", {"id": "pants", "name": "pants", "type": "standard", "shaderModel": "MeshStandardMaterial", "baseColor": "#242c43", "color": "#242c43", "roughness": 0.78, "metalness": 0, "textureless": {"declared": true, "evidence": ["reference-isolated.png: broad smooth color regions, no observable pore/grain pattern at target game distance; simplified art requested by user"]}, "albedo": {"dominant": "#242c43", "secondary": ["#242c43"]}, "ambientOcclusion": {"cavityStrength": 0.16, "contactShadowBias": 0.25}, "localOverrides": [{"id": "cuff-shadow", "region": "hem seam", "color": "#1b2334", "roughness": 0.88, "evidenceRefs": ["full-object"]}]}, options, true)
  );
  mesh_pants_2.name = "pants";
  if (endpoint_pants_2) {
    mesh_pants_2.position.copy(endpoint_pants_2.midpoint);
    mesh_pants_2.quaternion.copy(endpoint_pants_2.quaternion);
  }
  mesh_pants_2.castShadow = options.castShadow ?? true;
  mesh_pants_2.receiveShadow = options.receiveShadow ?? true;
  mesh_pants_2.userData.sculptComponent = {"id": "pants", "name": "pants", "level": "macro", "role": "body", "importance": 1.0, "confidence": 0.78, "primitive": "ellipsoid", "topologyClass": "implicit", "topologyRationale": "Continuous trouser volume, smooth union of waist and overlapping thigh, calf contour volumes. All fields use supported primitives; no separate visible leg shells.", "geometryDescriptor": {"sdf": {"primitives": [{"id": "waist", "type": "ellipsoid", "center": [0, 0.973, -0.008], "radii": [0.176, 0.085, 0.106]}, {"id": "hip", "type": "ellipsoid", "center": [0, 0.93, -0.005], "radii": [0.174, 0.092, 0.106]}, {"id": "l-0", "type": "ellipsoid", "center": [0.11261224489795918, 0.82, 0], "radii": [0.097, 0.17, 0.095]}, {"id": "l-1", "type": "ellipsoid", "center": [0.12388775510204081, 0.65, 0], "radii": [0.081, 0.16, 0.082]}, {"id": "l-2", "type": "ellipsoid", "center": [0.14750000000000002, 0.49, 0], "radii": [0.068, 0.1, 0.071]}, {"id": "l-3", "type": "ellipsoid", "center": [0.15678571428571428, 0.35, 0], "radii": [0.073, 0.15, 0.076]}, {"id": "l-4", "type": "ellipsoid", "center": [0.16673469387755102, 0.2, 0], "radii": [0.058, 0.11, 0.061]}, {"id": "r-0", "type": "ellipsoid", "center": [-0.10526530612244897, 0.82, 0], "radii": [0.097, 0.17, 0.095]}, {"id": "r-1", "type": "ellipsoid", "center": [-0.10873469387755101, 0.65, 0], "radii": [0.081, 0.16, 0.082]}, {"id": "r-2", "type": "ellipsoid", "center": [-0.125, 0.49, 0], "radii": [0.068, 0.1, 0.071]}, {"id": "r-3", "type": "ellipsoid", "center": [-0.12785714285714286, 0.35, 0], "radii": [0.073, 0.15, 0.076]}, {"id": "r-4", "type": "ellipsoid", "center": [-0.1309183673469388, 0.2, 0], "radii": [0.058, 0.11, 0.061]}], "operations": [{"id": "pants-join0", "type": "smooth-union", "left": "waist", "right": "hip", "radius": 0.022}, {"id": "pants-join1", "type": "smooth-union", "left": "pants-join0", "right": "l-0", "radius": 0.022}, {"id": "pants-join2", "type": "smooth-union", "left": "pants-join1", "right": "l-1", "radius": 0.022}, {"id": "pants-join3", "type": "smooth-union", "left": "pants-join2", "right": "l-2", "radius": 0.022}, {"id": "pants-join4", "type": "smooth-union", "left": "pants-join3", "right": "l-3", "radius": 0.022}, {"id": "pants-join5", "type": "smooth-union", "left": "pants-join4", "right": "l-4", "radius": 0.022}, {"id": "pants-join6", "type": "smooth-union", "left": "pants-join5", "right": "r-0", "radius": 0.022}, {"id": "pants-join7", "type": "smooth-union", "left": "pants-join6", "right": "r-1", "radius": 0.022}, {"id": "pants-join8", "type": "smooth-union", "left": "pants-join7", "right": "r-2", "radius": 0.022}, {"id": "pants-join9", "type": "smooth-union", "left": "pants-join8", "right": "r-3", "radius": 0.022}, {"id": "pants-join10", "type": "smooth-union", "left": "pants-join9", "right": "r-4", "radius": 0.022}], "resolution": 64, "bounds": {"min": [-0.29, 0.09, -0.16], "max": [0.29, 1.075, 0.16]}}}, "parent": "root", "attachment": null, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.78}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pants-pelvis", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "pants", "materialLayers": ["pants"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(36, 44, 67, 1)", "secondaryAlbedo": "rgba(36, 44, 67, 1)", "materialClass": "fabric", "materialClassConfidence": 0.8, "evidenceRefs": ["full-object"]}};
  node_pants_2.add(mesh_pants_2);
  meshes["pants"] = mesh_pants_2;
  colliders["pants"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["pants-pelvis"] ??= [];
  destructionGroups["pants-pelvis"].push(node_pants_2);

  const endpoint_arm_l_3 = makeAttachmentEndpoint(null);
  const node_arm_l_3 = new THREE.Group();
  node_arm_l_3.name = "arm-l__pivot";
  node_arm_l_3.scale.set(1, 1, 1);
  if (endpoint_arm_l_3) {
    node_arm_l_3.position.copy(endpoint_arm_l_3.start);
    node_arm_l_3.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_arm_l_3.position.set(0.0, 0.0, 0.0);
    node_arm_l_3.rotation.set(0.0, 0.0, 0.0);
  }
  node_arm_l_3.userData.sculptComponent = {"id": "arm-l", "name": "arm-l", "level": "macro", "role": "body", "importance": 1.0, "confidence": 0.78, "primitive": "tapered-sweep", "topologyClass": "continuous-sculpt", "topologyRationale": "Contour follows the reference silhouette; depth is inferred and tested in orbit.", "geometryDescriptor": {"taperedSweep": {"stations": [{"position": [0.321, 0.88, 0.003], "rx": 0.029, "rz": 0.032, "twist": 0}, {"position": [0.321, 0.95, 0], "rx": 0.035, "rz": 0.038, "twist": 0}, {"position": [0.317, 1.045, 0], "rx": 0.048, "rz": 0.055, "twist": 0}, {"position": [0.31, 1.105, 0], "rx": 0.043, "rz": 0.048, "twist": 0}, {"position": [0.295, 1.17, 0], "rx": 0.05, "rz": 0.055, "twist": 0}, {"position": [0.276, 1.245, 0], "rx": 0.06, "rz": 0.064, "twist": 0}, {"position": [0.258, 1.31, 0], "rx": 0.062, "rz": 0.062, "twist": 0}], "radialSegments": 24, "capEnds": true}, "normalStrategy": "smooth vertex normals"}, "parent": "root", "attachment": {"parentSocket": "shirt-sleeve", "localStart": [0.258, 1.31, 0], "localEnd": [0.321, 0.88, 0.003], "contactType": "overlap", "embedDepth": 0.025, "gapTolerance": 0.003}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.78}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "arm-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "skin", "materialLayers": ["skin"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(213, 154, 115, 1)", "secondaryAlbedo": "rgba(213, 154, 115, 1)", "materialClass": "skin", "materialClassConfidence": 0.8, "evidenceRefs": ["full-object"]}};
  node_arm_l_3.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "arm-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["root"] ?? root).add(node_arm_l_3);
  nodes["arm-l"] = node_arm_l_3;
  const mesh_arm_l_3Geometry = endpoint_arm_l_3
    ? new THREE.CylinderGeometry(endpoint_arm_l_3.endRadius, endpoint_arm_l_3.baseRadius, endpoint_arm_l_3.length, 16, 6)
    : buildTaperedSweepGeometry({"stations": [{"position": [0.321, 0.88, 0.003], "rx": 0.029, "rz": 0.032, "twist": 0}, {"position": [0.321, 0.95, 0], "rx": 0.035, "rz": 0.038, "twist": 0}, {"position": [0.317, 1.045, 0], "rx": 0.048, "rz": 0.055, "twist": 0}, {"position": [0.31, 1.105, 0], "rx": 0.043, "rz": 0.048, "twist": 0}, {"position": [0.295, 1.17, 0], "rx": 0.05, "rz": 0.055, "twist": 0}, {"position": [0.276, 1.245, 0], "rx": 0.06, "rz": 0.064, "twist": 0}, {"position": [0.258, 1.31, 0], "rx": 0.062, "rz": 0.062, "twist": 0}], "radialSegments": 24, "capEnds": true});
  if (!endpoint_arm_l_3) {
    mesh_arm_l_3Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_arm_l_3 = new THREE.Mesh(
    mesh_arm_l_3Geometry,
    materialMap["skin"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_arm_l_3.name = "arm-l";
  if (endpoint_arm_l_3) {
    mesh_arm_l_3.position.copy(endpoint_arm_l_3.midpoint);
    mesh_arm_l_3.quaternion.copy(endpoint_arm_l_3.quaternion);
  }
  mesh_arm_l_3.castShadow = options.castShadow ?? true;
  mesh_arm_l_3.receiveShadow = options.receiveShadow ?? true;
  mesh_arm_l_3.userData.sculptComponent = {"id": "arm-l", "name": "arm-l", "level": "macro", "role": "body", "importance": 1.0, "confidence": 0.78, "primitive": "tapered-sweep", "topologyClass": "continuous-sculpt", "topologyRationale": "Contour follows the reference silhouette; depth is inferred and tested in orbit.", "geometryDescriptor": {"taperedSweep": {"stations": [{"position": [0.321, 0.88, 0.003], "rx": 0.029, "rz": 0.032, "twist": 0}, {"position": [0.321, 0.95, 0], "rx": 0.035, "rz": 0.038, "twist": 0}, {"position": [0.317, 1.045, 0], "rx": 0.048, "rz": 0.055, "twist": 0}, {"position": [0.31, 1.105, 0], "rx": 0.043, "rz": 0.048, "twist": 0}, {"position": [0.295, 1.17, 0], "rx": 0.05, "rz": 0.055, "twist": 0}, {"position": [0.276, 1.245, 0], "rx": 0.06, "rz": 0.064, "twist": 0}, {"position": [0.258, 1.31, 0], "rx": 0.062, "rz": 0.062, "twist": 0}], "radialSegments": 24, "capEnds": true}, "normalStrategy": "smooth vertex normals"}, "parent": "root", "attachment": {"parentSocket": "shirt-sleeve", "localStart": [0.258, 1.31, 0], "localEnd": [0.321, 0.88, 0.003], "contactType": "overlap", "embedDepth": 0.025, "gapTolerance": 0.003}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.78}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "arm-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "skin", "materialLayers": ["skin"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(213, 154, 115, 1)", "secondaryAlbedo": "rgba(213, 154, 115, 1)", "materialClass": "skin", "materialClassConfidence": 0.8, "evidenceRefs": ["full-object"]}};
  node_arm_l_3.add(mesh_arm_l_3);
  meshes["arm-l"] = mesh_arm_l_3;
  colliders["arm-l"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["arm-l"] ??= [];
  destructionGroups["arm-l"].push(node_arm_l_3);

  const endpoint_hand_l_4 = makeAttachmentEndpoint(null);
  const node_hand_l_4 = new THREE.Group();
  node_hand_l_4.name = "hand-l__pivot";
  node_hand_l_4.scale.set(1, 1, 1);
  if (endpoint_hand_l_4) {
    node_hand_l_4.position.copy(endpoint_hand_l_4.start);
    node_hand_l_4.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_hand_l_4.position.set(0.0, 0.0, 0.0);
    node_hand_l_4.rotation.set(0.0, 0.0, 0.0);
  }
  node_hand_l_4.userData.sculptComponent = {"id": "hand-l", "name": "hand-l", "level": "meso", "role": "body", "importance": 1.0, "confidence": 0.78, "primitive": "ellipsoid", "topologyClass": "implicit", "topologyRationale": "Continuous sculpt volume made from smoothly blended fields, not independently rendered spheres.", "geometryDescriptor": {"sdf": {"primitives": [{"id": "palm", "type": "ellipsoid", "center": [0.325, 0.842, 0.005], "radii": [0.038, 0.057, 0.024]}, {"id": "finger0", "type": "ellipsoid", "center": [0.301, 0.798, 0.01], "radii": [0.009, 0.034, 0.011]}, {"id": "finger1", "type": "ellipsoid", "center": [0.317, 0.792, 0.01], "radii": [0.009, 0.038, 0.011]}, {"id": "finger2", "type": "ellipsoid", "center": [0.33299999999999996, 0.798, 0.01], "radii": [0.009, 0.034, 0.011]}, {"id": "finger3", "type": "ellipsoid", "center": [0.349, 0.804, 0.01], "radii": [0.009, 0.03, 0.011]}, {"id": "thumb", "type": "ellipsoid", "center": [0.29, 0.84, 0.027], "radii": [0.017, 0.029, 0.014]}], "operations": [{"id": "blend0", "type": "smooth-union", "left": "palm", "right": "finger0", "radius": 0.003}, {"id": "blend1", "type": "smooth-union", "left": "blend0", "right": "finger1", "radius": 0.003}, {"id": "blend2", "type": "smooth-union", "left": "blend1", "right": "finger2", "radius": 0.003}, {"id": "blend3", "type": "smooth-union", "left": "blend2", "right": "finger3", "radius": 0.003}, {"id": "blend4", "type": "smooth-union", "left": "blend3", "right": "thumb", "radius": 0.003}], "bounds": {"min": [0.24799999999999997, 0.729, -0.044], "max": [0.388, 0.924, 0.066]}, "resolution": 40}, "normalStrategy": "smooth vertex normals"}, "parent": "root", "attachment": null, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.78}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "hand-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "skin", "materialLayers": ["skin"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(213, 154, 115, 1)", "secondaryAlbedo": "rgba(213, 154, 115, 1)", "materialClass": "skin", "materialClassConfidence": 0.8, "evidenceRefs": ["full-object"]}};
  node_hand_l_4.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "hand-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["root"] ?? root).add(node_hand_l_4);
  nodes["hand-l"] = node_hand_l_4;
  const mesh_hand_l_4Geometry = polygonizeSdf({"primitives": [{"id": "palm", "type": "ellipsoid", "center": [0.325, 0.842, 0.005], "radii": [0.038, 0.057, 0.024]}, {"id": "finger0", "type": "ellipsoid", "center": [0.301, 0.798, 0.01], "radii": [0.009, 0.034, 0.011]}, {"id": "finger1", "type": "ellipsoid", "center": [0.317, 0.792, 0.01], "radii": [0.009, 0.038, 0.011]}, {"id": "finger2", "type": "ellipsoid", "center": [0.33299999999999996, 0.798, 0.01], "radii": [0.009, 0.034, 0.011]}, {"id": "finger3", "type": "ellipsoid", "center": [0.349, 0.804, 0.01], "radii": [0.009, 0.03, 0.011]}, {"id": "thumb", "type": "ellipsoid", "center": [0.29, 0.84, 0.027], "radii": [0.017, 0.029, 0.014]}], "operations": [{"id": "blend0", "type": "smooth-union", "left": "palm", "right": "finger0", "radius": 0.003}, {"id": "blend1", "type": "smooth-union", "left": "blend0", "right": "finger1", "radius": 0.003}, {"id": "blend2", "type": "smooth-union", "left": "blend1", "right": "finger2", "radius": 0.003}, {"id": "blend3", "type": "smooth-union", "left": "blend2", "right": "finger3", "radius": 0.003}, {"id": "blend4", "type": "smooth-union", "left": "blend3", "right": "thumb", "radius": 0.003}], "bounds": {"min": [0.24799999999999997, 0.729, -0.044], "max": [0.388, 0.924, 0.066]}, "resolution": 40});
  if (!endpoint_hand_l_4) {
    mesh_hand_l_4Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_hand_l_4 = new THREE.Mesh(
    mesh_hand_l_4Geometry,
    createSculptMaterial("skin", {"id": "skin", "name": "skin", "type": "standard", "shaderModel": "MeshStandardMaterial", "baseColor": "#d59a73", "color": "#d59a73", "roughness": 0.78, "metalness": 0, "textureless": {"declared": true, "evidence": ["reference-isolated.png: broad smooth color regions, no observable pore/grain pattern at target game distance; simplified art requested by user"]}, "albedo": {"dominant": "#d59a73", "secondary": ["#d59a73"]}, "ambientOcclusion": {"cavityStrength": 0.16, "contactShadowBias": 0.25}, "localOverrides": []}, options, true)
  );
  mesh_hand_l_4.name = "hand-l";
  if (endpoint_hand_l_4) {
    mesh_hand_l_4.position.copy(endpoint_hand_l_4.midpoint);
    mesh_hand_l_4.quaternion.copy(endpoint_hand_l_4.quaternion);
  }
  mesh_hand_l_4.castShadow = options.castShadow ?? true;
  mesh_hand_l_4.receiveShadow = options.receiveShadow ?? true;
  mesh_hand_l_4.userData.sculptComponent = {"id": "hand-l", "name": "hand-l", "level": "meso", "role": "body", "importance": 1.0, "confidence": 0.78, "primitive": "ellipsoid", "topologyClass": "implicit", "topologyRationale": "Continuous sculpt volume made from smoothly blended fields, not independently rendered spheres.", "geometryDescriptor": {"sdf": {"primitives": [{"id": "palm", "type": "ellipsoid", "center": [0.325, 0.842, 0.005], "radii": [0.038, 0.057, 0.024]}, {"id": "finger0", "type": "ellipsoid", "center": [0.301, 0.798, 0.01], "radii": [0.009, 0.034, 0.011]}, {"id": "finger1", "type": "ellipsoid", "center": [0.317, 0.792, 0.01], "radii": [0.009, 0.038, 0.011]}, {"id": "finger2", "type": "ellipsoid", "center": [0.33299999999999996, 0.798, 0.01], "radii": [0.009, 0.034, 0.011]}, {"id": "finger3", "type": "ellipsoid", "center": [0.349, 0.804, 0.01], "radii": [0.009, 0.03, 0.011]}, {"id": "thumb", "type": "ellipsoid", "center": [0.29, 0.84, 0.027], "radii": [0.017, 0.029, 0.014]}], "operations": [{"id": "blend0", "type": "smooth-union", "left": "palm", "right": "finger0", "radius": 0.003}, {"id": "blend1", "type": "smooth-union", "left": "blend0", "right": "finger1", "radius": 0.003}, {"id": "blend2", "type": "smooth-union", "left": "blend1", "right": "finger2", "radius": 0.003}, {"id": "blend3", "type": "smooth-union", "left": "blend2", "right": "finger3", "radius": 0.003}, {"id": "blend4", "type": "smooth-union", "left": "blend3", "right": "thumb", "radius": 0.003}], "bounds": {"min": [0.24799999999999997, 0.729, -0.044], "max": [0.388, 0.924, 0.066]}, "resolution": 40}, "normalStrategy": "smooth vertex normals"}, "parent": "root", "attachment": null, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.78}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "hand-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "skin", "materialLayers": ["skin"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(213, 154, 115, 1)", "secondaryAlbedo": "rgba(213, 154, 115, 1)", "materialClass": "skin", "materialClassConfidence": 0.8, "evidenceRefs": ["full-object"]}};
  node_hand_l_4.add(mesh_hand_l_4);
  meshes["hand-l"] = mesh_hand_l_4;
  colliders["hand-l"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["hand-l"] ??= [];
  destructionGroups["hand-l"].push(node_hand_l_4);

  const endpoint_shoe_l_5 = makeAttachmentEndpoint(null);
  const node_shoe_l_5 = new THREE.Group();
  node_shoe_l_5.name = "shoe-l__pivot";
  node_shoe_l_5.scale.set(1, 1, 1);
  if (endpoint_shoe_l_5) {
    node_shoe_l_5.position.copy(endpoint_shoe_l_5.start);
    node_shoe_l_5.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_shoe_l_5.position.set(0.0, 0.0, 0.0);
    node_shoe_l_5.rotation.set(0.0, 0.0, 0.0);
  }
  node_shoe_l_5.userData.sculptComponent = {"id": "shoe-l", "name": "shoe-l", "level": "meso", "role": "body", "importance": 1.0, "confidence": 0.78, "primitive": "ellipsoid", "topologyClass": "implicit", "topologyRationale": "Continuous sculpt volume made from smoothly blended fields, not independently rendered spheres.", "geometryDescriptor": {"sdf": {"primitives": [{"id": "ankle", "type": "ellipsoid", "center": [0.115, 0.105, -0.003], "radii": [0.065, 0.08, 0.075]}, {"id": "toe", "type": "ellipsoid", "center": [0.115, 0.053, 0.065], "radii": [0.068, 0.05, 0.115]}], "operations": [{"id": "blend0", "type": "smooth-union", "left": "ankle", "right": "toe", "radius": 0.022}], "bounds": {"min": [0.022, -0.022000000000000006, -0.10300000000000001], "max": [0.208, 0.21, 0.205]}, "resolution": 40}, "normalStrategy": "smooth vertex normals"}, "parent": "root", "attachment": null, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.78}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "shoe-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "shoes", "materialLayers": ["shoes"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(39, 41, 50, 1)", "secondaryAlbedo": "rgba(39, 41, 50, 1)", "materialClass": "plastic", "materialClassConfidence": 0.8, "evidenceRefs": ["full-object"]}};
  node_shoe_l_5.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "shoe-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["root"] ?? root).add(node_shoe_l_5);
  nodes["shoe-l"] = node_shoe_l_5;
  const mesh_shoe_l_5Geometry = polygonizeSdf({"primitives": [{"id": "ankle", "type": "ellipsoid", "center": [0.115, 0.105, -0.003], "radii": [0.065, 0.08, 0.075]}, {"id": "toe", "type": "ellipsoid", "center": [0.115, 0.053, 0.065], "radii": [0.068, 0.05, 0.115]}], "operations": [{"id": "blend0", "type": "smooth-union", "left": "ankle", "right": "toe", "radius": 0.022}], "bounds": {"min": [0.022, -0.022000000000000006, -0.10300000000000001], "max": [0.208, 0.21, 0.205]}, "resolution": 40});
  if (!endpoint_shoe_l_5) {
    mesh_shoe_l_5Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_shoe_l_5 = new THREE.Mesh(
    mesh_shoe_l_5Geometry,
    createSculptMaterial("shoes", {"id": "shoes", "name": "shoes", "type": "standard", "shaderModel": "MeshStandardMaterial", "baseColor": "#272932", "color": "#272932", "roughness": 0.78, "metalness": 0, "textureless": {"declared": true, "evidence": ["reference-isolated.png: broad smooth color regions, no observable pore/grain pattern at target game distance; simplified art requested by user"]}, "albedo": {"dominant": "#272932", "secondary": ["#272932"]}, "ambientOcclusion": {"cavityStrength": 0.16, "contactShadowBias": 0.25}, "localOverrides": []}, options, true)
  );
  mesh_shoe_l_5.name = "shoe-l";
  if (endpoint_shoe_l_5) {
    mesh_shoe_l_5.position.copy(endpoint_shoe_l_5.midpoint);
    mesh_shoe_l_5.quaternion.copy(endpoint_shoe_l_5.quaternion);
  }
  mesh_shoe_l_5.castShadow = options.castShadow ?? true;
  mesh_shoe_l_5.receiveShadow = options.receiveShadow ?? true;
  mesh_shoe_l_5.userData.sculptComponent = {"id": "shoe-l", "name": "shoe-l", "level": "meso", "role": "body", "importance": 1.0, "confidence": 0.78, "primitive": "ellipsoid", "topologyClass": "implicit", "topologyRationale": "Continuous sculpt volume made from smoothly blended fields, not independently rendered spheres.", "geometryDescriptor": {"sdf": {"primitives": [{"id": "ankle", "type": "ellipsoid", "center": [0.115, 0.105, -0.003], "radii": [0.065, 0.08, 0.075]}, {"id": "toe", "type": "ellipsoid", "center": [0.115, 0.053, 0.065], "radii": [0.068, 0.05, 0.115]}], "operations": [{"id": "blend0", "type": "smooth-union", "left": "ankle", "right": "toe", "radius": 0.022}], "bounds": {"min": [0.022, -0.022000000000000006, -0.10300000000000001], "max": [0.208, 0.21, 0.205]}, "resolution": 40}, "normalStrategy": "smooth vertex normals"}, "parent": "root", "attachment": null, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.78}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "shoe-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "shoes", "materialLayers": ["shoes"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(39, 41, 50, 1)", "secondaryAlbedo": "rgba(39, 41, 50, 1)", "materialClass": "plastic", "materialClassConfidence": 0.8, "evidenceRefs": ["full-object"]}};
  node_shoe_l_5.add(mesh_shoe_l_5);
  meshes["shoe-l"] = mesh_shoe_l_5;
  colliders["shoe-l"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["shoe-l"] ??= [];
  destructionGroups["shoe-l"].push(node_shoe_l_5);

  const endpoint_sole_l_6 = makeAttachmentEndpoint(null);
  const node_sole_l_6 = new THREE.Group();
  node_sole_l_6.name = "sole-l__pivot";
  node_sole_l_6.scale.set(1, 1, 1);
  if (endpoint_sole_l_6) {
    node_sole_l_6.position.copy(endpoint_sole_l_6.start);
    node_sole_l_6.rotation.set(1.5707963267948966, 0.0, 0.0);
  } else {
    node_sole_l_6.position.set(0.115, 0.025, 0.035);
    node_sole_l_6.rotation.set(1.5707963267948966, 0.0, 0.0);
  }
  node_sole_l_6.userData.sculptComponent = {"id": "sole-l", "name": "sole-l", "level": "micro", "role": "body", "importance": 1.0, "confidence": 0.78, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Contour follows the reference silhouette; depth is inferred and tested in orbit.", "geometryDescriptor": {"profile2D": {"points": [[-0.42, -0.45], [0.42, -0.45], [0.5, -0.1], [0.47, 0.45], [0.28, 0.5], [-0.28, 0.5], [-0.47, 0.45], [-0.5, -0.1]], "depth": 1, "bevelEnabled": true, "bevelSize": 0.035, "bevelThickness": 0.035, "bevelSegments": 2}}, "parent": "root", "attachment": null, "dimensions": {"width": 0.145, "height": 0.25, "depth": 0.014, "units": "meters", "confidence": 0.78}, "transform": {"position": [0.115, 0.025, 0.035], "rotation": [1.5707963267948966, 0, 0], "scale": [0.145, 0.25, 0.014]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "sole-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "sole", "materialLayers": ["sole"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "shoe-sole", "kind": "contour", "description": "shoe-sole", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(23, 26, 34, 1)", "secondaryAlbedo": "rgba(23, 26, 34, 1)", "materialClass": "plastic", "materialClassConfidence": 0.8, "evidenceRefs": ["full-object"]}};
  node_sole_l_6.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "sole-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["root"] ?? root).add(node_sole_l_6);
  nodes["sole-l"] = node_sole_l_6;
  const mesh_sole_l_6Geometry = endpoint_sole_l_6
    ? new THREE.CylinderGeometry(endpoint_sole_l_6.endRadius, endpoint_sole_l_6.baseRadius, endpoint_sole_l_6.length, 16, 6)
    : buildExtrudeGeometry({"points": [[-0.42, -0.45], [0.42, -0.45], [0.5, -0.1], [0.47, 0.45], [0.28, 0.5], [-0.28, 0.5], [-0.47, 0.45], [-0.5, -0.1]], "depth": 1, "bevelEnabled": true, "bevelSize": 0.035, "bevelThickness": 0.035, "bevelSegments": 2});
  if (!endpoint_sole_l_6) {
    mesh_sole_l_6Geometry.scale(0.145, 0.25, 0.014);
  }
  const mesh_sole_l_6 = new THREE.Mesh(
    mesh_sole_l_6Geometry,
    materialMap["sole"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_sole_l_6.name = "sole-l";
  if (endpoint_sole_l_6) {
    mesh_sole_l_6.position.copy(endpoint_sole_l_6.midpoint);
    mesh_sole_l_6.quaternion.copy(endpoint_sole_l_6.quaternion);
  }
  mesh_sole_l_6.castShadow = options.castShadow ?? true;
  mesh_sole_l_6.receiveShadow = options.receiveShadow ?? true;
  mesh_sole_l_6.userData.sculptComponent = {"id": "sole-l", "name": "sole-l", "level": "micro", "role": "body", "importance": 1.0, "confidence": 0.78, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Contour follows the reference silhouette; depth is inferred and tested in orbit.", "geometryDescriptor": {"profile2D": {"points": [[-0.42, -0.45], [0.42, -0.45], [0.5, -0.1], [0.47, 0.45], [0.28, 0.5], [-0.28, 0.5], [-0.47, 0.45], [-0.5, -0.1]], "depth": 1, "bevelEnabled": true, "bevelSize": 0.035, "bevelThickness": 0.035, "bevelSegments": 2}}, "parent": "root", "attachment": null, "dimensions": {"width": 0.145, "height": 0.25, "depth": 0.014, "units": "meters", "confidence": 0.78}, "transform": {"position": [0.115, 0.025, 0.035], "rotation": [1.5707963267948966, 0, 0], "scale": [0.145, 0.25, 0.014]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "sole-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "sole", "materialLayers": ["sole"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "shoe-sole", "kind": "contour", "description": "shoe-sole", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(23, 26, 34, 1)", "secondaryAlbedo": "rgba(23, 26, 34, 1)", "materialClass": "plastic", "materialClassConfidence": 0.8, "evidenceRefs": ["full-object"]}};
  node_sole_l_6.add(mesh_sole_l_6);
  meshes["sole-l"] = mesh_sole_l_6;
  colliders["sole-l"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["sole-l"] ??= [];
  destructionGroups["sole-l"].push(node_sole_l_6);

  const attachment_lace_l_0_7 = {"parentSocket": "shoe-l", "localStart": [0.07500000000000001, 0.093, 0.11], "localEnd": [0.155, 0.093, 0.09], "contactType": "surface-embed", "embedDepth": 0.002, "gapTolerance": 0.003};
  const endpoint_lace_l_0_7 = null; // authored tubePath already in model coordinates
  const node_lace_l_0_7 = new THREE.Group();
  node_lace_l_0_7.name = "lace-l-0__pivot";
  node_lace_l_0_7.scale.set(1, 1, 1);
  if (endpoint_lace_l_0_7) {
    node_lace_l_0_7.position.copy(endpoint_lace_l_0_7.start);
    node_lace_l_0_7.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_lace_l_0_7.position.set(0.0, 0.0, 0.0);
    node_lace_l_0_7.rotation.set(0.0, 0.0, 0.0);
  }
  node_lace_l_0_7.userData.sculptComponent = {"id": "lace-l-0", "name": "lace-l-0", "level": "micro", "role": "body", "importance": 1.0, "confidence": 0.78, "primitive": "tube", "topologyClass": "assembled-solid", "topologyRationale": "Contour follows the reference silhouette; depth is inferred and tested in orbit.", "geometryDescriptor": {"tubePath": {"points": [[0.07500000000000001, 0.093, 0.11], [0.155, 0.093, 0.09]], "radius": 0.003, "closed": false}, "attachmentGeometry": "authored-path"}, "parent": "root", "attachment": {"parentSocket": "shoe-l", "localStart": [0.07500000000000001, 0.093, 0.11], "localEnd": [0.155, 0.093, 0.09], "contactType": "surface-embed", "embedDepth": 0.002, "gapTolerance": 0.003}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.78}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lace-l-0", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "sole", "materialLayers": ["sole"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "lace-row", "kind": "linework", "description": "lace-row", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(23, 26, 34, 1)", "secondaryAlbedo": "rgba(23, 26, 34, 1)", "materialClass": "plastic", "materialClassConfidence": 0.8, "evidenceRefs": ["full-object"]}};
  node_lace_l_0_7.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lace-l-0", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["root"] ?? root).add(node_lace_l_0_7);
  nodes["lace-l-0"] = node_lace_l_0_7;
  const mesh_lace_l_0_7Geometry = endpoint_lace_l_0_7
    ? new THREE.CylinderGeometry(endpoint_lace_l_0_7.endRadius, endpoint_lace_l_0_7.baseRadius, endpoint_lace_l_0_7.length, 16, 6)
    : buildTubeGeometry({"points": [[0.07500000000000001, 0.093, 0.11], [0.155, 0.093, 0.09]], "radius": 0.003, "closed": false});
  if (!endpoint_lace_l_0_7) {
    mesh_lace_l_0_7Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_lace_l_0_7 = new THREE.Mesh(
    mesh_lace_l_0_7Geometry,
    materialMap["sole"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_lace_l_0_7.name = "lace-l-0";
  if (endpoint_lace_l_0_7) {
    mesh_lace_l_0_7.position.copy(endpoint_lace_l_0_7.midpoint);
    mesh_lace_l_0_7.quaternion.copy(endpoint_lace_l_0_7.quaternion);
  }
  mesh_lace_l_0_7.castShadow = options.castShadow ?? true;
  mesh_lace_l_0_7.receiveShadow = options.receiveShadow ?? true;
  mesh_lace_l_0_7.userData.sculptComponent = {"id": "lace-l-0", "name": "lace-l-0", "level": "micro", "role": "body", "importance": 1.0, "confidence": 0.78, "primitive": "tube", "topologyClass": "assembled-solid", "topologyRationale": "Contour follows the reference silhouette; depth is inferred and tested in orbit.", "geometryDescriptor": {"tubePath": {"points": [[0.07500000000000001, 0.093, 0.11], [0.155, 0.093, 0.09]], "radius": 0.003, "closed": false}, "attachmentGeometry": "authored-path"}, "parent": "root", "attachment": {"parentSocket": "shoe-l", "localStart": [0.07500000000000001, 0.093, 0.11], "localEnd": [0.155, 0.093, 0.09], "contactType": "surface-embed", "embedDepth": 0.002, "gapTolerance": 0.003}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.78}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lace-l-0", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "sole", "materialLayers": ["sole"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "lace-row", "kind": "linework", "description": "lace-row", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(23, 26, 34, 1)", "secondaryAlbedo": "rgba(23, 26, 34, 1)", "materialClass": "plastic", "materialClassConfidence": 0.8, "evidenceRefs": ["full-object"]}};
  node_lace_l_0_7.add(mesh_lace_l_0_7);
  meshes["lace-l-0"] = mesh_lace_l_0_7;
  colliders["lace-l-0"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["lace-l-0"] ??= [];
  destructionGroups["lace-l-0"].push(node_lace_l_0_7);

  const attachment_lace_l_1_8 = {"parentSocket": "shoe-l", "localStart": [0.07500000000000001, 0.102, 0.086], "localEnd": [0.155, 0.102, 0.066], "contactType": "surface-embed", "embedDepth": 0.002, "gapTolerance": 0.003};
  const endpoint_lace_l_1_8 = null; // authored tubePath already in model coordinates
  const node_lace_l_1_8 = new THREE.Group();
  node_lace_l_1_8.name = "lace-l-1__pivot";
  node_lace_l_1_8.scale.set(1, 1, 1);
  if (endpoint_lace_l_1_8) {
    node_lace_l_1_8.position.copy(endpoint_lace_l_1_8.start);
    node_lace_l_1_8.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_lace_l_1_8.position.set(0.0, 0.0, 0.0);
    node_lace_l_1_8.rotation.set(0.0, 0.0, 0.0);
  }
  node_lace_l_1_8.userData.sculptComponent = {"id": "lace-l-1", "name": "lace-l-1", "level": "micro", "role": "body", "importance": 1.0, "confidence": 0.78, "primitive": "tube", "topologyClass": "assembled-solid", "topologyRationale": "Contour follows the reference silhouette; depth is inferred and tested in orbit.", "geometryDescriptor": {"tubePath": {"points": [[0.07500000000000001, 0.102, 0.086], [0.155, 0.102, 0.066]], "radius": 0.003, "closed": false}, "attachmentGeometry": "authored-path"}, "parent": "root", "attachment": {"parentSocket": "shoe-l", "localStart": [0.07500000000000001, 0.102, 0.086], "localEnd": [0.155, 0.102, 0.066], "contactType": "surface-embed", "embedDepth": 0.002, "gapTolerance": 0.003}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.78}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lace-l-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "sole", "materialLayers": ["sole"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(23, 26, 34, 1)", "secondaryAlbedo": "rgba(23, 26, 34, 1)", "materialClass": "plastic", "materialClassConfidence": 0.8, "evidenceRefs": ["full-object"]}};
  node_lace_l_1_8.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lace-l-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["root"] ?? root).add(node_lace_l_1_8);
  nodes["lace-l-1"] = node_lace_l_1_8;
  const mesh_lace_l_1_8Geometry = endpoint_lace_l_1_8
    ? new THREE.CylinderGeometry(endpoint_lace_l_1_8.endRadius, endpoint_lace_l_1_8.baseRadius, endpoint_lace_l_1_8.length, 16, 6)
    : buildTubeGeometry({"points": [[0.07500000000000001, 0.102, 0.086], [0.155, 0.102, 0.066]], "radius": 0.003, "closed": false});
  if (!endpoint_lace_l_1_8) {
    mesh_lace_l_1_8Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_lace_l_1_8 = new THREE.Mesh(
    mesh_lace_l_1_8Geometry,
    materialMap["sole"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_lace_l_1_8.name = "lace-l-1";
  if (endpoint_lace_l_1_8) {
    mesh_lace_l_1_8.position.copy(endpoint_lace_l_1_8.midpoint);
    mesh_lace_l_1_8.quaternion.copy(endpoint_lace_l_1_8.quaternion);
  }
  mesh_lace_l_1_8.castShadow = options.castShadow ?? true;
  mesh_lace_l_1_8.receiveShadow = options.receiveShadow ?? true;
  mesh_lace_l_1_8.userData.sculptComponent = {"id": "lace-l-1", "name": "lace-l-1", "level": "micro", "role": "body", "importance": 1.0, "confidence": 0.78, "primitive": "tube", "topologyClass": "assembled-solid", "topologyRationale": "Contour follows the reference silhouette; depth is inferred and tested in orbit.", "geometryDescriptor": {"tubePath": {"points": [[0.07500000000000001, 0.102, 0.086], [0.155, 0.102, 0.066]], "radius": 0.003, "closed": false}, "attachmentGeometry": "authored-path"}, "parent": "root", "attachment": {"parentSocket": "shoe-l", "localStart": [0.07500000000000001, 0.102, 0.086], "localEnd": [0.155, 0.102, 0.066], "contactType": "surface-embed", "embedDepth": 0.002, "gapTolerance": 0.003}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.78}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lace-l-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "sole", "materialLayers": ["sole"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(23, 26, 34, 1)", "secondaryAlbedo": "rgba(23, 26, 34, 1)", "materialClass": "plastic", "materialClassConfidence": 0.8, "evidenceRefs": ["full-object"]}};
  node_lace_l_1_8.add(mesh_lace_l_1_8);
  meshes["lace-l-1"] = mesh_lace_l_1_8;
  colliders["lace-l-1"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["lace-l-1"] ??= [];
  destructionGroups["lace-l-1"].push(node_lace_l_1_8);

  const attachment_lace_l_2_9 = {"parentSocket": "shoe-l", "localStart": [0.07500000000000001, 0.111, 0.062], "localEnd": [0.155, 0.111, 0.041999999999999996], "contactType": "surface-embed", "embedDepth": 0.002, "gapTolerance": 0.003};
  const endpoint_lace_l_2_9 = null; // authored tubePath already in model coordinates
  const node_lace_l_2_9 = new THREE.Group();
  node_lace_l_2_9.name = "lace-l-2__pivot";
  node_lace_l_2_9.scale.set(1, 1, 1);
  if (endpoint_lace_l_2_9) {
    node_lace_l_2_9.position.copy(endpoint_lace_l_2_9.start);
    node_lace_l_2_9.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_lace_l_2_9.position.set(0.0, 0.0, 0.0);
    node_lace_l_2_9.rotation.set(0.0, 0.0, 0.0);
  }
  node_lace_l_2_9.userData.sculptComponent = {"id": "lace-l-2", "name": "lace-l-2", "level": "micro", "role": "body", "importance": 1.0, "confidence": 0.78, "primitive": "tube", "topologyClass": "assembled-solid", "topologyRationale": "Contour follows the reference silhouette; depth is inferred and tested in orbit.", "geometryDescriptor": {"tubePath": {"points": [[0.07500000000000001, 0.111, 0.062], [0.155, 0.111, 0.041999999999999996]], "radius": 0.003, "closed": false}, "attachmentGeometry": "authored-path"}, "parent": "root", "attachment": {"parentSocket": "shoe-l", "localStart": [0.07500000000000001, 0.111, 0.062], "localEnd": [0.155, 0.111, 0.041999999999999996], "contactType": "surface-embed", "embedDepth": 0.002, "gapTolerance": 0.003}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.78}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lace-l-2", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "sole", "materialLayers": ["sole"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(23, 26, 34, 1)", "secondaryAlbedo": "rgba(23, 26, 34, 1)", "materialClass": "plastic", "materialClassConfidence": 0.8, "evidenceRefs": ["full-object"]}};
  node_lace_l_2_9.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lace-l-2", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["root"] ?? root).add(node_lace_l_2_9);
  nodes["lace-l-2"] = node_lace_l_2_9;
  const mesh_lace_l_2_9Geometry = endpoint_lace_l_2_9
    ? new THREE.CylinderGeometry(endpoint_lace_l_2_9.endRadius, endpoint_lace_l_2_9.baseRadius, endpoint_lace_l_2_9.length, 16, 6)
    : buildTubeGeometry({"points": [[0.07500000000000001, 0.111, 0.062], [0.155, 0.111, 0.041999999999999996]], "radius": 0.003, "closed": false});
  if (!endpoint_lace_l_2_9) {
    mesh_lace_l_2_9Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_lace_l_2_9 = new THREE.Mesh(
    mesh_lace_l_2_9Geometry,
    materialMap["sole"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_lace_l_2_9.name = "lace-l-2";
  if (endpoint_lace_l_2_9) {
    mesh_lace_l_2_9.position.copy(endpoint_lace_l_2_9.midpoint);
    mesh_lace_l_2_9.quaternion.copy(endpoint_lace_l_2_9.quaternion);
  }
  mesh_lace_l_2_9.castShadow = options.castShadow ?? true;
  mesh_lace_l_2_9.receiveShadow = options.receiveShadow ?? true;
  mesh_lace_l_2_9.userData.sculptComponent = {"id": "lace-l-2", "name": "lace-l-2", "level": "micro", "role": "body", "importance": 1.0, "confidence": 0.78, "primitive": "tube", "topologyClass": "assembled-solid", "topologyRationale": "Contour follows the reference silhouette; depth is inferred and tested in orbit.", "geometryDescriptor": {"tubePath": {"points": [[0.07500000000000001, 0.111, 0.062], [0.155, 0.111, 0.041999999999999996]], "radius": 0.003, "closed": false}, "attachmentGeometry": "authored-path"}, "parent": "root", "attachment": {"parentSocket": "shoe-l", "localStart": [0.07500000000000001, 0.111, 0.062], "localEnd": [0.155, 0.111, 0.041999999999999996], "contactType": "surface-embed", "embedDepth": 0.002, "gapTolerance": 0.003}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.78}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lace-l-2", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "sole", "materialLayers": ["sole"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(23, 26, 34, 1)", "secondaryAlbedo": "rgba(23, 26, 34, 1)", "materialClass": "plastic", "materialClassConfidence": 0.8, "evidenceRefs": ["full-object"]}};
  node_lace_l_2_9.add(mesh_lace_l_2_9);
  meshes["lace-l-2"] = mesh_lace_l_2_9;
  colliders["lace-l-2"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["lace-l-2"] ??= [];
  destructionGroups["lace-l-2"].push(node_lace_l_2_9);

  const attachment_lace_l_3_10 = {"parentSocket": "shoe-l", "localStart": [0.07500000000000001, 0.12, 0.03799999999999999], "localEnd": [0.155, 0.12, 0.017999999999999988], "contactType": "surface-embed", "embedDepth": 0.002, "gapTolerance": 0.003};
  const endpoint_lace_l_3_10 = null; // authored tubePath already in model coordinates
  const node_lace_l_3_10 = new THREE.Group();
  node_lace_l_3_10.name = "lace-l-3__pivot";
  node_lace_l_3_10.scale.set(1, 1, 1);
  if (endpoint_lace_l_3_10) {
    node_lace_l_3_10.position.copy(endpoint_lace_l_3_10.start);
    node_lace_l_3_10.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_lace_l_3_10.position.set(0.0, 0.0, 0.0);
    node_lace_l_3_10.rotation.set(0.0, 0.0, 0.0);
  }
  node_lace_l_3_10.userData.sculptComponent = {"id": "lace-l-3", "name": "lace-l-3", "level": "micro", "role": "body", "importance": 1.0, "confidence": 0.78, "primitive": "tube", "topologyClass": "assembled-solid", "topologyRationale": "Contour follows the reference silhouette; depth is inferred and tested in orbit.", "geometryDescriptor": {"tubePath": {"points": [[0.07500000000000001, 0.12, 0.03799999999999999], [0.155, 0.12, 0.017999999999999988]], "radius": 0.003, "closed": false}, "attachmentGeometry": "authored-path"}, "parent": "root", "attachment": {"parentSocket": "shoe-l", "localStart": [0.07500000000000001, 0.12, 0.03799999999999999], "localEnd": [0.155, 0.12, 0.017999999999999988], "contactType": "surface-embed", "embedDepth": 0.002, "gapTolerance": 0.003}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.78}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lace-l-3", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "sole", "materialLayers": ["sole"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(23, 26, 34, 1)", "secondaryAlbedo": "rgba(23, 26, 34, 1)", "materialClass": "plastic", "materialClassConfidence": 0.8, "evidenceRefs": ["full-object"]}};
  node_lace_l_3_10.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lace-l-3", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["root"] ?? root).add(node_lace_l_3_10);
  nodes["lace-l-3"] = node_lace_l_3_10;
  const mesh_lace_l_3_10Geometry = endpoint_lace_l_3_10
    ? new THREE.CylinderGeometry(endpoint_lace_l_3_10.endRadius, endpoint_lace_l_3_10.baseRadius, endpoint_lace_l_3_10.length, 16, 6)
    : buildTubeGeometry({"points": [[0.07500000000000001, 0.12, 0.03799999999999999], [0.155, 0.12, 0.017999999999999988]], "radius": 0.003, "closed": false});
  if (!endpoint_lace_l_3_10) {
    mesh_lace_l_3_10Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_lace_l_3_10 = new THREE.Mesh(
    mesh_lace_l_3_10Geometry,
    materialMap["sole"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_lace_l_3_10.name = "lace-l-3";
  if (endpoint_lace_l_3_10) {
    mesh_lace_l_3_10.position.copy(endpoint_lace_l_3_10.midpoint);
    mesh_lace_l_3_10.quaternion.copy(endpoint_lace_l_3_10.quaternion);
  }
  mesh_lace_l_3_10.castShadow = options.castShadow ?? true;
  mesh_lace_l_3_10.receiveShadow = options.receiveShadow ?? true;
  mesh_lace_l_3_10.userData.sculptComponent = {"id": "lace-l-3", "name": "lace-l-3", "level": "micro", "role": "body", "importance": 1.0, "confidence": 0.78, "primitive": "tube", "topologyClass": "assembled-solid", "topologyRationale": "Contour follows the reference silhouette; depth is inferred and tested in orbit.", "geometryDescriptor": {"tubePath": {"points": [[0.07500000000000001, 0.12, 0.03799999999999999], [0.155, 0.12, 0.017999999999999988]], "radius": 0.003, "closed": false}, "attachmentGeometry": "authored-path"}, "parent": "root", "attachment": {"parentSocket": "shoe-l", "localStart": [0.07500000000000001, 0.12, 0.03799999999999999], "localEnd": [0.155, 0.12, 0.017999999999999988], "contactType": "surface-embed", "embedDepth": 0.002, "gapTolerance": 0.003}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.78}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lace-l-3", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "sole", "materialLayers": ["sole"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(23, 26, 34, 1)", "secondaryAlbedo": "rgba(23, 26, 34, 1)", "materialClass": "plastic", "materialClassConfidence": 0.8, "evidenceRefs": ["full-object"]}};
  node_lace_l_3_10.add(mesh_lace_l_3_10);
  meshes["lace-l-3"] = mesh_lace_l_3_10;
  colliders["lace-l-3"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["lace-l-3"] ??= [];
  destructionGroups["lace-l-3"].push(node_lace_l_3_10);

  const endpoint_arm_r_11 = makeAttachmentEndpoint(null);
  const node_arm_r_11 = new THREE.Group();
  node_arm_r_11.name = "arm-r__pivot";
  node_arm_r_11.scale.set(1, 1, 1);
  if (endpoint_arm_r_11) {
    node_arm_r_11.position.copy(endpoint_arm_r_11.start);
    node_arm_r_11.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_arm_r_11.position.set(0.0, 0.0, 0.0);
    node_arm_r_11.rotation.set(0.0, 0.0, 0.0);
  }
  node_arm_r_11.userData.sculptComponent = {"id": "arm-r", "name": "arm-r", "level": "macro", "role": "body", "importance": 1.0, "confidence": 0.78, "primitive": "tapered-sweep", "topologyClass": "continuous-sculpt", "topologyRationale": "Contour follows the reference silhouette; depth is inferred and tested in orbit.", "geometryDescriptor": {"taperedSweep": {"stations": [{"position": [-0.321, 0.88, 0.003], "rx": 0.029, "rz": 0.032, "twist": 0}, {"position": [-0.321, 0.95, 0], "rx": 0.035, "rz": 0.038, "twist": 0}, {"position": [-0.317, 1.045, 0], "rx": 0.048, "rz": 0.055, "twist": 0}, {"position": [-0.31, 1.105, 0], "rx": 0.043, "rz": 0.048, "twist": 0}, {"position": [-0.295, 1.17, 0], "rx": 0.05, "rz": 0.055, "twist": 0}, {"position": [-0.276, 1.245, 0], "rx": 0.06, "rz": 0.064, "twist": 0}, {"position": [-0.258, 1.31, 0], "rx": 0.062, "rz": 0.062, "twist": 0}], "radialSegments": 24, "capEnds": true}, "normalStrategy": "smooth vertex normals"}, "parent": "root", "attachment": {"parentSocket": "shirt-sleeve", "localStart": [-0.258, 1.31, 0], "localEnd": [-0.321, 0.88, 0.003], "contactType": "overlap", "embedDepth": 0.025, "gapTolerance": 0.003}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.78}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "arm-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "skin", "materialLayers": ["skin"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "angular-tattoo", "kind": "linework", "description": "matte dark tribal chevron and curved bands over forearm", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(213, 154, 115, 1)", "secondaryAlbedo": "rgba(213, 154, 115, 1)", "materialClass": "skin", "materialClassConfidence": 0.8, "evidenceRefs": ["full-object"]}};
  node_arm_r_11.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "arm-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["root"] ?? root).add(node_arm_r_11);
  nodes["arm-r"] = node_arm_r_11;
  const mesh_arm_r_11Geometry = endpoint_arm_r_11
    ? new THREE.CylinderGeometry(endpoint_arm_r_11.endRadius, endpoint_arm_r_11.baseRadius, endpoint_arm_r_11.length, 16, 6)
    : buildTaperedSweepGeometry({"stations": [{"position": [-0.321, 0.88, 0.003], "rx": 0.029, "rz": 0.032, "twist": 0}, {"position": [-0.321, 0.95, 0], "rx": 0.035, "rz": 0.038, "twist": 0}, {"position": [-0.317, 1.045, 0], "rx": 0.048, "rz": 0.055, "twist": 0}, {"position": [-0.31, 1.105, 0], "rx": 0.043, "rz": 0.048, "twist": 0}, {"position": [-0.295, 1.17, 0], "rx": 0.05, "rz": 0.055, "twist": 0}, {"position": [-0.276, 1.245, 0], "rx": 0.06, "rz": 0.064, "twist": 0}, {"position": [-0.258, 1.31, 0], "rx": 0.062, "rz": 0.062, "twist": 0}], "radialSegments": 24, "capEnds": true});
  if (!endpoint_arm_r_11) {
    mesh_arm_r_11Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_arm_r_11 = new THREE.Mesh(
    mesh_arm_r_11Geometry,
    materialMap["skin"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_arm_r_11.name = "arm-r";
  if (endpoint_arm_r_11) {
    mesh_arm_r_11.position.copy(endpoint_arm_r_11.midpoint);
    mesh_arm_r_11.quaternion.copy(endpoint_arm_r_11.quaternion);
  }
  mesh_arm_r_11.castShadow = options.castShadow ?? true;
  mesh_arm_r_11.receiveShadow = options.receiveShadow ?? true;
  mesh_arm_r_11.userData.sculptComponent = {"id": "arm-r", "name": "arm-r", "level": "macro", "role": "body", "importance": 1.0, "confidence": 0.78, "primitive": "tapered-sweep", "topologyClass": "continuous-sculpt", "topologyRationale": "Contour follows the reference silhouette; depth is inferred and tested in orbit.", "geometryDescriptor": {"taperedSweep": {"stations": [{"position": [-0.321, 0.88, 0.003], "rx": 0.029, "rz": 0.032, "twist": 0}, {"position": [-0.321, 0.95, 0], "rx": 0.035, "rz": 0.038, "twist": 0}, {"position": [-0.317, 1.045, 0], "rx": 0.048, "rz": 0.055, "twist": 0}, {"position": [-0.31, 1.105, 0], "rx": 0.043, "rz": 0.048, "twist": 0}, {"position": [-0.295, 1.17, 0], "rx": 0.05, "rz": 0.055, "twist": 0}, {"position": [-0.276, 1.245, 0], "rx": 0.06, "rz": 0.064, "twist": 0}, {"position": [-0.258, 1.31, 0], "rx": 0.062, "rz": 0.062, "twist": 0}], "radialSegments": 24, "capEnds": true}, "normalStrategy": "smooth vertex normals"}, "parent": "root", "attachment": {"parentSocket": "shirt-sleeve", "localStart": [-0.258, 1.31, 0], "localEnd": [-0.321, 0.88, 0.003], "contactType": "overlap", "embedDepth": 0.025, "gapTolerance": 0.003}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.78}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "arm-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "skin", "materialLayers": ["skin"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "angular-tattoo", "kind": "linework", "description": "matte dark tribal chevron and curved bands over forearm", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(213, 154, 115, 1)", "secondaryAlbedo": "rgba(213, 154, 115, 1)", "materialClass": "skin", "materialClassConfidence": 0.8, "evidenceRefs": ["full-object"]}};
  node_arm_r_11.add(mesh_arm_r_11);
  meshes["arm-r"] = mesh_arm_r_11;
  colliders["arm-r"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["arm-r"] ??= [];
  destructionGroups["arm-r"].push(node_arm_r_11);

  const endpoint_hand_r_12 = makeAttachmentEndpoint(null);
  const node_hand_r_12 = new THREE.Group();
  node_hand_r_12.name = "hand-r__pivot";
  node_hand_r_12.scale.set(1, 1, 1);
  if (endpoint_hand_r_12) {
    node_hand_r_12.position.copy(endpoint_hand_r_12.start);
    node_hand_r_12.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_hand_r_12.position.set(0.0, 0.0, 0.0);
    node_hand_r_12.rotation.set(0.0, 0.0, 0.0);
  }
  node_hand_r_12.userData.sculptComponent = {"id": "hand-r", "name": "hand-r", "level": "meso", "role": "body", "importance": 1.0, "confidence": 0.78, "primitive": "ellipsoid", "topologyClass": "implicit", "topologyRationale": "Continuous sculpt volume made from smoothly blended fields, not independently rendered spheres.", "geometryDescriptor": {"sdf": {"primitives": [{"id": "palm", "type": "ellipsoid", "center": [-0.325, 0.842, 0.005], "radii": [0.038, 0.057, 0.024]}, {"id": "finger0", "type": "ellipsoid", "center": [-0.301, 0.798, 0.01], "radii": [0.009, 0.034, 0.011]}, {"id": "finger1", "type": "ellipsoid", "center": [-0.317, 0.792, 0.01], "radii": [0.009, 0.038, 0.011]}, {"id": "finger2", "type": "ellipsoid", "center": [-0.33299999999999996, 0.798, 0.01], "radii": [0.009, 0.034, 0.011]}, {"id": "finger3", "type": "ellipsoid", "center": [-0.349, 0.804, 0.01], "radii": [0.009, 0.03, 0.011]}, {"id": "thumb", "type": "ellipsoid", "center": [-0.29, 0.84, 0.027], "radii": [0.017, 0.029, 0.014]}], "operations": [{"id": "blend0", "type": "smooth-union", "left": "palm", "right": "finger0", "radius": 0.003}, {"id": "blend1", "type": "smooth-union", "left": "blend0", "right": "finger1", "radius": 0.003}, {"id": "blend2", "type": "smooth-union", "left": "blend1", "right": "finger2", "radius": 0.003}, {"id": "blend3", "type": "smooth-union", "left": "blend2", "right": "finger3", "radius": 0.003}, {"id": "blend4", "type": "smooth-union", "left": "blend3", "right": "thumb", "radius": 0.003}], "bounds": {"min": [-0.388, 0.729, -0.044], "max": [-0.24799999999999997, 0.924, 0.066]}, "resolution": 40}, "normalStrategy": "smooth vertex normals"}, "parent": "root", "attachment": null, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.78}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "hand-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "skin", "materialLayers": ["skin"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(213, 154, 115, 1)", "secondaryAlbedo": "rgba(213, 154, 115, 1)", "materialClass": "skin", "materialClassConfidence": 0.8, "evidenceRefs": ["full-object"]}};
  node_hand_r_12.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "hand-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["root"] ?? root).add(node_hand_r_12);
  nodes["hand-r"] = node_hand_r_12;
  const mesh_hand_r_12Geometry = polygonizeSdf({"primitives": [{"id": "palm", "type": "ellipsoid", "center": [-0.325, 0.842, 0.005], "radii": [0.038, 0.057, 0.024]}, {"id": "finger0", "type": "ellipsoid", "center": [-0.301, 0.798, 0.01], "radii": [0.009, 0.034, 0.011]}, {"id": "finger1", "type": "ellipsoid", "center": [-0.317, 0.792, 0.01], "radii": [0.009, 0.038, 0.011]}, {"id": "finger2", "type": "ellipsoid", "center": [-0.33299999999999996, 0.798, 0.01], "radii": [0.009, 0.034, 0.011]}, {"id": "finger3", "type": "ellipsoid", "center": [-0.349, 0.804, 0.01], "radii": [0.009, 0.03, 0.011]}, {"id": "thumb", "type": "ellipsoid", "center": [-0.29, 0.84, 0.027], "radii": [0.017, 0.029, 0.014]}], "operations": [{"id": "blend0", "type": "smooth-union", "left": "palm", "right": "finger0", "radius": 0.003}, {"id": "blend1", "type": "smooth-union", "left": "blend0", "right": "finger1", "radius": 0.003}, {"id": "blend2", "type": "smooth-union", "left": "blend1", "right": "finger2", "radius": 0.003}, {"id": "blend3", "type": "smooth-union", "left": "blend2", "right": "finger3", "radius": 0.003}, {"id": "blend4", "type": "smooth-union", "left": "blend3", "right": "thumb", "radius": 0.003}], "bounds": {"min": [-0.388, 0.729, -0.044], "max": [-0.24799999999999997, 0.924, 0.066]}, "resolution": 40});
  if (!endpoint_hand_r_12) {
    mesh_hand_r_12Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_hand_r_12 = new THREE.Mesh(
    mesh_hand_r_12Geometry,
    createSculptMaterial("skin", {"id": "skin", "name": "skin", "type": "standard", "shaderModel": "MeshStandardMaterial", "baseColor": "#d59a73", "color": "#d59a73", "roughness": 0.78, "metalness": 0, "textureless": {"declared": true, "evidence": ["reference-isolated.png: broad smooth color regions, no observable pore/grain pattern at target game distance; simplified art requested by user"]}, "albedo": {"dominant": "#d59a73", "secondary": ["#d59a73"]}, "ambientOcclusion": {"cavityStrength": 0.16, "contactShadowBias": 0.25}, "localOverrides": []}, options, true)
  );
  mesh_hand_r_12.name = "hand-r";
  if (endpoint_hand_r_12) {
    mesh_hand_r_12.position.copy(endpoint_hand_r_12.midpoint);
    mesh_hand_r_12.quaternion.copy(endpoint_hand_r_12.quaternion);
  }
  mesh_hand_r_12.castShadow = options.castShadow ?? true;
  mesh_hand_r_12.receiveShadow = options.receiveShadow ?? true;
  mesh_hand_r_12.userData.sculptComponent = {"id": "hand-r", "name": "hand-r", "level": "meso", "role": "body", "importance": 1.0, "confidence": 0.78, "primitive": "ellipsoid", "topologyClass": "implicit", "topologyRationale": "Continuous sculpt volume made from smoothly blended fields, not independently rendered spheres.", "geometryDescriptor": {"sdf": {"primitives": [{"id": "palm", "type": "ellipsoid", "center": [-0.325, 0.842, 0.005], "radii": [0.038, 0.057, 0.024]}, {"id": "finger0", "type": "ellipsoid", "center": [-0.301, 0.798, 0.01], "radii": [0.009, 0.034, 0.011]}, {"id": "finger1", "type": "ellipsoid", "center": [-0.317, 0.792, 0.01], "radii": [0.009, 0.038, 0.011]}, {"id": "finger2", "type": "ellipsoid", "center": [-0.33299999999999996, 0.798, 0.01], "radii": [0.009, 0.034, 0.011]}, {"id": "finger3", "type": "ellipsoid", "center": [-0.349, 0.804, 0.01], "radii": [0.009, 0.03, 0.011]}, {"id": "thumb", "type": "ellipsoid", "center": [-0.29, 0.84, 0.027], "radii": [0.017, 0.029, 0.014]}], "operations": [{"id": "blend0", "type": "smooth-union", "left": "palm", "right": "finger0", "radius": 0.003}, {"id": "blend1", "type": "smooth-union", "left": "blend0", "right": "finger1", "radius": 0.003}, {"id": "blend2", "type": "smooth-union", "left": "blend1", "right": "finger2", "radius": 0.003}, {"id": "blend3", "type": "smooth-union", "left": "blend2", "right": "finger3", "radius": 0.003}, {"id": "blend4", "type": "smooth-union", "left": "blend3", "right": "thumb", "radius": 0.003}], "bounds": {"min": [-0.388, 0.729, -0.044], "max": [-0.24799999999999997, 0.924, 0.066]}, "resolution": 40}, "normalStrategy": "smooth vertex normals"}, "parent": "root", "attachment": null, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.78}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "hand-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "skin", "materialLayers": ["skin"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(213, 154, 115, 1)", "secondaryAlbedo": "rgba(213, 154, 115, 1)", "materialClass": "skin", "materialClassConfidence": 0.8, "evidenceRefs": ["full-object"]}};
  node_hand_r_12.add(mesh_hand_r_12);
  meshes["hand-r"] = mesh_hand_r_12;
  colliders["hand-r"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["hand-r"] ??= [];
  destructionGroups["hand-r"].push(node_hand_r_12);

  const endpoint_shoe_r_13 = makeAttachmentEndpoint(null);
  const node_shoe_r_13 = new THREE.Group();
  node_shoe_r_13.name = "shoe-r__pivot";
  node_shoe_r_13.scale.set(1, 1, 1);
  if (endpoint_shoe_r_13) {
    node_shoe_r_13.position.copy(endpoint_shoe_r_13.start);
    node_shoe_r_13.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_shoe_r_13.position.set(0.0, 0.0, 0.0);
    node_shoe_r_13.rotation.set(0.0, 0.0, 0.0);
  }
  node_shoe_r_13.userData.sculptComponent = {"id": "shoe-r", "name": "shoe-r", "level": "meso", "role": "body", "importance": 1.0, "confidence": 0.78, "primitive": "ellipsoid", "topologyClass": "implicit", "topologyRationale": "Continuous sculpt volume made from smoothly blended fields, not independently rendered spheres.", "geometryDescriptor": {"sdf": {"primitives": [{"id": "ankle", "type": "ellipsoid", "center": [-0.115, 0.105, -0.003], "radii": [0.065, 0.08, 0.075]}, {"id": "toe", "type": "ellipsoid", "center": [-0.115, 0.053, 0.065], "radii": [0.068, 0.05, 0.115]}], "operations": [{"id": "blend0", "type": "smooth-union", "left": "ankle", "right": "toe", "radius": 0.022}], "bounds": {"min": [-0.208, -0.022000000000000006, -0.10300000000000001], "max": [-0.022, 0.21, 0.205]}, "resolution": 40}, "normalStrategy": "smooth vertex normals"}, "parent": "root", "attachment": null, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.78}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "shoe-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "shoes", "materialLayers": ["shoes"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(39, 41, 50, 1)", "secondaryAlbedo": "rgba(39, 41, 50, 1)", "materialClass": "plastic", "materialClassConfidence": 0.8, "evidenceRefs": ["full-object"]}};
  node_shoe_r_13.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "shoe-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["root"] ?? root).add(node_shoe_r_13);
  nodes["shoe-r"] = node_shoe_r_13;
  const mesh_shoe_r_13Geometry = polygonizeSdf({"primitives": [{"id": "ankle", "type": "ellipsoid", "center": [-0.115, 0.105, -0.003], "radii": [0.065, 0.08, 0.075]}, {"id": "toe", "type": "ellipsoid", "center": [-0.115, 0.053, 0.065], "radii": [0.068, 0.05, 0.115]}], "operations": [{"id": "blend0", "type": "smooth-union", "left": "ankle", "right": "toe", "radius": 0.022}], "bounds": {"min": [-0.208, -0.022000000000000006, -0.10300000000000001], "max": [-0.022, 0.21, 0.205]}, "resolution": 40});
  if (!endpoint_shoe_r_13) {
    mesh_shoe_r_13Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_shoe_r_13 = new THREE.Mesh(
    mesh_shoe_r_13Geometry,
    createSculptMaterial("shoes", {"id": "shoes", "name": "shoes", "type": "standard", "shaderModel": "MeshStandardMaterial", "baseColor": "#272932", "color": "#272932", "roughness": 0.78, "metalness": 0, "textureless": {"declared": true, "evidence": ["reference-isolated.png: broad smooth color regions, no observable pore/grain pattern at target game distance; simplified art requested by user"]}, "albedo": {"dominant": "#272932", "secondary": ["#272932"]}, "ambientOcclusion": {"cavityStrength": 0.16, "contactShadowBias": 0.25}, "localOverrides": []}, options, true)
  );
  mesh_shoe_r_13.name = "shoe-r";
  if (endpoint_shoe_r_13) {
    mesh_shoe_r_13.position.copy(endpoint_shoe_r_13.midpoint);
    mesh_shoe_r_13.quaternion.copy(endpoint_shoe_r_13.quaternion);
  }
  mesh_shoe_r_13.castShadow = options.castShadow ?? true;
  mesh_shoe_r_13.receiveShadow = options.receiveShadow ?? true;
  mesh_shoe_r_13.userData.sculptComponent = {"id": "shoe-r", "name": "shoe-r", "level": "meso", "role": "body", "importance": 1.0, "confidence": 0.78, "primitive": "ellipsoid", "topologyClass": "implicit", "topologyRationale": "Continuous sculpt volume made from smoothly blended fields, not independently rendered spheres.", "geometryDescriptor": {"sdf": {"primitives": [{"id": "ankle", "type": "ellipsoid", "center": [-0.115, 0.105, -0.003], "radii": [0.065, 0.08, 0.075]}, {"id": "toe", "type": "ellipsoid", "center": [-0.115, 0.053, 0.065], "radii": [0.068, 0.05, 0.115]}], "operations": [{"id": "blend0", "type": "smooth-union", "left": "ankle", "right": "toe", "radius": 0.022}], "bounds": {"min": [-0.208, -0.022000000000000006, -0.10300000000000001], "max": [-0.022, 0.21, 0.205]}, "resolution": 40}, "normalStrategy": "smooth vertex normals"}, "parent": "root", "attachment": null, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.78}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "shoe-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "shoes", "materialLayers": ["shoes"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(39, 41, 50, 1)", "secondaryAlbedo": "rgba(39, 41, 50, 1)", "materialClass": "plastic", "materialClassConfidence": 0.8, "evidenceRefs": ["full-object"]}};
  node_shoe_r_13.add(mesh_shoe_r_13);
  meshes["shoe-r"] = mesh_shoe_r_13;
  colliders["shoe-r"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["shoe-r"] ??= [];
  destructionGroups["shoe-r"].push(node_shoe_r_13);

  const endpoint_sole_r_14 = makeAttachmentEndpoint(null);
  const node_sole_r_14 = new THREE.Group();
  node_sole_r_14.name = "sole-r__pivot";
  node_sole_r_14.scale.set(1, 1, 1);
  if (endpoint_sole_r_14) {
    node_sole_r_14.position.copy(endpoint_sole_r_14.start);
    node_sole_r_14.rotation.set(1.5707963267948966, 0.0, 0.0);
  } else {
    node_sole_r_14.position.set(-0.115, 0.025, 0.035);
    node_sole_r_14.rotation.set(1.5707963267948966, 0.0, 0.0);
  }
  node_sole_r_14.userData.sculptComponent = {"id": "sole-r", "name": "sole-r", "level": "micro", "role": "body", "importance": 1.0, "confidence": 0.78, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Contour follows the reference silhouette; depth is inferred and tested in orbit.", "geometryDescriptor": {"profile2D": {"points": [[-0.42, -0.45], [0.42, -0.45], [0.5, -0.1], [0.47, 0.45], [0.28, 0.5], [-0.28, 0.5], [-0.47, 0.45], [-0.5, -0.1]], "depth": 1, "bevelEnabled": true, "bevelSize": 0.035, "bevelThickness": 0.035, "bevelSegments": 2}}, "parent": "root", "attachment": null, "dimensions": {"width": 0.145, "height": 0.25, "depth": 0.014, "units": "meters", "confidence": 0.78}, "transform": {"position": [-0.115, 0.025, 0.035], "rotation": [1.5707963267948966, 0, 0], "scale": [0.145, 0.25, 0.014]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "sole-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "sole", "materialLayers": ["sole"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(23, 26, 34, 1)", "secondaryAlbedo": "rgba(23, 26, 34, 1)", "materialClass": "plastic", "materialClassConfidence": 0.8, "evidenceRefs": ["full-object"]}};
  node_sole_r_14.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "sole-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["root"] ?? root).add(node_sole_r_14);
  nodes["sole-r"] = node_sole_r_14;
  const mesh_sole_r_14Geometry = endpoint_sole_r_14
    ? new THREE.CylinderGeometry(endpoint_sole_r_14.endRadius, endpoint_sole_r_14.baseRadius, endpoint_sole_r_14.length, 16, 6)
    : buildExtrudeGeometry({"points": [[-0.42, -0.45], [0.42, -0.45], [0.5, -0.1], [0.47, 0.45], [0.28, 0.5], [-0.28, 0.5], [-0.47, 0.45], [-0.5, -0.1]], "depth": 1, "bevelEnabled": true, "bevelSize": 0.035, "bevelThickness": 0.035, "bevelSegments": 2});
  if (!endpoint_sole_r_14) {
    mesh_sole_r_14Geometry.scale(0.145, 0.25, 0.014);
  }
  const mesh_sole_r_14 = new THREE.Mesh(
    mesh_sole_r_14Geometry,
    materialMap["sole"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_sole_r_14.name = "sole-r";
  if (endpoint_sole_r_14) {
    mesh_sole_r_14.position.copy(endpoint_sole_r_14.midpoint);
    mesh_sole_r_14.quaternion.copy(endpoint_sole_r_14.quaternion);
  }
  mesh_sole_r_14.castShadow = options.castShadow ?? true;
  mesh_sole_r_14.receiveShadow = options.receiveShadow ?? true;
  mesh_sole_r_14.userData.sculptComponent = {"id": "sole-r", "name": "sole-r", "level": "micro", "role": "body", "importance": 1.0, "confidence": 0.78, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Contour follows the reference silhouette; depth is inferred and tested in orbit.", "geometryDescriptor": {"profile2D": {"points": [[-0.42, -0.45], [0.42, -0.45], [0.5, -0.1], [0.47, 0.45], [0.28, 0.5], [-0.28, 0.5], [-0.47, 0.45], [-0.5, -0.1]], "depth": 1, "bevelEnabled": true, "bevelSize": 0.035, "bevelThickness": 0.035, "bevelSegments": 2}}, "parent": "root", "attachment": null, "dimensions": {"width": 0.145, "height": 0.25, "depth": 0.014, "units": "meters", "confidence": 0.78}, "transform": {"position": [-0.115, 0.025, 0.035], "rotation": [1.5707963267948966, 0, 0], "scale": [0.145, 0.25, 0.014]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "sole-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "sole", "materialLayers": ["sole"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(23, 26, 34, 1)", "secondaryAlbedo": "rgba(23, 26, 34, 1)", "materialClass": "plastic", "materialClassConfidence": 0.8, "evidenceRefs": ["full-object"]}};
  node_sole_r_14.add(mesh_sole_r_14);
  meshes["sole-r"] = mesh_sole_r_14;
  colliders["sole-r"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["sole-r"] ??= [];
  destructionGroups["sole-r"].push(node_sole_r_14);

  const attachment_lace_r_0_15 = {"parentSocket": "shoe-r", "localStart": [-0.155, 0.093, 0.11], "localEnd": [-0.07500000000000001, 0.093, 0.09], "contactType": "surface-embed", "embedDepth": 0.002, "gapTolerance": 0.003};
  const endpoint_lace_r_0_15 = null; // authored tubePath already in model coordinates
  const node_lace_r_0_15 = new THREE.Group();
  node_lace_r_0_15.name = "lace-r-0__pivot";
  node_lace_r_0_15.scale.set(1, 1, 1);
  if (endpoint_lace_r_0_15) {
    node_lace_r_0_15.position.copy(endpoint_lace_r_0_15.start);
    node_lace_r_0_15.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_lace_r_0_15.position.set(0.0, 0.0, 0.0);
    node_lace_r_0_15.rotation.set(0.0, 0.0, 0.0);
  }
  node_lace_r_0_15.userData.sculptComponent = {"id": "lace-r-0", "name": "lace-r-0", "level": "micro", "role": "body", "importance": 1.0, "confidence": 0.78, "primitive": "tube", "topologyClass": "assembled-solid", "topologyRationale": "Contour follows the reference silhouette; depth is inferred and tested in orbit.", "geometryDescriptor": {"tubePath": {"points": [[-0.155, 0.093, 0.11], [-0.07500000000000001, 0.093, 0.09]], "radius": 0.003, "closed": false}, "attachmentGeometry": "authored-path"}, "parent": "root", "attachment": {"parentSocket": "shoe-r", "localStart": [-0.155, 0.093, 0.11], "localEnd": [-0.07500000000000001, 0.093, 0.09], "contactType": "surface-embed", "embedDepth": 0.002, "gapTolerance": 0.003}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.78}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lace-r-0", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "sole", "materialLayers": ["sole"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(23, 26, 34, 1)", "secondaryAlbedo": "rgba(23, 26, 34, 1)", "materialClass": "plastic", "materialClassConfidence": 0.8, "evidenceRefs": ["full-object"]}};
  node_lace_r_0_15.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lace-r-0", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["root"] ?? root).add(node_lace_r_0_15);
  nodes["lace-r-0"] = node_lace_r_0_15;
  const mesh_lace_r_0_15Geometry = endpoint_lace_r_0_15
    ? new THREE.CylinderGeometry(endpoint_lace_r_0_15.endRadius, endpoint_lace_r_0_15.baseRadius, endpoint_lace_r_0_15.length, 16, 6)
    : buildTubeGeometry({"points": [[-0.155, 0.093, 0.11], [-0.07500000000000001, 0.093, 0.09]], "radius": 0.003, "closed": false});
  if (!endpoint_lace_r_0_15) {
    mesh_lace_r_0_15Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_lace_r_0_15 = new THREE.Mesh(
    mesh_lace_r_0_15Geometry,
    materialMap["sole"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_lace_r_0_15.name = "lace-r-0";
  if (endpoint_lace_r_0_15) {
    mesh_lace_r_0_15.position.copy(endpoint_lace_r_0_15.midpoint);
    mesh_lace_r_0_15.quaternion.copy(endpoint_lace_r_0_15.quaternion);
  }
  mesh_lace_r_0_15.castShadow = options.castShadow ?? true;
  mesh_lace_r_0_15.receiveShadow = options.receiveShadow ?? true;
  mesh_lace_r_0_15.userData.sculptComponent = {"id": "lace-r-0", "name": "lace-r-0", "level": "micro", "role": "body", "importance": 1.0, "confidence": 0.78, "primitive": "tube", "topologyClass": "assembled-solid", "topologyRationale": "Contour follows the reference silhouette; depth is inferred and tested in orbit.", "geometryDescriptor": {"tubePath": {"points": [[-0.155, 0.093, 0.11], [-0.07500000000000001, 0.093, 0.09]], "radius": 0.003, "closed": false}, "attachmentGeometry": "authored-path"}, "parent": "root", "attachment": {"parentSocket": "shoe-r", "localStart": [-0.155, 0.093, 0.11], "localEnd": [-0.07500000000000001, 0.093, 0.09], "contactType": "surface-embed", "embedDepth": 0.002, "gapTolerance": 0.003}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.78}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lace-r-0", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "sole", "materialLayers": ["sole"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(23, 26, 34, 1)", "secondaryAlbedo": "rgba(23, 26, 34, 1)", "materialClass": "plastic", "materialClassConfidence": 0.8, "evidenceRefs": ["full-object"]}};
  node_lace_r_0_15.add(mesh_lace_r_0_15);
  meshes["lace-r-0"] = mesh_lace_r_0_15;
  colliders["lace-r-0"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["lace-r-0"] ??= [];
  destructionGroups["lace-r-0"].push(node_lace_r_0_15);

  const attachment_lace_r_1_16 = {"parentSocket": "shoe-r", "localStart": [-0.155, 0.102, 0.086], "localEnd": [-0.07500000000000001, 0.102, 0.066], "contactType": "surface-embed", "embedDepth": 0.002, "gapTolerance": 0.003};
  const endpoint_lace_r_1_16 = null; // authored tubePath already in model coordinates
  const node_lace_r_1_16 = new THREE.Group();
  node_lace_r_1_16.name = "lace-r-1__pivot";
  node_lace_r_1_16.scale.set(1, 1, 1);
  if (endpoint_lace_r_1_16) {
    node_lace_r_1_16.position.copy(endpoint_lace_r_1_16.start);
    node_lace_r_1_16.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_lace_r_1_16.position.set(0.0, 0.0, 0.0);
    node_lace_r_1_16.rotation.set(0.0, 0.0, 0.0);
  }
  node_lace_r_1_16.userData.sculptComponent = {"id": "lace-r-1", "name": "lace-r-1", "level": "micro", "role": "body", "importance": 1.0, "confidence": 0.78, "primitive": "tube", "topologyClass": "assembled-solid", "topologyRationale": "Contour follows the reference silhouette; depth is inferred and tested in orbit.", "geometryDescriptor": {"tubePath": {"points": [[-0.155, 0.102, 0.086], [-0.07500000000000001, 0.102, 0.066]], "radius": 0.003, "closed": false}, "attachmentGeometry": "authored-path"}, "parent": "root", "attachment": {"parentSocket": "shoe-r", "localStart": [-0.155, 0.102, 0.086], "localEnd": [-0.07500000000000001, 0.102, 0.066], "contactType": "surface-embed", "embedDepth": 0.002, "gapTolerance": 0.003}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.78}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lace-r-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "sole", "materialLayers": ["sole"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(23, 26, 34, 1)", "secondaryAlbedo": "rgba(23, 26, 34, 1)", "materialClass": "plastic", "materialClassConfidence": 0.8, "evidenceRefs": ["full-object"]}};
  node_lace_r_1_16.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lace-r-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["root"] ?? root).add(node_lace_r_1_16);
  nodes["lace-r-1"] = node_lace_r_1_16;
  const mesh_lace_r_1_16Geometry = endpoint_lace_r_1_16
    ? new THREE.CylinderGeometry(endpoint_lace_r_1_16.endRadius, endpoint_lace_r_1_16.baseRadius, endpoint_lace_r_1_16.length, 16, 6)
    : buildTubeGeometry({"points": [[-0.155, 0.102, 0.086], [-0.07500000000000001, 0.102, 0.066]], "radius": 0.003, "closed": false});
  if (!endpoint_lace_r_1_16) {
    mesh_lace_r_1_16Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_lace_r_1_16 = new THREE.Mesh(
    mesh_lace_r_1_16Geometry,
    materialMap["sole"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_lace_r_1_16.name = "lace-r-1";
  if (endpoint_lace_r_1_16) {
    mesh_lace_r_1_16.position.copy(endpoint_lace_r_1_16.midpoint);
    mesh_lace_r_1_16.quaternion.copy(endpoint_lace_r_1_16.quaternion);
  }
  mesh_lace_r_1_16.castShadow = options.castShadow ?? true;
  mesh_lace_r_1_16.receiveShadow = options.receiveShadow ?? true;
  mesh_lace_r_1_16.userData.sculptComponent = {"id": "lace-r-1", "name": "lace-r-1", "level": "micro", "role": "body", "importance": 1.0, "confidence": 0.78, "primitive": "tube", "topologyClass": "assembled-solid", "topologyRationale": "Contour follows the reference silhouette; depth is inferred and tested in orbit.", "geometryDescriptor": {"tubePath": {"points": [[-0.155, 0.102, 0.086], [-0.07500000000000001, 0.102, 0.066]], "radius": 0.003, "closed": false}, "attachmentGeometry": "authored-path"}, "parent": "root", "attachment": {"parentSocket": "shoe-r", "localStart": [-0.155, 0.102, 0.086], "localEnd": [-0.07500000000000001, 0.102, 0.066], "contactType": "surface-embed", "embedDepth": 0.002, "gapTolerance": 0.003}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.78}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lace-r-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "sole", "materialLayers": ["sole"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(23, 26, 34, 1)", "secondaryAlbedo": "rgba(23, 26, 34, 1)", "materialClass": "plastic", "materialClassConfidence": 0.8, "evidenceRefs": ["full-object"]}};
  node_lace_r_1_16.add(mesh_lace_r_1_16);
  meshes["lace-r-1"] = mesh_lace_r_1_16;
  colliders["lace-r-1"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["lace-r-1"] ??= [];
  destructionGroups["lace-r-1"].push(node_lace_r_1_16);

  const attachment_lace_r_2_17 = {"parentSocket": "shoe-r", "localStart": [-0.155, 0.111, 0.062], "localEnd": [-0.07500000000000001, 0.111, 0.041999999999999996], "contactType": "surface-embed", "embedDepth": 0.002, "gapTolerance": 0.003};
  const endpoint_lace_r_2_17 = null; // authored tubePath already in model coordinates
  const node_lace_r_2_17 = new THREE.Group();
  node_lace_r_2_17.name = "lace-r-2__pivot";
  node_lace_r_2_17.scale.set(1, 1, 1);
  if (endpoint_lace_r_2_17) {
    node_lace_r_2_17.position.copy(endpoint_lace_r_2_17.start);
    node_lace_r_2_17.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_lace_r_2_17.position.set(0.0, 0.0, 0.0);
    node_lace_r_2_17.rotation.set(0.0, 0.0, 0.0);
  }
  node_lace_r_2_17.userData.sculptComponent = {"id": "lace-r-2", "name": "lace-r-2", "level": "micro", "role": "body", "importance": 1.0, "confidence": 0.78, "primitive": "tube", "topologyClass": "assembled-solid", "topologyRationale": "Contour follows the reference silhouette; depth is inferred and tested in orbit.", "geometryDescriptor": {"tubePath": {"points": [[-0.155, 0.111, 0.062], [-0.07500000000000001, 0.111, 0.041999999999999996]], "radius": 0.003, "closed": false}, "attachmentGeometry": "authored-path"}, "parent": "root", "attachment": {"parentSocket": "shoe-r", "localStart": [-0.155, 0.111, 0.062], "localEnd": [-0.07500000000000001, 0.111, 0.041999999999999996], "contactType": "surface-embed", "embedDepth": 0.002, "gapTolerance": 0.003}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.78}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lace-r-2", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "sole", "materialLayers": ["sole"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(23, 26, 34, 1)", "secondaryAlbedo": "rgba(23, 26, 34, 1)", "materialClass": "plastic", "materialClassConfidence": 0.8, "evidenceRefs": ["full-object"]}};
  node_lace_r_2_17.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lace-r-2", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["root"] ?? root).add(node_lace_r_2_17);
  nodes["lace-r-2"] = node_lace_r_2_17;
  const mesh_lace_r_2_17Geometry = endpoint_lace_r_2_17
    ? new THREE.CylinderGeometry(endpoint_lace_r_2_17.endRadius, endpoint_lace_r_2_17.baseRadius, endpoint_lace_r_2_17.length, 16, 6)
    : buildTubeGeometry({"points": [[-0.155, 0.111, 0.062], [-0.07500000000000001, 0.111, 0.041999999999999996]], "radius": 0.003, "closed": false});
  if (!endpoint_lace_r_2_17) {
    mesh_lace_r_2_17Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_lace_r_2_17 = new THREE.Mesh(
    mesh_lace_r_2_17Geometry,
    materialMap["sole"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_lace_r_2_17.name = "lace-r-2";
  if (endpoint_lace_r_2_17) {
    mesh_lace_r_2_17.position.copy(endpoint_lace_r_2_17.midpoint);
    mesh_lace_r_2_17.quaternion.copy(endpoint_lace_r_2_17.quaternion);
  }
  mesh_lace_r_2_17.castShadow = options.castShadow ?? true;
  mesh_lace_r_2_17.receiveShadow = options.receiveShadow ?? true;
  mesh_lace_r_2_17.userData.sculptComponent = {"id": "lace-r-2", "name": "lace-r-2", "level": "micro", "role": "body", "importance": 1.0, "confidence": 0.78, "primitive": "tube", "topologyClass": "assembled-solid", "topologyRationale": "Contour follows the reference silhouette; depth is inferred and tested in orbit.", "geometryDescriptor": {"tubePath": {"points": [[-0.155, 0.111, 0.062], [-0.07500000000000001, 0.111, 0.041999999999999996]], "radius": 0.003, "closed": false}, "attachmentGeometry": "authored-path"}, "parent": "root", "attachment": {"parentSocket": "shoe-r", "localStart": [-0.155, 0.111, 0.062], "localEnd": [-0.07500000000000001, 0.111, 0.041999999999999996], "contactType": "surface-embed", "embedDepth": 0.002, "gapTolerance": 0.003}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.78}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lace-r-2", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "sole", "materialLayers": ["sole"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(23, 26, 34, 1)", "secondaryAlbedo": "rgba(23, 26, 34, 1)", "materialClass": "plastic", "materialClassConfidence": 0.8, "evidenceRefs": ["full-object"]}};
  node_lace_r_2_17.add(mesh_lace_r_2_17);
  meshes["lace-r-2"] = mesh_lace_r_2_17;
  colliders["lace-r-2"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["lace-r-2"] ??= [];
  destructionGroups["lace-r-2"].push(node_lace_r_2_17);

  const attachment_lace_r_3_18 = {"parentSocket": "shoe-r", "localStart": [-0.155, 0.12, 0.03799999999999999], "localEnd": [-0.07500000000000001, 0.12, 0.017999999999999988], "contactType": "surface-embed", "embedDepth": 0.002, "gapTolerance": 0.003};
  const endpoint_lace_r_3_18 = null; // authored tubePath already in model coordinates
  const node_lace_r_3_18 = new THREE.Group();
  node_lace_r_3_18.name = "lace-r-3__pivot";
  node_lace_r_3_18.scale.set(1, 1, 1);
  if (endpoint_lace_r_3_18) {
    node_lace_r_3_18.position.copy(endpoint_lace_r_3_18.start);
    node_lace_r_3_18.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_lace_r_3_18.position.set(0.0, 0.0, 0.0);
    node_lace_r_3_18.rotation.set(0.0, 0.0, 0.0);
  }
  node_lace_r_3_18.userData.sculptComponent = {"id": "lace-r-3", "name": "lace-r-3", "level": "micro", "role": "body", "importance": 1.0, "confidence": 0.78, "primitive": "tube", "topologyClass": "assembled-solid", "topologyRationale": "Contour follows the reference silhouette; depth is inferred and tested in orbit.", "geometryDescriptor": {"tubePath": {"points": [[-0.155, 0.12, 0.03799999999999999], [-0.07500000000000001, 0.12, 0.017999999999999988]], "radius": 0.003, "closed": false}, "attachmentGeometry": "authored-path"}, "parent": "root", "attachment": {"parentSocket": "shoe-r", "localStart": [-0.155, 0.12, 0.03799999999999999], "localEnd": [-0.07500000000000001, 0.12, 0.017999999999999988], "contactType": "surface-embed", "embedDepth": 0.002, "gapTolerance": 0.003}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.78}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lace-r-3", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "sole", "materialLayers": ["sole"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(23, 26, 34, 1)", "secondaryAlbedo": "rgba(23, 26, 34, 1)", "materialClass": "plastic", "materialClassConfidence": 0.8, "evidenceRefs": ["full-object"]}};
  node_lace_r_3_18.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lace-r-3", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["root"] ?? root).add(node_lace_r_3_18);
  nodes["lace-r-3"] = node_lace_r_3_18;
  const mesh_lace_r_3_18Geometry = endpoint_lace_r_3_18
    ? new THREE.CylinderGeometry(endpoint_lace_r_3_18.endRadius, endpoint_lace_r_3_18.baseRadius, endpoint_lace_r_3_18.length, 16, 6)
    : buildTubeGeometry({"points": [[-0.155, 0.12, 0.03799999999999999], [-0.07500000000000001, 0.12, 0.017999999999999988]], "radius": 0.003, "closed": false});
  if (!endpoint_lace_r_3_18) {
    mesh_lace_r_3_18Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_lace_r_3_18 = new THREE.Mesh(
    mesh_lace_r_3_18Geometry,
    materialMap["sole"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_lace_r_3_18.name = "lace-r-3";
  if (endpoint_lace_r_3_18) {
    mesh_lace_r_3_18.position.copy(endpoint_lace_r_3_18.midpoint);
    mesh_lace_r_3_18.quaternion.copy(endpoint_lace_r_3_18.quaternion);
  }
  mesh_lace_r_3_18.castShadow = options.castShadow ?? true;
  mesh_lace_r_3_18.receiveShadow = options.receiveShadow ?? true;
  mesh_lace_r_3_18.userData.sculptComponent = {"id": "lace-r-3", "name": "lace-r-3", "level": "micro", "role": "body", "importance": 1.0, "confidence": 0.78, "primitive": "tube", "topologyClass": "assembled-solid", "topologyRationale": "Contour follows the reference silhouette; depth is inferred and tested in orbit.", "geometryDescriptor": {"tubePath": {"points": [[-0.155, 0.12, 0.03799999999999999], [-0.07500000000000001, 0.12, 0.017999999999999988]], "radius": 0.003, "closed": false}, "attachmentGeometry": "authored-path"}, "parent": "root", "attachment": {"parentSocket": "shoe-r", "localStart": [-0.155, 0.12, 0.03799999999999999], "localEnd": [-0.07500000000000001, 0.12, 0.017999999999999988], "contactType": "surface-embed", "embedDepth": 0.002, "gapTolerance": 0.003}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.78}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lace-r-3", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "sole", "materialLayers": ["sole"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(23, 26, 34, 1)", "secondaryAlbedo": "rgba(23, 26, 34, 1)", "materialClass": "plastic", "materialClassConfidence": 0.8, "evidenceRefs": ["full-object"]}};
  node_lace_r_3_18.add(mesh_lace_r_3_18);
  meshes["lace-r-3"] = mesh_lace_r_3_18;
  colliders["lace-r-3"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["lace-r-3"] ??= [];
  destructionGroups["lace-r-3"].push(node_lace_r_3_18);

  const endpoint_neck_19 = makeAttachmentEndpoint(null);
  const node_neck_19 = new THREE.Group();
  node_neck_19.name = "neck__pivot";
  node_neck_19.scale.set(1, 1, 1);
  if (endpoint_neck_19) {
    node_neck_19.position.copy(endpoint_neck_19.start);
    node_neck_19.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_neck_19.position.set(0.0, 0.0, 0.0);
    node_neck_19.rotation.set(0.0, 0.0, 0.0);
  }
  node_neck_19.userData.sculptComponent = {"id": "neck", "name": "neck", "level": "meso", "role": "body", "importance": 1.0, "confidence": 0.78, "primitive": "ellipsoid", "topologyClass": "implicit", "topologyRationale": "Continuous sculpt volume made from smoothly blended fields, not independently rendered spheres.", "geometryDescriptor": {"sdf": {"primitives": [{"id": "neck-shaft", "type": "ellipsoid", "center": [0, 1.49, -0.012], "radii": [0.049, 0.085, 0.045]}], "operations": [], "bounds": {"min": [-0.07400000000000001, 1.382, -0.08199999999999999], "max": [0.07400000000000001, 1.628, 0.058]}, "resolution": 36}, "normalStrategy": "smooth vertex normals"}, "parent": "root", "attachment": null, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.78}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "neck", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "skin", "materialLayers": ["skin"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(213, 154, 115, 1)", "secondaryAlbedo": "rgba(213, 154, 115, 1)", "materialClass": "skin", "materialClassConfidence": 0.8, "evidenceRefs": ["full-object"]}};
  node_neck_19.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "neck", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["root"] ?? root).add(node_neck_19);
  nodes["neck"] = node_neck_19;
  const mesh_neck_19Geometry = polygonizeSdf({"primitives": [{"id": "neck-shaft", "type": "ellipsoid", "center": [0, 1.49, -0.012], "radii": [0.049, 0.085, 0.045]}], "operations": [], "bounds": {"min": [-0.07400000000000001, 1.382, -0.08199999999999999], "max": [0.07400000000000001, 1.628, 0.058]}, "resolution": 36});
  if (!endpoint_neck_19) {
    mesh_neck_19Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_neck_19 = new THREE.Mesh(
    mesh_neck_19Geometry,
    createSculptMaterial("skin", {"id": "skin", "name": "skin", "type": "standard", "shaderModel": "MeshStandardMaterial", "baseColor": "#d59a73", "color": "#d59a73", "roughness": 0.78, "metalness": 0, "textureless": {"declared": true, "evidence": ["reference-isolated.png: broad smooth color regions, no observable pore/grain pattern at target game distance; simplified art requested by user"]}, "albedo": {"dominant": "#d59a73", "secondary": ["#d59a73"]}, "ambientOcclusion": {"cavityStrength": 0.16, "contactShadowBias": 0.25}, "localOverrides": []}, options, true)
  );
  mesh_neck_19.name = "neck";
  if (endpoint_neck_19) {
    mesh_neck_19.position.copy(endpoint_neck_19.midpoint);
    mesh_neck_19.quaternion.copy(endpoint_neck_19.quaternion);
  }
  mesh_neck_19.castShadow = options.castShadow ?? true;
  mesh_neck_19.receiveShadow = options.receiveShadow ?? true;
  mesh_neck_19.userData.sculptComponent = {"id": "neck", "name": "neck", "level": "meso", "role": "body", "importance": 1.0, "confidence": 0.78, "primitive": "ellipsoid", "topologyClass": "implicit", "topologyRationale": "Continuous sculpt volume made from smoothly blended fields, not independently rendered spheres.", "geometryDescriptor": {"sdf": {"primitives": [{"id": "neck-shaft", "type": "ellipsoid", "center": [0, 1.49, -0.012], "radii": [0.049, 0.085, 0.045]}], "operations": [], "bounds": {"min": [-0.07400000000000001, 1.382, -0.08199999999999999], "max": [0.07400000000000001, 1.628, 0.058]}, "resolution": 36}, "normalStrategy": "smooth vertex normals"}, "parent": "root", "attachment": null, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.78}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "neck", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "skin", "materialLayers": ["skin"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(213, 154, 115, 1)", "secondaryAlbedo": "rgba(213, 154, 115, 1)", "materialClass": "skin", "materialClassConfidence": 0.8, "evidenceRefs": ["full-object"]}};
  node_neck_19.add(mesh_neck_19);
  meshes["neck"] = mesh_neck_19;
  colliders["neck"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["neck"] ??= [];
  destructionGroups["neck"].push(node_neck_19);

  const endpoint_head_20 = makeAttachmentEndpoint(null);
  const node_head_20 = new THREE.Group();
  node_head_20.name = "head__pivot";
  node_head_20.scale.set(1, 1, 1);
  if (endpoint_head_20) {
    node_head_20.position.copy(endpoint_head_20.start);
    node_head_20.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_head_20.position.set(0.0, 0.0, 0.0);
    node_head_20.rotation.set(0.0, 0.0, 0.0);
  }
  node_head_20.userData.sculptComponent = {"id": "head", "name": "head", "level": "macro", "role": "body", "importance": 1.0, "confidence": 0.78, "primitive": "tapered-sweep", "topologyClass": "continuous-sculpt", "topologyRationale": "Single closed head contour with continuously sculpted nose, brow and lips. No separate cheek or jaw lobes.", "geometryDescriptor": {"taperedSweep": {"stations": [{"position": [0, 1.57, 0.027], "rx": 0.036, "rz": 0.042}, {"position": [0, 1.58, 0.014], "rx": 0.05, "rz": 0.056}, {"position": [0, 1.599, 0.005], "rx": 0.059, "rz": 0.067}, {"position": [0, 1.63, -0.006], "rx": 0.071, "rz": 0.081}, {"position": [0, 1.67, -0.012], "rx": 0.078, "rz": 0.096}, {"position": [0, 1.706, -0.013], "rx": 0.078, "rz": 0.099}, {"position": [0, 1.74, -0.018], "rx": 0.08, "rz": 0.096}, {"position": [0, 1.775, -0.02], "rx": 0.072, "rz": 0.082}, {"position": [0, 1.8, -0.02], "rx": 0.053, "rz": 0.057}, {"position": [0, 1.815, -0.02], "rx": 0.005, "rz": 0.005}], "radialSegments": 64, "capEnds": true, "fixedFrame": "horizontal"}, "normalStrategy": "Horizontal anatomical contour sections: preserve world Y cross-section planes to avoid mouth/jaw folding when centre depth changes.", "faceSculpt": {"frontAxis": "+Z", "nose": [0, 1.661, 0.026, 0.014, 0.022], "bridge": [0, 1.69, 0.014, 0.027, 0.011], "cheeks": [[0.052, 1.653, 0.026, 0.03, 0.003], [-0.052, 1.653, 0.026, 0.03, 0.003]], "lipRidge": [0, 1.632, 0.025, 0.007, 0.002], "jawExponent": 2.25}, "displayHeadScale": 1.07, "displayHeadOffsetY": -0.018}, "parent": "root", "attachment": null, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.78}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "head", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "skin", "materialLayers": ["skin"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(213, 154, 115, 1)", "secondaryAlbedo": "rgba(213, 154, 115, 1)", "materialClass": "skin", "materialClassConfidence": 0.8, "evidenceRefs": ["full-object"]}};
  node_head_20.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "head", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["root"] ?? root).add(node_head_20);
  nodes["head"] = node_head_20;
  const mesh_head_20Geometry = endpoint_head_20
    ? new THREE.CylinderGeometry(endpoint_head_20.endRadius, endpoint_head_20.baseRadius, endpoint_head_20.length, 16, 6)
    : buildTaperedSweepGeometry({"stations": [{"position": [0, 1.57, 0.027], "rx": 0.036, "rz": 0.042}, {"position": [0, 1.58, 0.014], "rx": 0.05, "rz": 0.056}, {"position": [0, 1.599, 0.005], "rx": 0.059, "rz": 0.067}, {"position": [0, 1.63, -0.006], "rx": 0.071, "rz": 0.081}, {"position": [0, 1.67, -0.012], "rx": 0.078, "rz": 0.096}, {"position": [0, 1.706, -0.013], "rx": 0.078, "rz": 0.099}, {"position": [0, 1.74, -0.018], "rx": 0.08, "rz": 0.096}, {"position": [0, 1.775, -0.02], "rx": 0.072, "rz": 0.082}, {"position": [0, 1.8, -0.02], "rx": 0.053, "rz": 0.057}, {"position": [0, 1.815, -0.02], "rx": 0.005, "rz": 0.005}], "radialSegments": 64, "capEnds": true, "fixedFrame": "horizontal"});
  if (!endpoint_head_20) {
    mesh_head_20Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_head_20 = new THREE.Mesh(
    mesh_head_20Geometry,
    materialMap["skin"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_head_20.name = "head";
  if (endpoint_head_20) {
    mesh_head_20.position.copy(endpoint_head_20.midpoint);
    mesh_head_20.quaternion.copy(endpoint_head_20.quaternion);
  }
  mesh_head_20.castShadow = options.castShadow ?? true;
  mesh_head_20.receiveShadow = options.receiveShadow ?? true;
  mesh_head_20.userData.sculptComponent = {"id": "head", "name": "head", "level": "macro", "role": "body", "importance": 1.0, "confidence": 0.78, "primitive": "tapered-sweep", "topologyClass": "continuous-sculpt", "topologyRationale": "Single closed head contour with continuously sculpted nose, brow and lips. No separate cheek or jaw lobes.", "geometryDescriptor": {"taperedSweep": {"stations": [{"position": [0, 1.57, 0.027], "rx": 0.036, "rz": 0.042}, {"position": [0, 1.58, 0.014], "rx": 0.05, "rz": 0.056}, {"position": [0, 1.599, 0.005], "rx": 0.059, "rz": 0.067}, {"position": [0, 1.63, -0.006], "rx": 0.071, "rz": 0.081}, {"position": [0, 1.67, -0.012], "rx": 0.078, "rz": 0.096}, {"position": [0, 1.706, -0.013], "rx": 0.078, "rz": 0.099}, {"position": [0, 1.74, -0.018], "rx": 0.08, "rz": 0.096}, {"position": [0, 1.775, -0.02], "rx": 0.072, "rz": 0.082}, {"position": [0, 1.8, -0.02], "rx": 0.053, "rz": 0.057}, {"position": [0, 1.815, -0.02], "rx": 0.005, "rz": 0.005}], "radialSegments": 64, "capEnds": true, "fixedFrame": "horizontal"}, "normalStrategy": "Horizontal anatomical contour sections: preserve world Y cross-section planes to avoid mouth/jaw folding when centre depth changes.", "faceSculpt": {"frontAxis": "+Z", "nose": [0, 1.661, 0.026, 0.014, 0.022], "bridge": [0, 1.69, 0.014, 0.027, 0.011], "cheeks": [[0.052, 1.653, 0.026, 0.03, 0.003], [-0.052, 1.653, 0.026, 0.03, 0.003]], "lipRidge": [0, 1.632, 0.025, 0.007, 0.002], "jawExponent": 2.25}, "displayHeadScale": 1.07, "displayHeadOffsetY": -0.018}, "parent": "root", "attachment": null, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.78}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "head", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "skin", "materialLayers": ["skin"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(213, 154, 115, 1)", "secondaryAlbedo": "rgba(213, 154, 115, 1)", "materialClass": "skin", "materialClassConfidence": 0.8, "evidenceRefs": ["full-object"]}};
  node_head_20.add(mesh_head_20);
  meshes["head"] = mesh_head_20;
  colliders["head"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["head"] ??= [];
  destructionGroups["head"].push(node_head_20);

  const endpoint_ear__1_21 = makeAttachmentEndpoint(null);
  const node_ear__1_21 = new THREE.Group();
  node_ear__1_21.name = "ear--1__pivot";
  node_ear__1_21.scale.set(1, 1, 1);
  if (endpoint_ear__1_21) {
    node_ear__1_21.position.copy(endpoint_ear__1_21.start);
    node_ear__1_21.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_ear__1_21.position.set(-0.098, 1.684, -0.005);
    node_ear__1_21.rotation.set(0.0, 0.0, 0.0);
  }
  node_ear__1_21.userData.sculptComponent = {"id": "ear--1", "name": "ear--1", "level": "meso", "role": "body", "importance": 1.0, "confidence": 0.78, "primitive": "ellipsoid", "topologyClass": "assembled-solid", "topologyRationale": "Contour follows the reference silhouette; depth is inferred and tested in orbit.", "geometryDescriptor": {"normalStrategy": "smooth vertex normals", "uvStrategy": "generated procedural coordinates", "edgeTreatment": {"type": "none", "bevelRadius": 0, "segments": 1}, "deformationStack": []}, "parent": "root", "attachment": null, "dimensions": {"width": 0.035, "height": 0.061, "depth": 0.033, "units": "meters", "confidence": 0.78}, "transform": {"position": [-0.098, 1.684, -0.005], "rotation": [0, 0, 0], "scale": [0.035, 0.061, 0.033]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "ear--1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "skin", "materialLayers": ["skin"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(213, 154, 115, 1)", "secondaryAlbedo": "rgba(213, 154, 115, 1)", "materialClass": "skin", "materialClassConfidence": 0.8, "evidenceRefs": ["full-object"]}};
  node_ear__1_21.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "ear--1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["root"] ?? root).add(node_ear__1_21);
  nodes["ear--1"] = node_ear__1_21;
  const mesh_ear__1_21Geometry = endpoint_ear__1_21
    ? new THREE.CylinderGeometry(endpoint_ear__1_21.endRadius, endpoint_ear__1_21.baseRadius, endpoint_ear__1_21.length, 16, 6)
    : new THREE.SphereGeometry(0.5, 32, 20);
  if (!endpoint_ear__1_21) {
    mesh_ear__1_21Geometry.scale(0.035, 0.061, 0.033);
  }
  const mesh_ear__1_21 = new THREE.Mesh(
    mesh_ear__1_21Geometry,
    materialMap["skin"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_ear__1_21.name = "ear--1";
  if (endpoint_ear__1_21) {
    mesh_ear__1_21.position.copy(endpoint_ear__1_21.midpoint);
    mesh_ear__1_21.quaternion.copy(endpoint_ear__1_21.quaternion);
  }
  mesh_ear__1_21.castShadow = options.castShadow ?? true;
  mesh_ear__1_21.receiveShadow = options.receiveShadow ?? true;
  mesh_ear__1_21.userData.sculptComponent = {"id": "ear--1", "name": "ear--1", "level": "meso", "role": "body", "importance": 1.0, "confidence": 0.78, "primitive": "ellipsoid", "topologyClass": "assembled-solid", "topologyRationale": "Contour follows the reference silhouette; depth is inferred and tested in orbit.", "geometryDescriptor": {"normalStrategy": "smooth vertex normals", "uvStrategy": "generated procedural coordinates", "edgeTreatment": {"type": "none", "bevelRadius": 0, "segments": 1}, "deformationStack": []}, "parent": "root", "attachment": null, "dimensions": {"width": 0.035, "height": 0.061, "depth": 0.033, "units": "meters", "confidence": 0.78}, "transform": {"position": [-0.098, 1.684, -0.005], "rotation": [0, 0, 0], "scale": [0.035, 0.061, 0.033]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "ear--1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "skin", "materialLayers": ["skin"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(213, 154, 115, 1)", "secondaryAlbedo": "rgba(213, 154, 115, 1)", "materialClass": "skin", "materialClassConfidence": 0.8, "evidenceRefs": ["full-object"]}};
  node_ear__1_21.add(mesh_ear__1_21);
  meshes["ear--1"] = mesh_ear__1_21;
  colliders["ear--1"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["ear--1"] ??= [];
  destructionGroups["ear--1"].push(node_ear__1_21);

  const endpoint_eye__1_22 = makeAttachmentEndpoint(null);
  const node_eye__1_22 = new THREE.Group();
  node_eye__1_22.name = "eye--1__pivot";
  node_eye__1_22.scale.set(1, 1, 1);
  if (endpoint_eye__1_22) {
    node_eye__1_22.position.copy(endpoint_eye__1_22.start);
    node_eye__1_22.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_eye__1_22.position.set(-0.039, 1.709, 0.07);
    node_eye__1_22.rotation.set(0.0, 0.0, 0.0);
  }
  node_eye__1_22.userData.sculptComponent = {"id": "eye--1", "name": "eye--1", "level": "micro", "role": "body", "importance": 1.0, "confidence": 0.78, "primitive": "ellipsoid", "topologyClass": "assembled-solid", "topologyRationale": "Contour follows the reference silhouette; depth is inferred and tested in orbit.", "geometryDescriptor": {"normalStrategy": "smooth vertex normals", "uvStrategy": "generated procedural coordinates", "edgeTreatment": {"type": "none", "bevelRadius": 0, "segments": 1}, "deformationStack": []}, "parent": "root", "attachment": null, "dimensions": {"width": 0.035, "height": 0.018, "depth": 0.014, "units": "meters", "confidence": 0.78}, "transform": {"position": [-0.039, 1.709, 0.07], "rotation": [0, 0, 0], "scale": [0.035, 0.018, 0.014]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "eye--1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "eye", "materialLayers": ["eye"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(238, 232, 222, 1)", "secondaryAlbedo": "rgba(238, 232, 222, 1)", "materialClass": "plastic", "materialClassConfidence": 0.8, "evidenceRefs": ["full-object"]}};
  node_eye__1_22.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "eye--1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["root"] ?? root).add(node_eye__1_22);
  nodes["eye--1"] = node_eye__1_22;
  const mesh_eye__1_22Geometry = endpoint_eye__1_22
    ? new THREE.CylinderGeometry(endpoint_eye__1_22.endRadius, endpoint_eye__1_22.baseRadius, endpoint_eye__1_22.length, 16, 6)
    : new THREE.SphereGeometry(0.5, 32, 20);
  if (!endpoint_eye__1_22) {
    mesh_eye__1_22Geometry.scale(0.035, 0.018, 0.014);
  }
  const mesh_eye__1_22 = new THREE.Mesh(
    mesh_eye__1_22Geometry,
    materialMap["eye"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_eye__1_22.name = "eye--1";
  if (endpoint_eye__1_22) {
    mesh_eye__1_22.position.copy(endpoint_eye__1_22.midpoint);
    mesh_eye__1_22.quaternion.copy(endpoint_eye__1_22.quaternion);
  }
  mesh_eye__1_22.castShadow = options.castShadow ?? true;
  mesh_eye__1_22.receiveShadow = options.receiveShadow ?? true;
  mesh_eye__1_22.userData.sculptComponent = {"id": "eye--1", "name": "eye--1", "level": "micro", "role": "body", "importance": 1.0, "confidence": 0.78, "primitive": "ellipsoid", "topologyClass": "assembled-solid", "topologyRationale": "Contour follows the reference silhouette; depth is inferred and tested in orbit.", "geometryDescriptor": {"normalStrategy": "smooth vertex normals", "uvStrategy": "generated procedural coordinates", "edgeTreatment": {"type": "none", "bevelRadius": 0, "segments": 1}, "deformationStack": []}, "parent": "root", "attachment": null, "dimensions": {"width": 0.035, "height": 0.018, "depth": 0.014, "units": "meters", "confidence": 0.78}, "transform": {"position": [-0.039, 1.709, 0.07], "rotation": [0, 0, 0], "scale": [0.035, 0.018, 0.014]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "eye--1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "eye", "materialLayers": ["eye"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(238, 232, 222, 1)", "secondaryAlbedo": "rgba(238, 232, 222, 1)", "materialClass": "plastic", "materialClassConfidence": 0.8, "evidenceRefs": ["full-object"]}};
  node_eye__1_22.add(mesh_eye__1_22);
  meshes["eye--1"] = mesh_eye__1_22;
  colliders["eye--1"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["eye--1"] ??= [];
  destructionGroups["eye--1"].push(node_eye__1_22);

  const endpoint_glasses__1_23 = makeAttachmentEndpoint(null);
  const node_glasses__1_23 = new THREE.Group();
  node_glasses__1_23.name = "glasses--1__pivot";
  node_glasses__1_23.scale.set(1, 1, 1);
  if (endpoint_glasses__1_23) {
    node_glasses__1_23.position.copy(endpoint_glasses__1_23.start);
    node_glasses__1_23.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_glasses__1_23.position.set(-0.047, 1.703, 0.088);
    node_glasses__1_23.rotation.set(0.0, 0.0, 0.0);
  }
  node_glasses__1_23.userData.sculptComponent = {"id": "glasses--1", "name": "glasses--1", "level": "micro", "role": "body", "importance": 1.0, "confidence": 0.78, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Contour follows the reference silhouette; depth is inferred and tested in orbit.", "geometryDescriptor": {"profile2D": {"points": [[-0.5, 0.35], [-0.4, 0.5], [0.42, 0.5], [0.5, 0.3], [0.4, -0.42], [-0.35, -0.5]], "depth": 1, "bevelEnabled": true, "bevelSize": 0.05, "bevelThickness": 0.03, "bevelSegments": 2}}, "parent": "root", "attachment": null, "dimensions": {"width": 0.082, "height": 0.048, "depth": 0.012, "units": "meters", "confidence": 0.78}, "transform": {"position": [-0.047, 1.703, 0.088], "rotation": [0, 0, 0], "scale": [0.082, 0.048, 0.012]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "glasses--1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "glasses-frame", "materialLayers": ["glasses-frame"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(25, 30, 37, 1)", "secondaryAlbedo": "rgba(25, 30, 37, 1)", "materialClass": "plastic", "materialClassConfidence": 0.8, "evidenceRefs": ["full-object"]}};
  node_glasses__1_23.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "glasses--1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["root"] ?? root).add(node_glasses__1_23);
  nodes["glasses--1"] = node_glasses__1_23;
  const mesh_glasses__1_23Geometry = endpoint_glasses__1_23
    ? new THREE.CylinderGeometry(endpoint_glasses__1_23.endRadius, endpoint_glasses__1_23.baseRadius, endpoint_glasses__1_23.length, 16, 6)
    : buildExtrudeGeometry({"points": [[-0.5, 0.35], [-0.4, 0.5], [0.42, 0.5], [0.5, 0.3], [0.4, -0.42], [-0.35, -0.5]], "depth": 1, "bevelEnabled": true, "bevelSize": 0.05, "bevelThickness": 0.03, "bevelSegments": 2});
  if (!endpoint_glasses__1_23) {
    mesh_glasses__1_23Geometry.scale(0.082, 0.048, 0.012);
  }
  const mesh_glasses__1_23 = new THREE.Mesh(
    mesh_glasses__1_23Geometry,
    materialMap["glasses-frame"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_glasses__1_23.name = "glasses--1";
  if (endpoint_glasses__1_23) {
    mesh_glasses__1_23.position.copy(endpoint_glasses__1_23.midpoint);
    mesh_glasses__1_23.quaternion.copy(endpoint_glasses__1_23.quaternion);
  }
  mesh_glasses__1_23.castShadow = options.castShadow ?? true;
  mesh_glasses__1_23.receiveShadow = options.receiveShadow ?? true;
  mesh_glasses__1_23.userData.sculptComponent = {"id": "glasses--1", "name": "glasses--1", "level": "micro", "role": "body", "importance": 1.0, "confidence": 0.78, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Contour follows the reference silhouette; depth is inferred and tested in orbit.", "geometryDescriptor": {"profile2D": {"points": [[-0.5, 0.35], [-0.4, 0.5], [0.42, 0.5], [0.5, 0.3], [0.4, -0.42], [-0.35, -0.5]], "depth": 1, "bevelEnabled": true, "bevelSize": 0.05, "bevelThickness": 0.03, "bevelSegments": 2}}, "parent": "root", "attachment": null, "dimensions": {"width": 0.082, "height": 0.048, "depth": 0.012, "units": "meters", "confidence": 0.78}, "transform": {"position": [-0.047, 1.703, 0.088], "rotation": [0, 0, 0], "scale": [0.082, 0.048, 0.012]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "glasses--1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "glasses-frame", "materialLayers": ["glasses-frame"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(25, 30, 37, 1)", "secondaryAlbedo": "rgba(25, 30, 37, 1)", "materialClass": "plastic", "materialClassConfidence": 0.8, "evidenceRefs": ["full-object"]}};
  node_glasses__1_23.add(mesh_glasses__1_23);
  meshes["glasses--1"] = mesh_glasses__1_23;
  colliders["glasses--1"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["glasses--1"] ??= [];
  destructionGroups["glasses--1"].push(node_glasses__1_23);

  const attachment_temple__1_24 = {"parentSocket": "head", "localStart": [-0.088, 1.715, 0.088], "localEnd": [-0.099, 1.69, -0.012], "contactType": "surface-embed", "embedDepth": 0.002, "gapTolerance": 0.003};
  const endpoint_temple__1_24 = null; // authored tubePath already in model coordinates
  const node_temple__1_24 = new THREE.Group();
  node_temple__1_24.name = "temple--1__pivot";
  node_temple__1_24.scale.set(1, 1, 1);
  if (endpoint_temple__1_24) {
    node_temple__1_24.position.copy(endpoint_temple__1_24.start);
    node_temple__1_24.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_temple__1_24.position.set(0.0, 0.0, 0.0);
    node_temple__1_24.rotation.set(0.0, 0.0, 0.0);
  }
  node_temple__1_24.userData.sculptComponent = {"id": "temple--1", "name": "temple--1", "level": "micro", "role": "body", "importance": 1.0, "confidence": 0.78, "primitive": "tube", "topologyClass": "assembled-solid", "topologyRationale": "Contour follows the reference silhouette; depth is inferred and tested in orbit.", "geometryDescriptor": {"tubePath": {"points": [[-0.088, 1.715, 0.088], [-0.105, 1.711, 0.03], [-0.099, 1.69, -0.012]], "radius": 0.004, "closed": false}, "attachmentGeometry": "authored-path"}, "parent": "root", "attachment": {"parentSocket": "head", "localStart": [-0.088, 1.715, 0.088], "localEnd": [-0.099, 1.69, -0.012], "contactType": "surface-embed", "embedDepth": 0.002, "gapTolerance": 0.003}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.78}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "temple--1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "glasses-frame", "materialLayers": ["glasses-frame"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(25, 30, 37, 1)", "secondaryAlbedo": "rgba(25, 30, 37, 1)", "materialClass": "plastic", "materialClassConfidence": 0.8, "evidenceRefs": ["full-object"]}};
  node_temple__1_24.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "temple--1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["root"] ?? root).add(node_temple__1_24);
  nodes["temple--1"] = node_temple__1_24;
  const mesh_temple__1_24Geometry = endpoint_temple__1_24
    ? new THREE.CylinderGeometry(endpoint_temple__1_24.endRadius, endpoint_temple__1_24.baseRadius, endpoint_temple__1_24.length, 16, 6)
    : buildTubeGeometry({"points": [[-0.088, 1.715, 0.088], [-0.105, 1.711, 0.03], [-0.099, 1.69, -0.012]], "radius": 0.004, "closed": false});
  if (!endpoint_temple__1_24) {
    mesh_temple__1_24Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_temple__1_24 = new THREE.Mesh(
    mesh_temple__1_24Geometry,
    materialMap["glasses-frame"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_temple__1_24.name = "temple--1";
  if (endpoint_temple__1_24) {
    mesh_temple__1_24.position.copy(endpoint_temple__1_24.midpoint);
    mesh_temple__1_24.quaternion.copy(endpoint_temple__1_24.quaternion);
  }
  mesh_temple__1_24.castShadow = options.castShadow ?? true;
  mesh_temple__1_24.receiveShadow = options.receiveShadow ?? true;
  mesh_temple__1_24.userData.sculptComponent = {"id": "temple--1", "name": "temple--1", "level": "micro", "role": "body", "importance": 1.0, "confidence": 0.78, "primitive": "tube", "topologyClass": "assembled-solid", "topologyRationale": "Contour follows the reference silhouette; depth is inferred and tested in orbit.", "geometryDescriptor": {"tubePath": {"points": [[-0.088, 1.715, 0.088], [-0.105, 1.711, 0.03], [-0.099, 1.69, -0.012]], "radius": 0.004, "closed": false}, "attachmentGeometry": "authored-path"}, "parent": "root", "attachment": {"parentSocket": "head", "localStart": [-0.088, 1.715, 0.088], "localEnd": [-0.099, 1.69, -0.012], "contactType": "surface-embed", "embedDepth": 0.002, "gapTolerance": 0.003}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.78}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "temple--1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "glasses-frame", "materialLayers": ["glasses-frame"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(25, 30, 37, 1)", "secondaryAlbedo": "rgba(25, 30, 37, 1)", "materialClass": "plastic", "materialClassConfidence": 0.8, "evidenceRefs": ["full-object"]}};
  node_temple__1_24.add(mesh_temple__1_24);
  meshes["temple--1"] = mesh_temple__1_24;
  colliders["temple--1"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["temple--1"] ??= [];
  destructionGroups["temple--1"].push(node_temple__1_24);

  const endpoint_ear_1_25 = makeAttachmentEndpoint(null);
  const node_ear_1_25 = new THREE.Group();
  node_ear_1_25.name = "ear-1__pivot";
  node_ear_1_25.scale.set(1, 1, 1);
  if (endpoint_ear_1_25) {
    node_ear_1_25.position.copy(endpoint_ear_1_25.start);
    node_ear_1_25.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_ear_1_25.position.set(0.098, 1.684, -0.005);
    node_ear_1_25.rotation.set(0.0, 0.0, 0.0);
  }
  node_ear_1_25.userData.sculptComponent = {"id": "ear-1", "name": "ear-1", "level": "meso", "role": "body", "importance": 1.0, "confidence": 0.78, "primitive": "ellipsoid", "topologyClass": "assembled-solid", "topologyRationale": "Contour follows the reference silhouette; depth is inferred and tested in orbit.", "geometryDescriptor": {"normalStrategy": "smooth vertex normals", "uvStrategy": "generated procedural coordinates", "edgeTreatment": {"type": "none", "bevelRadius": 0, "segments": 1}, "deformationStack": []}, "parent": "root", "attachment": null, "dimensions": {"width": 0.035, "height": 0.061, "depth": 0.033, "units": "meters", "confidence": 0.78}, "transform": {"position": [0.098, 1.684, -0.005], "rotation": [0, 0, 0], "scale": [0.035, 0.061, 0.033]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "ear-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "skin", "materialLayers": ["skin"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(213, 154, 115, 1)", "secondaryAlbedo": "rgba(213, 154, 115, 1)", "materialClass": "skin", "materialClassConfidence": 0.8, "evidenceRefs": ["full-object"]}};
  node_ear_1_25.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "ear-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["root"] ?? root).add(node_ear_1_25);
  nodes["ear-1"] = node_ear_1_25;
  const mesh_ear_1_25Geometry = endpoint_ear_1_25
    ? new THREE.CylinderGeometry(endpoint_ear_1_25.endRadius, endpoint_ear_1_25.baseRadius, endpoint_ear_1_25.length, 16, 6)
    : new THREE.SphereGeometry(0.5, 32, 20);
  if (!endpoint_ear_1_25) {
    mesh_ear_1_25Geometry.scale(0.035, 0.061, 0.033);
  }
  const mesh_ear_1_25 = new THREE.Mesh(
    mesh_ear_1_25Geometry,
    materialMap["skin"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_ear_1_25.name = "ear-1";
  if (endpoint_ear_1_25) {
    mesh_ear_1_25.position.copy(endpoint_ear_1_25.midpoint);
    mesh_ear_1_25.quaternion.copy(endpoint_ear_1_25.quaternion);
  }
  mesh_ear_1_25.castShadow = options.castShadow ?? true;
  mesh_ear_1_25.receiveShadow = options.receiveShadow ?? true;
  mesh_ear_1_25.userData.sculptComponent = {"id": "ear-1", "name": "ear-1", "level": "meso", "role": "body", "importance": 1.0, "confidence": 0.78, "primitive": "ellipsoid", "topologyClass": "assembled-solid", "topologyRationale": "Contour follows the reference silhouette; depth is inferred and tested in orbit.", "geometryDescriptor": {"normalStrategy": "smooth vertex normals", "uvStrategy": "generated procedural coordinates", "edgeTreatment": {"type": "none", "bevelRadius": 0, "segments": 1}, "deformationStack": []}, "parent": "root", "attachment": null, "dimensions": {"width": 0.035, "height": 0.061, "depth": 0.033, "units": "meters", "confidence": 0.78}, "transform": {"position": [0.098, 1.684, -0.005], "rotation": [0, 0, 0], "scale": [0.035, 0.061, 0.033]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "ear-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "skin", "materialLayers": ["skin"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(213, 154, 115, 1)", "secondaryAlbedo": "rgba(213, 154, 115, 1)", "materialClass": "skin", "materialClassConfidence": 0.8, "evidenceRefs": ["full-object"]}};
  node_ear_1_25.add(mesh_ear_1_25);
  meshes["ear-1"] = mesh_ear_1_25;
  colliders["ear-1"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["ear-1"] ??= [];
  destructionGroups["ear-1"].push(node_ear_1_25);

  const endpoint_eye_1_26 = makeAttachmentEndpoint(null);
  const node_eye_1_26 = new THREE.Group();
  node_eye_1_26.name = "eye-1__pivot";
  node_eye_1_26.scale.set(1, 1, 1);
  if (endpoint_eye_1_26) {
    node_eye_1_26.position.copy(endpoint_eye_1_26.start);
    node_eye_1_26.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_eye_1_26.position.set(0.039, 1.709, 0.07);
    node_eye_1_26.rotation.set(0.0, 0.0, 0.0);
  }
  node_eye_1_26.userData.sculptComponent = {"id": "eye-1", "name": "eye-1", "level": "micro", "role": "body", "importance": 1.0, "confidence": 0.78, "primitive": "ellipsoid", "topologyClass": "assembled-solid", "topologyRationale": "Contour follows the reference silhouette; depth is inferred and tested in orbit.", "geometryDescriptor": {"normalStrategy": "smooth vertex normals", "uvStrategy": "generated procedural coordinates", "edgeTreatment": {"type": "none", "bevelRadius": 0, "segments": 1}, "deformationStack": []}, "parent": "root", "attachment": null, "dimensions": {"width": 0.035, "height": 0.018, "depth": 0.014, "units": "meters", "confidence": 0.78}, "transform": {"position": [0.039, 1.709, 0.07], "rotation": [0, 0, 0], "scale": [0.035, 0.018, 0.014]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "eye-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "eye", "materialLayers": ["eye"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(238, 232, 222, 1)", "secondaryAlbedo": "rgba(238, 232, 222, 1)", "materialClass": "plastic", "materialClassConfidence": 0.8, "evidenceRefs": ["full-object"]}};
  node_eye_1_26.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "eye-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["root"] ?? root).add(node_eye_1_26);
  nodes["eye-1"] = node_eye_1_26;
  const mesh_eye_1_26Geometry = endpoint_eye_1_26
    ? new THREE.CylinderGeometry(endpoint_eye_1_26.endRadius, endpoint_eye_1_26.baseRadius, endpoint_eye_1_26.length, 16, 6)
    : new THREE.SphereGeometry(0.5, 32, 20);
  if (!endpoint_eye_1_26) {
    mesh_eye_1_26Geometry.scale(0.035, 0.018, 0.014);
  }
  const mesh_eye_1_26 = new THREE.Mesh(
    mesh_eye_1_26Geometry,
    materialMap["eye"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_eye_1_26.name = "eye-1";
  if (endpoint_eye_1_26) {
    mesh_eye_1_26.position.copy(endpoint_eye_1_26.midpoint);
    mesh_eye_1_26.quaternion.copy(endpoint_eye_1_26.quaternion);
  }
  mesh_eye_1_26.castShadow = options.castShadow ?? true;
  mesh_eye_1_26.receiveShadow = options.receiveShadow ?? true;
  mesh_eye_1_26.userData.sculptComponent = {"id": "eye-1", "name": "eye-1", "level": "micro", "role": "body", "importance": 1.0, "confidence": 0.78, "primitive": "ellipsoid", "topologyClass": "assembled-solid", "topologyRationale": "Contour follows the reference silhouette; depth is inferred and tested in orbit.", "geometryDescriptor": {"normalStrategy": "smooth vertex normals", "uvStrategy": "generated procedural coordinates", "edgeTreatment": {"type": "none", "bevelRadius": 0, "segments": 1}, "deformationStack": []}, "parent": "root", "attachment": null, "dimensions": {"width": 0.035, "height": 0.018, "depth": 0.014, "units": "meters", "confidence": 0.78}, "transform": {"position": [0.039, 1.709, 0.07], "rotation": [0, 0, 0], "scale": [0.035, 0.018, 0.014]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "eye-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "eye", "materialLayers": ["eye"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(238, 232, 222, 1)", "secondaryAlbedo": "rgba(238, 232, 222, 1)", "materialClass": "plastic", "materialClassConfidence": 0.8, "evidenceRefs": ["full-object"]}};
  node_eye_1_26.add(mesh_eye_1_26);
  meshes["eye-1"] = mesh_eye_1_26;
  colliders["eye-1"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["eye-1"] ??= [];
  destructionGroups["eye-1"].push(node_eye_1_26);

  const endpoint_glasses_1_27 = makeAttachmentEndpoint(null);
  const node_glasses_1_27 = new THREE.Group();
  node_glasses_1_27.name = "glasses-1__pivot";
  node_glasses_1_27.scale.set(1, 1, 1);
  if (endpoint_glasses_1_27) {
    node_glasses_1_27.position.copy(endpoint_glasses_1_27.start);
    node_glasses_1_27.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_glasses_1_27.position.set(0.047, 1.703, 0.088);
    node_glasses_1_27.rotation.set(0.0, 0.0, 0.0);
  }
  node_glasses_1_27.userData.sculptComponent = {"id": "glasses-1", "name": "glasses-1", "level": "micro", "role": "body", "importance": 1.0, "confidence": 0.78, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Contour follows the reference silhouette; depth is inferred and tested in orbit.", "geometryDescriptor": {"profile2D": {"points": [[-0.5, 0.35], [-0.4, 0.5], [0.42, 0.5], [0.5, 0.3], [0.4, -0.42], [-0.35, -0.5]], "depth": 1, "bevelEnabled": true, "bevelSize": 0.05, "bevelThickness": 0.03, "bevelSegments": 2}}, "parent": "root", "attachment": null, "dimensions": {"width": 0.082, "height": 0.048, "depth": 0.012, "units": "meters", "confidence": 0.78}, "transform": {"position": [0.047, 1.703, 0.088], "rotation": [0, 0, 0], "scale": [0.082, 0.048, 0.012]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "glasses-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "glasses-frame", "materialLayers": ["glasses-frame"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "smoked-lens", "kind": "gloss", "description": "smoked-lens", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(25, 30, 37, 1)", "secondaryAlbedo": "rgba(25, 30, 37, 1)", "materialClass": "plastic", "materialClassConfidence": 0.8, "evidenceRefs": ["full-object"]}};
  node_glasses_1_27.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "glasses-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["root"] ?? root).add(node_glasses_1_27);
  nodes["glasses-1"] = node_glasses_1_27;
  const mesh_glasses_1_27Geometry = endpoint_glasses_1_27
    ? new THREE.CylinderGeometry(endpoint_glasses_1_27.endRadius, endpoint_glasses_1_27.baseRadius, endpoint_glasses_1_27.length, 16, 6)
    : buildExtrudeGeometry({"points": [[-0.5, 0.35], [-0.4, 0.5], [0.42, 0.5], [0.5, 0.3], [0.4, -0.42], [-0.35, -0.5]], "depth": 1, "bevelEnabled": true, "bevelSize": 0.05, "bevelThickness": 0.03, "bevelSegments": 2});
  if (!endpoint_glasses_1_27) {
    mesh_glasses_1_27Geometry.scale(0.082, 0.048, 0.012);
  }
  const mesh_glasses_1_27 = new THREE.Mesh(
    mesh_glasses_1_27Geometry,
    materialMap["glasses-frame"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_glasses_1_27.name = "glasses-1";
  if (endpoint_glasses_1_27) {
    mesh_glasses_1_27.position.copy(endpoint_glasses_1_27.midpoint);
    mesh_glasses_1_27.quaternion.copy(endpoint_glasses_1_27.quaternion);
  }
  mesh_glasses_1_27.castShadow = options.castShadow ?? true;
  mesh_glasses_1_27.receiveShadow = options.receiveShadow ?? true;
  mesh_glasses_1_27.userData.sculptComponent = {"id": "glasses-1", "name": "glasses-1", "level": "micro", "role": "body", "importance": 1.0, "confidence": 0.78, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Contour follows the reference silhouette; depth is inferred and tested in orbit.", "geometryDescriptor": {"profile2D": {"points": [[-0.5, 0.35], [-0.4, 0.5], [0.42, 0.5], [0.5, 0.3], [0.4, -0.42], [-0.35, -0.5]], "depth": 1, "bevelEnabled": true, "bevelSize": 0.05, "bevelThickness": 0.03, "bevelSegments": 2}}, "parent": "root", "attachment": null, "dimensions": {"width": 0.082, "height": 0.048, "depth": 0.012, "units": "meters", "confidence": 0.78}, "transform": {"position": [0.047, 1.703, 0.088], "rotation": [0, 0, 0], "scale": [0.082, 0.048, 0.012]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "glasses-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "glasses-frame", "materialLayers": ["glasses-frame"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "smoked-lens", "kind": "gloss", "description": "smoked-lens", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(25, 30, 37, 1)", "secondaryAlbedo": "rgba(25, 30, 37, 1)", "materialClass": "plastic", "materialClassConfidence": 0.8, "evidenceRefs": ["full-object"]}};
  node_glasses_1_27.add(mesh_glasses_1_27);
  meshes["glasses-1"] = mesh_glasses_1_27;
  colliders["glasses-1"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["glasses-1"] ??= [];
  destructionGroups["glasses-1"].push(node_glasses_1_27);

  const attachment_temple_1_28 = {"parentSocket": "head", "localStart": [0.088, 1.715, 0.088], "localEnd": [0.099, 1.69, -0.012], "contactType": "surface-embed", "embedDepth": 0.002, "gapTolerance": 0.003};
  const endpoint_temple_1_28 = null; // authored tubePath already in model coordinates
  const node_temple_1_28 = new THREE.Group();
  node_temple_1_28.name = "temple-1__pivot";
  node_temple_1_28.scale.set(1, 1, 1);
  if (endpoint_temple_1_28) {
    node_temple_1_28.position.copy(endpoint_temple_1_28.start);
    node_temple_1_28.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_temple_1_28.position.set(0.0, 0.0, 0.0);
    node_temple_1_28.rotation.set(0.0, 0.0, 0.0);
  }
  node_temple_1_28.userData.sculptComponent = {"id": "temple-1", "name": "temple-1", "level": "micro", "role": "body", "importance": 1.0, "confidence": 0.78, "primitive": "tube", "topologyClass": "assembled-solid", "topologyRationale": "Contour follows the reference silhouette; depth is inferred and tested in orbit.", "geometryDescriptor": {"tubePath": {"points": [[0.088, 1.715, 0.088], [0.105, 1.711, 0.03], [0.099, 1.69, -0.012]], "radius": 0.004, "closed": false}, "attachmentGeometry": "authored-path"}, "parent": "root", "attachment": {"parentSocket": "head", "localStart": [0.088, 1.715, 0.088], "localEnd": [0.099, 1.69, -0.012], "contactType": "surface-embed", "embedDepth": 0.002, "gapTolerance": 0.003}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.78}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "temple-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "glasses-frame", "materialLayers": ["glasses-frame"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(25, 30, 37, 1)", "secondaryAlbedo": "rgba(25, 30, 37, 1)", "materialClass": "plastic", "materialClassConfidence": 0.8, "evidenceRefs": ["full-object"]}};
  node_temple_1_28.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "temple-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["root"] ?? root).add(node_temple_1_28);
  nodes["temple-1"] = node_temple_1_28;
  const mesh_temple_1_28Geometry = endpoint_temple_1_28
    ? new THREE.CylinderGeometry(endpoint_temple_1_28.endRadius, endpoint_temple_1_28.baseRadius, endpoint_temple_1_28.length, 16, 6)
    : buildTubeGeometry({"points": [[0.088, 1.715, 0.088], [0.105, 1.711, 0.03], [0.099, 1.69, -0.012]], "radius": 0.004, "closed": false});
  if (!endpoint_temple_1_28) {
    mesh_temple_1_28Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_temple_1_28 = new THREE.Mesh(
    mesh_temple_1_28Geometry,
    materialMap["glasses-frame"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_temple_1_28.name = "temple-1";
  if (endpoint_temple_1_28) {
    mesh_temple_1_28.position.copy(endpoint_temple_1_28.midpoint);
    mesh_temple_1_28.quaternion.copy(endpoint_temple_1_28.quaternion);
  }
  mesh_temple_1_28.castShadow = options.castShadow ?? true;
  mesh_temple_1_28.receiveShadow = options.receiveShadow ?? true;
  mesh_temple_1_28.userData.sculptComponent = {"id": "temple-1", "name": "temple-1", "level": "micro", "role": "body", "importance": 1.0, "confidence": 0.78, "primitive": "tube", "topologyClass": "assembled-solid", "topologyRationale": "Contour follows the reference silhouette; depth is inferred and tested in orbit.", "geometryDescriptor": {"tubePath": {"points": [[0.088, 1.715, 0.088], [0.105, 1.711, 0.03], [0.099, 1.69, -0.012]], "radius": 0.004, "closed": false}, "attachmentGeometry": "authored-path"}, "parent": "root", "attachment": {"parentSocket": "head", "localStart": [0.088, 1.715, 0.088], "localEnd": [0.099, 1.69, -0.012], "contactType": "surface-embed", "embedDepth": 0.002, "gapTolerance": 0.003}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.78}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "temple-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "glasses-frame", "materialLayers": ["glasses-frame"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(25, 30, 37, 1)", "secondaryAlbedo": "rgba(25, 30, 37, 1)", "materialClass": "plastic", "materialClassConfidence": 0.8, "evidenceRefs": ["full-object"]}};
  node_temple_1_28.add(mesh_temple_1_28);
  meshes["temple-1"] = mesh_temple_1_28;
  colliders["temple-1"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["temple-1"] ??= [];
  destructionGroups["temple-1"].push(node_temple_1_28);

  const attachment_glasses_bridge_29 = {"parentSocket": "head", "localStart": [-0.012, 1.716, 0.097], "localEnd": [0.012, 1.716, 0.097], "contactType": "surface-embed", "embedDepth": 0.002, "gapTolerance": 0.003};
  const endpoint_glasses_bridge_29 = null; // authored tubePath already in model coordinates
  const node_glasses_bridge_29 = new THREE.Group();
  node_glasses_bridge_29.name = "glasses-bridge__pivot";
  node_glasses_bridge_29.scale.set(1, 1, 1);
  if (endpoint_glasses_bridge_29) {
    node_glasses_bridge_29.position.copy(endpoint_glasses_bridge_29.start);
    node_glasses_bridge_29.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_glasses_bridge_29.position.set(0.0, 0.0, 0.0);
    node_glasses_bridge_29.rotation.set(0.0, 0.0, 0.0);
  }
  node_glasses_bridge_29.userData.sculptComponent = {"id": "glasses-bridge", "name": "glasses-bridge", "level": "micro", "role": "body", "importance": 1.0, "confidence": 0.78, "primitive": "tube", "topologyClass": "assembled-solid", "topologyRationale": "Contour follows the reference silhouette; depth is inferred and tested in orbit.", "geometryDescriptor": {"tubePath": {"points": [[-0.012, 1.716, 0.097], [0, 1.722, 0.103], [0.012, 1.716, 0.097]], "radius": 0.004, "closed": false}, "attachmentGeometry": "authored-path"}, "parent": "root", "attachment": {"parentSocket": "head", "localStart": [-0.012, 1.716, 0.097], "localEnd": [0.012, 1.716, 0.097], "contactType": "surface-embed", "embedDepth": 0.002, "gapTolerance": 0.003}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.78}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "glasses-bridge", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "glasses-frame", "materialLayers": ["glasses-frame"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "eyewear-bridge", "kind": "contour", "description": "eyewear-bridge", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(25, 30, 37, 1)", "secondaryAlbedo": "rgba(25, 30, 37, 1)", "materialClass": "plastic", "materialClassConfidence": 0.8, "evidenceRefs": ["full-object"]}};
  node_glasses_bridge_29.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "glasses-bridge", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["root"] ?? root).add(node_glasses_bridge_29);
  nodes["glasses-bridge"] = node_glasses_bridge_29;
  const mesh_glasses_bridge_29Geometry = endpoint_glasses_bridge_29
    ? new THREE.CylinderGeometry(endpoint_glasses_bridge_29.endRadius, endpoint_glasses_bridge_29.baseRadius, endpoint_glasses_bridge_29.length, 16, 6)
    : buildTubeGeometry({"points": [[-0.012, 1.716, 0.097], [0, 1.722, 0.103], [0.012, 1.716, 0.097]], "radius": 0.004, "closed": false});
  if (!endpoint_glasses_bridge_29) {
    mesh_glasses_bridge_29Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_glasses_bridge_29 = new THREE.Mesh(
    mesh_glasses_bridge_29Geometry,
    materialMap["glasses-frame"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_glasses_bridge_29.name = "glasses-bridge";
  if (endpoint_glasses_bridge_29) {
    mesh_glasses_bridge_29.position.copy(endpoint_glasses_bridge_29.midpoint);
    mesh_glasses_bridge_29.quaternion.copy(endpoint_glasses_bridge_29.quaternion);
  }
  mesh_glasses_bridge_29.castShadow = options.castShadow ?? true;
  mesh_glasses_bridge_29.receiveShadow = options.receiveShadow ?? true;
  mesh_glasses_bridge_29.userData.sculptComponent = {"id": "glasses-bridge", "name": "glasses-bridge", "level": "micro", "role": "body", "importance": 1.0, "confidence": 0.78, "primitive": "tube", "topologyClass": "assembled-solid", "topologyRationale": "Contour follows the reference silhouette; depth is inferred and tested in orbit.", "geometryDescriptor": {"tubePath": {"points": [[-0.012, 1.716, 0.097], [0, 1.722, 0.103], [0.012, 1.716, 0.097]], "radius": 0.004, "closed": false}, "attachmentGeometry": "authored-path"}, "parent": "root", "attachment": {"parentSocket": "head", "localStart": [-0.012, 1.716, 0.097], "localEnd": [0.012, 1.716, 0.097], "contactType": "surface-embed", "embedDepth": 0.002, "gapTolerance": 0.003}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.78}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "glasses-bridge", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "glasses-frame", "materialLayers": ["glasses-frame"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "eyewear-bridge", "kind": "contour", "description": "eyewear-bridge", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(25, 30, 37, 1)", "secondaryAlbedo": "rgba(25, 30, 37, 1)", "materialClass": "plastic", "materialClassConfidence": 0.8, "evidenceRefs": ["full-object"]}};
  node_glasses_bridge_29.add(mesh_glasses_bridge_29);
  meshes["glasses-bridge"] = mesh_glasses_bridge_29;
  colliders["glasses-bridge"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["glasses-bridge"] ??= [];
  destructionGroups["glasses-bridge"].push(node_glasses_bridge_29);

  const attachment_mouth_30 = {"parentSocket": "head", "localStart": [-0.03, 1.627, 0.069], "localEnd": [0.029, 1.63, 0.069], "contactType": "surface-embed", "embedDepth": 0.002, "gapTolerance": 0.003};
  const endpoint_mouth_30 = null; // authored tubePath already in model coordinates
  const node_mouth_30 = new THREE.Group();
  node_mouth_30.name = "mouth__pivot";
  node_mouth_30.scale.set(1, 1, 1);
  if (endpoint_mouth_30) {
    node_mouth_30.position.copy(endpoint_mouth_30.start);
    node_mouth_30.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_mouth_30.position.set(0.0, 0.0, 0.0);
    node_mouth_30.rotation.set(0.0, 0.0, 0.0);
  }
  node_mouth_30.userData.sculptComponent = {"id": "mouth", "name": "mouth", "level": "micro", "role": "body", "importance": 1.0, "confidence": 0.78, "primitive": "tube", "topologyClass": "assembled-solid", "topologyRationale": "Contour follows the reference silhouette; depth is inferred and tested in orbit.", "geometryDescriptor": {"tubePath": {"points": [[-0.027, 1.635, 0.068], [-0.01, 1.631, 0.073], [0.01, 1.632, 0.073], [0.027, 1.638, 0.067]], "radius": 0.001, "closed": false}, "attachmentGeometry": "authored-path"}, "parent": "root", "attachment": {"parentSocket": "head", "localStart": [-0.03, 1.627, 0.069], "localEnd": [0.029, 1.63, 0.069], "contactType": "surface-embed", "embedDepth": 0.002, "gapTolerance": 0.003}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.78}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "mouth", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "lips", "materialLayers": ["lips"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(161, 106, 89, 1)", "secondaryAlbedo": "rgba(161, 106, 89, 1)", "materialClass": "plastic", "materialClassConfidence": 0.8, "evidenceRefs": ["full-object"]}};
  node_mouth_30.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "mouth", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["root"] ?? root).add(node_mouth_30);
  nodes["mouth"] = node_mouth_30;
  const mesh_mouth_30Geometry = endpoint_mouth_30
    ? new THREE.CylinderGeometry(endpoint_mouth_30.endRadius, endpoint_mouth_30.baseRadius, endpoint_mouth_30.length, 16, 6)
    : buildTubeGeometry({"points": [[-0.027, 1.635, 0.068], [-0.01, 1.631, 0.073], [0.01, 1.632, 0.073], [0.027, 1.638, 0.067]], "radius": 0.001, "closed": false});
  if (!endpoint_mouth_30) {
    mesh_mouth_30Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_mouth_30 = new THREE.Mesh(
    mesh_mouth_30Geometry,
    materialMap["lips"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_mouth_30.name = "mouth";
  if (endpoint_mouth_30) {
    mesh_mouth_30.position.copy(endpoint_mouth_30.midpoint);
    mesh_mouth_30.quaternion.copy(endpoint_mouth_30.quaternion);
  }
  mesh_mouth_30.castShadow = options.castShadow ?? true;
  mesh_mouth_30.receiveShadow = options.receiveShadow ?? true;
  mesh_mouth_30.userData.sculptComponent = {"id": "mouth", "name": "mouth", "level": "micro", "role": "body", "importance": 1.0, "confidence": 0.78, "primitive": "tube", "topologyClass": "assembled-solid", "topologyRationale": "Contour follows the reference silhouette; depth is inferred and tested in orbit.", "geometryDescriptor": {"tubePath": {"points": [[-0.027, 1.635, 0.068], [-0.01, 1.631, 0.073], [0.01, 1.632, 0.073], [0.027, 1.638, 0.067]], "radius": 0.001, "closed": false}, "attachmentGeometry": "authored-path"}, "parent": "root", "attachment": {"parentSocket": "head", "localStart": [-0.03, 1.627, 0.069], "localEnd": [0.029, 1.63, 0.069], "contactType": "surface-embed", "embedDepth": 0.002, "gapTolerance": 0.003}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.78}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "mouth", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "lips", "materialLayers": ["lips"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(161, 106, 89, 1)", "secondaryAlbedo": "rgba(161, 106, 89, 1)", "materialClass": "plastic", "materialClassConfidence": 0.8, "evidenceRefs": ["full-object"]}};
  node_mouth_30.add(mesh_mouth_30);
  meshes["mouth"] = mesh_mouth_30;
  colliders["mouth"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["mouth"] ??= [];
  destructionGroups["mouth"].push(node_mouth_30);

  const endpoint_cap_31 = makeAttachmentEndpoint(null);
  const node_cap_31 = new THREE.Group();
  node_cap_31.name = "cap__pivot";
  node_cap_31.scale.set(1, 1, 1);
  if (endpoint_cap_31) {
    node_cap_31.position.copy(endpoint_cap_31.start);
    node_cap_31.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_cap_31.position.set(0.0, 0.0, 0.0);
    node_cap_31.rotation.set(0.0, 0.0, 0.0);
  }
  node_cap_31.userData.sculptComponent = {"id": "cap", "name": "cap", "level": "meso", "role": "body", "importance": 1.0, "confidence": 0.78, "primitive": "tapered-sweep", "topologyClass": "continuous-sculpt", "topologyRationale": "Contour follows the reference silhouette; depth is inferred and tested in orbit.", "geometryDescriptor": {"taperedSweep": {"stations": [{"position": [0, 1.745, -0.017], "rx": 0.091, "rz": 0.101, "twist": 0}, {"position": [0, 1.775, -0.019], "rx": 0.089, "rz": 0.098, "twist": 0}, {"position": [0, 1.81, -0.019], "rx": 0.078, "rz": 0.083, "twist": 0}, {"position": [0, 1.837, -0.019], "rx": 0.05, "rz": 0.052, "twist": 0}, {"position": [0, 1.846, -0.019], "rx": 0.003, "rz": 0.003, "twist": 0}], "radialSegments": 24, "capEnds": true}, "normalStrategy": "smooth vertex normals"}, "parent": "root", "attachment": null, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.78}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "cap", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "cap", "materialLayers": ["cap"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "cap-seam", "kind": "seam", "description": "cap-seam", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(36, 35, 44, 1)", "secondaryAlbedo": "rgba(36, 35, 44, 1)", "materialClass": "fabric", "materialClassConfidence": 0.8, "evidenceRefs": ["full-object"]}};
  node_cap_31.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "cap", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["root"] ?? root).add(node_cap_31);
  nodes["cap"] = node_cap_31;
  const mesh_cap_31Geometry = endpoint_cap_31
    ? new THREE.CylinderGeometry(endpoint_cap_31.endRadius, endpoint_cap_31.baseRadius, endpoint_cap_31.length, 16, 6)
    : buildTaperedSweepGeometry({"stations": [{"position": [0, 1.745, -0.017], "rx": 0.091, "rz": 0.101, "twist": 0}, {"position": [0, 1.775, -0.019], "rx": 0.089, "rz": 0.098, "twist": 0}, {"position": [0, 1.81, -0.019], "rx": 0.078, "rz": 0.083, "twist": 0}, {"position": [0, 1.837, -0.019], "rx": 0.05, "rz": 0.052, "twist": 0}, {"position": [0, 1.846, -0.019], "rx": 0.003, "rz": 0.003, "twist": 0}], "radialSegments": 24, "capEnds": true});
  if (!endpoint_cap_31) {
    mesh_cap_31Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_cap_31 = new THREE.Mesh(
    mesh_cap_31Geometry,
    materialMap["cap"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_cap_31.name = "cap";
  if (endpoint_cap_31) {
    mesh_cap_31.position.copy(endpoint_cap_31.midpoint);
    mesh_cap_31.quaternion.copy(endpoint_cap_31.quaternion);
  }
  mesh_cap_31.castShadow = options.castShadow ?? true;
  mesh_cap_31.receiveShadow = options.receiveShadow ?? true;
  mesh_cap_31.userData.sculptComponent = {"id": "cap", "name": "cap", "level": "meso", "role": "body", "importance": 1.0, "confidence": 0.78, "primitive": "tapered-sweep", "topologyClass": "continuous-sculpt", "topologyRationale": "Contour follows the reference silhouette; depth is inferred and tested in orbit.", "geometryDescriptor": {"taperedSweep": {"stations": [{"position": [0, 1.745, -0.017], "rx": 0.091, "rz": 0.101, "twist": 0}, {"position": [0, 1.775, -0.019], "rx": 0.089, "rz": 0.098, "twist": 0}, {"position": [0, 1.81, -0.019], "rx": 0.078, "rz": 0.083, "twist": 0}, {"position": [0, 1.837, -0.019], "rx": 0.05, "rz": 0.052, "twist": 0}, {"position": [0, 1.846, -0.019], "rx": 0.003, "rz": 0.003, "twist": 0}], "radialSegments": 24, "capEnds": true}, "normalStrategy": "smooth vertex normals"}, "parent": "root", "attachment": null, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.78}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "cap", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "cap", "materialLayers": ["cap"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "cap-seam", "kind": "seam", "description": "cap-seam", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(36, 35, 44, 1)", "secondaryAlbedo": "rgba(36, 35, 44, 1)", "materialClass": "fabric", "materialClassConfidence": 0.8, "evidenceRefs": ["full-object"]}};
  node_cap_31.add(mesh_cap_31);
  meshes["cap"] = mesh_cap_31;
  colliders["cap"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["cap"] ??= [];
  destructionGroups["cap"].push(node_cap_31);

  const endpoint_cap_brim_32 = makeAttachmentEndpoint(null);
  const node_cap_brim_32 = new THREE.Group();
  node_cap_brim_32.name = "cap-brim__pivot";
  node_cap_brim_32.scale.set(1, 1, 1);
  if (endpoint_cap_brim_32) {
    node_cap_brim_32.position.copy(endpoint_cap_brim_32.start);
    node_cap_brim_32.rotation.set(1.5707963267948966, 0.0, -0.45);
  } else {
    node_cap_brim_32.position.set(0.0, 1.751, -0.067);
    node_cap_brim_32.rotation.set(1.5707963267948966, 0.0, -0.45);
  }
  node_cap_brim_32.userData.sculptComponent = {"id": "cap-brim", "name": "cap-brim", "level": "meso", "role": "body", "importance": 1.0, "confidence": 0.78, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Contour follows the reference silhouette; depth is inferred and tested in orbit.", "geometryDescriptor": {"profile2D": {"points": [[-0.45, 0], [-0.55, -0.4], [-0.48, -0.75], [-0.2, -0.95], [0.2, -0.95], [0.48, -0.75], [0.55, -0.4], [0.45, 0]], "depth": 1, "bevelEnabled": true, "bevelSize": 0.035, "bevelThickness": 0.03, "bevelSegments": 2}}, "parent": "root", "attachment": null, "dimensions": {"width": 0.18, "height": 0.18, "depth": 0.008, "units": "meters", "confidence": 0.78}, "transform": {"position": [0, 1.751, -0.067], "rotation": [1.5707963267948966, 0, -0.45], "scale": [0.18, 0.18, 0.008]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "cap-brim", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "cap", "materialLayers": ["cap"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "cap-brim", "kind": "contour", "description": "cap-brim", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(36, 35, 44, 1)", "secondaryAlbedo": "rgba(36, 35, 44, 1)", "materialClass": "fabric", "materialClassConfidence": 0.8, "evidenceRefs": ["full-object"]}};
  node_cap_brim_32.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "cap-brim", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["root"] ?? root).add(node_cap_brim_32);
  nodes["cap-brim"] = node_cap_brim_32;
  const mesh_cap_brim_32Geometry = endpoint_cap_brim_32
    ? new THREE.CylinderGeometry(endpoint_cap_brim_32.endRadius, endpoint_cap_brim_32.baseRadius, endpoint_cap_brim_32.length, 16, 6)
    : buildExtrudeGeometry({"points": [[-0.45, 0], [-0.55, -0.4], [-0.48, -0.75], [-0.2, -0.95], [0.2, -0.95], [0.48, -0.75], [0.55, -0.4], [0.45, 0]], "depth": 1, "bevelEnabled": true, "bevelSize": 0.035, "bevelThickness": 0.03, "bevelSegments": 2});
  if (!endpoint_cap_brim_32) {
    mesh_cap_brim_32Geometry.scale(0.18, 0.18, 0.008);
  }
  const mesh_cap_brim_32 = new THREE.Mesh(
    mesh_cap_brim_32Geometry,
    materialMap["cap"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_cap_brim_32.name = "cap-brim";
  if (endpoint_cap_brim_32) {
    mesh_cap_brim_32.position.copy(endpoint_cap_brim_32.midpoint);
    mesh_cap_brim_32.quaternion.copy(endpoint_cap_brim_32.quaternion);
  }
  mesh_cap_brim_32.castShadow = options.castShadow ?? true;
  mesh_cap_brim_32.receiveShadow = options.receiveShadow ?? true;
  mesh_cap_brim_32.userData.sculptComponent = {"id": "cap-brim", "name": "cap-brim", "level": "meso", "role": "body", "importance": 1.0, "confidence": 0.78, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Contour follows the reference silhouette; depth is inferred and tested in orbit.", "geometryDescriptor": {"profile2D": {"points": [[-0.45, 0], [-0.55, -0.4], [-0.48, -0.75], [-0.2, -0.95], [0.2, -0.95], [0.48, -0.75], [0.55, -0.4], [0.45, 0]], "depth": 1, "bevelEnabled": true, "bevelSize": 0.035, "bevelThickness": 0.03, "bevelSegments": 2}}, "parent": "root", "attachment": null, "dimensions": {"width": 0.18, "height": 0.18, "depth": 0.008, "units": "meters", "confidence": 0.78}, "transform": {"position": [0, 1.751, -0.067], "rotation": [1.5707963267948966, 0, -0.45], "scale": [0.18, 0.18, 0.008]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "cap-brim", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "cap", "materialLayers": ["cap"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "cap-brim", "kind": "contour", "description": "cap-brim", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(36, 35, 44, 1)", "secondaryAlbedo": "rgba(36, 35, 44, 1)", "materialClass": "fabric", "materialClassConfidence": 0.8, "evidenceRefs": ["full-object"]}};
  node_cap_brim_32.add(mesh_cap_brim_32);
  meshes["cap-brim"] = mesh_cap_brim_32;
  colliders["cap-brim"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["cap-brim"] ??= [];
  destructionGroups["cap-brim"].push(node_cap_brim_32);

  const endpoint_fringe_0_33 = makeAttachmentEndpoint(null);
  const node_fringe_0_33 = new THREE.Group();
  node_fringe_0_33.name = "fringe-0__pivot";
  node_fringe_0_33.scale.set(1, 1, 1);
  if (endpoint_fringe_0_33) {
    node_fringe_0_33.position.copy(endpoint_fringe_0_33.start);
    node_fringe_0_33.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_fringe_0_33.position.set(0.0, 0.0, 0.0);
    node_fringe_0_33.rotation.set(0.0, 0.0, 0.0);
  }
  node_fringe_0_33.userData.sculptComponent = {"id": "fringe-0", "name": "fringe-0", "level": "micro", "role": "body", "importance": 1.0, "confidence": 0.78, "primitive": "tapered-sweep", "topologyClass": "continuous-sculpt", "topologyRationale": "Contour follows the reference silhouette; depth is inferred and tested in orbit.", "geometryDescriptor": {"taperedSweep": {"stations": [{"position": [-0.065, 1.775, 0.035], "rx": 0.032, "rz": 0.025, "twist": 0}, {"position": [-0.04, 1.788, 0.072], "rx": 0.028, "rz": 0.021, "twist": 0}, {"position": [-0.017, 1.774, 0.098], "rx": 0.018, "rz": 0.012, "twist": 0}, {"position": [0.0, 1.753, 0.105], "rx": 0, "rz": 0, "twist": 0}], "radialSegments": 12, "capEnds": true}, "normalStrategy": "smooth vertex normals"}, "parent": "root", "attachment": null, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.78}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "fringe-0", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "hair", "materialLayers": ["hair"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "swept-fringe", "kind": "contour", "description": "swept-fringe", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(52, 40, 43, 1)", "secondaryAlbedo": "rgba(52, 40, 43, 1)", "materialClass": "plastic", "materialClassConfidence": 0.8, "evidenceRefs": ["full-object"]}};
  node_fringe_0_33.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "fringe-0", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["root"] ?? root).add(node_fringe_0_33);
  nodes["fringe-0"] = node_fringe_0_33;
  const mesh_fringe_0_33Geometry = endpoint_fringe_0_33
    ? new THREE.CylinderGeometry(endpoint_fringe_0_33.endRadius, endpoint_fringe_0_33.baseRadius, endpoint_fringe_0_33.length, 16, 6)
    : buildTaperedSweepGeometry({"stations": [{"position": [-0.065, 1.775, 0.035], "rx": 0.032, "rz": 0.025, "twist": 0}, {"position": [-0.04, 1.788, 0.072], "rx": 0.028, "rz": 0.021, "twist": 0}, {"position": [-0.017, 1.774, 0.098], "rx": 0.018, "rz": 0.012, "twist": 0}, {"position": [0.0, 1.753, 0.105], "rx": 0, "rz": 0, "twist": 0}], "radialSegments": 12, "capEnds": true});
  if (!endpoint_fringe_0_33) {
    mesh_fringe_0_33Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_fringe_0_33 = new THREE.Mesh(
    mesh_fringe_0_33Geometry,
    materialMap["hair"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_fringe_0_33.name = "fringe-0";
  if (endpoint_fringe_0_33) {
    mesh_fringe_0_33.position.copy(endpoint_fringe_0_33.midpoint);
    mesh_fringe_0_33.quaternion.copy(endpoint_fringe_0_33.quaternion);
  }
  mesh_fringe_0_33.castShadow = options.castShadow ?? true;
  mesh_fringe_0_33.receiveShadow = options.receiveShadow ?? true;
  mesh_fringe_0_33.userData.sculptComponent = {"id": "fringe-0", "name": "fringe-0", "level": "micro", "role": "body", "importance": 1.0, "confidence": 0.78, "primitive": "tapered-sweep", "topologyClass": "continuous-sculpt", "topologyRationale": "Contour follows the reference silhouette; depth is inferred and tested in orbit.", "geometryDescriptor": {"taperedSweep": {"stations": [{"position": [-0.065, 1.775, 0.035], "rx": 0.032, "rz": 0.025, "twist": 0}, {"position": [-0.04, 1.788, 0.072], "rx": 0.028, "rz": 0.021, "twist": 0}, {"position": [-0.017, 1.774, 0.098], "rx": 0.018, "rz": 0.012, "twist": 0}, {"position": [0.0, 1.753, 0.105], "rx": 0, "rz": 0, "twist": 0}], "radialSegments": 12, "capEnds": true}, "normalStrategy": "smooth vertex normals"}, "parent": "root", "attachment": null, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.78}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "fringe-0", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "hair", "materialLayers": ["hair"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "swept-fringe", "kind": "contour", "description": "swept-fringe", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(52, 40, 43, 1)", "secondaryAlbedo": "rgba(52, 40, 43, 1)", "materialClass": "plastic", "materialClassConfidence": 0.8, "evidenceRefs": ["full-object"]}};
  node_fringe_0_33.add(mesh_fringe_0_33);
  meshes["fringe-0"] = mesh_fringe_0_33;
  colliders["fringe-0"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["fringe-0"] ??= [];
  destructionGroups["fringe-0"].push(node_fringe_0_33);

  const endpoint_fringe_1_34 = makeAttachmentEndpoint(null);
  const node_fringe_1_34 = new THREE.Group();
  node_fringe_1_34.name = "fringe-1__pivot";
  node_fringe_1_34.scale.set(1, 1, 1);
  if (endpoint_fringe_1_34) {
    node_fringe_1_34.position.copy(endpoint_fringe_1_34.start);
    node_fringe_1_34.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_fringe_1_34.position.set(0.0, 0.0, 0.0);
    node_fringe_1_34.rotation.set(0.0, 0.0, 0.0);
  }
  node_fringe_1_34.userData.sculptComponent = {"id": "fringe-1", "name": "fringe-1", "level": "micro", "role": "body", "importance": 1.0, "confidence": 0.78, "primitive": "tapered-sweep", "topologyClass": "continuous-sculpt", "topologyRationale": "Contour follows the reference silhouette; depth is inferred and tested in orbit.", "geometryDescriptor": {"taperedSweep": {"stations": [{"position": [-0.038000000000000006, 1.775, 0.035], "rx": 0.032, "rz": 0.025, "twist": 0}, {"position": [-0.013000000000000005, 1.788, 0.072], "rx": 0.028, "rz": 0.021, "twist": 0}, {"position": [0.009999999999999995, 1.774, 0.098], "rx": 0.018, "rz": 0.012, "twist": 0}, {"position": [0.026999999999999996, 1.753, 0.105], "rx": 0, "rz": 0, "twist": 0}], "radialSegments": 12, "capEnds": true}, "normalStrategy": "smooth vertex normals"}, "parent": "root", "attachment": null, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.78}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "fringe-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "hair", "materialLayers": ["hair"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(52, 40, 43, 1)", "secondaryAlbedo": "rgba(52, 40, 43, 1)", "materialClass": "plastic", "materialClassConfidence": 0.8, "evidenceRefs": ["full-object"]}};
  node_fringe_1_34.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "fringe-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["root"] ?? root).add(node_fringe_1_34);
  nodes["fringe-1"] = node_fringe_1_34;
  const mesh_fringe_1_34Geometry = endpoint_fringe_1_34
    ? new THREE.CylinderGeometry(endpoint_fringe_1_34.endRadius, endpoint_fringe_1_34.baseRadius, endpoint_fringe_1_34.length, 16, 6)
    : buildTaperedSweepGeometry({"stations": [{"position": [-0.038000000000000006, 1.775, 0.035], "rx": 0.032, "rz": 0.025, "twist": 0}, {"position": [-0.013000000000000005, 1.788, 0.072], "rx": 0.028, "rz": 0.021, "twist": 0}, {"position": [0.009999999999999995, 1.774, 0.098], "rx": 0.018, "rz": 0.012, "twist": 0}, {"position": [0.026999999999999996, 1.753, 0.105], "rx": 0, "rz": 0, "twist": 0}], "radialSegments": 12, "capEnds": true});
  if (!endpoint_fringe_1_34) {
    mesh_fringe_1_34Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_fringe_1_34 = new THREE.Mesh(
    mesh_fringe_1_34Geometry,
    materialMap["hair"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_fringe_1_34.name = "fringe-1";
  if (endpoint_fringe_1_34) {
    mesh_fringe_1_34.position.copy(endpoint_fringe_1_34.midpoint);
    mesh_fringe_1_34.quaternion.copy(endpoint_fringe_1_34.quaternion);
  }
  mesh_fringe_1_34.castShadow = options.castShadow ?? true;
  mesh_fringe_1_34.receiveShadow = options.receiveShadow ?? true;
  mesh_fringe_1_34.userData.sculptComponent = {"id": "fringe-1", "name": "fringe-1", "level": "micro", "role": "body", "importance": 1.0, "confidence": 0.78, "primitive": "tapered-sweep", "topologyClass": "continuous-sculpt", "topologyRationale": "Contour follows the reference silhouette; depth is inferred and tested in orbit.", "geometryDescriptor": {"taperedSweep": {"stations": [{"position": [-0.038000000000000006, 1.775, 0.035], "rx": 0.032, "rz": 0.025, "twist": 0}, {"position": [-0.013000000000000005, 1.788, 0.072], "rx": 0.028, "rz": 0.021, "twist": 0}, {"position": [0.009999999999999995, 1.774, 0.098], "rx": 0.018, "rz": 0.012, "twist": 0}, {"position": [0.026999999999999996, 1.753, 0.105], "rx": 0, "rz": 0, "twist": 0}], "radialSegments": 12, "capEnds": true}, "normalStrategy": "smooth vertex normals"}, "parent": "root", "attachment": null, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.78}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "fringe-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "hair", "materialLayers": ["hair"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(52, 40, 43, 1)", "secondaryAlbedo": "rgba(52, 40, 43, 1)", "materialClass": "plastic", "materialClassConfidence": 0.8, "evidenceRefs": ["full-object"]}};
  node_fringe_1_34.add(mesh_fringe_1_34);
  meshes["fringe-1"] = mesh_fringe_1_34;
  colliders["fringe-1"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["fringe-1"] ??= [];
  destructionGroups["fringe-1"].push(node_fringe_1_34);

  const endpoint_fringe_2_35 = makeAttachmentEndpoint(null);
  const node_fringe_2_35 = new THREE.Group();
  node_fringe_2_35.name = "fringe-2__pivot";
  node_fringe_2_35.scale.set(1, 1, 1);
  if (endpoint_fringe_2_35) {
    node_fringe_2_35.position.copy(endpoint_fringe_2_35.start);
    node_fringe_2_35.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_fringe_2_35.position.set(0.0, 0.0, 0.0);
    node_fringe_2_35.rotation.set(0.0, 0.0, 0.0);
  }
  node_fringe_2_35.userData.sculptComponent = {"id": "fringe-2", "name": "fringe-2", "level": "micro", "role": "body", "importance": 1.0, "confidence": 0.78, "primitive": "tapered-sweep", "topologyClass": "continuous-sculpt", "topologyRationale": "Contour follows the reference silhouette; depth is inferred and tested in orbit.", "geometryDescriptor": {"taperedSweep": {"stations": [{"position": [-0.011000000000000003, 1.775, 0.035], "rx": 0.032, "rz": 0.025, "twist": 0}, {"position": [0.013999999999999999, 1.788, 0.072], "rx": 0.028, "rz": 0.021, "twist": 0}, {"position": [0.037, 1.774, 0.098], "rx": 0.018, "rz": 0.012, "twist": 0}, {"position": [0.054, 1.753, 0.105], "rx": 0, "rz": 0, "twist": 0}], "radialSegments": 12, "capEnds": true}, "normalStrategy": "smooth vertex normals"}, "parent": "root", "attachment": null, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.78}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "fringe-2", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "hair", "materialLayers": ["hair"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(52, 40, 43, 1)", "secondaryAlbedo": "rgba(52, 40, 43, 1)", "materialClass": "plastic", "materialClassConfidence": 0.8, "evidenceRefs": ["full-object"]}};
  node_fringe_2_35.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "fringe-2", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["root"] ?? root).add(node_fringe_2_35);
  nodes["fringe-2"] = node_fringe_2_35;
  const mesh_fringe_2_35Geometry = endpoint_fringe_2_35
    ? new THREE.CylinderGeometry(endpoint_fringe_2_35.endRadius, endpoint_fringe_2_35.baseRadius, endpoint_fringe_2_35.length, 16, 6)
    : buildTaperedSweepGeometry({"stations": [{"position": [-0.011000000000000003, 1.775, 0.035], "rx": 0.032, "rz": 0.025, "twist": 0}, {"position": [0.013999999999999999, 1.788, 0.072], "rx": 0.028, "rz": 0.021, "twist": 0}, {"position": [0.037, 1.774, 0.098], "rx": 0.018, "rz": 0.012, "twist": 0}, {"position": [0.054, 1.753, 0.105], "rx": 0, "rz": 0, "twist": 0}], "radialSegments": 12, "capEnds": true});
  if (!endpoint_fringe_2_35) {
    mesh_fringe_2_35Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_fringe_2_35 = new THREE.Mesh(
    mesh_fringe_2_35Geometry,
    materialMap["hair"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_fringe_2_35.name = "fringe-2";
  if (endpoint_fringe_2_35) {
    mesh_fringe_2_35.position.copy(endpoint_fringe_2_35.midpoint);
    mesh_fringe_2_35.quaternion.copy(endpoint_fringe_2_35.quaternion);
  }
  mesh_fringe_2_35.castShadow = options.castShadow ?? true;
  mesh_fringe_2_35.receiveShadow = options.receiveShadow ?? true;
  mesh_fringe_2_35.userData.sculptComponent = {"id": "fringe-2", "name": "fringe-2", "level": "micro", "role": "body", "importance": 1.0, "confidence": 0.78, "primitive": "tapered-sweep", "topologyClass": "continuous-sculpt", "topologyRationale": "Contour follows the reference silhouette; depth is inferred and tested in orbit.", "geometryDescriptor": {"taperedSweep": {"stations": [{"position": [-0.011000000000000003, 1.775, 0.035], "rx": 0.032, "rz": 0.025, "twist": 0}, {"position": [0.013999999999999999, 1.788, 0.072], "rx": 0.028, "rz": 0.021, "twist": 0}, {"position": [0.037, 1.774, 0.098], "rx": 0.018, "rz": 0.012, "twist": 0}, {"position": [0.054, 1.753, 0.105], "rx": 0, "rz": 0, "twist": 0}], "radialSegments": 12, "capEnds": true}, "normalStrategy": "smooth vertex normals"}, "parent": "root", "attachment": null, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.78}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "fringe-2", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "hair", "materialLayers": ["hair"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(52, 40, 43, 1)", "secondaryAlbedo": "rgba(52, 40, 43, 1)", "materialClass": "plastic", "materialClassConfidence": 0.8, "evidenceRefs": ["full-object"]}};
  node_fringe_2_35.add(mesh_fringe_2_35);
  meshes["fringe-2"] = mesh_fringe_2_35;
  colliders["fringe-2"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["fringe-2"] ??= [];
  destructionGroups["fringe-2"].push(node_fringe_2_35);

  const endpoint_fringe_3_36 = makeAttachmentEndpoint(null);
  const node_fringe_3_36 = new THREE.Group();
  node_fringe_3_36.name = "fringe-3__pivot";
  node_fringe_3_36.scale.set(1, 1, 1);
  if (endpoint_fringe_3_36) {
    node_fringe_3_36.position.copy(endpoint_fringe_3_36.start);
    node_fringe_3_36.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_fringe_3_36.position.set(0.0, 0.0, 0.0);
    node_fringe_3_36.rotation.set(0.0, 0.0, 0.0);
  }
  node_fringe_3_36.userData.sculptComponent = {"id": "fringe-3", "name": "fringe-3", "level": "micro", "role": "body", "importance": 1.0, "confidence": 0.78, "primitive": "tapered-sweep", "topologyClass": "continuous-sculpt", "topologyRationale": "Contour follows the reference silhouette; depth is inferred and tested in orbit.", "geometryDescriptor": {"taperedSweep": {"stations": [{"position": [0.016, 1.775, 0.035], "rx": 0.032, "rz": 0.025, "twist": 0}, {"position": [0.041, 1.788, 0.072], "rx": 0.028, "rz": 0.021, "twist": 0}, {"position": [0.064, 1.774, 0.098], "rx": 0.018, "rz": 0.012, "twist": 0}, {"position": [0.081, 1.753, 0.105], "rx": 0, "rz": 0, "twist": 0}], "radialSegments": 12, "capEnds": true}, "normalStrategy": "smooth vertex normals"}, "parent": "root", "attachment": null, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.78}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "fringe-3", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "hair", "materialLayers": ["hair"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(52, 40, 43, 1)", "secondaryAlbedo": "rgba(52, 40, 43, 1)", "materialClass": "plastic", "materialClassConfidence": 0.8, "evidenceRefs": ["full-object"]}};
  node_fringe_3_36.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "fringe-3", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["root"] ?? root).add(node_fringe_3_36);
  nodes["fringe-3"] = node_fringe_3_36;
  const mesh_fringe_3_36Geometry = endpoint_fringe_3_36
    ? new THREE.CylinderGeometry(endpoint_fringe_3_36.endRadius, endpoint_fringe_3_36.baseRadius, endpoint_fringe_3_36.length, 16, 6)
    : buildTaperedSweepGeometry({"stations": [{"position": [0.016, 1.775, 0.035], "rx": 0.032, "rz": 0.025, "twist": 0}, {"position": [0.041, 1.788, 0.072], "rx": 0.028, "rz": 0.021, "twist": 0}, {"position": [0.064, 1.774, 0.098], "rx": 0.018, "rz": 0.012, "twist": 0}, {"position": [0.081, 1.753, 0.105], "rx": 0, "rz": 0, "twist": 0}], "radialSegments": 12, "capEnds": true});
  if (!endpoint_fringe_3_36) {
    mesh_fringe_3_36Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_fringe_3_36 = new THREE.Mesh(
    mesh_fringe_3_36Geometry,
    materialMap["hair"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_fringe_3_36.name = "fringe-3";
  if (endpoint_fringe_3_36) {
    mesh_fringe_3_36.position.copy(endpoint_fringe_3_36.midpoint);
    mesh_fringe_3_36.quaternion.copy(endpoint_fringe_3_36.quaternion);
  }
  mesh_fringe_3_36.castShadow = options.castShadow ?? true;
  mesh_fringe_3_36.receiveShadow = options.receiveShadow ?? true;
  mesh_fringe_3_36.userData.sculptComponent = {"id": "fringe-3", "name": "fringe-3", "level": "micro", "role": "body", "importance": 1.0, "confidence": 0.78, "primitive": "tapered-sweep", "topologyClass": "continuous-sculpt", "topologyRationale": "Contour follows the reference silhouette; depth is inferred and tested in orbit.", "geometryDescriptor": {"taperedSweep": {"stations": [{"position": [0.016, 1.775, 0.035], "rx": 0.032, "rz": 0.025, "twist": 0}, {"position": [0.041, 1.788, 0.072], "rx": 0.028, "rz": 0.021, "twist": 0}, {"position": [0.064, 1.774, 0.098], "rx": 0.018, "rz": 0.012, "twist": 0}, {"position": [0.081, 1.753, 0.105], "rx": 0, "rz": 0, "twist": 0}], "radialSegments": 12, "capEnds": true}, "normalStrategy": "smooth vertex normals"}, "parent": "root", "attachment": null, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.78}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "fringe-3", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "hair", "materialLayers": ["hair"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(52, 40, 43, 1)", "secondaryAlbedo": "rgba(52, 40, 43, 1)", "materialClass": "plastic", "materialClassConfidence": 0.8, "evidenceRefs": ["full-object"]}};
  node_fringe_3_36.add(mesh_fringe_3_36);
  meshes["fringe-3"] = mesh_fringe_3_36;
  colliders["fringe-3"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["fringe-3"] ??= [];
  destructionGroups["fringe-3"].push(node_fringe_3_36);

  const endpoint_fringe_4_37 = makeAttachmentEndpoint(null);
  const node_fringe_4_37 = new THREE.Group();
  node_fringe_4_37.name = "fringe-4__pivot";
  node_fringe_4_37.scale.set(1, 1, 1);
  if (endpoint_fringe_4_37) {
    node_fringe_4_37.position.copy(endpoint_fringe_4_37.start);
    node_fringe_4_37.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_fringe_4_37.position.set(0.0, 0.0, 0.0);
    node_fringe_4_37.rotation.set(0.0, 0.0, 0.0);
  }
  node_fringe_4_37.userData.sculptComponent = {"id": "fringe-4", "name": "fringe-4", "level": "micro", "role": "body", "importance": 1.0, "confidence": 0.78, "primitive": "tapered-sweep", "topologyClass": "continuous-sculpt", "topologyRationale": "Contour follows the reference silhouette; depth is inferred and tested in orbit.", "geometryDescriptor": {"taperedSweep": {"stations": [{"position": [0.043, 1.775, 0.035], "rx": 0.032, "rz": 0.025, "twist": 0}, {"position": [0.068, 1.788, 0.072], "rx": 0.028, "rz": 0.021, "twist": 0}, {"position": [0.091, 1.774, 0.098], "rx": 0.018, "rz": 0.012, "twist": 0}, {"position": [0.108, 1.753, 0.105], "rx": 0, "rz": 0, "twist": 0}], "radialSegments": 12, "capEnds": true}, "normalStrategy": "smooth vertex normals"}, "parent": "root", "attachment": null, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.78}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "fringe-4", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "hair", "materialLayers": ["hair"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(52, 40, 43, 1)", "secondaryAlbedo": "rgba(52, 40, 43, 1)", "materialClass": "plastic", "materialClassConfidence": 0.8, "evidenceRefs": ["full-object"]}};
  node_fringe_4_37.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "fringe-4", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["root"] ?? root).add(node_fringe_4_37);
  nodes["fringe-4"] = node_fringe_4_37;
  const mesh_fringe_4_37Geometry = endpoint_fringe_4_37
    ? new THREE.CylinderGeometry(endpoint_fringe_4_37.endRadius, endpoint_fringe_4_37.baseRadius, endpoint_fringe_4_37.length, 16, 6)
    : buildTaperedSweepGeometry({"stations": [{"position": [0.043, 1.775, 0.035], "rx": 0.032, "rz": 0.025, "twist": 0}, {"position": [0.068, 1.788, 0.072], "rx": 0.028, "rz": 0.021, "twist": 0}, {"position": [0.091, 1.774, 0.098], "rx": 0.018, "rz": 0.012, "twist": 0}, {"position": [0.108, 1.753, 0.105], "rx": 0, "rz": 0, "twist": 0}], "radialSegments": 12, "capEnds": true});
  if (!endpoint_fringe_4_37) {
    mesh_fringe_4_37Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_fringe_4_37 = new THREE.Mesh(
    mesh_fringe_4_37Geometry,
    materialMap["hair"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_fringe_4_37.name = "fringe-4";
  if (endpoint_fringe_4_37) {
    mesh_fringe_4_37.position.copy(endpoint_fringe_4_37.midpoint);
    mesh_fringe_4_37.quaternion.copy(endpoint_fringe_4_37.quaternion);
  }
  mesh_fringe_4_37.castShadow = options.castShadow ?? true;
  mesh_fringe_4_37.receiveShadow = options.receiveShadow ?? true;
  mesh_fringe_4_37.userData.sculptComponent = {"id": "fringe-4", "name": "fringe-4", "level": "micro", "role": "body", "importance": 1.0, "confidence": 0.78, "primitive": "tapered-sweep", "topologyClass": "continuous-sculpt", "topologyRationale": "Contour follows the reference silhouette; depth is inferred and tested in orbit.", "geometryDescriptor": {"taperedSweep": {"stations": [{"position": [0.043, 1.775, 0.035], "rx": 0.032, "rz": 0.025, "twist": 0}, {"position": [0.068, 1.788, 0.072], "rx": 0.028, "rz": 0.021, "twist": 0}, {"position": [0.091, 1.774, 0.098], "rx": 0.018, "rz": 0.012, "twist": 0}, {"position": [0.108, 1.753, 0.105], "rx": 0, "rz": 0, "twist": 0}], "radialSegments": 12, "capEnds": true}, "normalStrategy": "smooth vertex normals"}, "parent": "root", "attachment": null, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.78}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "fringe-4", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "hair", "materialLayers": ["hair"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(52, 40, 43, 1)", "secondaryAlbedo": "rgba(52, 40, 43, 1)", "materialClass": "plastic", "materialClassConfidence": 0.8, "evidenceRefs": ["full-object"]}};
  node_fringe_4_37.add(mesh_fringe_4_37);
  meshes["fringe-4"] = mesh_fringe_4_37;
  colliders["fringe-4"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["fringe-4"] ??= [];
  destructionGroups["fringe-4"].push(node_fringe_4_37);

  const attachment_necklace_38 = {"parentSocket": "shirt", "localStart": [-0.057, 1.485, 0.044], "localEnd": [0.057, 1.485, 0.044], "contactType": "surface-embed", "embedDepth": 0.002, "gapTolerance": 0.003};
  const endpoint_necklace_38 = null; // authored tubePath already in model coordinates
  const node_necklace_38 = new THREE.Group();
  node_necklace_38.name = "necklace__pivot";
  node_necklace_38.scale.set(1, 1, 1);
  if (endpoint_necklace_38) {
    node_necklace_38.position.copy(endpoint_necklace_38.start);
    node_necklace_38.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_necklace_38.position.set(0.0, 0.0, 0.0);
    node_necklace_38.rotation.set(0.0, 0.0, 0.0);
  }
  node_necklace_38.userData.sculptComponent = {"id": "necklace", "name": "necklace", "level": "micro", "role": "body", "importance": 1.0, "confidence": 0.78, "primitive": "tube", "topologyClass": "assembled-solid", "topologyRationale": "Contour follows the reference silhouette; depth is inferred and tested in orbit.", "geometryDescriptor": {"tubePath": {"points": [[-0.057, 1.485, 0.044], [-0.044, 1.417, 0.099], [0, 1.355, 0.123], [0.044, 1.417, 0.099], [0.057, 1.485, 0.044]], "radius": 0.0021, "closed": false}, "attachmentGeometry": "authored-path"}, "parent": "root", "attachment": {"parentSocket": "shirt", "localStart": [-0.057, 1.485, 0.044], "localEnd": [0.057, 1.485, 0.044], "contactType": "surface-embed", "embedDepth": 0.002, "gapTolerance": 0.003}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.78}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "necklace", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "gold", "materialLayers": ["gold"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "gold-chain", "kind": "linework", "description": "gold-chain", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(207, 172, 92, 1)", "secondaryAlbedo": "rgba(207, 172, 92, 1)", "materialClass": "metal", "materialClassConfidence": 0.8, "evidenceRefs": ["full-object"]}};
  node_necklace_38.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "necklace", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["root"] ?? root).add(node_necklace_38);
  nodes["necklace"] = node_necklace_38;
  const mesh_necklace_38Geometry = endpoint_necklace_38
    ? new THREE.CylinderGeometry(endpoint_necklace_38.endRadius, endpoint_necklace_38.baseRadius, endpoint_necklace_38.length, 16, 6)
    : buildTubeGeometry({"points": [[-0.057, 1.485, 0.044], [-0.044, 1.417, 0.099], [0, 1.355, 0.123], [0.044, 1.417, 0.099], [0.057, 1.485, 0.044]], "radius": 0.0021, "closed": false});
  if (!endpoint_necklace_38) {
    mesh_necklace_38Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_necklace_38 = new THREE.Mesh(
    mesh_necklace_38Geometry,
    materialMap["gold"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_necklace_38.name = "necklace";
  if (endpoint_necklace_38) {
    mesh_necklace_38.position.copy(endpoint_necklace_38.midpoint);
    mesh_necklace_38.quaternion.copy(endpoint_necklace_38.quaternion);
  }
  mesh_necklace_38.castShadow = options.castShadow ?? true;
  mesh_necklace_38.receiveShadow = options.receiveShadow ?? true;
  mesh_necklace_38.userData.sculptComponent = {"id": "necklace", "name": "necklace", "level": "micro", "role": "body", "importance": 1.0, "confidence": 0.78, "primitive": "tube", "topologyClass": "assembled-solid", "topologyRationale": "Contour follows the reference silhouette; depth is inferred and tested in orbit.", "geometryDescriptor": {"tubePath": {"points": [[-0.057, 1.485, 0.044], [-0.044, 1.417, 0.099], [0, 1.355, 0.123], [0.044, 1.417, 0.099], [0.057, 1.485, 0.044]], "radius": 0.0021, "closed": false}, "attachmentGeometry": "authored-path"}, "parent": "root", "attachment": {"parentSocket": "shirt", "localStart": [-0.057, 1.485, 0.044], "localEnd": [0.057, 1.485, 0.044], "contactType": "surface-embed", "embedDepth": 0.002, "gapTolerance": 0.003}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.78}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "necklace", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "gold", "materialLayers": ["gold"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "gold-chain", "kind": "linework", "description": "gold-chain", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(207, 172, 92, 1)", "secondaryAlbedo": "rgba(207, 172, 92, 1)", "materialClass": "metal", "materialClassConfidence": 0.8, "evidenceRefs": ["full-object"]}};
  node_necklace_38.add(mesh_necklace_38);
  meshes["necklace"] = mesh_necklace_38;
  colliders["necklace"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["necklace"] ??= [];
  destructionGroups["necklace"].push(node_necklace_38);

  const endpoint_pendant_39 = makeAttachmentEndpoint(null);
  const node_pendant_39 = new THREE.Group();
  node_pendant_39.name = "pendant__pivot";
  node_pendant_39.scale.set(1, 1, 1);
  if (endpoint_pendant_39) {
    node_pendant_39.position.copy(endpoint_pendant_39.start);
    node_pendant_39.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_pendant_39.position.set(0.0, 1.346, 0.124);
    node_pendant_39.rotation.set(0.0, 0.0, 0.0);
  }
  node_pendant_39.userData.sculptComponent = {"id": "pendant", "name": "pendant", "level": "micro", "role": "body", "importance": 1.0, "confidence": 0.78, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Contour follows the reference silhouette; depth is inferred and tested in orbit.", "geometryDescriptor": {"normalStrategy": "smooth vertex normals", "uvStrategy": "generated procedural coordinates", "edgeTreatment": {"type": "none", "bevelRadius": 0, "segments": 1}, "deformationStack": []}, "parent": "root", "attachment": null, "dimensions": {"width": 0.018, "height": 0.031, "depth": 0.005, "units": "meters", "confidence": 0.78}, "transform": {"position": [0, 1.346, 0.124], "rotation": [0, 0, 0], "scale": [0.018, 0.031, 0.005]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pendant", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "gold", "materialLayers": ["gold"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "rectangular-pendant", "kind": "bevel", "description": "rectangular-pendant", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(207, 172, 92, 1)", "secondaryAlbedo": "rgba(207, 172, 92, 1)", "materialClass": "metal", "materialClassConfidence": 0.8, "evidenceRefs": ["full-object"]}};
  node_pendant_39.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pendant", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["root"] ?? root).add(node_pendant_39);
  nodes["pendant"] = node_pendant_39;
  const mesh_pendant_39Geometry = endpoint_pendant_39
    ? new THREE.CylinderGeometry(endpoint_pendant_39.endRadius, endpoint_pendant_39.baseRadius, endpoint_pendant_39.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_pendant_39) {
    mesh_pendant_39Geometry.scale(0.018, 0.031, 0.005);
  }
  const mesh_pendant_39 = new THREE.Mesh(
    mesh_pendant_39Geometry,
    materialMap["gold"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_pendant_39.name = "pendant";
  if (endpoint_pendant_39) {
    mesh_pendant_39.position.copy(endpoint_pendant_39.midpoint);
    mesh_pendant_39.quaternion.copy(endpoint_pendant_39.quaternion);
  }
  mesh_pendant_39.castShadow = options.castShadow ?? true;
  mesh_pendant_39.receiveShadow = options.receiveShadow ?? true;
  mesh_pendant_39.userData.sculptComponent = {"id": "pendant", "name": "pendant", "level": "micro", "role": "body", "importance": 1.0, "confidence": 0.78, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Contour follows the reference silhouette; depth is inferred and tested in orbit.", "geometryDescriptor": {"normalStrategy": "smooth vertex normals", "uvStrategy": "generated procedural coordinates", "edgeTreatment": {"type": "none", "bevelRadius": 0, "segments": 1}, "deformationStack": []}, "parent": "root", "attachment": null, "dimensions": {"width": 0.018, "height": 0.031, "depth": 0.005, "units": "meters", "confidence": 0.78}, "transform": {"position": [0, 1.346, 0.124], "rotation": [0, 0, 0], "scale": [0.018, 0.031, 0.005]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pendant", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "gold", "materialLayers": ["gold"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "rectangular-pendant", "kind": "bevel", "description": "rectangular-pendant", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(207, 172, 92, 1)", "secondaryAlbedo": "rgba(207, 172, 92, 1)", "materialClass": "metal", "materialClassConfidence": 0.8, "evidenceRefs": ["full-object"]}};
  node_pendant_39.add(mesh_pendant_39);
  meshes["pendant"] = mesh_pendant_39;
  colliders["pendant"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["pendant"] ??= [];
  destructionGroups["pendant"].push(node_pendant_39);

  const endpoint_sleeve_l_40 = makeAttachmentEndpoint(null);
  const node_sleeve_l_40 = new THREE.Group();
  node_sleeve_l_40.name = "sleeve-l__pivot";
  node_sleeve_l_40.scale.set(1, 1, 1);
  if (endpoint_sleeve_l_40) {
    node_sleeve_l_40.position.copy(endpoint_sleeve_l_40.start);
    node_sleeve_l_40.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_sleeve_l_40.position.set(0.0, 0.0, 0.0);
    node_sleeve_l_40.rotation.set(0.0, 0.0, 0.0);
  }
  node_sleeve_l_40.userData.sculptComponent = {"id": "sleeve-l", "name": "sleeve-l", "level": "meso", "role": "body", "importance": 1.0, "confidence": 0.78, "primitive": "tapered-sweep", "topologyClass": "continuous-sculpt", "topologyRationale": "Contour follows the reference silhouette; depth is inferred and tested in orbit.", "geometryDescriptor": {"taperedSweep": {"stations": [{"position": [0.213, 1.405, 0], "rx": 0.028, "rz": 0.025}, {"position": [0.233, 1.38, 0], "rx": 0.085, "rz": 0.075}, {"position": [0.24800000000000003, 1.33, 0], "rx": 0.083, "rz": 0.073}, {"position": [0.256, 1.295, 0], "rx": 0.075, "rz": 0.065}], "radialSegments": 28, "capEnds": true}, "normalStrategy": "smooth shared contour"}, "parent": "root", "attachment": null, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.78}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "arm-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "shirt", "materialLayers": ["shirt"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(213, 154, 115, 1)", "secondaryAlbedo": "rgba(213, 154, 115, 1)", "materialClass": "skin", "materialClassConfidence": 0.8, "evidenceRefs": ["full-object"]}};
  node_sleeve_l_40.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "arm-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["root"] ?? root).add(node_sleeve_l_40);
  nodes["sleeve-l"] = node_sleeve_l_40;
  const mesh_sleeve_l_40Geometry = endpoint_sleeve_l_40
    ? new THREE.CylinderGeometry(endpoint_sleeve_l_40.endRadius, endpoint_sleeve_l_40.baseRadius, endpoint_sleeve_l_40.length, 16, 6)
    : buildTaperedSweepGeometry({"stations": [{"position": [0.213, 1.405, 0], "rx": 0.028, "rz": 0.025}, {"position": [0.233, 1.38, 0], "rx": 0.085, "rz": 0.075}, {"position": [0.24800000000000003, 1.33, 0], "rx": 0.083, "rz": 0.073}, {"position": [0.256, 1.295, 0], "rx": 0.075, "rz": 0.065}], "radialSegments": 28, "capEnds": true});
  if (!endpoint_sleeve_l_40) {
    mesh_sleeve_l_40Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_sleeve_l_40 = new THREE.Mesh(
    mesh_sleeve_l_40Geometry,
    materialMap["shirt"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_sleeve_l_40.name = "sleeve-l";
  if (endpoint_sleeve_l_40) {
    mesh_sleeve_l_40.position.copy(endpoint_sleeve_l_40.midpoint);
    mesh_sleeve_l_40.quaternion.copy(endpoint_sleeve_l_40.quaternion);
  }
  mesh_sleeve_l_40.castShadow = options.castShadow ?? true;
  mesh_sleeve_l_40.receiveShadow = options.receiveShadow ?? true;
  mesh_sleeve_l_40.userData.sculptComponent = {"id": "sleeve-l", "name": "sleeve-l", "level": "meso", "role": "body", "importance": 1.0, "confidence": 0.78, "primitive": "tapered-sweep", "topologyClass": "continuous-sculpt", "topologyRationale": "Contour follows the reference silhouette; depth is inferred and tested in orbit.", "geometryDescriptor": {"taperedSweep": {"stations": [{"position": [0.213, 1.405, 0], "rx": 0.028, "rz": 0.025}, {"position": [0.233, 1.38, 0], "rx": 0.085, "rz": 0.075}, {"position": [0.24800000000000003, 1.33, 0], "rx": 0.083, "rz": 0.073}, {"position": [0.256, 1.295, 0], "rx": 0.075, "rz": 0.065}], "radialSegments": 28, "capEnds": true}, "normalStrategy": "smooth shared contour"}, "parent": "root", "attachment": null, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.78}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "arm-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "shirt", "materialLayers": ["shirt"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(213, 154, 115, 1)", "secondaryAlbedo": "rgba(213, 154, 115, 1)", "materialClass": "skin", "materialClassConfidence": 0.8, "evidenceRefs": ["full-object"]}};
  node_sleeve_l_40.add(mesh_sleeve_l_40);
  meshes["sleeve-l"] = mesh_sleeve_l_40;
  colliders["sleeve-l"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["arm-l"] ??= [];
  destructionGroups["arm-l"].push(node_sleeve_l_40);

  const endpoint_sleeve_r_41 = makeAttachmentEndpoint(null);
  const node_sleeve_r_41 = new THREE.Group();
  node_sleeve_r_41.name = "sleeve-r__pivot";
  node_sleeve_r_41.scale.set(1, 1, 1);
  if (endpoint_sleeve_r_41) {
    node_sleeve_r_41.position.copy(endpoint_sleeve_r_41.start);
    node_sleeve_r_41.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_sleeve_r_41.position.set(0.0, 0.0, 0.0);
    node_sleeve_r_41.rotation.set(0.0, 0.0, 0.0);
  }
  node_sleeve_r_41.userData.sculptComponent = {"id": "sleeve-r", "name": "sleeve-r", "level": "meso", "role": "body", "importance": 1.0, "confidence": 0.78, "primitive": "tapered-sweep", "topologyClass": "continuous-sculpt", "topologyRationale": "Contour follows the reference silhouette; depth is inferred and tested in orbit.", "geometryDescriptor": {"taperedSweep": {"stations": [{"position": [-0.213, 1.405, 0], "rx": 0.028, "rz": 0.025}, {"position": [-0.233, 1.38, 0], "rx": 0.085, "rz": 0.075}, {"position": [-0.24800000000000003, 1.33, 0], "rx": 0.083, "rz": 0.073}, {"position": [-0.256, 1.295, 0], "rx": 0.075, "rz": 0.065}], "radialSegments": 28, "capEnds": true}, "normalStrategy": "smooth shared contour"}, "parent": "root", "attachment": null, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.78}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "arm-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "shirt", "materialLayers": ["shirt"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(213, 154, 115, 1)", "secondaryAlbedo": "rgba(213, 154, 115, 1)", "materialClass": "skin", "materialClassConfidence": 0.8, "evidenceRefs": ["full-object"]}};
  node_sleeve_r_41.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "arm-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["root"] ?? root).add(node_sleeve_r_41);
  nodes["sleeve-r"] = node_sleeve_r_41;
  const mesh_sleeve_r_41Geometry = endpoint_sleeve_r_41
    ? new THREE.CylinderGeometry(endpoint_sleeve_r_41.endRadius, endpoint_sleeve_r_41.baseRadius, endpoint_sleeve_r_41.length, 16, 6)
    : buildTaperedSweepGeometry({"stations": [{"position": [-0.213, 1.405, 0], "rx": 0.028, "rz": 0.025}, {"position": [-0.233, 1.38, 0], "rx": 0.085, "rz": 0.075}, {"position": [-0.24800000000000003, 1.33, 0], "rx": 0.083, "rz": 0.073}, {"position": [-0.256, 1.295, 0], "rx": 0.075, "rz": 0.065}], "radialSegments": 28, "capEnds": true});
  if (!endpoint_sleeve_r_41) {
    mesh_sleeve_r_41Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_sleeve_r_41 = new THREE.Mesh(
    mesh_sleeve_r_41Geometry,
    materialMap["shirt"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_sleeve_r_41.name = "sleeve-r";
  if (endpoint_sleeve_r_41) {
    mesh_sleeve_r_41.position.copy(endpoint_sleeve_r_41.midpoint);
    mesh_sleeve_r_41.quaternion.copy(endpoint_sleeve_r_41.quaternion);
  }
  mesh_sleeve_r_41.castShadow = options.castShadow ?? true;
  mesh_sleeve_r_41.receiveShadow = options.receiveShadow ?? true;
  mesh_sleeve_r_41.userData.sculptComponent = {"id": "sleeve-r", "name": "sleeve-r", "level": "meso", "role": "body", "importance": 1.0, "confidence": 0.78, "primitive": "tapered-sweep", "topologyClass": "continuous-sculpt", "topologyRationale": "Contour follows the reference silhouette; depth is inferred and tested in orbit.", "geometryDescriptor": {"taperedSweep": {"stations": [{"position": [-0.213, 1.405, 0], "rx": 0.028, "rz": 0.025}, {"position": [-0.233, 1.38, 0], "rx": 0.085, "rz": 0.075}, {"position": [-0.24800000000000003, 1.33, 0], "rx": 0.083, "rz": 0.073}, {"position": [-0.256, 1.295, 0], "rx": 0.075, "rz": 0.065}], "radialSegments": 28, "capEnds": true}, "normalStrategy": "smooth shared contour"}, "parent": "root", "attachment": null, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.78}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "arm-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "shirt", "materialLayers": ["shirt"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(213, 154, 115, 1)", "secondaryAlbedo": "rgba(213, 154, 115, 1)", "materialClass": "skin", "materialClassConfidence": 0.8, "evidenceRefs": ["full-object"]}};
  node_sleeve_r_41.add(mesh_sleeve_r_41);
  meshes["sleeve-r"] = mesh_sleeve_r_41;
  colliders["sleeve-r"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["arm-r"] ??= [];
  destructionGroups["arm-r"].push(node_sleeve_r_41);


  // Head planes are deformed on ONE surface in model coordinates.
  const faceSpec = meshes['head'].userData.sculptComponent.geometryDescriptor.faceSculpt;
  const headGeom = meshes['head'].geometry;
  const hp = headGeom.getAttribute('position');
  for(let i=0;i<hp.count;i++){
    let x=hp.getX(i),y=hp.getY(i),z=hp.getZ(i);
    if(z>-.005){const bump=(p:number[])=>p[4]*Math.exp(-Math.pow((x-p[0])/p[2],2)-Math.pow((y-p[1])/p[3],2));
      const gate=THREE.MathUtils.smoothstep(z,-.005,.035);
      z+=gate*(bump(faceSpec.nose)+bump(faceSpec.bridge)+bump(faceSpec.lipRidge)+faceSpec.cheeks.reduce((v:number,p:number[])=>v+bump(p),0));
      hp.setXYZ(i,x,y,z);
    }
  }headGeom.computeVertexNormals();
  root.updateMatrixWorld(true);
  const imageHeadIds=["head","cap","cap-brim","glasses-bridge","mouth","ear--1","eye--1","glasses--1","temple--1","ear-1","eye-1","glasses-1","temple-1","fringe-0","fringe-1","fringe-2","fringe-3","fringe-4"];
  const hmat=new THREE.Matrix4().makeTranslation(0,1.7,0).multiply(new THREE.Matrix4().makeRotationY(.48)).multiply(new THREE.Matrix4().makeRotationZ(-.105)).multiply(new THREE.Matrix4().makeScale(1.18,1.07,1.1)).multiply(new THREE.Matrix4().makeTranslation(0,-1.718,0));
  for(const id of imageHeadIds){const mesh=meshes[id];if(!mesh)continue;const m=new THREE.Matrix4().copy(mesh.matrixWorld).invert().multiply(hmat).multiply(mesh.matrixWorld);mesh.geometry.applyMatrix4(m);mesh.geometry.computeVertexNormals();}
  // A conforming shader marking has no floating geometry or visible thickness.
  const inkMesh=meshes['arm-r'];inkMesh.geometry.setAttribute('tattooCoord',inkMesh.geometry.getAttribute('position').clone());
  const inkMaterial=inkMesh.material.clone();inkMesh.material=inkMaterial;
  inkMaterial.onBeforeCompile=(shader:any)=>{
    shader.vertexShader='attribute vec3 tattooCoord;varying vec3 vTattooCoord;\n'+shader.vertexShader;
    shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\n vTattooCoord=tattooCoord;');
    shader.fragmentShader='varying vec3 vTattooCoord;\n'+shader.fragmentShader;
    shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>','#include <color_fragment>\n vec3 p=vTattooCoord; float x=p.x+.30; float upper=1.234-abs(x)*1.45; float a=1.-smoothstep(.006,.009,abs(p.y-upper));float arc=abs(length(vec2(x/.046,(p.y-1.116)/.067))-1.);float b=1.-smoothstep(.12,.20,arc);float band=1.-smoothstep(.008,.012,abs(p.y-(1.17+.018*sin(x*48.))));float mask=max(a,max(b,band))*step(.0,p.z)*step(1.035,p.y)*step(p.y,1.25);diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.075,.065,.065),mask*.88);');
  };
  inkMaterial.customProgramCacheKey=()=> 'riff-image-tribal-v1';
  for(const id of ['shirt','sleeve-l','sleeve-r','arm-l','arm-r','hand-l','hand-r','necklace','pendant']){const mesh=meshes[id];if(!mesh)continue;const a=mesh.geometry.getAttribute('position');for(let i=0;i<a.count;i++)a.setX(i,a.getX(i)*.86);a.needsUpdate=true;mesh.geometry.computeVertexNormals();}
  for(const [side,splay]of [['l',.065],['r',-.02]] as const){
    for(const id of Object.keys(meshes)){if(!(id==='pants-'+side||id==='shoe-'+side||id==='sole-'+side||id.startsWith('lace-'+side+'-')))continue;
      const mesh=meshes[id],attr=mesh.geometry.getAttribute('position'),inv=mesh.matrixWorld.clone().invert(),v=new THREE.Vector3();
      for(let i=0;i<attr.count;i++){v.fromBufferAttribute(attr,i).applyMatrix4(mesh.matrixWorld);v.x+=splay*Math.max(0,1-v.y/.98);v.applyMatrix4(inv);attr.setXYZ(i,v.x,v.y,v.z);}attr.needsUpdate=true;mesh.geometry.computeVertexNormals();
    }
  }

  root.userData.sculptRuntime = { nodes, meshes, sockets, colliders, destructionGroups } satisfies ProceduralModelRuntime;
  root.userData.lookDevTargets = {"qualityPriority": "reference-fidelity", "materialPass": {"albedoPaletteRequired": true, "roughnessVariationRequired": true, "normalOrBumpRequired": true, "localOverridesRequired": true, "minimumTextureResolution": 1024, "preferredTextureResolution": 2048, "independentMapChannels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "requiredSurfaceFrequencyBands": ["macro", "meso", "micro"], "geometryReliefRequiredWhenSilhouetteAffected": true, "referencePbrExtraction": {"requiredWhenSourceImagePresent": true, "targetThreshold": 0.7, "stopOnLowConfidence": true, "script": "forge/stage1_intake/extract_pbr_evidence.py", "acceptedLimitation": "single-image extraction is reference-derived inference, not exact photogrammetry"}, "mustAvoid": ["single flat albedo per material", "uniform roughness", "albedo texture reused as roughness/height/normal/AO", "single-frequency random noise", "plastic-looking smooth bark, stone, cloth, foliage, or aged material", "local color/detail described only in prose without material masks", "claiming exact PBR recovery when confidence is below the target threshold"]}, "lightingPass": {"requiredTerms": ["key light", "fill light", "rim or environment light", "exposure", "tone mapping", "background", "contact shadow"], "mustAvoid": ["ambient-only lighting", "flat value range", "missing contact shadow", "reference lighting copied without separating material readability"]}, "screenshotReview": ["Compare albedo palette and local color zones.", "Compare roughness/normal/bump response under light.", "Compare cavity dirt, edge wear, stains, moss, scratches, or other local masks.", "Compare key/fill/rim structure, exposure, tone mapping, background, and contact shadows.", "Capture a neutral-light render to verify material readability without reference lighting.", "Capture a grazing-light close-up to expose flat normals, uniform roughness, tiling, and plastic highlights.", "Capture a reference-matched render from the same camera framing as the source."]};
  root.userData.actionReadiness = {
    note: 'Use root.userData.sculptRuntime.nodes for transforms, sockets for attachments, colliders for physics proxies, and destructionGroups for breakable sets.',
  };
  return root;
}

export function createRiffNocturneSingleCharacterTestLookDevLights(
  mode: 'neutral' | 'grazing' | 'reference' = 'neutral',
): THREE.Group {
  const lights = new THREE.Group();
  lights.name = "Riff Nocturne single-character test look-dev lights";
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
  lights.userData.lightingFromPhoto = ["Key: upper-left soft directional at [3,5,4], intensity 3; ACES tone mapping exposure 1", "Fill: broad frontal at [-3,3,4], intensity .7, neutral pale background", "Rim: rear-right at [2,4,-3], intensity 1.1; contact shadow under shoes"];
  lights.userData.lookDevTargets = {"qualityPriority": "reference-fidelity", "materialPass": {"albedoPaletteRequired": true, "roughnessVariationRequired": true, "normalOrBumpRequired": true, "localOverridesRequired": true, "minimumTextureResolution": 1024, "preferredTextureResolution": 2048, "independentMapChannels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "requiredSurfaceFrequencyBands": ["macro", "meso", "micro"], "geometryReliefRequiredWhenSilhouetteAffected": true, "referencePbrExtraction": {"requiredWhenSourceImagePresent": true, "targetThreshold": 0.7, "stopOnLowConfidence": true, "script": "forge/stage1_intake/extract_pbr_evidence.py", "acceptedLimitation": "single-image extraction is reference-derived inference, not exact photogrammetry"}, "mustAvoid": ["single flat albedo per material", "uniform roughness", "albedo texture reused as roughness/height/normal/AO", "single-frequency random noise", "plastic-looking smooth bark, stone, cloth, foliage, or aged material", "local color/detail described only in prose without material masks", "claiming exact PBR recovery when confidence is below the target threshold"]}, "lightingPass": {"requiredTerms": ["key light", "fill light", "rim or environment light", "exposure", "tone mapping", "background", "contact shadow"], "mustAvoid": ["ambient-only lighting", "flat value range", "missing contact shadow", "reference lighting copied without separating material readability"]}, "screenshotReview": ["Compare albedo palette and local color zones.", "Compare roughness/normal/bump response under light.", "Compare cavity dirt, edge wear, stains, moss, scratches, or other local masks.", "Compare key/fill/rim structure, exposure, tone mapping, background, and contact shadows.", "Capture a neutral-light render to verify material readability without reference lighting.", "Capture a grazing-light close-up to expose flat normals, uniform roughness, tiling, and plastic highlights.", "Capture a reference-matched render from the same camera framing as the source."]};
  return lights;
}

// PBR materials (clearcoat/iridescence/transmission/anisotropy) need an environment
// map to visually behave as intended — call this once per renderer and assign the
// result to scene.environment before rendering. No external HDR asset required.
export function createRiffNocturneSingleCharacterTestEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
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
export function frameRiffNocturneSingleCharacterTestCamera(
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
export function createRiffNocturneSingleCharacterTestPresentationComposer(
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

export function configureRiffNocturneSingleCharacterTestRenderer(renderer: THREE.WebGLRenderer): void {
  // Load-bearing for view-dependent finishes (anodized / Doppler): without ACES + sRGB
  // the environment reflection reads flat/washed instead of a believable metal response.
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
}

export function createRiffNocturneSingleCharacterTestInspectControls(
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
