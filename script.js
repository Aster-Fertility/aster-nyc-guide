// Aster NYC Guide — script.js (v16)
// Removes "Data tools (one-time)" and "Clinics" header boxes.
// Keeps clinic dropdown, clinic detail rendering, and hotel/address nearby finder.

const NYC_VIEWBOX = "-74.05,40.55,-73.70,40.95"; // W,S,E,N for NYC bias
const WALK_MAX_KM = 1.5; // ~18 min walk
const CATEGORIES_ORDER = [
  "cafes",
  "restaurants",
  "pizza_bagels",
  "hidden_gems",
  "broadway_comedy",
  "activities",
  "iconic"
];

let DATA = null;

// -------------------- Load JSON --------------------
async function loadData(){
  try{
    let res = await fetch("nyc_fertility_locations.json", { cache: "no-store" });
    if(!res.ok) throw new Error("Failed to fetch nyc_fertility_locations.json");
    DATA = await res.json();
  }catch(err){
    console.error("Data load error:", err);
    DATA = { clinics: [], mustSees: [] };
  }
  populateClinicDropdown();
  clearResults();
}

// -------------------- Helpers --------------------
function kmBetween(lat1,lon1,lat2,lon2){
  const R=6371;
  const dLat=(lat2-lat1)*Math.PI/180;
  const dLon=(lon2-lon1)*Math.PI/180;
  const a=Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
  return 2*R*Math.asin(Math.sqrt(a));
}
function safeHtml(str){
  return String(str==null?"":str).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}
function clearResults(){
  const mount = document.getElementById('results');
  if(mount) mount.innerHTML = "";
}

// -------------------- UI: Clinic Dropdown --------------------
function populateClinicDropdown(){
  const sel = document.getElementById('clinicSelect');
  if(!sel || !DATA?.clinics) return;

  const list = [...DATA.clinics].sort((a,b)=> a.name.localeCompare(b.name));
  sel.innerHTML = '<option value="">Select a clinic…</option>' +
    list.map(c => `<option value="${safeHtml(c.name)}">${safeHtml(c.name)}</option>`).join('');

  sel.onchange = () => {
    const name = sel.value;
    if(!name){ clearResults(); return; }
    const clinic = DATA.clinics.find(c => c.name === name);
    renderClinic(clinic);
  };

  // Optional "Show all" button; if present, clear results instead of drawing a header card
  const showAllBtn = document.getElementById('showAllBtn');
  if(showAllBtn) showAllBtn.onclick = clearResults;
}

// -------------------- UI: Render Selected Clinic --------------------
function renderClinic(clinic){
  const mount = document.getElementById('results');
  if(!mount) return;
  if(!clinic){ mount.innerHTML = "<div class='card'>Clinic not found.</div>"; return; }

  const blocks = [];
  blocks.push(`<div class="card">
    <h3 class="section-title">${safeHtml(clinic.name)}</h3>
    <div class="addr">${safeHtml(clinic.address || "")}</div>
    ${clinic.website ? `<div><a href="${safeHtml(clinic.website)}" target="_blank" rel="noopener">Website</a></div>`:""}
  </div>`);

  const cats = clinic.categories || {};
  for(const key of CATEGORIES_ORDER){
    const arr = cats[key] || [];
    if(!arr.length) continue;
    const pretty = key.replace(/_/g," ").replace(/\b\w/g, s=>s.toUpperCase());
    const items = arr.map(i => {
      const dist = (clinic.lat && clinic.lon && i.lat && i.lon) ? kmBetween(clinic.lat, clinic.lon, i.lat, i.lon) : null;
      const distStr = dist!=null ? `<span class="tag">${dist.toFixed(2)} km</span>` : "";
      return `<div class="nearby-card">
        <div><strong>${safeHtml(i.name||"")}</strong> ${distStr}</div>
        <div class="meta">${safeHtml(i.address||"")}</div>
        <div>${i.website ? `<a href="${safeHtml(i.website)}" target="_blank" rel="noopener">Website</a>`:""}</div>
        ${i.note ? `<div class="meta">${safeHtml(i.note)}</div>`:""}
      </div>`;
    }).join("");
    blocks.push(`<div class="card"><h4>${safeHtml(pretty)}</h4><div class="nearby-results">${items}</div></div>`);
  }

  mount.innerHTML = blocks.join("\n");
}

// -------------------- Nearby (Hotel/Address) --------------------

// Known points fallback (handles common entries cleanly)
const HARDCODED_POINTS = [
  { test:/\b1535\s*broadway\b/i, lat:40.758636, lon:-73.985450, label:"Marriott Marquis" },
  { test:/\b810\s*(7(th)?|seventh)\s*ave\b/i, lat:40.7628709, lon:-73.9825242, label:"CCRM New York" }
];

// Remove floor/suite/unit etc. and extra punctuation
function normalizeAddress(q){
  let s = (q||"").trim();
  s = s.replace(/\b(floor|fl\.?|suite|ste\.?|unit|level)\s*[#\-\w]+/ig, "");
  s = s.replace(/\s+/g," ").replace(/\s*,\s*/g,", ").trim();
  s = s.replace(/\b(\d+)(st|nd|rd|th)\b/gi, "$1");
  return s;
}

async function geocodeOnce(q){
  const controller = new AbortController();
  const timer = setTimeout(()=>controller.abort(), 12000);
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&addressdetails=0&bounded=1&viewbox=${NYC_VIEWBOX}&q=${encodeURIComponent(q)}`;
  const res = await fetch(url, { headers: { 'Accept':'application/json' }, signal: controller.signal });
  clearTimeout(timer);
  if(!res.ok) throw new Error("Geocode failed");
  const arr = await res.json();
  if(!Array.isArray(arr) || !arr.length) throw new Error("No results");
  return { lat: parseFloat(arr[0].lat), lon: parseFloat(arr[0].lon) };
}

function clinicFallbackFromText(q){
  const text = (q||"").toLowerCase();
  for(const c of (DATA?.clinics||[])){
    const name = (c.name||"").toLowerCase();
    const firstLine = (c.address||"").split(",")[0].toLowerCase();
    if(text.includes(name) || (firstLine && text.includes(firstLine))){
      if(typeof c.lat==="number" && typeof c.lon==="number"){
        return { lat:c.lat, lon:c.lon, via:`clinic: ${c.name}` };
      }
    }
  }
  return null;
}
function hardcodedFallback(q){
  for(const h of HARDCODED_POINTS){
    if(h.test.test(q)) return { lat:h.lat, lon:h.lon, via:`hardcoded: ${h.label}` };
  }
  return null;
}

async function geocodeAddress(q){
  const raw = (q||"").trim();
  if(!raw) throw new Error("empty");

  const hard = hardcodedFallback(raw);
  if(hard) return hard;

  const clinicGuess = clinicFallbackFromText(raw);
  if(clinicGuess) return clinicGuess;

  const base = normalizeAddress(raw);
  const attempts = [
    base,
    `${base}, Manhattan, New York, NY`,
    `${base}, New York, NY`,
    `${base}, NYC`,
  ];
  const zip = (raw.match(/\b1\d{4}\b/)||[])[0];
  if(zip) attempts.unshift(`${base}, New York, NY ${zip}`);

  let lastErr=null;
  for(const v of attempts){
    try{ return await geocodeOnce(v); }catch(e){ lastErr=e; }
  }
  const weakClinic = clinicFallbackFromText(base);
  if(weakClinic) return weakClinic;
  throw lastErr || new Error("Geocode failed");
}

function collectAllPlaces(){
  const out = [];
  (DATA?.clinics||[]).forEach(c => {
    out.push({type:"Clinic", clinic:c.name, name:c.name, lat:c.lat, lon:c.lon, address:c.address, website:c.website});
    const cats = c.categories||{};
    for(const key of Object.keys(cats)){
      for(const i of (cats[key]||[])){
        out.push({type:key, clinic:c.name, name:i.name, lat:i.lat, lon:i.lon, address:i.address, website:i.website, note:i.note});
      }
    }
  });
  (DATA?.mustSees||[]).forEach(i =>
    out.push({type:"mustSee", clinic:null, name:i.name, lat:i.lat, lon:i.lon, address:i.address, website:i.website, note:i.note})
  );
  return out;
}

async function handleNearby(){
  const btn = document.getElementById('nearbyBtn');
  const input = document.getElementById('userAddress');
  const mount = document.getElementById('nearbyResults');
  if(!btn || !input || !mount) return;

  const q = (input.value||"").trim();
  if(!q){
    mount.innerHTML = `<div class="muted">Enter an address or hotel name.</div>`;
    return;
  }

  btn.disabled = true; btn.textContent = "Searching…";
  mount.innerHTML = `<div class="muted">Geocoding address (NYC)…</div>`;

  try{
    const pt = await geocodeAddress(q);
    const all = collectAllPlaces().filter(p => typeof p.lat==="number" && typeof p.lon==="number");

    const within = all
      .map(p => ({...p, km: kmBetween(pt.lat, pt.lon, p.lat, p.lon)}))
      .filter(p => p.km <= WALK_MAX_KM)
      .sort((a,b)=> a.km - b.km);

    if(within.length){
      mount.innerHTML = within.slice(0,80).map(m => `
        <div class="nearby-card">
          <div><strong>${safeHtml(m.name)}</strong> <span class="tag">${m.km.toFixed(2)} km</span></div>
          <div class="meta">${safeHtml(m.address||"")}${m.clinic?` · <em>${safeHtml(m.clinic)}</em>`:""}</div>
          <div>${m.website?`<a href="${safeHtml(m.website)}" target="_blank" rel="noopener">Website</a>`:""}</div>
          ${m.note?`<div class="meta">${safeHtml(m.note)}</div>`:""}
        </div>
      `).join("");
      return;
    }

    // Fallback: closest 12 even if outside WALK_MAX_KM
    const closest = all
      .map(p => ({...p, km: kmBetween(pt.lat, pt.lon, p.lat, p.lon)}))
      .sort((a,b)=> a.km - b.km)
      .slice(0, 12);

    if(closest.length){
      mount.innerHTML = `
        <div class="muted">Nothing within ~${WALK_MAX_KM} km. Showing the closest curated spots:</div>
        ${closest.map(m => `
          <div class="nearby-card">
            <div><strong>${safeHtml(m.name)}</strong> <span class="tag">${m.km.toFixed(2)} km</span></div>
            <div class="meta">${safeHtml(m.address||"")}${m.clinic?` · <em>${safeHtml(m.clinic)}</em>`:""}</div>
            <div>${m.website?`<a href="${safeHtml(m.website)}" target="_blank" rel="noopener">Website</a>`:""}</div>
            ${m.note?`<div class="meta">${safeHtml(m.note)}</div>`:""}
          </div>
        `).join("")}
      `;
      return;
    }

    mount.innerHTML = `<div class="muted">No curated spots available yet.</div>`;
  }catch(err){
    console.warn('[Nearby] Error:', err);
    mount.innerHTML = `
      <div class="nearby-card">
        <strong>No nearby picks found</strong>
        <div class="meta">Try adding the neighborhood or borough.</div>
      </div>
    `;
  }finally{
    btn.disabled = false; btn.textContent = "Find nearby";
  }
}

// -------------------- Boot --------------------
document.addEventListener("DOMContentLoaded", () => {
  loadData();
  document.getElementById('nearbyBtn')?.addEventListener('click', handleNearby);

  // If any legacy "Data tools" markup exists in the HTML, remove it
  const enrichBtn = document.getElementById('enrichBtn');
  if(enrichBtn){
    const card = enrichBtn.closest('.card');
    (card || enrichBtn).remove();
  }
  // If there was a static "Clinics" header card in HTML, try to remove it as well
  const possibleClinicsHeader = document.querySelector('.card .section-title');
  if(possibleClinicsHeader && /clinics/i.test(possibleClinicsHeader.textContent||"")){
    possibleClinicsHeader.closest('.card')?.remove();
  }
});
