(function(){
  "use strict";
  window.DATA = window.DATA || null;
  window.LOADED = !!window.DATA;

  function escHtml(s){ if(s==null) return ""; return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/"/g,"&quot;"); }
  function currentQuery(){
    var sel = document.getElementById("clinicSelect");
    if (sel) return sel.value || "";
    var inp = document.getElementById("query");
    return inp ? (inp.value || "") : "";
  }

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

  var NOMINATIM_BASE="https://nominatim.openstreetmap.org/search";
  var GEO_CACHE=new Map();
  function haversineMiles(a,b){
    var R=3958.7613, toRad=function(d){return d*Math.PI/180;};
    var dLat=toRad(b.lat-a.lat), dLon=toRad(b.lon-a.lon);
    var s=Math.sin(dLat/2)*Math.sin(dLat/2)+Math.cos(toRad(a.lat))*Math.cos(toRad(b.lat))*Math.sin(dLon/2)*Math.sin(dLon/2);
    return 2*R*Math.asin(Math.sqrt(s));
  }
  async function geocodeBiased(address,stateHint){
    var p=new URLSearchParams(); p.set("format","json"); p.set("limit","1"); p.set("q",(address+(stateHint?(", "+stateHint):""))+", USA");
    var res=await fetch(NOMINATIM_BASE+"?"+p.toString(),{headers:{"Accept":"application/json"}}); if(!res.ok) return null;
    var js=await res.json(); if(!Array.isArray(js)||!js.length) return null; return {lat:parseFloat(js[0].lat), lon:parseFloat(js[0].lon)};
  }
  async function geocodeCached(address,stateHint){
    var key=(String(address||"")+"|"+String(stateHint||"")).toLowerCase().trim();
    if(GEO_CACHE.has(key)) return GEO_CACHE.get(key);
    var pt=await geocodeBiased(address,stateHint); if(pt) GEO_CACHE.set(key,pt); return pt;
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
  async function findNearby(address,radiusMiles){
    var here=await geocodeCached(address,"NY"); if(!here) throw new Error("Could not geocode that address.");
    var places=collectPlaces(), uniq={}, arr=[], i, key, results=[], pl, pt, miles;
    for(i=0;i<places.length;i++){ key=(places[i].address||"").toLowerCase().trim(); if(!uniq[key]){uniq[key]=true; arr.push(places[i]);} }
    for(i=0;i<arr.length;i++){
      pl=arr[i];
      try{
        pt=await geocodeCached(pl.address,"NY");
        if(pt){ miles=haversineMiles({lat:here.lat,lon:here.lon},{lat:pt.lat,lon:pt.lon}); if(miles<=0.7){ pl.miles=miles; results.push(pl);} }
      }catch(_){}
    }
    results.sort(function(a,b){ return a.miles - b.miles; });
    return results;
  }
  function renderNearby(list){
    var wrap=document.getElementById("nearbyResults"), hint=document.getElementById("nearbyHint");
    if(!wrap) return;
    if(!list||!list.length){
      wrap.innerHTML='<div class="nearby-card"><strong>No nearby picks found</strong><div class="meta">Try adding the city/borough.</div></div>';
      if(hint) hint.textContent="We could not find that address. Try adding the city/borough.";
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
      var val=(input.value||"").trim(); if(!val){ renderNearby([]); return; }
      btn.disabled=true; if(hint) hint.textContent="Searching nearby...";
      try{ var res=await findNearby(val,0.7); renderNearby(res); }catch(e){ console.error(e); renderNearby([]); } finally{ btn.disabled=false; }
    };
    btn.addEventListener("click", handler);
    input.addEventListener("keydown", function(e){ if(e.key==="Enter") handler(); });
  }

  function attachShowAll(){
    var btn=document.getElementById("showAllBtn");
    if(!btn) return;
    btn.addEventListener("click", function(){
      var sel=document.getElementById("clinicSelect"); if(sel) sel.value="";
      var inp=document.getElementById("query"); if(inp) inp.value="";
      renderClinics((window.DATA&&window.DATA.clinics)?window.DATA.clinics:[]);
    });
  }

  window.addEventListener("DOMContentLoaded", function(){
    loadData();
    populateClinicDropdown();
    attachClinicDropdownHandler();
    attachNearby();
    attachShowAll();
  });
})();
