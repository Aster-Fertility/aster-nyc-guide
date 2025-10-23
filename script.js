/* ================================
   Aster NYC Guide — script.js (ASCII only)
   - Loads nyc_fertility_locations.json
   - Populates #clinicSelect dropdown
   - Fallback text search via #query if present
   - Renders clinic cards to #results
   - "Near your hotel" search using Nominatim geocoding
   - Includes mustSees (from JSON) in nearby results
=================================== */

(function(){
  "use strict";

  // -------------------------------
  // State
  // -------------------------------
  window.DATA = window.DATA || null;   // { clinics: [...], mustSees: [...] }
  window.LOADED = false;

  // -------------------------------
  // DOM helpers
  // -------------------------------
  function $(sel){ return document.querySelector(sel); }
  function $all(sel){ return Array.prototype.slice.call(document.querySelectorAll(sel)); }

  // -------------------------------
  // Simple HTML escaper for labels
  // -------------------------------
  function escHtml(s){
    if (s == null) return "";
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/"/g, "&quot;");
  }

  // -------------------------------
  // Read current query from dropdown or input
  // -------------------------------
  function currentQuery(){
    var sel = document.getElementById("clinicSelect");
    if (sel) return sel.value || "";
    var inp = document.getElementById("query");
    return inp ? (inp.value || "") : "";
  }

  // -------------------------------
  // Data loading (with fallback path)
  // -------------------------------
  async function loadData(){
    try{
      var res = await fetch("nyc_fertility_locations.json");
      if(!res.ok) res = await fetch("/nyc_fertility_locations.json");
      if(!res.ok){
        console.warn("Fell back to empty data; could not fetch JSON.");
        window.DATA = { clinics: [], mustSees: [] };
        window.LOADED = true;
        return;
      }
      var json = await res.json();
      if(!json || !Array.isArray(json.clinics)){
        console.warn("JSON missing clinics array. Using empty set.");
        window.DATA = { clinics: [], mustSees: (json && json.mustSees) ? json.mustSees : [] };
        window.LOADED = true;
        return;
      }

      // set data when valid
      window.DATA = {
        clinics: json.clinics || [],
        mustSees: json.mustSees || []
      };
      window.LOADED = true;

      // populate the dropdown now that data is set
      populateClinicDropdown();
    }catch(e){
      console.error("Unexpected error loading JSON:", e);
      window.DATA = { clinics: [], mustSees: [] };
      window.LOADED = true;
    }
  }

  // -------------------------------
  // Populate the clinic dropdown
  // -------------------------------
  function populateClinicDropdown(){
    var sel = document.getElementById("clinicSelect");
    if (!sel || !window.DATA || !Array.isArray(window.DATA.clinics)) return;

    try{
      var list = window.DATA.clinics.slice();
      list.sort(function(a,b){
        var an = a && a.name ? a.name : "";
        var bn = b && b.name ? b.name : "";
        return an.localeCompare(bn);
      });

      var html = '<option value="">Select a clinic...</option>';
      for (var i=0; i<list.length; i++){
        var c = list[i] || {};
        var name = c.name || "(Unnamed clinic)";
        var address = c.address ? " - " + String(c.address) : "";
        var label = (name + address);
        var value = String(c.name || "");

        html += '<option value="' + escHtml(value) + '">' + escHtml(label) + "</option>";
      }
      sel.innerHTML = html;
    }catch(err){
      console.warn("populateClinicDropdown failed", err);
    }
  }

  function attachClinicDropdownHandler(){
    var sel = document.getElementById("clinicSelect");
    if (!sel || sel._wired) return;
    sel.addEventListener("change", function(){
      var q = currentQuery();
      if (typeof doSearch === "function") { doSearch(q); }
      else if (typeof runSearch === "function") { runSearch(q); }
      else if (typeof search === "function") { search(q); }
      else {
        // Built-in simple filter as a fallback
        renderClinics(filterClinics(q));
      }
    });
    sel._wired = true;
  }

  // -------------------------------
  // Simple render + filter (fallback if you do not have your own)
  // -------------------------------
  function filterClinics(q){
    q = (q || "").toLowerCase().trim();
    var arr = (window.DATA && window.DATA.clinics) ? window.DATA.clinics : [];
    if (!q) return arr.slice();
    return arr.filter(function(c){
      var s1 = (c.name || "").toLowerCase();
      var s2 = (c.address || "").toLowerCase();
      return s1.indexOf(q) >= 0 || s2.indexOf(q) >= 0;
    });
  }

  function renderClinics(list){
    var container = document.getElementById("results");
    if (!container){
      console.warn("#results container not found");
      return;
    }
    if (!list || !list.length){
      container.innerHTML = '<div class="card"><p>No clinics found. Try selecting a clinic from the dropdown.</p></div>';
      return;
    }
    var out = [];
    for (var i=0; i<list.length; i++){
      var c = list[i] || {};
      var name = c.name || "Clinic";
      var addr = c.address || "";
      var website = c.website || "";
      var cats = c.categories || {};
      // tag row with category counts
      var tags = [];
      for (var key in cats){
        if (!cats.hasOwnProperty(key)) continue;
        var arr = Array.isArray(cats[key]) ? cats[key] : [];
        if (arr.length) tags.push('<span class="tag">' + escHtml(key) + " • " + arr.length + "</span>");
      }
      out.push(
        '<article class="card">' +
          "<h4>" + escHtml(name) + "</h4>" +
          '<div class="addr">' + escHtml(addr) + "</div>" +
          (website ? '<div><a href="' + escHtml(website) + '" target="_blank" rel="noopener">Website</a></div>' : "") +
          (tags.length ? '<div class="tag-row">' + tags.join("") + "</div>" : "") +
        "</article>"
      );
    }
    container.innerHTML = out.join("");
  }

  // Hook up your Show All button if present
  function attachShowAll(){
    var btn = document.getElementById("showAllBtn");
    if (!btn) return;
    btn.addEventListener("click", function(){
      // reset dropdown if present
      var sel = document.getElementById("clinicSelect");
      if (sel) sel.value = "";
      // reset text input if present
      var inp = document.getElementById("query");
      if (inp) inp.value = "";
      renderClinics((window.DATA && window.DATA.clinics) ? window.DATA.clinics : []);
    });
  }

  // -------------------------------
  // Geocoding + "Near your hotel"
  // -------------------------------
  var NOMINATIM_BASE = "https://nominatim.openstreetmap.org/search";
  var GEO_CACHE = new Map();

  function haversineMiles(a, b){
    var R = 3958.7613;
    function toRad(d){ return d * Math.PI / 180; }
    var dLat = toRad(b.lat - a.lat);
    var dLon = toRad(b.lon - a.lon);
    var s = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) *
            Math.sin(dLon/2) * Math.sin(dLon/2);
    return 2 * R * Math.asin(Math.sqrt(s));
  }

  async function geocodeBiased(address, stateHint){
    // Simple Nominatim request with NY bias
    var params = new URLSearchParams();
    params.set("format", "json");
    params.set("limit", "1");
    params.set("q", stateHint ? (address + ", " + stateHint + ", USA") : (address + ", USA"));
    var url = NOMINATIM_BASE + "?" + params.toString();
    var res = await fetch(url, { headers: { "Accept": "application/json" }});
    if (!res.ok) return null;
    var js = await res.json();
    if (!Array.isArray(js) || !js.length) return null;
    return { lat: parseFloat(js[0].lat), lon: parseFloat(js[0].lon) };
  }

  async function geocodeCached(address, stateHint){
    var key = (String(address || "") + "|" + String(stateHint || "")).toLowerCase().trim();
    if (GEO_CACHE.has(key)) return GEO_CACHE.get(key);
    var pt = await geocodeBiased(address, stateHint);
    if (pt) GEO_CACHE.set(key, pt);
    return pt;
  }

  function collectPlaces(){
    var out = [];
    var data = (window.DATA && window.DATA.clinics) ? window.DATA.clinics : [];
    for (var i=0; i<data.length; i++){
      var clinic = data[i] || {};
      var cats = clinic.categories || {};
      for (var k in cats){
        if (!cats.hasOwnProperty(k)) continue;
        var arr = Array.isArray(cats[k]) ? cats[k] : [];
        for (var j=0; j<arr.length; j++){
          var p = arr[j] || {};
          if (!p.address) continue;
          out.push({
            category: k,
            name: p.name || "(Unnamed)",
            address: p.address,
            website: p.website || "",
            clinic: clinic.name || ""
          });
        }
      }
    }
    // add mustSees if present
    var ms = (window.DATA && Array.isArray(window.DATA.mustSees)) ? window.DATA.mustSees : [];
    for (var m=0; m<ms.length; m++){
      var it = ms[m] || {};
      if (!it.address) continue;
      out.push({
        category: "must-see",
        name: it.title || "(Must-See)",
        address: it.address,
        website: it.website || "",
        clinic: "Iconic NYC"
      });
    }
    return out;
  }

  async function findNearby(address, radiusMiles){
    var here = await geocodeCached(address, "NY");
    if (!here) throw new Error("Could not geocode that address.");
    var places = collectPlaces();
    // de-dup by address
    var uniq = {};
    var arr = [];
    for (var i=0; i<places.length; i++){
      var key = (places[i].address || "").toLowerCase().trim();
      if (!uniq[key]){ uniq[key] = true; arr.push(places[i]); }
    }
    // geocode each place (cached)
    var results = [];
    for (var k=0; k<arr.length; k++){
      var pl = arr[k];
      try{
        var pt = await geocodeCached(pl.address, "NY");
        if (pt){
          var miles = haversineMiles({lat:here.lat, lon:here.lon}, {lat:pt.lat, lon:pt.lon});
          if (miles <= radiusMiles){
            pl.miles = miles;
            results.push(pl);
          }
        }
      }catch(_){}
    }
    results.sort(function(a,b){ return a.miles - b.miles; });
    return results;
  }

  function renderNearby(list){
    var wrap = document.getElementById("nearbyResults");
    var hint = document.getElementById("nearbyHint");
    if (!wrap) return;
    if (!list || !list.length){
      wrap.innerHTML = '<div class="nearby-card"><strong>No nearby picks found</strong><div class="meta">Try adding the city/borough.</div></div>';
      if (hint) hint.textContent = "We could not find that address. Try adding the city/borough.";
      return;
    }
    var out = [];
    for (var i=0; i<list.length; i++){
      var r = list[i];
      out.push(
        '<div class="nearby-card">' +
          "<div><strong>" + escHtml(r.name) + "</strong> <span class=\"meta\">• " + escHtml(r.category) + " • " + escHtml(r.clinic) + "</span></div>" +
          "<div class=\"meta\">" + escHtml(r.address) + " • ~" + r.miles.toFixed(2) + " mi</div>" +
          (r.website ? ('<div><a href="' + escHtml(r.website) + '" target="_blank" rel="noopener">Website</a></div>') : "") +
        "</div>"
      );
    }
    wrap.innerHTML = out.join("");
    if (hint) hint.textContent = "Showing places within ~15 min walk.";
  }

  function attachNearby(){
    var btn = document.getElementById("nearbyBtn");
    var input = document.getElementById("userAddress");
    var hint = document.getElementById("nearbyHint");
    if (!btn || !input) return;
    var handler = async function(){
      if (!window.DATA || !Array.isArray(window.DATA.clinics)){
        renderNearby([]);
        return;
      }
      var val = (input.value || "").trim();
      if (!val){ renderNearby([]); return; }
      btn.disabled = true;
      if (hint) hint.textContent = "Searching nearby...";
      try{
        // 0.7 mi ~ 15 minute walk
        var res = await findNearby(val, 0.7);
        renderNearby(res);
      }catch(e){
        console.error(e);
        renderNearby([]);
      }finally{
        btn.disabled = false;
      }
    };
    btn.addEventListener("click", handler);
    input.addEventListener("keydown", function(e){ if (e.key === "Enter") handler(); });
  }

  // -------------------------------
  // Startup
  // -------------------------------
  window.addEventListener("DOMContentLoaded", function(){
    loadData();                    // fetch JSON
    populateClinicDropdown();      // in case DATA is already present (SSR or cached)
    attachClinicDropdownHandler(); // fire search on change
    attachShowAll();               // show all button, if present
    attachNearby();                // near your hotel logic

    // If you have your own input search, keep it working:
    var inp = document.getElementById("query");
    if (inp && !inp._wired){
      inp.addEventListener("input", function(){
        var q = currentQuery();
        if (typeof doSearch === "function") { doSearch(q); }
        else if (typeof runSearch === "function") { runSearch(q); }
        else if (typeof search === "function") { search(q); }
        else { renderClinics(filterClinics(q)); }
      });
      inp._wired = true;
    }

    // Render all by default if you want a starting view
    if (window.DATA && Array.isArray(window.DATA.clinics) && window.DATA.clinics.length){
      renderClinics(window.DATA.clinics);
    }
  });

})();
