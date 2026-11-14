# Pause Audio

Listen before allowing audio through to the rest of a ComfyUI workflow.

Connect: `Audio source -> Pause Audio`. The output can optionally feed other audio
nodes for downstream processing.
Press Run with **Pause** enabled to preview without running downstream saves.
Press **Continue** to run downstream using the exact captured samples, without
regenerating the audio. **Regenerate** queues another paused preview using
ComfyUI's normal upstream seed controls. **Fixed** keeps the seed; **Randomize**,
**Increment**, and **Decrement** follow their selected behavior. Unchanged
upstream inputs may reuse ComfyUI's cached audio.
Disable Pause for **Pass** mode and normal end-to-end execution.

**Save to Folder** saves the current preview to a folder you choose. Chrome/Edge
can show a browser folder picker. When the browser does not support one, a local
Windows ComfyUI opens a Windows folder-selection dialog instead. It never falls
back to Downloads. Audio batches save as separate FLAC files. Canceling the picker
saves nothing. The Windows fallback requires a local `localhost`/`127.0.0.1`/`[::1]`
ComfyUI address; it cannot open a dialog on a remote computer.

**Save Output** saves the captured audio as FLAC into the configured ComfyUI
`output/audio` folder. In Stability Matrix, an output folder linked to `Text2Img`
puts these files in `Text2Img/audio`. Each click uses a new numbered filename.
Neither save button regenerates audio or continues downstream execution. You can
leave the audio output disconnected and remove the separate Save Audio node.

Previews and exact snapshots use ComfyUI's temporary directory, not `output`.
Mono, stereo, and audio batches are preserved. Temporary snapshots can expire;
run again to capture audio if Continue reports a missing snapshot.

Only the branch connected through this node is gated. Saves connected directly
to an audio source bypass it and can still write files. Do not bypass or mute the
node when relying on it to prevent saving.

## Installation

1. Clone this folder into `your_path/ComfyUI/custom_nodes`
```sh
git clone https://github.com/EmpressVera/ComfyUI-Custom-Nodes/edit/main/comfyui-pause-audio pause-audio
```
2. Restart ComfyUI.
3. Under `audio`, you will find: `Pause Audio`.

No additional packages are needed. Uses ComfyUI's built-in audio preview helper,
lazy inputs, and execution blocker. Tested with ComfyUI 0.39.0/frontend 1.53.10.

This is a separate extension inspired by Pixaroma's Pause Image/Pause Text. It
does not modify Pixaroma or Named Any Switch. The Continue pruning and invisible
Windows dialog owner adapt Pixaroma's MIT-licensed implementation; its license
is included.

## API Use

The default is safely paused even without the browser extension. To pass, set
`PauseAudioState` to `{"mode":"pass"}`. To continue, use
`{"mode":"continue","token":"<token returned in pause_audio UI>"}`. Continue
does not require the audio input. Browser exports keep the complete workflow;
Continue's upstream-output pruning applies only when queueing a browser run.
To save into `output/audio`, use `{"mode":"save_output","token":"<token>",
"request":"<unique value for each save>"}`. This blocks downstream execution;
the browser submits only this node for standalone saving.
