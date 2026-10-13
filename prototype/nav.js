// Navigation mode (GO): a tilted, heading-up map that follows the rider along the route, with the
// distance left, re-routing when you leave the route, and the screen kept awake.

const OFF_ROUTE_M = 40;  // this far from the line on 3 fixes in a row → find a new route
const ARRIVED_M = 25;

const navigation = {
  active: false,
  offRoute: 0,
  lastReroute: 0,
  wakeLock: null,
  line: null, // route coordinates + cumulative metres, cached per route
};

// Rider sits low on the screen so you see more of what's ahead.
function navCamera() {
  return {
    pitch: 50,
    zoom: Math.max(map.getZoom(), 16),
    padding: { top: map.getContainer().clientHeight * 0.45, bottom: 0, left: 0, right: 0 },
  };
}

function startNavigation() {
  requestCompass();
  if (userLoc.watchId === null) startLocation();
  // Navigation always runs from where you actually are, not from a picked start point.
  if (routing.start) {
    routing.start.remove();
    routing.start = null;
    if (userLoc.pos) updateRoute(false); // otherwise routing.js does it on the first GPS fix
  }
  navigation.active = true;
  navigation.offRoute = 0;
  document.getElementById('route-card').classList.add('hidden');
  document.getElementById('nav-bar').classList.remove('hidden');
  document.getElementById('nav-remaining').textContent = 'Waiting for GPS…';
  document.getElementById('nav-eta').textContent = '';
  requestWakeLock();
  recenter();
}

function stopNavigation() {
  navigation.active = false;
  userLoc.following = false;
  updateLocateButton();
  document.getElementById('nav-bar').classList.add('hidden');
  if (routing.end) document.getElementById('route-card').classList.remove('hidden');
  map.easeTo({ pitch: 0, bearing: 0, padding: { top: 0, bottom: 0, left: 0, right: 0 }, duration: 600 });
  navigation.wakeLock?.release().catch(() => {});
  navigation.wakeLock = null;
}

async function requestWakeLock() {
  try {
    navigation.wakeLock = await navigator.wakeLock?.request('screen');
  } catch { /* unsupported or refused: the screen may sleep */ }
}

// The browser drops the wake lock whenever the tab is hidden.
document.addEventListener('visibilitychange', () => {
  if (navigation.active && document.visibilityState === 'visible') requestWakeLock();
});

function routeLine() {
  const f = routing.feature;
  if (navigation.line?.feature !== f) {
    const coords = f.geometry.coordinates;
    const cum = [0];
    for (let i = 1; i < coords.length; i++) cum.push(cum[i - 1] + metersBetween(coords[i - 1], coords[i]));
    navigation.line = { feature: f, coords, cum };
  }
  return navigation.line;
}

// Closest point on the route: how far off it we are, and how far along it that point is.
function projectOnRoute(pos, line) {
  const kx = 111320 * Math.cos(pos[1] * Math.PI / 180);
  const ky = 110540;
  const c = line.coords;
  let best = { dist: Infinity, along: 0 };
  for (let i = 0; i < c.length - 1; i++) {
    const ax = (c[i][0] - pos[0]) * kx, ay = (c[i][1] - pos[1]) * ky;
    const dx = (c[i + 1][0] - c[i][0]) * kx, dy = (c[i + 1][1] - c[i][1]) * ky;
    const len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
    const dist = Math.hypot(ax + t * dx, ay + t * dy);
    if (dist < best.dist) best = { dist, along: line.cum[i] + t * (line.cum[i + 1] - line.cum[i]) };
  }
  return best;
}

onLocation(pos => {
  if (!navigation.active || !routing.feature) return;
  const line = routeLine();
  if (metersBetween(pos, line.coords[line.coords.length - 1]) < ARRIVED_M) {
    stopNavigation();
    setStatus('You have arrived!');
    setTimeout(() => { if (statusEl.textContent === 'You have arrived!') setStatus(''); }, 5000);
    return;
  }

  const { dist, along } = projectOnRoute(pos, line);
  if (dist > OFF_ROUTE_M) {
    if (++navigation.offRoute >= 3 && Date.now() - navigation.lastReroute > 15000) {
      navigation.offRoute = 0;
      navigation.lastReroute = Date.now();
      updateRoute(false);
    }
  } else {
    navigation.offRoute = 0;
  }

  const total = line.cum[line.cum.length - 1];
  const left = Math.max(0, total - along);
  const secs = Number(routing.feature.properties['total-time']) * (total ? left / total : 0);
  const mins = Math.round(secs / 60);
  const arrive = new Date(Date.now() + secs * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  document.getElementById('nav-remaining').textContent =
    left < 1000 ? `${Math.round(left / 10) * 10} m` : `${(left / 1000).toFixed(1)} km`;
  document.getElementById('nav-eta').textContent =
    `${mins >= 60 ? `${Math.floor(mins / 60)} h ${mins % 60} min` : `${mins} min`} · arrive ${arrive}`;
});

document.getElementById('route-go').onclick = startNavigation;
document.getElementById('nav-exit').onclick = stopNavigation;
document.getElementById('nav-recenter').onclick = recenter;
