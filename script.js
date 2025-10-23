// Aster NYC Guide — script.js (v14)
// Features:
// - Clinic dropdown
// - Hotel/address nearby finder (15–18 min walk radius) with robust geocoding
// - Fallback to closest results if nothing within radius
// - Coordinate enrichment + JSON download
// - No search history / saved items / method-reliability sections

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
  renderAll();
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
  return String(str==null?"":str)
    .replace(/&/g,"&amp;")
    .replace(/</g,"&lt;")
    .replace(/>/g,"&gt;");
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
    if(!name){ renderAll(); return; }
    const clinic = DATA.clinics.find(c => c.name === name);
    renderClinic(clinic);
  };

  const showAllBtn = document.getElementById('showAllBtn');
  if(showAllBtn) showAllBtn.onclick = renderAll;
}

// -------------------- UI: Render Lists --------------------
function renderAll(){
  const mount = document.getElementById('results');
  if(!mount) return;
  mount.innerHTML = "";

  const header = document.createElement('div');
  header.className = "card";
  header.innerHTML = `<h3 class="section-title">Clinics</h3>
    <p class="muted">Choose a clinic above to see curated nearby picks.</p>`;
  mount.appendChild(header);

  (DATA?.clinics||[]).forEach(c => {
    const el = document.createElement('div');
    el.className = "card";
    el.innerHTML = `<h4>${safeHtml(c.name)}</h4>
      <div class="addr">${safeHtml(c.address || "")}</div>
      <div>${c.website ? `<a href="${safeHtml(c.website)}" target="_blank" rel="noopener">Website</a>` : ""}</div>`;
    mount.appendChild(el);
  });
}

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
async function geocodeAddress(q){
  // Nominatim (no API key). Use timeout + NYC bounding box. Do NOT set User-Agent in browser.
  const controller = new AbortController();
  const id = setTimeout(()=>controller.abort(), 12000);
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&addressdetails=0&bounded=1&viewbox=${NYC_VIEWBOX}&q=${encodeURIComponent(q)}`;
  try{
    const res = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      signal: controller.signal
    });
    clearTimeout(id);
    if(!res.ok) throw new Error("Geocode failed");
    const arr = await res.json();
    if(!Array.isArray(arr) || !arr.length) throw new Error("No results");
    return { lat: parseFloat(arr[0].lat), lon: parseFloat(arr[0].lon) };
  }catch(e){
    clearTimeout(id);
    throw e;
  }
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
    console.log('[Nearby] Geocoded', q, '→', pt);
    const all = collectAllPlaces().filter(p => typeof p.lat==="number" && typeof p.lon==="number");
    console.log('[Nearby] Places with coords:', all.length);

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
    mount.innerHTML = `<div class="muted">Couldn’t locate that address in NYC. Try a fuller address (e.g., “Marriott Marquis, 1535 Broadway, New York, NY”).</div>`;
  }finally{
    btn.disabled = false; btn.textContent = "Find nearby";
  }
}

// -------------------- Enrichment / Add Coordinates --------------------
function flattenForGeocode(){
  const tasks = [];
  (DATA?.clinics||[]).forEach((c,ci)=>{
    if(c.address && (c.lat==null || c.lon==null)) tasks.push({path:`clinics[${ci}]`, name:c.name, address:c.address});
    const cats = c.categories||{};
    Object.keys(cats).forEach(cat => {
      (cats[cat]||[]).forEach((i,ii)=>{
        if(i.address && (i.lat==null || i.lon==null)){
          tasks.push({path:`clinics[${ci}].categories.${cat}[${ii}]`, name:i.name, address:i.address});
        }
      });
    });
  });
  (DATA?.mustSees||[]).forEach((m,mi)=>{
    if(m.address && (m.lat==null || m.lon==null)) tasks.push({path:`mustSees[${mi}]`, name:m.name, address:m.address});
  });
  return tasks;
}

async function geocodeNYCAddress(address){
  // helper used by enrichment — NYC bias
  return geocodeAddress(`${address}, New York, NY`);
}

async function enrichAndDownload(){
  const status = document.getElementById('enrichStatus');
  if(status) status.textContent = "Scanning…";
  const tasks = flattenForGeocode();
  if(!tasks.length){ if(status) status.textContent = "Everything already has coordinates."; return; }

  let done = 0;
  for(const t of tasks){
    if(status) status.textContent = `Geocoding ${done+1}/${tasks.length}: ${t.name}`;
    try{
      const pt = await geocodeNYCAddress(t.address);
      const set = new Function("DATA","val",`
        DATA.${t.path}.lat = val.lat;
        DATA.${t.path}.lon = val.lon;
      `);
      set(DATA, pt);
    }catch(e){
      console.warn("Failed to geocode", t.name, e);
    }
    done++;
    await new Promise(r=>setTimeout(r, 800)); // throttle
  }

  if(status) status.textContent = "Packaging JSON…";
  const jsonStr = JSON.stringify(DATA, null, 2);
  const blob = new Blob([jsonStr], {type:"application/json"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = "nyc_fertility_locations_coords.json";
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url), 1000);
  if(status) status.textContent = "Done. Check your downloads.";
}

// -------------------- Boot --------------------
document.addEventListener("DOMContentLoaded", () => {
  loadData();
  document.getElementById('nearbyBtn')?.addEventListener('click', handleNearby);
  document.getElementById('enrichBtn')?.addEventListener('click', enrichAndDownload);
});
