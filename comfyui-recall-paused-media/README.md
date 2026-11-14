# Recall Paused Media

# Usage

Connect a Pixaroma Pause Image, Pixaroma Pause Text, or Pause Audio output to `source`. Connect `media` to your switch or downstream workflow.

- **Recall** copies this source's current preview and queues its downstream outputs.
- **Recall All** copies every eligible recall source in the current workflow, then submits one coordinated run. All eligible recalls execute, including unselected switch inputs.
- Bypassed/muted recall nodes and bypassed/muted source nodes (including their containing subgraphs) are skipped. Their paths cannot accidentally restart the original capture workflow during a recall run.
- Recall All skips recall nodes with no source connected. A connected source with no usable preview still stops the coordinated run; a visible notification identifies the affected node, even when it is inside a subgraph.
- Existing downstream pause gates keep their normal behavior. The switch selection is never changed.
- Each subgraph can independently expose **Recall** and **Recall All** from every recall node. Use the subgraph's parameter visibility toggles. Exposing either action does not expose the other; buttons from multiple recall nodes are supported.
- An exposed **Recall** targets that subgraph instance. For a shared definition, use the button on the outermost subgraph to choose an instance, or use **Recall All** to refresh every eligible instance.
- A normal Run reuses previously recalled media; it does not refresh recall snapshots. Original output/capture nodes elsewhere in the workflow may still run on a normal Run.

Text uses the current edited box, including blank text. Images use Pixaroma's displayed RGB frame, not an original multi-image batch. Audio preserves the saved waveform, channels, sample rate, and batch. Snapshots live in ComfyUI's temporary folder, not output. Clearing temporary files requires a fresh preview and recall.

Recall buttons queue through ComfyUI's API without generation widget callbacks, so upstream seeds are not changed. Other inputs genuinely required by the downstream workflow still execute normally.

# Installation

1. Clone this folder into `your_path/ComfyUI/custom_nodes`.
```sh
git clone https://github.com/EmpressVera/ComfyUI-Custom-Nodes/edit/main/comfyui-recall-paused-media recall-paused-media
```
2. Restart ComfyUI.
3. Under `Recall Paused Media`, you will find the Recall Paused Media node.
