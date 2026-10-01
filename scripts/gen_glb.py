#!/usr/bin/env python3
"""genera un .glb minimo y valido, para las pruebas de modelos 3d.

    python3 scripts/gen_glb.py [salida]

glTF 2.0, una caja de 12 triangulos, cabecera 'glTF' y su bloque BIN
como manda el formato. No es anatomia: es un archivo DE VERDAD que el
cargador tiene que saber leer, que es lo que se esta probando.

Se genera en vez de guardarse en el repositorio porque son 1 KB de
numeros en binario: en un diff no se lee, y en el arbol solo genera
preguntas de "que es esto".
"""
import struct
import json
import sys
import pathlib


def build() -> bytes:
    pos = []
    for x in (-1, 1):
        for y in (-1, 1):
            for z in (-1, 1):
                pos += [x * 0.6, y * 1.1, z * 0.5]
    faces = [(0,1,3,2), (4,6,7,5), (0,4,5,1), (2,3,7,6), (0,2,6,4), (1,5,7,3)]
    idx = []
    for a, b, c, d in faces:
        idx += [a, b, c, a, c, d]
    vb0 = b"".join(struct.pack("<f", v) for v in pos)
    vb1 = b"".join(struct.pack("<H", v) for v in idx)
    pad = (4 - len(vb1) % 4) % 4
    bin_ = vb0 + vb1 + b"\x00" * pad

    gj = {
        "asset": {"version": "2.0", "generator": "m-nexus-test"},
        "scene": 0,
        "scenes": [{"nodes": [0], "name": "prueba"}],
        "nodes": [{"mesh": 0, "name": "caja"}],
        "meshes": [{"name": "caja", "primitives": [
            {"attributes": {"POSITION": 0}, "indices": 1, "material": 0}]}],
        "materials": [{"name": "rojo", "pbrMetallicRoughness": {
            "baseColorFactor": [0.85, 0.2, 0.25, 1.0],
            "roughnessFactor": 0.6, "metallicFactor": 0.0}}],
        "accessors": [
            {"bufferView": 0, "componentType": 5126, "count": 8, "type": "VEC3",
             "min": [-0.6, -1.1, -0.5], "max": [0.6, 1.1, 0.5]},
            {"bufferView": 1, "componentType": 5123, "count": len(idx), "type": "SCALAR"}],
        "bufferViews": [
            {"buffer": 0, "byteOffset": 0, "byteLength": len(vb0), "target": 34962},
            {"buffer": 0, "byteOffset": len(vb0), "byteLength": len(vb1) + pad,
             "target": 34963}],
        "buffers": [{"byteLength": len(bin_)}],
    }
    js = json.dumps(gj).encode()
    js += b" " * ((4 - len(js) % 4) % 4)

    glb = b"glTF" + struct.pack("<II", 2, 12 + 8 + len(js) + 8 + len(bin_))
    glb += struct.pack("<I", len(js)) + b"JSON" + js
    glb += struct.pack("<I", len(bin_)) + b"BIN\x00" + bin_
    return glb


if __name__ == "__main__":
    out = pathlib.Path(
        sys.argv[1] if len(sys.argv) > 1 else "scripts/fixtures/caja.glb")
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(build())
    print(f"{out} - {out.stat().st_size} bytes")
