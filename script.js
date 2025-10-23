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
    selClinic.
