/* ==========================================================================
   spicy_engine.js — SpicyTerminal WEB offline engine.
   Faithful JavaScript port of the v3.4 Python engine (parser_offline +
   formatter + aviation_data inference). Same laws, same outputs, same
   warning strings. Verified byte-for-byte against the Python engine on the
   office corpus (web/test_engine.js).
   Requires: spicy_data.js (SPICY_DATA).
   ========================================================================== */
(function () {
"use strict";

var D = (typeof SPICY_DATA !== "undefined") ? SPICY_DATA
        : require("./spicy_data.js");

var AIRPORTS = D.airports, AIRLINES = D.airlines,
    AIRLINE_ALIASES = D.airlineAliases, CITY_ALIASES = D.cityAliases,
    AIRCRAFT = D.aircraft, AIRCRAFT_TYPES = D.aircraftTypes,
    ROUTE_EQUIPMENT = D.routeEquipment, AIRLINE_EQUIPMENT = D.airlineEquipment,
    GENERIC_EQUIPMENT = D.genericEquipment, FLIGHT_EQUIPMENT = D.flightEquipment;

var MONTHS = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
var MONTH_MAP = {JAN:1,FEB:2,MAR:3,APR:4,MAY:5,JUN:6,JUL:7,AUG:8,SEP:9,OCT:10,NOV:11,DEC:12,
  JANUARY:1,FEBRUARY:2,MARCH:3,APRIL:4,JUNE:6,JULY:7,AUGUST:8,SEPTEMBER:9,
  OCTOBER:10,NOVEMBER:11,DECEMBER:12,MAY_:0};
delete MONTH_MAP.MAY_;
var MONTH_RE = Object.keys(MONTH_MAP).sort(function(a,b){return b.length-a.length;}).join("|");

var CABIN_DEFAULT_CLASS = {FIRST:"F", BUSINESS:"C", "PREMIUM ECONOMY":"W", ECONOMY:"Y"};
var CLASS_TO_CABIN = {F:"FIRST",A:"FIRST",P:"FIRST",R:"ECONOMY",J:"BUSINESS",C:"BUSINESS",
  D:"BUSINESS",I:"BUSINESS",Z:"BUSINESS",O:"BUSINESS",W:"PREMIUM ECONOMY",S:"PREMIUM ECONOMY"};
var AMBIGUOUS_CODES = {AM:1,AT:1,TO:1,AS:1,IS:1,ON:1,NO:1,OK:1,GO:1,BY:1,BE:1,IT:1,
  IN:1,OR:1,DO:1,US:1,WE:1,ME:1,MY:1,SO:1,AN:1,IF:1,HE:1,HA:1,ID:1,LA:1,MA:1,MD:1,
  MM:1,MO:1,MU:1,MT:1,LO:1,NE:1,PA:1,AD:1,UP:1,EH:1,EX:1,PS:1};

// python round() = round-half-even
function pyRound(x){var f=Math.floor(x),d=x-f;if(d<0.5)return f;if(d>0.5)return f+1;return (f%2)?f+1:f;}

/* ---------------- dates / dst ---------------- */
function _nthWeekday(year, month, weekday, n){   // python date().weekday(): Mon=0..Sun=6
  var cnt=0;
  for(var day=1;;day++){var dt=new Date(Date.UTC(year,month-1,day));
    var wd=(dt.getUTCDay()+6)%7; if(wd===weekday){cnt++;if(cnt===n)return {y:year,m:month,d:day};}}
}
function _lastWeekday(year, month, weekday){
  var dim=new Date(Date.UTC(year,month,0)).getUTCDate();
  for(var day=dim;day>=1;day--){var dt=new Date(Date.UTC(year,month-1,day));
    var wd=(dt.getUTCDay()+6)%7; if(wd===weekday)return {y:year,m:month,d:day};}
}
function _cmpD(a,b){return (a.y*372+a.m*31+a.d)-(b.y*372+b.m*31+b.d);}
function dstActive(region, dt){  // dt={y,m,d}
  if(region==="US") return _cmpD(_nthWeekday(dt.y,3,6,2),dt)<=0 && _cmpD(dt,_nthWeekday(dt.y,11,6,1))<0;
  if(region==="EU") return _cmpD(_lastWeekday(dt.y,3,6),dt)<=0 && _cmpD(dt,_lastWeekday(dt.y,10,6))<0;
  if(region==="AU") return _cmpD(dt,_nthWeekday(dt.y,10,6,1))>=0 || _cmpD(dt,_nthWeekday(dt.y,4,6,1))<0;
  if(region==="NZ") return _cmpD(dt,_lastWeekday(dt.y,9,6))>=0 || _cmpD(dt,_nthWeekday(dt.y,4,6,1))<0;
  if(region==="SHSEP") return _cmpD(dt,_nthWeekday(dt.y,9,6,1))>=0 || _cmpD(dt,_nthWeekday(dt.y,4,6,1))<0;
  if(region==="EG") return _cmpD(_lastWeekday(dt.y,4,4),dt)<=0 && _cmpD(dt,_lastWeekday(dt.y,10,4))<0;
  return false;
}
function utcOffset(code, dt){
  var ap=AIRPORTS[code]; if(!ap) return null;
  var off=ap.off; if(dstActive(ap.dst,dt)) off+=1; return off;
}

/* ---------------- distances / durations ---------------- */
var _EARTH_MI = 3958.7613;
function haversineMiles(c1,c2){
  var a=AIRPORTS[c1], b=AIRPORTS[c2]; if(!a||!b) return null;
  var r=Math.PI/180, lat1=a.lat*r, lat2=b.lat*r, dl=lat2-lat1, dn=(b.lon-a.lon)*r;
  var h=Math.sin(dl/2)*Math.sin(dl/2)+Math.cos(lat1)*Math.cos(lat2)*Math.sin(dn/2)*Math.sin(dn/2);
  return Math.round(2*_EARTH_MI*Math.asin(Math.sqrt(h)));
}
function estimateDurationMin(mi){ if(!mi) return null; return Math.max(35, pyRound((mi/9+30)/5)*5); }
function formatHMM(totalMin){ var t=Math.round(totalMin), h=Math.floor(t/60), m=t%60;
  return h+"."+(m<10?"0":"")+m; }
var NM_PER_MI = 0.868976;

/* ---------------- aircraft ---------------- */
var _AC_VENDOR=["BOEING","AIRBUS","EMBRAER","BOMBARDIER","DE HAVILLAND","CANADAIR","CESSNA","COMAC","SUKHOI"];
function squashAircraft(text){
  var t=text.toUpperCase().replace(/\u2013/g,"-").replace(/\u2014/g,"-");
  var embraer=t.indexOf("EMBRAER")>=0;
  for(var i=0;i<_AC_VENDOR.length;i++) t=t.split(_AC_VENDOR[i]).join("");
  var sq=t.replace(/\s+/g,"");
  if(embraer && /^\d/.test(sq)) sq="E"+sq;
  return sq;
}
function lookupAircraft(text){ var sq=squashAircraft(text); return AIRCRAFT[sq]||null; }
var IATA_ACFT_CODES={}; Object.keys(AIRCRAFT).forEach(function(k){IATA_ACFT_CODES[AIRCRAFT[k]]=1;});
var _AC_KEYS_BY_LEN=Object.keys(AIRCRAFT).sort(function(a,b){return b.length-a.length;});
function scanAircraft(regionUpper){
  var sq=squashAircraft(regionUpper);
  for(var i=0;i<_AC_KEYS_BY_LEN.length;i++){var key=_AC_KEYS_BY_LEN[i];
    if(key.length>=3 && sq.indexOf(key)>=0) return AIRCRAFT[key];}
  var m=/EMBRAER\s+E?(\d{3})\s*-?\s*(E2)?/.exec(regionUpper);
  if(m){var fam="E"+m[1]+(m[2]?"-E2":""); if(AIRCRAFT[fam]) return AIRCRAFT[fam];}
  return null;
}
function inferAircraft(airline, flightNo, orig, dest, distanceMi){
  var code=FLIGHT_EQUIPMENT[airline+"|"+String(flightNo)];
  if(code) return [code,"flight table"];
  code=ROUTE_EQUIPMENT[airline+"|"+orig+"|"+dest]||ROUTE_EQUIPMENT[airline+"|"+dest+"|"+orig];
  if(code) return [code,"route database"];
  var pair=AIRLINE_EQUIPMENT[airline]||GENERIC_EQUIPMENT;
  var narrow=pair[0], wide=pair[1];
  var d=distanceMi||0;
  if(!d && AIRPORTS[orig] && AIRPORTS[dest]) d=haversineMiles(orig,dest)||0;
  var pick=(d>=3500)?wide:narrow;
  if(pick===narrow && d){var t=AIRCRAFT_TYPES[pick];
    if(t && t[5] && d*NM_PER_MI > t[5]*1.02) pick=wide;}
  return [pick,"route estimate"];
}
function rangeAdvisory(code, orig, dest, distanceMi){
  var t=AIRCRAFT_TYPES[code]; if(!t || !t[5]) return null;
  var d=distanceMi||0;
  if(!d && AIRPORTS[orig] && AIRPORTS[dest]) d=haversineMiles(orig,dest)||0;
  if(!d) return null;
  var nm=Math.round(d*NM_PER_MI);
  if(nm > t[5]*1.10) return "range check: "+code+" range "+t[5]+"nm < route "+nm+"nm - verify equipment";
  return null;
}

/* ---------------- base formatters ---------------- */
function fmtClock(hh24, mm){
  var suffix=hh24<12?"A":"P", h12=hh24%12; if(h12===0) h12=12;
  return h12+(""+(100+mm)).slice(1)+suffix;
}
function makeDate(day, mon){ return (day<10?"0":"")+day+MONTHS[mon-1]; }
function airportName(code){ var ap=AIRPORTS[code]; return ap?ap.name:(code||"???"); }

var TODAY = new Date();
var _TODAY = {y:TODAY.getFullYear(), m:TODAY.getMonth()+1, d:TODAY.getDate()};

/* ---------------- regex kit (ported) ---------------- */
var DATE_RES = [
  new RegExp("\\b(\\d{1,2})[\\s\\-\\.]?("+MONTH_RE+")(?:[\\s,/\\-]+(\\d{2,4}))?\\b","gi"),
  new RegExp("\\b("+MONTH_RE+")\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:[\\s,]+(\\d{4}))?\\b","gi"),
  /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/g,
  /\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/g ];
var TIME_RE = new RegExp(
  "(?<![\\d:])"+
  "(?:(\\d{1,2})[:.](\\d{2})\\s*([AaPp])\\.?\\s*[Mm]\\.?"+
  "|(\\d{1,2})\\s*([AaPp])\\.?\\s*[Mm]\\.?"+
  "|(?<![\\d:A-Za-z])(\\d{1,2})(\\d{2})([AP])(?![a-z])"+
  "|([01]?\\d|2[0-3])[:.](\\d{2}))","g");
var OVERNIGHT_TAIL_RE = /\s*(?:[¥‡]\s?(\d)|\+\s?(\d)(?:\s?days?)?|\(?(next day|following day)\)?)/i;
var DEP_NEAR_RE = /(dep\w*|leav\w*|from|take\s?off)\b/i;
var ARR_NEAR_RE = /(arr\w*|arrive\w*|land\w*)\b/i;
var DURATION_RE = /\b(\d{1,2})\s*(?:hrs?|hours?|h)\s*,?\s*(?:(\d{1,2})\s*(?:mins?|minutes?|m)\b)?|\b(\d{1,3})\s*(?:mins?|minutes?)\b/gi;
var PAREN_DURATION_RE = /\(\s*(\d{1,2})\s*(?:hrs?|hours?|h)\s*,?\s*(?:(\d{1,2})\s*(?:mins?|minutes?|m)\s*)?\s*\)/gi;
var LAYOVER_GUARD_RE = /(layover|stopover|connection|transit|stop in|via)\b/i;
var DIST_RE = /\b(\d[\d,]{2,})\s*(mi|miles|km|kilometers|kilometres)\b/gi;
var CABIN_RES = [
  ["PREMIUM ECONOMY", /\bpremium\s+economy\b|\bprem(ium)?\s+eco\b/i],
  ["FIRST", /\bfirst(\s+class)?\b|\b1st\s+class\b/i],
  ["BUSINESS", /\bbusiness(\s+class)?\b|\bbiz(\s+class)?\b|\bexec(utive)?\s+class\b/i],
  ["ECONOMY", /\beconomy(\s+class)?\b|\bcoach\b/i]];
var CABIN_CLASS_RE = /\b(premium economy|first|business|economy|coach)\s*(?:class)?\s*[-,/]?\s*\(?\s*\b([A-Z])\b\s*\)?/i;
var ALL_CABIN_RE = /\ball\s+(premium economy|first|business|economy)\b/i;
var GLOBAL_CLASS_RE = /\b(?:booking\s+class|bkg\s+class|booking\s+code|cabin\s+class|rbd|fare\s+class|fare\s+basis)\s*[:\-]?\s*\"?'?\b([A-Z])\b/i;
var WORD_SEP_RE = /\bto\b|\binto\b/g;
var PAREN_CODE_RE = /(?<=[A-Za-z]\s)\(([A-Z]{3})\)/g;
var PAREN_ROUTE_HDR_RE = /\(([A-Z]{3})\)\s+(?:to|into)\s+[A-Za-z ,.'-]{2,40}?\(([A-Z]{3})\)/;
var BARE_CODE_RE = /\b([A-Z]{3})\b/g;
var AIRLINE_TOK = "(?:[A-Z][A-Z0-9]|[0-9][A-Z])";
var _aliasAlt = Object.keys(AIRLINE_ALIASES).sort(function(a,b){return b.length-a.length;})
  .map(function(s){return s.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");}).join("|");
var ALIAS_NUM_RE = new RegExp(
  "\\b("+_aliasAlt+")\\b\\s*(?:flight|flt)?\\s*(?:no\\.?|number|nbr|#)?\\s*"+
  "(?:\\(?([A-Z][A-Z0-9])\\)?\\s*)?(\\d{1,4})\\b","gi");
var CODE_NUM_RE = new RegExp("\\b("+"[A-Z][A-Z0-9]|[0-9][A-Z]"+")\\s{0,3}(\\d{1,4})\\b","g");
var TIME_UNIT_AFTER = /\s*(?::\d{2}|hrs?\b|hours?\b|mins?\b|minutes?\b|m\b|h\b)/i;
function _stripFltZeros(n){var v=parseInt(n,10);return v>0?String(v):n;}   // "AF 0003" -> "AF 3"
/* Google Flights collapsed "next flight" summary card — junk times/dates/ghost flight:
   AF / Air France / 12:30 PM / Sep 16, 2026 / 6:45 PM / Sep 16, 2026 / 12h 15m / FCO to JFK / CDG */
var SUMMARY_STRIP_RE = /\n[ \t]*[A-Z0-9]{2}[ \t]*\n[ \t]*[A-Za-z][A-Za-z .&'-]{1,30}[ \t]*\n+[ \t]*\d{1,2}:\d{2}\s*[AP]M[ \t]*\n+[ \t]*[A-Z][a-z]{2} \d{1,2}, \d{4}[ \t]*\n+[ \t]*\d{1,2}:\d{2}\s*[AP]M[ \t]*\n+[ \t]*[A-Z][a-z]{2} \d{1,2}, \d{4}[ \t]*\n+[ \t]*\d{1,2}h(?: \d{1,2}m)?[ \t]*\n+[ \t]*[A-Z]{3} to [A-Z]{3}[ \t]*(?:\n+[ \t]*[A-Z]{3}[ \t]*)?(?=\n|$)/g;
var _cityAlts = Object.keys(CITY_ALIASES).sort(function(a,b){return b.length-a.length;})
  .map(function(s){return s.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");}).join("|");
var CITY_ALT_RE = new RegExp("\\b("+_cityAlts+")\\b","g");

function findDates(region){
  var out=[];
  for(var idx=0;idx<DATE_RES.length;idx++){
    var rx=DATE_RES[idx]; rx.lastIndex=0; var m;
    while((m=rx.exec(region))){
      var day,mon;
      try{
        if(idx===0){day=parseInt(m[1],10);mon=MONTH_MAP[m[2].toUpperCase()];}
        else if(idx===1){day=parseInt(m[2],10);mon=MONTH_MAP[m[1].toUpperCase()];}
        else if(idx===2){day=parseInt(m[3],10);mon=parseInt(m[2],10);}
        else{var a=parseInt(m[1],10),b=parseInt(m[2],10);
          if(a>12){day=a;mon=b;}else{day=b;mon=a;}}
        if(day>=1&&day<=31&&mon>=1&&mon<=12)
          out.push({pos:m.index,day:day,mon:mon,prio:idx});
      }catch(e){}
    }
  }
  out.sort(function(a,b){return a.pos-b.pos||a.prio-b.prio;});
  var seen={},clean=[];
  out.forEach(function(d){var k=d.day+"-"+d.mon;if(!seen[k]){seen[k]=1;clean.push(d);}});
  return clean;
}

function findTimes(region, basePos){
  var out=[]; TIME_RE.lastIndex=0; var m;
  while((m=TIME_RE.exec(region))){
    if(m[3]&&/[apm]/i.test(region.slice(m.index+m[0].length,m.index+m[0].length+1))){
      // already consumed; nothing
    }
    var h,mi,marker=null;
    if(m[1]!==undefined){h=parseInt(m[1],10)%12;mi=parseInt(m[2],10);if(m[3].toUpperCase()==="P")h+=12;}
    else if(m[4]!==undefined){h=parseInt(m[4],10)%12;mi=0;if(m[5].toUpperCase()==="P")h+=12;}
    else if(m[6]!==undefined){h=parseInt(m[6],10)%12;mi=parseInt(m[7],10);if(m[8]==="P")h+=12;}
    else {h=parseInt(m[9],10);mi=parseInt(m[10],10);}
    var tail=region.slice(m.index+m[0].length, m.index+m[0].length+20);
    var tm=OVERNIGHT_TAIL_RE.exec(tail);
    if(tm && tm.index===0 && (tm[1]||tm[2]||tm[3])){
      marker=tm[1]?parseInt(tm[1],10):(tm[2]?parseInt(tm[2],10):1);
    }
    if(h>23||mi>59) continue;
    var before=region.slice(Math.max(0,m.index-24),m.index);
    // Google-Flights arrival glue: "6:05 PM\nto12:45 PM+1" or "10:30 AM to 1:50 PM" —
    // a "to" glued directly to the clock (same line, spaces/tabs only) marks the arrival.
    var toArr=/(?:^|[\s>(\[])[Tt]o[ \t]*$/.test(before);
    out.push({pos:(basePos||0)+m.index,end:(basePos||0)+m.index+m[0].length,
      h:h,m:mi,marker:marker,
      depkw:DEP_NEAR_RE.test(before),arrkw:ARR_NEAR_RE.test(before)||toArr});
  }
  return out;
}

function findDuration(region){
  PAREN_DURATION_RE.lastIndex=0; var m;
  while((m=PAREN_DURATION_RE.exec(region))){
    var ctx=region.slice(Math.max(0,m.index-25), m.index+m[0].length+25);
    if(LAYOVER_GUARD_RE.test(ctx)) continue;
    var mins=parseInt(m[1],10)*60+parseInt(m[2]||"0",10);
    if(mins>0&&mins<=2400) return mins;
  }
  DURATION_RE.lastIndex=0;
  while((m=DURATION_RE.exec(region))){
    var ctx2=region.slice(Math.max(0,m.index-25), m.index+m[0].length+25);
    if(LAYOVER_GUARD_RE.test(ctx2)) continue;
    if(region[m.index-1]==="(") continue;      // paren handled above
    var mins2=m[3]!==undefined?parseInt(m[3],10)
             :parseInt(m[1],10)*60+parseInt(m[2]||"0",10);
    if(mins2>0&&mins2<=2400) return mins2;
  }
  return null;
}

function findDistance(region){
  DIST_RE.lastIndex=0; var m;
  while((m=DIST_RE.exec(region))){
    var val=parseInt(m[1].replace(/,/g,""),10);
    if(/^k/i.test(m[2])) val=Math.round(val*0.621371);
    if(val>=50&&val<=14000) return val;
  }
  return null;
}

/* ---------------- airport mentions / headers ---------------- */
function _airportMentions(region){
  var rl=region.toLowerCase(), raw=[], m;
  BARE_CODE_RE.lastIndex=0;
  while((m=BARE_CODE_RE.exec(region))) if(AIRPORTS[m[1]]) raw.push([m.index,m[1],3]);
  PAREN_CODE_RE.lastIndex=0;
  while((m=PAREN_CODE_RE.exec(region))){
    var dup=false;
    for(var i=0;i<raw.length;i++) if(raw[i][0]<=m.index && m.index<raw[i][0]+raw[i][2]) {dup=true;break;}
    if(!dup) raw.push([m.index,m[1],5]);
  }
  CITY_ALT_RE.lastIndex=0;
  while((m=CITY_ALT_RE.exec(rl))) raw.push([m.index,CITY_ALIASES[m[1]],m[1].length]);
  raw.sort(function(a,b){return a[0]-b[0]||b[2]-a[2];});
  var clean=[];
  raw.forEach(function(t){
    if(clean.length && t[0] < clean[clean.length-1][0]+clean[clean.length-1][2]) return;
    clean.push(t);});
  return clean;
}

function findSideHeaders(text){
  var out=[], lines=text.split("\n"), pos=0;
  for(var li=0;li<lines.length;li++){
    var line=lines[li], ls=pos; pos+=line.length+1;
    if(!line.trim()||line.length>90) continue;
    var pq=PAREN_ROUTE_HDR_RE.exec(line);
    if(pq && pq[1]!==pq[2]){ out.push([ls,pq[1],pq[2]]); continue; }
    var mentions=_airportMentions(line), uniq={}, cnt=0;
    mentions.forEach(function(t){if(!uniq[t[1]]){uniq[t[1]]=1;cnt++;}});
    if(cnt<2) continue;
    if(!/\bto\b|\binto\b/i.test(line)) continue;
    if(mentions.length>=2 && mentions[0][1]!==mentions[1][1])
      out.push([ls,mentions[0][1],mentions[1][1]]);
  }
  return out;
}

/* ---------------- anchors ---------------- */
function _suppressedAnchor(text, st){
  var before=text.slice(Math.max(0,st-15),st).toLowerCase();
  if(/operated\s+by\s*$/.test(before)) return true;
  return false;
}
function _codeCorroborated(code, text_l){
  for(var alias in AIRLINE_ALIASES){
    if(AIRLINE_ALIASES[alias]===code && alias.length>=3){
      if(new RegExp("\\b"+alias.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")+"\\b").test(text_l)) return true;
    }
  }
  return false;
}
function findAnchors(text){
  var text_l=text.toLowerCase(), cands=[], occupied=[], m;
  ALIAS_NUM_RE.lastIndex=0;
  while((m=ALIAS_NUM_RE.exec(text))){
    var afterT=text.slice(m.index+m[0].length);
    if(TIME_UNIT_AFTER.test(afterT)){
      var tm=TIME_UNIT_AFTER.exec(afterT);
      if(tm.index===0) continue;
    }
    if(_suppressedAnchor(text,m.index)) continue;
    var raw_alias=m[1].toLowerCase();
    var code=AIRLINE_ALIASES[raw_alias];
    var code_txt=(m[2]||"").toUpperCase();
    if(code_txt && AIRLINES[code_txt]) code=code_txt;
    if(!code) continue;
    cands.push({start:m.index,end:m.index+m[0].length,code:code,num:_stripFltZeros(m[3])});
    occupied.push([m.index,m.index+m[0].length]);
  }
  function overlaps(s,e){for(var i=0;i<occupied.length;i++)
    if(s<occupied[i][1]&&e>occupied[i][0])return true;return false;}
  CODE_NUM_RE.lastIndex=0;
  while((m=CODE_NUM_RE.exec(text))){
    var code2=m[1],num=m[2];
    if(!AIRLINES[code2]||overlaps(m.index,m.index+m[0].length)) continue;
    var afterU=text.slice(m.index+m[0].length);
    var tu=TIME_UNIT_AFTER.exec(afterU);
    if(tu&&tu.index===0) continue;
    if(_suppressedAnchor(text,m.index)) continue;
    if(/^-\d/.test(text.slice(m.index+m[0].length,m.index+m[0].length+6))) continue;
    var token=(code2+num).toUpperCase();
    if(AIRCRAFT[token]||/^(A3\d\d|A22\d|B7\d7|E1\d\d|E19\d|E29\d|CRJ\d+|ATR\d\d)$/.test(token)) continue;
    if(AMBIGUOUS_CODES[code2] && !_codeCorroborated(code2,text_l)){
      var nxt=text.slice(m.index+m[0].length,m.index+m[0].length+30);
      if(!/[A-Z]{3}/.test(nxt)) continue;
    }
    cands.push({start:m.index,end:m.index+m[0].length,code:code2,num:_stripFltZeros(num)});
  }
  cands.sort(function(a,b){return a.start-b.start;});
  return cands;
}

/* ---------------- FlightSegment + render ---------------- */
function Seg(){
  return {seg:0,airline:"",flight_no:"",date_ddmmm:"",orig:"",dest:"",
    dep_time:"",arr_time:"",arr_day_shift:0,booking_class:"",aircraft:"???",
    flight_time:"",distance:"",cabin:"ECONOMY",warnings:[],hidden_stops:[],
    _date_parts:null};
}
function renderSegment(s){
  var cls=(s.booking_class||CABIN_DEFAULT_CLASS[s.cabin]||"Y").toUpperCase();
  var arr=s.arr_time;
  if(s.arr_day_shift>=1||s.arr_day_shift<0) arr=arr+"\u00a5"+s.arr_day_shift;
  var line1=[String(s.seg),s.airline,s.flight_no,s.date_ddmmm,s.orig,s.dest,
    s.dep_time,arr,cls,s.aircraft||"???",s.flight_time||"0.00",
    s.distance?String(s.distance):"0","N"].join(" ");
  var lines=[line1];
  s.hidden_stops.forEach(function(c){lines.push("STOP-"+c);});
  lines.push("DEP-"+airportName(s.orig));
  lines.push("ARR-"+airportName(s.dest));
  lines.push("CABIN-"+s.cabin);
  return lines.join("\n");
}
function renderItinerary(segs){
  var blocks=segs.map(renderSegment);
  var additional=["<--additional-->"];
  segs.forEach(function(s){
    var cls=(s.booking_class||CABIN_DEFAULT_CLASS[s.cabin]||"Y").toUpperCase();
    additional.push(s.seg+" "+s.airline+" "+s.flight_no+cls+" "+s.date_ddmmm);});
  return blocks.join("\n\n")+"\n\n"+additional.join("\n");
}

/* ---------------- cabin ---------------- */
function cabinInRegion(region){
  var cc=CABIN_CLASS_RE.exec(region);
  if(cc){var name=cc[1].toUpperCase();
    if(name==="COACH")name="ECONOMY";
    if(/PREMIUM/.test(name))name="PREMIUM ECONOMY";
    return {cabin:name,cls:cc[2].toUpperCase()};}
  for(var i=0;i<CABIN_RES.length;i++){
    if(CABIN_RES[i][1].test(region)) return {cabin:CABIN_RES[i][0],cls:""};}
  return {cabin:"",cls:""};
}

/* ---------------- GDS row scanner (port of _try_gds_lines) ---------------- */
function _gdsClock(tok){
  var m=/^(\d{3,4})([APNM])$/.exec(tok.toUpperCase());
  if(!m) return null;
  var num=m[1], hh=parseInt(num.slice(0,num.length-2),10), mm=parseInt(num.slice(-2),10);
  if(hh<1||hh>12||mm>=60) return null;
  var ap=m[2];
  if(ap==="N") return (hh===12&&mm===0)?[12,0]:null;
  if(ap==="M") return (hh===12&&mm===0)?[0,0]:null;
  return [hh%12+(ap==="P"?12:0), mm];
}
function _cabinNear(lines, li){
  var offs=[0,1,2,-1,3], j, m;
  for(var k=0;k<offs.length;k++){j=li+offs[k];
    if(j>=0&&j<lines.length){
      m=/CABIN\s*[-:]?\s*(FIRST|BUSINESS|PREMIUM\s+ECONOMY|ECONOMY)/i.exec(lines[j]);
      if(m){var w=m[1].toUpperCase().replace(/\s+/g," ");
        return w.indexOf("PREMIUM")>=0?"PREMIUM ECONOMY":w;}}}
  for(var k2=0;k2<offs.length;k2++){j=li+offs[k2];
    if(j>=0&&j<lines.length){
      for(var c=0;c<CABIN_RES.length;c++) if(CABIN_RES[c][1].test(lines[j])) return CABIN_RES[c][0];}}
  return "";
}
function fullRe(reStr,tok){ return new RegExp("^(?:"+reStr+")$").exec(tok); }

function tryGdsLines(text, used){
  var lines=text.replace(/\u00a0/g," ").replace(/\u2007/g," ").replace(/\u202f/g," ").split("\n");
  var segs=[];
  for(var li=0;li<lines.length;li++){
    var toks=lines[li].split(/\s+/).filter(function(t){return t.length;});
    if(toks.length<7) continue;
    var i=0;
    if(i+1<toks.length && /^\d{1,2}$/.test(toks[i]) &&
       fullRe(AIRLINE_TOK+"\\d{0,4}[A-Z]?", (toks[i+1]||"").toUpperCase().replace(/\*/g,""))) i++;
    var al=null,flt=null,flt_cls=null,g;
    g=new RegExp("^("+AIRLINE_TOK+")(\\d{1,4})([A-Z])?$").exec((toks[i]||"").toUpperCase().replace(/\*/g,""));
    if(g && AIRLINES[g[1]]){ al=g[1];flt=_stripFltZeros(g[2]);flt_cls=g[3]||""; i++; }
    else if(i+1<toks.length && fullRe(AIRLINE_TOK,toks[i].toUpperCase())
            && AIRLINES[toks[i].toUpperCase()]){
      var m2=/^(\d{1,4})([A-Z])?$/.exec(toks[i+1].toUpperCase());
      if(!m2) continue;
      al=toks[i].toUpperCase(); flt=_stripFltZeros(m2[1]); flt_cls=m2[2]||""; i+=2;
    } else continue;
    if(i<toks.length && /^[A-Z]$/.test(toks[i])){ flt_cls=toks[i].toUpperCase(); i++; }
    var day=null,mon=null,dm;
    dm=(i<toks.length)?/^(\d{1,2})([A-Z]{3})$/.exec(toks[i].toUpperCase()):null;
    if(dm && MONTH_MAP[dm[2]] && dm[2].length===3){
      day=parseInt(dm[1],10); mon=MONTH_MAP[dm[2]]; i++;
    } else if(i+1<toks.length && /^\d{1,2}$/.test(toks[i])
              && MONTH_MAP[toks[i+1].toUpperCase()]){
      day=parseInt(toks[i],10); mon=MONTH_MAP[toks[i+1].toUpperCase()]; i+=2;
    } else continue;
    if(!(day>=1&&day<=31)) continue;
    if(i<toks.length && /^[A-Z]$/.test(toks[i].toUpperCase())){   // stray cabin letter between date and airports ("06FEB J JFKLHR")
      if(!flt_cls) flt_cls=toks[i].toUpperCase(); i++;
    }
    if(i+1>=toks.length) continue;
    var apA=toks[i].toUpperCase(), apB=toks[i+1].toUpperCase();
    if(!/^[A-Z]{3}$/.test(apA) && /^[A-Z]{6}$/.test(apA) && AIRPORTS[apA.slice(0,3)] && AIRPORTS[apA.slice(3)]){
      toks.splice(i,1,apA.slice(0,3),apA.slice(3));              // glued pair -> unroll "JFKLHR" into two tokens
      apA=toks[i].toUpperCase(); apB=toks[i+1].toUpperCase();
    }
    if(!/^[A-Z]{3}$/.test(apA) || !/^[A-Z]{3}$/.test(apB)) continue;
    var orig=apA, dest=apB;
    if(orig===dest) continue;
    i+=2;
    while(i<toks.length && /^[A-Z]{2}\d{1,2}$/.test(toks[i].toUpperCase())) i++;   // sell-status junk ("SS1","HK1","NN1")
    var dct=(i<toks.length)?toks[i]:"";                       // raw dep clock token (noon "N" marker)
    var dc=dct?_gdsClock(dct):null;
    if(!dc) continue; i++;
    var am=(i<toks.length)?/^(\d{3,4}[APNM])[\¥+‡]?(-?\d)?$/.exec(toks[i].toUpperCase()):null;
    if(!am) continue;
    var ac=_gdsClock(am[1]);
    if(!ac) continue;
    var shift=am[2]?parseInt(am[2],10):0;          // "-1" = lands the previous day (eastbound across the date line)
    i++;
    if(i<toks.length && /^[\¥+‡]?(-1|[0-3])$/.test(toks[i])){
      shift=parseInt(toks[i].replace(/[\¥+‡]/g,""),10); i++; }
    if(i<toks.length){                                        // arrival date -> overnight shift ("945A  07FEB")
      var ad=/^(\d{1,2})([A-Z]{3})(?:\d{2,4})?$/.exec(toks[i].toUpperCase());
      if(ad && MONTH_MAP[ad[2]]){
        var sh=parseInt(ad[1],10)-day; while(sh<0) sh+=31;
        if(sh>=0&&sh<=3) shift=sh;
        i++;
      }
    }
    var cls=flt_cls||"";                                      // glued / before-date class wins
    if(!cls && i<toks.length && /^[A-Z]$/.test(toks[i])){ cls=toks[i].toUpperCase(); i++; }
    var acft="",dur="",dist="";
    while(i<toks.length){
      var t=toks[i], up=t.toUpperCase();
      if(!acft && IATA_ACFT_CODES[up] && /\d/.test(up)) acft=up;
      else if(!dur && /^\d{1,2}\.\d{2}$/.test(t)) dur=t;
      else if(!dist && /^\d{3,5}$/.test(t)) dist=t;
      i++;
    }
    var seg=Seg();
    seg.seg=segs.length+1;
    seg.airline=al; seg.flight_no=flt;
    seg.date_ddmmm=makeDate(day,mon);
    seg.orig=orig; seg.dest=dest;
    seg.dep_time=/N$/i.test(dct)?"1200N":fmtClock(dc[0],dc[1]);   // noon stays N (1200N, not 1200P)
    seg.arr_time=/N$/.test(am[1])?"1200N":fmtClock(ac[0],ac[1]);
    seg.arr_day_shift=Math.min(Math.max(shift,-1),3);
    seg.booking_class=cls;
    seg.aircraft=acft||"???";
    seg.cabin=_cabinNear(lines,li)||CLASS_TO_CABIN[cls]||"ECONOMY";
    if(!seg.booking_class) seg.booking_class=CABIN_DEFAULT_CLASS[seg.cabin];
    if(dur){
      var parts=dur.split(".");
      seg.flight_time=parseInt(parts[0],10)+"."+parts[1];
    } else {
      var fdate={y:_TODAY.y, m:mon, d:Math.min(day,28)};
      var offO=utcOffset(orig,fdate), offD=utcOffset(dest,fdate), duration;
      if(offO===null||offD===null){ duration=0; }
      else{
        var rawMin=(ac[0]*60+ac[1]-offD*60)-(dc[0]*60+dc[1]-offO*60);
        duration=rawMin+1440*seg.arr_day_shift;
        if(duration<=0) duration=rawMin+1440;
      }
      if(duration<=0||duration>1700){
        var est;
        if(dist && dist!=="0") est=parseInt(dist,10);
        else if(AIRPORTS[orig]&&AIRPORTS[dest]) est=haversineMiles(orig,dest);
        else est=0;
        var dm2=est?estimateDurationMin(est):0;
        duration=dm2||0;
      }
      seg.flight_time=duration?formatHMM(duration):"0.00";
    }
    if(!dist){
      dist=(AIRPORTS[orig]&&AIRPORTS[dest])?String(Math.round(haversineMiles(orig,dest))):"0";
    }
    seg.distance=dist;
    segs.push(seg);
    if(used) used.push(li);
  }
  fillAircraft(segs);
  return segs;
}

function fillAircraft(segments){
  segments.forEach(function(s){
    if(s.aircraft===""||s.aircraft==="???"){
      var d=/^\d+$/.test(String(s.distance))?parseInt(s.distance,10):0;
      var r=inferAircraft(s.airline,s.flight_no,s.orig,s.dest,d);
      s.aircraft=r[0];
      s.warnings.push("aircraft inferred "+r[0]+" ("+s.airline+" "+s.flight_no+", "+r[1]+")");
    }});
  segments.forEach(function(s){
    var d=/^\d+$/.test(String(s.distance))?parseInt(s.distance,10):0;
    var warn=rangeAdvisory(s.aircraft,s.orig,s.dest,d);
    if(warn) s.warnings.push(warn);});
}

/* ---------------- hidden-stop merge (v3.2) ---------------- */
function _ddmmmParts(ddmmm){
  var m=/^\s*(\d{1,2})\s*([A-Za-z]{3})/.exec(ddmmm||"");
  if(!m||MONTHS.indexOf(m[2].toUpperCase())<0) return null;
  return [parseInt(m[1],10), MONTHS.indexOf(m[2].toUpperCase())+1];
}
function _clockMin(tok){
  var m=/^(\d{1,2})(\d{2})([AP])$/.exec((tok||"").trim());
  if(!m) return null;
  var h=parseInt(m[1],10)%12, mi=parseInt(m[2],10);
  if(m[3]==="P") h+=12;
  return h*60+mi;
}
function _groundMinutes(a,b){
  var pa=_ddmmmParts(a.date_ddmmm), pb=_ddmmmParts(b.date_ddmmm);
  var ca=_clockMin(a.arr_time), cb=_clockMin(b.dep_time);
  if(!pa||!pb||ca===null||cb===null) return null;
  var yr=_TODAY.y;
  var monA=pa[1],monB=pb[1];
  var dayAddB=0;
  if((pb[1]*100+pb[0])<(pa[1]*100+pa[0])) dayAddB=1;  // year turnover
  var da={y:yr,m:monA,d:pa[0]}, db={y:yr+dayAddB,m:monB,d:pb[0]};
  var offa=utcOffset(a.dest,da), offb=utcOffset(b.orig,db);
  if(offa===null||offb===null) return null;
  var daysDiff=(Date.UTC(db.y,db.m-1,db.d)-Date.UTC(yr,monA-1,pa[0]))/86400000;
  var arrUtc=a.arr_day_shift*1440+ca-offa*60;
  var depUtc=daysDiff*1440+cb-offb*60;
  return depUtc-arrUtc;
}
function _blockHmm(){
  var tot=0;
  for(var k=0;k<arguments.length;k++){
    var m=/^(\d+)\.(\d{2})$/.exec((arguments[k]||"").trim());
    if(!m) return "";
    tot+=parseInt(m[1],10)*60+parseInt(m[2],10);
  }
  return Math.floor(tot/60)+"."+("0"+(tot%60)).slice(-2);
}
function _joinHidden(a,b){
  var pa=_ddmmmParts(a.date_ddmmm), pb=_ddmmmParts(b.date_ddmmm);
  if(pa&&pb){
    var ordA=pa[1]*31+pa[0];
    var ordB=pb[1]*31+pb[0]+b.arr_day_shift;
    if(ordB-ordA<-300) ordB+=372;
    a.arr_day_shift=Math.max(0,ordB-ordA);
  }
  var tot=_blockHmm(a.flight_time,b.flight_time);
  if(tot) a.flight_time=tot;
  var dmi=haversineMiles(a.orig,b.dest);
  if(dmi) a.distance=String(Math.round(dmi));
  if(b.aircraft&&a.aircraft&&(a.aircraft+b.aircraft).indexOf("???")<0&&a.aircraft!==b.aircraft)
    a.warnings.push("hidden-stop legs use "+a.aircraft+" then "+b.aircraft+" — first leg shown");
  if(b.booking_class&&a.booking_class&&a.booking_class!==b.booking_class)
    a.warnings.push("class differs on hidden-stop legs ("+a.booking_class+"/"+b.booking_class+") — first shown");
  b.warnings.forEach(function(w){a.warnings.push(w);});
  a.dest=b.dest; a.arr_time=b.arr_time;
}
function mergeHiddenStops(segs){
  if(segs.length<2) return segs;
  var out=[], i=0, n=segs.length;
  while(i<n){
    var cur=segs[i], stops=[];
    while(i+1<n && cur.flight_no && segs[i+1].flight_no
          && segs[i+1].airline===cur.airline
          && (segs[i+1].flight_no.replace(/^0+/,"")===cur.flight_no.replace(/^0+/,""))
          && segs[i+1].orig===cur.dest){
      var nxt=segs[i+1];
      var gap=_groundMinutes(cur,nxt);
      if(gap===null||gap<0||gap>24*60) break;
      stops.push(cur.dest);
      _joinHidden(cur,nxt);
      i++;
    }
    if(stops.length){
      cur.hidden_stops=stops.slice();
      cur.warnings.push("hidden stop "+stops.join(" + ")+" — same flight "
        +cur.airline+" "+cur.flight_no+" continues; shown as ONE segment (not "
        +(stops.length+1)+")");
      var seen={},ded=[]; cur.warnings.forEach(function(w){if(!seen[w]){seen[w]=1;ded.push(w);}});
      cur.warnings=ded;
    }
    out.push(cur); i++;
  }
  out.forEach(function(s,k){s.seg=k+1;});
  return out;
}

/* ---------------- chronological sort (v3.4.1) ---------------- */
function sortChronologically(segs){
  if(segs.length<2) return segs;
  var mons=segs.map(function(s){var p=_ddmmmParts(s.date_ddmmm);return p?p[1]:0;});
  var have=mons.filter(function(m){return m;});
  var wrap=have.length && (Math.max.apply(null,have)-Math.min.apply(null,have)>6);
  // Year-turnover pivot: the "trip year" starts at the month that follows the
  // largest circular gap between booked months (e.g. DEC..MAY -> gap MAY->DEC,
  // so DEC starts the trip and JAN-MAY belong to the following year). The old
  // hardcoded "m<=4" pivot broke any itinerary returning in MAY or JUN.
  var pivot=13;
  if(wrap){
    var uniq=[]; have.forEach(function(m){if(uniq.indexOf(m)<0)uniq.push(m);});
    uniq.sort(function(a,b){return a-b;});
    var bestGap=-1;
    for(var i=0;i<uniq.length;i++){
      var nxt=uniq[(i+1)%uniq.length]+(i===uniq.length-1?12:0);
      var gap=nxt-uniq[i];
      if(gap>bestGap){bestGap=gap;pivot=uniq[(i+1)%uniq.length];}
    }
  }
  return segs.map(function(s,idx){return [idx,s];}).sort(function(A,B){
    var ka=keyOf(A[1],A[0]), kb=keyOf(B[1],B[0]);
    return ka-kb;
  }).map(function(t){return t[1];});
  function keyOf(s,idx){
    var p=_ddmmmParts(s.date_ddmmm);
    if(!p) return 1e9+idx/1e6;
    var d=p[0],m=p[1],yAdd=0;
    if(wrap&&m<pivot){m+=12;yAdd=1;}
    var c=_clockMin(s.dep_time); if(c===null)c=0;
    // Compare in UTC when the departure airport is known: a 14MAY 1245A HKG
    // departure really happens BEFORE a 13MAY 1115P YVR departure.
    var off=utcOffset(s.orig,{y:_TODAY.y+yAdd,m:p[1],d:Math.min(d,28)});
    if(off!==null) c-=off*60;
    return (m*31+d)*1440+c+idx/1e6;
  }
}

/* ---------------- prose / Google-Flights path ---------------- */
function pickTimes(wTimes,pTimes){
  wTimes.forEach(function(t){t.region="w";});
  pTimes.forEach(function(t){t.region="p";});
  var pool=wTimes.length>=2?wTimes.slice():wTimes.concat(pTimes);
  pool.sort(function(a,b){return a.pos-b.pos;});
  if(!pool.length) return [null,null];
  var dep=null,arr=null,i;
  for(i=0;i<pool.length;i++) if(pool[i].depkw){dep=pool[i];break;}
  for(i=0;i<pool.length;i++) if(pool[i].arrkw&&pool[i]!==dep){arr=pool[i];break;}
  if(!dep&&!arr){ if(pool.length>=2){dep=pool[0];arr=pool[pool.length-1];} else dep=pool[0]; }
  else if(!dep){var o1=pool.filter(function(t){return t!==arr;}); dep=o1.length?o1[0]:null;}
  else if(!arr){var o2=pool.filter(function(t){return t!==dep;}); arr=o2.length?o2[o2.length-1]:null;}
  if(dep&&arr&&dep===arr){var o3=pool.filter(function(t){return t!==dep;}); arr=o3.length?o3[o3.length-1]:null;}
  if(dep&&arr&&dep.pos>arr.pos&&!dep.depkw&&!arr.arrkw){var tmp=dep;dep=arr;arr=tmp;}
  return [dep,arr];
}

function parseProse(text){
  var headers=findSideHeaders(text);
  var anchors=findAnchors(text);
  if(!anchors.length) return [[],true];  // second = "no anchors" flag
  // block assignment: anchor belongs to the nearest header at/before it
  function headerFor(posI){
    var best=null;
    for(var i=0;i<headers.length;i++) if(headers[i][0]<=posI) best=headers[i]; else break;
    return best;
  }
  function nextHeaderAfter(startPos){
    for(var i=0;i<headers.length;i++) if(headers[i][0]>startPos) return headers[i][0];
    return text.length;
  }
  var gCabin=null,m;
  m=ALL_CABIN_RE.exec(text);
  if(m){var tok=m[1].toUpperCase(); gCabin=/PREMIUM/.test(tok)?"PREMIUM ECONOMY":tok;}
  var gCabinAny=null;
  for(var ci=0;ci<CABIN_RES.length;ci++) if(CABIN_RES[ci][1].test(text)){gCabinAny=CABIN_RES[ci][0];break;}
  var gClass=null; var gm=GLOBAL_CLASS_RE.exec(text);
  if(gm) gClass=gm[1].toUpperCase();

  var segs=[];
  for(var ai=0;ai<anchors.length;ai++){
    var a=anchors[ai];
    var hdr=headerFor(a.start);
    var winStart=hdr?hdr[0]:text.lastIndexOf("\n\n",a.start); if(winStart<0) winStart=0;
    var winEnd=hdr?nextHeaderAfter(hdr[0]):text.length;
    // but never past the next anchor's header start
    if(ai+1<anchors.length){
      var h2=headerFor(anchors[ai+1].start);
      if(h2 && h2!==hdr) winEnd=Math.min(winEnd,h2[0]);
    }
    var region=text.slice(winStart,winEnd);
    var sel=text.slice(a.end,winEnd);
    var oth=text.slice(winStart,a.start);
    var seg=Seg();
    seg.seg=segs.length+1;
    seg.airline=a.code; seg.flight_no=a.num;

    // date: own region, header-first
    var dates=findDates(region), d=null;
    if(dates.length) d=dates[0];
    var seg_day=null, seg_mon=null;
    if(d){seg_day=d.day;seg_mon=d.mon;seg.date_ddmmm=makeDate(seg_day,seg_mon);}
    var flightDate=_TODAY;
    if(d) flightDate={y:_TODAY.y,m:d.mon,d:Math.min(d.day,28)};

    // route: header of own block, else code mentions inside region
    var orig=hdr?hdr[1]:null, dest=hdr?hdr[2]:null;
    if(!orig||!dest){
      var men=_airportMentions(region);
      var uniqM=[]; men.forEach(function(t){if(uniqM.indexOf(t[1])<0)uniqM.push(t[1]);});
      for(var k=0;k<uniqM.length;k++){
        if(orig===uniqM[k]||dest===uniqM[k]) continue;
        if(!orig)orig=uniqM[k];
        else if(!dest)dest=uniqM[k];
      }
    }
    if(dest===orig) dest=null;
    if(!dest){ // find any other code
      var men2=_airportMentions(region);
      for(var k2=0;k2<men2.length;k2++) if(men2[k2][1]!==orig){dest=men2[k2][1];break;}
    }
    seg.orig=orig||""; seg.dest=dest||"";

    // times
    var wTimes=findTimes(sel,a.end), pTimes=findTimes(oth,winStart);
    var pair=pickTimes(wTimes,pTimes), dep=pair[0], arr=pair[1];
    var warn=[];
    if(!dep) warn.push("departure time missing -> ????");
    if(!arr) warn.push("arrival time missing -> ????");
    seg.dep_time=dep?fmtClock(dep.h,dep.m):"????";
    seg.arr_time=arr?fmtClock(arr.h,arr.m):"????";

    // duration / overnight (exact port)
    var durToken=findDuration(sel)||findDuration(oth);
    var explicitShift=(arr&&arr.marker)?arr.marker:null;
    if(explicitShift===null&&arr&&seg_day){
      var lineEnd=text.indexOf("\n",arr.pos);
      if(lineEnd===-1) lineEnd=text.length;
      var tds=findDates(text.slice(arr.pos,lineEnd));
      if(tds.length && (tds[0].mon*100+tds[0].day)>(seg_mon*100+seg_day)) explicitShift=1;
    }
    var distMiles=findDistance(sel)||findDistance(oth);
    if(distMiles===null&&AIRPORTS[seg.orig]&&AIRPORTS[seg.dest])
      distMiles=haversineMiles(seg.orig,seg.dest);
    var depMin=dep?dep.h*60+dep.m:null, arrMin=arr?arr.h*60+arr.m:null;
    var shift=0,duration=null;
    if(depMin!==null&&arrMin!==null){
      var offO=AIRPORTS[seg.orig]?utcOffset(seg.orig,flightDate):null;
      var offD=AIRPORTS[seg.dest]?utcOffset(seg.dest,flightDate):null;
      var raw=null;
      if(offO!==null&&offD!==null) raw=(arrMin-offD*60)-(depMin-offO*60);
      if(durToken){
        duration=durToken;
        if(explicitShift!==null) shift=explicitShift;
        else if((raw!==null&&raw<=-60)||(raw===null&&arrMin<depMin)) shift=1;
      } else if(explicitShift!==null){
        shift=explicitShift;
        if(raw!==null) duration=raw+1440*shift;
      } else if(raw!==null){
        if(raw<=0){shift=1;duration=raw+1440;} else duration=raw;
      } else if(arrMin<depMin){shift=1;warn.push("overnight marker assumed (+1)");}
    }
    seg.arr_day_shift=Math.min(Math.max(shift,0),3);
    if(duration===null) duration=durToken;
    if(duration===null||duration<=0||duration>1700){
      duration=estimateDurationMin(distMiles);
      if(duration) warn.push("flight time estimated from distance");
    }
    seg.flight_time=duration?formatHMM(duration):"0.00";
    if(distMiles!==null) seg.distance=String(Math.round(distMiles));

    // cabin / class
    var cab=cabinInRegion(region);
    var cabin=gCabin||cab.cabin||gCabinAny||"ECONOMY";
    var cls=cab.cls||gClass||"";
    seg.cabin=cabin;
    seg.booking_class=cls;
    if(!seg.booking_class) seg.booking_class=CABIN_DEFAULT_CLASS[seg.cabin]||"Y";

    // aircraft
    var acft=scanAircraft(region.toUpperCase());
    if(acft) seg.aircraft=acft;
    seg.warnings=warn;
    seg._date_parts=seg_day?[seg_day,seg_mon]:null;
    segs.push(seg);
  }
  fillAircraft(segs);
  return [segs,false];
}

/* ---------------- lost-row guard (v3.2/3.4) + entry ---------------- */
var LOST_ROW_RE = new RegExp(
  "^\\s*(?:\\d{1,2}\\s+)?([A-Z][A-Z0-9]|[0-9][A-Z])\\s*(\\d{1,4})\\s+"+
  "(?:[A-Z]\\s+)?\\d{1,2}\\s*(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\\b","i");

function parse(text){
  text=text.replace(SUMMARY_STRIP_RE,"\n");   // kill Google-Flights summary cards before anything sees them
  var used=[], gds=tryGdsLines(text, used), segs, warns=[];
  if(gds.length){
    gds=mergeHiddenStops(gds);
    gds.forEach(function(s){s.warnings.forEach(function(w){warns.push("S"+s.seg+": "+w);});});
    segs=gds;
    /* mixed paste (GDS rows + Google-Flights prose): parse the remainder as prose too */
    var allL=text.split("\n"), rest=[], uu={};
    used.forEach(function(li){uu[li]=1;});
    for(var ul=0;ul<allL.length;ul++) if(!uu[ul]) rest.push(allL[ul]);
    var pr2=parseProse(rest.join("\n"));
    if(!pr2[1] && pr2[0].length){
      var psegs=mergeHiddenStops(pr2[0]), seenP={};
      psegs.forEach(function(s2){s2.warnings.forEach(function(w){
        if(!seenP[w]){seenP[w]=1;warns.push(w);}});});
      segs=segs.concat(psegs);
    }
  } else {
    var pr=parseProse(text);
    if(pr[1]) return [[],["No flight anchors (airline + flight number) found. "
      +"Try AI mode for free-form input."]];
    segs=pr[0];
    segs=mergeHiddenStops(segs);
    var seenW={};
    segs.forEach(function(s){s.warnings.forEach(function(w){
      if(!seenW[w]){seenW[w]=1;warns.push(w);}});});
  }
  segs=sortChronologically(segs);
  segs.forEach(function(s,i){s.seg=i+1;});
  var have={};
  segs.forEach(function(s){have[s.airline.toUpperCase()+"|"+(s.flight_no.replace(/^0+/,"")||"0")]=1;});
  var lost=[], lines=text.split("\n");
  for(var ln=0;ln<lines.length;ln++){
    var m=LOST_ROW_RE.exec(lines[ln]);
    if(m && !have[m[1].toUpperCase()+"|"+(m[2].replace(/^0+/,"")||"0")]) lost.push(ln+1);
  }
  if(lost.length){
    warns.push("flight row(s) NOT read — check the times/date on input line(s) "
      +lost.slice(0,6).join(", ")+": output has NONE of them; fix the text or press ✦ AI to fill them");
  }
  return [segs,warns];
}

var SpicyEngine={
  parse:parse, renderItinerary:renderItinerary, renderSegment:renderSegment,
  inferAircraft:inferAircraft, haversineMiles:haversineMiles, scanAircraft:scanAircraft,
  MASTER_PROMPT:D.masterPrompt, _tryGdsLines:tryGdsLines, _findAnchors:findAnchors
};
if(typeof module!=="undefined") module.exports=SpicyEngine;
if(typeof window!=="undefined") window.SpicyEngine=SpicyEngine;
})();
