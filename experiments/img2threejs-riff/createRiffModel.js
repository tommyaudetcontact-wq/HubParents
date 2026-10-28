import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { BokehPass } from 'three/examples/jsm/postprocessing/BokehPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

















































function sdfSphere(point               , radius        )         {
  return point.length() - radius;
}

function sdfCapsule(point               , radius        , height        )         {
  const halfHeight = height * 0.5;
  const y = Math.max(-halfHeight, Math.min(halfHeight, point.y));
  return point.distanceTo(new THREE.Vector3(0, y, 0)) - radius;
}

function sdfBox(point               , size           )         {
  const q = new THREE.Vector3(Math.abs(point.x), Math.abs(point.y), Math.abs(point.z))
    .sub(new THREE.Vector3(size[0] * 0.5, size[1] * 0.5, size[2] * 0.5));
  return q.clone().max(new THREE.Vector3()).length() + Math.min(Math.max(q.x, q.y, q.z), 0);
}

function sdfCone(point               , radius        , height        )         {
  const halfHeight = height * 0.5;
  const taper = radius * (1 - (point.y + halfHeight) / height);
  return Math.max(Math.hypot(point.x, point.z) - Math.max(0, taper), Math.abs(point.y) - halfHeight);
}

function sdfEllipsoid(point               , radii           )         {
  const scaled = new THREE.Vector3(point.x / radii[0], point.y / radii[1], point.z / radii[2]);
  return (scaled.length() - 1) * Math.min(radii[0], radii[1], radii[2]);
}

function sdfRadii(primitive              )            {
  const radius = primitive.radius;
  if (primitive.radii) return primitive.radii;
  if (typeof radius === 'number') return [radius, radius, radius];
  return radius ?? [0.5, 0.5, 0.5];
}

function smin(left        , right        , radius        )         {
  const blend = Math.max(radius - Math.abs(left - right), 0) / radius;
  return Math.min(left, right) - blend * blend * radius * 0.25;
}

function sdfLocalPoint(point               , primitive              )                                          {
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

function sdfPrimitive(point               , primitive              )         {
  const local = sdfLocalPoint(point, primitive);
  let distance        ;
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

function sdfSample(descriptor               )              {
  const nodes = new Map                     ();
  for (const primitive of descriptor.primitives) nodes.set(primitive.id, (point) => sdfPrimitive(point, primitive));
  let result = descriptor.primitives.length > 0 ? nodes.get(descriptor.primitives[0].id) : undefined;
  for (let index = 0; index < (descriptor.operations?.length ?? 0); index += 1) {
    const operation = descriptor.operations?.[index];
    if (!operation) continue;
    const left = nodes.get(operation.left);
    const right = nodes.get(operation.right);
    if (!left || !right) continue;
    let combined             ;
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

function polygonizeSdf(descriptor               )                       {
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
  const defaultBounds                                                       = { min: [-2, -2, -2], max: [2, 2, 2] };
  const bounds = descriptor.bounds ?? defaultBounds;
  const min = new THREE.Vector3(bounds.min[0], bounds.min[1], bounds.min[2]);
  const step = new THREE.Vector3(
    (bounds.max[0] - bounds.min[0]) / resolution,
    (bounds.max[1] - bounds.min[1]) / resolution,
    (bounds.max[2] - bounds.min[2]) / resolution,
  );
  const sample              = descriptor.authoredLofts ? (point) => {
    const values=descriptor.authoredLofts .map((rings)=>{const y=point.y;let i=0;while(i<rings.length-2&&y>rings[i+1][0])i++;
      const a=rings[Math.max(0,i-1)],b=rings[i],c=rings[i+1],d=rings[Math.min(rings.length-1,i+2)],t=Math.max(0,Math.min(1,(y-b[0])/(c[0]-b[0])));
      const f=(k       )=>{const q=.5*(2*b[k]+(-a[k]+c[k])*t+(2*a[k]-5*b[k]+4*c[k]-d[k])*t*t+(-a[k]+3*b[k]-3*c[k]+d[k])*t*t*t);return Math.max(Math.min(b[k],c[k]),Math.min(Math.max(b[k],c[k]),q));};
      const rx=f(3),rz=f(4),radial=(Math.hypot((point.x-f(1))/rx,(point.z-f(2))/rz)-1)*Math.min(rx,rz);
      return Math.max(radial,rings[0][0]-y,y-rings[rings.length-1][0]);
    });for(const v of descriptor.authoredVolumes??[])values.push(sdfPrimitive(point,v));return values.reduce((a,b)=>smin(a,b,descriptor.blendRadius??.014));
  } : sdfSample(descriptor);
  const scratch = new THREE.Vector3();

  // Corner grid: one more corner than cells on each axis.
  const side = resolution + 1;
  const field = new Float32Array(side * side * side);
  const cornerAt = (x        , y        , z        )         => (z * side + y) * side + x;
  for (let z = 0; z < side; z += 1) {
    for (let y = 0; y < side; y += 1) {
      for (let x = 0; x < side; x += 1) {
        scratch.set(min.x + x * step.x, min.y + y * step.y, min.z + z * step.z);
        field[cornerAt(x, y, z)] = sample(scratch);
      }
    }
  }

  // The 12 cell edges as corner-offset pairs.
  const CUBE_EDGES                                                                         = [
    [0, 0, 0, 1, 0, 0], [1, 0, 0, 1, 1, 0], [0, 1, 0, 1, 1, 0], [0, 0, 0, 0, 1, 0],
    [0, 0, 1, 1, 0, 1], [1, 0, 1, 1, 1, 1], [0, 1, 1, 1, 1, 1], [0, 0, 1, 0, 1, 1],
    [0, 0, 0, 0, 0, 1], [1, 0, 0, 1, 0, 1], [1, 1, 0, 1, 1, 1], [0, 1, 0, 0, 1, 1],
  ];

  const positions           = [];
  const normals           = [];
  const indices           = [];
  const cellVertex = new Int32Array(resolution * resolution * resolution).fill(-1);
  const cellAt = (x        , y        , z        )         => (z * resolution + y) * resolution + x;

  // Central-difference gradient, stepped at a fraction of a cell so it follows the field rather
  // than the grid.
  const epsilon = Math.min(step.x, step.y, step.z) * 0.25;
  const gradient = (point               )                => {
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
  const quad = (a        , b        , c        , d        , flip         )       => {
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
function buildExtrudeShape(points                    , holes                       )              {
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
function ovalLoop(cx        , cy        , rx        , ry        , seg = 24)                     {
  const loop                     = [];
  for (let i = 0; i < seg; i += 1) {
    const a = (i / seg) * Math.PI * 2;
    loop.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
  }
  return loop;
}

function buildExtrudeGeometry(profile                                                                                                                                                                                                                                            )                        {
  const holes = [...(profile.holes ?? []), ...((profile.ovalHoles ?? []).map((o) => ovalLoop(o.cx, o.cy, o.rx, o.ry)))];
  const shape = buildExtrudeShape(profile.points, holes);
  return new THREE.ExtrudeGeometry(shape, {
    depth: profile.depth,
    bevelEnabled: profile.bevelEnabled??false, bevelSize:profile.bevelSize??0, bevelThickness:profile.bevelThickness??0, bevelSegments:profile.bevelSegments??1,
    steps: 1,
  });
}

function buildTubeGeometry(
  path                                                                                                    ,
)                     {
  const vectors = path.points.map(([x, y, z]) => new THREE.Vector3(x, y, z));
  const curve = new THREE.CatmullRomCurve3(vectors, path.closed ?? false);
  const tubularSegments = Math.max(8, path.points.length * 6);
  return new THREE.TubeGeometry(curve, tubularSegments, path.radius ?? 0.05, path.radialSegments ?? 8, path.closed ?? false);
}



// Frames come from PARALLEL TRANSPORT, not from a Frenet frame. A Frenet frame is defined by
// the curve's normal, which flips sign wherever the path has an inflection or straightens out,
// and every flip twists the surface 180 degrees within one segment. Carrying the previous frame
// forward and removing only its along-path component keeps the twist continuous. THREE's own
// extrudePath and TubeGeometry do not expose this, which is why this is hand-built.
function buildTaperedSweepGeometry(
  sweep                                                                                                 ,
)                       {
  const input = sweep.stations;
  const stations                   = [];
  for(let i=0;i<input.length-1;i++){
    const a=input[Math.max(0,i-1)], b=input[i], c=input[i+1], d=input[Math.min(input.length-1,i+2)];
    for(let n=0;n<4;n++){const t=n/4;const interp=(x       ,y       ,z       ,w       )=>.5*((2*y)+(-x+z)*t+(2*x-5*y+4*z-w)*t*t+(-x+3*y-3*z+w)*t*t*t);
      stations.push({position:b.position.map((v,k)=>interp(a.position[k],v,c.position[k],d.position[k]))                          ,rx:Math.max(0,interp(a.rx,b.rx,c.rx,d.rx)),rz:Math.max(0,interp(a.rz,b.rz,c.rz,d.rz)),twist:interp(a.twist||0,b.twist||0,c.twist||0,d.twist||0)});
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

  const normals                  = [];
  const binormals                  = [];
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

  const positions           = [];
  const uvs           = [];
  const indices           = [];
  const ringStart           = [];
  const isPoint            = [];

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

function hashString(value        )         {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function readLayerNumber(value         , keys          , fallback        )         {
  if (typeof value === 'number') return value;
  if (value && typeof value === 'object') {
    const record = value                           ;
    for (const key of keys) {
      if (typeof record[key] === 'number') return record[key]          ;
    }
  }
  return fallback;
}

function hexToRgb(hex        )                           {
  const normalized = /^#[0-9a-f]{3}$/i.test(hex)
    ? '#' + hex.slice(1).split('').map((part) => part + part).join('')
    : hex;
  const value = /^#[0-9a-f]{6}$/i.test(normalized) ? Number.parseInt(normalized.slice(1), 16) : 0x8a7a5f;
  return [clampAlbedoChannel((value >> 16) & 255), clampAlbedoChannel((value >> 8) & 255), clampAlbedoChannel(value & 255)];
}

function materialPalette(spec                    )           {
  const palette = spec.colorVariation?.palette;
  if (Array.isArray(palette) && palette.length > 0) return palette.filter((value) => typeof value === 'string');
  const secondary = spec.albedo?.secondary;
  const colors = [spec.baseColor ?? spec.color ?? spec.albedo?.dominant, ...(Array.isArray(secondary) ? secondary : [])];
  return colors.filter((value)                  => typeof value === 'string' && value.startsWith('#'));
}

function clamp01(value        )         {
  return Math.max(0, Math.min(1, value));
}

function clampAlbedoChannel(value        )         {
  return Math.max(30, Math.min(240, Math.round(value)));
}

function clampPbrF0(value        )         {
  return Math.max(0.02, Math.min(1, value));
}

function clampPbrIor(value        )         {
  return Math.max(1, Math.min(2.5, value));
}

function clampPbrMetalness(value        )         {
  return value >= 0.5 ? 1 : 0;
}

function clampedAlbedoColor(spec                    )              {
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

function smoothCurve(value        )         {
  return value * value * (3 - 2 * value);
}

function periodicHash(x        , y        , seed        , periodX        , periodY        )         {
  const wrappedX = ((x % periodX) + periodX) % periodX;
  const wrappedY = ((y % periodY) + periodY) % periodY;
  let value = Math.imul(wrappedX + seed * 17, 374761393) ^ Math.imul(wrappedY + seed * 31, 668265263);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
}

function periodicValueNoise(u        , v        , seed        , periodX        , periodY        )         {
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









function surfaceBands(spec                    )                {
  const source = Array.isArray(spec.surfaceFrequencyBands) ? spec.surfaceFrequencyBands : [];
  const parsed = source.flatMap((item         ) => {
    if (!item || typeof item !== 'object') return [];
    const band = item                           ;
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

function sampleSurface(u        , v        , bands               , seed        )         {
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

function mixPalette(colors                            , value        )                           {
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








function parseRgba(value        )                           {
  const match = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(value);
  if (!match) return [138, 122, 95];
  return [clampAlbedoChannel(Number(match[1])), clampAlbedoChannel(Number(match[2])), clampAlbedoChannel(Number(match[3]))];
}

// Analytical per-pixel gradient sample. The extraction schema's colorGradient carries
// exact rgba(...) stop colors (see extract_part_color_recipe.py), so this samples the
// same trend directly in JS math rather than round-tripping through a Canvas 2D
// createLinearGradient/createRadialGradient object — same visual result, and it composes
// directly with the existing noise/height-correlated colorVariation blend below.
function sampleColorGradient(gradient                   , u        , v        )                           {
  const stops = gradient.stops.length >= 2 ? gradient.stops : [{ offset: 0, color: 'rgba(138,122,95,1)' }, { offset: 1, color: 'rgba(138,122,95,1)' }];
  let t        ;
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

function writePixel(data                   , offset        , red        , green        , blue        )       {
  data[offset] = Math.max(0, Math.min(255, Math.round(red)));
  data[offset + 1] = Math.max(0, Math.min(255, Math.round(green)));
  data[offset + 2] = Math.max(0, Math.min(255, Math.round(blue)));
  data[offset + 3] = 255;
}

function makeCanvas(size        )                    {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  return canvas;
}

function createMapTexture(
  canvas                   ,
  colorSpace                  ,
  spec                    ,
  options                        ,
)                      {
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










function referenceMapUrl(spec                    , channel        )                {
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
  const map = (maps                           )[channel];
  if (!map || typeof map !== 'object') return null;
  const record = map                           ;
  const url = typeof record.url === 'string' && record.url.trim() ? record.url : record.path;
  return typeof url === 'string' && url.trim() ? url : null;
}

function createLoadedMapTexture(
  url        ,
  colorSpace                  ,
  spec                    ,
  options                        ,
)                {
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

function makeReferenceTextureSet(spec                    , options                        )                              {
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
  id        ,
  spec                    ,
  options                        ,
)                              {
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
  const colorGradient                                = spec.colorGradient;
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
      let color                          ;
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

function createSculptMaterial(id        , spec                    , options                        , denseComponent = false)                             {
  // A material that declares -- with evidence -- that its subject carries no texture
  // detail gets NO texture set. Synthesising one anyway is not a harmless default: the
  // branch below then forces color to white and roughness to 1 and reads both from the
  // generated maps, so the authored albedo and the reference-derived roughness are both
  // discarded, and the model gains mottling the reference does not have. Measured on the
  // tuxedo cat, whose black fur rendered as speckled grey-and-white from a palette that
  // only ever described two flat regions.
  const textureless = (spec.textureless                                      )?.declared === true;
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










function readVector3(value         , fallback                          )                {
  if (Array.isArray(value) && value.length === 3 && value.every((item) => typeof item === 'number')) {
    return new THREE.Vector3(value[0], value[1], value[2]);
  }
  return new THREE.Vector3(fallback[0], fallback[1], fallback[2]);
}

function readNumber(value         , fallback        )         {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function makeAttachmentEndpoint(attachment         )                            {
  if (!attachment || typeof attachment !== 'object') return null;
  const record = attachment                           ;
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
export function createRiffNocturneSingleCharacterTestModel(options                         = {})              {
  const root = new THREE.Group();
  root.name = "Riff Nocturne single-character test";
  root.userData.reconstructionEvidence = {"itemFamily": null, "subtype": null, "componentAdapter": null, "route": null, "exactnessTier": null, "referenceCamera": {"solved": false, "fovDegrees": 40.0, "aspect": 1.0, "orientation": {"yaw": 0.0, "pitch": 0.0, "roll": 0.0}, "positionHint": [0.0, 0.0, 3.0], "note": "For likeness work, solve the reference camera (forge/stage1_intake/solve_camera_pose.py) so the review render aligns with the photo and the reference can be projected. Confirm by overlay review."}, "approximationNotes": []};
  root.userData.materialPipeline = {};
  root.userData.materialReferenceRegistry = null;

  const materialMap                                 = {};
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
    {"id": "sole", "name": "sole", "type": "standard", "shaderModel": "MeshStandardMaterial", "baseColor": "#30343d", "color": "#30343d", "roughness": 0.75, "metalness": 0, "textureless": {"declared": true, "evidence": ["reference-isolated.png: broad smooth color regions, no observable pore/grain pattern at target game distance; simplified art requested by user"]}, "albedo": {"dominant": "#30343d", "secondary": ["#30343d"]}, "ambientOcclusion": {"cavityStrength": 0.16, "contactShadowBias": 0.25}, "localOverrides": []},
    options
  );
  materialMap["ink"] = createSculptMaterial(
    "ink",
    {"id": "ink", "name": "ink", "type": "standard", "shaderModel": "MeshStandardMaterial", "baseColor": "#45424a", "color": "#45424a", "roughness": 0.8, "metalness": 0, "textureless": {"declared": true, "evidence": ["reference-isolated.png: broad smooth color regions, no observable pore/grain pattern at target game distance; simplified art requested by user"]}, "albedo": {"dominant": "#45424a", "secondary": ["#45424a"]}, "ambientOcclusion": {"cavityStrength": 0.16, "contactShadowBias": 0.25}, "localOverrides": []},
    options
  );

  const nodes                                 = { root };
  const meshes                             = {};
  const sockets                                 = {};
  const colliders                          = {};
  const destructionGroups                                   = {};

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
  node_pants_2.userData.sculptComponent = {"id": "pants", "name": "pants", "level": "macro", "role": "body", "importance": 1.0, "confidence": 0.78, "primitive": "tapered-sweep", "topologyClass": "continuous-sculpt", "topologyRationale": "Smooth branched contour loft for pelvis and two legs; no ellipsoid stack or repeated lobes.", "geometryDescriptor": {"taperedSweep": {"stations": [{"position": [0, 0.835, 0], "rx": 0.045, "rz": 0.075}, {"position": [0, 0.865, -0.006], "rx": 0.08, "rz": 0.15}, {"position": [0, 0.93, -0.006], "rx": 0.105, "rz": 0.177}, {"position": [0, 0.98, -0.006], "rx": 0.108, "rz": 0.18}, {"position": [0, 1.045, -0.006], "rx": 0.101, "rz": 0.17}], "radialSegments": 40, "capEnds": true, "fixedFrame": "horizontal"}, "branchedLoft": {"lofts": [[[0.835, 0, 0, 0.075, 0.045], [0.865, 0, -0.006, 0.15, 0.08], [0.93, 0, -0.006, 0.177, 0.105], [0.98, 0, -0.006, 0.18, 0.108], [1.045, 0, -0.006, 0.17, 0.101]], [[0.155, 0.16971938775510204, -0.004, 0.055, 0.057], [0.2, 0.16673469387755102, -0.004, 0.058, 0.06], [0.3, 0.16010204081632654, -0.004, 0.066, 0.066], [0.4, 0.15346938775510205, -0.004, 0.069, 0.071], [0.5, 0.14683673469387756, -0.004, 0.067, 0.07], [0.6, 0.12720408163265307, -0.004, 0.078, 0.08], [0.75, 0.11725510204081632, -0.004, 0.09, 0.094], [0.88, 0.10863265306122448, -0.004, 0.09, 0.094], [0.93, 0.10531632653061224, -0.004, 0.078, 0.084], [0.97, 0.10266326530612244, -0.004, 0.043, 0.054], [1.005, 0.102, -0.004, 0.004, 0.006]], [[0.155, -0.13183673469387755, -0.004, 0.055, 0.057], [0.2, -0.1309183673469388, -0.004, 0.058, 0.06], [0.3, -0.12887755102040815, -0.004, 0.066, 0.066], [0.4, -0.12683673469387755, -0.004, 0.069, 0.071], [0.5, -0.12479591836734694, -0.004, 0.067, 0.07], [0.6, -0.10975510204081632, -0.004, 0.078, 0.08], [0.75, -0.1066938775510204, -0.004, 0.09, 0.094], [0.88, -0.1040408163265306, -0.004, 0.09, 0.094], [0.93, -0.1030204081632653, -0.004, 0.078, 0.084], [0.97, -0.10220408163265306, -0.004, 0.043, 0.054], [1.005, -0.102, -0.004, 0.004, 0.006]]], "blendRadius": 0.014, "resolution": 40, "bounds": {"min": [-0.29, 0.13, -0.15], "max": [0.29, 1.07, 0.15]}}, "normalStrategy": "Continuous cubic contour field, welded surface-net topology", "authoredRefinement": "refine-emitter.cjs: branchedProfileSample replaces only this surface before rigging; every contour is stored here."}, "parent": "root", "attachment": null, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.78}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pants-pelvis", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "pants", "materialLayers": ["pants"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(36, 44, 67, 1)", "secondaryAlbedo": "rgba(36, 44, 67, 1)", "materialClass": "fabric", "materialClassConfidence": 0.8, "evidenceRefs": ["full-object"]}};
  node_pants_2.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pants-pelvis", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["root"] ?? root).add(node_pants_2);
  nodes["pants"] = node_pants_2;
  const mesh_pants_2Geometry = polygonizeSdf({"primitives":[],"authoredLofts":[[[0.835,0,0,0.075,0.045],[0.865,0,-0.006,0.15,0.08],[0.93,0,-0.006,0.177,0.105],[0.98,0,-0.006,0.18,0.108],[1.045,0,-0.006,0.17,0.101]],[[0.155,0.16971938775510204,-0.004,0.055,0.057],[0.2,0.16673469387755102,-0.004,0.058,0.06],[0.3,0.16010204081632654,-0.004,0.066,0.066],[0.4,0.15346938775510205,-0.004,0.069,0.071],[0.5,0.14683673469387756,-0.004,0.067,0.07],[0.6,0.12720408163265307,-0.004,0.078,0.08],[0.75,0.11725510204081632,-0.004,0.09,0.094],[0.88,0.10863265306122448,-0.004,0.09,0.094],[0.93,0.10531632653061224,-0.004,0.078,0.084],[0.97,0.10266326530612244,-0.004,0.043,0.054],[1.005,0.102,-0.004,0.004,0.006]],[[0.155,-0.13183673469387755,-0.004,0.055,0.057],[0.2,-0.1309183673469388,-0.004,0.058,0.06],[0.3,-0.12887755102040815,-0.004,0.066,0.066],[0.4,-0.12683673469387755,-0.004,0.069,0.071],[0.5,-0.12479591836734694,-0.004,0.067,0.07],[0.6,-0.10975510204081632,-0.004,0.078,0.08],[0.75,-0.1066938775510204,-0.004,0.09,0.094],[0.88,-0.1040408163265306,-0.004,0.09,0.094],[0.93,-0.1030204081632653,-0.004,0.078,0.084],[0.97,-0.10220408163265306,-0.004,0.043,0.054],[1.005,-0.102,-0.004,0.004,0.006]]],"blendRadius":0.014,"resolution":40,"bounds":{"min":[-0.29,0.13,-0.15],"max":[0.29,1.07,0.15]}});
  if (!endpoint_pants_2) {
    mesh_pants_2Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_pants_2 = new THREE.Mesh(
    mesh_pants_2Geometry,
    materialMap["pants"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_pants_2.name = "pants";
  if (endpoint_pants_2) {
    mesh_pants_2.position.copy(endpoint_pants_2.midpoint);
    mesh_pants_2.quaternion.copy(endpoint_pants_2.quaternion);
  }
  mesh_pants_2.castShadow = options.castShadow ?? true;
  mesh_pants_2.receiveShadow = options.receiveShadow ?? true;
  mesh_pants_2.userData.sculptComponent = {"id": "pants", "name": "pants", "level": "macro", "role": "body", "importance": 1.0, "confidence": 0.78, "primitive": "tapered-sweep", "topologyClass": "continuous-sculpt", "topologyRationale": "Smooth branched contour loft for pelvis and two legs; no ellipsoid stack or repeated lobes.", "geometryDescriptor": {"taperedSweep": {"stations": [{"position": [0, 0.835, 0], "rx": 0.045, "rz": 0.075}, {"position": [0, 0.865, -0.006], "rx": 0.08, "rz": 0.15}, {"position": [0, 0.93, -0.006], "rx": 0.105, "rz": 0.177}, {"position": [0, 0.98, -0.006], "rx": 0.108, "rz": 0.18}, {"position": [0, 1.045, -0.006], "rx": 0.101, "rz": 0.17}], "radialSegments": 40, "capEnds": true, "fixedFrame": "horizontal"}, "branchedLoft": {"lofts": [[[0.835, 0, 0, 0.075, 0.045], [0.865, 0, -0.006, 0.15, 0.08], [0.93, 0, -0.006, 0.177, 0.105], [0.98, 0, -0.006, 0.18, 0.108], [1.045, 0, -0.006, 0.17, 0.101]], [[0.155, 0.16971938775510204, -0.004, 0.055, 0.057], [0.2, 0.16673469387755102, -0.004, 0.058, 0.06], [0.3, 0.16010204081632654, -0.004, 0.066, 0.066], [0.4, 0.15346938775510205, -0.004, 0.069, 0.071], [0.5, 0.14683673469387756, -0.004, 0.067, 0.07], [0.6, 0.12720408163265307, -0.004, 0.078, 0.08], [0.75, 0.11725510204081632, -0.004, 0.09, 0.094], [0.88, 0.10863265306122448, -0.004, 0.09, 0.094], [0.93, 0.10531632653061224, -0.004, 0.078, 0.084], [0.97, 0.10266326530612244, -0.004, 0.043, 0.054], [1.005, 0.102, -0.004, 0.004, 0.006]], [[0.155, -0.13183673469387755, -0.004, 0.055, 0.057], [0.2, -0.1309183673469388, -0.004, 0.058, 0.06], [0.3, -0.12887755102040815, -0.004, 0.066, 0.066], [0.4, -0.12683673469387755, -0.004, 0.069, 0.071], [0.5, -0.12479591836734694, -0.004, 0.067, 0.07], [0.6, -0.10975510204081632, -0.004, 0.078, 0.08], [0.75, -0.1066938775510204, -0.004, 0.09, 0.094], [0.88, -0.1040408163265306, -0.004, 0.09, 0.094], [0.93, -0.1030204081632653, -0.004, 0.078, 0.084], [0.97, -0.10220408163265306, -0.004, 0.043, 0.054], [1.005, -0.102, -0.004, 0.004, 0.006]]], "blendRadius": 0.014, "resolution": 40, "bounds": {"min": [-0.29, 0.13, -0.15], "max": [0.29, 1.07, 0.15]}}, "normalStrategy": "Continuous cubic contour field, welded surface-net topology", "authoredRefinement": "refine-emitter.cjs: branchedProfileSample replaces only this surface before rigging; every contour is stored here."}, "parent": "root", "attachment": null, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.78}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pants-pelvis", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "pants", "materialLayers": ["pants"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(36, 44, 67, 1)", "secondaryAlbedo": "rgba(36, 44, 67, 1)", "materialClass": "fabric", "materialClassConfidence": 0.8, "evidenceRefs": ["full-object"]}};
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
  node_arm_l_3.userData.sculptComponent = {"id": "arm-l", "name": "arm-l", "level": "macro", "role": "body", "importance": 1.0, "confidence": 0.78, "primitive": "tapered-sweep", "topologyClass": "continuous-sculpt", "topologyRationale": "Contour follows the reference silhouette; depth is inferred and tested in orbit.", "geometryDescriptor": {"taperedSweep": {"stations": [{"position": [0.321, 0.88, 0.003], "rx": 0.029, "rz": 0.032, "twist": 0}, {"position": [0.321, 0.95, 0], "rx": 0.035, "rz": 0.038, "twist": 0}, {"position": [0.317, 1.045, 0], "rx": 0.048, "rz": 0.055, "twist": 0}, {"position": [0.31, 1.105, 0], "rx": 0.043, "rz": 0.048, "twist": 0}, {"position": [0.295, 1.17, 0], "rx": 0.05, "rz": 0.055, "twist": 0}, {"position": [0.276, 1.245, 0], "rx": 0.06, "rz": 0.064, "twist": 0}, {"position": [0.258, 1.31, 0], "rx": 0.062, "rz": 0.062, "twist": 0}], "radialSegments": 24, "capEnds": true}, "normalStrategy": "smooth vertex normals", "connectedHand": {"lofts": [[[0.84, 0.324, 0.005, 0.034, 0.028], [0.88, 0.321, 0.003, 0.032, 0.029], [0.95, 0.321, 0, 0.038, 0.035], [1.045, 0.317, 0, 0.055, 0.048], [1.105, 0.31, 0, 0.048, 0.043], [1.17, 0.295, 0, 0.055, 0.05], [1.245, 0.276, 0, 0.064, 0.06], [1.31, 0.258, 0, 0.062, 0.062]]], "volumes": [{"id": "palm", "type": "ellipsoid", "center": [0.325, 0.842, 0.005], "radii": [0.044079999999999994, 0.061560000000000004, 0.028319999999999998]}, {"id": "finger0", "type": "ellipsoid", "center": [0.29524, 0.7944800000000001, 0.01], "radii": [0.010439999999999998, 0.03672, 0.012979999999999998]}, {"id": "finger1", "type": "ellipsoid", "center": [0.31508, 0.788, 0.01], "radii": [0.010439999999999998, 0.04104, 0.012979999999999998]}, {"id": "finger2", "type": "ellipsoid", "center": [0.33491999999999994, 0.7944800000000001, 0.01], "radii": [0.010439999999999998, 0.03672, 0.012979999999999998]}, {"id": "finger3", "type": "ellipsoid", "center": [0.35475999999999996, 0.80096, 0.01], "radii": [0.010439999999999998, 0.0324, 0.012979999999999998]}, {"id": "thumb-base", "type": "ellipsoid", "center": [0.296, 0.85, 0.012], "radii": [0.015, 0.026, 0.015]}, {"id": "thumb-tip", "type": "ellipsoid", "center": [0.286, 0.83, 0.022], "radii": [0.012, 0.02, 0.013]}], "blendRadius": 0.004, "resolution": 60, "bounds": {"min": [0.2, 0.72, -0.085], "max": [0.43, 1.34, 0.085]}, "purpose": "One continuous wrist surface; hand enlarged from reference-approved draft"}}, "parent": "root", "attachment": {"parentSocket": "shirt-sleeve", "localStart": [0.258, 1.31, 0], "localEnd": [0.321, 0.88, 0.003], "contactType": "overlap", "embedDepth": 0.025, "gapTolerance": 0.003}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.78}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "arm-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "skin", "materialLayers": ["skin"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(213, 154, 115, 1)", "secondaryAlbedo": "rgba(213, 154, 115, 1)", "materialClass": "skin", "materialClassConfidence": 0.8, "evidenceRefs": ["full-object"]}};
  node_arm_l_3.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "arm-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["root"] ?? root).add(node_arm_l_3);
  nodes["arm-l"] = node_arm_l_3;
  const mesh_arm_l_3Geometry = polygonizeSdf({"primitives":[],"authoredLofts":[[[0.84,0.324,0.005,0.034,0.028],[0.88,0.321,0.003,0.032,0.029],[0.95,0.321,0,0.038,0.035],[1.045,0.317,0,0.055,0.048],[1.105,0.31,0,0.048,0.043],[1.17,0.295,0,0.055,0.05],[1.245,0.276,0,0.064,0.06],[1.31,0.258,0,0.062,0.062]]],"authoredVolumes":[{"id":"palm","type":"ellipsoid","center":[0.325,0.842,0.005],"radii":[0.044079999999999994,0.061560000000000004,0.028319999999999998]},{"id":"finger0","type":"ellipsoid","center":[0.29524,0.7944800000000001,0.01],"radii":[0.010439999999999998,0.03672,0.012979999999999998]},{"id":"finger1","type":"ellipsoid","center":[0.31508,0.788,0.01],"radii":[0.010439999999999998,0.04104,0.012979999999999998]},{"id":"finger2","type":"ellipsoid","center":[0.33491999999999994,0.7944800000000001,0.01],"radii":[0.010439999999999998,0.03672,0.012979999999999998]},{"id":"finger3","type":"ellipsoid","center":[0.35475999999999996,0.80096,0.01],"radii":[0.010439999999999998,0.0324,0.012979999999999998]},{"id":"thumb-base","type":"ellipsoid","center":[0.296,0.85,0.012],"radii":[0.015,0.026,0.015]},{"id":"thumb-tip","type":"ellipsoid","center":[0.286,0.83,0.022],"radii":[0.012,0.02,0.013]}],"blendRadius":0.004,"resolution":60,"bounds":{"min":[0.2,0.72,-0.085],"max":[0.43,1.34,0.085]}});
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
  mesh_arm_l_3.userData.sculptComponent = {"id": "arm-l", "name": "arm-l", "level": "macro", "role": "body", "importance": 1.0, "confidence": 0.78, "primitive": "tapered-sweep", "topologyClass": "continuous-sculpt", "topologyRationale": "Contour follows the reference silhouette; depth is inferred and tested in orbit.", "geometryDescriptor": {"taperedSweep": {"stations": [{"position": [0.321, 0.88, 0.003], "rx": 0.029, "rz": 0.032, "twist": 0}, {"position": [0.321, 0.95, 0], "rx": 0.035, "rz": 0.038, "twist": 0}, {"position": [0.317, 1.045, 0], "rx": 0.048, "rz": 0.055, "twist": 0}, {"position": [0.31, 1.105, 0], "rx": 0.043, "rz": 0.048, "twist": 0}, {"position": [0.295, 1.17, 0], "rx": 0.05, "rz": 0.055, "twist": 0}, {"position": [0.276, 1.245, 0], "rx": 0.06, "rz": 0.064, "twist": 0}, {"position": [0.258, 1.31, 0], "rx": 0.062, "rz": 0.062, "twist": 0}], "radialSegments": 24, "capEnds": true}, "normalStrategy": "smooth vertex normals", "connectedHand": {"lofts": [[[0.84, 0.324, 0.005, 0.034, 0.028], [0.88, 0.321, 0.003, 0.032, 0.029], [0.95, 0.321, 0, 0.038, 0.035], [1.045, 0.317, 0, 0.055, 0.048], [1.105, 0.31, 0, 0.048, 0.043], [1.17, 0.295, 0, 0.055, 0.05], [1.245, 0.276, 0, 0.064, 0.06], [1.31, 0.258, 0, 0.062, 0.062]]], "volumes": [{"id": "palm", "type": "ellipsoid", "center": [0.325, 0.842, 0.005], "radii": [0.044079999999999994, 0.061560000000000004, 0.028319999999999998]}, {"id": "finger0", "type": "ellipsoid", "center": [0.29524, 0.7944800000000001, 0.01], "radii": [0.010439999999999998, 0.03672, 0.012979999999999998]}, {"id": "finger1", "type": "ellipsoid", "center": [0.31508, 0.788, 0.01], "radii": [0.010439999999999998, 0.04104, 0.012979999999999998]}, {"id": "finger2", "type": "ellipsoid", "center": [0.33491999999999994, 0.7944800000000001, 0.01], "radii": [0.010439999999999998, 0.03672, 0.012979999999999998]}, {"id": "finger3", "type": "ellipsoid", "center": [0.35475999999999996, 0.80096, 0.01], "radii": [0.010439999999999998, 0.0324, 0.012979999999999998]}, {"id": "thumb-base", "type": "ellipsoid", "center": [0.296, 0.85, 0.012], "radii": [0.015, 0.026, 0.015]}, {"id": "thumb-tip", "type": "ellipsoid", "center": [0.286, 0.83, 0.022], "radii": [0.012, 0.02, 0.013]}], "blendRadius": 0.004, "resolution": 60, "bounds": {"min": [0.2, 0.72, -0.085], "max": [0.43, 1.34, 0.085]}, "purpose": "One continuous wrist surface; hand enlarged from reference-approved draft"}}, "parent": "root", "attachment": {"parentSocket": "shirt-sleeve", "localStart": [0.258, 1.31, 0], "localEnd": [0.321, 0.88, 0.003], "contactType": "overlap", "embedDepth": 0.025, "gapTolerance": 0.003}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.78}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "arm-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "skin", "materialLayers": ["skin"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(213, 154, 115, 1)", "secondaryAlbedo": "rgba(213, 154, 115, 1)", "materialClass": "skin", "materialClassConfidence": 0.8, "evidenceRefs": ["full-object"]}};
  node_arm_l_3.add(mesh_arm_l_3);
  meshes["arm-l"] = mesh_arm_l_3;
  colliders["arm-l"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["arm-l"] ??= [];
  destructionGroups["arm-l"].push(node_arm_l_3);

  const endpoint_shoe_l_4 = makeAttachmentEndpoint(null);
  const node_shoe_l_4 = new THREE.Group();
  node_shoe_l_4.name = "shoe-l__pivot";
  node_shoe_l_4.scale.set(1, 1, 1);
  if (endpoint_shoe_l_4) {
    node_shoe_l_4.position.copy(endpoint_shoe_l_4.start);
    node_shoe_l_4.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_shoe_l_4.position.set(0.0, 0.0, 0.0);
    node_shoe_l_4.rotation.set(0.0, 0.0, 0.0);
  }
  node_shoe_l_4.userData.sculptComponent = {"id": "shoe-l", "name": "shoe-l", "level": "meso", "role": "body", "importance": 1.0, "confidence": 0.78, "primitive": "tapered-sweep", "topologyClass": "continuous-sculpt", "topologyRationale": "Continuous high-top shoe contour: flat broad toe, shaped instep and ankle collar, replacing rounded overlapping blobs.", "geometryDescriptor": {"taperedSweep": {"stations": [{"position": [0.115, 0.012, 0.035], "rx": 0.024, "rz": 0.015}, {"position": [0.115, 0.025, 0.035], "rx": 0.118, "rz": 0.063}, {"position": [0.115, 0.045, 0.035], "rx": 0.121, "rz": 0.067}, {"position": [0.115, 0.062, 0.03], "rx": 0.115, "rz": 0.064}, {"position": [0.115, 0.08, 0.015], "rx": 0.096, "rz": 0.06}, {"position": [0.115, 0.1, -0.002], "rx": 0.075, "rz": 0.056}, {"position": [0.115, 0.13, -0.018], "rx": 0.059, "rz": 0.054}, {"position": [0.115, 0.17, -0.023], "rx": 0.052, "rz": 0.052}, {"position": [0.115, 0.178, -0.023], "rx": 0.05, "rz": 0.05}], "radialSegments": 28, "capEnds": true, "fixedFrame": "horizontal"}, "normalStrategy": "Smooth horizontal shoe contours; separate outsole", "sourceNotes": "Broad reference toe and dark high-top sneakers, independent shoe module"}, "parent": "root", "attachment": null, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.78}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "shoe-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "shoes", "materialLayers": ["shoes"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(39, 41, 50, 1)", "secondaryAlbedo": "rgba(39, 41, 50, 1)", "materialClass": "plastic", "materialClassConfidence": 0.8, "evidenceRefs": ["full-object"]}};
  node_shoe_l_4.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "shoe-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["root"] ?? root).add(node_shoe_l_4);
  nodes["shoe-l"] = node_shoe_l_4;
  const mesh_shoe_l_4Geometry = endpoint_shoe_l_4
    ? new THREE.CylinderGeometry(endpoint_shoe_l_4.endRadius, endpoint_shoe_l_4.baseRadius, endpoint_shoe_l_4.length, 16, 6)
    : buildTaperedSweepGeometry({"stations": [{"position": [0.115, 0.012, 0.035], "rx": 0.024, "rz": 0.015}, {"position": [0.115, 0.025, 0.035], "rx": 0.118, "rz": 0.063}, {"position": [0.115, 0.045, 0.035], "rx": 0.121, "rz": 0.067}, {"position": [0.115, 0.062, 0.03], "rx": 0.115, "rz": 0.064}, {"position": [0.115, 0.08, 0.015], "rx": 0.096, "rz": 0.06}, {"position": [0.115, 0.1, -0.002], "rx": 0.075, "rz": 0.056}, {"position": [0.115, 0.13, -0.018], "rx": 0.059, "rz": 0.054}, {"position": [0.115, 0.17, -0.023], "rx": 0.052, "rz": 0.052}, {"position": [0.115, 0.178, -0.023], "rx": 0.05, "rz": 0.05}], "radialSegments": 28, "capEnds": true, "fixedFrame": "horizontal"});
  if (!endpoint_shoe_l_4) {
    mesh_shoe_l_4Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_shoe_l_4 = new THREE.Mesh(
    mesh_shoe_l_4Geometry,
    materialMap["shoes"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_shoe_l_4.name = "shoe-l";
  if (endpoint_shoe_l_4) {
    mesh_shoe_l_4.position.copy(endpoint_shoe_l_4.midpoint);
    mesh_shoe_l_4.quaternion.copy(endpoint_shoe_l_4.quaternion);
  }
  mesh_shoe_l_4.castShadow = options.castShadow ?? true;
  mesh_shoe_l_4.receiveShadow = options.receiveShadow ?? true;
  mesh_shoe_l_4.userData.sculptComponent = {"id": "shoe-l", "name": "shoe-l", "level": "meso", "role": "body", "importance": 1.0, "confidence": 0.78, "primitive": "tapered-sweep", "topologyClass": "continuous-sculpt", "topologyRationale": "Continuous high-top shoe contour: flat broad toe, shaped instep and ankle collar, replacing rounded overlapping blobs.", "geometryDescriptor": {"taperedSweep": {"stations": [{"position": [0.115, 0.012, 0.035], "rx": 0.024, "rz": 0.015}, {"position": [0.115, 0.025, 0.035], "rx": 0.118, "rz": 0.063}, {"position": [0.115, 0.045, 0.035], "rx": 0.121, "rz": 0.067}, {"position": [0.115, 0.062, 0.03], "rx": 0.115, "rz": 0.064}, {"position": [0.115, 0.08, 0.015], "rx": 0.096, "rz": 0.06}, {"position": [0.115, 0.1, -0.002], "rx": 0.075, "rz": 0.056}, {"position": [0.115, 0.13, -0.018], "rx": 0.059, "rz": 0.054}, {"position": [0.115, 0.17, -0.023], "rx": 0.052, "rz": 0.052}, {"position": [0.115, 0.178, -0.023], "rx": 0.05, "rz": 0.05}], "radialSegments": 28, "capEnds": true, "fixedFrame": "horizontal"}, "normalStrategy": "Smooth horizontal shoe contours; separate outsole", "sourceNotes": "Broad reference toe and dark high-top sneakers, independent shoe module"}, "parent": "root", "attachment": null, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.78}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "shoe-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "shoes", "materialLayers": ["shoes"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(39, 41, 50, 1)", "secondaryAlbedo": "rgba(39, 41, 50, 1)", "materialClass": "plastic", "materialClassConfidence": 0.8, "evidenceRefs": ["full-object"]}};
  node_shoe_l_4.add(mesh_shoe_l_4);
  meshes["shoe-l"] = mesh_shoe_l_4;
  colliders["shoe-l"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["shoe-l"] ??= [];
  destructionGroups["shoe-l"].push(node_shoe_l_4);

  const endpoint_sole_l_5 = makeAttachmentEndpoint(null);
  const node_sole_l_5 = new THREE.Group();
  node_sole_l_5.name = "sole-l__pivot";
  node_sole_l_5.scale.set(1, 1, 1);
  if (endpoint_sole_l_5) {
    node_sole_l_5.position.copy(endpoint_sole_l_5.start);
    node_sole_l_5.rotation.set(1.5707963267948966, 0.0, 0.0);
  } else {
    node_sole_l_5.position.set(0.115, 0.026, 0.035);
    node_sole_l_5.rotation.set(1.5707963267948966, 0.0, 0.0);
  }
  node_sole_l_5.userData.sculptComponent = {"id": "sole-l", "name": "sole-l", "level": "micro", "role": "body", "importance": 1.0, "confidence": 0.78, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Contour follows the reference silhouette; depth is inferred and tested in orbit.", "geometryDescriptor": {"profile2D": {"points": [[0.42769999999999997, 0.0], [0.41805772288557197, 0.10232070351484124], [0.405118990788356, 0.1732426103684521], [0.38764313024846664, 0.23404723308381586], [0.36561897893722106, 0.28749781270113345], [0.33914098771003437, 0.33449234126967875], [0.30830758094922195, 0.3753317575473136], [0.2731685825266422, 0.41007447486767296], [0.2336630366055767, 0.4386748333756851], [0.1895037006540926, 0.46104821625249315], [0.13989014717124748, 0.4771054426630118], [0.08248650863723848, 0.4867721764671055], [1.3329809914788902e-13, 0.49], [-0.08248650863723843, 0.4867721764671055], [-0.13989014717124743, 0.4771054426630118], [-0.18950370065409247, 0.4610482162524932], [-0.23366303660557658, 0.43867483337568514], [-0.2731685825266422, 0.41007447486767296], [-0.3083075809492219, 0.3753317575473136], [-0.3391409877100343, 0.3344923412696788], [-0.36561897893722106, 0.28749781270113345], [-0.38764313024846664, 0.23404723308381592], [-0.40511899078835595, 0.17324261036845223], [-0.41805772288557197, 0.10232070351484147], [-0.42769999999998104, 2.819709889450938e-13], [-0.43170741946128943, -0.10232070351484136], [-0.42777079626050174, -0.17324261036845212], [-0.41721532726660004, -0.2340472330838158], [-0.40018194447004646, -0.28749781270113334], [-0.37673188127324614, -0.33449234126967875], [-0.34691443008337425, -0.3753317575473134], [-0.3107594760898541, -0.41007447486767284], [-0.26822600213840225, -0.4386748333756851], [-0.2190758976722258, -0.4610482162524932], [-0.16254195264339313, -0.4771054426630118], [-0.09613620521295588, -0.4867721764671055], [-3.6206545950956876e-13, -0.49], [0.09613620521295567, -0.4867721764671056], [0.162541952643393, -0.4771054426630118], [0.21907589767222568, -0.46104821625249326], [0.2682260021384021, -0.4386748333756851], [0.31075947608985377, -0.4100744748676732], [0.3469144300833741, -0.3753317575473136], [0.3767318812732461, -0.33449234126967886], [0.40018194447004635, -0.28749781270113367], [0.41721532726660004, -0.23404723308381575], [0.42777079626050174, -0.17324261036845254], [0.43170741946128943, -0.10232070351484131]], "depth": 1, "bevelEnabled": true, "bevelSize": 0.018, "bevelThickness": 0.06, "bevelSegments": 2}}, "parent": "root", "attachment": null, "dimensions": {"width": 0.145, "height": 0.25, "depth": 0.014, "units": "meters", "confidence": 0.78}, "transform": {"position": [0.115, 0.026, 0.035], "rotation": [1.5707963267948966, 0, 0], "scale": [0.145, 0.248, 0.013]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "sole-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "sole", "materialLayers": ["sole"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "shoe-sole", "kind": "contour", "description": "shoe-sole", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(23, 26, 34, 1)", "secondaryAlbedo": "rgba(23, 26, 34, 1)", "materialClass": "plastic", "materialClassConfidence": 0.8, "evidenceRefs": ["full-object"]}};
  node_sole_l_5.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "sole-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["root"] ?? root).add(node_sole_l_5);
  nodes["sole-l"] = node_sole_l_5;
  const mesh_sole_l_5Geometry = endpoint_sole_l_5
    ? new THREE.CylinderGeometry(endpoint_sole_l_5.endRadius, endpoint_sole_l_5.baseRadius, endpoint_sole_l_5.length, 16, 6)
    : buildExtrudeGeometry({"points": [[0.42769999999999997, 0.0], [0.41805772288557197, 0.10232070351484124], [0.405118990788356, 0.1732426103684521], [0.38764313024846664, 0.23404723308381586], [0.36561897893722106, 0.28749781270113345], [0.33914098771003437, 0.33449234126967875], [0.30830758094922195, 0.3753317575473136], [0.2731685825266422, 0.41007447486767296], [0.2336630366055767, 0.4386748333756851], [0.1895037006540926, 0.46104821625249315], [0.13989014717124748, 0.4771054426630118], [0.08248650863723848, 0.4867721764671055], [1.3329809914788902e-13, 0.49], [-0.08248650863723843, 0.4867721764671055], [-0.13989014717124743, 0.4771054426630118], [-0.18950370065409247, 0.4610482162524932], [-0.23366303660557658, 0.43867483337568514], [-0.2731685825266422, 0.41007447486767296], [-0.3083075809492219, 0.3753317575473136], [-0.3391409877100343, 0.3344923412696788], [-0.36561897893722106, 0.28749781270113345], [-0.38764313024846664, 0.23404723308381592], [-0.40511899078835595, 0.17324261036845223], [-0.41805772288557197, 0.10232070351484147], [-0.42769999999998104, 2.819709889450938e-13], [-0.43170741946128943, -0.10232070351484136], [-0.42777079626050174, -0.17324261036845212], [-0.41721532726660004, -0.2340472330838158], [-0.40018194447004646, -0.28749781270113334], [-0.37673188127324614, -0.33449234126967875], [-0.34691443008337425, -0.3753317575473134], [-0.3107594760898541, -0.41007447486767284], [-0.26822600213840225, -0.4386748333756851], [-0.2190758976722258, -0.4610482162524932], [-0.16254195264339313, -0.4771054426630118], [-0.09613620521295588, -0.4867721764671055], [-3.6206545950956876e-13, -0.49], [0.09613620521295567, -0.4867721764671056], [0.162541952643393, -0.4771054426630118], [0.21907589767222568, -0.46104821625249326], [0.2682260021384021, -0.4386748333756851], [0.31075947608985377, -0.4100744748676732], [0.3469144300833741, -0.3753317575473136], [0.3767318812732461, -0.33449234126967886], [0.40018194447004635, -0.28749781270113367], [0.41721532726660004, -0.23404723308381575], [0.42777079626050174, -0.17324261036845254], [0.43170741946128943, -0.10232070351484131]], "depth": 1, "bevelEnabled": true, "bevelSize": 0.018, "bevelThickness": 0.06, "bevelSegments": 2});
  if (!endpoint_sole_l_5) {
    mesh_sole_l_5Geometry.scale(0.145, 0.248, 0.013);
  }
  const mesh_sole_l_5 = new THREE.Mesh(
    mesh_sole_l_5Geometry,
    materialMap["sole"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_sole_l_5.name = "sole-l";
  if (endpoint_sole_l_5) {
    mesh_sole_l_5.position.copy(endpoint_sole_l_5.midpoint);
    mesh_sole_l_5.quaternion.copy(endpoint_sole_l_5.quaternion);
  }
  mesh_sole_l_5.castShadow = options.castShadow ?? true;
  mesh_sole_l_5.receiveShadow = options.receiveShadow ?? true;
  mesh_sole_l_5.userData.sculptComponent = {"id": "sole-l", "name": "sole-l", "level": "micro", "role": "body", "importance": 1.0, "confidence": 0.78, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Contour follows the reference silhouette; depth is inferred and tested in orbit.", "geometryDescriptor": {"profile2D": {"points": [[0.42769999999999997, 0.0], [0.41805772288557197, 0.10232070351484124], [0.405118990788356, 0.1732426103684521], [0.38764313024846664, 0.23404723308381586], [0.36561897893722106, 0.28749781270113345], [0.33914098771003437, 0.33449234126967875], [0.30830758094922195, 0.3753317575473136], [0.2731685825266422, 0.41007447486767296], [0.2336630366055767, 0.4386748333756851], [0.1895037006540926, 0.46104821625249315], [0.13989014717124748, 0.4771054426630118], [0.08248650863723848, 0.4867721764671055], [1.3329809914788902e-13, 0.49], [-0.08248650863723843, 0.4867721764671055], [-0.13989014717124743, 0.4771054426630118], [-0.18950370065409247, 0.4610482162524932], [-0.23366303660557658, 0.43867483337568514], [-0.2731685825266422, 0.41007447486767296], [-0.3083075809492219, 0.3753317575473136], [-0.3391409877100343, 0.3344923412696788], [-0.36561897893722106, 0.28749781270113345], [-0.38764313024846664, 0.23404723308381592], [-0.40511899078835595, 0.17324261036845223], [-0.41805772288557197, 0.10232070351484147], [-0.42769999999998104, 2.819709889450938e-13], [-0.43170741946128943, -0.10232070351484136], [-0.42777079626050174, -0.17324261036845212], [-0.41721532726660004, -0.2340472330838158], [-0.40018194447004646, -0.28749781270113334], [-0.37673188127324614, -0.33449234126967875], [-0.34691443008337425, -0.3753317575473134], [-0.3107594760898541, -0.41007447486767284], [-0.26822600213840225, -0.4386748333756851], [-0.2190758976722258, -0.4610482162524932], [-0.16254195264339313, -0.4771054426630118], [-0.09613620521295588, -0.4867721764671055], [-3.6206545950956876e-13, -0.49], [0.09613620521295567, -0.4867721764671056], [0.162541952643393, -0.4771054426630118], [0.21907589767222568, -0.46104821625249326], [0.2682260021384021, -0.4386748333756851], [0.31075947608985377, -0.4100744748676732], [0.3469144300833741, -0.3753317575473136], [0.3767318812732461, -0.33449234126967886], [0.40018194447004635, -0.28749781270113367], [0.41721532726660004, -0.23404723308381575], [0.42777079626050174, -0.17324261036845254], [0.43170741946128943, -0.10232070351484131]], "depth": 1, "bevelEnabled": true, "bevelSize": 0.018, "bevelThickness": 0.06, "bevelSegments": 2}}, "parent": "root", "attachment": null, "dimensions": {"width": 0.145, "height": 0.25, "depth": 0.014, "units": "meters", "confidence": 0.78}, "transform": {"position": [0.115, 0.026, 0.035], "rotation": [1.5707963267948966, 0, 0], "scale": [0.145, 0.248, 0.013]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "sole-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "sole", "materialLayers": ["sole"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "shoe-sole", "kind": "contour", "description": "shoe-sole", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(23, 26, 34, 1)", "secondaryAlbedo": "rgba(23, 26, 34, 1)", "materialClass": "plastic", "materialClassConfidence": 0.8, "evidenceRefs": ["full-object"]}};
  node_sole_l_5.add(mesh_sole_l_5);
  meshes["sole-l"] = mesh_sole_l_5;
  colliders["sole-l"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["sole-l"] ??= [];
  destructionGroups["sole-l"].push(node_sole_l_5);

  const attachment_lace_l_0_6 = {"parentSocket": "shoe-l", "localStart": [0.07500000000000001, 0.093, 0.11], "localEnd": [0.155, 0.093, 0.09], "contactType": "surface-embed", "embedDepth": 0.002, "gapTolerance": 0.003};
  const endpoint_lace_l_0_6 = null; // authored tubePath already in model coordinates
  const node_lace_l_0_6 = new THREE.Group();
  node_lace_l_0_6.name = "lace-l-0__pivot";
  node_lace_l_0_6.scale.set(1, 1, 1);
  if (endpoint_lace_l_0_6) {
    node_lace_l_0_6.position.copy(endpoint_lace_l_0_6.start);
    node_lace_l_0_6.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_lace_l_0_6.position.set(0.0, 0.0, 0.0);
    node_lace_l_0_6.rotation.set(0.0, 0.0, 0.0);
  }
  node_lace_l_0_6.userData.sculptComponent = {"id": "lace-l-0", "name": "lace-l-0", "level": "micro", "role": "body", "importance": 1.0, "confidence": 0.78, "primitive": "tube", "topologyClass": "assembled-solid", "topologyRationale": "Contour follows the reference silhouette; depth is inferred and tested in orbit.", "geometryDescriptor": {"tubePath": {"points": [[0.07800000000000001, 0.082, 0.098], [0.152, 0.082, 0.09]], "radius": 0.0025, "closed": false}, "attachmentGeometry": "authored-path"}, "parent": "root", "attachment": {"parentSocket": "shoe-l", "localStart": [0.07500000000000001, 0.093, 0.11], "localEnd": [0.155, 0.093, 0.09], "contactType": "surface-embed", "embedDepth": 0.002, "gapTolerance": 0.003}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.78}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lace-l-0", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "sole", "materialLayers": ["sole"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "lace-row", "kind": "linework", "description": "lace-row", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(23, 26, 34, 1)", "secondaryAlbedo": "rgba(23, 26, 34, 1)", "materialClass": "plastic", "materialClassConfidence": 0.8, "evidenceRefs": ["full-object"]}};
  node_lace_l_0_6.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lace-l-0", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["root"] ?? root).add(node_lace_l_0_6);
  nodes["lace-l-0"] = node_lace_l_0_6;
  const mesh_lace_l_0_6Geometry = endpoint_lace_l_0_6
    ? new THREE.CylinderGeometry(endpoint_lace_l_0_6.endRadius, endpoint_lace_l_0_6.baseRadius, endpoint_lace_l_0_6.length, 16, 6)
    : buildTubeGeometry({"points": [[0.07800000000000001, 0.082, 0.098], [0.152, 0.082, 0.09]], "radius": 0.0025, "closed": false});
  if (!endpoint_lace_l_0_6) {
    mesh_lace_l_0_6Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_lace_l_0_6 = new THREE.Mesh(
    mesh_lace_l_0_6Geometry,
    materialMap["sole"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_lace_l_0_6.name = "lace-l-0";
  if (endpoint_lace_l_0_6) {
    mesh_lace_l_0_6.position.copy(endpoint_lace_l_0_6.midpoint);
    mesh_lace_l_0_6.quaternion.copy(endpoint_lace_l_0_6.quaternion);
  }
  mesh_lace_l_0_6.castShadow = options.castShadow ?? true;
  mesh_lace_l_0_6.receiveShadow = options.receiveShadow ?? true;
  mesh_lace_l_0_6.userData.sculptComponent = {"id": "lace-l-0", "name": "lace-l-0", "level": "micro", "role": "body", "importance": 1.0, "confidence": 0.78, "primitive": "tube", "topologyClass": "assembled-solid", "topologyRationale": "Contour follows the reference silhouette; depth is inferred and tested in orbit.", "geometryDescriptor": {"tubePath": {"points": [[0.07800000000000001, 0.082, 0.098], [0.152, 0.082, 0.09]], "radius": 0.0025, "closed": false}, "attachmentGeometry": "authored-path"}, "parent": "root", "attachment": {"parentSocket": "shoe-l", "localStart": [0.07500000000000001, 0.093, 0.11], "localEnd": [0.155, 0.093, 0.09], "contactType": "surface-embed", "embedDepth": 0.002, "gapTolerance": 0.003}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.78}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lace-l-0", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "sole", "materialLayers": ["sole"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "lace-row", "kind": "linework", "description": "lace-row", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(23, 26, 34, 1)", "secondaryAlbedo": "rgba(23, 26, 34, 1)", "materialClass": "plastic", "materialClassConfidence": 0.8, "evidenceRefs": ["full-object"]}};
  node_lace_l_0_6.add(mesh_lace_l_0_6);
  meshes["lace-l-0"] = mesh_lace_l_0_6;
  colliders["lace-l-0"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["lace-l-0"] ??= [];
  destructionGroups["lace-l-0"].push(node_lace_l_0_6);

  const attachment_lace_l_1_7 = {"parentSocket": "shoe-l", "localStart": [0.07500000000000001, 0.102, 0.086], "localEnd": [0.155, 0.102, 0.066], "contactType": "surface-embed", "embedDepth": 0.002, "gapTolerance": 0.003};
  const endpoint_lace_l_1_7 = null; // authored tubePath already in model coordinates
  const node_lace_l_1_7 = new THREE.Group();
  node_lace_l_1_7.name = "lace-l-1__pivot";
  node_lace_l_1_7.scale.set(1, 1, 1);
  if (endpoint_lace_l_1_7) {
    node_lace_l_1_7.position.copy(endpoint_lace_l_1_7.start);
    node_lace_l_1_7.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_lace_l_1_7.position.set(0.0, 0.0, 0.0);
    node_lace_l_1_7.rotation.set(0.0, 0.0, 0.0);
  }
  node_lace_l_1_7.userData.sculptComponent = {"id": "lace-l-1", "name": "lace-l-1", "level": "micro", "role": "body", "importance": 1.0, "confidence": 0.78, "primitive": "tube", "topologyClass": "assembled-solid", "topologyRationale": "Contour follows the reference silhouette; depth is inferred and tested in orbit.", "geometryDescriptor": {"tubePath": {"points": [[0.07800000000000001, 0.101, 0.077], [0.152, 0.101, 0.069]], "radius": 0.0025, "closed": false}, "attachmentGeometry": "authored-path"}, "parent": "root", "attachment": {"parentSocket": "shoe-l", "localStart": [0.07500000000000001, 0.102, 0.086], "localEnd": [0.155, 0.102, 0.066], "contactType": "surface-embed", "embedDepth": 0.002, "gapTolerance": 0.003}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.78}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lace-l-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "sole", "materialLayers": ["sole"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(23, 26, 34, 1)", "secondaryAlbedo": "rgba(23, 26, 34, 1)", "materialClass": "plastic", "materialClassConfidence": 0.8, "evidenceRefs": ["full-object"]}};
  node_lace_l_1_7.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lace-l-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["root"] ?? root).add(node_lace_l_1_7);
  nodes["lace-l-1"] = node_lace_l_1_7;
  const mesh_lace_l_1_7Geometry = endpoint_lace_l_1_7
    ? new THREE.CylinderGeometry(endpoint_lace_l_1_7.endRadius, endpoint_lace_l_1_7.baseRadius, endpoint_lace_l_1_7.length, 16, 6)
    : buildTubeGeometry({"points": [[0.07800000000000001, 0.101, 0.077], [0.152, 0.101, 0.069]], "radius": 0.0025, "closed": false});
  if (!endpoint_lace_l_1_7) {
    mesh_lace_l_1_7Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_lace_l_1_7 = new THREE.Mesh(
    mesh_lace_l_1_7Geometry,
    materialMap["sole"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_lace_l_1_7.name = "lace-l-1";
  if (endpoint_lace_l_1_7) {
    mesh_lace_l_1_7.position.copy(endpoint_lace_l_1_7.midpoint);
    mesh_lace_l_1_7.quaternion.copy(endpoint_lace_l_1_7.quaternion);
  }
  mesh_lace_l_1_7.castShadow = options.castShadow ?? true;
  mesh_lace_l_1_7.receiveShadow = options.receiveShadow ?? true;
  mesh_lace_l_1_7.userData.sculptComponent = {"id": "lace-l-1", "name": "lace-l-1", "level": "micro", "role": "body", "importance": 1.0, "confidence": 0.78, "primitive": "tube", "topologyClass": "assembled-solid", "topologyRationale": "Contour follows the reference silhouette; depth is inferred and tested in orbit.", "geometryDescriptor": {"tubePath": {"points": [[0.07800000000000001, 0.101, 0.077], [0.152, 0.101, 0.069]], "radius": 0.0025, "closed": false}, "attachmentGeometry": "authored-path"}, "parent": "root", "attachment": {"parentSocket": "shoe-l", "localStart": [0.07500000000000001, 0.102, 0.086], "localEnd": [0.155, 0.102, 0.066], "contactType": "surface-embed", "embedDepth": 0.002, "gapTolerance": 0.003}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.78}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lace-l-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "sole", "materialLayers": ["sole"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(23, 26, 34, 1)", "secondaryAlbedo": "rgba(23, 26, 34, 1)", "materialClass": "plastic", "materialClassConfidence": 0.8, "evidenceRefs": ["full-object"]}};
  node_lace_l_1_7.add(mesh_lace_l_1_7);
  meshes["lace-l-1"] = mesh_lace_l_1_7;
  colliders["lace-l-1"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["lace-l-1"] ??= [];
  destructionGroups["lace-l-1"].push(node_lace_l_1_7);

  const attachment_lace_l_2_8 = {"parentSocket": "shoe-l", "localStart": [0.07500000000000001, 0.111, 0.062], "localEnd": [0.155, 0.111, 0.041999999999999996], "contactType": "surface-embed", "embedDepth": 0.002, "gapTolerance": 0.003};
  const endpoint_lace_l_2_8 = null; // authored tubePath already in model coordinates
  const node_lace_l_2_8 = new THREE.Group();
  node_lace_l_2_8.name = "lace-l-2__pivot";
  node_lace_l_2_8.scale.set(1, 1, 1);
  if (endpoint_lace_l_2_8) {
    node_lace_l_2_8.position.copy(endpoint_lace_l_2_8.start);
    node_lace_l_2_8.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_lace_l_2_8.position.set(0.0, 0.0, 0.0);
    node_lace_l_2_8.rotation.set(0.0, 0.0, 0.0);
  }
  node_lace_l_2_8.userData.sculptComponent = {"id": "lace-l-2", "name": "lace-l-2", "level": "micro", "role": "body", "importance": 1.0, "confidence": 0.78, "primitive": "tube", "topologyClass": "assembled-solid", "topologyRationale": "Contour follows the reference silhouette; depth is inferred and tested in orbit.", "geometryDescriptor": {"tubePath": {"points": [[0.07800000000000001, 0.12, 0.056], [0.152, 0.12, 0.048]], "radius": 0.0025, "closed": false}, "attachmentGeometry": "authored-path"}, "parent": "root", "attachment": {"parentSocket": "shoe-l", "localStart": [0.07500000000000001, 0.111, 0.062], "localEnd": [0.155, 0.111, 0.041999999999999996], "contactType": "surface-embed", "embedDepth": 0.002, "gapTolerance": 0.003}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.78}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lace-l-2", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "sole", "materialLayers": ["sole"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(23, 26, 34, 1)", "secondaryAlbedo": "rgba(23, 26, 34, 1)", "materialClass": "plastic", "materialClassConfidence": 0.8, "evidenceRefs": ["full-object"]}};
  node_lace_l_2_8.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lace-l-2", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["root"] ?? root).add(node_lace_l_2_8);
  nodes["lace-l-2"] = node_lace_l_2_8;
  const mesh_lace_l_2_8Geometry = endpoint_lace_l_2_8
    ? new THREE.CylinderGeometry(endpoint_lace_l_2_8.endRadius, endpoint_lace_l_2_8.baseRadius, endpoint_lace_l_2_8.length, 16, 6)
    : buildTubeGeometry({"points": [[0.07800000000000001, 0.12, 0.056], [0.152, 0.12, 0.048]], "radius": 0.0025, "closed": false});
  if (!endpoint_lace_l_2_8) {
    mesh_lace_l_2_8Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_lace_l_2_8 = new THREE.Mesh(
    mesh_lace_l_2_8Geometry,
    materialMap["sole"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_lace_l_2_8.name = "lace-l-2";
  if (endpoint_lace_l_2_8) {
    mesh_lace_l_2_8.position.copy(endpoint_lace_l_2_8.midpoint);
    mesh_lace_l_2_8.quaternion.copy(endpoint_lace_l_2_8.quaternion);
  }
  mesh_lace_l_2_8.castShadow = options.castShadow ?? true;
  mesh_lace_l_2_8.receiveShadow = options.receiveShadow ?? true;
  mesh_lace_l_2_8.userData.sculptComponent = {"id": "lace-l-2", "name": "lace-l-2", "level": "micro", "role": "body", "importance": 1.0, "confidence": 0.78, "primitive": "tube", "topologyClass": "assembled-solid", "topologyRationale": "Contour follows the reference silhouette; depth is inferred and tested in orbit.", "geometryDescriptor": {"tubePath": {"points": [[0.07800000000000001, 0.12, 0.056], [0.152, 0.12, 0.048]], "radius": 0.0025, "closed": false}, "attachmentGeometry": "authored-path"}, "parent": "root", "attachment": {"parentSocket": "shoe-l", "localStart": [0.07500000000000001, 0.111, 0.062], "localEnd": [0.155, 0.111, 0.041999999999999996], "contactType": "surface-embed", "embedDepth": 0.002, "gapTolerance": 0.003}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.78}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lace-l-2", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "sole", "materialLayers": ["sole"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(23, 26, 34, 1)", "secondaryAlbedo": "rgba(23, 26, 34, 1)", "materialClass": "plastic", "materialClassConfidence": 0.8, "evidenceRefs": ["full-object"]}};
  node_lace_l_2_8.add(mesh_lace_l_2_8);
  meshes["lace-l-2"] = mesh_lace_l_2_8;
  colliders["lace-l-2"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["lace-l-2"] ??= [];
  destructionGroups["lace-l-2"].push(node_lace_l_2_8);

  const attachment_lace_l_3_9 = {"parentSocket": "shoe-l", "localStart": [0.07500000000000001, 0.12, 0.03799999999999999], "localEnd": [0.155, 0.12, 0.017999999999999988], "contactType": "surface-embed", "embedDepth": 0.002, "gapTolerance": 0.003};
  const endpoint_lace_l_3_9 = null; // authored tubePath already in model coordinates
  const node_lace_l_3_9 = new THREE.Group();
  node_lace_l_3_9.name = "lace-l-3__pivot";
  node_lace_l_3_9.scale.set(1, 1, 1);
  if (endpoint_lace_l_3_9) {
    node_lace_l_3_9.position.copy(endpoint_lace_l_3_9.start);
    node_lace_l_3_9.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_lace_l_3_9.position.set(0.0, 0.0, 0.0);
    node_lace_l_3_9.rotation.set(0.0, 0.0, 0.0);
  }
  node_lace_l_3_9.userData.sculptComponent = {"id": "lace-l-3", "name": "lace-l-3", "level": "micro", "role": "body", "importance": 1.0, "confidence": 0.78, "primitive": "tube", "topologyClass": "assembled-solid", "topologyRationale": "Contour follows the reference silhouette; depth is inferred and tested in orbit.", "geometryDescriptor": {"tubePath": {"points": [[0.07800000000000001, 0.139, 0.035], [0.152, 0.139, 0.027000000000000003]], "radius": 0.0025, "closed": false}, "attachmentGeometry": "authored-path"}, "parent": "root", "attachment": {"parentSocket": "shoe-l", "localStart": [0.07500000000000001, 0.12, 0.03799999999999999], "localEnd": [0.155, 0.12, 0.017999999999999988], "contactType": "surface-embed", "embedDepth": 0.002, "gapTolerance": 0.003}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.78}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lace-l-3", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "sole", "materialLayers": ["sole"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(23, 26, 34, 1)", "secondaryAlbedo": "rgba(23, 26, 34, 1)", "materialClass": "plastic", "materialClassConfidence": 0.8, "evidenceRefs": ["full-object"]}};
  node_lace_l_3_9.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lace-l-3", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["root"] ?? root).add(node_lace_l_3_9);
  nodes["lace-l-3"] = node_lace_l_3_9;
  const mesh_lace_l_3_9Geometry = endpoint_lace_l_3_9
    ? new THREE.CylinderGeometry(endpoint_lace_l_3_9.endRadius, endpoint_lace_l_3_9.baseRadius, endpoint_lace_l_3_9.length, 16, 6)
    : buildTubeGeometry({"points": [[0.07800000000000001, 0.139, 0.035], [0.152, 0.139, 0.027000000000000003]], "radius": 0.0025, "closed": false});
  if (!endpoint_lace_l_3_9) {
    mesh_lace_l_3_9Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_lace_l_3_9 = new THREE.Mesh(
    mesh_lace_l_3_9Geometry,
    materialMap["sole"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_lace_l_3_9.name = "lace-l-3";
  if (endpoint_lace_l_3_9) {
    mesh_lace_l_3_9.position.copy(endpoint_lace_l_3_9.midpoint);
    mesh_lace_l_3_9.quaternion.copy(endpoint_lace_l_3_9.quaternion);
  }
  mesh_lace_l_3_9.castShadow = options.castShadow ?? true;
  mesh_lace_l_3_9.receiveShadow = options.receiveShadow ?? true;
  mesh_lace_l_3_9.userData.sculptComponent = {"id": "lace-l-3", "name": "lace-l-3", "level": "micro", "role": "body", "importance": 1.0, "confidence": 0.78, "primitive": "tube", "topologyClass": "assembled-solid", "topologyRationale": "Contour follows the reference silhouette; depth is inferred and tested in orbit.", "geometryDescriptor": {"tubePath": {"points": [[0.07800000000000001, 0.139, 0.035], [0.152, 0.139, 0.027000000000000003]], "radius": 0.0025, "closed": false}, "attachmentGeometry": "authored-path"}, "parent": "root", "attachment": {"parentSocket": "shoe-l", "localStart": [0.07500000000000001, 0.12, 0.03799999999999999], "localEnd": [0.155, 0.12, 0.017999999999999988], "contactType": "surface-embed", "embedDepth": 0.002, "gapTolerance": 0.003}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.78}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lace-l-3", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "sole", "materialLayers": ["sole"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(23, 26, 34, 1)", "secondaryAlbedo": "rgba(23, 26, 34, 1)", "materialClass": "plastic", "materialClassConfidence": 0.8, "evidenceRefs": ["full-object"]}};
  node_lace_l_3_9.add(mesh_lace_l_3_9);
  meshes["lace-l-3"] = mesh_lace_l_3_9;
  colliders["lace-l-3"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["lace-l-3"] ??= [];
  destructionGroups["lace-l-3"].push(node_lace_l_3_9);

  const endpoint_arm_r_10 = makeAttachmentEndpoint(null);
  const node_arm_r_10 = new THREE.Group();
  node_arm_r_10.name = "arm-r__pivot";
  node_arm_r_10.scale.set(1, 1, 1);
  if (endpoint_arm_r_10) {
    node_arm_r_10.position.copy(endpoint_arm_r_10.start);
    node_arm_r_10.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_arm_r_10.position.set(0.0, 0.0, 0.0);
    node_arm_r_10.rotation.set(0.0, 0.0, 0.0);
  }
  node_arm_r_10.userData.sculptComponent = {"id": "arm-r", "name": "arm-r", "level": "macro", "role": "body", "importance": 1.0, "confidence": 0.78, "primitive": "tapered-sweep", "topologyClass": "continuous-sculpt", "topologyRationale": "Contour follows the reference silhouette; depth is inferred and tested in orbit.", "geometryDescriptor": {"taperedSweep": {"stations": [{"position": [-0.321, 0.88, 0.003], "rx": 0.029, "rz": 0.032, "twist": 0}, {"position": [-0.321, 0.95, 0], "rx": 0.035, "rz": 0.038, "twist": 0}, {"position": [-0.317, 1.045, 0], "rx": 0.048, "rz": 0.055, "twist": 0}, {"position": [-0.31, 1.105, 0], "rx": 0.043, "rz": 0.048, "twist": 0}, {"position": [-0.295, 1.17, 0], "rx": 0.05, "rz": 0.055, "twist": 0}, {"position": [-0.276, 1.245, 0], "rx": 0.06, "rz": 0.064, "twist": 0}, {"position": [-0.258, 1.31, 0], "rx": 0.062, "rz": 0.062, "twist": 0}], "radialSegments": 24, "capEnds": true}, "normalStrategy": "smooth vertex normals", "connectedHand": {"lofts": [[[0.84, -0.324, 0.005, 0.034, 0.028], [0.88, -0.321, 0.003, 0.032, 0.029], [0.95, -0.321, 0, 0.038, 0.035], [1.045, -0.317, 0, 0.055, 0.048], [1.105, -0.31, 0, 0.048, 0.043], [1.17, -0.295, 0, 0.055, 0.05], [1.245, -0.276, 0, 0.064, 0.06], [1.31, -0.258, 0, 0.062, 0.062]]], "volumes": [{"id": "palm", "type": "ellipsoid", "center": [-0.325, 0.842, 0.005], "radii": [0.044079999999999994, 0.061560000000000004, 0.028319999999999998]}, {"id": "finger0", "type": "ellipsoid", "center": [-0.29524, 0.7944800000000001, 0.01], "radii": [0.010439999999999998, 0.03672, 0.012979999999999998]}, {"id": "finger1", "type": "ellipsoid", "center": [-0.31508, 0.788, 0.01], "radii": [0.010439999999999998, 0.04104, 0.012979999999999998]}, {"id": "finger2", "type": "ellipsoid", "center": [-0.33491999999999994, 0.7944800000000001, 0.01], "radii": [0.010439999999999998, 0.03672, 0.012979999999999998]}, {"id": "finger3", "type": "ellipsoid", "center": [-0.35475999999999996, 0.80096, 0.01], "radii": [0.010439999999999998, 0.0324, 0.012979999999999998]}, {"id": "thumb-base", "type": "ellipsoid", "center": [-0.296, 0.85, 0.012], "radii": [0.015, 0.026, 0.015]}, {"id": "thumb-tip", "type": "ellipsoid", "center": [-0.286, 0.83, 0.022], "radii": [0.012, 0.02, 0.013]}], "blendRadius": 0.004, "resolution": 60, "bounds": {"min": [-0.43, 0.72, -0.085], "max": [-0.2, 1.34, 0.085]}, "purpose": "One continuous wrist surface; hand enlarged from reference-approved draft"}}, "parent": "root", "attachment": {"parentSocket": "shirt-sleeve", "localStart": [-0.258, 1.31, 0], "localEnd": [-0.321, 0.88, 0.003], "contactType": "overlap", "embedDepth": 0.025, "gapTolerance": 0.003}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.78}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "arm-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "skin", "materialLayers": ["skin"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "angular-tattoo", "kind": "linework", "description": "matte dark tribal chevron and curved bands over forearm", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(213, 154, 115, 1)", "secondaryAlbedo": "rgba(213, 154, 115, 1)", "materialClass": "skin", "materialClassConfidence": 0.8, "evidenceRefs": ["full-object"]}};
  node_arm_r_10.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "arm-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["root"] ?? root).add(node_arm_r_10);
  nodes["arm-r"] = node_arm_r_10;
  const mesh_arm_r_10Geometry = polygonizeSdf({"primitives":[],"authoredLofts":[[[0.84,-0.324,0.005,0.034,0.028],[0.88,-0.321,0.003,0.032,0.029],[0.95,-0.321,0,0.038,0.035],[1.045,-0.317,0,0.055,0.048],[1.105,-0.31,0,0.048,0.043],[1.17,-0.295,0,0.055,0.05],[1.245,-0.276,0,0.064,0.06],[1.31,-0.258,0,0.062,0.062]]],"authoredVolumes":[{"id":"palm","type":"ellipsoid","center":[-0.325,0.842,0.005],"radii":[0.044079999999999994,0.061560000000000004,0.028319999999999998]},{"id":"finger0","type":"ellipsoid","center":[-0.29524,0.7944800000000001,0.01],"radii":[0.010439999999999998,0.03672,0.012979999999999998]},{"id":"finger1","type":"ellipsoid","center":[-0.31508,0.788,0.01],"radii":[0.010439999999999998,0.04104,0.012979999999999998]},{"id":"finger2","type":"ellipsoid","center":[-0.33491999999999994,0.7944800000000001,0.01],"radii":[0.010439999999999998,0.03672,0.012979999999999998]},{"id":"finger3","type":"ellipsoid","center":[-0.35475999999999996,0.80096,0.01],"radii":[0.010439999999999998,0.0324,0.012979999999999998]},{"id":"thumb-base","type":"ellipsoid","center":[-0.296,0.85,0.012],"radii":[0.015,0.026,0.015]},{"id":"thumb-tip","type":"ellipsoid","center":[-0.286,0.83,0.022],"radii":[0.012,0.02,0.013]}],"blendRadius":0.004,"resolution":60,"bounds":{"min":[-0.43,0.72,-0.085],"max":[-0.2,1.34,0.085]}});
  if (!endpoint_arm_r_10) {
    mesh_arm_r_10Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_arm_r_10 = new THREE.Mesh(
    mesh_arm_r_10Geometry,
    materialMap["skin"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_arm_r_10.name = "arm-r";
  if (endpoint_arm_r_10) {
    mesh_arm_r_10.position.copy(endpoint_arm_r_10.midpoint);
    mesh_arm_r_10.quaternion.copy(endpoint_arm_r_10.quaternion);
  }
  mesh_arm_r_10.castShadow = options.castShadow ?? true;
  mesh_arm_r_10.receiveShadow = options.receiveShadow ?? true;
  mesh_arm_r_10.userData.sculptComponent = {"id": "arm-r", "name": "arm-r", "level": "macro", "role": "body", "importance": 1.0, "confidence": 0.78, "primitive": "tapered-sweep", "topologyClass": "continuous-sculpt", "topologyRationale": "Contour follows the reference silhouette; depth is inferred and tested in orbit.", "geometryDescriptor": {"taperedSweep": {"stations": [{"position": [-0.321, 0.88, 0.003], "rx": 0.029, "rz": 0.032, "twist": 0}, {"position": [-0.321, 0.95, 0], "rx": 0.035, "rz": 0.038, "twist": 0}, {"position": [-0.317, 1.045, 0], "rx": 0.048, "rz": 0.055, "twist": 0}, {"position": [-0.31, 1.105, 0], "rx": 0.043, "rz": 0.048, "twist": 0}, {"position": [-0.295, 1.17, 0], "rx": 0.05, "rz": 0.055, "twist": 0}, {"position": [-0.276, 1.245, 0], "rx": 0.06, "rz": 0.064, "twist": 0}, {"position": [-0.258, 1.31, 0], "rx": 0.062, "rz": 0.062, "twist": 0}], "radialSegments": 24, "capEnds": true}, "normalStrategy": "smooth vertex normals", "connectedHand": {"lofts": [[[0.84, -0.324, 0.005, 0.034, 0.028], [0.88, -0.321, 0.003, 0.032, 0.029], [0.95, -0.321, 0, 0.038, 0.035], [1.045, -0.317, 0, 0.055, 0.048], [1.105, -0.31, 0, 0.048, 0.043], [1.17, -0.295, 0, 0.055, 0.05], [1.245, -0.276, 0, 0.064, 0.06], [1.31, -0.258, 0, 0.062, 0.062]]], "volumes": [{"id": "palm", "type": "ellipsoid", "center": [-0.325, 0.842, 0.005], "radii": [0.044079999999999994, 0.061560000000000004, 0.028319999999999998]}, {"id": "finger0", "type": "ellipsoid", "center": [-0.29524, 0.7944800000000001, 0.01], "radii": [0.010439999999999998, 0.03672, 0.012979999999999998]}, {"id": "finger1", "type": "ellipsoid", "center": [-0.31508, 0.788, 0.01], "radii": [0.010439999999999998, 0.04104, 0.012979999999999998]}, {"id": "finger2", "type": "ellipsoid", "center": [-0.33491999999999994, 0.7944800000000001, 0.01], "radii": [0.010439999999999998, 0.03672, 0.012979999999999998]}, {"id": "finger3", "type": "ellipsoid", "center": [-0.35475999999999996, 0.80096, 0.01], "radii": [0.010439999999999998, 0.0324, 0.012979999999999998]}, {"id": "thumb-base", "type": "ellipsoid", "center": [-0.296, 0.85, 0.012], "radii": [0.015, 0.026, 0.015]}, {"id": "thumb-tip", "type": "ellipsoid", "center": [-0.286, 0.83, 0.022], "radii": [0.012, 0.02, 0.013]}], "blendRadius": 0.004, "resolution": 60, "bounds": {"min": [-0.43, 0.72, -0.085], "max": [-0.2, 1.34, 0.085]}, "purpose": "One continuous wrist surface; hand enlarged from reference-approved draft"}}, "parent": "root", "attachment": {"parentSocket": "shirt-sleeve", "localStart": [-0.258, 1.31, 0], "localEnd": [-0.321, 0.88, 0.003], "contactType": "overlap", "embedDepth": 0.025, "gapTolerance": 0.003}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.78}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "arm-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "skin", "materialLayers": ["skin"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "angular-tattoo", "kind": "linework", "description": "matte dark tribal chevron and curved bands over forearm", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(213, 154, 115, 1)", "secondaryAlbedo": "rgba(213, 154, 115, 1)", "materialClass": "skin", "materialClassConfidence": 0.8, "evidenceRefs": ["full-object"]}};
  node_arm_r_10.add(mesh_arm_r_10);
  meshes["arm-r"] = mesh_arm_r_10;
  colliders["arm-r"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["arm-r"] ??= [];
  destructionGroups["arm-r"].push(node_arm_r_10);

  const endpoint_shoe_r_11 = makeAttachmentEndpoint(null);
  const node_shoe_r_11 = new THREE.Group();
  node_shoe_r_11.name = "shoe-r__pivot";
  node_shoe_r_11.scale.set(1, 1, 1);
  if (endpoint_shoe_r_11) {
    node_shoe_r_11.position.copy(endpoint_shoe_r_11.start);
    node_shoe_r_11.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_shoe_r_11.position.set(0.0, 0.0, 0.0);
    node_shoe_r_11.rotation.set(0.0, 0.0, 0.0);
  }
  node_shoe_r_11.userData.sculptComponent = {"id": "shoe-r", "name": "shoe-r", "level": "meso", "role": "body", "importance": 1.0, "confidence": 0.78, "primitive": "tapered-sweep", "topologyClass": "continuous-sculpt", "topologyRationale": "Continuous high-top shoe contour: flat broad toe, shaped instep and ankle collar, replacing rounded overlapping blobs.", "geometryDescriptor": {"taperedSweep": {"stations": [{"position": [-0.115, 0.012, 0.035], "rx": 0.024, "rz": 0.015}, {"position": [-0.115, 0.025, 0.035], "rx": 0.118, "rz": 0.063}, {"position": [-0.115, 0.045, 0.035], "rx": 0.121, "rz": 0.067}, {"position": [-0.115, 0.062, 0.03], "rx": 0.115, "rz": 0.064}, {"position": [-0.115, 0.08, 0.015], "rx": 0.096, "rz": 0.06}, {"position": [-0.115, 0.1, -0.002], "rx": 0.075, "rz": 0.056}, {"position": [-0.115, 0.13, -0.018], "rx": 0.059, "rz": 0.054}, {"position": [-0.115, 0.17, -0.023], "rx": 0.052, "rz": 0.052}, {"position": [-0.115, 0.178, -0.023], "rx": 0.05, "rz": 0.05}], "radialSegments": 28, "capEnds": true, "fixedFrame": "horizontal"}, "normalStrategy": "Smooth horizontal shoe contours; separate outsole", "sourceNotes": "Broad reference toe and dark high-top sneakers, independent shoe module"}, "parent": "root", "attachment": null, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.78}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "shoe-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "shoes", "materialLayers": ["shoes"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(39, 41, 50, 1)", "secondaryAlbedo": "rgba(39, 41, 50, 1)", "materialClass": "plastic", "materialClassConfidence": 0.8, "evidenceRefs": ["full-object"]}};
  node_shoe_r_11.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "shoe-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["root"] ?? root).add(node_shoe_r_11);
  nodes["shoe-r"] = node_shoe_r_11;
  const mesh_shoe_r_11Geometry = endpoint_shoe_r_11
    ? new THREE.CylinderGeometry(endpoint_shoe_r_11.endRadius, endpoint_shoe_r_11.baseRadius, endpoint_shoe_r_11.length, 16, 6)
    : buildTaperedSweepGeometry({"stations": [{"position": [-0.115, 0.012, 0.035], "rx": 0.024, "rz": 0.015}, {"position": [-0.115, 0.025, 0.035], "rx": 0.118, "rz": 0.063}, {"position": [-0.115, 0.045, 0.035], "rx": 0.121, "rz": 0.067}, {"position": [-0.115, 0.062, 0.03], "rx": 0.115, "rz": 0.064}, {"position": [-0.115, 0.08, 0.015], "rx": 0.096, "rz": 0.06}, {"position": [-0.115, 0.1, -0.002], "rx": 0.075, "rz": 0.056}, {"position": [-0.115, 0.13, -0.018], "rx": 0.059, "rz": 0.054}, {"position": [-0.115, 0.17, -0.023], "rx": 0.052, "rz": 0.052}, {"position": [-0.115, 0.178, -0.023], "rx": 0.05, "rz": 0.05}], "radialSegments": 28, "capEnds": true, "fixedFrame": "horizontal"});
  if (!endpoint_shoe_r_11) {
    mesh_shoe_r_11Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_shoe_r_11 = new THREE.Mesh(
    mesh_shoe_r_11Geometry,
    materialMap["shoes"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_shoe_r_11.name = "shoe-r";
  if (endpoint_shoe_r_11) {
    mesh_shoe_r_11.position.copy(endpoint_shoe_r_11.midpoint);
    mesh_shoe_r_11.quaternion.copy(endpoint_shoe_r_11.quaternion);
  }
  mesh_shoe_r_11.castShadow = options.castShadow ?? true;
  mesh_shoe_r_11.receiveShadow = options.receiveShadow ?? true;
  mesh_shoe_r_11.userData.sculptComponent = {"id": "shoe-r", "name": "shoe-r", "level": "meso", "role": "body", "importance": 1.0, "confidence": 0.78, "primitive": "tapered-sweep", "topologyClass": "continuous-sculpt", "topologyRationale": "Continuous high-top shoe contour: flat broad toe, shaped instep and ankle collar, replacing rounded overlapping blobs.", "geometryDescriptor": {"taperedSweep": {"stations": [{"position": [-0.115, 0.012, 0.035], "rx": 0.024, "rz": 0.015}, {"position": [-0.115, 0.025, 0.035], "rx": 0.118, "rz": 0.063}, {"position": [-0.115, 0.045, 0.035], "rx": 0.121, "rz": 0.067}, {"position": [-0.115, 0.062, 0.03], "rx": 0.115, "rz": 0.064}, {"position": [-0.115, 0.08, 0.015], "rx": 0.096, "rz": 0.06}, {"position": [-0.115, 0.1, -0.002], "rx": 0.075, "rz": 0.056}, {"position": [-0.115, 0.13, -0.018], "rx": 0.059, "rz": 0.054}, {"position": [-0.115, 0.17, -0.023], "rx": 0.052, "rz": 0.052}, {"position": [-0.115, 0.178, -0.023], "rx": 0.05, "rz": 0.05}], "radialSegments": 28, "capEnds": true, "fixedFrame": "horizontal"}, "normalStrategy": "Smooth horizontal shoe contours; separate outsole", "sourceNotes": "Broad reference toe and dark high-top sneakers, independent shoe module"}, "parent": "root", "attachment": null, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.78}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "shoe-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "shoes", "materialLayers": ["shoes"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(39, 41, 50, 1)", "secondaryAlbedo": "rgba(39, 41, 50, 1)", "materialClass": "plastic", "materialClassConfidence": 0.8, "evidenceRefs": ["full-object"]}};
  node_shoe_r_11.add(mesh_shoe_r_11);
  meshes["shoe-r"] = mesh_shoe_r_11;
  colliders["shoe-r"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["shoe-r"] ??= [];
  destructionGroups["shoe-r"].push(node_shoe_r_11);

  const endpoint_sole_r_12 = makeAttachmentEndpoint(null);
  const node_sole_r_12 = new THREE.Group();
  node_sole_r_12.name = "sole-r__pivot";
  node_sole_r_12.scale.set(1, 1, 1);
  if (endpoint_sole_r_12) {
    node_sole_r_12.position.copy(endpoint_sole_r_12.start);
    node_sole_r_12.rotation.set(1.5707963267948966, 0.0, 0.0);
  } else {
    node_sole_r_12.position.set(-0.115, 0.026, 0.035);
    node_sole_r_12.rotation.set(1.5707963267948966, 0.0, 0.0);
  }
  node_sole_r_12.userData.sculptComponent = {"id": "sole-r", "name": "sole-r", "level": "micro", "role": "body", "importance": 1.0, "confidence": 0.78, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Contour follows the reference silhouette; depth is inferred and tested in orbit.", "geometryDescriptor": {"profile2D": {"points": [[0.42769999999999997, 0.0], [0.41805772288557197, 0.10232070351484124], [0.405118990788356, 0.1732426103684521], [0.38764313024846664, 0.23404723308381586], [0.36561897893722106, 0.28749781270113345], [0.33914098771003437, 0.33449234126967875], [0.30830758094922195, 0.3753317575473136], [0.2731685825266422, 0.41007447486767296], [0.2336630366055767, 0.4386748333756851], [0.1895037006540926, 0.46104821625249315], [0.13989014717124748, 0.4771054426630118], [0.08248650863723848, 0.4867721764671055], [1.3329809914788902e-13, 0.49], [-0.08248650863723843, 0.4867721764671055], [-0.13989014717124743, 0.4771054426630118], [-0.18950370065409247, 0.4610482162524932], [-0.23366303660557658, 0.43867483337568514], [-0.2731685825266422, 0.41007447486767296], [-0.3083075809492219, 0.3753317575473136], [-0.3391409877100343, 0.3344923412696788], [-0.36561897893722106, 0.28749781270113345], [-0.38764313024846664, 0.23404723308381592], [-0.40511899078835595, 0.17324261036845223], [-0.41805772288557197, 0.10232070351484147], [-0.42769999999998104, 2.819709889450938e-13], [-0.43170741946128943, -0.10232070351484136], [-0.42777079626050174, -0.17324261036845212], [-0.41721532726660004, -0.2340472330838158], [-0.40018194447004646, -0.28749781270113334], [-0.37673188127324614, -0.33449234126967875], [-0.34691443008337425, -0.3753317575473134], [-0.3107594760898541, -0.41007447486767284], [-0.26822600213840225, -0.4386748333756851], [-0.2190758976722258, -0.4610482162524932], [-0.16254195264339313, -0.4771054426630118], [-0.09613620521295588, -0.4867721764671055], [-3.6206545950956876e-13, -0.49], [0.09613620521295567, -0.4867721764671056], [0.162541952643393, -0.4771054426630118], [0.21907589767222568, -0.46104821625249326], [0.2682260021384021, -0.4386748333756851], [0.31075947608985377, -0.4100744748676732], [0.3469144300833741, -0.3753317575473136], [0.3767318812732461, -0.33449234126967886], [0.40018194447004635, -0.28749781270113367], [0.41721532726660004, -0.23404723308381575], [0.42777079626050174, -0.17324261036845254], [0.43170741946128943, -0.10232070351484131]], "depth": 1, "bevelEnabled": true, "bevelSize": 0.018, "bevelThickness": 0.06, "bevelSegments": 2}}, "parent": "root", "attachment": null, "dimensions": {"width": 0.145, "height": 0.25, "depth": 0.014, "units": "meters", "confidence": 0.78}, "transform": {"position": [-0.115, 0.026, 0.035], "rotation": [1.5707963267948966, 0, 0], "scale": [0.145, 0.248, 0.013]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "sole-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "sole", "materialLayers": ["sole"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(23, 26, 34, 1)", "secondaryAlbedo": "rgba(23, 26, 34, 1)", "materialClass": "plastic", "materialClassConfidence": 0.8, "evidenceRefs": ["full-object"]}};
  node_sole_r_12.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "sole-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["root"] ?? root).add(node_sole_r_12);
  nodes["sole-r"] = node_sole_r_12;
  const mesh_sole_r_12Geometry = endpoint_sole_r_12
    ? new THREE.CylinderGeometry(endpoint_sole_r_12.endRadius, endpoint_sole_r_12.baseRadius, endpoint_sole_r_12.length, 16, 6)
    : buildExtrudeGeometry({"points": [[0.42769999999999997, 0.0], [0.41805772288557197, 0.10232070351484124], [0.405118990788356, 0.1732426103684521], [0.38764313024846664, 0.23404723308381586], [0.36561897893722106, 0.28749781270113345], [0.33914098771003437, 0.33449234126967875], [0.30830758094922195, 0.3753317575473136], [0.2731685825266422, 0.41007447486767296], [0.2336630366055767, 0.4386748333756851], [0.1895037006540926, 0.46104821625249315], [0.13989014717124748, 0.4771054426630118], [0.08248650863723848, 0.4867721764671055], [1.3329809914788902e-13, 0.49], [-0.08248650863723843, 0.4867721764671055], [-0.13989014717124743, 0.4771054426630118], [-0.18950370065409247, 0.4610482162524932], [-0.23366303660557658, 0.43867483337568514], [-0.2731685825266422, 0.41007447486767296], [-0.3083075809492219, 0.3753317575473136], [-0.3391409877100343, 0.3344923412696788], [-0.36561897893722106, 0.28749781270113345], [-0.38764313024846664, 0.23404723308381592], [-0.40511899078835595, 0.17324261036845223], [-0.41805772288557197, 0.10232070351484147], [-0.42769999999998104, 2.819709889450938e-13], [-0.43170741946128943, -0.10232070351484136], [-0.42777079626050174, -0.17324261036845212], [-0.41721532726660004, -0.2340472330838158], [-0.40018194447004646, -0.28749781270113334], [-0.37673188127324614, -0.33449234126967875], [-0.34691443008337425, -0.3753317575473134], [-0.3107594760898541, -0.41007447486767284], [-0.26822600213840225, -0.4386748333756851], [-0.2190758976722258, -0.4610482162524932], [-0.16254195264339313, -0.4771054426630118], [-0.09613620521295588, -0.4867721764671055], [-3.6206545950956876e-13, -0.49], [0.09613620521295567, -0.4867721764671056], [0.162541952643393, -0.4771054426630118], [0.21907589767222568, -0.46104821625249326], [0.2682260021384021, -0.4386748333756851], [0.31075947608985377, -0.4100744748676732], [0.3469144300833741, -0.3753317575473136], [0.3767318812732461, -0.33449234126967886], [0.40018194447004635, -0.28749781270113367], [0.41721532726660004, -0.23404723308381575], [0.42777079626050174, -0.17324261036845254], [0.43170741946128943, -0.10232070351484131]], "depth": 1, "bevelEnabled": true, "bevelSize": 0.018, "bevelThickness": 0.06, "bevelSegments": 2});
  if (!endpoint_sole_r_12) {
    mesh_sole_r_12Geometry.scale(0.145, 0.248, 0.013);
  }
  const mesh_sole_r_12 = new THREE.Mesh(
    mesh_sole_r_12Geometry,
    materialMap["sole"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_sole_r_12.name = "sole-r";
  if (endpoint_sole_r_12) {
    mesh_sole_r_12.position.copy(endpoint_sole_r_12.midpoint);
    mesh_sole_r_12.quaternion.copy(endpoint_sole_r_12.quaternion);
  }
  mesh_sole_r_12.castShadow = options.castShadow ?? true;
  mesh_sole_r_12.receiveShadow = options.receiveShadow ?? true;
  mesh_sole_r_12.userData.sculptComponent = {"id": "sole-r", "name": "sole-r", "level": "micro", "role": "body", "importance": 1.0, "confidence": 0.78, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Contour follows the reference silhouette; depth is inferred and tested in orbit.", "geometryDescriptor": {"profile2D": {"points": [[0.42769999999999997, 0.0], [0.41805772288557197, 0.10232070351484124], [0.405118990788356, 0.1732426103684521], [0.38764313024846664, 0.23404723308381586], [0.36561897893722106, 0.28749781270113345], [0.33914098771003437, 0.33449234126967875], [0.30830758094922195, 0.3753317575473136], [0.2731685825266422, 0.41007447486767296], [0.2336630366055767, 0.4386748333756851], [0.1895037006540926, 0.46104821625249315], [0.13989014717124748, 0.4771054426630118], [0.08248650863723848, 0.4867721764671055], [1.3329809914788902e-13, 0.49], [-0.08248650863723843, 0.4867721764671055], [-0.13989014717124743, 0.4771054426630118], [-0.18950370065409247, 0.4610482162524932], [-0.23366303660557658, 0.43867483337568514], [-0.2731685825266422, 0.41007447486767296], [-0.3083075809492219, 0.3753317575473136], [-0.3391409877100343, 0.3344923412696788], [-0.36561897893722106, 0.28749781270113345], [-0.38764313024846664, 0.23404723308381592], [-0.40511899078835595, 0.17324261036845223], [-0.41805772288557197, 0.10232070351484147], [-0.42769999999998104, 2.819709889450938e-13], [-0.43170741946128943, -0.10232070351484136], [-0.42777079626050174, -0.17324261036845212], [-0.41721532726660004, -0.2340472330838158], [-0.40018194447004646, -0.28749781270113334], [-0.37673188127324614, -0.33449234126967875], [-0.34691443008337425, -0.3753317575473134], [-0.3107594760898541, -0.41007447486767284], [-0.26822600213840225, -0.4386748333756851], [-0.2190758976722258, -0.4610482162524932], [-0.16254195264339313, -0.4771054426630118], [-0.09613620521295588, -0.4867721764671055], [-3.6206545950956876e-13, -0.49], [0.09613620521295567, -0.4867721764671056], [0.162541952643393, -0.4771054426630118], [0.21907589767222568, -0.46104821625249326], [0.2682260021384021, -0.4386748333756851], [0.31075947608985377, -0.4100744748676732], [0.3469144300833741, -0.3753317575473136], [0.3767318812732461, -0.33449234126967886], [0.40018194447004635, -0.28749781270113367], [0.41721532726660004, -0.23404723308381575], [0.42777079626050174, -0.17324261036845254], [0.43170741946128943, -0.10232070351484131]], "depth": 1, "bevelEnabled": true, "bevelSize": 0.018, "bevelThickness": 0.06, "bevelSegments": 2}}, "parent": "root", "attachment": null, "dimensions": {"width": 0.145, "height": 0.25, "depth": 0.014, "units": "meters", "confidence": 0.78}, "transform": {"position": [-0.115, 0.026, 0.035], "rotation": [1.5707963267948966, 0, 0], "scale": [0.145, 0.248, 0.013]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "sole-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "sole", "materialLayers": ["sole"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(23, 26, 34, 1)", "secondaryAlbedo": "rgba(23, 26, 34, 1)", "materialClass": "plastic", "materialClassConfidence": 0.8, "evidenceRefs": ["full-object"]}};
  node_sole_r_12.add(mesh_sole_r_12);
  meshes["sole-r"] = mesh_sole_r_12;
  colliders["sole-r"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["sole-r"] ??= [];
  destructionGroups["sole-r"].push(node_sole_r_12);

  const attachment_lace_r_0_13 = {"parentSocket": "shoe-r", "localStart": [-0.155, 0.093, 0.11], "localEnd": [-0.07500000000000001, 0.093, 0.09], "contactType": "surface-embed", "embedDepth": 0.002, "gapTolerance": 0.003};
  const endpoint_lace_r_0_13 = null; // authored tubePath already in model coordinates
  const node_lace_r_0_13 = new THREE.Group();
  node_lace_r_0_13.name = "lace-r-0__pivot";
  node_lace_r_0_13.scale.set(1, 1, 1);
  if (endpoint_lace_r_0_13) {
    node_lace_r_0_13.position.copy(endpoint_lace_r_0_13.start);
    node_lace_r_0_13.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_lace_r_0_13.position.set(0.0, 0.0, 0.0);
    node_lace_r_0_13.rotation.set(0.0, 0.0, 0.0);
  }
  node_lace_r_0_13.userData.sculptComponent = {"id": "lace-r-0", "name": "lace-r-0", "level": "micro", "role": "body", "importance": 1.0, "confidence": 0.78, "primitive": "tube", "topologyClass": "assembled-solid", "topologyRationale": "Contour follows the reference silhouette; depth is inferred and tested in orbit.", "geometryDescriptor": {"tubePath": {"points": [[-0.152, 0.082, 0.098], [-0.07800000000000001, 0.082, 0.09]], "radius": 0.0025, "closed": false}, "attachmentGeometry": "authored-path"}, "parent": "root", "attachment": {"parentSocket": "shoe-r", "localStart": [-0.155, 0.093, 0.11], "localEnd": [-0.07500000000000001, 0.093, 0.09], "contactType": "surface-embed", "embedDepth": 0.002, "gapTolerance": 0.003}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.78}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lace-r-0", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "sole", "materialLayers": ["sole"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(23, 26, 34, 1)", "secondaryAlbedo": "rgba(23, 26, 34, 1)", "materialClass": "plastic", "materialClassConfidence": 0.8, "evidenceRefs": ["full-object"]}};
  node_lace_r_0_13.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lace-r-0", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["root"] ?? root).add(node_lace_r_0_13);
  nodes["lace-r-0"] = node_lace_r_0_13;
  const mesh_lace_r_0_13Geometry = endpoint_lace_r_0_13
    ? new THREE.CylinderGeometry(endpoint_lace_r_0_13.endRadius, endpoint_lace_r_0_13.baseRadius, endpoint_lace_r_0_13.length, 16, 6)
    : buildTubeGeometry({"points": [[-0.152, 0.082, 0.098], [-0.07800000000000001, 0.082, 0.09]], "radius": 0.0025, "closed": false});
  if (!endpoint_lace_r_0_13) {
    mesh_lace_r_0_13Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_lace_r_0_13 = new THREE.Mesh(
    mesh_lace_r_0_13Geometry,
    materialMap["sole"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_lace_r_0_13.name = "lace-r-0";
  if (endpoint_lace_r_0_13) {
    mesh_lace_r_0_13.position.copy(endpoint_lace_r_0_13.midpoint);
    mesh_lace_r_0_13.quaternion.copy(endpoint_lace_r_0_13.quaternion);
  }
  mesh_lace_r_0_13.castShadow = options.castShadow ?? true;
  mesh_lace_r_0_13.receiveShadow = options.receiveShadow ?? true;
  mesh_lace_r_0_13.userData.sculptComponent = {"id": "lace-r-0", "name": "lace-r-0", "level": "micro", "role": "body", "importance": 1.0, "confidence": 0.78, "primitive": "tube", "topologyClass": "assembled-solid", "topologyRationale": "Contour follows the reference silhouette; depth is inferred and tested in orbit.", "geometryDescriptor": {"tubePath": {"points": [[-0.152, 0.082, 0.098], [-0.07800000000000001, 0.082, 0.09]], "radius": 0.0025, "closed": false}, "attachmentGeometry": "authored-path"}, "parent": "root", "attachment": {"parentSocket": "shoe-r", "localStart": [-0.155, 0.093, 0.11], "localEnd": [-0.07500000000000001, 0.093, 0.09], "contactType": "surface-embed", "embedDepth": 0.002, "gapTolerance": 0.003}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.78}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lace-r-0", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "sole", "materialLayers": ["sole"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(23, 26, 34, 1)", "secondaryAlbedo": "rgba(23, 26, 34, 1)", "materialClass": "plastic", "materialClassConfidence": 0.8, "evidenceRefs": ["full-object"]}};
  node_lace_r_0_13.add(mesh_lace_r_0_13);
  meshes["lace-r-0"] = mesh_lace_r_0_13;
  colliders["lace-r-0"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["lace-r-0"] ??= [];
  destructionGroups["lace-r-0"].push(node_lace_r_0_13);

  const attachment_lace_r_1_14 = {"parentSocket": "shoe-r", "localStart": [-0.155, 0.102, 0.086], "localEnd": [-0.07500000000000001, 0.102, 0.066], "contactType": "surface-embed", "embedDepth": 0.002, "gapTolerance": 0.003};
  const endpoint_lace_r_1_14 = null; // authored tubePath already in model coordinates
  const node_lace_r_1_14 = new THREE.Group();
  node_lace_r_1_14.name = "lace-r-1__pivot";
  node_lace_r_1_14.scale.set(1, 1, 1);
  if (endpoint_lace_r_1_14) {
    node_lace_r_1_14.position.copy(endpoint_lace_r_1_14.start);
    node_lace_r_1_14.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_lace_r_1_14.position.set(0.0, 0.0, 0.0);
    node_lace_r_1_14.rotation.set(0.0, 0.0, 0.0);
  }
  node_lace_r_1_14.userData.sculptComponent = {"id": "lace-r-1", "name": "lace-r-1", "level": "micro", "role": "body", "importance": 1.0, "confidence": 0.78, "primitive": "tube", "topologyClass": "assembled-solid", "topologyRationale": "Contour follows the reference silhouette; depth is inferred and tested in orbit.", "geometryDescriptor": {"tubePath": {"points": [[-0.152, 0.101, 0.077], [-0.07800000000000001, 0.101, 0.069]], "radius": 0.0025, "closed": false}, "attachmentGeometry": "authored-path"}, "parent": "root", "attachment": {"parentSocket": "shoe-r", "localStart": [-0.155, 0.102, 0.086], "localEnd": [-0.07500000000000001, 0.102, 0.066], "contactType": "surface-embed", "embedDepth": 0.002, "gapTolerance": 0.003}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.78}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lace-r-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "sole", "materialLayers": ["sole"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(23, 26, 34, 1)", "secondaryAlbedo": "rgba(23, 26, 34, 1)", "materialClass": "plastic", "materialClassConfidence": 0.8, "evidenceRefs": ["full-object"]}};
  node_lace_r_1_14.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lace-r-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["root"] ?? root).add(node_lace_r_1_14);
  nodes["lace-r-1"] = node_lace_r_1_14;
  const mesh_lace_r_1_14Geometry = endpoint_lace_r_1_14
    ? new THREE.CylinderGeometry(endpoint_lace_r_1_14.endRadius, endpoint_lace_r_1_14.baseRadius, endpoint_lace_r_1_14.length, 16, 6)
    : buildTubeGeometry({"points": [[-0.152, 0.101, 0.077], [-0.07800000000000001, 0.101, 0.069]], "radius": 0.0025, "closed": false});
  if (!endpoint_lace_r_1_14) {
    mesh_lace_r_1_14Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_lace_r_1_14 = new THREE.Mesh(
    mesh_lace_r_1_14Geometry,
    materialMap["sole"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_lace_r_1_14.name = "lace-r-1";
  if (endpoint_lace_r_1_14) {
    mesh_lace_r_1_14.position.copy(endpoint_lace_r_1_14.midpoint);
    mesh_lace_r_1_14.quaternion.copy(endpoint_lace_r_1_14.quaternion);
  }
  mesh_lace_r_1_14.castShadow = options.castShadow ?? true;
  mesh_lace_r_1_14.receiveShadow = options.receiveShadow ?? true;
  mesh_lace_r_1_14.userData.sculptComponent = {"id": "lace-r-1", "name": "lace-r-1", "level": "micro", "role": "body", "importance": 1.0, "confidence": 0.78, "primitive": "tube", "topologyClass": "assembled-solid", "topologyRationale": "Contour follows the reference silhouette; depth is inferred and tested in orbit.", "geometryDescriptor": {"tubePath": {"points": [[-0.152, 0.101, 0.077], [-0.07800000000000001, 0.101, 0.069]], "radius": 0.0025, "closed": false}, "attachmentGeometry": "authored-path"}, "parent": "root", "attachment": {"parentSocket": "shoe-r", "localStart": [-0.155, 0.102, 0.086], "localEnd": [-0.07500000000000001, 0.102, 0.066], "contactType": "surface-embed", "embedDepth": 0.002, "gapTolerance": 0.003}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.78}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lace-r-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "sole", "materialLayers": ["sole"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(23, 26, 34, 1)", "secondaryAlbedo": "rgba(23, 26, 34, 1)", "materialClass": "plastic", "materialClassConfidence": 0.8, "evidenceRefs": ["full-object"]}};
  node_lace_r_1_14.add(mesh_lace_r_1_14);
  meshes["lace-r-1"] = mesh_lace_r_1_14;
  colliders["lace-r-1"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["lace-r-1"] ??= [];
  destructionGroups["lace-r-1"].push(node_lace_r_1_14);

  const attachment_lace_r_2_15 = {"parentSocket": "shoe-r", "localStart": [-0.155, 0.111, 0.062], "localEnd": [-0.07500000000000001, 0.111, 0.041999999999999996], "contactType": "surface-embed", "embedDepth": 0.002, "gapTolerance": 0.003};
  const endpoint_lace_r_2_15 = null; // authored tubePath already in model coordinates
  const node_lace_r_2_15 = new THREE.Group();
  node_lace_r_2_15.name = "lace-r-2__pivot";
  node_lace_r_2_15.scale.set(1, 1, 1);
  if (endpoint_lace_r_2_15) {
    node_lace_r_2_15.position.copy(endpoint_lace_r_2_15.start);
    node_lace_r_2_15.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_lace_r_2_15.position.set(0.0, 0.0, 0.0);
    node_lace_r_2_15.rotation.set(0.0, 0.0, 0.0);
  }
  node_lace_r_2_15.userData.sculptComponent = {"id": "lace-r-2", "name": "lace-r-2", "level": "micro", "role": "body", "importance": 1.0, "confidence": 0.78, "primitive": "tube", "topologyClass": "assembled-solid", "topologyRationale": "Contour follows the reference silhouette; depth is inferred and tested in orbit.", "geometryDescriptor": {"tubePath": {"points": [[-0.152, 0.12, 0.056], [-0.07800000000000001, 0.12, 0.048]], "radius": 0.0025, "closed": false}, "attachmentGeometry": "authored-path"}, "parent": "root", "attachment": {"parentSocket": "shoe-r", "localStart": [-0.155, 0.111, 0.062], "localEnd": [-0.07500000000000001, 0.111, 0.041999999999999996], "contactType": "surface-embed", "embedDepth": 0.002, "gapTolerance": 0.003}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.78}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lace-r-2", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "sole", "materialLayers": ["sole"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(23, 26, 34, 1)", "secondaryAlbedo": "rgba(23, 26, 34, 1)", "materialClass": "plastic", "materialClassConfidence": 0.8, "evidenceRefs": ["full-object"]}};
  node_lace_r_2_15.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lace-r-2", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["root"] ?? root).add(node_lace_r_2_15);
  nodes["lace-r-2"] = node_lace_r_2_15;
  const mesh_lace_r_2_15Geometry = endpoint_lace_r_2_15
    ? new THREE.CylinderGeometry(endpoint_lace_r_2_15.endRadius, endpoint_lace_r_2_15.baseRadius, endpoint_lace_r_2_15.length, 16, 6)
    : buildTubeGeometry({"points": [[-0.152, 0.12, 0.056], [-0.07800000000000001, 0.12, 0.048]], "radius": 0.0025, "closed": false});
  if (!endpoint_lace_r_2_15) {
    mesh_lace_r_2_15Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_lace_r_2_15 = new THREE.Mesh(
    mesh_lace_r_2_15Geometry,
    materialMap["sole"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_lace_r_2_15.name = "lace-r-2";
  if (endpoint_lace_r_2_15) {
    mesh_lace_r_2_15.position.copy(endpoint_lace_r_2_15.midpoint);
    mesh_lace_r_2_15.quaternion.copy(endpoint_lace_r_2_15.quaternion);
  }
  mesh_lace_r_2_15.castShadow = options.castShadow ?? true;
  mesh_lace_r_2_15.receiveShadow = options.receiveShadow ?? true;
  mesh_lace_r_2_15.userData.sculptComponent = {"id": "lace-r-2", "name": "lace-r-2", "level": "micro", "role": "body", "importance": 1.0, "confidence": 0.78, "primitive": "tube", "topologyClass": "assembled-solid", "topologyRationale": "Contour follows the reference silhouette; depth is inferred and tested in orbit.", "geometryDescriptor": {"tubePath": {"points": [[-0.152, 0.12, 0.056], [-0.07800000000000001, 0.12, 0.048]], "radius": 0.0025, "closed": false}, "attachmentGeometry": "authored-path"}, "parent": "root", "attachment": {"parentSocket": "shoe-r", "localStart": [-0.155, 0.111, 0.062], "localEnd": [-0.07500000000000001, 0.111, 0.041999999999999996], "contactType": "surface-embed", "embedDepth": 0.002, "gapTolerance": 0.003}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.78}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lace-r-2", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "sole", "materialLayers": ["sole"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(23, 26, 34, 1)", "secondaryAlbedo": "rgba(23, 26, 34, 1)", "materialClass": "plastic", "materialClassConfidence": 0.8, "evidenceRefs": ["full-object"]}};
  node_lace_r_2_15.add(mesh_lace_r_2_15);
  meshes["lace-r-2"] = mesh_lace_r_2_15;
  colliders["lace-r-2"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["lace-r-2"] ??= [];
  destructionGroups["lace-r-2"].push(node_lace_r_2_15);

  const attachment_lace_r_3_16 = {"parentSocket": "shoe-r", "localStart": [-0.155, 0.12, 0.03799999999999999], "localEnd": [-0.07500000000000001, 0.12, 0.017999999999999988], "contactType": "surface-embed", "embedDepth": 0.002, "gapTolerance": 0.003};
  const endpoint_lace_r_3_16 = null; // authored tubePath already in model coordinates
  const node_lace_r_3_16 = new THREE.Group();
  node_lace_r_3_16.name = "lace-r-3__pivot";
  node_lace_r_3_16.scale.set(1, 1, 1);
  if (endpoint_lace_r_3_16) {
    node_lace_r_3_16.position.copy(endpoint_lace_r_3_16.start);
    node_lace_r_3_16.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_lace_r_3_16.position.set(0.0, 0.0, 0.0);
    node_lace_r_3_16.rotation.set(0.0, 0.0, 0.0);
  }
  node_lace_r_3_16.userData.sculptComponent = {"id": "lace-r-3", "name": "lace-r-3", "level": "micro", "role": "body", "importance": 1.0, "confidence": 0.78, "primitive": "tube", "topologyClass": "assembled-solid", "topologyRationale": "Contour follows the reference silhouette; depth is inferred and tested in orbit.", "geometryDescriptor": {"tubePath": {"points": [[-0.152, 0.139, 0.035], [-0.07800000000000001, 0.139, 0.027000000000000003]], "radius": 0.0025, "closed": false}, "attachmentGeometry": "authored-path"}, "parent": "root", "attachment": {"parentSocket": "shoe-r", "localStart": [-0.155, 0.12, 0.03799999999999999], "localEnd": [-0.07500000000000001, 0.12, 0.017999999999999988], "contactType": "surface-embed", "embedDepth": 0.002, "gapTolerance": 0.003}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.78}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lace-r-3", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "sole", "materialLayers": ["sole"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(23, 26, 34, 1)", "secondaryAlbedo": "rgba(23, 26, 34, 1)", "materialClass": "plastic", "materialClassConfidence": 0.8, "evidenceRefs": ["full-object"]}};
  node_lace_r_3_16.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lace-r-3", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["root"] ?? root).add(node_lace_r_3_16);
  nodes["lace-r-3"] = node_lace_r_3_16;
  const mesh_lace_r_3_16Geometry = endpoint_lace_r_3_16
    ? new THREE.CylinderGeometry(endpoint_lace_r_3_16.endRadius, endpoint_lace_r_3_16.baseRadius, endpoint_lace_r_3_16.length, 16, 6)
    : buildTubeGeometry({"points": [[-0.152, 0.139, 0.035], [-0.07800000000000001, 0.139, 0.027000000000000003]], "radius": 0.0025, "closed": false});
  if (!endpoint_lace_r_3_16) {
    mesh_lace_r_3_16Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_lace_r_3_16 = new THREE.Mesh(
    mesh_lace_r_3_16Geometry,
    materialMap["sole"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_lace_r_3_16.name = "lace-r-3";
  if (endpoint_lace_r_3_16) {
    mesh_lace_r_3_16.position.copy(endpoint_lace_r_3_16.midpoint);
    mesh_lace_r_3_16.quaternion.copy(endpoint_lace_r_3_16.quaternion);
  }
  mesh_lace_r_3_16.castShadow = options.castShadow ?? true;
  mesh_lace_r_3_16.receiveShadow = options.receiveShadow ?? true;
  mesh_lace_r_3_16.userData.sculptComponent = {"id": "lace-r-3", "name": "lace-r-3", "level": "micro", "role": "body", "importance": 1.0, "confidence": 0.78, "primitive": "tube", "topologyClass": "assembled-solid", "topologyRationale": "Contour follows the reference silhouette; depth is inferred and tested in orbit.", "geometryDescriptor": {"tubePath": {"points": [[-0.152, 0.139, 0.035], [-0.07800000000000001, 0.139, 0.027000000000000003]], "radius": 0.0025, "closed": false}, "attachmentGeometry": "authored-path"}, "parent": "root", "attachment": {"parentSocket": "shoe-r", "localStart": [-0.155, 0.12, 0.03799999999999999], "localEnd": [-0.07500000000000001, 0.12, 0.017999999999999988], "contactType": "surface-embed", "embedDepth": 0.002, "gapTolerance": 0.003}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.78}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lace-r-3", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "sole", "materialLayers": ["sole"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(23, 26, 34, 1)", "secondaryAlbedo": "rgba(23, 26, 34, 1)", "materialClass": "plastic", "materialClassConfidence": 0.8, "evidenceRefs": ["full-object"]}};
  node_lace_r_3_16.add(mesh_lace_r_3_16);
  meshes["lace-r-3"] = mesh_lace_r_3_16;
  colliders["lace-r-3"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["lace-r-3"] ??= [];
  destructionGroups["lace-r-3"].push(node_lace_r_3_16);

  const endpoint_neck_17 = makeAttachmentEndpoint(null);
  const node_neck_17 = new THREE.Group();
  node_neck_17.name = "neck__pivot";
  node_neck_17.scale.set(1, 1, 1);
  if (endpoint_neck_17) {
    node_neck_17.position.copy(endpoint_neck_17.start);
    node_neck_17.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_neck_17.position.set(0.0, 0.0, 0.0);
    node_neck_17.rotation.set(0.0, 0.0, 0.0);
  }
  node_neck_17.userData.sculptComponent = {"id": "neck", "name": "neck", "level": "meso", "role": "body", "importance": 1.0, "confidence": 0.78, "primitive": "ellipsoid", "topologyClass": "implicit", "topologyRationale": "Continuous sculpt volume made from smoothly blended fields, not independently rendered spheres.", "geometryDescriptor": {"sdf": {"primitives": [{"id": "neck-shaft", "type": "ellipsoid", "center": [0, 1.49, -0.012], "radii": [0.049, 0.085, 0.045]}], "operations": [], "bounds": {"min": [-0.07400000000000001, 1.382, -0.08199999999999999], "max": [0.07400000000000001, 1.628, 0.058]}, "resolution": 36}, "normalStrategy": "smooth vertex normals"}, "parent": "root", "attachment": null, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.78}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "neck", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "skin", "materialLayers": ["skin"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(213, 154, 115, 1)", "secondaryAlbedo": "rgba(213, 154, 115, 1)", "materialClass": "skin", "materialClassConfidence": 0.8, "evidenceRefs": ["full-object"]}};
  node_neck_17.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "neck", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["root"] ?? root).add(node_neck_17);
  nodes["neck"] = node_neck_17;
  const mesh_neck_17Geometry = polygonizeSdf({"primitives": [{"id": "neck-shaft", "type": "ellipsoid", "center": [0, 1.49, -0.012], "radii": [0.049, 0.085, 0.045]}], "operations": [], "bounds": {"min": [-0.07400000000000001, 1.382, -0.08199999999999999], "max": [0.07400000000000001, 1.628, 0.058]}, "resolution": 36});
  if (!endpoint_neck_17) {
    mesh_neck_17Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_neck_17 = new THREE.Mesh(
    mesh_neck_17Geometry,
    createSculptMaterial("skin", {"id": "skin", "name": "skin", "type": "standard", "shaderModel": "MeshStandardMaterial", "baseColor": "#d59a73", "color": "#d59a73", "roughness": 0.78, "metalness": 0, "textureless": {"declared": true, "evidence": ["reference-isolated.png: broad smooth color regions, no observable pore/grain pattern at target game distance; simplified art requested by user"]}, "albedo": {"dominant": "#d59a73", "secondary": ["#d59a73"]}, "ambientOcclusion": {"cavityStrength": 0.16, "contactShadowBias": 0.25}, "localOverrides": []}, options, true)
  );
  mesh_neck_17.name = "neck";
  if (endpoint_neck_17) {
    mesh_neck_17.position.copy(endpoint_neck_17.midpoint);
    mesh_neck_17.quaternion.copy(endpoint_neck_17.quaternion);
  }
  mesh_neck_17.castShadow = options.castShadow ?? true;
  mesh_neck_17.receiveShadow = options.receiveShadow ?? true;
  mesh_neck_17.userData.sculptComponent = {"id": "neck", "name": "neck", "level": "meso", "role": "body", "importance": 1.0, "confidence": 0.78, "primitive": "ellipsoid", "topologyClass": "implicit", "topologyRationale": "Continuous sculpt volume made from smoothly blended fields, not independently rendered spheres.", "geometryDescriptor": {"sdf": {"primitives": [{"id": "neck-shaft", "type": "ellipsoid", "center": [0, 1.49, -0.012], "radii": [0.049, 0.085, 0.045]}], "operations": [], "bounds": {"min": [-0.07400000000000001, 1.382, -0.08199999999999999], "max": [0.07400000000000001, 1.628, 0.058]}, "resolution": 36}, "normalStrategy": "smooth vertex normals"}, "parent": "root", "attachment": null, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.78}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "neck", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "skin", "materialLayers": ["skin"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(213, 154, 115, 1)", "secondaryAlbedo": "rgba(213, 154, 115, 1)", "materialClass": "skin", "materialClassConfidence": 0.8, "evidenceRefs": ["full-object"]}};
  node_neck_17.add(mesh_neck_17);
  meshes["neck"] = mesh_neck_17;
  colliders["neck"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["neck"] ??= [];
  destructionGroups["neck"].push(node_neck_17);

  const endpoint_head_18 = makeAttachmentEndpoint(null);
  const node_head_18 = new THREE.Group();
  node_head_18.name = "head__pivot";
  node_head_18.scale.set(1, 1, 1);
  if (endpoint_head_18) {
    node_head_18.position.copy(endpoint_head_18.start);
    node_head_18.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_head_18.position.set(0.0, 0.0, 0.0);
    node_head_18.rotation.set(0.0, 0.0, 0.0);
  }
  node_head_18.userData.sculptComponent = {"id": "head", "name": "head", "level": "macro", "role": "body", "importance": 1.0, "confidence": 0.78, "primitive": "tapered-sweep", "topologyClass": "continuous-sculpt", "topologyRationale": "Single closed head contour with continuously sculpted nose, brow and lips. No separate cheek or jaw lobes.", "geometryDescriptor": {"taperedSweep": {"stations": [{"position": [0, 1.57, 0.027], "rx": 0.036, "rz": 0.042}, {"position": [0, 1.58, 0.014], "rx": 0.05, "rz": 0.056}, {"position": [0, 1.599, 0.005], "rx": 0.059, "rz": 0.067}, {"position": [0, 1.63, -0.006], "rx": 0.071, "rz": 0.081}, {"position": [0, 1.67, -0.012], "rx": 0.078, "rz": 0.096}, {"position": [0, 1.706, -0.013], "rx": 0.078, "rz": 0.099}, {"position": [0, 1.74, -0.018], "rx": 0.08, "rz": 0.096}, {"position": [0, 1.775, -0.02], "rx": 0.072, "rz": 0.082}, {"position": [0, 1.8, -0.02], "rx": 0.053, "rz": 0.057}, {"position": [0, 1.815, -0.02], "rx": 0.005, "rz": 0.005}], "radialSegments": 64, "capEnds": true, "fixedFrame": "horizontal"}, "normalStrategy": "Horizontal anatomical contour sections: preserve world Y cross-section planes to avoid mouth/jaw folding when centre depth changes.", "faceSculpt": {"frontAxis": "+Z", "nose": [0, 1.661, 0.021, 0.016, 0.019], "bridge": [0, 1.69, 0.014, 0.027, 0.009], "cheeks": [[0.052, 1.653, 0.026, 0.03, 0.003], [-0.052, 1.653, 0.026, 0.03, 0.003]], "lipRidge": [0, 1.631, 0.023, 0.008, 0.003], "jawExponent": 2.25, "backRoundness": {"centreY": 1.715, "heightRadius": 0.075, "depth": 0.022}}, "displayHeadScale": 1.07, "displayHeadOffsetY": -0.018}, "parent": "root", "attachment": null, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.78}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "head", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "skin", "materialLayers": ["skin"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(213, 154, 115, 1)", "secondaryAlbedo": "rgba(213, 154, 115, 1)", "materialClass": "skin", "materialClassConfidence": 0.8, "evidenceRefs": ["full-object"]}};
  node_head_18.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "head", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["root"] ?? root).add(node_head_18);
  nodes["head"] = node_head_18;
  const mesh_head_18Geometry = endpoint_head_18
    ? new THREE.CylinderGeometry(endpoint_head_18.endRadius, endpoint_head_18.baseRadius, endpoint_head_18.length, 16, 6)
    : buildTaperedSweepGeometry({"stations": [{"position": [0, 1.57, 0.027], "rx": 0.036, "rz": 0.042}, {"position": [0, 1.58, 0.014], "rx": 0.05, "rz": 0.056}, {"position": [0, 1.599, 0.005], "rx": 0.059, "rz": 0.067}, {"position": [0, 1.63, -0.006], "rx": 0.071, "rz": 0.081}, {"position": [0, 1.67, -0.012], "rx": 0.078, "rz": 0.096}, {"position": [0, 1.706, -0.013], "rx": 0.078, "rz": 0.099}, {"position": [0, 1.74, -0.018], "rx": 0.08, "rz": 0.096}, {"position": [0, 1.775, -0.02], "rx": 0.072, "rz": 0.082}, {"position": [0, 1.8, -0.02], "rx": 0.053, "rz": 0.057}, {"position": [0, 1.815, -0.02], "rx": 0.005, "rz": 0.005}], "radialSegments": 64, "capEnds": true, "fixedFrame": "horizontal"});
  if (!endpoint_head_18) {
    mesh_head_18Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_head_18 = new THREE.Mesh(
    mesh_head_18Geometry,
    materialMap["skin"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_head_18.name = "head";
  if (endpoint_head_18) {
    mesh_head_18.position.copy(endpoint_head_18.midpoint);
    mesh_head_18.quaternion.copy(endpoint_head_18.quaternion);
  }
  mesh_head_18.castShadow = options.castShadow ?? true;
  mesh_head_18.receiveShadow = options.receiveShadow ?? true;
  mesh_head_18.userData.sculptComponent = {"id": "head", "name": "head", "level": "macro", "role": "body", "importance": 1.0, "confidence": 0.78, "primitive": "tapered-sweep", "topologyClass": "continuous-sculpt", "topologyRationale": "Single closed head contour with continuously sculpted nose, brow and lips. No separate cheek or jaw lobes.", "geometryDescriptor": {"taperedSweep": {"stations": [{"position": [0, 1.57, 0.027], "rx": 0.036, "rz": 0.042}, {"position": [0, 1.58, 0.014], "rx": 0.05, "rz": 0.056}, {"position": [0, 1.599, 0.005], "rx": 0.059, "rz": 0.067}, {"position": [0, 1.63, -0.006], "rx": 0.071, "rz": 0.081}, {"position": [0, 1.67, -0.012], "rx": 0.078, "rz": 0.096}, {"position": [0, 1.706, -0.013], "rx": 0.078, "rz": 0.099}, {"position": [0, 1.74, -0.018], "rx": 0.08, "rz": 0.096}, {"position": [0, 1.775, -0.02], "rx": 0.072, "rz": 0.082}, {"position": [0, 1.8, -0.02], "rx": 0.053, "rz": 0.057}, {"position": [0, 1.815, -0.02], "rx": 0.005, "rz": 0.005}], "radialSegments": 64, "capEnds": true, "fixedFrame": "horizontal"}, "normalStrategy": "Horizontal anatomical contour sections: preserve world Y cross-section planes to avoid mouth/jaw folding when centre depth changes.", "faceSculpt": {"frontAxis": "+Z", "nose": [0, 1.661, 0.021, 0.016, 0.019], "bridge": [0, 1.69, 0.014, 0.027, 0.009], "cheeks": [[0.052, 1.653, 0.026, 0.03, 0.003], [-0.052, 1.653, 0.026, 0.03, 0.003]], "lipRidge": [0, 1.631, 0.023, 0.008, 0.003], "jawExponent": 2.25, "backRoundness": {"centreY": 1.715, "heightRadius": 0.075, "depth": 0.022}}, "displayHeadScale": 1.07, "displayHeadOffsetY": -0.018}, "parent": "root", "attachment": null, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.78}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "head", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "skin", "materialLayers": ["skin"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(213, 154, 115, 1)", "secondaryAlbedo": "rgba(213, 154, 115, 1)", "materialClass": "skin", "materialClassConfidence": 0.8, "evidenceRefs": ["full-object"]}};
  node_head_18.add(mesh_head_18);
  meshes["head"] = mesh_head_18;
  colliders["head"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["head"] ??= [];
  destructionGroups["head"].push(node_head_18);

  const endpoint_ear__1_19 = makeAttachmentEndpoint(null);
  const node_ear__1_19 = new THREE.Group();
  node_ear__1_19.name = "ear--1__pivot";
  node_ear__1_19.scale.set(1, 1, 1);
  if (endpoint_ear__1_19) {
    node_ear__1_19.position.copy(endpoint_ear__1_19.start);
    node_ear__1_19.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_ear__1_19.position.set(-0.098, 1.684, -0.005);
    node_ear__1_19.rotation.set(0.0, 0.0, 0.0);
  }
  node_ear__1_19.userData.sculptComponent = {"id": "ear--1", "name": "ear--1", "level": "meso", "role": "body", "importance": 1.0, "confidence": 0.78, "primitive": "ellipsoid", "topologyClass": "assembled-solid", "topologyRationale": "Contour follows the reference silhouette; depth is inferred and tested in orbit.", "geometryDescriptor": {"normalStrategy": "smooth vertex normals", "uvStrategy": "generated procedural coordinates", "edgeTreatment": {"type": "none", "bevelRadius": 0, "segments": 1}, "deformationStack": []}, "parent": "root", "attachment": null, "dimensions": {"width": 0.035, "height": 0.061, "depth": 0.033, "units": "meters", "confidence": 0.78}, "transform": {"position": [-0.098, 1.684, -0.005], "rotation": [0, 0, 0], "scale": [0.035, 0.061, 0.033]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "ear--1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "skin", "materialLayers": ["skin"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(213, 154, 115, 1)", "secondaryAlbedo": "rgba(213, 154, 115, 1)", "materialClass": "skin", "materialClassConfidence": 0.8, "evidenceRefs": ["full-object"]}};
  node_ear__1_19.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "ear--1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["root"] ?? root).add(node_ear__1_19);
  nodes["ear--1"] = node_ear__1_19;
  const mesh_ear__1_19Geometry = endpoint_ear__1_19
    ? new THREE.CylinderGeometry(endpoint_ear__1_19.endRadius, endpoint_ear__1_19.baseRadius, endpoint_ear__1_19.length, 16, 6)
    : new THREE.SphereGeometry(0.5, 32, 20);
  if (!endpoint_ear__1_19) {
    mesh_ear__1_19Geometry.scale(0.035, 0.061, 0.033);
  }
  const mesh_ear__1_19 = new THREE.Mesh(
    mesh_ear__1_19Geometry,
    materialMap["skin"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_ear__1_19.name = "ear--1";
  if (endpoint_ear__1_19) {
    mesh_ear__1_19.position.copy(endpoint_ear__1_19.midpoint);
    mesh_ear__1_19.quaternion.copy(endpoint_ear__1_19.quaternion);
  }
  mesh_ear__1_19.castShadow = options.castShadow ?? true;
  mesh_ear__1_19.receiveShadow = options.receiveShadow ?? true;
  mesh_ear__1_19.userData.sculptComponent = {"id": "ear--1", "name": "ear--1", "level": "meso", "role": "body", "importance": 1.0, "confidence": 0.78, "primitive": "ellipsoid", "topologyClass": "assembled-solid", "topologyRationale": "Contour follows the reference silhouette; depth is inferred and tested in orbit.", "geometryDescriptor": {"normalStrategy": "smooth vertex normals", "uvStrategy": "generated procedural coordinates", "edgeTreatment": {"type": "none", "bevelRadius": 0, "segments": 1}, "deformationStack": []}, "parent": "root", "attachment": null, "dimensions": {"width": 0.035, "height": 0.061, "depth": 0.033, "units": "meters", "confidence": 0.78}, "transform": {"position": [-0.098, 1.684, -0.005], "rotation": [0, 0, 0], "scale": [0.035, 0.061, 0.033]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "ear--1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "skin", "materialLayers": ["skin"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(213, 154, 115, 1)", "secondaryAlbedo": "rgba(213, 154, 115, 1)", "materialClass": "skin", "materialClassConfidence": 0.8, "evidenceRefs": ["full-object"]}};
  node_ear__1_19.add(mesh_ear__1_19);
  meshes["ear--1"] = mesh_ear__1_19;
  colliders["ear--1"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["ear--1"] ??= [];
  destructionGroups["ear--1"].push(node_ear__1_19);

  const endpoint_eye__1_20 = makeAttachmentEndpoint(null);
  const node_eye__1_20 = new THREE.Group();
  node_eye__1_20.name = "eye--1__pivot";
  node_eye__1_20.scale.set(1, 1, 1);
  if (endpoint_eye__1_20) {
    node_eye__1_20.position.copy(endpoint_eye__1_20.start);
    node_eye__1_20.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_eye__1_20.position.set(-0.039, 1.709, 0.07);
    node_eye__1_20.rotation.set(0.0, 0.0, 0.0);
  }
  node_eye__1_20.userData.sculptComponent = {"id": "eye--1", "name": "eye--1", "level": "micro", "role": "body", "importance": 1.0, "confidence": 0.78, "primitive": "ellipsoid", "topologyClass": "assembled-solid", "topologyRationale": "Contour follows the reference silhouette; depth is inferred and tested in orbit.", "geometryDescriptor": {"normalStrategy": "smooth vertex normals", "uvStrategy": "generated procedural coordinates", "edgeTreatment": {"type": "none", "bevelRadius": 0, "segments": 1}, "deformationStack": []}, "parent": "root", "attachment": null, "dimensions": {"width": 0.035, "height": 0.018, "depth": 0.014, "units": "meters", "confidence": 0.78}, "transform": {"position": [-0.039, 1.709, 0.07], "rotation": [0, 0, 0], "scale": [0.035, 0.018, 0.014]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "eye--1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "eye", "materialLayers": ["eye"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(238, 232, 222, 1)", "secondaryAlbedo": "rgba(238, 232, 222, 1)", "materialClass": "plastic", "materialClassConfidence": 0.8, "evidenceRefs": ["full-object"]}};
  node_eye__1_20.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "eye--1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["root"] ?? root).add(node_eye__1_20);
  nodes["eye--1"] = node_eye__1_20;
  const mesh_eye__1_20Geometry = endpoint_eye__1_20
    ? new THREE.CylinderGeometry(endpoint_eye__1_20.endRadius, endpoint_eye__1_20.baseRadius, endpoint_eye__1_20.length, 16, 6)
    : new THREE.SphereGeometry(0.5, 32, 20);
  if (!endpoint_eye__1_20) {
    mesh_eye__1_20Geometry.scale(0.035, 0.018, 0.014);
  }
  const mesh_eye__1_20 = new THREE.Mesh(
    mesh_eye__1_20Geometry,
    materialMap["eye"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_eye__1_20.name = "eye--1";
  if (endpoint_eye__1_20) {
    mesh_eye__1_20.position.copy(endpoint_eye__1_20.midpoint);
    mesh_eye__1_20.quaternion.copy(endpoint_eye__1_20.quaternion);
  }
  mesh_eye__1_20.castShadow = options.castShadow ?? true;
  mesh_eye__1_20.receiveShadow = options.receiveShadow ?? true;
  mesh_eye__1_20.userData.sculptComponent = {"id": "eye--1", "name": "eye--1", "level": "micro", "role": "body", "importance": 1.0, "confidence": 0.78, "primitive": "ellipsoid", "topologyClass": "assembled-solid", "topologyRationale": "Contour follows the reference silhouette; depth is inferred and tested in orbit.", "geometryDescriptor": {"normalStrategy": "smooth vertex normals", "uvStrategy": "generated procedural coordinates", "edgeTreatment": {"type": "none", "bevelRadius": 0, "segments": 1}, "deformationStack": []}, "parent": "root", "attachment": null, "dimensions": {"width": 0.035, "height": 0.018, "depth": 0.014, "units": "meters", "confidence": 0.78}, "transform": {"position": [-0.039, 1.709, 0.07], "rotation": [0, 0, 0], "scale": [0.035, 0.018, 0.014]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "eye--1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "eye", "materialLayers": ["eye"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(238, 232, 222, 1)", "secondaryAlbedo": "rgba(238, 232, 222, 1)", "materialClass": "plastic", "materialClassConfidence": 0.8, "evidenceRefs": ["full-object"]}};
  node_eye__1_20.add(mesh_eye__1_20);
  meshes["eye--1"] = mesh_eye__1_20;
  colliders["eye--1"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["eye--1"] ??= [];
  destructionGroups["eye--1"].push(node_eye__1_20);

  const endpoint_glasses__1_21 = makeAttachmentEndpoint(null);
  const node_glasses__1_21 = new THREE.Group();
  node_glasses__1_21.name = "glasses--1__pivot";
  node_glasses__1_21.scale.set(1, 1, 1);
  if (endpoint_glasses__1_21) {
    node_glasses__1_21.position.copy(endpoint_glasses__1_21.start);
    node_glasses__1_21.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_glasses__1_21.position.set(-0.047, 1.703, 0.088);
    node_glasses__1_21.rotation.set(0.0, 0.0, 0.0);
  }
  node_glasses__1_21.userData.sculptComponent = {"id": "glasses--1", "name": "glasses--1", "level": "micro", "role": "body", "importance": 1.0, "confidence": 0.78, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Contour follows the reference silhouette; depth is inferred and tested in orbit.", "geometryDescriptor": {"profile2D": {"points": [[-0.5, 0.35], [-0.4, 0.5], [0.42, 0.5], [0.5, 0.3], [0.4, -0.42], [-0.35, -0.5]], "depth": 1, "bevelEnabled": true, "bevelSize": 0.05, "bevelThickness": 0.03, "bevelSegments": 2}}, "parent": "root", "attachment": null, "dimensions": {"width": 0.082, "height": 0.048, "depth": 0.012, "units": "meters", "confidence": 0.78}, "transform": {"position": [-0.047, 1.703, 0.088], "rotation": [0, 0, 0], "scale": [0.082, 0.048, 0.012]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "glasses--1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "glasses-frame", "materialLayers": ["glasses-frame"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(25, 30, 37, 1)", "secondaryAlbedo": "rgba(25, 30, 37, 1)", "materialClass": "plastic", "materialClassConfidence": 0.8, "evidenceRefs": ["full-object"]}};
  node_glasses__1_21.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "glasses--1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["root"] ?? root).add(node_glasses__1_21);
  nodes["glasses--1"] = node_glasses__1_21;
  const mesh_glasses__1_21Geometry = endpoint_glasses__1_21
    ? new THREE.CylinderGeometry(endpoint_glasses__1_21.endRadius, endpoint_glasses__1_21.baseRadius, endpoint_glasses__1_21.length, 16, 6)
    : buildExtrudeGeometry({"points": [[-0.5, 0.35], [-0.4, 0.5], [0.42, 0.5], [0.5, 0.3], [0.4, -0.42], [-0.35, -0.5]], "depth": 1, "bevelEnabled": true, "bevelSize": 0.05, "bevelThickness": 0.03, "bevelSegments": 2});
  if (!endpoint_glasses__1_21) {
    mesh_glasses__1_21Geometry.scale(0.082, 0.048, 0.012);
  }
  const mesh_glasses__1_21 = new THREE.Mesh(
    mesh_glasses__1_21Geometry,
    materialMap["glasses-frame"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_glasses__1_21.name = "glasses--1";
  if (endpoint_glasses__1_21) {
    mesh_glasses__1_21.position.copy(endpoint_glasses__1_21.midpoint);
    mesh_glasses__1_21.quaternion.copy(endpoint_glasses__1_21.quaternion);
  }
  mesh_glasses__1_21.castShadow = options.castShadow ?? true;
  mesh_glasses__1_21.receiveShadow = options.receiveShadow ?? true;
  mesh_glasses__1_21.userData.sculptComponent = {"id": "glasses--1", "name": "glasses--1", "level": "micro", "role": "body", "importance": 1.0, "confidence": 0.78, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Contour follows the reference silhouette; depth is inferred and tested in orbit.", "geometryDescriptor": {"profile2D": {"points": [[-0.5, 0.35], [-0.4, 0.5], [0.42, 0.5], [0.5, 0.3], [0.4, -0.42], [-0.35, -0.5]], "depth": 1, "bevelEnabled": true, "bevelSize": 0.05, "bevelThickness": 0.03, "bevelSegments": 2}}, "parent": "root", "attachment": null, "dimensions": {"width": 0.082, "height": 0.048, "depth": 0.012, "units": "meters", "confidence": 0.78}, "transform": {"position": [-0.047, 1.703, 0.088], "rotation": [0, 0, 0], "scale": [0.082, 0.048, 0.012]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "glasses--1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "glasses-frame", "materialLayers": ["glasses-frame"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(25, 30, 37, 1)", "secondaryAlbedo": "rgba(25, 30, 37, 1)", "materialClass": "plastic", "materialClassConfidence": 0.8, "evidenceRefs": ["full-object"]}};
  node_glasses__1_21.add(mesh_glasses__1_21);
  meshes["glasses--1"] = mesh_glasses__1_21;
  colliders["glasses--1"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["glasses--1"] ??= [];
  destructionGroups["glasses--1"].push(node_glasses__1_21);

  const attachment_temple__1_22 = {"parentSocket": "head", "localStart": [-0.088, 1.715, 0.088], "localEnd": [-0.099, 1.69, -0.012], "contactType": "surface-embed", "embedDepth": 0.002, "gapTolerance": 0.003};
  const endpoint_temple__1_22 = null; // authored tubePath already in model coordinates
  const node_temple__1_22 = new THREE.Group();
  node_temple__1_22.name = "temple--1__pivot";
  node_temple__1_22.scale.set(1, 1, 1);
  if (endpoint_temple__1_22) {
    node_temple__1_22.position.copy(endpoint_temple__1_22.start);
    node_temple__1_22.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_temple__1_22.position.set(0.0, 0.0, 0.0);
    node_temple__1_22.rotation.set(0.0, 0.0, 0.0);
  }
  node_temple__1_22.userData.sculptComponent = {"id": "temple--1", "name": "temple--1", "level": "micro", "role": "body", "importance": 1.0, "confidence": 0.78, "primitive": "tube", "topologyClass": "assembled-solid", "topologyRationale": "Contour follows the reference silhouette; depth is inferred and tested in orbit.", "geometryDescriptor": {"tubePath": {"points": [[-0.088, 1.715, 0.088], [-0.105, 1.711, 0.03], [-0.099, 1.69, -0.012]], "radius": 0.004, "closed": false}, "attachmentGeometry": "authored-path"}, "parent": "root", "attachment": {"parentSocket": "head", "localStart": [-0.088, 1.715, 0.088], "localEnd": [-0.099, 1.69, -0.012], "contactType": "surface-embed", "embedDepth": 0.002, "gapTolerance": 0.003}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.78}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "temple--1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "glasses-frame", "materialLayers": ["glasses-frame"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(25, 30, 37, 1)", "secondaryAlbedo": "rgba(25, 30, 37, 1)", "materialClass": "plastic", "materialClassConfidence": 0.8, "evidenceRefs": ["full-object"]}};
  node_temple__1_22.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "temple--1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["root"] ?? root).add(node_temple__1_22);
  nodes["temple--1"] = node_temple__1_22;
  const mesh_temple__1_22Geometry = endpoint_temple__1_22
    ? new THREE.CylinderGeometry(endpoint_temple__1_22.endRadius, endpoint_temple__1_22.baseRadius, endpoint_temple__1_22.length, 16, 6)
    : buildTubeGeometry({"points": [[-0.088, 1.715, 0.088], [-0.105, 1.711, 0.03], [-0.099, 1.69, -0.012]], "radius": 0.004, "closed": false});
  if (!endpoint_temple__1_22) {
    mesh_temple__1_22Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_temple__1_22 = new THREE.Mesh(
    mesh_temple__1_22Geometry,
    materialMap["glasses-frame"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_temple__1_22.name = "temple--1";
  if (endpoint_temple__1_22) {
    mesh_temple__1_22.position.copy(endpoint_temple__1_22.midpoint);
    mesh_temple__1_22.quaternion.copy(endpoint_temple__1_22.quaternion);
  }
  mesh_temple__1_22.castShadow = options.castShadow ?? true;
  mesh_temple__1_22.receiveShadow = options.receiveShadow ?? true;
  mesh_temple__1_22.userData.sculptComponent = {"id": "temple--1", "name": "temple--1", "level": "micro", "role": "body", "importance": 1.0, "confidence": 0.78, "primitive": "tube", "topologyClass": "assembled-solid", "topologyRationale": "Contour follows the reference silhouette; depth is inferred and tested in orbit.", "geometryDescriptor": {"tubePath": {"points": [[-0.088, 1.715, 0.088], [-0.105, 1.711, 0.03], [-0.099, 1.69, -0.012]], "radius": 0.004, "closed": false}, "attachmentGeometry": "authored-path"}, "parent": "root", "attachment": {"parentSocket": "head", "localStart": [-0.088, 1.715, 0.088], "localEnd": [-0.099, 1.69, -0.012], "contactType": "surface-embed", "embedDepth": 0.002, "gapTolerance": 0.003}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.78}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "temple--1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "glasses-frame", "materialLayers": ["glasses-frame"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(25, 30, 37, 1)", "secondaryAlbedo": "rgba(25, 30, 37, 1)", "materialClass": "plastic", "materialClassConfidence": 0.8, "evidenceRefs": ["full-object"]}};
  node_temple__1_22.add(mesh_temple__1_22);
  meshes["temple--1"] = mesh_temple__1_22;
  colliders["temple--1"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["temple--1"] ??= [];
  destructionGroups["temple--1"].push(node_temple__1_22);

  const endpoint_ear_1_23 = makeAttachmentEndpoint(null);
  const node_ear_1_23 = new THREE.Group();
  node_ear_1_23.name = "ear-1__pivot";
  node_ear_1_23.scale.set(1, 1, 1);
  if (endpoint_ear_1_23) {
    node_ear_1_23.position.copy(endpoint_ear_1_23.start);
    node_ear_1_23.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_ear_1_23.position.set(0.098, 1.684, -0.005);
    node_ear_1_23.rotation.set(0.0, 0.0, 0.0);
  }
  node_ear_1_23.userData.sculptComponent = {"id": "ear-1", "name": "ear-1", "level": "meso", "role": "body", "importance": 1.0, "confidence": 0.78, "primitive": "ellipsoid", "topologyClass": "assembled-solid", "topologyRationale": "Contour follows the reference silhouette; depth is inferred and tested in orbit.", "geometryDescriptor": {"normalStrategy": "smooth vertex normals", "uvStrategy": "generated procedural coordinates", "edgeTreatment": {"type": "none", "bevelRadius": 0, "segments": 1}, "deformationStack": []}, "parent": "root", "attachment": null, "dimensions": {"width": 0.035, "height": 0.061, "depth": 0.033, "units": "meters", "confidence": 0.78}, "transform": {"position": [0.098, 1.684, -0.005], "rotation": [0, 0, 0], "scale": [0.035, 0.061, 0.033]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "ear-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "skin", "materialLayers": ["skin"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(213, 154, 115, 1)", "secondaryAlbedo": "rgba(213, 154, 115, 1)", "materialClass": "skin", "materialClassConfidence": 0.8, "evidenceRefs": ["full-object"]}};
  node_ear_1_23.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "ear-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["root"] ?? root).add(node_ear_1_23);
  nodes["ear-1"] = node_ear_1_23;
  const mesh_ear_1_23Geometry = endpoint_ear_1_23
    ? new THREE.CylinderGeometry(endpoint_ear_1_23.endRadius, endpoint_ear_1_23.baseRadius, endpoint_ear_1_23.length, 16, 6)
    : new THREE.SphereGeometry(0.5, 32, 20);
  if (!endpoint_ear_1_23) {
    mesh_ear_1_23Geometry.scale(0.035, 0.061, 0.033);
  }
  const mesh_ear_1_23 = new THREE.Mesh(
    mesh_ear_1_23Geometry,
    materialMap["skin"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_ear_1_23.name = "ear-1";
  if (endpoint_ear_1_23) {
    mesh_ear_1_23.position.copy(endpoint_ear_1_23.midpoint);
    mesh_ear_1_23.quaternion.copy(endpoint_ear_1_23.quaternion);
  }
  mesh_ear_1_23.castShadow = options.castShadow ?? true;
  mesh_ear_1_23.receiveShadow = options.receiveShadow ?? true;
  mesh_ear_1_23.userData.sculptComponent = {"id": "ear-1", "name": "ear-1", "level": "meso", "role": "body", "importance": 1.0, "confidence": 0.78, "primitive": "ellipsoid", "topologyClass": "assembled-solid", "topologyRationale": "Contour follows the reference silhouette; depth is inferred and tested in orbit.", "geometryDescriptor": {"normalStrategy": "smooth vertex normals", "uvStrategy": "generated procedural coordinates", "edgeTreatment": {"type": "none", "bevelRadius": 0, "segments": 1}, "deformationStack": []}, "parent": "root", "attachment": null, "dimensions": {"width": 0.035, "height": 0.061, "depth": 0.033, "units": "meters", "confidence": 0.78}, "transform": {"position": [0.098, 1.684, -0.005], "rotation": [0, 0, 0], "scale": [0.035, 0.061, 0.033]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "ear-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "skin", "materialLayers": ["skin"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(213, 154, 115, 1)", "secondaryAlbedo": "rgba(213, 154, 115, 1)", "materialClass": "skin", "materialClassConfidence": 0.8, "evidenceRefs": ["full-object"]}};
  node_ear_1_23.add(mesh_ear_1_23);
  meshes["ear-1"] = mesh_ear_1_23;
  colliders["ear-1"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["ear-1"] ??= [];
  destructionGroups["ear-1"].push(node_ear_1_23);

  const endpoint_eye_1_24 = makeAttachmentEndpoint(null);
  const node_eye_1_24 = new THREE.Group();
  node_eye_1_24.name = "eye-1__pivot";
  node_eye_1_24.scale.set(1, 1, 1);
  if (endpoint_eye_1_24) {
    node_eye_1_24.position.copy(endpoint_eye_1_24.start);
    node_eye_1_24.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_eye_1_24.position.set(0.039, 1.709, 0.07);
    node_eye_1_24.rotation.set(0.0, 0.0, 0.0);
  }
  node_eye_1_24.userData.sculptComponent = {"id": "eye-1", "name": "eye-1", "level": "micro", "role": "body", "importance": 1.0, "confidence": 0.78, "primitive": "ellipsoid", "topologyClass": "assembled-solid", "topologyRationale": "Contour follows the reference silhouette; depth is inferred and tested in orbit.", "geometryDescriptor": {"normalStrategy": "smooth vertex normals", "uvStrategy": "generated procedural coordinates", "edgeTreatment": {"type": "none", "bevelRadius": 0, "segments": 1}, "deformationStack": []}, "parent": "root", "attachment": null, "dimensions": {"width": 0.035, "height": 0.018, "depth": 0.014, "units": "meters", "confidence": 0.78}, "transform": {"position": [0.039, 1.709, 0.07], "rotation": [0, 0, 0], "scale": [0.035, 0.018, 0.014]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "eye-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "eye", "materialLayers": ["eye"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(238, 232, 222, 1)", "secondaryAlbedo": "rgba(238, 232, 222, 1)", "materialClass": "plastic", "materialClassConfidence": 0.8, "evidenceRefs": ["full-object"]}};
  node_eye_1_24.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "eye-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["root"] ?? root).add(node_eye_1_24);
  nodes["eye-1"] = node_eye_1_24;
  const mesh_eye_1_24Geometry = endpoint_eye_1_24
    ? new THREE.CylinderGeometry(endpoint_eye_1_24.endRadius, endpoint_eye_1_24.baseRadius, endpoint_eye_1_24.length, 16, 6)
    : new THREE.SphereGeometry(0.5, 32, 20);
  if (!endpoint_eye_1_24) {
    mesh_eye_1_24Geometry.scale(0.035, 0.018, 0.014);
  }
  const mesh_eye_1_24 = new THREE.Mesh(
    mesh_eye_1_24Geometry,
    materialMap["eye"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_eye_1_24.name = "eye-1";
  if (endpoint_eye_1_24) {
    mesh_eye_1_24.position.copy(endpoint_eye_1_24.midpoint);
    mesh_eye_1_24.quaternion.copy(endpoint_eye_1_24.quaternion);
  }
  mesh_eye_1_24.castShadow = options.castShadow ?? true;
  mesh_eye_1_24.receiveShadow = options.receiveShadow ?? true;
  mesh_eye_1_24.userData.sculptComponent = {"id": "eye-1", "name": "eye-1", "level": "micro", "role": "body", "importance": 1.0, "confidence": 0.78, "primitive": "ellipsoid", "topologyClass": "assembled-solid", "topologyRationale": "Contour follows the reference silhouette; depth is inferred and tested in orbit.", "geometryDescriptor": {"normalStrategy": "smooth vertex normals", "uvStrategy": "generated procedural coordinates", "edgeTreatment": {"type": "none", "bevelRadius": 0, "segments": 1}, "deformationStack": []}, "parent": "root", "attachment": null, "dimensions": {"width": 0.035, "height": 0.018, "depth": 0.014, "units": "meters", "confidence": 0.78}, "transform": {"position": [0.039, 1.709, 0.07], "rotation": [0, 0, 0], "scale": [0.035, 0.018, 0.014]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "eye-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "eye", "materialLayers": ["eye"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(238, 232, 222, 1)", "secondaryAlbedo": "rgba(238, 232, 222, 1)", "materialClass": "plastic", "materialClassConfidence": 0.8, "evidenceRefs": ["full-object"]}};
  node_eye_1_24.add(mesh_eye_1_24);
  meshes["eye-1"] = mesh_eye_1_24;
  colliders["eye-1"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["eye-1"] ??= [];
  destructionGroups["eye-1"].push(node_eye_1_24);

  const endpoint_glasses_1_25 = makeAttachmentEndpoint(null);
  const node_glasses_1_25 = new THREE.Group();
  node_glasses_1_25.name = "glasses-1__pivot";
  node_glasses_1_25.scale.set(1, 1, 1);
  if (endpoint_glasses_1_25) {
    node_glasses_1_25.position.copy(endpoint_glasses_1_25.start);
    node_glasses_1_25.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_glasses_1_25.position.set(0.047, 1.703, 0.088);
    node_glasses_1_25.rotation.set(0.0, 0.0, 0.0);
  }
  node_glasses_1_25.userData.sculptComponent = {"id": "glasses-1", "name": "glasses-1", "level": "micro", "role": "body", "importance": 1.0, "confidence": 0.78, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Contour follows the reference silhouette; depth is inferred and tested in orbit.", "geometryDescriptor": {"profile2D": {"points": [[-0.5, 0.35], [-0.4, 0.5], [0.42, 0.5], [0.5, 0.3], [0.4, -0.42], [-0.35, -0.5]], "depth": 1, "bevelEnabled": true, "bevelSize": 0.05, "bevelThickness": 0.03, "bevelSegments": 2}}, "parent": "root", "attachment": null, "dimensions": {"width": 0.082, "height": 0.048, "depth": 0.012, "units": "meters", "confidence": 0.78}, "transform": {"position": [0.047, 1.703, 0.088], "rotation": [0, 0, 0], "scale": [0.082, 0.048, 0.012]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "glasses-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "glasses-frame", "materialLayers": ["glasses-frame"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "smoked-lens", "kind": "gloss", "description": "smoked-lens", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(25, 30, 37, 1)", "secondaryAlbedo": "rgba(25, 30, 37, 1)", "materialClass": "plastic", "materialClassConfidence": 0.8, "evidenceRefs": ["full-object"]}};
  node_glasses_1_25.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "glasses-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["root"] ?? root).add(node_glasses_1_25);
  nodes["glasses-1"] = node_glasses_1_25;
  const mesh_glasses_1_25Geometry = endpoint_glasses_1_25
    ? new THREE.CylinderGeometry(endpoint_glasses_1_25.endRadius, endpoint_glasses_1_25.baseRadius, endpoint_glasses_1_25.length, 16, 6)
    : buildExtrudeGeometry({"points": [[-0.5, 0.35], [-0.4, 0.5], [0.42, 0.5], [0.5, 0.3], [0.4, -0.42], [-0.35, -0.5]], "depth": 1, "bevelEnabled": true, "bevelSize": 0.05, "bevelThickness": 0.03, "bevelSegments": 2});
  if (!endpoint_glasses_1_25) {
    mesh_glasses_1_25Geometry.scale(0.082, 0.048, 0.012);
  }
  const mesh_glasses_1_25 = new THREE.Mesh(
    mesh_glasses_1_25Geometry,
    materialMap["glasses-frame"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_glasses_1_25.name = "glasses-1";
  if (endpoint_glasses_1_25) {
    mesh_glasses_1_25.position.copy(endpoint_glasses_1_25.midpoint);
    mesh_glasses_1_25.quaternion.copy(endpoint_glasses_1_25.quaternion);
  }
  mesh_glasses_1_25.castShadow = options.castShadow ?? true;
  mesh_glasses_1_25.receiveShadow = options.receiveShadow ?? true;
  mesh_glasses_1_25.userData.sculptComponent = {"id": "glasses-1", "name": "glasses-1", "level": "micro", "role": "body", "importance": 1.0, "confidence": 0.78, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Contour follows the reference silhouette; depth is inferred and tested in orbit.", "geometryDescriptor": {"profile2D": {"points": [[-0.5, 0.35], [-0.4, 0.5], [0.42, 0.5], [0.5, 0.3], [0.4, -0.42], [-0.35, -0.5]], "depth": 1, "bevelEnabled": true, "bevelSize": 0.05, "bevelThickness": 0.03, "bevelSegments": 2}}, "parent": "root", "attachment": null, "dimensions": {"width": 0.082, "height": 0.048, "depth": 0.012, "units": "meters", "confidence": 0.78}, "transform": {"position": [0.047, 1.703, 0.088], "rotation": [0, 0, 0], "scale": [0.082, 0.048, 0.012]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "glasses-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "glasses-frame", "materialLayers": ["glasses-frame"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "smoked-lens", "kind": "gloss", "description": "smoked-lens", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(25, 30, 37, 1)", "secondaryAlbedo": "rgba(25, 30, 37, 1)", "materialClass": "plastic", "materialClassConfidence": 0.8, "evidenceRefs": ["full-object"]}};
  node_glasses_1_25.add(mesh_glasses_1_25);
  meshes["glasses-1"] = mesh_glasses_1_25;
  colliders["glasses-1"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["glasses-1"] ??= [];
  destructionGroups["glasses-1"].push(node_glasses_1_25);

  const attachment_temple_1_26 = {"parentSocket": "head", "localStart": [0.088, 1.715, 0.088], "localEnd": [0.099, 1.69, -0.012], "contactType": "surface-embed", "embedDepth": 0.002, "gapTolerance": 0.003};
  const endpoint_temple_1_26 = null; // authored tubePath already in model coordinates
  const node_temple_1_26 = new THREE.Group();
  node_temple_1_26.name = "temple-1__pivot";
  node_temple_1_26.scale.set(1, 1, 1);
  if (endpoint_temple_1_26) {
    node_temple_1_26.position.copy(endpoint_temple_1_26.start);
    node_temple_1_26.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_temple_1_26.position.set(0.0, 0.0, 0.0);
    node_temple_1_26.rotation.set(0.0, 0.0, 0.0);
  }
  node_temple_1_26.userData.sculptComponent = {"id": "temple-1", "name": "temple-1", "level": "micro", "role": "body", "importance": 1.0, "confidence": 0.78, "primitive": "tube", "topologyClass": "assembled-solid", "topologyRationale": "Contour follows the reference silhouette; depth is inferred and tested in orbit.", "geometryDescriptor": {"tubePath": {"points": [[0.088, 1.715, 0.088], [0.105, 1.711, 0.03], [0.099, 1.69, -0.012]], "radius": 0.004, "closed": false}, "attachmentGeometry": "authored-path"}, "parent": "root", "attachment": {"parentSocket": "head", "localStart": [0.088, 1.715, 0.088], "localEnd": [0.099, 1.69, -0.012], "contactType": "surface-embed", "embedDepth": 0.002, "gapTolerance": 0.003}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.78}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "temple-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "glasses-frame", "materialLayers": ["glasses-frame"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(25, 30, 37, 1)", "secondaryAlbedo": "rgba(25, 30, 37, 1)", "materialClass": "plastic", "materialClassConfidence": 0.8, "evidenceRefs": ["full-object"]}};
  node_temple_1_26.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "temple-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["root"] ?? root).add(node_temple_1_26);
  nodes["temple-1"] = node_temple_1_26;
  const mesh_temple_1_26Geometry = endpoint_temple_1_26
    ? new THREE.CylinderGeometry(endpoint_temple_1_26.endRadius, endpoint_temple_1_26.baseRadius, endpoint_temple_1_26.length, 16, 6)
    : buildTubeGeometry({"points": [[0.088, 1.715, 0.088], [0.105, 1.711, 0.03], [0.099, 1.69, -0.012]], "radius": 0.004, "closed": false});
  if (!endpoint_temple_1_26) {
    mesh_temple_1_26Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_temple_1_26 = new THREE.Mesh(
    mesh_temple_1_26Geometry,
    materialMap["glasses-frame"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_temple_1_26.name = "temple-1";
  if (endpoint_temple_1_26) {
    mesh_temple_1_26.position.copy(endpoint_temple_1_26.midpoint);
    mesh_temple_1_26.quaternion.copy(endpoint_temple_1_26.quaternion);
  }
  mesh_temple_1_26.castShadow = options.castShadow ?? true;
  mesh_temple_1_26.receiveShadow = options.receiveShadow ?? true;
  mesh_temple_1_26.userData.sculptComponent = {"id": "temple-1", "name": "temple-1", "level": "micro", "role": "body", "importance": 1.0, "confidence": 0.78, "primitive": "tube", "topologyClass": "assembled-solid", "topologyRationale": "Contour follows the reference silhouette; depth is inferred and tested in orbit.", "geometryDescriptor": {"tubePath": {"points": [[0.088, 1.715, 0.088], [0.105, 1.711, 0.03], [0.099, 1.69, -0.012]], "radius": 0.004, "closed": false}, "attachmentGeometry": "authored-path"}, "parent": "root", "attachment": {"parentSocket": "head", "localStart": [0.088, 1.715, 0.088], "localEnd": [0.099, 1.69, -0.012], "contactType": "surface-embed", "embedDepth": 0.002, "gapTolerance": 0.003}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.78}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "temple-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "glasses-frame", "materialLayers": ["glasses-frame"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(25, 30, 37, 1)", "secondaryAlbedo": "rgba(25, 30, 37, 1)", "materialClass": "plastic", "materialClassConfidence": 0.8, "evidenceRefs": ["full-object"]}};
  node_temple_1_26.add(mesh_temple_1_26);
  meshes["temple-1"] = mesh_temple_1_26;
  colliders["temple-1"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["temple-1"] ??= [];
  destructionGroups["temple-1"].push(node_temple_1_26);

  const attachment_glasses_bridge_27 = {"parentSocket": "head", "localStart": [-0.012, 1.716, 0.097], "localEnd": [0.012, 1.716, 0.097], "contactType": "surface-embed", "embedDepth": 0.002, "gapTolerance": 0.003};
  const endpoint_glasses_bridge_27 = null; // authored tubePath already in model coordinates
  const node_glasses_bridge_27 = new THREE.Group();
  node_glasses_bridge_27.name = "glasses-bridge__pivot";
  node_glasses_bridge_27.scale.set(1, 1, 1);
  if (endpoint_glasses_bridge_27) {
    node_glasses_bridge_27.position.copy(endpoint_glasses_bridge_27.start);
    node_glasses_bridge_27.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_glasses_bridge_27.position.set(0.0, 0.0, 0.0);
    node_glasses_bridge_27.rotation.set(0.0, 0.0, 0.0);
  }
  node_glasses_bridge_27.userData.sculptComponent = {"id": "glasses-bridge", "name": "glasses-bridge", "level": "micro", "role": "body", "importance": 1.0, "confidence": 0.78, "primitive": "tube", "topologyClass": "assembled-solid", "topologyRationale": "Contour follows the reference silhouette; depth is inferred and tested in orbit.", "geometryDescriptor": {"tubePath": {"points": [[-0.012, 1.716, 0.097], [0, 1.722, 0.103], [0.012, 1.716, 0.097]], "radius": 0.004, "closed": false}, "attachmentGeometry": "authored-path"}, "parent": "root", "attachment": {"parentSocket": "head", "localStart": [-0.012, 1.716, 0.097], "localEnd": [0.012, 1.716, 0.097], "contactType": "surface-embed", "embedDepth": 0.002, "gapTolerance": 0.003}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.78}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "glasses-bridge", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "glasses-frame", "materialLayers": ["glasses-frame"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "eyewear-bridge", "kind": "contour", "description": "eyewear-bridge", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(25, 30, 37, 1)", "secondaryAlbedo": "rgba(25, 30, 37, 1)", "materialClass": "plastic", "materialClassConfidence": 0.8, "evidenceRefs": ["full-object"]}};
  node_glasses_bridge_27.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "glasses-bridge", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["root"] ?? root).add(node_glasses_bridge_27);
  nodes["glasses-bridge"] = node_glasses_bridge_27;
  const mesh_glasses_bridge_27Geometry = endpoint_glasses_bridge_27
    ? new THREE.CylinderGeometry(endpoint_glasses_bridge_27.endRadius, endpoint_glasses_bridge_27.baseRadius, endpoint_glasses_bridge_27.length, 16, 6)
    : buildTubeGeometry({"points": [[-0.012, 1.716, 0.097], [0, 1.722, 0.103], [0.012, 1.716, 0.097]], "radius": 0.004, "closed": false});
  if (!endpoint_glasses_bridge_27) {
    mesh_glasses_bridge_27Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_glasses_bridge_27 = new THREE.Mesh(
    mesh_glasses_bridge_27Geometry,
    materialMap["glasses-frame"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_glasses_bridge_27.name = "glasses-bridge";
  if (endpoint_glasses_bridge_27) {
    mesh_glasses_bridge_27.position.copy(endpoint_glasses_bridge_27.midpoint);
    mesh_glasses_bridge_27.quaternion.copy(endpoint_glasses_bridge_27.quaternion);
  }
  mesh_glasses_bridge_27.castShadow = options.castShadow ?? true;
  mesh_glasses_bridge_27.receiveShadow = options.receiveShadow ?? true;
  mesh_glasses_bridge_27.userData.sculptComponent = {"id": "glasses-bridge", "name": "glasses-bridge", "level": "micro", "role": "body", "importance": 1.0, "confidence": 0.78, "primitive": "tube", "topologyClass": "assembled-solid", "topologyRationale": "Contour follows the reference silhouette; depth is inferred and tested in orbit.", "geometryDescriptor": {"tubePath": {"points": [[-0.012, 1.716, 0.097], [0, 1.722, 0.103], [0.012, 1.716, 0.097]], "radius": 0.004, "closed": false}, "attachmentGeometry": "authored-path"}, "parent": "root", "attachment": {"parentSocket": "head", "localStart": [-0.012, 1.716, 0.097], "localEnd": [0.012, 1.716, 0.097], "contactType": "surface-embed", "embedDepth": 0.002, "gapTolerance": 0.003}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.78}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "glasses-bridge", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "glasses-frame", "materialLayers": ["glasses-frame"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "eyewear-bridge", "kind": "contour", "description": "eyewear-bridge", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(25, 30, 37, 1)", "secondaryAlbedo": "rgba(25, 30, 37, 1)", "materialClass": "plastic", "materialClassConfidence": 0.8, "evidenceRefs": ["full-object"]}};
  node_glasses_bridge_27.add(mesh_glasses_bridge_27);
  meshes["glasses-bridge"] = mesh_glasses_bridge_27;
  colliders["glasses-bridge"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["glasses-bridge"] ??= [];
  destructionGroups["glasses-bridge"].push(node_glasses_bridge_27);

  const attachment_mouth_28 = {"parentSocket": "head", "localStart": [-0.03, 1.627, 0.069], "localEnd": [0.029, 1.63, 0.069], "contactType": "surface-embed", "embedDepth": 0.002, "gapTolerance": 0.003};
  const endpoint_mouth_28 = null; // authored tubePath already in model coordinates
  const node_mouth_28 = new THREE.Group();
  node_mouth_28.name = "mouth__pivot";
  node_mouth_28.scale.set(1, 1, 1);
  if (endpoint_mouth_28) {
    node_mouth_28.position.copy(endpoint_mouth_28.start);
    node_mouth_28.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_mouth_28.position.set(0.0, 0.0, 0.0);
    node_mouth_28.rotation.set(0.0, 0.0, 0.0);
  }
  node_mouth_28.userData.sculptComponent = {"id": "mouth", "name": "mouth", "level": "micro", "role": "body", "importance": 1.0, "confidence": 0.78, "primitive": "tube", "topologyClass": "assembled-solid", "topologyRationale": "Contour follows the reference silhouette; depth is inferred and tested in orbit.", "geometryDescriptor": {"tubePath": {"points": [[-0.027, 1.635, 0.068], [-0.01, 1.631, 0.073], [0.01, 1.632, 0.073], [0.027, 1.638, 0.067]], "radius": 0.001, "closed": false}, "attachmentGeometry": "authored-path"}, "parent": "root", "attachment": {"parentSocket": "head", "localStart": [-0.03, 1.627, 0.069], "localEnd": [0.029, 1.63, 0.069], "contactType": "surface-embed", "embedDepth": 0.002, "gapTolerance": 0.003}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.78}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "mouth", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "lips", "materialLayers": ["lips"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(161, 106, 89, 1)", "secondaryAlbedo": "rgba(161, 106, 89, 1)", "materialClass": "plastic", "materialClassConfidence": 0.8, "evidenceRefs": ["full-object"]}};
  node_mouth_28.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "mouth", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["root"] ?? root).add(node_mouth_28);
  nodes["mouth"] = node_mouth_28;
  const mesh_mouth_28Geometry = endpoint_mouth_28
    ? new THREE.CylinderGeometry(endpoint_mouth_28.endRadius, endpoint_mouth_28.baseRadius, endpoint_mouth_28.length, 16, 6)
    : buildTubeGeometry({"points": [[-0.027, 1.635, 0.068], [-0.01, 1.631, 0.073], [0.01, 1.632, 0.073], [0.027, 1.638, 0.067]], "radius": 0.001, "closed": false});
  if (!endpoint_mouth_28) {
    mesh_mouth_28Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_mouth_28 = new THREE.Mesh(
    mesh_mouth_28Geometry,
    materialMap["lips"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_mouth_28.name = "mouth";
  if (endpoint_mouth_28) {
    mesh_mouth_28.position.copy(endpoint_mouth_28.midpoint);
    mesh_mouth_28.quaternion.copy(endpoint_mouth_28.quaternion);
  }
  mesh_mouth_28.castShadow = options.castShadow ?? true;
  mesh_mouth_28.receiveShadow = options.receiveShadow ?? true;
  mesh_mouth_28.userData.sculptComponent = {"id": "mouth", "name": "mouth", "level": "micro", "role": "body", "importance": 1.0, "confidence": 0.78, "primitive": "tube", "topologyClass": "assembled-solid", "topologyRationale": "Contour follows the reference silhouette; depth is inferred and tested in orbit.", "geometryDescriptor": {"tubePath": {"points": [[-0.027, 1.635, 0.068], [-0.01, 1.631, 0.073], [0.01, 1.632, 0.073], [0.027, 1.638, 0.067]], "radius": 0.001, "closed": false}, "attachmentGeometry": "authored-path"}, "parent": "root", "attachment": {"parentSocket": "head", "localStart": [-0.03, 1.627, 0.069], "localEnd": [0.029, 1.63, 0.069], "contactType": "surface-embed", "embedDepth": 0.002, "gapTolerance": 0.003}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.78}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "mouth", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "lips", "materialLayers": ["lips"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(161, 106, 89, 1)", "secondaryAlbedo": "rgba(161, 106, 89, 1)", "materialClass": "plastic", "materialClassConfidence": 0.8, "evidenceRefs": ["full-object"]}};
  node_mouth_28.add(mesh_mouth_28);
  meshes["mouth"] = mesh_mouth_28;
  colliders["mouth"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["mouth"] ??= [];
  destructionGroups["mouth"].push(node_mouth_28);

  const endpoint_cap_29 = makeAttachmentEndpoint(null);
  const node_cap_29 = new THREE.Group();
  node_cap_29.name = "cap__pivot";
  node_cap_29.scale.set(1, 1, 1);
  if (endpoint_cap_29) {
    node_cap_29.position.copy(endpoint_cap_29.start);
    node_cap_29.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_cap_29.position.set(0.0, 0.0, 0.0);
    node_cap_29.rotation.set(0.0, 0.0, 0.0);
  }
  node_cap_29.userData.sculptComponent = {"id": "cap", "name": "cap", "level": "meso", "role": "body", "importance": 1.0, "confidence": 0.78, "primitive": "tapered-sweep", "topologyClass": "continuous-sculpt", "topologyRationale": "Contour follows the reference silhouette; depth is inferred and tested in orbit.", "geometryDescriptor": {"taperedSweep": {"stations": [{"position": [0, 1.745, -0.017], "rx": 0.091, "rz": 0.101, "twist": 0}, {"position": [0, 1.775, -0.019], "rx": 0.089, "rz": 0.098, "twist": 0}, {"position": [0, 1.81, -0.019], "rx": 0.078, "rz": 0.083, "twist": 0}, {"position": [0, 1.837, -0.019], "rx": 0.05, "rz": 0.052, "twist": 0}, {"position": [0, 1.846, -0.019], "rx": 0.003, "rz": 0.003, "twist": 0}], "radialSegments": 24, "capEnds": true}, "normalStrategy": "smooth vertex normals", "backFit": {"centreY": 1.754, "heightRadius": 0.065, "centreZ": -0.017, "depth": 0.03}}, "parent": "root", "attachment": null, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.78}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "cap", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "cap", "materialLayers": ["cap"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "cap-seam", "kind": "seam", "description": "cap-seam", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(36, 35, 44, 1)", "secondaryAlbedo": "rgba(36, 35, 44, 1)", "materialClass": "fabric", "materialClassConfidence": 0.8, "evidenceRefs": ["full-object"]}};
  node_cap_29.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "cap", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["root"] ?? root).add(node_cap_29);
  nodes["cap"] = node_cap_29;
  const mesh_cap_29Geometry = endpoint_cap_29
    ? new THREE.CylinderGeometry(endpoint_cap_29.endRadius, endpoint_cap_29.baseRadius, endpoint_cap_29.length, 16, 6)
    : buildTaperedSweepGeometry({"stations": [{"position": [0, 1.745, -0.017], "rx": 0.091, "rz": 0.101, "twist": 0}, {"position": [0, 1.775, -0.019], "rx": 0.089, "rz": 0.098, "twist": 0}, {"position": [0, 1.81, -0.019], "rx": 0.078, "rz": 0.083, "twist": 0}, {"position": [0, 1.837, -0.019], "rx": 0.05, "rz": 0.052, "twist": 0}, {"position": [0, 1.846, -0.019], "rx": 0.003, "rz": 0.003, "twist": 0}], "radialSegments": 24, "capEnds": true});
  if (!endpoint_cap_29) {
    mesh_cap_29Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_cap_29 = new THREE.Mesh(
    mesh_cap_29Geometry,
    materialMap["cap"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_cap_29.name = "cap";
  if (endpoint_cap_29) {
    mesh_cap_29.position.copy(endpoint_cap_29.midpoint);
    mesh_cap_29.quaternion.copy(endpoint_cap_29.quaternion);
  }
  mesh_cap_29.castShadow = options.castShadow ?? true;
  mesh_cap_29.receiveShadow = options.receiveShadow ?? true;
  mesh_cap_29.userData.sculptComponent = {"id": "cap", "name": "cap", "level": "meso", "role": "body", "importance": 1.0, "confidence": 0.78, "primitive": "tapered-sweep", "topologyClass": "continuous-sculpt", "topologyRationale": "Contour follows the reference silhouette; depth is inferred and tested in orbit.", "geometryDescriptor": {"taperedSweep": {"stations": [{"position": [0, 1.745, -0.017], "rx": 0.091, "rz": 0.101, "twist": 0}, {"position": [0, 1.775, -0.019], "rx": 0.089, "rz": 0.098, "twist": 0}, {"position": [0, 1.81, -0.019], "rx": 0.078, "rz": 0.083, "twist": 0}, {"position": [0, 1.837, -0.019], "rx": 0.05, "rz": 0.052, "twist": 0}, {"position": [0, 1.846, -0.019], "rx": 0.003, "rz": 0.003, "twist": 0}], "radialSegments": 24, "capEnds": true}, "normalStrategy": "smooth vertex normals", "backFit": {"centreY": 1.754, "heightRadius": 0.065, "centreZ": -0.017, "depth": 0.03}}, "parent": "root", "attachment": null, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.78}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "cap", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "cap", "materialLayers": ["cap"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "cap-seam", "kind": "seam", "description": "cap-seam", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(36, 35, 44, 1)", "secondaryAlbedo": "rgba(36, 35, 44, 1)", "materialClass": "fabric", "materialClassConfidence": 0.8, "evidenceRefs": ["full-object"]}};
  node_cap_29.add(mesh_cap_29);
  meshes["cap"] = mesh_cap_29;
  colliders["cap"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["cap"] ??= [];
  destructionGroups["cap"].push(node_cap_29);

  const endpoint_cap_brim_30 = makeAttachmentEndpoint(null);
  const node_cap_brim_30 = new THREE.Group();
  node_cap_brim_30.name = "cap-brim__pivot";
  node_cap_brim_30.scale.set(1, 1, 1);
  if (endpoint_cap_brim_30) {
    node_cap_brim_30.position.copy(endpoint_cap_brim_30.start);
    node_cap_brim_30.rotation.set(1.5707963267948966, 0.0, -0.45);
  } else {
    node_cap_brim_30.position.set(0.0, 1.751, -0.067);
    node_cap_brim_30.rotation.set(1.5707963267948966, 0.0, -0.45);
  }
  node_cap_brim_30.userData.sculptComponent = {"id": "cap-brim", "name": "cap-brim", "level": "meso", "role": "body", "importance": 1.0, "confidence": 0.78, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Contour follows the reference silhouette; depth is inferred and tested in orbit.", "geometryDescriptor": {"profile2D": {"points": [[-0.45, 0], [-0.55, -0.4], [-0.48, -0.75], [-0.2, -0.95], [0.2, -0.95], [0.48, -0.75], [0.55, -0.4], [0.45, 0]], "depth": 1, "bevelEnabled": true, "bevelSize": 0.035, "bevelThickness": 0.03, "bevelSegments": 2}}, "parent": "root", "attachment": null, "dimensions": {"width": 0.18, "height": 0.18, "depth": 0.008, "units": "meters", "confidence": 0.78}, "transform": {"position": [0, 1.751, -0.067], "rotation": [1.5707963267948966, 0, -0.45], "scale": [0.18, 0.18, 0.008]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "cap-brim", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "cap", "materialLayers": ["cap"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "cap-brim", "kind": "contour", "description": "cap-brim", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(36, 35, 44, 1)", "secondaryAlbedo": "rgba(36, 35, 44, 1)", "materialClass": "fabric", "materialClassConfidence": 0.8, "evidenceRefs": ["full-object"]}};
  node_cap_brim_30.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "cap-brim", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["root"] ?? root).add(node_cap_brim_30);
  nodes["cap-brim"] = node_cap_brim_30;
  const mesh_cap_brim_30Geometry = endpoint_cap_brim_30
    ? new THREE.CylinderGeometry(endpoint_cap_brim_30.endRadius, endpoint_cap_brim_30.baseRadius, endpoint_cap_brim_30.length, 16, 6)
    : buildExtrudeGeometry({"points": [[-0.45, 0], [-0.55, -0.4], [-0.48, -0.75], [-0.2, -0.95], [0.2, -0.95], [0.48, -0.75], [0.55, -0.4], [0.45, 0]], "depth": 1, "bevelEnabled": true, "bevelSize": 0.035, "bevelThickness": 0.03, "bevelSegments": 2});
  if (!endpoint_cap_brim_30) {
    mesh_cap_brim_30Geometry.scale(0.18, 0.18, 0.008);
  }
  const mesh_cap_brim_30 = new THREE.Mesh(
    mesh_cap_brim_30Geometry,
    materialMap["cap"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_cap_brim_30.name = "cap-brim";
  if (endpoint_cap_brim_30) {
    mesh_cap_brim_30.position.copy(endpoint_cap_brim_30.midpoint);
    mesh_cap_brim_30.quaternion.copy(endpoint_cap_brim_30.quaternion);
  }
  mesh_cap_brim_30.castShadow = options.castShadow ?? true;
  mesh_cap_brim_30.receiveShadow = options.receiveShadow ?? true;
  mesh_cap_brim_30.userData.sculptComponent = {"id": "cap-brim", "name": "cap-brim", "level": "meso", "role": "body", "importance": 1.0, "confidence": 0.78, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Contour follows the reference silhouette; depth is inferred and tested in orbit.", "geometryDescriptor": {"profile2D": {"points": [[-0.45, 0], [-0.55, -0.4], [-0.48, -0.75], [-0.2, -0.95], [0.2, -0.95], [0.48, -0.75], [0.55, -0.4], [0.45, 0]], "depth": 1, "bevelEnabled": true, "bevelSize": 0.035, "bevelThickness": 0.03, "bevelSegments": 2}}, "parent": "root", "attachment": null, "dimensions": {"width": 0.18, "height": 0.18, "depth": 0.008, "units": "meters", "confidence": 0.78}, "transform": {"position": [0, 1.751, -0.067], "rotation": [1.5707963267948966, 0, -0.45], "scale": [0.18, 0.18, 0.008]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "cap-brim", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "cap", "materialLayers": ["cap"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "cap-brim", "kind": "contour", "description": "cap-brim", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(36, 35, 44, 1)", "secondaryAlbedo": "rgba(36, 35, 44, 1)", "materialClass": "fabric", "materialClassConfidence": 0.8, "evidenceRefs": ["full-object"]}};
  node_cap_brim_30.add(mesh_cap_brim_30);
  meshes["cap-brim"] = mesh_cap_brim_30;
  colliders["cap-brim"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["cap-brim"] ??= [];
  destructionGroups["cap-brim"].push(node_cap_brim_30);

  const endpoint_fringe_0_31 = makeAttachmentEndpoint(null);
  const node_fringe_0_31 = new THREE.Group();
  node_fringe_0_31.name = "fringe-0__pivot";
  node_fringe_0_31.scale.set(1, 1, 1);
  if (endpoint_fringe_0_31) {
    node_fringe_0_31.position.copy(endpoint_fringe_0_31.start);
    node_fringe_0_31.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_fringe_0_31.position.set(0.0, 0.0, 0.0);
    node_fringe_0_31.rotation.set(0.0, 0.0, 0.0);
  }
  node_fringe_0_31.userData.sculptComponent = {"id": "fringe-0", "name": "fringe-0", "level": "micro", "role": "body", "importance": 1.0, "confidence": 0.78, "primitive": "tapered-sweep", "topologyClass": "continuous-sculpt", "topologyRationale": "Contour follows the reference silhouette; depth is inferred and tested in orbit.", "geometryDescriptor": {"taperedSweep": {"stations": [{"position": [-0.065, 1.775, 0.035], "rx": 0.032, "rz": 0.025, "twist": 0}, {"position": [-0.04, 1.788, 0.072], "rx": 0.028, "rz": 0.021, "twist": 0}, {"position": [-0.017, 1.774, 0.098], "rx": 0.018, "rz": 0.012, "twist": 0}, {"position": [0.0, 1.753, 0.105], "rx": 0, "rz": 0, "twist": 0}], "radialSegments": 12, "capEnds": true}, "normalStrategy": "smooth vertex normals"}, "parent": "root", "attachment": null, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.78}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "fringe-0", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "hair", "materialLayers": ["hair"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "swept-fringe", "kind": "contour", "description": "swept-fringe", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(52, 40, 43, 1)", "secondaryAlbedo": "rgba(52, 40, 43, 1)", "materialClass": "plastic", "materialClassConfidence": 0.8, "evidenceRefs": ["full-object"]}};
  node_fringe_0_31.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "fringe-0", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["root"] ?? root).add(node_fringe_0_31);
  nodes["fringe-0"] = node_fringe_0_31;
  const mesh_fringe_0_31Geometry = endpoint_fringe_0_31
    ? new THREE.CylinderGeometry(endpoint_fringe_0_31.endRadius, endpoint_fringe_0_31.baseRadius, endpoint_fringe_0_31.length, 16, 6)
    : buildTaperedSweepGeometry({"stations": [{"position": [-0.065, 1.775, 0.035], "rx": 0.032, "rz": 0.025, "twist": 0}, {"position": [-0.04, 1.788, 0.072], "rx": 0.028, "rz": 0.021, "twist": 0}, {"position": [-0.017, 1.774, 0.098], "rx": 0.018, "rz": 0.012, "twist": 0}, {"position": [0.0, 1.753, 0.105], "rx": 0, "rz": 0, "twist": 0}], "radialSegments": 12, "capEnds": true});
  if (!endpoint_fringe_0_31) {
    mesh_fringe_0_31Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_fringe_0_31 = new THREE.Mesh(
    mesh_fringe_0_31Geometry,
    materialMap["hair"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_fringe_0_31.name = "fringe-0";
  if (endpoint_fringe_0_31) {
    mesh_fringe_0_31.position.copy(endpoint_fringe_0_31.midpoint);
    mesh_fringe_0_31.quaternion.copy(endpoint_fringe_0_31.quaternion);
  }
  mesh_fringe_0_31.castShadow = options.castShadow ?? true;
  mesh_fringe_0_31.receiveShadow = options.receiveShadow ?? true;
  mesh_fringe_0_31.userData.sculptComponent = {"id": "fringe-0", "name": "fringe-0", "level": "micro", "role": "body", "importance": 1.0, "confidence": 0.78, "primitive": "tapered-sweep", "topologyClass": "continuous-sculpt", "topologyRationale": "Contour follows the reference silhouette; depth is inferred and tested in orbit.", "geometryDescriptor": {"taperedSweep": {"stations": [{"position": [-0.065, 1.775, 0.035], "rx": 0.032, "rz": 0.025, "twist": 0}, {"position": [-0.04, 1.788, 0.072], "rx": 0.028, "rz": 0.021, "twist": 0}, {"position": [-0.017, 1.774, 0.098], "rx": 0.018, "rz": 0.012, "twist": 0}, {"position": [0.0, 1.753, 0.105], "rx": 0, "rz": 0, "twist": 0}], "radialSegments": 12, "capEnds": true}, "normalStrategy": "smooth vertex normals"}, "parent": "root", "attachment": null, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.78}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "fringe-0", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "hair", "materialLayers": ["hair"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "swept-fringe", "kind": "contour", "description": "swept-fringe", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(52, 40, 43, 1)", "secondaryAlbedo": "rgba(52, 40, 43, 1)", "materialClass": "plastic", "materialClassConfidence": 0.8, "evidenceRefs": ["full-object"]}};
  node_fringe_0_31.add(mesh_fringe_0_31);
  meshes["fringe-0"] = mesh_fringe_0_31;
  colliders["fringe-0"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["fringe-0"] ??= [];
  destructionGroups["fringe-0"].push(node_fringe_0_31);

  const endpoint_fringe_1_32 = makeAttachmentEndpoint(null);
  const node_fringe_1_32 = new THREE.Group();
  node_fringe_1_32.name = "fringe-1__pivot";
  node_fringe_1_32.scale.set(1, 1, 1);
  if (endpoint_fringe_1_32) {
    node_fringe_1_32.position.copy(endpoint_fringe_1_32.start);
    node_fringe_1_32.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_fringe_1_32.position.set(0.0, 0.0, 0.0);
    node_fringe_1_32.rotation.set(0.0, 0.0, 0.0);
  }
  node_fringe_1_32.userData.sculptComponent = {"id": "fringe-1", "name": "fringe-1", "level": "micro", "role": "body", "importance": 1.0, "confidence": 0.78, "primitive": "tapered-sweep", "topologyClass": "continuous-sculpt", "topologyRationale": "Contour follows the reference silhouette; depth is inferred and tested in orbit.", "geometryDescriptor": {"taperedSweep": {"stations": [{"position": [-0.038000000000000006, 1.775, 0.035], "rx": 0.032, "rz": 0.025, "twist": 0}, {"position": [-0.013000000000000005, 1.788, 0.072], "rx": 0.028, "rz": 0.021, "twist": 0}, {"position": [0.009999999999999995, 1.774, 0.098], "rx": 0.018, "rz": 0.012, "twist": 0}, {"position": [0.026999999999999996, 1.753, 0.105], "rx": 0, "rz": 0, "twist": 0}], "radialSegments": 12, "capEnds": true}, "normalStrategy": "smooth vertex normals"}, "parent": "root", "attachment": null, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.78}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "fringe-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "hair", "materialLayers": ["hair"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(52, 40, 43, 1)", "secondaryAlbedo": "rgba(52, 40, 43, 1)", "materialClass": "plastic", "materialClassConfidence": 0.8, "evidenceRefs": ["full-object"]}};
  node_fringe_1_32.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "fringe-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["root"] ?? root).add(node_fringe_1_32);
  nodes["fringe-1"] = node_fringe_1_32;
  const mesh_fringe_1_32Geometry = endpoint_fringe_1_32
    ? new THREE.CylinderGeometry(endpoint_fringe_1_32.endRadius, endpoint_fringe_1_32.baseRadius, endpoint_fringe_1_32.length, 16, 6)
    : buildTaperedSweepGeometry({"stations": [{"position": [-0.038000000000000006, 1.775, 0.035], "rx": 0.032, "rz": 0.025, "twist": 0}, {"position": [-0.013000000000000005, 1.788, 0.072], "rx": 0.028, "rz": 0.021, "twist": 0}, {"position": [0.009999999999999995, 1.774, 0.098], "rx": 0.018, "rz": 0.012, "twist": 0}, {"position": [0.026999999999999996, 1.753, 0.105], "rx": 0, "rz": 0, "twist": 0}], "radialSegments": 12, "capEnds": true});
  if (!endpoint_fringe_1_32) {
    mesh_fringe_1_32Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_fringe_1_32 = new THREE.Mesh(
    mesh_fringe_1_32Geometry,
    materialMap["hair"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_fringe_1_32.name = "fringe-1";
  if (endpoint_fringe_1_32) {
    mesh_fringe_1_32.position.copy(endpoint_fringe_1_32.midpoint);
    mesh_fringe_1_32.quaternion.copy(endpoint_fringe_1_32.quaternion);
  }
  mesh_fringe_1_32.castShadow = options.castShadow ?? true;
  mesh_fringe_1_32.receiveShadow = options.receiveShadow ?? true;
  mesh_fringe_1_32.userData.sculptComponent = {"id": "fringe-1", "name": "fringe-1", "level": "micro", "role": "body", "importance": 1.0, "confidence": 0.78, "primitive": "tapered-sweep", "topologyClass": "continuous-sculpt", "topologyRationale": "Contour follows the reference silhouette; depth is inferred and tested in orbit.", "geometryDescriptor": {"taperedSweep": {"stations": [{"position": [-0.038000000000000006, 1.775, 0.035], "rx": 0.032, "rz": 0.025, "twist": 0}, {"position": [-0.013000000000000005, 1.788, 0.072], "rx": 0.028, "rz": 0.021, "twist": 0}, {"position": [0.009999999999999995, 1.774, 0.098], "rx": 0.018, "rz": 0.012, "twist": 0}, {"position": [0.026999999999999996, 1.753, 0.105], "rx": 0, "rz": 0, "twist": 0}], "radialSegments": 12, "capEnds": true}, "normalStrategy": "smooth vertex normals"}, "parent": "root", "attachment": null, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.78}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "fringe-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "hair", "materialLayers": ["hair"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(52, 40, 43, 1)", "secondaryAlbedo": "rgba(52, 40, 43, 1)", "materialClass": "plastic", "materialClassConfidence": 0.8, "evidenceRefs": ["full-object"]}};
  node_fringe_1_32.add(mesh_fringe_1_32);
  meshes["fringe-1"] = mesh_fringe_1_32;
  colliders["fringe-1"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["fringe-1"] ??= [];
  destructionGroups["fringe-1"].push(node_fringe_1_32);

  const endpoint_fringe_2_33 = makeAttachmentEndpoint(null);
  const node_fringe_2_33 = new THREE.Group();
  node_fringe_2_33.name = "fringe-2__pivot";
  node_fringe_2_33.scale.set(1, 1, 1);
  if (endpoint_fringe_2_33) {
    node_fringe_2_33.position.copy(endpoint_fringe_2_33.start);
    node_fringe_2_33.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_fringe_2_33.position.set(0.0, 0.0, 0.0);
    node_fringe_2_33.rotation.set(0.0, 0.0, 0.0);
  }
  node_fringe_2_33.userData.sculptComponent = {"id": "fringe-2", "name": "fringe-2", "level": "micro", "role": "body", "importance": 1.0, "confidence": 0.78, "primitive": "tapered-sweep", "topologyClass": "continuous-sculpt", "topologyRationale": "Contour follows the reference silhouette; depth is inferred and tested in orbit.", "geometryDescriptor": {"taperedSweep": {"stations": [{"position": [-0.011000000000000003, 1.775, 0.035], "rx": 0.032, "rz": 0.025, "twist": 0}, {"position": [0.013999999999999999, 1.788, 0.072], "rx": 0.028, "rz": 0.021, "twist": 0}, {"position": [0.037, 1.774, 0.098], "rx": 0.018, "rz": 0.012, "twist": 0}, {"position": [0.054, 1.753, 0.105], "rx": 0, "rz": 0, "twist": 0}], "radialSegments": 12, "capEnds": true}, "normalStrategy": "smooth vertex normals"}, "parent": "root", "attachment": null, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.78}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "fringe-2", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "hair", "materialLayers": ["hair"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(52, 40, 43, 1)", "secondaryAlbedo": "rgba(52, 40, 43, 1)", "materialClass": "plastic", "materialClassConfidence": 0.8, "evidenceRefs": ["full-object"]}};
  node_fringe_2_33.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "fringe-2", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["root"] ?? root).add(node_fringe_2_33);
  nodes["fringe-2"] = node_fringe_2_33;
  const mesh_fringe_2_33Geometry = endpoint_fringe_2_33
    ? new THREE.CylinderGeometry(endpoint_fringe_2_33.endRadius, endpoint_fringe_2_33.baseRadius, endpoint_fringe_2_33.length, 16, 6)
    : buildTaperedSweepGeometry({"stations": [{"position": [-0.011000000000000003, 1.775, 0.035], "rx": 0.032, "rz": 0.025, "twist": 0}, {"position": [0.013999999999999999, 1.788, 0.072], "rx": 0.028, "rz": 0.021, "twist": 0}, {"position": [0.037, 1.774, 0.098], "rx": 0.018, "rz": 0.012, "twist": 0}, {"position": [0.054, 1.753, 0.105], "rx": 0, "rz": 0, "twist": 0}], "radialSegments": 12, "capEnds": true});
  if (!endpoint_fringe_2_33) {
    mesh_fringe_2_33Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_fringe_2_33 = new THREE.Mesh(
    mesh_fringe_2_33Geometry,
    materialMap["hair"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_fringe_2_33.name = "fringe-2";
  if (endpoint_fringe_2_33) {
    mesh_fringe_2_33.position.copy(endpoint_fringe_2_33.midpoint);
    mesh_fringe_2_33.quaternion.copy(endpoint_fringe_2_33.quaternion);
  }
  mesh_fringe_2_33.castShadow = options.castShadow ?? true;
  mesh_fringe_2_33.receiveShadow = options.receiveShadow ?? true;
  mesh_fringe_2_33.userData.sculptComponent = {"id": "fringe-2", "name": "fringe-2", "level": "micro", "role": "body", "importance": 1.0, "confidence": 0.78, "primitive": "tapered-sweep", "topologyClass": "continuous-sculpt", "topologyRationale": "Contour follows the reference silhouette; depth is inferred and tested in orbit.", "geometryDescriptor": {"taperedSweep": {"stations": [{"position": [-0.011000000000000003, 1.775, 0.035], "rx": 0.032, "rz": 0.025, "twist": 0}, {"position": [0.013999999999999999, 1.788, 0.072], "rx": 0.028, "rz": 0.021, "twist": 0}, {"position": [0.037, 1.774, 0.098], "rx": 0.018, "rz": 0.012, "twist": 0}, {"position": [0.054, 1.753, 0.105], "rx": 0, "rz": 0, "twist": 0}], "radialSegments": 12, "capEnds": true}, "normalStrategy": "smooth vertex normals"}, "parent": "root", "attachment": null, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.78}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "fringe-2", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "hair", "materialLayers": ["hair"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(52, 40, 43, 1)", "secondaryAlbedo": "rgba(52, 40, 43, 1)", "materialClass": "plastic", "materialClassConfidence": 0.8, "evidenceRefs": ["full-object"]}};
  node_fringe_2_33.add(mesh_fringe_2_33);
  meshes["fringe-2"] = mesh_fringe_2_33;
  colliders["fringe-2"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["fringe-2"] ??= [];
  destructionGroups["fringe-2"].push(node_fringe_2_33);

  const endpoint_fringe_3_34 = makeAttachmentEndpoint(null);
  const node_fringe_3_34 = new THREE.Group();
  node_fringe_3_34.name = "fringe-3__pivot";
  node_fringe_3_34.scale.set(1, 1, 1);
  if (endpoint_fringe_3_34) {
    node_fringe_3_34.position.copy(endpoint_fringe_3_34.start);
    node_fringe_3_34.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_fringe_3_34.position.set(0.0, 0.0, 0.0);
    node_fringe_3_34.rotation.set(0.0, 0.0, 0.0);
  }
  node_fringe_3_34.userData.sculptComponent = {"id": "fringe-3", "name": "fringe-3", "level": "micro", "role": "body", "importance": 1.0, "confidence": 0.78, "primitive": "tapered-sweep", "topologyClass": "continuous-sculpt", "topologyRationale": "Contour follows the reference silhouette; depth is inferred and tested in orbit.", "geometryDescriptor": {"taperedSweep": {"stations": [{"position": [0.016, 1.775, 0.035], "rx": 0.032, "rz": 0.025, "twist": 0}, {"position": [0.041, 1.788, 0.072], "rx": 0.028, "rz": 0.021, "twist": 0}, {"position": [0.064, 1.774, 0.098], "rx": 0.018, "rz": 0.012, "twist": 0}, {"position": [0.081, 1.753, 0.105], "rx": 0, "rz": 0, "twist": 0}], "radialSegments": 12, "capEnds": true}, "normalStrategy": "smooth vertex normals"}, "parent": "root", "attachment": null, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.78}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "fringe-3", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "hair", "materialLayers": ["hair"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(52, 40, 43, 1)", "secondaryAlbedo": "rgba(52, 40, 43, 1)", "materialClass": "plastic", "materialClassConfidence": 0.8, "evidenceRefs": ["full-object"]}};
  node_fringe_3_34.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "fringe-3", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["root"] ?? root).add(node_fringe_3_34);
  nodes["fringe-3"] = node_fringe_3_34;
  const mesh_fringe_3_34Geometry = endpoint_fringe_3_34
    ? new THREE.CylinderGeometry(endpoint_fringe_3_34.endRadius, endpoint_fringe_3_34.baseRadius, endpoint_fringe_3_34.length, 16, 6)
    : buildTaperedSweepGeometry({"stations": [{"position": [0.016, 1.775, 0.035], "rx": 0.032, "rz": 0.025, "twist": 0}, {"position": [0.041, 1.788, 0.072], "rx": 0.028, "rz": 0.021, "twist": 0}, {"position": [0.064, 1.774, 0.098], "rx": 0.018, "rz": 0.012, "twist": 0}, {"position": [0.081, 1.753, 0.105], "rx": 0, "rz": 0, "twist": 0}], "radialSegments": 12, "capEnds": true});
  if (!endpoint_fringe_3_34) {
    mesh_fringe_3_34Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_fringe_3_34 = new THREE.Mesh(
    mesh_fringe_3_34Geometry,
    materialMap["hair"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_fringe_3_34.name = "fringe-3";
  if (endpoint_fringe_3_34) {
    mesh_fringe_3_34.position.copy(endpoint_fringe_3_34.midpoint);
    mesh_fringe_3_34.quaternion.copy(endpoint_fringe_3_34.quaternion);
  }
  mesh_fringe_3_34.castShadow = options.castShadow ?? true;
  mesh_fringe_3_34.receiveShadow = options.receiveShadow ?? true;
  mesh_fringe_3_34.userData.sculptComponent = {"id": "fringe-3", "name": "fringe-3", "level": "micro", "role": "body", "importance": 1.0, "confidence": 0.78, "primitive": "tapered-sweep", "topologyClass": "continuous-sculpt", "topologyRationale": "Contour follows the reference silhouette; depth is inferred and tested in orbit.", "geometryDescriptor": {"taperedSweep": {"stations": [{"position": [0.016, 1.775, 0.035], "rx": 0.032, "rz": 0.025, "twist": 0}, {"position": [0.041, 1.788, 0.072], "rx": 0.028, "rz": 0.021, "twist": 0}, {"position": [0.064, 1.774, 0.098], "rx": 0.018, "rz": 0.012, "twist": 0}, {"position": [0.081, 1.753, 0.105], "rx": 0, "rz": 0, "twist": 0}], "radialSegments": 12, "capEnds": true}, "normalStrategy": "smooth vertex normals"}, "parent": "root", "attachment": null, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.78}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "fringe-3", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "hair", "materialLayers": ["hair"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(52, 40, 43, 1)", "secondaryAlbedo": "rgba(52, 40, 43, 1)", "materialClass": "plastic", "materialClassConfidence": 0.8, "evidenceRefs": ["full-object"]}};
  node_fringe_3_34.add(mesh_fringe_3_34);
  meshes["fringe-3"] = mesh_fringe_3_34;
  colliders["fringe-3"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["fringe-3"] ??= [];
  destructionGroups["fringe-3"].push(node_fringe_3_34);

  const endpoint_fringe_4_35 = makeAttachmentEndpoint(null);
  const node_fringe_4_35 = new THREE.Group();
  node_fringe_4_35.name = "fringe-4__pivot";
  node_fringe_4_35.scale.set(1, 1, 1);
  if (endpoint_fringe_4_35) {
    node_fringe_4_35.position.copy(endpoint_fringe_4_35.start);
    node_fringe_4_35.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_fringe_4_35.position.set(0.0, 0.0, 0.0);
    node_fringe_4_35.rotation.set(0.0, 0.0, 0.0);
  }
  node_fringe_4_35.userData.sculptComponent = {"id": "fringe-4", "name": "fringe-4", "level": "micro", "role": "body", "importance": 1.0, "confidence": 0.78, "primitive": "tapered-sweep", "topologyClass": "continuous-sculpt", "topologyRationale": "Contour follows the reference silhouette; depth is inferred and tested in orbit.", "geometryDescriptor": {"taperedSweep": {"stations": [{"position": [0.043, 1.775, 0.035], "rx": 0.032, "rz": 0.025, "twist": 0}, {"position": [0.068, 1.788, 0.072], "rx": 0.028, "rz": 0.021, "twist": 0}, {"position": [0.091, 1.774, 0.098], "rx": 0.018, "rz": 0.012, "twist": 0}, {"position": [0.108, 1.753, 0.105], "rx": 0, "rz": 0, "twist": 0}], "radialSegments": 12, "capEnds": true}, "normalStrategy": "smooth vertex normals"}, "parent": "root", "attachment": null, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.78}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "fringe-4", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "hair", "materialLayers": ["hair"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(52, 40, 43, 1)", "secondaryAlbedo": "rgba(52, 40, 43, 1)", "materialClass": "plastic", "materialClassConfidence": 0.8, "evidenceRefs": ["full-object"]}};
  node_fringe_4_35.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "fringe-4", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["root"] ?? root).add(node_fringe_4_35);
  nodes["fringe-4"] = node_fringe_4_35;
  const mesh_fringe_4_35Geometry = endpoint_fringe_4_35
    ? new THREE.CylinderGeometry(endpoint_fringe_4_35.endRadius, endpoint_fringe_4_35.baseRadius, endpoint_fringe_4_35.length, 16, 6)
    : buildTaperedSweepGeometry({"stations": [{"position": [0.043, 1.775, 0.035], "rx": 0.032, "rz": 0.025, "twist": 0}, {"position": [0.068, 1.788, 0.072], "rx": 0.028, "rz": 0.021, "twist": 0}, {"position": [0.091, 1.774, 0.098], "rx": 0.018, "rz": 0.012, "twist": 0}, {"position": [0.108, 1.753, 0.105], "rx": 0, "rz": 0, "twist": 0}], "radialSegments": 12, "capEnds": true});
  if (!endpoint_fringe_4_35) {
    mesh_fringe_4_35Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_fringe_4_35 = new THREE.Mesh(
    mesh_fringe_4_35Geometry,
    materialMap["hair"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_fringe_4_35.name = "fringe-4";
  if (endpoint_fringe_4_35) {
    mesh_fringe_4_35.position.copy(endpoint_fringe_4_35.midpoint);
    mesh_fringe_4_35.quaternion.copy(endpoint_fringe_4_35.quaternion);
  }
  mesh_fringe_4_35.castShadow = options.castShadow ?? true;
  mesh_fringe_4_35.receiveShadow = options.receiveShadow ?? true;
  mesh_fringe_4_35.userData.sculptComponent = {"id": "fringe-4", "name": "fringe-4", "level": "micro", "role": "body", "importance": 1.0, "confidence": 0.78, "primitive": "tapered-sweep", "topologyClass": "continuous-sculpt", "topologyRationale": "Contour follows the reference silhouette; depth is inferred and tested in orbit.", "geometryDescriptor": {"taperedSweep": {"stations": [{"position": [0.043, 1.775, 0.035], "rx": 0.032, "rz": 0.025, "twist": 0}, {"position": [0.068, 1.788, 0.072], "rx": 0.028, "rz": 0.021, "twist": 0}, {"position": [0.091, 1.774, 0.098], "rx": 0.018, "rz": 0.012, "twist": 0}, {"position": [0.108, 1.753, 0.105], "rx": 0, "rz": 0, "twist": 0}], "radialSegments": 12, "capEnds": true}, "normalStrategy": "smooth vertex normals"}, "parent": "root", "attachment": null, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.78}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "fringe-4", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "hair", "materialLayers": ["hair"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(52, 40, 43, 1)", "secondaryAlbedo": "rgba(52, 40, 43, 1)", "materialClass": "plastic", "materialClassConfidence": 0.8, "evidenceRefs": ["full-object"]}};
  node_fringe_4_35.add(mesh_fringe_4_35);
  meshes["fringe-4"] = mesh_fringe_4_35;
  colliders["fringe-4"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["fringe-4"] ??= [];
  destructionGroups["fringe-4"].push(node_fringe_4_35);

  const attachment_necklace_36 = {"parentSocket": "shirt", "localStart": [-0.057, 1.485, 0.044], "localEnd": [0.057, 1.485, 0.044], "contactType": "surface-embed", "embedDepth": 0.002, "gapTolerance": 0.003};
  const endpoint_necklace_36 = null; // authored tubePath already in model coordinates
  const node_necklace_36 = new THREE.Group();
  node_necklace_36.name = "necklace__pivot";
  node_necklace_36.scale.set(1, 1, 1);
  if (endpoint_necklace_36) {
    node_necklace_36.position.copy(endpoint_necklace_36.start);
    node_necklace_36.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_necklace_36.position.set(0.0, 0.0, 0.0);
    node_necklace_36.rotation.set(0.0, 0.0, 0.0);
  }
  node_necklace_36.userData.sculptComponent = {"id": "necklace", "name": "necklace", "level": "micro", "role": "body", "importance": 1.0, "confidence": 0.78, "primitive": "tube", "topologyClass": "assembled-solid", "topologyRationale": "Contour follows the reference silhouette; depth is inferred and tested in orbit.", "geometryDescriptor": {"tubePath": {"points": [[-0.057, 1.485, 0.044], [-0.044, 1.417, 0.099], [0, 1.355, 0.123], [0.044, 1.417, 0.099], [0.057, 1.485, 0.044]], "radius": 0.0021, "closed": false}, "attachmentGeometry": "authored-path"}, "parent": "root", "attachment": {"parentSocket": "shirt", "localStart": [-0.057, 1.485, 0.044], "localEnd": [0.057, 1.485, 0.044], "contactType": "surface-embed", "embedDepth": 0.002, "gapTolerance": 0.003}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.78}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "necklace", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "gold", "materialLayers": ["gold"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "gold-chain", "kind": "linework", "description": "gold-chain", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(207, 172, 92, 1)", "secondaryAlbedo": "rgba(207, 172, 92, 1)", "materialClass": "metal", "materialClassConfidence": 0.8, "evidenceRefs": ["full-object"]}};
  node_necklace_36.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "necklace", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["root"] ?? root).add(node_necklace_36);
  nodes["necklace"] = node_necklace_36;
  const mesh_necklace_36Geometry = endpoint_necklace_36
    ? new THREE.CylinderGeometry(endpoint_necklace_36.endRadius, endpoint_necklace_36.baseRadius, endpoint_necklace_36.length, 16, 6)
    : buildTubeGeometry({"points": [[-0.057, 1.485, 0.044], [-0.044, 1.417, 0.099], [0, 1.355, 0.123], [0.044, 1.417, 0.099], [0.057, 1.485, 0.044]], "radius": 0.0021, "closed": false});
  if (!endpoint_necklace_36) {
    mesh_necklace_36Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_necklace_36 = new THREE.Mesh(
    mesh_necklace_36Geometry,
    materialMap["gold"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_necklace_36.name = "necklace";
  if (endpoint_necklace_36) {
    mesh_necklace_36.position.copy(endpoint_necklace_36.midpoint);
    mesh_necklace_36.quaternion.copy(endpoint_necklace_36.quaternion);
  }
  mesh_necklace_36.castShadow = options.castShadow ?? true;
  mesh_necklace_36.receiveShadow = options.receiveShadow ?? true;
  mesh_necklace_36.userData.sculptComponent = {"id": "necklace", "name": "necklace", "level": "micro", "role": "body", "importance": 1.0, "confidence": 0.78, "primitive": "tube", "topologyClass": "assembled-solid", "topologyRationale": "Contour follows the reference silhouette; depth is inferred and tested in orbit.", "geometryDescriptor": {"tubePath": {"points": [[-0.057, 1.485, 0.044], [-0.044, 1.417, 0.099], [0, 1.355, 0.123], [0.044, 1.417, 0.099], [0.057, 1.485, 0.044]], "radius": 0.0021, "closed": false}, "attachmentGeometry": "authored-path"}, "parent": "root", "attachment": {"parentSocket": "shirt", "localStart": [-0.057, 1.485, 0.044], "localEnd": [0.057, 1.485, 0.044], "contactType": "surface-embed", "embedDepth": 0.002, "gapTolerance": 0.003}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.78}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "necklace", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "gold", "materialLayers": ["gold"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "gold-chain", "kind": "linework", "description": "gold-chain", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(207, 172, 92, 1)", "secondaryAlbedo": "rgba(207, 172, 92, 1)", "materialClass": "metal", "materialClassConfidence": 0.8, "evidenceRefs": ["full-object"]}};
  node_necklace_36.add(mesh_necklace_36);
  meshes["necklace"] = mesh_necklace_36;
  colliders["necklace"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["necklace"] ??= [];
  destructionGroups["necklace"].push(node_necklace_36);

  const endpoint_pendant_37 = makeAttachmentEndpoint(null);
  const node_pendant_37 = new THREE.Group();
  node_pendant_37.name = "pendant__pivot";
  node_pendant_37.scale.set(1, 1, 1);
  if (endpoint_pendant_37) {
    node_pendant_37.position.copy(endpoint_pendant_37.start);
    node_pendant_37.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_pendant_37.position.set(0.0, 1.346, 0.124);
    node_pendant_37.rotation.set(0.0, 0.0, 0.0);
  }
  node_pendant_37.userData.sculptComponent = {"id": "pendant", "name": "pendant", "level": "micro", "role": "body", "importance": 1.0, "confidence": 0.78, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Contour follows the reference silhouette; depth is inferred and tested in orbit.", "geometryDescriptor": {"normalStrategy": "smooth vertex normals", "uvStrategy": "generated procedural coordinates", "edgeTreatment": {"type": "none", "bevelRadius": 0, "segments": 1}, "deformationStack": []}, "parent": "root", "attachment": null, "dimensions": {"width": 0.018, "height": 0.031, "depth": 0.005, "units": "meters", "confidence": 0.78}, "transform": {"position": [0, 1.346, 0.124], "rotation": [0, 0, 0], "scale": [0.018, 0.031, 0.005]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pendant", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "gold", "materialLayers": ["gold"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "rectangular-pendant", "kind": "bevel", "description": "rectangular-pendant", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(207, 172, 92, 1)", "secondaryAlbedo": "rgba(207, 172, 92, 1)", "materialClass": "metal", "materialClassConfidence": 0.8, "evidenceRefs": ["full-object"]}};
  node_pendant_37.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pendant", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["root"] ?? root).add(node_pendant_37);
  nodes["pendant"] = node_pendant_37;
  const mesh_pendant_37Geometry = endpoint_pendant_37
    ? new THREE.CylinderGeometry(endpoint_pendant_37.endRadius, endpoint_pendant_37.baseRadius, endpoint_pendant_37.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_pendant_37) {
    mesh_pendant_37Geometry.scale(0.018, 0.031, 0.005);
  }
  const mesh_pendant_37 = new THREE.Mesh(
    mesh_pendant_37Geometry,
    materialMap["gold"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_pendant_37.name = "pendant";
  if (endpoint_pendant_37) {
    mesh_pendant_37.position.copy(endpoint_pendant_37.midpoint);
    mesh_pendant_37.quaternion.copy(endpoint_pendant_37.quaternion);
  }
  mesh_pendant_37.castShadow = options.castShadow ?? true;
  mesh_pendant_37.receiveShadow = options.receiveShadow ?? true;
  mesh_pendant_37.userData.sculptComponent = {"id": "pendant", "name": "pendant", "level": "micro", "role": "body", "importance": 1.0, "confidence": 0.78, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Contour follows the reference silhouette; depth is inferred and tested in orbit.", "geometryDescriptor": {"normalStrategy": "smooth vertex normals", "uvStrategy": "generated procedural coordinates", "edgeTreatment": {"type": "none", "bevelRadius": 0, "segments": 1}, "deformationStack": []}, "parent": "root", "attachment": null, "dimensions": {"width": 0.018, "height": 0.031, "depth": 0.005, "units": "meters", "confidence": 0.78}, "transform": {"position": [0, 1.346, 0.124], "rotation": [0, 0, 0], "scale": [0.018, 0.031, 0.005]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pendant", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "gold", "materialLayers": ["gold"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "rectangular-pendant", "kind": "bevel", "description": "rectangular-pendant", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(207, 172, 92, 1)", "secondaryAlbedo": "rgba(207, 172, 92, 1)", "materialClass": "metal", "materialClassConfidence": 0.8, "evidenceRefs": ["full-object"]}};
  node_pendant_37.add(mesh_pendant_37);
  meshes["pendant"] = mesh_pendant_37;
  colliders["pendant"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["pendant"] ??= [];
  destructionGroups["pendant"].push(node_pendant_37);

  const endpoint_sleeve_l_38 = makeAttachmentEndpoint(null);
  const node_sleeve_l_38 = new THREE.Group();
  node_sleeve_l_38.name = "sleeve-l__pivot";
  node_sleeve_l_38.scale.set(1, 1, 1);
  if (endpoint_sleeve_l_38) {
    node_sleeve_l_38.position.copy(endpoint_sleeve_l_38.start);
    node_sleeve_l_38.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_sleeve_l_38.position.set(0.0, 0.0, 0.0);
    node_sleeve_l_38.rotation.set(0.0, 0.0, 0.0);
  }
  node_sleeve_l_38.userData.sculptComponent = {"id": "sleeve-l", "name": "sleeve-l", "level": "meso", "role": "body", "importance": 1.0, "confidence": 0.78, "primitive": "tapered-sweep", "topologyClass": "continuous-sculpt", "topologyRationale": "Contour follows the reference silhouette; depth is inferred and tested in orbit.", "geometryDescriptor": {"taperedSweep": {"stations": [{"position": [0.213, 1.405, 0], "rx": 0.028, "rz": 0.025}, {"position": [0.233, 1.38, 0], "rx": 0.085, "rz": 0.075}, {"position": [0.24800000000000003, 1.33, 0], "rx": 0.083, "rz": 0.073}, {"position": [0.256, 1.295, 0], "rx": 0.075, "rz": 0.065}], "radialSegments": 28, "capEnds": true}, "normalStrategy": "smooth shared contour"}, "parent": "root", "attachment": null, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.78}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "arm-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "shirt", "materialLayers": ["shirt"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(213, 154, 115, 1)", "secondaryAlbedo": "rgba(213, 154, 115, 1)", "materialClass": "skin", "materialClassConfidence": 0.8, "evidenceRefs": ["full-object"]}};
  node_sleeve_l_38.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "arm-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["root"] ?? root).add(node_sleeve_l_38);
  nodes["sleeve-l"] = node_sleeve_l_38;
  const mesh_sleeve_l_38Geometry = endpoint_sleeve_l_38
    ? new THREE.CylinderGeometry(endpoint_sleeve_l_38.endRadius, endpoint_sleeve_l_38.baseRadius, endpoint_sleeve_l_38.length, 16, 6)
    : buildTaperedSweepGeometry({"stations": [{"position": [0.213, 1.405, 0], "rx": 0.028, "rz": 0.025}, {"position": [0.233, 1.38, 0], "rx": 0.085, "rz": 0.075}, {"position": [0.24800000000000003, 1.33, 0], "rx": 0.083, "rz": 0.073}, {"position": [0.256, 1.295, 0], "rx": 0.075, "rz": 0.065}], "radialSegments": 28, "capEnds": true});
  if (!endpoint_sleeve_l_38) {
    mesh_sleeve_l_38Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_sleeve_l_38 = new THREE.Mesh(
    mesh_sleeve_l_38Geometry,
    materialMap["shirt"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_sleeve_l_38.name = "sleeve-l";
  if (endpoint_sleeve_l_38) {
    mesh_sleeve_l_38.position.copy(endpoint_sleeve_l_38.midpoint);
    mesh_sleeve_l_38.quaternion.copy(endpoint_sleeve_l_38.quaternion);
  }
  mesh_sleeve_l_38.castShadow = options.castShadow ?? true;
  mesh_sleeve_l_38.receiveShadow = options.receiveShadow ?? true;
  mesh_sleeve_l_38.userData.sculptComponent = {"id": "sleeve-l", "name": "sleeve-l", "level": "meso", "role": "body", "importance": 1.0, "confidence": 0.78, "primitive": "tapered-sweep", "topologyClass": "continuous-sculpt", "topologyRationale": "Contour follows the reference silhouette; depth is inferred and tested in orbit.", "geometryDescriptor": {"taperedSweep": {"stations": [{"position": [0.213, 1.405, 0], "rx": 0.028, "rz": 0.025}, {"position": [0.233, 1.38, 0], "rx": 0.085, "rz": 0.075}, {"position": [0.24800000000000003, 1.33, 0], "rx": 0.083, "rz": 0.073}, {"position": [0.256, 1.295, 0], "rx": 0.075, "rz": 0.065}], "radialSegments": 28, "capEnds": true}, "normalStrategy": "smooth shared contour"}, "parent": "root", "attachment": null, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.78}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "arm-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "shirt", "materialLayers": ["shirt"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(213, 154, 115, 1)", "secondaryAlbedo": "rgba(213, 154, 115, 1)", "materialClass": "skin", "materialClassConfidence": 0.8, "evidenceRefs": ["full-object"]}};
  node_sleeve_l_38.add(mesh_sleeve_l_38);
  meshes["sleeve-l"] = mesh_sleeve_l_38;
  colliders["sleeve-l"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["arm-l"] ??= [];
  destructionGroups["arm-l"].push(node_sleeve_l_38);

  const endpoint_sleeve_r_39 = makeAttachmentEndpoint(null);
  const node_sleeve_r_39 = new THREE.Group();
  node_sleeve_r_39.name = "sleeve-r__pivot";
  node_sleeve_r_39.scale.set(1, 1, 1);
  if (endpoint_sleeve_r_39) {
    node_sleeve_r_39.position.copy(endpoint_sleeve_r_39.start);
    node_sleeve_r_39.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_sleeve_r_39.position.set(0.0, 0.0, 0.0);
    node_sleeve_r_39.rotation.set(0.0, 0.0, 0.0);
  }
  node_sleeve_r_39.userData.sculptComponent = {"id": "sleeve-r", "name": "sleeve-r", "level": "meso", "role": "body", "importance": 1.0, "confidence": 0.78, "primitive": "tapered-sweep", "topologyClass": "continuous-sculpt", "topologyRationale": "Contour follows the reference silhouette; depth is inferred and tested in orbit.", "geometryDescriptor": {"taperedSweep": {"stations": [{"position": [-0.213, 1.405, 0], "rx": 0.028, "rz": 0.025}, {"position": [-0.233, 1.38, 0], "rx": 0.085, "rz": 0.075}, {"position": [-0.24800000000000003, 1.33, 0], "rx": 0.083, "rz": 0.073}, {"position": [-0.256, 1.295, 0], "rx": 0.075, "rz": 0.065}], "radialSegments": 28, "capEnds": true}, "normalStrategy": "smooth shared contour"}, "parent": "root", "attachment": null, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.78}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "arm-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "shirt", "materialLayers": ["shirt"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(213, 154, 115, 1)", "secondaryAlbedo": "rgba(213, 154, 115, 1)", "materialClass": "skin", "materialClassConfidence": 0.8, "evidenceRefs": ["full-object"]}};
  node_sleeve_r_39.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "arm-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["root"] ?? root).add(node_sleeve_r_39);
  nodes["sleeve-r"] = node_sleeve_r_39;
  const mesh_sleeve_r_39Geometry = endpoint_sleeve_r_39
    ? new THREE.CylinderGeometry(endpoint_sleeve_r_39.endRadius, endpoint_sleeve_r_39.baseRadius, endpoint_sleeve_r_39.length, 16, 6)
    : buildTaperedSweepGeometry({"stations": [{"position": [-0.213, 1.405, 0], "rx": 0.028, "rz": 0.025}, {"position": [-0.233, 1.38, 0], "rx": 0.085, "rz": 0.075}, {"position": [-0.24800000000000003, 1.33, 0], "rx": 0.083, "rz": 0.073}, {"position": [-0.256, 1.295, 0], "rx": 0.075, "rz": 0.065}], "radialSegments": 28, "capEnds": true});
  if (!endpoint_sleeve_r_39) {
    mesh_sleeve_r_39Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_sleeve_r_39 = new THREE.Mesh(
    mesh_sleeve_r_39Geometry,
    materialMap["shirt"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_sleeve_r_39.name = "sleeve-r";
  if (endpoint_sleeve_r_39) {
    mesh_sleeve_r_39.position.copy(endpoint_sleeve_r_39.midpoint);
    mesh_sleeve_r_39.quaternion.copy(endpoint_sleeve_r_39.quaternion);
  }
  mesh_sleeve_r_39.castShadow = options.castShadow ?? true;
  mesh_sleeve_r_39.receiveShadow = options.receiveShadow ?? true;
  mesh_sleeve_r_39.userData.sculptComponent = {"id": "sleeve-r", "name": "sleeve-r", "level": "meso", "role": "body", "importance": 1.0, "confidence": 0.78, "primitive": "tapered-sweep", "topologyClass": "continuous-sculpt", "topologyRationale": "Contour follows the reference silhouette; depth is inferred and tested in orbit.", "geometryDescriptor": {"taperedSweep": {"stations": [{"position": [-0.213, 1.405, 0], "rx": 0.028, "rz": 0.025}, {"position": [-0.233, 1.38, 0], "rx": 0.085, "rz": 0.075}, {"position": [-0.24800000000000003, 1.33, 0], "rx": 0.083, "rz": 0.073}, {"position": [-0.256, 1.295, 0], "rx": 0.075, "rz": 0.065}], "radialSegments": 28, "capEnds": true}, "normalStrategy": "smooth shared contour"}, "parent": "root", "attachment": null, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.78}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "arm-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "shirt", "materialLayers": ["shirt"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(213, 154, 115, 1)", "secondaryAlbedo": "rgba(213, 154, 115, 1)", "materialClass": "skin", "materialClassConfidence": 0.8, "evidenceRefs": ["full-object"]}};
  node_sleeve_r_39.add(mesh_sleeve_r_39);
  meshes["sleeve-r"] = mesh_sleeve_r_39;
  colliders["sleeve-r"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["arm-r"] ??= [];
  destructionGroups["arm-r"].push(node_sleeve_r_39);

  const endpoint_fringe_back_40 = makeAttachmentEndpoint(null);
  const node_fringe_back_40 = new THREE.Group();
  node_fringe_back_40.name = "fringe-back__pivot";
  node_fringe_back_40.scale.set(1, 1, 1);
  if (endpoint_fringe_back_40) {
    node_fringe_back_40.position.copy(endpoint_fringe_back_40.start);
    node_fringe_back_40.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_fringe_back_40.position.set(0.0, 0.0, 0.0);
    node_fringe_back_40.rotation.set(0.0, 0.0, 0.0);
  }
  node_fringe_back_40.userData.sculptComponent = {"id": "fringe-back", "name": "fringe-back", "level": "meso", "role": "body", "importance": 1.0, "confidence": 0.78, "primitive": "tapered-sweep", "topologyClass": "continuous-sculpt", "topologyRationale": "Contour follows the reference silhouette; depth is inferred and tested in orbit.", "geometryDescriptor": {"taperedSweep": {"stations": [{"position": [0, 1.625, -0.012], "rx": 0.03, "rz": 0.03}, {"position": [0, 1.632, -0.012], "rx": 0.08, "rz": 0.075}, {"position": [0, 1.66, -0.015], "rx": 0.093, "rz": 0.094}, {"position": [0, 1.705, -0.017], "rx": 0.109, "rz": 0.102}, {"position": [0, 1.74, -0.018], "rx": 0.106, "rz": 0.103}, {"position": [0, 1.755, -0.018], "rx": 0.095, "rz": 0.098}], "radialSegments": 24, "capEnds": true, "fixedFrame": "horizontal"}, "rearHair": {"rings": [[1.632, 0.075, 0.08, -0.012], [1.66, 0.094, 0.112, -0.015], [1.705, 0.102, 0.126, -0.017], [1.74, 0.099, 0.125, -0.018], [1.775, 0.083, 0.111, -0.019]], "radialSegments": 32, "thickness": 0.014}, "normalStrategy": "closed rear-half scalp shell, attached under cap"}, "parent": "root", "attachment": null, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.78}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "fringe-0", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "hair", "materialLayers": ["hair"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "rear-hair", "kind": "contour", "description": "continuous rear hair and nape below the cap", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(52, 40, 43, 1)", "secondaryAlbedo": "rgba(52, 40, 43, 1)", "materialClass": "plastic", "materialClassConfidence": 0.8, "evidenceRefs": ["full-object"]}};
  node_fringe_back_40.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "fringe-0", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["root"] ?? root).add(node_fringe_back_40);
  nodes["fringe-back"] = node_fringe_back_40;
  const mesh_fringe_back_40Geometry = endpoint_fringe_back_40
    ? new THREE.CylinderGeometry(endpoint_fringe_back_40.endRadius, endpoint_fringe_back_40.baseRadius, endpoint_fringe_back_40.length, 16, 6)
    : buildTaperedSweepGeometry({"stations": [{"position": [0, 1.625, -0.012], "rx": 0.03, "rz": 0.03}, {"position": [0, 1.632, -0.012], "rx": 0.08, "rz": 0.075}, {"position": [0, 1.66, -0.015], "rx": 0.093, "rz": 0.094}, {"position": [0, 1.705, -0.017], "rx": 0.109, "rz": 0.102}, {"position": [0, 1.74, -0.018], "rx": 0.106, "rz": 0.103}, {"position": [0, 1.755, -0.018], "rx": 0.095, "rz": 0.098}], "radialSegments": 24, "capEnds": true, "fixedFrame": "horizontal"});
  if (!endpoint_fringe_back_40) {
    mesh_fringe_back_40Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_fringe_back_40 = new THREE.Mesh(
    mesh_fringe_back_40Geometry,
    materialMap["hair"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_fringe_back_40.name = "fringe-back";
  if (endpoint_fringe_back_40) {
    mesh_fringe_back_40.position.copy(endpoint_fringe_back_40.midpoint);
    mesh_fringe_back_40.quaternion.copy(endpoint_fringe_back_40.quaternion);
  }
  mesh_fringe_back_40.castShadow = options.castShadow ?? true;
  mesh_fringe_back_40.receiveShadow = options.receiveShadow ?? true;
  mesh_fringe_back_40.userData.sculptComponent = {"id": "fringe-back", "name": "fringe-back", "level": "meso", "role": "body", "importance": 1.0, "confidence": 0.78, "primitive": "tapered-sweep", "topologyClass": "continuous-sculpt", "topologyRationale": "Contour follows the reference silhouette; depth is inferred and tested in orbit.", "geometryDescriptor": {"taperedSweep": {"stations": [{"position": [0, 1.625, -0.012], "rx": 0.03, "rz": 0.03}, {"position": [0, 1.632, -0.012], "rx": 0.08, "rz": 0.075}, {"position": [0, 1.66, -0.015], "rx": 0.093, "rz": 0.094}, {"position": [0, 1.705, -0.017], "rx": 0.109, "rz": 0.102}, {"position": [0, 1.74, -0.018], "rx": 0.106, "rz": 0.103}, {"position": [0, 1.755, -0.018], "rx": 0.095, "rz": 0.098}], "radialSegments": 24, "capEnds": true, "fixedFrame": "horizontal"}, "rearHair": {"rings": [[1.632, 0.075, 0.08, -0.012], [1.66, 0.094, 0.112, -0.015], [1.705, 0.102, 0.126, -0.017], [1.74, 0.099, 0.125, -0.018], [1.775, 0.083, 0.111, -0.019]], "radialSegments": 32, "thickness": 0.014}, "normalStrategy": "closed rear-half scalp shell, attached under cap"}, "parent": "root", "attachment": null, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.78}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "fringe-0", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "hair", "materialLayers": ["hair"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "rear-hair", "kind": "contour", "description": "continuous rear hair and nape below the cap", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(52, 40, 43, 1)", "secondaryAlbedo": "rgba(52, 40, 43, 1)", "materialClass": "plastic", "materialClassConfidence": 0.8, "evidenceRefs": ["full-object"]}};
  node_fringe_back_40.add(mesh_fringe_back_40);
  meshes["fringe-back"] = mesh_fringe_back_40;
  colliders["fringe-back"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["fringe-0"] ??= [];
  destructionGroups["fringe-0"].push(node_fringe_back_40);


  // Head planes are deformed on ONE surface in model coordinates.
  // Fit the cap to the rounded occiput; the skull must remain inside the cloth shell.
  const capFit=meshes['cap'].userData.sculptComponent.geometryDescriptor.backFit;
  if(capFit){const p=meshes['cap'].geometry.getAttribute('position');for(let i=0;i<p.count;i++){const x=p.getX(i),y=p.getY(i),z=p.getZ(i);if(z<capFit.centreZ)p.setZ(i,z-capFit.depth*Math.exp(-(((y-capFit.centreY)/capFit.heightRadius)**2))*Math.min(1,(capFit.centreZ-z)/.065));}p.needsUpdate=true;meshes['cap'].geometry.computeVertexNormals();}
  const faceSpec = meshes['head'].userData.sculptComponent.geometryDescriptor.faceSculpt;
  const headGeom = meshes['head'].geometry;
  const hp = headGeom.getAttribute('position');
  for(let i=0;i<hp.count;i++){
    let x=hp.getX(i),y=hp.getY(i),z=hp.getZ(i);
    if(z<-.02){const round=faceSpec.backRoundness;z-=round.depth*Math.exp(-Math.pow((y-round.centreY)/round.heightRadius,2))*THREE.MathUtils.smoothstep(-z,.02,.075);hp.setXYZ(i,x,y,z);}
    if(z>-.005){const bump=(p         )=>p[4]*Math.exp(-Math.pow((x-p[0])/p[2],2)-Math.pow((y-p[1])/p[3],2));
      const gate=THREE.MathUtils.smoothstep(z,-.005,.035);
      z+=gate*(bump(faceSpec.nose)+bump(faceSpec.bridge)+bump(faceSpec.lipRidge)+faceSpec.cheeks.reduce((v       ,p         )=>v+bump(p),0));
      hp.setXYZ(i,x,y,z);
    }
  }headGeom.computeVertexNormals();
  {
    const spec=meshes['fringe-back'].userData.sculptComponent.geometryDescriptor.rearHair,rings=spec.rings,N=spec.radialSegments,positions         =[],indices         =[];
    for(let layer=0;layer<2;layer++)for(let r=0;r<rings.length;r++){const [y,w,d,z]=rings[r];for(let j=0;j<=N;j++){const a=j/N*Math.PI,t=layer?spec.thickness:0;positions.push((w-t)*Math.cos(a),y+(r===0?-.003*Math.sin(a*8)**2:0),z-(d-t)*Math.sin(a));}}
    const stride=N+1,offset=rings.length*stride;
    for(let r=0;r<rings.length-1;r++)for(let j=0;j<N;j++){const a=r*stride+j,b=a+stride;indices.push(a,a+1,b,a+1,b+1,b);const c=a+offset,d=b+offset;indices.push(c,d,c+1,c+1,d,d+1);}
    for(let r=0;r<rings.length-1;r++)for(const j of [0,N]){const a=r*stride+j,b=a+stride,c=a+offset,d=b+offset;indices.push(a,b,c,b,d,c);}
    for(const r of [0,rings.length-1])for(let j=0;j<N;j++){const a=r*stride+j,b=a+offset;indices.push(a,b,a+1,a+1,b,b+1);}
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setIndex(indices);g.computeVertexNormals();meshes['fringe-back'].geometry.dispose();meshes['fringe-back'].geometry=g;
  }
  root.updateMatrixWorld(true);
  const imageHeadIds=["head","cap","cap-brim","glasses-bridge","mouth","ear--1","eye--1","glasses--1","temple--1","ear-1","eye-1","glasses-1","temple-1","fringe-0","fringe-1","fringe-2","fringe-3","fringe-4","fringe-back"];
  const hmat=new THREE.Matrix4().makeTranslation(0,1.7,0).multiply(new THREE.Matrix4().makeRotationY(.48)).multiply(new THREE.Matrix4().makeRotationZ(-.105)).multiply(new THREE.Matrix4().makeScale(1.18,1.07,1.1)).multiply(new THREE.Matrix4().makeTranslation(0,-1.718,0));
  for(const id of imageHeadIds){const mesh=meshes[id];if(!mesh)continue;const m=new THREE.Matrix4().copy(mesh.matrixWorld).invert().multiply(hmat).multiply(mesh.matrixWorld);mesh.geometry.applyMatrix4(m);mesh.geometry.computeVertexNormals();}
  // A conforming shader marking has no floating geometry or visible thickness.
  const inkMesh=meshes['arm-r'];inkMesh.geometry.setAttribute('tattooCoord',inkMesh.geometry.getAttribute('position').clone());
  const inkMaterial=inkMesh.material.clone();inkMesh.material=inkMaterial;
  inkMaterial.onBeforeCompile=(shader    )=>{
    shader.vertexShader='attribute vec3 tattooCoord;varying vec3 vTattooCoord;\n'+shader.vertexShader;
    shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\n vTattooCoord=tattooCoord;');
    shader.fragmentShader='varying vec3 vTattooCoord;\n'+shader.fragmentShader;
    shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>','#include <color_fragment>\n vec3 p=vTattooCoord; float x=p.x+.30; float upper=1.234-abs(x)*1.45; float a=1.-smoothstep(.006,.009,abs(p.y-upper));float arc=abs(length(vec2(x/.046,(p.y-1.116)/.067))-1.);float b=1.-smoothstep(.12,.20,arc);float band=1.-smoothstep(.008,.012,abs(p.y-(1.17+.018*sin(x*48.))));float mask=max(a,max(b,band))*step(.0,p.z)*step(1.035,p.y)*step(p.y,1.25);diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.075,.065,.065),mask*.88);');
  };
  inkMaterial.customProgramCacheKey=()=> 'riff-image-tribal-v1';
  for(const id of ['shirt','sleeve-l','sleeve-r','arm-l','arm-r','hand-l','hand-r','necklace','pendant']){const mesh=meshes[id];if(!mesh)continue;const a=mesh.geometry.getAttribute('position');for(let i=0;i<a.count;i++)a.setX(i,a.getX(i)*.86);a.needsUpdate=true;mesh.geometry.computeVertexNormals();}
  for(const [side,splay]of [['l',.065],['r',-.02]]         ){
    for(const id of Object.keys(meshes)){if(!(id==='pants-'+side||id==='shoe-'+side||id==='sole-'+side||id.startsWith('lace-'+side+'-')))continue;
      const mesh=meshes[id],attr=mesh.geometry.getAttribute('position'),inv=mesh.matrixWorld.clone().invert(),v=new THREE.Vector3();
      for(let i=0;i<attr.count;i++){v.fromBufferAttribute(attr,i).applyMatrix4(mesh.matrixWorld);v.x+=splay*Math.max(0,1-v.y/.98);v.applyMatrix4(inv);attr.setXYZ(i,v.x,v.y,v.z);}attr.needsUpdate=true;mesh.geometry.computeVertexNormals();
    }
  }

  root.userData.sculptRuntime = { nodes, meshes, sockets, colliders, destructionGroups }                                 ;
  root.userData.lookDevTargets = {"qualityPriority": "reference-fidelity", "materialPass": {"albedoPaletteRequired": true, "roughnessVariationRequired": true, "normalOrBumpRequired": true, "localOverridesRequired": true, "minimumTextureResolution": 1024, "preferredTextureResolution": 2048, "independentMapChannels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "requiredSurfaceFrequencyBands": ["macro", "meso", "micro"], "geometryReliefRequiredWhenSilhouetteAffected": true, "referencePbrExtraction": {"requiredWhenSourceImagePresent": true, "targetThreshold": 0.7, "stopOnLowConfidence": true, "script": "forge/stage1_intake/extract_pbr_evidence.py", "acceptedLimitation": "single-image extraction is reference-derived inference, not exact photogrammetry"}, "mustAvoid": ["single flat albedo per material", "uniform roughness", "albedo texture reused as roughness/height/normal/AO", "single-frequency random noise", "plastic-looking smooth bark, stone, cloth, foliage, or aged material", "local color/detail described only in prose without material masks", "claiming exact PBR recovery when confidence is below the target threshold"]}, "lightingPass": {"requiredTerms": ["key light", "fill light", "rim or environment light", "exposure", "tone mapping", "background", "contact shadow"], "mustAvoid": ["ambient-only lighting", "flat value range", "missing contact shadow", "reference lighting copied without separating material readability"]}, "screenshotReview": ["Compare albedo palette and local color zones.", "Compare roughness/normal/bump response under light.", "Compare cavity dirt, edge wear, stains, moss, scratches, or other local masks.", "Compare key/fill/rim structure, exposure, tone mapping, background, and contact shadows.", "Capture a neutral-light render to verify material readability without reference lighting.", "Capture a grazing-light close-up to expose flat normals, uniform roughness, tiling, and plastic highlights.", "Capture a reference-matched render from the same camera framing as the source."]};
  root.userData.actionReadiness = {
    note: 'Use root.userData.sculptRuntime.nodes for transforms, sockets for attachments, colliders for physics proxies, and destructionGroups for breakable sets.',
  };
  return root;
}

export function createRiffNocturneSingleCharacterTestLookDevLights(
  mode                                      = 'neutral',
)              {
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
export function createRiffNocturneSingleCharacterTestEnvironment(renderer                     )                {
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
  camera                         ,
  object                ,
  options                                                                  = {},
)       {
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
  renderer                     ,
  scene             ,
  camera              ,
  options                                                                                                      = {},
)                 {
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

export function configureRiffNocturneSingleCharacterTestRenderer(renderer                     )       {
  // Load-bearing for view-dependent finishes (anodized / Doppler): without ACES + sRGB
  // the environment reflection reads flat/washed instead of a believable metal response.
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
}

export function createRiffNocturneSingleCharacterTestInspectControls(
  camera              ,
  domElement             ,
)                {
  // View-dependent finishes only read correctly once the user orbits — their color
  // comes from the environment reflection, not albedo, so free rotation matters here.
  const controls = new OrbitControls(camera, domElement);
  controls.enableDamping = true;
  controls.minDistance = 1.0;
  controls.maxDistance = 8.0;
  controls.autoRotate = false;
  return controls;
}
