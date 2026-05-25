// Insights dashboard HTML — separate file so the big template literal doesn't
// blow up the readability of index.ts and we don't have to worry about backtick
// or ${} escape collisions.

export const INSIGHTS_DASHBOARD_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Insights · APG</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Playfair+Display:ital,wght@0,400;0,700;1,400;1,700&display=swap" rel="stylesheet">
<style>
  :root { --ink:#1A2840; --gold:#FFC72C; --paper:#FAFAF7; --ash:#6B7280; --rule:#E5E1D8; }
  * { box-sizing: border-box; }
  body { margin:0; font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif; background: var(--paper); color: var(--ink); }
  .wrap { max-width: 1400px; margin: 0 auto; padding: 28px; }
  h1 { font-family: 'Playfair Display', Georgia, serif; font-size: 38px; margin: 0 0 4px; font-weight: 700; letter-spacing: -0.01em; }
  h1 em { color: #B58800; font-style: italic; }
  .sub { color: var(--ash); font-size: 14px; margin-bottom: 24px; }
  .pages { display: grid; grid-template-columns: repeat(auto-fill, minmax(380px, 1fr)); gap: 20px; }
  .card { background: white; border: 1px solid var(--rule); border-radius: 12px; overflow: hidden; transition: box-shadow 0.15s, border-color 0.15s; }
  .card:hover { box-shadow: 0 8px 24px -8px rgba(26,40,64,0.18); border-color: var(--gold); }
  .card .thumb { background: #f5f1e8; aspect-ratio: 16/10; position: relative; overflow: hidden; }
  .card .thumb img { width: 100%; height: 100%; object-fit: cover; object-position: top; display: block; }
  .card .thumb .empty { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; color: var(--ash); font-style: italic; font-size: 13px; padding: 16px; text-align: center; }
  .card .body { padding: 14px 16px 16px; }
  .card .label { font-weight: 700; font-size: 14px; margin-bottom: 2px; font-family: 'Playfair Display', serif; }
  .card .url { font-size: 11px; color: var(--ash); margin-bottom: 10px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .card .meta { display: flex; justify-content: space-between; font-size: 11px; color: var(--ash); margin-bottom: 10px; padding-bottom: 10px; border-bottom: 1px solid var(--rule); }
  .card .meta strong { color: var(--ink); }
  .actions { display: flex; gap: 6px; flex-wrap: wrap; }
  .actions button, .actions a { font-size: 10px; padding: 6px 10px; border-radius: 4px; border: 1px solid var(--rule); background: white; color: var(--ink); cursor: pointer; text-decoration: none; letter-spacing: 0.05em; text-transform: uppercase; font-weight: 700; font-family: inherit; transition: all 0.15s; }
  .actions button.primary { background: var(--ink); color: var(--paper); border-color: var(--ink); }
  .actions button:hover, .actions a:hover { background: var(--gold); color: var(--ink); border-color: var(--gold); }
  .actions button:disabled { opacity: 0.5; cursor: wait; }
  .actions .clarity { background: linear-gradient(135deg, #BF7BFF, #7B5BFF); color: white; border-color: #7B5BFF; }
  .actions .clarity:hover { filter: brightness(1.1); background: linear-gradient(135deg, #BF7BFF, #7B5BFF); border-color: #7B5BFF; color: white; }
  .status { padding: 10px 14px; background: var(--ink); color: var(--paper); border-radius: 6px; font-size: 12px; margin-bottom: 16px; display: none; }
  .status.show { display: block; }
  .status.ok { background: #0e6e2f; }
  .status.error { background: #8b1a1a; }
  .modal { position: fixed; inset: 0; background: rgba(26,40,64,0.85); display: none; align-items: center; justify-content: center; z-index: 100; padding: 24px; }
  .modal.show { display: flex; }
  .modal-content { background: white; border-radius: 12px; max-width: 1200px; width: 100%; max-height: 90vh; overflow: auto; padding: 28px; position: relative; }
  .modal-content .close { position: absolute; top: 12px; right: 16px; background: none; border: none; font-size: 28px; cursor: pointer; color: var(--ash); }
  .modal h2 { font-family: 'Playfair Display', serif; font-size: 26px; margin: 0 0 4px; }
  .modal .timeline-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 14px; margin-top: 18px; }
  .modal .ts-card { border: 1px solid var(--rule); border-radius: 8px; overflow: hidden; }
  .modal .ts-card img { width: 100%; height: auto; display: block; }
  .modal .ts-card .label { padding: 10px 12px; font-size: 11px; color: var(--ash); border-top: 1px solid var(--rule); }
  .modal .ts-card .label strong { color: var(--ink); display: block; font-size: 12px; }
</style>
</head>
<body>
<div class="wrap">
  <h1>Website <em>Insights</em></h1>
  <div class="sub">Auto-snapshots on every WP page change &middot; click <strong>Heatmap</strong> or <strong>Sessions</strong> to see where users actually stop scrolling, click, and drop off (Microsoft Clarity)</div>

  <div class="status" id="status"></div>

  <div class="pages" id="pages">
    <div style="grid-column:1/-1;text-align:center;padding:60px;color:var(--ash);font-style:italic;">Loading&hellip;</div>
  </div>
</div>

<div class="modal" id="modal" onclick="if(event.target.id==='modal')closeModal()">
  <div class="modal-content">
    <button class="close" onclick="closeModal()" aria-label="Close">&times;</button>
    <h2 id="modal-title">Timeline</h2>
    <div class="sub" id="modal-sub"></div>
    <div class="timeline-grid" id="timeline-grid">Loading&hellip;</div>
  </div>
</div>

<script>
  var $ = function(id){ return document.getElementById(id); };
  var pageData = [];

  function setStatus(text, kind) {
    var el = $('status');
    el.textContent = text || '';
    el.className = 'status' + (text ? ' show' : '') + (kind ? ' ' + kind : '');
    if (text && kind === 'ok') setTimeout(function(){ setStatus(''); }, 4000);
  }

  function fmtDate(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  function fmtBytes(n) {
    if (!n) return '0 B';
    if (n < 1024) return n + ' B';
    if (n < 1024*1024) return Math.round(n/1024) + ' KB';
    return (n/1024/1024).toFixed(1) + ' MB';
  }

  function escapeHtml(s) {
    return String(s||'').replace(/[&<>"']/g, function(ch){
      return ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[ch];
    });
  }

  function load() {
    return fetch('/insights/api/pages')
      .then(function(r){ if(!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function(data){
        pageData = data.pages || [];
        render();
      })
      .catch(function(e){
        setStatus('Failed to load: ' + e.message, 'error');
      });
  }

  function render() {
    var html = pageData.map(function(p, i){
      var thumbHtml = p.latestKey
        ? '<img src="/insights/snap/' + encodeURIComponent(p.latestKey) + '" alt="">'
        : '<div class="empty">No snapshot yet &mdash; click <strong>Snap now</strong> to capture</div>';
      return [
        '<div class="card">',
          '<div class="thumb">' + thumbHtml + '</div>',
          '<div class="body">',
            '<div class="label">' + escapeHtml(p.label) + '</div>',
            '<div class="url">' + escapeHtml(p.link || '') + '</div>',
            '<div class="meta">',
              '<span>WP modified: <strong>' + fmtDate(p.modified) + '</strong></span>',
              '<span><strong>' + (p.snapshotCount || 0) + '</strong> snap' + (p.snapshotCount === 1 ? '' : 's') + '</span>',
            '</div>',
            '<div class="actions">',
              '<button class="primary" onclick="captureSnap(' + i + ')">Snap now</button>',
              '<button onclick="openTimeline(' + i + ')">History</button>',
              '<a class="clarity" href="' + escapeHtml(p.clarityHeatmapUrl) + '" target="_blank" rel="noopener">Heatmap &#8599;</a>',
              '<a class="clarity" href="' + escapeHtml(p.clarityRecordingsUrl) + '" target="_blank" rel="noopener">Sessions &#8599;</a>',
              '<a href="' + escapeHtml(p.link) + '" target="_blank" rel="noopener">Visit &#8599;</a>',
            '</div>',
          '</div>',
        '</div>'
      ].join('');
    }).join('');
    $('pages').innerHTML = html || '<div style="grid-column:1/-1;text-align:center;padding:60px;color:var(--ash);">No pages tracked.</div>';
  }

  function captureSnap(idx) {
    var p = pageData[idx];
    setStatus('Capturing ' + p.label + '...');
    fetch('/insights/api/capture', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pageId: p.id }),
    })
      .then(function(r){ return r.json().then(function(d){ return { ok: r.ok, data: d }; }); })
      .then(function(res){
        if (!res.ok) throw new Error(res.data.error || 'capture failed');
        setStatus('✓ Captured ' + p.label + ' (' + fmtBytes(res.data.bytes) + ')', 'ok');
        return load();
      })
      .catch(function(e){
        setStatus('Capture failed: ' + e.message, 'error');
      });
  }

  function openTimeline(idx) {
    var p = pageData[idx];
    $('modal-title').textContent = p.label;
    $('modal-sub').textContent = p.link;
    $('timeline-grid').innerHTML = 'Loading…';
    $('modal').classList.add('show');
    fetch('/insights/api/snapshots?id=' + p.id)
      .then(function(r){ return r.json(); })
      .then(function(data){
        var items = data.timeline || [];
        if (items.length === 0) {
          $('timeline-grid').innerHTML = '<div style="grid-column:1/-1;color:var(--ash);font-style:italic;padding:24px;">No snapshots yet for this page. Click Snap now to capture the first one.</div>';
          return;
        }
        $('timeline-grid').innerHTML = items.map(function(s){
          return [
            '<div class="ts-card">',
              '<img src="/insights/snap/' + encodeURIComponent(s.key) + '" alt="" loading="lazy">',
              '<div class="label">',
                '<strong>Captured ' + fmtDate(s.capturedAt) + '</strong>',
                'WP modified ' + fmtDate(s.modifiedAt) + ' &middot; ' + fmtBytes(s.bytes),
              '</div>',
            '</div>'
          ].join('');
        }).join('');
      })
      .catch(function(e){
        $('timeline-grid').innerHTML = '<div style="color:var(--ash);">Failed: ' + escapeHtml(e.message) + '</div>';
      });
  }

  function closeModal() {
    $('modal').classList.remove('show');
  }

  document.addEventListener('keydown', function(e){
    if (e.key === 'Escape') closeModal();
  });

  load();
</script>
</body>
</html>`;
