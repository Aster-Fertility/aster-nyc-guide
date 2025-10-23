/* Aster NYC Guide — places.json only
   Category mapping:
   - pizza_bagels → restaurants (if name has "pizza"), cafes (if "bagel")
   - hidden_gems → shopping
   - iconic → activities
   - museums → any with “museum”, “MoMA”, “Metropolitan Museum”, “AMNH”, “Memorial & Museum”
   Shows walking time (minutes) within 10-minute walking radius.
*/

(() => {
  const PLACES_JSON = 'places.json';
  const METERS_PER_MIN = 80; // ~3 mph average walk
  const WALK_MIN = 10;
  const WALK_METERS = METERS_PER_MIN * WALK_MIN;

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

  /* ---------- helpers ---------- */
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
  function fmtWalkTime(meters) {
    if (!isFinite(meters)) return '';
    const mins = Math.max(1, Math.round(meters / METERS_PER_MIN));
    return `${mins} min walk`;
  }
  const setStatus = (t='') => { if (statusEl) statusEl.textContent = t; };

  /* ---------- category mapping ---------- */
  const museumRegex = /\b(museum|moma|metropolitan museum|american museum of natural history|memorial\s*&?\s*museum)\b/i;
  const pizzaRegex  = /\b(pizza|pizzeria)\b/i;
  const bagelRegex  = /\b(bagel)\b/i;

  function normalizeCategory(p) {
    const original = (p.type || '').toLowerCase();
    const name = p.name || '';

    if (museumRegex.test(name)) return 'museums';
    if (original === 'pizza_bagels') {
      if (bagelRegex.test(name)) return 'cafes';
      if (pizzaRegex.test(name)) return 'restaurants';
      return 'restaurants';
    }
    if (original === 'hidden_gems') return 'shopping';
    if (original === 'iconic') return 'activities';
    return original || 'other';
  }

  /* ---------- load ---------- */
  async function loadPlaces() {
    const res = await fetch(PLACES_JSON, { headers: { 'Accept': 'application/json' } });
    if (!res.ok) throw new Error(`Failed to load ${PLACES_JSON} (${res.status})`);
    const json = await res.json();
    ALL_PLACES = Array.isArray(json?.places) ? json.places : [];

    // de-dup
    const seen = new Set();
    ALL_PLACES = ALL_PLACES.filter(p => {
      const k = `${(p.name||'').trim()}|${(p.address||'').trim()}`.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

    CLINICS = ALL_PLACES.filter(p => (p.type || '').toLowerCase() === 'clinic');
    CURATED = ALL_PLACES
      .filter(p => (p.type || '').toLowerCase() !== 'clinic')
      .map(p => ({ ...p, _normType: normalizeCategory(p) }));
  }

  /* ---------- render ---------- */
  function populateClinicDropdown() {
    const opts = [`<option value="">Select a clinic…</option>`]
      .concat([...CLINICS].sort((a,b)=>a.name.localeCompare(b.name))
      .map(c => `<option value="${c.name}">${c.name}</option>`));
    selClinic.innerHTML = opts.join('');
  }

  function renderClinics(list, title='Clinics') {
    const html = `
      <div class="card">
        <h3 class="section-title">${title}</h3>
        <div class="grid grid-clinics">
          ${list.map(c => `
            <div class="clinic-card">
              <div class="clinic-title">${c.name}</div>
              <div class="clinic-sub">${c.address}</div>
              ${c.website ? `<a class="ext" href="${c.website}" target="_blank">Website</a>` : ''}
            </div>`).join('')}
        </div>
      </div>`;
    resultsEl.innerHTML = html;
  }

  function renderNearby(anchor, groups) {
    const order = ['museums','restaurants','cafes','shopping','activities','broadway_comedy','other'];
    const labels = {
      museums:'Museums',
      restaurants:'Restaurants',
      cafes:'Cafes & Bagels',
      shopping:'Shopping',
      activities:'Activities',
      broadway_comedy:'Broadway & Comedy',
      other:'Other'
    };

    const hdr = `
      <div class="card">
        <h3 class="section-title">Near: ${anchor.label}</h3>
        <p class="muted">${anchor.display || anchor.address || ''}</p>
        <p class="muted">Showing places within ~${WALK_MIN} minutes on foot.</p>
      </div>`;

    const blocks = order.map(cat => {
      const rows = groups[cat] || [];
      if (!rows.length) return '';
      const cards = rows.map(r => `
        <div class="place-card">
          <div class="place-title">${r.name}</div>
          <div class="place-sub">${r.address}</div>
          <div class="place-meta">${fmtWalkTime(r._dist)}</div>
          ${r.website ? `<a class="ext" href="${r.website}" target="_blank">Website</a>` : ''}
        </div>`).join('');
      return `
        <div class="card">
          <h3 class="section-title">${labels[cat]}</h3>
          <div class="grid grid-places">${cards}</div>
        </div>`;
    }).join('');

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
      const cat = p._normType || 'other';
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(p);
    }
    Object.keys(groups).forEach(k => groups[k].sort((a,b)=>a._dist - b._dist));
    return groups;
  }

  /* ---------- geocoding ---------- */
  async function geocodeNominatim(q, tries=4) {
    const base = 'https://nominatim.openstreetmap.org/search';
    const url  = `${base}?format=jsonv2&limit=1&q=${encodeURIComponent(q)}`;
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
    renderClinics([clinic], 'Selected Clinic');

    const groups = groupCurated({ lat: clinic.lat, lon: clinic.lon });
    renderNearby({ label: clinic.name, address: clinic.address, lat: clinic.lat, lon: clinic.lon }, groups);
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
