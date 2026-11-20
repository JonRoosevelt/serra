// Keyboard rules for the command palette. Pure functions: imported by `node --test` as well as the renderer.

/** The parts of a KeyboardEvent the shortcut needs, so tests don't need a DOM. */
export interface KeyPress {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

/** ⌘K (Ctrl+K off macOS) with no other modifier. Works from any screen and any field. */
export const isPaletteShortcut = (press: KeyPress): boolean =>
  press.key.toLowerCase() === 'k' && press.metaKey !== press.ctrlKey && !press.altKey && !press.shiftKey;

/** The next highlighted row after an arrow key: wraps at both ends, and -1 when there are no rows. */
export const moveSelection = (current: number, delta: number, count: number): number => {
  if (count <= 0) return -1;
  if (current < 0) return delta < 0 ? count - 1 : 0;
  return (((current + delta) % count) + count) % count;
};

/** Splits a label into runs so matched letters can be highlighted. */
export const highlightRuns = (text: string, indices: readonly number[]): { text: string; match: boolean }[] => {
  const matched = new Set(indices);
  const runs: { text: string; match: boolean }[] = [];
  for (let i = 0; i < text.length; i++) {
    const match = matched.has(i);
    const last = runs[runs.length - 1];
    if (last && last.match === match) last.text += text[i];
    else runs.push({ text: text[i] ?? '', match });
  }
  return runs;
};
