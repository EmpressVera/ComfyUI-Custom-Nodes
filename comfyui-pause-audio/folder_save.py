import asyncio
import ipaddress
import json
import os
import re
import shutil
import subprocess
import sys
import threading
import uuid
from urllib.parse import urlsplit

from aiohttp import web
import folder_paths
from server import PromptServer


_dialog_lock = threading.Lock()


def preview_manifest_path(token):
    if not isinstance(token, str) or not re.fullmatch(r"[0-9a-f]{32}", token):
        raise ValueError("Run once to preview audio before saving.")
    return os.path.join(folder_paths.get_temp_directory(), "pause_audio", token + ".json")


def record_preview(token, clips):
    with open(preview_manifest_path(token), "x", encoding="utf-8") as file:
        json.dump(clips, file)


def preview_files(token):
    try:
        with open(preview_manifest_path(token), encoding="utf-8") as file:
            clips = json.load(file)
    except FileNotFoundError as error:
        raise ValueError("Preview expired. Run again.") from error
    root = os.path.realpath(folder_paths.get_temp_directory())
    files = []
    for clip in clips:
        filename = clip["filename"]
        if clip["type"] != "temp" or not re.fullmatch(r"ComfyUI_temp_[a-z]+_[0-9]+\.flac", filename):
            raise ValueError("Invalid audio preview.")
        path = os.path.realpath(os.path.join(root, clip.get("subfolder", ""), filename))
        if os.path.commonpath([root, path]) != root or not os.path.isfile(path):
            raise ValueError("Preview expired. Run again.")
        files.append(path)
    if not files:
        raise ValueError("Run once to preview audio before saving.")
    return files


def choose_windows_folder():
    if sys.platform != "win32":
        raise RuntimeError("Folder selection needs a local Windows ComfyUI or a browser with folder-picker support.")
    powershell = os.path.join(os.environ["SystemRoot"], "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
    # An invisible owner keeps the folder dialog in front of the browser.
    script = (
        "$ErrorActionPreference='Stop';"
        "[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false);"
        "Add-Type -AssemblyName System.Windows.Forms;"
        "$script:folder='';"
        "$owner=New-Object System.Windows.Forms.Form;"
        "$owner.TopMost=$true;$owner.ShowInTaskbar=$false;$owner.FormBorderStyle='None';"
        "$owner.Width=1;$owner.Height=1;$owner.Opacity=0;$owner.StartPosition='CenterScreen';"
        "$owner.Add_Shown({"
        "$owner.Activate();"
        "$dialog=New-Object System.Windows.Forms.FolderBrowserDialog;"
        "$dialog.Description='Choose a folder to save audio';$dialog.ShowNewFolderButton=$true;"
        "try{if($dialog.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK){"
        "$script:folder=$dialog.SelectedPath}}finally{$dialog.Dispose();$owner.Close()}"
        "});"
        "try{[void]$owner.ShowDialog()}finally{$owner.Dispose()};"
        "[Console]::Out.Write($script:folder)"
    )
    try:
        result = subprocess.run(
            [powershell, "-NoProfile", "-STA", "-Command", script],
            capture_output=True, encoding="utf-8", timeout=300,
            creationflags=subprocess.CREATE_NO_WINDOW,
        )
    except subprocess.TimeoutExpired as error:
        raise RuntimeError("Folder selection timed out. Try again.") from error
    if result.returncode != 0:
        raise RuntimeError("Windows could not open the folder picker.")
    return result.stdout


def save_with_folder_picker(token):
    if not _dialog_lock.acquire(blocking=False):
        raise RuntimeError("A folder picker is already open. Finish that selection first.")
    try:
        sources = preview_files(token)
        directory = choose_windows_folder()
        if not directory:
            return {"cancelled": True}
        # The destination comes ONLY from the OS dialog, never from a workflow or request.
        directory = os.path.realpath(directory)
        if not os.path.isdir(directory):
            raise ValueError("The selected folder is unavailable.")
        prefix = "PauseAudio_" + uuid.uuid4().hex
        saved = []
        for index, source in enumerate(sources, 1):
            filename = f"{prefix}_{index}.flac"
            target = os.path.join(directory, filename)
            with open(source, "rb") as audio, open(target, "xb") as output:
                try:
                    shutil.copyfileobj(audio, output)
                except OSError:
                    output.close()
                    os.remove(target)
                    raise
            saved.append(filename)
        return {"directory": directory, "files": saved}
    finally:
        _dialog_lock.release()


def local_request(request):
    try:
        peer = ipaddress.ip_address(request.remote or "")
        peer = peer.ipv4_mapped if isinstance(peer, ipaddress.IPv6Address) and peer.ipv4_mapped else peer
        host = urlsplit("//" + request.host).hostname
        local_host = host == "localhost" or ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False
    origin = request.headers.get("Origin")
    same_origin = not origin or origin == f"{request.scheme}://{request.host}"
    return peer.is_loopback and local_host and same_origin and request.headers.get("Sec-Fetch-Site", "same-origin") != "cross-site"


@PromptServer.instance.routes.post("/pause_audio/save_folder")
async def save_folder(request):
    if not local_request(request):
        return web.json_response({"error": "Windows folder selection is available only from local ComfyUI."}, status=403)
    if request.content_type != "application/json":
        return web.json_response({"error": "Expected an audio preview token."}, status=415)
    try:
        data = await request.json()
        if not isinstance(data, dict) or set(data) != {"token"}:
            raise ValueError("Expected an audio preview token, not a destination path.")
        preview_manifest_path(data["token"])
        result = await asyncio.to_thread(save_with_folder_picker, data["token"])
        return web.json_response(result)
    except ValueError as error:
        return web.json_response({"error": str(error)}, status=400)
    except (OSError, RuntimeError) as error:
        return web.json_response({"error": str(error)}, status=500)
