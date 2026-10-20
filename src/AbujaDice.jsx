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

// Each entry rotates the selected face upward.
// Material order for BoxGeometry: +X, -X, +Y, -Y, +Z, -Z.
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
    [-0.36, 0.36],
    [0.36, -0.36],
  ],
  3: [
    [-0.36, 0.36],
    [0, 0],
    [0.36, -0.36],
  ],
  4: [
    [-0.36, 0.36],
    [0.36, 0.36],
    [-0.36, -0.36],
    [0.36, -0.36],
  ],
  5: [
    [-0.36, 0.36],
    [0.36, 0.36],
    [0, 0],
    [-0.36, -0.36],
    [0.36, -0.36],
  ],
  6: [
    [-0.36, 0.36],
    [0.36, 0.36],
    [-0.36, 0],
    [0.36, 0],
    [-0.36, -0.36],
    [0.36, -0.36],
  ],
};

function makeFaceTexture(value) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 256;

  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#f7f5ef";
  ctx.fillRect(0, 0, 256, 256);

  ctx.fillStyle = "#17191f";

  for (const [x, y] of PIP_POSITIONS[value]) {
    ctx.beginPath();
    ctx.arc(128 + x * 220, 128 + y * 220, 19, 0, Math.PI * 2);
    ctx.fill();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function Dice({ tossToken, onResult }) {
  const diceRef = useRef();
  const animation = useRef(null);

  const materials = useMemo(
    () =>
      FACE_VALUES.map((value) => {
        const texture = makeFaceTexture(value);
        return new THREE.MeshStandardMaterial({
          map: texture,
          roughness: 0.24,
          metalness: 0.02,
        });
      }),
    [],
  );

  useEffect(() => {
    return () =>
      materials.forEach((material) => {
        material.map?.dispose();
        material.dispose();
      });
  }, [materials]);

  useEffect(() => {
    if (!tossToken || !diceRef.current) return;

    const value = Math.floor(Math.random() * 6) + 1;
    const base = FACE_ROTATIONS[value];

    // Add complete turns so each toss has a different trajectory.
    animation.current = {
      start: 0,
      duration: 2.1 + Math.random() * 0.65,
      from: diceRef.current.rotation.clone(),
      target: new THREE.Euler(
        base[0] + (2 + Math.floor(Math.random() * 3)) * Math.PI * 2,
        (2 + Math.floor(Math.random() * 3)) * Math.PI * 2,
        base[2] + (2 + Math.floor(Math.random() * 3)) * Math.PI * 2,
      ),
      value,
    };
  }, [tossToken]);

  useFrame((state, delta) => {
    const dice = diceRef.current;
    if (!dice) return;

    const roll = animation.current;

    if (roll) {
      roll.start += delta;
      const t = Math.min(roll.start / roll.duration, 1);
      const eased = t * t * (3 - 2 * t);

      dice.rotation.set(
        THREE.MathUtils.lerp(roll.from.x, roll.target.x, eased),
        THREE.MathUtils.lerp(roll.from.y, roll.target.y, eased),
        THREE.MathUtils.lerp(roll.from.z, roll.target.z, eased),
      );

      // Two small bounces, followed by a settled position.
      const bounce =
        t < 0.8 ? Math.abs(Math.sin(t * Math.PI * 5)) * 0.65 * (1 - t) : 0;

      dice.position.y = 1.12 + bounce;

      if (t >= 1) {
        dice.rotation.copy(roll.target);
        dice.position.y = 1.12;
        animation.current = null;
        onResult(roll.value);
      }
    }

    // Pull the camera back after the toss.
    const rolling = Boolean(animation.current);
    const targetPosition = rolling
      ? new THREE.Vector3(4.3, 4.6, 6.2)
      : new THREE.Vector3(6.4, 6.2, 8.5);

    state.camera.position.lerp(targetPosition, 1 - Math.exp(-2.2 * delta));
    state.camera.lookAt(0, 0.5, 0);
  });

  return (
    <group>
      <RoundedBox
        ref={diceRef}
        args={[2, 2, 2]}
        radius={0.17}
        smoothness={5}
        position={[0, 1.12, 0]}
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
    map.anisotropy = 8;
    map.needsUpdate = true;
  }, [map]);

  return (
    <mesh
      rotation={[-Math.PI / 2, 0, 0]}
      position={[0, -0.03, 0]}
      receiveShadow
    >
      <planeGeometry args={[24, 24]} />
      <meshStandardMaterial map={map} roughness={0.95} metalness={0} />
    </mesh>
  );
}

function playDiceSound() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;

  if (!AudioContextClass) return;

  const audio = new AudioContextClass();
  const duration = 0.8;
  const buffer = audio.createBuffer(
    1,
    audio.sampleRate * duration,
    audio.sampleRate,
  );

  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) {
    const time = i / audio.sampleRate;
    const envelope = Math.exp(-time * 3.5);
    data[i] = (Math.random() * 2 - 1) * envelope;
  }

  const source = audio.createBufferSource();
  const filter = audio.createBiquadFilter();
  const gain = audio.createGain();

  source.buffer = buffer;
  filter.type = "lowpass";
  filter.frequency.value = 1800;
  gain.gain.value = 0.22;

  source.connect(filter);
  filter.connect(gain);
  gain.connect(audio.destination);
  source.start();

  // Short wooden/plastic clacks layered over the rattle.
  for (let i = 0; i < 7; i++) {
    const osc = audio.createOscillator();
    const hitGain = audio.createGain();
    const start = audio.currentTime + i * 0.095;

    osc.type = "triangle";
    osc.frequency.value = 180 + Math.random() * 300;
    hitGain.gain.setValueAtTime(0.0001, start);
    hitGain.gain.exponentialRampToValueAtTime(0.12, start + 0.008);
    hitGain.gain.exponentialRampToValueAtTime(0.0001, start + 0.065);

    osc.connect(hitGain);
    hitGain.connect(audio.destination);
    osc.start(start);
    osc.stop(start + 0.07);
  }

  source.onended = () => audio.close();
}

export default function AbujaDice() {
  const [tossToken, setTossToken] = useState(0);
  const [history, setHistory] = useState([]);
  const [rolling, setRolling] = useState(false);

  const toss = useCallback(() => {
    if (rolling) return;

    setRolling(true);
    playDiceSound();
    setTossToken((token) => token + 1);
  }, [rolling]);

  const recordResult = useCallback((value) => {
    setHistory((items) =>
      [
        {
          id: Date.now(),
          value,
          time: new Date().toLocaleTimeString(),
        },
        ...items,
      ].slice(0, 12),
    );

    setRolling(false);
  }, []);

  return (
    <main className="abuja-app">
      <header className="abuja-header">
        <div>
          <p className="eyebrow">FCT · NIGERIA</p>
          <h1>ABUJA DICE</h1>
          <p className="subtitle">Roll the city. Test your luck.</p>
        </div>
        <span className="status">
          <span className={`status-dot ${rolling ? "active" : ""}`} />
          {rolling ? "DICE IN MOTION" : "READY TO ROLL"}
        </span>
      </header>

      <section className="game-layout">
        <div
          className="scene"
          onPointerDown={toss}
          role="button"
          tabIndex={0}
          aria-label="Click to toss the dice"
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              toss();
            }
          }}
        >
          <Canvas
            shadows
            dpr={[1, 2]}
            camera={{
              position: [4.3, 4.6, 6.2],
              fov: 38,
              near: 0.1,
              far: 100,
            }}
            gl={{ antialias: true }}
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
              scale={10}
              blur={2.5}
              far={4}
            />

            <Dice tossToken={tossToken} onResult={recordResult} />
          </Canvas>

          <div className="scene-hint">
            {rolling ? "Rolling..." : "CLICK ANYWHERE TO TOSS"}
          </div>
        </div>

        <aside className="results-panel">
          <p className="eyebrow">YOUR SESSION</p>
          <h2>Roll history</h2>

          <div className="latest-result">
            <span className="result-label">LATEST RESULT</span>
            <strong>{history.length ? history[0].value : "—"}</strong>
            <span className="result-caption">
              {rolling
                ? "Waiting for the dice to settle"
                : history.length
                  ? "Roll completed"
                  : "Your first roll awaits"}
            </span>
          </div>

          <div className="history-heading">
            <span>RECENT ROLLS</span>
            <span>{history.length} / 12</span>
          </div>

          <div className="history-list">
            {history.length === 0 ? (
              <p className="empty-history">Your results will appear here.</p>
            ) : (
              history.map((item, index) => (
                <div className="history-row" key={item.id}>
                  <span className="roll-index">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <span className="roll-die">{item.value}</span>
                  <span className="roll-time">{item.time}</span>
                </div>
              ))
            )}
          </div>

          <button className="roll-button" onClick={toss} disabled={rolling}>
            {rolling ? "ROLLING..." : "TOSS DICE  ↗"}
          </button>

          <p className="map-note">PLAY SURFACE · ABUJA, FCT</p>
        </aside>
      </section>

      <footer className="abuja-footer">
        INTERACTIVE 3D EXPERIENCE
        <span>BUILT WITH REACT THREE FIBER</span>
      </footer>
    </main>
  );
}
