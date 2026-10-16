#!/usr/bin/env python3
"""Decode only positional layout_hints from original PS Vita RCOF files.

Input files must be obtained from a user's own Vita:
vs0:/vsh/shell/livearea/<style>.rco

This script does not copy images, executable resources, or firmware blobs.
The output is plain numeric geometry for the existing LiveArea layout styles.
The RCOF/CXML header, tree and float-array attribute formats are described at
https://www.psdevwiki.com/vita/Resource_Container_CXML_(RCO,_QRC,_Theme_Files,_RAF,_CXML)

Usage:
    python3 tools/extract-livearea-layouts.py /path/to/rco-directory data/livearea-layouts.json
"""

import json
import struct
import sys
from pathlib import Path


STYLES = (
    "a1 a2 a3 a4 a5 ad0 ad1 ad2 ad3 ad4 browser "
    "content_manager kids music nsx1 ps1emu psmobile pspemu vd"
).split()


def extract(path):
    data = path.read_bytes()
    if data[:4] != b"RCOF":
        raise ValueError(f"{path}: not RCOF")
    header = struct.unpack_from("<20I", data)
    tree, float_table = header[2], header[16]
    groups = []
    visited = set()

    def string(offset):
        start = header[8] + offset
        if start < header[8] or start >= header[8] + header[9]:
            raise ValueError(f"{path}: invalid string offset")
        return data[start:data.index(0, start)].decode("utf-8")

    def node(offset):
        if offset in visited or not (0 <= offset < header[3]):
            return
        visited.add(offset)
        tag, count, _, _, _, first, _ = struct.unpack_from("<7i", data, tree + offset)
        name = string(tag)
        if name == "group":
            groups.append({})
        elif name == "layout_hint":
            if not groups:
                raise ValueError(f"{path}: layout_hint without parent group")
            for i in range(count):
                key, kind, start, length = struct.unpack_from(
                    "<4i", data, tree + offset + 28 + i * 16
                )
                label = string(key)
                if label in {"pos", "size"} and kind == 7:
                    if length not in (2, 3):
                        raise ValueError(f"{path}: unexpected array length")
                    values = struct.unpack_from(
                        "<" + "f" * length, data, float_table + start * 4
                    )
                    groups[-1][label] = [round(value) for value in values[:2]]
        child = first
        siblings = set()
        while child >= 0 and child not in siblings:
            siblings.add(child)
            following = struct.unpack_from("<i", data, tree + child + 16)[0]
            node(child)
            child = following

    node(0)
    if not groups or any("pos" not in group for group in groups):
        raise ValueError(f"{path}: missing layout geometry")
    gates = [group["pos"] for group in groups if "size" not in group]
    if len(gates) > 1:
        raise ValueError(f"{path}: multiple gate candidates")
    frames = [
        [*group["pos"], *group["size"]]
        for group in groups if "size" in group
    ]
    return {
        "gate": gates[0] if gates else None,
        "frames": frames,
    }


def main(source, destination):
    root = Path(source)
    output = {
        "source": "PS Vita firmware vs0:vsh/shell/livearea/*.rco, RCOF layout_hint",
        "units": "pixels; positions relative to card center; X right, Y up",
        "card": [840, 500],
        "gateSize": [280, 158],
        "layouts": {},
    }
    for style in STYLES:
        output["layouts"][style] = extract(root / (style + ".rco"))
    Path(destination).parent.mkdir(parents=True, exist_ok=True)
    Path(destination).write_text(
        json.dumps(output, indent=2, ensure_ascii=True) + "\n",
        encoding="utf-8",
    )
    print(f"Wrote {len(output['layouts'])} layouts to {destination}")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit(__doc__)
    main(*sys.argv[1:])
