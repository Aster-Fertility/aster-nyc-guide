/**
 * Aster NYC Guide – nearest places engine
 * - Category + tag filters, nearby hotel/address search
 * - Left drawer: How to use / Method & reliability
 * - Safe if a place lacks coords (shows without distance)
 */
(function () {
  const STATE = { data:null, clinic:null, radius:1200, typeFilters:new Set(), tagFilters:new Set(), limitPerGroup:8 };

  // --- Distance helpers ---
  function haversine(lat1, lon1, lat2, lon2) {
    const R = 6371000, toRad = d => d * Math.PI / 180;
    const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)**2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }
  const metersToMiles = m => m * 0.000621371;
  const metersToWalkMins = m => Math.round(m / 80);

  // --- Data load ---
  function loadPlaces() {
    return fetch('places.json', { cache: 'no-cache' })
      .then(r => { if (!r.ok) throw new Error('Failed to fetch places.json'); return r.json(); })
      .then(json => { STATE.data = json; initUI(); STATE.clinic = json.clinics[0]; renderAll(); })
      .catch(err => {
        console.error(err);
        const el=document.getElementById('results');
        if (el) el.innerHTML='<div class="card error">Could not load curated data. Please ensure <code>places.json</code> is deployed next to this page.</div>';
      });
  }

  // --- Nearby (hotel/address) helpers ---
  async function geocodeAddress(query) {
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=us&bounded=1&viewbox=-74.05,40.92,-73.70,40.49&q=${encodeURIComponent(query)}`;
    const r = await fetch(url, { headers: { "Accept": "application/json" } });
    if (!r.ok) throw new Error("Geocoding failed");
    const data = await r.json();
    if (!Array.isArray(data) || !data.length) throw new Error("No results");
    return { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) };
  }

  function renderNearbyFromCoords({ lat, lon, label }) {
    const out = document.getElementById('nearbyResults');
    const statusEl = document.getElementById('status');
    if (!out || !STATE?.data) return;

    const pseudoClinic = { id: 'user-addr', name: label || 'Your location', lat, lon };
    const items = getNearbyPlaces({
      clinic: pseudoClinic,
      places: STATE.data.places,
      types: [], // allow all categories
      radiusMeters: STATE.radius,
      limit: 24,
      mustHaveTags: STATE.tagFilters
    });

    if (statusEl) statusEl.textContent = `Showing ${items.length} curated places near “${label}”.`;
    out.innerHTML = items.length
      ? `<section class="card">
           <h3 class="section-title">Nearby picks for: ${label}</h3>
           <div class="grid grid-gap">${ items.map(renderCard).join('') }</div>
         </section>`
      : `<div class="card">No curated places within your current radius. Try increasing the slider or clearing filters.</div>`;
  }

  // --- Drawer helpers ---
  function openDrawer({ title, html }) {
    const drawer = document.getElementById('drawer');
    const panel = drawer?.querySelector('.drawer__panel');
    const dTitle = drawer?.querySelector('#drawerTitle');
    const dContent = drawer?.querySelector('#drawerContent');
    if (!drawer || !panel || !dTitle || !dContent) return;

    dTitle.textContent = title;
    dContent.innerHTML = html;
    drawer.classList.add('is-open');
    drawer.setAttribute('aria-hidden','false');
    panel.focus();
  }
  function closeDrawer() {
    const drawer = document.getElementById('drawer');
    if (!drawer) return;
    drawer.classList.remove('is-open');
    drawer.setAttribute('aria-hidden','true');
  }
  function getHowToHTML() {
    // Copy from the on-page "How to use" section if present; fallback text otherwise
    const sec = document.querySelector('#howtoBox');
    if (sec) {
      const clone = sec.cloneNode(true);
      // Reduce nesting: we just want the inner of the card
      return clone.innerHTML;
    }
    return `
      <h4>How to use</h4>
      <ol>
        <li>Select your clinic from the dropdown.</li>
        <li>Adjust the walking radius and apply category/tag filters.</li>
        <li>Browse curated spots closest to you, or search by hotel/address.</li>
      </ol>
    `;
  }
  function getMethodHTML() {
    return `
      <h4>Method & reliability</h4>
      <p><strong>Data source:</strong> Curated list from <code>places.json</code> (handpicked categories: café, bagels, pizza, restaurant, shopping, things to do).</p>
      <p><strong>Geocoding:</strong> Addresses are geocoded to latitude/longitude. If any item lacks coordinates it can still display (without distance).</p>
      <p><strong>Distance:</strong> Calculated via the Haversine formula from clinic (or your typed address) to each place.</p>
      <p><strong>Walking time:</strong> Estimated at ~80 meters/minute. Actual times vary by traffic, signals, pace, and weather.</p>
      <p><strong>Filters:</strong> Category filters must match the <code>type</code> field; tag filters match <code>tags</code> (and optional <code>dietary</code>) exactly.</p>
      <p><strong>Limitations:</strong> Hours and conditions change; verify before visiting. This guide emphasizes proximity and user comfort near clinics.</p>
    `;
  }

  // --- UI wiring ---
  function initUI() {
    const sel=document.getElementById('clinicSelect');
    if (sel && STATE.data) {
      sel.innerHTML = STATE.data.clinics.map(c=>`<option value="${c.id}">${c.name}</option>`).join('');
      sel.value = STATE.data.clinics[0]?.id || '';
      sel.addEventListener('change', () => {
        STATE.clinic = STATE.data.clinics.find(c=>c.id===sel.value)||STATE.data.clinics[0];
        renderAll();
      });
    }

    const radius=document.getElementById('radiusInput');
    if (radius) {
      radius.value=String(STATE.radius);
      radius.addEventListener('input', ()=>{
        STATE.radius=Number(radius.value)||1200;
        renderAll();
        const addr = document.getElementById('userAddress');
        if (addr && addr.value.trim()) {
          geocodeAddress(addr.value.trim())
            .then(({lat,lon}) => renderNearbyFromCoords({ lat, lon, label: addr.value.trim() }))
            .catch(()=>{});
        }
      });
    }

    // Category filters
    document.querySelectorAll('[data-filter-group="type"] input[type="checkbox"]').forEach(cb => {
      cb.addEventListener('change', ()=>{
        if (cb.checked) STATE.typeFilters.add(cb.value); else STATE.typeFilters.delete(cb.value);
        renderAll();
      });
    });

    // Tag filters
    document.querySelectorAll('[data-filter-group="tag"] input[type="checkbox"]').forEach(cb => {
      cb.addEventListener('change', ()=>{
        if (cb.checked) STATE.tagFilters.add(cb.value); else STATE.tagFilters.delete(cb.value);
        renderAll();
        const addr = document.getElementById('userAddress');
        if (addr && addr.value.trim()) {
          geocodeAddress(addr.value.trim())
            .then(({lat,lon}) => renderNearbyFromCoords({ lat, lon, label: addr.value.trim() }))
            .catch(()=>{});
        }
      });
    });

    // Nearby hotel/address search
    const nearbyBtn = document.getElementById('nearbyBtn');
    const userAddress = document.getElementById('userAddress');
    const statusEl = document.getElementById('status');

    async function runNearby() {
      if (!STATE?.data) return;
      const q = (userAddress?.value || '').trim();
      const out = document.getElementById('nearbyResults');
      if (!q) {
        if (statusEl) statusEl.textContent = 'Please enter a hotel or street address.';
        return;
      }
      if (statusEl) statusEl.textContent = 'Finding places near your location…';
      if (out) out.innerHTML = '';
      try {
        const { lat, lon } = await geocodeAddress(q);
        renderNearbyFromCoords({ lat, lon, label: q });
      } catch (e) {
        if (statusEl) statusEl.textContent = 'Could not find that address. Try a full street address (e.g., "1335 6th Ave, New York, NY").';
      }
    }

    if (nearbyBtn) nearbyBtn.addEventListener('click', runNearby);
    if (userAddress) {
      userAddress.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          runNearby();
        }
      });
    }

    // Drawer triggers + close handlers
    const btnHowTo = document.getElementById('btnHowTo');
    const btnMethod = document.getElementById('btnMethod');
    const drawer = document.getElementById('drawer');
    const overlay = document.getElementById('drawerOverlay');
    const closeBtn = document.getElementById('drawerClose');

    btnHowTo?.addEventListener('click', () => openDrawer({ title: 'How to use', html: getHowToHTML() }));
    btnMethod?.addEventListener('click', () => openDrawer({ title: 'Method & reliability', html: getMethodHTML() }));
    overlay?.addEventListener('click', closeDrawer);
    closeBtn?.addEventListener('click', closeDrawer);
    window.addEventListener('keydown', (e)=>{ if (e.key === 'Escape') closeDrawer(); });
  }

  // --- Core engine (coordinate-safe) ---
  function getNearbyPlaces({ clinic, places, types=[], radiusMeters=1200, limit=8, mustHaveTags=new Set() }) {
    const hasClinicCoords = Number.isFinite(clinic?.lat) && Number.isFinite(clinic?.lon);

    const featured = places.filter(p =>
      Array.isArray(p.featured_for) &&
      p.featured_for.includes(clinic.id) &&
      (!types.length || types.includes(p.type))
    );

    let candidates = places.filter(p => {
      const typeOK = !types.length || types.includes(p.type);
      const tagsArray = (p.dietary||[]).concat(p.tags||[]);
      const tagsOK = !mustHaveTags.size ? true : tagsArray.some(t => mustHaveTags.has(t));
      return typeOK && tagsOK;
    });

    // Compute distance ONLY if both sides have coords
    candidates = candidates.map(p => {
      const hasCoords = Number.isFinite(p.lat) && Number.isFinite(p.lon) && hasClinicCoords;
      const distance = hasCoords ? haversine(clinic.lat, clinic.lon, p.lat, p.lon) : null;
      return { ...p, distance };
    });

    // Filter by radius ONLY for those with a distance; keep coord-less entries
    candidates = candidates
      .filter(p => p.distance === null || p.distance <= radiusMeters)
      .filter(p => !featured.find(f => f.id === p.id));

    // Sort: by distance (nulls last), then price length, then name
    candidates.sort((a, b) => {
      const ad = a.distance, bd = b.distance;
      if (ad === null && bd !== null) return 1;
      if (ad !== null && bd === null) return -1;
      if (ad !== null && bd !== null && ad !== bd) return ad - bd;
      const ap = String(a.price_level||'').length, bp = String(b.price_level||'').length;
      if (ap !== bp) return ap - bp;
      return a.name.localeCompare(b.name);
    });

    const featWithDist = featured.map(p => {
      const hasCoords = Number.isFinite(p.lat) && Number.isFinite(p.lon) && hasClinicCoords;
      const distance = hasCoords ? haversine(clinic.lat, clinic.lon, p.lat, p.lon) : null;
      return { ...p, distance };
    }).sort((a,b) => {
      if (a.distance === null && b.distance !== null) return 1;
      if (a.distance !== null && b.distance === null) return -1;
      return (a.distance||0) - (b.distance||0);
    });

    return [...featWithDist, ...candidates].slice(0, limit);
  }

  // --- Card render ---
  function renderCard(p) {
    const miles = (p.distance != null) ? metersToMiles(p.distance) : null;
    const mins  = (p.distance != null) ? metersToWalkMins(p.distance) : null;
    const dist  = (p.distance != null) ? `${miles.toFixed(1)} mi · ${mins} min walk` : '';
    const tags  = (p.tags||[]).concat(p.dietary||[]);
    const tagHtml = tags.map(t=>`<span class="chip">${t}</span>`).join('');
    const price = p.price_level ? `<span class="price">${p.price_level}</span>` : '';
    const note  = p.note ? `<div class="note">${p.note}</div>` : '';
    const website = p.website ? `<a class="visit-link" href="${p.website}" target="_blank" rel="noopener">Visit website</a>` : '';
    const address = p.address ? p.address : '';

    return `<div class="place-card">
      <div class="place-card__row">
        <div class="place-card__title">${p.name}</div>
        <div class="place-card__meta">${price}${dist ? ` · ${dist}` : ''}</div>
      </div>
      <div class="place-card__sub">${address}</div>
      ${tagHtml ? `<div class="place-card__tags">${tagHtml}</div>` : ''}
      ${note}
      ${website}
    </div>`;
  }

  // --- Sections + page render ---
  function renderSection(title, items) {
    if (!items.length) return '';
    return `<section class="card">
      <h3 class="section-title">${title}</h3>
      <div class="grid grid-gap">${ items.map(renderCard).join('') }</div>
    </section>`;
  }

  function renderAll() {
    const root=document.getElementById('results'); if (!root||!STATE.data||!STATE.clinic) return;
    const { places } = STATE.data; const radius=STATE.radius;
    const types = STATE.typeFilters.size ? Array.from(STATE.typeFilters) : [];
    const tags  = STATE.tagFilters;

    const groups = [
      { key: 'cafe',         title: 'Cafés & Bakeries' },
      { key: 'bagels',       title: 'Bagels & Breakfast' },
      { key: 'pizza',        title: 'Great Slices Nearby' },
      { key: 'restaurant',   title: 'Great Eats Nearby' },
      { key: 'shopping',     title: 'Shopping & Markets' },
      { key: 'things to do', title: 'Iconic NYC Must-Sees' }
    ].filter(g => !types.length || types.includes(g.key));

    const html = groups.map(g=>{
      const items = getNearbyPlaces({
        clinic:STATE.clinic,
        places,
        types:g.key?[g.key]:[],
        radiusMeters:radius,
        limit:STATE.limitPerGroup,
        mustHaveTags:tags
      });
      return renderSection(g.title, items);
    }).join('');

    const mins=(radius/80).toFixed(1), miles=(radius*0.000621371).toFixed(2);
    root.innerHTML = `<div class="header-compact">
      <div><strong>Clinic:</strong> ${STATE.clinic.name}</div>
      <div><strong>Radius:</strong> ~${mins} min (~${miles} mi)</div>
    </div>${html || '<div class="card">No results match your filters.</div>'}`;
  }

  // --- Public API + boot ---
  window.AsterGuide = { loadPlaces, getNearbyPlaces, renderAll, state: STATE };
  if (document.getElementById('results')) loadPlaces();
})();
// --- Modal logic (Method & Reliability) ---
const methodBtn = document.getElementById('methodBtn');
const modal = document.getElementById('methodModal');
const closeModal = document.getElementById('closeModal');

if (methodBtn && modal && closeModal) {
  methodBtn.addEventListener('click', () => {
    modal.classList.add('is-visible');
    modal.setAttribute('aria-hidden', 'false');
  });

  closeModal.addEventListener('click', () => {
    modal.classList.remove('is-visible');
    modal.setAttribute('aria-hidden', 'true');
  });

  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.classList.remove('is-visible');
      modal.setAttribute('aria-hidden', 'true');
    }
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      modal.classList.remove('is-visible');
      modal.setAttribute('aria-hidden', 'true');
    }
  });
}

