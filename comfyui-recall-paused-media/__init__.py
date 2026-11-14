import asyncio
import json
import os
import pickle
import re
import uuid

import numpy as np
import torch
from aiohttp import web
from PIL import Image

import folder_paths
from comfy_execution.graph_utils import ExecutionBlocker
from server import PromptServer

WEB_DIRECTORY = "./web"


def token_path(token, directory="recall_paused_media"):
    if not isinstance(token, str) or not re.fullmatch(r"[0-9a-f]{32}", token):
        raise ValueError("Invalid snapshot reference.")
    temp = os.path.realpath(folder_paths.get_temp_directory())
    path = os.path.realpath(os.path.join(temp, directory, token + ".pt"))
    if os.path.commonpath([temp, path]) != temp:
        raise ValueError("Snapshot must be inside ComfyUI's temporary folder.")
    return path


def load_snapshot(token, directory="recall_paused_media"):
    try:
        return torch.load(token_path(token, directory), map_location="cpu", weights_only=True)
    except (OSError, RuntimeError, EOFError, pickle.UnpicklingError) as error:
        raise ValueError("Snapshot expired or unavailable. Preview the source again, then recall it.") from error


def capture_preview(source):
    kind = source.get("kind")
    if kind == "IMAGE":
        frame = source.get("frame") or {}
        if not isinstance(frame, dict):
            raise ValueError("Invalid Pause Image snapshot. Preview the source again.")
        filename = frame.get("filename")
        if frame.get("type") != "temp" or frame.get("subfolder", "") != "" or not isinstance(filename, str) or not re.fullmatch(r"pixaroma_pause_[A-Za-z0-9_-]+\.png", filename):
            raise ValueError("Invalid Pause Image snapshot. Preview the source again.")
        temp = os.path.realpath(folder_paths.get_temp_directory())
        path = os.path.realpath(os.path.join(temp, filename))
        if os.path.commonpath([temp, path]) != temp:
            raise ValueError("Snapshot must be inside ComfyUI's temporary folder.")
        try:
            with Image.open(path) as image:
                value = torch.from_numpy(np.array(image.convert("RGB"), dtype=np.float32) / 255.0).unsqueeze(0)
        except (OSError, ValueError) as error:
            raise ValueError("Image preview expired. Preview the source again, then recall it.") from error
    elif kind == "STRING":
        value = source.get("text")
        if not isinstance(value, str):
            raise ValueError("Pause Text has no readable text.")
    elif kind == "AUDIO":
        value = load_snapshot(source.get("token"), "pause_audio")
        if not isinstance(value, dict) or not isinstance(value.get("waveform"), torch.Tensor) or not isinstance(value.get("sample_rate"), int):
            raise ValueError("Invalid Pause Audio snapshot. Preview the source again.")
    else:
        raise ValueError("Supported sources: Pixaroma Pause Image, Pixaroma Pause Text, and Pause Audio.")
    return {"kind": kind, "value": value}


def capture_sources(sources):
    created = []
    results = []
    directory = os.path.join(folder_paths.get_temp_directory(), "recall_paused_media")
    os.makedirs(directory, exist_ok=True)
    try:
        for source in sources:
            snapshot = capture_preview(source)
            token = uuid.uuid4().hex
            path = token_path(token)
            created.extend([path, path + ".partial"])
            torch.save(snapshot, path + ".partial")
            os.replace(path + ".partial", path)
            results.append({"token": token, "kind": snapshot["kind"]})
    except (OSError, ValueError, RuntimeError):
        for path in created:
            if os.path.isfile(path):
                os.remove(path)
        raise
    return results


@PromptServer.instance.routes.post("/recall_paused_media/capture")
async def capture(request):
    try:
        body = await request.json()
        sources = body.get("sources") if isinstance(body, dict) else None
        if not isinstance(sources, list) or not sources or not all(isinstance(source, dict) for source in sources):
            raise ValueError("No paused media was selected.")
        snapshots = await asyncio.to_thread(capture_sources, sources)
        return web.json_response({"snapshots": snapshots})
    except (ValueError, OSError, RuntimeError) as error:
        return web.json_response({"error": str(error)}, status=400)


class RecallPausedMedia:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {},
            "optional": {"source": ("*", {"rawLink": True, "lazy": True})},
            "hidden": {"RecallState": ("STRING", {"default": ""})},
        }

    RETURN_TYPES = ("*",)
    RETURN_NAMES = ("media",)
    OUTPUT_NODE = True
    FUNCTION = "recall"
    CATEGORY = "Recall Paused Media"
    DESCRIPTION = "Recall an existing Pause Image, Pause Text, or Pause Audio snapshot."

    @classmethod
    def VALIDATE_INPUTS(cls, input_types):
        return True

    def check_lazy_status(self, **kwargs):
        return []

    def recall(self, source=None, RecallState=""):
        state = json.loads(RecallState) if RecallState else {}
        if not isinstance(state, dict):
            raise ValueError("Invalid recall state. Recall the paused source again.")
        if state.get("blocked") or not state.get("token"):
            return {"ui": {"recall_status": ["Skipped" if state.get("blocked") else "Not recalled"]}, "result": (ExecutionBlocker(None),)}
        snapshot = load_snapshot(state["token"])
        return {"ui": {"recall_status": [snapshot["kind"] + " recalled"]}, "result": (snapshot["value"],)}


class RecallPausedMediaBlock:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {}}

    RETURN_TYPES = ("*",)
    FUNCTION = "block"
    CATEGORY = "_internal"
    DEPRECATED = True

    def block(self):
        return (ExecutionBlocker(None),)


NODE_CLASS_MAPPINGS = {"RecallPausedMedia": RecallPausedMedia, "RecallPausedMediaBlock": RecallPausedMediaBlock}
NODE_DISPLAY_NAME_MAPPINGS = {"RecallPausedMedia": "Recall Paused Media"}
