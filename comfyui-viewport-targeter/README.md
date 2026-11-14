# Viewport Targeter

A frontend-only ComfyUI navigation node under **Viewport Targeting**.

# Usage

Place a targeter near each workflow area and rename its node title. Every targeter
lists the other targeters on that same grid in its **destination** dropdown.
Press **Target** to center the canvas on the selected node, preserving the current
zoom. Moving or renaming a targeter updates its destination automatically.

- No wires, inputs, outputs, generation, or backend execution.
- A targeter never lists itself. A lone targeter has no navigation controls.
- Duplicate names include their node IDs. There is no target-count limit.
- Destinations, positions, and resized node dimensions survive workflow save/reload.
- Navigation stays on the current grid; it does not enter or leave subgraphs.

# Installation

1. Clone this folder into `your_path/ComfyUI/custom_nodes`.
```sh
git clone https://github.com/EmpressVera/ComfyUI-Custom-Nodes/edit/main/comfyui-viewport-targeter viewport-targeter
```
2. Restart ComfyUI.
3. Under `Viewport Targeting`, you will find: ViewportTargeter.
