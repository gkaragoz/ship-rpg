export interface Input {
  /** True while the key (KeyboardEvent.code) is held. */
  isDown(code: string): boolean;
  /** True once per key press until `endFrame()`. */
  pressed(code: string): boolean;
  /** Clear one-shot presses; call once per rendered frame. */
  endFrame(): void;
  dispose(): void;
}

/** Keyboard state tracker. Releases everything when the window loses focus. */
export function createInput(target: Window = window): Input {
  const down = new Set<string>();
  const pressed = new Set<string>();

  const onDown = (e: KeyboardEvent): void => {
    if (e.repeat) return;
    down.add(e.code);
    pressed.add(e.code);
  };
  const onUp = (e: KeyboardEvent): void => {
    down.delete(e.code);
  };
  const onBlur = (): void => down.clear();

  target.addEventListener('keydown', onDown);
  target.addEventListener('keyup', onUp);
  target.addEventListener('blur', onBlur);

  return {
    isDown: (code) => down.has(code),
    pressed: (code) => pressed.has(code),
    endFrame: () => pressed.clear(),
    dispose(): void {
      target.removeEventListener('keydown', onDown);
      target.removeEventListener('keyup', onUp);
      target.removeEventListener('blur', onBlur);
      down.clear();
      pressed.clear();
    },
  };
}
