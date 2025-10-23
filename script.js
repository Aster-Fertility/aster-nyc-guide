(function(){
  "use strict";
  window.DATA = window.DATA || null;
  window.LOADED = !!window.DATA;

  // ---------- Helpers ----------
  function escHtml(s){ if(s==null) return ""; return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/"/g,"&quot;"); }
  function currentQuery(){
    var sel = document.getElementById("clinicSelect");
    if (sel) return sel.value || "";
    var inp = document.getElementById("query");
    return inp ? (inp.value || "") : "";
  }
  function sleep(ms){ return new Promise(function(res){ setTimeout(res, ms); }); }

  // ---------- Data load ----------
  async function loadData(){
    try{
      var res = await fetch("nyc_fertility_locations.json");
      if(!res.ok) res = await fetch("/nyc_fertility_locations.json");
      if(!res.ok){ window.DATA={clinics:[],mustSees:[]}; window.LOADED=true; return; }
      var json = await res.json();
      if(!json || !Array.isArray(json.clinics)){ window.DATA={clinics:[],mustSees:(json&&json.mustSees)||[]}; window.LOADED=true; return; }
      window.DATA = { clinics: json.clinics||[], mustSees: json.mustSees||[] };
      window.LOADED = true;
      populateClinicDropdown();
      renderClinics(window.DATA.clinics);
    }catch(e){
      console.error(e);
      window.DATA = {clinics:[], mustSees:[]};
      window.LOADED = true;
    }
  }

  // ---------- Clinic dropdown ----------
  function populateClinicDropdown(){
    var sel = document.getElementById("clinicSelect");
    if (!sel || !window.DATA || !Array.isArray(window.DATA.clinics)) return;
    try{
      var list = window.DATA.clinics.slice();
      list.sort(function(a,b){
        var an=a&&a.name?a.name:"", bn=b&&b.name?b.name:"";
        return an.localeCompare(bn);
      });
      var html = '<option value="">Select a clinic...</option>';
      for(var i=0;i<list.length;i++){
        var c=list[i]||{}, name=c.name||"(Unnamed clinic)", address=c.address?(" - "+c.address):"";
        html += '<option value="'+escHtml(name)+'">'+escHtml(name+address)+'</option>';
      }
      sel.innerHTML = html;
    }catch(e){ console.warn("populateClinicDropdown failed", e); }
  }
  function attachClinicDropdownHandler(){
    var sel = document.getElementById("clinicSelect");
    if (!sel || sel._wired) return;
    sel.addEventListener("change", function(){
      var q = currentQuery();
      if (typeof doSearch==="function") doSearch(q);
      else if (typeof runSearch==="function") runSearch(q);
      else if (typeof search==="function") search(q);
      else renderClinics(filterClinics(q));
    });
    sel._wired = true;
  }

  // ---------- Render/Filter (fallback) ----------
  function filterClinics(q){
    q = (q||"").toLowerCase().trim();
    var arr = (window.DATA && window.DATA.clinics) ? window.DATA.clinics : [];
    if (!q) return arr.slice();
    return arr.filter(function(c){
      var n=(c.name||"").toLowerCase(), a=(c.address||"").toLowerCase();
      return n.indexOf(q)>=0 || a.indexOf(q)>=0;
    });
  }
  function renderClinics(list){
    var el=document.getElementById("results"); if(!el){console.warn("#results missing");return;}
    if(!list||!list.length){ el.innerHTML='<div class="card"><p>No clinics found.</p></div>'; return; }
    var out=[], i, c, name, addr, site, cats, k, arr, tags;
    for(i=0;i<list.length;i++){
      c=list[i]||{}; name=c.name||"Clinic"; addr=c.address||""; site=c.website||""; cats=c.categories||{}; tags=[];
      for(k in cats){ if(!cats.hasOwnProperty(k)) continue; arr=Array.isArray(cats[k])?cats[k]:[]; if(arr.length) tags.push('<span class="tag">'+escHtml(k)+' • '+arr.length+'</span>'); }
      out.push('<article class="card"><h4>'+escHtml(name)+'</h4><div class="addr">'+escHtml(addr)+'</div>'
        +(site?'<div><a href="'+escHtml(site)+'" target="_blank" rel="noopener">Website</a></div>':"")
        +(tags.length?'<div class="tag-row">'+tags.join("")+'</div>':"")
        +'</article>');
    }
    el.innerHTML = out.join("");
  }

  // ---------- Near your hotel (throttled + progressive) ----------
  var NOMINATIM_BASE="https://nominatim.openstreetmap.org/search";
  var NYC_VIEWBOX = [-74.25909, 40.477399, -73.700272, 40.916178]; // SW lon, SW lat, NE lon, NE lat
  var GEO_CACHE=new Map();
  var GEOCODE_DELAY_MS = 320;      // throttle between requests
  var GEOCODE_LIMIT = 80;          // max addresses to geocode per search
  var RESULTS_TARGET = 30;         // stop early when we have enough
  var ACTIVE_MATCH_TOKEN = 0;      // cancel in-flight match when a new one starts

  async function geocodeBiased(address){
    var p=new URLSearchParams();
    p.set("format","jsonv2");
    p.set("limit","1");
    p.set("countrycodes","us");
    p.set("addressdetails","0");
    p.set("viewbox", NYC_VIEWBOX.join(","));
    p.set("bounded","1");
    p.set("q", address+", New York");
    var url = NOMINATIM_BASE+"?"+p.toString();
    var res;
    try{
      res = await fetch(url, { headers: { "Accept":"application/json" } });
    }catch(netErr){
      return { error: "network" };
    }
    if (!res.ok){
      if (res.status === 429) return { error: "rate" };
      return { error: "http:"+res.status };
    }
    var js;
    try { js = await res.json(); } catch(parseErr){ return { error: "parse" }; }
    if (!Array.isArray(js) || !js.length) return null;
    return { lat: parseFloat(js[0].lat), lon: parseFloat(js[0].lon) };
  }

  async function geocodeCachedThrottled(address){
    var key=(String(address||"")).toLowerCase().trim();
    if(GEO_CACHE.has(key)) return GEO_CACHE.get(key);
    // throttle
    await sleep(GEOCODE_DELAY_MS);
    var pt=await geocodeBiased(address);
    GEO_CACHE.set(key, pt);
    return pt;
  }

  function collectPlaces(){
    var out=[], data=(window.DATA&&window.DATA.clinics)?window.DATA.clinics:[], i, clinic, cats, k, arr, j, p;
    for(i=0;i<data.length;i++){
      clinic=data[i]||{}; cats=clinic.categories||{};
      for(k in cats){ if(!cats.hasOwnProperty(k)) continue; arr=Array.isArray(cats[k])?cats[k]:[];
        for(j=0;j<arr.length;j++){ p=arr[j]||{}; if(!p.address) continue;
          out.push({category:k, name:p.name||"(Unnamed)", address:p.address, website:p.website||"", clinic:clinic.name||""});
        }
      }
    }
    var ms=(window.DATA&&Array.isArray(window.DATA.mustSees))?window.DATA.mustSees:[], m, it;
    for(m=0;m<ms.length;m++){ it=ms[m]||{}; if(!it.address) continue;
      out.push({category:"must-see", name:it.title||"(Must-See)", address:it.address, website:it.website||"", clinic:"Iconic NYC"});
    }
    return out;
  }

  async function findNearbyThrottled(address, radiusMiles, statusCb){
    var myToken = (++ACTIVE_MATCH_TOKEN);
    if (typeof statusCb === "function") statusCb("geocoding");
    var here = await geocodeCachedThrottled(address);
    if (myToken !== ACTIVE_MATCH_TOKEN) return { cancelled: true };
    if (!here || here.error){
      return { error: here ? here.error : "no_results", results: [] };
    }
    if (typeof statusCb === "function") statusCb("matching");

    var places=collectPlaces(), seen={}, arr=[], i, key;
    for(i=0;i<places.length;i++){
      key=(places[i].address||"").toLowerCase().trim();
      if(!seen[key]){ seen[key]=true; arr.push(places[i]); }
    }

    // Hard cap the total to geocode; prefer items near borough hints first
    var prioritized = [];
    var boroughHints = ["Manhattan","Brooklyn","Queens","Bronx","Staten Island","NY","New York","NYC"];
    for(i=0;i<arr.length;i++){
      var a=(arr[i].address||""); 
      var scored = 0;
      for (var b=0;b<boroughHints.length;b++){
        if (a.indexOf(boroughHints[b])>=0) { scored++; }
      }
      prioritized.push({score: scored, item: arr[i]});
    }
    prioritized.sort(function(x,y){ return y.score - x.score; });
    var capped = prioritized.slice(0, GEOCODE_LIMIT).map(function(o){ return o.item; });

    var results=[], progress=0;
    for(i=0;i<capped.length;i++){
      if (myToken !== ACTIVE_MATCH_TOKEN) return { cancelled: true };
      var pl=capped[i];
      var pt=await geocodeCachedThrottled(pl.address);
      progress++;
      if (typeof statusCb === "function") statusCb("progress:"+progress+"/"+capped.length);
      if(pt && !pt.error){
        var miles=haversineMiles({lat:here.lat,lon:here.lon},{lat:pt.lat,lon:pt.lon});
        if(miles<=radiusMiles){ pl.miles=miles; results.push(pl); }
      }
      if (results.length >= RESULTS_TARGET) break; // early exit when we have enough
    }
    results.sort(function(a,b){ return a.miles - b.miles; });
    return { results: results };
  }

  function renderNearby(list){
    var wrap=document.getElementById("nearbyResults"), hint=document.getElementById("nearbyHint");
    if(!wrap) return;
    if(!list||!list.length){
      wrap.innerHTML='<div class="nearby-card"><strong>No nearby picks found</strong><div class="meta">Try adding the neighborhood or borough.</div></div>';
      if(hint) hint.textContent="We could not find that address. Try adding the neighborhood or borough.";
      return;
    }
    var out=[], i, r;
    for(i=0;i<list.length;i++){
      r=list[i];
      out.push('<div class="nearby-card">'
        +'<div><strong>'+escHtml(r.name)+'</strong> <span class="meta">• '+escHtml(r.category)+' • '+escHtml(r.clinic)+'</span></div>'
        +'<div class="meta">'+escHtml(r.address)+' • ~'+r.miles.toFixed(2)+' mi</div>'
        +(r.website?('<div><a href="'+escHtml(r.website)+'" target="_blank" rel="noopener">Website</a></div>'):"")
        +'</div>');
    }
    wrap.innerHTML=out.join("");
    if(hint) hint.textContent="Showing places within ~15 min walk.";
  }

  function attachNearby(){
    var btn=document.getElementById("nearbyBtn"), input=document.getElementById("userAddress"), hint=document.getElementById("nearbyHint");
    if(!btn||!input) return;
    var handler=async function(){
      var val=(input.value||"").trim();
      if(!val){ renderNearby([]); return; }
      btn.disabled=true;
      if(hint) hint.textContent="Searching nearby...";
      try{
        var resp = await findNearbyThrottled(val, 0.7, function(stage){
          if(!hint) return;
          if(stage==="geocoding") hint.textContent="Finding that address...";
          else if(stage==="matching") hint.textContent="Matching places nearby...";
          else if(typeof stage==="string" && stage.indexOf("progress:")===0){
            hint.textContent = "Matching places nearby ("+stage.split(":")[1]+")...";
          }
        });
        if(resp.cancelled){ return; }
        if(resp.error){
          if(resp.error==="rate" && hint) hint.textContent="Temporarily rate-limited. Please try again in a minute.";
          else if(hint) hint.textContent="We couldn't find that address. Try adding the neighborhood/borough.";
          renderNearby([]);
        }else{
          renderNearby(resp.results||[]);
          if((resp.results||[]).length===0 && hint) hint.textContent="No curated spots within ~15 min walk. Try a different address.";
        }
      }catch(e){
        console.error(e);
        if(hint) hint.textContent="Something went wrong. Please try again.";
        renderNearby([]);
      }finally{
        btn.disabled=false;
      }
    };
    btn.addEventListener("click", handler);
    input.addEventListener("keydown", function(e){ if(e.key==="Enter") handler(); });
  }

  // ---------- Show all button ----------
  function attachShowAll(){
    var btn=document.getElementById("showAllBtn");
    if(!btn) return;
    btn.addEventListener("click", function(){
      var sel=document.getElementById("clinicSelect"); if(sel) sel.value="";
      var inp=document.getElementById("query"); if(inp) inp.value="";
      if (window.DATA && Array.isArray(window.DATA.clinics)) renderClinics(window.DATA.clinics);
    });
  }

  // ---------- Boot ----------
  window.addEventListener("DOMContentLoaded", function(){
    loadData();
    populateClinicDropdown();
    attachClinicDropdownHandler();
    attachNearby();
    attachShowAll();
  });
})();
