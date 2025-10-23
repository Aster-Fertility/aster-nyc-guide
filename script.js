// script.js — Aster NYC Guide (places.json only)

// -------------------------------
// Config & globals
// -------------------------------
const PLACES_URL = 'places.json';
const MAX_WALK_MIN = 10;                 // 10-minute walking radius
const WALK_MIN_PER_KM = 12.5;            // ~80 m/min ≈ 12.5 min/km
let ALL_PLACES = [];
let CLINICS = [];                        // array of clinic place objects
let lastGeocodeAt = 0;

// -------------------------------
// Helpers
// -------------------------------
const $ = sel => document.querySelector(sel);

function escapeHTML(s) {
  return String(s ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function haversineKm(aLat, aLon, bLat, bLon) {
  const toRad = d => d * Math.PI / 180;
  const R = 6371;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const s1 = Math.sin(dLat/2)**2 +
             Math.cos(toRad(aLat))*Math.cos(toRad(bLat))*Math.sin(dLon/2)**2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s1)));
}

function minutesFromKm(km) {
  return Math.round(km * WALK_MIN_PER_KM);
}

function fmtWalk(mins) {
  return `${mins} min walk`;
}

// Manhattan ZIP & bounds filter (addresses sometimes lack ZIPs)
function extractZip(addr) {
  if (!addr) return null;
  const m = String(addr).match(/\b1\d{4}\b/); // 1xxxx
  return m ? m[0] : null;
}
function isManhattanZip(zip) {
  return !!zip && (zip.startsWith('100') || zip.startsWith('101') || zip.startsWith('102'));
}
function isWithinManhattanBounds(lat, lon) {
  if (typeof lat !== 'number' || typeof lon !== 'number') return false;
  return (lat >= 40.680 && lat <= 40.882) && (lon >= -74.047 && lon <= -73.906);
}
function isInManhattan(place) {
  const zip = extractZip(place.address || '');
  if (isManhattanZip(zip)) return true;
  if (place.lat != null && place.lon != null) {
    return isWithinManhattanBounds(Number(place.lat), Number(place.lon));
  }
  return false;
}

// -------------------------------
// Category normalization (per your rules)
// -------------------------------
const MUSEUM_KEYWORDS = [
  'museum of modern art','moma','metropolitan museum','the met museum','met museum',
  'american museum of natural history','guggenheim'
];

function isMuseum(name) {
  const n = String(name).toLowerCase();
  return MUSEUM_KEYWORDS.some(k => n.includes(k));
}

function normalizeCategory(p) {
  const name = String(p.name || '').toLowerCase();
  const raw = String(p.type || '').toLowerCase();

  // Force moves based on name
  if (name.includes('magnolia bakery')) return 'Cafes & Bagels';
  if (name.includes('moma design store')) return 'Shopping';
  if (isMuseum(name)) return 'Museums';

  // Move bagels to Cafes & Bagels; cafés remain Cafes & Bagels
  if (raw === 'cafes') return 'Cafes & Bagels';
  if (raw === 'pizza_bagels') {
    if (name.includes('bagel') || name.includes('bakery') || name.includes('coffee')) {
      return 'Cafes & Bagels';
    }
    // else assume it's pizza
    return 'Restaurants';
  }

  // Move all pizza to Restaurants
  if (name.includes('pizza')) return 'Restaurants';

  // Hidden gems -> Shopping
  if (raw === 'hidden_gems') return 'Shopping';

  // Iconic -> Activities
  if (raw === 'iconic') return 'Activities';

  // Broadway / Comedy -> Activities
  if (raw === 'broadway_comedy') return 'Activities';

  // Activities stays Activities; restaurants stays Restaurants
  if (raw === 'restaurants') return 'Restaurants';
  if (raw === 'activities') return 'Activities';

  // Fallback buckets based on name hints
  if (name.includes('bagel') || name.includes('coffee') || name.includes('cafe')) {
    return 'Cafes & Bagels';
  }
  if (name.includes('store') || name.includes('market') || name.includes('boutique')) {
    return 'Shopping';
  }

  // Default bucket
  return 'Activities';
}

// -------------------------------
/** Group places by normalized category */
function groupByCategory(list) {
  const map = new Map();
  for (const p of list) {
    const cat = normalizeCategory(p);
    if (!map.has(cat)) map.set(cat, []);
    map.get(cat).push(p);
  }
  // Stable order for display
  const order = ['Cafes & Bagels', 'Restaurants', 'Shopping', 'Museums', 'Activities'];
  const out = [];
  for (const key of order) {
    if (map.has(key)) out.push([key, map.get(key)]);
  }
  // Append any extra categories if present
  for (const [k, v] of map.entries()) {
    if (!order.includes(k)) out.push([k, v]);
  }
  return out;
}

// -------------------------------
// Rendering
// -------------------------------
function renderNearbyResults(list) {
  const box = $('#nearbyResults');
  if (!box) return;

  if (!list.length) {
    box.innerHTML = `<p class="muted">No curated spots within a 10-minute walk in Manhattan for that location.</p>`;
    return;
  }

  const grouped = groupByCategory(list);
  let html = '';
  for (const [cat, items] of grouped) {
    html += `<div class="category-block"><h4>${escapeHTML(cat)}</h4><ul class="place-list">`;
    for (const p of items) {
      const mins = p.mins ?? '';
      html += `
        <li class="place-item">
          <div class="place-title">
            <a href="${escapeHTML(p.website || '#')}" target="_blank" rel="noopener">${escapeHTML(p.name)}</a>
          </div>
          <div class="place-meta">
            <span>${escapeHTML(p.address || '')}</span>
            ${mins ? `<span class="dot">•</span><span>${fmtWalk(mins)}</span>` : ''}
            ${p.clinic ? `<span class="dot">•</span><span class="badge">${escapeHTML(p.clinic)}</span>` : ''}
          </div>
        </li>`;
    }
    html += `</ul></div>`;
  }
  box.innerHTML = html;
}

function renderClinicResults(clinic, list) {
  const results = $('#results');
  if (!results) return;

  if (!list.length) {
    results.innerHTML = `<div class="card"><p class="muted">No curated spots within a 10-minute walk for ${escapeHTML(clinic.name)}.</p></div>`;
    return;
  }

  const grouped = groupByCategory(list);
  let html = `<div class="card"><h3 class="section-title">${escapeHTML(clinic.name)}</h3>`;
  html += `<p class="muted">${escapeHTML(clinic.address || '')}</p>`;
  for (const [cat, items] of grouped) {
    html += `<div class="category-block"><h4>${escapeHTML(cat)}</h4><ul class="place-list">`;
    for (const p of items) {
      html += `
        <li class="place-item">
          <div class="place-title">
            <a href="${escapeHTML(p.website || '#')}" target="_blank" rel="noopener">${escapeHTML(p.name)}</a>
          </div>
          <div class="place-meta">
            <span>${escapeHTML(p.address || '')}</span>
            <span class="dot">•</span><span>${fmtWalk(p.mins)}</span>
          </div>
        </li>`;
    }
    html += `</ul></div>`;
  }
  html += `</div>`;
  results.innerHTML = html;
}

// -------------------------------
// Data loading
// -------------------------------
async function loadPlaces() {
  const res = await fetch(PLACES_URL, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Failed to load ${PLACES_URL}`);
  const json = await res.json();
  if (!json || !Array.isArray(json.places)) throw new Error('Invalid places.json');
  ALL_PLACES = json.places.map(p => ({
    ...p,
    lat: Number(p.lat),
    lon: Number(p.lon)
  }));
  CLINICS = ALL_PLACES.filter(p => String(p.type).toLowerCase() === 'clinic');
}

// -------------------------------
// UI wiring
// -------------------------------
function populateClinicDropdown() {
  const sel = $('#clinicSelect');
  if (!sel) return;
  const sorted = [...CLINICS].sort((a,b) => a.name.localeCompare(b.name));
  sel.innerHTML = `<option value="">Select a clinic…</option>` +
    sorted.map(c => `<option value="${escapeHTML(c.name)}">${escapeHTML(c.name)}</option>`).join('');
}

function getClinicByName(name) {
  return CLINICS.find(c => c.name === name);
}

// Show curated locations (≤ 10 min walk) for a clinic
function showClinicCurated(clinic) {
  if (!clinic || clinic.lat == null || clinic.lon == null) {
    renderClinicResults(clinic || {name:'Clinic'}, []);
    return;
  }
  const near = ALL_PLACES
    .filter(p => p.clinic === clinic.name && p.type !== 'clinic')
    .map(p => {
      const km = haversineKm(clinic.lat, clinic.lon, p.lat, p.lon);
      return { ...p, km, mins: minutesFromKm(km) };
    })
    .filter(p => p.mins <= MAX_WALK_MIN)
    .sort((a,b) => a.km - b.km);

  renderClinicResults(clinic, near);
}

// Find all clinics (simple listing)
function showAllClinics() {
  const results = $('#results');
  if (!results) return;
  const items = [...CLINICS].sort((a,b)=>a.name.localeCompare(b.name))
    .map(c => `<li><strong>${escapeHTML(c.name)}</strong><br><span class="muted">${escapeHTML(c.address||'')}</span></li>`).join('');
  results.innerHTML = `<div class="card"><h3 class="section-title">All Clinics</h3><ul class="simple-list">${items}</ul></div>`;
}

// -------------------------------
// Geocoding (Nominatim) with retry/backoff & 1 req/sec pacing
// -------------------------------
async function geocodeQ(q) {
  // Respect 1 rps
  const now = Date.now();
  const diff = now - lastGeocodeAt;
  if (diff < 1100) await new Promise(r => setTimeout(r, 1100 - diff));

  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(q)}`;
  const res = await fetch(url, {
    headers: { 'Accept-Language': 'en' }
  });
  lastGeocodeAt = Date.now();
  if (!res.ok) throw new Error(`Geocode failed (${res.status})`);
  const arr = await res.json();
  if (!Array.isArray(arr) || !arr.length) throw new Error('No results');
  const { lat, lon } = arr[0];
  return { lat: Number(lat), lon: Number(lon) };
}

async function robustGeocode(q) {
  // Try: 1) raw input; 2) ensure ", New York, NY" if not present
  const tries = [];
  tries.push(q);
  const lower = String(q).toLowerCase();
  if (!/new york/.test(lower)) tries.push(`${q}, New York, NY`);
  if (!/usa|united states|ny\b|new york,? ny/i.test(lower)) tries.push(`${q}, New York, NY, USA`);

  let lastErr;
  for (let i=0; i<tries.length; i++) {
    try {
      return await geocodeQ(tries[i]);
    } catch (e) {
      lastErr = e;
      // backoff on 429/503-ish failures
      await new Promise(r => setTimeout(r, 1200 + i*800));
    }
  }
  throw lastErr || new Error('Geocode failed');
}

// -------------------------------
// Nearby search (hotel/address) — Manhattan + ≤ 10 min
// -------------------------------
async function handleNearby() {
  const input = $('#userAddress');
  const hint = $('#nearbyHint');
  const out = $('#nearbyResults');
  if (!input || !out) return;

  const q = input.value.trim();
  if (!q) {
    out.innerHTML = `<p class="muted">Please enter your hotel name or address.</p>`;
    return;
  }

  hint && (hint.textContent = 'Searching nearby…');

  try {
    // 1) geocode hotel
    const { lat, lon } = await robustGeocode(q);

    // 2) Manhattan-only places
    const manhattanOnly = ALL_PLACES.filter(isInManhattan);

    // 3) Compute distances, filter to ≤ 10 minutes
    const candidates = manhattanOnly
      .filter(p => isFinite(p.lat) && isFinite(p.lon) && p.type !== 'clinic')
      .map(p => {
        const km = haversineKm(lat, lon, p.lat, p.lon);
        return { ...p, km, mins: minutesFromKm(km) };
      })
      .filter(p => p.mins <= MAX_WALK_MIN)
      .sort((a,b) => a.km - b.km);

    renderNearbyResults(candidates);
    hint && (hint.textContent = 'Showing curated Manhattan locations within ~10 minutes on foot.');
  } catch (e) {
    console.warn('Nearby search error', e);
    out.innerHTML = `<p class="muted">We couldn’t find curated places near that address. Try entering the **hotel name** (e.g., “New York Hilton Midtown”) or a simpler address like “1335 6th Ave, New York, NY”.</p>`;
    hint && (hint.textContent = 'Tip: hotel names usually work best.');
  }
}

// -------------------------------
// Boot
// -------------------------------
async function init() {
  // Wire events
  $('#clinicSelect')?.addEventListener('change', e => {
    const name = e.target.value;
    if (!name) { $('#results').innerHTML = ''; return; }
    const clinic = getClinicByName(name);
    showClinicCurated(clinic);
  });

  $('#showAllBtn')?.addEventListener('click', showAllClinics);
  $('#nearbyBtn')?.addEventListener('click', handleNearby);
  $('#userAddress')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') handleNearby();
  });

  // Load data
  try {
    await loadPlaces();
    populateClinicDropdown();
  } catch (e) {
    console.error('Failed to initialize:', e);
    $('#results').innerHTML = `<div class="card"><p class="muted">Could not load curated data. Please ensure <code>places.json</code> is deployed next to this page.</p></div>`;
  }
}

document.addEventListener('DOMContentLoaded', init);
