#!/usr/bin/env python3
"""
Validate correctIndex in questions.json against checked checkboxes in PDF files.

Independently re-detects which checkbox is filled for every question and
compares with the stored correctIndex. Reports all mismatches.

Usage: python3 validate-answers.py [path_to_pdf_dir]
Default PDF dir: ../../testy_pdf/ (relative to this script)
"""

import sys
import os
import json
import re
import fitz  # PyMuPDF

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DEFAULT_PDF_DIR = os.path.join(SCRIPT_DIR, "..", "..", "testy_pdf")
QUESTIONS_JSON = os.path.join(SCRIPT_DIR, "..", "data", "questions.json")

DPI = 600
SCALE = DPI / 72
CHECKBOX_WIDTH_PT = 19
CHECKBOX_MARGIN_PT = 3
CHECKBOX_Y_ABOVE = 3
CHECKBOX_Y_BELOW = 10
DARK_PIXEL_THRESHOLD = 150

FOOTER_PATTERN = re.compile(r"[Vv]erze\s+\d+\.\d+\s+ze\s+dne\s+\d+")


def extract_category_info(filename):
    base = os.path.splitext(filename)[0]
    name_map = {
        1: "Letecký zákon a postupy ATC",
        2: "Lidská výkonnost",
        3: "Meteorologie",
        4: "Letové zásady",
        5: "Komunikace",
        6: "Provozní postupy",
        7: "Výkonnost a plánování letu",
        8: "Obecné znalosti o letadle",
        9: "Navigace",
    }
    if base == "Komunikace":
        return 5, name_map[5]
    if base.startswith("Letove-zasady"):
        return 4, name_map[4]
    match = re.match(r"(\d+)", base)
    if not match:
        return None, base
    cat_id = int(match.group(1))
    return cat_id, name_map.get(cat_id, base)


def count_dark_pixels(pixmap, text_x0, y_top):
    cb_x_left = text_x0 - CHECKBOX_WIDTH_PT - CHECKBOX_MARGIN_PT
    cb_x_right = text_x0 - CHECKBOX_MARGIN_PT
    x_start = int(cb_x_left * SCALE)
    x_end = int(cb_x_right * SCALE)
    y_start = int((y_top - CHECKBOX_Y_ABOVE) * SCALE)
    y_end = int((y_top + CHECKBOX_Y_BELOW) * SCALE)
    dark = 0
    total = 0
    for x_px in range(max(0, x_start), min(pixmap.width, x_end)):
        for y_px in range(max(0, y_start), min(pixmap.height, y_end)):
            r, g, b = pixmap.pixel(x_px, y_px)[:3]
            total += 1
            if r < DARK_PIXEL_THRESHOLD:
                dark += 1
    return dark, total


def find_correct_by_checkboxes(pixmap, text_x0, checkbox_ys):
    """Find correct answer using checkbox glyph y-positions (not text y-positions).
    Returns (index, confidence, counts) where confidence is max/second_max ratio."""
    if not checkbox_ys:
        return None, 0.0, []
    counts = []
    for y_pos in checkbox_ys:
        dark, total = count_dark_pixels(pixmap, text_x0, y_pos)
        counts.append(dark)
    if not counts:
        return None, 0.0, counts
    max_dark = max(counts)
    min_dark = min(counts)
    if max_dark > min_dark * 1.10 and max_dark > 0:
        sorted_counts = sorted(counts, reverse=True)
        second = sorted_counts[1] if len(sorted_counts) > 1 else 0
        confidence = (max_dark - second) / second * 100 if second > 0 else 999.0
        return counts.index(max_dark), confidence, counts
    return None, 0.0, counts


def extract_questions_from_pdf(filepath):
    """Extract questions with their checkbox positions for validation."""
    doc = fitz.open(filepath)
    questions = []

    for page_num in range(len(doc)):
        page = doc[page_num]
        pixmap = page.get_pixmap(dpi=DPI)
        blocks = page.get_text("dict")["blocks"]

        # Extract all spans
        raw_spans = []
        checkbox_ys = []
        for block in blocks:
            if "lines" not in block:
                continue
            for line in block["lines"]:
                for span in line["spans"]:
                    text = span["text"]
                    font = span["font"]
                    bbox = span["bbox"]
                    if "MDL2" in font:
                        checkbox_ys.append(bbox[1])
                        continue
                    text = re.sub(r"[\uf000-\uf8ff]", "", text)
                    if not text.strip():
                        continue
                    raw_spans.append({
                        "text": text,
                        "x0": bbox[0],
                        "y0": bbox[1],
                        "bold": "Bold" in font or "bold" in font,
                    })

        # Group spans into lines
        lines = []
        for span in raw_spans:
            merged = False
            for existing in lines:
                if abs(existing["y0"] - span["y0"]) < 3:
                    existing["text"] += span["text"]
                    existing["bold"] = existing["bold"] or span["bold"]
                    existing["x0"] = min(existing["x0"], span["x0"])
                    merged = True
                    break
            if not merged:
                lines.append({
                    "text": span["text"],
                    "y0": span["y0"],
                    "x0": span["x0"],
                    "bold": span["bold"],
                })
        lines.sort(key=lambda l: l["y0"])
        lines = [l for l in lines if not FOOTER_PATTERN.search(l["text"].strip())]

        # Find answer x0 (most common non-bold x)
        answer_x_vals = [l["x0"] for l in lines if not l["bold"]]
        if not answer_x_vals:
            continue
        from collections import Counter
        answer_x0 = Counter([round(x, 0) for x in answer_x_vals]).most_common(1)[0][0]

        # Detect question number x position
        q_number_xs = []
        for line in lines:
            text = line["text"].strip()
            if line["bold"] and re.match(r"^\d+\s", text) and line["x0"] < 100:
                q_number_xs.append(line["x0"])
        q_x_max = (min(q_number_xs) + 10) if q_number_xs else 82

        # Parse questions on this page
        current_q = None
        claimed_checkboxes = set()

        for line in lines:
            text = line["text"].strip()
            if not text:
                continue

            q_match = re.match(r"^(\d+)\s+(.*)", text)

            if q_match and line["bold"] and line["x0"] < q_x_max:
                if current_q and current_q["checkbox_ys"]:
                    correct, conf, counts = find_correct_by_checkboxes(
                        pixmap, answer_x0, current_q["checkbox_ys"]
                    )
                    current_q["detected_correct"] = correct
                    current_q["confidence"] = conf
                    current_q["pixel_counts"] = counts
                    questions.append(current_q)

                q_num = int(q_match.group(1))
                current_q = {
                    "number": q_num,
                    "text": q_match.group(2).strip(),
                    "page": page_num,
                    "checkbox_ys": [],
                    "option_count": 0,
                    "detected_correct": None,
                    "confidence": 0.0,
                    "pixel_counts": [],
                }
                claimed_checkboxes = set()

            elif current_q and not line["bold"]:
                # Check if this line starts a new option (has unclaimed checkbox)
                nearest_cb = None
                nearest_dist = float("inf")
                for cy in checkbox_ys:
                    dist = abs(cy - line["y0"])
                    if dist < nearest_dist:
                        nearest_dist = dist
                        nearest_cb = cy

                is_new_option = (
                    nearest_cb is not None
                    and nearest_dist < 15
                    and nearest_cb not in claimed_checkboxes
                )

                if is_new_option:
                    current_q["option_count"] += 1
                    current_q["checkbox_ys"].append(nearest_cb)
                    claimed_checkboxes.add(nearest_cb)

        # Don't forget last question on page
        if current_q and current_q["checkbox_ys"]:
            correct, conf, counts = find_correct_by_checkboxes(
                pixmap, answer_x0, current_q["checkbox_ys"]
            )
            current_q["detected_correct"] = correct
            current_q["confidence"] = conf
            current_q["pixel_counts"] = counts
            questions.append(current_q)

    doc.close()
    return questions


def main():
    pdf_dir = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_PDF_DIR
    pdf_dir = os.path.abspath(pdf_dir)

    with open(QUESTIONS_JSON, encoding="utf-8") as f:
        json_data = json.load(f)

    # Build lookup: id -> correctIndex
    json_lookup = {}
    for q in json_data["questions"]:
        json_lookup[q["id"]] = q["correctIndex"]

    pdf_files = sorted([f for f in os.listdir(pdf_dir) if f.endswith(".pdf")])
    total_checked = 0
    validated_ids = set()
    mismatches = []
    undetected = []
    low_confidence = []

    CONFIDENCE_THRESHOLD = 20.0  # % difference — below this is "tight"

    for pdf_file in pdf_files:
        filepath = os.path.join(pdf_dir, pdf_file)
        cat_id, cat_name = extract_category_info(pdf_file)
        if cat_id is None:
            continue

        print(f"Validating: {cat_id}. {cat_name}...")
        pdf_questions = extract_questions_from_pdf(filepath)

        for pq in pdf_questions:
            qid = f"{cat_id}-{pq['number']}"
            if qid not in json_lookup:
                continue

            total_checked += 1
            validated_ids.add(qid)
            json_correct = json_lookup[qid]
            pdf_correct = pq["detected_correct"]
            confidence = pq.get("confidence", 0.0)
            pixel_counts = pq.get("pixel_counts", [])

            if pdf_correct is None:
                undetected.append({
                    "id": qid,
                    "text": pq["text"][:60],
                    "json_correct": json_correct,
                    "pixel_counts": pixel_counts,
                })
            elif pdf_correct != json_correct:
                mismatches.append({
                    "id": qid,
                    "text": pq["text"][:60],
                    "json_correct": json_correct,
                    "pdf_correct": pdf_correct,
                    "confidence": confidence,
                    "pixel_counts": pixel_counts,
                })
            elif confidence < CONFIDENCE_THRESHOLD:
                low_confidence.append({
                    "id": qid,
                    "text": pq["text"][:60],
                    "correct": pdf_correct,
                    "confidence": confidence,
                    "pixel_counts": pixel_counts,
                })

    print(f"\n{'='*70}")
    print(f"Total questions validated: {total_checked}")
    print(f"Mismatches: {len(mismatches)}")
    print(f"Undetected (no clear checkbox): {len(undetected)}")

    if mismatches:
        print(f"\n{'='*70}")
        print("MISMATCHES (correctIndex in JSON != detected in PDF):")
        print(f"{'='*70}")
        for m in mismatches:
            json_letter = chr(65 + m["json_correct"])
            pdf_letter = chr(65 + m["pdf_correct"])
            print(f"  {m['id']:>6}  JSON={json_letter}({m['json_correct']})  PDF={pdf_letter}({m['pdf_correct']})  {m['text']}")

    if undetected:
        print(f"\n{'='*70}")
        print("UNDETECTED (could not determine correct answer from PDF):")
        print(f"{'='*70}")
        for u in undetected:
            json_letter = chr(65 + u["json_correct"])
            print(f"  {u['id']:>6}  JSON={json_letter}({u['json_correct']})  {u['text']}")

    if not mismatches and not undetected:
        print("\nAll answers match! ✓")

    low_confidence.sort(key=lambda x: x["confidence"])
    if low_confidence:
        print(f"\n{'='*70}")
        print(f"LOW CONFIDENCE ({len(low_confidence)} questions with <{CONFIDENCE_THRESHOLD}% pixel margin):")
        print(f"{'='*70}")
        print(f"  {'ID':>6}  {'Conf':>6}  {'Ans':>3}  {'Pixels (A, B, C, D)':>30}  Question")
        print(f"  {'─'*6}  {'─'*6}  {'─'*3}  {'─'*30}  {'─'*40}")
        for lc in low_confidence:
            letter = chr(65 + lc["correct"])
            counts_str = ", ".join(str(c) for c in lc["pixel_counts"])
            print(f"  {lc['id']:>6}  {lc['confidence']:5.1f}%  {letter:>3}  {counts_str:>30}  {lc['text']}")
    else:
        print(f"\nNo low-confidence detections (all above {CONFIDENCE_THRESHOLD}% margin) ✓")

    not_validated = sorted(
        [qid for qid in json_lookup if qid not in validated_ids],
        key=lambda x: (int(x.split("-")[0]), int(x.split("-")[1])),
    )
    if not_validated:
        print(f"\n{'='*70}")
        print(f"NOT VALIDATED ({len(not_validated)} questions not found by validator in PDF):")
        print(f"{'='*70}")
        for qid in not_validated:
            q = next((q for q in json_data["questions"] if q["id"] == qid), None)
            text = q["question"][:60].replace("\n", " ") if q else "?"
            print(f"  {qid:>6}  JSON={chr(65+json_lookup[qid])}({json_lookup[qid]})  {text}")

    return len(mismatches)


if __name__ == "__main__":
    sys.exit(main())
