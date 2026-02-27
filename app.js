(() => {
  'use strict';

  const state = {
    canvas: document.getElementById('bubbleCanvas'),
    ctx: null,
    tooltip: document.getElementById('tooltip'),
    csvInput: document.getElementById('csvInput'),
    resetLayoutBtn: document.getElementById('resetLayoutBtn'),
    clearMergesBtn: document.getElementById('clearMergesBtn'),
    exportBtn: document.getElementById('exportBtn'),
    showFullToggle: document.getElementById('showFullContentToggle'),
    width: 0,
    height: 0,
    dpr: window.devicePixelRatio || 1,
    leaves: [],
    topLevel: [],
    bubbleMap: new Map(),
    dragging: null,
    hovered: null,
    mergeTarget: null,
    pointer: { x: 0, y: 0 },
    showFullMergedContent: false,
    dirty: true,
    animating: false,
    idCounter: 0
  };

  const BASE_RADIUS = 30;
  const RADIUS_SCALE = 11;
  const MAX_TEXT_CHARS = 95;
  const MERGE_THRESHOLD = 0.7;

  function uid() {
    state.idCounter += 1;
    return `b-${state.idCounter}`;
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function computeRadius(itemCount) {
    return BASE_RADIUS + Math.sqrt(Math.max(1, itemCount)) * RADIUS_SCALE;
  }

  function createLeafBubble(text) {
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
      scale: 1
    };
    state.bubbleMap.set(bubble.id, bubble);
    return bubble;
  }

  function rebuildBubbleMap() {
    state.bubbleMap.clear();
    const seen = new Set();
    const stack = [...state.topLevel];
    while (stack.length) {
      const bubble = stack.pop();
      if (!bubble || seen.has(bubble.id)) {
        continue;
      }
      seen.add(bubble.id);
      state.bubbleMap.set(bubble.id, bubble);
      for (const child of bubble.children) {
        stack.push(child);
      }
    }
  }

  function parseCsv(text) {
    const rows = text.split(/\r?\n/);
    const cleaned = [];
    for (let line of rows) {
      line = line.trim();
      if (!line) continue;
      if (line.startsWith('"') && line.endsWith('"')) {
        line = line.slice(1, -1).trim();
      }
      if (!line) continue;
      cleaned.push(line);
    }
    if (!cleaned.length) return [];

    const normalized = cleaned.map((v) => v.toLowerCase());
    const first = normalized[0];
    const headerLike = [
      'item',
      'items',
      'text',
      'statement',
      'curriculum statement',
      'value',
      'name'
    ].includes(first);
    const start = headerLike ? 1 : 0;

    const unique = new Set();
    const result = [];
    for (let i = start; i < cleaned.length; i += 1) {
      const item = cleaned[i].trim();
      const key = item.toLowerCase();
      if (!item || unique.has(key)) continue;
      unique.add(key);
      result.push(item);
    }
    return result;
  }

  function initializeBubbles(items) {
    state.leaves = items.map(createLeafBubble);
    state.topLevel = [...state.leaves];
    placeWithoutOverlap(state.topLevel);
    rebuildBubbleMap();
    requestDraw();
  }

  function placeWithoutOverlap(bubbles) {
    const padding = 10;
    for (let i = 0; i < bubbles.length; i += 1) {
      const bubble = bubbles[i];
      const r = bubble.radius;
      let placed = false;
      let attempts = 0;
      while (!placed && attempts < 600) {
        attempts += 1;
        bubble.x = clamp(Math.random() * state.width, r + padding, state.width - r - padding);
        bubble.y = clamp(Math.random() * state.height, r + padding, state.height - r - padding);
        placed = true;
        for (let j = 0; j < i; j += 1) {
          const other = bubbles[j];
          const dx = bubble.x - other.x;
          const dy = bubble.y - other.y;
          const minDist = bubble.radius + other.radius + 6;
          if (dx * dx + dy * dy < minDist * minDist) {
            placed = false;
            break;
          }
        }
      }
      if (!placed) {
        bubble.x = r + padding + ((i * 17) % Math.max(40, state.width - 2 * (r + padding)));
        bubble.y = r + padding + ((i * 29) % Math.max(40, state.height - 2 * (r + padding)));
      }
    }
  }

  function clearAllMerges() {
    if (!state.leaves.length) return;
    state.topLevel = [...state.leaves];
    for (const leaf of state.leaves) {
      leaf.parent = null;
      leaf.children = [];
      leaf.items = [leaf.items[0]];
      leaf.radius = computeRadius(leaf.items.length);
      leaf.targetRadius = leaf.radius;
      leaf.renderRadius = leaf.radius;
    }
    placeWithoutOverlap(state.topLevel);
    rebuildBubbleMap();
    requestDraw();
  }

  function resetLayout() {
    placeWithoutOverlap(state.topLevel);
    requestDraw();
  }

  function hitTest(x, y) {
    for (let i = state.topLevel.length - 1; i >= 0; i -= 1) {
      const b = state.topLevel[i];
      const dx = x - b.x;
      const dy = y - b.y;
      const rr = b.renderRadius || b.radius;
      if (dx * dx + dy * dy <= rr * rr) {
        return b;
      }
    }
    return null;
  }

  function isDescendant(candidate, ancestor) {
    if (!candidate || !ancestor) return false;
    let node = candidate;
    while (node) {
      if (node.id === ancestor.id) return true;
      node = node.parent;
    }
    return false;
  }

  function unionItems(a, b) {
    return [...new Set([...a, ...b])];
  }

  function bringToFront(bubble) {
    const idx = state.topLevel.findIndex((b) => b.id === bubble.id);
    if (idx >= 0) {
      state.topLevel.splice(idx, 1);
      state.topLevel.push(bubble);
    }
  }

  function mergeBubbles(a, b) {
    if (!a || !b || a.id === b.id) return;
    if (isDescendant(a, b) || isDescendant(b, a)) return;

    const parent = {
      id: uid(),
      x: (a.x + b.x) / 2,
      y: (a.y + b.y) / 2,
      radius: computeRadius(1),
      items: unionItems(a.items, b.items),
      children: [a, b],
      parent: null,
      targetRadius: computeRadius(1),
      renderRadius: computeRadius(1),
      scale: 0.8
    };

    a.parent = parent;
    b.parent = parent;

    parent.targetRadius = computeRadius(parent.items.length);
    parent.radius = parent.targetRadius;

    state.topLevel = state.topLevel.filter((node) => node.id !== a.id && node.id !== b.id);
    state.topLevel.push(parent);
    rebuildBubbleMap();
    requestDraw();
  }

  function splitBubble(bubble) {
    if (!bubble || !bubble.children.length) return;
    const idx = state.topLevel.findIndex((b) => b.id === bubble.id);
    if (idx < 0) return;

    state.topLevel.splice(idx, 1);
    const count = bubble.children.length;
    const spread = Math.max(22, bubble.radius * 0.45);
    for (let i = 0; i < count; i += 1) {
      const child = bubble.children[i];
      child.parent = null;
      const angle = (Math.PI * 2 * i) / count;
      child.x = clamp(bubble.x + Math.cos(angle) * spread, child.radius + 8, state.width - child.radius - 8);
      child.y = clamp(bubble.y + Math.sin(angle) * spread, child.radius + 8, state.height - child.radius - 8);
      child.scale = 0.9;
      state.topLevel.push(child);
    }
    bubble.children = [];
    rebuildBubbleMap();
    requestDraw();
  }

  function textLinesForBubble(bubble) {
    const items = bubble.items;
    if (!bubble.children.length) {
      return wrapAndTrimText(items[0], Math.max(30, bubble.renderRadius * 1.6), 4);
    }

    if (state.showFullMergedContent) {
      return wrapAndTrimText(items.join(' • '), Math.max(30, bubble.renderRadius * 1.65), 5);
    }

    const preview = items.slice(0, 2);
    const more = items.length - preview.length;
    const label = [...preview, more > 0 ? `+${more} more` : ''];
    return wrapAndTrimText(label.filter(Boolean).join('\n'), Math.max(30, bubble.renderRadius * 1.6), 5);
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
        if (state.ctx.measureText(test).width <= maxWidth) {
          line = test;
        } else {
          lines.push(line);
          line = words[i];
          if (lines.length >= maxLines) {
            return truncateLines(lines, maxLines);
          }
        }
      }
      lines.push(line);
      if (lines.length >= maxLines) {
        return truncateLines(lines, maxLines);
      }
    }

    return truncateLines(lines, maxLines);
  }

  function truncateLines(lines, maxLines) {
    if (lines.length <= maxLines) {
      return lines.map((line) => line.slice(0, MAX_TEXT_CHARS));
    }
    const trimmed = lines.slice(0, maxLines);
    const last = trimmed[maxLines - 1];
    trimmed[maxLines - 1] = `${last.slice(0, Math.max(0, MAX_TEXT_CHARS - 1))}…`;
    return trimmed;
  }

  function drawBubble(bubble) {
    const ctx = state.ctx;
    const isHovered = state.hovered && state.hovered.id === bubble.id;
    const isMergeTarget = state.mergeTarget && state.mergeTarget.id === bubble.id;
    const r = bubble.renderRadius;

    ctx.save();
    ctx.translate(bubble.x, bubble.y);
    ctx.scale(bubble.scale || 1, bubble.scale || 1);

    ctx.shadowColor = 'rgba(15, 23, 42, 0.18)';
    ctx.shadowBlur = 18;
    ctx.shadowOffsetY = 5;

    const grad = ctx.createRadialGradient(-r * 0.35, -r * 0.45, r * 0.15, 0, 0, r);
    grad.addColorStop(0, bubble.children.length ? '#6ea6ff' : '#93c5fd');
    grad.addColorStop(1, bubble.children.length ? '#2563eb' : '#3b82f6');

    ctx.beginPath();
    ctx.fillStyle = grad;
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();

    ctx.shadowColor = 'transparent';
    ctx.lineWidth = isMergeTarget ? 4 : isHovered ? 3 : 1.5;
    ctx.strokeStyle = isMergeTarget ? '#22c55e' : isHovered ? '#f8fafc' : 'rgba(255,255,255,0.7)';
    ctx.stroke();

    ctx.fillStyle = '#f8fafc';
    ctx.font = `600 ${Math.max(10, Math.min(14, r * 0.21))}px Inter, Segoe UI, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const lines = textLinesForBubble(bubble);
    const lineHeight = Math.max(12, r * 0.28);
    const startY = -((lines.length - 1) * lineHeight) / 2;
    for (let i = 0; i < lines.length; i += 1) {
      ctx.fillText(lines[i], 0, startY + i * lineHeight, r * 1.75);
    }
    ctx.restore();
  }

  function draw() {
    if (!state.dirty && !state.animating) return;
    state.dirty = false;

    const ctx = state.ctx;
    ctx.clearRect(0, 0, state.width, state.height);

    let stillAnimating = false;
    for (const bubble of state.topLevel) {
      bubble.targetRadius = bubble.targetRadius || bubble.radius;
      bubble.renderRadius += (bubble.targetRadius - bubble.renderRadius) * 0.18;
      bubble.scale += (1 - bubble.scale) * 0.18;
      if (Math.abs(bubble.targetRadius - bubble.renderRadius) > 0.2 || Math.abs(1 - bubble.scale) > 0.01) {
        stillAnimating = true;
      }
      drawBubble(bubble);
    }

    state.animating = stillAnimating;
    if (state.animating) {
      requestDraw();
    }
  }

  function requestDraw() {
    state.dirty = true;
    if (!requestDraw._queued) {
      requestDraw._queued = true;
      window.requestAnimationFrame(() => {
        requestDraw._queued = false;
        draw();
      });
    }
  }

  function onPointerDown(event) {
    const rect = state.canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const bubble = hitTest(x, y);
    if (!bubble) return;

    bringToFront(bubble);
    state.dragging = {
      bubble,
      offsetX: x - bubble.x,
      offsetY: y - bubble.y,
      originalX: bubble.x,
      originalY: bubble.y
    };
    state.canvas.setPointerCapture(event.pointerId);
    requestDraw();
  }

  function findMergeCandidate(active) {
    let best = null;
    let bestDist = Infinity;
    for (const candidate of state.topLevel) {
      if (candidate.id === active.id) continue;
      if (isDescendant(candidate, active) || isDescendant(active, candidate)) continue;
      const dx = active.x - candidate.x;
      const dy = active.y - candidate.y;
      const dist = Math.hypot(dx, dy);
      const threshold = (active.radius + candidate.radius) * MERGE_THRESHOLD;
      if (dist < threshold && dist < bestDist) {
        best = candidate;
        bestDist = dist;
      }
    }
    return best;
  }

  function onPointerMove(event) {
    const rect = state.canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    state.pointer.x = event.clientX;
    state.pointer.y = event.clientY;

    if (state.dragging) {
      const bubble = state.dragging.bubble;
      bubble.x = clamp(x - state.dragging.offsetX, bubble.radius + 5, state.width - bubble.radius - 5);
      bubble.y = clamp(y - state.dragging.offsetY, bubble.radius + 5, state.height - bubble.radius - 5);
      state.mergeTarget = findMergeCandidate(bubble);
      hideTooltip();
      requestDraw();
      return;
    }

    const hovered = hitTest(x, y);
    if ((hovered && !state.hovered) || (!hovered && state.hovered) || (hovered && state.hovered && hovered.id !== state.hovered.id)) {
      state.hovered = hovered;
      state.canvas.style.cursor = hovered ? 'grab' : 'default';
      requestDraw();
    }

    if (hovered) {
      showTooltip(hovered, event.clientX, event.clientY);
    } else {
      hideTooltip();
    }
  }

  function onPointerUp(event) {
    if (!state.dragging) return;
    const drag = state.dragging;
    const bubble = drag.bubble;
    state.dragging = null;
    state.canvas.releasePointerCapture(event.pointerId);

    if (state.mergeTarget) {
      mergeBubbles(bubble, state.mergeTarget);
    } else {
      bubble.x += (drag.originalX - bubble.x) * 0.15;
      bubble.y += (drag.originalY - bubble.y) * 0.15;
      requestDraw();
    }

    state.mergeTarget = null;
    requestDraw();
  }

  function onDoubleClick(event) {
    const rect = state.canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const bubble = hitTest(x, y);
    if (!bubble || !bubble.children.length) return;
    splitBubble(bubble);
  }

  function showTooltip(bubble, clientX, clientY) {
    const content = bubble.items.join('\n• ');
    state.tooltip.textContent = `• ${content}`;
    state.tooltip.style.display = 'block';
    state.tooltip.style.left = `${clientX}px`;
    state.tooltip.style.top = `${clientY}px`;
  }

  function hideTooltip() {
    state.tooltip.style.display = 'none';
  }

  function exportStructure() {
    const toSerializable = (bubble) => ({
      id: bubble.id,
      x: Number(bubble.x.toFixed(2)),
      y: Number(bubble.y.toFixed(2)),
      radius: Number(bubble.radius.toFixed(2)),
      items: [...bubble.items],
      children: bubble.children.map(toSerializable),
      parent: bubble.parent ? bubble.parent.id : null
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
      reader.onload = () => {
        const items = parseCsv(`${reader.result || ''}`);
        initializeBubbles(items);
      };
      reader.readAsText(file);
      event.target.value = '';
    });

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
      hideTooltip();
      requestDraw();
    });

    window.addEventListener('resize', resizeCanvas);
  }

  function init() {
    state.ctx = state.canvas.getContext('2d');
    bindEvents();
    resizeCanvas();
  }

  init();
})();
