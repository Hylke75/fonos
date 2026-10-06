#!/usr/bin/env python3
"""Zet de spreadsheets van de LP-gebruikscollectie om naar collectie/gebruikscollectie.csv en
schrijft collectie/prioriteit.csv (album_code,priority) uit de scrape-wachtrij.

    python collectie/maak_csv.py LP_Klassiek.xlsx LP_Populair.xlsx [--db muziekweb.db]

gebruikscollectie.csv: objectnummer,titelnummer,bron — één regel per gevulde rij, van alle
tabbladen behalve TOTAAL (alleen formules). Objectnummers als ';101180681' worden ontdaan van
';' en spaties; zonder titelnummer blijft die kolom leeg. Niet ontdubbeld.
"""
from __future__ import annotations

import argparse
import csv
import re
import sqlite3
from pathlib import Path

import openpyxl

HERE = Path(__file__).resolve().parent
OBJECT_HEADERS = {"objectnummer", "plessey"}
CODE_HEADERS = {"titelnummer", "titlenumber", "titelnr", "catalogusnummer", "catalogusnr"}
VINDCODE_HEADERS = {"vindcode", "standplaats", "plaatsnummer"}


def _cell(v) -> str:
    if v is None:
        return ""
    if isinstance(v, float) and v.is_integer():
        v = int(v)
    return str(v).strip()


def rows_from(path: Path, name: str):
    wb = openpyxl.load_workbook(path, read_only=True)
    for ws in wb.worksheets:
        if ws.title.strip().upper() == "TOTAAL":
            continue
        rows = ws.iter_rows(values_only=True)
        header = [_cell(h).lower() for h in next(rows, ())]
        obj = next((i for i, h in enumerate(header) if h in OBJECT_HEADERS), 0)
        code = next((i for i, h in enumerate(header) if h in CODE_HEADERS), None)
        vind = next((i for i, h in enumerate(header) if h in VINDCODE_HEADERS), None)
        for row in rows:
            get = lambda i: _cell(row[i]) if i is not None and i < len(row) else ""  # noqa: E731
            objectnummer = re.sub(r"[;\s]", "", get(obj))
            titelnummer = get(code).upper()
            if not objectnummer and not titelnummer:
                continue
            yield objectnummer, titelnummer, f"{name} / {ws.title}", get(vind)


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("xlsx", nargs="+", type=Path)
    p.add_argument("--names", nargs="*", help="bronnaam per bestand (standaard de bestandsnaam)")
    p.add_argument("--db", type=Path, default=HERE.parent / "muziekweb.db")
    args = p.parse_args()

    rows = []
    for i, path in enumerate(args.xlsx):
        name = args.names[i] if args.names and i < len(args.names) else path.name
        rows += list(rows_from(path, name))
    with_vind = any(r[3] for r in rows)
    out = HERE / "gebruikscollectie.csv"
    with open(out, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["objectnummer", "titelnummer", "bron"] + (["vindcode"] if with_vind else []))
        w.writerows(r if with_vind else r[:3] for r in rows)
    print(f"{out.name}: {len(rows)} regels")

    conn = sqlite3.connect(args.db, timeout=60)
    prio = conn.execute("SELECT album_code, priority FROM scrape_queue WHERE priority > 0 "
                        "ORDER BY priority DESC, album_code").fetchall()
    with open(HERE / "prioriteit.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["album_code", "priority"])
        w.writerows(prio)
    print(f"prioriteit.csv: {len(prio)} regels")


if __name__ == "__main__":
    main()
