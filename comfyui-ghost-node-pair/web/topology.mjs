export const SENDER = "GhostNodeSender";
export const RECEIVER = "GhostNodeReceiver";
export const CONTROLLER = "GhostNodeController";
export const SHOW = "show_wire";
export const HIDE = "hide_all";

export function kind(node) { return node?.comfyClass || node?.type; }

export function frames(root) {
    const result = [];
    function visit(graph, parent, host, path, seen) {
        if (seen.has(graph)) return;
        const frame = { graph, parent, host, path };
        result.push(frame);
        const next = new Set([...seen, graph]);
        for (const node of graph.nodes) {
            if (node.isSubgraphNode?.()) visit(node.subgraph, frame, node, [...path, node.id], next);
        }
    }
    visit(root, null, null, [], new Set());
    return result;
}

function inner(frame, host) {
    return { graph: host.subgraph, parent: frame, host, path: [...frame.path, host.id] };
}

function enter(seen, frame, link, direction) {
    const key = frame.path.join(":") + "/" + frame.graph.id + "/" + link.id + "/" + direction;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
}

export function origin(frame, link, seen = new Set()) {
    if (!link || !enter(seen, frame, link, "in")) return;
    if (link.originIsIoNode) {
        if (!frame.parent) return;
        return origin(frame.parent, frame.parent.graph.getLink(frame.host.inputs[link.origin_slot]?.link), seen);
    }
    return outlet(frame, frame.graph.getNodeById(link.origin_id), link.origin_slot, seen);
}

export function outlet(frame, node, slot, seen = new Set()) {
    if (!node) return;
    if (node.isSubgraphNode?.()) {
        const id = node.subgraph.outputNode.slots[slot]?.linkIds[0];
        return origin(inner(frame, node), node.subgraph.getLink(id), seen);
    }
    return { node, slot, frame };
}

export function destinations(frame, link, seen = new Set()) {
    if (!link || !enter(seen, frame, link, "out")) return [];
    if (link.targetIsIoNode) {
        if (!frame.parent) return [];
        return (frame.host.outputs[link.target_slot]?.links || []).flatMap((id) =>
            destinations(frame.parent, frame.parent.graph.getLink(id), new Set(seen)));
    }
    return inlet(frame, frame.graph.getNodeById(link.target_id), link.target_slot, seen);
}

export function inlet(frame, node, slot, seen = new Set()) {
    if (!node) return [];
    if (node.isSubgraphNode?.()) {
        return (node.subgraph.inputNode.slots[slot]?.linkIds || []).flatMap((id) =>
            destinations(inner(frame, node), node.subgraph.getLink(id), new Set(seen)));
    }
    return [{ node, slot, frame }];
}

export function sourceTitle(frame, link, seen = new Set()) {
    if (!link || !enter(seen, frame, link, "label-in")) return;
    if (link.originIsIoNode) {
        if (!frame.parent) return;
        return sourceTitle(frame.parent, frame.parent.graph.getLink(frame.host.inputs[link.origin_slot]?.link), seen);
    }
    return frame.graph.getNodeById(link.origin_id)?.title;
}

export function destinationTitle(frame, link, seen = new Set()) {
    if (!link || !enter(seen, frame, link, "label-out")) return;
    if (link.targetIsIoNode) {
        if (!frame.parent) return;
        const id = frame.host.outputs[link.target_slot]?.links?.[0];
        return destinationTitle(frame.parent, frame.parent.graph.getLink(id), seen);
    }
    return frame.graph.getNodeById(link.target_id)?.title;
}

export function promotedControl(host, slot, path = [], seen = new Set()) {
    if (seen.has(host.subgraph)) return;
    const next = new Set([...seen, host.subgraph]);
    for (const id of host.subgraph.inputNode.slots[slot]?.linkIds || []) {
        const link = host.subgraph.getLink(id);
        const node = host.subgraph.getNodeById(link?.target_id);
        const input = node?.inputs[link.target_slot];
        if (!node || !input) continue;
        const childPath = [...path, node.id];
        if (node.isSubgraphNode?.()) {
            const control = promotedControl(node, link.target_slot, childPath, next);
            if (control) return control;
        } else if ((kind(node) === SENDER && input.widget?.name === SHOW)
            || (kind(node) === CONTROLLER && input.widget?.name === HIDE)) {
            return { node, name: input.widget.name, path: childPath };
        }
    }
}

export function senderVisible(source) {
    const { node } = source;
    let value = node.properties[SHOW] !== false;
    let child = source.frame;
    let path = [node.id];
    // The outermost promoted value owns visibility for that particular instance.
    while (child.parent) {
        const host = child.host;
        for (let slot = 0; slot < host.inputs.length; slot++) {
            const control = promotedControl(host, slot);
            if (control?.name === SHOW && control.path.join(":") === path.join(":")) {
                const widget = host.getWidgetFromSlot(host.inputs[slot]);
                if (widget) value = widget.value !== false;
            }
        }
        path = [host.id, ...path];
        child = child.parent;
    }
    return value;
}

export function canConnect(frame, from, outputSlot, to, inputSlot) {
    const source = outlet(frame, from, outputSlot);
    const targets = inlet(frame, to, inputSlot);
    const ghostOutput = from.outputs[outputSlot]?.type === "GHOST";
    const ghostInput = to.inputs[inputSlot]?.type === "GHOST";
    const sender = kind(source?.node) === SENDER && source.slot === 0;
    const receivers = targets.filter((target) => kind(target.node) === RECEIVER && target.slot === 0);
    if (!sender && !receivers.length && !ghostOutput && !ghostInput) return true;
    if (source && !sender) return false;
    if (targets.some((target) => kind(target.node) !== RECEIVER || target.slot !== 0)) return false;
    return (sender || ghostOutput) && (receivers.length > 0 || ghostInput);
}
