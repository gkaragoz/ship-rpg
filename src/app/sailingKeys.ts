import type { Controls, GameView, Input } from '../core';
import type { Weather } from '../world';

export const PORT = ['KeyA', 'ArrowLeft'];
export const STARBOARD = ['KeyD', 'ArrowRight'];
export const MORE_SAIL = ['KeyW', 'ArrowUp'];
export const LESS_SAIL = ['KeyS', 'ArrowDown'];
export const INTERACT = 'KeyF';
export const FIRE_PORT = 'KeyQ';
export const FIRE_STARBOARD = 'KeyE';
export const RESTART = 'KeyR';
export const BOARD = 'KeyB';
export const MAP = 'KeyM';
export const AIM = 'KeyG';
export const GUNS_UP = 'KeyX'; // longer range
export const GUNS_DOWN = 'KeyZ'; // shorter range
export const MUTE = 'KeyN';
export const QUALITY = 'KeyK';
/** Game speed keys are matched by the character they type (+ = and - _, on the numpad too), so every keyboard layout works. */
export const FASTER = ['+', '='];
export const SLOWER = ['-', '_'];
/** Keys whose default action (scrolling the page) the game stops. */
export const GAME_KEYS = [...PORT, ...STARBOARD, ...MORE_SAIL, ...LESS_SAIL];

/** The weather in a view, as the weather simulator's panel reads it. */
export const weatherOf = (v: GameView): Weather => ({
  windSpeed: v.wind.speed,
  windFrom: v.wind.from,
  seaState: v.seaState,
  cloud: v.weather.cloud,
  fog: v.weather.fog,
  rain: v.weather.rain,
  lightning: v.weather.lightning,
  tuning: v.weather.tuning,
});

export interface ControlReader {
  /** The controls for the next fixed step: held keys, and presses that act once even when a frame runs several steps. */
  read(): Controls;
  /** A fixed step has run with them. */
  stepped(): void;
  /** The end of a frame: keeps unconsumed presses if no step ran this frame, forgets the consumed ones otherwise. */
  endFrame(): void;
}

/** Turns the keyboard into `Controls`: a sail step, a dock, a salvo or a boarding is one press however many steps a frame runs. */
export function createControlReader(input: Input): ControlReader {
  const any = (codes: string[], test: (code: string) => boolean): boolean => codes.some(test);
  let updated = false;
  let stepTaken = false;
  let interactTaken = false;
  let fireTaken = false;
  let boardTaken = false;
  return {
    read(): Controls {
      let sailStep: -1 | 0 | 1 = 0;
      if (!stepTaken) {
        if (any(MORE_SAIL, input.pressed)) sailStep = 1;
        else if (any(LESS_SAIL, input.pressed)) sailStep = -1;
        stepTaken = sailStep !== 0;
      }
      const rudder = (any(STARBOARD, input.isDown) ? 1 : 0) - (any(PORT, input.isDown) ? 1 : 0);
      const interact = !interactTaken && input.pressed(INTERACT);
      if (interact) interactTaken = true;
      // Fire and restart presses are one-shot too; the game ignores repeats while reloading.
      const firePort = !fireTaken && input.pressed(FIRE_PORT);
      const fireStarboard = !fireTaken && input.pressed(FIRE_STARBOARD);
      if (firePort || fireStarboard) fireTaken = true;
      const elevate = ((input.isDown(GUNS_UP) ? 1 : 0) - (input.isDown(GUNS_DOWN) ? 1 : 0)) as -1 | 0 | 1;
      const board = !boardTaken && input.pressed(BOARD);
      if (board) boardTaken = true;
      return { rudder, sailStep, interact, firePort, fireStarboard, elevate, board, restart: input.pressed(RESTART) };
    },
    stepped(): void {
      updated = true;
    },
    endFrame(): void {
      if (!updated) return;
      input.endFrame(); // keep unconsumed presses if no update ran this frame
      updated = false;
      stepTaken = false;
      interactTaken = false;
      fireTaken = false;
      boardTaken = false;
    },
  };
}
