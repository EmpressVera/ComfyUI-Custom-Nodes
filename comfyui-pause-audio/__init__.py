import json
import os
import pickle
import re
import uuid

import folder_paths
import torch
from comfy_api.latest import UI
from comfy_execution.graph_utils import ExecutionBlocker
from .folder_save import record_preview


WEB_DIRECTORY = "./web"


def read_state(value):
    state = json.loads(value) if value else {"mode": "pause"}
    if not isinstance(state, dict) or state.get("mode", "pause") not in ("pause", "pass", "continue", "save_output"):
        raise ValueError("Pause Audio: invalid pause state.")
    return state


def snapshot_path(token):
    if not isinstance(token, str) or not re.fullmatch(r"[0-9a-f]{32}", token):
        raise ValueError("Pause Audio: run once to preview audio before continuing or saving.")
    return os.path.join(folder_paths.get_temp_directory(), "pause_audio", token + ".pt")


def load_snapshot(token):
    path = snapshot_path(token)
    try:
        return torch.load(path, map_location="cpu", weights_only=True)
    except (OSError, RuntimeError, EOFError, pickle.UnpicklingError) as error:
        raise RuntimeError("Pause Audio: the temporary snapshot is unavailable. Run again to preview fresh audio.") from error


class PauseAudio:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {},
            "optional": {"audio": ("AUDIO", {"lazy": True})},
            "hidden": {"PauseAudioState": ("STRING", {"default": ""})},
        }

    RETURN_TYPES = ("AUDIO",)
    RETURN_NAMES = ("audio",)
    FUNCTION = "run"
    OUTPUT_NODE = True
    CATEGORY = "audio"
    DESCRIPTION = "Listen before continuing. Pause blocks downstream nodes; Continue reuses the previewed audio; save buttons save it without continuing; Pass runs straight through."

    def check_lazy_status(self, audio=None, PauseAudioState=""):
        if read_state(PauseAudioState).get("mode", "pause") not in ("continue", "save_output") and audio is None:
            return ["audio"]
        return []

    def run(self, audio=None, PauseAudioState=""):
        state = read_state(PauseAudioState)
        mode = state.get("mode", "pause")
        if mode in ("continue", "save_output"):
            audio = load_snapshot(state.get("token"))
            if mode == "save_output":
                clips = UI.AudioSaveHelper.get_save_audio_ui(audio, "audio/PauseAudio", cls=None, format="flac").as_dict()["audio"]
                saved = {"clips": clips, "directory": os.path.join(folder_paths.get_output_directory(), "audio")}
                return {"ui": {"pause_audio_saved": [saved]}, "result": (ExecutionBlocker(None),)}
            return {"ui": {"pause_audio_status": ["continued"]}, "result": (audio,)}

        if audio is None:
            raise ValueError("Pause Audio: connect an AUDIO source.")

        clips = UI.PreviewAudio(audio).as_dict()["audio"]
        token = uuid.uuid4().hex
        path = snapshot_path(token)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        snapshot = dict(audio)
        # Preserve the full batch and original samples, not the encoded preview.
        snapshot["waveform"] = audio["waveform"].detach().cpu().clone()
        partial = path + ".partial"
        try:
            torch.save(snapshot, partial)
            os.replace(partial, path)
        finally:
            if os.path.exists(partial):
                os.remove(partial)

        record_preview(token, clips)
        ui = {"pause_audio": [{"token": token, "clips": clips, "mode": mode}]}
        return {"ui": ui, "result": (ExecutionBlocker(None) if mode == "pause" else audio,)}


NODE_CLASS_MAPPINGS = {"PauseAudio": PauseAudio}
NODE_DISPLAY_NAME_MAPPINGS = {"PauseAudio": "Pause Audio"}
