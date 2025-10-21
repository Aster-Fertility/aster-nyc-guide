/* Aster Fertility • NYC Clinic Concierge
   script.js — Distance Mode ON (robust)
   - Loads JSON with fallback + diagnostics banner
   - Live distance from clinic (walking & driving) via public OSRM (no key)
   - Apple/Google directions links prefilled clinic -> place
   - New categories: Cafés & Bakeries, NYC Shopping, Broadway & Comedy, Iconic NYC Must Sees, Navigating NYC
*/

let DATA = null;
let LOADED = false;
const ENABLE_DISTANCES = true; // <-- toggle here if you ever want to disable

const $q = (sel) => document.querySelector(sel);
const $results = $q('#results');
const $input = $q('#query');
const $suggestions = $q('#suggestions');
const $searchBtn = $q('#searchBtn');
const $showAllBtn = $q('#showAllBtn');

// ================= Diagnostics banner =================
function banner(msg, type = 'info'){
  const id = 'diagnostic-banner';
  let el = document.getElementById(id);
  if(!el){
    el = document.createElement('div');
    el.id = id;
    el.style.cssText = 'margin:12px 0;padding:10px;border-radius:8px;font-size:14px';
    $results.parentElement.insertBefore(el, $results);
  }
  const bg = type === 'error' ? '#fde2e1' : '#e7f3ff';
  const fg = type === 'error' ? '#912018' : '#0b69a3';
  el.style.background = bg;
  el.style.color = fg;
  el.innerText = msg;
}
function showError(msg){
  banner(msg, 'error');
  $results.innerHTML = `<div class="card"><p>${msg}</p></div>`;
  console.error(msg);
}

// ================= Maps helpers =================
function isAppleMapsPreferred(){
  return /iPad|iPhone|iPod|Macintosh/.test(navigator.userAgent);
}
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

// ================= Geocode + Routing (no key) =================
const NOMINATIM = 'https://nominatim.openstreetmap.org/search?format=json&limit=1&q=';
const OSRM = 'https://router.project-osrm.org/route/v1';

function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }

async function geocode(address){
  if(!ENABLE_DISTANCES) return null;
  try{
    if(!address) return null;
    const key = 'geo:' + address;
    const cached = localStorage.getItem(key);
    if(cached) return JSON.parse(cached);
    // gentle rate limiting for free service
    await sleep(120);
    const res = await fetch(NOMINATIM + encodeURIComponent(address), {
      headers: { 'Accept-Language': 'en' }
    });
    if(!res.ok) return null;
    const data = await res.json();
    const pt = data && data[0] ? {lat:+data[0].lat, lon:+data[0].lon} : null;
    if(pt) localStorage.setItem(key, JSON.stringify(pt));
    return pt;
  }catch(e){ return null; }
}

async function osrmDuration(profile, from, to){
  if(!ENABLE_DISTANCES) return null;
  try{
    if(!from || !to) return null;
    const url = `${OSRM}/${profile}/${from.lon},${from.lat};${to.lon},${to.lat}?overview=false`;
    const res = await fetch(url);
    if(!res.ok) return null;
    const json = await res.json();
    const r = json.routes && json.routes[0];
    if(!r) return null;
    return { seconds: r.duration, meters: r.distance };
  }catch(e){ return null; }
}

function fmtMiles(meters){
  const mi = meters / 1609.344;
  return mi < 0.1 ? `${(mi*5280).toFixed(0)} ft` : `${mi.toFixed(1)} mi`;
}
function fmtMins(seconds){ return `${Math.round(seconds/60)} min`; }

async function computeDistanceLines(clinicAddr, placeAddr){
  if(!ENABLE_DISTANCES) return '';
  try{
    const [cPt, pPt] = await Promise.all([geocode(clinicAddr), geocode(placeAddr)]);
    if(!cPt || !pPt) return '';
    const [walk, drive] = await Promise.all([
      osrmDuration('foot', cPt, pPt),
      osrmDuration('driving', cPt, pPt)
    ]);
    const dist = (walk || drive) ? (walk?.meters ?? drive?.meters) : null;
    const distStr = dist ? fmtMiles(dist) : '';
    const walkStr = walk ? `${fmtMins(walk.seconds)} walk` : '';
    const driveStr = drive ? `${fmtMins(drive.seconds)} drive` : '';
    const parts = [distStr, walkStr, driveStr].filter(Boolean).join(' • ');
    return parts ? `<div class="distance">Distance from clinic: <em>${parts}</em></div>` : '';
  }catch(e){ return ''; }
}

// ================= Data loading (with fallback sample) =================
const SAMPLE = {
  clinics: [
    {
      name: "Weill Cornell Medicine (1305 York Ave)",
      address: "1305 York Ave, New York, NY 10021",
      website: "https://weillcornell.org",
      categories: {
        cafes: [
          {"name":"Maman UES","address":"1424 3rd Ave, New York, NY","phone":"(917) 675-7667","website":"https://mamannyc.com"},
          {"name":"Bluestone Lane (UES Café)","address":"2 E 90th St, New York, NY","phone":"(718) 374-6858","website":"https://bluestonelane.com"}
        ],
        restaurants: [
          {"name":"Finestra","address":"1370 York Ave, New York, NY","phone":"(212) 249-2941","website":"https://finestrarestaurant.com"}
        ],
        pizza_bagels: [
          {"name":"Patsy’s Pizzeria (UES)","address":"206 E 60th St, New York, NY","phone":"(212) 688-9707","website":"https://patsyspizzeria.us"}
        ],
        hidden_gems: [
          {"name":"Levain Bakery (UES)","address":"1484 3rd Ave, New York, NY","phone":"(917) 470-9041","website":"https://levainbakery.com"},
          {"name":"MoMA Design Store (Midtown)","address":"44 W 53rd St, New York, NY","phone":"(212) 767-1050","website":"https://store.moma.org"}
        ],
        broadway_comedy: [
          {"name":"TKTS Lincoln Center (David Rubenstein Atrium)","address":"61 W 62nd St, New York, NY 10023","phone":"(212) 912-9770","website":"https://www.tdf.org/discount-ticket-programs/tkts-by-tdf/tkts-live/","note":"Closest TKTS to 1305 York."},
          {"name":"Comic Strip Live","address":"1568 2nd Ave, New York, NY","phone":"(212) 861-9386","website":"https://comicstriplive.com"}
        ],
        activities: [
          {"name":"The Met Museum","address":"1000 5th Ave, New York, NY","website":"https://metmuseum.org"},
          {"name":"Guggenheim Museum","address":"1071 5th Ave, New York, NY","website":"https://guggenheim.org"}
        ],
        iconic: [
          {"name":"MoMA – Museum of Modern Art","address":"11 W 53rd St, New York, NY","website":"https://www.moma.org"}
        ]
      }
    }
  ]
};

async function loadData(){
  try{
    let res = await fetch('nyc_fertility_locations.json');
    if(!res.ok){
      res = await fetch('/nyc_fertility_locations.json');
    }
    if(!res.ok){
      DATA = SAMPLE; LOADED = true;
      banner('Loaded SAMPLE data (nyc_fertility_locations.json not found).', 'error');
      $suggestions.innerHTML = `Clinics: ${DATA.clinics.map(c => c.name).join(' · ')}`;
      return;
    }
    const json = await res.json();
    if(!json || !Array.isArray(json.clinics)){
      DATA = SAMPLE; LOADED = true;
      banner('Loaded SAMPLE data (JSON format issue). Expect { "clinics": [...] }', 'error');
      $suggestions.innerHTML = `Clinics: ${DATA.clinics.map(c => c.name).join(' · ')}`;
      return;
    }
    DATA = json; LOADED = true;
    banner(`Loaded ${DATA.clinics.length} clinics • Distances: ${ENABLE_DISTANCES ? 'ON' : 'OFF'}`, 'info');
    $suggestions.innerHTML = `Clinics: ${DATA.clinics.map(c => c.name).join(' · ')}`;
  }catch(e){
    DATA = SAMPLE; LOADED = true;
    banner('Loaded SAMPLE data (unexpected fetch error). See console for details.', 'error');
    console.error(e);
    $suggestions.innerHTML = `Clinics: ${DATA.clinics.map(c => c.name).join(' · ')}`;
  }
}

// ================= Category remap (runtime) =================
const BAKERY_KEYWORDS = /(Levain|Magnolia|Dominique Ansel|Senza Gluten|Modern Bread|Erin McKenna|Bakery|Bagel)/i;
const SHOPPING_KEYWORDS = /(Fishs Eddy|MoMA Design Store|CityStore|Artists & Fleas|Pink Olive|Greenwich Letterpress|Mure \+ Grand|Transit Museum Store|NY Transit Museum Store)/i;

const ICONIC_GLOBAL = [
  {name:"Statue of Liberty & Ellis Island (Statue City Cruises)", address:"Battery Park, New York, NY", website:"https://www.cityexperiences.com/new-york/city-cruises/statue/"},
  {name:"9/11 Memorial & Museum (World Trade Center)", address:"180 Greenwich St, New York, NY", website:"https://www.911memorial.org"},
  {name:"NYC Ferry (Harbor sightseeing)", address:"Multiple piers citywide", website:"https://www.ferry.nyc"},
  {name:"Big Bus Tours NYC (Hop-on Hop-off)", address:"Citywide stops (Times Sq, Downtown, Uptown)", website:"https://www.bigbustours.com/new-york"},
  {name:"TopView Sightseeing (Hop-on Hop-off)", address:"Citywide stops", website:"https://topviewnyc.com"}
];

const NAVIGATING = [
  {name:"MTA Subway Map & Guide", address:"Citywide", website:"https://new.mta.info/maps/subway", note:"Tip: OMNY contactless works on all subways and buses."},
  {name:"MTA Bus Map & Service", address:"Citywide", website:"https://new.mta.info/maps/bus"},
  {name:"Grand Central Terminal", address:"89 E 42nd St, New York, NY", website:"https://www.grandcentralterminal.com"},
  {name:"Penn Station (LIRR/Amtrak/NJ Transit)", address:"421 8th Ave, New York, NY", website:"https://www.amtrak.com/stations/nyp"}
];

function dedupeByName(list){
  if(!Array.isArray(list)) return [];
  const seen = new Set(); const out = [];
  for(const x of list){
    const k = (x?.name||'').toLowerCase();
    if(k && !seen.has(k)){ seen.add(k); out.push(x); }
  }
  return out;
}

function remapClinicCategories(c){
  const cats = c.categories || {};
  const cafes = cats.cafes || [];
  const restaurants = cats.restaurants || [];
  const pizza = cats.pizza_bagels || [];
  const hidden = cats.hidden_gems || [];
  const broadway = cats.broadway_comedy || [];
  const iconicExisting = cats.iconic || cats.activities || [];

  const bakeriesFromHidden = hidden.filter(x => BAKERY_KEYWORDS.test(x?.name||''));
  const shoppingFromHidden = hidden.filter(x => SHOPPING_KEYWORDS.test(x?.name||''));

  const cafes_bakeries = dedupeByName([...cafes, ...bakeriesFromHidden]);
  const nyc_shopping = dedupeByName(shoppingFromHidden);
  const iconicMustSees = dedupeByName([...iconicExisting, ...ICONIC_GLOBAL]);
  const navigatingNYC = NAVIGATING;

  return {
    cafes_bakeries,
    restaurants,
    pizza_bagels: pizza,
    nyc_shopping,
    broadway_comedy: broadway,
    iconic_mustsees: iconicMustSees,
    navigating: navigatingNYC
  };
}

// ================= Rendering =================
function itemHTMLBase(it, clinicAddress){
  const name = it?.name || 'Unnamed';
  const addr = it?.address || '';
  const phone = it?.phone || '';
  const site = it?.website || '';
  const note = it?.note || '';

  const hasAddr = !!addr;
  const dirDrive = hasAddr ? mapsDirectionsLink(clinicAddress, addr, 'driving') : '';
  const dirWalk  = hasAddr ? mapsDirectionsLink(clinicAddress, addr, 'walking') : '';

  const line1 = addr ? `<p>${addr}${phone ? ` • ${phone}`:''}</p>` : (phone ? `<p>${phone}</p>`:'');
  const links = [
    site ? `<a href="${site}" target="_blank" rel="noopener">Website</a>` : '',
    hasAddr ? `<a href="${mapsLink(addr)}" target="_blank" rel="noopener">Open in Maps</a>` : '',
    hasAddr ? `<a href="${dirDrive}" target="_blank" rel="noopener">Directions (Drive)</a>` : '',
    hasAddr ? `<a href="${dirWalk}" target="_blank" rel="noopener">Directions (Walk)</a>` : ''
  ].filter(Boolean).join(' • ');

  // include a placeholder for distance if enabled
  const distanceDiv = (ENABLE_DISTANCES && hasAddr)
    ? `<div class="distance" data-dist-for="${encodeURIComponent(addr)}"></div>`
    : '';

  return `
    <div class="item card">
      <h4>${name}</h4>
      ${line1}
      ${links ? `<p>${links}</p>` : ''}
      ${note ? `<p>${note}</p>` : ''}
      ${distanceDiv}
    </div>
  `;
}

function sectionHTML(title, arr, clinicAddress){
  if(!arr || !arr.length) return '';
  return `
    <div class="card">
      <h3 class="section-title">${title}</h3>
      <div class="grid">
        ${arr.map(it => itemHTMLBase(it, clinicAddress)).join('')}
      </div>
    </div>
  `;
}

// --- SAFETY SHIM: ensure remapClinicCategories exists in global scope ---
const BAKERY_KEYWORDS = BAKERY_KEYWORDS || /(Levain|Magnolia|Dominique Ansel|Senza Gluten|Modern Bread|Erin McKenna|Bakery|Bagel)/i;
const SHOPPING_KEYWORDS = SHOPPING_KEYWORDS || /(Fishs Eddy|MoMA Design Store|CityStore|Artists & Fleas|Pink Olive|Greenwich Letterpress|Mure \+ Grand|Transit Museum Store|NY Transit Museum Store)/i;

const ICONIC_GLOBAL = typeof ICONIC_GLOBAL !== 'undefined' ? ICONIC_GLOBAL : [
  {name:"Statue of Liberty & Ellis Island (Statue City Cruises)", address:"Battery Park, New York, NY", website:"https://www.cityexperiences.com/new-york/city-cruises/statue/"},
  {name:"9/11 Memorial & Museum (World Trade Center)", address:"180 Greenwich St, New York, NY", website:"https://www.911memorial.org"},
  {name:"NYC Ferry (Harbor sightseeing)", address:"Multiple piers citywide", website:"https://www.ferry.nyc"},
  {name:"Big Bus Tours NYC (Hop-on Hop-off)", address:"Citywide stops (Times Sq, Downtown, Uptown)", website:"https://www.bigbustours.com/new-york"},
  {name:"TopView Sightseeing (Hop-on Hop-off)", address:"Citywide stops", website:"https://topviewnyc.com"}
];

const NAVIGATING = typeof NAVIGATING !== 'undefined' ? NAVIGATING : [
  {name:"MTA Subway Map & Guide", address:"Citywide", website:"https://new.mta.info/maps/subway", note:"Tip: OMNY contactless works on all subways and buses."},
  {name:"MTA Bus Map & Service", address:"Citywide", website:"https://new.mta.info/maps/bus"},
  {name:"Grand Central Terminal", address:"89 E 42nd St, New York, NY", website:"https://www.grandcentralterminal.com"},
  {name:"Penn Station (LIRR/Amtrak/NJ Transit)", address:"421 8th Ave, New York, NY", website:"https://www.amtrak.com/stations/nyp"}
];

if (typeof window.remapClinicCategories !== 'function') {
  window.remapClinicCategories = function remapClinicCategories(c){
    const cats = (c && c.categories) || {};
    const cafes = cats.cafes || [];
    const restaurants = cats.restaurants || [];
    const pizza = cats.pizza_bagels || [];
    const hidden = cats.hidden_gems || [];
    const broadway = cats.broadway_comedy || [];
    const iconicExisting = cats.iconic || cats.activities || [];

    const bakeriesFromHidden = hidden.filter(x => (x?.name||'').match(BAKERY_KEYWORDS));
    const shoppingFromHidden = hidden.filter(x => (x?.name||'').match(SHOPPING_KEYWORDS));

    // simple dedupe by name
    const dedupe = (arr) => {
      const seen = new Set();
      return (arr||[]).filter(x => {
        const k = (x?.name||'').toLowerCase();
        if(!k || seen.has(k)) return false;
        seen.add(k); return true;
      });
    };

    return {
      cafes_bakeries: dedupe([...(cafes||[]), ...(bakeriesFromHidden||[])]),
      restaurants: dedupe(restaurants),
      pizza_bagels: dedupe(pizza),
      nyc_shopping: dedupe(shoppingFromHidden),
      broadway_comedy: dedupe(broadway),
      iconic_mustsees: dedupe([...(iconicExisting||[]), ...ICONIC_GLOBAL]),
      navigating: NAVIGATING
    };
  };
}
// ------------------------------------------------------------------------

function renderClinic(clinic){
  const mapped = remapClinicCategories(clinic);
  const header = `
    <div class="card">
      <h2>${clinic.name} <span class="badge">Clinic</span></h2>
      <p>${clinic.address} • <a href="${clinic.website}" target="_blank" rel="noopener">Website</a> • <a href="${mapsLink(clinic.address)}" target="_blank" rel="noopener">Open in Maps</a></p>
    </div>
  `;
  return header + [
    sectionHTML('Cafés & Bakeries', mapped.cafes_bakeries, clinic.address),
    sectionHTML('Restaurants', mapped.restaurants, clinic.address),
    sectionHTML('Pizza & Bagels', mapped.pizza_bagels, clinic.address),
    sectionHTML('NYC Shopping', mapped.nyc_shopping, clinic.address),
    sectionHTML('Broadway & Comedy', mapped.broadway_comedy, clinic.address),
    sectionHTML('Iconic NYC Must Sees', mapped.iconic_mustsees, clinic.address),
    sectionHTML('Navigating NYC', mapped.navigating, clinic.address),
  ].join('');
}

async function fillAllDistancesForClinic(clinic){
  if(!ENABLE_DISTANCES) return;
  const distTargets = document.querySelectorAll('.distance[data-dist-for]');
  const cAddr = clinic.address;
  for(const el of distTargets){
    const placeAddr = decodeURIComponent(el.getAttribute('data-dist-for')||'');
    if(!placeAddr){ el.remove(); continue; }
    const line = await computeDistanceLines(cAddr, placeAddr);
    el.outerHTML = line || '';
  }
}

// ================= Search / UI =================
async function ensureLoaded(){
  if(LOADED) return;
  await loadData();
}
async function doSearch(){
  await ensureLoaded();
  const q = ($input.value||'').trim();
  let list = DATA.clinics || [];
  if(q){
    const needle = q.toLowerCase();
    list = list.filter(c =>
      (c?.name||'').toLowerCase().includes(needle) ||
      (c?.address||'').toLowerCase().includes(needle)
    );
  }
  if(!list.length){
    $results.innerHTML = `<div class="card"><p>No clinics matched. Try “Weill Cornell” or an address like “1305 York”.</p></div>`;
    return;
  }
  $results.innerHTML = list.map(renderClinic).join('');
  // compute distances after render (async)
  for(const clinic of list){
    await fillAllDistancesForClinic(clinic);
  }
}
async function showAll(){
  await ensureLoaded();
  const list = DATA.clinics || [];
  $results.innerHTML = list.map(renderClinic).join('');
  for(const clinic of list){
    await fillAllDistancesForClinic(clinic);
  }
}

// ================= Init =================
window.addEventListener('DOMContentLoaded', async () => {
  $searchBtn.disabled = true;
  $showAllBtn.disabled = true;
  await ensureLoaded();
  $searchBtn.disabled = false;
  $showAllBtn.disabled = false;
  await showAll(); // show everything on load so you can verify quickly
});
$searchBtn.addEventListener('click', doSearch);
$showAllBtn.addEventListener('click', showAll);
$input.addEventListener('keydown', (e)=>{ if(e.key === 'Enter') doSearch(); });
