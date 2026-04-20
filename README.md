# UV UI Tool

A starter VS Code extension scaffold for building a UI that runs `uv` commands.

## What is included

- TypeScript-based extension entry point in `src/extension.ts`
- A starter webview panel exposed by the command `UV UI Tool: Open Panel`
- Media assets in `media/` for HTML, CSS, and JavaScript
- Build scripts for `npm run compile` and `npm run watch`

## Run locally

1. Install dependencies:
   ```bash
   npm install
   ```
2. Compile the extension:
   ```bash
   npm run compile
   ```
3. Launch the extension host:
   - Press `F5` in VS Code

## Usage

Open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`) and run:

- `UV UI Tool: Open Panel`

That opens a webview panel with a starting UI where you can extend the button to execute `uv` commands.

## Next steps

- Add a command list and input field to the webview
- Send command requests from `media/script.js` to `src/extension.ts`
- Run `uv` with `child_process.spawn` or `child_process.exec` in the extension host
- Display output and errors inside the webview
