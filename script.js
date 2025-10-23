/* ========= BASIC APP STATE ========= */
let PLACES = [];      // from places.json (POIs)
let DATA = null;      // optional nyc_fertility_locations.json if you use elsewhere
const geocodeCache = new Map();

/* ========= UTIL ========= */
const sleep = ms => new Promise(r => setTimeout(r, ms));
const pFloat = v => Number.parseFloat(v);

function normalizeQuery(q) {
  return (q || '')
    .toString()
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\b(floor|fl|suite|ste|apt|#)\b.*$/i, '') // strip unit info
    .toLowerCase();
}

/* ========= FETCH WITH BACKOFF ========= */
async function fetchWithBackoff(url, {retries=3, baseDelay=700, timeoutMs=9000, headers={}} = {}) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: controller.signal, headers: { 'Accept': 'application/json', ...headers }});
      clearTimeout(timer);
      if (res.ok) return res;

      if ((res.status === 429 || res.status === 503) && attempt < retries) {
        await sleep(baseDelay * Math.pow(2, attempt)); // 700, 1400, 2800ms
        continue;
      }
      const txt = await res.text().catch(()=> '');
      throw new Error(`HTTP ${res.status}${txt ? `: ${txt.slice(0,120)}` : ''}`);
    } catch (err) {
      clearTimeout(timer);
      if ((err.name === 'AbortError' || /network|fetch/i.test(err.message)) && attempt < retries) {
        await sleep(baseDelay * Math.pow(2, attempt));
        continue;
      }
      throw err;
    }
  }
  throw new Error('Exhausted retries');
}

/* ========= LOCAL LOOKUP ========= */
function findLocalCoords(query) {
  const q = normalizeQuery(query);
  if (!q || !PLACES.length) return null;

  // exact name
  let hit = PLACES.find(p => p.name && p.name.toLowerCase() === q && Number.isFinite(p.lat) && Number.isFinite(p.lon));
  if (hit) return { lat: pFloat(hit.lat), lon: pFloat(hit.lon) };

  // exact address
  hit = PLACES.find(p => p.address && normalizeQuery(p.address) === q && Number.isFinite(p.lat) && Number.isFinite(p.lon));
  if (hit) return { lat: pFloat(hit.lat), lon: pFloat(hit.lon) };

  // substring match (name or address)
  hit = PLACES.find(p =>
    ((p.name && p.name.toLowerCase().includes(q)) || (p.address && normalizeQuery(p.address).includes(q)))
    && Number.isFinite(p.lat) && Number.isFinite(p.lon)
  );
  if (hit) return { lat: pFloat(hit.lat), lon: pFloat(hit.lon) };

  return null;
}

/* ========= GEOCODER =========
   Recommended: run a tiny server proxy at /api/geocode to call Nominatim with a proper User-Agent.
   Fallback uses direct Nominatim w/ backoff; may 503 during load.
*/
const GEOCODER_MODE = 'proxy'; // 'proxy' | 'nominatim' | 'mapbox' | 'google'

async function geocodeAddress(query) {
  const q = (query || '').toString().trim();
  if (!q) throw new Error('Please enter a place or address');

  // Local first
  const local = findLocalCoords(q);
  if (local) return local;

  // Cache
  if (geocodeCache.has(q)) return geocodeCache.get(q);

  let url, headers = {};
  if (GEOCODER_MODE === 'proxy') {
    url = `/api/geocode?q=${encodeURIComponent(q)}&limit=1`;
  } else if (GEOCODER_MODE === 'mapbox') {
    const MAPBOX_TOKEN = 'YOUR_MAPBOX_TOKEN';
    url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json?limit=1&access_token=${MAPBOX_TOKEN}`;
  } else if (GEOCODER_MODE === 'google') {
    const GOOGLE_KEY = 'YOUR_GOOGLE_KEY';
    url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(q)}&key=${GOOGLE_KEY}`;
  } else {
    url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(q)}`;
  }

  const res = await fetchWithBackoff(url, { headers, retries: 3, baseDelay: 800, timeoutMs: 9000 });
  const data = await res.json();

  let lat, lon;
  if (Array.isArray(data) && data.length) {
    lat = pFloat(data[0].lat); lon = pFloat(data[0].lon);
  } else if (GEOCODER_MODE === 'mapbox' && data.features?.[0]) {
    lon = data.features[0].center[0]; lat = data.features[0].center[1];
  } else if (GEOCODER_MODE === 'google' && data.results?.[0]) {
    lat = data.results[0].geometry.location.lat;
    lon = data.results[0].geometry.location.lng;
  }

  if (Number.isFinite(lat) && Number.isFinite(lon)) {
    const out = { lat, lon };
    geocodeCache.set(q, out);
    return out;
  }
  throw new Error('No geocode results found');
}

/* ========= STATUS UI ========= */
function setStatus(msg) {
  const el = document.getElementById('status');
  if (el) el.textContent = msg || '';
}

/* ========= NEARBY MATCHING ========= */
function getPlacesNear(lat, lon, { radiusMeters = 1200 } = {}) {
  if (!PLACES || !PLACES.length) return [];
  const toMeters = (la1, lo1, la2, lo2) => {
    const R = 6371000;
    const x = (pFloat(lo2) - pFloat(lo1)) * Math.cos((pFloat(la1)+pFloat(la2))*Math.PI/360) * Math.PI/180;
    const y = (pFloat(la2) - pFloat(la1)) * Math.PI/180;
    return Math.sqrt((x*R)*(x*R) + (y*R)*(y*R));
  };
  return PLACES
    .map(p => {
      if (!Number.isFinite(p.lat) || !Number.isFinite(p.lon)) return null;
      const d = toMeters(lat, lon, p.lat, p.lon);
      return { ...p, distanceMeters: d };
    })
    .filter(Boolean)
    .filter(p => p.distanceMeters <= radiusMeters)
    .sort((a,b)=> a.distanceMeters - b.distanceMeters);
}

function renderResults(items) {
  const box = document.getElementById('results');
  if (!box) return;
  if (!items || !items.length) { box.innerHTML = '<p>No nearby places found.</p>'; return; }
  const fmt = m => (m > 999 ? (m/1000).toFixed(1)+' km' : Math.round(m)+' m');
  box.innerHTML = items.slice(0, 30).map(p => `
    <div class="result">
      <div class="title">${p.name}</div>
      <div class="meta">${p.address || ''}</div>
      <div class="meta">${p.type || ''} • ${fmt(p.distanceMeters)}</div>
      ${p.website ? `<a href="${p.website}" target="_blank" rel="noopener">Website</a>` : ''}
    </div>
  `).join('');
}

/* ========= MAIN SEARCH HANDLER ========= */
async function onSearch(query) {
  setStatus('Searching…');
  try {
    const { lat, lon } = await geocodeAddress(query);
    setStatus('Matching places nearby…');
    const matches = getPlacesNear(lat, lon);
    renderResults(matches);
    setStatus(matches.length ? '' : 'No nearby places found.');
  } catch (e) {
    console.error(e);
    const msg = /HTTP 503|Exhausted|No geocode/i.test(e.message)
      ? 'Geocoding is busy or returned nothing. Try a shorter address or name.'
      : e.message;
    setStatus(msg);
  }
}

/* ========= LOADERS ========= */
async function loadJSON(urls) {
  for (const u of urls) {
    try {
      const res = await fetch(u);
      if (res.ok) return await res.json();
    } catch (_) {}
  }
  return null;
}

function dedupeByNameAddress(list) {
  const seen = new Set();
  return (list || []).filter(p => {
    const key = `${(p.name||'').toLowerCase()}|${(p.address||'').toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function boot() {
  // Load places/POIs only
  const places = await loadJSON(['places.json', '/places.json']);
  PLACES = dedupeByNameAddress(places?.places || []);

  // Optional: load clinics JSON if your UI still uses it
  DATA = await loadJSON(['nyc_fertility_locations.json', '/nyc_fertility_locations.json']);

  // Wire events
  const btn = document.getElementById('hotelSearchBtn');
  const input = document.getElementById('hotelInput');
  if (btn && input) {
    btn.addEventListener('click', () => onSearch(input.value));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') onSearch(input.value);
    });
  }
}

document.addEventListener('DOMContentLoaded', boot);
