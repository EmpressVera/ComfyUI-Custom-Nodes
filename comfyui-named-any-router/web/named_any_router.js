import { app } from "../../scripts/app.js";

const NODE_ID = "NamedAnyRouter";
const MAX_PORTS = 20;
const SELECTORS = ["input_selector", "output_selector"];
const states = new WeakMap();
const watchedGraphs = new WeakSet();
const promotedSelections = new WeakMap();

function isRouter(node) {
    return node.comfyClass === NODE_ID || node.constructor?.comfyClass === NODE_ID;
}

function graphOwners(root) {
    return [root, ...root.subgraphs.values()];
}

function getLink(graph, id) {
    return graph.links.get?.(id) ?? graph.links[id];
}

function sourceTitle(graph, link, seen = new Set()) {
    const source = graph.getNodeById(link.origin_id);
    if (source) return String(source.title || source.constructor?.title || source.type);
    if (link.origin_id !== graph.inputNode?.id || seen.has(graph)) return;
    seen.add(graph);
    for (const owner of graphOwners(graph.rootGraph)) {
        for (const parent of owner.nodes) {
            if (!parent.isSubgraphNode?.() || parent.subgraph !== graph) continue;
            const input = parent.inputs[link.origin_slot];
            const upstream = input?.link != null && getLink(owner, input.link);
            if (upstream) return sourceTitle(owner, upstream, seen);
        }
    }
    const boundary = graph.inputs[link.origin_slot];
    return boundary?.label || boundary?.name;
}

function destinationTitle(graph, link, seen = new Set()) {
    const target = graph.getNodeById(link.target_id);
    if (target) return String(target.title || target.constructor?.title || target.type);
    if (link.target_id !== graph.outputNode?.id || seen.has(graph)) return;
    seen.add(graph);
    // Cross output boundaries, but stop at the first real connected node.
    for (const owner of graphOwners(graph.rootGraph)) {
        for (const parent of owner.nodes) {
            if (!parent.isSubgraphNode?.() || parent.subgraph !== graph) continue;
            for (const id of parent.outputs[link.target_slot]?.links || []) {
                const downstream = getLink(owner, id);
                const title = downstream && destinationTitle(owner, downstream, seen);
                if (title) return title;
            }
        }
    }
    const boundary = graph.outputs[link.target_slot];
    return boundary?.label || boundary?.name || "Subgraph output";
}

function syncOutputs(node) {
    let lastConnected = -1;
    for (const [index, output] of node.outputs.entries()) {
        if (output.links?.length) lastConnected = index;
    }
    const count = Math.min(MAX_PORTS, Math.max(1, lastConnected + 2));
    const changed = node.outputs.length !== count;
    while (node.outputs.length > count) node.removeOutput(node.outputs.length - 1);
    while (node.outputs.length < count) node.addOutput(`output_${node.outputs.length + 1}`, "*");
    if (changed) node.expandToFitContent();
}

function readEntries(node, direction) {
    const graph = node.graph;
    if (!graph) return [];
    const entries = [];
    if (direction === "input") {
        for (const port of node.inputs) {
            if (!port.name.startsWith("inputs.input_") || port.link == null) continue;
            const link = getLink(graph, port.link);
            const title = link && sourceTitle(graph, link);
            if (title) entries.push({ port, key: port.name, anchor: port.link, title });
        }
    } else {
        for (const [index, port] of node.outputs.entries()) {
            const link = (port.links || []).map((id) => getLink(graph, id)).find(Boolean);
            const title = link && destinationTitle(graph, link);
            if (title) entries.push({ port, key: `output_${index}`, anchor: index, title });
            else port.label = port.name;
        }
    }
    const counts = new Map();
    for (const entry of entries) counts.set(entry.title, (counts.get(entry.title) || 0) + 1);
    const used = new Set();
    for (const entry of entries) {
        const suffix = direction === "input" ? entry.key.split(".").at(-1) : entry.port.name;
        let label = counts.get(entry.title) > 1 ? `${entry.title} [${suffix}]` : entry.title;
        while (used.has(label)) label += ` [${suffix}]`;
        used.add(label);
        entry.label = label;
        entry.port.label = label.length > 24 ? label.slice(0, 21) + "..." : label;
    }
    return entries;
}

function installMenu(node, name, schedule) {
    const widget = node.widgets.find((item) => item.name === name);
    const direction = name === "input_selector" ? "input" : "output";
    const property = `named_router_selected_${direction}`;
    const empty = direction === "input" ? "No inputs connected" : "No outputs connected";
    widget.label = direction;
    widget.options ||= {};
    widget.options.socketless = false;
    let entries = [];
    let keys = [""];
    let selectedKey = node.properties?.[property] || widget.value;
    let selectedAnchor = null;
    let initialized = false;

    const refresh = () => {
        if (!node.graph) return;
        const connected = readEntries(node, direction);
        let selected = widget.value !== selectedKey ? connected.find((entry) => entry.key === widget.value) : undefined;
        selected ||= selectedAnchor == null ? undefined : connected.find((entry) => entry.anchor === selectedAnchor);
        if (!selected && !initialized) selected = connected.find((entry) => entry.key === selectedKey);
        selected ||= connected[0];
        initialized = connected.length > 0;
        selectedAnchor = selected?.anchor ?? null;
        selectedKey = selected?.key || "";
        node.properties ||= {};
        node.properties[property] = selectedKey;
        widget.value = selectedKey;
        const nextKeys = connected.length ? connected.map((entry) => entry.key) : [""];
        if (nextKeys.length !== keys.length || nextKeys.some((key, index) => key !== keys[index])) {
            keys = nextKeys;
            node.setDirtyCanvas?.(true, true);
        }
        entries = connected;
    };

    const previousCallback = widget.callback;
    widget.callback = function (value, ...args) {
        const selected = entries.find((entry) => entry.key === value);
        if (selected) {
            selectedAnchor = selected.anchor;
            selectedKey = selected.key;
            node.properties[property] = selectedKey;
        }
        previousCallback?.call(this, value, ...args);
        schedule();
    };
    Object.defineProperty(widget.options, "values", {
        configurable: true, enumerable: true,
        get() { refresh(); return keys; },
    });
    widget.options.getOptionLabel = (key) => {
        refresh();
        return entries.find((entry) => entry.key === key)?.label || empty;
    };
    widget.serializeValue = () => { refresh(); return selectedKey; };
    return {
        widget, refresh,
        reset() { selectedKey = node.properties?.[property] || widget.value; selectedAnchor = null; initialized = false; },
        readEntries() { refresh(); return entries; },
    };
}

function promotedSelector(node, slot, seen = new Set()) {
    if (seen.has(node)) return;
    seen.add(node);
    for (const { inputNode, input } of node.resolveSubgraphInputLinks(slot)) {
        if (!inputNode || !input) continue;
        if (isRouter(inputNode) && SELECTORS.includes(input.widget?.name)) {
            return states.get(inputNode)?.menus.get(input.widget.name);
        }
        if (inputNode.isSubgraphNode?.()) {
            const resolved = promotedSelector(inputNode, inputNode.inputs.indexOf(input), seen);
            if (resolved) return resolved;
        }
    }
}

function bindPromotedSelectors(root) {
    for (const graph of graphOwners(root)) {
        for (const node of graph.nodes) {
            if (!node.isSubgraphNode?.()) continue;
            for (const [index, input] of node.inputs.entries()) {
                if (!input.widgetId) continue;
                const menu = promotedSelector(node, index);
                const source = menu?.widget;
                const widget = source && node.getWidgetFromSlot(input);
                if (!widget) continue;
                let selection = promotedSelections.get(input);
                if (!selection) {
                    selection = { key: widget.value, anchor: null };
                    promotedSelections.set(input, selection);
                }
                const sync = () => {
                    const entries = menu.readEntries();
                    let selected = widget.value === selection.key && selection.anchor != null
                        ? entries.find((entry) => entry.anchor === selection.anchor)
                        : entries.find((entry) => entry.key === widget.value);
                    selected ||= entries[0];
                    selection.key = selected?.key || "";
                    selection.anchor = selected?.anchor ?? null;
                    widget.value = selection.key;
                };
                Object.defineProperty(widget.options, "values", {
                    configurable: true, enumerable: true,
                    get() { sync(); return source.options.values; },
                });
                widget.options.getOptionLabel = (key) => {
                    const previous = widget.value;
                    sync();
                    return source.options.getOptionLabel(key === previous ? widget.value : key);
                };
                sync();
            }
        }
    }
}

function watchGraph(graph) {
    if (watchedGraphs.has(graph)) return;
    watchedGraphs.add(graph);
    graph.events.addEventListener("widget-promoted", () => bindPromotedSelectors(graph.rootGraph));
}

function install(node) {
    if (states.has(node)) return states.get(node);
    if (!SELECTORS.every((name) => node.widgets?.some((widget) => widget.name === name))) return;
    const ensureSelectorSlots = () => {
        for (const name of SELECTORS) {
            if (!node.inputs.some((input) => input.widget?.name === name)) {
                node.addInput(name, "COMBO", { widget: { name } });
            }
        }
    };
    ensureSelectorSlots();
    let pending = false;
    const refresh = () => {
        if (!node.graph) return;
        syncOutputs(node);
        for (const menu of menus.values()) menu.refresh();
    };
    const schedule = () => {
        if (pending) return;
        pending = true;
        queueMicrotask(() => { pending = false; refresh(); });
    };
    const menus = new Map(SELECTORS.map((name) => [name, installMenu(node, name, schedule)]));
    syncOutputs(node);
    const size = node.computeSize();
    node.setSize([Math.max(size[0], 420), size[1]]);
    const previousConnections = node.onConnectionsChange;
    node.onConnectionsChange = function (...args) {
        const result = previousConnections?.apply(this, args);
        schedule();
        return result;
    };
    const previousConfigure = node.onConfigure;
    node.onConfigure = function (...args) {
        const result = previousConfigure?.apply(this, args);
        ensureSelectorSlots();
        node.size = [Math.max(node.size[0], 420), node.size[1]];
        for (const menu of menus.values()) menu.reset();
        schedule();
        return result;
    };
    const previousDraw = node.onDrawForeground;
    node.onDrawForeground = function (...args) { refresh(); return previousDraw?.apply(this, args); };
    const state = { menus, refresh, schedule };
    states.set(node, state);
    schedule();
    return state;
}

app.registerExtension({
    name: "NamedAnyRouter.Dropdowns",
    setup() {
        app.graph.events.addEventListener("subgraph-created", (event) => watchGraph(event.detail.subgraph));
        for (const graph of app.graph.subgraphs.values()) watchGraph(graph);
    },
    nodeCreated(node) { if (isRouter(node)) install(node); },
    loadedGraphNode(node) { if (isRouter(node)) install(node)?.schedule(); },
    beforeQueuePrompt() { bindPromotedSelectors(app.graph.rootGraph); },
    afterConfigureGraph() {
        for (const graph of graphOwners(app.graph.rootGraph)) {
            for (const node of graph.nodes) if (isRouter(node)) install(node)?.refresh();
        }
        bindPromotedSelectors(app.graph.rootGraph);
    },
});
