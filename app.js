(() => {
  const JOURNALS = {
    mis_quarterly: { name: 'MIS Quarterly', file: 'mis_quarterly_papers.json', color: '#7463d9' },
    information_systems_research: { name: 'Information Systems Research', file: 'information_systems_research_papers.json', color: '#ef8a67' },
    journal_of_management_information_systems: { name: 'Journal of Management Information Systems', file: 'journal_of_management_information_systems_papers.json', color: '#25a99b' },
  };
  const $ = (selector) => document.querySelector(selector);
  const escape = (value = '') => String(value).replace(/[&<>'"]/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[char]));

  function initShell() {
    document.querySelectorAll('[data-version]').forEach((node) => { node.textContent = window.ATLAS_VERSION || '0.1.0'; });
    const useNight = localStorage.getItem('atlas-theme') === 'night';
    document.body.classList.toggle('night', useNight);
    document.querySelectorAll('.theme-toggle').forEach((button) => button.addEventListener('click', () => {
      const night = !document.body.classList.contains('night'); document.body.classList.toggle('night', night); localStorage.setItem('atlas-theme', night ? 'night' : 'day');
    }));
    const updateFromData = (data) => {
      const stamp = data?.lastUpdated || data?.last_successful_quarterly_refresh || data?.updated_at;
      const display = stamp ? new Date(stamp).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'Not yet recorded';
      document.querySelectorAll('[data-last-update]').forEach((node) => { node.textContent = display; });
    };
    if (window.ATLAS_METADATA) updateFromData(window.ATLAS_METADATA);
    else fetch('atlas_state.json').then((response) => response.ok ? response.json() : null).then(updateFromData).catch(() => document.querySelectorAll('[data-last-update]').forEach((node) => { node.textContent = 'Available in local dataset'; }));
  }
  initShell();
  const canvas = $('#network-canvas');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  const state = { records: [], byId: new Map(), nodes: [], edges: [], view: 'overview', selected: null, dragging: null, dragStart: null, transform: { zoom: 1, x: 0, y: 0 } };
  let externalLoadPromise;
  let yearBounds = { min: 1900, max: 2026 };
  const dataFiles = Object.entries(JOURNALS);
  const hash = (text) => [...String(text)].reduce((value, char) => ((value << 5) - value + char.charCodeAt(0)) | 0, 0) >>> 0;
  const coordsFor = (id, index, total, center = false) => {
    if (center) return { x: .5, y: .52 };
    const angle = index * 2.399963229728653 + (hash(id) % 99) / 99;
    const radius = .13 + .75 * Math.sqrt((index + 1) / Math.max(total, 2));
    return { x: .5 + Math.cos(angle) * radius * .56, y: .5 + Math.sin(angle) * radius * .42 };
  };
  const journalKey = (record) => Object.keys(JOURNALS).find((key) => (record._journal || '') === key) || 'external';
  const topicNames = (record) => (record.topics || []).map((topic) => topic?.name).filter(Boolean);
  const subfieldNames = (record) => (record.topics || []).map((topic) => topic?.subfield?.name).filter(Boolean);
  const readableAuthors = (record) => (record.authors || []).map((author) => author.name).filter(Boolean).join(', ');
  const mergeRecord = (record, key) => ({ ...record, _journal: key, _id: record.id, _title: record.title || `OpenAlex record ${record.id}` });

  function populateOptions(records) {
    const topics = [...new Set(records.flatMap(topicNames))].sort(); const subfields = [...new Set(records.flatMap(subfieldNames))].sort();
    $('#topic-options').innerHTML = topics.map((value) => `<option value="${escape(value)}"></option>`).join('');
    $('#subfield-options').innerHTML = subfields.map((value) => `<option value="${escape(value)}"></option>`).join('');
  }
  function activeJournalKeys() { return [...document.querySelectorAll('input[name="journal"]:checked')].map((input) => input.value); }
  function includes(value, query) { return !query || String(value || '').toLowerCase().includes(query.toLowerCase()); }
  function selectedPeriod() { const fromValue = Number($('#year-from').value), toValue = Number($('#year-to').value); return { from: fromValue || -Infinity, to: toValue || Infinity }; }
  function recordsFor(keys) {
    const selectedKeys = new Set(keys); const { from, to } = selectedPeriod(); const topic = $('#topic-filter').value.trim(); const subfield = $('#subfield-filter').value.trim();
    return state.records.filter((record) => selectedKeys.has(record._journal) && (record.publication_year || 0) >= from && (record.publication_year || 0) <= to && (!topic || topicNames(record).some((item) => includes(item, topic))) && (!subfield || subfieldNames(record).some((item) => includes(item, subfield))));
  }
  function filteredRecords() { return recordsFor(activeJournalKeys()); }
  function syncYearControls() {
    const start = $('#year-range-start'), end = $('#year-range-end'); const fromValue = Number($('#year-from').value), toValue = Number($('#year-to').value);
    start.value = Math.max(yearBounds.min, Math.min(yearBounds.max, fromValue || yearBounds.min)); end.value = Math.max(yearBounds.min, Math.min(yearBounds.max, toValue || yearBounds.max));
    $('#year-range-start-label').textContent = `From ${fromValue || 'Beginning'}`; $('#year-range-end-label').textContent = `To ${toValue || 'All years'}`;
  }
  function configureYearControls(records) {
    const years = records.map((record) => Number(record.publication_year)).filter((year) => year >= 1800 && year <= 3000); if (years.length) yearBounds = { min: Math.min(...years), max: Math.max(...years) };
    ['#year-range-start', '#year-range-end', '#year-from', '#year-to'].forEach((selector) => { $(selector).min = yearBounds.min; $(selector).max = yearBounds.max; }); syncYearControls();
  }
  function updateYearBoundsForSelection() {
    const selected = activeJournalKeys(); const source = selected.length ? state.records.filter((record) => selected.includes(record._journal)) : state.records;
    const years = source.map((record) => Number(record.publication_year)).filter((year) => year >= 1800 && year <= 3000); if (!years.length) return;
    yearBounds.min = Math.min(...years); const from = Number($('#year-from').value), to = Number($('#year-to').value);
    if (from && from < yearBounds.min) $('#year-from').value = yearBounds.min; if (to && to < yearBounds.min) $('#year-to').value = yearBounds.min;
    ['#year-range-start', '#year-range-end', '#year-from', '#year-to'].forEach((selector) => { $(selector).min = yearBounds.min; $(selector).max = yearBounds.max; }); syncYearControls();
  }
  function updateJournalStats() {
    const active = activeJournalKeys(), host = $('#journal-stats');
    if (!active.length) { host.innerHTML = '<p>Select one or more journals to view their basic statistics.</p>'; return; }
    host.innerHTML = active.map((key) => { const records = recordsFor([key]); const citations = records.reduce((total, record) => total + Number(record.cited_by_count || 0), 0); const years = records.map((record) => Number(record.publication_year)).filter(Boolean); const coverage = years.length ? `${Math.min(...years)}-${Math.max(...years)}` : 'No matching years'; const journal = JOURNALS[key]; return `<div class="journal-stat" style="--journal-color:${journal.color}"><strong>${escape(journal.name)}</strong><span>${records.length.toLocaleString()} papers | ${citations.toLocaleString()} citations | ${coverage}</span></div>`; }).join('');
  }
  function resetZoom() { state.transform = { zoom: 1, x: 0, y: 0 }; $('#zoom-reset').textContent = '100%'; }
  function setZoom(next, anchor) { const box = canvas.getBoundingClientRect(), old = state.transform.zoom; const zoom = Math.max(.3, Math.min(4, next)); const point = anchor || { x: box.width / 2, y: box.height / 2 }; state.transform.x = point.x - (point.x - state.transform.x) * (zoom / old); state.transform.y = point.y - (point.y - state.transform.y) * (zoom / old); state.transform.zoom = zoom; $('#zoom-reset').textContent = `${Math.round(zoom * 100)}%`; render(); }
  function buildOverview() {
    updateYearBoundsForSelection();
    const records = filteredRecords(); const allowed = new Set(records.map((record) => record.id));
    state.view = 'overview'; state.selected = null; resetZoom();
    state.nodes = records.map((record, index) => ({ ...record, ...coordsFor(record.id, index, records.length), fixed: false }));
    state.edges = records.flatMap((record) => (record.referenced_work_ids || []).filter((id) => allowed.has(id)).map((id) => ({ source: record.id, target: id, sourceJournal: record._journal, relation: 'outgoing' })));
    $('#network-title').textContent = 'Filtered research network'; $('#network-summary').textContent = `${records.length.toLocaleString()} papers · ${state.edges.length.toLocaleString()} internal citation links`;
    $('#network-empty').hidden = records.length > 0;
    if (!records.length) $('#network-empty').textContent = activeJournalKeys().length ? 'No papers match these filters. Try widening the time period.' : 'Choose one or more journals to begin exploring the network.';
    updateJournalStats();
    render();
  }
  function externalNode(id) { return state.byId.get(id) || { id, _id: id, _title: 'External paper not yet hydrated', title: 'External paper not yet hydrated', _journal: 'external', referenced_work_ids: [], citing_work_ids: [] }; }
  function ensureExternalIndex() {
    if (window.ATLAS_EXTERNAL_INDEX) { window.ATLAS_EXTERNAL_INDEX.forEach((record) => state.byId.set(record.id, mergeRecord(record, 'external'))); return Promise.resolve(); }
    if (externalLoadPromise) return externalLoadPromise;
    externalLoadPromise = new Promise((resolve, reject) => { const script = document.createElement('script'); script.src = 'atlas_external_index.js'; script.onload = () => { (window.ATLAS_EXTERNAL_INDEX || []).forEach((record) => state.byId.set(record.id, mergeRecord(record, 'external'))); resolve(); }; script.onerror = () => reject(new Error('external index')); document.head.append(script); });
    return externalLoadPromise;
  }
  async function buildFocus(record) {
    $('#network-loading').hidden = false; $('#network-loading').textContent = 'Loading connected paper details…';
    try { await ensureExternalIndex(); } catch { /* focal paper details still remain usable */ }
    $('#network-loading').hidden = true;
    const ids = new Set([record.id, ...(record.referenced_work_ids || []), ...(record.citing_work_ids || [])]);
    const nodes = [...ids].map(externalNode); state.view = 'focus'; state.selected = record.id; resetZoom();
    state.nodes = nodes.map((item, index) => ({ ...item, ...coordsFor(item.id, index, nodes.length, item.id === record.id), fixed: item.id === record.id }));
    state.edges = [ ...(record.referenced_work_ids || []).map((id) => ({ source: record.id, target: id, sourceJournal: record._journal, relation: 'outgoing' })), ...(record.citing_work_ids || []).map((id) => ({ source: id, target: record.id, sourceJournal: journalKey(externalNode(id)), relation: 'incoming' })) ].filter((edge) => ids.has(edge.source) && ids.has(edge.target));
    $('#network-title').textContent = 'Focused citation neighborhood'; $('#network-summary').textContent = `${nodes.length} directly connected papers`;
    $('.toolbar-hint').textContent = 'Drag nodes · click a paper for details';
    $('#network-empty').hidden = true; showPaper(record); render();
  }
  function nodeMap() { return new Map(state.nodes.map((node) => [node.id, node])); }
  function resize() { const box = canvas.getBoundingClientRect(); const ratio = Math.min(window.devicePixelRatio || 1, 2); canvas.width = box.width * ratio; canvas.height = box.height * ratio; ctx.setTransform(ratio, 0, 0, ratio, 0, 0); render(); }
  function pos(node, time) { const box = canvas.getBoundingClientRect(); const levitate = state.view === 'focus' || node.fixed || state.dragging?.id === node.id ? 0 : Math.sin(time / 1200 + (hash(node.id) % 70)) * 2; return { x: node.x * box.width * state.transform.zoom + state.transform.x, y: (node.y * box.height + levitate) * state.transform.zoom + state.transform.y }; }
  function nodeSize(node) { return Math.max(4, Math.min(18, (4 + Math.log10((node.cited_by_count || 0) + 1) * 3) * Math.sqrt(state.transform.zoom))); }
  function drawArrow(from, to, color, dashed = false, edgeKey = '', sourceRadius = 5, targetRadius = 5) { const dx = to.x - from.x, dy = to.y - from.y, distance = Math.hypot(dx, dy); if (distance < sourceRadius + targetRadius + 12) return; const ux = dx / distance, uy = dy / distance, curve = Math.min(38, distance * .12) * ((hash(edgeKey) % 2) ? 1 : -1), control = { x: (from.x + to.x) / 2 - uy * curve, y: (from.y + to.y) / 2 + ux * curve }; const startDirection = { x: control.x - from.x, y: control.y - from.y }, startDistance = Math.hypot(startDirection.x, startDirection.y), startX = from.x + startDirection.x / startDistance * (sourceRadius + 1), startY = from.y + startDirection.y / startDistance * (sourceRadius + 1); const tangentX = to.x - control.x, tangentY = to.y - control.y, tangentDistance = Math.hypot(tangentX, tangentY), tx = tangentX / tangentDistance, ty = tangentY / tangentDistance, endX = to.x - tx * (targetRadius + 1), endY = to.y - ty * (targetRadius + 1); ctx.save(); ctx.strokeStyle = color; ctx.globalAlpha = .42; ctx.lineWidth = 1.2; if (dashed) ctx.setLineDash([4, 5]); ctx.beginPath(); ctx.moveTo(startX, startY); ctx.quadraticCurveTo(control.x, control.y, endX, endY); ctx.stroke(); ctx.setLineDash([]); ctx.fillStyle = color; ctx.globalAlpha = .7; ctx.beginPath(); ctx.moveTo(endX, endY); ctx.lineTo(endX - tx * 7 - ty * 4, endY - ty * 7 + tx * 4); ctx.lineTo(endX - tx * 7 + ty * 4, endY - ty * 7 - tx * 4); ctx.closePath(); ctx.fill(); ctx.restore(); }
  function render(time = performance.now()) {
    const box = canvas.getBoundingClientRect(); ctx.clearRect(0, 0, box.width, box.height); const map = nodeMap();
    for (const edge of state.edges) { const source = map.get(edge.source), target = map.get(edge.target); if (!source || !target) continue; const color = JOURNALS[edge.sourceJournal]?.color || '#98a0b8'; drawArrow(pos(source, time), pos(target, time), color, edge.relation === 'incoming', `${edge.source}:${edge.target}`, nodeSize(source), nodeSize(target)); }
    for (const node of state.nodes) { const point = pos(node, time), radius = nodeSize(node), color = JOURNALS[node._journal]?.color || '#98a0b8'; ctx.save(); ctx.shadowColor = color; ctx.shadowBlur = state.dragging?.id === node.id ? 18 : 8; ctx.fillStyle = node.id === state.selected ? '#ffffff' : color; ctx.strokeStyle = color; ctx.lineWidth = node.id === state.selected ? 4 : 1.5; ctx.beginPath(); ctx.arc(point.x, point.y, radius, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); ctx.restore(); if (state.view === 'focus' || state.nodes.length <= 180) { const words = String(node.title || node._title || '').trim().split(/\s+/).filter(Boolean); const label = words.length > 3 ? `${words.slice(0, 3).join(' ')}…` : words.join(' '); ctx.font = '600 11px Inter, system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = document.body.classList.contains('night') ? '#f5f2fb' : '#30264a'; ctx.shadowBlur = 0; ctx.fillText(label, point.x, point.y - radius - 9); } }
  }
  function animate(time) { if (state.nodes.length && state.nodes.length <= 1200) render(time); requestAnimationFrame(animate); }
  function canvasPoint(event) { const box = canvas.getBoundingClientRect(); return { x: event.clientX - box.left, y: event.clientY - box.top, box }; }
  function hitTest(point) { let closest = null, best = Infinity; for (const node of state.nodes) { const position = pos(node, performance.now()), distance = Math.hypot(point.x - position.x, point.y - position.y); if (distance < nodeSize(node) + 8 && distance < best) { closest = node; best = distance; } } return closest; }
  function installCanvasEvents() {
    canvas.addEventListener('pointerdown', (event) => { const point = canvasPoint(event), node = hitTest(point); if (!node) return; state.dragging = node; state.dragStart = point; node.fixed = true; canvas.setPointerCapture(event.pointerId); canvas.style.cursor = 'grabbing'; });
    canvas.addEventListener('pointermove', (event) => { const point = canvasPoint(event); if (state.dragging) { state.dragging.x = Math.max(.02, Math.min(.98, (point.x - state.transform.x) / (point.box.width * state.transform.zoom))); state.dragging.y = Math.max(.06, Math.min(.94, (point.y - state.transform.y) / (point.box.height * state.transform.zoom))); render(); } else canvas.style.cursor = hitTest(point) ? 'pointer' : 'grab'; });
    canvas.addEventListener('pointerup', (event) => { const point = canvasPoint(event), node = state.dragging; if (node) { const moved = Math.hypot(point.x - state.dragStart.x, point.y - state.dragStart.y); state.dragging = null; state.dragStart = null; canvas.style.cursor = 'grab'; if (moved < 8) { if (state.view === 'focus') showPaper(node); else void buildFocus(node); } } });
    canvas.addEventListener('wheel', (event) => { event.preventDefault(); const point = canvasPoint(event); setZoom(state.transform.zoom * (event.deltaY < 0 ? 1.15 : .87), point); }, { passive: false });
    canvas.addEventListener('dblclick', resetZoom);
  }
  function showPaper(record) {
    const dialog = $('#paper-dialog'); const topic = record.primary_topic?.name || topicNames(record)[0] || 'Not classified'; const institutions = (record.institutions || []).map((item) => item.name).filter(Boolean); const keywords = (record.keywords || []).map((item) => item.display_name || item.keyword || item).filter(Boolean); const sdgs = (record.sustainable_development_goals || []).map((item) => item.display_name).filter(Boolean);
    $('#paper-details').innerHTML = `<div class="paper-kicker">${escape(JOURNALS[record._journal]?.name || 'External paper')} · ${escape(record.publication_year || 'Year unavailable')}</div><h2>${escape(record.title || record._title)}</h2><div class="paper-meta"><span>${escape(record.cited_by_count || 0)} OpenAlex citations</span><span>${escape(topic)}</span>${record.doi ? `<span><a href="${escape(record.doi)}" target="_blank" rel="noreferrer">DOI ↗</a></span>` : ''}</div><section class="detail-section"><h3>Authors</h3><p>${escape(readableAuthors(record) || 'Not available')}</p></section><section class="detail-section"><h3>Abstract</h3><p>${escape(record.abstract || 'No abstract was available from OpenAlex for this work.')}</p></section><section class="detail-section"><h3>Institutions</h3><div class="detail-chips">${institutions.length ? institutions.map((item) => `<span>${escape(item)}</span>`).join('') : '<span>Not available</span>'}</div></section><section class="detail-section"><h3>Topics &amp; keywords</h3><div class="detail-chips">${[...topicNames(record), ...keywords].slice(0, 18).map((item) => `<span>${escape(item)}</span>`).join('') || '<span>Not available</span>'}</div></section><section class="detail-section"><h3>SDGs &amp; links</h3><p>${escape(sdgs.join(', ') || 'No SDG classification')} · ${record.link_to_paper ? `<a href="${escape(record.link_to_paper)}" target="_blank" rel="noreferrer">Open paper link ↗</a>` : 'No paper link available'}</p></section><p class="dialog-hint">This focused view shows directly cited and citing papers. Close this panel to return to the filtered network.</p>`;
    // Keep the focused graph visible and interactive; details are a modeless side panel.
    if (!dialog.open) dialog.show();
  }
  function closeFocus() { if ($('#paper-dialog').open) $('#paper-dialog').close(); buildOverview(); }
  function updateFromStartSlider() {
    const start = Number($('#year-range-start').value), end = $('#year-range-end'); if (start > Number(end.value)) end.value = start;
    $('#year-from').value = start; $('#year-to').value = Number(end.value) === yearBounds.max ? '' : end.value; syncYearControls(); buildOverview();
  }
  function updateFromEndSlider() {
    const end = Number($('#year-range-end').value), start = $('#year-range-start'); if (end < Number(start.value)) start.value = end;
    $('#year-from').value = start.value; $('#year-to').value = end === yearBounds.max ? '' : end; syncYearControls(); buildOverview();
  }
  function updateFromYearFields() {
    const from = Number($('#year-from').value), to = Number($('#year-to').value); if (from && to && to < from) $('#year-to').value = from;
    syncYearControls(); buildOverview();
  }
  async function load() {
    try {
      if (window.ATLAS_DATA?.records) {
        state.records = window.ATLAS_DATA.records.map((record) => mergeRecord(record, record._journal));
      } else {
        const journalData = await Promise.all(dataFiles.map(async ([key, config]) => [key, await fetch(config.file).then((response) => { if (!response.ok) throw new Error(config.file); return response.json(); })]));
        state.records = journalData.flatMap(([key, data]) => Object.values(data.works || {}).map((record) => mergeRecord(record, key)));
      }
      state.records.forEach((record) => state.byId.set(record.id, record));
      populateOptions(state.records); configureYearControls(state.records); buildOverview(); $('#network-loading').hidden = true;
    } catch (error) { $('#network-loading').textContent = `Could not load the Atlas data (${error.message}). Serve this folder through GitHub Pages or a local web server.`; }
  }
  ['#topic-filter','#subfield-filter'].forEach((selector) => $(selector).addEventListener('input', buildOverview)); ['#year-from','#year-to'].forEach((selector) => $(selector).addEventListener('input', updateFromYearFields)); $('#year-range-start').addEventListener('input', updateFromStartSlider); $('#year-range-end').addEventListener('input', updateFromEndSlider); document.querySelectorAll('input[name="journal"]').forEach((input) => input.addEventListener('change', buildOverview)); $('#reset-view').addEventListener('click', buildOverview); $('#zoom-in').addEventListener('click', () => setZoom(state.transform.zoom * 1.25)); $('#zoom-out').addEventListener('click', () => setZoom(state.transform.zoom / 1.25)); $('#zoom-reset').addEventListener('click', resetZoom); $('#close-paper').addEventListener('click', closeFocus); $('#paper-dialog').addEventListener('cancel', (event) => { event.preventDefault(); closeFocus(); });
  installCanvasEvents(); window.addEventListener('resize', resize); resize(); requestAnimationFrame(animate); load();
})();
