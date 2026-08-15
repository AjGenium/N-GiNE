// ============================================================
// SHAPES.JS
// Every shape N-GINE knows how to draw lives in this file, registered
// in SHAPE_DEFS. The rendering engine (engine.js) never references a
// specific shape by name — it only ever calls the methods below through
// SHAPE_DEFS[part.type], so adding shape #14 means adding one more entry
// here, not touching engine.js at all.
// ============================================================

// Shared by every extrudable shape: the side view spawns one front-width's
// worth of gap away from the front view's edge, using that shape's own
// frontWidthMm(). Two things vary per shape:
//   - extrudeWidthKey: which extrude param sets the side view's own footprint
//     (e.g. 'depth', 'width', 'thickness') — or null if the side view's
//     footprint just mirrors the front width (a cylinder's side elevation
//     is exactly as wide as its diameter, there's no separate param for it).
//   - cornerAnchored: true for shapes whose frontPos.x is their LEFT EDGE
//     rather than their center (the brackets, since their origin is the
//     outer corner the L/U shape is built from).
function genericSideSpawn(part, def, extrudeWidthKey, cornerAnchored) {
  const frontTotalWidthMm = def.frontWidthMm(part.params);
  const frontRightEdgeMm = part.frontPos.x + (cornerAnchored ? frontTotalWidthMm : frontTotalWidthMm / 2);
  const sideHalfWidthMm = extrudeWidthKey ? part.extrudeParams[extrudeWidthKey].value / 2 : frontTotalWidthMm / 2;
  return { x: frontRightEdgeMm + frontTotalWidthMm + sideHalfWidthMm, y: part.frontPos.y };
}


// ============================================================
// SHAPE REGISTRY — every shape plugs in here. The engine (camera,
// grid, drag/snap, steppers, dimension helpers) below never
// references a specific shape by name.
// ============================================================
// Param sets per fastener variant — switching variant regenerates part.params
// from whichever of these matches, since a nut and a bolt genuinely need
// different fields, not just different numbers.
const FASTENER_VARIANT_PARAMS = {
  hex: () => ({
    headDia:    { value: 16, min: 1, max: 500, label: 'Head Width' },
    headHeight: { value: 8,  min: 1, max: 500, label: 'Head Height' },
    shaftDia:   { value: 8,  min: 1, max: 500, label: 'Shaft Diameter' },
    length:     { value: 40, min: 1, max: 500, label: 'Length' },
  }),
  carriage: () => ({
    headDia:    { value: 16, min: 1, max: 500, label: 'Head Diameter' },
    headHeight: { value: 8,  min: 1, max: 500, label: 'Head Height' },
    shaftDia:   { value: 8,  min: 1, max: 500, label: 'Shaft Diameter' },
    length:     { value: 40, min: 1, max: 500, label: 'Length' },
  }),
  hexnut: () => ({
    acrossFlats: { value: 16, min: 1, max: 500, label: 'Width Across Flats' },
    boreDia: { value: 8, min: 1, max: 500, label: 'Bore Diameter' },
    thickness: { value: 8, min: 1, max: 500, label: 'Thickness' },
  }),
  washer: () => ({
    outerDia: { value: 20, min: 1, max: 500, label: 'Outer Diameter' },
    innerDia: { value: 9, min: 1, max: 500, label: 'Inner Diameter' },
    thickness: { value: 2, min: 1, max: 500, label: 'Thickness' },
  }),
  screw: () => ({
    headDia:    { value: 8,  min: 1, max: 500, label: 'Head Diameter' },
    headHeight: { value: 3,  min: 1, max: 500, label: 'Head Height' },
    shaftDia:   { value: 4,  min: 1, max: 500, label: 'Shaft Diameter' },
    length:     { value: 25, min: 1, max: 500, label: 'Length' },
  }),
  woodscrew: () => ({
    headDia:    { value: 8,  min: 1, max: 500, label: 'Head Diameter' },
    headHeight: { value: 3,  min: 1, max: 500, label: 'Head Height' },
    shaftDia:   { value: 4,  min: 1, max: 500, label: 'Shaft Diameter' },
    length:     { value: 25, min: 1, max: 500, label: 'Length' },
  }),
};
const FASTENER_VARIANTS = [
  { id: 'hex', label: 'Hex Bolt' },
  { id: 'carriage', label: 'Carriage Bolt' },
  { id: 'hexnut', label: 'Hex Nut' },
  { id: 'washer', label: 'Washer' },
  { id: 'screw', label: 'Machine Screw' },
  { id: 'woodscrew', label: 'Wood Screw' },
];
function hexPoints(cx, cy, acrossFlatsWorld) {
  const R = acrossFlatsWorld / Math.sqrt(3);
  const pts = [];
  for (let i = 0; i < 6; i++) {
    const angle = Math.PI / 6 + i * Math.PI / 3;
    pts.push(`${cx + R * Math.cos(angle)},${cy + R * Math.sin(angle)}`);
  }
  return pts.join(' ');
}

const SHAPE_DEFS = {
  pillowBearing: {
    label: 'Pillow Bearing',
    category: 'Bearings',
    supportsExtrude: true,
    defaultParams: () => ({
      outer:  { value: 80,  min: 5,  max: 500, label: 'Outer Diameter' },
      inner:  { value: 30,  min: 5,  max: 500, label: 'Inner Hole Diameter' },
      basew:  { value: 120, min: 5,  max: 500, label: 'Base Width' },
      baseth: { value: 18,  min: 5,  max: 500,  label: 'Base Thickness' },
      ringh:  { value: 10,  min: -40,max: 500, label: 'Outer Ring Height' },
      bolt:   { value: 8,   min: 0,  max: 500,  label: 'Bolt Hole Diameter' },
      boltsp: { value: 50,  min: 5,  max: 500, label: 'Bolt Spacing' },
    }),
    defaultExtrudeParams: () => ({ depth: { value: 60, min: 5, max: 500, label: 'Depth' } }),
    frontWidthMm: (p) => Math.max(p.basew.value, p.outer.value),
    validate: (p) => {
      const problems = [];
      if (p.inner.value >= p.outer.value) problems.push('Inner hole must be smaller than outer diameter.');
      if (p.basew.value < p.outer.value) problems.push('Base width should be ≥ outer diameter.');
      if (p.bolt.value > 0 && p.boltsp.value * 2 + p.bolt.value > p.basew.value) problems.push('Bolt holes fall outside the base width.');
      if (p.ringh.value + p.outer.value < p.baseth.value) problems.push('Ring sits entirely below the top of the base — increase ring height.');
      return problems;
    },
    renderFront(part, group, selected) {
      const p = part.params, scale = WORLD_PX_PER_MM;
      const outer = p.outer.value, inner = p.inner.value, basew = p.basew.value, baseth = p.baseth.value;
      const ringGap = p.ringh.value, bolt = p.bolt.value, boltsp = p.boltsp.value;
      const rOuterMm = outer / 2;
      const ringBottom_mm = ringGap, ringTop_mm = ringGap + outer, ringCenter_mm = ringGap + rOuterMm;
      const totalHeight_mm = ringTop_mm;

      const cx = part.frontPos.x * scale, baseBottomY = part.frontPos.y * scale;
      const baseTopY = baseBottomY - baseth * scale;
      const ringBottomY = baseBottomY - ringBottom_mm * scale;
      const ringTopY = baseBottomY - ringTop_mm * scale;
      const ringCenterY = baseBottomY - ringCenter_mm * scale;

      const halfBaseW = (basew / 2) * scale, rOuter = rOuterMm * scale, rInner = (inner / 2) * scale;
      const rightExtent = Math.max(halfBaseW, rOuter);
      const oc = selected ? 'outline-selected' : 'outline';

      group.appendChild(label(cx, ringTopY - 60, 'Front Profile'));
      group.appendChild(svgEl('rect', { class: oc, x: cx - halfBaseW, y: baseTopY, width: halfBaseW * 2, height: baseth * scale, 'stroke-width': OUTLINE_W }));
      group.appendChild(svgEl('circle', { class: oc, cx, cy: ringCenterY, r: rOuter, 'stroke-width': OUTLINE_W }));
      group.appendChild(svgEl('circle', { class: oc, cx, cy: ringCenterY, r: rInner, 'stroke-width': OUTLINE_W }));
      group.appendChild(svgEl('line', { class: 'centerline', x1: cx - rOuter - 14, y1: ringCenterY, x2: cx + rOuter + 14, y2: ringCenterY, 'stroke-width': CENTERLINE_W }));
      group.appendChild(svgEl('line', { class: 'centerline', x1: cx, y1: ringTopY - 14, x2: cx, y2: Math.max(baseBottomY, ringBottomY) + 14, 'stroke-width': CENTERLINE_W }));

      let rightBoltHole = null;
      if (bolt > 0) {
        const boltR = (bolt / 2) * scale, boltOffset = boltsp * scale, boltY = baseTopY + (baseth * scale) / 2;
        [-1, 1].forEach(dir => {
          group.appendChild(svgEl('circle', { class: oc, cx: cx + dir * boltOffset, cy: boltY, r: boltR, 'stroke-width': OUTLINE_W }));
          group.appendChild(svgEl('line', { class: 'centerline', x1: cx + dir * boltOffset, y1: boltY - boltR - 6, x2: cx + dir * boltOffset, y2: boltY + boltR + 6, 'stroke-width': CENTERLINE_W }));
        });
        rightBoltHole = { x: cx + boltOffset, y: boltY, r: boltR };
      }

      dimH(cx - rOuter, cx + rOuter, ringTopY - 24, 'Ø' + fmtClean(outer), group, true);
      dimH(cx - rInner, cx + rInner, ringCenterY + rInner + 16, 'Ø' + fmtClean(inner), group, true);
      dimH(cx - halfBaseW, cx + halfBaseW, baseBottomY + 20, fmtClean(basew), group, false);
      if (bolt > 0) {
        dimH(cx - boltsp * scale, cx + boltsp * scale, baseBottomY + 38, fmtClean(boltsp * 2) + ' Spacing', group, false);
        leader(rightBoltHole.x + rightBoltHole.r * 0.7, rightBoltHole.y - rightBoltHole.r * 0.7, 34, -34, 'Ø' + fmtClean(bolt), group);
      }
      dimV(baseTopY, baseBottomY, cx - halfBaseW - 16, fmtClean(baseth), group, false);
      dimV(ringBottomY, baseBottomY, cx - halfBaseW - 48, fmtClean(ringGap), group, false);
      dimV(ringTopY, baseBottomY, cx + rightExtent + 30, fmtClean(totalHeight_mm), group, true);

      part._cache = { totalHeight_mm, ringTop_mm, ringBottom_mm, baseTopY_local: baseTopY - baseBottomY, ringTopY_local: ringTopY - baseBottomY, ringBottomY_local: ringBottomY - baseBottomY };
      return { x: cx, y: baseBottomY + 58 };
    },
    computeSideSpawnPos(part) { return genericSideSpawn(part, this, 'depth', false); },
    renderSide(part, group, selected) {
      const scale = WORLD_PX_PER_MM, p = part.params, ep = part.extrudeParams;
      const depth = ep.depth.value, outer = p.outer.value, baseth = p.baseth.value;
      const c = part._cache;
      const sCenterX = part.sidePos.x * scale, sBaselineY = part.sidePos.y * scale;
      const sBaseTopY = sBaselineY + c.baseTopY_local;
      const sRingTopY = sBaselineY + c.ringTopY_local;
      const sRingBottomY = sBaselineY + c.ringBottomY_local;
      const sRingCenterY = (sRingTopY + sRingBottomY) / 2;
      const sDepth = depth * scale;
      const oc = selected ? 'outline-selected' : 'outline';

      group.appendChild(label(sCenterX, sRingTopY - 60, 'Side Profile'));
      group.appendChild(svgEl('rect', { class: oc, x: sCenterX - sDepth / 2, y: sRingTopY, width: sDepth, height: sRingBottomY - sRingTopY, 'stroke-width': OUTLINE_W }));
      group.appendChild(svgEl('rect', { class: oc, x: sCenterX - sDepth / 2, y: sBaseTopY, width: sDepth, height: sBaselineY - sBaseTopY, 'stroke-width': OUTLINE_W }));
      group.appendChild(svgEl('line', { class: 'centerline', x1: sCenterX - sDepth / 2 - 14, y1: sRingCenterY, x2: sCenterX + sDepth / 2 + 14, y2: sRingCenterY, 'stroke-width': CENTERLINE_W }));
      group.appendChild(svgEl('line', { class: 'centerline', x1: sCenterX, y1: sRingTopY - 14, x2: sCenterX, y2: Math.max(sBaselineY, sRingBottomY) + 14, 'stroke-width': CENTERLINE_W }));

      dimH(sCenterX - sDepth / 2, sCenterX + sDepth / 2, sBaselineY + 20, fmtClean(depth), group, false);
      dimV(sBaseTopY, sBaselineY, sCenterX - sDepth / 2 - 16, fmtClean(baseth), group, false);
      dimV(sRingTopY, sRingBottomY, sCenterX - sDepth / 2 - 48, 'Ø' + fmtClean(outer), group, false);
      dimV(sRingTopY, sBaselineY, sCenterX + sDepth / 2 + 26, fmtClean(c.totalHeight_mm), group, true);

      return { x: sCenterX, y: sBaselineY + 38 };
    },
    thumbnail: '<svg viewBox="0 0 100 60"><circle cx="50" cy="24" r="17" fill="none" stroke="#000" stroke-width="2"/><circle cx="50" cy="24" r="7" fill="none" stroke="#000" stroke-width="2"/><rect x="20" y="42" width="60" height="12" fill="none" stroke="#000" stroke-width="2"/></svg>',
  },

  box: {
    label: 'Box',
    category: 'Solids',
    supportsExtrude: true,
    defaultParams: () => ({
      width:  { value: 100, min: 5, max: 500, label: 'Width' },
      height: { value: 60,  min: 5, max: 500, label: 'Height' },
    }),
    defaultExtrudeParams: () => ({ depth: { value: 60, min: 5, max: 500, label: 'Depth' } }),
    frontWidthMm: (p) => p.width.value,
    validate: () => [],
    renderFront(part, group, selected) {
      const p = part.params, scale = WORLD_PX_PER_MM;
      const width = p.width.value, height = p.height.value;
      const cx = part.frontPos.x * scale, bottomY = part.frontPos.y * scale;
      const topY = bottomY - height * scale;
      const halfW = (width / 2) * scale;
      const oc = selected ? 'outline-selected' : 'outline';

      group.appendChild(label(cx, topY - 60, 'Front Profile'));
      group.appendChild(svgEl('rect', { class: oc, x: cx - halfW, y: topY, width: halfW * 2, height: height * scale, 'stroke-width': OUTLINE_W }));
      group.appendChild(svgEl('line', { class: 'centerline', x1: cx, y1: topY - 14, x2: cx, y2: bottomY + 14, 'stroke-width': CENTERLINE_W }));

      dimH(cx - halfW, cx + halfW, bottomY + 20, fmtClean(width), group, false);
      dimV(topY, bottomY, cx + halfW + 30, fmtClean(height), group, true);

      part._cache = { totalHeight_mm: height, topY_local: topY - bottomY };
      return { x: cx, y: bottomY + 38 };
    },
    computeSideSpawnPos(part) { return genericSideSpawn(part, this, 'depth', false); },
    renderSide(part, group, selected) {
      const scale = WORLD_PX_PER_MM, ep = part.extrudeParams;
      const depth = ep.depth.value;
      const c = part._cache;
      const sCenterX = part.sidePos.x * scale, sBottomY = part.sidePos.y * scale;
      const sTopY = sBottomY + c.topY_local;
      const sDepth = depth * scale;
      const oc = selected ? 'outline-selected' : 'outline';

      group.appendChild(label(sCenterX, sTopY - 60, 'Side Profile'));
      group.appendChild(svgEl('rect', { class: oc, x: sCenterX - sDepth / 2, y: sTopY, width: sDepth, height: sBottomY - sTopY, 'stroke-width': OUTLINE_W }));
      group.appendChild(svgEl('line', { class: 'centerline', x1: sCenterX, y1: sTopY - 14, x2: sCenterX, y2: sBottomY + 14, 'stroke-width': CENTERLINE_W }));

      dimH(sCenterX - sDepth / 2, sCenterX + sDepth / 2, sBottomY + 20, fmtClean(depth), group, false);
      dimV(sTopY, sBottomY, sCenterX + sDepth / 2 + 30, fmtClean(c.totalHeight_mm), group, true);

      return { x: sCenterX, y: sBottomY + 38 };
    },
    thumbnail: '<svg viewBox="0 0 100 60"><rect x="22" y="10" width="56" height="40" fill="none" stroke="#000" stroke-width="2"/></svg>',
  },

  bearing: {
    label: 'Bearing',
    category: 'Bearings',
    supportsExtrude: true,
    defaultParams: () => ({
      outer: { value: 60, min: 5, max: 500, label: 'Outer Diameter' },
      inner: { value: 25, min: 5, max: 500, label: 'Inner Hole Diameter' },
    }),
    defaultExtrudeParams: () => ({ depth: { value: 20, min: 5, max: 500, label: 'Depth' } }),
    frontWidthMm: (p) => p.outer.value,
    validate: (p) => (p.inner.value >= p.outer.value ? ['Inner hole must be smaller than outer diameter.'] : []),
    renderFront(part, group, selected) {
      const p = part.params, scale = WORLD_PX_PER_MM;
      const outer = p.outer.value, inner = p.inner.value;
      const cx = part.frontPos.x * scale, cy = part.frontPos.y * scale;
      const rOuter = (outer / 2) * scale, rInner = (inner / 2) * scale;
      const oc = selected ? 'outline-selected' : 'outline';

      group.appendChild(label(cx, cy - rOuter - 60, 'Front Profile'));
      group.appendChild(svgEl('circle', { class: oc, cx, cy, r: rOuter, 'stroke-width': OUTLINE_W }));
      group.appendChild(svgEl('circle', { class: oc, cx, cy, r: rInner, 'stroke-width': OUTLINE_W }));
      group.appendChild(svgEl('line', { class: 'centerline', x1: cx - rOuter - 14, y1: cy, x2: cx + rOuter + 14, y2: cy, 'stroke-width': CENTERLINE_W }));
      group.appendChild(svgEl('line', { class: 'centerline', x1: cx, y1: cy - rOuter - 14, x2: cx, y2: cy + rOuter + 14, 'stroke-width': CENTERLINE_W }));

      dimH(cx - rOuter, cx + rOuter, cy - rOuter - 24, 'Ø' + fmtClean(outer), group, true);
      dimH(cx - rInner, cx + rInner, cy + rInner + 16, 'Ø' + fmtClean(inner), group, true);

      part._cache = { totalHeight_mm: outer };
      return { x: cx, y: cy + rOuter + 30 };
    },
    computeSideSpawnPos(part) { return genericSideSpawn(part, this, 'depth', false); },
    renderSide(part, group, selected) {
      const scale = WORLD_PX_PER_MM, p = part.params, ep = part.extrudeParams;
      const depth = ep.depth.value, outer = p.outer.value;
      const sCenterX = part.sidePos.x * scale, sCenterY = part.sidePos.y * scale;
      const rOuter = (outer / 2) * scale, sDepth = depth * scale;
      const oc = selected ? 'outline-selected' : 'outline';

      group.appendChild(label(sCenterX, sCenterY - rOuter - 60, 'Side Profile'));
      group.appendChild(svgEl('rect', { class: oc, x: sCenterX - sDepth / 2, y: sCenterY - rOuter, width: sDepth, height: rOuter * 2, 'stroke-width': OUTLINE_W }));
      group.appendChild(svgEl('line', { class: 'centerline', x1: sCenterX - sDepth / 2 - 14, y1: sCenterY, x2: sCenterX + sDepth / 2 + 14, y2: sCenterY, 'stroke-width': CENTERLINE_W }));

      dimH(sCenterX - sDepth / 2, sCenterX + sDepth / 2, sCenterY + rOuter + 20, fmtClean(depth), group, false);
      dimV(sCenterY - rOuter, sCenterY + rOuter, sCenterX + sDepth / 2 + 26, 'Ø' + fmtClean(outer), group, true);

      return { x: sCenterX, y: sCenterY + rOuter + 40 };
    },
    thumbnail: '<svg viewBox="0 0 100 60"><circle cx="50" cy="30" r="22" fill="none" stroke="#000" stroke-width="2"/><circle cx="50" cy="30" r="9" fill="none" stroke="#000" stroke-width="2"/></svg>',
  },

  gear: {
    label: 'Gear',
    category: 'Motion',
    supportsExtrude: true,
    defaultParams: () => ({
      outer: { value: 60, min: 5, max: 500, label: 'Outer Diameter' },
      teeth: { value: 24, min: 4, max: 500, label: 'Tooth Count' },
    }),
    defaultExtrudeParams: () => ({ depth: { value: 15, min: 5, max: 500, label: 'Depth' } }),
    frontWidthMm: (p) => p.outer.value,
    validate: () => [],
    renderFront(part, group, selected) {
      const p = part.params, scale = WORLD_PX_PER_MM;
      const outer = p.outer.value, teeth = Math.round(p.teeth.value);
      const cx = part.frontPos.x * scale, cy = part.frontPos.y * scale;
      const rOuter = (outer / 2) * scale;
      const oc = selected ? 'outline-selected' : 'outline';

      group.appendChild(label(cx, cy - rOuter - 60, 'Front Profile'));
      group.appendChild(svgEl('circle', { class: oc, cx, cy, r: rOuter, 'stroke-width': OUTLINE_W }));
      group.appendChild(svgEl('line', { class: 'centerline', x1: cx - rOuter - 14, y1: cy, x2: cx + rOuter + 14, y2: cy, 'stroke-width': CENTERLINE_W }));
      group.appendChild(svgEl('line', { class: 'centerline', x1: cx, y1: cy - rOuter - 14, x2: cx, y2: cy + rOuter + 14, 'stroke-width': CENTERLINE_W }));

      // no visual teeth by design — the count is called out as text at the center
      const teethLabel = svgEl('text', { class: 'dim-text', x: cx, y: cy - 4, 'text-anchor': 'middle' });
      teethLabel.textContent = teeth + 'T';
      group.appendChild(teethLabel);

      dimH(cx - rOuter, cx + rOuter, cy - rOuter - 24, 'Ø' + fmtClean(outer), group, true);

      part._cache = { totalHeight_mm: outer };
      return { x: cx, y: cy + rOuter + 30 };
    },
    computeSideSpawnPos(part) { return genericSideSpawn(part, this, 'depth', false); },
    renderSide(part, group, selected) {
      const scale = WORLD_PX_PER_MM, p = part.params, ep = part.extrudeParams;
      const depth = ep.depth.value, outer = p.outer.value;
      const sCenterX = part.sidePos.x * scale, sCenterY = part.sidePos.y * scale;
      const rOuter = (outer / 2) * scale, sDepth = depth * scale;
      const oc = selected ? 'outline-selected' : 'outline';

      group.appendChild(label(sCenterX, sCenterY - rOuter - 60, 'Side Profile'));
      group.appendChild(svgEl('rect', { class: oc, x: sCenterX - sDepth / 2, y: sCenterY - rOuter, width: sDepth, height: rOuter * 2, 'stroke-width': OUTLINE_W }));
      group.appendChild(svgEl('line', { class: 'centerline', x1: sCenterX - sDepth / 2 - 14, y1: sCenterY, x2: sCenterX + sDepth / 2 + 14, y2: sCenterY, 'stroke-width': CENTERLINE_W }));

      dimH(sCenterX - sDepth / 2, sCenterX + sDepth / 2, sCenterY + rOuter + 20, fmtClean(depth), group, false);
      dimV(sCenterY - rOuter, sCenterY + rOuter, sCenterX + sDepth / 2 + 26, 'Ø' + fmtClean(outer), group, true);

      return { x: sCenterX, y: sCenterY + rOuter + 40 };
    },
    thumbnail: '<svg viewBox="0 0 100 60"><circle cx="50" cy="30" r="22" fill="none" stroke="#000" stroke-width="2"/><text x="50" y="34" font-size="11" text-anchor="middle" font-family="monospace">NT</text></svg>',
  },

  hole: {
    label: 'Hole',
    category: 'Mounting',
    supportsExtrude: true,
    defaultParams: () => ({
      diameter: { value: 8, min: 1, max: 500, label: 'Diameter' },
    }),
    defaultExtrudeParams: () => ({ depth: { value: 10, min: 1, max: 500, label: 'Depth' } }),
    frontWidthMm: (p) => p.diameter.value,
    validate: () => [],
    renderFront(part, group, selected) {
      const p = part.params, scale = WORLD_PX_PER_MM;
      const dia = p.diameter.value;
      const cx = part.frontPos.x * scale, cy = part.frontPos.y * scale;
      const r = (dia / 2) * scale;
      const oc = selected ? 'outline-selected' : 'outline';

      group.appendChild(label(cx, cy - r - 60, 'Front Profile'));
      group.appendChild(svgEl('circle', { class: oc, cx, cy, r, 'stroke-width': OUTLINE_W }));
      group.appendChild(svgEl('line', { class: 'centerline', x1: cx - r - 14, y1: cy, x2: cx + r + 14, y2: cy, 'stroke-width': CENTERLINE_W }));
      group.appendChild(svgEl('line', { class: 'centerline', x1: cx, y1: cy - r - 14, x2: cx, y2: cy + r + 14, 'stroke-width': CENTERLINE_W }));

      dimH(cx - r, cx + r, cy - r - 24, 'Ø' + fmtClean(dia), group, true);

      part._cache = { totalHeight_mm: dia };
      return { x: cx, y: cy + r + 30 };
    },
    computeSideSpawnPos(part) { return genericSideSpawn(part, this, 'depth', false); },
    renderSide(part, group, selected) {
      const scale = WORLD_PX_PER_MM, p = part.params, ep = part.extrudeParams;
      const depth = ep.depth.value, dia = p.diameter.value;
      const sCenterX = part.sidePos.x * scale, sCenterY = part.sidePos.y * scale;
      const r = (dia / 2) * scale, sDepth = depth * scale;
      const oc = selected ? 'outline-selected' : 'outline';

      group.appendChild(label(sCenterX, sCenterY - r - 60, 'Side Profile'));
      group.appendChild(svgEl('rect', { class: oc, x: sCenterX - sDepth / 2, y: sCenterY - r, width: sDepth, height: r * 2, 'stroke-width': OUTLINE_W }));
      // dashed through-bore centerline — a hole is a void, not solid material
      group.appendChild(svgEl('line', { class: 'centerline', x1: sCenterX - sDepth / 2, y1: sCenterY, x2: sCenterX + sDepth / 2, y2: sCenterY, 'stroke-width': CENTERLINE_W }));

      dimH(sCenterX - sDepth / 2, sCenterX + sDepth / 2, sCenterY + r + 20, fmtClean(depth), group, false);
      dimV(sCenterY - r, sCenterY + r, sCenterX + sDepth / 2 + 26, 'Ø' + fmtClean(dia), group, true);

      return { x: sCenterX, y: sCenterY + r + 40 };
    },
    thumbnail: '<svg viewBox="0 0 100 60"><circle cx="50" cy="30" r="14" fill="none" stroke="#000" stroke-width="2"/></svg>',
  },

  cylinder: {
    label: 'Cylinder',
    category: 'Solids',
    supportsExtrude: true,
    frontLabel: 'Top Profile',
    sideLabel: 'Side Profile',
    defaultParams: () => ({
      diameter: { value: 60, min: 5, max: 500, label: 'Diameter' },
    }),
    defaultExtrudeParams: () => ({ height: { value: 80, min: 5, max: 500, label: 'Height' } }),
    frontWidthMm: (p) => p.diameter.value,
    validate: () => [],
    renderFront(part, group, selected) {
      // this IS the top-down view for a cylinder — a plain circle
      const p = part.params, scale = WORLD_PX_PER_MM;
      const dia = p.diameter.value;
      const cx = part.frontPos.x * scale, cy = part.frontPos.y * scale;
      const r = (dia / 2) * scale;
      const oc = selected ? 'outline-selected' : 'outline';

      group.appendChild(label(cx, cy - r - 60, this.frontLabel));
      group.appendChild(svgEl('circle', { class: oc, cx, cy, r, 'stroke-width': OUTLINE_W }));
      group.appendChild(svgEl('line', { class: 'centerline', x1: cx - r - 14, y1: cy, x2: cx + r + 14, y2: cy, 'stroke-width': CENTERLINE_W }));
      group.appendChild(svgEl('line', { class: 'centerline', x1: cx, y1: cy - r - 14, x2: cx, y2: cy + r + 14, 'stroke-width': CENTERLINE_W }));

      dimH(cx - r, cx + r, cy - r - 24, 'Ø' + fmtClean(dia), group, true);

      part._cache = { diameter_mm: dia };
      return { x: cx, y: cy + r + 30 };
    },
    computeSideSpawnPos(part) { return genericSideSpawn(part, this, null, false); },
    renderSide(part, group, selected) {
      // the elevation view — a plain rectangle, diameter wide, height tall
      const scale = WORLD_PX_PER_MM, p = part.params, ep = part.extrudeParams;
      const height = ep.height.value, dia = p.diameter.value;
      const sCenterX = part.sidePos.x * scale, sBottomY = part.sidePos.y * scale;
      const sTopY = sBottomY - height * scale;
      const halfW = (dia / 2) * scale;
      const oc = selected ? 'outline-selected' : 'outline';

      group.appendChild(label(sCenterX, sTopY - 60, this.sideLabel));
      group.appendChild(svgEl('rect', { class: oc, x: sCenterX - halfW, y: sTopY, width: halfW * 2, height: height * scale, 'stroke-width': OUTLINE_W }));
      group.appendChild(svgEl('line', { class: 'centerline', x1: sCenterX, y1: sTopY - 14, x2: sCenterX, y2: sBottomY + 14, 'stroke-width': CENTERLINE_W }));

      dimH(sCenterX - halfW, sCenterX + halfW, sBottomY + 20, 'Ø' + fmtClean(dia), group, false);
      dimV(sTopY, sBottomY, sCenterX + halfW + 30, fmtClean(height), group, true);

      return { x: sCenterX, y: sBottomY + 38 };
    },
    thumbnail: '<svg viewBox="0 0 100 60"><circle cx="28" cy="30" r="17" fill="none" stroke="#000" stroke-width="2"/><rect x="58" y="10" width="30" height="40" fill="none" stroke="#000" stroke-width="2"/></svg>',
  },

  wedge: {
    label: 'Wedge',
    category: 'Solids',
    supportsExtrude: true,
    defaultParams: () => ({
      depth:      { value: 80, min: 5, max: 500, label: 'Depth' },
      height:     { value: 60, min: 5, max: 500, label: 'Height' },
      backHeight: { value: 0,  min: 0, max: 500, label: 'Back Height' },
    }),
    defaultExtrudeParams: () => ({
      width: { value: 100, min: 5, max: 500, label: 'Width' },
    }),
    frontWidthMm: (p) => p.depth.value,
    validate: () => [],
    renderFront(part, group, selected) {
      // the slope IS the default view now — no extrude needed to see it
      const p = part.params, scale = WORLD_PX_PER_MM;
      const depth = p.depth.value, height = p.height.value, backHeight = p.backHeight.value;
      const bottomY = part.frontPos.y * scale, cx = part.frontPos.x * scale;
      const halfD = (depth / 2) * scale;
      const frontTopY = bottomY - height * scale;
      const backTopY = bottomY - backHeight * scale;
      const oc = selected ? 'outline-selected' : 'outline';

      group.appendChild(label(cx, Math.min(frontTopY, backTopY) - 60, 'Front Profile'));
      const pts = `${cx - halfD},${bottomY} ${cx - halfD},${frontTopY} ${cx + halfD},${backTopY} ${cx + halfD},${bottomY}`;
      group.appendChild(svgEl('polygon', { class: oc, points: pts, 'stroke-width': OUTLINE_W }));
      group.appendChild(svgEl('line', { class: 'centerline', x1: cx, y1: Math.min(frontTopY, backTopY) - 14, x2: cx, y2: bottomY + 14, 'stroke-width': CENTERLINE_W }));

      dimH(cx - halfD, cx + halfD, bottomY + 20, fmtClean(depth), group, false);
      dimV(frontTopY, bottomY, cx - halfD - 16, fmtClean(height), group, false);
      dimV(backTopY, bottomY, cx + halfD + 16, fmtClean(backHeight), group, true);

      part._cache = { height_mm: height };
      return { x: cx, y: bottomY + 40 };
    },
    computeSideSpawnPos(part) { return genericSideSpawn(part, this, 'width', false); },
    renderSide(part, group, selected) {
      // just a block — this is what Extrude reveals now
      const scale = WORLD_PX_PER_MM, ep = part.extrudeParams, c = part._cache;
      const width = ep.width.value, height = c.height_mm;
      const sCenterX = part.sidePos.x * scale, sBottomY = part.sidePos.y * scale;
      const sTopY = sBottomY - height * scale;
      const halfW = (width / 2) * scale;
      const oc = selected ? 'outline-selected' : 'outline';

      group.appendChild(label(sCenterX, sTopY - 60, 'Side Profile'));
      group.appendChild(svgEl('rect', { class: oc, x: sCenterX - halfW, y: sTopY, width: halfW * 2, height: height * scale, 'stroke-width': OUTLINE_W }));
      group.appendChild(svgEl('line', { class: 'centerline', x1: sCenterX, y1: sTopY - 14, x2: sCenterX, y2: sBottomY + 14, 'stroke-width': CENTERLINE_W }));

      dimH(sCenterX - halfW, sCenterX + halfW, sBottomY + 20, fmtClean(width), group, false);
      dimV(sTopY, sBottomY, sCenterX + halfW + 30, fmtClean(height), group, true);

      return { x: sCenterX, y: sBottomY + 38 };
    },
    thumbnail: '<svg viewBox="0 0 100 60"><polygon points="20,50 20,14 80,34 80,50" fill="none" stroke="#000" stroke-width="2"/></svg>',
  },

  triPrism: {
    label: 'Triangular Prism',
    category: 'Solids',
    supportsExtrude: true,
    defaultParams: () => ({
      width:  { value: 100, min: 5, max: 500, label: 'Base Width' },
      height: { value: 70,  min: 5, max: 500, label: 'Height' },
    }),
    defaultExtrudeParams: () => ({ depth: { value: 80, min: 5, max: 500, label: 'Depth' } }),
    frontWidthMm: (p) => p.width.value,
    validate: () => [],
    renderFront(part, group, selected) {
      const p = part.params, scale = WORLD_PX_PER_MM;
      const width = p.width.value, height = p.height.value;
      const cx = part.frontPos.x * scale, baseY = part.frontPos.y * scale;
      const halfW = (width / 2) * scale;
      const apexY = baseY - height * scale;
      const oc = selected ? 'outline-selected' : 'outline';

      group.appendChild(label(cx, apexY - 60, 'Front Profile'));
      const pts = `${cx - halfW},${baseY} ${cx + halfW},${baseY} ${cx},${apexY}`;
      group.appendChild(svgEl('polygon', { class: oc, points: pts, 'stroke-width': OUTLINE_W }));
      group.appendChild(svgEl('line', { class: 'centerline', x1: cx, y1: apexY - 14, x2: cx, y2: baseY + 14, 'stroke-width': CENTERLINE_W }));

      dimH(cx - halfW, cx + halfW, baseY + 20, fmtClean(width), group, false);
      dimV(apexY, baseY, cx + halfW + 30, fmtClean(height), group, true);

      part._cache = { height_mm: height };
      return { x: cx, y: baseY + 38 };
    },
    computeSideSpawnPos(part) { return genericSideSpawn(part, this, 'depth', false); },
    renderSide(part, group, selected) {
      // uniform extrusion of a triangle looks like a plain rectangle from the side
      const scale = WORLD_PX_PER_MM, ep = part.extrudeParams, c = part._cache;
      const depth = ep.depth.value, height = c.height_mm;
      const sCenterX = part.sidePos.x * scale, sBottomY = part.sidePos.y * scale;
      const sTopY = sBottomY - height * scale;
      const sDepth = depth * scale;
      const oc = selected ? 'outline-selected' : 'outline';

      group.appendChild(label(sCenterX, sTopY - 60, 'Side Profile'));
      group.appendChild(svgEl('rect', { class: oc, x: sCenterX - sDepth / 2, y: sTopY, width: sDepth, height: sBottomY - sTopY, 'stroke-width': OUTLINE_W }));
      group.appendChild(svgEl('line', { class: 'centerline', x1: sCenterX, y1: sTopY - 14, x2: sCenterX, y2: sBottomY + 14, 'stroke-width': CENTERLINE_W }));

      dimH(sCenterX - sDepth / 2, sCenterX + sDepth / 2, sBottomY + 20, fmtClean(depth), group, false);
      dimV(sTopY, sBottomY, sCenterX + sDepth / 2 + 30, fmtClean(height), group, true);

      return { x: sCenterX, y: sBottomY + 38 };
    },
    thumbnail: '<svg viewBox="0 0 100 60"><polygon points="20,50 80,50 50,12" fill="none" stroke="#000" stroke-width="2"/></svg>',
  },

  bolt: {
    label: 'Fastener',
    category: 'Fasteners',
    supportsExtrude: false,
    hasVariants: true,
    variants: FASTENER_VARIANTS,
    defaultVariant: 'hex',
    paramsForVariant(variant) { return FASTENER_VARIANT_PARAMS[variant](); },
    defaultParams() { return this.paramsForVariant(this.defaultVariant); },
    frontWidthMm(p) {
      if ('headDia' in p) return Math.max(p.headDia.value, p.shaftDia.value);
      if ('acrossFlats' in p) return p.acrossFlats.value;
      if ('outerDia' in p) return p.outerDia.value;
      return 20;
    },
    validate: () => [],
    renderFront(part, group, selected) {
      const variant = part.variant || this.defaultVariant;
      const p = part.params, scale = WORLD_PX_PER_MM;
      const oc = selected ? 'outline-selected' : 'outline';
      const cx = part.frontPos.x * scale;

      if (variant === 'hexnut' || variant === 'washer') {
        // face-on view — these parts are flat and thin, viewed from the face, not the side
        const cy = part.frontPos.y * scale;
        if (variant === 'washer') {
          const outer = p.outerDia.value, inner = p.innerDia.value, thickness = p.thickness.value;
          const rOuter = (outer / 2) * scale, rInner = (inner / 2) * scale;
          group.appendChild(label(cx, cy - rOuter - 60, 'Front Profile'));
          group.appendChild(svgEl('circle', { class: oc, cx, cy, r: rOuter, 'stroke-width': OUTLINE_W }));
          group.appendChild(svgEl('circle', { class: oc, cx, cy, r: rInner, 'stroke-width': OUTLINE_W }));
          group.appendChild(svgEl('line', { class: 'centerline', x1: cx - rOuter - 14, y1: cy, x2: cx + rOuter + 14, y2: cy, 'stroke-width': CENTERLINE_W }));
          dimH(cx - rOuter, cx + rOuter, cy - rOuter - 24, 'Ø' + fmtClean(outer), group, true);
          dimH(cx - rInner, cx + rInner, cy + rInner + 16, 'Ø' + fmtClean(inner), group, true);
          leader(cx + rOuter * 0.7, cy + rOuter * 0.7, 34, 34, 'Thickness ' + fmtClean(thickness), group);
          return { x: cx, y: cy + rOuter + 30 };
        } else {
          const acrossFlats = p.acrossFlats.value, bore = p.boreDia.value, thickness = p.thickness.value;
          const rHex = (acrossFlats / 2) * scale, rBore = (bore / 2) * scale;
          group.appendChild(label(cx, cy - rHex - 60, 'Front Profile'));
          group.appendChild(svgEl('polygon', { class: oc, points: hexPoints(cx, cy, acrossFlats * scale), 'stroke-width': OUTLINE_W }));
          group.appendChild(svgEl('circle', { class: oc, cx, cy, r: rBore, 'stroke-width': OUTLINE_W }));
          group.appendChild(svgEl('line', { class: 'centerline', x1: cx - rHex - 14, y1: cy, x2: cx + rHex + 14, y2: cy, 'stroke-width': CENTERLINE_W }));
          dimH(cx - rHex, cx + rHex, cy - rHex - 24, fmtClean(acrossFlats), group, true);
          dimH(cx - rBore, cx + rBore, cy + rBore + 16, 'Ø' + fmtClean(bore), group, true);
          leader(cx + rHex * 0.7, cy + rHex * 0.7, 34, 34, 'Thickness ' + fmtClean(thickness), group);
          return { x: cx, y: cy + rHex + 30 };
        }
      }

      // hex bolt / carriage bolt / screw / wood screw — elevation view, head over shaft
      const headDia = p.headDia.value, headHeightMm = p.headHeight.value, shaftDia = p.shaftDia.value, length = p.length.value;
      const bottomY = part.frontPos.y * scale;
      const shaftTopY = bottomY - length * scale;
      const halfShaft = (shaftDia / 2) * scale;
      const halfHead = (headDia / 2) * scale;
      const headHeightPx = headHeightMm * scale;

      if (variant === 'carriage') {
        const neckH = Math.max(6, shaftDia * 0.5) * scale;
        const neckTopY = shaftTopY - neckH;
        const domeTopY = neckTopY - headHeightPx;
        const domeCenterY = (neckTopY + domeTopY) / 2;
        group.appendChild(label(cx, domeTopY - 60, 'Front Profile'));
        // shaft
        group.appendChild(svgEl('rect', { class: oc, x: cx - halfShaft, y: shaftTopY, width: halfShaft * 2, height: bottomY - shaftTopY, 'stroke-width': OUTLINE_W }));
        // square neck (breaks radial symmetry — the carriage bolt's defining trait)
        group.appendChild(svgEl('rect', { class: oc, x: cx - halfShaft * 1.3, y: neckTopY, width: halfShaft * 2.6, height: neckH, 'stroke-width': OUTLINE_W }));
        // rounded dome head — width from Head Diameter, height from Head Height, independently
        group.appendChild(svgEl('ellipse', { class: oc, cx, cy: domeCenterY, rx: halfHead, ry: headHeightPx / 2, 'stroke-width': OUTLINE_W }));
        group.appendChild(svgEl('line', { class: 'centerline', x1: cx, y1: domeTopY - 14, x2: cx, y2: bottomY + 14, 'stroke-width': CENTERLINE_W }));

        dimV(shaftTopY, bottomY, cx + halfShaft + 30, fmtClean(length), group, true);
        dimH(cx - halfHead, cx + halfHead, domeTopY - 24, 'Ø' + fmtClean(headDia), group, true);
        dimH(cx - halfShaft, cx + halfShaft, bottomY + 20, 'Ø' + fmtClean(shaftDia), group, false);
        // total length — derived, read-only, shown on the left (not an editable param)
        dimV(domeTopY, bottomY, cx - halfHead - 30, fmtClean((bottomY - domeTopY) / scale), group, false);

        part._cache = { totalHeight_mm: length };
        return { x: cx, y: bottomY + 38 };
      }

      // hex / screw / woodscrew share the same head+shaft skeleton
      const headTopY = shaftTopY - headHeightPx;
      group.appendChild(label(cx, headTopY - 60, 'Front Profile'));
      group.appendChild(svgEl('rect', { class: oc, x: cx - halfHead, y: headTopY, width: halfHead * 2, height: shaftTopY - headTopY, 'stroke-width': OUTLINE_W }));

      if (variant === 'woodscrew') {
        // shaft tapers to a point — no grooves drawn, just the tip shape
        const pts = `${cx - halfShaft},${shaftTopY} ${cx + halfShaft},${shaftTopY} ${cx},${bottomY}`;
        group.appendChild(svgEl('polygon', { class: oc, points: pts, 'stroke-width': OUTLINE_W }));
      } else {
        group.appendChild(svgEl('rect', { class: oc, x: cx - halfShaft, y: shaftTopY, width: halfShaft * 2, height: bottomY - shaftTopY, 'stroke-width': OUTLINE_W }));
      }
      group.appendChild(svgEl('line', { class: 'centerline', x1: cx, y1: headTopY - 14, x2: cx, y2: bottomY + 14, 'stroke-width': CENTERLINE_W }));

      dimV(shaftTopY, bottomY, cx + halfShaft + 30, fmtClean(length), group, true);
      dimH(cx - halfHead, cx + halfHead, headTopY - 24, variant === 'hex' ? fmtClean(headDia) : 'Ø' + fmtClean(headDia), group, true);
      dimH(cx - halfShaft, cx + halfShaft, bottomY + 20, 'Ø' + fmtClean(shaftDia), group, false);
      // total length — derived, read-only, shown on the left (not an editable param)
      dimV(headTopY, bottomY, cx - halfHead - 30, fmtClean((bottomY - headTopY) / scale), group, false);

      part._cache = { totalHeight_mm: length };
      return { x: cx, y: bottomY + 38 };
    },
    thumbnail: '<svg viewBox="0 0 100 60"><rect x="30" y="8" width="40" height="12" fill="none" stroke="#000" stroke-width="2"/><rect x="42" y="20" width="16" height="32" fill="none" stroke="#000" stroke-width="2"/></svg>',
  },

  lBracket: {
    label: 'L Bracket',
    category: 'Brackets',
    supportsExtrude: true,
    defaultParams: () => ({
      legA:      { value: 80, min: 5, max: 500, label: 'Vertical Leg' },
      legB:      { value: 60, min: 5, max: 500, label: 'Horizontal Leg' },
      thickness: { value: 6,  min: 1, max: 500, label: 'Thickness' },
    }),
    defaultExtrudeParams: () => ({ depth: { value: 60, min: 5, max: 500, label: 'Depth' } }),
    frontWidthMm: (p) => p.legB.value,
    validate: (p) => (p.thickness.value >= Math.min(p.legA.value, p.legB.value) ? ['Thickness must be smaller than both legs.'] : []),
    renderFront(part, group, selected) {
      const p = part.params, scale = WORLD_PX_PER_MM;
      const legA = p.legA.value, legB = p.legB.value, th = p.thickness.value;
      const ox = part.frontPos.x * scale, oy = part.frontPos.y * scale; // bottom-left outer corner
      const oc = selected ? 'outline-selected' : 'outline';
      const X = (mm) => ox + mm * scale, Y = (mm) => oy - mm * scale;

      group.appendChild(label(ox, Y(legA) - 60, 'Front Profile'));
      const pts = `${X(0)},${Y(0)} ${X(legB)},${Y(0)} ${X(legB)},${Y(th)} ${X(th)},${Y(th)} ${X(th)},${Y(legA)} ${X(0)},${Y(legA)}`;
      group.appendChild(svgEl('polygon', { class: oc, points: pts, 'stroke-width': OUTLINE_W }));

      dimH(X(0), X(legB), Y(0) + 20, fmtClean(legB), group, false);
      dimV(Y(legA), Y(0), X(0) - 30, fmtClean(legA), group, false);
      leader(X(th) * 0.6 + X(0) * 0.4, Y(th * 0.6), 30, 24, 'Thickness ' + fmtClean(th), group);

      part._cache = { height_mm: legA };
      return { x: (X(0) + X(legB)) / 2, y: Y(0) + 40 };
    },
    computeSideSpawnPos(part) { return genericSideSpawn(part, this, 'depth', true); },
    renderSide(part, group, selected) {
      const scale = WORLD_PX_PER_MM, ep = part.extrudeParams, c = part._cache;
      const depth = ep.depth.value, height = c.height_mm;
      const sCenterX = part.sidePos.x * scale, sBottomY = part.sidePos.y * scale;
      const sTopY = sBottomY - height * scale;
      const sDepth = depth * scale;
      const oc = selected ? 'outline-selected' : 'outline';

      group.appendChild(label(sCenterX, sTopY - 60, 'Side Profile'));
      group.appendChild(svgEl('rect', { class: oc, x: sCenterX - sDepth / 2, y: sTopY, width: sDepth, height: sBottomY - sTopY, 'stroke-width': OUTLINE_W }));
      group.appendChild(svgEl('line', { class: 'centerline', x1: sCenterX, y1: sTopY - 14, x2: sCenterX, y2: sBottomY + 14, 'stroke-width': CENTERLINE_W }));

      dimH(sCenterX - sDepth / 2, sCenterX + sDepth / 2, sBottomY + 20, fmtClean(depth), group, false);
      dimV(sTopY, sBottomY, sCenterX + sDepth / 2 + 30, fmtClean(height), group, true);

      return { x: sCenterX, y: sBottomY + 38 };
    },
    thumbnail: '<svg viewBox="0 0 100 60"><polygon points="30,10 42,10 42,38 78,38 78,50 30,50" fill="none" stroke="#000" stroke-width="2"/></svg>',
  },

  uBracket: {
    label: 'U Bracket',
    category: 'Brackets',
    supportsExtrude: true,
    defaultParams: () => ({
      width:     { value: 80, min: 5, max: 500, label: 'Width' },
      height:    { value: 60, min: 5, max: 500, label: 'Height' },
      thickness: { value: 6,  min: 1, max: 500, label: 'Wall Thickness' },
    }),
    defaultExtrudeParams: () => ({ depth: { value: 60, min: 5, max: 500, label: 'Depth' } }),
    frontWidthMm: (p) => p.width.value,
    validate: (p) => (p.thickness.value * 2 >= p.width.value ? ['Wall thickness is too large for this width.'] : []),
    renderFront(part, group, selected) {
      const p = part.params, scale = WORLD_PX_PER_MM;
      const width = p.width.value, height = p.height.value, th = p.thickness.value;
      const ox = part.frontPos.x * scale, oy = part.frontPos.y * scale; // bottom-left outer corner
      const oc = selected ? 'outline-selected' : 'outline';
      const X = (mm) => ox + mm * scale, Y = (mm) => oy - mm * scale;

      group.appendChild(label(ox + (width / 2) * scale, Y(height) - 60, 'Front Profile'));
      const pts = `${X(0)},${Y(0)} ${X(width)},${Y(0)} ${X(width)},${Y(height)} ${X(width - th)},${Y(height)} ${X(width - th)},${Y(th)} ${X(th)},${Y(th)} ${X(th)},${Y(height)} ${X(0)},${Y(height)}`;
      group.appendChild(svgEl('polygon', { class: oc, points: pts, 'stroke-width': OUTLINE_W }));

      dimH(X(0), X(width), Y(0) + 20, fmtClean(width), group, false);
      dimV(Y(height), Y(0), X(0) - 30, fmtClean(height), group, false);
      leader(X(th) * 0.6 + X(0) * 0.4, Y(th * 0.6), 30, 24, 'Thickness ' + fmtClean(th), group);

      part._cache = { height_mm: height };
      return { x: X(width / 2), y: Y(0) + 40 };
    },
    computeSideSpawnPos(part) { return genericSideSpawn(part, this, 'depth', false); },
    renderSide(part, group, selected) {
      const scale = WORLD_PX_PER_MM, ep = part.extrudeParams, c = part._cache;
      const depth = ep.depth.value, height = c.height_mm;
      const sCenterX = part.sidePos.x * scale, sBottomY = part.sidePos.y * scale;
      const sTopY = sBottomY - height * scale;
      const sDepth = depth * scale;
      const oc = selected ? 'outline-selected' : 'outline';

      group.appendChild(label(sCenterX, sTopY - 60, 'Side Profile'));
      group.appendChild(svgEl('rect', { class: oc, x: sCenterX - sDepth / 2, y: sTopY, width: sDepth, height: sBottomY - sTopY, 'stroke-width': OUTLINE_W }));
      group.appendChild(svgEl('line', { class: 'centerline', x1: sCenterX, y1: sTopY - 14, x2: sCenterX, y2: sBottomY + 14, 'stroke-width': CENTERLINE_W }));

      dimH(sCenterX - sDepth / 2, sCenterX + sDepth / 2, sBottomY + 20, fmtClean(depth), group, false);
      dimV(sTopY, sBottomY, sCenterX + sDepth / 2 + 30, fmtClean(height), group, true);

      return { x: sCenterX, y: sBottomY + 38 };
    },
    thumbnail: '<svg viewBox="0 0 100 60"><polygon points="26,10 38,10 38,40 62,40 62,10 74,10 74,50 26,50" fill="none" stroke="#000" stroke-width="2"/></svg>',
  },

  flatBracket: {
    label: 'Flat Bracket',
    category: 'Brackets',
    supportsExtrude: true,
    defaultParams: () => ({
      width:  { value: 80, min: 5, max: 500, label: 'Width' },
      length: { value: 40, min: 5, max: 500, label: 'Length' },
    }),
    defaultExtrudeParams: () => ({ thickness: { value: 5, min: 1, max: 500, label: 'Thickness' } }),
    frontWidthMm: (p) => p.width.value,
    validate: () => [],
    renderFront(part, group, selected) {
      const p = part.params, scale = WORLD_PX_PER_MM;
      const width = p.width.value, length = p.length.value;
      const cx = part.frontPos.x * scale, bottomY = part.frontPos.y * scale;
      const topY = bottomY - length * scale;
      const halfW = (width / 2) * scale;
      const oc = selected ? 'outline-selected' : 'outline';

      group.appendChild(label(cx, topY - 60, 'Front Profile'));
      group.appendChild(svgEl('rect', { class: oc, x: cx - halfW, y: topY, width: halfW * 2, height: length * scale, 'stroke-width': OUTLINE_W }));
      group.appendChild(svgEl('line', { class: 'centerline', x1: cx, y1: topY - 14, x2: cx, y2: bottomY + 14, 'stroke-width': CENTERLINE_W }));

      dimH(cx - halfW, cx + halfW, bottomY + 20, fmtClean(width), group, false);
      dimV(topY, bottomY, cx + halfW + 30, fmtClean(length), group, true);

      part._cache = { length_mm: length };
      return { x: cx, y: bottomY + 38 };
    },
    computeSideSpawnPos(part) { return genericSideSpawn(part, this, 'thickness', false); },
    renderSide(part, group, selected) {
      const scale = WORLD_PX_PER_MM, ep = part.extrudeParams, c = part._cache;
      const thickness = ep.thickness.value, length = c.length_mm;
      const sCenterX = part.sidePos.x * scale, sBottomY = part.sidePos.y * scale;
      const sTopY = sBottomY - length * scale;
      const halfT = (thickness / 2) * scale;
      const oc = selected ? 'outline-selected' : 'outline';

      group.appendChild(label(sCenterX, sTopY - 60, 'Side Profile'));
      group.appendChild(svgEl('rect', { class: oc, x: sCenterX - halfT, y: sTopY, width: halfT * 2, height: sBottomY - sTopY, 'stroke-width': OUTLINE_W }));
      group.appendChild(svgEl('line', { class: 'centerline', x1: sCenterX, y1: sTopY - 14, x2: sCenterX, y2: sBottomY + 14, 'stroke-width': CENTERLINE_W }));

      dimH(sCenterX - halfT, sCenterX + halfT, sBottomY + 20, fmtClean(thickness), group, false);
      dimV(sTopY, sBottomY, sCenterX + halfT + 30, fmtClean(length), group, true);

      return { x: sCenterX, y: sBottomY + 38 };
    },
    thumbnail: '<svg viewBox="0 0 100 60"><rect x="34" y="8" width="32" height="44" fill="none" stroke="#000" stroke-width="2"/></svg>',
  },
};
