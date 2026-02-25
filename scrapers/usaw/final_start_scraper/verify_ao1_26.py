import csv
import re
from pathlib import Path

import pdfplumber

from ao1_26 import parse_entry_line

PDF_PATH = Path("/tmp/vws1_start_list_v2.pdf")
CSV_PATH = Path(__file__).resolve().parent / "ao1_26.csv"


def main() -> None:
    with CSV_PATH.open(newline="", encoding="utf-8") as handle:
        csv_rows = list(csv.DictReader(handle))

    pat_normal = re.compile(
        r"\s\d{1,3}[A-Z]\s+(\d+(?:\.\d+)?)(RED|WHITE|BLUE|STARS|STRIPES|ROGUE)\s+\d{1,2}-[A-Za-z]{3}\s+\d{1,2}:\d{2}\s+[AP]M$"
    )
    pat_rogue = re.compile(
        r"\s\d{1,3}ROGUE\s+(\d+(?:\.\d+)?)ROGUE\s+\d{1,2}-[A-Za-z]{3}\s+\d{1,2}:\d{2}\s+[AP]M$",
        re.IGNORECASE,
    )

    pdf_parseable = 0
    missing = []

    with pdfplumber.open(PDF_PATH) as pdf:
        for page_i, page in enumerate(pdf.pages, 1):
            text = page.extract_text() or ""
            for raw in text.splitlines():
                line = " ".join(raw.split())
                if pat_normal.search(line) or pat_rogue.search(line):
                    pdf_parseable += 1
                    if not parse_entry_line(line):
                        missing.append((page_i, line))

    print(f"CSV rows: {len(csv_rows)}")
    print(f"PDF parseable athlete lines: {pdf_parseable}")
    print(f"Rows parsed by scraper logic: {pdf_parseable - len(missing)}")
    print(f"Missing lines: {len(missing)}")
    for index, (page, line) in enumerate(missing, 1):
        print(f"{index}. page {page}: {line}")


if __name__ == "__main__":
    main()
