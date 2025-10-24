
/**
 * Aster NYC Guide – nearest places engine (cleaned UI)
 * - Only the website is clickable (Visit website → link)
 * - Better spacing between items
 * - Distance shows in miles and walking time (min)
 */
(function () {
  const STATE = {
    data: null,
    clinic: null,
    radius: 1200, // meters; ~80 m/min walking speed
    typeFilters: new Set(),
    tagFilters: new Set(),
    limitPerGroup: 8
  };

  // Helpers
  function haversine(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const toRad = d => d * Math.PI / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat/2) ** 2 +
              Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
              Math.sin(dLon/2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a)); // meters
  }
  function metersToMiles(m) { return m * 0.000621371; }
  function metersToWalkMins(m) { return Math.round(m / 80); } // ≈80 m per minute

  function loadPlaces() {
    return fetch('places.json', { cache: 'no-cache' })
      .then(r => {
        if (!r.ok) throw new Error('Failed to fetch places.json');
        return r.json();
      })
      .then(json => {
        STATE.data = json;
        initUI();
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
      const tagsArray = (p.dietary || []).concat(p.tags || []);
      const tagsOK = !mustHaveTags.size ? true : tagsArray.some(t => mustHaveTags.has(t));
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
    const miles = metersToMiles(p.distance || 0);
    const mins = metersToWalkMins(p.distance || 0);
    const dist = p.distance != null ? `${miles.toFixed(1)} mi · ${mins} min walk` : '';
    const tags = (p.tags || []).concat(p.dietary || []);
    const tagHtml = tags.map(t => `<span class="chip">${t}</span>`).join('');
    const price = p.price_level ? `<span class="price">${p.price_level}</span>` : '';
    const note = p.note ? `<div class="note">${p.note}</div>` : '';
    const website = p.website ? `<a class="visit-link" href="${p.website}" target="_blank" rel="noopener">Visit website</a>` : '';

    return `
      <div class="place-card">
        <div class="place-card__row">
          <div class="place-card__title">${p.name}</div>
          <div class="place-card__meta">${price}${dist ? ` · ${dist}` : ''}</div>
        </div>
        <div class="place-card__sub">${p.address}</div>
        ${tagHtml ? `<div class="place-card__tags">${tagHtml}</div>` : ''}
        ${note}
        ${website}
      </div>
    `;
  }

  function renderSection(title, items) {
    if (!items.length) return '';
    return `
      <section class="card">
        <h3 class="section-title">${title}</h3>
        <div class="grid grid-gap">${ items.map(renderCard).join('') }</div>
      </section>
    `;
  }

  function renderAll() {
    const root = document.getElementById('results');
    if (!root || !STATE.data || !STATE.clinic) return;

    const { places } = STATE.data;
    const radius = STATE.radius;
    const types = STATE.typeFilters.size ? Array.from(STATE.typeFilters) : [];
    const tags  = STATE.tagFilters;

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

    const mins = (radius/80).toFixed(1);
    const miles = (radius * 0.000621371).toFixed(2); // radius is meters
    root.innerHTML = `
      <div class="header-compact">
        <div><strong>Clinic:</strong> ${STATE.clinic.name}</div>
        <div><strong>Radius:</strong> ~${mins} min (~${miles} mi)</div>
      </div>
      ${html || '<div class="card">No results match your filters.</div>'}
    `;
  }

  // Public API
  window.AsterGuide = { loadPlaces, getNearbyPlaces, renderAll, state: STATE };

  if (document.getElementById('results')) {
    loadPlaces();
  }
})();
