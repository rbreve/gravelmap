// The rider's position: a blue arrow pointing where you're heading, and the locate (◎) button.
// Heading comes from the GPS course while moving and from the phone's compass when standing still.

const MOVING_SPEED = 1.5; // m/s; below this the GPS course is noise, so the compass takes over

const userLoc = {
  pos: null,          // latest GPS [lng, lat]
  heading: null,      // degrees clockwise from north; null until known
  gpsHeadingAt: 0,    // when the GPS course last set the heading (ms)
  hasCompass: false,
  bearingFrom: null,  // no compass and no GPS course (desktop): heading from movement
  watchId: null,
  following: false,   // camera keeps the rider in view
  listeners: [],
  marker: null,
  shown: { pos: null, heading: null }, // smoothed values that are actually drawn
};

function onLocation(fn) { userLoc.listeners.push(fn); }

function metersBetween(a, b) {
  const kx = 111320 * Math.cos(a[1] * Math.PI / 180);
  return Math.hypot((b[0] - a[0]) * kx, (b[1] - a[1]) * 110540);
}

function bearingBetween(a, b) {
  const kx = 111320 * Math.cos(a[1] * Math.PI / 180);
  return (Math.atan2((b[0] - a[0]) * kx, (b[1] - a[1]) * 110540) * 180 / Math.PI + 360) % 360;
}

// Signed shortest turn from b to a, in degrees (-180..180).
function angleDiff(a, b) {
  return ((a - b + 540) % 360) - 180;
}

// --- GPS + compass ------------------------------------------------------------------

function startLocation() {
  if (!navigator.geolocation) {
    setStatus('Location is not available in this browser');
    return;
  }
  userLoc.watchId = navigator.geolocation.watchPosition(onPosition, onLocationError,
    { enableHighAccuracy: true, maximumAge: 1000, timeout: 30000 });
  if (!userLoc.marker) {
    const el = document.createElement('div');
    el.className = 'user-loc no-heading';
    el.innerHTML = '<span class="dot"></span><svg viewBox="0 0 40 40"><path d="M20 3 L34 35 L20 27 L6 35 Z"/></svg>';
    userLoc.marker = new maplibregl.Marker({ element: el, rotationAlignment: 'map', pitchAlignment: 'map' });
  }
  updateLocateButton();
  requestAnimationFrame(tick);
}

function stopLocation() {
  if (userLoc.watchId !== null) navigator.geolocation.clearWatch(userLoc.watchId);
  userLoc.watchId = null;
  userLoc.pos = null;
  userLoc.following = false;
  userLoc.shown = { pos: null, heading: null };
  userLoc.marker?.remove();
  userLoc.marker?.getElement().classList.add('no-heading');
  updateLocateButton();
}

function onPosition(p) {
  const c = p.coords;
  const pos = [c.longitude, c.latitude];
  if (c.speed > MOVING_SPEED && Number.isFinite(c.heading)) {
    userLoc.heading = c.heading;
    userLoc.gpsHeadingAt = Date.now();
  } else if (!userLoc.hasCompass) {
    if (!userLoc.bearingFrom) userLoc.bearingFrom = pos;
    else if (metersBetween(userLoc.bearingFrom, pos) > 10) {
      userLoc.heading = bearingBetween(userLoc.bearingFrom, pos);
      userLoc.bearingFrom = pos;
    }
  }
  const first = !userLoc.pos;
  userLoc.pos = pos;
  if (first) updateLocateButton();
  for (const fn of userLoc.listeners) fn(pos, first);
}

function onLocationError(err) {
  if (err.code === err.PERMISSION_DENIED) {
    stopLocation();
    setStatus('Location permission denied');
  }
  // Timeouts and lost signal: keep watching, the next fix will come through.
}

// iOS only hands out compass data after a permission prompt, which must come from a tap.
let compassRequested = false;
function requestCompass() {
  if (compassRequested || !window.DeviceOrientationEvent) return;
  compassRequested = true;
  const listen = () => window.addEventListener(
    'ondeviceorientationabsolute' in window ? 'deviceorientationabsolute' : 'deviceorientation', onCompass);
  if (typeof DeviceOrientationEvent.requestPermission === 'function') {
    DeviceOrientationEvent.requestPermission().then(r => { if (r === 'granted') listen(); }).catch(() => {});
  } else {
    listen();
  }
}

function onCompass(e) {
  let h;
  if (e.webkitCompassHeading != null) h = e.webkitCompassHeading; // iOS
  else if (e.absolute && e.alpha != null) h = 360 - e.alpha;      // Android
  else return;
  h = (h + (screen.orientation?.angle || 0) + 360) % 360;
  userLoc.hasCompass = true;
  if (Date.now() - userLoc.gpsHeadingAt > 3000) userLoc.heading = h;
}

// --- drawing + camera ------------------------------------------------------------------

// GPS fixes arrive about once a second and the compass jitters, so the arrow (and the camera,
// when following) glides towards the latest values every frame.
function tick() {
  if (userLoc.watchId === null) return;
  requestAnimationFrame(tick);
  const s = userLoc.shown;
  const m = userLoc.marker;
  if (!userLoc.pos) return;

  let changed = false;
  if (!s.pos) {
    s.pos = [...userLoc.pos];
    m.setLngLat(s.pos).addTo(map);
    if (userLoc.following) recenter();
  } else {
    const dx = userLoc.pos[0] - s.pos[0];
    const dy = userLoc.pos[1] - s.pos[1];
    if (Math.abs(dx) + Math.abs(dy) > 1e-7) {
      s.pos[0] += dx * 0.12;
      s.pos[1] += dy * 0.12;
      changed = true;
    }
  }
  if (userLoc.heading !== null) {
    if (s.heading === null) {
      s.heading = userLoc.heading;
      m.getElement().classList.remove('no-heading');
      changed = true;
    } else {
      const d = angleDiff(userLoc.heading, s.heading);
      if (Math.abs(d) > 0.2) {
        s.heading = (s.heading + d * 0.15 + 360) % 360;
        changed = true;
      }
    }
  }
  if (!changed) return;

  m.setLngLat(s.pos);
  if (s.heading !== null) m.setRotation(s.heading);
  if (userLoc.following && !map.isEasing()) {
    map.jumpTo(navigation.active && s.heading !== null ? { center: s.pos, bearing: s.heading } : { center: s.pos });
  }
}

function recenter() {
  userLoc.following = true;
  updateLocateButton();
  const center = userLoc.shown.pos;
  if (!center) return; // the first fix will call us again
  if (navigation.active) {
    map.easeTo({ center, bearing: userLoc.shown.heading ?? map.getBearing(), ...navCamera(), duration: 800 });
  } else {
    map.easeTo({ center, zoom: Math.max(map.getZoom(), 14), duration: 800 });
  }
}

map.on('dragstart', () => {
  if (!userLoc.following) return;
  userLoc.following = false;
  updateLocateButton();
});

// --- locate button --------------------------------------------------------------------

const locateButton = document.createElement('button');
locateButton.type = 'button';
locateButton.className = 'maplibregl-ctrl-geolocate';
locateButton.title = locateButton.ariaLabel = 'Show my location';
locateButton.innerHTML = '<span class="maplibregl-ctrl-icon" aria-hidden="true"></span>';
locateButton.onclick = () => {
  requestCompass();
  if (userLoc.watchId === null) {
    userLoc.following = true;
    startLocation();
  } else if (!userLoc.following || navigation.active) {
    recenter();
  } else {
    stopLocation();
  }
};

// Reuses MapLibre's geolocate button styles: spinning while waiting, blue while following.
function updateLocateButton() {
  const on = userLoc.watchId !== null;
  const cl = locateButton.classList;
  cl.toggle('maplibregl-ctrl-geolocate-waiting', on && !userLoc.pos);
  cl.toggle('maplibregl-ctrl-geolocate-active', on && !!userLoc.pos && userLoc.following);
  cl.toggle('maplibregl-ctrl-geolocate-background', on && !!userLoc.pos && !userLoc.following);
  document.getElementById('nav-recenter').classList.toggle('hidden', userLoc.following);
}

map.addControl({
  onAdd() {
    const div = document.createElement('div');
    div.className = 'maplibregl-ctrl maplibregl-ctrl-group';
    div.appendChild(locateButton);
    return div;
  },
  onRemove() {},
}, 'top-right');
