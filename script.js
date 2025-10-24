
/**
 * Aster NYC Guide – nearest places engine (final fix)
 * - Featured items must match the current section type
 * - Website-only link, card spacing, miles + min walk
 */
(function () {
  const STATE = { data:null, clinic:null, radius:1200, typeFilters:new Set(), tagFilters:new Set(), limitPerGroup:8 };

  function haversine(lat1, lon1, lat2, lon2) {
    const R = 6371000, toRad = d => d * Math.PI / 180;
    const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)**2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }
  const metersToMiles = m => m * 0.000621371;
  const metersToWalkMins = m => Math.round(m / 80);

  function loadPlaces() {
    return fetch('places.json', { cache: 'no-cache' })
      .then(r => { if (!r.ok) throw new Error('Failed to fetch places.json'); return r.json(); })
      .then(json => { STATE.data = json; initUI(); STATE.clinic = json.clinics[0]; renderAll(); })
      .catch(err => { console.error(err); const el=document.getElementById('results'); if (el) el.innerHTML='<div class="card error">Could not load curated data. Please ensure <code>places.json</code> is deployed next to this page.</div>'; });
  }

  function initUI() {
    const sel=document.getElementById('clinicSelect');
    if (sel && STATE.data) {
      sel.innerHTML = STATE.data.clinics.map(c=>`<option value="${c.id}">${c.name}</option>`).join('');
      sel.value = STATE.data.clinics[0]?.id || '';
      sel.addEventListener('change', () => { STATE.clinic = STATE.data.clinics.find(c=>c.id===sel.value)||STATE.data.clinics[0]; renderAll(); });
    }
    const radius=document.getElementById('radiusInput');
    if (radius) { radius.value=String(STATE.radius); radius.addEventListener('input', ()=>{ STATE.radius=Number(radius.value)||1200; renderAll(); }); }
    document.querySelectorAll('[data-filter-group="type"] input[type="checkbox"]').forEach(cb => {
      cb.addEventListener('change', ()=>{ if (cb.checked) STATE.typeFilters.add(cb.value); else STATE.typeFilters.delete(cb.value); renderAll(); });
    });
    document.querySelectorAll('[data-filter-group="tag"] input[type="checkbox"]').forEach(cb => {
      cb.addEventListener('change', ()=>{ if (cb.checked) STATE.tagFilters.add(cb.value); else STATE.tagFilters.delete(cb.value); renderAll(); });
    });
  }

  function getNearbyPlaces({ clinic, places, types=[], radiusMeters=1200, limit=8, mustHaveTags=new Set() }) {
    const featured = places.filter(p =>
      Array.isArray(p.featured_for) &&
      p.featured_for.includes(clinic.id) &&
      (!types.length || types.includes(p.type))
    );
    let candidates = places.filter(p => {
      const typeOK = !types.length || types.includes(p.type);
      const tagsArray = (p.dietary||[]).concat(p.tags||[]);
      const tagsOK = !mustHaveTags.size ? true : tagsArray.some(t => mustHaveTags.has(t));
      return typeOK && tagsOK;
    });
    candidates = candidates.map(p=>({ ...p, distance:haversine(clinic.lat, clinic.lon, p.lat, p.lon) }))
                           .filter(p=> p.distance <= radiusMeters && !featured.find(f=>f.id===p.id));
    candidates.sort((a,b)=> a.distance-b.distance || (String(a.price_level||'').length - String(b.price_level||'').length) || a.name.localeCompare(b.name));
    const featWithDist = featured.map(p=>({ ...p, distance:haversine(clinic.lat, clinic.lon, p.lat, p.lon) })).sort((a,b)=>a.distance-b.distance);
    return [...featWithDist, ...candidates].slice(0, limit);
  }

  function renderCard(p) {
    const miles = metersToMiles(p.distance||0);
    const mins = metersToWalkMins(p.distance||0);
    const dist = p.distance!=null ? `${miles.toFixed(1)} mi · ${mins} min walk` : '';
    const tags = (p.tags||[]).concat(p.dietary||[]);
    const tagHtml = tags.map(t=>`<span class="chip">${t}</span>`).join('');
    const price = p.price_level ? `<span class="price">${p.price_level}</span>` : '';
    const note = p.note ? `<div class="note">${p.note}</div>` : '';
    const website = p.website ? `<a class="visit-link" href="${p.website}" target="_blank" rel="noopener">Visit website</a>` : '';
    return `<div class="place-card">
      <div class="place-card__row">
        <div class="place-card__title">${p.name}</div>
        <div class="place-card__meta">${price}${dist ? ` · ${dist}` : ''}</div>
      </div>
      <div class="place-card__sub">${p.address}</div>
      ${tagHtml ? `<div class="place-card__tags">${tagHtml}</div>` : ''}
      ${note}
      ${website}
    </div>`;
  }

  function renderSection(title, items) {
    if (!items.length) return '';
    return `<section class="card">
      <h3 class="section-title">${title}</h3>
      <div class="grid grid-gap">${ items.map(renderCard).join('') }</div>
    </section>`;
  }

  function renderAll() {
    const root=document.getElementById('results'); if (!root||!STATE.data||!STATE.clinic) return;
    const { places } = STATE.data; const radius=STATE.radius;
    const types = STATE.typeFilters.size ? Array.from(STATE.typeFilters) : [];
    const tags  = STATE.tagFilters;
    const groups=[
      { key:'cafe', title:'Cafés Near This Clinic' },
      { key:'restaurant', title:'Great Eats Nearby' },
      { key:'shopping', title:'Shopping & Markets' },
      { key:'iconic', title:'Iconic NYC Must‑Sees' }
    ].filter(g=>!types.length || types.includes(g.key));
    const html = groups.map(g=>{
      const items = getNearbyPlaces({ clinic:STATE.clinic, places, types:g.key?[g.key]:[], radiusMeters:radius, limit:STATE.limitPerGroup, mustHaveTags:tags });
      return renderSection(g.title, items);
    }).join('');
    const mins=(radius/80).toFixed(1), miles=(radius*0.000621371).toFixed(2);
    root.innerHTML = `<div class="header-compact">
      <div><strong>Clinic:</strong> ${STATE.clinic.name}</div>
      <div><strong>Radius:</strong> ~${mins} min (~${miles} mi)</div>
    </div>${html || '<div class="card">No results match your filters.</div>'}`;
  }

  window.AsterGuide = { loadPlaces, getNearbyPlaces, renderAll, state: STATE };
  if (document.getElementById('results')) loadPlaces();
})();
