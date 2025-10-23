/* ==============================
   Aster NYC Guide - script.js
   ============================== */

(() => {
  const CLINICS_JSON = 'nyc_fertility_locations.json';
  const PLACES_JSON  = 'places.json'; // contains clinics + curated places
  const WALK_METERS  = 1200; // ~15 min walk
  const $ = (id) => document.getElementById(id);

  // DOM
  const selClinic   = $('clinicSelect');
  const btnShowAll  = $('showAllBtn');
  const inputAddr   = $('userAddress');
  const btnNearby   = $('nearbyBtn');
  const statusLine  = $('status');
  const resultsEl   = $('results');
  const nearbyWrap  = $('nearbyResults');

  // Data
  let CLINICS = [];     // [{name, address, lat, lon, website}]
  let PLACES  = [];     // [{name,address,lat,lon,type,clinic,website}]
  let PLACES_INDEX = { clinics: [], other: [] };

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
  const fmtMeters = (m) => {
    if (!isFinite(m)) return '';
    const feet = m * 3.28084;
    if (m < 200) return `${Math.round(feet)} ft`;
    const miles = m / 1609.344;
    return miles < 1 ? `${Math.round(m)} m` : `${miles.toFixed(2)} mi`;
  };
  const setStatus = (msg) => { if (statusLine) statusLine.textContent = msg || ''; };

  /* ---------- fetch helpers ---------- */
  async function safeFetchJSON(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url} -> ${res.status}`);
    return res.json();
  }

  async function loadData() {
    // 1) Clinics from nyc_fertility_locations.json
    try {
      const cdata = await safeFetchJSON(CLINICS_JSON);
      if (Array.isArray(cdata?.clinics)) {
        CLINICS = cdata.clinics.map(c => ({
          name: c.name,
          address: c.address,
          website: c.website || '',
          lat: c.lat ?? c.latitude ?? null,
          lon: c.lon ?? c.longitude ?? null
        })).filter(c => c.name && c.address);
      }
    } catch (e) {
      console.warn('Clinic load failed', e);
    }

    // 2) places.json (optional but recommended)
    try {
      const pdata = await safeFetchJSON(PLACES_JSON);
      if (Array.isArray(pdata?.places)) {
        PLACES = pdata.places.filter(p => p && p.name && p.address);
      }
    } catch (e) {
      console.warn('places.json missing or failed to load (hotel search will still work, but fewer curated matches).', e);
      PLACES = [];
    }

    // If clinics missing, try to pull clinic rows from places.json
    if (!CLINICS.length && PLACES.length) {
      CLINICS = PLACES
        .filter(p => p.type === 'clinic')
        .map(({ name, address, lat, lon, website }) => ({ name, address, lat, lon, website }));
    }

    // Index places
    PLACES_INDEX.clinics = PLACES.filter(p => p.type === 'clinic');
    PLACES_INDEX.other   = PLACES.filter(p => p.type !== 'clinic');
  }

  /* ---------- UI renderers ---------- */
  function renderClinicsList(list, heading = 'Clinics') {
    const safe = (s) => (s || '');
    const html = `
      <div class="card">
        <h3 class="section-title">${heading}</h3>
        <div class="grid grid-clinics">
          ${list.map(c => `
            <div class="clinic-card">
              <div class="clinic-title">${safe(c.name)}</div>
              <div class="clinic-sub">${safe(c.address)}</div>
              ${c.website ? `<a class="ext" href="${c.website}" target="_blank" rel="noopener">Website</a>` : ''}
            </div>
          `).join('')}
        </div>
      </div>
    `;
    resultsEl.innerHTML = html;
  }

  function renderNearbyGroups(anchor, groups) {
    const catsOrder = ['cafes','restaurants','pizza_bagels','hidden_gems','activities','broadway_comedy','iconic'];
    const titleMap  = {
      cafes: 'Cafés', restaurants: 'Restaurants', pizza_bagels: 'Pizza & Bagels',
      hidden_gems: 'Hidden Gems', activities: 'Activities', broadway_comedy: 'Broadway & Comedy',
      iconic: 'Iconic NYC'
    };

    const blocks = catsOrder.map(cat => {
      const rows = groups[cat] || [];
      if (!rows.length) return '';
      const cards = rows.map(r => `
        <div class="place-card">
          <div class="place-title">${r.name}</div>
          <div class="place-sub">${r.address}</div>
          <div class="place-meta">${fmtMeters(r._dist)} away</div>
          ${r.website ? `<a class="ext" href="${r.website}" target="_blank" rel="noopener">Website</a>` : ''}
        </div>
      `).join('');
      return `
        <div class="card">
          <h3 class="section-title">${titleMap[cat] || cat}</h3>
          <div class="grid grid-places">${cards}</div>
        </div>
      `;
    }).join('');

    const anchorCard = `
      <div class="card">
        <h3 class="section-title">Near: ${anchor.label}</h3>
        <p class="muted">${anchor.address}</p>
        ${isFinite(anchor.lat) && isFinite(anchor.lon) ? '' : '<p class="warn">No coordinates for this location.</p>'}
      </div>
    `;

    resultsEl.innerHTML = anchorCard + blocks || '<div class="card"><p>No results.</p></div>';
  }

  /* ---------- dropdown + show all ---------- */
  function populateClinicDropdown() {
    if (!selClinic) return;
    const sorted = [...CLINICS].sort((a,b) => a.name.localeCompare(b.name));
    selClinic.innerHTML = `<option value="">Select a clinic…</option>` +
      sorted.map(c => `<option value="${c.name}">${c.name}</option>`).join('');
  }

  function onClinicChange() {
    const name = selClinic.value;
    if (!name) { resultsEl.innerHTML = ''; return; }
    const match = CLINICS.find(c => c.name === name);
    if (!match) { resultsEl.innerHTML = ''; return; }
    renderClinicsList([match], 'Selected Clinic');
  }

  function onShowAll() {
    if (!CLINICS.length) { resultsEl.innerHTML = '<div class="card"><p>No clinics loaded.</p></div>'; return; }
    renderClinicsList(CLINICS, 'All Clinics');
  }

  /* ---------- geocoding with retry & normalization ---------- */
  async function geocodeWithRetry(query, tries = 4) {
    const base = 'https://nominatim.openstreetmap.org/search';
    const url  = `${base}?format=jsonv2&limit=1&addressdetails=1&q=${encodeURIComponent(query)}`;
    let delay = 600; // ms, respectful to OSM

    for (let i = 0; i < tries; i++) {
      try {
        setStatus(i ? `Retrying geocoder… (${i}/${tries-1})` : 'Searching address…');
        const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
        if (res.status === 503) throw new Error('503');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (Array.isArray(json) && json.length) {
          const hit = json[0];
          return { lat: parseFloat(hit.lat), lon: parseFloat(hit.lon), disp: hit.display_name || query };
        }
        // no results — break early
        return null;
      } catch (e) {
        await new Promise(r => setTimeout(r, delay));
        delay *= 1.6;
      }
    }
    return null;
  }

  // If full address fails, try simplified variants
  async function smartGeocode(input) {
    // 1) raw
    let res = await geocodeWithRetry(input);
    if (res) return res;

    // 2) remove floor/unit parts
    const stripped = input.replace(/\b(FL|Floor|Suite|Ste|#)\.?\s*\w+/gi, '').trim();
    if (stripped && stripped !== input) {
      res = await geocodeWithRetry(stripped);
      if (res) return res;
    }

    // 3) if it looks like "number street, city, state zip" keep "number street, city"
    const simpler = stripped.replace(/,\s*NY\s*\d{5}(?:-\d{4})?$/i, '').trim();
    if (simpler && simpler !== stripped) {
      res = await geocodeWithRetry(simpler);
      if (res) return res;
    }

    // 4) final hail mary: just city
    res = await geocodeWithRetry('New York, NY');
    return res;
  }

  /* ---------- nearby search ---------- */
  function groupNearby(anchor, maxMeters = WALK_METERS) {
    // Use curated PLACES; if not present, try building from clinics file
    const universe = PLACES_INDEX.other.length ? PLACES_INDEX.other : [];
    const withDist = universe.map(p => ({
      ...p,
      _dist: haversineMeters({lat: anchor.lat, lon: anchor.lon}, {lat: p.lat, lon: p.lon})
    })).filter(p => p._dist <= maxMeters && isFinite(p._dist));

    // group by type and sort by distance
    const groups = {};
    for (const p of withDist) {
      const cat = p.type || 'other';
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(p);
    }
    Object.keys(groups).forEach(k => groups[k].sort((a,b) => a._dist - b._dist));

    return groups;
  }

  async function onFindNearby() {
    const q = (inputAddr?.value || '').trim();
    resultsEl.innerHTML = '';
    nearbyWrap.innerHTML = '';
    if (!q) { setStatus('Please enter a hotel or address.'); return; }

    setStatus('Matching place…');
    const geo = await smartGeocode(q);
    if (!geo) { setStatus('Could not locate that address. Try the hotel name (e.g., “New York Hilton Midtown”).'); return; }

    setStatus('Finding curated spots nearby…');
    const groups = groupNearby({ lat: geo.lat, lon: geo.lon }, WALK_METERS);
    setStatus('');

    renderNearbyGroups({ label: q, address: geo.disp, lat: geo.lat, lon: geo.lon }, groups);
  }

  /* ---------- boot ---------- */
  async function init() {
    await loadData();
    populateClinicDropdown();

    selClinic?.addEventListener('change', onClinicChange);
    btnShowAll?.addEventListener('click', onShowAll);
    btnNearby?.addEventListener('click', onFindNearby);

    // Optional UX: Enter key triggers nearby search
    inputAddr?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        btnNearby?.click();
      }
    });
  }

  document.readyState === 'loading'
    ? document.addEventListener('DOMContentLoaded', init)
    : init();

})();
