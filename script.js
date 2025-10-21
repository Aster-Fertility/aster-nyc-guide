/* Aster Fertility • NYC Clinic Concierge
   Full script.js (drop-in)
   - Category remap (runtime; no JSON rewrite needed)
   - Directions links (Apple/Google)
   - Live walking/driving distance via open OSRM routing (no key)
*/

let DATA = null;
const $q = (sel) => document.querySelector(sel);
const $results = $q('#results');
const $input = $q('#query');
const $suggestions = $q('#suggestions');

// -----------------------------
// Maps Helpers
// -----------------------------
function isAppleMapsPreferred(){
  return /iPad|iPhone|iPod|Macintosh/.test(navigator.userAgent);
}

// Single-place map link (kept for quick open)
function mapsLink(address){
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}

// Directions link from clinic -> place
function mapsDirectionsLink(originAddress, destAddress, mode = 'driving'){
  if(!originAddress || !destAddress) return '';
  if(isAppleMapsPreferred()){
    // Apple Maps dirflg: w (walking), d (driving)
    const flag = mode === 'walking' ? 'w' : 'd';
    return `http://maps.apple.com/?saddr=${encodeURIComponent(originAddress)}&daddr=${encodeURIComponent(destAddress)}&dirflg=${flag}`;
  }
  // Google Maps
  return `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(originAddress)}&destination=${encodeURIComponent(destAddress)}&travelmode=${mode}`;
}

// -----------------------------
// Geocoding & Routing (no API key)
// -----------------------------
const NOMINATIM = 'https://nominatim.openstreetmap.org/search?format=json&limit=1&q=';
const OSRM = 'https://router.project-osrm.org/route/v1'; // public OSRM

function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }

// cache geocodes locally to avoid rate limits
async function geocode(address){
  if(!address) return null;
  const key = 'geo:' + address;
  const cached = localStorage.getItem(key);
  if(cached) return JSON.parse(cached);
  // be gentle to Nominatim
  await sleep(120);
  const res = await fetch(NOMINATIM + encodeURIComponent(address));
  if(!res.ok) return null;
  const data = await res.json();
  const pt = data && data[0] ? {lat:+data[0].lat, lon:+data[0].lon} : null;
  if(pt) localStorage.setItem(key, JSON.stringify(pt));
  return pt;
}

async function osrmDuration(profile, from, to){
  // profile: 'foot' or 'driving'
  if(!from || !to) return null;
  const url = `${OSRM}/${profile}/${from.lon},${from.lat};${to.lon},${to.lat}?overview=false`;
  const res = await fetch(url);
  if(!res.ok) return null;
  const json = await res.json();
  const r = json.routes && json.routes[0];
  if(!r) return null;
  return { seconds: r.duration, meters: r.distance };
}

function fmtMiles(meters){
  const mi = meters / 1609.344;
  return mi < 0.1 ? `${(mi*5280).toFixed(0)} ft` : `${mi.toFixed(1)} mi`;
}
function fmtMins(seconds){ return `${Math.round(seconds/60)} min`; }

async function computeDistanceLines(clinicAddr, placeAddr){
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
  }catch(e){
    return '';
  }
}

// -----------------------------
// Data loading
// -----------------------------
async function loadData(){
  const res = await fetch('nyc_fertility_locations.json');
  DATA = await res.json();
  $suggestions.innerHTML = `Clinics: ${DATA.clinics.map(c => c.name).join(' · ')}`;
}

// Search helpers
function byQuery(clinic, q){
  const needle = q.toLowerCase();
  return clinic.name.toLowerCase().includes(needle) || clinic.address.toLowerCase().includes(needle);
}

// -----------------------------
// Category remapping (runtime)
// -----------------------------
// We derive new buckets from your existing JSON keys, so you don’t have to rewrite the data file.

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
  const seen = new Set(); const out = [];
  for(const x of list){
    const k = (x.name||'').toLowerCase();
    if(!seen.has(k)){ seen.add(k); out.push(x); }
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
  // existing activities or iconic lists (from earlier steps)
  const iconicExisting = cats.iconic || cats.activities || [];

  const bakeriesFromHidden = hidden.filter(x => BAKERY_KEYWORDS.test(x.name||''));
  const shoppingFromHidden = hidden.filter(x => SHOPPING_KEYWORDS.test(x.name||''));

  const cafes_bakeries = dedupeByName([...cafes, ...bakeriesFromHidden]);
  const nyc_shopping = dedupeByName(shoppingFromHidden);

  const iconicMustSees = dedupeByName([
    ...iconicExisting,
    ...ICONIC_GLOBAL
  ]);

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

// -----------------------------
// Rendering
// -----------------------------
function itemHTMLBase(it, clinicAddress){
  const hasAddr = !!it.address;
  const dirDrive = hasAddr ? mapsDirectionsLink(clinicAddress, it.address, 'driving') : '';
  const dirWalk  = hasAddr ? mapsDirectionsLink(clinicAddress, it.address, 'walking') : '';
  const lines = [
    it.address ? `<p>${it.address}${it.phone ? ` • ${it.phone}`:''}</p>` : (it.phone ? `<p>${it.phone}</p>`:''),
    `<p>
      ${it.website ? `<a href="${it.website}" target="_blank" rel="noopener">Website</a>` : ''}
      ${hasAddr ? `${it.website ? ' • ' : ''}<a href="${mapsLink(it.address)}" target="_blank" rel="noopener">Open in Maps</a>` : ''}
      ${hasAddr ? ` • <a href="${dirDrive}" target="_blank" rel="noopener">Directions (Drive)</a> • <a href="${dirWalk}" target="_blank" rel="noopener">Directions (Walk)</a>` : ''}
    </p>`,
    it.note ? `<p>${it.note}</p>` : ''
  ].join('');
  // distance placeholder (filled async)
  return `<div class="item card"><h4>${it.name}</h4>${lines}<div class="distance" data-dist-for="${encodeURIComponent(it.address||'')}"></div></div>`;
}

function sectionHTML(title, arr, clinicAddress){
  if(!arr || !arr.length) return '';
  return `
    <div class="card">
      <h3 class="section-title">${title}</h3>
      <div class="grid">${arr.map(it => itemHTMLBase(it, clinicAddress)).join('')}</div>
    </div>
  `;
}

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
  const distTargets = document.querySelectorAll('.distance[data-dist-for]');
  const cAddr = clinic.address;
  for(const el of distTargets){
    const placeAddr = decodeURIComponent(el.getAttribute('data-dist-for')||'');
    if(!placeAddr){ el.remove(); continue; }
    const line = await computeDistanceLines(cAddr, placeAddr);
    el.outerHTML = line || '';
  }
}

// -----------------------------
// Search / UI
// -----------------------------
function search(){
  const q = $input.value.trim();
  let list = DATA.clinics;
  if(q) list = list.filter(c => byQuery(c, q));
  if(!list.length){
    $results.innerHTML = `<div class="card"><p>No clinics matched. Try “Weill Cornell” or an address like “1305 York”.</p></div>`;
    return;
  }
  $results.innerHTML = list.map(renderClinic).join('');
  (async () => {
    // compute distances for each rendered clinic’s items
    for(const clinic of list){
      await fillAllDistancesForClinic(clinic);
    }
  })();
}

// Init
$q('#searchBtn').addEventListener('click', search);
$q('#showAllBtn').addEventListener('click', () => {
  $input.value = '';
  $results.innerHTML = DATA.clinics.map(renderClinic).join('');
  (async () => {
    for(const clinic of DATA.clinics){
      await fillAllDistancesForClinic(clinic);
    }
  })();
});
$input.addEventListener('keydown', (e)=>{ if(e.key === 'Enter') search(); });

loadData();
