let DATA = null;
const $q = (sel) => document.querySelector(sel);
const $results = $q('#results');
const $input = $q('#query');
const $suggestions = $q('#suggestions');

function isAppleMapsPreferred(){
  return /iPad|iPhone|iPod|Macintosh/.test(navigator.userAgent);
}

// Single-place map link (unchanged)
function mapsLink(address){
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}

// NEW: directions link from clinic -> place
function mapsDirectionsLink(originAddress, destAddress, mode /* 'walking' | 'driving' */ = 'driving'){
  if(!originAddress || !destAddress) return '';
  if(isAppleMapsPreferred()){
    // Apple Maps: dirflg=w (walking) or d (driving)
    const flag = mode === 'walking' ? 'w' : 'd';
    return `http://maps.apple.com/?saddr=${encodeURIComponent(originAddress)}&daddr=${encodeURIComponent(destAddress)}&dirflg=${flag}`;
  }
  // Google Maps Directions
  return `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(originAddress)}&destination=${encodeURIComponent(destAddress)}&travelmode=${mode}`;
}


async function loadData(){
  const res = await fetch('nyc_fertility_locations.json');
  DATA = await res.json();
  $suggestions.innerHTML = `Clinics: ${DATA.clinics.map(c => c.name).join(' · ')}`;
}

function byQuery(clinic, q){
  const needle = q.toLowerCase();
  return clinic.name.toLowerCase().includes(needle) || clinic.address.toLowerCase().includes(needle);
}

function mapsLink(address){ return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`; }

function itemHTMLBase(it, clinicAddress){
  const hasAddr = !!it.address;
  const dirDrive = hasAddr ? mapsDirectionsLink(clinicAddress, it.address, 'driving') : '';
  const dirWalk  = hasAddr ? mapsDirectionsLink(clinicAddress, it.address, 'walking') : '';
  const lines = [
    it.address ? `<p>${it.address}${it.phone ? ` • ${it.phone}`:''}</p>` : (it.phone ? `<p>${it.phone}</p>`:''),
    // Links row: Website • Open in Maps • Directions (Drive/Walk)
    `<p>
      ${it.website ? `<a href="${it.website}" target="_blank" rel="noopener">Website</a>` : ''}
      ${hasAddr ? `${it.website ? ' • ' : ''}<a href="${mapsLink(it.address)}" target="_blank" rel="noopener">Open in Maps</a>` : ''}
      ${hasAddr ? ` • <a href="${dirDrive}" target="_blank" rel="noopener">Directions (Drive)</a> • <a href="${dirWalk}" target="_blank" rel="noopener">Directions (Walk)</a>` : ''}
    </p>`,
    it.note ? `<p>${it.note}</p>` : ''
  ].join('');
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


function search(){
  const q = $input.value.trim();
  let list = DATA.clinics;
  if(q) list = list.filter(c => byQuery(c, q));
  if(!list.length){
    $results.innerHTML = `<div class="card"><p>No clinics matched. Try “Weill Cornell” or an address like “1305 York”.</p></div>`;
    return;
  }
  $results.innerHTML = list.map(renderClinic).join('');
}

$q('#searchBtn').addEventListener('click', search);
$q('#showAllBtn').addEventListener('click', () => {
  $input.value = '';
  $results.innerHTML = DATA.clinics.map(renderClinic).join('');
});
$input.addEventListener('keydown', (e)=>{ if(e.key === 'Enter') search(); });

loadData();
