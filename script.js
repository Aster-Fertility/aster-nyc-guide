
/**
 * Aster NYC Guide – nearest places engine (drop-in)
 * Expects a sibling `places.json` file.
 * Optional DOM hooks (if present):
 *  - <select id="clinicSelect">
 *  - <input type="range" id="radiusInput"> (meters)
 *  - <div id="results"></div>
 *  - Filter checkboxes container with data-filter-group="type" and inputs [value=restaurant|cafe|shopping|iconic]
 *  - Filter checkboxes container with data-filter-group="tag"   and inputs [value=...] for tag filters
 */
(function () {
  const STATE = {
    data: null,
    clinic: null,
    radius: 1200, // default ~10–12 min walk
    typeFilters: new Set(),    // e.g. 'cafe','restaurant','shopping','iconic'
    tagFilters: new Set(),     // e.g. 'gluten-free options','kid-friendly'
    limitPerGroup: 8
  };

  // Haversine distance (meters)
  function haversine(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const toRad = d => d * Math.PI / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat/2) ** 2 +
              Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
              Math.sin(dLon/2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }

  function loadPlaces() {
    return fetch('places.json', { cache: 'no-cache' })
      .then(r => {
        if (!r.ok) throw new Error('Failed to fetch places.json');
        return r.json();
      })
      .then(json => {
        STATE.data = json;
        initUI();
        // default: pick first clinic
        STATE.clinic = json.clinics[0];
        renderAll();
        return json;
      })
      .catch(err => {
        console.error(err);
        const container = document.getElementById('results');
        if (container) {
          container.innerHTML = '<div class="card error">Could not load curated data. Please ensure <code>places.json</code> is deployed next to this page.</div>';
        }
      });
  }

  function initUI() {
    const sel = document.getElementById('clinicSelect');
    if (sel && STATE.data) {
      sel.innerHTML = STATE.data.clinics.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
      sel.value = STATE.data.clinics[0]?.id || '';
      sel.addEventListener('change', () => {
        STATE.clinic = STATE.data.clinics.find(c => c.id === sel.value) || STATE.data.clinics[0];
        renderAll();
      });
    }
    const radius = document.getElementById('radiusInput');
    if (radius) {
      radius.value = String(STATE.radius);
      radius.addEventListener('input', () => {
        STATE.radius = Number(radius.value) || 1200;
        renderAll();
      });
    }
    document.querySelectorAll('[data-filter-group="type"] input[type="checkbox"]').forEach(cb => {
      cb.addEventListener('change', () => {
        if (cb.checked) STATE.typeFilters.add(cb.value); else STATE.typeFilters.delete(cb.value);
        renderAll();
      });
    });
    document.querySelectorAll('[data-filter-group="tag"] input[type="checkbox"]').forEach(cb => {
      cb.addEventListener('change', () => {
        if (cb.checked) STATE.tagFilters.add(cb.value); else STATE.tagFilters.delete(cb.value);
        renderAll();
      });
    });
  }

  function getNearbyPlaces({ clinic, places, types = [], radiusMeters = 1200, limit = 8, mustHaveTags = [] }) {
    const featured = places.filter(p => Array.isArray(p.featured_for) && p.featured_for.includes(clinic.id));

    let candidates = places.filter(p => {
      const typeOK = !types.length || types.includes(p.type);
      const tagsOK = !mustHaveTags.length || (p.dietary || []).concat(p.tags || []).some(t => mustHaveTags.has ? mustHaveTags.has(t) : mustHaveTags.includes(t));
      return typeOK && tagsOK;
    });

    candidates = candidates
      .map(p => ({ ...p, distance: haversine(clinic.lat, clinic.lon, p.lat, p.lon) }))
      .filter(p => p.distance <= radiusMeters && !featured.find(f => f.id === p.id));

    candidates.sort((a, b) =>
      a.distance - b.distance ||
      (String(a.price_level || '').length - String(b.price_level || '').length) ||
      a.name.localeCompare(b.name)
    );

    const featWithDist = featured.map(p => ({ ...p, distance: haversine(clinic.lat, clinic.lon, p.lat, p.lon) }))
                                 .sort((a, b) => a.distance - b.distance);

    return [...featWithDist, ...candidates].slice(0, limit);
  }

  function renderCard(p) {
    const dist = p.distance != null ? `${Math.round(p.distance)} m` : '';
    const tags = (p.tags || []).concat(p.dietary || []);
    const tagHtml = tags.map(t => `<span class="chip">${t}</span>`).join('');
    const price = p.price_level ? `<span class="price">${p.price_level}</span>` : '';
    const note = p.note ? `<div class="note">${p.note}</div>` : '';
    return `
      <a class="place-card" href="${p.website || '#'}" target="_blank" rel="noopener">
        <div class="place-card__header">
          <div class="place-card__title">${p.name}</div>
          <div class="place-card__meta">${price}${dist ? ' · ' + dist : ''}</div>
        </div>
        <div class="place-card__sub">${p.address}</div>
        ${tagHtml ? `<div class="place-card__tags">${tagHtml}</div>` : ''}
        ${note}
      </a>
    `;
  }

  function renderSection(title, items) {
    if (!items.length) return '';
    return `
      <section class="card">
        <h3 class="section-title">${title}</h3>
        <div class="grid">${ items.map(renderCard).join('') }</div>
      </section>
    `;
  }

  function renderAll() {
    const root = document.getElementById('results');
    if (!root || !STATE.data || !STATE.clinic) return;

    const { places } = STATE.data;
    const radius = STATE.radius;
    const types = STATE.typeFilters.size ? Array.from(STATE.typeFilters) : []; // empty means all
    const tags  = STATE.tagFilters; // Set

    const groups = [
      { key: 'cafe',      title: 'Cafés Near This Clinic' },
      { key: 'restaurant',title: 'Great Eats Nearby' },
      { key: 'shopping',  title: 'Shopping & Markets' },
      { key: 'iconic',    title: 'Iconic NYC Must‑Sees' }
    ].filter(g => !types.length || types.includes(g.key));

    const html = groups.map(g => {
      const items = getNearbyPlaces({
        clinic: STATE.clinic,
        places: places,
        types: g.key ? [g.key] : [],
        radiusMeters: radius,
        limit: STATE.limitPerGroup,
        mustHaveTags: tags
      });
      return renderSection(g.title, items);
    }).join('');

    root.innerHTML = `
      <div class="header-compact">
        <div><strong>Clinic:</strong> ${STATE.clinic.name}</div>
        <div><strong>Radius:</strong> ${(radius/80).toFixed(1)} min walk (≈ ${Math.round(radius)} m)</div>
      </div>
      ${html || '<div class="card">No results match your filters.</div>'}
    `;
  }

  // Public API
  window.AsterGuide = {
    loadPlaces,
    getNearbyPlaces,
    renderAll,
    state: STATE
  };

  // Auto-run if results container exists
  if (document.getElementById('results')) {
    loadPlaces();
  }
})();
