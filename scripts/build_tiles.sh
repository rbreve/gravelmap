#!/usr/bin/env bash
# Build prototype/tiles/roads.pmtiles from the Geofabrik Finland OSM extract.
# Needs: osmium-tool, tippecanoe (brew install osmium-tool tippecanoe), python3.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DATA="$ROOT/data"
OUT="$ROOT/prototype/tiles"
mkdir -p "$DATA" "$OUT"

if [[ "${1:-}" == "--download" || ! -f "$DATA/finland-latest.osm.pbf" ]]; then
  echo "Downloading Finland extract…"
  curl -L --fail -o "$DATA/finland-latest.osm.pbf" https://download.geofabrik.de/europe/finland-latest.osm.pbf
fi

echo "Filtering roads…"
osmium tags-filter --overwrite -o "$DATA/roads.osm.pbf" "$DATA/finland-latest.osm.pbf" \
  w/highway=track,path,bridleway,cycleway,footway,unclassified,residential,service,living_street,tertiary,tertiary_link,secondary,secondary_link,primary,primary_link

echo "Exporting + classifying…"
osmium export --overwrite -f geojsonseq --geometry-types=linestring -a id \
  -o - "$DATA/roads.osm.pbf" \
  | python3 "$ROOT/scripts/classify.py" > "$DATA/roads.geojsonseq"

echo "Building tiles…"
tippecanoe --force -o "$OUT/roads.pmtiles" -l roads \
  -Z8 -z14 -P \
  --drop-densest-as-needed --extend-zooms-if-still-dropping \
  --attribution='© OpenStreetMap contributors' \
  "$DATA/roads.geojsonseq"

ls -lh "$OUT/roads.pmtiles"
