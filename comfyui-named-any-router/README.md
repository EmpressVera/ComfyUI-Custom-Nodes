# Named Any Router

A separate ComfyUI node combining named input selection with output-path routing.
It does not modify Named Any Switch or Pause Audio.

Connect sources on the left and destination workflows on the right. The **input**
dropdown selects the source; **output** selects the destination path. The input
menu uses source titles; the output menu uses the first directly connected node.
Both update when those nodes are renamed. Only connected
ports appear in the menus. Duplicate names include the port name to distinguish
them. Renaming does not change the selected connection.

Inputs and outputs grow as you connect the spare port, up to **20 of each**.
All ports accept any ComfyUI data type, including audio, images, models, custom
objects, and execution lists. The selected destination must support the actual
data type you send it; this node does not convert types.

The selected input is evaluated lazily. Its value goes to the selected output;
all other outputs send `ExecutionBlocker(None)`, skipping dependent downstream
nodes and saves without missing-input errors. Independent inputs to a blocked
branch may still compute. All workflows must still have valid required inputs
and pass ComfyUI's initial validation.

Destination names come from the first connected node on each output, not the end
of its workflow. If the connected node is a subgraph, its title is used. Paths
that converge on the same final node keep their distinct starting-node names.
Multiple connections on one output are still one path: all receive the same data
when selected, but only the first connection supplies the dropdown name. Removing
it updates the name to the next connected node. Use separate ports to choose
destinations separately.

Both dropdowns can be promoted to a subgraph's exterior. Names also follow
connections across subgraph input/output boundaries. Selections survive workflow
save/reload and disconnection of other inputs or outputs.

## Installation

Place `comfyui-named-any-router` in `ComfyUI/custom_nodes/`, restart ComfyUI, and
refresh the browser. Search **Named Any Router** under `utilities/switch`.
No additional packages are needed. Uses ComfyUI's native input autogrow and
execution blocking; the frontend reveals output ports as needed.

## API

The class name is `NamedAnyRouter`. Inputs are `inputs.input_0` through
`inputs.input_19`; `input_selector` contains one of those keys. `output_selector`
is `output_0` through `output_19` (zero-based output indices). UI display names
never become routing keys. The backend always exposes 20 output slots; the UI
shows connected slots plus one spare without renumbering connected outputs.
Earlier disconnected output sockets remain available for reuse so existing
routes keep their output indices.
