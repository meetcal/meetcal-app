#!/usr/bin/env python3
#
# No venv required — uses only the Python standard library (no pip install).
#
# Full export — all four Carolina tabs (youth, junior, senior, masters) → CSV in this package dir:
#   (from repo root — -o path puts the file under scrapers/wso/)
#   python3 scrapers/wso/carolina_to_standard.py -o scrapers/wso/out.csv
#   (from scrapers/wso — CSV lands in the current dir, i.e. next to this script)
#   python3 carolina_to_standard.py -o out.csv
#
# Partial export — only the listed tabs (comma-separated); faster or smaller file:
#   python3 scrapers/wso/carolina_to_standard.py --tabs youth,senior -o scrapers/wso/partial.csv
#   python3 carolina_to_standard.py --tabs youth,senior -o partial.csv
#
# CLI reference — flags, defaults, and optional sheet IDs:
#   python3 scrapers/wso/carolina_to_standard.py --help
#   python3 carolina_to_standard.py --help
#
"""
Fetch Carolina WSO record tabs as public HTML (htmlview), parse the grid, and
emit CSV rows matching the reference sheet shape:

  federation,recordName,ageGroup,gender,ageMin,ageMax,bodyWeightMin,bodyWeightMax,lift,record,name,date,place

Reference layout (for age/body ranges): loads the export CSV from the format
example spreadsheet URL — plain HTTP, not the Google Sheets API.

Carolina source: same spreadsheet, tabs YOUTH / JUNIOR / SENIOR / MASTER via gid.
"""

from __future__ import annotations

import argparse
import csv
import datetime as dt
import io
import re
import sys
import urllib.error
import urllib.request
from html.parser import HTMLParser
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

DEFAULT_CAROLINA_SHEET_ID = "1rKFzpkLCT-FE2SzM0qpUOoZ788YHl7dg"
DEFAULT_REFERENCE_SPREADSHEET_ID = "1ZI9TOZ8Ql-ACxNIcytsPXrWfetZFXyjg"
DEFAULT_REFERENCE_GID = "1911965444"

CAROLINA_TABS: Dict[str, str] = {
    "youth": "1785893123",
    "junior": "1157313505",
    "senior": "2109027801",
    "masters": "448005775",
}

USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)


class TableHTMLParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.rows: List[List[str]] = []
        self._row: List[str] = []
        self._in_cell = False
        self._cell_parts: List[str] = []

    def handle_starttag(self, tag: str, attrs: Any) -> None:
        if tag == "tr":
            self._row = []
        elif tag in ("td", "th"):
            self._in_cell = True
            self._cell_parts = []

    def handle_endtag(self, tag: str) -> None:
        if tag in ("td", "th"):
            self._in_cell = False
            self._row.append("".join(self._cell_parts).strip())
        elif tag == "tr":
            if self._row:
                self.rows.append(self._row)

    def handle_data(self, data: str) -> None:
        if self._in_cell:
            self._cell_parts.append(data)


def http_get_text(url: str, timeout: int = 60) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        raw = resp.read()
        enc = resp.headers.get_content_charset() or "utf-8"
    return raw.decode(enc, errors="replace")


def html_table_to_rows(html: str) -> List[List[str]]:
    parser = TableHTMLParser()
    parser.feed(html)
    if not parser.rows:
        raise ValueError("No HTML table found in page")
    return parser.rows


def strip_row_index_column(rows: Sequence[Sequence[str]]) -> List[List[str]]:
    out: List[List[str]] = []
    for row in rows:
        r = [str(c).strip() for c in row]
        if not r:
            continue
        if r[0].isdigit():
            out.append(list(r[1:]))
        else:
            out.append(list(r))
    return out


def fetch_carolina_rows(sheet_id: str, gid: str) -> List[List[str]]:
    url = (
        f"https://docs.google.com/spreadsheets/d/{sheet_id}/htmlview/sheet"
        f"?headers=true&gid={gid}"
    )
    html = http_get_text(url)
    raw = html_table_to_rows(html)
    return strip_row_index_column(raw)


def fetch_reference_map(
    spreadsheet_id: str, gid: str, timeout: int = 60
) -> Dict[Tuple[str, str, str], Dict[str, Any]]:
    url = f"https://docs.google.com/spreadsheets/d/{spreadsheet_id}/export?format=csv&gid={gid}"
    text = http_get_text(url, timeout=timeout)
    reader = csv.DictReader(io.StringIO(text))
    m: Dict[Tuple[str, str, str], Dict[str, Any]] = {}
    for row in reader:
        ag = (row.get("ageGroup") or "").strip()
        g = (row.get("gender") or "").strip()
        bmin = (row.get("bodyWeightMin") or "").strip()
        bmax = (row.get("bodyWeightMax") or "").strip()
        if not ag or not g:
            continue
        key_label = class_label_from_reference_bounds(bmin, bmax)
        k = (ag, g, key_label)
        if k not in m:
            m[k] = {
                "ageMin": row.get("ageMin", "").strip(),
                "ageMax": row.get("ageMax", "").strip(),
                "bodyWeightMin": bmin,
                "bodyWeightMax": bmax,
            }
    return m


def class_label_from_reference_bounds(bmin: str, bmax: str) -> str:
    bmax = bmax.strip()
    if bmax.startswith(">"):
        num = re.sub(r"[^\d]", "", bmax)
        return f"{num}+" if num else bmax
    try:
        return str(int(float(bmax)))
    except ValueError:
        return bmax


def normalize_carolina_class_label(s: str) -> str:
    s = (s or "").strip()
    if not s:
        return s
    if s.endswith("+"):
        return s
    try:
        return str(int(float(s)))
    except ValueError:
        return s


def map_masters_section_to_codes(low: int, high: int) -> Tuple[str, str]:
    prefix_m = f"M{low}"
    prefix_w = f"W{low}"
    return prefix_m, prefix_w


YOUTH_SECTION_PATTERNS: List[Tuple[re.Pattern[str], str]] = [
    (re.compile(r"13\s*&\s*under", re.I), "U13"),
    (re.compile(r"14\s*[-–]\s*15"), "U15"),
    (re.compile(r"16\s*[-–]\s*17"), "U17"),
]


def detect_youth_age_group(row_text: str) -> Optional[str]:
    for pat, code in YOUTH_SECTION_PATTERNS:
        if pat.search(row_text):
            return code
    return None


def detect_masters_section(row_text: str) -> Optional[Tuple[int, int]]:
    m = re.search(r"(\d{2})\s*[-–]\s*(\d{2})\s*records?", row_text, re.I)
    if not m:
        return None
    a, b = int(m.group(1)), int(m.group(2))
    return a, b


def tab_base_age_group(tab_key: str) -> Optional[str]:
    t = tab_key.lower()
    if t == "junior":
        return "JR"
    if t == "senior":
        return "Open"
    return None


LIFT_ALIASES = {
    "snatch": "Snatch",
    "c & j": "Clean & Jerk",
    "c&j": "Clean & Jerk",
    "clean & jerk": "Clean & Jerk",
    "total": "Total",
}


def normalize_lift(name: str) -> Optional[str]:
    n = (name or "").strip().lower()
    return LIFT_ALIASES.get(n)


def parse_date_to_iso(s: str) -> str:
    s = (s or "").strip()
    if not s:
        return ""
    for fmt in ("%m/%d/%y", "%m/%d/%Y", "%Y-%m-%d"):
        try:
            d = dt.datetime.strptime(s, fmt)
            return d.strftime("%Y-%m-%d")
        except ValueError:
            continue
    return s


def normalize_person_name(s: str) -> str:
    t = (s or "").strip()
    if re.fullmatch(r"WSO\s+standard", t, re.I):
        return "STANDARD"
    return t


def lookup_meta(
    ref: Dict[Tuple[str, str, str], Dict[str, Any]],
    age_group: str,
    gender: str,
    class_label: str,
) -> Optional[Dict[str, Any]]:
    label = normalize_carolina_class_label(class_label)
    return ref.get((age_group, gender, label))


def pad_row(row: Sequence[str], min_len: int = 20) -> List[str]:
    r = [str(c) for c in row]
    if len(r) < min_len:
        r.extend([""] * (min_len - len(r)))
    return r


def is_category_first_cell(cell: str) -> bool:
    c0 = (cell or "").strip()
    if not c0:
        return False
    low = c0.lower()
    if low in ("snatch", "c & j", "c&j", "total"):
        return False
    if c0.endswith("+"):
        return True
    return bool(re.match(r"^\d", c0))


def is_continuation_first_cell(cell: str) -> bool:
    low = (cell or "").strip().lower()
    return low in ("snatch", "c & j", "c&j", "total")


def split_html_row_pair(
    row: Sequence[str],
) -> Tuple[Optional[List[str]], Optional[List[str]]]:
    r = pad_row(row)
    c0 = r[0].strip() if r else ""
    if is_category_first_cell(c0):
        return r[0:7], r[7:14]
    if is_continuation_first_cell(c0):
        return (
            ["", r[0], r[1], r[2], r[3], r[4], r[5]],
            ["", r[6], r[7], r[8], r[9], r[10], r[11]],
        )
    return None, None


def iter_side_by_side_records(
    rows: List[List[str]],
    tab_key: str,
) -> Iterable[Dict[str, Any]]:
    tab = tab_key.lower()
    base = tab_base_age_group(tab_key)

    youth_section: Optional[str] = None
    masters_band: Optional[Tuple[int, int]] = None

    last_m: Optional[str] = None
    last_w: Optional[str] = None

    i = 0
    while i < len(rows):
        row = pad_row(rows[i])
        if not any(c.strip() for c in row):
            i += 1
            continue

        joined = " ".join(row)

        if tab == "youth":
            y = detect_youth_age_group(joined)
            if y:
                youth_section = y
                last_m = None
                last_w = None

        if tab == "masters":
            mb = detect_masters_section(joined)
            if mb:
                masters_band = mb
                last_m = None
                last_w = None

        men7, women7 = split_html_row_pair(row)
        if men7 is None or women7 is None:
            i += 1
            continue
        m_lift = men7[1].strip() if len(men7) > 1 else ""
        w_lift = women7[1].strip() if len(women7) > 1 else ""
        m_is_sn = m_lift == "Snatch" or normalize_lift(m_lift) == "Snatch"
        w_is_sn = w_lift == "Snatch" or normalize_lift(w_lift) == "Snatch"

        if m_is_sn or w_is_sn:
            age_m, age_w = resolve_age_groups(
                tab, base, youth_section, masters_band
            )
            if age_m is None or age_w is None:
                i += 1
                continue
            for side, ag, lw in (
                ("M", age_m, last_m),
                ("F", age_w, last_w),
            ):
                rec = parse_triple_block_side(
                    rows,
                    i,
                    ag,
                    lw,
                    men_side=(side == "M"),
                )
                if rec:
                    rec["gender_code"] = side
                    rec["age_group"] = ag
                    yield rec
                    wc = rec.get("weight_class")
                    if wc and not str(wc).endswith("+"):
                        if side == "M":
                            last_m = wc
                        else:
                            last_w = wc
        i += 1


def resolve_age_groups(
    tab: str,
    base: Optional[str],
    youth_section: Optional[str],
    masters_band: Optional[Tuple[int, int]],
) -> Tuple[Optional[str], Optional[str]]:
    if tab == "youth":
        y = youth_section or "U13"
        return y, y
    if tab == "masters":
        if not masters_band:
            return None, None
        lo, hi = masters_band
        m_code, w_code = map_masters_section_to_codes(lo, hi)
        return m_code, w_code
    if base:
        return base, base
    return "Open", "Open"


def parse_triple_block_side(
    rows: List[List[str]],
    start_i: int,
    age_group: str,
    last_weight: Optional[str],
    men_side: bool = True,
) -> Optional[Dict[str, Any]]:
    if start_i + 2 >= len(rows):
        return None

    def side7(idx: int) -> List[str]:
        m, w = split_html_row_pair(rows[idx] if idx < len(rows) else [])
        if m is None or w is None:
            return ["", "", "", "", "", "", ""]
        return m if men_side else w

    r0 = side7(start_i)
    r1 = side7(start_i + 1)
    r2 = side7(start_i + 2)

    wc = (r0[0].strip() if r0 else "") or ""
    if not wc and last_weight:
        wc = f"{last_weight}+"

    if not wc:
        return None

    lifts_out: List[Dict[str, Any]] = []
    for label_row, r in (
        ("Snatch", r0),
        ("C & J", r1),
        ("Total", r2),
    ):
        lift_norm = normalize_lift(r[1].strip() if len(r) > 1 else "")
        if not lift_norm:
            lift_norm = normalize_lift(label_row) or label_row
        val_raw = r[2].strip() if len(r) > 2 else ""
        try:
            record_kg = int(float(val_raw)) if val_raw else None
        except ValueError:
            record_kg = None
        name = normalize_person_name(r[3] if len(r) > 3 else "")
        date_s = parse_date_to_iso(r[5] if len(r) > 5 else "")
        place = (r[6] if len(r) > 6 else "").strip()

        lifts_out.append(
            {
                "lift": lift_norm,
                "record": record_kg,
                "name": name,
                "date": date_s,
                "place": place,
            }
        )

    return {
        "weight_class": wc,
        "age_group": age_group,
        "lifts": lifts_out,
    }


OUTPUT_FIELDS = [
    "federation",
    "recordName",
    "ageGroup",
    "gender",
    "ageMin",
    "ageMax",
    "bodyWeightMin",
    "bodyWeightMax",
    "lift",
    "record",
    "name",
    "date",
    "place",
]


def emit_csv_rows(
    federation: str,
    record_name: str,
    ref: Dict[Tuple[str, str, str], Dict[str, Any]],
    parsed: Iterable[Dict[str, Any]],
) -> List[List[str]]:
    out: List[List[str]] = []
    for block in parsed:
        ag = block["age_group"]
        gcode = block["gender_code"]
        wc = block["weight_class"]
        meta = lookup_meta(ref, ag, gcode, wc)
        if not meta:
            continue
        for lift in block["lifts"]:
            rec_val = lift.get("record")
            if rec_val is None:
                continue
            row = [
                federation,
                record_name,
                ag,
                gcode,
                meta["ageMin"],
                meta["ageMax"],
                meta["bodyWeightMin"],
                meta["bodyWeightMax"],
                lift["lift"],
                str(rec_val),
                lift["name"],
                lift["date"],
                lift["place"],
            ]
            out.append(row)
    return out


def run(
    federation: str,
    record_name: str,
    carolina_sheet_id: str,
    reference_spreadsheet_id: str,
    reference_gid: str,
    tabs: Optional[Sequence[str]] = None,
) -> List[List[str]]:
    ref = fetch_reference_map(reference_spreadsheet_id, reference_gid)
    want = set(t.lower() for t in tabs) if tabs else set(CAROLINA_TABS.keys())
    all_rows: List[List[str]] = []
    for tab_key, gid in CAROLINA_TABS.items():
        if tab_key not in want:
            continue
        grid = fetch_carolina_rows(carolina_sheet_id, gid)
        blocks = iter_side_by_side_records(grid, tab_key)
        rows = emit_csv_rows(federation, record_name, ref, blocks)
        all_rows.extend(rows)
    return all_rows


def main() -> None:
    p = argparse.ArgumentParser(
        description="Convert Carolina WSO htmlview tabs to reference CSV format."
    )
    p.add_argument(
        "--federation",
        default="Carolina",
        help="Value for federation and recordName columns",
    )
    p.add_argument(
        "--record-name",
        default=None,
        help="Override recordName (defaults to --federation)",
    )
    p.add_argument("--carolina-sheet-id", default=DEFAULT_CAROLINA_SHEET_ID)
    p.add_argument("--reference-spreadsheet-id", default=DEFAULT_REFERENCE_SPREADSHEET_ID)
    p.add_argument("--reference-gid", default=DEFAULT_REFERENCE_GID)
    p.add_argument(
        "--tabs",
        default=",".join(CAROLINA_TABS.keys()),
        help=f"Comma-separated subset of: {','.join(CAROLINA_TABS.keys())}",
    )
    p.add_argument(
        "-o",
        "--output",
        default="-",
        help="Output CSV path, or - for stdout",
    )
    args = p.parse_args()
    record_name = args.record_name or args.federation
    tabs = [t.strip() for t in args.tabs.split(",") if t.strip()]
    try:
        rows = run(
            federation=args.federation,
            record_name=record_name,
            carolina_sheet_id=args.carolina_sheet_id,
            reference_spreadsheet_id=args.reference_spreadsheet_id,
            reference_gid=args.reference_gid,
            tabs=tabs,
        )
    except (urllib.error.URLError, urllib.error.HTTPError, OSError, ValueError) as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)

    out_fp = sys.stdout if args.output == "-" else open(args.output, "w", newline="")
    try:
        w = csv.writer(out_fp)
        w.writerow(OUTPUT_FIELDS)
        w.writerows(rows)
    finally:
        if out_fp is not sys.stdout:
            out_fp.close()


if __name__ == "__main__":
    main()
