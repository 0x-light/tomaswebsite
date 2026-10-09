#!/usr/bin/env python3
"""Builds Medici's lookup from National Gallery of Art object numbers to IIIF images.

nga.gov's pages sit behind a bot check, but its images are served openly from
api.nga.gov/iiif/<uuid>. The mapping from an object number (the 46626 in
nga.gov/collection/art-object-page.46626.html) to that uuid is published as
open data: published_images.csv in github.com/NationalGalleryOfArt/opendata.

This reads that CSV and writes data/nga/<id % 100>.json, each a small
{ "objectid": ["uuid", width, height] } map of primary, open-access images.
Run it now and then to pick up new acquisitions:

    python3 scripts/build_nga_index.py
"""

import csv
import io
import json
import sys
import urllib.request
from pathlib import Path

SOURCE = "https://raw.githubusercontent.com/NationalGalleryOfArt/opendata/main/data/published_images.csv"
OUT = Path(__file__).resolve().parent.parent / "data" / "nga"
SHARDS = 100

csv.field_size_limit(sys.maxsize)


def main():
    print("downloading", SOURCE)
    with urllib.request.urlopen(SOURCE) as response:
        text = io.TextIOWrapper(response, encoding="utf-8", newline="")
        best = {}
        for row in csv.DictReader(text):
            if row.get("openaccess") != "1":
                continue
            object_id = row.get("depictstmsobjectid", "").strip()
            uuid = row.get("uuid", "").strip()
            if not object_id or not uuid:
                continue
            primary = row.get("viewtype") == "primary"
            try:
                sequence = int(row.get("sequence") or 0)
                width = int(float(row.get("width") or 0))
                height = int(float(row.get("height") or 0))
            except ValueError:
                continue
            rank = (0 if primary else 1, sequence)
            if object_id not in best or rank < best[object_id][0]:
                best[object_id] = (rank, [uuid, width, height])

    OUT.mkdir(parents=True, exist_ok=True)
    shards = [dict() for _ in range(SHARDS)]
    for object_id, (_rank, entry) in best.items():
        shards[int(object_id) % SHARDS][object_id] = entry
    for index, shard in enumerate(shards):
        (OUT / f"{index}.json").write_text(json.dumps(shard, separators=(",", ":"), sort_keys=True))
    print(f"wrote {len(best)} objects into {SHARDS} files in {OUT.relative_to(OUT.parent.parent)}")


if __name__ == "__main__":
    main()
