// Aster NYC Guide — script.js (v18)
// - Hotel/address search reads from places.json (flat & fast); falls back to clinics JSON if missing.
// - Robust address geocoding (6th Ave <-> Avenue of the Americas, floor/suite cleanup, NYC-biased).
// - Auto-removes any leftover "Data tools (one-time)" and "Clinics" header cards in HTML.

const NYC_VIEWBOX = "-74.05,40.55,-73.70,40.95"; // W,S,E,N bias around NYC
const WALK_MAX_KM = 1.5; // ~18 min walk
const CATEGORIES_ORDER = ["cafes","restaurants","pizza_bagels","hidden_gems","broadway_comedy","activities","iconic"];

let DATA = null;   // full clinics JSON
let PLACES = null; // flat places from places.json (lazy)

// -------------------- Loaders --------------------
async function loadClinics(){
  try{
    const res = await fetch("nyc_fertility_locations.json", { cache: "no-store" });
    if(!res.ok) throw new Error("Failed to fetch nyc_fertility_locations.json");
    DATA = await res.json();
  }catch(err){
    console.error("Clinics data load error:", err);
    DATA = { clinics: [], mustSees: [] };
  }
  populateClinicDropdown();
  clearResults();
}

async function getPlaces(){
  if(PLACES) return PLACES;
  try{
    const res = await fetch("places.json", { cache: "no-store" });
    if(res.ok){
      const j = await res.json();
      if(Array.isArray(j.places)){
        PLACES = j.places;
        return PLACES;
      }
    }
  }catch(e){
    console.warn("places.json not available; falling back to clinics JSON", e);
  }
  // Fallback: derive from big JSON if places.json missing
  PLACES = collectAllPlaces().map(p => ({
    name: p.name, address: p.address, lat: p.lat, lon: p.lon,
    type: p.type, clinic: p.clinic, website: p.website
  }));
  return PLACES;
}

// -------------------- Utils --------------------
function kmBetween(lat1,lon1,lat2,lon2){
  const R=6371;
  const dLat=(lat2-lat1)*Math.PI/180, dLon=(lon2-lon1)*Math.PI/180;
  const a=Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
  return 2*R*Math.asin(Math.sqrt(a));
}
function safeHtml(str){ return String(str??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }
function clearResults(){ const m = document.getElementById('results'); if(m) m.innerHTML=""; }

// -------------------- Clinic dropdown & render --------------------
function populateClinicDropdown(){
  const sel = document.getElementById('clinicSelect');
  if(!sel || !DATA?.clinics) return;
  const list = [...DATA.clinics].sort((a,b)=> a.name.localeCompare(b.name));
  sel.innerHTML = '<option value="">Select a clinic…</option>' +
    list.map(c => `<option value="${safeHtml(c.name)}">${safeHtml(c.name)}</option>`).join('');
  sel.onchange = () => {
    const name = sel.value;
    if(!name){ clearResults(); return; }
    renderClinic(DATA.clinics.find(c => c.name === name));
  };
  document.getElementById('showAllBtn')?.addEventListener('click', clearResults);
}

function renderClinic(clinic){
  const mount = document.getElementById('results');
  if(!mount) return;
  if(!clinic){ mount.innerHTML = "<div class='card'>Clinic not found.</div>"; return; }

  const parts = [];
  parts.push(`<div class="card">
    <h3 class="section-title">${safeHtml(clinic.name)}</h3>
    <div class="addr">${safeHtml(clinic.address||"")}</div>
    ${clinic.website?`<div><a href="${safeHtml(clinic.website)}" target="_blank" rel="noopener">Website</a></div>`:""}
  </div>`);

  const cats = clinic.categories||{};
  for(const key of CATEGORIES_ORDER){
    const arr = cats[key]||[];
    if(!arr.length) continue;
    const title = key.replace(/_/g," ").replace(/\b\w/g,s=>s.toUpperCase());
    const items = arr.map(i=>{
      const d = (clinic.lat&&clinic.lon&&i.lat&&i.lon)? kmBetween(clinic.lat,clinic.lon,i.lat,i.lon):null;
      return `<div class="nearby-card">
        <div><strong>${safeHtml(i.name||"")}</strong> ${d!=null?`<span class="tag">${d.toFixed(2)} km</span>`:""}</div>
        <div class="meta">${safeHtml(i.address||"")}</div>
        <div>${i.website?`<a href="${safeHtml(i.website)}" target="_blank" rel="noopener">Website</a>`:""}</div>
        ${i.note?`<div class="meta">${safeHtml(i.note)}</div>`:""}
      </div>`;
    }).join("");
    parts.push(`<div class="card"><h4>${safeHtml(title)}</h4><div class="nearby-results">${items}</div></div>`);
  }
  mount.innerHTML = parts.join("\n");
}

// -------------------- Hotel/address nearby search --------------------
const HARDCODED_POINTS = [
  { test:/\b1535\s*broadway\b/i, lat:40.758636, lon:-73.985450, label:"Marriott Marquis" },
  { test:/\b810\s*(7(th)?|seventh)\s*ave\b/i, lat:40.7628709, lon:-73.9825242, label:"CCRM New York" }
];

function normalizeAddress(q){
  let s=(q||"").trim();
  s=s.replace(/\b(floor|fl\.?|suite|ste\.?|unit|level)\s*[#\-\w]+/ig,"");
  s=s.replace(/\s+/g," ").replace(/\s*,\s*/g,", ").trim();
  s=s.replace(/\b(\d+)(st|nd|rd|th)\b/gi,"$1");
  return s;
}
function expandNYCSynonyms(base){
  const out=new Set([base]);
  if(/\b6\s*(th)?\s*ave(nue)?\b/i.test(base)){
    out.add(base.replace(/\b6\s*(th)?\s*ave(nue)?\b/ig,"Avenue of the Americas"));
    out.add(base.replace(/\b6\s*(th)?\s*ave(nue)?\b/ig,"Ave of the Americas"));
    out.add(base.replace(/\b6\s*(th)?\s*ave(nue)?\b/ig,"Sixth Avenue"));
  }
  if(/\b(avenue of the americas|ave of the americas)\b/i.test(base)){
    out.add(base.replace(/\b(avenue of the americas|ave of the americas)\b/ig,"6th Ave"));
    out.add(base.replace(/\b(avenue of the americas|ave of the americas)\b/ig,"Sixth Avenue"));
  }
  if(/\b7\s*(th)?\s*ave(nue)?\b/i.test(base)) out.add(base.replace(/\b7\s*(th)?\s*ave(nue)?\b/ig,"Seventh Avenue"));
  if(/\bseventh avenue\b/i.test(base)) out.add(base.replace(/\bseventh avenue\b/ig,"7th Ave"));
  return Array.from(out);
}
async function geocodeOnce(q){
  const ctl=new AbortController(); const t=setTimeout(()=>ctl.abort(),12000);
  const url=`https://nominatim.openstreetmap.org/search?format=json&limit=1&addressdetails=0&bounded=1&viewbox=${NYC_VIEWBOX}&q=${encodeURIComponent(q)}`;
  const res=await fetch(url,{headers:{Accept:"application/json"},signal:ctl.signal}); clearTimeout(t);
  if(!res.ok) throw new Error("Geocode failed");
  const a=await res.json(); if(!Array.isArray(a)||!a.length) throw new Error("No results");
  return {lat:parseFloat(a[0].lat),lon:parseFloat(a[0].lon)};
}
function clinicFallbackFromText(q){
  const text=(q||"").toLowerCase();
  for(const c of (DATA?.clinics||[])){
    const name=(c.name||"").toLowerCase();
    const first=(c.address||"").split(",")[0].toLowerCase();
    if(text.includes(name) || (first && text.includes(first))){
      if(typeof c.lat==="number" && typeof c.lon==="number") return {lat:c.lat,lon:c.lon,via:`clinic: ${c.name}`};
    }
  }
  return null;
}
function hardcodedFallback(q){ for(const h of HARDCODED_POINTS){ if(h.test.test(q)) return {lat:h.lat,lon:h.lon,via:`hardcoded: ${h.label}`}; } return null; }

async function geocodeAddress(q){
  const raw=(q||"").trim(); if(!raw) throw new Error("empty");
  const hard=hardcodedFallback(raw); if(hard) return hard;
  const clinicGuess=clinicFallbackFromText(raw); if(clinicGuess) return clinicGuess;

  const base=normalizeAddress(raw);
  const variants=expandNYCSynonyms(base);
  const attempts=[];
  const pushNYC=(s)=>{ const zip=(raw.match(/\b1\d{4}\b/)||[])[0];
    if(zip) attempts.push(`${s}, New York, NY ${zip}`);
    attempts.push(`${s}, Manhattan, New York, NY`, `${s}, New York, NY`, `${s}, NYC`);
  };
  variants.forEach(s=>{ attempts.push(s); pushNYC(s); });

  let last=null;
  for(const v of attempts){ try{ return await geocodeOnce(v); }catch(e){ last=e; } }
  const weak=clinicFallbackFromText(base); if(weak) return weak;
  throw last||new Error("Geocode failed");
}

function collectAllPlaces(){
  const out=[];
  (DATA?.clinics||[]).forEach(c=>{
    out.push({type:"clinic", clinic:c.name, name:c.name, lat:c.lat, lon:c.lon, address:c.address, website:c.website});
    const cats=c.categories||{};
    for(const key of Object.keys(cats)){
      for(const i of (cats[key]||[])){
        out.push({type:key, clinic:c.name, name:i.name, lat:i.lat, lon:i.lon, address:i.address, website:i.website, note:i.note});
      }
    }
  });
  (DATA?.mustSees||[]).forEach(i=> out.push({type:"mustSee", clinic:null, name:i.name, lat:i.lat, lon:i.lon, address:i.address, website:i.website, note:i.note}));
  return out;
}

async function handleNearby(){
  const btn=document.getElementById('nearbyBtn');
  const input=document.getElementById('userAddress');
  const mount=document.getElementById('nearbyResults');
  if(!btn||!input||!mount) return;

  const q=(input.value||"").trim();
  if(!q){ mount.innerHTML=`<div class="muted">Enter an address or hotel name.</div>`; return; }

  btn.disabled=true; btn.textContent="Searching…";
  mount.innerHTML=`<div class="muted">Geocoding address (NYC)…</div>`;

  try{
    const pt=await geocodeAddress(q);
    const places=(await getPlaces()).filter(p=>typeof p.lat==="number" && typeof p.lon==="number");
    const within=places.map(p=>({...p, km:kmBetween(pt.lat,pt.lon,p.lat,p.lon)}))
                       .filter(p=>p.km<=WALK_MAX_KM)
                       .sort((a,b)=>a.km-b.km);
    if(within.length){
      mount.innerHTML = within.slice(0,80).map(m=>`
        <div class="nearby-card">
          <div><strong>${safeHtml(m.name)}</strong> <span class="tag">${m.km.toFixed(2)} km</span></div>
          <div class="meta">${safeHtml(m.address||"")}${m.clinic?` · <em>${safeHtml(m.clinic)}</em>`:""}</div>
          <div>${m.website?`<a href="${safeHtml(m.website)}" target="_blank" rel="noopener">Website</a>`:""}</div>
          ${m.note?`<div class="meta">${safeHtml(m.note)}</div>`:""}
        </div>
      `).join("");
      return;
    }
    const closest=places.map(p=>({...p, km:kmBetween(pt.lat,pt.lon,p.lat,p.lon)}))
                        .sort((a,b)=>a.km-b.km).slice(0,12);
    mount.innerHTML = closest.length ? `
      <div class="muted">Nothing within ~${WALK_MAX_KM} km. Showing the closest curated spots:</div>
      ${closest.map(m=>`
        <div class="nearby-card">
          <div><strong>${safeHtml(m.name)}</strong> <span class="tag">${m.km.toFixed(2)} km</span></div>
          <div class="meta">${safeHtml(m.address||"")}${m.clinic?` · <em>${safeHtml(m.clinic)}</em>`:""}</div>
          <div>${m.website?`<a href="${safeHtml(m.website)}" target="_blank" rel="noopener">Website</a>`:""}</div>
          ${m.note?`<div class="meta">${safeHtml(m.note)}</div>`:""}
        </div>
      `).join("")}
    ` : `<div class="nearby-card"><strong>No curated spots available yet.</strong></div>`;
  }catch(err){
    console.warn("[Nearby] Error:", err);
    mount.innerHTML = `<div class="nearby-card"><strong>No nearby picks found</strong><div class="meta">Try adding the neighborhood or borough.</div></div>`;
  }finally{
    btn.disabled=false; btn.textContent="Find nearby";
  }
}

// -------------------- Remove leftover boxes if present --------------------
function removeCardByHeadingPrefix(prefix){
  document.querySelectorAll('.card').forEach(card=>{
    const h=card.querySelector('h1,h2,h3,h4,h5,h6');
    const t=(h?.textContent||"").trim().toLowerCase();
    if(t.startsWith(prefix.toLowerCase())) card.remove();
  });
}
function removeCardIfContainsButtonText(text){
  [...document.querySelectorAll('button,a,input[type="button"],input[type="submit"]')].forEach(b=>{
    if(((b.value||b.textContent||"").trim().toLowerCase())===text.toLowerCase()){
      (b.closest('.card')||b).remove();
    }
  });
}

// -------------------- Boot --------------------
document.addEventListener("DOMContentLoaded", ()=>{
  // hard-remove the two old boxes
  removeCardByHeadingPrefix("data tools");
  removeCardIfContainsButtonText("add coordinates & download json");
  removeCardByHeadingPrefix("clinics"); // only the static header card

  loadClinics();
  document.getElementById('nearbyBtn')?.addEventListener('click', handleNearby);
});
