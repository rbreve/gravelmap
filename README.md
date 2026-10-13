# Gravel Finland

A simple map for cycling in Finland that shows the roads normal map apps hide: gravel roads,
forest roads and small paths, next to regular paved roads.

Google Maps and similar apps treat gravel and forest roads as second-class or leave them out.
This map takes every road from OpenStreetMap and colours it by surface, so you can see at a glance
where you can ride on gravel. Tap a spot on the map to get a route there that prefers gravel.

## Features

- **Gravel + paved roads** for the whole of Finland. Rough trails and roads with unknown surface
  can be switched on from the ☰ menu.
- **Gravel routing:** tap the map → *Go here*. Routes start from your location (◎) or a point you pick,
  and show distance, climbing and how much of the route is gravel. Three modes: *Max gravel*,
  *More gravel*, *Direct*.
- **Base maps:** OpenTopoMap, or the official Finnish topographic maps from Maanmittauslaitos
  (free API key), with a slider to lighten the base map.
- **Road details:** tap a road to see its surface and a link to fix it on OpenStreetMap.

| Colour | Meaning |
|---|---|
| Orange | Gravel / compacted, incl. good forest roads |
| Grey | Paved |
| Magenta dashed | Rough: dirt, grass, roots, trails (off by default) |
| Cyan dashed | No surface info in OpenStreetMap (off by default) |

## Run it locally

Needs `brew install osmium-tool tippecanoe`, Python 3 and Node.

```sh
./scripts/build_tiles.sh            # downloads Finland OSM data (~770 MB) once, builds the road tiles (~7 min)
./scripts/build_tiles.sh --download # refresh with the latest OSM data
./scripts/serve.sh                  # open http://localhost:8765
./scripts/serve.sh --lan            # also reachable from a phone on the same Wi-Fi
```

The OSM download (`data/`) and the generated tiles (`prototype/tiles/roads.pmtiles`, ~360 MB) are not
committed; the build script recreates them.

## Project layout

```
prototype/        the web app (MapLibre GL JS, no build step)
  app.js          map, layers, menu, road popup
  routing.js      gravel routing + route summary
scripts/
  build_tiles.sh  OSM extract → roads.pmtiles
  classify.py     decides which colour each road gets (surface rules)
  serve.sh        local web server with range-request support
```

## Data sources

- **Roads:** © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors (ODbL), via
  [Geofabrik](https://download.geofabrik.de/europe/finland.html).
- **Base maps:** [OpenTopoMap](https://opentopomap.org) (CC-BY-SA) or
  [Maanmittauslaitos](https://www.maanmittauslaitos.fi/en/rajapinnat/api-avaimen-ohje) (CC BY 4.0).
  The MML API key is entered in the ☰ menu and stored only in your browser.
- **Routing:** public [BRouter](https://brouter.de) server, `gravel` profile with its
  `prefer_unpaved_paths` / `avoid_towns` / `prefer_forests` switches set per route mode.
