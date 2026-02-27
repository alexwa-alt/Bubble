(() => {
  'use strict';

  const state = {
    canvas: document.getElementById('bubbleCanvas'),
    ctx: null,
    tooltip: document.getElementById('tooltip'),
    csvInput: document.getElementById('csvInput'),
    addBubbleBtn: document.getElementById('addBubbleBtn'),
    resetLayoutBtn: document.getElementById('resetLayoutBtn'),
    clearMergesBtn: document.getElementById('clearMergesBtn'),
    exportBtn: document.getElementById('exportBtn'),
    showFullToggle: document.getElementById('showFullContentToggle'),
    colorPalette: document.getElementById('colorPalette'),
    renameZoneEl: document.getElementById('renameZone'),
    binZoneEl: document.getElementById('binZone'),
    binList: document.getElementById('binList'),
    width: 0,
    height: 0,
    dpr: window.devicePixelRatio || 1,
    leaves: [],
    topLevel: [],
    dragging: null,
    hovered: null,
    mergeTarget: null,
    selectedBubbleId: null,
    showFullMergedContent: false,
    dirty: true,
    animating: false,
    idCounter: 0,
    binned: []
  };

  const BASE_RADIUS = 30;
  const RADIUS_SCALE = 11;
  const MAX_TEXT_CHARS = 95;
  const MERGE_THRESHOLD = 0.7;

  function uid() { state.idCounter += 1; return `b-${state.idCounter}`; }
  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
  function computeRadius(count) { return BASE_RADIUS + Math.sqrt(Math.max(1, count)) * RADIUS_SCALE; }

  function createBubble(text) {
    const bubble = {
      id: uid(),
      x: 0,
      y: 0,
      radius: computeRadius(1),
      items: [text],
      children: [],
      parent: null,
      targetRadius: computeRadius(1),
      renderRadius: computeRadius(1),
      scale: 1,
      color: '#3b82f6'
    };
    state.leaves.push(bubble);
    return bubble;
  }

  function parseCsv(text) {
    const rows = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (!rows.length) return [];
    const dataRows = ['item', 'items', 'text', 'statement', 'curriculum statement', 'value', 'name'].includes(rows[0].toLowerCase()) ? rows.slice(1) : rows;
    const seen = new Set();
    const out = [];
    for (let row of dataRows) {
      if (row.startsWith('"') && row.endsWith('"')) row = row.slice(1, -1).trim();
      const key = row.toLowerCase();
      if (!row || seen.has(key)) continue;
      seen.add(key);
      out.push(row);
    }
    return out;
  }

  function initializeBubbles(items) {
    const newBubbles = items.map(createBubble);
    state.topLevel.push(...newBubbles);
    placeWithoutOverlap(state.topLevel);
    requestDraw();
  }

  function placeWithoutOverlap(bubbles) {
    const pad = 8;
    for (let i = 0; i < bubbles.length; i += 1) {
      const b = bubbles[i];
      let placed = false;
      for (let attempts = 0; attempts < 500 && !placed; attempts += 1) {
        b.x = clamp(Math.random() * state.width, b.radius + pad, state.width - b.radius - pad);
        b.y = clamp(Math.random() * state.height, b.radius + pad + 50, state.height - b.radius - pad - 50);
        placed = true;
        for (let j = 0; j < i; j += 1) {
          const o = bubbles[j];
          const dx = b.x - o.x;
          const dy = b.y - o.y;
          const minD = b.radius + o.radius + 4;
          if (dx * dx + dy * dy < minD * minD) { placed = false; break; }
        }
      }
    }
  }

  function resetLayout() { placeWithoutOverlap(state.topLevel); requestDraw(); }

  function clearAllMerges() {
    state.topLevel = [...state.leaves.filter((b) => !state.binned.some((x) => x.id === b.id))];
    for (const leaf of state.topLevel) {
      leaf.parent = null;
      leaf.children = [];
      leaf.items = [leaf.items[0]];
      leaf.radius = computeRadius(1);
      leaf.targetRadius = leaf.radius;
      leaf.renderRadius = leaf.radius;
    }
    placeWithoutOverlap(state.topLevel);
    requestDraw();
  }

  function hitTest(x, y) {
    for (let i = state.topLevel.length - 1; i >= 0; i -= 1) {
      const b = state.topLevel[i];
      const rr = b.renderRadius || b.radius;
      const dx = x - b.x;
      const dy = y - b.y;
      if (dx * dx + dy * dy <= rr * rr) return b;
    }
    return null;
  }

  function bringToFront(bubble) {
    const idx = state.topLevel.findIndex((b) => b.id === bubble.id);
    if (idx >= 0) state.topLevel.push(...state.topLevel.splice(idx, 1));
  }

  function isDescendant(candidate, ancestor) {
    let node = candidate;
    while (node) {
      if (node.id === ancestor.id) return true;
      node = node.parent;
    }
    return false;
  }

  function mergeBubbles(a, b) {
    if (!a || !b || a.id === b.id) return;
    if (isDescendant(a, b) || isDescendant(b, a)) return;

    const parent = {
      id: uid(),
      x: (a.x + b.x) / 2,
      y: (a.y + b.y) / 2,
      radius: computeRadius(1),
      items: [...new Set([...a.items, ...b.items])],
      children: [a, b],
      parent: null,
      targetRadius: computeRadius(1),
      renderRadius: computeRadius(1),
      scale: 0.8,
      color: a.color
    };
    a.parent = parent;
    b.parent = parent;
    parent.targetRadius = computeRadius(parent.items.length);
    parent.radius = parent.targetRadius;

    state.topLevel = state.topLevel.filter((n) => n.id !== a.id && n.id !== b.id);
    state.topLevel.push(parent);
    state.selectedBubbleId = parent.id;
    requestDraw();
  }

  function splitBubble(bubble) {
    if (!bubble.children.length) return;
    const idx = state.topLevel.findIndex((b) => b.id === bubble.id);
    if (idx < 0) return;
    state.topLevel.splice(idx, 1);
    const spread = Math.max(24, bubble.radius * 0.45);
    bubble.children.forEach((child, i) => {
      child.parent = null;
      const angle = (Math.PI * 2 * i) / bubble.children.length;
      child.x = clamp(bubble.x + Math.cos(angle) * spread, child.radius + 8, state.width - child.radius - 8);
      child.y = clamp(bubble.y + Math.sin(angle) * spread, child.radius + 8, state.height - child.radius - 8);
      child.scale = 0.9;
      state.topLevel.push(child);
    });
    bubble.children = [];
    requestDraw();
  }

  function wrapAndTrimText(text, maxWidth, maxLines) {
    const lines = [];
    const paragraphs = `${text}`.split(/\n/g);
    for (const p of paragraphs) {
      const words = p.split(/\s+/).filter(Boolean);
      if (!words.length) continue;
      let line = words[0];
      for (let i = 1; i < words.length; i += 1) {
        const test = `${line} ${words[i]}`;
        if (state.ctx.measureText(test).width <= maxWidth) line = test;
        else { lines.push(line); line = words[i]; if (lines.length >= maxLines) return truncateLines(lines, maxLines); }
      }
      lines.push(line);
      if (lines.length >= maxLines) return truncateLines(lines, maxLines);
    }
    return truncateLines(lines, maxLines);
  }

  function truncateLines(lines, maxLines) {
    if (lines.length <= maxLines) return lines.map((line) => line.slice(0, MAX_TEXT_CHARS));
    const trimmed = lines.slice(0, maxLines);
    trimmed[maxLines - 1] = `${trimmed[maxLines - 1].slice(0, MAX_TEXT_CHARS - 1)}…`;
    return trimmed;
  }

  function textLinesForBubble(bubble) {
    if (!bubble.children.length) return wrapAndTrimText(bubble.items[0], Math.max(30, bubble.renderRadius * 1.6), 4);
    if (state.showFullMergedContent) return wrapAndTrimText(bubble.items.join(' • '), Math.max(30, bubble.renderRadius * 1.65), 5);
    const preview = bubble.items.slice(0, 2);
    const more = bubble.items.length - preview.length;
    return wrapAndTrimText([...preview, more > 0 ? `+${more} more` : ''].filter(Boolean).join('\n'), Math.max(30, bubble.renderRadius * 1.6), 5);
  }

  function drawBubble(bubble) {
    const ctx = state.ctx;
    const isHovered = state.hovered && state.hovered.id === bubble.id;
    const isMergeTarget = state.mergeTarget && state.mergeTarget.id === bubble.id;
    const isSelected = state.selectedBubbleId === bubble.id;
    const r = bubble.renderRadius;

    ctx.save();
    ctx.translate(bubble.x, bubble.y);
    ctx.scale(bubble.scale || 1, bubble.scale || 1);
    ctx.shadowColor = 'rgba(15, 23, 42, 0.18)';
    ctx.shadowBlur = 18;
    ctx.shadowOffsetY = 5;

    const baseColor = bubble.color || '#3b82f6';
    const grad = ctx.createRadialGradient(-r * 0.35, -r * 0.45, r * 0.15, 0, 0, r);
    grad.addColorStop(0, shade(baseColor, 28));
    grad.addColorStop(1, shade(baseColor, -16));

    ctx.beginPath();
    ctx.fillStyle = grad;
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();

    ctx.shadowColor = 'transparent';
    ctx.lineWidth = isMergeTarget ? 4 : isSelected ? 3.5 : isHovered ? 3 : 1.5;
    ctx.strokeStyle = isMergeTarget ? '#22c55e' : isSelected ? '#fef08a' : isHovered ? '#f8fafc' : 'rgba(255,255,255,0.7)';
    ctx.stroke();

    ctx.fillStyle = '#f8fafc';
    ctx.font = `600 ${Math.max(10, Math.min(14, r * 0.21))}px Inter, Segoe UI, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const lines = textLinesForBubble(bubble);
    const lineHeight = Math.max(12, r * 0.28);
    const startY = -((lines.length - 1) * lineHeight) / 2;
    lines.forEach((line, i) => ctx.fillText(line, 0, startY + i * lineHeight, r * 1.75));
    ctx.restore();
  }

  function shade(hex, percent) {
    const num = parseInt(hex.slice(1), 16);
    const amt = Math.round(2.55 * percent);
    const r = clamp((num >> 16) + amt, 0, 255);
    const g = clamp(((num >> 8) & 0x00ff) + amt, 0, 255);
    const b = clamp((num & 0x0000ff) + amt, 0, 255);
    return `#${(0x1000000 + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
  }

  function requestDraw() {
    state.dirty = true;
    if (!requestDraw._queued) {
      requestDraw._queued = true;
      requestAnimationFrame(() => { requestDraw._queued = false; draw(); });
    }
  }

  function draw() {
    if (!state.dirty && !state.animating) return;
    state.dirty = false;
    state.ctx.clearRect(0, 0, state.width, state.height);
    let still = false;
    for (const bubble of state.topLevel) {
      bubble.targetRadius = bubble.targetRadius || bubble.radius;
      bubble.renderRadius += (bubble.targetRadius - bubble.renderRadius) * 0.18;
      bubble.scale += (1 - bubble.scale) * 0.18;
      if (Math.abs(bubble.targetRadius - bubble.renderRadius) > 0.2 || Math.abs(1 - bubble.scale) > 0.01) still = true;
      drawBubble(bubble);
    }
    state.animating = still;
    if (still) requestDraw();
  }

  function zoneHit(clientX, clientY, zoneEl) {
    const rect = zoneEl.getBoundingClientRect();
    return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
  }

  function onPointerDown(event) {
    const rect = state.canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const bubble = hitTest(x, y);
    if (!bubble) return;
    bringToFront(bubble);
    state.selectedBubbleId = bubble.id;
    state.dragging = { bubble, offsetX: x - bubble.x, offsetY: y - bubble.y };
    state.canvas.setPointerCapture(event.pointerId);
    requestDraw();
  }

  function findMergeCandidate(active) {
    let best = null;
    let bestDist = Infinity;
    for (const candidate of state.topLevel) {
      if (candidate.id === active.id) continue;
      if (isDescendant(candidate, active) || isDescendant(active, candidate)) continue;
      const dist = Math.hypot(active.x - candidate.x, active.y - candidate.y);
      const threshold = (active.radius + candidate.radius) * MERGE_THRESHOLD;
      if (dist < threshold && dist < bestDist) { best = candidate; bestDist = dist; }
    }
    return best;
  }

  function onPointerMove(event) {
    const rect = state.canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    if (state.dragging) {
      const b = state.dragging.bubble;
      b.x = clamp(x - state.dragging.offsetX, b.radius + 6, state.width - b.radius - 6);
      b.y = clamp(y - state.dragging.offsetY, b.radius + 6, state.height - b.radius - 6);
      state.mergeTarget = findMergeCandidate(b);
      const renameActive = zoneHit(event.clientX, event.clientY, state.renameZoneEl);
      const binActive = zoneHit(event.clientX, event.clientY, state.binZoneEl);
      state.renameZoneEl.classList.toggle('active', renameActive);
      state.binZoneEl.classList.toggle('active', binActive);
      hideTooltip();
      requestDraw();
      return;
    }

    const hovered = hitTest(x, y);
    if (hovered !== state.hovered) {
      state.hovered = hovered;
      state.canvas.style.cursor = hovered ? 'grab' : 'default';
      requestDraw();
    }
    if (hovered) showTooltip(hovered, event.clientX, event.clientY);
    else hideTooltip();
  }

  function onPointerUp(event) {
    if (!state.dragging) return;
    const bubble = state.dragging.bubble;
    state.dragging = null;
    state.canvas.releasePointerCapture(event.pointerId);

    const inRename = zoneHit(event.clientX, event.clientY, state.renameZoneEl);
    const inBin = zoneHit(event.clientX, event.clientY, state.binZoneEl);

    state.renameZoneEl.classList.remove('active');
    state.binZoneEl.classList.remove('active');

    if (inRename) {
      const nextName = window.prompt('Rename bubble text', bubble.items[0] || '');
      if (nextName && nextName.trim()) {
        if (!bubble.children.length) {
          bubble.items = [nextName.trim()];
        } else {
          bubble.items[0] = nextName.trim();
        }
      }
    } else if (inBin) {
      binBubble(bubble);
    } else if (state.mergeTarget) {
      mergeBubbles(bubble, state.mergeTarget);
    }

    state.mergeTarget = null;
    requestDraw();
  }

  function binBubble(bubble) {
    state.topLevel = state.topLevel.filter((b) => b.id !== bubble.id);
    bubble.parent = null;
    state.binned.push(bubble);
    state.selectedBubbleId = null;
    renderBin();
  }

  function restoreBubble(id) {
    const idx = state.binned.findIndex((b) => b.id === id);
    if (idx < 0) return;
    const [bubble] = state.binned.splice(idx, 1);
    bubble.x = clamp(state.width * 0.5 + (Math.random() * 90 - 45), bubble.radius + 8, state.width - bubble.radius - 8);
    bubble.y = clamp(state.height * 0.5 + (Math.random() * 90 - 45), bubble.radius + 8, state.height - bubble.radius - 8);
    bubble.parent = null;
    state.topLevel.push(bubble);
    renderBin();
    requestDraw();
  }

  function renderBin() {
    state.binList.innerHTML = '';
    for (const bubble of state.binned) {
      const li = document.createElement('li');
      li.className = 'bin-item';
      const label = bubble.items[0] ? bubble.items[0].slice(0, 48) : `${bubble.items.length} merged items`;
      li.textContent = bubble.children.length ? `${label} (${bubble.items.length} items)` : label;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = 'Restore';
      btn.addEventListener('click', () => restoreBubble(bubble.id));
      li.appendChild(btn);
      state.binList.appendChild(li);
    }
  }

  function onDoubleClick(event) {
    const rect = state.canvas.getBoundingClientRect();
    const bubble = hitTest(event.clientX - rect.left, event.clientY - rect.top);
    if (bubble && bubble.children.length) splitBubble(bubble);
  }

  function showTooltip(bubble, clientX, clientY) {
    state.tooltip.textContent = `• ${bubble.items.join('\n• ')}`;
    state.tooltip.style.display = 'block';
    state.tooltip.style.left = `${clientX}px`;
    state.tooltip.style.top = `${clientY}px`;
  }

  function hideTooltip() { state.tooltip.style.display = 'none'; }

  function exportStructure() {
    const toSerializable = (bubble) => ({
      id: bubble.id,
      x: Number(bubble.x.toFixed(2)),
      y: Number(bubble.y.toFixed(2)),
      radius: Number(bubble.radius.toFixed(2)),
      items: [...bubble.items],
      children: bubble.children.map(toSerializable),
      parent: bubble.parent ? bubble.parent.id : null,
      color: bubble.color
    });
    const output = state.topLevel.map(toSerializable);
    const blob = new Blob([JSON.stringify(output, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'bubble-structure.json';
    a.click();
    URL.revokeObjectURL(url);
  }

  function resizeCanvas() {
    const rect = state.canvas.parentElement.getBoundingClientRect();
    state.width = Math.max(320, rect.width);
    state.height = Math.max(240, rect.height);
    state.dpr = window.devicePixelRatio || 1;
    state.canvas.width = Math.floor(state.width * state.dpr);
    state.canvas.height = Math.floor(state.height * state.dpr);
    state.canvas.style.width = `${state.width}px`;
    state.canvas.style.height = `${state.height}px`;
    state.ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
    requestDraw();
  }

  function bindEvents() {
    state.csvInput.addEventListener('change', (event) => {
      const [file] = event.target.files || [];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => initializeBubbles(parseCsv(`${reader.result || ''}`));
      reader.readAsText(file);
      event.target.value = '';
    });

    state.addBubbleBtn.addEventListener('click', () => {
      const text = window.prompt('Bubble text');
      if (!text || !text.trim()) return;
      const bubble = createBubble(text.trim());
      bubble.x = clamp(state.width * 0.5 + (Math.random() * 100 - 50), bubble.radius + 8, state.width - bubble.radius - 8);
      bubble.y = clamp(state.height * 0.5 + (Math.random() * 100 - 50), bubble.radius + 8, state.height - bubble.radius - 8);
      state.topLevel.push(bubble);
      state.selectedBubbleId = bubble.id;
      requestDraw();
    });

    state.colorPalette.addEventListener('click', (event) => {
      const btn = event.target.closest('.swatch');
      if (!btn || !state.selectedBubbleId) return;
      const bubble = state.topLevel.find((b) => b.id === state.selectedBubbleId);
      if (!bubble) return;
      bubble.color = btn.dataset.color;
      requestDraw();
    });

    state.resetLayoutBtn.addEventListener('click', resetLayout);
    state.clearMergesBtn.addEventListener('click', clearAllMerges);
    state.exportBtn.addEventListener('click', exportStructure);
    state.showFullToggle.addEventListener('change', (event) => { state.showFullMergedContent = event.target.checked; requestDraw(); });

    state.canvas.addEventListener('pointerdown', onPointerDown);
    state.canvas.addEventListener('pointermove', onPointerMove);
    state.canvas.addEventListener('pointerup', onPointerUp);
    state.canvas.addEventListener('pointercancel', onPointerUp);
    state.canvas.addEventListener('dblclick', onDoubleClick);
    state.canvas.addEventListener('mouseleave', () => { state.hovered = null; hideTooltip(); requestDraw(); });
    window.addEventListener('resize', resizeCanvas);
  }

  function init() {
    state.ctx = state.canvas.getContext('2d');
    bindEvents();
    resizeCanvas();
    renderBin();
  }

  init();
})();
