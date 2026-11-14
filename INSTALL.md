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

If you previously installed a node under a different folder name, move that
older copy outside `custom_nodes` so ComfyUI loads only one copy.

## Update installed nodes

Close ComfyUI. From your existing Git checkout, get the latest changes and run
the installer again with `--update`.

```powershell
git pull --ff-only
python install.py "C:\path\to\ComfyUI\custom_nodes" --update
```

On Linux and macOS, use `python3` and your own `custom_nodes` path. If you
originally downloaded a ZIP, get the latest ZIP and run the same installer
command from its extracted folder.

Updates replace changed release files and remove files retired by the release.
They preserve unrelated files and stop before overwriting an edit that conflicts
with the release. Restart ComfyUI and refresh its interface once the update
finishes. To remove a whole node package, move its folder out of `custom_nodes`.

### If you used the original installer

The original installer did not record the version of each file it copied.
Run the new installer from a download containing the same node files as your
installed copy to record them in place. Then pull the newer release and use
`--update`. If you no longer have the matching version, move the folder the
installer names outside `custom_nodes` as a backup and install the current
version once.
