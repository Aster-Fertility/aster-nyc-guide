/**
 * Aster NYC Guide – nearest places engine
 * - Category + tag filters, nearby hotel/address search
 * - How to use + Method & Reliability modals
 * - Safe if a place lacks coords (shows without distance)
 */
(function () {
  const STATE = {
    data: null,
    clinic: null,
    radius: 1200,
    typeFilters: new Set(),
    tagFilters: new Set(),
    limitPerGroup: 8
  };

  console.log('Aster NYC Guide script loaded');

  // --- Distance helpers ---
  function haversine(lat1, lon1, lat2, lon2) {
    const R = 6371000, toRad = d => d * Math.PI / 180;
    const dLat = toRad(lat2 - lat1), dLon = toRad(lat2 - lon1);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }
  const metersToMiles = m => m * 0.000621371;
  const metersToWalkMins = m => Math.round(m / 80);

  // --- Data load ---
  function loadPlaces() {
    return fetch('places.json', { cache: 'no-cache' })
      .then(r => {
        if (!r.ok) throw new Error('Failed to fetch places.json');
        return r.json();
      })
      .then(json => {
        STATE.data = json;
        initUI();

        const clinics = Array.isArray(json.clinics) ? json.clinics : [];
        STATE.clinic = clinics[0] || null;

        renderAll();
      })
      .catch(err => {
        console.error(err);
        const el = document.getElementById('results');
        if (el) {
          el.innerHTML =
            '<div class="card error">Could not load curated data. Please ensure <code>places.json</code> is deployed next to this page and has <code>clinics</code> and <code>places</code> arrays.</div>';
        }
      });
  }

  // --- Nearby (hotel/address) helpers ---
  async function geocodeAddress(query) {
    const url =
      `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=us&bounded=1&viewbox=-74.05,40.92,-73.70,40.49&q=${encodeURIComponent(
        query
      )}`;
    const r = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error('Geocoding failed');
    const data = await r.json();
    if (!Array.isArray(data) || !data.length) throw new Error('No results');
    return { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) };
  }

  function renderNearbyFromCoords({ lat, lon, label }) {
    const out = document.getElementById('nearbyResults');
    const statusEl = document.getElementById('status');
    if (!out || !STATE.data) return;

    const pseudoClinic = {
      id: 'user-addr',
      name: label || 'Your location',
      lat,
      lon
    };

    const items = getNearbyPlaces({
      clinic: pseudoClinic,
      places: STATE.data.places,
      types: [], // all categories
      radiusMeters: STATE.radius,
      limit: 24,
      mustHaveTags: STATE.tagFilters
    });

    if (statusEl) {
      statusEl.textContent =
        `Showing ${items.length} curated places near “${label}”.`;
    }

    out.innerHTML = items.length
      ? `<section class="card">
           <h3 class="section-title">Nearby picks for: ${label}</h3>
           <div class="grid grid-gap">${items.map(renderCard).join('')}</div>
         </section>`
      : '<div class="card">No curated places within your current radius. Try increasing the slider or clearing filters.</div>';
  }

  // --- UI wiring ---
  function initUI() {
    const sel = document.getElementById('clinicSelect');
    if (sel && STATE.data && Array.isArray(STATE.data.clinics)) {
      sel.innerHTML =
        '<option value="">Select a clinic…</option>' +
        STATE.data.clinics
          .map(c => `<option value="${c.id}">${c.name}</option>`)
          .join('');

      if (STATE.data.clinics[0]) {
        sel.value = STATE.data.clinics[0].id;
      }

      sel.addEventListener('change', () => {
        STATE.clinic =
          STATE.data.clinics.find(c => c.id === sel.value) ||
          STATE.data.clinics[0] ||
          null;
        renderAll();
      });
    }

    const radius = document.getElementById('radiusInput');
    const radiusLabel = document.getElementById('radiusValue');

    function updateRadiusLabel() {
      if (!radius || !radiusLabel) return;
      const mins = (Number(radius.value || 1200) / 80).toFixed(1);
      radiusLabel.textContent = `~${mins} min`;
    }

    if (radius) {
      radius.value = String(STATE.radius);
      updateRadiusLabel();
      radius.addEventListener('input', () => {
