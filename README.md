# ComfyUI-Custom-Nodes
A collection of custom nodes created when I needed/wanted them. All nodes work towards building a cleaner UI for your Comfy setup with some extra functionalities.

Read INSTALL.md for the "Install all" and update functionality. While each node has its own installer, only the install all currently has an updater.

`comfyui-pause-audio` is the only node to contain an extra license, as its code is adapted from Pixaroma's Pause Image and Pause Text nodes.

I am not a professional software engineer. I just learned github. Things will be scuffed for a while. If you have issues, I will get to them when possible. If they are of extreme importance, please mark them as such. 

My X profiles are linked under my git profile, and from there you can find my discord, so if you have any issues or just want to join, you can hit me up there.

# Current Nodes
<img width="3001" height="1568" alt="ReleaseNodes" src="https://github.com/user-attachments/assets/4d743050-366d-49ba-8d47-a41e5db8d162" />

Ghost Nodes:
In the top left panel, a `Ghost Node Sender` is show connected to its `Ghost Node Receiver`. The green endpoints indicate a connection, while the `Ghost Node Controller` overrides the individual setting and hides all ghost wires in the workflow. Ghost nodes can be placed as a full pair or as individuals.

# Viewport Targeters
In the bottom left panel, two viewport targeters are shown. One is labelled `North`, and the other `South`. Upon clicking the `Target` button on either, the viewport will snap to that location, centered on the targeter node selected. Helpful for snapping around to named locations even if you don't remember exactly where everything is. Offset functionality may be in the works, though at the moment, they only arrive centralized.

# Named Any Router/Switch
In the top right panel, we have the router and switch setup. Nodes `1` and `2` contain test strings "Apple" and "Banana" respectively. Both strings are fed into both the router and switch. The input labels change dynamically to the name of the input nodes. As you can see, the default input name for a disconnected link is "input_#", beginning at 0 for no connected links.
The `Named Any Router` is outputting into both node `A` and node `B`. This demonstration has already been run once with the currently selected input/output selectors. As shown, only node `A` received the "Apple" string, while node `B` remained silent, without throwing a no valid input error. All unselected outputs receive execution blockers upon running the workflow, preventing unselected nodes from complaining about a lack of input.
The `Named Any Switch` is connected only to node `C`. This node goes to one location, but allows you to pick from up to twenty inputs, just like the router. While the router is overall more useful and can function the same as the switch, the switch was created first and was used as a basis for the router. I thought I'd include it here as well. It is still its own separate node.

Note that while the example workflow uses strings, the Named *Any* Router/Switch can take *any* input.

# Pause Audio and Recall Paused Media.
The `Pause Audio` node is built off of the code from Pixaroma's `Pause Image Pixaroma` and `Pause Test Pixaroma` nodes. Like with those nodes, the `Pause Audio` node saves a preview of the audio output from your workflow, allowing you to listen to it without it being saved automatically into your audio output folder.
This `Pause Audio` nodes is hooked up to the `Recall Paused Media` node, which then leads to a regular `Save Audio (Advanced)` node, ending the workflow.

## The Buttons:

### Pause Audio

  - Regenerate:
      The regenerate button saves nothing. The held audio remains as a preview while the workflow runs again, up to that point. On finishing, the previously previewed audio is replaced
      with the new preview, and the old one is unrecoverable.
  
  - Continue:
      The continue button sends the audio preview forward into the next stage of the workflow without saving it. Here, that would send it through the recall node and into the save node.
      The recall node would not affect the audio, and the final audio would be the same as the preview.

  - Save to Folder:
      This button will open up a dialog allowing you to choose which folder the audio preview is saved into. It will save as a FLAC file. It will be saved upon choosing a location, and
      will show up as Pause_Audio_#####.FLAC. You will then have to find it and rename it yourself. The preview remains in the pause node until you run the workflow again.

  - Save Output:
      The default save button. This saves the audio preview directly to your `output/audio` folder. The preview remains in the pause node until you run the workflow again. This will also
      save as a FLAC file. Currently, only the native `Save Audio (Advanced)` node may save as a WAV or MP3.

  - The `Pause` checkbox
      Unchecking the `Pause` option will treat the node as if it doesn't exist, sending the preview straight through without stopping the workflow. This would be the equivalent to the
      "Pass" option on the Pixaroma nodes.

### Recall Paused Media

  - Recall:
      This button recalls only the paused media (image, text, audio), from the node connected to the recall node's input. Other pause nodes remain dormant. This acts as a replacement to
      the Continue button on the pause node.

  - Recall all:
      This button acts the same as if you hit the Continue button on *every* pause node at once. Only pause nodes with previews held inside will be recalled. This is especially helpful for
      running pause nodes into a switch to choose what gets forwarded.


# Subgraphs

## Ghost Nodes

  Ghost Nodes will all work inside subgraphs. Visibility toggles may be exposed on the outside, and the wires leading into and out of a subgraph will be invisible as well.
  
## Viewport Targeters

  While targeters cannot jump into subgraphs right now, they can work independently inside of a subgraph. For an example workflow, given that we have our targeters `North` and `South`,
  and we have a subgraph: `Sub`, containing two more targeters: `East` and `West`, `North` and `South` will only expose each other and can only jump to each other. Inside of `Sub`, `East`
  and `West` will only expose each other and can only jump to each other.

## Named Any Router/Switch

  Both the Router and Switch may be placed inside a subgraph, and the input/output selectors of the Router and "selector" selector of the Switch may be exposed on the outside of a
  subgraph.

## Pause Audio and Recall Paused Media

  ### Pause Audio

  - While the `Pause Audio` node should remain on the outside, due to it being unable to expose any of its buttons or preview, it can live inside a subgraph and will function normally
    with only the drawback of requiring you to enter the subgraph to listen to the preview or interact with it in any way.

  ### Recall Paused Media

  - The Recall node may have both recall options exposed on the outside of a subgraph. Additionally, should there be multiple recall nodes inside one subgraph, each individual button may
    be exposed at once. Only one `Recall All` button need be exposed, as they would all have the same functionality.


All custom nodes can be used together. If you get too complicated with your workflow and some things start to break, there are some functionality drawbacks. Connecting multiple switches and ghost node pairs together will tend to lose the original input and will upset your final output nodes. If you really need to have more than 20 options for input, adding another pause segment to your workflow will keep your input preview intact without trying to send it through a bunch of nonsense and losing it somewhere along the way.

# If you have major issues, let me know, otherwise, I'll get to them whenever I make time.
