export const CLASS = "RecallPausedMedia";

export function isLink(value) {
    return Array.isArray(value) && value.length === 2 && ["string", "number"].includes(typeof value[0]) && typeof value[1] === "number";
}

export function scopeRecall(output, selected, isOutput) {
    const consumers = new Map();
    for (const [id, entry] of Object.entries(output)) {
        for (const value of Object.values(entry.inputs || {})) {
            if (!isLink(value)) continue;
            const source = String(value[0]);
            if (!consumers.has(source)) consumers.set(source, []);
            consumers.get(source).push(id);
        }
    }
    const downstream = new Set();
    const pending = [...selected];
    while (pending.length) {
        const id = pending.pop();
        if (downstream.has(id) || !output[id]) continue;
        downstream.add(id);
        pending.push(...(consumers.get(id) || []));
    }
    const targets = [...downstream].filter((id) => selected.includes(id) || isOutput(output[id].class_type));
    const keep = new Set();
    pending.push(...targets);
    while (pending.length) {
        const id = pending.pop();
        if (keep.has(id) || !output[id]) continue;
        keep.add(id);
        for (const value of Object.values(output[id].inputs || {})) if (isLink(value)) pending.push(String(value[0]));
    }
    for (const id of Object.keys(output)) if (!keep.has(id)) delete output[id];
    return targets;
}
