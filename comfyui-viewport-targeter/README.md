# Viewport Targeter

A frontend-only ComfyUI navigation node under **Viewport Targeting**.

Place a targeter near each workflow area and rename its node title. Every targeter
lists the other targeters on that same grid in its **destination** dropdown.
Press **Target** to center the canvas on the selected node, preserving the current
zoom. Moving or renaming a targeter updates its destination automatically.

- No wires, inputs, outputs, generation, or backend execution.
- A targeter never lists itself. A lone targeter has no navigation controls.
- Duplicate names include their node IDs. There is no target-count limit.
- Destinations, positions, and resized node dimensions survive workflow save/reload.
- Navigation stays on the current grid; it does not enter or leave subgraphs.

Copy this folder into `ComfyUI/custom_nodes`, restart ComfyUI, and refresh the
browser. Search **Viewport Targeter**. No additional dependencies are needed.
