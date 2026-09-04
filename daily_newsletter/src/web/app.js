const $ = (s) => document.querySelector(s);
const api = async (path, opts) => {
  const res = await fetch(path, opts);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `${res.status} ${res.statusText}`);
  return body;
};

const KIND_COLORS = {
  announcement: '--k-announcement',
  'new-research': '--k-new-research',
  concept: '--k-concept',
  foundational: '--k-foundational',
  adjacent: '--k-adjacent',
};

const TOPIC_COLORS = {
  model: '--k-announcement',
  agent: '--k-new-research',
  harness: '--k-concept',
  technique: '--k-foundational',
  infra: '--k-adjacent',
  adjacent: '--muted',
};

const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

let toastTimer;
function toast(msg, ms = 3600) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), ms);
}

/* ---------------------------------------------------------------- views -- */

document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === tab));
    const view = tab.dataset.view;
    $('#briefing').classList.toggle('hidden', view !== 'briefing');
    $('#map').classList.toggle('hidden', view !== 'map');
    if (view === 'map') loadGraph();
  });
});

/* ------------------------------------------------------------- briefing -- */

async function loadStatus() {
  try {
    const s = await api('/api/status');
    $('#status').textContent =
      `${s.prompts} prompts · ${s.topics} topics` + (s.unprocessed ? ` · ${s.unprocessed} pending` : '');
  } catch {
    $('#status').textContent = 'offline';
  }
}

async function loadDates(select) {
  const dates = await api('/api/dates');
  const el = $('#dates');
  el.innerHTML = dates.map((d) => `<option value="${d.date}">${d.date} (${d.n})</option>`).join('');
  el.classList.toggle('hidden', dates.length === 0);
  if (select) el.value = select;
  return dates;
}

async function loadDigest(date) {
  const { date: d, items } = await api('/api/digest' + (date ? `?date=${date}` : ''));
  const box = $('#items');

  if (!items.length) {
    box.innerHTML = `<div class="empty">
      <p>No briefing yet.</p>
      <p class="muted">Click <strong>Sync brain</strong> to read your Claude Code transcripts,
      then <strong>New briefing</strong> to build one.<br />
      From a terminal that is <code>npm run ingest</code> then <code>npm run digest</code>.</p>
    </div>`;
    $('#digest-meta').textContent = '';
    return;
  }

  $('#digest-meta').textContent = `${items.length} items`;
  box.innerHTML = items.map(renderItem).join('');

  box.querySelectorAll('.react').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const wrap = btn.closest('.item');
      const on = btn.classList.contains('on');
      wrap.querySelectorAll('.react').forEach((b) => b.classList.remove('on'));
      if (!on) btn.classList.add('on');
      await api(`/api/items/${wrap.dataset.id}/reaction`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reaction: on ? null : btn.dataset.reaction }),
      }).catch((e) => toast(e.message));
    });
  });
}

const esc = (s) =>
  String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

function renderItem(it) {
  const colour = `var(${KIND_COLORS[it.kind] ?? '--muted'})`;
  const title = it.url
    ? `<a href="${esc(it.url)}" target="_blank" rel="noopener">${esc(it.title)}</a>`
    : esc(it.title);
  const host = it.url ? new URL(it.url).hostname.replace(/^www\./, '') : it.source;

  return `<article class="item" data-id="${esc(it.id)}" style="--kind:${colour}">
    <div class="item-head">
      <span class="kind">${esc(it.kind)}</span>
      ${it.topic_label ? `<span class="topic-chip">${esc(it.topic_label)}</span>` : ''}
    </div>
    <h2>${title}</h2>
    <p>${esc(it.summary)}</p>
    ${it.why ? `<p class="why"><strong>Why you:</strong> ${esc(it.why)}</p>` : ''}
    <div class="item-foot">
      <span>${esc(host)}${it.published ? ' · ' + it.published.slice(0, 10) : ''}</span>
      <span class="spacer"></span>
      <button class="react ${it.reaction === 'up' ? 'on' : ''}" data-reaction="up">More like this</button>
      <button class="react ${it.reaction === 'down' ? 'on' : ''}" data-reaction="down">Less</button>
    </div>
  </article>`;
}

$('#dates').addEventListener('change', (e) => loadDigest(e.target.value));

/* ------------------------------------------------------------- actions -- */

async function runAction(btn, path, done) {
  const others = [$('#refresh'), $('#build')];
  others.forEach((b) => (b.disabled = true));
  const label = btn.textContent;
  btn.textContent = 'Working…';
  try {
    done(await api(path, { method: 'POST' }));
  } catch (e) {
    toast(e.message, 6000);
  } finally {
    btn.textContent = label;
    others.forEach((b) => (b.disabled = false));
    loadStatus();
  }
}

$('#refresh').addEventListener('click', (e) =>
  runAction(e.target, '/api/refresh', (r) => {
    toast(`${r.ing.inserted} new prompts, ${r.ext.topicsTouched} topics updated`);
    graph = null;
    if (!$('#map').classList.contains('hidden')) loadGraph();
  }),
);

$('#build').addEventListener('click', (e) =>
  runAction(e.target, '/api/digest', async (r) => {
    toast(`Briefing ready: ${r.items} items`);
    await loadDates(r.date);
    await loadDigest(r.date);
  }),
);

/* --------------------------------------------------------------- graph -- */

const canvas = $('#graph');
const ctx = canvas.getContext('2d');
let graph = null;
let nodes = [];
let links = [];
let selected = null;
let pan = { x: 0, y: 0 };
let raf = null;

async function loadGraph() {
  if (graph) return;
  graph = await api('/api/graph');

  const live = graph.topics.filter((t) => t.weight > 0.05 || t.pinned);
  const maxW = Math.max(...live.map((t) => t.weight), 1);

  // Size first: the seed ring has to be centred on the real canvas, or the
  // nodes start at the origin and the centring force never catches them.
  sizeCanvas();
  pan = { x: 0, y: 0 };
  const rect = canvas.getBoundingClientRect();
  const ring = Math.min(rect.width, rect.height) / 4;

  nodes = live.map((t, i) => ({
    ...t,
    // Seed on a circle so the simulation unfolds instead of exploding.
    x: rect.width / 2 + Math.cos((i / live.length) * Math.PI * 2) * ring + (Math.random() - 0.5) * 20,
    y: rect.height / 2 + Math.sin((i / live.length) * Math.PI * 2) * ring + (Math.random() - 0.5) * 20,
    vx: 0,
    vy: 0,
    r: 7 + Math.sqrt(t.weight / maxW) * 22,
  }));

  // Separation has to account for the label, not just the circle, or long
  // names like "Large language models" overlap their neighbours.
  for (const n of nodes) {
    ctx.font = labelFont(n);
    n.halfW = Math.max(n.r, ctx.measureText(n.label).width / 2);
  }

  const byId = new Map(nodes.map((n) => [n.id, n]));
  links = graph.edges
    .map((e) => ({ s: byId.get(e.a), t: byId.get(e.b), w: e.weight }))
    .filter((l) => l.s && l.t);

  renderLegend();
  if (!raf) tick();
}

const labelFont = (n) => `${n.r > 15 ? 13 : 11}px ui-sans-serif, system-ui, sans-serif`;

function renderLegend() {
  $('#legend').innerHTML = Object.entries(TOPIC_COLORS)
    .map(([k, v]) => `<span><i class="dot" style="background:var(${v})"></i>${k}</span>`)
    .join('');
}

function sizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

/** A small spring/repulsion simulation. O(n^2), which is fine well past 300 topics. */
function step() {
  const rect = canvas.getBoundingClientRect();
  const cx = rect.width / 2 + pan.x;
  const cy = rect.height / 2 + pan.y;

  // A handful of topics need a firm pull to stay together; a busy map needs a
  // gentle one or it collapses into an unreadable knot.
  const pull = nodes.length < 12 ? 0.006 : 0.002;
  for (const n of nodes) {
    n.vx += (cx - n.x) * pull;
    n.vy += (cy - n.y) * pull;
  }

  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i];
      const b = nodes[j];
      let dx = b.x - a.x;
      let dy = b.y - a.y;
      let d2 = dx * dx + dy * dy || 0.01;
      const min = (a.halfW + b.halfW + 18) ** 2;
      const force = (d2 < min ? 2600 : 900) / d2;
      const d = Math.sqrt(d2);
      const fx = (dx / d) * force;
      const fy = (dy / d) * force;
      a.vx -= fx;
      a.vy -= fy;
      b.vx += fx;
      b.vy += fy;
    }
  }

  for (const l of links) {
    const dx = l.t.x - l.s.x;
    const dy = l.t.y - l.s.y;
    const d = Math.hypot(dx, dy) || 0.01;
    const rest = 90 + 40 / Math.sqrt(l.w);
    const k = (d - rest) * 0.006 * Math.min(l.w, 4);
    const fx = (dx / d) * k;
    const fy = (dy / d) * k;
    l.s.vx += fx;
    l.s.vy += fy;
    l.t.vx -= fx;
    l.t.vy -= fy;
  }

  for (const n of nodes) {
    n.vx *= 0.82;
    n.vy *= 0.82;
    n.x += n.vx;
    n.y += n.vy;
  }
}

function draw() {
  const rect = canvas.getBoundingClientRect();
  ctx.clearRect(0, 0, rect.width, rect.height);

  ctx.strokeStyle = cssVar('--line');
  for (const l of links) {
    ctx.globalAlpha = Math.min(0.25 + l.w * 0.12, 0.9);
    ctx.lineWidth = Math.min(1 + l.w * 0.4, 4);
    ctx.beginPath();
    ctx.moveTo(l.s.x, l.s.y);
    ctx.lineTo(l.t.x, l.t.y);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  const ink = cssVar('--ink');
  for (const n of nodes) {
    ctx.fillStyle = cssVar(TOPIC_COLORS[n.kind] ?? '--muted');
    ctx.globalAlpha = n.muted ? 0.2 : 1;
    ctx.beginPath();
    ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
    ctx.fill();

    if (n.pinned || selected === n.id) {
      ctx.strokeStyle = ink;
      ctx.lineWidth = selected === n.id ? 3 : 1.5;
      ctx.stroke();
    }

    ctx.globalAlpha = n.muted ? 0.35 : 1;
    ctx.fillStyle = ink;
    ctx.font = labelFont(n);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(n.label, n.x, n.y + n.r + 5);
    ctx.globalAlpha = 1;
  }
}

function tick() {
  step();
  draw();
  raf = requestAnimationFrame(tick);
}

/* ---- interaction ---- */

let drag = null;

canvas.addEventListener('mousedown', (e) => {
  const p = pointer(e);
  const hit = nodeAt(p);
  drag = hit ? { node: hit } : { pan: true, x: p.x, y: p.y, moved: false };
});

canvas.addEventListener('mousemove', (e) => {
  const p = pointer(e);
  if (drag?.node) {
    drag.node.x = p.x;
    drag.node.y = p.y;
    drag.node.vx = drag.node.vy = 0;
    drag.moved = true;
  } else if (drag?.pan) {
    const dx = p.x - drag.x;
    const dy = p.y - drag.y;
    for (const n of nodes) {
      n.x += dx;
      n.y += dy;
    }
    pan.x += dx;
    pan.y += dy;
    drag.x = p.x;
    drag.y = p.y;
    drag.moved = true;
  } else {
    canvas.style.cursor = nodeAt(p) ? 'pointer' : 'grab';
  }
});

window.addEventListener('mouseup', () => (drag = null));

canvas.addEventListener('click', async (e) => {
  const hit = nodeAt(pointer(e));
  if (!hit) return;
  selected = hit.id;
  await openInspector(hit);
});

function pointer(e) {
  const rect = canvas.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

function nodeAt(p) {
  for (let i = nodes.length - 1; i >= 0; i--) {
    const n = nodes[i];
    if (Math.hypot(n.x - p.x, n.y - p.y) <= n.r + 4) return n;
  }
  return null;
}

async function openInspector(n) {
  $('#inspector').classList.remove('hidden');
  $('#insp-title').textContent = n.label;
  $('#insp-meta').textContent =
    `${n.kind} · weight ${n.weight.toFixed(2)} · ${n.mentions} mentions · ` +
    `${n.first_seen.slice(0, 10)} → ${n.last_seen.slice(0, 10)}`;
  $('#insp-pin').textContent = n.pinned ? 'Unpin' : 'Pin';
  $('#insp-mute').textContent = n.muted ? 'Unmute' : 'Mute';

  const flag = async (name) => {
    const value = !n[name === 'pinned' ? 'pinned' : 'muted'];
    await api(`/api/topics/${n.id}/flag`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ flag: name, value }),
    });
    n[name] = value ? 1 : 0;
    toast(`${n.label}: ${name} ${value ? 'on' : 'off'}`);
    openInspector(n);
  };
  $('#insp-pin').onclick = () => flag('pinned');
  $('#insp-mute').onclick = () => flag('muted');

  const prompts = await api(`/api/topics/${n.id}/prompts`);
  $('#insp-prompts').innerHTML = prompts.length
    ? prompts
        .map(
          (p) =>
            `<li><strong>${p.ts.slice(0, 10)}</strong>${p.project ? ' · ' + esc(p.project) : ''}<br />${esc(
              p.text.slice(0, 200),
            )}${p.text.length > 200 ? '…' : ''}</li>`,
        )
        .join('')
    : '<li>no prompts recorded</li>';
}

$('#close-inspector').addEventListener('click', () => {
  $('#inspector').classList.add('hidden');
  selected = null;
});

window.addEventListener('resize', () => {
  if (nodes.length) sizeCanvas();
});

/* ----------------------------------------------------------------- go -- */

loadStatus();
loadDates().then(() => loadDigest());
