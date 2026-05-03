#!/usr/bin/env python3
"""
Independent answer validation against questions.json.

For ORIGINAL questions (cat IDs 1-9, no "S" prefix in question ID):
    - Re-parses 9 source PDFs in testy_pdf/
    - Detects checked checkboxes using INTERIOR-pixel sampling: an empty
      Segoe MDL2 Assets checkbox glyph is just an outline, while a checked
      one fills the interior with a check pattern. We render at 600 dpi,
      sample only the interior of the checkbox (excluding borders), and
      pick the option with the highest dark-pixel ratio.
    - Independence vs parse-pdfs.py:
        * parse-pdfs.py derives the checkbox bbox from text_x0 - 22pt
          (where the answer text starts). This validator derives it from
          the MDL2 span's own x-coord, expanded inward by a fixed margin.
        * parse-pdfs.py samples the FULL checkbox area (border + interior).
          This validator samples only the INTERIOR — the difference between
          checked and empty is much larger here (≈2.4×) which makes the
          decision robust even when the main parser's 10 % margin is tight.
        * parse-pdfs.py compares max-dark with min-dark (rank-based).
          This validator requires the winner's interior dark ratio to be
          ≥ 1.5× the median of the others (absolute confidence).

For SUPPLEMENT questions (ID format {cat}-S{n}):
    - Re-extracts text from PPL_Supplement_2026.pdf
    - Independently regex-matches the "Správná odpověď: X)" line on each page
    - Compares against questions.json correctIndex

Mismatches are listed verbatim. Exit code is 0 only if zero mismatches.

Usage:
    python3 scripts/validate-all-answers.py
    python3 scripts/validate-all-answers.py --verbose
"""

import argparse
import json
import os
import re
import sys
from collections import defaultdict

import fitz  # PyMuPDF

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PDF_DIR = os.path.abspath(os.path.join(SCRIPT_DIR, "..", "..", "testy_pdf"))
QUESTIONS_PATH = os.path.join(SCRIPT_DIR, "..", "data", "questions.json")
SUPP_PDF = os.path.join(PDF_DIR, "PPL_Supplement_2026.pdf")

# --- Original-PDF detection params ---
DPI = 600
SCALE = DPI / 72
DARK_THRESHOLD = 150  # RGB R-channel threshold; below = dark

# Interior-of-checkbox bbox, derived from MDL2 span's x-coord.
# MDL2 span sits at x ≈ 61..64 (text-width 2.4pt), but the rendered glyph
# extends ≈8pt left of the span. We sample interior x = span_x - 8 .. span_x + 0
# and y = span_y + 1.5pt .. span_y + 8pt (excludes top/bottom borders).
INTERIOR_X_LEFT_OFFSET = -8.0   # relative to MDL2 span x0
INTERIOR_X_RIGHT_OFFSET = 0.0   # relative to MDL2 span x0
INTERIOR_Y_TOP_OFFSET = 1.5     # relative to MDL2 span y0
INTERIOR_Y_BOTTOM_OFFSET = 8.0  # relative to MDL2 span y0

# Decision threshold: winner must have ≥ this ratio over the median of others.
WIN_RATIO = 1.5

FOOTER_PATTERN = re.compile(r"[Vv]erze\s+\d+\.\d+\s+ze\s+dne\s+\d+")


# ----------------------------------------------------------------------
# Helpers shared with the main parser (re-implemented for independence)
# ----------------------------------------------------------------------


def category_id_from_filename(filename):
    """Match filename to existing categoryId. Mirrors parse-pdfs.py."""
    base = os.path.splitext(filename)[0]
    if base == "Komunikace":
        return 5
    if base.startswith("Letove-zasady"):
        return 4
    m = re.match(r"(\d+)", base)
    return int(m.group(1)) if m else None


def extract_lines_and_checkboxes(page):
    """Return (text_lines, checkbox_spans) for a page.

    text_lines is a list of {text, x0, y0, x1, bold} grouped by y-position.
    checkbox_spans is a list of (x0, y0, x1, y1) — bboxes of MDL2 glyphs.
    """
    raw_spans = []
    cb_spans = []

    for block in page.get_text("dict")["blocks"]:
        if "lines" not in block:
            continue
        for line in block["lines"]:
            for span in line["spans"]:
                font = span.get("font", "")
                bbox = span["bbox"]
                if "MDL2" in font:
                    cb_spans.append(bbox)
                    continue
                text = re.sub(r"[-]", "", span["text"])
                if not text.strip():
                    continue
                raw_spans.append({
                    "text": text,
                    "x0": bbox[0],
                    "y0": bbox[1],
                    "x1": bbox[2],
                    "bold": "Bold" in font or "bold" in font,
                })

    # Group spans into lines by y0 (≤3pt tolerance)
    lines = []
    for s in raw_spans:
        merged = False
        for ln in lines:
            if abs(ln["y0"] - s["y0"]) < 3:
                ln["text"] += s["text"]
                ln["x0"] = min(ln["x0"], s["x0"])
                ln["x1"] = max(ln["x1"], s["x1"])
                ln["bold"] = ln["bold"] or s["bold"]
                merged = True
                break
        if not merged:
            lines.append({
                "text": s["text"],
                "x0": s["x0"],
                "y0": s["y0"],
                "x1": s["x1"],
                "bold": s["bold"],
            })
    lines.sort(key=lambda ln: ln["y0"])
    lines = [ln for ln in lines if not FOOTER_PATTERN.search(ln["text"].strip())]
    cb_spans.sort(key=lambda bb: bb[1])
    return lines, cb_spans


def detect_question_groups(pages_data):
    """Walk pages in order, group MDL2 spans into 4-tuples per question.

    Returns list of {q_num, page_idx, option_bboxes: [4 mdl2 bboxes]}.
    Handles questions split across pages (last <4 options carry over).
    """
    # Discover the typical question-header x0 (different per PDF).
    # We look across all pages for bold lines starting with a digit and pick
    # the smallest such x0 — that's the left-margin column for question numbers.
    candidate_x0 = []
    for _, (lines, _cbs) in enumerate(pages_data):
        for ln in lines:
            text = ln["text"].strip()
            if ln["bold"] and re.match(r"^\d+\b", text):
                candidate_x0.append(ln["x0"])
    if not candidate_x0:
        return []
    q_x_min = min(candidate_x0)
    q_x_max = q_x_min + 10  # tolerance: same column ±10pt

    # Discover typical MDL2 span (x0, width) — drop overlays and stray glyphs.
    # When a checkbox is rendered with a check overlay, the PDF often emits
    # an extra MDL2 span at the same y but with anomalous width (e.g. 18pt
    # instead of the usual ~2.5pt). Keep only spans that match the dominant
    # (x0, width) tuple to within a small tolerance.
    from collections import Counter
    span_x0 = []
    span_w = []
    for _, (_, cbs) in enumerate(pages_data):
        for bb in cbs:
            span_x0.append(round(bb[0], 1))
            span_w.append(round(bb[2] - bb[0], 1))
    if span_x0:
        typ_x0 = Counter(span_x0).most_common(1)[0][0]
        typ_w = Counter(span_w).most_common(1)[0][0]
        # Filter each page's checkbox list
        new_pages_data = []
        for lines, cbs in pages_data:
            kept = [bb for bb in cbs
                    if abs(bb[0] - typ_x0) < 1.0
                    and abs((bb[2] - bb[0]) - typ_w) < 1.5]
            new_pages_data.append((lines, kept))
        pages_data = new_pages_data

    groups = []
    pending = None  # carry-over question whose options span across pages

    for page_idx, (lines, cb_spans) in enumerate(pages_data):
        # Question headers: bold lines starting with a number at left margin
        q_headers = []
        for ln in lines:
            m = re.match(r"^(\d+)\b", ln["text"].strip())
            if m and ln["bold"] and ln["x0"] <= q_x_max:
                q_headers.append({"num": int(m.group(1)), "y0": ln["y0"]})

        # Sort by y
        q_headers.sort(key=lambda h: h["y0"])

        # If we have a pending question (carry-over), absorb leading checkboxes
        # whose y is BEFORE the first new question header on this page.
        if pending is not None:
            cutoff_y = q_headers[0]["y0"] if q_headers else float("inf")
            absorbed = []
            for bb in cb_spans:
                if bb[1] < cutoff_y:
                    absorbed.append(bb)
                else:
                    break
            need = 4 - len(pending["option_bboxes"])
            taken = absorbed[:need]
            pending["option_bboxes"].extend(taken)
            pending["page_idx_extra"].append(page_idx)
            cb_spans = cb_spans[len(taken):]
            if len(pending["option_bboxes"]) >= 4:
                groups.append(pending)
                pending = None

        # Now walk question headers on this page
        for i, qh in enumerate(q_headers):
            next_qh_y = q_headers[i + 1]["y0"] if i + 1 < len(q_headers) else float("inf")
            # Checkboxes between this header and next header
            opts = [bb for bb in cb_spans if qh["y0"] < bb[1] < next_qh_y]
            entry = {
                "q_num": qh["num"],
                "page_idx": page_idx,
                "option_bboxes": opts[:4],
                "page_idx_extra": [],
            }
            if len(entry["option_bboxes"]) >= 4:
                groups.append(entry)
            else:
                # Likely split across pages
                pending = entry

    if pending is not None and len(pending["option_bboxes"]) >= 4:
        groups.append(pending)

    return groups


def count_interior_dark(pix, span_bbox):
    """Count dark pixels in the interior of the checkbox at this MDL2 span."""
    sx0, sy0, _sx1, _sy1 = span_bbox
    x0_pt = sx0 + INTERIOR_X_LEFT_OFFSET
    x1_pt = sx0 + INTERIOR_X_RIGHT_OFFSET
    y0_pt = sy0 + INTERIOR_Y_TOP_OFFSET
    y1_pt = sy0 + INTERIOR_Y_BOTTOM_OFFSET

    x0 = int(x0_pt * SCALE)
    x1 = int(x1_pt * SCALE)
    y0 = int(y0_pt * SCALE)
    y1 = int(y1_pt * SCALE)

    dark = 0
    total = 0
    for x in range(max(0, x0), min(pix.width, x1)):
        for y in range(max(0, y0), min(pix.height, y1)):
            r, _g, _b = pix.pixel(x, y)[:3]
            total += 1
            if r < DARK_THRESHOLD:
                dark += 1
    return dark, total


def detect_checked_index(page_pixmaps, group):
    """Return (idx, ratios) — idx = which option is checked (0-3) or None.

    page_pixmaps is a dict {page_idx: pixmap}. group["option_bboxes"] may
    span pages if page_idx_extra is non-empty.
    """
    bboxes = group["option_bboxes"][:4]
    pages = [group["page_idx"]] * len(bboxes)
    # If split across pages, the carry-over options live on the next page(s).
    # We approximate by checking each bbox: if its y is unusually small
    # compared to the previous, it's on the next page.
    for i in range(1, len(bboxes)):
        if bboxes[i][1] < bboxes[i - 1][1] - 50:
            pages[i] = pages[i - 1] + 1
    if group["page_idx_extra"]:
        # Conservative: assign tail bboxes to the extra page(s)
        n_extra = len(group["page_idx_extra"])
        pages[-n_extra:] = group["page_idx_extra"][:n_extra]

    ratios = []
    for i, bbox in enumerate(bboxes):
        pix = page_pixmaps[pages[i]]
        dark, total = count_interior_dark(pix, bbox)
        ratios.append(dark / total if total else 0.0)

    if not ratios:
        return None, ratios

    # Pick winner: highest ratio, must be ≥ WIN_RATIO × median of others
    sorted_indices = sorted(range(len(ratios)), key=lambda i: -ratios[i])
    winner_idx = sorted_indices[0]
    winner_val = ratios[winner_idx]
    others = [r for j, r in enumerate(ratios) if j != winner_idx]
    if not others:
        return winner_idx, ratios

    sorted_others = sorted(others)
    median_others = sorted_others[len(sorted_others) // 2]

    # Avoid division by zero — if median is ~0, require winner > 0.02
    if median_others < 0.005:
        if winner_val > 0.02:
            return winner_idx, ratios
        return None, ratios

    if winner_val >= WIN_RATIO * median_others:
        return winner_idx, ratios

    return None, ratios


# ----------------------------------------------------------------------
# Validation passes
# ----------------------------------------------------------------------


def validate_original_pdfs(json_questions, verbose=False):
    """Returns list of mismatch dicts."""
    questions_by_cat = defaultdict(dict)  # cat_id -> {q_num: question}
    for q in json_questions:
        if q.get("supplement"):
            continue
        m = re.match(r"^(\d+)-(\d+)$", q["id"])
        if not m:
            continue  # skip malformed IDs
        cat = int(m.group(1))
        num = int(m.group(2))
        questions_by_cat[cat][num] = q

    if not os.path.isdir(PDF_DIR):
        print(f"ERROR: PDF dir not found: {PDF_DIR}", file=sys.stderr)
        return [{"_error": "pdf_dir_missing"}]

    mismatches = []
    not_found = []
    ambiguous = []
    checked_total = 0

    pdf_files = sorted(f for f in os.listdir(PDF_DIR)
                       if f.endswith(".pdf") and "Supplement" not in f)

    for pdf_file in pdf_files:
        cat_id = category_id_from_filename(pdf_file)
        if cat_id is None:
            continue

        path = os.path.join(PDF_DIR, pdf_file)
        doc = fitz.open(path)

        # Pre-compute lines, checkbox bboxes, and pixmaps for every page
        pages_data = []
        page_pixmaps = {}
        for i in range(len(doc)):
            lines, cbs = extract_lines_and_checkboxes(doc[i])
            pages_data.append((lines, cbs))
            page_pixmaps[i] = doc[i].get_pixmap(dpi=DPI)

        groups = detect_question_groups(pages_data)

        if verbose:
            print(f"  {pdf_file}: parsed {len(groups)} question groups")

        seen_q_nums = set()
        for g in groups:
            q_num = g["q_num"]
            # Provisional q_num for split-across-page entries; if we already
            # processed q_num on this PDF, this one is a phantom.
            if q_num in seen_q_nums:
                continue
            seen_q_nums.add(q_num)

            json_q = questions_by_cat.get(cat_id, {}).get(q_num)
            if json_q is None:
                continue  # JSON skipped this question (parse-pdfs.py warning)

            checked_total += 1
            detected, ratios = detect_checked_index(page_pixmaps, g)
            if detected is None:
                ambiguous.append({
                    "id": json_q["id"],
                    "ratios": ratios,
                    "json_correct": json_q["correctIndex"],
                    "page": g["page_idx"] + 1,
                })
                continue

            if detected != json_q["correctIndex"]:
                mismatches.append({
                    "id": json_q["id"],
                    "question": json_q["question"],
                    "options": json_q["options"],
                    "json_correct": json_q["correctIndex"],
                    "pdf_correct": detected,
                    "ratios": ratios,
                    "page": g["page_idx"] + 1,
                })

        # Find JSON questions not encountered in PDF parse
        json_nums = set(questions_by_cat.get(cat_id, {}).keys())
        for missing in sorted(json_nums - seen_q_nums):
            not_found.append({
                "id": f"{cat_id}-{missing}",
                "reason": "not visited by validator (structure mismatch)",
            })

        doc.close()

    return mismatches, ambiguous, not_found, checked_total


def validate_supplement_pdf(json_questions, verbose=False):
    """Independently regex 'Správná odpověď: X)' on each page."""
    if not os.path.isfile(SUPP_PDF):
        print(f"ERROR: Supplement PDF not found: {SUPP_PDF}", file=sys.stderr)
        return [], [], 0

    supp_by_num = {}
    for q in json_questions:
        if not q.get("supplement"):
            continue
        m = re.match(r"^(\d+)-S(\d+)$", q["id"])
        if not m:
            continue
        supp_by_num[int(m.group(2))] = q

    HDR = re.compile(r"^Otázka\s+(\d+)\s+·\s+Předmět\s+\d+\s*$", re.M)
    ANS = re.compile(r"^Správná odpověď:\s*([A-D])\)", re.M)

    doc = fitz.open(SUPP_PDF)
    mismatches = []
    not_found = []
    checked_total = 0

    seen_nums = set()
    for i in range(len(doc)):
        text = doc[i].get_text()
        h = HDR.search(text)
        if not h:
            continue
        q_num = int(h.group(1))
        a = ANS.search(text)
        if not a:
            continue
        letter = a.group(1)
        pdf_correct = "ABCD".index(letter)

        json_q = supp_by_num.get(q_num)
        if json_q is None:
            continue
        checked_total += 1
        seen_nums.add(q_num)

        if pdf_correct != json_q["correctIndex"]:
            mismatches.append({
                "id": json_q["id"],
                "question": json_q["question"],
                "options": json_q["options"],
                "json_correct": json_q["correctIndex"],
                "pdf_correct": pdf_correct,
                "page": i + 1,
            })

    for n, q in supp_by_num.items():
        if n not in seen_nums:
            not_found.append({"id": q["id"], "reason": "no PDF page found"})

    doc.close()
    return mismatches, not_found, checked_total


# ----------------------------------------------------------------------
# Main
# ----------------------------------------------------------------------


def format_mismatch(m):
    q_short = m["question"].replace("\n", " ")[:60]
    json_letter = "ABCD"[m["json_correct"]]
    pdf_letter = "ABCD"[m["pdf_correct"]]
    s = (
        f"  ID: {m['id']:<10}  page {m.get('page', '?')}  "
        f"\"{q_short}...\"\n"
        f"      JSON říká: correctIndex={m['json_correct']} (odpověď {json_letter})\n"
        f"      PDF říká:  zaškrtnutá je odpověď {pdf_letter} (index {m['pdf_correct']})\n"
        f"      → NESHODA"
    )
    if "ratios" in m and m["ratios"]:
        ratios_str = ", ".join(f"{r:.3f}" for r in m["ratios"])
        s += f"   [ratios: {ratios_str}]"
    return s


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--verbose", action="store_true")
    args = ap.parse_args()

    if not os.path.isfile(QUESTIONS_PATH):
        print(f"ERROR: {QUESTIONS_PATH} not found", file=sys.stderr)
        sys.exit(2)

    with open(QUESTIONS_PATH, encoding="utf-8") as f:
        data = json.load(f)
    json_questions = data["questions"]

    print("=" * 78)
    print("VALIDACE ORIGINÁLNÍCH OTÁZEK (interior pixel-ratio detekce)")
    print("=" * 78)
    orig_mis, orig_amb, orig_nf, orig_total = validate_original_pdfs(
        json_questions, verbose=args.verbose
    )

    print(f"\n  Zkontrolováno: {orig_total} otázek z 9 PDF souborů")
    print(f"  Neshody:       {len(orig_mis)}")
    print(f"  Nejednoznačné: {len(orig_amb)} (validátor si není jistý)")
    print(f"  Nenalezené:    {len(orig_nf)}")

    if orig_mis:
        print(f"\n  --- NESHODY ({len(orig_mis)}) ---")
        for m in orig_mis:
            print(format_mismatch(m))

    if orig_amb and args.verbose:
        print(f"\n  --- NEJEDNOZNAČNÉ ({len(orig_amb)}) ---")
        for a in orig_amb:
            ratios_str = ", ".join(f"{r:.3f}" for r in a["ratios"])
            print(f"  {a['id']}  page {a['page']}  ratios=[{ratios_str}]  "
                  f"json_correct={a['json_correct']}")

    if orig_nf and args.verbose:
        print(f"\n  --- NENALEZENO VE VALIDÁTORU ({len(orig_nf)}) ---")
        for n in orig_nf:
            print(f"  {n['id']}: {n['reason']}")

    print()
    print("=" * 78)
    print("VALIDACE DOPLŇKOVÝCH OTÁZEK (regex 'Správná odpověď: X)')")
    print("=" * 78)
    supp_mis, supp_nf, supp_total = validate_supplement_pdf(json_questions)

    print(f"\n  Zkontrolováno: {supp_total} otázek")
    print(f"  Neshody:       {len(supp_mis)}")
    print(f"  Nenalezené:    {len(supp_nf)}")

    if supp_mis:
        print(f"\n  --- NESHODY ({len(supp_mis)}) ---")
        for m in supp_mis:
            print(format_mismatch(m))

    print()
    print("=" * 78)
    print("CELKOVÝ SOUHRN")
    print("=" * 78)
    total_mis = len(orig_mis) + len(supp_mis)
    total_checked = orig_total + supp_total
    print(f"  Celkem zkontrolováno: {total_checked} otázek")
    print(f"  Shody:                {total_checked - total_mis}")
    print(f"  Neshody:              {total_mis}")
    print(f"  Nejednoznačné (orig): {len(orig_amb)} — validátor si není jistý, NUTNÉ ručně ověřit")
    print(f"  Nenalezené:           {len(orig_nf) + len(supp_nf)}")

    if total_mis == 0 and len(orig_amb) == 0:
        print("\n  ✅ VŠE V POŘÁDKU — žádné neshody, žádné nejednoznačné případy.")
        sys.exit(0)
    elif total_mis == 0:
        print("\n  ⚠ Žádné neshody, ale validátor má nejednoznačné případy "
              "— spusť s --verbose pro detail.")
        sys.exit(0)
    else:
        print(f"\n  ❌ NALEZENO {total_mis} NESHOD — vyžaduje opravu.")
        sys.exit(1)


if __name__ == "__main__":
    main()
