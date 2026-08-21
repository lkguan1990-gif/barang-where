// ============================================================
// Barang Where — application logic
// Everything here talks to a real Supabase project (auth, Postgres,
// storage, realtime). Configure your project in config.js first.
// ============================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cfg = window.NDL_CONFIG || {};
if (!cfg.SUPABASE_URL || cfg.SUPABASE_URL.includes('YOUR-PROJECT-REF')) {
  document.getElementById('bootLoader').innerHTML =
    '⚠️ Open config.js and fill in your Supabase project URL + anon key first.';
  throw new Error('Supabase not configured — see config.js');
}

const supabase = createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);

/* =========================================================
   CONSTANTS
========================================================= */
const CATEGORIES = ["Furniture","Electronics","Baby & Kids","Books","Clothing","Kitchen","Toys","Sports","Others"];
const CATEGORY_EMOJI = {
  "Furniture":"🛋️","Electronics":"📺","Baby & Kids":"🍼","Books":"📚",
  "Clothing":"👕","Kitchen":"🍳","Toys":"🧸","Sports":"🏸","Others":"📦"
};
const PALETTE = ["#C0392B","#3C6E71","#E8A93E","#4C6B8A","#7C5C3E","#6B7A3D"];
const BOOST_OPTIONS = [
  {label:"24 hours", sub:"Top of Nearby for one day", price:1.50, hours:24},
  {label:"3 days", sub:"Best for weekend decluttering", price:3.50, hours:72},
  {label:"7 days", sub:"Best value, per-day cheapest", price:6.90, hours:168}
];

/* =========================================================
   STATE
========================================================= */
let session = null;
let myGarage = null;          // row from `garages` for the current user
let myItems = [];             // this user's items
let nearbyGarages = [];       // cached nearby-fetch result (garages + nested items)
let activeCategory = "All";
let currentItemId = null;
let currentItemCache = null;  // last-opened item detail, so we don't need a refetch for send/save
let currentGarageId = null;
let itemDetailFrom = 'nearby';
let currentConversation = null;
let realtimeChannel = null;
let globalMessageChannel = null;
let currentScreen = 'nearby';
let unreadConversationIds = new Set();
let boostingItemId = null;
let selectedBoostOption = 0;
let formPhotos = [];
let savedItemIds = new Set();

/* =========================================================
   HELPERS
========================================================= */
function colorFor(id){
  let h = 0;
  for (const c of String(id)) h = (h*31 + c.charCodeAt(0)) % PALETTE.length;
  return PALETTE[Math.abs(h)];
}
function mediaFill(item){
  if (item.photos && item.photos.length) {
    return `<img src="${item.photos[0]}" style="width:100%;height:100%;object-fit:cover;display:block;">`;
  }
  return CATEGORY_EMOJI[item.category] || "📦";
}
function haversineMeters(lat1, lng1, lat2, lng2){
  if ([lat1,lng1,lat2,lng2].some(v => v === null || v === undefined)) return null;
  const R = 6371000;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2-lat1), dLng = toRad(lng2-lng1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLng/2)**2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)));
}
function toast(msg){
  const host = document.getElementById('toastHost');
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  host.appendChild(el);
  setTimeout(()=>el.remove(), 2600);
}
function esc(s){
  return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

/* =========================================================
   BOOT / AUTH ROUTING
========================================================= */
async function boot(){
  const { data: { session: s } } = await supabase.auth.getSession();
  session = s;
  supabase.auth.onAuthStateChange((_event, s2) => {
    session = s2;
    route();
  });
  await route();
}
async function route(){
  document.getElementById('bootLoader').style.display = 'none';
  document.getElementById('screen-auth').style.display = 'none';
  document.getElementById('screen-onboarding').style.display = 'none';
  document.getElementById('mainApp').style.display = 'none';

  if (!session) {
    document.getElementById('screen-auth').style.display = 'flex';
    return;
  }
  const { data: garage, error } = await supabase
    .from('garages').select('*').eq('id', session.user.id).maybeSingle();
  if (error) { toast('Could not load your garage — check your Supabase setup.'); console.error(error); return; }

  if (!garage) {
    document.getElementById('screen-onboarding').style.display = 'flex';
    return;
  }
  myGarage = garage;
  document.getElementById('mainApp').style.display = 'block';
  buildCategoryChips();
  await Promise.all([loadNearby(), loadMyItems(), loadSaved()]);
  subscribeToGlobalMessages();
  show('nearby');
}

window.sendMagicLink = async function(){
  const email = document.getElementById('authEmail').value.trim();
  const msg = document.getElementById('authMsg');
  if (!email) { msg.className='auth-msg error'; msg.textContent='Enter your email first.'; return; }
  msg.className = 'auth-msg'; msg.textContent = 'Sending…';
  const { error } = await supabase.auth.signInWithOtp({
    email, options: { emailRedirectTo: window.location.href }
  });
  if (error) { msg.className='auth-msg error'; msg.textContent = error.message; return; }
  msg.className = 'auth-msg ok';
  msg.textContent = '✓ Check your email for the magic link, then come back to this tab.';
};

window.finishOnboarding = async function(){
  const display_name = document.getElementById('obName').value.trim();
  const block = document.getElementById('obBlock').value.trim();
  const town = document.getElementById('obTown').value.trim() || (cfg.DEFAULT_TOWN || 'Sengkang');
  const msg = document.getElementById('obMsg');
  if (!display_name || !block) { msg.className='auth-msg error'; msg.textContent='Name and block are both required.'; return; }

  document.getElementById('obLocStatus').textContent = 'Requesting your location…';
  let lat = null, lng = null;
  try {
    const pos = await new Promise((res, rej) => navigator.geolocation.getCurrentPosition(res, rej, {timeout:8000}));
    // Round to ~3 decimals (~110m) so we never store a precise doorstep location.
    lat = Math.round(pos.coords.latitude * 1000) / 1000;
    lng = Math.round(pos.coords.longitude * 1000) / 1000;
  } catch (e) {
    document.getElementById('obLocStatus').textContent = 'Location unavailable — you can still list items, but distance sorting needs it. You can allow location later by refreshing.';
  }

  const { error } = await supabase.from('garages').insert({
    id: session.user.id, display_name, block, town, lat, lng
  });
  if (error) { msg.className='auth-msg error'; msg.textContent = error.message; return; }
  await route();
};

window.signOut = async function(){
  await supabase.auth.signOut();
  if (globalMessageChannel) { supabase.removeChannel(globalMessageChannel); globalMessageChannel = null; }
  unreadConversationIds.clear();
  myGarage = null; myItems = []; nearbyGarages = [];
  route();
};

/* =========================================================
   NAVIGATION
========================================================= */
window.show = function(screen){
  currentScreen = screen;
  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
  const el = document.getElementById('screen-'+screen);
  if (el) el.classList.add('active');
  document.querySelectorAll('.navbtn').forEach(b=>b.classList.remove('active'));
  const navMap = {nearby:'nearby', mygarage:'mygarage', additem:'mygarage', chats:'chats', thread:'chats',
                   profile:'profile', garage:'nearby', item:'nearby', boost:'mygarage', pro:'mygarage', liked:'profile'};
  const navKey = navMap[screen];
  document.querySelectorAll('.navbtn').forEach(b=>{ if (b.dataset.nav===navKey) b.classList.add('active'); });

  if (screen==='mygarage') renderMyGarage();
  if (screen==='additem') renderAddItemForm();
  if (screen==='chats') renderChats();
  if (screen==='profile') renderProfile();
  if (screen==='liked') renderLiked();
  if (screen !== 'thread' && realtimeChannel) { supabase.removeChannel(realtimeChannel); realtimeChannel = null; }
  updateChatBadge();
  window.scrollTo(0,0);
};
function updateChatBadge(){
  const badge = document.getElementById('chatsBadge');
  if (!badge) return;
  const count = unreadConversationIds.size;
  if (count > 0) { badge.textContent = count; badge.style.display = 'flex'; }
  else { badge.style.display = 'none'; }
}
function subscribeToGlobalMessages(){
  if (globalMessageChannel) supabase.removeChannel(globalMessageChannel);
  globalMessageChannel = supabase
    .channel('global-messages')
    .on('postgres_changes', {
      event: 'INSERT', schema: 'public', table: 'messages'
    }, (payload) => {
      const msg = payload.new;
      if (msg.sender_id === session.user.id) return; // ignore our own sends
      const viewingThisThread = currentScreen === 'thread' && currentConversation?.id === msg.conversation_id;
      if (viewingThisThread) return; // per-thread subscription already handles this case
      unreadConversationIds.add(msg.conversation_id);
      updateChatBadge();
      toast('💬 New message');
      if (currentScreen === 'chats') renderChats();
    })
    .subscribe();
}

/* =========================================================
   NEARBY
========================================================= */
window.loadNearby = async function(){
  document.getElementById('resultsCount').textContent = 'Loading…';
  renderLocationWarning();
  const { data, error } = await supabase
    .from('garages')
    .select('*, items(*)')
    .neq('id', session.user.id);
  if (error) { toast('Could not load nearby garages.'); console.error(error); return; }

  nearbyGarages = (data || []).map(g => ({
    ...g,
    items: (g.items || []).filter(it => !it.deleted_at),
    distance: haversineMeters(myGarage.lat, myGarage.lng, g.lat, g.lng)
  }));
  document.getElementById('estateName').textContent = myGarage.town || '—';
  document.getElementById('topbarSub').textContent = '📍 ' + (myGarage.town || 'Nearby') + ' · live';
  renderGarageList();
};
function renderLocationWarning(){
  const slot = document.getElementById('locationWarningSlot');
  if (!slot) return;
  const missing = myGarage.lat === null || myGarage.lat === undefined;
  const label = (myGarage.location_mode === 'live') ? 'current location' : 'home location';
  slot.innerHTML = missing ? `
    <div class="location-warning" onclick="requestLocationUpdate()">
      <div class="glyph">📍</div>
      <div class="txt">Your ${label} isn't set, so distances to nearby garages can't be shown.</div>
      <div class="go">Enable →</div>
    </div>` : '';
}
window.requestLocationUpdate = async function(){
  const mode = myGarage.location_mode || 'fixed';
  const alreadySet = myGarage.lat !== null && myGarage.lat !== undefined;
  if (mode === 'fixed' && alreadySet) {
    const ok = confirm("This will update your home location to wherever you are right now. Only do this if you're actually at home. Continue?");
    if (!ok) return;
  }
  toast('Requesting your location…');
  let lat = null, lng = null;
  try {
    const pos = await new Promise((res, rej) => navigator.geolocation.getCurrentPosition(res, rej, {timeout:8000}));
    lat = Math.round(pos.coords.latitude * 1000) / 1000;
    lng = Math.round(pos.coords.longitude * 1000) / 1000;
  } catch (e) {
    toast('Could not get your location — check your browser/device location permission.');
    return;
  }
  const { error } = await supabase.from('garages').update({lat, lng}).eq('id', session.user.id);
  if (error) { toast('Failed to save your location.'); console.error(error); return; }
  myGarage.lat = lat; myGarage.lng = lng;
  toast(mode === 'fixed' ? '🏠 Home location updated!' : '📡 Current location updated!');
  renderLocationWarning();
  if (currentScreen === 'profile') renderProfile();
  await loadNearby();
};
window.setLocationMode = async function(mode){
  if (myGarage.location_mode === mode) return;
  myGarage.location_mode = mode;
  const { error } = await supabase.from('garages').update({location_mode: mode}).eq('id', session.user.id);
  if (error) { toast('Failed to switch mode.'); console.error(error); return; }
  toast(mode === 'fixed' ? 'Switched to Fixed (home) mode' : 'Switched to Live (current) mode');
  renderProfile();
};
function buildCategoryChips(){
  const box = document.getElementById('categoryChips');
  const cats = ["All", ...CATEGORIES];
  box.innerHTML = cats.map(c => `<div class="chip ${c===activeCategory?'active':''}" onclick="setCategory('${c}')">${c}</div>`).join('');
}
window.setCategory = function(c){ activeCategory = c; buildCategoryChips(); renderGarageList(); };

function renderGarageList(){
  const q = (document.getElementById('searchInput')?.value || '').toLowerCase().trim();
  let list = nearbyGarages.slice().sort((a,b)=>{
    const aBoost = (a.items||[]).some(i=>i.boosted) ? 1 : 0;
    const bBoost = (b.items||[]).some(i=>i.boosted) ? 1 : 0;
    if (aBoost !== bBoost) return bBoost - aBoost;
    const ad = a.distance ?? Infinity, bd = b.distance ?? Infinity;
    return ad - bd;
  });
  const filtered = list.filter(g=>{
    const items = g.items || [];
    const matchesCat = activeCategory==="All" || items.some(it=>it.category===activeCategory);
    const matchesQ = !q || g.display_name.toLowerCase().includes(q) || g.block.toLowerCase().includes(q)
      || items.some(it=>it.title.toLowerCase().includes(q));
    return matchesCat && matchesQ && items.length > 0;
  });
  document.getElementById('resultsCount').textContent = `${filtered.length} garage${filtered.length===1?'':'s'} nearby`;
  const box = document.getElementById('garageList');
  if (filtered.length===0){
    box.innerHTML = `<div class="empty"><div class="glyph">🕳️</div><p>No garages match yet.<br>Nearby listings will appear here as neighbours add items.</p></div>`;
    return;
  }
  box.innerHTML = filtered.map(g=>{
    const c = colorFor(g.id);
    const items = (g.items||[]).filter(it=>it.status!=='Sold' && (activeCategory==="All" || it.category===activeCategory));
    const preview = items.slice(0,4).map(it=>`<div class="mini-item" style="position:relative;">${mediaFill(it)}${it.boosted?'<div class="mi-boost-flag">🔥</div>':''}</div>`).join('');
    const more = (g.items||[]).length>4 ? `<div class="mini-item more">+${g.items.length-4}</div>` : '';
    const isBoosted = (g.items||[]).some(i=>i.boosted);
    const distLabel = g.distance===null ? '—' : (g.distance < 15 ? 'IN YOUR BLOCK' : g.distance+'m');
    return `
    <div class="garage-card" style="position:relative;" onclick="openGarage('${g.id}')">
      ${isBoosted ? '<div class="boost-tag">🔥 Boosted</div>' : ''}
      <div class="block-tile sz-list" style="background:${c};"><div class="num">${esc(g.block)}</div><div class="town">${esc((g.town||'').slice(0,3).toUpperCase())}</div></div>
      <div class="info">
        <div class="row1"><div class="name">${esc(g.display_name)}'s Garage</div><div class="dist">${distLabel}</div></div>
        <div class="addr">Blk ${esc(g.block)}, ${esc(g.town)} · ${(g.items||[]).length} item${(g.items||[]).length===1?'':'s'}</div>
        <div class="preview">${preview}${more}</div>
      </div>
    </div>`;
  }).join('');
}

/* =========================================================
   GARAGE PAGE
========================================================= */
window.openGarage = function(id){
  const g = nearbyGarages.find(x=>x.id===id);
  if (!g) return;
  currentGarageId = id;
  const c = colorFor(id);
  document.getElementById('garageHeaderBox').innerHTML = `
    <div class="block-tile sz-hero" style="background:${c};"><div class="num">${esc(g.block)}</div><div class="town">${esc((g.town||'').slice(0,3).toUpperCase())}</div></div>
    <div class="who">
      <div class="name">${esc(g.display_name)}'s Garage</div>
      <div class="addr">Blk ${esc(g.block)}, ${esc(g.town)} ${g.distance!==null ? '· '+(g.distance<15?'in your block':g.distance+'m away') : ''}</div>
      <div class="tagline">"${esc(g.tagline) || "Welcome to my garage — feel free to ask about anything!"}"</div>
    </div>`;
  const grid = document.getElementById('garageItemGrid');
  const items = g.items || [];
  grid.innerHTML = items.length===0
    ? `<div class="empty" style="grid-column:1/-1;"><div class="glyph">📦</div><p>No items listed yet.</p></div>`
    : items.map(it=>itemCardHtml(it, id)).join('');
  show('garage');
};
function itemCardHtml(it, garageId, fromScreen){
  const statusClass = it.status.toLowerCase();
  const from = fromScreen || 'garage';
  return `
  <div class="item-card" onclick="itemDetailFrom='${from}'; openItem('${it.id}','${garageId}')">
    <div class="item-photo" style="background:${colorFor(it.id)}22;">
      ${mediaFill(it)}
      ${it.boosted ? '<div class="boost-tag" style="top:6px; left:6px; right:auto;">🔥</div>' : ''}
      <div class="status-tag ${statusClass}">${it.status}</div>
    </div>
    <div class="item-body">
      <div class="item-title">${esc(it.title)}</div>
      <div class="item-price">$${it.price}</div>
      <div class="item-cond">${esc(it.condition)}</div>
    </div>
  </div>`;
}

/* =========================================================
   ITEM DETAIL
========================================================= */
window.backFromItem = function(){
  if (itemDetailFrom==='garage' && currentGarageId) openGarage(currentGarageId);
  else if (itemDetailFrom==='liked') show('liked');
  else if (itemDetailFrom==='mygarage') show('mygarage');
  else show('nearby');
};
window.openItem = function(itemId, garageId){
  if (garageId === 'mine') itemDetailFrom = 'mygarage';
  const g = garageId==='mine' ? {id:'mine', ...myGarage} : nearbyGarages.find(x=>x.id===garageId);
  const item = garageId==='mine'
    ? myItems.find(i=>i.id===itemId)
    : (g?.items || []).find(i=>i.id===itemId);
  if (!item || !g) return;
  currentItemId = itemId;
  currentItemCache = item;
  currentGarageId = garageId;

  const isMine = garageId==='mine';
  const c = colorFor(g.id);
  const saved = savedItemIds.has(itemId);
  const hasPhotos = item.photos && item.photos.length > 0;
  const mainMedia = hasPhotos
    ? `<img id="detailMainImg" src="${item.photos[0]}" style="width:100%;height:100%;object-fit:contain;display:block;cursor:zoom-in;" onclick="openLightbox(this.src, event)">`
    : mediaFill(item);
  const dots = (hasPhotos && item.photos.length > 1)
    ? `<div class="photo-dots">${item.photos.map((_,i)=>`<div class="photo-dot ${i===0?'active':''}" onclick="setDetailPhoto(${i},event)"></div>`).join('')}</div>` : '';

  document.getElementById('itemDetailBox').innerHTML = `
    <div class="item-detail-photo" style="background:${c}22;">
      ${mainMedia}
      <div class="save-btn ${saved?'saved':''}" onclick="toggleSave('${itemId}', event)">${saved?'♥':'♡'}</div>
      ${dots}
    </div>
    <div class="idet-title">${esc(item.title)}</div>
    <div class="idet-price">$${item.price}</div>
    <div class="idet-badges">
      <div class="badge">${esc(item.condition)}</div>
      <div class="badge">${esc(item.category)}</div>
      <div class="badge">${item.status}</div>
    </div>
    <div class="idet-desc">${esc(item.description)}</div>
    <div class="seller-strip" onclick="${isMine ? "show('mygarage')" : `openGarage('${g.id}')`}">
      <div class="block-tile sz-sm" style="background:${c};"><div class="num">${esc(g.block)}</div></div>
      <div><div class="name">${esc(g.display_name)}${isMine?' (you)':"'s Garage"}</div><div class="addr">Blk ${esc(g.block)}, ${esc(g.town)}</div></div>
    </div>
    <div class="action-row">
      ${isMine
        ? `<button class="btn block ghost" disabled>This is your listing</button>`
        : `<button class="btn block red" onclick="startChat('${itemId}','${g.id}')">💬 Message ${esc(g.display_name)}</button>`}
    </div>`;
  show('item');
};
window.openLightbox = function(src, evt){
  if (evt) evt.stopPropagation();
  const overlay = document.createElement('div');
  overlay.className = 'lightbox-overlay';
  overlay.onclick = () => overlay.remove();
  const img = document.createElement('img');
  img.src = src;
  img.onclick = (e) => e.stopPropagation();
  const closeBtn = document.createElement('div');
  closeBtn.className = 'lightbox-close';
  closeBtn.textContent = '✕';
  const hint = document.createElement('div');
  hint.className = 'lightbox-hint';
  hint.textContent = 'Tap anywhere to close';
  overlay.appendChild(img);
  overlay.appendChild(closeBtn);
  overlay.appendChild(hint);
  document.body.appendChild(overlay);
};
window.setDetailPhoto = function(i, evt){
  if (evt) evt.stopPropagation();
  if (!currentItemCache?.photos?.[i]) return;
  document.getElementById('detailMainImg').src = currentItemCache.photos[i];
  document.querySelectorAll('.photo-dot').forEach((d,idx)=>d.classList.toggle('active', idx===i));
};
window.toggleSave = async function(itemId, evt){
  if (evt) evt.stopPropagation();
  if (savedItemIds.has(itemId)) {
    savedItemIds.delete(itemId);
    await supabase.from('saved_items').delete().match({user_id: session.user.id, item_id: itemId});
  } else {
    savedItemIds.add(itemId);
    await supabase.from('saved_items').insert({user_id: session.user.id, item_id: itemId});
  }
  openItem(itemId, currentGarageId);
};
async function loadSaved(){
  const { data } = await supabase.from('saved_items').select('item_id').eq('user_id', session.user.id);
  savedItemIds = new Set((data||[]).map(r=>r.item_id));
}

/* =========================================================
   CHAT
========================================================= */
window.startChat = async function(itemId, sellerId){
  const { data: existing } = await supabase
    .from('conversations').select('id').eq('item_id', itemId).eq('buyer_id', session.user.id).maybeSingle();
  let convoId = existing?.id;
  if (!convoId) {
    const { data: created, error } = await supabase
      .from('conversations')
      .insert({ item_id: itemId, buyer_id: session.user.id, seller_id: sellerId })
      .select('id').single();
    if (error) { toast('Could not start chat.'); console.error(error); return; }
    convoId = created.id;
  }
  await openThread(convoId);
};
async function openThread(convoId){
  const { data: convo, error } = await supabase
    .from('conversations')
    .select(`
      id, item_id, buyer_id, seller_id,
      item:items(id,title,price,photos,category,deleted_at),
      buyer:garages!conversations_buyer_id_fkey(id,display_name,block),
      seller:garages!conversations_seller_id_fkey(id,display_name,block)
    `)
    .eq('id', convoId).single();
  if (error) { toast('Could not open chat.'); console.error(error); return; }
  currentConversation = convo;
  unreadConversationIds.delete(convoId);
  updateChatBadge();
  const otherParty = convo.buyer_id === session.user.id ? convo.seller : convo.buyer;

  document.getElementById('threadWho').textContent = (otherParty?.display_name || 'Chat').toUpperCase();
  document.getElementById('threadItemStrip').innerHTML = `
    <div class="ph">${mediaFill(convo.item)}</div>
    <div><div class="t">${esc(convo.item.title)}</div><div class="p">${convo.item.deleted_at ? '<span style="color:var(--ink-soft); font-weight:600;">Listing removed</span>' : '$'+convo.item.price}</div></div>`;

  await loadMessages(convoId);
  subscribeToThread(convoId);
  show('thread');
}
async function loadMessages(convoId){
  const { data, error } = await supabase
    .from('messages').select('*').eq('conversation_id', convoId).order('created_at', {ascending:true});
  if (error) { console.error(error); return; }
  renderMessages(data || []);
}
function renderMessages(messages){
  const box = document.getElementById('threadMessages');
  box.innerHTML = messages.map(m=>{
    const mine = m.sender_id === session.user.id;
    const time = new Date(m.created_at).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
    return `<div class="msg ${mine?'me':'them'}">${esc(m.body)}<div class="msg-time">${time}</div></div>`;
  }).join('');
  box.scrollTop = box.scrollHeight;
}
function subscribeToThread(convoId){
  if (realtimeChannel) supabase.removeChannel(realtimeChannel);
  realtimeChannel = supabase
    .channel('messages-'+convoId)
    .on('postgres_changes', {
      event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${convoId}`
    }, () => loadMessages(convoId))
    .subscribe();
}
window.sendMsg = async function(){
  const input = document.getElementById('composerInput');
  const body = input.value.trim();
  if (!body || !currentConversation) return;
  input.value = '';
  const { error } = await supabase.from('messages').insert({
    conversation_id: currentConversation.id, sender_id: session.user.id, body
  });
  if (error) { toast('Message failed to send.'); console.error(error); }
};
window.renderChats = async function(){
  const box = document.getElementById('convoList');
  box.innerHTML = `<div class="empty"><div class="glyph">💬</div><p>Loading…</p></div>`;
  const { data, error } = await supabase
    .from('conversations')
    .select(`
      id, buyer_id, seller_id,
      item:items(id,title,price,photos,deleted_at),
      buyer:garages!conversations_buyer_id_fkey(id,display_name),
      seller:garages!conversations_seller_id_fkey(id,display_name),
      messages(body, created_at, sender_id)
    `)
    .or(`buyer_id.eq.${session.user.id},seller_id.eq.${session.user.id}`)
    .order('created_at', {foreignTable:'messages', ascending:true});
  if (error) { box.innerHTML = `<div class="empty"><p>Could not load messages.</p></div>`; console.error(error); return; }

  if (!data || data.length===0){
    box.innerHTML = `<div class="empty"><div class="glyph">💬</div><p>No conversations yet.<br>Message a seller from any item page to start chatting.</p></div>`;
    return;
  }
  box.innerHTML = data.map(c=>{
    const otherParty = c.buyer_id === session.user.id ? c.seller : c.buyer;
    const msgs = c.messages || [];
    const last = msgs[msgs.length-1];
    const isUnread = unreadConversationIds.has(c.id);
    return `
    <div class="convo-card" onclick="openThread('${c.id}')">
      <div class="convo-thumb">${mediaFill(c.item)}</div>
      <div class="convo-info">
        <div class="convo-name">${esc(otherParty?.display_name || 'Neighbour')}</div>
        <div class="convo-item">${esc(c.item.title)} · ${c.item.deleted_at ? 'Listing removed' : '$'+c.item.price}</div>
        <div class="convo-last">${last ? (last.sender_id===session.user.id?'You: ':'') + esc(last.body) : 'Say hi 👋'}</div>
      </div>
      ${isUnread ? '<div class="unread-dot"></div>' : ''}
    </div>`;
  }).join('');
};
// openThread needs to be reachable from the convo card's inline onclick
window.openThread = openThread;

/* =========================================================
   MY GARAGE
========================================================= */
async function loadMyItems(){
  const { data, error } = await supabase.from('items').select('*').eq('garage_id', session.user.id).is('deleted_at', null).order('created_at', {ascending:false});
  if (error) { console.error(error); return; }
  myItems = data || [];
}
window.renderMyGarage = function(){
  document.getElementById('myBlockTile').innerHTML = `<div class="num">${esc(myGarage.block)}</div><div class="town">${esc((myGarage.town||'').slice(0,3).toUpperCase())}</div>`;
  document.getElementById('myAddrLine').textContent = `Blk ${myGarage.block}, ${myGarage.town}`;
  document.getElementById('myItemCount').textContent = myItems.filter(i=>i.status!=='Sold').length;
  document.getElementById('mySoldCount').textContent = myItems.filter(i=>i.status==='Sold').length;
  document.getElementById('proBadgeSlot').innerHTML = myGarage.is_pro ? '<span class="pro-badge">★ PRO</span>' : '';

  const proSlot = document.getElementById('proBannerSlot');
  proSlot.innerHTML = myGarage.is_pro ? `
    <div class="pro-banner" onclick="show('pro')">
      <div class="top"><div class="kicker">Pro Garage active</div><div style="font-size:18px;">★</div></div>
      <h3>You're all set</h3>
      <p>3 photos per item, a custom tagline, and ${myGarage.free_boost_credits} free boost credit${myGarage.free_boost_credits===1?'':'s'} left this month.</p>
    </div>
    <div class="field" style="margin-top:14px;">
      <label>Garage tagline <span style="text-transform:none; font-weight:500;">— shown on your garage page</span></label>
      <input type="text" id="taglineInput" maxlength="80" value="${esc(myGarage.tagline||'')}" onblur="saveTagline(this.value)">
    </div>` : `
    <div class="pro-banner" onclick="show('pro')">
      <div class="top"><div class="kicker">Sell more, often?</div><div style="font-size:18px;">→</div></div>
      <h3>Go Pro Garage</h3>
      <p>3 photos per item, a custom garage tagline, a Pro badge, and 3 free boosts every month — $2.90/mo.</p>
    </div>`;

  const box = document.getElementById('myItemsList');
  box.innerHTML = myItems.length===0
    ? `<div class="empty"><div class="glyph">📦</div><p>Your garage is empty.<br>List your first item — someone in your block might need exactly that.</p></div>`
    : myItems.map(it=>`
      <div class="my-item-row" style="position:relative;">
        ${it.boosted ? '<div class="mi-boost-flag" style="top:-6px; left:34px;">🔥</div>' : ''}
        <div class="row-top">
          <div class="ph" onclick="openItem('${it.id}','mine')">${mediaFill(it)}</div>
          <div class="body" onclick="openItem('${it.id}','mine')">
            <div class="t">${esc(it.title)}</div><div class="p">$${it.price}</div>
          </div>
          <div class="del-x" onclick="deleteItem('${it.id}')">✕</div>
        </div>
        <div class="row-bottom">
          <div class="status-pills">
            <div class="status-pill ${it.status==='Available'?'active available':''}" onclick="setStatus('${it.id}','Available')">Available</div>
            <div class="status-pill ${it.status==='Reserved'?'active reserved':''}" onclick="setStatus('${it.id}','Reserved')">Reserved</div>
            <div class="status-pill ${it.status==='Sold'?'active sold':''}" onclick="setStatus('${it.id}','Sold')">Sold</div>
          </div>
          <div class="boost-btn ${it.boosted?'is-boosted':''}" onclick="openBoost('${it.id}')">${it.boosted?'🔥 Boosted':'🔥 Boost'}</div>
        </div>
      </div>`).join('');
};
window.saveTagline = async function(value){
  myGarage.tagline = value;
  await supabase.from('garages').update({tagline: value}).eq('id', session.user.id);
};
window.setStatus = async function(itemId, status){
  const it = myItems.find(i=>i.id===itemId);
  if (!it) return;
  it.status = status;
  await supabase.from('items').update({status}).eq('id', itemId);
  renderMyGarage();
};
window.deleteItem = async function(itemId){
  if (!confirm("Remove this listing? It'll disappear from Nearby and your garage, but any chats about it will stay in your Chats list.")) return;

  const it = myItems.find(i=>i.id===itemId);

  // Delete the actual photo files from storage to reclaim space —
  // extract each file's storage path out of its public URL.
  if (it && it.photos && it.photos.length) {
    const marker = '/item-photos/';
    const paths = it.photos
      .map(url => { const i = url.indexOf(marker); return i === -1 ? null : url.slice(i + marker.length); })
      .filter(Boolean);
    if (paths.length) {
      const { error: storageErr } = await supabase.storage.from('item-photos').remove(paths);
      if (storageErr) console.error('Could not delete photo files:', storageErr);
      // Don't block the listing removal just because storage cleanup failed —
      // worst case is a harmless orphaned file, not a broken listing.
    }
  }

  // Soft-delete: keep the row (so old chats referencing it still work),
  // just mark it removed and clear the (now-deleted) photo URLs.
  const { error } = await supabase.from('items').update({ deleted_at: new Date().toISOString(), photos: [] }).eq('id', itemId);
  if (error) { toast('Failed to remove listing.'); console.error(error); return; }

  myItems = myItems.filter(i=>i.id!==itemId);
  renderMyGarage();
  toast('Listing removed.');
};

/* =========================================================
   ADD ITEM (with real photo upload to Supabase Storage)
========================================================= */
function photoCap(){ return myGarage.is_pro ? 3 : 1; }
window.renderAddItemForm = function(){
  document.getElementById('fTitle').value='';
  document.getElementById('fPrice').value='';
  document.getElementById('fDesc').value='';
  document.getElementById('fCondition').value='Like new';
  document.getElementById('itemFormMsg').textContent='';
  formPhotos = [];
  document.getElementById('fCategory').innerHTML = CATEGORIES.map(c=>`<option>${c}</option>`).join('');
  renderPhotoUploadRow();
};
function renderPhotoUploadRow(){
  const row = document.getElementById('photoUploadRow');
  const cap = photoCap();
  let html = formPhotos.map((p,i)=>`
    <div class="photo-slot"><img src="${p.previewUrl}"><div class="photo-remove" onclick="removePhoto(${i})">✕</div></div>
  `).join('');
  if (formPhotos.length < cap){
    html += `<div class="photo-slot" onclick="document.getElementById('photoFileInput').click()"><div class="plus">＋</div></div>`;
  } else if (!myGarage.is_pro){
    html += `<div class="photo-slot" style="cursor:pointer; border-color:var(--hdb-red);" onclick="show('pro')"><div class="lockmsg">🔒 Pro for more photos</div></div>`;
  }
  row.innerHTML = html;
  document.getElementById('photoHint').innerHTML = myGarage.is_pro
    ? `Pro Garage: up to 3 photos per item. ${formPhotos.length}/3 added.`
    : `Everyone gets 1 free photo per item. <span style="color:var(--zinc-blue); font-weight:700; cursor:pointer;" onclick="show('pro')">Pro Garage</span> unlocks up to 3.`;
}
window.handlePhotoFile = function(input){
  const file = input.files && input.files[0];
  if (!file) return;
  if (formPhotos.length >= photoCap()) { input.value=''; return; }
  formPhotos.push({ file, previewUrl: URL.createObjectURL(file) });
  input.value = '';
  renderPhotoUploadRow();
};
window.removePhoto = function(i){ formPhotos.splice(i,1); renderPhotoUploadRow(); };

window.submitItem = async function(){
  const title = document.getElementById('fTitle').value.trim();
  const price = parseFloat(document.getElementById('fPrice').value);
  const category = document.getElementById('fCategory').value;
  const condition = document.getElementById('fCondition').value;
  const description = document.getElementById('fDesc').value.trim();
  const msg = document.getElementById('itemFormMsg');

  if (!title || isNaN(price)) { msg.className='auth-msg error'; msg.textContent='Please add at least a title and price.'; return; }
  msg.className = 'auth-msg'; msg.textContent = 'Publishing…';

  // 1. Insert the item row first so we have an id to namespace photo paths.
  const { data: item, error: insertErr } = await supabase.from('items').insert({
    garage_id: session.user.id, title, price, category, condition, description, photos: []
  }).select().single();
  if (insertErr) { msg.className='auth-msg error'; msg.textContent = insertErr.message; return; }

  // 2. Upload any photos to Storage, under a per-user folder.
  const urls = [];
  for (const p of formPhotos) {
    const ext = (p.file.name.split('.').pop() || 'jpg').toLowerCase();
    const path = `${session.user.id}/${item.id}-${Date.now()}-${urls.length}.${ext}`;
    const { error: upErr } = await supabase.storage.from('item-photos').upload(path, p.file, {
      cacheControl: '3600', upsert: false, contentType: p.file.type
    });
    if (upErr) { console.error(upErr); continue; }
    const { data: pub } = supabase.storage.from('item-photos').getPublicUrl(path);
    urls.push(pub.publicUrl);
  }

  // 3. Attach the uploaded URLs back onto the item.
  if (urls.length) {
    await supabase.from('items').update({ photos: urls }).eq('id', item.id);
    item.photos = urls;
  }

  myItems.unshift(item);
  show('mygarage');
  toast('Listed! Neighbours can see it now.');
};

/* =========================================================
   BOOST A LISTING
========================================================= */
window.openBoost = function(itemId){
  boostingItemId = itemId;
  selectedBoostOption = 0;
  const it = myItems.find(i=>i.id===itemId);
  document.getElementById('boostItemStrip').innerHTML = `
    <div class="ph">${mediaFill(it)}</div><div><div class="t">${esc(it.title)}</div><div class="p">$${it.price}</div></div>`;
  renderBoostOptions();
  show('boost');
};
function renderBoostOptions(){
  const hasFreeCredit = myGarage.is_pro && myGarage.free_boost_credits > 0;
  const box = document.getElementById('boostOptions');
  box.innerHTML = BOOST_OPTIONS.map((opt,i)=>`
    <div class="price-card ${i===selectedBoostOption?'selected':''}" onclick="selectBoost(${i})">
      <div class="l"><div class="t">${opt.label}</div><div class="s">${opt.sub}</div></div>
      <div class="p">$${opt.price.toFixed(2)}</div><div class="radio-dot"></div>
    </div>`).join('') + (hasFreeCredit ? `
    <div class="price-card ${selectedBoostOption===99?'selected':''}" onclick="selectBoost(99)">
      <div class="l"><div class="t">Use free Pro credit</div><div class="s">24 hours, no charge</div></div>
      <div class="p">$0</div><div class="radio-dot"></div>
    </div>` : '');
  const price = selectedBoostOption===99 ? 0 : BOOST_OPTIONS[selectedBoostOption].price;
  document.getElementById('boostConfirmPrice').textContent = price===0 ? 'Free' : '$'+price.toFixed(2);
}
window.selectBoost = function(i){ selectedBoostOption = i; renderBoostOptions(); };
window.confirmBoost = async function(){
  const hours = selectedBoostOption===99 ? 24 : BOOST_OPTIONS[selectedBoostOption].hours;
  const expiresAt = new Date(Date.now() + hours*3600*1000).toISOString();
  const { error } = await supabase.from('items').update({ boosted:true, boost_expires_at: expiresAt }).eq('id', boostingItemId);
  if (error) { toast('Boost failed.'); console.error(error); return; }
  if (selectedBoostOption===99) {
    myGarage.free_boost_credits = Math.max(0, myGarage.free_boost_credits-1);
    await supabase.from('garages').update({free_boost_credits: myGarage.free_boost_credits}).eq('id', session.user.id);
  }
  const it = myItems.find(i=>i.id===boostingItemId);
  if (it) { it.boosted = true; it.boost_expires_at = expiresAt; }
  toast('🔥 Boosted! Live on Nearby now.');
  show('mygarage');
};

/* =========================================================
   PRO GARAGE
========================================================= */
window.confirmPro = async function(){
  const proExpires = new Date(Date.now() + 30*24*3600*1000).toISOString();
  const newCredits = (myGarage.free_boost_credits||0) + 3;
  const { error } = await supabase.from('garages').update({
    is_pro: true, pro_expires_at: proExpires, free_boost_credits: newCredits
  }).eq('id', session.user.id);
  if (error) { toast('Upgrade failed.'); console.error(error); return; }
  myGarage.is_pro = true; myGarage.pro_expires_at = proExpires; myGarage.free_boost_credits = newCredits;
  toast('★ Welcome to Pro Garage!');
  show('mygarage');
};

/* =========================================================
   PROFILE
========================================================= */
window.renderProfile = function(){
  document.getElementById('profileBlockTile').innerHTML = `<div class="num">${esc(myGarage.block)}</div><div class="town">${esc((myGarage.town||'').slice(0,3).toUpperCase())}</div>`;
  document.getElementById('profileName').textContent = myGarage.display_name;
  document.getElementById('profileAddr').textContent = `Blk ${myGarage.block}, ${myGarage.town}`;

  const mode = myGarage.location_mode || 'fixed';
  const missing = myGarage.lat === null || myGarage.lat === undefined;
  document.getElementById('modeFixedBtn').className = 'status-pill' + (mode==='fixed' ? ' active mode-fixed' : '');
  document.getElementById('modeLiveBtn').className = 'status-pill' + (mode==='live' ? ' active mode-live' : '');

  const hint = document.getElementById('locationModeHint');
  const actionBtn = document.getElementById('locationActionBtn');
  if (mode === 'fixed') {
    hint.textContent = missing
      ? "Your home location isn't set yet — items won't show a distance to buyers until you set it."
      : "Neighbours can find your garage near this fixed point, even while you're out.";
    actionBtn.textContent = missing ? '🏠 Set my home location' : '🏠 Update home location';
  } else {
    hint.textContent = missing
      ? "Your current location isn't set yet."
      : "Your garage shows up wherever you last refreshed your location from.";
    actionBtn.textContent = '📡 Refresh current location';
  }
};

window.renderLiked = async function(){
  const box = document.getElementById('likedGrid');
  box.innerHTML = `<div class="empty" style="grid-column:1/-1;"><div class="glyph">♡</div><p>Loading…</p></div>`;

  const { data, error } = await supabase
    .from('saved_items')
    .select(`
      item_id, created_at,
      item:items(id,title,price,photos,category,condition,status,boosted,garage_id,deleted_at)
    `)
    .eq('user_id', session.user.id)
    .order('created_at', {ascending:false});

  if (error) { box.innerHTML = `<div class="empty" style="grid-column:1/-1;"><p>Could not load liked items.</p></div>`; console.error(error); return; }

  const liked = (data || []).filter(row => row.item && !row.item.deleted_at); // skip deleted or hard-removed items
  if (liked.length === 0){
    box.innerHTML = `<div class="empty" style="grid-column:1/-1;"><div class="glyph">♡</div><p>Nothing liked yet.<br>Tap the heart on any item to save it here.</p></div>`;
    return;
  }
  box.innerHTML = liked.map(row => {
    const gid = row.item.garage_id === session.user.id ? 'mine' : row.item.garage_id;
    return itemCardHtml(row.item, gid, 'liked');
  }).join('');
};

/* =========================================================
   START
========================================================= */
boot();
