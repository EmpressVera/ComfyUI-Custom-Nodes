import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";
import { CLASS, scopeRecall } from "./recall.mjs";

const PROPERTY = "recallPausedMedia";
const controls = new WeakMap();
const ACTIONS = ["Recall", "Recall All"];
const watchedGraphs = new WeakSet();
const boundActions = new WeakSet();
const promotedButtons = new WeakMap();
let busy = false;

const active = (node) => node.mode !== 2 && node.mode !== 4;
const getLink = (graph, id) => graph.links.get?.(id) ?? graph.links[id];

function contexts() {
    const records = new Map();
    function visit(graph, prefix = "", parent = null, host = null, disabled = false, ancestors = new Set()) {
        if (ancestors.has(graph)) return;
        const frame = { graph, prefix, parent, host, disabled, children: new Map() };
        const seen = new Set([...ancestors, graph]);
        for (const node of graph.nodes) {
            const id = prefix + node.id;
            records.set(id, { id, node, frame, disabled: disabled || !active(node) });
            if (node.isSubgraphNode?.()) frame.children.set(node, visit(node.subgraph, id + ":", frame, node, disabled || !active(node), seen));
        }
        return frame;
    }
    visit(app.rootGraph || app.graph.rootGraph);
    return records;
}

function findSource(record) {
    let frame = record.frame;
    const port = record.node.inputs.find((input) => input.name === "source");
    if (port?.link == null) return { unconnected: true, error: "Connect a Pause Image, Pause Text, or Pause Audio node." };
    let link = port?.link != null && getLink(frame.graph, port.link);
    const seen = new Set();
    while (link) {
        const key = frame.prefix + ":" + link.id;
        if (seen.has(key)) break;
        seen.add(key);
        if (link.origin_id === frame.graph.inputNode?.id && frame.parent) {
            const exterior = frame.host.inputs[link.origin_slot];
            if (exterior?.link == null) return { unconnected: true, error: "Connect a Pause Image, Pause Text, or Pause Audio node." };
            frame = frame.parent;
            link = exterior?.link != null && getLink(frame.graph, exterior.link);
            continue;
        }
        const node = frame.graph.getNodeById(link.origin_id);
        if (!node) break;
        if (frame.disabled || !active(node)) return { skipped: true };
        if (node.isSubgraphNode?.()) {
            frame = frame.children.get(node);
            const boundary = frame.graph.outputs[link.origin_slot];
            link = boundary?.getLinks()?.[0];
            continue;
        }
        if (node.isVirtualNode || node.type === "Reroute") {
            const input = node.inputs[0];
            link = input?.link != null && getLink(frame.graph, input.link);
            continue;
        }
        return preview(node, frame.prefix + node.id);
    }
    return { error: "Connect a Pause Image, Pause Text, or Pause Audio node." };
}

function preview(node, id) {
    const name = node.title || node.type;
    if (node.comfyClass === "PixaromaPauseImage") {
        const frame = node.properties?.pauseImageState?.frame;
        if (!frame) return { error: name + ": preview an image first." };
        return { id, name, source: { kind: "IMAGE", frame } };
    }
    if (node.comfyClass === "PixaromaPauseText") {
        const text = node._pixPtEls?.ta?.value ?? node.properties?.pauseTextState?.text;
        if (typeof text !== "string") return { error: name + ": no text is available." };
        return { id, name, source: { kind: "STRING", text } };
    }
    if (node.comfyClass === "PauseAudio") {
        const token = node.properties?.pauseAudioState?.snapshot?.token;
        if (!token) return { error: name + ": preview audio first." };
        return { id, name, source: { kind: "AUDIO", token } };
    }
    return { error: name + ": unsupported pause node." };
}

function saved(record) {
    return record.node.properties?.[PROPERTY]?.[record.id];
}

// Follow exterior sockets as references; never ask the original pause node to execute.
function destinations(record, callback) {
    const pending = (record.node.outputs[0]?.links || []).map((id) => ({ frame: record.frame, link: getLink(record.frame.graph, id) }));
    const seen = new Set();
    while (pending.length) {
        const { frame, link } = pending.pop();
        if (!link || seen.has(frame.prefix + ":" + link.id)) continue;
        seen.add(frame.prefix + ":" + link.id);
        const node = frame.graph.getNodeById(link.target_id);
        if (!node && link.target_id === frame.graph.outputNode?.id && frame.parent) {
            for (const id of frame.host.outputs[link.target_slot]?.links || []) pending.push({ frame: frame.parent, link: getLink(frame.parent.graph, id) });
        } else if (node?.isSubgraphNode?.()) {
            const inner = frame.children.get(node);
            for (const childLink of node.subgraph.inputs[link.target_slot]?.getLinks() || []) pending.push({ frame: inner, link: childLink });
        } else if (node?.isVirtualNode || (node && !active(node))) {
            for (const port of node.outputs) for (const id of port.links || []) pending.push({ frame, link: getLink(frame.graph, id) });
        } else if (node) callback(frame.prefix + node.id, node.inputs[link.target_slot]?.name);
    }
}

function prepare(prompt, records, selected) {
    // API prompts are JSON data; reactive widget proxies cannot be structured-cloned.
    const output = JSON.parse(JSON.stringify(prompt.output));
    const sourceIds = new Set();
    for (const record of records.values()) {
        if (record.node.comfyClass !== CLASS) continue;
        const source = findSource(record);
        if (source.id) sourceIds.add(source.id);
        const entry = output[record.id];
        if (entry) {
            delete entry.inputs.source;
            const snapshot = saved(record);
            if (record.disabled || source.skipped || source.unconnected) output[record.id] = { class_type: "RecallPausedMediaBlock", inputs: {} };
            else entry.inputs.RecallState = JSON.stringify(snapshot || {});
        } else if (record.disabled) {
            const stub = "recall_block_" + record.id;
            destinations(record, (id, input) => {
                if (!output[id] || !input) return;
                output[stub] ||= { class_type: "RecallPausedMediaBlock", inputs: {} };
                output[id].inputs[input] = [stub, 0];
            });
        }
    }
    // A side input wired directly to a capture gate must not regenerate that gate.
    for (const id of sourceIds) if (output[id]) output[id] = { class_type: "RecallPausedMediaBlock", inputs: {} };
    const targets = scopeRecall(output, selected, (type) => !!window.LiteGraph.registered_node_types[type]?.nodeData?.output_node);
    return { prompt: { ...prompt, output }, targets };
}

function message(node, text) {
    const ui = controls.get(node);
    if (ui) { ui.status.textContent = text; ui.status.title = text; }
}

function reportError(node, text) {
    message(node, text);
    const toast = app.extensionManager?.toast;
    if (toast?.add) toast.add({ severity: "warn", summary: "Recall Paused Media", detail: text, life: 10000 });
    else {
        const detail = document.createElement("div");
        detail.textContent = text;
        app.ui.dialog?.show(detail);
    }
}

async function recall(node, all, executionId) {
    if (busy || app.processingQueue) return;
    const root = app.rootGraph;
    const records = contexts();
    if (!all && !executionId && [...records.values()].filter((record) => record.node === node).length > 1) {
        reportError(node, "Shared subgraph has multiple instances. Use Recall All.");
        return;
    }
    const candidates = [];
    for (const record of records.values()) {
        if (record.node.comfyClass !== CLASS || (!all && (executionId ? record.id !== executionId : record.node !== node)) || record.disabled) continue;
        const source = findSource(record);
        if (source.skipped || (all && source.unconnected)) continue;
        if (source.error) {
            const text = (record.node.title || CLASS) + " (" + record.id + "): " + source.error;
            message(record.node, text);
            reportError(node, text);
            return;
        }
        candidates.push({ record, ...source });
    }
    if (!candidates.length) { reportError(node, "No active paused inputs to recall."); return; }
    busy = true;
    setBusyButtons(records, true);
    message(node, "Recalling...");
    try {
        const response = await api.fetchApi("/recall_paused_media/capture", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sources: candidates.map((candidate) => candidate.source) }),
        });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Recall failed.");
        if (app.rootGraph !== root) throw new Error("Workflow changed. Recall again.");
        const current = contexts();
        for (const candidate of candidates) {
            const record = current.get(candidate.record.id);
            if (!record || record.disabled || findSource(record).id !== candidate.id) throw new Error("Connections or bypass changed. Recall again.");
        }
        for (const [index, candidate] of candidates.entries()) {
            const { record } = candidate;
            record.node.properties ||= {};
            record.node.properties[PROPERTY] ||= {};
            record.node.properties[PROPERTY][record.id] = { ...body.snapshots[index], source: candidate.id };
            message(record.node, candidate.name + ": " + body.snapshots[index].kind + " recalled");
        }
        root.change();
        const prompt = await app.graphToPrompt(root);
        if (app.rootGraph !== root) throw new Error("Workflow changed. Recall again.");
        const prepared = prepare(prompt, current, candidates.map((candidate) => candidate.record.id));
        // Direct submission avoids rerolling seeds or running widget generation callbacks.
        await api.queuePrompt(0, prepared.prompt, { partialExecutionTargets: prepared.targets });
        await app.ui.queue.update();
    } catch (error) {
        reportError(node, error.message || "Recall failed. Check ComfyUI's log.");
        console.error("[Recall Paused Media]", error);
    } finally {
        busy = false;
        setBusyButtons(records, false);
        setBusyButtons(contexts(), false);
    }
}

function ensureActionSlots(node) {
    for (const name of ACTIONS) {
        const input = node.inputs.find((input) => input.name === name)
            || node.addInput(name, "BUTTON", { widget: { name }, label: name });
        input.widget = { name };
        input.label ||= name;
    }
}

// Resolve live promotion links, including nested subgraphs and duplicate labels.
function promotedAction(host, slot, path = [], seen = new Set()) {
    if (seen.has(host)) return;
    const visited = new Set([...seen, host]);
    for (const { inputNode: node, input } of host.resolveSubgraphInputLinks(slot) || []) {
        if (!node || !input) continue;
        const nodePath = [...path, node.id];
        if (node.isSubgraphNode?.()) {
            const action = promotedAction(node, node.inputs.indexOf(input), nodePath, visited);
            if (action) return action;
        } else if (node.comfyClass === CLASS && ACTIONS.includes(input.widget?.name)) {
            return { node, name: input.widget.name, path: nodePath };
        }
    }
}

function bindHostActions(host) {
    if (!host.isSubgraphNode?.()) return;
    host.inputs.forEach((input, slot) => {
        if (!input.widgetId || !promotedAction(host, slot)) return;
        const widget = host.getWidgetFromSlot(input);
        if (!widget) return;
        // Native slots weakly reference proxies; retain our callback while its slot exists.
        promotedButtons.set(input, widget);
        if (boundActions.has(widget)) return;
        boundActions.add(widget);
        // Frontend 1.55.18's button constructor writes to the projection's getter-only options.
        Object.defineProperty(widget, "options", {
            configurable: true, enumerable: true, writable: true, value: widget.options,
        });
        widget.serialize = false;
        widget.options.socketless = true;
        widget.callback = (_value, _canvas, owner) => {
            // Visibility and value restoration also call callbacks, without a node.
            if (!owner || busy) return;
            const action = promotedAction(host, host.inputs.indexOf(input));
            if (!action) return;
            const instances = [...contexts().values()].filter((record) => record.node === host);
            if (instances.length !== 1) {
                reportError(action.node, "Use the button on the outermost subgraph for this instance.");
                return;
            }
            if (instances[0].disabled) return;
            const id = instances[0].id + ":" + action.path.join(":");
            const record = contexts().get(id);
            if (!record || record.disabled) return;
            recall(action.node, action.name === "Recall All", id);
        };
    });
}

function watchGraph(graph) {
    if (!graph || watchedGraphs.has(graph)) return;
    watchedGraphs.add(graph);
    graph.events.addEventListener("subgraph-created", (event) => {
        watchGraph(event.detail.subgraph);
    });
    graph.events.addEventListener("widget-promoted", (event) => {
        bindHostActions(event.detail.subgraphNode);
    });
    for (const subgraph of graph.subgraphs?.values() || []) watchGraph(subgraph);
}

function bindActions() {
    const root = app.rootGraph || app.graph.rootGraph;
    watchGraph(root);
    const graphs = new Set([root, ...root.subgraphs.values()]);
    for (const graph of graphs) for (const node of graph.nodes) bindHostActions(node);
}

function setBusyButtons(records, disabled) {
    for (const record of records.values()) {
        const ui = controls.get(record.node);
        if (ui) for (const button of ui.buttons) button.disabled = disabled;
        if (record.node.isSubgraphNode?.()) {
            record.node.inputs.forEach((input, slot) => {
                if (!input.widgetId || !promotedAction(record.node, slot)) return;
                const widget = record.node.getWidgetFromSlot(input);
                widget.disabled = disabled;
                widget.options.disabled = disabled;
            });
        }
        record.node.setDirtyCanvas?.(true);
    }
}

function install(node) {
    if (controls.has(node)) return;
    const root = document.createElement("div");
    root.className = "recall-media-ui";
    root.innerHTML = '<div role="status">Not recalled</div>';
    const widget = node.addDOMWidget("recall_status", "recall_status", root, { serialize: false, getMinHeight: () => 40, getMaxHeight: () => 40 });
    Object.defineProperty(widget.options, "canvasOnly", { configurable: true, enumerable: true, get: () => !window.LiteGraph?.vueNodesMode });
    const buttons = ACTIONS.map((name, index) => {
        const button = node.addWidget("button", name, null, (_value, _canvas, owner) => {
            if (owner) recall(node, index === 1);
        }, { serialize: false, socketless: true, iconClass: index ? "pi pi-sync" : "pi pi-refresh", title: index ? "Recall all active paused inputs" : "Recall this paused input" });
        button.label = name;
        button.serialize = false;
        return button;
    });
    controls.set(node, { root, buttons, status: root.querySelector('[role="status"]') });
    ensureActionSlots(node);
    node.setSize([Math.max(280, node.size[0]), Math.max(160, node.size[1])]);
    const configure = node.onConfigure;
    node.onConfigure = function (...args) {
        const result = configure?.apply(this, args);
        ensureActionSlots(node);
        const snapshots = Object.values(node.properties?.[PROPERTY] || {});
        message(node, snapshots.length ? snapshots[0].kind + " recalled" : "Not recalled");
        return result;
    };
}

app.registerExtension({
    name: "RecallPausedMedia.Controls",
    nodeCreated(node) { if (node.comfyClass === CLASS) install(node); },
    loadedGraphNode(node) { if (node.comfyClass === CLASS) install(node); },
    afterConfigureGraph() { bindActions(); },
    setup() {
        const style = document.createElement("style");
        style.textContent = `.recall-media-ui{box-sizing:border-box;width:100%;height:100%;min-width:0;padding:8px;background:#252525;color:#bbb;font:12px sans-serif;letter-spacing:0;overflow:hidden}.recall-media-ui [role=status]{overflow:hidden;overflow-wrap:anywhere;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2}`;
        document.head.append(style);
        bindActions();
        const original = app.graphToPrompt;
        app.graphToPrompt = async function (...args) {
            const prompt = await original.apply(this, args);
            for (const record of contexts().values()) {
                const entry = prompt.output?.[record.id];
                if (entry?.class_type !== CLASS) continue;
                delete entry.inputs.source;
                for (const name of ACTIONS) delete entry.inputs[name];
                const source = findSource(record);
                entry.inputs.RecallState = JSON.stringify(record.disabled || source.skipped ? { blocked: true } : saved(record) || {});
            }
            return prompt;
        };
        api.addEventListener("execution_error", (event) => {
            const record = contexts().get(String(event.detail.node_id));
            if (record?.node.comfyClass === CLASS) message(record.node, event.detail.exception_message || "Recall stopped.");
        });
    },
});
