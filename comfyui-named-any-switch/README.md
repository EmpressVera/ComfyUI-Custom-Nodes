# Named Any Switch

A ComfyUI switch with one dropdown and one universal output. Connecting an input
adds the upstream node's title to the dropdown and creates another empty socket.
Renamed titles update automatically. Duplicate titles include an input identifier.
The selected connection survives workflow saving and node renaming.

Supports up to **20 connected inputs**, using ComfyUI's native auto-expanding
inputs. Accepts images, masks, latents, models, conditioning, strings, numbers,
audio, video, and custom data types. The selected value passes through unchanged,
including batches and list outputs. Unselected branches are lazily evaluated:
they do not execute just because they are connected to this switch. Branches
connected to another active output can still execute independently.

## Installation

1. Clone this folder into `your_path/ComfyUI/custom_nodes`.
```sh
git clone https://github.com/EmpressVera/ComfyUI-Custom-Nodes/edit/main/comfyui-named-any-switch named-any-switch
```
2. Restart ComfyUI.
3. Under `utilities/switch` you will find `Named Any Switch`.

No additional dependencies. Requires a recent ComfyUI with the V3 node API and
`io.Autogrow` support; tested against ComfyUI 0.39.0.

Connect source nodes, choose a title in `selector`, and connect `output` to a
compatible downstream input. The wildcard output permits any connection, but it
does not convert values: an image consumer still needs an image selected.

## API Workflows

`selector` is serialized as a stable socket key, for example `inputs.input_0`.
Connected inputs use keys `inputs.input_0` through `inputs.input_19`. Node titles
are display labels only and can be renamed without changing routing.

References: [ComfyUI V3 API](https://docs.comfy.org/custom-nodes/v3-migration),
[lazy evaluation](https://docs.comfy.org/custom-nodes/backend/lazy_evaluation).
