#!/usr/bin/env python3
"""
PokeFollower Asset Pipeline
Automates adding new Pokémon to the PokeFollower Chrome extension.

Usage:
    python add_pokemon.py --gen 3 --batch "337-lunatone"
    python add_pokemon.py --gen 3 --batch "337-lunatone 338-solrock 339-barboach"
    python add_pokemon.py --gen 3 --batch "337-lunatone" --dry-run

Before running:
    1. Have Claude in Chrome save files to the incoming folder:
       - {dex}-{name}.png  (e.g. 337-lunatone.png)  from pokemondb.net Gen 5 sprite
       - {dex4}.zip        (e.g. 0337.zip)           from sprites.pmdcollab.org
    2. Ensure the gen folders exist in both the VS Code project and PROJECTS archive
    3. Run: pip3 install Pillow  (one time only)
"""

import argparse
import re
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

# ── Paths ─────────────────────────────────────────────────────────────────────

VSCODE_ROOT  = Path("/Users/alihamad/Documents/GitHub/pokefollower_cursor_web_plugin")
VSCODE_RAW   = VSCODE_ROOT / "src/assets/raw"
VSCODE_UI    = VSCODE_ROOT / "src/assets/ui"
VSCODE_PACKS = VSCODE_ROOT / "src/assets/packs/retro"

PROJECTS     = Path("/Users/alihamad/Desktop/PROJECTS/Pokefollower Plugin/Pokemon")
INCOMING     = PROJECTS / "incoming"
PROCESSED    = PROJECTS / "processed"
TEMP         = INCOMING / "_tmp"

# ── Helpers ───────────────────────────────────────────────────────────────────

def log(msg):  print(f"    {msg}")
def ok(msg):   print(f"  ✅ {msg}")
def warn(msg): print(f"  ⚠️  {msg}")
def err(msg):  print(f"\n  ❌ {msg}\n"); sys.exit(1)

def dex_padded(dex_num):
    """337 -> ('337', '0337')"""
    return str(dex_num), str(dex_num).zfill(4)

def gen_label(gen):
    """3 -> 'gen-3'  (VS Code folder naming)"""
    return f"gen-{gen}"

def gen_folder(gen):
    """3 -> 'Gen 3'  (PROJECTS archive folder naming)"""
    return f"Gen {gen}"

def parse_batch(batch_str):
    """'337-lunatone 338-solrock' -> [(337, 'lunatone'), (338, 'solrock')]"""
    result = []
    for entry in batch_str.strip().split():
        match = re.match(r'^(\d+)-(.+)$', entry)
        if not match:
            err(f"Invalid format '{entry}'. Use: dex-name (e.g. 337-lunatone)")
        result.append((int(match.group(1)), match.group(2).lower()))
    return result

# ── Preflight checks ──────────────────────────────────────────────────────────

def preflight(gen, pokemon_list):
    """Check all required folders and incoming files exist before starting."""
    print("\n  Checking folders...")
    missing = []

    for folder in [
        VSCODE_RAW   / gen_label(gen),
        VSCODE_UI    / gen_label(gen),
        VSCODE_PACKS / gen_label(gen),
        PROCESSED    / gen_folder(gen),
        INCOMING,
    ]:
        if not folder.exists():
            missing.append(str(folder))

    if missing:
        print("\n  Missing folders - create these before running:")
        for m in missing:
            print(f"    mkdir -p \"{m}\"")
        sys.exit(1)

    print("  Checking incoming files...")
    for dex_num, name in pokemon_list:
        dex, dex4 = dex_padded(dex_num)
        png = INCOMING / f"{dex}-{name}.png"
        zip_candidates = [
            INCOMING / f"{dex}-{name} sprite.zip",
            INCOMING / f"{dex4}.zip",
            INCOMING / f"{dex}-{name}-sprites.zip",
            INCOMING / "sprites.zip",
        ]
        if not png.exists():
            err(f"Cover PNG not found: {png.name}\n"
                f"    Save from pokemondb.net (Gen 5 normal sprite) to:\n"
                f"    {INCOMING}/")
        if not any(z.exists() for z in zip_candidates):
            err(f"Sprite zip not found for {dex}-{name}\n"
                f"    Expected: {INCOMING}/{dex}-{name} sprite.zip\n"
                f"    Save from sprites.pmdcollab.org to incoming/")

    ok("All preflight checks passed\n")

# ── Per-Pokemon processing ────────────────────────────────────────────────────

def find_zip(dex_num, name):
    dex, dex4 = dex_padded(dex_num)
    for candidate in [
        INCOMING / f"{dex}-{name} sprite.zip",   # canonical format
        INCOMING / f"{dex4}.zip",                 # fallback
        INCOMING / f"{dex}-{name}-sprites.zip",   # fallback
        INCOMING / "sprites.zip",                 # fallback
    ]:
        if candidate.exists():
            return candidate
    err(f"Sprite zip not found for {dex}-{name}.\n"
        f"    Expected: {INCOMING}/{dex}-{name} sprite.zip")


def extract_sprites(zip_path, dex_num, name):
    """Extract the 4 needed files from zip into a temp folder."""
    dex, _ = dex_padded(dex_num)
    extract_to = TEMP / f"{dex}-{name}"
    extract_to.mkdir(parents=True, exist_ok=True)

    needed = ["AnimData.xml", "Idle-Anim.png", "Sleep-Anim.png", "Walk-Anim.png"]

    with zipfile.ZipFile(zip_path, 'r') as zf:
        all_files = zf.namelist()
        for filename in needed:
            matches = [f for f in all_files if f.endswith(filename)]
            if not matches:
                err(f"'{filename}' not found in zip for {dex}-{name}")
            zf.extract(matches[0], extract_to)
            extracted = extract_to / matches[0]
            dest = extract_to / filename
            if str(extracted) != str(dest):
                shutil.move(str(extracted), str(dest))
                # Clean up empty subdirs from zip structure
                try:
                    extracted.parent.rmdir()
                except Exception:
                    pass

    log("Extracted 4 files from zip")
    return extract_to


def convert_to_webp(folder, png_name):
    """Convert PNG to lossless WebP, remove original."""
    try:
        from PIL import Image
    except ImportError:
        err("Pillow not installed. Run: pip3 install Pillow")

    png_path  = folder / png_name
    webp_path = folder / png_name.replace(".png", ".webp")
    img = Image.open(png_path)
    img.save(webp_path, "WEBP", lossless=True, quality=100)
    png_path.unlink()
    log(f"Converted {png_name} -> {webp_path.name}")


def count_frames(xml_path):
    """Count Duration tags per animation section to derive FPS."""
    import xml.etree.ElementTree as ET
    counts = {"Idle": 6, "Walk": 6, "Sleep": 6}
    try:
        tree  = ET.parse(xml_path)
        anims = tree.getroot().find("Anims")
        if anims:
            for anim in anims.findall("Anim"):
                name_el = anim.find("Name")
                if name_el is not None and name_el.text.strip() in counts:
                    durations = anim.findall(".//Duration")
                    if durations:
                        counts[name_el.text.strip()] = len(durations)
    except Exception as e:
        warn(f"Could not parse AnimData.xml ({e}), using fallback FPS=6")
    return counts


def run_parse_anim(dex_num, name, gen):
    """Run parse-anim.js for one Pokemon."""
    dex, _ = dex_padded(dex_num)
    mon    = f"{dex}-{name}"
    g      = gen_label(gen)
    frames = count_frames(VSCODE_RAW / g / mon / "AnimData.xml")
    log(f"FPS - Idle:{frames['Idle']} Walk:{frames['Walk']} Sleep:{frames['Sleep']}")

    cmd = [
        "node", "src/scripts/parse-anim.js",
        "--xml",        f"src/assets/raw/{g}/{mon}/AnimData.xml",
        "--dir",        f"src/assets/raw/{g}/{mon}",
        "--name",       mon,
        "--generation", g,
        "--out",        f"src/assets/packs/retro/{g}/{mon}.json",
        "--idle",       "Idle-Anim.webp",
        "--walk",       "Walk-Anim.webp",
        "--sleep",      "Sleep-Anim.webp",
        "--fpsIdle",    str(frames['Idle']),
        "--fpsWalk",    str(frames['Walk']),
        "--fpsSleep",   str(frames['Sleep']),
    ]

    result = subprocess.run(cmd, cwd=VSCODE_ROOT, capture_output=True, text=True)
    if result.returncode != 0:
        print(f"    stderr: {result.stderr.strip()}")
        err(f"parse-anim.js failed for {mon}")
    ok(f"JSON generated -> src/assets/packs/retro/{g}/{mon}.json")


def process_pokemon(dex_num, name, gen):
    dex, dex4 = dex_padded(dex_num)
    mon       = f"{dex}-{name}"
    g         = gen_label(gen)

    print(f"\n── {mon} {'─' * max(1, 44 - len(mon))}")

    cover_png = INCOMING / f"{dex}-{name}.png"
    zip_path  = find_zip(dex_num, name)

    # Extract + convert
    temp_dir = extract_sprites(zip_path, dex_num, name)
    for png in ["Idle-Anim.png", "Sleep-Anim.png", "Walk-Anim.png"]:
        convert_to_webp(temp_dir, png)

    # Archive to PROJECTS: processed/Gen X/{dex}-{name} sprite/in use/
    archive_dir = PROCESSED / gen_folder(gen) / f"{mon} sprite" / "in use"
    archive_dir.mkdir(parents=True, exist_ok=True)
    shutil.copy2(cover_png, archive_dir / cover_png.name)
    for f in ["AnimData.xml", "Idle-Anim.webp", "Sleep-Anim.webp", "Walk-Anim.webp"]:
        shutil.copy2(temp_dir / f, archive_dir / f)
    ok(f"Archived 5 files -> PROJECTS/processed/Gen {gen}/{mon} sprite/in use/")

    # Copy to VS Code raw folder
    raw_dir = VSCODE_RAW / g / mon
    raw_dir.mkdir(parents=True, exist_ok=True)
    for f in ["AnimData.xml", "Idle-Anim.webp", "Sleep-Anim.webp", "Walk-Anim.webp"]:
        shutil.copy2(temp_dir / f, raw_dir / f)
    ok(f"Copied 4 files -> src/assets/raw/{g}/{mon}/")

    # Copy cover PNG to VS Code UI folder
    shutil.copy2(cover_png, VSCODE_UI / g / cover_png.name)
    ok(f"Copied cover -> src/assets/ui/{g}/{cover_png.name}")

    # Run parse-anim.js
    run_parse_anim(dex_num, name, gen)

    # Clean up temp and move incoming files to processed archive
    shutil.rmtree(temp_dir, ignore_errors=True)
    incoming_archive = PROCESSED / gen_folder(gen) / "_incoming_archive"
    incoming_archive.mkdir(parents=True, exist_ok=True)
    shutil.move(str(cover_png), str(incoming_archive / cover_png.name))
    shutil.move(str(zip_path),  str(incoming_archive / zip_path.name))
    log("Cleaned up incoming/")


def run_build_index():
    log("Running npm run build:index...")
    result = subprocess.run(
        ["npm", "run", "build:index"],
        cwd=VSCODE_ROOT, capture_output=True, text=True
    )
    if result.returncode != 0:
        print(f"    stderr: {result.stderr.strip()}")
        err("build:index failed")
    ok("Index rebuilt -> src/assets/packs/index.json")

# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="PokeFollower asset pipeline"
    )
    parser.add_argument("--gen",     required=True, type=int)
    parser.add_argument("--batch",   required=True)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    pokemon_list = parse_batch(args.batch)

    print(f"\n🎮 PokeFollower Asset Pipeline")
    print(f"   Generation : Gen {args.gen} / {gen_label(args.gen)}")
    print(f"   Batch      : {[f'{d}-{n}' for d,n in pokemon_list]}")

    if args.dry_run:
        print(f"\n   DRY RUN - no files will be moved\n")
        for dex_num, name in pokemon_list:
            dex, dex4 = dex_padded(dex_num)
            mon = f"{dex}-{name}"
            print(f"  [{mon}]")
            print(f"    1. Find {mon}.png + {dex4}.zip in incoming/")
            print(f"    2. Extract AnimData.xml + Idle/Sleep/Walk PNGs")
            print(f"    3. Convert 3 PNGs -> WebP")
            print(f"    4. Archive -> PROJECTS/processed/Gen {args.gen}/{mon} sprite/in use/")
            print(f"    5. Copy to VS Code raw/{gen_label(args.gen)}/{mon}/")
            print(f"    6. Copy cover PNG -> VS Code ui/{gen_label(args.gen)}/")
            print(f"    7. Run parse-anim.js -> {mon}.json")
            print(f"    8. Clean up incoming/\n")
        print(f"  [batch end]")
        print(f"    9. npm run build:index\n")
        return

    preflight(args.gen, pokemon_list)

    for dex_num, name in pokemon_list:
        process_pokemon(dex_num, name, args.gen)

    print(f"\n── Finalizing {'─' * 38}")
    run_build_index()

    print(f"\n🏁 Done! {len(pokemon_list)} Pokemon added to Gen {args.gen}.\n")


if __name__ == "__main__":
    main()
