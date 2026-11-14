import { app } from "../../scripts/app.js";

const NODE_ID = "NamedAnySwitch";
const EMPTY = "No inputs connected";
const PROPERTY = "named_switch_selected_input";
const states = new WeakMap();
const watchedGraphs = new WeakSet();
const promotedSelections = new WeakMap();

function isSwitch(node) {
    return node.comfyClass === NODE_ID || node.constructor?.comfyClass === NODE_ID;
}

function graphOwners(root) {
    return [root, ...root.subgraphs.values()];
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
            const upstream = input?.link != null && owner.links.get(input.link);
            if (upstream) return sourceTitle(owner, upstream, seen);
        }
    }
    const boundary = graph.inputs[link.origin_slot];
    return boundary?.label || boundary?.name;
}

function promotedSelector(node, slot, seen = new Set()) {
    if (seen.has(node)) return;
    seen.add(node);
    for (const { inputNode, input } of node.resolveSubgraphInputLinks(slot)) {
        if (!inputNode || !input) continue;
        if (isSwitch(inputNode) && input.widget?.name === "selector") {
            return { node: inputNode, widget: inputNode.widgets.find((widget) => widget.name === "selector") };
        }
        if (inputNode.isSubgraphNode?.()) {
            const widget = promotedSelector(inputNode, inputNode.inputs.indexOf(input), seen);
            if (widget) return widget;
        }
    }
}

function bindPromotedSelectors(root) {
    for (const graph of graphOwners(root)) {
        for (const node of graph.nodes) {
            if (!node.isSubgraphNode?.()) continue;
            for (const [index, input] of node.inputs.entries()) {
                if (!input.widgetId) continue;
                const resolved = promotedSelector(node, index);
                const source = resolved?.widget;
                const state = resolved && states.get(resolved.node);
                const widget = source && node.getWidgetFromSlot(input);
                if (!widget || !state) continue;
                let selection = promotedSelections.get(input);
                if (!selection) {
                    selection = { key: widget.value, link: null };
                    promotedSelections.set(input, selection);
                }
                const sync = () => {
                    const entries = state.readEntries();
                    let selected = widget.value === selection.key && selection.link != null
                        ? entries.find((entry) => entry.input.link === selection.link)
                        : entries.find((entry) => entry.key === widget.value);
                    selected ||= entries[0];
                    selection.key = selected?.key || "";
                    selection.link = selected?.input.link ?? null;
                    widget.value = selection.key;
                };
                // ComfyUI copies options when promoting; keep this dynamic menu live.
                Object.defineProperty(widget.options, "values", {
                    configurable: true,
                    enumerable: true,
                    get() {
                        sync();
                        return source.options.values;
                    },
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
    const widget = node.widgets?.find((item) => item.name === "selector");
    if (!widget) return;
    widget.options ||= {};
    widget.options.socketless = false;
    const ensureSelectorSlot = () => {
        if (!node.inputs.some((input) => input.widget?.name === "selector")) {
            node.addInput("selector", "COMBO", { widget: { name: "selector" } });
        }
    };
    ensureSelectorSlot();

    let entries = [];
    let keys = [""];
    let selectedInput = null;
    let selectedLink = null;
    let selectedKey = node.properties?.[PROPERTY] || widget.value;
    let pending = false;

    const refresh = () => {
        const graph = node.graph;
        if (!graph) return;
        const connected = [];
        for (const input of node.inputs || []) {
            if (!input.name.startsWith("inputs.input_") || input.link == null) continue;
            const link = graph.links.get?.(input.link) ?? graph.links[input.link];
            const title = link && sourceTitle(graph, link);
            if (!title) continue;
            connected.push({ input, key: input.name, title });
        }

        const counts = new Map();
        for (const entry of connected) counts.set(entry.title, (counts.get(entry.title) || 0) + 1);
        const used = new Set();
        for (const entry of connected) {
            const suffix = entry.key.split(".").at(-1);
            let label = counts.get(entry.title) > 1 ? `${entry.title} [${suffix}]` : entry.title;
            while (used.has(label)) label += ` [${suffix}]`;
            used.add(label);
            entry.label = label;
            if (entry.input.label !== label) entry.input.label = label;
        }

        let selected = widget.value !== selectedKey
            ? connected.find((entry) => entry.key === widget.value)
            : undefined;
        selected ||= selectedLink == null ? undefined : connected.find((entry) => entry.input.link === selectedLink);
        if (!selected && selectedInput === null) {
            selected = connected.find((entry) => entry.key === selectedKey);
            selected ||= connected.find((entry) => entry.label === widget.value);
        }
        selected ||= connected[0];
        selectedInput = selected?.input || null;
        selectedLink = selectedInput?.link ?? null;
        selectedKey = selected?.key || "";
        node.properties ||= {};
        node.properties[PROPERTY] = selectedKey;
        const value = selectedKey;
        if (widget.value !== value) widget.value = value;
        const nextKeys = connected.length ? connected.map((entry) => entry.key) : [""];
        if (nextKeys.length !== keys.length || nextKeys.some((key, index) => key !== keys[index])) {
            keys = nextKeys;
            node.setDirtyCanvas?.(true, true);
        }
        entries = connected;
    };

    const schedule = () => {
        if (pending) return;
        pending = true;
        queueMicrotask(() => {
            pending = false;
            refresh();
        });
    };

    const previousCallback = widget.callback;
    widget.callback = function (value, ...args) {
        const selected = entries.find((entry) => entry.key === value);
        if (selected) {
            selectedInput = selected.input;
            selectedLink = selected.input.link;
            selectedKey = selected.key;
            node.properties[PROPERTY] = selectedKey;
        }
        previousCallback?.call(this, value, ...args);
        schedule();
    };

    Object.defineProperty(widget.options, "values", {
        configurable: true,
        enumerable: true,
        get() {
            refresh();
            return keys;
        },
    });
    widget.options.getOptionLabel = (key) => {
        refresh();
        return entries.find((entry) => entry.key === key)?.label || EMPTY;
    };
    widget.serializeValue = () => {
        refresh();
        return selectedKey;
    };

    const previousConnections = node.onConnectionsChange;
    node.onConnectionsChange = function (...args) {
        const result = previousConnections?.apply(this, args);
        schedule();
        return result;
    };

    const previousConfigure = node.onConfigure;
    node.onConfigure = function (...args) {
        const result = previousConfigure?.apply(this, args);
        ensureSelectorSlot();
        selectedInput = null;
        selectedLink = null;
        selectedKey = node.properties?.[PROPERTY] || widget.value;
        schedule();
        return result;
    };

    const previousDraw = node.onDrawForeground;
    node.onDrawForeground = function (...args) {
        refresh();
        return previousDraw?.apply(this, args);
    };

    const state = { refresh, schedule, readEntries() { refresh(); return entries; } };
    states.set(node, state);
    schedule();
    return state;
}

app.registerExtension({
    name: "NamedAnySwitch.Dropdown",
    setup() {
        app.graph.events.addEventListener("subgraph-created", (event) => watchGraph(event.detail.subgraph));
        for (const graph of app.graph.subgraphs.values()) watchGraph(graph);
    },
    nodeCreated(node) {
        if (isSwitch(node)) install(node);
    },
    loadedGraphNode(node) {
        if (isSwitch(node)) install(node)?.schedule();
    },
    beforeQueuePrompt() {
        bindPromotedSelectors(app.graph.rootGraph);
    },
    afterConfigureGraph() {
        const visit = (graph) => {
            for (const node of graph?._nodes || []) {
                if (isSwitch(node)) install(node)?.refresh();
            }
            for (const subgraph of graph?.subgraphs?.values() || []) visit(subgraph);
        };
        visit(app.graph);
        bindPromotedSelectors(app.graph);
    },
});
