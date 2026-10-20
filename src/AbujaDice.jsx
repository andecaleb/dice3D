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

function makeMarkerTexture(color = "#ea4335") {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");

  const cx = size / 2;
  const headR = size * 0.28;
  const headCY = size * 0.36;

  ctx.fillStyle = "rgba(0,0,0,0.18)";
  ctx.beginPath();
  ctx.ellipse(cx, size * 0.9, size * 0.16, size * 0.045, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(cx, headCY, headR, Math.PI * 0.15, Math.PI * 0.85, true);
  ctx.lineTo(cx, size * 0.86);
  ctx.closePath();
  ctx.fill();

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
  texture.needsUpdate = true;
  return texture;
}

function MapMarker({ texture, animRef, index }) {
  const groupRef = useRef();
  const spriteRef = useRef();

  useFrame((state, delta) => {
    const g = groupRef.current;
    const s = spriteRef.current;
    if (!g || !s) return;

    const a = animRef.current.markers[index];
    if (!a) return;

    // Move X/Z toward current target.
    const ease = 1 - Math.exp(-4 * delta);
    g.position.x = THREE.MathUtils.lerp(g.position.x, a.x, ease);
    g.position.z = THREE.MathUtils.lerp(g.position.z, a.z, ease);

    // Hop arc: `hop` is 0..1 progress. Only animate y when hopping.
    let hopHeight = 0;
    if (a.hopActive && a.hopProgress < 1) {
      a.hopProgress += delta / a.hopDuration;
      if (a.hopProgress >= 1) {
        a.hopProgress = 1;
        a.hopActive = false;
      }
      hopHeight = Math.sin(a.hopProgress * Math.PI) * a.hopScale;
    }
    s.position.y = 1.15 + hopHeight;

    // Billboard.
    s.lookAt(
      state.camera.position.x,
      s.getWorldPosition(new THREE.Vector3()).y,
      state.camera.position.z,
    );
  });

  return (
    <group ref={groupRef}>
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

// Edge band on the map for marker starting positions.
const EDGE_MIN_RADIUS = 7.5;
const EDGE_MAX_RADIUS = 10.5;

// Interior band for marker destinations after a move.
const INTERIOR_MIN_RADIUS = 2.5;
const INTERIOR_MAX_RADIUS = 7.0;

function randomEdgePoint(avoid = []) {
  for (let attempt = 0; attempt < 30; attempt++) {
    const angle = Math.random() * Math.PI * 2;
    const r =
      EDGE_MIN_RADIUS + Math.random() * (EDGE_MAX_RADIUS - EDGE_MIN_RADIUS);
    const p = { x: Math.cos(angle) * r, z: Math.sin(angle) * r };
    let tooClose = false;
    for (const q of avoid) {
      const dx = p.x - q.x;
      const dz = p.z - q.z;
      if (dx * dx + dz * dz < 1.8 * 1.8) {
        tooClose = true;
        break;
      }
    }
    if (!tooClose) return p;
  }
  const angle = Math.random() * Math.PI * 2;
  return {
    x: Math.cos(angle) * EDGE_MIN_RADIUS,
    z: Math.sin(angle) * EDGE_MIN_RADIUS,
  };
}

function randomInteriorPoint(avoid = []) {
  for (let attempt = 0; attempt < 30; attempt++) {
    const angle = Math.random() * Math.PI * 2;
    const r =
      INTERIOR_MIN_RADIUS +
      Math.random() * (INTERIOR_MAX_RADIUS - INTERIOR_MIN_RADIUS);
    const p = { x: Math.cos(angle) * r, z: Math.sin(angle) * r };
    let tooClose = false;
    for (const q of avoid) {
      const dx = p.x - q.x;
      const dz = p.z - q.z;
      if (dx * dx + dz * dz < 1.8 * 1.8) {
        tooClose = true;
        break;
      }
    }
    if (!tooClose) return p;
  }
  const angle = Math.random() * Math.PI * 2;
  return {
    x: Math.cos(angle) * INTERIOR_MIN_RADIUS,
    z: Math.sin(angle) * INTERIOR_MIN_RADIUS,
  };
}

function MarkerField({ tossToken, animRef, onMarkerMove }) {
  const textures = useMemo(
    () => MARKER_COLORS.map((c) => makeMarkerTexture(c)),
    [],
  );

  // Initialize markers on the edge of the map.
  if (!animRef.current.markers) {
    const initial = [];
    for (let i = 0; i < MARKER_COUNT; i++) {
      const pt = randomEdgePoint(initial.map((m) => ({ x: m.x, z: m.z })));
      initial.push({
        x: pt.x,
        z: pt.z,
        hopProgress: 1,
        hopActive: false,
        hopDuration: 0.9,
        hopScale: 0.55,
      });
    }
    animRef.current.markers = initial;
    // Track which markers have already moved in the current cycle.
    animRef.current.movedCount = 0;
  }

  // On each toss, move exactly ONE marker (the next one in sequence).
  useEffect(() => {
    if (!tossToken) return;

    const state = animRef.current;
    if (!state.markers) return;

    // If all markers have moved, reset the cycle: all return to the edge.
    if (state.movedCount >= MARKER_COUNT) {
      state.movedCount = 0;
      for (let i = 0; i < state.markers.length; i++) {
        const others = state.markers
          .filter((_, idx) => idx !== i)
          .map((m) => ({ x: m.x, z: m.z }));
        const pt = randomEdgePoint(others);
        const m = state.markers[i];
        m.x = pt.x;
        m.z = pt.z;
        m.hopProgress = 0;
        m.hopActive = true;
        m.hopDuration = 0.9;
        m.hopScale = 0.4 + Math.random() * 0.5;
      }
      onMarkerMove?.(0, "reset");
      return;
    }

    // Otherwise move ONE marker (the next in line).
    const idx = state.movedCount;
    const others = state.markers
      .filter((_, i) => i !== idx)
      .map((m) => ({ x: m.x, z: m.z }));
    const pt = randomInteriorPoint(others);

    const m = state.markers[idx];
    m.x = pt.x;
    m.z = pt.z;
    m.hopProgress = 0;
    m.hopActive = true;
    m.hopDuration = 1.1;
    m.hopScale = 0.6 + Math.random() * 0.6;

    state.movedCount += 1;
    onMarkerMove?.(idx + 1, "moved");
  }, [tossToken, animRef, onMarkerMove]);

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
        targetRadius = 14;
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
  // Track markers moved this cycle: value 0..7.
  const [movedCount, setMovedCount] = useState(0);
  // Log of movement events.
  const [log, setLog] = useState([]);

  const wrapRef = useRef(null);

  const orbitState = useRef({
    dragging: false,
    dragDistance: 0,
    lastX: 0,
    lastY: 0,
    theta: Math.PI / 4,
    phi: Math.PI / 3.2,
    radius: 14,
    lookY: REST_Y * 0.8,
  });

  const markerAnimRef = useRef({ markers: null, movedCount: 0 });

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

  const handleMarkerMove = useCallback((count, kind) => {
    if (kind === "reset") {
      setMovedCount(0);
      setLog((l) =>
        [
          {
            id: Date.now(),
            text: "All markers returned to the edge — new cycle",
            kind: "reset",
          },
          ...l,
        ].slice(0, 8),
      );
    } else {
      setMovedCount(count);
      setLog((l) =>
        [
          {
            id: Date.now(),
            text: `Marker ${count} moved (${count}/7)`,
            kind: "moved",
          },
          ...l,
        ].slice(0, 8),
      );
    }
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
          min-width: 180px; padding: 16px 20px;
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
        .result-panel .progress { font-size: 11px; color: #96a6b9; letter-spacing: 1px; }
        .result-panel .progress strong { color: #f1c47d; }
        .result-panel .bar { height: 4px; background: #1e2937; border-radius: 2px; margin-top: 6px; overflow: hidden; }
        .result-panel .bar-fill { height: 100%; background: #75c9a1; transition: width 0.3s ease; }
        .log-panel {
          position: fixed; top: 220px; right: 20px; z-index: 10;
          width: 180px; max-height: 40vh; overflow-y: auto;
          background: rgba(16, 26, 39, 0.75);
          border: 1px solid #2c3a4b; border-radius: 12px;
          padding: 12px; font-family: 'DM Mono', ui-monospace, monospace;
          font-size: 10px; color: #96a6b9; letter-spacing: 0.6px;
          user-select: none; pointer-events: none;
        }
        .log-panel h4 { margin: 0 0 8px; font-size: 9px; letter-spacing: 1.5px; color: #f1c47d; }
        .log-panel .entry { padding: 4px 0; border-bottom: 1px solid #1e2937; }
        .log-panel .entry.reset { color: #e7b86c; }
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

          <MarkerField
            tossToken={tossToken}
            animRef={markerAnimRef}
            onMarkerMove={handleMarkerMove}
          />

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
        <div className="divider" />
        <div className="progress">
          MARKERS MOVED <strong>{movedCount}/7</strong>
        </div>
        <div className="bar">
          <div
            className="bar-fill"
            style={{ width: `${(movedCount / 7) * 100}%` }}
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

      <div className="hint">DRAG TO ORBIT · CLICK TO TOSS · SCROLL TO ZOOM</div>
    </main>
  );
}
