/* Aster Fertility • NYC Clinic Concierge
   script.js — Robust JSON Loader + Geocode Bias + Distance Guard + In-App Updates
   - Loads nyc_fertility_locations.json as TEXT, sanitizes, then parses (fixes common JSON issues)
   - Bias Nominatim to US + clinic state (NY/NJ/CT)
   - If a place geocodes >300 km from clinic, retry with state hint; if still far, skip distances
   - Replaces NYU Langone entry and adds shopping/iconic items to all other clinics (de-duped)
   - Keeps directions links (Apple/Google), categories, and optional distance lines (toggle)
*/

'use strict';

let DATA = null;
let LOADED = false;
const ENABLE_DISTANCES = true; // set false to disable distance lookups

// ---------------- UI helpers ----------------
const $ = (s) => document.querySelector(s);
const $results = $('#results');
const $input = $('#query');
const $searchBtn = $('#searchBtn');
const $showAllBtn = $('#showAllBtn');
const $suggestions = $('#suggestions');

function banner(msg, type='info'){
  if(!$results) return;
  let el = document.getElementById('diagnostic-banner');
  if(!el){
    el = document.createElement('div');
    el.id = 'diagnostic-banner';
    el.style.cssText = 'margin:12px 0;padding:10px;border-radius:8px;font-size:14px';
    $results.parentElement.insertBefore(el, $results);
  }
  el.style.background = type==='error' ? '#fde2e1' : '#e7f3ff';
  el.style.color      = type==='error' ? '#912018' : '#0b69a3';
  el.textContent = msg;
}

// ---------------- Maps helpers ----------------
function isAppleMapsPreferred(){ return /iPad|iPhone|iPod|Macintosh/.test(navigator.userAgent); }
function mapsLink(address){ return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`; }
function mapsDirectionsLink(originAddress, destAddress, mode='driving'){
  if(!originAddress || !destAddress) return '';
  if(isAppleMapsPreferred()){
    const flag = mode === 'walking' ? 'w' : 'd';
    return `http://maps.apple.com/?saddr=${encodeURIComponent(originAddress)}&daddr=${encodeURIComponent(destAddress)}&dirflg=${flag}`;
  }
  return `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(originAddress)}&destination=${encodeURIComponent(destAddress)}&travelmode=${mode}`;
}

// ---------------- Distances (OSRM) with geocode bias ----------------
const NOMINATIM_BASE = 'https://nominatim.openstreetmap.org/search';
const OSRM = 'https://router.project-osrm.org/route/v1';
const sleep = (ms)=>new Promise(r=>setTimeout(r,ms));

// simple haversine (km)
function haversineKm(a, b){
  const toRad = d => d * Math.PI/180;
  const R=6371;
  const dLat = toRad((b.lat - a.lat));
  const dLon = toRad((b.lon - a.lon));
  const s1 = Math.sin(dLat/2)**2 + Math.cos(toRad(a.lat))*Math.cos(toRad(b.lat))*Math.sin(dLon/2)**2;
  return 2*R*Math.asin(Math.sqrt(s1));
}

// infer a state hint from the clinic address
function inferState(addr){
  if(!addr) return null;
  const m = addr.match(/\b(NY|NJ|CT)\b/i);
  return m ? m[1].toUpperCase() : null;
}

// Build a Nominatim URL with US bias and optional state hint
function nominatimUrl(q, stateHint){
  const params = new URLSearchParams({
    format: 'json',
    limit: '1',
    addressdetails: '0',
    countrycodes: 'us',
    q
  });
  // If we have a state hint, append to the query to bias the result
  if(stateHint && !q.match(/\b(NY|NJ|CT)\b/i)){
    params.set('q', `${q}, ${stateHint}, USA`);
  }
  return `${NOMINATIM_BASE}?${params.toString()}`;
}

async function geocodeBiased(address, stateHint){
  if(!ENABLE_DISTANCES || !address) return null;
  try{
    const key = `geo2:${address}|${stateHint||''}`;
    const cached = localStorage.getItem(key);
    if(cached) return JSON.parse(cached);

    await sleep(120); // be gentle to free service
    const res = await fetch(nominatimUrl(address, stateHint), { headers:{'Accept-Language':'en'} });
    if(!res.ok) return null;
    const data = await res.json();
    const pt = data && data[0] ? {lat:+data[0].lat, lon:+data[0].lon} : null;
    if(pt) localStorage.setItem(key, JSON.stringify(pt));
    return pt;
  }catch{ return null; }
}

async function osrmDuration(profile, from, to){
  if(!from || !to) return null;
  try{
    const url = `${OSRM}/${profile}/${from.lon},${from.lat};${to.lon},${to.lat}?overview=false`;
    const res = await fetch(url);
    if(!res.ok) return null; // avoid throwing; just skip
    const json = await res.json();
    const r = json.routes && json.routes[0];
    return r ? { seconds: r.duration, meters: r.distance } : null;
  }catch{ return null; }
}

function fmtMiles(m){ const mi = m/1609.344; return mi < 0.1 ? `${(mi*5280).toFixed(0)} ft` : `${mi.toFixed(1)} mi`; }
function fmtMins(s){ return `${Math.round(s/60)} min`; }

async function computeDistanceLine(clinicAddr, placeAddr){
  try{
    const clinicState = inferState(clinicAddr) || 'NY'; // default bias to NY
    const clinicPt = await geocodeBiased(clinicAddr, clinicState);
    if(!clinicPt) return '';

    // 1st attempt: bias by clinic state
    let placePt = await geocodeBiased(placeAddr, clinicState);
    if(!placePt) return '';

    // If the place is unreasonably far (>300 km), retry with a stronger hint
    let km = haversineKm(clinicPt, placePt);
    if(km > 300){
      // Retry: if clinic is NJ/CT, keep that; otherwise force NY
      const retryState = clinicState || 'NY';
      placePt = await geocodeBiased(`${placeAddr}`, retryState);
      if(!placePt) return '';
      km = haversineKm(clinicPt, placePt);
      if(km > 300){
        // Still far (e.g., matched Melbourne) -> skip routing to avoid OSRM 400
        return '';
      }
    }

    // Now safe to query OSRM
    const [walk, drive] = await Promise.all([
      osrmDuration('foot', clinicPt, placePt),
      osrmDuration('driving', clinicPt, placePt)
    ]);

    const meters = (walk || drive) ? (walk?.meters ?? drive?.meters) : null;
    const dist = meters ? fmtMiles(meters) : '';
    const w = walk ? `${fmtMins(walk.seconds)} walk` : '';
    const d = drive ? `${fmtMins(drive.seconds)} drive` : '';
    const parts = [dist, w, d].filter(Boolean).join(' • ');

    return parts ? `<div class="distance">Distance from clinic: <em>${parts}</em></div>` : '';
  }catch{
    return '';
  }
}

// ---------------- SAMPLE fallback ----------------
const SAMPLE = {
  clinics: [{
    name: "Weill Cornell Medicine (1305 York Ave)",
    address: "1305 York Ave, New York, NY 10021",
    website: "https://weillcornell.org",
    categories: {
      cafes: [{ name:"Maman UES", address:"1424 3rd Ave, New York, NY", website:"https://mamannyc.com" }],
      restaurants: [{ name:"Finestra", address:"1370 York Ave, New York, NY", website:"https://finestrarestaurant.com" }],
      pizza_bagels: [{ name:"Patsy’s Pizzeria (UES)", address:"206 E 60th St, New York, NY", website:"https://patsyspizzeria.us" }],
      hidden_gems: [{ name:"Levain Bakery (UES)", address:"1484 3rd Ave, New York, NY", website:"https://levainbakery.com" }],
      broadway_comedy: [{ name:"TKTS Lincoln Center (David Rubenstein Atrium)", address:"61 W 62nd St, New York, NY 10023", website:"https://www.tdf.org/discount-ticket-programs/tkts-by-tdf/tkts-live/" }],
      activities: [{ name:"The Met Museum", address:"1000 5th Ave, New York, NY", website:"https://metmuseum.org" }],
      iconic: [{ name:"MoMA – Museum of Modern Art", address:"11 W 53rd St, New York, NY", website:"https://www.moma.org" }]
    }
  }]
};

// ---------------- Category constants + helpers ----------------
const BAKERY_RE   = /(Levain|Magnolia|Dominique Ansel|Senza Gluten|Modern Bread|Erin McKenna|Bakery|Bagel)/i;

// UPDATED: include Chelsea Market + boutiques so they appear in "NYC Shopping"
const SHOPPING_RE = /(Fishs Eddy|MoMA Design Store|CityStore|Artists & Fleas|Pink Olive|Greenwich Letterpress|Mure \+ Grand|Transit Museum Store|NY Transit Museum Store|Chelsea Market|Vintage India|TTH Vintage|Artisans of New York|Rizzoli|Vintage Thrift)/i;

const ICONIC_GLOBAL = [
  {name:"Statue of Liberty & Ellis Island (Statue City Cruises)", address:"Battery Park, New York, NY", website:"https://www.cityexperiences.com/new-york/city-cruises/statue/"},
  {name:"9/11 Memorial & Museum (World Trade Center)", address:"180 Greenwich St, New York, NY", website:"https://www.911memorial.org"},
  {name:"NYC Ferry (Harbor sightseeing)", address:"Multiple piers citywide", website:"https://www.ferry.nyc"},
  {name:"Big Bus Tours NYC (Hop-on Hop-off)", address:"Citywide stops", website:"https://www.bigbustours.com/new-york"},
  {name:"TopView Sightseeing (Hop-on Hop-off)", address:"Citywide stops", website:"https://topviewnyc.com"}
];

const NAVIGATING = [
  {name:"MTA Subway Map & Guide", address:"Citywide", website:"https://new.mta.info/maps/subway", note:"OMNY contactless works on all subways and buses."},
  {name:"MTA Bus Map & Service", address:"Citywide", website:"https://new.mta.info/maps/bus"},
  {name:"Grand Central Terminal", address:"89 E 42nd St, New York, NY", website:"https://www.grandcentralterminal.com"},
  {name:"Penn Station (LIRR/Amtrak/NJ Transit)", address:"421 8th Ave, New York, NY", website:"https://www.amtrak.com/stations/nyp"}
];

function dedupeByName(list){
  const seen = new Set(); const out = [];
  for(const x of (list || [])){
    const k = (x?.name || '').toLowerCase();
    if(k && !seen.has(k)){ seen.add(k); out.push(x); }
  }
  return out;
}

// ---------------- In-app updates (NYU + Global adds) ----------------
function isNYUClinic(c){
  const n = (c?.name || '').toLowerCase();
  const a = (c?.address || '').toLowerCase();
  return n.includes('nyu langone') || a.includes('660 1st ave');
}
function mergeItems(targetArr, newItems){
  const names = new Set((targetArr || []).map(x => (x?.name || '').trim().toLowerCase()));
  const out = targetArr ? targetArr.slice() : [];
  for(const item of (newItems || [])){
    const k = (item?.name || '').trim().toLowerCase();
    if(k && !names.has(k)){ names.add(k); out.push(item); }
  }
  return out;
}
function applyNYUUpdate(db){
  if(!db?.clinics) return;
  const idx = db.clinics.findIndex(isNYUClinic);
  if(idx === -1) return;
  db.clinics[idx] = {
    name: "NYU Langone Fertility Center (Kips Bay)",
    address: "660 1st Ave, New York, NY 10016",
    website: "https://nyulangone.org/locations/fertility-center",
    categories: {
      cafes: [
        { name:"Qahwah Valley Cafe", address:"630 1st Ave, New York, NY 10016", phone:"(917) 939-0628", website:"https://www.qahwahvalley.com/", note:"Yemeni coffee favorites like Sana’ani and Adani chai in a relaxed spot." },
        { name:"Charlotte Cafe", address:"605 2nd Ave, New York, NY 10016", phone:"(347) 318-7107", website:"https://www.instagram.com/charlottecafeofficial/", note:"Cozy neighborhood café for espresso drinks, pastries, and light bites." },
        { name:"Gold Coffee", address:"491 3rd Ave, New York, NY 10016", phone:"", website:"https://www.instagram.com/the_gold_coffee_official/", note:"Bright Murray Hill coffee bar; quick grab-and-go near the clinic." }
      ],
      restaurants: [
        { name:"Garlic New York Pizza Bar", address:"629 2nd Ave, New York, NY 10016", phone:"(646) 559-9500", website:"https://www.garlicnewyorkpizza.com/", note:"Neighborhood pizzeria known for garlicky pies and Sicilian slices." },
        { name:"Hole in the Wall – Murray Hill", address:"445 E 35th St, New York, NY 10016", phone:"(646) 858-0401", website:"https://holeinthewallnyc.com/murray-hill", note:"Australian-inspired café/restaurant—brunch through dinner." },
        { name:"Little Alley", address:"550 3rd Ave, New York, NY 10016", phone:"(646) 998-3976", website:"https://www.littlealley.nyc/", note:"Beloved Shanghainese spot—don’t miss the soup dumplings and noodles." },
        { name:"Lena’s Italian Kitchen (Kips Bay)", address:"551 2nd Ave, New York, NY 10016", phone:"(646) 846-5362", website:"https://www.lenasitaliankitchen.com/", note:"Comfort Italian pastas, parm heroes, and salads—easy for takeout." }
      ],
      pizza_bagels: [],
      hidden_gems: [
        { name:"Chelsea Market", address:"75 9th Ave, New York, NY 10011", phone:"", website:"https://www.chelseamarket.com/", note:"Iconic indoor food & retail hall—perfect for grazing and gift shopping." },
        { name:"Vintage India NYC", address:"132 Lexington Ave, New York, NY 10016", phone:"(212) 213-0080", website:"https://vintageindianyc.com/", note:"South Asian formalwear, kurtas, and accessories—great for special occasions." },
        { name:"TTH Vintage Boutique (NoMad)", address:"40 W 25th St, New York, NY 10010", phone:"(212) 206-1174", website:"https://www.tthvintageboutique.org/", note:"Nonprofit vintage boutique; proceeds support programs for homeless mothers." },
        { name:"Artisans of New York (Seasonal @ Bryant Park Holiday Shops)", address:"41 W 40th St, New York, NY 10018", phone:"(631) 831-1831", website:"https://www.artisansofny.com/", note:"Glass art & gift kiosk at the Holiday Shops (typically Oct–Jan)." },
        { name:"Rizzoli Bookstore (NoMad)", address:"1133 Broadway, New York, NY 10010", phone:"(212) 759-2424", website:"https://www.rizzolibookstore.com/", note:"Gorgeous flagship bookstore for art, design, and illustrated titles." },
        { name:"Vintage Thrift Shop (Gramercy)", address:"286 3rd Ave, New York, NY 10010", phone:"(212) 871-0777", website:"https://www.vintagethriftshop.org/", note:"Nonprofit thrift with clothing, housewares, and vintage finds." }
      ],
      broadway_comedy: [],
      iconic: [
        { name:"Edge (Hudson Yards)", address:"30 Hudson Yards, New York, NY 10001", phone:"(332) 204-8500", website:"https://www.edgenyc.com/", note:"100-story outdoor sky deck with a glass floor and sweeping views." },
        { name:"Central Park", address:"59th–110th St, Fifth Ave–Central Park West, New York, NY", phone:"(212) 310-6600", website:"https://www.centralparknyc.org/", note:"NYC’s iconic 843-acre park with lawns, lakes, and scenic loops." }
      ]
    }
  };
}
const GLOBAL_SHOPPING = [
  { name:"Chelsea Market", address:"75 9th Ave, New York, NY 10011", phone:"", website:"https://www.chelseamarket.com/", note:"Iconic indoor food & retail hall—perfect for grazing and gift shopping." },
  { name:"Rizzoli Bookstore (NoMad)", address:"1133 Broadway, New York, NY 10010", phone:"(212) 759-2424", website:"https://www.rizzolibookstore.com/", note:"Gorgeous flagship bookstore for art, design, and illustrated titles." },
  { name:"Vintage Thrift Shop (Gramercy)", address:"286 3rd Ave, New York, NY 10010", phone:"(212) 871-0777", website:"https://www.vintagethriftshop.org/", note:"Nonprofit thrift with clothing, housewares, and vintage finds." },
  { name:"Vintage India NYC", address:"132 Lexington Ave, New York, NY 10016", phone:"(212) 213-0080", website:"https://vintageindianyc.com/", note:"South Asian formalwear, kurtas, and accessories—great for special occasions." },
  { name:"TTH Vintage Boutique (NoMad)", address:"40 W 25th St, New York, NY 10010", phone:"(212) 206-1174", website:"https://www.tthvintageboutique.org/", note:"Nonprofit vintage boutique; proceeds support programs for homeless mothers." },
  { name:"Artisans of New York (Seasonal @ Bryant Park Holiday Shops)", address:"41 W 40th St, New York, NY 10018", phone:"(631) 831-1831", website:"https://www.artisansofny.com/", note:"Glass art & gift kiosk at the Holiday Shops (typically Oct–Jan)." }
];
const GLOBAL_ICONIC = [
  { name:"Edge (Hudson Yards)", address:"30 Hudson Yards, New York, NY 10001", phone:"(332) 204-8500", website:"https://www.edgenyc.com/", note:"100-story outdoor sky deck with a glass floor and sweeping views." },
  { name:"Central Park", address:"59th–110th St, Fifth Ave–Central Park West, New York, NY", phone:"(212) 310-6600", website:"https://www.centralparknyc.org/", note:"NYC’s iconic 843-acre park with lawns, lakes, and scenic loops." }
];
function applyGlobalEnhancements(db){
  if(!db?.clinics) return;
  for(const clinic of db.clinics){
    if(isNYUClinic(clinic)) continue;
    clinic.categories = clinic.categories || {};
    clinic.categories.hidden_gems = clinic.categories.hidden_gems || [];
    clinic.categories.iconic = clinic.categories.iconic || clinic.categories.activities || [];
    clinic.categories.hidden_gems = mergeItems(clinic.categories.hidden_gems, GLOBAL_SHOPPING);
    clinic.categories.iconic = mergeItems(clinic.categories.iconic, GLOBAL_ICONIC);
    clinic.categories.hidden_gems = dedupeByName(clinic.categories.hidden_gems);
    clinic.categories.iconic = dedupeByName(clinic.categories.iconic);
  }
}

// ---------------- remapClinicCategories (hoisted & global) ----------------
function remapClinicCategories(c){
  const cats = c?.categories || {};
  const cafes = cats.cafes || [];
  const restaurants = cats.restaurants || [];
  const pizza = cats.pizza_bagels || [];
  const hidden = cats.hidden_gems || [];
  const broadway = cats.broadway_comedy || [];
  const iconicExisting = cats.iconic || cats.activities || [];

  const bakeriesFromHidden = hidden.filter(x => BAKERY_RE.test(x?.name || ''));
  const shoppingFromHidden = hidden.filter(x => SHOPPING_RE.test(x?.name || ''));

  const cafes_bakeries = dedupeByName([...cafes, ...bakeriesFromHidden]);
  const nyc_shopping   = dedupeByName(shoppingFromHidden);
  const iconic_mustsees= dedupeByName([...iconicExisting, ...ICONIC_GLOBAL]);

  return {
    cafes_bakeries,
    restaurants,
    pizza_bagels: pizza,
    nyc_shopping,
    broadway_comedy: broadway,
    iconic_mustsees,
    navigating: NAVIGATING
  };
}
window.remapClinicCategories = remapClinicCategories;

// ---------------- Rendering ----------------
function itemHTML(it, clinicAddress){
  const name  = it?.name || 'Unnamed';
  const addr  = it?.address || '';
  const phone = it?.phone || '';
  const site  = it?.website || '';
  const note  = it?.note || '';

  const links = [
    site ? `<a href="${site}" target="_blank" rel="noopener">Website</a>` : '',
    addr ? `<a href="${mapsLink(addr)}" target="_blank" rel="noopener">Open in Maps</a>` : '',
    addr ? `<a href="${mapsDirectionsLink(clinicAddress, addr, 'driving')}" target="_blank" rel="noopener">Directions (Drive)</a>` : '',
    addr ? `<a href="${mapsDirectionsLink(clinicAddress, addr, 'walking')}" target="_blank" rel="noopener">Directions (Walk)</a>` : ''
  ].filter(Boolean).join(' • ');

  const distanceDiv = (ENABLE_DISTANCES && addr)
    ? `<div class="distance" data-dist-for="${encodeURIComponent(addr)}"></div>`
    : '';

  return `
    <div class="item card">
      <h4>${name}</h4>
      ${addr ? `<p>${addr}${phone ? ` • ${phone}` : ''}</p>` : (phone ? `<p>${phone}</p>` : '')}
      ${links ? `<p>${links}</p>` : ''}
      ${note ? `<p>${note}</p>` : ''}
      ${distanceDiv}
    </div>
  `;
}
function sectionHTML(title, list, clinicAddress){
  if(!list || !list.length) return '';
  return `
    <div class="card">
      <h3 class="section-title">${title}</h3>
      <div class="grid">
        ${list.map(it => itemHTML(it, clinicAddress)).join('')}
      </div>
    </div>
  `;
}
function renderClinic(clinic){
  const m = remapClinicCategories(clinic);
  const head = `
    <div class="card">
      <h2>${clinic.name} <span class="badge">Clinic</span></h2>
      <p>${clinic.address} • <a href="${clinic.website}" target="_blank" rel="noopener">Website</a> • <a href="${mapsLink(clinic.address)}" target="_blank" rel="noopener">Open in Maps</a></p>
    </div>
  `;
  return head + [
    sectionHTML('Cafés & Bakeries', m.cafes_bakeries, clinic.address),
    sectionHTML('Restaurants', m.restaurants, clinic.address),
    sectionHTML('Pizza & Bagels', m.pizza_bagels, clinic.address),
    sectionHTML('NYC Shopping', m.nyc_shopping, clinic.address),
    sectionHTML('Broadway & Comedy', m.broadway_comedy, clinic.address),
    sectionHTML('Iconic NYC Must Sees', m.iconic_mustsees, clinic.address),
    sectionHTML('Navigating NYC', m.navigating, clinic.address),
  ].join('');
}

async function fillDistancesFor(clinic, container){
  if(!ENABLE_DISTANCES) return;
  const nodes = container.querySelectorAll('.distance[data-dist-for]');
  for(const el of nodes){
    const addr = decodeURIComponent(el.getAttribute('data-dist-for') || '');
    if(!addr){ el.remove(); continue; }
    const line = await computeDistanceLine(clinic.address, addr);
    el.outerHTML = line || '';
  }
}

// ---------------- JSON sanitizer ----------------
function sanitizeJsonText(text){
  if(typeof text !== 'string') return text;
  // Remove BOM
  let t = text.replace(/^\uFEFF/, '');
  // Remove /* block comments */ and // line comments
  t = t.replace(/\/\*[\s\S]*?\*\//g, '');
  t = t.replace(/(^|\s)\/\/[^\n\r]*/g, '$1');
  // Remove trailing commas before } or ]
  t = t.replace(/,\s*([}\]])/g, '$1');
  // Trim whitespace
  return t.trim();
}

function safeParseJson(text){
  try{
    return JSON.parse(text);
  }catch(e){
    console.warn('JSON.parse failed, attempting sanitization:', e?.message);
    const cleaned = sanitizeJsonText(text);
    const parsed = JSON.parse(cleaned); // throws if still bad
    console.warn('JSON required sanitization (comments/trailing commas removed).');
    return parsed;
  }
}

// ---------------- Data loading ----------------
async function loadData(){
  try{
    let res = await fetch('nyc_fertility_locations.json');
    if(!res.ok) res = await fetch('/nyc_fertility_locations.json');
    if(!res.ok){
      DATA = SAMPLE; LOADED = true;
      banner('Loaded SAMPLE data (nyc_fertility_locations.json not found).', 'error');
      // Apply in-app updates even to SAMPLE (if structure allows)
      applyNYUUpdate(DATA);
      applyGlobalEnhancements(DATA);
      return;
    }

    // Read as TEXT so we can sanitize common JSON issues
    const rawText = await res.text();
    let json;
    try{
      json = safeParseJson(rawText);
    }catch(parseErr){
      console.error('Sanitized JSON still invalid:', parseErr);
      DATA = SAMPLE; LOADED = true;
      banner('Your nyc_fertility_locations.json has a formatting error. Loaded SAMPLE data so the app still works. Open console for details.', 'error');
      applyNYUUpdate(DATA);
      applyGlobalEnhancements(DATA);
      return;
    }

    if(!json || !Array.isArray(json.clinics)){
      DATA = SAMPLE; LOADED = true;
      banner('Loaded SAMPLE data (JSON must be { "clinics": [...] }).', 'error');
      applyNYUUpdate(DATA);
      applyGlobalEnhancements(DATA);
      return;
    }
    DATA = json; LOADED = true;
    // Apply updates on top of real data
    applyNYUUpdate(DATA);
    applyGlobalEnhancements(DATA);
    banner(`Loaded ${DATA.clinics.length} clinics • Distances: ${ENABLE_DISTANCES ? 'ON' : 'OFF'}`, 'info');
  }catch(e){
    DATA = SAMPLE; LOADED = true;
    banner('Loaded SAMPLE data (unexpected fetch error). See console.', 'error');
    console.error(e);
    applyNYUUpdate(DATA);
    applyGlobalEnhancements(DATA);
  }
}

// ---------------- Search / UI ----------------
function filterClinics(q){
  const needle = q.toLowerCase();
  return (DATA.clinics || []).filter(c =>
    (c?.name || '').toLowerCase().includes(needle) ||
    (c?.address || '').toLowerCase().includes(needle)
  );
}

async function doSearch(){
  if(!LOADED) await loadData();
  const input = document.querySelector('#query');
  const results = document.querySelector('#results');
  if(!results) return;

  const q = (input?.value || '').trim();
  let list = DATA.clinics || [];
  if(q) list = filterClinics(q);

  if(!q){
    results.innerHTML = `<div class="card"><p>Type a clinic name (e.g., “Weill Cornell”, “RMA”, “CCRM”) or an address, then press Enter or Search.</p></div>`;
    return;
  }
  if(!list.length){
    results.innerHTML = `<div class="card"><p>No clinics matched “${q}”. Try “1305 York” or “NYU Langone”.</p></div>`;
    return;
  }

  results.innerHTML = list.map(renderClinic).join('');
  for(const clinic of list){ await fillDistancesFor(clinic, results); }
}

async function showAll(){
  if(!LOADED) await loadData();
  const results = document.querySelector('#results');
  if(!results) return;
  const list = DATA.clinics || [];
  results.innerHTML = list.map(renderClinic).join('');
  for(const clinic of list){ await fillDistancesFor(clinic, results); }
}

// ---------------- Init ----------------
window.addEventListener('DOMContentLoaded', async () => {
  const results = document.querySelector('#results');
  if(results){
    results.innerHTML = `<div class="card"><p>Enter your clinic to find cafés, restaurants, treats, and gentle activities nearby.</p></div>`;
  }

  await loadData();

  const searchBtn = document.querySelector('#searchBtn');
  if(searchBtn){
    searchBtn.addEventListener('click', (e)=>{ e.preventDefault(); e.stopPropagation(); doSearch(); });
    if(!searchBtn.getAttribute('type')) searchBtn.setAttribute('type','button');
  }

  const form = document.querySelector('form') || document.querySelector('#searchForm');
  if(form){
    form.addEventListener('submit', (e)=>{ e.preventDefault(); e.stopPropagation(); doSearch(); return false; });
  }

  const input = document.querySelector('#query');
  if(input){
    input.addEventListener('keydown', (e)=>{ if(e.key==='Enter'){ e.preventDefault(); doSearch(); } });
  }

  const showAllBtn = document.querySelector('#showAllBtn');
  if(showAllBtn){
    showAllBtn.addEventListener('click', (e)=>{ e.preventDefault(); e.stopPropagation(); showAll(); });
    if(!showAllBtn.getAttribute('type')) showAllBtn.setAttribute('type','button');
  }

  if($suggestions && DATA?.clinics){
    $suggestions.textContent = `Clinics: ${DATA.clinics.map(c => c.name).join(' · ')}`;
  }
});
