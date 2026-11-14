# Install all nodes

Download and extract this repository using **Code → Download ZIP**, or clone it
with Git. Keep the downloaded repository outside ComfyUI's `custom_nodes`
folder. Open a terminal in the downloaded repository and close ComfyUI.

Run the installer with the path to the `custom_nodes` folder used by your
ComfyUI installation. Keep the quotation marks if the path contains spaces.

**Windows**

```powershell
python install.py "C:\path\to\ComfyUI\custom_nodes"
```

**Linux and macOS**

```sh
python3 install.py "/path/to/ComfyUI/custom_nodes"
```

The installer uses Python's standard library and copies each `comfyui-*` node
package directly into `custom_nodes`. Restart ComfyUI and refresh its interface
after installation.

If the installer reports an existing folder with different files, move the
listed folder outside `custom_nodes`. Then rerun the installer. Keep the old
folder until you have verified the fresh installation. If you previously
installed a node under a different folder name, move that older copy outside
`custom_nodes` too so ComfyUI loads only one copy.
