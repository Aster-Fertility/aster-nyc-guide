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

function itemHTML(it){
  const noteLine = it.note ? `<p>${it.note}</p>` : '';
  const lines = [
    it.address ? `<p>${it.address}${it.phone ? ` • ${it.phone}`:''}</p>` : (it.phone ? `<p>${it.phone}</p>`:''),
    it.website ? `<p><a href="${it.website}" target="_blank" rel="noopener">Website</a>${it.address ? ` • <a href="${mapsLink(it.address)}" target="_blank" rel="noopener">Open in Maps</a>`:''}</p>` : '',
    noteLine
  ].join('');
  return `<div class="item card"><h4>${it.name}</h4>${lines}</div>`;
}

function sectionHTML(title, arr){
  if(!arr || !arr.length) return '';
  return `
    <div class="card">
      <h3 class="section-title">${title}</h3>
      <div class="grid">${arr.map(itemHTML).join('')}</div>
    </div>
  `;
}

function renderClinic(clinic){
  return `
    <div class="card">
      <h2>${clinic.name} <span class="badge">Clinic</span></h2>
      <p>${clinic.address} • <a href="${clinic.website}" target="_blank" rel="noopener">Website</a> • <a href="${mapsLink(clinic.address)}" target="_blank" rel="noopener">Open in Maps</a></p>
    </div>
    ${sectionHTML('Cafés', clinic.categories.cafes)}
    ${sectionHTML('Restaurants', clinic.categories.restaurants)}
    ${sectionHTML('Pizza & Bagels', clinic.categories.pizza_bagels)}
    ${sectionHTML('Hidden Gems & Local Favorites', clinic.categories.hidden_gems)}
    ${sectionHTML('Broadway & Comedy Shows', clinic.categories.broadway_comedy)}
    ${sectionHTML('Nearby Activities & Landmarks', clinic.categories.activities)}
    ${sectionHTML('Iconic NYC Things to Do', clinic.categories.iconic)}
  `;
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
