// Gravel routing via the public BRouter server (https://brouter.de), which ships a gravel profile.

const BROUTER_URL = 'https://brouter.de/brouter';

// Presets on top of BRouter's stock gravel profile. Its switches can be overridden per request
// with `profile:<name>=<value>`; on a Nuuksio → Espoo test "max" cut asphalt from 75% to 11%.
const ROUTE_MODES = {
  max: { label: 'Max gravel (forests, avoid towns)', params: { prefer_unpaved_paths: 1, avoid_towns: 1, prefer_forests: 1 } },
  more: { label: 'More gravel', params: { prefer_unpaved_paths: 1 } },
  direct: { label: 'Direct (more asphalt)', params: {} },
};

const routing = {
  start: null,  // maplibregl.Marker, set via "Start here"; otherwise the GPS position is used
  end: null,
  gps: null,    // last [lng, lat] reported by the locate button
  mode: load('routeMode', 'max'),
  inflight: null,
};

geolocate.on('geolocate', e => {
  const firstFix = !routing.gps;
  routing.gps = [e.coords.longitude, e.coords.latitude];
  // A destination picked before location was on: route from here as soon as we know where "here" is.
  if (firstFix && routing.end && !routing.start) updateRoute(true);
});

// Same rules as scripts/classify.py, applied to BRouter's per-segment way tags.
const R_PAVED = new Set(['asphalt', 'paved', 'concrete', 'concrete:plates', 'concrete:lanes',
  'paving_stones', 'sett', 'chipseal', 'metal', 'cobblestone', 'grass_paver']);
const R_GRAVEL = new Set(['gravel', 'fine_gravel', 'compacted', 'unpaved', 'pebblestone']);
const R_ROUGH = new Set(['dirt', 'ground', 'earth', 'grass', 'sand', 'mud', 'rock', 'roots',
  'wood', 'woodchips', 'stone']);

function classifyTags(t) {
  const s = t.surface;
  if (R_PAVED.has(s)) return 'paved';
  if (R_GRAVEL.has(s)) return 'gravel';
  if (R_ROUGH.has(s)) return 'rough';
  if (t.highway === 'track') {
    if (t.tracktype === 'grade1' || t.tracktype === 'grade2') return 'gravel';
    return t.tracktype ? 'rough' : 'unknown';
  }
  if (t.highway === 'path' || t.highway === 'bridleway') return 'rough';
  if (/^(primary|secondary|tertiary)(_link)?$/.test(t.highway)) return 'paved';
  return 'unknown';
}

function addRouteLayers() {
  map.addSource('route', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addLayer({
    id: 'route-casing', type: 'line', source: 'route',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#fff', 'line-width': ['interpolate', ['linear'], ['zoom'], 9, 6, 16, 12] },
  });
  map.addLayer({
    id: 'route-line', type: 'line', source: 'route',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': '#2563eb', 'line-opacity': 0.85,
      'line-width': ['interpolate', ['linear'], ['zoom'], 9, 3.5, 16, 7],
    },
  });

  const select = document.getElementById('route-profile');
  for (const [id, m] of Object.entries(ROUTE_MODES)) select.add(new Option(m.label, id));
  if (!ROUTE_MODES[routing.mode]) routing.mode = 'max';
  select.value = routing.mode;
  select.onchange = () => {
    routing.mode = select.value;
    save('routeMode', routing.mode);
    updateRoute(false);
  };
  document.getElementById('route-clear').onclick = clearRoute;
}

function routeActions(lngLat, popup) {
  const div = document.createElement('div');
  div.className = 'route-actions';
  const go = document.createElement('button');
  go.textContent = '🚴 Go here';
  go.onclick = () => { popup.remove(); setPoint('end', lngLat); };
  const start = document.createElement('button');
  start.textContent = 'Start here';
  start.className = 'secondary';
  start.onclick = () => { popup.remove(); setPoint('start', lngLat); };
  div.append(go, start);
  return div;
}

function setPoint(kind, lngLat) {
  if (!routing[kind]) {
    routing[kind] = new maplibregl.Marker({ color: kind === 'start' ? '#16a34a' : '#dc2626', draggable: true })
      .setLngLat(lngLat)
      .addTo(map);
    routing[kind].on('dragend', () => updateRoute(false));
  } else {
    routing[kind].setLngLat(lngLat);
  }
  updateRoute(true);
}

function startPoint() {
  if (routing.start) return routing.start.getLngLat();
  return routing.gps ? maplibregl.LngLat.convert(routing.gps) : null;
}

async function updateRoute(fit) {
  const from = startPoint();
  const to = routing.end && routing.end.getLngLat();
  if (!to) return;
  if (!from) {
    setStatus('Turn on your location (◎) or tap the map → "Start here"');
    return;
  }

  if (routing.inflight) routing.inflight.abort();
  routing.inflight = new AbortController();
  setStatus('Finding gravel route…');

  const lonlats = `${from.lng.toFixed(6)},${from.lat.toFixed(6)}|${to.lng.toFixed(6)},${to.lat.toFixed(6)}`;
  const params = Object.entries(ROUTE_MODES[routing.mode].params).map(([k, v]) => `&profile:${k}=${v}`).join('');
  const url = `${BROUTER_URL}?lonlats=${lonlats}&profile=gravel&alternativeidx=0&format=geojson${params}`;
  try {
    const res = await fetch(url, { signal: routing.inflight.signal });
    if (!res.ok) throw new Error((await res.text()).trim() || `HTTP ${res.status}`);
    const data = await res.json();
    map.getSource('route').setData(data);
    showSummary(data.features[0].properties);
    setStatus('');
    if (fit) {
      const coords = data.features[0].geometry.coordinates;
      const bounds = coords.reduce((b, c) => b.extend([c[0], c[1]]), new maplibregl.LngLatBounds(coords[0], coords[0]));
      map.fitBounds(bounds, { padding: { top: 70, bottom: 170, left: 40, right: 60 }, maxZoom: 15 });
    }
  } catch (err) {
    if (err.name === 'AbortError') return;
    console.error(err);
    setStatus('No route found: ' + err.message);
  }
}

function showSummary(props) {
  const km = (Number(props['track-length']) / 1000).toFixed(1);
  const climb = props['filtered ascend'];
  const mins = Math.round(Number(props['total-time']) / 60);
  const time = mins >= 60 ? `${Math.floor(mins / 60)} h ${mins % 60} min` : `${mins} min`;
  document.getElementById('route-stats').textContent = `${km} km · ↑ ${climb} m · ~${time}`;

  // messages[0] is the header row; each following row is one segment with its distance and OSM tags.
  const [header, ...rows] = props.messages;
  const iDist = header.indexOf('Distance');
  const iTags = header.indexOf('WayTags');
  const meters = {};
  let total = 0;
  for (const row of rows) {
    const tags = Object.fromEntries(row[iTags].split(' ').filter(Boolean).map(kv => kv.split('=')));
    const d = Number(row[iDist]);
    const cls = classifyTags(tags);
    meters[cls] = (meters[cls] || 0) + d;
    total += d;
  }

  const bar = document.getElementById('route-bar');
  const legend = document.getElementById('route-legend');
  bar.innerHTML = '';
  legend.innerHTML = '';
  for (const c of [...CLASSES].reverse()) {
    const pct = total ? Math.round((meters[c.id] || 0) / total * 100) : 0;
    if (!pct) continue;
    const seg = document.createElement('div');
    seg.style.cssText = `width:${pct}%;background:${c.color}`;
    bar.appendChild(seg);
    const item = document.createElement('span');
    item.innerHTML = `<i style="background:${c.color}"></i>${c.label.split(':')[0]} ${pct}%`;
    legend.appendChild(item);
  }
  document.getElementById('route-card').classList.remove('hidden');
}

function clearRoute() {
  if (routing.inflight) routing.inflight.abort();
  for (const kind of ['start', 'end']) {
    if (routing[kind]) routing[kind].remove();
    routing[kind] = null;
  }
  map.getSource('route').setData({ type: 'FeatureCollection', features: [] });
  document.getElementById('route-card').classList.add('hidden');
  setStatus('');
}
