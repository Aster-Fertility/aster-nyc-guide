(function(){
  "use strict";

  // State
  window.DATA = window.DATA || null;
  window.LOADED = !!window.DATA;

  // Helpers
  function escHtml(s){ if(s==null) return ""; return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/"/g,"&quot;"); }
  function sleep(ms){ return new Promise(function(res){ setTimeout(res, ms); }); }
  function $(sel){ return document.querySelector(sel); }

  // UI helpers
  function toastStatus(id, msg){ var el=$(id); if(el) el.textContent = msg; }

  // Data load
  async function loadData(){
    try{
      var res = await fetch("nyc_fertility_locations.json");
      if(!res.ok) res = await fetch("/nyc_fertility_locations.json");
      if(!res.ok){ window.DATA={clinics:[],mustSees:[]}; window.LOADED=true; return; }
      var json = await res.json();
      window.DATA = { clinics: json.clinics||[], mustSees: json.mustSees||[] };
      window.LOADED = true;
      populateClinicDropdown();
      if (window.DATA.clinics && window.DATA.clinics.length) renderClinics(window.DATA.clinics);
    }catch(e){
      console.error(e);
      window.DATA = {clinics:[], mustSees:[]};
      window.LOADED = true;
    }
  }

  // Clinic dropdown
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
      var val = sel.value || "";
      if (!val){ renderClinics(window.DATA.clinics||[]); return; }
      var list = (window.DATA.clinics||[]).filter(function(c){ return (c.name||"").toLowerCase() === val.toLowerCase(); });
      renderClinics(list);
    });
    sel._wired = true;
  }

  // Render clinics
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

  // Hotel nearby search (uses lat/lon if present; otherwise geocodes with throttle)
  var NOMINATIM_BASE="https://nominatim.openstreetmap.org/search";
  var NYC_VIEWBOX = [-74.25909, 40.477399, -73.700272, 40.916178];
  var GEO_CACHE=new Map();
  var GEOCODE_DELAY_MS = 360;
  var GEOCODE_LIMIT = 80;
  var RESULTS_TARGET = 30;
  var ACTIVE_MATCH_TOKEN = 0;

  function haversineMiles(a,b){
    var R=3958.7613, toRad=function(d){return d*Math.PI/180;};
    var dLat=toRad(b.lat-a.lat), dLon=toRad(b.lon-a.lon);
    var s=Math.sin(dLat/2)*Math.sin(dLat/2)+Math.cos(toRad(a.lat))*Math.cos(toRad(b.lat))*Math.sin(dLon/2)*Math.sin(dLon/2);
    return 2*R*Math.asin(Math.sqrt(s));
  }

  async function geocodeBiased(address){
    var key=(String(address||"")).toLowerCase().trim();
    if(GEO_CACHE.has(key)) return GEO_CACHE.get(key);
    var p=new URLSearchParams();
    p.set("format","jsonv2"); p.set("limit","1"); p.set("countrycodes","us");
    p.set("addressdetails","0"); p.set("viewbox", NYC_VIEWBOX.join(",")); p.set("bounded","1");
    p.set("q", address+", New York");
    var url = NOMINATIM_BASE+"?"+p.toString();
    await sleep(GEOCODE_DELAY_MS);
    var res;
    try{ res = await fetch(url, { headers:{"Accept":"application/json"} }); }
    catch(_){ res = null; }
    var js = res && res.ok ? await res.json() : null;
    var pt = (js && Array.isArray(js) && js.length) ? {lat:parseFloat(js[0].lat), lon:parseFloat(js[0].lon)} : null;
    GEO_CACHE.set(key, pt||{error:true});
    return pt;
  }

  function collectPlaces(){
    var out=[], data=(window.DATA&&window.DATA.clinics)?window.DATA.clinics:[], i, clinic, cats, k, arr, j, p;
    for(i=0;i<data.length;i++){
      clinic=data[i]||{}; cats=clinic.categories||{};
      for(k in cats){ if(!cats.hasOwnProperty(k)) continue; arr=Array.isArray(cats[k])?cats[k]:[];
        for(j=0;j<arr.length;j++){ p=arr[j]||{}; if(!p.address) continue;
          out.push({category:k, name:p.name||"(Unnamed)", address:p.address, website:p.website||"", clinic:clinic.name||"", lat:p.lat, lon:p.lon});
        }
      }
    }
    var ms=(window.DATA&&Array.isArray(window.DATA.mustSees))?window.DATA.mustSees:[];
    for(i=0;i<ms.length;i++){ var it=ms[i]||{}; if(!it.address) continue;
      out.push({category:"must-see", name:it.title||"(Must-See)", address:it.address, website:it.website||"", clinic:"Iconic NYC", lat:it.lat, lon:it.lon});
    }
    return out;
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

  async function findNearby(address, radiusMiles, statusCb){
    var myToken = (++ACTIVE_MATCH_TOKEN);
    if (typeof statusCb === "function") statusCb("geocoding");
    var here = await geocodeBiased(address);
    if (myToken !== ACTIVE_MATCH_TOKEN) return {cancelled:true};
    if (!here || here.error){ return {error:"no_results", results:[]}; }
    if (typeof statusCb === "function") statusCb("matching");

    var places = collectPlaces(), seen={}, arr=[], i, key;
    for(i=0;i<places.length;i++){
      key=(places[i].address||"").toLowerCase().trim();
      if(!seen[key]){ seen[key]=true; arr.push(places[i]); }
    }

    var results=[], progress=0;
    for(i=0;i<arr.length && i<GEOCODE_LIMIT;i++){
      if (myToken !== ACTIVE_MATCH_TOKEN) return {cancelled:true};
      var pl=arr[i];
      var pt = (pl.lat && pl.lon) ? {lat:pl.lat, lon:pl.lon} : await geocodeBiased(pl.address);
      progress++;
      if (typeof statusCb === "function") statusCb("progress:"+progress+"/"+Math.min(arr.length,GEOCODE_LIMIT));
      if(pt && !pt.error){
        var miles=haversineMiles(here,{lat:pt.lat,lon:pt.lon});
        if(miles<=radiusMiles){ pl.miles=miles; results.push(pl); }
      }
      if (results.length >= RESULTS_TARGET) break;
    }
    results.sort(function(a,b){ return a.miles - b.miles; });
    return {results:results};
  }

  function attachNearby(){
    var btn=$("#nearbyBtn"), input=$("#userAddress"), hint=$("#nearbyHint");
    if(!btn||!input) return;
    var handler=async function(){
      var val=(input.value||"").trim();
      if(!val){ renderNearby([]); return; }
      btn.disabled=true; if(hint) hint.textContent="Searching nearby...";
      try{
        var resp = await findNearby(val, 0.7, function(stage){
          if(!hint) return;
          if(stage==="geocoding") hint.textContent="Finding that address...";
          else if(stage==="matching") hint.textContent="Matching places nearby...";
          else if(typeof stage==="string" && stage.indexOf("progress:")===0){
            hint.textContent = "Matching places nearby ("+stage.split(':')[1]+")...";
          }
        });
        if(resp.cancelled){ return; }
        if(resp.error){ if(hint) hint.textContent="We couldn't find that address."; renderNearby([]); }
        else{ renderNearby(resp.results||[]); if(hint && (!resp.results||!resp.results.length)) hint.textContent="No curated spots within ~15 min walk."; }
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

  // ------- One-click enrichment: add lat/lon to every address and download JSON -------
  async function geocodeAllAddresses(data, statusCb){
    var NYC_VIEWBOX = [-74.25909, 40.477399, -73.700272, 40.916178];
    var p = new URLSearchParams();
    p.set("format","jsonv2"); p.set("limit","1"); p.set("countrycodes","us");
    p.set("addressdetails","0"); p.set("viewbox", NYC_VIEWBOX.join(",")); p.set("bounded","1");

    async function geocodeAddr(addr){
      var key=(String(addr||"")).toLowerCase().trim();
      if(GEO_CACHE.has(key)) return GEO_CACHE.get(key);
      await sleep(360);
      var url = "https://nominatim.openstreetmap.org/search?"+p.toString()+"&q="+encodeURIComponent(addr+", New York");
      var res; try{ res = await fetch(url,{headers:{"Accept":"application/json"}}); }catch(_){ res=null; }
      var js = res && res.ok ? await res.json() : null;
      var pt = (js && Array.isArray(js) && js.length) ? {lat:parseFloat(js[0].lat), lon:parseFloat(js[0].lon)} : null;
      GEO_CACHE.set(key, pt);
      return pt;
    }

    function* walkItems(root){
      var i,j,k,clinic,arr,item;
      var clinics = Array.isArray(root.clinics)?root.clinics:[];
      for(i=0;i<clinics.length;i++){
        clinic = clinics[i]||{};
        if (clinic.address) yield {obj:clinic, field:"clinic"};
        var cats = clinic.categories||{};
        for(k in cats){ if(!cats.hasOwnProperty(k)) continue; arr = Array.isArray(cats[k])?cats[k]:[];
          for(j=0;j<arr.length;j++){ item=arr[j]||{}; if(item.address) yield {obj:item, field:k}; }
        }
      }
      var ms = Array.isArray(root.mustSees)?root.mustSees:[];
      for(i=0;i<ms.length;i++){ item=ms[i]||{}; if(item.address) yield {obj:item, field:"mustSees"}; }
    }

    var total=0; for (var _ of walkItems(data)) total++;
    var done=0, updated=0;

    for (var it of walkItems(data)){
      done++;
      if (typeof statusCb==="function") statusCb(done, total, it.field);
      if (it.obj.lat && it.obj.lon) continue;
      var pt = await geocodeAddr(it.obj.address);
      if (pt){ it.obj.lat=pt.lat; it.obj.lon=pt.lon; updated++; }
    }
    return {updated, total};
  }

  function downloadJson(filename, obj){
    var blob = new Blob([JSON.stringify(obj,null,2)], {type:"application/json"});
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url; a.download = filename; document.body.appendChild(a); a.click();
    setTimeout(function(){ URL.revokeObjectURL(url); a.remove(); }, 500);
  }

  function attachEnrichButton(){
    var btn=$("#enrichBtn"), status=$("#enrichStatus");
    if(!btn) return;
    btn.addEventListener("click", async function(){
      if(!window.DATA || (!Array.isArray(window.DATA.clinics) && !Array.isArray(window.DATA.mustSees))){
        toastStatus("#enrichStatus","No data loaded."); return;
      }
      btn.disabled = true; toastStatus("#enrichStatus","Starting… (this runs once)");

      var progress = function(done,total,section){
        if(status) status.textContent = "Geocoding "+section+"… "+done+"/"+total;
      };

      try{
        var copy = JSON.parse(JSON.stringify(window.DATA));
        var info = await geocodeAllAddresses(copy, progress);
        if(status) status.textContent = "Done. Added coords to "+info.updated+" of "+info.total+" items.";
        downloadJson("nyc_fertility_locations_coords.json", copy);
      }catch(e){
        console.error(e);
        if(status) status.textContent = "Failed. Please try again.";
      }finally{
        btn.disabled=false;
      }
    });
  }

  // Boot
  window.addEventListener("DOMContentLoaded", function(){
    loadData();
    populateClinicDropdown();
    attachClinicDropdownHandler();
    attachNearby();
    attachEnrichButton();
  });
})();
