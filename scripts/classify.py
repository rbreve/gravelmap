#!/usr/bin/env python3
"""Read `osmium export` GeoJSON sequence on stdin, write slimmed + classified features for tippecanoe.

Each road gets a `cls` property used for styling:
  gravel   - gravel / compacted roads and good forest roads (tracktype grade1-2)
  rough    - dirt, grass, sand, roots, trails (tracktype grade3-5, paths)
  paved    - asphalt etc.
  unknown  - no surface information in OSM
"""
import json
import sys

PAVED = {'asphalt', 'paved', 'concrete', 'concrete:plates', 'concrete:lanes',
         'paving_stones', 'sett', 'chipseal', 'metal', 'cobblestone', 'grass_paver'}
GRAVEL = {'gravel', 'fine_gravel', 'compacted', 'unpaved', 'pebblestone'}
ROUGH = {'dirt', 'ground', 'earth', 'grass', 'sand', 'mud', 'rock', 'roots',
         'wood', 'woodchips', 'stone'}

MAJOR = {'primary', 'primary_link', 'secondary', 'secondary_link', 'tertiary', 'tertiary_link'}
TRAILS = {'path', 'footway', 'cycleway', 'bridleway'}

SKIP_SERVICE = {'parking_aisle', 'driveway', 'drive-through'}
SKIP_FOOTWAY = {'sidewalk', 'crossing'}

KEEP = ['name', 'surface', 'tracktype', 'smoothness', 'mtb:scale', 'access', 'bicycle']


def classify(t):
    s = t.get('surface')
    if s in PAVED:
        return 'paved'
    if s in GRAVEL:
        return 'gravel'
    if s in ROUGH:
        return 'rough'
    hw = t['highway']
    if hw == 'track':
        tt = t.get('tracktype')
        if tt in ('grade1', 'grade2'):
            return 'gravel'
        return 'rough' if tt else 'unknown'
    if hw in ('path', 'bridleway'):
        return 'rough'
    if hw in MAJOR:
        return 'paved'
    return 'unknown'


def min_zoom(hw, cls):
    if hw in MAJOR:
        return 8
    if cls == 'gravel':
        return 9 if hw not in TRAILS else 11
    if cls == 'paved':
        return 12
    if hw in TRAILS:
        return 12
    return 11


def skip(t):
    if t.get('area') == 'yes':
        return True
    if t.get('service') in SKIP_SERVICE or t.get('footway') in SKIP_FOOTWAY or t.get('cycleway') == 'crossing':
        return True
    # Finnish everyman's rights allow cycling on private roads unless signed otherwise,
    # so only drop ways that are explicitly closed to everyone and not opened to bikes.
    if t.get('access') == 'no' and t.get('bicycle') not in ('yes', 'designated', 'permissive'):
        return True
    if t.get('bicycle') == 'no':
        return True
    return False


def main():
    counts = {}
    for line in sys.stdin:
        line = line.lstrip('\x1e').strip()
        if not line:
            continue
        f = json.loads(line)
        t = f['properties']
        if 'highway' not in t or skip(t):
            continue
        cls = classify(t)
        hw = t['highway']
        props = {'cls': cls, 'highway': hw, 'osm_id': f.get('id') or t.get('@id')}
        for k in KEEP:
            if k in t:
                props[k] = t[k]
        out = {
            'type': 'Feature',
            'properties': props,
            'geometry': f['geometry'],
            'tippecanoe': {'minzoom': min_zoom(hw, cls)},
        }
        sys.stdout.write(json.dumps(out, separators=(',', ':'), ensure_ascii=False) + '\n')
        counts[cls] = counts.get(cls, 0) + 1
    print(json.dumps(counts), file=sys.stderr)


if __name__ == '__main__':
    main()
