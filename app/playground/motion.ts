// A stand-in for a phone's motion sensors, for the playground on a desktop:
// someone dancing with the phone in hand. A slow turn with a wobble (yaw, in
// radians like the real sensor path), a sway and a nod (roll and pitch,
// -1..1), and a shake every few seconds (a spike of the size the real path
// reports, 0..3). The Phone IMU node reads it exactly as it would a phone.

import type { Motion, MotionSource } from "@empyrean-gate/patch-web/runtime";

const TURN_PER_S = 0.06; // turns per second: a full turn in ~17 s

export function syntheticMotion(
  now: () => number = () => performance.now(),
): MotionSource {
  const t0 = now();
  let nextShake = 3;
  let shake = 0;
  return {
    read(): Motion {
      const t = (now() - t0) / 1000;
      const yaw =
        (((t * TURN_PER_S * Math.PI * 2 + 0.5 * Math.sin(t * 0.37)) %
          (Math.PI * 2)) +
          Math.PI * 2) %
        (Math.PI * 2);
      const pitch = 0.35 * Math.sin(t * 1.9) + 0.15 * Math.sin(t * 0.53);
      const roll = 0.45 * Math.sin(t * 1.2 + 1) + 0.1 * Math.sin(t * 3.1);
      if (t >= nextShake) {
        shake = 1.5 + Math.random();
        nextShake = t + 3 + Math.random() * 5;
      }
      const spike = shake;
      shake = 0;
      return { yaw, pitch, roll, shake: spike };
    },
    stop() {},
  };
}
