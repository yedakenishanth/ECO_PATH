// ══════════════════════════════════════════
//  STATE
// ══════════════════════════════════════════
const state = {
  user: { name: 'Nishanth' },
  ecoPoints: 1448,
  co2Saved: 14.5,
  co2Emitted: 0,
  streak: 1,
  totalTrips: 0,
  totalKm: 0,
  trips: [],
  earnedBadges: ['first_step','eco_starter'],
  coupons: [],
};

let liveTrip = null;
let liveTripInterval = null;
let plannerLogged = null;

// ══════════════════════════════════════════
//  SECURITY: HTML ESCAPING
// ══════════════════════════════════════════
// Escapes user-supplied text before it is interpolated into innerHTML,
// preventing stored/reflected XSS via names, trip locations, etc.
function escapeHtml(str){
  return String(str??'').replace(/[&<>"']/g,c=>({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}

// ══════════════════════════════════════════
//  STORAGE ABSTRACTION
//  A thin get/set/remove layer over localStorage. Swapping to a real
//  backend later (REST/Supabase/Firebase) means changing the three
//  functions in this block only — nothing else in the app should
//  touch `localStorage` directly.
// ══════════════════════════════════════════
const storage={
  get(key){
    try{
      const raw=localStorage.getItem(key);
      return raw===null?null:JSON.parse(raw);
    }catch(e){
      console.warn(`EcoPath: could not read "${key}" from storage`,e);
      return null;
    }
  },
  set(key,value){
    try{
      localStorage.setItem(key,JSON.stringify(value));
      return true;
    }catch(e){
      console.warn(`EcoPath: could not write "${key}" to storage`,e);
      return false;
    }
  },
  remove(key){
    try{localStorage.removeItem(key);}catch(e){}
  }
};

// ══════════════════════════════════════════
//  PERSISTENCE (app state, via the storage abstraction above)
// ══════════════════════════════════════════
const STORAGE_KEY='ecopath_state_v1';
function saveState(){
  storage.set(STORAGE_KEY,state);
}
function loadState(){
  const saved=storage.get(STORAGE_KEY);
  if(!saved)return false;
  Object.assign(state,saved);
  return true;
}
function resetState(){
  storage.remove(STORAGE_KEY);
  location.reload();
}

// ══════════════════════════════════════════
//  NETWORK HELPER: fetch with timeout + retry
// ══════════════════════════════════════════
async function fetchWithRetry(url,options={},{retries=1,timeoutMs=8000}={}){
  for(let attempt=0;attempt<=retries;attempt++){
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),timeoutMs);
    try{
      const resp=await fetch(url,{...options,signal:controller.signal});
      clearTimeout(timer);
      if(!resp.ok) throw new Error(`Request failed (${resp.status})`);
      return resp;
    }catch(err){
      clearTimeout(timer);
      const isLastAttempt=attempt===retries;
      if(isLastAttempt){
        if(err.name==='AbortError') throw new Error('Request timed out — please try again');
        throw err;
      }
      await new Promise(r=>setTimeout(r,500*(attempt+1))); // small backoff before retry
    }
  }
}

// ── GPS TRACKING STATE ──
let gpsWatchId = null;
let lastGPSPos = null;
let gpsDistKm = 0;
let gpsAvailable = false;

// ── MAP STATE ──
let plannerMap = null;
let routePolyline = null;
let fromMarker = null;
let toMarker = null;
let liveGPSMarker = null;
let plannedRoute = null; // store last planned route info

const MODES = [
  {id:'walk',   label:'Walking',       icon:'🚶', emoji:'🚶', co2:0,   color:'#16a34a', bg:'#dcfce7'},
  {id:'bike',   label:'Cycling',       icon:'🚲', emoji:'🚲', co2:21,  color:'#15803d', bg:'#bbf7d0'},
  {id:'ebike',  label:'E-Bike',        icon:'⚡', emoji:'⚡', co2:22,  color:'#0d9488', bg:'#ccfbf1'},
  {id:'bus',    label:'Bus',           icon:'🚌', emoji:'🚌', co2:89,  color:'#b45309', bg:'#fef3c7'},
  {id:'train',  label:'Train / Metro', icon:'🚇', emoji:'🚇', co2:41,  color:'#1d4ed8', bg:'#dbeafe'},
  {id:'carpool',label:'Carpool',       icon:'🚗', emoji:'🚗', co2:96,  color:'#7c3aed', bg:'#ede9fe'},
  {id:'ev',     label:'Electric Car',  icon:'🔋', emoji:'🔋', co2:75,  color:'#0369a1', bg:'#e0f2fe'},
  {id:'car',    label:'Car',           icon:'🚘', emoji:'🚘', co2:192, color:'#dc2626', bg:'#fee2e2'},
];

const BADGES = [
  {id:'first_step',    name:'First Step',     desc:'Logged your first trip',          pts:100,  req:s=>s.totalTrips>=1},
  {id:'zero_hero',     name:'Zero Hero',      desc:'Completed a walk or bike trip',    pts:200,  req:s=>s.trips.some(t=>['walk','bike'].includes(t.mode))},
  {id:'eco_starter',   name:'Eco Starter',    desc:'Saved 5 kg of CO2',               pts:300,  req:s=>s.co2Saved>=5},
  {id:'carbon_saver',  name:'Carbon Saver',   desc:'Saved 25 kg of CO2',              pts:500,  req:s=>s.co2Saved>=25},
  {id:'green_hero',    name:'Green Hero',     desc:'Saved 100 kg of CO2',             pts:1000, req:s=>s.co2Saved>=100},
  {id:'streak_starter',name:'Streak Starter', desc:'3-day eco streak',                pts:150,  req:s=>s.streak>=3},
  {id:'streak_master', name:'Streak Master',  desc:'7-day eco streak',                pts:400,  req:s=>s.streak>=7},
  {id:'commuter',      name:'Commuter',       desc:'Logged 10 trips',                 pts:300,  req:s=>s.totalTrips>=10},
  {id:'frequent_eco',  name:'Frequent Eco',   desc:'Logged 50 trips',                 pts:700,  req:s=>s.totalTrips>=50},
  {id:'transit_fan',   name:'Transit Fan',    desc:'Logged 10 transit trips',         pts:250,  req:s=>s.trips.filter(t=>['bus','train'].includes(t.mode)).length>=10},
  {id:'eco_champion',  name:'Eco Champion',   desc:'Reached Level 5',                 pts:800,  req:s=>getLevel(s.ecoPoints).n>=5},
  {id:'century_club',  name:'Century Club',   desc:'Logged 100 trips',                pts:1500, req:s=>s.totalTrips>=100},
];

const LEADERBOARD = [
  {name:'Aryan K.',  pts:4200, badges:8},
  {name:'Priya M.',  pts:3800, badges:7},
  {name:'Ravi S.',   pts:3100, badges:6},
  {name:'Ananya T.', pts:2700, badges:5},
  {name:'Kiran B.',  pts:2300, badges:4},
];

const CREDIT_RULES = [
  {label:'1 km cycling',           pts:10,  icon:'🚲', bg:'#bbf7d0', color:'#15803d'},
  {label:'5 km bus / metro ride',  pts:20,  icon:'🚌', bg:'#fef3c7', color:'#b45309'},
  {label:'500g CO2 saved',         pts:20,  icon:'🌿', bg:'#dcfce7', color:'#16a34a'},
  {label:'Shortest route taken',   pts:10,  icon:'📍', bg:'#dbeafe', color:'#1d4ed8'},
  {label:'Less congested route',   pts:10,  icon:'✅', bg:'#ede9fe', color:'#7c3aed'},
  {label:'Shared transport',       pts:10,  icon:'🤝', bg:'#ccfbf1', color:'#0d9488'},
];

const COMMUNITY_FEED = [
  {initials:'AK', name:'Aryan K.', action:'cycled 8 km to Indiranagar',          pts:'+80 credits', time:'2 min ago'},
  {initials:'PM', name:'Priya M.', action:'saved 1.2 kg CO2 via metro',           pts:'+48 credits', time:'14 min ago'},
  {initials:'RS', name:'Ravi S.',  action:'took bus on a shared route',            pts:'+30 credits', time:'31 min ago'},
  {initials:'AT', name:'Ananya T.',action:'walked 3 km in Koramangala',            pts:'+30 credits', time:'1 hr ago'},
  {initials:'KB', name:'Kiran B.', action:'used carpool, saved 0.8 kg CO2',       pts:'+40 credits', time:'2 hr ago'},
];

const LEVEL_THRESHOLDS = [0,500,1000,1500,2000,3000,5000];
const LEVEL_NAMES = ['','Green Newcomer','Eco Explorer','Eco Traveler','Eco Commuter','Eco Champion','Eco Legend'];
function getLevel(pts){
  let n=1;
  for(let i=1;i<LEVEL_THRESHOLDS.length;i++){if(pts>=LEVEL_THRESHOLDS[i-1])n=i;}
  return{n,title:LEVEL_NAMES[n],next:LEVEL_THRESHOLDS[Math.min(n,LEVEL_THRESHOLDS.length-1)]};
}
function levelPct(pts){
  const lv=getLevel(pts);
  const low=LEVEL_THRESHOLDS[lv.n-1]||0;
  const high=lv.next;
  if(high===low)return 100;
  return Math.min(100,Math.round(((pts-low)/(high-low))*100));
}

// ══════════════════════════════════════════
//  PAGE ROUTING
// ══════════════════════════════════════════
function showPage(name){
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.getElementById('page-'+name).classList.add('active');
  const landExtra=document.getElementById('land-extra');
  if(landExtra) landExtra.style.display=(name==='landing')?'block':'none';
  if(name==='app') renderApp('dashboard');
}
function showApp(section){
  document.querySelectorAll('.app-section').forEach(s=>s.classList.add('hidden'));
  document.getElementById('app-'+section).classList.remove('hidden');
  document.querySelectorAll('.nav-btn').forEach(b=>b.classList.toggle('active',b.dataset.nav===section));
  const renders={dashboard:renderDashboard,planner:renderPlanner,tracker:renderTracker,coach:renderCoach,community:renderCommunity,achievements:renderAchievements};
  renders[section]&&renders[section]();
}
function renderApp(s){showApp(s);}

// ══════════════════════════════════════════
//  AUTH
// ══════════════════════════════════════════
const EMAIL_RE=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function doSignup(){
  const name=document.getElementById('su-name').value.trim();
  const email=document.getElementById('su-email').value.trim();
  const pass=document.getElementById('su-pass').value;
  if(!name){toast('Please enter your name');return;}
  if(!EMAIL_RE.test(email)){toast('Please enter a valid email address');return;}
  if(pass.length<8){toast('Password must be at least 8 characters');return;}
  state.user.name=name;
  document.getElementById('nav-avatar').textContent=name[0].toUpperCase();
  saveState();
  showPage('app');
}
function doSignin(){
  const email=document.getElementById('si-email').value.trim();
  const pass=document.getElementById('si-pass').value;
  if(!EMAIL_RE.test(email)){toast('Please enter a valid email address');return;}
  if(!pass){toast('Please enter your password');return;}
  state.user.name=email.split('@')[0];
  document.getElementById('nav-avatar').textContent=state.user.name[0].toUpperCase();
  saveState();
  showPage('app');
}

// ══════════════════════════════════════════
//  TOAST
// ══════════════════════════════════════════
function toast(msg){
  const t=document.getElementById('toast');
  document.getElementById('toast-msg').textContent=msg;
  t.classList.add('show');
  setTimeout(()=>t.classList.remove('show'),3200);
}
function updateNav(){
  document.getElementById('nav-pts').textContent=state.ecoPoints.toLocaleString();
}

// ══════════════════════════════════════════
//  COUPON LOGIC
// ══════════════════════════════════════════
function checkCoupon(){
  const couponsEarned=Math.floor(state.ecoPoints/300);
  while(state.coupons.length<couponsEarned){
    const code='ECO-'+Math.random().toString(36).substring(2,7).toUpperCase();
    state.coupons.push({code,redeemed:false,earnedAt:state.ecoPoints});
    toast(`Coupon unlocked: ${code} — 10% off eco transport!`);
  }
}

// ══════════════════════════════════════════
//  TRIP LOGGING
// ══════════════════════════════════════════
function logTrip(from,to,distKm,modeId,bonuses=[]){
  const mode=MODES.find(m=>m.id===modeId);
  const co2Car=(distKm*192)/1000;
  const co2Mode=(distKm*mode.co2)/1000;
  const saved=Math.max(0,co2Car-co2Mode);
  let pts=0;
  pts+=Math.round((saved*1000/500)*20);
  if(modeId==='bike'||modeId==='walk') pts+=Math.round(distKm*10);
  if(modeId==='bus'||modeId==='train') pts+=Math.round((distKm/5)*20);
  pts=Math.max(10,pts);
  bonuses.forEach(b=>{if(b==='shortest')pts+=10;if(b==='low_congestion')pts+=10;if(b==='shared')pts+=10;});
  state.trips.push({from,to,distKm,mode:modeId,co2Saved:saved,co2Emitted:co2Mode,pts,date:new Date().toISOString(),bonuses});
  state.totalTrips++;state.totalKm+=distKm;state.co2Saved+=saved;state.co2Emitted+=co2Mode;state.ecoPoints+=pts;
  state.streak=Math.max(1,state.streak);
  BADGES.forEach(b=>{if(!state.earnedBadges.includes(b.id)&&b.req(state)){state.earnedBadges.push(b.id);setTimeout(()=>toast(`Badge unlocked: ${b.name}!`),400);}});
  checkCoupon();updateNav();saveState();
  return{saved,pts};
}

// ══════════════════════════════════════════
//  DASHBOARD
// ══════════════════════════════════════════
function renderDashboard(){
  const lv=getLevel(state.ecoPoints);
  const pct=levelPct(state.ecoPoints);
  const userName=state.user.name;
  const days=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const weekVals=days.map((_,i)=>state.trips.filter(t=>{const d=new Date(t.date);return d.getDay()===i;}).reduce((s,t)=>s+t.co2Saved,0));
  const maxVal=Math.max(...weekVals,0.1);
  const modeCount={};state.trips.forEach(t=>{modeCount[t.mode]=(modeCount[t.mode]||0)+1;});
  const usedModes=MODES.filter(m=>modeCount[m.id]);
  const nextCouponAt=Math.ceil(state.ecoPoints/300)*300;
  const creditsToNextCoupon=nextCouponAt-state.ecoPoints;
  const couponPct=Math.min(100,Math.round(((300-(creditsToNextCoupon%300))/300)*100));

  document.getElementById('app-dashboard').innerHTML=`
  <div class="page-header">
    <div>
      <h1 class="page-title">Welcome back, ${escapeHtml(userName)}</h1>
      <p class="page-sub">Your eco impact at a glance</p>
    </div>
    <button class="btn-plan" onclick="showApp('planner')">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>
      Plan Route
    </button>
  </div>
  <div class="level-card">
    <div class="level-top">
      <div class="level-info">
        <span class="level-badge">LVL ${lv.n}</span>
        <span class="level-name">${lv.title}</span>
      </div>
      <span class="level-pts">${state.ecoPoints.toLocaleString()} / ${lv.next.toLocaleString()} pts</span>
    </div>
    <div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>
    <p class="level-pct">${pct}% to Level ${lv.n+1}</p>
  </div>
  ${state.coupons.length>0?`
  <div class="coupon-banner" style="margin-bottom:20px">
    <div class="coupon-title">Coupon Unlocked 🎉</div>
    <div class="coupon-sub">You have ${state.coupons.filter(c=>!c.redeemed).length} active coupon(s). Use them on eco transport partners.</div>
    <div class="coupon-code">${state.coupons[state.coupons.length-1].code}</div><br>
    <button class="btn-copy" style="margin-top:14px" onclick="toast('Coupon code copied!')">Copy Code</button>
  </div>`:`
  <div style="background:var(--white);border-radius:12px;padding:16px 22px;border:1px solid var(--gray2);margin-bottom:20px;display:flex;align-items:center;gap:16px">
    <div style="flex:1">
      <div style="font-size:12px;font-weight:700;color:var(--gray5);letter-spacing:.5px;font-family:var(--mono);margin-bottom:6px">COUPON PROGRESS</div>
      <div class="coupon-progress-bar" style="height:8px;background:var(--gray2);border-radius:4px"><div style="height:100%;width:${couponPct}%;background:linear-gradient(90deg,var(--g7),var(--g4));border-radius:4px"></div></div>
      <div style="font-size:11px;color:var(--gray5);margin-top:6px;font-family:var(--mono)">${creditsToNextCoupon} credits until next coupon</div>
    </div>
    <div style="text-align:right;flex-shrink:0"><div style="font-size:20px;font-weight:800;color:var(--g6);font-family:var(--mono)">${couponPct}%</div><div style="font-size:10px;color:var(--gray5);font-family:var(--mono)">COMPLETE</div></div>
  </div>`}
  <div class="stats-grid">
    <div class="stat-card">
      <div class="stat-header"><span class="stat-label">CO2 SAVED</span><div class="stat-icon-box" style="background:#dcfce7"><svg viewBox="0 0 24 24" fill="none" stroke="#16a34a" stroke-width="2"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg></div></div>
      <div class="stat-value" style="color:var(--g6)">${state.co2Saved.toFixed(2)}</div><div class="stat-unit">kg vs driving</div>
    </div>
    <div class="stat-card">
      <div class="stat-header"><span class="stat-label">ECOCREDITS</span><div class="stat-icon-box" style="background:#fef3c7"><svg viewBox="0 0 24 24" fill="none" stroke="#b45309" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg></div></div>
      <div class="stat-value" style="color:var(--amber)">${state.ecoPoints.toLocaleString()}</div><div class="stat-unit">total earned</div>
    </div>
    <div class="stat-card">
      <div class="stat-header"><span class="stat-label">TRIPS</span><div class="stat-icon-box" style="background:#dbeafe"><svg viewBox="0 0 24 24" fill="none" stroke="#1d4ed8" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg></div></div>
      <div class="stat-value" style="color:var(--blue)">${state.totalTrips}</div><div class="stat-unit">${state.totalKm.toFixed(1)} km total</div>
    </div>
    <div class="stat-card">
      <div class="stat-header"><span class="stat-label">STREAK</span><div class="stat-icon-box" style="background:#fee2e2"><svg viewBox="0 0 24 24" fill="none" stroke="#dc2626" stroke-width="2"><path d="M8 2c0 0-2 5.5-2 9a6 6 0 0012 0c0-3.5-2-9-2-9"/></svg></div></div>
      <div class="stat-value" style="color:var(--red)">${state.streak}</div><div class="stat-unit">day streak</div>
    </div>
  </div>
  <div class="charts-grid">
    <div class="card">
      <div class="card-title">CO2 Saved — This Week</div>
      <div class="bar-chart">
        ${weekVals.map((v,i)=>`<div class="bar-col">
          <div class="bar-fill" style="height:${Math.round((v/maxVal)*80)+4}px;background:${v>0?'var(--g4)':'var(--gray2)'}"></div>
          <span class="bar-label">${days[i].slice(0,1)}</span>
        </div>`).join('')}
      </div>
    </div>
    <div class="card">
      <div class="card-title">Transport Mix</div>
      ${usedModes.length===0?`<div class="empty-state" style="padding:20px"><div class="empty-icon"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg></div><p>No trips yet</p></div>`:
      `<div class="transport-rows">${usedModes.map(m=>{
        const pct2=Math.round((modeCount[m.id]/state.totalTrips)*100);
        return`<div class="transport-row">
          <span class="t-label">${m.emoji||m.icon}</span>
          <div class="t-bar-wrap"><div class="t-bar" style="width:${pct2}%;background:${m.color}"></div></div>
          <span class="t-pct">${pct2}%</span>
        </div>`;}).join('')}
      </div>`}
    </div>
  </div>
  <div class="bottom-grid">
    <div class="card">
      <div class="card-title">Recent Trips</div>
      ${state.trips.length===0?`<div class="empty-state"><div class="empty-icon"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/></svg></div><p>No trips logged yet</p></div>`:
      [...state.trips].reverse().slice(0,4).map(t=>{const m=MODES.find(x=>x.id===t.mode);return`<div class="trip-item"><div class="trip-mode-badge" style="background:${m.bg};color:${m.color}">${m.emoji}</div><div class="trip-info"><div class="trip-route">${escapeHtml(t.from)} → ${escapeHtml(t.to)}</div><div class="trip-meta">${t.distKm.toFixed(1)} km · ${new Date(t.date).toLocaleDateString()}</div></div><div class="trip-stats"><div class="trip-saved">-${t.co2Saved.toFixed(2)} kg</div><div class="trip-pts">+${t.pts} pts</div></div></div>`;}).join('')}
    </div>
    <div class="card">
      <div class="card-title">Quick Actions</div>
      <button class="quick-btn" onclick="showApp('planner')">
        <div class="quick-icon-wrap"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#374151" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg></div>
        <div><div class="quick-title">Plan a Route</div><div class="quick-sub">Get the greenest route with live map</div></div>
        <div class="quick-arrow">›</div>
      </button>
      <button class="quick-btn" onclick="showApp('tracker')">
        <div class="quick-icon-wrap"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#374151" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg></div>
        <div><div class="quick-title">Carbon Tracker</div><div class="quick-sub">Full trip history and stats</div></div>
        <div class="quick-arrow">›</div>
      </button>
      <button class="quick-btn" onclick="showApp('coach')">
        <div class="quick-icon-wrap"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#374151" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></div>
        <div><div class="quick-title">Ask Eco Coach</div><div class="quick-sub">AI-powered commuting advice</div></div>
        <div class="quick-arrow">›</div>
      </button>
      <div class="eco-tip-box">
        <div class="eco-tip-label">AI DAILY TIP</div>
        <div class="eco-tip-text">Combining bus and cycling for the first/last mile can cut your total journey emissions by up to 65% compared to driving the same route.</div>
      </div>
    </div>
  </div>`;
}

// ══════════════════════════════════════════
//  ROUTE PLANNER — REAL MAP + GPS
// ══════════════════════════════════════════

// Haversine distance between two GPS coords (km)
function haversineKm(lat1,lon1,lat2,lon2){
  const R=6371;
  const dLat=(lat2-lat1)*Math.PI/180;
  const dLon=(lon2-lon1)*Math.PI/180;
  const a=Math.sin(dLat/2)**2+Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
  return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
}

// Geocode address via Nominatim (OpenStreetMap).
// NOTE: Nominatim's public demo API has a strict usage policy (max ~1 req/sec,
// no heavy/bulk usage, valid User-Agent required). This is fine for occasional
// personal use / demos but should be swapped for a self-hosted instance or a
// paid geocoding provider before any real production traffic.
async function geocodeAddress(query){
  const url=`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1&addressdetails=1`;
  let resp;
  try{
    resp=await fetchWithRetry(url,{headers:{'User-Agent':'EcoPath/1.0 (demo app)'}},{retries:1,timeoutMs:8000});
  }catch(err){
    throw new Error(`Could not reach location service: ${err.message}`);
  }
  const data=await resp.json();
  if(!data||data.length===0) throw new Error(`Location not found: "${query}"`);
  return{lat:parseFloat(data[0].lat),lon:parseFloat(data[0].lon),name:data[0].display_name};
}

// Get route from OSRM (Open Source Routing Machine — free, no key).
// Same caveat as above: the public demo server is rate-limited and not
// intended for production load.
async function getOSRMRoute(fromCoords,toCoords,profile='driving'){
  const url=`https://router.project-osrm.org/route/v1/${profile}/${fromCoords.lon},${fromCoords.lat};${toCoords.lon},${toCoords.lat}?overview=full&geometries=geojson`;
  let resp;
  try{
    resp=await fetchWithRetry(url,{},{retries:1,timeoutMs:8000});
  }catch(err){
    throw new Error(`Could not reach routing service: ${err.message}`);
  }
  const data=await resp.json();
  if(data.code!=='Ok'||!data.routes||data.routes.length===0) throw new Error('Route not found between these locations');
  return{
    distKm:+(data.routes[0].distance/1000).toFixed(2),
    durationMin:Math.round(data.routes[0].duration/60),
    geometry:data.routes[0].geometry.coordinates // [[lon,lat],...]
  };
}

function renderPlanner(){
  const livePanelHTML=liveTrip?buildLiveTripPanel():'';
  document.getElementById('app-planner').innerHTML=`
  <div class="page-header">
    <div>
      <h1 class="page-title">Route Planner</h1>
      <p class="page-sub">Find the most efficient, eco-friendly route with live GPS tracking</p>
    </div>
  </div>
  ${livePanelHTML}
  <div class="planner-grid">
    <!-- LEFT: Form card -->
    <div class="route-form-card">
      <div class="route-form-title">Plan Your Route</div>
      <div class="route-input-group">
        <div class="route-input-wrapper">
          <span class="route-input-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/><circle cx="12" cy="9" r="2.5"/></svg>
          </span>
          <label for="p-from" class="sr-only">From location</label>
          <input class="route-field" type="text" id="p-from" placeholder="From: e.g. London Bridge" autocomplete="off">
        </div>
        <div class="route-divider">
          <div class="route-divider-line"></div>
          <div class="route-divider-dot"></div>
          <div class="route-divider-line"></div>
        </div>
        <div class="route-input-wrapper">
          <span class="route-input-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          </span>
          <label for="p-to" class="sr-only">To location</label>
          <input class="route-field" type="text" id="p-to" placeholder="To: e.g. Canary Wharf" autocomplete="off">
        </div>
      </div>
      <button class="btn-plan-route" id="plan-route-btn" onclick="doPlanRoute()">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        Plan Route
      </button>
      <div id="route-status-box" style="display:none" class="route-status">
        <div class="route-status-dot"></div>
        <span id="route-status-text">Finding route...</span>
      </div>
    </div>

    <!-- RIGHT: Leaflet map -->
    <div class="map-wrapper">
      <div class="map-loading-overlay" id="map-loading">
        <div class="map-loading-spinner"></div>
        <span style="font-size:13px;color:var(--gray5);font-family:var(--mono)">Loading map...</span>
      </div>
      <div id="leaflet-map"></div>
    </div>
  </div>
  <div id="planner-results"></div>`;

  // Initialize map after DOM is ready
  setTimeout(initPlannerMap, 50);
}

function initPlannerMap(){
  const el=document.getElementById('leaflet-map');
  if(!el) return;

  // Destroy existing map
  if(plannerMap){plannerMap.remove();plannerMap=null;routePolyline=null;fromMarker=null;toMarker=null;liveGPSMarker=null;}

  const defaultCenter=[12.9716,77.5946]; // Bengaluru

  plannerMap=L.map('leaflet-map',{center:defaultCenter,zoom:12,zoomControl:true});
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{
    attribution:'© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom:19
  }).addTo(plannerMap);

  // Hide loading overlay once tiles load
  plannerMap.on('load',()=>{hideMapLoading();});
  setTimeout(hideMapLoading,2000);

  // Try to center on user's location
  if(navigator.geolocation){
    navigator.geolocation.getCurrentPosition(pos=>{
      if(plannerMap) plannerMap.setView([pos.coords.latitude,pos.coords.longitude],13);
      gpsAvailable=true;
    },()=>{gpsAvailable=false;});
  }
}

function hideMapLoading(){
  const lo=document.getElementById('map-loading');
  if(lo) lo.style.display='none';
}

// Custom map markers
function makeMarker(color,label){
  return L.divIcon({
    className:'',
    html:`<div style="width:34px;height:34px;background:${color};border-radius:50% 50% 50% 0;transform:rotate(-45deg);border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.3);display:flex;align-items:center;justify-content:center">
      <span style="transform:rotate(45deg);font-size:13px;color:#fff;font-weight:800;font-family:monospace">${label}</span>
    </div>`,
    iconSize:[34,34],
    iconAnchor:[17,34],
    popupAnchor:[0,-34]
  });
}

function makeLiveMarker(){
  return L.divIcon({
    className:'',
    html:`<div style="width:18px;height:18px;background:var(--blue,#1d4ed8);border-radius:50%;border:3px solid #fff;box-shadow:0 0 0 4px rgba(29,78,216,.3);animation:gps-pulse 1.5s infinite"></div>
    <style>@keyframes gps-pulse{0%,100%{box-shadow:0 0 0 4px rgba(29,78,216,.3)}50%{box-shadow:0 0 0 8px rgba(29,78,216,.1)}}</style>`,
    iconSize:[18,18],
    iconAnchor:[9,9]
  });
}

async function doPlanRoute(){
  const from=document.getElementById('p-from').value.trim();
  const to=document.getElementById('p-to').value.trim();
  if(!from||!to){toast('Please enter both From and To locations');return;}

  const btn=document.getElementById('plan-route-btn');
  const statusBox=document.getElementById('route-status-box');
  const statusText=document.getElementById('route-status-text');

  btn.disabled=true;btn.textContent='Searching...';
  statusBox.style.display='flex';statusText.textContent='Geocoding locations...';
  statusBox.className='route-status';

  try{
    // Geocode
    statusText.textContent='Finding locations on map...';
    const [fromCoords,toCoords]=await Promise.all([geocodeAddress(from),geocodeAddress(to)]);

    // Get route
    statusText.textContent='Calculating optimal route...';
    const route=await getOSRMRoute(fromCoords,toCoords,'driving');
    const dist=route.distKm;
    plannedRoute={from,to,fromCoords,toCoords,dist,durationMin:route.durationMin};

    // Draw on map
    drawRouteOnMap(fromCoords,toCoords,route.geometry,from,to,dist);

    statusText.textContent=`Route found: ${dist} km · ~${route.durationMin} min`;

    // Build mode options
    plannerLogged=null;
    const options=MODES.map(m=>{
      const co2E=+(dist*m.co2/1000).toFixed(3);
      const co2Car=+(dist*192/1000).toFixed(3);
      const saved=+(Math.max(0,co2Car-co2E)).toFixed(3);
      let pts=Math.round((saved*1000/500)*20);
      if(m.id==='bike'||m.id==='walk') pts+=Math.round(dist*10);
      if(m.id==='bus'||m.id==='train') pts+=Math.round((dist/5)*20);
      pts=Math.max(10,pts);
      return{...m,co2E,saved,pts};
    });
    const bestEco=options.reduce((a,b)=>a.co2E<b.co2E?a:b);
    const bestOverall=options.find(m=>['bike','train','bus'].includes(m.id))||bestEco;

    document.getElementById('planner-results').innerHTML=`
    <div class="ai-analysis-box">
      <div class="ai-analysis-header"><span class="ai-chip">AI ANALYSIS</span><span class="ai-analysis-title">${escapeHtml(from)} → ${escapeHtml(to)} · ${dist} km · ~${route.durationMin} min by car</span></div>
      <div class="ai-analysis-text" id="ai-analysis-text">
        <span style="opacity:.5">Fetching AI route intelligence...</span>
      </div>
    </div>
    <h3 style="font-size:15px;font-weight:800;color:var(--gray9);margin:24px 0 16px;letter-spacing:-.2px">Transport Options — ${dist} km</h3>
    <div class="route-results">
      ${options.map(o=>`
      <div class="mode-card${o.id===bestEco.id?' best':''}${o.id===bestOverall.id&&o.id!==bestEco.id?' ai-pick':''}">
        ${o.id===bestEco.id?'<div class="best-tag">GREENEST</div>':''}
        ${o.id===bestOverall.id&&o.id!==bestEco.id?'<div class="ai-pick-tag">AI PICK</div>':''}
        <div class="mode-header">
          <div class="mode-icon-wrap" style="background:${o.bg};font-size:22px">${o.emoji}</div>
          <div><div class="mode-label">${o.label}</div><div class="mode-gco2">${o.co2} g CO₂/km</div></div>
        </div>
        <div class="mode-stats">
          <div><div class="mode-stat-val" style="color:var(--red)">${o.co2E} kg</div><div class="mode-stat-label">EMITTED</div></div>
          <div style="text-align:right"><div class="mode-stat-val" style="color:var(--g6)">+${o.saved} kg</div><div class="mode-stat-label">SAVED</div></div>
        </div>
        <div class="mode-pts-box">+${o.pts} EcoCredits</div>
        <button class="btn-log btn-log-ready" id="btn-${o.id}" onclick="doLogTrip('${o.id}')">Log Trip</button>
        <button class="btn-start-trip" onclick="startLiveTrip('${o.id}')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16 10 8"/></svg>
          Start Live Trip
        </button>
      </div>`).join('')}
    </div>`;

    // Async AI analysis
    fetchAIRouteAnalysis(from,to,dist,options,bestEco,bestOverall);

  }catch(err){
    statusBox.className='route-status error';
    statusText.textContent=err.message||'Could not calculate route. Check locations and try again.';
    toast('Route error: '+err.message);
  }finally{
    btn.disabled=false;
    btn.innerHTML=`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="16" height="16"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg> Plan Route`;
  }
}

function drawRouteOnMap(fromCoords,toCoords,geometry,fromLabel,toLabel,distKm){
  if(!plannerMap) return;

  // Clear old layers
  if(routePolyline){plannerMap.removeLayer(routePolyline);routePolyline=null;}
  if(fromMarker){plannerMap.removeLayer(fromMarker);fromMarker=null;}
  if(toMarker){plannerMap.removeLayer(toMarker);toMarker=null;}

  // Draw route (geometry is [[lon,lat],...])
  const latlngs=geometry.map(c=>[c[1],c[0]]);
  routePolyline=L.polyline(latlngs,{color:'#166534',weight:5,opacity:.85,lineCap:'round',lineJoin:'round'}).addTo(plannerMap);

  // Add subtle shadow underneath
  L.polyline(latlngs,{color:'rgba(0,0,0,.15)',weight:8,opacity:.5,lineCap:'round',lineJoin:'round'}).addTo(plannerMap).bringToBack();

  // Markers
  fromMarker=L.marker([fromCoords.lat,fromCoords.lon],{icon:makeMarker('#166534','A')}).addTo(plannerMap).bindPopup(`<strong>From:</strong><br>${escapeHtml(fromLabel)}`);
  toMarker=L.marker([toCoords.lat,toCoords.lon],{icon:makeMarker('#dc2626','B')}).addTo(plannerMap).bindPopup(`<strong>To:</strong><br>${escapeHtml(toLabel)}<br><span style="color:var(--g6);font-weight:700">${distKm} km</span>`);

  // Fit bounds
  plannerMap.fitBounds(routePolyline.getBounds(),{padding:[40,40]});
}

async function fetchAIRouteAnalysis(from,to,dist,options,bestEco,bestOverall){
  const el=document.getElementById('ai-analysis-text');
  if(!el) return;
  try{
    const resp=await fetch('https://api.anthropic.com/v1/messages',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        model:'claude-sonnet-4-20250514',
        max_tokens:400,
        system:'You are EcoPath AI route analyser. Give a concise 3-4 sentence analysis covering: (1) greenest transport option and why, (2) best option balancing time and carbon, (3) a practical tip for this specific route. Be specific with numbers. No emojis. Use **bold** for key numbers.',
        messages:[{role:'user',content:`Route: ${from} to ${to}, ${dist} km. Options: Walking (0 kg CO2), Cycling (${(dist*21/1000).toFixed(2)} kg), Train (${(dist*41/1000).toFixed(2)} kg), Bus (${(dist*89/1000).toFixed(2)} kg), Car (${(dist*192/1000).toFixed(2)} kg). Analysis?`}]
      })
    });
    const data=await resp.json();
    const text=data.content?.map(b=>b.text||'').join('')||null;
    if(text&&el) el.innerHTML=text.replace(/\*\*(.*?)\*\*/g,'<strong>$1</strong>');
  }catch(e){
    if(el) el.innerHTML=`For <strong>${dist} km</strong> from ${from} to ${to}: cycling produces zero direct emissions and earns the most EcoCredits (+${Math.round(dist*10)} from distance alone). If cycling isn't feasible, Metro/Train is the AI-recommended choice, cutting emissions by <strong>${Math.round((1-(41/192))*100)}%</strong> vs driving. Off-peak travel (before 8 AM or after 7 PM) avoids congestion and earns a +10 low-congestion bonus.`;
  }
}

function doLogTrip(modeId){
  if(plannerLogged)return;
  if(!plannedRoute){toast('Plan a route first');return;}
  plannerLogged=modeId;
  const{from,to,dist}=plannedRoute;
  const res=logTrip(from,to,dist,modeId);
  MODES.forEach(m=>{
    const btn=document.getElementById('btn-'+m.id);
    if(!btn)return;
    if(m.id===modeId){btn.textContent='✓ Logged';btn.className='btn-log btn-log-done';}
    else{btn.className='btn-log btn-log-used';}
  });
  toast(`Trip logged! +${res.pts} EcoCredits · ${res.saved.toFixed(3)} kg CO₂ saved`);
}

// ── LIVE TRIP ──
function buildLiveTripPanel(){
  const mode=MODES.find(m=>m.id===liveTrip.modeId)||{};
  return`
  <div class="live-trip-panel" id="live-trip-panel">
    <div class="live-header">
      <div>
        <div class="live-title">${mode.emoji||''} Active Trip — ${mode.label||'Live'}</div>
        <div class="live-gps-badge">${gpsWatchId?'📡 GPS ACTIVE':'⏱ SIMULATED'}</div>
      </div>
      <div class="live-indicator"><div class="pulse-dot"></div> LIVE</div>
    </div>
    <div class="live-stats-row">
      <div class="live-stat"><div class="live-stat-val" id="live-km">${(liveTrip.km).toFixed(2)}</div><div class="live-stat-label">KM TRAVELED</div></div>
      <div class="live-stat"><div class="live-stat-val" id="live-time">${fmtTime(liveTrip.elapsed)}</div><div class="live-stat-label">ELAPSED</div></div>
      <div class="live-stat"><div class="live-stat-val" id="live-co2" style="color:var(--g6)">${calcCO2Saved(liveTrip.km,liveTrip.modeId).toFixed(3)}</div><div class="live-stat-label">KG CO₂ SAVED</div></div>
      <div class="live-stat"><div class="live-stat-val" id="live-credits" style="color:var(--amber)">${liveTrip.creditsEarned}</div><div class="live-stat-label">CREDITS</div></div>
    </div>
    <div style="display:flex;gap:10px;align-items:center">
      <button class="btn-end-trip" onclick="endLiveTrip()">End Trip & Log</button>
      <span style="font-size:12px;color:var(--gray4);font-family:var(--mono)">${escapeHtml(liveTrip.from)} → ${escapeHtml(liveTrip.to)}</span>
    </div>
  </div>`;
}

function calcCO2Saved(km,modeId){
  const mode=MODES.find(m=>m.id===modeId)||{co2:0};
  return Math.max(0,km*0.001*(192-mode.co2));
}

function fmtTime(sec){
  const m=Math.floor(sec/60).toString().padStart(2,'0');
  const s=(sec%60).toString().padStart(2,'0');
  return `${m}:${s}`;
}

function startLiveTrip(modeId){
  if(liveTrip){toast('A trip is already in progress');return;}
  if(!plannedRoute){toast('Plan a route first');return;}
  const{from,to,dist:distKm}=plannedRoute;
  gpsDistKm=0;lastGPSPos=null;
  liveTrip={from,to,distKm,modeId,elapsed:0,km:0,creditsEarned:0,startTime:Date.now()};
  
  // Start GPS tracking (real device movement)
  startGPSWatch(modeId);
  
  // Fallback simulation tick
  liveTripInterval=setInterval(tickLiveTrip,1000);
  
  toast(`Live trip started! ${MODES.find(m=>m.id===modeId)?.emoji||''} Move forward — GPS measures real distance`);
  showApp('planner');
}

function startGPSWatch(modeId){
  if(!navigator.geolocation){return;}
  try{
    gpsWatchId=navigator.geolocation.watchPosition(
      pos=>{
        const{latitude:lat,longitude:lon}=pos.coords;
        if(lastGPSPos){
          const d=haversineKm(lastGPSPos.lat,lastGPSPos.lon,lat,lon);
          // Only count movement > 5 meters to filter noise
          if(d>0.005){
            gpsDistKm+=d;
            if(liveTrip){
              liveTrip.km=gpsDistKm;
              updateLiveTripUI();
            }
          }
        }
        lastGPSPos={lat,lon};
        // Update live marker on map
        if(plannerMap){
          if(!liveGPSMarker){
            liveGPSMarker=L.marker([lat,lon],{icon:makeLiveMarker(),zIndexOffset:1000}).addTo(plannerMap);
          } else {
            liveGPSMarker.setLatLng([lat,lon]);
          }
          plannerMap.panTo([lat,lon],{animate:true,duration:0.5});
        }
      },
      err=>{
        // GPS failed silently — simulation handles it
        gpsWatchId=null;
        const panel=document.getElementById('live-trip-panel');
        if(panel){const b=panel.querySelector('.live-gps-badge');if(b)b.textContent='⏱ SIMULATED';}
      },
      {enableHighAccuracy:true,maximumAge:3000,timeout:10000}
    );
  }catch(e){gpsWatchId=null;}
}

function tickLiveTrip(){
  if(!liveTrip)return;
  liveTrip.elapsed++;
  // If GPS is tracking real distance, don't simulate
  if(!gpsWatchId||gpsDistKm===0){
    const speed={'walk':4,'bike':14,'ebike':20,'bus':22,'train':35,'carpool':38,'ev':40,'car':45}[liveTrip.modeId]||15;
    liveTrip.km=Math.min(liveTrip.distKm,+(liveTrip.elapsed*(speed/3600)).toFixed(4));
  }
  updateLiveTripUI();
}

function updateLiveTripUI(){
  if(!liveTrip) return;
  const co2Saved=calcCO2Saved(liveTrip.km,liveTrip.modeId);
  const mode=MODES.find(m=>m.id===liveTrip.modeId)||{co2:0};
  let credits=Math.floor(co2Saved*(1000/500)*20);
  if(liveTrip.modeId==='bike'||liveTrip.modeId==='walk') credits+=Math.floor(liveTrip.km*10);
  liveTrip.creditsEarned=credits;

  const el=id=>document.getElementById(id);
  if(el('live-km')) el('live-km').textContent=liveTrip.km.toFixed(2);
  if(el('live-time')) el('live-time').textContent=fmtTime(liveTrip.elapsed);
  if(el('live-co2')) el('live-co2').textContent=co2Saved.toFixed(3);
  if(el('live-credits')) el('live-credits').textContent=liveTrip.creditsEarned;
}

function endLiveTrip(){
  if(!liveTrip)return;
  clearInterval(liveTripInterval);
  if(gpsWatchId){navigator.geolocation.clearWatch(gpsWatchId);gpsWatchId=null;}
  if(liveGPSMarker&&plannerMap){plannerMap.removeLayer(liveGPSMarker);liveGPSMarker=null;}
  const finalDist=Math.max(liveTrip.km,0.01);
  const res=logTrip(liveTrip.from,liveTrip.to,finalDist,liveTrip.modeId);
  toast(`Trip complete! +${res.pts} EcoCredits · ${res.saved.toFixed(3)} kg CO₂ saved`);
  liveTrip=null;liveTripInterval=null;gpsDistKm=0;lastGPSPos=null;
  showApp('planner');
}

// ══════════════════════════════════════════
//  CARBON TRACKER
// ══════════════════════════════════════════
function renderTracker(){
  document.getElementById('app-tracker').innerHTML=`
  <div class="page-header">
    <div><h1 class="page-title">Carbon Tracker</h1><p class="page-sub">Your complete carbon impact history</p></div>
  </div>
  <div class="tracker-stats">
    <div class="stat-card"><div class="stat-header"><span class="stat-label">CO2 SAVED</span><div class="stat-icon-box" style="background:#dcfce7"><svg viewBox="0 0 24 24" fill="none" stroke="#16a34a" stroke-width="2"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg></div></div><div class="stat-value" style="color:var(--g6)">${state.co2Saved.toFixed(2)}</div><div class="stat-unit">kg saved</div></div>
    <div class="stat-card"><div class="stat-header"><span class="stat-label">CO2 EMITTED</span><div class="stat-icon-box" style="background:#fee2e2"><svg viewBox="0 0 24 24" fill="none" stroke="#dc2626" stroke-width="2"><path d="M8 2c0 0-2 5.5-2 9a6 6 0 0012 0c0-3.5-2-9-2-9"/><path d="M12 2v10"/></svg></div></div><div class="stat-value" style="color:var(--red)">${state.co2Emitted.toFixed(2)}</div><div class="stat-unit">kg emitted</div></div>
    <div class="stat-card"><div class="stat-header"><span class="stat-label">ECOCREDITS</span><div class="stat-icon-box" style="background:#fef3c7"><svg viewBox="0 0 24 24" fill="none" stroke="#b45309" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg></div></div><div class="stat-value" style="color:var(--amber)">${state.ecoPoints.toLocaleString()}</div><div class="stat-unit">total credits</div></div>
    <div class="stat-card"><div class="stat-header"><span class="stat-label">TRIPS</span><div class="stat-icon-box" style="background:#dbeafe"><svg viewBox="0 0 24 24" fill="none" stroke="#1d4ed8" stroke-width="2"><path d="M3 12h18M3 6h18M3 18h18"/></svg></div></div><div class="stat-value" style="color:var(--blue)">${state.totalTrips}</div><div class="stat-unit">logged</div></div>
  </div>
  ${state.trips.length===0?`<div class="card"><div class="empty-state" style="padding:56px"><div class="empty-icon" style="width:56px;height:56px"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" stroke-width="2"><path d="M3 12h18M3 6h18M3 18h18"/></svg></div><p style="font-size:15px;font-weight:700;color:var(--gray7);margin-top:8px">No trips logged yet</p><p>Start by planning a route</p></div></div>`:
  `<div class="card" style="padding:0;overflow:hidden">
    <div style="padding:16px 22px;border-bottom:1px solid var(--gray2);display:flex;justify-content:space-between;align-items:center">
      <div class="card-title" style="margin:0">Trip History</div>
      <div style="font-size:11px;color:var(--gray4);font-family:var(--mono)">${state.totalTrips} trips · ${state.totalKm.toFixed(1)} km total</div>
    </div>
    <div style="overflow-x:auto">
      <table>
        <thead><tr><th>MODE</th><th>ROUTE</th><th>DIST</th><th>CO2 SAVED</th><th>CO2 EMITTED</th><th>CREDITS</th><th>DATE</th></tr></thead>
        <tbody>
          ${[...state.trips].reverse().map(t=>{
            const m=MODES.find(x=>x.id===t.mode);
            return`<tr>
              <td><div class="mode-tag" style="background:${m.bg};color:${m.color}">${m.emoji} ${m.label}</div></td>
              <td>${escapeHtml(t.from)} → ${escapeHtml(t.to)}</td>
              <td style="font-family:var(--mono)">${t.distKm.toFixed(2)} km</td>
              <td style="color:var(--g6);font-weight:700;font-family:var(--mono)">${t.co2Saved.toFixed(3)} kg</td>
              <td style="color:var(--red);font-family:var(--mono)">${t.co2Emitted.toFixed(3)} kg</td>
              <td style="color:var(--amber);font-weight:700;font-family:var(--mono)">+${t.pts}</td>
              <td style="color:var(--gray4);font-family:var(--mono)">${new Date(t.date).toLocaleDateString()}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>
  </div>`}`;
}

// ══════════════════════════════════════════
//  ECO COACH — WORKING AI CHATBOT
// ══════════════════════════════════════════
let coachMessages=[];
const SUGGESTIONS=[
  "What's the most eco-friendly way to commute in Bengaluru?",
  "How much CO₂ can I save by cycling instead of driving 10 km?",
  "What transport mode do you recommend for a 15 km commute?",
  "How do I earn more EcoCredits faster?",
  "Predict pollution on a morning bus route vs cycling",
  "What's the carbon footprint of taking the metro vs car for a week?",
];

function renderCoach(){
  coachMessages=[];
  document.getElementById('app-coach').innerHTML=`
  <div class="page-header">
    <div><h1 class="page-title">Eco Coach</h1><p class="page-sub">AI-powered green commuting advisor — powered by Claude</p></div>
  </div>
  <div class="coach-wrap">
    <div class="coach-card">
      <div class="coach-header">
        <div class="coach-avatar"><svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M20 20c0-4.42-3.58-8-8-8s-8 3.58-8 8"/></svg></div>
        <div>
          <div class="coach-name">Eco Coach</div>
          <div class="coach-status"><span class="status-dot"></span> AI-assisted · falls back to built-in tips if offline</div>
        </div>
        <div style="margin-left:auto;font-size:11px;color:var(--gray4);font-family:var(--mono);text-align:right">
          <div>${state.ecoPoints.toLocaleString()} credits</div>
          <div>${state.co2Saved.toFixed(1)} kg CO₂ saved</div>
        </div>
      </div>
      <div class="coach-messages" id="coach-msgs">
        <div class="msg-row">
          <div class="msg-ai-avatar"><svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M20 20c0-4.42-3.58-8-8-8s-8 3.58-8 8"/></svg></div>
          <div class="msg-bubble ai">Hi ${escapeHtml(state.user.name)}! 👋 I'm your Eco Coach, powered by Claude AI. I can help you with carbon calculations, route recommendations, traffic predictions, and tips to maximise your EcoCredits.<br><br>What would you like to know?</div>
        </div>
        <div>
          <div style="font-size:11px;color:var(--gray4);font-family:var(--mono);margin-bottom:8px;margin-left:40px">SUGGESTED QUESTIONS:</div>
          <div class="suggestions" id="coach-suggestions" style="margin-left:40px">
            ${SUGGESTIONS.map((s,i)=>`<button class="suggestion-btn" onclick="coachSend(this,'${s.replace(/'/g,"\\'")}')">${s}</button>`).join('')}
          </div>
        </div>
      </div>
      <div class="coach-input-row">
        <input class="coach-input" id="coach-input" placeholder="Ask about carbon, routes, EcoCredits, or eco transport..." onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();coachSendInput();}">
        <button class="send-btn ready" id="send-btn" onclick="coachSendInput()">
          <svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
        </button>
      </div>
    </div>
  </div>`;
}

async function coachSend(btnEl,text){
  if(btnEl){
    const suggestionsEl=document.getElementById('coach-suggestions');
    if(suggestionsEl) suggestionsEl.style.display='none';
  }
  if(!text.trim())return;
  document.getElementById('coach-input').value='';
  addMsg('user',text);
  coachMessages.push({role:'user',content:text});
  showTyping();
  const sendBtn=document.getElementById('send-btn');
  if(sendBtn){sendBtn.className='send-btn disabled';sendBtn.disabled=true;}

  try{
    const resp=await fetch('https://api.anthropic.com/v1/messages',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        model:'claude-sonnet-4-20250514',
        max_tokens:800,
        system:`You are EcoPath's AI Eco Coach. The user is ${state.user.name} with ${state.ecoPoints} EcoCredits, ${state.co2Saved.toFixed(1)} kg CO2 saved, and ${state.totalTrips} trips logged. You: (1) calculate precise carbon footprints for routes and journeys, (2) recommend the greenest and most efficient routes with specific data, (3) predict traffic and pollution windows, (4) explain EcoCredits system: 1km cycling=10 credits, 1km walking=10 credits, 5km bus=20 credits, 500g CO2 saved=20 credits, bonus +10 each for shortest/low-congestion/shared routes. Reference the user's actual stats when relevant. Be specific, data-driven, practical, and encouraging. Use **bold** for key numbers and data points. Keep responses concise (under 200 words).`,
        messages:coachMessages
      })
    });
    const data=await resp.json();
    if(data.error){throw new Error(data.error.message||'API error');}
    const reply=data.content?.map(b=>b.text||'').join('')||'Sorry, no response received.';
    hideTyping();
    addMsg('ai',reply);
    coachMessages.push({role:'assistant',content:reply});
  }catch(e){
    hideTyping();
    // Smart fallback answers based on keywords
    const fallback=getSmartFallback(text);
    addMsg('ai',fallback);
    coachMessages.push({role:'assistant',content:fallback});
  }finally{
    if(sendBtn){sendBtn.className='send-btn ready';sendBtn.disabled=false;}
  }
}

// Smart offline fallback for common eco questions
function getSmartFallback(question){
  const q=question.toLowerCase();
  if(q.includes('cycling')||q.includes('cycle')||q.includes('bike')){
    return`**Cycling is the greenest motor-assisted option.** For a typical 10 km commute, cycling emits only **0.21 kg CO₂** vs **1.92 kg** by car — a saving of **89%**. In EcoPath terms, that earns you **100+ EcoCredits** per trip: 10 per km cycled plus 20 credits per 500g CO₂ saved. Over a 5-day week, that's roughly **500 credits** — enough for a discount coupon!`;
  }
  if(q.includes('metro')||q.includes('train')||q.includes('transit')){
    return`**Metro/Train is excellent for longer distances.** At **41 g CO₂/km**, it emits **78% less** than driving. For a 15 km commute, metro produces **0.62 kg CO₂** vs **2.88 kg** by car, saving **2.26 kg** and earning roughly **90 EcoCredits**. Pro tip: travel off-peak (before 8 AM or after 7 PM) to earn the **+10 low-congestion bonus**.`;
  }
  if(q.includes('credit')||q.includes('points')||q.includes('earn')){
    return`**EcoCredits system:**\n• 🚲 Cycling: **+10 credits/km**\n• 🚌 Bus: **+20 credits per 5 km**\n• 🌿 CO₂ saved: **+20 credits per 500g**\n• 📍 Shortest route bonus: **+10 credits**\n• ✅ Low congestion bonus: **+10 credits**\n• 🤝 Shared transport bonus: **+10 credits**\n\nEvery **300 credits** unlocks a discount coupon. You currently have **${state.ecoPoints.toLocaleString()} credits** — ${300-(state.ecoPoints%300)} more until your next coupon!`;
  }
  if(q.includes('bus')){
    return`**Bus is a practical low-carbon choice.** At **89 g CO₂/km**, it emits **54% less** than a private car. For a 10 km bus trip you save roughly **1.03 kg CO₂** and earn **~60 EcoCredits** (distance + CO₂ bonus). Taking shared routes earns an extra **+10 bonus**. Buses shine for medium-distance trips where cycling isn't feasible.`;
  }
  if(q.includes('pollution')||q.includes('air quality')||q.includes('traffic')){
    return`**Traffic and pollution peaks** in Bengaluru typically occur 8–10 AM and 5–8 PM on weekdays. Cycling or walking during these windows actually exposes you to **less exhaust** than sitting in a car in traffic. Metro is the cleanest option during rush hour — underground tunnels filter most particulates. Departing before 8 AM or after 7 PM earns the **low-congestion +10 bonus** on EcoPath.`;
  }
  return`**EcoPath Eco Coach here!** I can help with:\n• Carbon footprint calculations for any route\n• Transport mode comparisons with specific CO₂ data\n• EcoCredits earning strategies\n• Traffic and pollution predictions\n• Route recommendations for Bengaluru\n\nYou've already saved **${state.co2Saved.toFixed(1)} kg CO₂** across ${state.totalTrips} trips — great work! Ask me anything about making your commute greener.`;
}

function coachSendInput(){
  const val=document.getElementById('coach-input').value.trim();
  if(val) coachSend(null,val);
}

function addMsg(role,text){
  const msgs=document.getElementById('coach-msgs');
  if(!msgs) return;
  const row=document.createElement('div');
  row.className='msg-row'+(role==='user'?' user':'');
  if(role==='ai'){
    row.innerHTML=`<div class="msg-ai-avatar"><svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M20 20c0-4.42-3.58-8-8-8s-8 3.58-8 8"/></svg></div><div class="msg-bubble ai">${text.replace(/\n/g,'<br>').replace(/\*\*(.*?)\*\*/g,'<strong>$1</strong>')}</div>`;
  } else {
    row.innerHTML=`<div class="msg-bubble user">${escapeHtml(text)}</div>`;
  }
  msgs.appendChild(row);msgs.scrollTop=msgs.scrollHeight;
}

let typingEl=null;
function showTyping(){
  const msgs=document.getElementById('coach-msgs');
  if(!msgs) return;
  typingEl=document.createElement('div');typingEl.className='msg-row';
  typingEl.innerHTML=`<div class="msg-ai-avatar"><svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M20 20c0-4.42-3.58-8-8-8s-8 3.58-8 8"/></svg></div><div class="msg-bubble ai" style="padding:0"><div class="typing"><span></span><span></span><span></span></div></div>`;
  msgs.appendChild(typingEl);msgs.scrollTop=msgs.scrollHeight;
}
function hideTyping(){if(typingEl){typingEl.remove();typingEl=null;}}

// ══════════════════════════════════════════
//  COMMUNITY
// ══════════════════════════════════════════
function renderCommunity(){
  const nextCouponAt=Math.ceil(state.ecoPoints/300)*300;
  const creditsLeft=nextCouponAt-state.ecoPoints;
  const pct=Math.min(100,Math.round(((300-creditsLeft%300)/300)*100));
  const activeCoupons=state.coupons.filter(c=>!c.redeemed);
  document.getElementById('app-community').innerHTML=`
  <div class="page-header">
    <div><h1 class="page-title">Community</h1><p class="page-sub">EcoCredits rules, live activity, and your coupons</p></div>
  </div>
  ${activeCoupons.length>0?`
  <div class="coupon-banner" style="margin-bottom:24px">
    <div class="coupon-title">Your Coupons 🎉</div>
    <div class="coupon-sub">You have ${activeCoupons.length} active coupon(s). Use for discounts on eco transport partners.</div>
    ${activeCoupons.map(c=>`<div class="coupon-code" style="margin-right:8px;margin-bottom:8px;display:inline-block">${c.code}</div>`).join('')}
    <br><button class="btn-copy" style="margin-top:12px" onclick="toast('Code copied!')">Copy Latest</button>
  </div>`:`
  <div class="coupon-banner" style="margin-bottom:24px">
    <div class="coupon-title">Earn a Coupon</div>
    <div class="coupon-sub">Every 300 EcoCredits unlocks a discount coupon. You need ${creditsLeft} more credits.</div>
    <div class="coupon-progress-bar"><div class="coupon-progress-fill" style="width:${pct}%"></div></div>
    <div class="coupon-progress-text" style="margin-top:8px">${pct}% — ${creditsLeft} credits remaining</div>
  </div>`}
  <div class="community-section">
    <div class="section-title">How to Earn EcoCredits</div>
    <div class="credit-rules">
      ${CREDIT_RULES.map(r=>`<div class="credit-rule"><div class="credit-rule-icon" style="background:${r.bg};font-size:20px">${r.icon}</div><div class="credit-rule-label">${r.label}</div><div class="credit-rule-pts">+${r.pts} credits</div></div>`).join('')}
    </div>
  </div>
  <div class="community-grid">
    <div class="card">
      <div class="card-title">Live Community Activity</div>
      ${COMMUNITY_FEED.map(f=>`<div class="feed-item"><div class="feed-avatar">${f.initials}</div><div><div class="feed-text"><strong>${f.name}</strong> ${f.action}</div><div class="feed-time">${f.time}</div><div class="feed-pts">${f.pts}</div></div></div>`).join('')}
    </div>
    <div class="card">
      <div class="card-title">Leaderboard</div>
      ${[...LEADERBOARD,{name:'You',pts:state.ecoPoints,badges:state.earnedBadges.length,isYou:true}].sort((a,b)=>b.pts-a.pts).map((u,i)=>`
      <div class="feed-item" style="${u.isYou?'background:var(--g0);border-radius:8px;padding:8px 10px;margin:0 -10px':''}">
        <div style="width:28px;text-align:center;font-size:13px;font-weight:800;color:var(--gray5);font-family:var(--mono);flex-shrink:0">${i<3?['01','02','03'][i]:'#'+(i+1)}</div>
        <div style="flex:1;margin-left:10px">
          <div style="font-size:13px;font-weight:700;color:${u.isYou?'var(--g6)':'var(--gray8)'}">${u.name}${u.isYou?' (You)':''}</div>
          <div style="font-size:11px;color:var(--gray4);font-family:var(--mono)">${u.badges} badges</div>
        </div>
        <div style="font-size:14px;font-weight:800;color:var(--amber);font-family:var(--mono)">${u.pts.toLocaleString()}</div>
      </div>`).join('')}
    </div>
  </div>`;
}

// ══════════════════════════════════════════
//  ACHIEVEMENTS
// ══════════════════════════════════════════
let achTab='badges';
function renderAchievements(){
  const lv=getLevel(state.ecoPoints);
  const pct=levelPct(state.ecoPoints);
  document.getElementById('app-achievements').innerHTML=`
  <div class="page-header">
    <div><h1 class="page-title">Achievements</h1><p class="page-sub">Earn badges and climb the leaderboard</p></div>
  </div>
  <div class="ach-summary">
    <div class="ach-stats">
      <div class="ach-stat">
        <div class="ach-level-circle">${lv.n}</div>
        <div style="font-size:10px;color:var(--gray5);font-weight:700;letter-spacing:.8px;font-family:var(--mono)">LEVEL</div>
        <div style="font-size:13px;font-weight:700;margin-top:3px">${lv.title}</div>
      </div>
      <div class="ach-stat">
        <div class="ach-stat-val" style="color:var(--amber)">${state.ecoPoints.toLocaleString()}</div>
        <div class="ach-stat-label">ECOCREDITS</div>
      </div>
      <div class="ach-stat">
        <div class="ach-stat-val" style="color:var(--red)">${state.streak}</div>
        <div class="ach-stat-label">DAY STREAK</div>
      </div>
      <div class="ach-stat">
        <div class="ach-stat-val">${state.earnedBadges.length}/${BADGES.length}</div>
        <div class="ach-stat-label">BADGES</div>
      </div>
    </div>
    <div>
      <div style="display:flex;justify-content:space-between;margin-bottom:8px">
        <span style="font-size:12px;font-weight:700;color:var(--gray7)">Level ${lv.n} Progress</span>
        <span style="font-size:12px;color:var(--gray5);font-family:var(--mono)">${state.ecoPoints.toLocaleString()} pts</span>
      </div>
      <div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>
    </div>
  </div>
  <div class="tabs">
    <button class="tab ${achTab==='badges'?'active':''}" onclick="switchAchTab('badges')">Badges</button>
    <button class="tab ${achTab==='leaderboard'?'active':''}" onclick="switchAchTab('leaderboard')">Leaderboard</button>
  </div>
  <div id="ach-content">${achTab==='badges'?renderBadges():renderLeaderboard()}</div>
  <div style="text-align:center;margin-top:28px">
    <button class="btn-ghost-danger" onclick="if(confirm('Reset all saved EcoPath progress? This cannot be undone.'))resetState()" style="background:transparent;border:1px solid var(--gray3);color:var(--gray5);padding:8px 18px;border-radius:8px;font-size:12px;font-weight:600">Reset saved progress</button>
  </div>`;
}
function switchAchTab(tab){
  achTab=tab;
  document.getElementById('ach-content').innerHTML=tab==='badges'?renderBadges():renderLeaderboard();
  document.querySelectorAll('.tab').forEach(t=>t.classList.toggle('active',t.textContent.toLowerCase()===tab));
}
function renderBadges(){
  return`<div class="badges-header"><h3 style="font-size:14px;font-weight:800;margin:0">Your Badges</h3><span style="font-size:12px;color:var(--gray5);font-family:var(--mono)">${state.earnedBadges.length} / ${BADGES.length} unlocked</span></div>
  <div class="badges-grid">
    ${BADGES.map(b=>{
      const earned=state.earnedBadges.includes(b.id);
      return`<div class="badge-card${earned?' earned':''}">
        <div class="badge-icon-wrap"><span style="font-size:20px">${earned?'🏅':'🔒'}</span></div>
        <div class="badge-name">${b.name}</div>
        <div class="badge-desc">${b.desc}</div>
        ${earned?`<div class="badge-earned-label">✓ EARNED</div>`:`<div class="badge-pts">+${b.pts} pts</div>`}
      </div>`;
    }).join('')}
  </div>`;
}
function renderLeaderboard(){
  const lb=[...LEADERBOARD,{name:'You',pts:state.ecoPoints,badges:state.earnedBadges.length,isYou:true}].sort((a,b)=>b.pts-a.pts);
  return`<div class="leaderboard-card">
    <div style="padding:16px 22px;border-bottom:1px solid var(--gray2)"><h3 style="font-size:14px;font-weight:800;margin:0">Global Leaderboard</h3></div>
    ${lb.map((u,i)=>`<div class="lb-row${u.isYou?' you':''}">
      <span class="lb-rank${i<3?' top':''}">${i<3?['🥇','🥈','🥉'][i]:'#'+(i+1)}</span>
      <div style="flex:1">
        <div class="lb-name${u.isYou?' you':''}">${u.name}${u.isYou?' (You)':''}</div>
        <div class="lb-badges">${u.badges} badges</div>
      </div>
      <span class="lb-pts">${u.pts.toLocaleString()}</span>
    </div>`).join('')}
  </div>`;
}

// ══════════════════════════════════════════
//  INIT
// ══════════════════════════════════════════
(function init(){
  const restored=loadState();
  updateNav();
  const avatarEl=document.getElementById('nav-avatar');
  if(avatarEl && state.user?.name) avatarEl.textContent=state.user.name[0].toUpperCase();
  // If we recovered a previous session with real activity, drop the user
  // straight back into the app instead of the landing page.
  if(restored && state.totalTrips>0){
    showPage('app');
    setTimeout(()=>toast('Welcome back — your progress was restored'),400);
  }
})();
