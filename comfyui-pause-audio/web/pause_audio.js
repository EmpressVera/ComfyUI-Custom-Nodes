import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";
import { prepareContinue } from "./gate.mjs";

const CLASS = "PauseAudio";
const PROPERTY = "pauseAudioState";
const widgets = new WeakMap();

function state(node) {
    node.properties ||= {};
    return node.properties[PROPERTY] ||= { gate: "pause", snapshot: null, revision: 0 };
}

function nodeIndex() {
    const result = new Map();
    const visit = (graph, prefix = "", parents = new Set()) => {
        if (!graph || parents.has(graph)) return;
        const seen = new Set([...parents, graph]);
        for (const node of graph.nodes || []) {
            const id = prefix + node.id;
            if (node.comfyClass === CLASS) result.set(id, node);
            if (node.isSubgraphNode?.()) visit(node.subgraph, id + ":", seen);
        }
    };
    visit(app.graph.rootGraph);
    return result;
}

function effectiveState(node) {
    const saved = state(node);
    const mode = node._pauseAudioSubmit || (saved.gate === "pass" ? "pass" : "pause");
    return { mode, revision: saved.revision, ...(["continue", "save_output"].includes(mode) ? { token: node._pauseAudioToken } : {}), ...(mode === "save_output" ? { request: node._pauseAudioSaveRequest } : {}) };
}

function render(node) {
    const ui = widgets.get(node);
    if (!ui) return;
    const saved = state(node);
    ui.toggle.checked = saved.gate !== "pass";
    ui.mode.textContent = saved.gate === "pass" ? "Pass" : "Pause";
    const busy = !!(node._pauseAudioBusy || node._pauseAudioSaving);
    ui.continue.disabled = busy || !ui.ready || saved.gate === "pass";
    ui.regenerate.disabled = busy;
    ui.saveFolder.disabled = busy || !ui.ready;
    ui.saveOutput.disabled = busy || !ui.ready;
    ui.status.textContent = node._pauseAudioMessage || (saved.snapshot ? (saved.gate === "pass" ? "Passing through" : "Paused") : "Waiting for audio");
    ui.status.title = ui.location || ui.status.textContent;
}

function showSnapshot(node) {
    const ui = widgets.get(node);
    if (!ui) return;
    for (const player of ui.players.querySelectorAll("audio")) player.pause();
    ui.players.replaceChildren();
    ui.ready = false;
    ui.location = null;
    const snapshot = state(node).snapshot;
    const clips = snapshot?.clips || [];
    let loaded = 0;
    for (const [index, clip] of clips.entries()) {
        const player = document.createElement("audio");
        player.controls = true;
        player.preload = "metadata";
        player.setAttribute("aria-label", `Audio preview ${index + 1}`);
        const params = new URLSearchParams({ filename: clip.filename, subfolder: clip.subfolder || "", type: "temp" });
        player.src = api.apiURL("/view?" + params);
        player.addEventListener("loadedmetadata", () => {
            loaded++;
            ui.ready = loaded === clips.length;
            render(node);
        }, { once: true });
        player.addEventListener("error", () => {
            ui.ready = false;
            node._pauseAudioMessage = "Preview expired. Run again.";
            render(node);
        });
        ui.players.append(player);
    }
    render(node);
}

async function queue(node, mode) {
    if (node._pauseAudioBusy || node._pauseAudioSaving) return;
    if (app.processingQueue) {
        node._pauseAudioMessage = "Queue is busy. Try again.";
        render(node);
        return;
    }
    for (const other of nodeIndex().values()) other._pauseAudioSubmit = null;
    if (mode === "pause") {
        state(node).revision++;
        node.graph.change();
    }
    node._pauseAudioSubmit = mode;
    node._pauseAudioToken = state(node).snapshot?.token;
    if (mode === "save_output") node._pauseAudioSaveRequest = `${Date.now()}-${Math.random()}`;
    widgets.get(node).location = null;
    node._pauseAudioBusy = true;
    node._pauseAudioMessage = mode === "continue" ? "Continuing..." : mode === "save_output" ? "Saving..." : "Regenerating...";
    render(node);
    try {
        const queued = await app.queuePrompt(0, 1);
        if (queued === false) throw new Error("ComfyUI did not accept the run.");
    } catch (error) {
        node._pauseAudioBusy = false;
        node._pauseAudioMessage = "Could not queue audio. Check ComfyUI's error.";
        render(node);
        console.error("[Pause Audio]", error);
    } finally {
        node._pauseAudioSubmit = null;
        node._pauseAudioToken = null;
        node._pauseAudioSaveRequest = null;
    }
}

async function saveToFolder(node) {
    const ui = widgets.get(node);
    if (!ui?.ready || node._pauseAudioBusy || node._pauseAudioSaving) return;
    const snapshot = state(node).snapshot;
    const clips = [...snapshot.clips];
    const stamp = new Date().toISOString().replace(/[^0-9]/g, "");
    const filename = (index) => `PauseAudio_${stamp}_${index + 1}.flac`;
    node._pauseAudioSaving = true;
    node._pauseAudioMessage = "Saving...";
    ui.location = null;
    render(node);
    try {
        // Open the picker before fetching audio, while the click is still active.
        let directory;
        let file;
        if (typeof window.showDirectoryPicker === "function") {
            directory = await window.showDirectoryPicker({ id: "pause-audio", mode: "readwrite", startIn: "music" });
        } else if (clips.length === 1 && typeof window.showSaveFilePicker === "function") {
            file = await window.showSaveFilePicker({ id: "pause-audio", suggestedName: filename(0), types: [{ description: "FLAC audio", accept: { "audio/flac": [".flac"] } }] });
        } else {
            node._pauseAudioMessage = "Choose a folder...";
            render(node);
            const response = await api.fetchApi("/pause_audio/save_folder", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ token: snapshot.token }),
            });
            const saved = await response.json();
            if (!response.ok) throw new Error(saved.error || "Could not save audio.");
            node._pauseAudioMessage = saved.cancelled ? null : `Saved ${saved.files.length} ${saved.files.length === 1 ? "file" : "files"}`;
            ui.location = saved.directory || null;
            return;
        }
        for (const [index, clip] of clips.entries()) {
            const params = new URLSearchParams({ filename: clip.filename, subfolder: clip.subfolder || "", type: "temp" });
            const response = await api.fetchApi("/view?" + params);
            if (!response.ok) throw new Error("Preview expired. Run again.");
            const blob = await response.blob();
            const handle = directory ? await directory.getFileHandle(filename(index), { create: true }) : file;
            const writer = await handle.createWritable();
            try { await writer.write(blob); await writer.close(); }
            catch (error) { await writer.abort().catch(() => {}); throw error; }
        }
        node._pauseAudioMessage = `Saved ${clips.length} ${clips.length === 1 ? "file" : "files"}`;
        ui.location = directory?.name || file?.name || null;
    } catch (error) {
        node._pauseAudioMessage = error.name === "AbortError" ? null : "Save failed: " + error.message;
    } finally {
        node._pauseAudioSaving = false;
        render(node);
    }
}

function install(node) {
    if (widgets.has(node)) return;
    const root = document.createElement("div");
    root.className = "pause-audio-ui";
    root.innerHTML = '<div class="pause-audio-mode"><label><input type="checkbox" aria-label="Pause before continuing" checked><span>Pause</span></label><span class="pause-audio-status" role="status"></span></div><div class="pause-audio-players"></div><div class="pause-audio-actions"><button type="button" aria-label="Regenerate" title="Regenerate audio"><i class="pi pi-refresh" aria-hidden="true"></i> Regenerate</button><button type="button" aria-label="Continue" title="Continue with the previewed audio"><i class="pi pi-arrow-right" aria-hidden="true"></i> Continue</button><button type="button" aria-label="Save to Folder" title="Save previewed audio to a chosen folder"><i class="pi pi-folder" aria-hidden="true"></i> Save to Folder</button><button type="button" aria-label="Save Output" title="Save previewed audio to ComfyUI output/audio"><i class="pi pi-save" aria-hidden="true"></i> Save Output</button></div>';
    const [regenerate, continueButton, saveFolder, saveOutput] = root.querySelectorAll("button");
    const ui = { root, toggle: root.querySelector("input"), mode: root.querySelector("label span"), status: root.querySelector('[role="status"]'), players: root.querySelector(".pause-audio-players"), regenerate, continue: continueButton, saveFolder, saveOutput, ready: false };
    widgets.set(node, ui);
    ui.toggle.addEventListener("change", () => {
        state(node).gate = ui.toggle.checked ? "pause" : "pass";
        node._pauseAudioMessage = null;
        node.graph?.change();
        render(node);
    });
    regenerate.addEventListener("click", () => queue(node, "pause"));
    continueButton.addEventListener("click", () => queue(node, "continue"));
    saveFolder.addEventListener("click", () => saveToFolder(node));
    saveOutput.addEventListener("click", () => queue(node, "save_output"));
    const widget = node.addDOMWidget("pause_audio", "pause_audio", root, { serialize: false, getMinHeight: () => 200 });
    Object.defineProperty(widget.options, "canvasOnly", { configurable: true, enumerable: true, get: () => !window.LiteGraph?.vueNodesMode });
    node.size = [Math.max(node.size[0], 350), Math.max(node.size[1], 280)];
    const previousConfigure = node.onConfigure;
    node.onConfigure = function (...args) {
        const result = previousConfigure?.apply(this, args);
        node.size = [Math.max(node.size[0], 350), Math.max(node.size[1], 280)];
        node._pauseAudioMessage = null;
        queueMicrotask(() => showSnapshot(node));
        return result;
    };
    const previousRemoved = node.onRemoved;
    node.onRemoved = function (...args) {
        for (const player of ui.players.querySelectorAll("audio")) {
            player.pause();
            player.removeAttribute("src");
            player.load();
        }
        widgets.delete(node);
        return previousRemoved?.apply(this, args);
    };
    queueMicrotask(() => showSnapshot(node));
}

app.registerExtension({
    name: "PauseAudio.Review",
    nodeCreated(node) { if (node.comfyClass === CLASS) install(node); },
    loadedGraphNode(node) { if (node.comfyClass === CLASS) install(node); },
    setup() {
        const style = document.createElement("style");
        style.textContent = `
            .pause-audio-ui{box-sizing:border-box;width:100%;height:100%;min-width:0;padding:8px;display:flex;flex-direction:column;gap:12px;background:#242424;color:#eee;font:13px sans-serif;overflow:hidden;letter-spacing:0}
            .pause-audio-ui *{box-sizing:border-box}
            .pause-audio-mode{display:flex;align-items:center;justify-content:space-between;gap:8px;height:32px;flex-shrink:0}
            .pause-audio-mode label{display:flex;align-items:center;gap:7px;cursor:pointer;flex-shrink:0}
            .pause-audio-mode input{accent-color:#48b58c}
            .pause-audio-status{color:#aaa;font-size:11px;text-align:right;overflow-wrap:anywhere;max-width:65%;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden}
            .pause-audio-players{display:flex;flex-direction:column;gap:8px;flex:1;min-height:48px;overflow:auto}
            .pause-audio-players audio{display:block;width:100%;min-width:0;height:42px}
            .pause-audio-actions{display:grid;grid-template-columns:1fr 1fr;gap:8px;flex-shrink:0}
            .pause-audio-actions button{min-width:0;min-height:32px;padding:4px;border:1px solid #555;border-radius:4px;background:#333;color:#eee;cursor:pointer;font:12px sans-serif;letter-spacing:0}
            .pause-audio-actions button[aria-label="Continue"]{background:#286950;border-color:#3b9272}
            .pause-audio-actions button:hover:not(:disabled){filter:brightness(1.15)}
            .pause-audio-actions button:disabled{opacity:.45;cursor:default}
            .pause-audio-actions i{margin-right:4px}
        `;
        document.head.append(style);

        const originalGraphToPrompt = app.graphToPrompt;
        app.graphToPrompt = async function (...args) {
            const result = await originalGraphToPrompt.apply(this, args);
            const index = nodeIndex();
            for (const [id, entry] of Object.entries(result.output || {})) {
                if (entry.class_type !== CLASS) continue;
                const node = index.get(id);
                entry.inputs.PauseAudioState = JSON.stringify(node ? effectiveState(node) : { mode: "pause" });
            }
            return result;
        };

        const originalQueuePrompt = api.queuePrompt;
        api.queuePrompt = async function (number, prompt, ...args) {
            if (!Object.values(prompt.output).some((entry) => entry.class_type === CLASS)) {
                return originalQueuePrompt.call(this, number, prompt, ...args);
            }
            const output = structuredClone(prompt.output);
            const save = Object.entries(output).find(([, entry]) => entry.class_type === CLASS && JSON.parse(entry.inputs.PauseAudioState || '{}').mode === "save_output");
            if (save) {
                const [id, entry] = save;
                delete entry.inputs.audio;
                // Saving is a standalone action, never a downstream workflow run.
                for (const key of Object.keys(output)) if (key !== id) delete output[key];
            }
            const isOutput = (type) => !!window.LiteGraph.registered_node_types[type]?.nodeData?.output_node;
            for (const [id, entry] of Object.entries(output)) {
                if (output[id] && entry.class_type === CLASS && JSON.parse(entry.inputs.PauseAudioState || '{}').mode === "continue") {
                    prepareContinue(output, id, isOutput);
                }
            }
            try {
                return await originalQueuePrompt.call(this, number, { ...prompt, output }, ...args);
            } catch (error) {
                // ComfyUI catches queue errors internally, so release the controls here.
                for (const node of nodeIndex().values()) {
                    if (!node._pauseAudioBusy) continue;
                    node._pauseAudioBusy = false;
                    node._pauseAudioMessage = "Could not queue audio. Check ComfyUI's error.";
                    render(node);
                }
                throw error;
            }
        };

        api.addEventListener("executed", (event) => {
            const payload = event.detail.output;
            if (!payload?.pause_audio && !payload?.pause_audio_status && !payload?.pause_audio_saved) return;
            const node = nodeIndex().get(String(event.detail.node));
            if (!node) return;
            node._pauseAudioBusy = false;
            node._pauseAudioMessage = null;
            if (payload.pause_audio) {
                state(node).snapshot = payload.pause_audio[0];
                showSnapshot(node);
            } else if (payload.pause_audio_saved) {
                const saved = payload.pause_audio_saved[0];
                node._pauseAudioMessage = `Saved ${saved.clips.length} ${saved.clips.length === 1 ? "file" : "files"} to output/audio`;
                const ui = widgets.get(node);
                if (ui) ui.location = saved.directory;
                render(node);
            } else {
                node._pauseAudioMessage = "Continued";
                render(node);
            }
        });
        for (const type of ["execution_success", "execution_error", "execution_interrupted"]) {
            api.addEventListener(type, () => {
                for (const node of nodeIndex().values()) {
                    if (!node._pauseAudioBusy) continue;
                    node._pauseAudioBusy = false;
                    node._pauseAudioMessage = type === "execution_success" ? "Run completed" : "Run stopped. Check ComfyUI's error.";
                    render(node);
                }
            });
        }
    },
});
