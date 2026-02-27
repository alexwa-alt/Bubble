(() => {
  'use strict';

  const state = {
    canvas: document.getElementById('bubbleCanvas'),
    ctx: null,
    tooltip: document.getElementById('tooltip'),
    csvInput: document.getElementById('csvInput'),
    addBubbleInput: document.getElementById('addBubbleInput'),
    addBubbleBtn: document.getElementById('addBubbleBtn'),
    resetLayoutBtn: document.getElementById('resetLayoutBtn'),
    clearMergesBtn: document.getElementById('clearMergesBtn'),
    exportBtn: document.getElementById('exportBtn'),
    showFullToggle: document.getElementById('showFullContentToggle'),
    colorPalette: document.getElementById('colorPalette'),
    renameZoneEl: document.getElementById('renameZone'),
    binZoneEl: document.getElementById('binZone'),
    binList: document.getElementById('binList'),
    renameEditor: document.getElementById('renameEditor'),
    renameInput: document.getElementById('renameInput'),
    renameSaveBtn: document.getElementById('renameSaveBtn'),
    renameCancelBtn: document.getElementById('renameCancelBtn'),
    width: 0,
    height: 0,
    dpr: window.devicePixelRatio || 1,
    leaves: [],
    topLevel: [],
    binned: [],
    dragging: null,
    hovered: null,
    mergeTarget: null,
    selectedBubbleId: null,
    renamingBubbleId: null,
    showFullMergedContent: false,
    dirty: true,
    animating: false,
    idCounter: 0
  };

  const BASE_RADIUS = 30;
  const RADIUS_SCALE = 11;
  const MERGE_THRESHOLD = 0.7;
  const MAX_TEXT_CHARS = 95;

  const uid = () => `b-${++state.idCounter}`;
  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
  const computeRadius = (count) => BASE_RADIUS + Math.sqrt(Math.max(1, count)) * RADIUS_SCALE;

  function getBubbleById(id) {
    return state.topLevel.find((b) => b.id === id) || state.binned.find((b) => b.id === id) || null;
  }

  function setSelectedBubble(id) {
    state.selectedBubbleId = id;
    const selected = getBubbleById(id);
    const color = selected ? selected.color : null;
    [...state.colorPalette.querySelectorAll('.swatch')].forEach((swatch) => {
      swatch.classList.toggle('active', !!color && swatch.dataset.color === color);
    });
  }

  function createBubble(text) {
    const bubble = {
      id: uid(),
      x: 0,
      y: 0,
      radius: computeRadius(1),
      targetRadius: computeRadius(1),
      renderRadius: computeRadius(1),
      scale: 1,
      items: [text],
      children: [],
      parent: null,
      color: '#3b82f6'
    };
    state.leaves.push(bubble);
    return bubble;
  }

  function parseCsv(text) {
    const rows = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (!rows.length) return [];
    const first = rows[0].toLowerCase();
    const dataRows = ['item', 'items', 'text', 'statement', 'curriculum statement', 'value', 'name'].includes(first) ? rows.slice(1) : rows;
    const seen = new Set();
    const items = [];
    for (let row of dataRows) {
      if (row.startsWith('"') && row.endsWith('"')) row = row.slice(1, -1).trim();
      const key = row.toLowerCase();
      if (!row || seen.has(key)) continue;
      seen.add(key);
      items.push(row);
    }
    return items;
  }

  function placeWithoutOverlap(bubbles) {
    const pad = 8;
    for (let i = 0; i < bubbles.length; i++) {
      const b = bubbles[i];
      let placed = false;
      for (let attempts = 0; attempts < 500 && !placed; attempts++) {
        b.x = clamp(Math.random() * state.width, b.radius + pad, state.width - b.radius - pad);
        b.y = clamp(Math.random() * state.height, b.radius + 70, state.height - b.radius - 70);
        placed = true;
        for (let j = 0; j < i; j++) {
          const o = bubbles[j];
          const dx = b.x - o.x;
          const dy = b.y - o.y;
          const minD = b.radius + o.radius + 5;
          if (dx * dx + dy * dy < minD * minD) {
            placed = false;
            break;
          }
        }
      }
    }
  }

  function initializeBubbles(items) {
    const newBubbles = items.map(createBubble);
    state.topLevel.push(...newBubbles);
    placeWithoutOverlap(state.topLevel);
    requestDraw();
  }

  function clearAllMerges() {
    state.topLevel = state.leaves.filter((leaf) => !state.binned.some((b) => b.id === leaf.id));
    state.topLevel.forEach((leaf) => {
      leaf.parent = null;
      leaf.children = [];
      leaf.items = [leaf.items[0]];
      leaf.radius = computeRadius(1);
      leaf.targetRadius = leaf.radius;
      leaf.renderRadius = leaf.radius;
      leaf.scale = 1;
    });
    placeWithoutOverlap(state.topLevel);
    requestDraw();
  }

  function resetLayout() {
    placeWithoutOverlap(state.topLevel);
    requestDraw();
  }

  function hitTest(x, y) {
    for (let i = state.topLevel.length - 1; i >= 0; i--) {
      const b = state.topLevel[i];
      const r = b.renderRadius || b.radius;
      const dx = x - b.x;
      const dy = y - b.y;
      if (dx * dx + dy * dy <= r * r) return b;
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
      targetRadius: computeRadius(1),
      renderRadius: computeRadius(1),
      scale: 0.8,
      items: [...new Set([...a.items, ...b.items])],
      children: [a, b],
      parent: null,
      color: a.color
    };
    a.parent = parent;
    b.parent = parent;
    parent.targetRadius = computeRadius(parent.items.length);
    parent.radius = parent.targetRadius;

    state.topLevel = state.topLevel.filter((node) => node.id !== a.id && node.id !== b.id);
    state.topLevel.push(parent);
    setSelectedBubble(parent.id);
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

  function shade(hex, percent) {
    const num = parseInt(hex.slice(1), 16);
    const amt = Math.round(2.55 * percent);
    const r = clamp((num >> 16) + amt, 0, 255);
    const g = clamp(((num >> 8) & 255) + amt, 0, 255);
    const b = clamp((num & 255) + amt, 0, 255);
    return `#${(0x1000000 + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
  }

  function wrapAndTrimText(text, maxWidth, maxLines) {
    const lines = [];
    const paragraphs = `${text}`.split(/\n/g);
    for (const p of paragraphs) {
      const words = p.split(/\s+/).filter(Boolean);
      if (!words.length) continue;
      let line = words[0];
      for (let i = 1; i < words.length; i++) {
        const test = `${line} ${words[i]}`;
        if (state.ctx.measureText(test).width <= maxWidth) line = test;
        else {
          lines.push(line);
          line = words[i];
          if (lines.length >= maxLines) return trimLines(lines, maxLines);
        }
      }
      lines.push(line);
      if (lines.length >= maxLines) return trimLines(lines, maxLines);
    }
    return trimLines(lines, maxLines);
  }

  function trimLines(lines, maxLines) {
    const output = lines.slice(0, maxLines).map((line) => line.slice(0, MAX_TEXT_CHARS));
    if (lines.length > maxLines) output[maxLines - 1] = `${output[maxLines - 1].slice(0, MAX_TEXT_CHARS - 1)}…`;
    return output;
  }

  function textLinesForBubble(bubble) {
    if (!bubble.children.length) return wrapAndTrimText(bubble.items[0], Math.max(30, bubble.renderRadius * 1.6), 4);
    if (state.showFullMergedContent) return wrapAndTrimText(bubble.items.join(' • '), Math.max(30, bubble.renderRadius * 1.6), 5);
    const preview = bubble.items.slice(0, 2);
    const more = bubble.items.length - preview.length;
    return wrapAndTrimText([...preview, more > 0 ? `+${more} more` : ''].filter(Boolean).join('\n'), Math.max(30, bubble.renderRadius * 1.6), 5);
  }

  function drawBubble(bubble) {
    const ctx = state.ctx;
    const r = bubble.renderRadius;
    const isHovered = state.hovered && state.hovered.id === bubble.id;
    const isSelected = state.selectedBubbleId === bubble.id;
    const isMergeTarget = state.mergeTarget && state.mergeTarget.id === bubble.id;

    ctx.save();
    ctx.translate(bubble.x, bubble.y);
    ctx.scale(bubble.scale || 1, bubble.scale || 1);

    const base = bubble.color || '#3b82f6';
    const grad = ctx.createRadialGradient(-r * 0.35, -r * 0.4, r * 0.15, 0, 0, r);
    grad.addColorStop(0, shade(base, 24));
    grad.addColorStop(1, shade(base, -16));

    ctx.shadowColor = 'rgba(15, 23, 42, 0.18)';
    ctx.shadowBlur = 18;
    ctx.shadowOffsetY = 5;

    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.shadowColor = 'transparent';
    ctx.lineWidth = isMergeTarget ? 4 : isSelected ? 3.5 : isHovered ? 3 : 1.5;
    ctx.strokeStyle = isMergeTarget ? '#22c55e' : isSelected ? '#fde68a' : isHovered ? '#f8fafc' : 'rgba(255,255,255,0.7)';
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

  function draw() {
    if (!state.dirty && !state.animating) return;
    state.dirty = false;
    state.ctx.clearRect(0, 0, state.width, state.height);

    let stillAnimating = false;
    state.topLevel.forEach((bubble) => {
      bubble.renderRadius += (bubble.targetRadius - bubble.renderRadius) * 0.18;
      bubble.scale += (1 - bubble.scale) * 0.18;
      if (Math.abs(bubble.targetRadius - bubble.renderRadius) > 0.2 || Math.abs(1 - bubble.scale) > 0.01) stillAnimating = true;
      drawBubble(bubble);
    });

    state.animating = stillAnimating;
    if (stillAnimating) requestDraw();
  }

  function requestDraw() {
    state.dirty = true;
    if (!requestDraw._queued) {
      requestDraw._queued = true;
      requestAnimationFrame(() => {
        requestDraw._queued = false;
        draw();
      });
    }
  }

  function zoneHit(clientX, clientY, zoneEl) {
    const rect = zoneEl.getBoundingClientRect();
    return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
  }

  function findMergeCandidate(active) {
    let best = null;
    let bestDist = Infinity;
    state.topLevel.forEach((candidate) => {
      if (candidate.id === active.id) return;
      if (isDescendant(candidate, active) || isDescendant(active, candidate)) return;
      const dist = Math.hypot(active.x - candidate.x, active.y - candidate.y);
      const threshold = (active.radius + candidate.radius) * MERGE_THRESHOLD;
      if (dist < threshold && dist < bestDist) {
        best = candidate;
        bestDist = dist;
      }
    });
    return best;
  }

  function showRenameEditor(bubble) {
    state.renamingBubbleId = bubble.id;
    state.renameInput.value = bubble.items[0] || '';
    state.renameEditor.hidden = false;
    state.renameInput.focus();
    state.renameInput.select();
  }

  function hideRenameEditor() {
    state.renamingBubbleId = null;
    state.renameEditor.hidden = true;
  }

  function onPointerDown(event) {
    if (!state.renameEditor.hidden) return;
    const rect = state.canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const bubble = hitTest(x, y);
    if (!bubble) return;
    bringToFront(bubble);
    setSelectedBubble(bubble.id);
    state.dragging = { bubble, offsetX: x - bubble.x, offsetY: y - bubble.y };
    state.canvas.setPointerCapture(event.pointerId);
    requestDraw();
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
      state.renameZoneEl.classList.toggle('active', zoneHit(event.clientX, event.clientY, state.renameZoneEl));
      state.binZoneEl.classList.toggle('active', zoneHit(event.clientX, event.clientY, state.binZoneEl));
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
      showRenameEditor(bubble);
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
    if (state.selectedBubbleId === bubble.id) setSelectedBubble(null);
    renderBin();
  }

  function restoreBubble(id) {
    const idx = state.binned.findIndex((b) => b.id === id);
    if (idx < 0) return;
    const [bubble] = state.binned.splice(idx, 1);
    bubble.parent = null;
    bubble.x = clamp(state.width / 2 + (Math.random() * 100 - 50), bubble.radius + 10, state.width - bubble.radius - 10);
    bubble.y = clamp(state.height / 2 + (Math.random() * 100 - 50), bubble.radius + 10, state.height - bubble.radius - 10);
    state.topLevel.push(bubble);
    renderBin();
    requestDraw();
  }

  function renderBin() {
    state.binList.innerHTML = '';
    state.binned.forEach((bubble) => {
      const li = document.createElement('li');
      li.className = 'bin-item';
      const label = bubble.children.length ? `${bubble.items[0] || 'Merged bubble'} (${bubble.items.length} items)` : (bubble.items[0] || 'Untitled bubble');
      const title = document.createElement('div');
      title.textContent = label.slice(0, 70);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = 'Restore';
      btn.addEventListener('click', () => restoreBubble(bubble.id));
      li.appendChild(title);
      li.appendChild(btn);
      state.binList.appendChild(li);
    });
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

  const hideTooltip = () => { state.tooltip.style.display = 'none'; };

  function exportStructure() {
    const toJSON = (bubble) => ({
      id: bubble.id,
      x: Number(bubble.x.toFixed(2)),
      y: Number(bubble.y.toFixed(2)),
      radius: Number(bubble.radius.toFixed(2)),
      items: [...bubble.items],
      children: bubble.children.map(toJSON),
      parent: bubble.parent ? bubble.parent.id : null,
      color: bubble.color
    });

    const blob = new Blob([JSON.stringify(state.topLevel.map(toJSON), null, 2)], { type: 'application/json' });
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

  function addBubbleFromInput() {
    const text = state.addBubbleInput.value.trim();
    if (!text) return;
    const bubble = createBubble(text);
    bubble.x = clamp(state.width / 2 + (Math.random() * 100 - 50), bubble.radius + 10, state.width - bubble.radius - 10);
    bubble.y = clamp(state.height / 2 + (Math.random() * 100 - 50), bubble.radius + 10, state.height - bubble.radius - 10);
    state.topLevel.push(bubble);
    state.addBubbleInput.value = '';
    setSelectedBubble(bubble.id);
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

    state.addBubbleBtn.addEventListener('click', addBubbleFromInput);
    state.addBubbleInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') addBubbleFromInput();
    });

    state.colorPalette.addEventListener('click', (event) => {
      const swatch = event.target.closest('.swatch');
      if (!swatch || !state.selectedBubbleId) return;
      const bubble = getBubbleById(state.selectedBubbleId);
      if (!bubble) return;
      bubble.color = swatch.dataset.color;
      setSelectedBubble(bubble.id);
      requestDraw();
    });

    state.renameSaveBtn.addEventListener('click', () => {
      const bubble = getBubbleById(state.renamingBubbleId);
      const value = state.renameInput.value.trim();
      if (bubble && value) {
        if (bubble.children.length) bubble.items[0] = value;
        else bubble.items = [value];
      }
      hideRenameEditor();
      requestDraw();
    });

    state.renameCancelBtn.addEventListener('click', hideRenameEditor);

    state.resetLayoutBtn.addEventListener('click', resetLayout);
    state.clearMergesBtn.addEventListener('click', clearAllMerges);
    state.exportBtn.addEventListener('click', exportStructure);
    state.showFullToggle.addEventListener('change', (event) => {
      state.showFullMergedContent = event.target.checked;
      requestDraw();
    });

    state.canvas.addEventListener('pointerdown', onPointerDown);
    state.canvas.addEventListener('pointermove', onPointerMove);
    state.canvas.addEventListener('pointerup', onPointerUp);
    state.canvas.addEventListener('pointercancel', onPointerUp);
    state.canvas.addEventListener('dblclick', onDoubleClick);
    state.canvas.addEventListener('mouseleave', () => {
      state.hovered = null;
      state.canvas.style.cursor = 'default';
      hideTooltip();
      requestDraw();
    });

    window.addEventListener('resize', resizeCanvas);
  }

  function init() {
    state.ctx = state.canvas.getContext('2d');
    bindEvents();
    renderBin();
    resizeCanvas();
  }

  init();
})();
