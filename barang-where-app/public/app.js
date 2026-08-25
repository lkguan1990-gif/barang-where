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
const CATEGORIES = [
  "Furniture","Electronics","Appliances","Baby & Kids","Books & Stationery",
  "Clothing","Footwear & Bags","Kitchen & Dining","Toys & Games","Sports & Fitness",
  "Beauty & Personal Care","Home & Living","Tools & Hardware","Pet Supplies",
  "Garden & Outdoor","Music & Hobbies","Art & Collectibles","Others"
];
const CATEGORY_EMOJI = {
  "Furniture":"🛋️","Electronics":"📺","Appliances":"🔌","Baby & Kids":"🍼","Books & Stationery":"📚",
  "Clothing":"👕","Footwear & Bags":"👜","Kitchen & Dining":"🍳","Toys & Games":"🧸","Sports & Fitness":"🏸",
  "Beauty & Personal Care":"💄","Home & Living":"🖼️","Tools & Hardware":"🔧","Pet Supplies":"🐾",
  "Garden & Outdoor":"🪴","Music & Hobbies":"🎸","Art & Collectibles":"🎨","Others":"📦"
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
let locationJustSwitched = false; // true right after switching Fixed/Live until the location is actually captured for it
let onboardingLocationCaptured = null; // null = not tried yet, false = denied/failed, {lat,lng} = captured
let currentGarageItemsCache = [];
let garageStatusFilter = 'All';
let myGarageStatusFilter = 'All';
let itemDetailFrom = 'nearby';
let currentConversation = null;
let realtimeChannel = null;
let globalMessageChannel = null;
let currentScreen = 'nearby';
let unreadConversationIds = new Set();
let boostingItemId = null;
let editingItemId = null;
let selectedBoostOption = 0;
let formPhotos = [];
let formCategories = [];
let savedItemIds = new Set();
let savedGarageIds = new Set();
let radiusKm = 1; // default 1km; null means "Any distance"
let radiusKmBeforeSearch; // remembers the radius selected before a search started, so it can be restored after
let conditionFilter = 'All'; // condition filter for item search results (New/Like new/Good/Fair)
const RADIUS_OPTIONS = [1, 3, null]; // null = "Any"

/* =========================================================
   HELPERS
========================================================= */
function checkForbiddenContent(text){
  // Checks listing text against window.FORBIDDEN_KEYWORDS (defined in
  // moderation-keywords.js). Returns the matched term, or null if clean.
  // NOTE: this is a client-side check only -- see the warning comment at
  // the top of moderation-keywords.js about why this alone isn't enough.
  const lower = (text || '').toLowerCase();
  const categories = window.FORBIDDEN_KEYWORDS || {};
  for (const category in categories) {
    for (const term of categories[category]) {
      if (lower.includes(term)) return term;
    }
  }
  return null;
}
function sortByStatusPriority(items){
  const order = { Available: 0, Reserved: 1, Sold: 2 };
  return items.slice().sort((a,b) => (order[a.status] ?? 9) - (order[b.status] ?? 9));
}
function isActivelyBoosted(it){
  return !!(it && it.boosted && it.boost_expires_at && new Date(it.boost_expires_at) > new Date());
}
function boostTimeLeft(expiresAt){
  const ms = new Date(expiresAt) - new Date();
  if (ms <= 0) return null;
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins}m left`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h left`;
  const days = Math.floor(hours / 24);
  return `${days}d left`;
}
function townLabel(g){
  const t = esc(g.town || '');
  return g.neighbourhood ? `${t} (${esc(g.neighbourhood)})` : t;
}
function formatDistance(meters){
  if (meters >= 1000) return (meters/1000).toFixed(1).replace(/\.0$/,'') + 'km';
  return meters + 'm';
}
function sameBlock(g){
  return (g.block||'').trim().toLowerCase() === (myGarage.block||'').trim().toLowerCase()
      && (g.town||'').trim().toLowerCase() === (myGarage.town||'').trim().toLowerCase();
}
function colorFor(id){
  let h = 0;
  for (const c of String(id)) h = (h*31 + c.charCodeAt(0)) % PALETTE.length;
  return PALETTE[Math.abs(h)];
}
function mediaFill(item){
  if (item.photos && item.photos.length) {
    return `<img src="${item.photos[0]}" style="width:100%;height:100%;object-fit:cover;display:block;">`;
  }
  return CATEGORY_EMOJI[(item.categories||[])[0]] || "📦";
}
// Approximate centre coordinates for Singapore's 27 official HDB towns.
// Used only to APPROXIMATE "which town am I near right now" for display
// in Live location mode -- NOT used for any actual distance/matching
// calculations (those always use precise lat/lng directly). Being off by
// a town at a boundary is a cosmetic imprecision, not a functional bug.
const TOWN_CENTERS = {
  "Ang Mo Kio": [1.3691, 103.8454], "Bedok": [1.3236, 103.9273],
  "Bishan": [1.3526, 103.8352], "Bukit Batok": [1.3590, 103.7637],
  "Bukit Merah": [1.2819, 103.8239], "Bukit Panjang": [1.3774, 103.7719],
  "Bukit Timah": [1.3294, 103.8021], "Central Area": [1.2903, 103.8520],
  "Choa Chu Kang": [1.3840, 103.7470], "Clementi": [1.3151, 103.7649],
  "Geylang": [1.3181, 103.8871], "Hougang": [1.3612, 103.8863],
  "Jurong East": [1.3329, 103.7436], "Jurong West": [1.3404, 103.7090],
  "Kallang/Whampoa": [1.3100, 103.8651], "Marine Parade": [1.3020, 103.9067],
  "Pasir Ris": [1.3721, 103.9474], "Punggol": [1.4051, 103.9020],
  "Queenstown": [1.2942, 103.7861], "Sembawang": [1.4491, 103.8185],
  "Sengkang": [1.3868, 103.8914], "Serangoon": [1.3554, 103.8679],
  "Tampines": [1.3496, 103.9568], "Tengah": [1.3722, 103.7069],
  "Toa Payoh": [1.3343, 103.8563], "Woodlands": [1.4382, 103.7890],
  "Yishun": [1.4304, 103.8354]
};
function nearestTown(lat, lng){
  if (lat === null || lat === undefined) return null;
  let best = null, bestDist = Infinity;
  for (const [name, [tLat, tLng]] of Object.entries(TOWN_CENTERS)) {
    const d = haversineMeters(lat, lng, tLat, tLng);
    if (d < bestDist) { bestDist = d; best = name; }
  }
  return best;
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
  let { data: garage, error } = await supabase
    .from('garages').select('*').eq('id', session.user.id).maybeSingle();
  if (error) {
    // After long inactivity (app backgrounded a while), the session's access
    // token can be stale before Supabase's automatic refresh has caught up.
    // Try an explicit refresh and retry once before giving up.
    const { data: refreshed } = await supabase.auth.refreshSession();
    if (refreshed?.session) {
      session = refreshed.session;
      ({ data: garage, error } = await supabase
        .from('garages').select('*').eq('id', session.user.id).maybeSingle());
    }
  }
  if (error) { toast('Could not load your garage — check your Supabase setup.'); console.error(error); return; }

  if (!garage) {
    document.getElementById('screen-onboarding').style.display = 'flex';
    return;
  }
  myGarage = garage;
  document.getElementById('mainApp').style.display = 'block';
  buildCategoryChips();
  buildRadiusChips();
  await Promise.all([loadNearby(), loadMyItems(), loadSaved(), loadSavedGarages()]);
  subscribeToGlobalMessages();
  show('nearby');
}

window.sendSignInCode = async function(){
  const email = document.getElementById('authEmail').value.trim();
  const msg = document.getElementById('authMsg');
  if (!email) { msg.className='auth-msg error'; msg.textContent='Enter your email first.'; return; }
  msg.className = 'auth-msg'; msg.textContent = 'Sending…';
  const { error } = await supabase.auth.signInWithOtp({
    email, options: { emailRedirectTo: window.location.href }
  });
  if (error) { msg.className='auth-msg error'; msg.textContent = error.message; return; }
  msg.className = 'auth-msg ok';
  msg.textContent = '✓ Check your email for your sign-in code, then enter it below.';
  document.getElementById('otpCodeSection').style.display = 'block';
};
window.verifyOtpCode = async function(){
  const email = document.getElementById('authEmail').value.trim();
  const token = document.getElementById('otpCodeInput').value.trim();
  const msg = document.getElementById('authMsg');
  if (!email) { msg.className='auth-msg error'; msg.textContent='Enter your email first.'; return; }
  if (!token) { msg.className='auth-msg error'; msg.textContent='Enter the code from your email.'; return; }
  msg.className = 'auth-msg'; msg.textContent = 'Verifying…';
  const { error } = await supabase.auth.verifyOtp({ email, token, type: 'email' });
  if (error) { msg.className='auth-msg error'; msg.textContent = error.message; return; }
  msg.className = 'auth-msg ok'; msg.textContent = '✓ Signed in!';
  // onAuthStateChange picks up the new session and routes automatically —
  // no page navigation happened, so this works identically whether we're
  // in an installed home-screen app or a regular browser tab.
};

window.finishOnboarding = async function(){
  const display_name = document.getElementById('obName').value.trim();
  const block = document.getElementById('obBlock').value.trim();
  const townSelect = document.getElementById('obTown');
  const neighbourhood = document.getElementById('obNeighbourhood').value.trim();
  const msg = document.getElementById('obMsg');
  const submitBtn = document.getElementById('obSubmitBtn');
  if (!display_name || !block) { msg.className='auth-msg error'; msg.textContent='Name and block are both required.'; return; }

  // First pass: detect location and suggest a matching town, so the two
  // never start out mismatched with each other. Wait for the user to
  // review/correct it before actually submitting.
  if (onboardingLocationCaptured === null) {
    document.getElementById('obLocStatus').textContent = 'Requesting your location…';
    try {
      const pos = await new Promise((res, rej) => navigator.geolocation.getCurrentPosition(res, rej, {timeout:8000}));
      const lat = Math.round(pos.coords.latitude * 1000) / 1000;
      const lng = Math.round(pos.coords.longitude * 1000) / 1000;
      onboardingLocationCaptured = { lat, lng };
      const detected = nearestTown(lat, lng);
      if (detected) {
        townSelect.value = detected;
        document.getElementById('obLocStatus').textContent = `📍 We've set your town to ${detected} based on your location — check it's right, then tap "${submitBtn.dataset.confirmLabel}" to finish.`;
      } else {
        document.getElementById('obLocStatus').textContent = `📍 Got your location. Please confirm your town below, then tap "${submitBtn.dataset.confirmLabel}" to finish.`;
      }
    } catch (e) {
      onboardingLocationCaptured = false;
      document.getElementById('obLocStatus').textContent = `Location unavailable — you can still list items, but distance sorting needs it (you can allow it later in Profile). Tap "${submitBtn.dataset.confirmLabel}" to finish without it.`;
    }
    submitBtn.textContent = submitBtn.dataset.confirmLabel;
    return;
  }

  // Second pass: actually submit, using whatever town is now selected --
  // either the GPS-detected suggestion, or the user's own correction.
  const town = townSelect.value.trim() || (cfg.DEFAULT_TOWN || 'Sengkang');
  const lat = onboardingLocationCaptured ? onboardingLocationCaptured.lat : null;
  const lng = onboardingLocationCaptured ? onboardingLocationCaptured.lng : null;

  const { error } = await supabase.from('garages').insert({
    id: session.user.id, display_name, block, town, neighbourhood,
    home_lat: lat, home_lng: lng, browse_lat: lat, browse_lng: lng
  });
  if (error) { msg.className='auth-msg error'; msg.textContent = error.message; return; }
  await route();
};

window.signOut = async function(){
  await supabase.auth.signOut();
  if (globalMessageChannel) { supabase.removeChannel(globalMessageChannel); globalMessageChannel = null; }
  unreadConversationIds.clear();
  myGarage = null; myItems = []; nearbyGarages = [];
  // Reset the sign-in screen back to a clean state, so it doesn't show
  // the previous session's leftover code, success message, or open code box.
  const otpInput = document.getElementById('otpCodeInput');
  const otpSection = document.getElementById('otpCodeSection');
  const authMsg = document.getElementById('authMsg');
  if (otpInput) otpInput.value = '';
  if (otpSection) otpSection.style.display = 'none';
  if (authMsg) { authMsg.className = 'auth-msg'; authMsg.textContent = ''; }
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
  let navKey = navMap[screen];
  if (screen === 'item') {
    navKey = itemDetailFrom === 'mygarage' ? 'mygarage' : (itemDetailFrom === 'liked' ? 'profile' : 'nearby');
  }
  document.querySelectorAll('.navbtn').forEach(b=>{ if (b.dataset.nav===navKey) b.classList.add('active'); });

  if (screen==='nearby') loadNearby();
  if (screen==='mygarage') renderMyGarage();
  if (screen==='additem') renderAddItemForm();
  if (screen==='pro') renderProScreen();
  if (screen==='chats') renderChats();
  if (screen==='profile') renderProfile();
  if (screen==='liked') { setLikedTab('items'); renderLiked(); }
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
  const searchBox = document.getElementById('searchInput');
  document.getElementById('resultsCount').textContent = 'Loading…';
  searchBox.disabled = true;
  searchBox.placeholder = 'Loading nearby garages…';
  renderLocationWarning();
  const { data, error } = await supabase
    .from('garages')
    .select('*, items(*)')
    .neq('id', session.user.id);
  searchBox.disabled = false;
  searchBox.placeholder = 'Search items or garages…';
  if (error) { toast('Could not load nearby garages.'); console.error(error); return; }

  nearbyGarages = (data || []).map(g => ({
    ...g,
    items: (g.items || []).filter(it => !it.deleted_at),
    distance: haversineMeters(myGarage.browse_lat, myGarage.browse_lng, g.home_lat, g.home_lng)
  }));
  const isLiveLocation = myGarage.location_mode === 'live';
  const garageTownName = myGarage.town || '—';
  const browseTownName = isLiveLocation ? (nearestTown(myGarage.browse_lat, myGarage.browse_lng) || 'Unknown area') : garageTownName;
  const browsingElsewhere = isLiveLocation && browseTownName !== garageTownName;

  document.getElementById('topbarSub').textContent = browsingElsewhere
    ? `Garage at ${garageTownName} · browsing from ${browseTownName} ›`
    : `Garage at ${garageTownName} · browsing from your home ›`;
  renderGarageList();
};
window.toggleGarageDetailsForm = function(){
  const form = document.getElementById('garageDetailsForm');
  const chevron = document.getElementById('garageDetailsChevron');
  const isOpen = form.style.display !== 'none';
  form.style.display = isOpen ? 'none' : 'flex';
  chevron.textContent = isOpen ? '▸' : '▾';
};
function renderHomeAddressStatus(){
  const slot = document.getElementById('homeAddressStatusSlot');
  if (!slot) return;
  if (myGarage.home_lat === null || myGarage.home_lat === undefined) {
    slot.innerHTML = `<div class="field-hint">Your garage's home address isn't set yet — tap "Update home address" below to set it.</div>`;
    return;
  }
  const mapUrl = `https://www.google.com/maps?q=${myGarage.home_lat},${myGarage.home_lng}`;
  const detected = nearestTown(myGarage.home_lat, myGarage.home_lng);
  const mismatch = detected && detected !== myGarage.town;
  slot.innerHTML = `
    <div class="field-hint">
      Your registered home location is near <b>${esc(detected || 'an unknown area')}</b> —
      <a href="${mapUrl}" target="_blank" rel="noopener" style="color:var(--zinc-blue); font-weight:700;">view on map</a>
      to check it's right. It only changes if you tap "Update home address" below.
    </div>
    ${mismatch ? `
    <div class="location-warning" style="cursor:default; margin-top:8px;">
      <div class="glyph">⚠️</div>
      <div class="txt">You've selected "${esc(myGarage.town)}" as your town, but that doesn't match your registered location above.
        <span style="color:var(--zinc-blue); font-weight:700; cursor:pointer;" onclick="updateHomeAddress()">Update home address</span> if you've actually moved, or double-check the town field if not.</div>
    </div>` : ''}`;
}
function renderLocationWarning(){
  const slot = document.getElementById('locationWarningSlot');
  if (!slot) return;
  const missing = myGarage.home_lat === null || myGarage.home_lat === undefined;
  slot.innerHTML = missing ? `
    <div class="location-warning" onclick="updateHomeAddress()">
      <div class="glyph">📍</div>
      <div class="txt">Your garage's home address isn't set, so buyers can't see a distance to it.</div>
      <div class="go">Enable →</div>
    </div>` : '';
}
window.updateHomeAddress = async function(){
  // This is the RARE, deliberate action for when you actually move house.
  // It only ever touches home_lat/lng -- never your browse position.
  const alreadySet = myGarage.home_lat !== null && myGarage.home_lat !== undefined;
  if (alreadySet) {
    const ok = confirm("This updates your garage's permanent address to wherever you are right now. Only do this if you've actually moved house. Continue?");
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
  const updates = { home_lat: lat, home_lng: lng };
  // Fixed mode means "browse from home" -- keep that mirror in sync.
  if ((myGarage.location_mode || 'fixed') === 'fixed') {
    updates.browse_lat = lat; updates.browse_lng = lng;
  }
  const { error } = await supabase.from('garages').update(updates).eq('id', session.user.id);
  if (error) { toast('Failed to save your address.'); console.error(error); return; }
  Object.assign(myGarage, updates);
  toast('🏠 Garage address updated!');
  renderLocationWarning();
  if (currentScreen === 'profile') renderProfile();
  await loadNearby();
};
window.requestLocationUpdate = async function(){
  // This is the frequent, casual action -- refreshing where YOU are
  // browsing from right now. Only ever touches browse_lat/lng, never
  // your garage's actual advertised address.
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
  const { error } = await supabase.from('garages').update({browse_lat: lat, browse_lng: lng}).eq('id', session.user.id);
  if (error) { toast('Failed to save your position.'); console.error(error); return; }
  myGarage.browse_lat = lat; myGarage.browse_lng = lng;
  locationJustSwitched = false;
  toast('📡 Now browsing from your current position!');
  if (currentScreen === 'profile') renderProfile();
  await loadNearby();
};
window.setLocationMode = async function(mode){
  if (myGarage.location_mode === mode) return;
  myGarage.location_mode = mode;
  const updates = { location_mode: mode };
  if (mode === 'fixed') {
    // Fixed means "browse from home" -- snap browse position back to
    // home immediately, since there's nothing independent to track.
    updates.browse_lat = myGarage.home_lat;
    updates.browse_lng = myGarage.home_lng;
  }
  const { error } = await supabase.from('garages').update(updates).eq('id', session.user.id);
  if (error) { toast('Failed to switch mode.'); console.error(error); return; }
  Object.assign(myGarage, updates);
  if (mode === 'fixed') {
    locationJustSwitched = false;
    toast(`🏠 Now browsing from your garage's home location (${myGarage.town || 'home'}).`);
  } else {
    locationJustSwitched = true;
    toast('📡 Switched to Live — tap "Refresh my current position" below now to browse from where you actually are.');
  }
  renderProfile();
};
function buildCategoryChips(){
  const box = document.getElementById('categoryChips');
  const cats = ["All", ...CATEGORIES];
  box.innerHTML = cats.map(c => `<div class="chip ${c===activeCategory?'active':''}" onclick="setCategory('${c}')">${c}</div>`).join('');
}
window.setCategory = function(c){ activeCategory = c; buildCategoryChips(); renderGarageList(); };

function buildRadiusChips(){
  const box = document.getElementById('radiusChips');
  if (!box) return;
  const searching = radiusKmBeforeSearch !== undefined;
  box.innerHTML = RADIUS_OPTIONS.map(km => {
    const label = km === null ? 'Any' : (km < 1 ? (km*1000)+'m' : km+'km');
    const active = km === radiusKm;
    const disabledAttr = searching ? 'style="opacity:0.4; pointer-events:none;"' : '';
    return `<div class="chip ${active?'active':''}" ${disabledAttr} onclick="setRadius(${km === null ? 'null' : km})">${label}</div>`;
  }).join('');
}
window.setRadius = function(km){ radiusKm = km; buildRadiusChips(); renderGarageList(); };

let searchDebounceTimer = null;
window.debouncedRenderGarageList = function(){
  clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(renderGarageList, 120);
};
function renderGarageList(){
  const rawQuery = (document.getElementById('searchInput')?.value || '').trim();
  const q = rawQuery.toLowerCase();

  if (q && radiusKmBeforeSearch === undefined) {
    // Just started searching -- remember the current radius and visually
    // switch to Any, since search intentionally casts wide regardless of it.
    radiusKmBeforeSearch = radiusKm;
    radiusKm = null;
    buildRadiusChips();
  } else if (!q && radiusKmBeforeSearch !== undefined) {
    // Search cleared -- restore whatever radius was active before.
    radiusKm = radiusKmBeforeSearch;
    radiusKmBeforeSearch = undefined;
    buildRadiusChips();
  }
  let list = nearbyGarages.slice().sort((a,b)=>{
    const aBoost = (a.items||[]).some(i=>isActivelyBoosted(i)) ? 1 : 0;
    const bBoost = (b.items||[]).some(i=>isActivelyBoosted(i)) ? 1 : 0;
    if (aBoost !== bBoost) return bBoost - aBoost;
    const ad = a.distance ?? Infinity, bd = b.distance ?? Infinity;
    return ad - bd;
  });

  // Classify each garage: passes the base filters at all, and if actively
  // searching, whether it matched by item (with the cheapest matching item
  // for the price indicator) or only by name/block/town.
  const classified = list.map(g=>{
    const items = g.items || [];
    const name = (g.display_name || '').toLowerCase();
    const block = (g.block || '').toLowerCase();
    const town = (g.town || '').toLowerCase();
    const matchesCat = activeCategory==="All" || items.some(it=>(it.categories||[]).includes(activeCategory));
    const hasLocation = g.distance !== null && g.distance !== undefined;
    const withinRadius = q ? true : (radiusKm === null ? true : (hasLocation && g.distance <= radiusKm*1000));
    const hasAvailableItems = items.some(it=>it.status!=='Sold');
    if (!matchesCat || !withinRadius || !hasAvailableItems) return null;

    if (!q) return { g, matchType: 'none' };

    const matchingItems = items.filter(it => it.status!=='Sold' &&
      ((it.title||'').toLowerCase().includes(q) || (it.categories||[]).some(cat=>cat.toLowerCase().includes(q))));
    if (matchingItems.length > 0) {
      return { g, matchType: 'item', matchingItems };
    }
    if (name.includes(q) || block.includes(q) || town.includes(q)) return { g, matchType: 'garage' };
    return null;
  }).filter(Boolean);

  const box = document.getElementById('garageList');
  const countLabel = document.getElementById('resultsCount');

  if (!q) {
    const radiusLabel = radiusKm === null ? 'any distance' : (radiusKm < 1 ? (radiusKm*1000)+'m' : radiusKm+'km');
    countLabel.textContent = `${classified.length} garage${classified.length===1?'':'s'} within ${radiusLabel}`;
    if (classified.length===0){
      const reason = nearbyGarages.length===0
        ? 'Nearby listings will appear here as neighbours add items.'
        : 'Try a wider radius, a different search, or another category.';
      box.innerHTML = `<div class="empty"><p>No garages match yet.<br>${reason}</p></div>`;
      return;
    }
    box.innerHTML = classified.map(m=>garageCardHtml(m.g, rawQuery)).join('');
    return;
  }

  // Active search: split into Items (with price) and Garages (name/block match only).
  const itemMatchesRaw = classified.filter(m=>m.matchType==='item');
  const garageMatches = classified.filter(m=>m.matchType==='garage');

  // Condition filter only applies to item-type matches -- a garage/name
  // match has no single item's condition to filter by.
  let itemMatches = itemMatchesRaw;
  if (conditionFilter !== 'All') {
    itemMatches = itemMatchesRaw
      .map(m => ({ ...m, matchingItems: m.matchingItems.filter(it=>it.condition===conditionFilter) }))
      .filter(m => m.matchingItems.length > 0);
  }

  const total = itemMatches.length + garageMatches.length;
  countLabel.textContent = `${total} result${total===1?'':'s'} match "${rawQuery}"`;

  if (itemMatchesRaw.length===0 && garageMatches.length===0){
    box.innerHTML = `<div class="empty"><p>No garages match yet.<br>Try a wider radius, a different search, or another category.</p></div>`;
    return;
  }

  let html = '';
  if (itemMatchesRaw.length>0){
    html += `<div class="pole-divider" style="margin-top:0;"><span>ITEMS</span></div>`;
    html += `<div class="chips" style="margin-bottom:10px;">${conditionChipsHtml()}</div>`;
    html += itemMatches.length>0
      ? itemMatches.map(m=>garageCardHtml(m.g, rawQuery, m.matchingItems)).join('')
      : `<div class="empty"><p>No ${conditionFilter.toLowerCase()} condition items match "${esc(rawQuery)}".</p></div>`;
  }
  if (garageMatches.length>0){
    html += `<div class="pole-divider"><span>GARAGES</span></div>`;
    html += garageMatches.map(m=>garageCardHtml(m.g, rawQuery, null)).join('');
  }
  box.innerHTML = html;
}
function conditionChipsHtml(){
  return ['All','New','Like new','Good','Fair'].map(c=>
    `<div class="chip ${c===conditionFilter?'active':''}" onclick="setConditionFilter('${c}')">${c}</div>`
  ).join('');
}
window.setConditionFilter = function(c){
  conditionFilter = c;
  renderGarageList();
};
function highlightMatch(rawText, query){
  if (!query) return esc(rawText || '');
  const text = rawText || '';
  const lower = text.toLowerCase();
  const idx = lower.indexOf(query.toLowerCase());
  if (idx === -1) return esc(text);
  const before = text.slice(0, idx);
  const match = text.slice(idx, idx + query.length);
  const after = text.slice(idx + query.length);
  return esc(before) + '<mark class="search-hl">' + esc(match) + '</mark>' + esc(after);
}
function garageCardHtml(g, query, matchingItems){
  query = query || '';
  const c = colorFor(g.id);
  const displayItems = matchingItems
    ? matchingItems
    : (g.items||[]).filter(it=>it.status!=='Sold' && (activeCategory==="All" || (it.categories||[]).includes(activeCategory)));
  const preview = displayItems.slice(0,4).map(it=>`<div class="mini-item" style="position:relative;">${mediaFill(it)}${isActivelyBoosted(it)?'<div class="mi-boost-flag">🔥</div>':''}</div>`).join('');
  const more = displayItems.length>4 ? `<div class="mini-item more">+${displayItems.length-4}</div>` : '';
  const isBoosted = (g.items||[]).some(i=>isActivelyBoosted(i));
  const distLabel = sameBlock(g) ? 'IN YOUR BLOCK' : ((g.distance===null || g.distance===undefined) ? '—' : (g.distance < 100 ? 'Very near' : formatDistance(g.distance)));
  const liked = savedGarageIds.has(g.id);
  const itemCountLabel = matchingItems
    ? `${matchingItems.length} item${matchingItems.length===1?'':'s'} match`
    : `${(g.items||[]).length} item${(g.items||[]).length===1?'':'s'}`;
  let priceLabel = '';
  if (matchingItems && matchingItems.length) {
    const cheapest = matchingItems.reduce((min, it) => Number(it.price) < Number(min.price) ? it : min);
    const uniqueConditions = new Set(matchingItems.map(it => it.condition));
    const conditionLabel = (conditionFilter === 'All' && uniqueConditions.size > 1) ? 'Various' : cheapest.condition;
    priceLabel = `<div class="price-indicator">${esc(conditionLabel)} condition from S$${Number(cheapest.price).toFixed(0)}</div>`;
  }
  return `
    <div class="garage-card" style="position:relative;" data-query="${esc(query)}" onclick="openGarage('${g.id}', this.dataset.query)">
      ${isBoosted ? '<div class="boost-tag">🔥 Boosted</div>' : ''}
      <div class="garage-like-btn ${liked?'liked':''}" data-garage-id="${g.id}" title="Like this garage — saves the whole seller, not a specific item" onclick="toggleSaveGarage('${g.id}', event)">${liked?'♥':'♡'}</div>
      <div class="block-tile sz-list" style="background:${c};"><div class="num">${esc(g.block)}</div><div class="town">${esc((g.town||'').toUpperCase())}</div></div>
      <div class="info">
        <div class="row1"><div class="name">${highlightMatch(g.display_name, query)}</div><div class="dist">${distLabel}</div></div>
        <div class="addr">Blk ${highlightMatch(g.block, query)}, ${townLabel(g)} · ${itemCountLabel}</div>
        <div class="preview-row"><div class="preview">${preview}${more}</div>${priceLabel}</div>
      </div>
    </div>`;
}

/* =========================================================
   GARAGE PAGE
========================================================= */
window.openGarage = async function(id, carryoverQuery){
  // Always fetch fresh -- the Nearby cache is a one-time snapshot, so an
  // item's status (e.g. marked Sold by the seller after that snapshot)
  // could otherwise still show as Available here.
  const { data, error } = await supabase.from('garages').select('*, items(*)').eq('id', id).maybeSingle();
  if (error || !data) { toast('Could not load this garage.'); return; }
  const g = {
    ...data,
    items: (data.items || []).filter(it => !it.deleted_at),
    distance: haversineMeters(myGarage.browse_lat, myGarage.browse_lng, data.home_lat, data.home_lng)
  };
  currentGarageId = id;
  currentGarageItemsCache = g.items || [];
  const c = colorFor(id);
  const liked = savedGarageIds.has(id);
  document.getElementById('garageHeaderBox').innerHTML = `
    <div class="garage-header-top">
      <div class="block-tile sz-hero" style="background:${c};"><div class="num">${esc(g.block)}</div><div class="town">${esc((g.town||'').toUpperCase())}</div></div>
      <div class="who">
        <div class="name">${esc(g.display_name)}</div>
        <div class="addr">Blk ${esc(g.block)}, ${townLabel(g)} ${sameBlock(g) ? '· in your block' : ((g.distance!==null && g.distance!==undefined) ? '· '+(g.distance < 100 ? 'very close by' : formatDistance(g.distance)+' away') : '')}</div>
        <div class="tagline">"${esc(g.tagline) || "Welcome to my garage — feel free to ask about anything!"}"</div>
      </div>
    </div>
    <div class="garage-header-like ${liked?'liked':''}" data-garage-id="${id}" onclick="toggleSaveGarage('${id}', event)">${liked?'♥ Liked':'♡ Like this garage'}</div>`;

  const searchBox = document.getElementById('garageSearchInput');
  searchBox.value = carryoverQuery || '';
  garageStatusFilter = 'All';
  buildGarageStatusChips();
  renderGarageItemGrid();
  show('garage');
  if (carryoverQuery) toast(`Showing items matching "${carryoverQuery}"`);
};
let garageSearchDebounceTimer = null;
window.debouncedRenderGarageItemGrid = function(){
  clearTimeout(garageSearchDebounceTimer);
  garageSearchDebounceTimer = setTimeout(renderGarageItemGrid, 120);
};
window.renderGarageItemGrid = function(){
  const query = (document.getElementById('garageSearchInput')?.value || '').trim();
  const q = query.toLowerCase();
  const grid = document.getElementById('garageItemGrid');
  const all = currentGarageItemsCache;
  let items = !q ? all : all.filter(it =>
    (it.title||'').toLowerCase().includes(q)
    || (it.description||'').toLowerCase().includes(q)
    || (it.categories||[]).some(cat=>cat.toLowerCase().includes(q))
  );
  if (garageStatusFilter !== 'All') {
    items = items.filter(it => it.status === garageStatusFilter);
  } else {
    items = sortByStatusPriority(items);
  }
  document.getElementById('garageItemCount').textContent = q
    ? `${items.length} item${items.length===1?'':'s'} match "${query}"`
    : `${items.length} item${items.length===1?'':'s'}`;
  if (all.length===0){
    grid.innerHTML = `<div class="empty" style="grid-column:1/-1;"><div class="glyph">📦</div><p>No items listed yet.</p></div>`;
    return;
  }
  if (items.length===0){
    grid.innerHTML = q
      ? `<div class="empty" style="grid-column:1/-1;"><p>No items match "${esc(query)}".<br>Try a different keyword.</p></div>`
      : `<div class="empty" style="grid-column:1/-1;"><p>No ${garageStatusFilter.toLowerCase()} items.</p></div>`;
    return;
  }
  grid.innerHTML = items.map(it=>itemCardHtml(it, currentGarageId, 'garage', query)).join('');
};
function buildGarageStatusChips(){
  const box = document.getElementById('garageStatusChips');
  if (!box) return;
  box.innerHTML = ['All','Available','Reserved','Sold'].map(s=>
    `<div class="chip ${s===garageStatusFilter?'active':''}" onclick="setGarageStatusFilter('${s}')">${s}</div>`
  ).join('');
}
window.setGarageStatusFilter = function(s){
  garageStatusFilter = s;
  buildGarageStatusChips();
  renderGarageItemGrid();
};
function itemCardHtml(it, garageId, fromScreen, query){
  const statusClass = it.status.toLowerCase();
  const from = fromScreen || 'garage';
  return `
  <div class="item-card" onclick="openItem('${it.id}','${garageId}','${from}')">
    <div class="item-photo" style="background:${colorFor(it.id)}22;">
      ${mediaFill(it)}
      ${isActivelyBoosted(it) ? '<div class="boost-tag" style="top:6px; left:6px; right:auto;">🔥</div>' : ''}
      <div class="status-tag ${statusClass}">${it.status}</div>
    </div>
    <div class="item-body">
      <div class="item-title">${highlightMatch(it.title, query)}</div>
      <div class="item-price">$${Number(it.price).toFixed(2)}</div>
      <div class="item-cond">${esc(it.condition)}</div>
    </div>
  </div>`;
}

/* =========================================================
   ITEM DETAIL
========================================================= */
window.backFromItem = function(){
  if (itemDetailFrom==='garage' && currentGarageId) {
    const existingQuery = document.getElementById('garageSearchInput')?.value || '';
    openGarage(currentGarageId, existingQuery);
  }
  else if (itemDetailFrom==='liked') show('liked');
  else if (itemDetailFrom==='mygarage') show('mygarage');
  else if (itemDetailFrom==='thread' && currentConversation) openThread(currentConversation.id);
  else show('nearby');
};
window.openItem = async function(itemId, garageId, fromScreen){
  itemDetailFrom = fromScreen || (garageId === 'mine' ? 'mygarage' : 'nearby');
  const g = garageId==='mine' ? {id:'mine', ...myGarage} : nearbyGarages.find(x=>x.id===garageId);
  let item = garageId==='mine'
    ? myItems.find(i=>i.id===itemId)
    : (g?.items || []).find(i=>i.id===itemId);
  if (!item || !g) return;

  // For someone else's item, refresh from the database -- the Nearby
  // cache is a one-time snapshot, so a status change (e.g. the seller
  // marking it Sold) after that snapshot would otherwise still show as
  // Available here.
  if (garageId !== 'mine') {
    const { data: freshItem, error } = await supabase.from('items').select('*').eq('id', itemId).maybeSingle();
    if (freshItem) item = freshItem;
    else if (error) console.error('Could not refresh item status:', error);
  }

  currentItemId = itemId;
  currentItemCache = item;
  currentGarageId = garageId;

  const isMine = garageId==='mine';
  const c = colorFor(g.id);
  const saved = savedItemIds.has(itemId);
  const ownerIsPro = !!g.is_pro;
  const allPhotos = item.photos || [];
  const lockedCount = (!ownerIsPro && allPhotos.length > 1) ? allPhotos.length - 1 : 0;
  const visiblePhotos = lockedCount > 0 ? allPhotos.slice(0,1) : allPhotos;
  const hasPhotos = visiblePhotos.length > 0;
  const mainMedia = hasPhotos
    ? `<img id="detailMainImg" src="${visiblePhotos[0]}" style="width:100%;height:100%;object-fit:contain;display:block;cursor:zoom-in;" onclick="openLightbox(this.src, event)">`
    : mediaFill(item);
  const dots = (hasPhotos && visiblePhotos.length > 1)
    ? `<div class="photo-dots">${visiblePhotos.map((_,i)=>`<div class="photo-dot ${i===0?'active':''}" onclick="setDetailPhoto(${i},event)"></div>`).join('')}</div>` : '';
  const lockHint = lockedCount > 0
    ? `<div class="field-hint" style="margin-top:8px;">🔒 ${isMine
        ? `${lockedCount} more photo${lockedCount===1?'':'s'} hidden — <span style="color:var(--zinc-blue); font-weight:700; cursor:pointer;" onclick="show('pro')">go Pro</span> to show them again.`
        : `This seller has ${lockedCount} more photo${lockedCount===1?'':'s'} hidden until they're on Pro Garage again.`}</div>`
    : '';

  document.getElementById('itemDetailBox').innerHTML = `
    <div class="item-detail-photo" style="background:${c}22;" ontouchstart="handlePhotoTouchStart(event)" ontouchend="handlePhotoTouchEnd(event)">
      ${mainMedia}
      ${isMine ? '' : `<div class="save-btn ${saved?'saved':''}" data-item-id="${itemId}" onclick="toggleSave('${itemId}', event)">${saved?'♥':'♡'}</div>`}
      ${dots}
    </div>
    ${lockHint}
    <div class="idet-title">${esc(item.title)}</div>
    <div class="idet-price">$${Number(item.price).toFixed(2)}</div>
    <div class="idet-condition-line">In ${esc(item.condition)} condition, listed under ${esc((item.categories||[]).join(', '))}.</div>
    <div class="idet-badges">
      <div class="badge ${item.status.toLowerCase()}">${item.status}</div>
    </div>
    <div class="idet-desc">${esc(item.description)}</div>
    ${isMine ? '' : `
    <div class="seller-strip" onclick="openGarage('${g.id}')">
      <div class="block-tile sz-sm" style="background:${c};"><div class="num">${esc(g.block)}</div></div>
      <div><div class="name">${esc(g.display_name)}</div><div class="addr">Blk ${esc(g.block)}, ${townLabel(g)}</div></div>
    </div>`}
    <div class="action-row">
      ${isMine
        ? `<button class="btn block ghost" onclick="openEditItem('${itemId}')">✏️ Edit this listing</button>`
        : `<button class="btn block red" onclick="startChat('${itemId}','${g.id}')">💬 Message ${esc(g.display_name)}</button>`}
    </div>
    ${isMine ? '' : `
    <div id="reportSection">
      <div class="report-link" onclick="toggleReportForm()">🚩 Report this listing</div>
      <div id="reportForm" style="display:none;"></div>
    </div>`}`;
  show('item');
};
window.toggleReportForm = function(){
  const form = document.getElementById('reportForm');
  if (form.style.display !== 'none') { form.style.display = 'none'; return; }
  form.style.display = 'block';
  form.innerHTML = `
    <select id="reportReason">
      <option>Prohibited item</option>
      <option>Offensive</option>
      <option>Fake or counterfeit</option>
      <option>Spam</option>
      <option>Scam attempt</option>
      <option>Other</option>
    </select>
    <textarea id="reportDetails" placeholder="Any extra details (optional)" maxlength="300"></textarea>
    <button class="btn small" onclick="submitReport('${currentItemId}')">Submit report</button>
    <div id="reportMsg" class="auth-msg"></div>`;
};
window.submitReport = async function(itemId){
  const reason = document.getElementById('reportReason').value;
  const details = document.getElementById('reportDetails').value.trim();
  const msgEl = document.getElementById('reportMsg');
  const { error } = await supabase.from('reports').insert({
    item_id: itemId, reporter_id: session.user.id, reason, details
  });
  if (error) {
    msgEl.className = 'auth-msg error';
    msgEl.textContent = error.code === '23505'
      ? 'You already reported this listing.'
      : 'Could not submit report. Please try again.';
    if (error.code !== '23505') console.error(error);
    return;
  }
  document.getElementById('reportForm').innerHTML = `<div class="auth-msg">Thanks, we'll review this listing.</div>`;
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
let swipeStartX = null, swipeStartY = null;
window.handlePhotoTouchStart = function(e){
  const t = e.changedTouches[0];
  swipeStartX = t.clientX; swipeStartY = t.clientY;
};
window.handlePhotoTouchEnd = function(e){
  if (swipeStartX === null) return;
  const t = e.changedTouches[0];
  const dx = t.clientX - swipeStartX;
  const dy = t.clientY - swipeStartY;
  swipeStartX = null; swipeStartY = null;
  if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy)) return; // require a real horizontal swipe
  const dots = document.querySelectorAll('.photo-dot');
  if (!dots.length) return;
  let current = 0;
  dots.forEach((d,i)=>{ if (d.classList.contains('active')) current = i; });
  const next = dx < 0 ? current + 1 : current - 1; // swipe left = next photo
  if (next < 0 || next >= dots.length) return; // clamp at the ends, no wraparound
  setDetailPhoto(next);
};
window.toggleSave = async function(itemId, evt){
  if (evt) evt.stopPropagation();
  let nowSaved;
  if (savedItemIds.has(itemId)) {
    savedItemIds.delete(itemId);
    nowSaved = false;
    await supabase.from('saved_items').delete().match({user_id: session.user.id, item_id: itemId});
  } else {
    savedItemIds.add(itemId);
    nowSaved = true;
    await supabase.from('saved_items').insert({user_id: session.user.id, item_id: itemId});
  }
  // Lightweight update: toggle just the heart, don't rebuild the whole
  // item detail page (which was re-loading the photo on every like/unlike).
  document.querySelectorAll(`.save-btn[data-item-id="${itemId}"]`).forEach(btn=>{
    btn.classList.toggle('saved', nowSaved);
    btn.textContent = nowSaved ? '♥' : '♡';
  });
};
async function loadSaved(){
  const { data } = await supabase.from('saved_items').select('item_id').eq('user_id', session.user.id);
  savedItemIds = new Set((data||[]).map(r=>r.item_id));
}
async function loadSavedGarages(){
  const { data } = await supabase.from('saved_garages').select('garage_id').eq('user_id', session.user.id);
  savedGarageIds = new Set((data||[]).map(r=>r.garage_id));
}
window.toggleSaveGarage = async function(garageId, evt){
  if (evt) evt.stopPropagation();
  let nowLiked;
  if (savedGarageIds.has(garageId)) {
    savedGarageIds.delete(garageId);
    nowLiked = false;
    await supabase.from('saved_garages').delete().match({user_id: session.user.id, garage_id: garageId});
  } else {
    savedGarageIds.add(garageId);
    nowLiked = true;
    await supabase.from('saved_garages').insert({user_id: session.user.id, garage_id: garageId});
  }
  // Lightweight update: toggle just this garage's heart button(s) directly.
  // Previously this called a full renderGarageList()/openGarage(), which
  // re-rendered every card's photos too -- causing a visible flash across
  // the whole list, not just the one card being liked.
  document.querySelectorAll(`.garage-like-btn[data-garage-id="${garageId}"]`).forEach(btn=>{
    btn.classList.toggle('liked', nowLiked);
    btn.textContent = nowLiked ? '♥' : '♡';
  });
  document.querySelectorAll(`.garage-header-like[data-garage-id="${garageId}"]`).forEach(btn=>{
    btn.classList.toggle('liked', nowLiked);
    btn.textContent = nowLiked ? '♥ Liked' : '♡ Like this garage';
  });
  // If viewing the Liked Garages tab and just unliked one, it no longer
  // belongs there -- remove just that card, not the whole list.
  if (currentScreen === 'liked' && !nowLiked) {
    document.querySelectorAll(`#likedGaragesGrid .garage-like-btn[data-garage-id="${garageId}"]`).forEach(btn=>{
      btn.closest('.garage-card')?.remove();
    });
  }
};

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
      item:items(id,title,price,photos,categories,status,deleted_at),
      buyer:garages!conversations_buyer_id_fkey(id,display_name,block),
      seller:garages!conversations_seller_id_fkey(id,display_name,block)
    `)
    .eq('id', convoId).single();
  if (error) { toast('Could not open chat.'); console.error(error); return; }
  currentConversation = convo;
  unreadConversationIds.delete(convoId);
  updateChatBadge();
  const otherParty = convo.buyer_id === session.user.id ? convo.seller : convo.buyer;
  const isMyItem = session.user.id === convo.seller_id;
  const itemGarageArg = isMyItem ? 'mine' : convo.seller_id;

  document.getElementById('threadWho').textContent = (otherParty?.display_name || 'Chat').toUpperCase();
  document.getElementById('threadItemStrip').innerHTML = `
    <div class="ph" onclick="openItem('${convo.item.id}','${itemGarageArg}','thread')">${mediaFill(convo.item)}</div>
    <div style="flex:1; min-width:0;" onclick="openItem('${convo.item.id}','${itemGarageArg}','thread')">
      <div class="t">${esc(convo.item.title)}</div>
      <div class="p">${convo.item.deleted_at ? '<span style="color:var(--ink-soft); font-weight:600;">Listing removed</span>' : '$'+Number(convo.item.price).toFixed(2)}</div>
    </div>
    ${!convo.item.deleted_at ? `<div class="badge ${convo.item.status.toLowerCase()}" style="flex:0 0 auto;">${convo.item.status}</div>` : ''}`;

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
  checkForStatusSuggestion(messages);
}
function checkForStatusSuggestion(messages){
  const banner = document.getElementById('statusSuggestionBanner');
  if (!banner) return;
  const item = currentConversation?.item;
  const isSeller = currentConversation && session.user.id === currentConversation.seller_id;
  if (!isSeller || !item || item.deleted_at || messages.length === 0) { banner.style.display = 'none'; return; }

  const last = messages[messages.length - 1];
  const text = (last.body || '').toLowerCase();
  let suggested = null;
  if (/\bsold\b/.test(text)) suggested = 'Sold';
  else if (/\breserv/.test(text)) suggested = 'Reserved';

  if (!suggested || item.status === suggested) { banner.style.display = 'none'; return; }

  banner.style.display = 'flex';
  banner.innerHTML = `
    <span>💡 Mark "${esc(item.title)}" as ${suggested}?</span>
    <div class="actions">
      <button class="btn small" onclick="applyChatStatusSuggestion('${suggested}')">Yes</button>
      <button class="btn small ghost" onclick="document.getElementById('statusSuggestionBanner').style.display='none'">Dismiss</button>
    </div>`;
}
window.applyChatStatusSuggestion = async function(status){
  const item = currentConversation?.item;
  if (!item) return;
  const { error } = await supabase.from('items').update({status}).eq('id', item.id);
  if (error) { toast('Could not update status.'); console.error(error); return; }
  item.status = status;
  const badge = document.querySelector('#threadItemStrip .badge');
  if (badge) { badge.className = 'badge ' + status.toLowerCase(); badge.textContent = status; }
  const myIt = myItems.find(i=>i.id===item.id);
  if (myIt) myIt.status = status;
  document.getElementById('statusSuggestionBanner').style.display = 'none';
  toast(`Marked as ${status}`);
};
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
  const sorted = data.slice().sort((a,b)=>{
    const aMsgs = a.messages || [], bMsgs = b.messages || [];
    const aTime = aMsgs.length ? new Date(aMsgs[aMsgs.length-1].created_at).getTime() : 0;
    const bTime = bMsgs.length ? new Date(bMsgs[bMsgs.length-1].created_at).getTime() : 0;
    return bTime - aTime;
  });
  box.innerHTML = sorted.map(c=>{
    const otherParty = c.buyer_id === session.user.id ? c.seller : c.buyer;
    const msgs = c.messages || [];
    const last = msgs[msgs.length-1];
    const isUnread = unreadConversationIds.has(c.id);
    return `
    <div class="convo-card" onclick="openThread('${c.id}')">
      <div class="convo-thumb">${mediaFill(c.item)}</div>
      <div class="convo-info">
        <div class="convo-name">${esc(otherParty?.display_name || 'Neighbour')}</div>
        <div class="convo-item">${esc(c.item.title)} · ${c.item.deleted_at ? '<span style="color:var(--ink-soft); font-weight:600;">Listing removed</span>' : '<span class="convo-price">$'+Number(c.item.price).toFixed(2)+'</span>'}</div>
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
function buildMyGarageStatusChips(){
  const box = document.getElementById('myGarageStatusChips');
  if (!box) return;
  box.innerHTML = ['All','Available','Reserved','Sold'].map(s=>
    `<div class="chip ${s===myGarageStatusFilter?'active':''}" onclick="setMyGarageStatusFilter('${s}')">${s}</div>`
  ).join('');
}
window.setMyGarageStatusFilter = function(s){
  myGarageStatusFilter = s;
  renderMyGarage();
};
window.renderMyGarage = function(){
  document.getElementById('myBlockTile').innerHTML = `<div class="num">${esc(myGarage.block)}</div><div class="town">${esc((myGarage.town||'').toUpperCase())}</div>`;
  document.getElementById('myGarageNameText').textContent = myGarage.display_name || 'Your Garage';
  document.getElementById('myAddrLine').textContent = `Blk ${myGarage.block}, ${myGarage.town}${myGarage.neighbourhood ? ' ('+myGarage.neighbourhood+')' : ''}`;
  document.getElementById('myTaglineDisplay').textContent = myGarage.is_pro
    ? (myGarage.tagline || 'Add a custom tagline below to make your garage stand out.')
    : 'Welcome to my garage — have a look around!';
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
      <input type="text" id="taglineInput" maxlength="80" value="${esc(myGarage.tagline||'')}">
      <button class="btn small" style="margin-top:8px;" onclick="saveTagline()">Save tagline</button>
    </div>` : `
    <div class="pro-banner" onclick="show('pro')">
      <div class="top"><div class="kicker">Sell more, often?</div><div style="font-size:18px;">→</div></div>
      <h3>Go Pro Garage</h3>
      <p>Every extra photo takes extra storage space, which costs us to host — so 3 photos per item (up from the free 1), a custom garage tagline, a Pro badge, and 3 free boosts every month — $2.90/mo.</p>
    </div>`;

  buildMyGarageStatusChips();
  const box = document.getElementById('myItemsList');
  let sortedItems = myGarageStatusFilter === 'All'
    ? sortByStatusPriority(myItems)
    : myItems.filter(it => it.status === myGarageStatusFilter);
  box.innerHTML = myItems.length===0
    ? `<div class="empty"><div class="glyph">📦</div><p>Your garage is empty.<br>List your first item — someone in your block might need exactly that.</p></div>`
    : sortedItems.length===0
    ? `<div class="empty"><p>No ${myGarageStatusFilter.toLowerCase()} items.</p></div>`
    : sortedItems.map(it=>`
      <div class="my-item-row" style="position:relative;">
        ${isActivelyBoosted(it) ? '<div class="mi-boost-flag" style="top:6px; left:6px;">🔥</div>' : ''}
        <div class="row-top">
          <div class="ph" onclick="openItem('${it.id}','mine')">${mediaFill(it)}</div>
          <div class="body" onclick="openItem('${it.id}','mine')">
            <div class="t">${esc(it.title)}</div><div class="p">$${Number(it.price).toFixed(2)}</div>
          </div>
          <div class="del-x" onclick="deleteItem('${it.id}')">✕</div>
        </div>
        <div class="row-bottom">
          <div class="status-pills">
            <div class="status-pill ${it.status==='Available'?'active available':''}" onclick="setStatus('${it.id}','Available')">Available</div>
            <div class="status-pill ${it.status==='Reserved'?'active reserved':''}" onclick="setStatus('${it.id}','Reserved')">Reserved</div>
            <div class="status-pill ${it.status==='Sold'?'active sold':''}" onclick="setStatus('${it.id}','Sold')">Sold</div>
          </div>
          ${it.status==='Sold'
            ? `<div class="boost-btn is-disabled" title="Can't boost a sold item">🔥 Sold</div>`
            : isActivelyBoosted(it)
              ? `<div class="boost-btn is-boosted is-disabled">🔥 ${boostTimeLeft(it.boost_expires_at)}</div>`
              : `<div class="boost-btn" onclick="openBoost('${it.id}')">🔥 Boost</div>`}
        </div>
      </div>`).join('');
};
window.saveTagline = async function(){
  const value = document.getElementById('taglineInput').value.trim();
  const { error } = await supabase.from('garages').update({tagline: value}).eq('id', session.user.id);
  if (error) { toast('Could not save tagline.'); console.error(error); return; }
  myGarage.tagline = value;
  toast('✓ Tagline saved!');
};
window.saveGarageDetails = async function(){
  const display_name = document.getElementById('editGarageName').value.trim();
  const block = document.getElementById('editGarageBlock').value.trim();
  const town = document.getElementById('editGarageTown').value;
  const neighbourhood = document.getElementById('editGarageNeighbourhood').value.trim();
  const msg = document.getElementById('editGarageMsg');
  if (!display_name || !block) { msg.className='auth-msg error'; msg.textContent='Name and block are both required.'; return; }

  msg.className = 'auth-msg'; msg.textContent = 'Saving…';
  const { error } = await supabase.from('garages').update({ display_name, block, town, neighbourhood }).eq('id', session.user.id);
  if (error) { msg.className='auth-msg error'; msg.textContent = error.message; return; }

  myGarage.display_name = display_name;
  myGarage.block = block;
  myGarage.town = town;
  myGarage.neighbourhood = neighbourhood;
  msg.className = 'auth-msg ok'; msg.textContent = '✓ Saved!';
  renderProfile();
  toast('Garage details updated');
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
   ADD / EDIT ITEM (with real photo upload to Supabase Storage)
========================================================= */
function photoCap(){ return myGarage.is_pro ? 3 : 1; }
window.openEditItem = function(itemId){
  editingItemId = itemId;
  show('additem');
};
window.backFromAddItem = function(){
  const wasEditing = !!editingItemId;
  editingItemId = null;
  if (wasEditing && currentItemId) {
    openItem(currentItemId, 'mine');
  } else {
    show('mygarage');
  }
};
window.renderAddItemForm = function(){
  document.getElementById('itemFormMsg').textContent='';
  formPhotos = [];

  const editing = editingItemId ? myItems.find(i=>i.id===editingItemId) : null;
  document.getElementById('addItemTitle').textContent = editing ? 'EDIT LISTING' : 'LIST AN ITEM';
  document.getElementById('addItemSubmitBtn').textContent = editing ? 'Save changes' : 'Publish to my garage';

  if (editing) {
    document.getElementById('fTitle').value = editing.title;
    document.getElementById('fPrice').value = editing.price;
    formCategories = [...(editing.categories || [])];
    document.getElementById('fCondition').value = editing.condition;
    document.getElementById('fDesc').value = editing.description || '';
    formPhotos = (editing.photos || []).map(url => ({ existingUrl: url, previewUrl: url }));
  } else {
    document.getElementById('fTitle').value='';
    document.getElementById('fPrice').value='';
    document.getElementById('fDesc').value='';
    document.getElementById('fCondition').value='Like new';
    formCategories = [];
  }
  buildFCategoryChips();
  renderPhotoUploadRow();
};
function buildFCategoryChips(){
  const box = document.getElementById('fCategoryChips');
  box.innerHTML = CATEGORIES.map(c =>
    `<div class="chip ${formCategories.includes(c)?'active':''}" onclick="toggleFCategory('${c.replace(/'/g,"\\'")}')">${c}</div>`
  ).join('');
}
window.toggleFCategory = function(cat){
  const i = formCategories.indexOf(cat);
  if (i === -1) formCategories.push(cat); else formCategories.splice(i,1);
  buildFCategoryChips();
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
    html += `<div class="photo-slot" style="cursor:pointer; border-color:var(--hdb-red);" onclick="show('pro')"><div class="lockmsg">🔒 Needs Pro storage</div></div>`;
  }
  row.innerHTML = html;
  document.getElementById('photoHint').innerHTML = myGarage.is_pro
    ? `Pro Garage: up to 3 photos per item. ${formPhotos.length}/3 added.`
    : `Everyone gets 1 free photo per item — extra photos need extra storage space to host, which is why <span style="color:var(--zinc-blue); font-weight:700; cursor:pointer;" onclick="show('pro')">Pro Garage</span> (unlocking up to 3) is a paid upgrade.`;
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

async function readFileSafely(file){
  // Some iOS Safari photo selections (particularly with iCloud Photo
  // Library's "Optimize Storage" on) can hand us a File object whose full
  // content hasn't actually finished downloading from iCloud yet -- it
  // looks selected and previews fine, but uploading it directly can send
  // essentially nothing. Explicitly reading it first forces the browser
  // to fully materialize the data, and lets us catch a genuinely empty
  // file with a clear message instead of a confusing server-side error.
  let buf;
  try {
    buf = await file.arrayBuffer();
  } catch (e) {
    throw new Error('Could not read this photo — try selecting it again.');
  }
  if (!buf || buf.byteLength === 0) {
    throw new Error('This photo has no readable content yet (this can happen with iCloud-optimized photos) — try again in a moment, or pick a different photo.');
  }
  return new Blob([buf], { type: file.type || 'image/jpeg' });
}
function extractStoragePath(url){
  const marker = '/item-photos/';
  const i = url.indexOf(marker);
  return i === -1 ? null : url.slice(i + marker.length);
}

window.submitItem = async function(){
  const title = document.getElementById('fTitle').value.trim();
  const rawPrice = parseFloat(document.getElementById('fPrice').value);
  const price = isNaN(rawPrice) ? rawPrice : Math.round(rawPrice * 100) / 100;
  const categories = [...formCategories];
  const condition = document.getElementById('fCondition').value;
  const description = document.getElementById('fDesc').value.trim();
  const msg = document.getElementById('itemFormMsg');

  if (!title || isNaN(price)) { msg.className='auth-msg error'; msg.textContent='Please add at least a title and price.'; return; }
  if (categories.length === 0) { msg.className='auth-msg error'; msg.textContent='Pick at least one category.'; return; }

  const flaggedTerm = checkForbiddenContent(title + ' ' + description);
  if (flaggedTerm) {
    msg.className = 'auth-msg error';
    msg.textContent = `This listing can't be published — it appears to reference "${flaggedTerm}", which isn't allowed on Barang Where. If this is a mistake, please rephrase your listing.`;
    return;
  }

  if (editingItemId) {
    // ---------- EDIT existing item ----------
    msg.className = 'auth-msg'; msg.textContent = 'Saving…';
    const original = myItems.find(i=>i.id===editingItemId);
    const keptUrls = formPhotos.filter(p=>p.existingUrl).map(p=>p.existingUrl);
    const removedUrls = (original.photos || []).filter(url => !keptUrls.includes(url));
    const newFiles = formPhotos.filter(p=>p.file);

    // Delete any removed photo files from storage.
    const removedPaths = removedUrls.map(extractStoragePath).filter(Boolean);
    if (removedPaths.length) {
      const { error: rmErr } = await supabase.storage.from('item-photos').remove(removedPaths);
      if (rmErr) console.error('Could not remove old photo files:', rmErr);
    }

    // Upload any newly added photos.
    const newUrls = [];
    let uploadFailures = 0;
    let lastUploadError = null;
    for (const p of newFiles) {
      const ext = (p.file.name.split('.').pop() || 'jpg').toLowerCase();
      const path = `${session.user.id}/${editingItemId}-${Date.now()}-${newUrls.length}.${ext}`;
      let uploadedOk = false;
      try {
        const safeBlob = await readFileSafely(p.file);
        const { error: upErr } = await supabase.storage.from('item-photos').upload(path, safeBlob, {
          cacheControl: '3600', upsert: false, contentType: p.file.type || 'image/jpeg'
        });
        if (upErr) throw upErr;
        uploadedOk = true;
      } catch (e) {
        console.error('Photo upload failed:', e);
        uploadFailures++; lastUploadError = e;
      }
      if (uploadedOk) {
        const { data: pub } = supabase.storage.from('item-photos').getPublicUrl(path);
        newUrls.push(pub.publicUrl);
      }
    }

    const finalPhotos = [...keptUrls, ...newUrls];
    const { error } = await supabase.from('items').update({
      title, price, categories, condition, description, photos: finalPhotos
    }).eq('id', editingItemId);
    if (error) { msg.className='auth-msg error'; msg.textContent = error.message; return; }

    Object.assign(original, { title, price, categories, condition, description, photos: finalPhotos });
    const savedId = editingItemId;
    editingItemId = null;
    toast(uploadFailures > 0
      ? `Saved, but ${uploadFailures} photo${uploadFailures===1?'':'s'} failed to upload (${lastUploadError?.message || 'unknown error'}). Try adding ${uploadFailures===1?'it':'them'} again.`
      : 'Changes saved!');
    openItem(savedId, 'mine');
    return;
  }

  // ---------- CREATE new item ----------
  msg.className = 'auth-msg'; msg.textContent = 'Publishing…';

  // 1. Insert the item row first so we have an id to namespace photo paths.
  const { data: item, error: insertErr } = await supabase.from('items').insert({
    garage_id: session.user.id, title, price, categories, condition, description, photos: []
  }).select().single();
  if (insertErr) { msg.className='auth-msg error'; msg.textContent = insertErr.message; return; }

  // 2. Upload any photos to Storage, under a per-user folder.
  const urls = [];
  let uploadFailures = 0;
  let lastUploadError = null;
  for (const p of formPhotos) {
    const ext = (p.file.name.split('.').pop() || 'jpg').toLowerCase();
    const path = `${session.user.id}/${item.id}-${Date.now()}-${urls.length}.${ext}`;
    let uploadedOk = false;
    try {
      const safeBlob = await readFileSafely(p.file);
      const { error: upErr } = await supabase.storage.from('item-photos').upload(path, safeBlob, {
        cacheControl: '3600', upsert: false, contentType: p.file.type || 'image/jpeg'
      });
      if (upErr) throw upErr;
      uploadedOk = true;
    } catch (e) {
      console.error('Photo upload failed:', e);
      uploadFailures++; lastUploadError = e;
    }
    if (uploadedOk) {
      const { data: pub } = supabase.storage.from('item-photos').getPublicUrl(path);
      urls.push(pub.publicUrl);
    }
  }

  // 3. Attach the uploaded URLs back onto the item.
  if (urls.length) {
    await supabase.from('items').update({ photos: urls }).eq('id', item.id);
    item.photos = urls;
  }

  myItems.unshift(item);
  show('mygarage');
  if (uploadFailures > 0) {
    toast(`Listed, but ${uploadFailures} photo${uploadFailures===1?'':'s'} failed to upload (${lastUploadError?.message || 'unknown error'}). You can add ${uploadFailures===1?'it':'them'} via Edit.`);
  } else {
    toast('Listed! Neighbours can see it now.');
  }
};

/* =========================================================
   BOOST A LISTING
========================================================= */
window.openBoost = function(itemId){
  const it = myItems.find(i=>i.id===itemId);
  if (isActivelyBoosted(it)) { toast(`Already boosted until ${new Date(it.boost_expires_at).toLocaleString()}.`); return; }
  boostingItemId = itemId;
  selectedBoostOption = 0;
  document.getElementById('boostItemStrip').innerHTML = `
    <div class="ph">${mediaFill(it)}</div><div><div class="t">${esc(it.title)}</div><div class="p">$${Number(it.price).toFixed(2)}</div></div>`;
  renderBoostOptions();
  show('boost');
};
function renderBoostOptions(){
  const credits = myGarage.free_boost_credits || 0;
  const hasFreeCredit = myGarage.is_pro && credits > 0;
  const box = document.getElementById('boostOptions');
  box.innerHTML = BOOST_OPTIONS.map((opt,i)=>`
    <div class="price-card ${i===selectedBoostOption?'selected':''}" onclick="selectBoost(${i})">
      <div class="l"><div class="t">${opt.label}</div><div class="s">${opt.sub}</div></div>
      <div class="right"><div class="p">$${opt.price.toFixed(2)}</div><div class="radio-dot"></div></div>
    </div>`).join('') + (hasFreeCredit ? `
    <div class="price-card ${selectedBoostOption===99?'selected':''}" onclick="selectBoost(99)">
      <div class="l"><div class="t">Use free Pro credit</div><div class="s">24 hours, no charge — ${credits} credit${credits===1?'':'s'} left</div></div>
      <div class="right"><div class="p">$0</div><div class="radio-dot"></div></div>
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
window.renderProScreen = function(){
  const subBlock = document.getElementById('proSubscribeBlock');
  const manageBlock = document.getElementById('proManageBlock');
  if (myGarage.is_pro) {
    subBlock.style.display = 'none';
    manageBlock.style.display = 'block';
    const credits = myGarage.free_boost_credits || 0;
    document.getElementById('proManageSummary').textContent =
      `3 photos per item, a custom tagline, and ${credits} free boost credit${credits===1?'':'s'} left this month.`;
  } else {
    subBlock.style.display = 'block';
    manageBlock.style.display = 'none';
  }
};
window.cancelPro = async function(){
  const ok = confirm("Cancel Pro Garage? Your tagline will clear, remaining free boost credits will be removed, and any item photos beyond the first will be hidden until you're Pro again. This won't delete anything — just hides it.");
  if (!ok) return;

  const { error } = await supabase.from('garages').update({
    is_pro: false, pro_expires_at: null, free_boost_credits: 0, tagline: ''
  }).eq('id', session.user.id);
  if (error) { toast('Could not cancel Pro.'); console.error(error); return; }

  myGarage.is_pro = false; myGarage.pro_expires_at = null; myGarage.free_boost_credits = 0; myGarage.tagline = '';
  toast('Pro Garage cancelled.');
  show('mygarage');
};

/* =========================================================
   PROFILE
========================================================= */
window.renderProfile = function(){
  document.getElementById('profileBlockTile').innerHTML = `<div class="num">${esc(myGarage.block)}</div><div class="town">${esc((myGarage.town||'').toUpperCase())}</div>`;
  document.getElementById('profileName').textContent = myGarage.display_name;
  document.getElementById('profileAddr').textContent = `Blk ${myGarage.block}, ${myGarage.town}${myGarage.neighbourhood ? ' ('+myGarage.neighbourhood+')' : ''}`;

  document.getElementById('garageDetailsSummary').textContent = `${myGarage.display_name || '—'} · Blk ${myGarage.block || '—'}, ${myGarage.town || '—'}`;
  document.getElementById('editGarageName').value = myGarage.display_name || '';
  document.getElementById('editGarageBlock').value = myGarage.block || '';
  document.getElementById('editGarageTown').value = myGarage.town || 'Sengkang';
  document.getElementById('editGarageNeighbourhood').value = myGarage.neighbourhood || '';
  document.getElementById('editGarageMsg').textContent = '';
  renderHomeAddressStatus();

  const mode = myGarage.location_mode || 'fixed';
  const browseMissing = myGarage.browse_lat === null || myGarage.browse_lat === undefined;
  document.getElementById('modeFixedBtn').className = 'status-pill' + (mode==='fixed' ? ' active mode-fixed' : '');
  document.getElementById('modeLiveBtn').className = 'status-pill' + (mode==='live' ? ' active mode-live' : '');

  const hint = document.getElementById('locationModeHint');
  const actionBtn = document.getElementById('locationActionBtn');
  if (mode === 'fixed') {
    hint.textContent = browseMissing
      ? "Your garage's home address isn't set yet — set it below under Garage Details first."
      : "You're browsing Nearby from your garage's home location — this always matches automatically in Fixed mode.";
    actionBtn.style.display = 'none';
  } else {
    hint.textContent = browseMissing
      ? "Tap below to start browsing from your current position."
      : (locationJustSwitched
          ? "⚠️ You just switched to Live — tap the button below now to actually browse from where you are."
          : "You're browsing Nearby from wherever you last refreshed below — your garage's own address hasn't moved.");
    actionBtn.style.display = '';
    actionBtn.textContent = '📡 Refresh my current position';
  }
  hint.classList.toggle('needs-attention', locationJustSwitched && mode === 'live');
  actionBtn.classList.toggle('needs-attention', locationJustSwitched && mode === 'live');
};

window.renderLiked = async function(){
  const box = document.getElementById('likedGrid');
  box.innerHTML = `<div class="empty" style="grid-column:1/-1;"><div class="glyph">♡</div><p>Loading…</p></div>`;

  const { data, error } = await supabase
    .from('saved_items')
    .select(`
      item_id, created_at,
      item:items(id,title,price,photos,categories,condition,status,boosted,garage_id,deleted_at)
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

window.setLikedTab = function(tab){
  document.getElementById('likedTabItems').classList.toggle('active', tab==='items');
  document.getElementById('likedTabGarages').classList.toggle('active', tab==='garages');
  document.getElementById('likedGrid').style.display = tab==='items' ? 'grid' : 'none';
  document.getElementById('likedGaragesGrid').style.display = tab==='garages' ? 'flex' : 'none';
  if (tab==='garages') renderLikedGarages();
};

window.renderLikedGarages = async function(){
  const box = document.getElementById('likedGaragesGrid');
  box.innerHTML = `<div class="empty"><div class="glyph">♡</div><p>Loading…</p></div>`;

  const { data, error } = await supabase
    .from('saved_garages')
    .select(`
      garage_id, created_at,
      garage:garages(id,display_name,block,town,lat,lng,rating,items(*))
    `)
    .eq('user_id', session.user.id)
    .order('created_at', {ascending:false});

  if (error) { box.innerHTML = `<div class="empty"><p>Could not load liked garages.</p></div>`; console.error(error); return; }

  const garages = (data || [])
    .filter(row => row.garage)
    .map(row => ({
      ...row.garage,
      items: (row.garage.items || []).filter(it => !it.deleted_at),
      distance: haversineMeters(myGarage.browse_lat, myGarage.browse_lng, row.garage.home_lat, row.garage.home_lng)
    }));

  if (garages.length === 0){
    box.innerHTML = `<div class="empty"><div class="glyph">♡</div><p>No liked garages yet.<br>Tap the heart on a garage page to save it here — handy for finding your way back even if you're away from home.</p></div>`;
    return;
  }
  box.innerHTML = garages.map(g => garageCardHtml(g)).join('');
};

/* =========================================================
   START
========================================================= */
boot();
