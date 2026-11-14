// Continue pruning is adapted from Pixaroma's MIT-licensed Pause Image helper.
export function isLink(value) {
    return Array.isArray(value) && value.length === 2
        && (typeof value[0] === "string" || typeof value[0] === "number")
        && typeof value[1] === "number";
}

function consumers(output) {
    const result = new Map();
    for (const [id, entry] of Object.entries(output)) {
        for (const value of Object.values(entry.inputs || {})) {
            if (!isLink(value)) continue;
            const origin = String(value[0]);
            if (!result.has(origin)) result.set(origin, new Set());
            result.get(origin).add(id);
        }
    }
    return result;
}

function downstream(edges, starts) {
    const found = new Set();
    const pending = [...starts];
    while (pending.length) {
        for (const id of edges.get(String(pending.pop())) || []) {
            if (!found.has(id)) { found.add(id); pending.push(id); }
        }
    }
    return found;
}

function addAncestors(output, keep) {
    const pending = [...keep];
    while (pending.length) {
        for (const value of Object.values(output[pending.pop()]?.inputs || {})) {
            if (!isLink(value)) continue;
            const id = String(value[0]);
            if (output[id] && !keep.has(id)) { keep.add(id); pending.push(id); }
        }
    }
}

export function prepareContinue(output, id, isOutput) {
    const entry = output[id];
    const source = entry.inputs.audio;
    delete entry.inputs.audio;
    if (!isLink(source)) return;
    const branch = downstream(consumers(output), [id]);
    for (const target of branch) {
        for (const [name, value] of Object.entries(output[target].inputs || {})) {
            if (isLink(value) && String(value[0]) === String(source[0]) && value[1] === source[1]) {
                output[target].inputs[name] = [String(id), 0];
            }
        }
    }
    const keep = new Set([String(id), ...branch]);
    addAncestors(output, keep);
    const upstream = new Set([String(source[0])]);
    addAncestors(output, upstream);
    const pullsUpstream = new Set([...upstream, ...downstream(consumers(output), upstream)]);
    for (const target of pullsUpstream) {
        if (!keep.has(target) && output[target] && isOutput(output[target].class_type)) delete output[target];
    }
}
