/* Layered DAG layout (Sugiyama-lite): longest-path layering, then barycentre
 * ordering to cut crossings.  Generative flow runs top -> bottom, matching the
 * figures in Hohna et al. 2014. */

const LAYER_GAP = 136;
const NODE_GAP = 130;
const MARGIN = 70;

export function layout(allNodes, allEdges, opts = {}) {
  const layerGap = opts.layerGap || LAYER_GAP;
  const nodeGap = opts.nodeGap || NODE_GAP;
  const widthOf = opts.widthOf || (() => 60);

  // Hyperparameter squares are not laid out on the grid; they are parked just
  // above the variable they constrain, as in Fig. 2 and Fig. 7 of the paper.
  const byIdAll = new Map(allNodes.map(n => [n.id, n]));
  const satellites = allNodes.filter(
    n => n.isHyper && byIdAll.has(n.hyperTarget) && !byIdAll.get(n.hyperTarget).isHyper);
  const satIds = new Set(satellites.map(n => n.id));

  const nodes = allNodes.filter(n => !satIds.has(n.id));
  const edges = allEdges.filter(e => !satIds.has(e.source) && !satIds.has(e.target));

  const byId = new Map(nodes.map(n => [n.id, n]));
  const live = edges.filter(e => byId.has(e.source) && byId.has(e.target));

  const parents = new Map(nodes.map(n => [n.id, []]));
  const children = new Map(nodes.map(n => [n.id, []]));
  for (const e of live) {
    children.get(e.source).push(e.target);
    parents.get(e.target).push(e.source);
  }

  // ---- longest-path layering, tolerant of cycles
  const depth = new Map();
  const state = new Map(); // 0 unvisited, 1 in-progress, 2 done
  function visit(id) {
    if (state.get(id) === 2) return depth.get(id);
    if (state.get(id) === 1) return 0; // cycle guard
    state.set(id, 1);
    let d = 0;
    for (const p of parents.get(id)) d = Math.max(d, visit(p) + 1);
    state.set(id, 2);
    depth.set(id, d);
    return d;
  }
  for (const n of nodes) visit(n.id);

  // Pull sinks down so likelihood/data terms sit at the bottom.
  const maxDepth = Math.max(0, ...depth.values());
  for (const n of nodes) {
    if (n.type === 'clamped' && children.get(n.id).length === 0) depth.set(n.id, maxDepth);
  }

  // ---- group into layers
  const layers = [];
  for (const n of nodes) {
    const d = depth.get(n.id);
    (layers[d] || (layers[d] = [])).push(n);
  }
  for (let i = 0; i < layers.length; i++) if (!layers[i]) layers[i] = [];

  // ---- initial order: keep module members adjacent
  const modOrder = new Map(
    ['tree', 'rateMatrix', 'siteRates', 'branchRates', 'phyloCTMC', 'data', 'other']
      .map((m, i) => [m, i]));
  for (const layer of layers) {
    layer.sort((a, b) =>
      (modOrder.get(a.module) ?? 9) - (modOrder.get(b.module) ?? 9) ||
      a.id.localeCompare(b.id));
  }

  // ---- barycentre sweeps
  const pos = new Map();
  const reindex = () => layers.forEach(l => l.forEach((n, i) => pos.set(n.id, i)));
  reindex();

  const bary = (id, rel) => {
    const xs = rel.get(id).map(o => pos.get(o)).filter(v => v !== undefined);
    return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : pos.get(id);
  };

  for (let sweep = 0; sweep < 6; sweep++) {
    const down = sweep % 2 === 0;
    const order = down ? layers : [...layers].reverse();
    for (const layer of order) {
      const rel = down ? parents : children;
      const keys = new Map(layer.map(n => [n.id, bary(n.id, rel)]));
      // Keep each module's nodes contiguous, and order the modules themselves
      // by their mean barycentre.  Without this the sweeps interleave modules
      // and their outlines end up overlapping.
      const groups = [...groupBy(layer, n => n.module)].map(([m, ns]) => ({
        m, ns: ns.sort((a, b) => keys.get(a.id) - keys.get(b.id) || a.id.localeCompare(b.id)),
        k: ns.reduce((s, n) => s + keys.get(n.id), 0) / ns.length,
      }));
      groups.sort((a, b) => a.k - b.k ||
        (modOrder.get(a.m) ?? 9) - (modOrder.get(b.m) ?? 9));
      layer.length = 0;
      for (const g of groups) layer.push(...g.ns);
      reindex();
    }
  }

  // ---- assign coordinates, spacing by actual node width
  const layerSpan = layer => layer.reduce(
    (acc, n, i) => acc + widthOf(n) + (i ? nodeGap - 60 : 0), 0);

  const width = MARGIN * 2 + Math.max(120, ...layers.map(layerSpan));

  layers.forEach((layer, d) => {
    let x = (width - layerSpan(layer)) / 2;
    layer.forEach((n, i) => {
      const w = widthOf(n);
      if (i) x += nodeGap - 60;
      n.x = x + w / 2;
      n.y = MARGIN + d * layerGap;
      n.layer = d;
      x += w;
    });
  });

  // Evicting a stranger from a plate can drop it on a neighbour, so settle
  // the row afterwards and re-check.
  const gridNodes = nodes;
  const plates = opts.plates || [];
  compactPlates(gridNodes, plates);
  for (let i = 0; i < 2; i++) {
    separate(gridNodes, widthOf, 26, false);
    evictFromPlates(gridNodes, plates, widthOf);
  }
  separate(gridNodes, widthOf, 26, false);
  packPlates(gridNodes, plates, widthOf);

  // ---- park hyperparameters just above the variable they constrain
  const sats = new Map();
  for (const s of satellites) {
    if (!sats.has(s.hyperTarget)) sats.set(s.hyperTarget, []);
    sats.get(s.hyperTarget).push(s);
  }
  for (const [targetId, list] of sats) {
    const t = byId.get(targetId);
    if (!t) continue;
    const gap = 8;
    const total = list.reduce((a, s) => a + widthOf(s), 0) + gap * (list.length - 1);
    let x = t.x - total / 2;
    for (const s of list) {
      const w = widthOf(s);
      s.x = x + w / 2;
      s.y = t.y - layerGap * 0.44;
      s.layer = t.layer - 0.44;
      x += w + gap;
    }
  }
  separate(satellites, widthOf, 10);

  const ys = allNodes.map(n => n.y);
  const top = Math.min(...ys), bottom = Math.max(...ys);

  return {
    width,
    height: bottom - Math.min(top, MARGIN) + MARGIN * 2,
    offsetY: Math.min(0, top - MARGIN),
    layers: layers.length,
  };
}

/** Stack a plate's members into one column so the box drawn around them is
 *  tight, instead of a wide band that sweeps up unrelated nodes. */
function compactPlates(nodes, plates) {
  for (const plate of plates) {
    const members = plate.members
      .map(id => nodes.find(n => n.id === id)).filter(Boolean);
    if (members.length < 2) continue;
    const cx = members.reduce((s, n) => s + n.x, 0) / members.length;
    for (const n of members) n.x = cx;
  }
}

/** A plate is drawn as the box enclosing its members, so a stranger sitting
 *  inside that box would read as replicated when it is not.  Slide any such
 *  node out the nearer side. */
function evictFromPlates(nodes, plates, widthOf) {
  const PAD = 30;
  for (const plate of plates) {
    const members = plate.members
      .map(id => nodes.find(n => n.id === id)).filter(Boolean);
    if (members.length < 2) continue;
    const box = {
      x0: Math.min(...members.map(n => n.x - widthOf(n) / 2)) - PAD,
      x1: Math.max(...members.map(n => n.x + widthOf(n) / 2)) + PAD,
      y0: Math.min(...members.map(n => n.y)) - 40 - PAD,
      y1: Math.max(...members.map(n => n.y)) + 40 + PAD,
    };
    const own = new Set(plate.members);
    for (const n of nodes) {
      if (own.has(n.id)) continue;
      const hw = widthOf(n) / 2;
      if (n.y < box.y0 || n.y > box.y1) continue;
      if (n.x + hw < box.x0 || n.x - hw > box.x1) continue;
      const left = box.x0 - (n.x + hw);
      const right = box.x1 - (n.x - hw);
      n.x += Math.abs(left) <= Math.abs(right) ? left - 12 : right + 12;
    }
  }
}

/** Pack the plates' member columns apart so wide plates do not overlap, and
 *  keep the diagram centred rather than drifting right.  Called after the
 *  settle loop, so the plate boxes are final:
 *
 *  1.  For each plate with >= 2 resolvable members, compute the box
 *      [min(x - w/2) - PAD, max(x + w/2) + PAD] (PAD 30, like
 *      evictFromPlates).
 *  2.  If plate A's member set is a subset of plate B's, skip A — it sits
 *      inside B's box and must not be shifted by the sweep.
 *  3.  Sort the remaining plates by box.x0; sweep left -> right keeping a
 *      cursor: if a plate's x0 < cursor + GAP (GAP 40), shift all its
 *      members right by the deficit; set cursor = the plate's new x1.
 *  4.  Recentre the union span around the pre-shift diagram centre, so the
 *      diagram does not drift right.
 *
 *  Only member positions change — the plates' id/kind/label/members, which
 *  the digest hashes, are untouched. */
function packPlates(nodes, plates, widthOf) {
  const PAD = 30;
  const GAP = 40;
  const boxes = [];
  for (const plate of plates) {
    const members = plate.members.map(id => nodes.find(n => n.id === id)).filter(Boolean);
    if (members.length < 2) continue;
    boxes.push({ plate, members,
                 x0: Math.min(...members.map(n => n.x - widthOf(n) / 2)) - PAD,
                 x1: Math.max(...members.map(n => n.x + widthOf(n) / 2)) + PAD });
  }
  if (boxes.length < 2) return;

  // Containment: a plate whose members are a subset of another's sits
  // inside the other's box and is not shifted by the sweep.
  const skip = new Set();
  for (let i = 0; i < boxes.length; i++)
    for (let j = 0; j < boxes.length; j++)
      if (i !== j && boxes[i].members.every(m => boxes[j].members.includes(m)))
        skip.add(boxes[i].plate);

  const ordered = [...boxes].sort((a, b) => a.x0 - b.x0);
  let cursor = -Infinity;
  for (const box of ordered) {
    if (skip.has(box.plate)) continue;
    if (box.x0 < cursor + GAP) {
      const shift = cursor + GAP - box.x0;
      for (const m of box.members) m.x += shift;
      cursor = box.x1 + shift;
    } else {
      cursor = box.x1;
    }
  }

  // Recentre the union span around the pre-shift diagram centre, so the
  // diagram does not drift right.  Spread the growth to both sides.
  const span = s => [Math.min(...s.map(n => n.x - widthOf(n) / 2)),
                     Math.max(...s.map(n => n.x + widthOf(n) / 2))];
  const [min0, max0] = span(nodes);
  const [min1, max1] = span(nodes);
  const grew = (max1 - min1) - (max0 - min0);
  if (grew) for (const n of nodes) n.x -= grew / 2;
}

function groupBy(arr, key) {
  const m = new Map();
  for (const v of arr) {
    const k = key(v);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(v);
  }
  return m;
}

/** Push same-row boxes apart until they no longer overlap. */
function separate(items, widthOf, gap, recentre = true) {
  for (const row of groupBy(items, n => Math.round(n.y)).values()) {
    if (row.length < 2) continue;
    row.sort((a, b) => a.x - b.x);
    const before = row.map(n => n.x);
    for (let i = 1; i < row.length; i++) {
      const prev = row[i - 1], cur = row[i];
      const need = widthOf(prev) / 2 + widthOf(cur) / 2 + gap;
      if (cur.x - prev.x < need) cur.x = prev.x + need;
    }
    if (!recentre) continue;
    // spread the growth to both sides rather than only rightwards
    const grew = (row[row.length - 1].x - row[0].x) - (before[before.length - 1] - before[0]);
    for (const n of row) n.x -= grew / 2;
  }
}

/** Collapse a set of nodes into one meta-node per module, aggregating edges. */
export function collapseModules(nodes, edges, collapsed) {
  if (!collapsed.size) return { nodes, edges };

  const byId = new Map(nodes.map(n => [n.id, n]));
  const repOf = id => {
    const n = byId.get(id);
    return n && collapsed.has(n.module) ? `module:${n.module}` : id;
  };

  const out = [];
  const made = new Set();
  for (const n of nodes) {
    if (!collapsed.has(n.module)) { out.push(n); continue; }
    const mid = `module:${n.module}`;
    if (made.has(mid)) continue;
    made.add(mid);
    const members = nodes.filter(m => m.module === n.module);
    out.push({
      id: mid,
      type: 'module',
      module: n.module,
      label: n.module,
      memberCount: members.length,
      members: members.map(m => m.id),
      role: `${members.length} nodes: ` + members.slice(0, 6).map(m => m.label).join(', ') +
            (members.length > 6 ? ', …' : ''),
      priors: [], operators: [], machinery: false,
    });
  }

  const seen = new Set();
  const outEdges = [];
  for (const e of edges) {
    const s = repOf(e.source), t = repOf(e.target);
    if (s === t) continue;
    const k = `${s} ${t}`;
    if (seen.has(k)) continue;
    seen.add(k);
    outEdges.push({ source: s, target: t, kind: e.kind });
  }

  return { nodes: out, edges: outEdges };
}
