/** One screen of the app (gallery, sailing, …). The loop drives the active mode. */
export interface Mode {
  update(dt: number): void;
  render(): void;
  /** Lines for the debug overlay (draw calls, counters …): optional. */
  debugInfo?(): readonly string[];
  dispose(): void;
}
