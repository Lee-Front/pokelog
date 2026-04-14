# Terminal Rendering

Updated: 2026-04-14

## Purpose

The CLI is not a chat log.
Every interactive screen should behave like a terminal application frame:

- one active frame on screen
- redraw in place
- no line accumulation across menu transitions
- no menu-specific rendering rules scattered across commands

## Current Runtime

The shared rendering runtime now lives in:

- [packages/cli/src/ui/screen.ts](/C:/Users/dlwog/Desktop/project/pokelog/packages/cli/src/ui/screen.ts:1)
- [packages/cli/src/ui/display.ts](/C:/Users/dlwog/Desktop/project/pokelog/packages/cli/src/ui/display.ts:1)

Core primitives:

- `clearScreen()` and `resetScreen()` for full-screen reset
- `runMenuLoop()` for persistent redraw-based menu screens
- `selectFrame()` for framed selection prompts
- `confirmFrame()` for framed yes/no prompts
- `inputFrame()` for framed text input
- `passwordFrame()` for framed masked input
- `redraw(lines, lineCount, first)` as the low-level in-place renderer

## Rendering Rule

The renderer keeps the current frame height and rewrites the same screen area instead of printing new lines.

Simplified flow:

```ts
let lineCount = 0;
let first = true;

while (true) {
  const lines = buildLines();
  lineCount = redraw(lines, lineCount, first);
  first = false;
  const key = await waitKey();
  await handleKey(key);
}
```

This gives the CLI its expected behavior:

- move cursor back to the previous frame
- overwrite the existing frame
- clear trailing old lines when the new frame is shorter
- keep the cursor hidden while redrawing

## Current Screen Policy

Interactive menu and input flows should go through the shared screen runtime.
Commands should not implement their own ad-hoc combinations of:

- `console.log()` loops
- local `lineCount` redraw code
- per-command `rawSelect()` menus
- prompt cleanup hacks

The command layer should decide:

- what to show
- what action was selected
- how state changes

The screen runtime should own:

- frame redraw
- cursor visibility
- page scrolling inside menus
- prompt/input rendering
- cancel and close behavior

## Current Adoption

The shared runtime is now wired into the main interactive command flow and the newer full-screen menu flows, including:

- help selection
- egg purchase flow
- trade menu
- pending evolutions menu
- leave server menu
- connect/integration menu
- framed text input and password input used by login/register/profile/connect/trade flows

Some older screen-heavy commands still maintain their own local frame loops:

- party
- storage
- inventory
- shop
- encounter
- events
- heal
- pokedex

These already redraw in place, but they are not yet fully expressed through a single shared controller abstraction.

## Immediate Standard

From this point forward:

1. New interactive screens must use the shared frame runtime.
2. Menu transitions must redraw in place instead of appending lines.
3. Text input should stay inside the same frame model instead of dropping into a separate prompt style.
4. Command-local rendering logic should only remain where the screen is unusually specialized, and that should be treated as technical debt to extract later.
