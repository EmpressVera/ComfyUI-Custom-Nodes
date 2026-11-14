import { app } from "../../scripts/app.js";

const TYPE = "ViewportTargeter";
const PROPERTY = "viewportTargetId";
const watchedGraphs = new WeakSet();
const pendingGraphs = new WeakSet();

function refreshGraph(graph) {
    for (const node of graph.nodes) if (node.type === TYPE) node.refreshDestinations();
}

function scheduleGraph(graph) {
    if (!graph || pendingGraphs.has(graph)) return;
    pendingGraphs.add(graph);
    queueMicrotask(() => { pendingGraphs.delete(graph); refreshGraph(graph); });
}

function watchGraph(graph) {
    if (watchedGraphs.has(graph)) return;
    watchedGraphs.add(graph);
    for (const event of ["node:added", "node:removed"]) {
        graph.events.addEventListener(event, ({ detail }) => {
            if (detail.node.type === TYPE) scheduleGraph(graph);
        });
    }
    graph.events.addEventListener("node:property:changed", ({ detail }) => {
        if (detail.property === "title" && graph.getNodeById(detail.nodeId)?.type === TYPE) scheduleGraph(graph);
    });
}

app.registerExtension({
    name: "ViewportTargeter.Navigation",
    registerCustomNodes() {
        class ViewportTargeter extends LGraphNode {
            static title = "Viewport Targeter";

            constructor(title = ViewportTargeter.title) {
                super(title);
                this.isVirtualNode = true;
                this.serialize_widgets = false;
                this.properties[PROPERTY] = "";
                this._entries = [];
                this._destination = this.addWidget("combo", "destination", "", (value) => {
                    this.properties[PROPERTY] = String(value);
                    this.graph?.change();
                }, {
                    values: [""], socketless: true, serialize: false,
                    getOptionLabel: (key) => this._entries.find((entry) => entry.key === key)?.label || "",
                });
                this._target = this.addWidget("button", "Target", null, (_value, _canvas, owner) => {
                    if (owner) this.goToTarget();
                }, { socketless: true, serialize: false, iconClass: "pi pi-crosshairs", title: "Center on the selected targeter without changing zoom" });
                this._destination.hidden = this._target.hidden = true;
                // Only new nodes get a default size. Configure restores the workflow's size.
                this.size = [280, 88];
            }

            onAdded(graph) {
                watchGraph(graph);
                scheduleGraph(graph);
            }

            onConfigure() {
                scheduleGraph(this.graph);
            }

            refreshDestinations() {
                if (!this.graph) return;
                const targets = this.graph.nodes.filter((node) => node.type === TYPE && node !== this);
                const names = targets.map((node) => String(node.title || ViewportTargeter.title));
                const counts = new Map();
                for (const name of names) counts.set(name, (counts.get(name) || 0) + 1);
                const used = new Set();
                const entries = targets.map((node, index) => {
                    const key = String(node.id);
                    let label = counts.get(names[index]) > 1 ? names[index] + " [#" + key + "]" : names[index];
                    while (used.has(label)) label += " [#" + key + "]";
                    used.add(label);
                    return { key, label };
                }).sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: "base" }));
                const changed = entries.length !== this._entries.length || entries.some((entry, index) => entry.key !== this._entries[index].key || entry.label !== this._entries[index].label);
                this._entries = entries;
                if (changed) this._destination.options.values = entries.length ? entries.map((entry) => entry.key) : [""];
                const selected = entries.find((entry) => entry.key === this.properties[PROPERTY]) || entries[0];
                this.properties[PROPERTY] = selected?.key || "";
                this._destination.value = this.properties[PROPERTY];
                const hidden = entries.length === 0;
                this._destination.hidden = this._target.hidden = hidden;
                this.setDirtyCanvas(true, true);
            }

            goToTarget() {
                this.refreshDestinations();
                if (app.canvas.graph !== this.graph) return;
                const target = this.graph.nodes.find((node) => node.type === TYPE && node !== this && String(node.id) === this._destination.value);
                if (target) app.canvas.centerOnNode(target);
            }
        }

        LiteGraph.registerNodeType(TYPE, ViewportTargeter);
        ViewportTargeter.category = "Viewport Targeting";
    },
    afterConfigureGraph() {
        const root = app.rootGraph;
        for (const graph of new Set([root, ...root.subgraphs.values()])) refreshGraph(graph);
    },
});
