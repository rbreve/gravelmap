// Gravel Finland prototype: MML / OpenTopoMap base map + OSM roads coloured by surface.

// Built by scripts/build_tiles.sh from the Geofabrik Finland extract.
const ROADS_URL = new URL('tiles/roads.pmtiles', location.href).href;
const MIN_ROAD_ZOOM = 9;

const pmtilesProtocol = new pmtiles.Protocol();
maplibregl.addProtocol('pmtiles', pmtilesProtocol.tile);

const MML_WMTS = 'https://avoin-karttakuva.maanmittauslaitos.fi/avoin/wmts/1.0.0';
const MML_ATTRIBUTION = '© <a href="https://www.maanmittauslaitos.fi/en/opendata-licence-cc40">Maanmittauslaitos</a>';

const BASEMAPS = {
  'mml-maasto': { mml: 'maastokartta', ext: 'png' },
  'mml-tausta': { mml: 'taustakartta', ext: 'png' },
  'mml-orto': { mml: 'ortokuva', ext: 'jpg' },
  'opentopo': {
    tiles: ['https://a.tile.opentopomap.org/{z}/{x}/{y}.png',
            'https://b.tile.opentopomap.org/{z}/{x}/{y}.png',
            'https://c.tile.opentopomap.org/{z}/{x}/{y}.png'],
    maxzoom: 17,
    attribution: '© <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)',
  },
};

// Surface classes, drawn bottom to top.
const CLASSES = [
  { id: 'paved',   label: 'Paved',                      color: '#4a4a4a', dashed: false, width: 0.7 },
  { id: 'unknown', label: 'Surface unknown',            color: '#00a6d6', dashed: true,  width: 0.9 },
  { id: 'rough',   label: 'Rough: dirt, trail, grass',  color: '#c2188f', dashed: true,  width: 1 },
  { id: 'gravel',  label: 'Gravel / compacted',         color: '#ff6a00', dashed: false, width: 1.2 },
];

// Roads arrive with a precomputed `cls` property (see scripts/classify.py).

// --- persisted settings -----------------------------------------------------

function load(key, fallback) {
  try {
    const v = localStorage.getItem('gravel.' + key);
    return v === null ? fallback : JSON.parse(v);
  } catch { return fallback; }
}
function save(key, value) {
  try { localStorage.setItem('gravel.' + key, JSON.stringify(value)); } catch { /* ignore */ }
}

const settings = {
  key: load('key', ''),
  basemap: load('basemap', null),
  hidden: load('layersOff', ['rough', 'unknown']),
  fade: load('fade', 0.5),
  view: load('view', { center: [24.56, 60.32], zoom: 12.5 }), // Nuuksio
};

// --- map ----------------------------------------------------------------------

const map = new maplibregl.Map({
  container: 'map',
  style: { version: 8, sources: {}, layers: [] },
  center: settings.view.center,
  zoom: settings.view.zoom,
  maxPitch: 60, // tilted only in navigation mode (nav.js); pitch gestures stay off
  dragRotate: false,
  attributionControl: { compact: true },
});
map.touchZoomRotate.disableRotation();
map.touchPitch.disable();

map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
map.addControl(new maplibregl.ScaleControl(), 'bottom-left');

const statusEl = document.getElementById('status');
function setStatus(text) {
  statusEl.textContent = text || '';
  statusEl.classList.toggle('hidden', !text);
}

function basemapSource(id) {
  const b = BASEMAPS[id];
  if (b.mml) {
    return {
      type: 'raster',
      tiles: [`${MML_WMTS}/${b.mml}/default/WGS84_Pseudo-Mercator/{z}/{y}/{x}.${b.ext}?api-key=${encodeURIComponent(settings.key)}`],
      tileSize: 256,
      maxzoom: 16,
      attribution: MML_ATTRIBUTION,
    };
  }
  return { type: 'raster', tiles: b.tiles, tileSize: 256, maxzoom: b.maxzoom, attribution: b.attribution };
}

function setBasemap(id) {
  if (BASEMAPS[id].mml && !settings.key) {
    setStatus('MML maps need an API key. Using OpenTopoMap for now.');
    id = 'opentopo';
  }
  document.getElementById('basemap').value = id;
  settings.basemap = id;
  save('basemap', id);

  if (map.getLayer('basemap')) map.removeLayer('basemap');
  if (map.getSource('basemap')) map.removeSource('basemap');
  map.addSource('basemap', basemapSource(id));
  const firstOverlay = map.getLayer('roads-casing') ? 'roads-casing' : undefined;
  map.addLayer({ id: 'basemap', type: 'raster', source: 'basemap', paint: basemapPaint() }, firstOverlay);
}

// Lifting the darkest pixels washes out buildings, labels and contours so the road colours stand out.
function basemapPaint() {
  return { 'raster-brightness-min': settings.fade, 'raster-saturation': -settings.fade / 2 };
}

function setFade(value) {
  settings.fade = value;
  save('fade', value);
  for (const [k, v] of Object.entries(basemapPaint())) map.setPaintProperty('basemap', k, v);
}

function widthExpr(scale) {
  return ['interpolate', ['linear'], ['zoom'], 9, 0.6 * scale, 12, 1.5 * scale, 14, 2.5 * scale, 17, 5 * scale];
}

// Halo only under visible, non-paved classes, otherwise hidden roads leave white ghost lines.
function casingFilter() {
  const shown = CLASSES.map(c => c.id).filter(id => id !== 'paved' && !settings.hidden.includes(id));
  return ['in', ['get', 'cls'], ['literal', shown]];
}

function addRoadLayers() {
  map.addSource('roads', {
    type: 'vector',
    url: 'pmtiles://' + ROADS_URL,
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  });

  // White halo so the lines stay readable over busy topo maps.
  map.addLayer({
    id: 'roads-casing',
    type: 'line',
    source: 'roads',
    'source-layer': 'roads',
    filter: casingFilter(),
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#fff', 'line-opacity': 0.8, 'line-width': widthExpr(1.9) },
  });

  for (const c of CLASSES) {
    map.addLayer({
      id: 'roads-' + c.id,
      type: 'line',
      source: 'roads',
      'source-layer': 'roads',
      filter: ['==', ['get', 'cls'], c.id],
      layout: {
        'line-join': 'round',
        'line-cap': c.dashed ? 'butt' : 'round',
        visibility: settings.hidden.includes(c.id) ? 'none' : 'visible',
      },
      paint: {
        'line-color': c.color,
        'line-width': widthExpr(c.width),
        ...(c.dashed ? { 'line-dasharray': [2, 1.2] } : {}),
      },
    });
  }
}

// Only touches the status line when the hint appears or goes, so it doesn't wipe other messages.
let zoomHintShown = false;
function updateZoomHint() {
  const show = map.getZoom() < MIN_ROAD_ZOOM;
  if (show === zoomHintShown) return;
  zoomHintShown = show;
  setStatus(show ? 'Zoom in to see gravel roads' : '');
}

// --- popup ------------------------------------------------------------------------

const POPUP_TAGS = ['highway', 'surface', 'tracktype', 'smoothness', 'mtb:scale', 'access', 'bicycle'];

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

map.on('click', e => {
  const pad = 10;
  const layers = CLASSES.map(c => 'roads-' + c.id).filter(id => map.getLayoutProperty(id, 'visibility') !== 'none');
  const hits = map.queryRenderedFeatures(
    [[e.point.x - pad, e.point.y - pad], [e.point.x + pad, e.point.y + pad]], { layers });
  const popup = new maplibregl.Popup({ maxWidth: '260px' }).setLngLat(e.lngLat);
  const el = document.createElement('div');
  if (hits.length) el.innerHTML = roadInfoHtml(hits[0].properties);
  el.appendChild(routeActions(e.lngLat, popup)); // routing.js
  popup.setDOMContent(el).addTo(map);
});

function roadInfoHtml(p) {
  const cls = CLASSES.find(c => c.id === p.cls);
  const rows = POPUP_TAGS.filter(k => p[k] !== undefined)
    .map(k => `<tr><td>${k}</td><td>${escapeHtml(p[k])}</td></tr>`).join('');
  return `<strong>${escapeHtml(p.name || cls.label)}</strong>
    <div style="color:${cls.color};margin-bottom:4px">${cls.label}</div>
    <table>${rows}</table>
    <a href="https://www.openstreetmap.org/way/${p.osm_id}" target="_blank" rel="noopener">View / fix on OSM</a>`;
}

// --- panel ------------------------------------------------------------------------

function buildPanel() {
  const panel = document.getElementById('panel');
  document.getElementById('panel-toggle').onclick = () => panel.classList.toggle('hidden');

  const legend = document.getElementById('legend');
  for (const c of [...CLASSES].reverse()) {
    const label = document.createElement('label');
    label.innerHTML = `<input type="checkbox" ${settings.hidden.includes(c.id) ? '' : 'checked'}>
      <span class="swatch ${c.dashed ? 'dashed' : ''}" style="border-top-color:${c.color}"></span>${c.label}`;
    label.querySelector('input').onchange = ev => {
      map.setLayoutProperty('roads-' + c.id, 'visibility', ev.target.checked ? 'visible' : 'none');
      settings.hidden = CLASSES.filter(x => map.getLayoutProperty('roads-' + x.id, 'visibility') === 'none').map(x => x.id);
      save('layersOff', settings.hidden);
      map.setFilter('roads-casing', casingFilter());
    };
    legend.appendChild(label);
  }

  const fade = document.getElementById('fade');
  fade.value = settings.fade;
  fade.oninput = () => setFade(Number(fade.value));

  const select = document.getElementById('basemap');
  select.onchange = () => { setStatus(''); setBasemap(select.value); };

  const keyInput = document.getElementById('mml-key');
  keyInput.value = settings.key;
  keyInput.onchange = () => {
    settings.key = keyInput.value.trim();
    save('key', settings.key);
    setStatus('');
    setBasemap(settings.key ? (BASEMAPS[select.value].mml ? select.value : 'mml-maasto') : 'opentopo');
  };
}

map.on('load', () => {
  buildPanel();
  addRoadLayers();
  addRouteLayers(); // routing.js
  setBasemap(settings.basemap || (settings.key ? 'mml-maasto' : 'opentopo'));
  updateZoomHint();
});

// While following the rider the camera moves every frame, so saving the view is debounced.
let saveViewTimer;
map.on('moveend', () => {
  clearTimeout(saveViewTimer);
  saveViewTimer = setTimeout(() => {
    const c = map.getCenter();
    save('view', { center: [c.lng, c.lat], zoom: map.getZoom() });
  }, 1000);
  updateZoomHint();
});
