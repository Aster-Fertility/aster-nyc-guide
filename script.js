/* Aster NYC Guide — uses ONLY places.json for data
   - Populates clinic dropdown from places.json (type:"clinic")
   - Clinic select now shows curated nearby places around that clinic
   - “Find nearby” geocodes hotel/address with retry + fallbacks
*/

(() => {
  const PLACES_JSON = 'places.json';
  const WALK_METERS = 1200; // ~15 minutes

  // DOM
  const $ = (id) => document.getElementById(id);
  const selClinic  = $('clinicSelect');
  const btnShowAll = $('showAllBtn');
  const inputAddr  = $('userAddress');
  const btnNearby  = $('nearbyBtn');
  const resultsEl  = $('results');
  const statusEl   = $('status');

  // Data
  let ALL_PLACES = [];
  let CLINICS = [];
  let CURATED = [];

  /* ---------- utils ---------- */
  const toRad = (x) => (x * Math.PI) / 180;
  function haversineMeters(a, b) {
    if (!a || !b || a.lat == null || a.lon == null || b.lat == null || b.lon == null) return Infinity;
    const R = 6371000;
    const dLat = toRad(b.lat - a.lat);
    const dLon = toRad(b.lon - a.lon);
    const lat1 = toRad(a.lat);
    const lat2 = toRad(b.lat);
    const h = Math.sin(dLat/2)**2 + Math.cos(lat1)*Math.cos(lat2)*Math.sin(dLon/2)**2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  function fmtDist(m) {
    if (!isFinite(m)) return '';
    const miles = m / 1609.344;
    return miles < 1 ? `${Math.round(m)} m` : `${miles.toFixed(2)} mi`;
  }
  const setStatus = (t='') => { if (statusEl) statusEl.textContent = t; };

  /* ---------- I/O ---------- */
  async function loadPlaces() {
    const res = await fetch(PLACES_JSON, { headers: { 'Accept': 'application/json' } });
    if (!res.ok) throw new Error(`Failed to load ${PLACES_JSON} (${res.status})`);
    const json = await res.json();
    ALL_PLACES = Array.isArray(json?.places) ? json.places : [];

    // de-dup by name+address
    const seen = new Set();
    ALL_PLACES = ALL_PLACES.filter(p => {
      const k = `${(p.name||'').trim()}|${(p.address||'').trim()}`.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k); return true;
    });

    CLINICS = ALL_PLACES.filter(p => p.type === 'clinic');
    CURATED = ALL_PLACES.filter(p => p.type !== 'clinic');
  }

  /* ---------- renderers ---------- */
  function populateClinicDropdown() {
    const opts = [`<option value="">Select a clinic…</option>`]
      .concat([...CLINICS].sort((a,b)=>a.name.localeCompare(b.name))
      .map(c => `<option value="${c.name}">${c.name}</option>`));
    selClinic.innerHTML = opts.join('');
  }

  function renderClinics(list, title='Clinics') {
    const safe = (s) => s || '';
    const html = `
      <div class="card">
        <h3 class="section-title">${title}</h3>
        <div class="grid grid-clinics">
          ${list.map(c => `
            <div class="clinic-card">
              <div class="clinic-title">${safe(c.name)}</div>
              <div class="clinic-sub">${safe(c.address)}</div>
              ${c.website ? `<a class="ext" href="${c.website}" target="_blank" rel="noopener">Website</a>` : ''}
            </div>
          `).join('')}
        </div>
      </div>`;
    resultsEl.innerHTML = html;
  }

  function renderNearby(anchor, groups) {
    const order = ['cafes','restaurants','pizza_bagels','hidden_gems','activities','broadway_comedy','iconic'];
    const labels = {
      cafes:'Cafés', restaurants:'Restaurants', pizza_bagels:'Pizza & Bagels',
      hidden_gems:'Hidden Gems', activities:'Activities', broadway_comedy:'Broadway & Comedy',
      iconic:'Iconic NYC'
    };

    const hdr = `
      <div class="card">
        <h3 class="section-title">Near: ${anchor.label}</h3>
        <p class="muted">${anchor.display || anchor.address || ''}</p>
      </div>`;

    const blocks = order.map(cat => {
      const rows = groups[cat] || [];
      if (!rows.length) return '';
      const cards = rows.map(r => `
        <div class="place-card">
          <div class="place-title">${r.name}</div>
          <div class="place-sub">${r.address}</div>
          <div class="place-meta">${fmtDist(r._dist)} away</div>
          ${r.website ? `<a class="ext" href="${r.website}" target="_blank" rel="noopener">Website</a>` : ''}
        </div>`).join('');
      return `
        <div class="card">
          <h3 class="section-title">${labels[cat] || cat}</h3>
          <div class="grid grid-places">${cards}</div>
        </div>`;
    }).join('');

    // append to whatever's already in results (so the clinic card stays visible)
    resultsEl.insertAdjacentHTML('beforeend', hdr + blocks);
  }

  /* ---------- grouping ---------- */
  function groupCurated(anchor) {
    const withDist = CURATED
      .filter(p => isFinite(p.lat) && isFinite(p.lon))
      .map(p => ({ ...p, _dist: haversineMeters(anchor, { lat: p.lat, lon: p.lon }) }))
      .filter(p => p._dist <= WALK_METERS);

    const groups = {};
    for (const p of withDist) {
      const cat = p.type || 'other';
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(p);
    }
    Object.keys(groups).forEach(k => groups[k].sort((a,b)=>a._dist - b._dist));
    return groups;
  }

  /* ---------- geocoding ---------- */
  async function geocodeNominatim(q, tries=4) {
    const base = 'https://nominatim.openstreetmap.org/search';
    const url  = `${base}?format=jsonv2&limit=1&addressdetails=1&q=${encodeURIComponent(q)}`;
    let backoff = 700;
    for (let i=0;i<tries;i++) {
      try {
        setStatus(i ? `Retrying geocoder… (${i}/${tries-1})` : 'Searching address…');
        const resp = await fetch(url, { headers: { 'Accept': 'application/json' } });
        if (resp.status === 503) throw new Error('503');
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const arr = await resp.json();
        if (Array.isArray(arr) && arr.length) {
          const hit = arr[0];
          return { lat: parseFloat(hit.lat), lon: parseFloat(hit.lon), display: hit.display_name };
        }
        return null;
      } catch {
        await new Promise(r => setTimeout(r, backoff));
        backoff = Math.min(backoff * 1.7, 4000);
      }
    }
    return null;
  }

  async function smartGeocode(input) {
    let g = await geocodeNominatim(input);
    if (g) return g;

    const stripped = input.replace(/\b(FL|Floor|Suite|Ste|Unit|#)\.?\s*\w+/gi, '').trim();
    if (stripped !== input) {
      g = await geocodeNominatim(stripped);
      if (g) return g;
    }

    const simpler = stripped.replace(/,\s*NY\s*\d{5}(?:-\d{4})?$/i, '').trim();
    if (simpler !== stripped) {
      g = await geocodeNominatim(simpler);
      if (g) return g;
    }

    return await geocodeNominatim('New York, NY');
  }

  /* ---------- interactions ---------- */
  function onClinicChange() {
    const name = selClinic.value;
    resultsEl.innerHTML = '';
    if (!name) { setStatus(''); return; }

    const clinic = CLINICS.find(c => c.name === name);
    if (!clinic) { setStatus('Clinic not found.'); return; }

    setStatus('Loading curated places near clinic…');

    // 1) show clinic card
    renderClinics([clinic], 'Selected Clinic');

    // 2) compute & render curated nearby
    const groups = groupCurated({ lat: clinic.lat, lon: clinic.lon });
    renderNearby(
      { label: clinic.name, address: clinic.address, lat: clinic.lat, lon: clinic.lon },
      groups
    );

    setStatus('');
  }

  function onShowAll() {
    setStatus('');
    if (!CLINICS.length) {
      resultsEl.innerHTML = `<div class="card"><p>No clinics found.</p></div>`;
      return;
    }
    resultsEl.innerHTML = '';
    renderClinics(CLINICS, 'All Clinics');
  }

  async function onFindNearby() {
    const q = (inputAddr?.value || '').trim();
    resultsEl.innerHTML = '';
    if (!q) { setStatus('Please enter a hotel or address.'); return; }
    setStatus('Matching place…');

    const geo = await smartGeocode(q);
    if (!geo) { setStatus('Could not locate that address. Try the hotel name.'); return; }

    setStatus('Finding curated spots nearby…');
    const groups = groupCurated({ lat: geo.lat, lon: geo.lon });
    setStatus('');

    // header only; no clinic card for arbitrary address
    renderNearby({ label: q, display: geo.display, lat: geo.lat, lon: geo.lon }, groups);
  }

  /* ---------- init ---------- */
  async function init() {
    try {
      await loadPlaces();
      populateClinicDropdown();
    } catch (e) {
      setStatus('Failed to load places.json');
      console.error(e);
    }

    selClinic?.addEventListener('change', onClinicChange);
    btnShowAll?.addEventListener('click', onShowAll);
    btnNearby?.addEventListener('click', onFindNearby);
    inputAddr?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); btnNearby?.click(); }
    });
  }

  document.readyState === 'loading'
    ? document.addEventListener('DOMContentLoaded', init)
    : init();
})();
