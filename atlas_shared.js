(() => {
  const BUCKETS = 256;
  const loaded = new Set();
  const pending = new Map();
  const idBucket = (id) => {
    const digits = String(id || '').replace(/\D/g, '');
    return digits ? Number(digits) % BUCKETS : 0;
  };
  const label = (value) => {
    if (typeof value === 'string' || typeof value === 'number') return String(value);
    if (value && typeof value === 'object') return String(value.name || value.display_name || value.keyword || value.title || '');
    return '';
  };
  const list = (values) => (values || []).map(label).filter(Boolean);
  const journalName = (record) => record?.journal?.name || record?.journal || record?._journal || 'External source';
  function loadBucket(bucket, byId) {
    if (loaded.has(bucket)) return Promise.resolve();
    if (pending.has(bucket)) return pending.get(bucket);
    const padded = String(bucket).padStart(2, '0');
    const work = new Promise((resolve, reject) => {
      const script = document.createElement('script'); script.src = `atlas_external_${padded}.js`;
      script.onload = () => {
        const items = window[`ATLAS_EXTERNAL_${padded}`] || [];
        items.forEach((record) => { if (!byId.has(record.id)) byId.set(record.id, { ...record, _journal: 'external', _id: record.id, _title: record.title || 'External paper' }); });
        loaded.add(bucket); pending.delete(bucket); resolve();
      };
      script.onerror = () => { pending.delete(bucket); reject(new Error(`external bundle ${padded}`)); };
      document.head.append(script);
    });
    pending.set(bucket, work); return work;
  }
  function loadExternal(ids, byId) {
    const buckets = [...new Set((ids || []).filter((id) => id && !byId.has(id)).map(idBucket))];
    return Promise.all(buckets.map((bucket) => loadBucket(bucket, byId)));
  }
  function download(filename, text, type) {
    const url = URL.createObjectURL(new Blob([text], { type })); const anchor = document.createElement('a');
    anchor.href = url; anchor.download = filename; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1500);
  }
  function downloadJSON(records, filename) { download(filename.endsWith('.json') ? filename : `${filename}.json`, JSON.stringify(records, null, 2), 'application/json'); }
  function recordRows(records) {
    return (records || []).map((record) => ({
      title: record.title || record._title || '', journal: journalName(record), year: record.publication_year || '', doi: record.doi || '', link: record.link_to_paper || '',
      citation_count: record.cited_by_count || '', topic: label(record.primary_topic) || list(record.topics).join('; '), subfield: list((record.topics || []).map((item) => item?.subfield)).join('; '),
      authors: list(record.authors).join('; '), institutions: list(record.institutions).join('; '), keywords: list(record.keywords).join('; '), sdgs: list(record.sustainable_development_goals).join('; '), type: record.type || '',
    }));
  }
  function downloadCSV(records, filename) {
    const rows = recordRows(records); const columns = ['title', 'journal', 'year', 'doi', 'link', 'citation_count', 'topic', 'subfield', 'authors', 'institutions', 'keywords', 'sdgs', 'type'];
    const cell = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`;
    download(filename.endsWith('.csv') ? filename : `${filename}.csv`, [columns.join(','), ...rows.map((row) => columns.map((column) => cell(row[column])).join(','))].join('\r\n'), 'text/csv;charset=utf-8');
  }
  window.AtlasShared = { label, list, loadExternal, downloadJSON, downloadCSV, journalName, idBucket };
})();
