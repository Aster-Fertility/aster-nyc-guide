/* Aster Fertility • NYC Clinic Concierge
   script.js — Consolidated, Robust, Distance Mode ON
   - Loads JSON with fallback sample + diagnostics banner
   - New categories: Cafés & Bakeries, NYC Shopping, Broadway & Comedy, Iconic NYC Must Sees, Navigating NYC
   - Directions links (Apple/Google) clinic -> place
   - Live distance from clinic (walking & driving) via public OSRM (no key)
*/

let DATA = null;
let LOADED = false;
const ENABLE_DISTANCES = true; // toggle to false to disable distances

// ================= DOM refs =================
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
    await sleep(120); // be gentle to free service
    const res = await fetch(NOMINATIM + encodeURIComponent(address), { headers: { 'Accept-Language':'en' }});
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

// ================= Fallback SAMPLE (if JSON missing) =================
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

// ================= Category mapping constants =================
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

// ================= Category helpers =================
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
  const cats = c?.categories || {};
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
  const iconic_mustsees = dedupeByName([...iconicExisting, ...ICONIC_GLOBAL]);
  const navigating = NAVIGATING;

  return {
    cafes_bakeries,
    restaurants,
    pizza_bagels: pizza,
    nyc_shopping,
    broadway_comedy: broadway,
    iconic_mustsees,
    navigating
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
    hasAddr ? `<a href="${dirWalk}" target="_blank" rel_
