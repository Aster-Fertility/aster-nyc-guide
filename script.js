/* Aster NYC Guide — places.json only
   Category mapping rules:
   - "Magnolia Bakery" → Cafes & Bagels
   - "MoMA Design Store" → Shopping
   - pizza_bagels: "pizza"→Restaurants, "bagel"→Cafes & Bagels
   - hidden_gems → Shopping
   - iconic → Activities
   - any "museum", "MoMA", "Metropolitan Museum", "AMNH", "Memorial & Museum" → Museums
   10-minute walking radius; shows walking time in minutes.
*/

(() => {
  const PLACES_JSON = 'places.json';
  const METERS_PER_MIN = 80;
  const WALK_MIN = 10;
  const WALK_METERS = METERS_PER_MIN * WALK_MIN;

  const $ = (id) => document.getElementById(id);
  const selClinic  = $('clinicSelect');
  const btnShowAll = $('showAllBtn');
  const inputAddr  = $('userAddress');
  const btnNearby  = $('nearbyBtn');
  const resultsEl  = $('results');
  const statusEl   = $('status') || (() => {
    const el = document.createElement('div');
    el.id = 'status';
    el.className = 'muted';
    document.body.prepend(el);
    return el;
  })();

  const setStatus = (t='') => { if (statusEl) statusEl.textContent = t; };

  let ALL_PLACES=[], CLINICS=[], CURATED=[];

  /* ---------- utils ---------- */
  const toRad = (x) => (x*Math.PI)/180;
  function haversineMeters(a,b){
    if(!a||!b||a.lat==null||b.lat==null) return Infinity;
    const R=6371000,dLat=toRad(b.lat-a.lat),dLon=toRad(b.lon-a.lon);
    const lat1=toRad(a.lat),lat2=toRad(b.lat);
    const h=Math.sin(dLat/2)**2+Math.cos(lat1)*Math.cos(lat2)*Math.sin(dLon/2)**2;
    return 2*R*Math.asin(Math.sqrt(h));
  }
  const fmtWalkTime=m=>isFinite(m)?`${Math.max(1,Math.round(m/METERS_PER_MIN))} min walk`:'';  

  /* ---------- category mapping ---------- */
  const museumRegex=/\b(museum|moma|metropolitan museum|american museum of natural history|memorial\s*&?\s*museum)\b/i;
  const pizzaRegex=/\b(pizza|pizzeria)\b/i;
  const bagelRegex=/\b(bagel)\b/i;
  const magnoliaRegex=/magnolia bakery/i;
  const momaStoreRegex=/moma design store/i;

  function normalizeCategory(p){
    const original=(p.type||'').toLowerCase();
    const name=p.name||'';

    if(magnoliaRegex.test(name)) return 'cafes';
    if(momaStoreRegex.test(name)) return 'shopping';
    if(museumRegex.test(name)) return 'museums';

    if(original==='pizza_bagels'){
      if(bagelRegex.test(name)) return 'cafes';
      if(pizzaRegex.test(name)) return 'restaurants';
      return 'restaurants';
    }
    if(original==='hidden_gems') return 'shopping';
    if(original==='iconic') return 'activities';
    return original||'other';
  }

  /* ---------- load ---------- */
  async function loadPlaces(){
    try{
      const res=await fetch(PLACES_JSON,{headers:{Accept:'application/json'}});
      if(!res.ok) throw new Error(`HTTP ${res.status}`);
      const json=await res.json();
      ALL_PLACES=Array.isArray(json?.places)?json.places:[];
      const seen=new Set();
      ALL_PLACES=ALL_PLACES.filter(p=>{
        const k=`${(p.name||'').trim()}|${(p.address||'').trim()}`.toLowerCase();
        if(seen.has(k)) return false; seen.add(k); return true;
      });
      CLINICS=ALL_PLACES.filter(p=>(p.type||'').toLowerCase()==='clinic');
      CURATED=ALL_PLACES.filter(p=>(p.type||'').toLowerCase()!=='clinic')
                        .map(p=>({...p,_normType:normalizeCategory(p)}));
      return true;
    }catch(e){
      console.error(e);
      const hint=location.protocol==='file:'?
        'Run a local web server (e.g. “python -m http.server”).':
        'Ensure places.json is accessible.';
      setStatus(`Could not load places.json. ${hint}`);
      return false;
    }
  }

  /* ---------- render ---------- */
  function populateClinicDropdown(){
    const opts=['<option value="">Select a clinic…</option>']
      .concat([...CLINICS].sort((a,b)=>a.name.localeCompare(b.name))
      .map(c=>`<option value="${c.name}">${c.name}</option>`));
    selClinic.innerHTML=opts.join('');
  }

  function renderClinics(list,title='Clinics'){
    resultsEl.innerHTML=`
      <div class="card">
        <h3 class="section-title">${title}</h3>
        <div class="grid grid-clinics">
          ${list.map(c=>`
            <div class="clinic-card">
              <div class="clinic-title">${c.name}</div>
              <div class="clinic-sub">${c.address}</div>
              ${c.website?`<a class="ext" href="${c.website}" target="_blank">Website</a>`:''}
            </div>`).join('')}
        </div>
      </div>`;
  }

  function renderNearby(anchor,groups){
    const order=['museums','restaurants','cafes','shopping','activities','broadway_comedy','other'];
    const labels={
      museums:'Museums',
      restaurants:'Restaurants',
      cafes:'Cafes & Bagels',
      shopping:'Shopping',
      activities:'Activities',
      broadway_comedy:'Broadway & Comedy',
      other:'Other'
    };
    const hdr=`
      <div class="card">
        <h3 class="section-title">Near: ${anchor.label}</h3>
        ${anchor.display||anchor.address?`<p class="muted">${anchor.display||anchor.address}</p>`:''}
        <p class="muted">Showing places within ~${WALK_MIN} minutes on foot.</p>
      </div>`;
    const blocks=order.map(cat=>{
      const rows=groups[cat]||[];
      if(!rows.length)return'';
      const cards=rows.map(r=>`
        <div class="place-card">
          <div class="place-title">${r.name}</div>
          <div class="place-sub">${r.address}</div>
          <div class="place-meta">${fmtWalkTime(r._dist)}</div>
          ${r.website?`<a class="ext" href="${r.website}" target="_blank">Website</a>`:''}
        </div>`).join('');
      return`
        <div class="card">
          <h3 class="section-title">${labels[cat]}</h3>
          <div class="grid grid-places">${cards}</div>
        </div>`;
    }).join('');
    resultsEl.insertAdjacentHTML('beforeend',hdr+blocks);
  }

  /* ---------- grouping ---------- */
  function groupCurated(anchor){
    const withDist=CURATED
      .filter(p=>isFinite(p.lat)&&isFinite(p.lon))
      .map(p=>({...p,_dist:haversineMeters(anchor,{lat:p.lat,lon:p.lon})}))
      .filter(p=>p._dist<=WALK_METERS);
    const groups={};
    for(const p of withDist){
      const cat=p._normType||'other';
      (groups[cat]??=[]).push(p);
    }
    Object.keys(groups).forEach(k=>groups[k].sort((a,b)=>a._dist-b._dist));
    return groups;
  }

  /* ---------- geocoding ---------- */
  async function geocodeNominatim(q,tries=4){
    const url=`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(q)}`;
    let backoff=700;
    for(let i=0;i<tries;i++){
      try{
        setStatus(i?`Retrying geocoder (${i}/${tries-1})`:'Searching address…');
        const resp=await fetch(url,{headers:{Accept:'application/json'}});
        if(resp.status===503)throw new Error('503');
        if(!resp.ok)throw new Error(`HTTP ${resp.status}`);
        const arr=await resp.json();
        if(arr?.length){
          const h=arr[0];
          return{lat:+h.lat,lon:+h.lon,display:h.display_name};
        }
        return null;
      }catch{await new Promise(r=>setTimeout(r,backoff));backoff=Math.min(backoff*1.7,4000);}
    }
    return nul
