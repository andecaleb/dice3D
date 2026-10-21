import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Environment, useTexture } from "@react-three/drei";
import * as THREE from "three";
import * as CANNON from "cannon-es";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";

/* ------------------------------------------------------------------ */
/*  World / map constants                                              */
/* ------------------------------------------------------------------ */

// abuja-map.png is 1536 x 1024 (3:2). The floor keeps that ratio so the
// map is never stretched.
const MAP_PX_W = 1536;
const MAP_W = 18;
const MAP_H = 12;
const UNITS_PER_PX = MAP_W / MAP_PX_W;

// Each toss moves ONE marker this many MAP pixels towards the centre.
// (Raise this number if you want the markers to travel faster.)
const MOVE_STEP_PX = 6;
const MOVE_STEP = MOVE_STEP_PX * UNITS_PER_PX;

const MARKER_COUNT = 7;
const MARKER_COLORS = [
  "#ea4335",
  "#4285f4",
  "#fbbc04",
  "#34a853",
  "#a142f4",
  "#ff6d01",
  "#00bcd4",
];
// Markers start near the map edge (inset so the tray rim never hides them).
const EDGE_INSET = 0.84;

/* ------------------------------------------------------------------ */
/*  Dice constants                                                     */
/* ------------------------------------------------------------------ */

const DICE_SIZE = 1.3;
const HALF = DICE_SIZE / 2;
const GRAVITY = -48;

// RoundedBoxGeometry keeps BoxGeometry's group order: +x, -x, +y, -y, +z, -z.
// Opposite faces always add up to 7, like a real die.
const FACE_VALUES = [3, 4, 1, 6, 2, 5];
const FACE_NORMALS = [
  [1, 0, 0, 3],
  [-1, 0, 0, 4],
  [0, 1, 0, 1],
  [0, -1, 0, 6],
  [0, 0, 1, 2],
  [0, 0, -1, 5],
];

// Pip layout in a 3x3 grid (-1, 0, 1).
const PIP_POSITIONS = {
  1: [[0, 0]],
  2: [
    [-1, 1],
    [1, -1],
  ],
  3: [
    [-1, 1],
    [0, 0],
    [1, -1],
  ],
  4: [
    [-1, 1],
    [1, 1],
    [-1, -1],
    [1, -1],
  ],
  5: [
    [-1, 1],
    [1, 1],
    [0, 0],
    [-1, -1],
    [1, -1],
  ],
  6: [
    [-1, 1],
    [1, 1],
    [-1, 0],
    [1, 0],
    [-1, -1],
    [1, -1],
  ],
};

/* ------------------------------------------------------------------ */
/*  Textures                                                           */
/* ------------------------------------------------------------------ */

// Returns a colour map (ivory face + glossy black pips) and a bump map so the
// pips are drilled into the die like a real one. Pips are spread across the
// whole face (grid at 27% / 50% / 73%), not crowded towards the middle.
function makeFaceTextures(value) {
  const size = 512;
  const spread = 0.235; // distance of outer pips from centre (fraction of face)
  const pipR = size * 0.088;

  const make = (draw) => {
    const c = document.createElement("canvas");
    c.width = c.height = size;
    const ctx = c.getContext("2d");
    draw(ctx);
    return c;
  };

  const forEachPip = (cb) => {
    for (const [nx, ny] of PIP_POSITIONS[value]) {
      cb(size * (0.5 + nx * spread), size * (0.5 + ny * spread));
    }
  };

  const colorCanvas = make((ctx) => {
    const g = ctx.createRadialGradient(
      size * 0.5,
      size * 0.45,
      size * 0.1,
      size * 0.5,
      size * 0.5,
      size * 0.75,
    );
    g.addColorStop(0, "#fbf9f2");
    g.addColorStop(1, "#ebe6d8");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);

    forEachPip((cx, cy) => {
      const pg = ctx.createRadialGradient(
        cx - pipR * 0.25,
        cy - pipR * 0.3,
        pipR * 0.1,
        cx,
        cy,
        pipR,
      );
      pg.addColorStop(0, "#2b2e36");
      pg.addColorStop(1, "#08090c");
      ctx.fillStyle = pg;
      ctx.beginPath();
      ctx.arc(cx, cy, pipR, 0, Math.PI * 2);
      ctx.fill();
    });
  });

  const bumpCanvas = make((ctx) => {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, size, size);
    forEachPip((cx, cy) => {
      const bg = ctx.createRadialGradient(cx, cy, 0, cx, cy, pipR * 1.12);
      bg.addColorStop(0, "#000000");
      bg.addColorStop(0.7, "#2a2a2a");
      bg.addColorStop(1, "#ffffff");
      ctx.fillStyle = bg;
      ctx.beginPath();
      ctx.arc(cx, cy, pipR * 1.12, 0, Math.PI * 2);
      ctx.fill();
    });
  });

  const map = new THREE.CanvasTexture(colorCanvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 16;

  const bump = new THREE.CanvasTexture(bumpCanvas);
  bump.anisotropy = 16;

  return { map, bump };
}

// The pin's TIP sits at 86% of the canvas height; the sprite is anchored
// there so the tip lands exactly on the map.
const PIN_TIP_FROM_BOTTOM = 0.14;

function makeMarkerTexture(color = "#ea4335") {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");

  const cx = size / 2;
  const headR = size * 0.28;
  const headCY = size * 0.36;

  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(cx, headCY, headR, Math.PI * 0.15, Math.PI * 0.85, true);
  ctx.lineTo(cx, size * 0.86);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = "rgba(0,0,0,0.25)";
  ctx.lineWidth = 3;
  ctx.stroke();

  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(cx, headCY, headR * 0.45, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "rgba(255,255,255,0.35)";
  ctx.beginPath();
  ctx.arc(
    cx - headR * 0.35,
    headCY - headR * 0.35,
    headR * 0.18,
    0,
    Math.PI * 2,
  );
  ctx.fill();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 16;
  return texture;
}

function makeBlobShadowTexture() {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  const g = ctx.createRadialGradient(
    size / 2,
    size / 2,
    0,
    size / 2,
    size / 2,
    size / 2,
  );
  g.addColorStop(0, "rgba(0,0,0,0.55)");
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

/* ------------------------------------------------------------------ */
/*  Audio (collision-driven, so every bounce clicks)                   */
/* ------------------------------------------------------------------ */

let audioCtx = null;
let noiseBuffer = null;

function ensureAudio() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  if (!audioCtx) {
    audioCtx = new AC();
    const len = Math.floor(audioCtx.sampleRate * 0.12);
    noiseBuffer = audioCtx.createBuffer(1, len, audioCtx.sampleRate);
    const d = noiseBuffer.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }
  if (audioCtx.state === "suspended") audioCtx.resume();
  return audioCtx;
}

function playImpact(speed, hardSurface) {
  const ctx = audioCtx;
  if (!ctx || !noiseBuffer) return;
  const strength = Math.min(speed / 20, 1);
  if (strength < 0.04) return;

  const now = ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer;

  const bp = ctx.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = (hardSurface ? 2600 : 1700) + Math.random() * 1200;
  bp.Q.value = 1.1;

  const gain = ctx.createGain();
  const peak = 0.06 + strength * 0.5;
  gain.gain.setValueAtTime(peak, now);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.05 + strength * 0.05);

  src.connect(bp);
  bp.connect(gain);
  gain.connect(ctx.destination);
  src.start(now);
  src.stop(now + 0.12);

  // Low "thock" of the die body.
  const osc = ctx.createOscillator();
  const og = ctx.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(190 + Math.random() * 60, now);
  osc.frequency.exponentialRampToValueAtTime(90, now + 0.06);
  og.gain.setValueAtTime(0.0001, now);
  og.gain.exponentialRampToValueAtTime(0.1 + strength * 0.35, now + 0.004);
  og.gain.exponentialRampToValueAtTime(0.0001, now + 0.08);
  osc.connect(og);
  og.connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 0.09);
}

/* ------------------------------------------------------------------ */
/*  Markers                                                            */
/* ------------------------------------------------------------------ */

// A point on the (inset) map border along a given angle from the centre.
function edgePoint(angle) {
  const hx = (MAP_W / 2) * EDGE_INSET;
  const hz = (MAP_H / 2) * EDGE_INSET;
  const dx = Math.cos(angle);
  const dz = Math.sin(angle);
  const t = Math.min(
    Math.abs(dx) < 1e-6 ? Infinity : hx / Math.abs(dx),
    Math.abs(dz) < 1e-6 ? Infinity : hz / Math.abs(dz),
  );
  return { x: dx * t, z: dz * t };
}

// Seven well-separated start points around the edge, in random order.
function makeEdgePoints() {
  const offset = Math.random() * Math.PI * 2;
  const pts = [];
  for (let i = 0; i < MARKER_COUNT; i++) {
    const jitter = (Math.random() - 0.5) * 0.35;
    pts.push(edgePoint(offset + (i / MARKER_COUNT) * Math.PI * 2 + jitter));
  }
  for (let i = pts.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pts[i], pts[j]] = [pts[j], pts[i]];
  }
  return pts;
}

function MapMarker({ texture, shadowTexture, animRef, index }) {
  const groupRef = useRef();
  const spriteRef = useRef();
  const shadowRef = useRef();

  useFrame((_, rawDelta) => {
    const delta = Math.min(rawDelta, 0.05);
    const g = groupRef.current;
    const s = spriteRef.current;
    const sh = shadowRef.current;
    const a = animRef.current.markers?.[index];
    if (!g || !s || !a) return;

    // First frame: appear directly on the start position.
    if (!a.placed) {
      g.position.set(a.x, 0, a.z);
      a.placed = true;
    }

    // Glide along the map surface.
    const ease = 1 - Math.exp(-a.glide * delta);
    g.position.x += (a.x - g.position.x) * ease;
    g.position.z += (a.z - g.position.z) * ease;

    // Small lift while moving, so it feels picked up and set down.
    let lift = 0;
    if (a.hopActive) {
      a.hopProgress += delta / a.hopDuration;
      if (a.hopProgress >= 1) {
        a.hopProgress = 1;
        a.hopActive = false;
      } else {
        lift = Math.sin(a.hopProgress * Math.PI) * a.hopScale;
      }
    }
    s.position.y = 0.02 + lift;

    const k = 1 / (1 + lift * 1.6);
    sh.scale.set(0.55 * k, 0.55 * k, 1);
    sh.material.opacity = 0.9 * k;
  });

  return (
    <group ref={groupRef} position={[0, 0, 0]}>
      {/* contact shadow lying on the map */}
      <mesh
        ref={shadowRef}
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0.04, 0.012, 0.04]}
        renderOrder={1}
      >
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial
          map={shadowTexture}
          transparent
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>

      {/* the pin: its tip is the sprite's anchor, which touches the map */}
      <sprite
        ref={spriteRef}
        scale={[1.15, 1.15, 1]}
        center={new THREE.Vector2(0.5, PIN_TIP_FROM_BOTTOM)}
        position={[0, 0.02, 0]}
        renderOrder={2}
      >
        <spriteMaterial
          map={texture}
          transparent
          alphaTest={0.05}
          toneMapped={false}
        />
      </sprite>
    </group>
  );
}

function MarkerField({ tossToken, animRef, onMarkerMove }) {
  const textures = useMemo(
    () => MARKER_COLORS.slice(0, MARKER_COUNT).map((c) => makeMarkerTexture(c)),
    [],
  );
  const shadowTexture = useMemo(() => makeBlobShadowTexture(), []);

  // Start every marker on the map edge, each at a separate position.
  if (!animRef.current.markers) {
    const pts = makeEdgePoints();
    animRef.current.markers = pts.map((p) => ({
      x: p.x,
      z: p.z,
      arrived: false,
      glide: 8,
      hopProgress: 1,
      hopActive: false,
      hopDuration: 0.5,
      hopScale: 0.2,
    }));
    animRef.current.next = 0;
  }

  // Place the groups on their start positions before the first frame.
  useEffect(() => {
    return () => {
      textures.forEach((t) => t.dispose());
      shadowTexture.dispose();
    };
  }, [textures, shadowTexture]);

  useEffect(() => {
    if (!tossToken) return;
    const state = animRef.current;
    const markers = state.markers;
    if (!markers) return;

    // Every marker has reached the centre -> start a new cycle on the edges.
    if (markers.every((m) => m.arrived)) {
      const pts = makeEdgePoints();
      markers.forEach((m, i) => {
        m.x = pts[i].x;
        m.z = pts[i].z;
        m.arrived = false;
        m.glide = 2.2;
        m.hopProgress = 0;
        m.hopActive = true;
        m.hopDuration = 1.3;
        m.hopScale = 1.4;
      });
      state.next = 0;
      onMarkerMove?.({ type: "reset", arrivedCount: 0 });
      return;
    }

    // Find the next marker (in order) that hasn't reached the centre yet.
    let idx = state.next % markers.length;
    for (let n = 0; n < markers.length && markers[idx].arrived; n++) {
      idx = (idx + 1) % markers.length;
    }
    const m = markers[idx];

    // Move it MOVE_STEP_PX map pixels straight towards the centre.
    const dist = Math.hypot(m.x, m.z);
    if (dist <= MOVE_STEP) {
      m.x = 0;
      m.z = 0;
      m.arrived = true;
    } else {
      m.x -= (m.x / dist) * MOVE_STEP;
      m.z -= (m.z / dist) * MOVE_STEP;
    }
    m.glide = 9;
    m.hopProgress = 0;
    m.hopActive = true;
    m.hopDuration = 0.45;
    m.hopScale = 0.18;

    state.next = (idx + 1) % markers.length;

    onMarkerMove?.({
      type: "moved",
      index: idx + 1,
      arrived: m.arrived,
      remainingPx: Math.round(Math.hypot(m.x, m.z) / UNITS_PER_PX),
      arrivedCount: markers.filter((k) => k.arrived).length,
    });
  }, [tossToken, animRef, onMarkerMove]);

  return (
    <group>
      {textures.map((tex, i) => (
        <MapMarker
          key={i}
          index={i}
          texture={tex}
          shadowTexture={shadowTexture}
          animRef={animRef}
        />
      ))}
    </group>
  );
}

/* ------------------------------------------------------------------ */
/*  Physics dice                                                       */
/* ------------------------------------------------------------------ */

function readTopFace(quaternion) {
  const v = new THREE.Vector3();
  let best = { value: 1, dot: -2 };
  for (const [x, y, z, value] of FACE_NORMALS) {
    v.set(x, y, z).applyQuaternion(quaternion);
    if (v.y > best.dot) best = { value, dot: v.y };
  }
  return best;
}

function createPhysics() {
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, GRAVITY, 0) });
  world.allowSleep = true;
  world.solver.iterations = 24;

  const diceMat = new CANNON.Material("dice");
  const floorMat = new CANNON.Material("floor");
  const wallMat = new CANNON.Material("wall");

  world.addContactMaterial(
    new CANNON.ContactMaterial(diceMat, floorMat, {
      friction: 0.42,
      restitution: 0.38,
    }),
  );
  world.addContactMaterial(
    new CANNON.ContactMaterial(diceMat, wallMat, {
      friction: 0.2,
      restitution: 0.55,
    }),
  );

  // Floor (the map surface).
  const floor = new CANNON.Body({ mass: 0, material: floorMat });
  floor.addShape(new CANNON.Plane());
  floor.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
  world.addBody(floor);

  // Tall invisible walls on the map edge (the visible tray rim is lower).
  const addWall = (hx, hy, hz, x, z) => {
    const w = new CANNON.Body({ mass: 0, material: wallMat });
    w.addShape(new CANNON.Box(new CANNON.Vec3(hx, hy, hz)));
    w.position.set(x, hy, z);
    world.addBody(w);
  };
  const t = 0.5;
  addWall(MAP_W / 2 + 1, 6, t, 0, MAP_H / 2 + t);
  addWall(MAP_W / 2 + 1, 6, t, 0, -MAP_H / 2 - t);
  addWall(t, 6, MAP_H / 2 + 1, MAP_W / 2 + t, 0);
  addWall(t, 6, MAP_H / 2 + 1, -MAP_W / 2 - t, 0);

  // The die. Slightly inset so the rounded visual corners don't float.
  const h = HALF - 0.015;
  const body = new CANNON.Body({
    mass: 1,
    material: diceMat,
    shape: new CANNON.Box(new CANNON.Vec3(h, h, h)),
    linearDamping: 0.04,
    angularDamping: 0.2,
    allowSleep: true,
    sleepSpeedLimit: 0.35,
    sleepTimeLimit: 0.4,
  });
  body.position.set(0, HALF, 0);
  world.addBody(body);

  return { world, body };
}

function Dice({ tossToken, onResult }) {
  const meshRef = useRef();
  const physics = useMemo(() => createPhysics(), []);
  const tossRef = useRef(null);
  const lastHit = useRef(0);

  const geometry = useMemo(
    () => new RoundedBoxGeometry(DICE_SIZE, DICE_SIZE, DICE_SIZE, 6, 0.1),
    [],
  );

  const materials = useMemo(
    () =>
      FACE_VALUES.map((value) => {
        const { map, bump } = makeFaceTextures(value);
        return new THREE.MeshPhysicalMaterial({
          map,
          bumpMap: bump,
          bumpScale: 2.2,
          roughness: 0.28,
          metalness: 0,
          clearcoat: 0.6,
          clearcoatRoughness: 0.25,
        });
      }),
    [],
  );

  useEffect(
    () => () => {
      geometry.dispose();
      materials.forEach((m) => {
        m.map?.dispose();
        m.bumpMap?.dispose();
        m.dispose();
      });
    },
    [geometry, materials],
  );

  // Bounce sounds + start position.
  useEffect(() => {
    const { body } = physics;
    const onCollide = (e) => {
      const now = performance.now();
      if (now - lastHit.current < 45) return;
      const speed = Math.abs(e.contact.getImpactVelocityAlongNormal());
      if (speed < 0.9) return;
      lastHit.current = now;
      const other = e.body === body ? e.target : e.body;
      playImpact(speed, other?.shapes?.[0] instanceof CANNON.Box);
    };
    body.addEventListener("collide", onCollide);
    return () => body.removeEventListener("collide", onCollide);
  }, [physics]);

  // Throw the die.
  useEffect(() => {
    if (!tossToken) return;
    const { body } = physics;
    const rand = (min, max) => min + Math.random() * (max - min);
    const sign = () => (Math.random() < 0.5 ? -1 : 1);

    // Picked up from where it lies, lifted, then thrown across the map.
    const limX = MAP_W / 2 - 2.2;
    const limZ = MAP_H / 2 - 2.2;
    const sx = THREE.MathUtils.clamp(body.position.x, -limX, limX);
    const sz = THREE.MathUtils.clamp(body.position.z, -limZ, limZ);

    body.wakeUp();
    body.position.set(sx, rand(2.2, 3.2), sz);
    body.quaternion.setFromEuler(
      rand(0, Math.PI * 2),
      rand(0, Math.PI * 2),
      rand(0, Math.PI * 2),
    );

    const tx = rand(-MAP_W * 0.25, MAP_W * 0.25);
    const tz = rand(-MAP_H * 0.2, MAP_H * 0.2);
    const dx = tx - sx;
    const dz = tz - sz;
    const len = Math.hypot(dx, dz) || 1;
    const speed = rand(8, 15);

    body.velocity.set((dx / len) * speed, rand(7, 12), (dz / len) * speed);
    body.angularVelocity.set(
      sign() * rand(14, 34),
      sign() * rand(14, 34),
      sign() * rand(14, 34),
    );

    tossRef.current = { elapsed: 0, still: 0, nudges: 0 };
  }, [tossToken, physics]);

  useFrame((_, rawDelta) => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const { world, body } = physics;

    world.step(1 / 120, Math.min(rawDelta, 0.05), 10);

    mesh.position.copy(body.position);
    mesh.quaternion.copy(body.quaternion);

    const t = tossRef.current;
    if (!t) return;
    t.elapsed += rawDelta;

    const calm =
      body.velocity.length() < 0.25 && body.angularVelocity.length() < 0.45;
    if (t.elapsed > 0.5 && calm) t.still += rawDelta;
    else t.still = 0;

    const stopped =
      t.still > 0.35 || body.sleepState === CANNON.Body.SLEEPING;
    const stuck = t.elapsed > 9;

    if (stopped || stuck) {
      const { value, dot } = readTopFace(mesh.quaternion);
      // Cocked against a wall or another edge? Give it a little shake.
      if (dot < 0.985 && t.nudges < 4) {
        t.nudges += 1;
        t.still = 0;
        t.elapsed = 0;
        body.wakeUp();
        body.velocity.set(
          (Math.random() - 0.5) * 3,
          rand(5, 7),
          (Math.random() - 0.5) * 3,
        );
        body.angularVelocity.set(
          (Math.random() - 0.5) * 12,
          (Math.random() - 0.5) * 12,
          (Math.random() - 0.5) * 12,
        );
        return;
      }
      tossRef.current = null;
      onResult(value);
    }
  });

  function rand(min, max) {
    return min + Math.random() * (max - min);
  }

  return (
    <mesh
      ref={meshRef}
      geometry={geometry}
      material={materials}
      position={[0, HALF, 0]}
      castShadow
      receiveShadow
    />
  );
}

/* ------------------------------------------------------------------ */
/*  Table, map and tray                                                */
/* ------------------------------------------------------------------ */

function AbujaFloor() {
  const map = useTexture("/abuja-map.png");

  useEffect(() => {
    map.colorSpace = THREE.SRGBColorSpace;
    map.wrapS = map.wrapT = THREE.ClampToEdgeWrapping;
    map.anisotropy = 16;
    map.needsUpdate = true;
  }, [map]);

  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
      <planeGeometry args={[MAP_W, MAP_H]} />
      <meshStandardMaterial
        map={map}
        emissive="#ffffff"
        emissiveMap={map}
        emissiveIntensity={0.35}
        roughness={0.9}
        metalness={0}
      />
    </mesh>
  );
}

function Tray() {
  const rimH = 0.55;
  const rimT = 0.6;
  const mat = (
    <meshStandardMaterial color="#2b1e16" roughness={0.55} metalness={0.05} />
  );
  return (
    <group>
      {/* table */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]} receiveShadow>
        <planeGeometry args={[120, 120]} />
        <meshStandardMaterial color="#0d141f" roughness={1} />
      </mesh>
      {/* rim */}
      <mesh position={[0, rimH / 2, MAP_H / 2 + rimT / 2]} castShadow receiveShadow>
        <boxGeometry args={[MAP_W + rimT * 2, rimH, rimT]} />
        {mat}
      </mesh>
      <mesh position={[0, rimH / 2, -MAP_H / 2 - rimT / 2]} castShadow receiveShadow>
        <boxGeometry args={[MAP_W + rimT * 2, rimH, rimT]} />
        {mat}
      </mesh>
      <mesh position={[MAP_W / 2 + rimT / 2, rimH / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[rimT, rimH, MAP_H]} />
        {mat}
      </mesh>
      <mesh position={[-MAP_W / 2 - rimT / 2, rimH / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[rimT, rimH, MAP_H]} />
        {mat}
      </mesh>
    </group>
  );
}

/* ------------------------------------------------------------------ */
/*  Camera + input                                                     */
/* ------------------------------------------------------------------ */

function CameraRig({ orbitState }) {
  useFrame(({ camera, size }, rawDelta) => {
    const s = orbitState.current;
    const delta = Math.min(rawDelta, 0.05);
    const aspect = size.width / size.height;

    // Keep the whole map in view on narrow (portrait) screens.
    const base = 21 * Math.max(1, 1.75 / aspect);
    const target = base * s.zoom;
    s.radius += (target - s.radius) * (1 - Math.exp(-6 * delta));

    const sp = Math.sin(s.phi);
    camera.position.set(
      s.radius * sp * Math.cos(s.theta),
      s.radius * Math.cos(s.phi),
      s.radius * sp * Math.sin(s.theta),
    );
    camera.lookAt(0, 0.2, 0);
  });
  return null;
}

function useOrbitDrag(wrapRef, orbitState) {
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const s = orbitState.current;

    const onDown = (e) => {
      s.dragging = true;
      s.dragDistance = 0;
      const p = e.touches ? e.touches[0] : e;
      s.lastX = p.clientX;
      s.lastY = p.clientY;
    };

    const onMove = (e) => {
      if (!s.dragging) return;
      const p = e.touches ? e.touches[0] : e;
      const dx = p.clientX - s.lastX;
      const dy = p.clientY - s.lastY;
      s.lastX = p.clientX;
      s.lastY = p.clientY;
      s.dragDistance += Math.abs(dx) + Math.abs(dy);

      s.theta -= dx * 0.005;
      s.phi -= dy * 0.005;
      s.phi = Math.max(0.25, Math.min(Math.PI / 2.15, s.phi));
    };

    const onUp = () => {
      s.dragging = false;
    };

    const onWheel = (e) => {
      e.preventDefault();
      s.zoom = Math.max(0.45, Math.min(1.7, s.zoom + e.deltaY * 0.001));
    };

    el.addEventListener("mousedown", onDown);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    el.addEventListener("touchstart", onDown, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: true });
    window.addEventListener("touchend", onUp);
    el.addEventListener("wheel", onWheel, { passive: false });

    return () => {
      el.removeEventListener("mousedown", onDown);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      el.removeEventListener("touchstart", onDown);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onUp);
      el.removeEventListener("wheel", onWheel);
    };
  }, [wrapRef, orbitState]);
}

/* ------------------------------------------------------------------ */
/*  App                                                                */
/* ------------------------------------------------------------------ */

export default function AbujaDice() {
  const [tossToken, setTossToken] = useState(0);
  const [result, setResult] = useState(null);
  const [rolling, setRolling] = useState(false);
  const [arrivedCount, setArrivedCount] = useState(0);
  const [tosses, setTosses] = useState(0);
  const [log, setLog] = useState([]);

  const wrapRef = useRef(null);
  const logId = useRef(0);
  const rollingRef = useRef(false);

  const orbitState = useRef({
    dragging: false,
    dragDistance: 0,
    lastX: 0,
    lastY: 0,
    theta: Math.PI / 2, // camera in front, north (top of the map) is away
    phi: 0.85,
    radius: 26,
    zoom: 1,
  });

  const markerAnimRef = useRef({ markers: null, next: 0 });

  useOrbitDrag(wrapRef, orbitState);

  const toss = useCallback(() => {
    if (rollingRef.current) return;
    rollingRef.current = true;
    ensureAudio();
    setRolling(true);
    setTosses((n) => n + 1);
    setTossToken((t) => t + 1);
  }, []);

  const recordResult = useCallback((value) => {
    rollingRef.current = false;
    setResult(value);
    setRolling(false);
  }, []);

  const handleMarkerMove = useCallback((info) => {
    const id = ++logId.current;
    setArrivedCount(info.arrivedCount);
    const entry =
      info.type === "reset"
        ? { id, kind: "reset", text: "All markers at the centre. New cycle" }
        : {
            id,
            kind: info.arrived ? "arrived" : "moved",
            text: info.arrived
              ? `Marker ${info.index} reached the centre`
              : `Marker ${info.index} moved ${MOVE_STEP_PX}px (${info.remainingPx}px left)`,
          };
    setLog((l) => [entry, ...l].slice(0, 8));
  }, []);

  const handleClick = useCallback(() => {
    if (orbitState.current.dragDistance > 6) return;
    toss();
  }, [toss]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.code === "Space") {
        e.preventDefault();
        toss();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toss]);

  return (
    <main
      style={{
        position: "fixed",
        inset: 0,
        margin: 0,
        padding: 0,
        overflow: "hidden",
        background: "#0b111b",
        cursor: "grab",
        touchAction: "none",
      }}
    >
      <style>{`
        html, body, #root { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; background: #0b111b; }
        * { box-sizing: border-box; }
        .result-panel {
          position: fixed; top: 20px; right: 20px; z-index: 10;
          min-width: 190px; padding: 16px 20px;
          background: rgba(16, 26, 39, 0.85);
          border: 1px solid #3a4c62; border-radius: 14px;
          backdrop-filter: blur(10px);
          font-family: 'DM Mono', ui-monospace, monospace;
          color: #f4f6fa; user-select: none; pointer-events: none;
        }
        .result-panel .label { font-size: 10px; letter-spacing: 1.5px; color: #96a6b9; margin: 0 0 6px; }
        .result-panel .value { font-size: 44px; font-weight: 700; line-height: 1; color: #f1c47d; }
        .result-panel .status { font-size: 10px; letter-spacing: 1.2px; margin-top: 6px; color: #75c9a1; }
        .result-panel .status.rolling { color: #e7b86c; }
        .result-panel .divider { height: 1px; background: #2c3a4b; margin: 12px 0; }
        .result-panel .progress { font-size: 11px; color: #96a6b9; letter-spacing: 1px; line-height: 1.7; }
        .result-panel .progress strong { color: #f1c47d; }
        .result-panel .bar { height: 4px; background: #1e2937; border-radius: 2px; margin-top: 6px; overflow: hidden; }
        .result-panel .bar-fill { height: 100%; background: #75c9a1; transition: width 0.3s ease; }
        .log-panel {
          position: fixed; top: 255px; right: 20px; z-index: 10;
          width: 190px; max-height: 40vh; overflow-y: auto;
          background: rgba(16, 26, 39, 0.75);
          border: 1px solid #2c3a4b; border-radius: 12px;
          padding: 12px; font-family: 'DM Mono', ui-monospace, monospace;
          font-size: 10px; color: #96a6b9; letter-spacing: 0.6px;
          user-select: none; pointer-events: none;
        }
        .log-panel h4 { margin: 0 0 8px; font-size: 9px; letter-spacing: 1.5px; color: #f1c47d; }
        .log-panel .entry { padding: 4px 0; border-bottom: 1px solid #1e2937; }
        .log-panel .entry.reset { color: #e7b86c; }
        .log-panel .entry.arrived { color: #75c9a1; }
        .hint { position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%); z-index: 10;
          font-family: 'DM Mono', ui-monospace, monospace; font-size: 10px; letter-spacing: 1.5px;
          color: #96a6b9; background: rgba(16,26,39,0.7); padding: 8px 14px; border-radius: 20px;
          border: 1px solid #2c3a4b; pointer-events: none; user-select: none; white-space: nowrap; }
      `}</style>

      <div
        ref={wrapRef}
        onClick={handleClick}
        style={{ position: "absolute", inset: 0, cursor: "grab" }}
      >
        <Canvas
          shadows
          dpr={[1, 2]}
          camera={{ position: [0, 17, 13], fov: 45, near: 0.1, far: 300 }}
          gl={{ antialias: true }}
          style={{ width: "100%", height: "100%", display: "block" }}
        >
          <color attach="background" args={["#0b111b"]} />
          <ambientLight intensity={0.55} />
          <directionalLight
            position={[6, 14, 8]}
            intensity={2.6}
            castShadow
            shadow-mapSize-width={2048}
            shadow-mapSize-height={2048}
            shadow-camera-left={-14}
            shadow-camera-right={14}
            shadow-camera-top={12}
            shadow-camera-bottom={-12}
            shadow-camera-near={1}
            shadow-camera-far={45}
            shadow-bias={-0.0004}
            shadow-normalBias={0.02}
            shadow-radius={4}
          />
          <Environment preset="city" />

          <CameraRig orbitState={orbitState} />

          <Tray />
          <AbujaFloor />

          <MarkerField
            tossToken={tossToken}
            animRef={markerAnimRef}
            onMarkerMove={handleMarkerMove}
          />

          <Dice tossToken={tossToken} onResult={recordResult} />
        </Canvas>
      </div>

      <div className="result-panel">
        <p className="label">DICE RESULT</p>
        <div className="value">{result ?? "—"}</div>
        <div className={`status ${rolling ? "rolling" : ""}`}>
          {rolling ? "ROLLING..." : result ? "SETTLED" : "READY"}
        </div>
        <div className="divider" />
        <div className="progress">
          TOSSES <strong>{tosses}</strong>
          <br />
          AT CENTRE{" "}
          <strong>
            {arrivedCount}/{MARKER_COUNT}
          </strong>
        </div>
        <div className="bar">
          <div
            className="bar-fill"
            style={{ width: `${(arrivedCount / MARKER_COUNT) * 100}%` }}
          />
        </div>
      </div>

      <div className="log-panel">
        <h4>MOVE LOG</h4>
        {log.length === 0 ? (
          <div className="entry" style={{ color: "#5a6b80" }}>
            No moves yet
          </div>
        ) : (
          log.map((e) => (
            <div key={e.id} className={`entry ${e.kind}`}>
              {e.text}
            </div>
          ))
        )}
      </div>

      <div className="hint">
        DRAG TO ORBIT · CLICK OR SPACE TO TOSS · SCROLL TO ZOOM
      </div>
    </main>
  );
}
