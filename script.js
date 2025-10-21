/* Aster Fertility • NYC Clinic Concierge
   script.js — Consolidated + Fixed (remapClinicCategories hoisted & global)
   - Directions links (Apple/Google) clinic -> place
   - Optional distance from clinic (toggle ENABLE_DISTANCES)
   - New categories & robust JSON loading with fallback + diagnostics
*/

let DATA = null;
let LOADED = false;
const ENABLE_DISTANCES = true; // set to false to disable distance lookups (useful for rate limits)

// ================== Diagnostics banner ==================
function banner(msg, type = 'info'){
  const id = 'diagnostic-banner';
  const results = document.querySelector('#results');
  if(!results) return;
  let el = document.getElementById(id);
  if(!el){
    el = document.createElement('div');
    el.id = id;
    el.style.cssText = 'margin:12px 0;padding:10px;border-radius:8px;font-size:14px';
    results.parentElement.insertBefore(el, results);
  }
  const bg = type === 'error' ? '#fde2e1' : '#e7f3ff';
  const fg = type === 'error' ? '#912018' : '#0b69a3';
  el.style.background = bg;
  el.style.color = fg;
  el.innerText = msg;
}
function showError(msg){ banner(msg, 'error'); console.error(msg); }

// ================== Maps helpers ==================
function isAppleMapsPreferred(){ return /iPad|iPhone|iPod|Macintosh/.test(navigator.userAgent); }
function mapsLink(address){
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}
function mapsDirectionsLink(originAddress, destAddress, mode = 'driving'){
  if(!originAddress || !destAddress) return '';
  if(isAppleMapsPreferred()){
    const flag = mode === 'walking' ? 'w' : 'd';
    return `http://maps.apple.com/?saddr=${encodeURIComponent(originAddress)}&daddr=${encodeURIComponent(destAddress)}&dirflg=${flag}`;
  }
  return `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(originAddress)}&destination=${encodeURIComponent(destAddress)}&travelmode=${mode}`;
}

// ================== Distances (no API key; optional) ==================
const NOMINATIM = 'https://nominatim.openstreetmap.org/search?format=json&limit=1&q=';
const OSRM = 'https://router.project-osrm.org/route/v1';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function geocode(address){
  if(!ENABLE_DISTANCES || !address) return null;
  try{
    const key = 'geo:' + address;
    const cached = localStorage.getItem(key);
    if(cached) return JSON.parse(cached);
    await sleep(120); // be kind to the free service
    const res = await fetch(NOMINATIM + encodeURIComponent(address), { headers:{'Accept-Language':'en'} });
    if(!res.ok) return null;
    const d = await res.json();
    const pt = d && d[0] ? {lat:+d[0].lat, lon:+d[0].lon} : null;
    if(pt) localStorage.setItem(key, JSON.stringify(pt));
    return pt;
  }catch{ return null; }
}
async function osrmDuration(profile, from, to){
  if(!ENABLE_DISTANCES || !from || !to) return null;
  try{
    const url = `${OSRM}/${profile}/${from.lon},${from.lat};${to.lon},${to.lat}?overview=false`;
    const res = await fetch(url);
    if(!res.ok) return null;
    const json = await res.json();
    const r = json.routes && json.routes[0];
    return r ? { seconds:r.duration, meters:r.distance } : null;
  }catch{ return null; }
}
function fmtMiles(m){ const mi = m/1609.344; return mi < 0.1 ? `${(mi*5280).toFixed(0)} ft` : `${mi.toFixed(1)} mi`; }
function fmtMins(s){ return `${Math.round(s/60)} min`; }
async function computeDistanceLine(fromAddr, toAddr){
  try{
    const [a,b] = await Promise.all([geocode(fromAddr), geocode(toAddr)]);
    if(!a || !b) return '';
    const [walk, drive] = await Promise.all([osrmDuration('foot', a, b), osrmDuration('driving', a, b)]);
    const meters = (walk || drive) ? (walk?.meters ?? drive?.meters) : null;
    const dist = meters ? fmtMiles(meters) : '';
    const w = walk ? `${fmtMins(walk.seconds)} walk` : '';
    const d = drive ? `${fmtMins(drive.seconds)} drive` : '';
    const parts = [dist, w, d].filter(Boolean).join(' • ');
    return parts ? `<div class="distance">Distance from clinic: <em>${parts}</em></div>` : '';
  }catch{ return ''; }
}

// ================== Fallback SAMPLE (used if JSON missing/invalid) ==================
const SAMPLE = {
  clinics: [
    {
      name: "Weill Cornell Medicine (1305 York Ave)",
      address: "1305 York Ave, New York, NY 10021",
      website: "https://weillcornell.org",
      categories: {
        cafes: [
          {"name":"Maman UES","address":"1424 3rd Ave, New York, NY","website":"https://mamannyc.com"},
          {"name":"Bluestone Lane (UES Café)","address":"2 E 90th St, New York, NY","website":"https://bluestonelane.com"}
        ],
        restaurants: [
          {"name":"Finestra","address":"1370 York Ave, New York, NY","website":"https://finestrarestaurant.com"}
        ],
        pizza_bagels: [
          {"name":"Patsy’s Pizzeria (UES)","address":"206 E 60th St, New York, NY","website":"https://patsyspizzeria.us"}
        ],
        hidden_gems: [
          {"name":"Levain Bakery (UES)","address":"1484 3rd Ave, New York, NY","website":"https://levainbakery.com"},
          {"name":"MoMA Design Store (Midtown)","address":"44 W 53rd St, New York, NY","website":"https://store.moma.org"}
        ],
        broadway_comedy: [
          {"name":"TKTS Lincoln Center (David Rubenstein Atrium)","address":"61 W 62nd St, New York, NY 10023","website":"https://www.tdf.org/discount-ticket-programs/tkts-by-tdf/tkts-live/"}
        ],
        activities: [
          {"name":"The Met Museum","address":"1000 5th Ave, New York, NY","website":"https://metmuseum.org"}
        ],
        iconic: [
          {"name":"MoMA – Museum of Modern Art","address":"11 W 53rd St, New York, NY","website":"https://www.moma.org"}
        ]
      }
    }
  ]
};

// ================== Category constants ==================
const BAKERY_RE  = /(Levain|Magnolia|Dominique Ansel|Senza Gluten|Modern Bread|Erin McKenna|Bakery|Bagel)/i;
const SHOPPING_RE = /(Fishs Eddy|MoMA Design Store|CityStore|Artists & Fleas|Pink Olive|Greenwich Letterpress|Mure \+ Grand|Transit Museum Store|NY Transit Museum Store)/i;

const ICONIC_GLOBAL = [
  {name:"Statue of Liberty & Ellis Island (Statue City Cruises)", address:"Battery Park, New York, NY", website:"https://www.cityexperiences.com/new-york/city-cruises/statue/"},
  {name:"9/11 Memorial & Museum (World Trade Center)", address:"180 Greenwich St, New York, NY", website:"https://www.911memorial.org"},
  {name:"NYC Ferry (Harbor sightseeing)", address:"Multiple piers citywide", website:"https://www.ferry.nyc"},
  {name:"Big Bus Tours NYC (Hop-on Hop-off)", address:"Citywide stops", website:"https://www.bigbustours.com/new-york"},
  {name:"TopView Sightseeing (Hop-on Hop-off)", address:"Citywide stops", website:"https://topviewnyc.com"}
];

const NAVIGATING = [
  {name:"MTA Subway Map & Guide", address:"Citywide", website:"https://new.mta.info/maps/subway", note:"Tip: OMNY contactless works on all subways and buses."},
  {name:"MTA Bus Map & Service", address:"Citywide", website:"https://new.mta.info/maps/bus"},
  {name:"Grand Central Terminal", address:"89 E 42nd St, New York, NY", website:"https://www.grandcentralterminal.com"},
  {name:"Penn Station (LIRR/Amtrak/NJ Transit)", address:"421 8th Ave, New York, NY", website:"https://www.amtrak.com/stations/nyp"}
];

// ================== Dedupe helper ==================
function dedupeByName(list){
  const seen = new Set(); const out = [];
  for(const x of (list || [])){
    const k = (x?.name || '').toLowerCase();
    if(k && !seen.has(k)){ seen.add(k); out.push(x); }
  }
  return out;
}

// ================== IMPORTANT: remapClinicCategories (hoisted & global) ==================
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
  const nyc_shopping = dedupeByName(shoppingFromHidden);
  const iconic_mustsees = dedupeByName([...iconicExisting, ...ICONIC_GLOBAL]);

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
window.remapClinicCategories = remapClinicCategories; // extra safety for module scopes

// ================== Data loading ==================
async function loadData(){
  try{
    let res = await fetch('nyc_fertility_locations.json');
    if(!res.ok) res = await fetch('/nyc_fertility_locations.json');
    if(!res.ok){
      DATA = SAMPLE; LOADED = true;
      banner('Loaded SAMPLE data (nyc_fertility_locations.json not found).', 'error');
      return;
    }
    const json = await res.json();
    if(!json || !Array.isArray(json.clinics)){
      DATA = SAMPLE; LOADED = true;
      banner('Loaded SAMPLE data (JSON format issue). Expect { "clinics": [...] }', 'error');
      return;
    }
    DATA = json; LOADED = true;
    banner(`Loaded ${DATA.clinics.length} clinics • Distances: ${ENABLE_DISTANCES ? 'ON' : 'OFF'}`, 'info');
  }catch(e){
    DATA = SAMPLE; LOADED = true;
    banner('Loaded SAMPLE data (unexpected fetch error). See console for details.', 'error');
    console.error(e);
  }
}

// ================== Rendering helpers ==================
function itemHTML(it, clinicAddress){
  const name = it?.name || 'Unnamed';
  const addr = it?.address || '';
  const phone = it?.phone || '';
  const site = it?.website || '';
  const note = it?.note || '';

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
  const m = remapClinicCategories(clinic); // <- guaranteed defined
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
async function fillDistancesFor(clinic){
  if(!ENABLE_DISTANCES) return;
  const nodes = document.querySelectorAll('.distance[data-dist-for]');
  for(const el of nodes){
    const addr = decodeURIComponent(el.getAttribute('data-dist-for') || '');
    if(!addr){ el.remove(); continue; }
    const line = await computeDistanceLine(clinic.address, addr);
    el.outerHTML = line || '';
  }
}

// ================== Search / UI ==================
async function ensureLoaded(){ if(!LOADED) await loadData(); }

async function doSearch(){
  await ensureLoaded();
  const results = document.querySelector('#results');
  const input = document.querySelector('#query');
  if(!results) return;

  const q = (input?.value || '').trim().toLowerCase();
  let list = DATA.clinics || [];
  if(q){
    list = list.filter(c =>
      (c?.name || '').toLowerCase().includes(q) ||
      (c?.address || '').toLowerCase().includes(q)
    );
  }
  if(!list.length){
    results.innerHTML = `<div class="card"><p>No clinics matched. Try “Weill Cornell” or an address like “1305 York”.</p></div>`;
    return;
  }
  results.innerHTML = list.map(renderClinic).join('');
  for(const clinic of list) await fillDistancesFor(clinic);
}

async function showAll(){
  await ensureLoaded();
  const results = document.querySelector('#results');
  const suggestions = document.querySelector('#suggestions');
  if(suggestions) suggestions.textContent = `Clinics: ${DATA.clinics.map(c=>c.name).join(' · ')}`;
  if(!results) return;
  const list = DATA.clinics || [];
  results.innerHTML = list.map(renderClinic).join('');
  for(const clinic of list) await fillDistancesFor(clinic);
}

// ================== Init ==================
window.addEventListener('DOMContentLoaded', async () => {
  const btnSearch = document.querySelector('#searchBtn');
  const btnAll = document.querySelector('#showAllBtn');

  if(btnSearch) btnSearch.disabled = true;
  if(btnAll) btnAll.disabled = true;

  await ensureLoaded();

  if(btnSearch) btnSearch.disabled = false;
  if(btnAll) btnAll.disabled = false;

  await showAll();

  if(btnSearch) btnSearch.addEventListener('click', doSearch);
  if(btnAll) btnAll.addEventListener('click', showAll);
  const input = document.querySelector('#query');
  if(input) input.addEventListener('keydown', (e)=>{ if(e.key==='Enter') doSearch(); });
});
