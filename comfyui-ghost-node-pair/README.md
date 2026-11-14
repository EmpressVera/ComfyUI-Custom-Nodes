# Ghost Node Pair

ComfyUI nodes in the **Ghost Nodes** category:

- **Ghost Node Pair** creates a connected Sender and Receiver, then becomes an ordinary Sender.
- **Ghost Node Sender** accepts any data and can feed multiple Receivers. Its Ghost Wire toggle controls all its middle wires.
- **Ghost Node Receiver** forwards the data unchanged. Without a Sender it blocks its branch and displays `No Sender connected`.
- **Ghost Node Controller** temporarily hides every Ghost Wire in the current workflow. Show restores individual Sender settings. Multiple controllers stay synchronized.

Middle wires are 50% opaque when visible. Hidden wires have no hover or click targets, but their sockets remain connected and lit. Ordinary incoming and outgoing wires are unchanged. Connections through subgraph boundaries inherit the original Sender's visibility. Sender and Controller toggles can be exposed independently using ComfyUI's subgraph parameter visibility controls.

Socket labels follow the upstream source and first downstream destination. Any Sender can connect to any Receiver. Deleting, duplicating, or loading a node does not recreate its partner. Node sizes and visibility settings are stored in the workflow.

## Installation

Place this entire folder in `ComfyUI/custom_nodes`, restart ComfyUI, then refresh the browser with Ctrl+F5. No additional dependencies are required.

Tested with ComfyUI 0.39.0 and frontend 1.53.10, in both Classic and Nodes 2.0. Verification covers 73 checks, including real media execution, nested/shared subgraphs, exposed toggles, placement cancellation, disconnected branches, and saved sizes.
