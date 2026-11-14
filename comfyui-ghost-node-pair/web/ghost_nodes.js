import { app } from "../../scripts/app.js";
import { SENDER, RECEIVER, CONTROLLER, SHOW, HIDE, kind, frames, origin, sourceTitle, destinationTitle, inlet, promotedControl, senderVisible, canConnect } from "./topology.mjs";

const STATE = "ghostWiresHidden";
const watched = new WeakSet();
const retainedWidgets = new WeakMap();
const boundWidgets = new WeakSet();
const boundaryPrototypes = new WeakSet();
let pending = false;
let graphFrames = [];
let viewFrame;
let wireState = new Map();

function invalidate() {
    wireState.clear();
    app.canvas?.setDirty(true, true);
    if (pending) return;
    pending = true;
    queueMicrotask(() => { pending = false; refresh(); });
}

function setGlobal(hidden) {
    const root = app.rootGraph;
    root.extra[STATE] = !!hidden;
    for (const frame of frames(root)) {
        for (const node of frame.graph.nodes) {
            if (kind(node) === CONTROLLER) {
                node.properties[HIDE] = !!hidden;
                node.widgets.find((widget) => widget.name === HIDE).value = !!hidden;
            }
            if (node.isSubgraphNode?.()) {
                node.inputs.forEach((input, slot) => {
                    if (promotedControl(node, slot)?.name === HIDE) {
                        const widget = node.getWidgetFromSlot(input);
                        if (widget) widget.value = !!hidden;
                    }
                });
            }
        }
    }
    root.change();
    invalidate();
}

function frameFor(graph) {
    if (viewFrame?.graph === graph) return viewFrame;
    return graphFrames.find((frame) => frame.graph === graph)
        || { graph, parent: null, host: null, path: [] };
}

function stateOf(canvas, link) {
    const graph = canvas.graph;
    const key = graph.id + ":" + link.id;
    if (wireState.has(key)) return wireState.get(key);
    const source = origin(frameFor(graph), link);
    const sender = kind(source?.node) === SENDER && source.slot === 0;
    const ghost = sender || link.type === "GHOST";
    const state = ghost ? { hidden: !!app.rootGraph.extra[STATE] || (sender && !senderVisible(source)) } : null;
    wireState.set(key, state);
    return state;
}

function bindHost(host) {
    host.inputs.forEach((input, slot) => {
        if (!input.widgetId) return;
        const control = promotedControl(host, slot);
        if (!control) return;
        const widget = host.getWidgetFromSlot(input);
        if (!widget) return;
        retainedWidgets.set(input, widget);
        if (boundWidgets.has(widget)) return;
        boundWidgets.add(widget);
        const callback = widget.callback;
        widget.callback = function (value, ...args) {
            const result = callback?.call(this, value, ...args);
            const current = promotedControl(host, host.inputs.indexOf(input));
            if (current?.name === HIDE) setGlobal(!!value);
            else invalidate();
            return result;
        };
    });
}

function status(node, text) {
    if (node._ghostStatus?.textContent !== text && node._ghostStatus) node._ghostStatus.textContent = text;
}

function patchBoundary(graph) {
    const proto = graph.inputNode?.slots[0] && Object.getPrototypeOf(graph.inputNode.slots[0]);
    if (!proto || boundaryPrototypes.has(proto)) return;
    boundaryPrototypes.add(proto);
    const connect = proto.connect;
    proto.connect = function (slot, node, ...args) {
        if (this.type === "GHOST") {
            const targets = inlet(frameFor(node.graph), node, node.inputs.indexOf(slot));
            if (targets.some((target) => kind(target.node) !== RECEIVER || target.slot !== 0)) return;
        }
        const result = connect.call(this, slot, node, ...args);
        invalidate();
        return result;
    };
}

function watch(graph) {
    if (watched.has(graph)) return;
    watched.add(graph);
    for (const event of ["node:added", "node:removed", "node:property:changed", "subgraph-created", "widget-promoted", "widget-demoted"]) {
        graph.events.addEventListener(event, invalidate);
    }
}

function refresh() {
    if (!app.rootGraph) return;
    graphFrames = frames(app.rootGraph);
    const refreshed = new Set();
    for (const frame of graphFrames) {
        watch(frame.graph);
        patchBoundary(frame.graph);
        for (const node of frame.graph.nodes) {
            if (refreshed.has(node)) continue;
            refreshed.add(node);
            const context = frameFor(frame.graph);
            if (node.isSubgraphNode?.()) bindHost(node);
            if (kind(node) === SENDER) {
                node.inputs[0].label = sourceTitle(context, frame.graph.getLink(node.inputs[0]?.link)) || "input";
            } else if (kind(node) === RECEIVER) {
                node.outputs[0].label = destinationTitle(context, frame.graph.getLink(node.outputs[0]?.links?.[0])) || "output";
                const source = origin(context, frame.graph.getLink(node.inputs[0]?.link));
                status(node, kind(source?.node) === SENDER ? "" : "No Sender connected");
            } else if (kind(node) === CONTROLLER) {
                node.properties[HIDE] = !!app.rootGraph.extra[STATE];
                node.widgets.find((widget) => widget.name === HIDE).value = !!app.rootGraph.extra[STATE];
            }
        }
    }
    wireState.clear();
    app.canvas?.setDirty(true, true);
}

function control(node, name, value, label, options, callback) {
    const widget = node.addWidget("toggle", name, value, callback, { ...options, socketless: true, serialize: false });
    widget.label = label;
    // Native subgraph promotion discovers widgets through their UI input metadata.
    const input = node.addInput(name, "BOOLEAN", { widget: { name }, label });
    input.widget = { name };
    return widget;
}

function spawnReceiver(sender) {
    if (!sender._ghostPair || !sender.graph) return;
    sender._ghostPair = false;
    const receiver = LiteGraph.createNode(RECEIVER);
    receiver.pos = [sender.pos[0] + sender.size[0] + 160, sender.pos[1]];
    sender.graph.add(receiver);
    sender.connect(0, receiver, 0);
    sender.graph.change();
}

function installSender(node, pair) {
    node.properties[SHOW] ??= true;
    node._ghostPair = pair;
    const widget = control(node, SHOW, node.properties[SHOW], "Ghost Wire", { on: "Visible", off: "Hidden" }, (value) => {
        node.properties[SHOW] = !!value;
        node.graph?.change();
        invalidate();
    });
    const added = node.onAdded;
    node.onAdded = function (graph) {
        const result = added?.call(this, graph);
        if (this._ghostPair) {
            this.type = this.comfyClass = SENDER;
            if (this.title === "Ghost Node Pair") this.title = "Ghost Node Sender";
            queueMicrotask(() => {
                if (!this._ghostPair || !this.graph) return;
                const canvas = app.canvas;
                if (canvas?.state.ghostNodeId === this.id) {
                    const placed = (event) => {
                        if (event.detail.active || String(event.detail.nodeId) !== String(this.id)) return;
                        canvas.canvas.removeEventListener("litegraph:ghost-placement", placed);
                        queueMicrotask(() => spawnReceiver(this));
                    };
                    canvas.canvas.addEventListener("litegraph:ghost-placement", placed);
                } else spawnReceiver(this);
            });
        }
        invalidate();
        return result;
    };
    const configure = node.onConfigure;
    node.onConfigure = function (...args) {
        this._ghostPair = false;
        const result = configure?.apply(this, args);
        widget.value = this.properties[SHOW] !== false;
        invalidate();
        return result;
    };
    node.onConnectOutput = (slot, _type, _input, target, targetSlot) => slot !== 0 || String(target.id) === "-20"
        || canConnect(frameFor(node.graph), node, slot, target, targetSlot);
    node.onConnectInput = (slot, _type, _output, source) => slot === 0
        || (node.inputs[slot]?.widget?.name === SHOW && String(source.id) === "-10");
    node.onConnectionsChange = invalidate;
    node.size = [260, 104];
}

function installReceiver(node) {
    const root = document.createElement("div");
    root.className = "ghost-node-status";
    root.setAttribute("role", "status");
    root.textContent = "No Sender connected";
    node._ghostStatus = root;
    node.addDOMWidget("ghost_status", "ghost_status", root, { serialize: false, getMinHeight: () => 24, getMaxHeight: () => 24 });
    node.onConnectInput = (slot, _type, _output, source, sourceSlot) => slot === 0 && (String(source.id) === "-10"
        || canConnect(frameFor(node.graph), source, sourceSlot, node, slot));
    node.onConnectionsChange = invalidate;
    const configure = node.onConfigure;
    node.onConfigure = function (...args) { const result = configure?.apply(this, args); invalidate(); return result; };
    node.size = [260, 90];
}

app.registerExtension({
    name: "GhostNodes.Pair",
    registerCustomNodes() {
        class GhostNodeController extends LGraphNode {
            static title = "Ghost Node Controller";
            constructor() {
                super(GhostNodeController.title);
                this.isVirtualNode = true;
                this.properties[HIDE] = false;
                control(this, HIDE, false, "Ghost Wires", { on: "Hide", off: "Show" }, setGlobal);
                this.size = [260, 78];
            }
            onAdded() { invalidate(); }
            onConfigure() { invalidate(); }
            onConnectInput(_slot, _type, _output, source) { return String(source.id) === "-10"; }
        }
        LiteGraph.registerNodeType(CONTROLLER, GhostNodeController);
        GhostNodeController.category = "Ghost Nodes";
    },
    nodeCreated(node) {
        if ([SENDER, "GhostNodePair"].includes(kind(node))) installSender(node, kind(node) === "GhostNodePair");
        else if (kind(node) === RECEIVER) installReceiver(node);
    },
    afterConfigureGraph() { viewFrame = null; refresh(); },
    setup() {
        const style = document.createElement("style");
        style.textContent = ":root{--color-datatype-GHOST:#7f7}.ghost-node-status{box-sizing:border-box;width:100%;padding:4px 8px;color:#aaa;font:12px sans-serif;letter-spacing:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}";
        document.head.append(style);
        const prototype = LGraphCanvas.prototype;
        const render = prototype._renderAllLinkSegments;
        prototype._renderAllLinkSegments = function (ctx, link, ...args) {
            const state = stateOf(this, link);
            if (state?.hidden) return;
            const alpha = ctx.globalAlpha;
            if (state) ctx.globalAlpha *= 0.5;
            try { return render.call(this, ctx, link, ...args); }
            finally { ctx.globalAlpha = alpha; }
        };
        const draw = prototype.drawConnections;
        prototype.drawConnections = function (...args) {
            // Only cache for one draw; promotion values and restored workflows remain live.
            wireState.clear();
            const result = draw.apply(this, args);
            if (this.over_link_center && !this.renderedPaths.has(this.over_link_center)) this.over_link_center = undefined;
            for (const item of this.selectedItems) {
                if (!item.linkIds || this._visibleReroutes.has(item)) continue;
                const links = [...item.linkIds].map((id) => this.graph.getLink(id)).filter(Boolean);
                if (links.length && links.every((link) => stateOf(this, link)?.hidden)) this.deselect(item);
            }
            return result;
        };
        const connect = LGraphNode.prototype.connectSlots;
        LGraphNode.prototype.connectSlots = function (output, target, input, ...args) {
            if (!canConnect(frameFor(this.graph), this, this.outputs.indexOf(output), target, target.inputs.indexOf(input))) return null;
            const result = connect.call(this, output, target, input, ...args);
            invalidate();
            return result;
        };
        app.canvas.canvas.addEventListener("subgraph-opened", (event) => {
            const host = event.detail.fromNode;
            const parent = frameFor(host.graph);
            viewFrame = { graph: host.subgraph, parent, host, path: [...parent.path, host.id] };
            invalidate();
        });
        const graphToPrompt = app.graphToPrompt;
        app.graphToPrompt = async function (...args) {
            const prompt = await graphToPrompt.apply(this, args);
            for (const entry of Object.values(prompt.output)) {
                if ([SENDER, "GhostNodePair"].includes(entry.class_type)) delete entry.inputs[SHOW];
            }
            for (const frame of frames(app.rootGraph)) for (const node of frame.graph.nodes) {
                if (kind(node) !== RECEIVER) continue;
                const entry = prompt.output[[...frame.path, node.id].join(":")];
                if (entry && !origin(frame, frame.graph.getLink(node.inputs[0]?.link))) delete entry.inputs.ghost;
            }
            return prompt;
        };
        refresh();
    },
});
