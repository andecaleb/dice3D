import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import {
  ContactShadows,
  Environment,
  RoundedBox,
  useTexture,
} from "@react-three/drei";
import * as THREE from "three";

const FACE_VALUES = [3, 4, 1, 6, 2, 5];

const FACE_ROTATIONS = {
  1: [0, 0, 0],
  2: [-Math.PI / 2, 0, 0],
  3: [0, 0, -Math.PI / 2],
  4: [0, 0, Math.PI / 2],
  5: [Math.PI / 2, 0, 0],
  6: [0, 0, Math.PI],
};

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

function makeFaceTexture(value) {
  const size = 512;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "#f7f5ef";
  ctx.fillRect(0, 0, size, size);

  const pipRadius = size * 0.115;
  ctx.fillStyle = "#17191f";

  for (const [nx, ny] of PIP_POSITIONS[value]) {
    const inset = size * 0.14;
    const cx = inset + ((nx + 1) / 2) * (size - inset * 2);
    const cy = inset + ((ny + 1) / 2) * (size - inset * 2);
    ctx.beginPath();
    ctx.arc(cx, cy, pipRadius, 0, Math.PI * 2);
    ctx.fill();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 16;
  texture.needsUpdate = true;
  return texture;
}

// ------- Google Maps-style pin texture -------
function makeMarkerTexture(color = "#ea4335") {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");

  const cx = size / 2;
  const headR = size * 0.28;
  const headCY = size * 0.36;

  // Shadow
  ctx.fillStyle = "rgba(0,0,0,0.18)";
  ctx.beginPath();
  ctx.ellipse(cx, size * 0.9, size * 0.16, size * 0.045, 0, 0, Math.PI * 2);
  ctx.fill();

  // Pin body
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(cx, headCY, headR, Math.PI * 0.15, Math.PI * 0.85, true);
  ctx.lineTo(cx, size * 0.86);
  ctx.closePath();
  ctx.fill();

  // Inner circle
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(cx, headCY, headR * 0.45, 0, Math.PI * 2);
  ctx.fill();

  // Highlight
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
  texture.needsUpdate = true;
  return texture;
}

// One marker. Its pin base sits exactly on the floor (y = 0).
// The sprite sits at the top of the pin, hovering above the ground.
function MapMarker({ texture, animRef, index }) {
  const groupRef = useRef();
  const spriteRef = useRef();

  useFrame((state, delta) => {
    const g = groupRef.current;
    const s = spriteRef.current;
    if (!g || !s) return;

    const a = animRef.current.markers[index];
    if (!a) return;

    // Move X/Z toward target with easing — this is the "hop" trajectory.
    const ease = 1 - Math.exp(-4 * delta);
    g.position.x = THREE.MathUtils.lerp(g.position.x, a.x, ease);
    g.position.z = THREE.MathUtils.lerp(g.position.z, a.z, ease);

    // The "hop": a parabolic arc driven by `a.hop`. `hop` goes 0 → 1 → 0
    // across the hop duration, so the sprite rises and falls.
    const hopHeight = Math.sin(Math.min(a.hop, 1) * Math.PI) * a.hopScale;
    s.position.y = 1.15 + hopHeight;

    // Billboard: always face the camera horizontally.
    s.lookAt(
      state.camera.position.x,
      s.getWorldPosition(new THREE.Vector3()).y,
      state.camera.position.z,
    );
  });

  return (
    <group ref={groupRef}>
      {/* Pin sprite (billboarded) — sits above the floor with a small hover */}
      <sprite ref={spriteRef} scale={[1.3, 1.3, 1.3]} position={[0, 1.15, 0]}>
        <spriteMaterial
          map={texture}
          transparent
          depthWrite={false}
          toneMapped={false}
        />
      </sprite>
    </group>
  );
}

// Marker field: keeps pins planted on the map, and on each toss reassigns
// each pin to a new location ONE AFTER ANOTHER (sequenced hop animation).
const MARKER_COUNT = 7;
const MARKER_COLORS = [
  "#ea4335",
  "#4285f4",
  "#fbbc04",
  "#34a853",
  "#ea4335",
  "#4285f4",
  "#fbbc04",
];

// A safe region on the map for pins to live in (doesn't overlap the dice).
const MAP_RADIUS_MIN = 3.2;
const MAP_RADIUS_MAX = 8.5;

function randomMapPoint(avoid = []) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const angle = Math.random() * Math.PI * 2;
    const r =
      MAP_RADIUS_MIN + Math.random() * (MAP_RADIUS_MAX - MAP_RADIUS_MIN);
    const p = { x: Math.cos(angle) * r, z: Math.sin(angle) * r };
    let tooClose = false;
    for (const q of avoid) {
      const dx = p.x - q.x;
      const dz = p.z - q.z;
      if (dx * dx + dz * dz < 1.6 * 1.6) {
        tooClose = true;
        break;
      }
    }
    if (!tooClose) return p;
  }
  // Fallback
  return { x: 0, z: 0 };
}

function MarkerField({ tossToken, animRef }) {
  const textures = useMemo(
    () => MARKER_COLORS.map((c) => makeMarkerTexture(c)),
    [],
  );

  // Initial random placements, shared across mounts.
  if (!animRef.current.markers || animRef.current.markers.length === 0) {
    const initial = [];
    for (let i = 0; i < MARKER_COUNT; i++) {
      const pt = randomMapPoint(initial);
      initial.push({
        x: pt.x,
        z: pt.z,
        hop: 1, // start resting
        hopScale: 0.55, // how high this marker jumps
      });
    }
    animRef.current.markers = initial;
  }

  // On each toss: reassign each marker to a new random spot, but stagger
  // the hops so they move ONE AFTER ANOTHER (not all at once).
  useEffect(() => {
    if (!tossToken) return;
    const markers = animRef.current.markers;
    if (!markers) return;

    const STAGGER_MS = 220; // delay between each marker's hop start
    const timers = [];

    // Build the sequence.
    for (let i = 0; i < markers.length; i++) {
      const slot = i;
      const delay = slot * STAGGER_MS;

      const startTimer = setTimeout(() => {
        // Pick a new position that doesn't overlap other markers' targets
        // (using current targets as avoidance hints).
        const others = markers
          .map((m, idx) => (idx === slot ? null : { x: m.x, z: m.z }))
          .filter(Boolean);
        const dest = randomMapPoint(others);

        // Kick off the hop for this marker.
        markers[slot].targetX = dest.x;
        markers[slot].targetZ = dest.z;
        markers[slot].hop = 0;
        markers[slot].hopScale = 0.5 + Math.random() * 0.6;
      }, delay);

      timers.push(startTimer);
    }

    // After the stagger completes, let markers glide to their new spots
    // (the hop parameter is animated in useFrame).
    return () => timers.forEach(clearTimeout);
  }, [tossToken, animRef]);

  return (
    <group>
      {textures.map((tex, i) => (
        <MapMarker key={i} index={i} texture={tex} animRef={animRef} />
      ))}
    </group>
  );
}

const DICE_SIZE = 2;
const REST_Y = DICE_SIZE / 2;
const GRAVITY = -14;
const TOSS_VELOCITY_MIN = 13;
const TOSS_VELOCITY_MAX = 16;
const BOUNCE_DAMPING = 0.45;
const MIN_BOUNCE = 2.0;

const cameraState = {
  cinematic: false,
};

let currentApexY = 0;

function Dice({ tossToken, onResult, orbitState }) {
  const diceRef = useRef();
  const anim = useRef(null);

  const materials = useMemo(
    () =>
      FACE_VALUES.map((value) => {
        const texture = makeFaceTexture(value);
        return new THREE.MeshStandardMaterial({
          map: texture,
          roughness: 0.3,
          metalness: 0.02,
        });
      }),
    [],
  );

  useEffect(() => {
    return () =>
      materials.forEach((m) => {
        m.map?.dispose();
        m.dispose();
      });
  }, [materials]);

  useEffect(() => {
    if (!tossToken || !diceRef.current) return;

    const value = Math.floor(Math.random() * 6) + 1;
    const base = FACE_ROTATIONS[value];

    const spinsX = (2 + Math.floor(Math.random() * 3)) * Math.PI * 2;
    const spinsY = (2 + Math.floor(Math.random() * 3)) * Math.PI * 2;
    const spinsZ = (2 + Math.floor(Math.random() * 3)) * Math.PI * 2;

    diceRef.current.position.set(0, REST_Y, 0);
    diceRef.current.rotation.set(
      Math.random() * Math.PI,
      Math.random() * Math.PI,
      Math.random() * Math.PI,
    );

    anim.current = {
      value,
      fromRot: diceRef.current.rotation.clone(),
      targetRot: new THREE.Euler(
        base[0] + spinsX,
        base[1] + spinsY,
        base[2] + spinsZ,
      ),
      rotElapsed: 0,
      rotDuration: 2.4 + Math.random() * 0.5,
      rotDone: false,
      y: REST_Y,
      vy:
        TOSS_VELOCITY_MIN +
        Math.random() * (TOSS_VELOCITY_MAX - TOSS_VELOCITY_MIN),
      settled: false,
    };

    currentApexY = 0;
    cameraState.cinematic = true;
  }, [tossToken]);

  useFrame((state, delta) => {
    const dice = diceRef.current;
    if (!dice) return;

    const a = anim.current;

    if (a) {
      if (!a.rotDone) {
        a.rotElapsed += delta;
        const t = Math.min(a.rotElapsed / a.rotDuration, 1);
        const eased = 1 - Math.pow(1 - t, 3);
        dice.rotation.set(
          THREE.MathUtils.lerp(a.fromRot.x, a.targetRot.x, eased),
          THREE.MathUtils.lerp(a.fromRot.y, a.targetRot.y, eased),
          THREE.MathUtils.lerp(a.fromRot.z, a.targetRot.z, eased),
        );
        if (t >= 1) {
          dice.rotation.copy(a.targetRot);
          a.rotDone = true;
        }
      }

      if (!a.settled) {
        a.vy += GRAVITY * delta;
        a.y += a.vy * delta;
        if (a.y > currentApexY) currentApexY = a.y;

        if (a.y <= REST_Y) {
          a.y = REST_Y;
          if (Math.abs(a.vy) < MIN_BOUNCE) {
            a.vy = 0;
            a.settled = true;
          } else {
            a.vy = -a.vy * BOUNCE_DAMPING;
            dice.rotation.y += (Math.random() - 0.5) * 0.06;
            dice.rotation.x += (Math.random() - 0.5) * 0.06;
          }
        }
        dice.position.y = a.y;
      }

      if (a.rotDone && a.settled) {
        dice.position.y = REST_Y;
        const result = a.value;
        anim.current = null;
        cameraState.cinematic = false;
        onResult(result);
      }
    }

    const orbit = orbitState?.current;
    if (orbit) {
      const airborne = cameraState.cinematic && anim.current;

      let targetRadius;
      let targetLookY;

      if (airborne) {
        const apex = Math.max(currentApexY, REST_Y);
        targetRadius = Math.max(16, apex * 2.6 + 8);
        targetLookY = apex * 0.45;
      } else {
        targetRadius = 12;
        targetLookY = REST_Y * 0.8;
      }

      const ease = 1 - Math.exp(-2.5 * delta);
      orbit.radius = THREE.MathUtils.lerp(orbit.radius, targetRadius, ease);
      orbit.lookY = THREE.MathUtils.lerp(
        orbit.lookY ?? targetLookY,
        targetLookY,
        ease,
      );

      const sp = Math.sin(orbit.phi);
      state.camera.position.set(
        orbit.radius * sp * Math.cos(orbit.theta),
        orbit.radius * Math.cos(orbit.phi),
        orbit.radius * sp * Math.sin(orbit.theta),
      );
      state.camera.lookAt(0, orbit.lookY, 0);
    }
  });

  return (
    <group>
      <RoundedBox
        ref={diceRef}
        args={[DICE_SIZE, DICE_SIZE, DICE_SIZE]}
        radius={0.14}
        smoothness={6}
        position={[0, REST_Y, 0]}
        castShadow
        receiveShadow
      >
        {materials.map((material, index) => (
          <primitive
            key={index}
            object={material}
            attach={`material-${index}`}
          />
        ))}
      </RoundedBox>
    </group>
  );
}

function AbujaFloor() {
  const map = useTexture("/abuja-map.png");

  useEffect(() => {
    map.colorSpace = THREE.SRGBColorSpace;
    map.wrapS = map.wrapT = THREE.ClampToEdgeWrapping;
    map.anisotropy = 16;
    map.needsUpdate = true;
  }, [map]);

  return (
    <mesh
      rotation={[-Math.PI / 2, 0, 0]}
      position={[0, -0.03, 0]}
      receiveShadow
    >
      <planeGeometry args={[60, 60]} />
      <meshStandardMaterial map={map} roughness={0.95} metalness={0} />
    </mesh>
  );
}

function playDiceSound() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;

  const audio = new AC();
  const duration = 0.8;
  const buffer = audio.createBuffer(
    1,
    audio.sampleRate * duration,
    audio.sampleRate,
  );
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) {
    const t = i / audio.sampleRate;
    data[i] = (Math.random() * 2 - 1) * Math.exp(-t * 3.5);
  }

  const src = audio.createBufferSource();
  const filter = audio.createBiquadFilter();
  const gain = audio.createGain();
  src.buffer = buffer;
  filter.type = "lowpass";
  filter.frequency.value = 1800;
  gain.gain.value = 0.22;
  src.connect(filter);
  filter.connect(gain);
  gain.connect(audio.destination);
  src.start();

  for (let i = 0; i < 7; i++) {
    const osc = audio.createOscillator();
    const g = audio.createGain();
    const s = audio.currentTime + i * 0.095;
    osc.type = "triangle";
    osc.frequency.value = 180 + Math.random() * 300;
    g.gain.setValueAtTime(0.0001, s);
    g.gain.exponentialRampToValueAtTime(0.12, s + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, s + 0.065);
    osc.connect(g);
    g.connect(audio.destination);
    osc.start(s);
    osc.stop(s + 0.07);
  }

  src.onended = () => audio.close();
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
      s.phi = Math.max(0.25, Math.min(Math.PI / 2.1, s.phi));
    };

    const onUp = () => {
      s.dragging = false;
    };

    const onWheel = (e) => {
      e.preventDefault();
      if (!s.dragging) {
        s.radius += e.deltaY * 0.01;
        s.radius = Math.max(5, Math.min(30, s.radius));
      }
    };

    el.addEventListener("mousedown", onDown);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    el.addEventListener("touchstart", onDown, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: false });
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

export default function AbujaDice() {
  const [tossToken, setTossToken] = useState(0);
  const [result, setResult] = useState(null);
  const [rolling, setRolling] = useState(false);

  const wrapRef = useRef(null);

  const orbitState = useRef({
    dragging: false,
    dragDistance: 0,
    lastX: 0,
    lastY: 0,
    theta: Math.PI / 4,
    phi: Math.PI / 3.2,
    radius: 12,
    lookY: REST_Y * 0.8,
  });

  // Shared marker state, initialized with random map positions.
  const markerAnimRef = useRef({ markers: null });

  useOrbitDrag(wrapRef, orbitState);

  const toss = useCallback(() => {
    if (rolling) return;
    setRolling(true);
    playDiceSound();
    setTossToken((t) => t + 1);
  }, [rolling]);

  const recordResult = useCallback((value) => {
    setResult(value);
    setRolling(false);
  }, []);

  const handleClick = useCallback(() => {
    if (orbitState.current.dragDistance > 6) return;
    toss();
  }, [toss, orbitState]);

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
          min-width: 150px; padding: 16px 20px;
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
        .hint { position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%); z-index: 10;
          font-family: 'DM Mono', ui-monospace, monospace; font-size: 10px; letter-spacing: 1.5px;
          color: #96a6b9; background: rgba(16,26,39,0.7); padding: 8px 14px; border-radius: 20px;
          border: 1px solid #2c3a4b; pointer-events: none; user-select: none; }
      `}</style>

      <div
        ref={wrapRef}
        onClick={handleClick}
        style={{ position: "absolute", inset: 0, cursor: "grab" }}
      >
        <Canvas
          shadows
          dpr={[1, 2]}
          camera={{ position: [6.4, 6.2, 8.5], fov: 45, near: 0.1, far: 200 }}
          gl={{ antialias: true }}
          style={{ width: "100%", height: "100%", display: "block" }}
        >
          <color attach="background" args={["#101a27"]} />
          <ambientLight intensity={1.15} />
          <directionalLight
            position={[4, 9, 5]}
            intensity={3}
            castShadow
            shadow-mapSize-width={2048}
            shadow-mapSize-height={2048}
          />
          <Environment preset="city" />

          <AbujaFloor />
          <ContactShadows
            position={[0, 0, 0]}
            opacity={0.55}
            scale={20}
            blur={2.5}
            far={4}
          />

          <MarkerField tossToken={tossToken} animRef={markerAnimRef} />

          <Dice
            tossToken={tossToken}
            onResult={recordResult}
            orbitState={orbitState}
          />
        </Canvas>
      </div>

      <div className="result-panel">
        <p className="label">DICE RESULT</p>
        <div className="value">{result ?? "—"}</div>
        <div className={`status ${rolling ? "rolling" : ""}`}>
          {rolling ? "ROLLING..." : result ? "SETTLED" : "READY"}
        </div>
      </div>

      <div className="hint">DRAG TO ORBIT · CLICK TO TOSS · SCROLL TO ZOOM</div>
    </main>
  );
}
