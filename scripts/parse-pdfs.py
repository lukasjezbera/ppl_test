#!/usr/bin/env python3
"""
Parse PPL exam PDF files into questions.json.
Uses PyMuPDF (fitz) for text extraction and pixel-based checkbox detection.

Usage: python3 parse-pdfs.py [path_to_pdf_dir]
Default PDF dir: ../../testy_pdf/ (relative to this script)
"""

import sys
import os
import json
import re
import fitz  # PyMuPDF

IMAGE_REF_PATTERN = re.compile(r'\(([A-Z]{2,4}-\d{3})\)')

# --- Config ---
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DEFAULT_PDF_DIR = os.path.join(SCRIPT_DIR, "..", "..", "testy_pdf")
OUTPUT_PATH = os.path.join(SCRIPT_DIR, "..", "data", "questions.json")

DPI = 600
SCALE = DPI / 72
CHECKBOX_WIDTH_PT = 19  # how far left of text the checkbox extends
CHECKBOX_MARGIN_PT = 3   # gap between checkbox right edge and text
CHECKBOX_Y_ABOVE = 3
CHECKBOX_Y_BELOW = 10
DARK_PIXEL_THRESHOLD = 150

FOOTER_PATTERN = re.compile(r"[Vv]erze\s+\d+\.\d+\s+ze\s+dne\s+\d+")


def extract_category_info(filename):
    """Extract category id and name from filename."""
    base = os.path.splitext(filename)[0]
    name_map = {
        1: "Letecký zákon a postupy ATC – letoun",
        2: "Lidská výkonnost – letoun",
        3: "Meteorologie – letoun",
        4: "Letové zásady – letoun",
        5: "Komunikace",
        6: "Provozní postupy – letoun",
        7: "Výkonnost a plánování letu – letoun",
        8: "Obecné znalosti o letadle – letoun",
        9: "Navigace – letoun",
    }
    if base == "Komunikace":
        return 5, name_map[5]
    if base.startswith("Letove-zasady"):
        return 4, name_map[4]
    match = re.match(r"(\d+)", base)
    if not match:
        return None, base
    cat_id = int(match.group(1))
    return cat_id, name_map.get(cat_id, base.replace("-", " "))


def count_dark_pixels_in_checkbox(pixmap, text_x0, y_top):
    """Count dark pixels in the checkbox area to the left of answer text."""
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


def find_correct_answer(pixmap, text_x0, option_y_positions):
    """Find which option has the checked checkbox by comparing dark pixel counts."""
    if not option_y_positions:
        return None

    counts = []
    for y_pos in option_y_positions:
        dark, total = count_dark_pixels_in_checkbox(pixmap, text_x0, y_pos)
        counts.append(dark)

    if not counts:
        return None

    max_dark = max(counts)
    min_dark = min(counts)

    # The checked checkbox should have noticeably more dark pixels
    # Require at least 15% more than unchecked
    if max_dark > min_dark * 1.10 and max_dark > 0:
        return counts.index(max_dark)

    return None


def extract_page_data(page):
    """Extract structured text lines from a page, plus checkbox y-positions."""
    blocks = page.get_text("dict")["blocks"]
    raw_spans = []
    checkbox_ys = []  # y positions where checkboxes exist

    for block in blocks:
        if "lines" not in block:
            continue
        for line in block["lines"]:
            for span in line["spans"]:
                text = span["text"]
                font = span["font"]
                bbox = span["bbox"]

                if "MDL2" in font:
                    # Record checkbox y position
                    checkbox_ys.append(bbox[1])
                    continue
                text = re.sub(r"[\uf000-\uf8ff]", "", text)
                if not text.strip():
                    continue

                raw_spans.append({
                    "text": text,
                    "x0": bbox[0],
                    "y0": bbox[1],
                    "x1": bbox[2],
                    "y1": bbox[3],
                    "bold": "Bold" in font or "bold" in font,
                })

    # Group spans into lines by y position
    lines = []
    for span in raw_spans:
        merged = False
        for existing in lines:
            if abs(existing["y0"] - span["y0"]) < 3:
                existing["text"] += span["text"]
                existing["bold"] = existing["bold"] or span["bold"]
                existing["x0"] = min(existing["x0"], span["x0"])
                existing["x1"] = max(existing["x1"], span["x1"])
                merged = True
                break
        if not merged:
            lines.append({
                "text": span["text"],
                "y0": span["y0"],
                "x0": span["x0"],
                "x1": span["x1"],
                "bold": span["bold"],
            })

    lines.sort(key=lambda l: l["y0"])
    return lines, checkbox_ys


def detect_layout(lines):
    """Detect the x-position thresholds for question numbers, text, and answers."""
    # Find bold lines that start with a number (question headers)
    q_number_x = []
    q_text_x = []

    for line in lines:
        text = line["text"].strip()
        if line["bold"] and re.match(r"^\d+\s", text) and line["x0"] < 100:
            q_number_x.append(line["x0"])

    if not q_number_x:
        return None

    # Find non-bold lines (answer options)
    answer_x = []
    for line in lines:
        if not line["bold"] and not FOOTER_PATTERN.search(line["text"].strip()):
            answer_x.append(line["x0"])

    if not answer_x:
        return None

    # Most common answer x0
    from collections import Counter
    answer_x_counts = Counter([round(x, 0) for x in answer_x])
    common_answer_x = answer_x_counts.most_common(1)[0][0] if answer_x_counts else 95

    q_x = min(q_number_x) if q_number_x else 50

    return {
        "question_x": q_x,
        "answer_x": common_answer_x,
        "question_x_max": q_x + 10,  # question numbers up to this x
    }


def parse_pdf(filepath):
    """Parse a single PDF file and return list of question dicts."""
    doc = fitz.open(filepath)
    all_questions = []

    # Detect layout from first page
    first_page_lines, _ = extract_page_data(doc[0])
    layout = detect_layout(first_page_lines)

    if not layout:
        doc.close()
        return []

    answer_x0 = layout["answer_x"]

    for page_num in range(len(doc)):
        page = doc[page_num]
        pixmap = page.get_pixmap(dpi=DPI)
        lines, checkbox_ys = extract_page_data(page)

        # Filter footer
        lines = [l for l in lines if not FOOTER_PATTERN.search(l["text"].strip())]
        # Also filter near-empty lines
        lines = [l for l in lines if l["text"].strip()]

        current_q = None

        for line in lines:
            text = line["text"].strip()
            if not text:
                continue

            # Is this a question header? Bold, starts with number
            q_match = re.match(r"^(\d+)\s+(.*)", text)

            if q_match and line["bold"]:
                q_num = int(q_match.group(1))
                q_text = q_match.group(2).strip()

                # Check if this is actually a new question or continuation
                # A new question has its number at the left margin
                is_new_q = line["x0"] < layout["question_x_max"]

                # Special case: question number on its own line
                if not q_text and is_new_q:
                    if current_q:
                        all_questions.append(current_q)
                    current_q = {
                        "number": q_num,
                        "question_lines": [],
                        "options": [],
                        "option_y_positions": [],
                        "page": page_num,
                        "state": "question",
                    }
                    continue

                if is_new_q:
                    if current_q:
                        all_questions.append(current_q)
                    current_q = {
                        "number": q_num,
                        "question_lines": [q_text] if q_text else [],
                        "options": [],
                        "option_y_positions": [],
                        "page": page_num,
                        "state": "question",
                    }
                elif current_q and current_q["state"] == "question":
                    # Bold text but not at left margin - continuation of question
                    current_q["question_lines"].append(text)

            elif current_q is None:
                continue

            elif line["bold"] and current_q["state"] == "question":
                # Bold continuation of question text (sub-items like a), b), etc.)
                current_q["question_lines"].append(text)

            elif line["bold"] and current_q["state"] == "options":
                # Bold line while in options - check if it's a new question
                q_match2 = re.match(r"^(\d+)\s+(.*)", text)
                if q_match2 and line["x0"] < layout["question_x_max"]:
                    all_questions.append(current_q)
                    q_num = int(q_match2.group(1))
                    q_text = q_match2.group(2).strip()
                    current_q = {
                        "number": q_num,
                        "question_lines": [q_text] if q_text else [],
                        "options": [],
                        "option_y_positions": [],
                        "page": page_num,
                        "state": "question",
                    }
                elif current_q["state"] == "options" and current_q["options"]:
                    # Might be bold text that's part of an answer (unusual)
                    current_q["options"][-1] += "\n" + text

            elif not line["bold"]:
                # Check if there's a checkbox near this line's y position
                has_checkbox = any(abs(cy - line["y0"]) < 15 for cy in checkbox_ys)

                if current_q["state"] == "question":
                    # First non-bold line after question = first option
                    current_q["state"] = "options"
                    current_q["options"].append(text)
                    current_q["option_y_positions"].append(line["y0"])
                elif current_q["state"] == "options":
                    # Use checkbox presence as primary signal for new option
                    if has_checkbox:
                        # There's a checkbox here = new option
                        current_q["options"].append(text)
                        current_q["option_y_positions"].append(line["y0"])
                    elif current_q["options"]:
                        # No checkbox = continuation of previous option
                        current_q["options"][-1] += "\n" + text

        if current_q:
            all_questions.append(current_q)

        # Detect correct answers for this page's questions
        for q in all_questions:
            if q["page"] == page_num and q.get("correct_index") is None:
                if q["option_y_positions"]:
                    q["correct_index"] = find_correct_answer(
                        pixmap, answer_x0, q["option_y_positions"]
                    )

    doc.close()

    # Handle questions split across pages
    merged = merge_split_questions(all_questions)
    return merged


def merge_split_questions(questions):
    """Merge questions that are split across pages."""
    if not questions:
        return questions

    merged = []
    i = 0
    while i < len(questions):
        q = questions[i]

        if len(q["options"]) < 4 and i + 1 < len(questions):
            next_q = questions[i + 1]
            # Same question number or consecutive page with incomplete options
            same_num = next_q["number"] == q["number"]
            next_page = next_q["page"] == q["page"] + 1
            combined_is_4 = len(q["options"]) + len(next_q["options"]) == 4

            if same_num or (next_page and combined_is_4 and len(q["options"]) > 0):
                q["options"].extend(next_q["options"])
                q["option_y_positions"].extend(next_q["option_y_positions"])

                if next_q.get("question_lines"):
                    # If next chunk has question text, it might be continuation
                    if not any(re.match(r"^\d+\s", line) for line in next_q["question_lines"]):
                        q["question_lines"].extend(next_q["question_lines"])

                if q.get("correct_index") is None and next_q.get("correct_index") is not None:
                    q["correct_index"] = len(q["options"]) - len(next_q["options"]) + next_q["correct_index"]

                merged.append(q)
                i += 2
                continue

        merged.append(q)
        i += 1

    return merged


def main():
    pdf_dir = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_PDF_DIR
    pdf_dir = os.path.abspath(pdf_dir)

    if not os.path.isdir(pdf_dir):
        print(f"ERROR: PDF directory not found: {pdf_dir}")
        sys.exit(1)

    pdf_files = sorted([f for f in os.listdir(pdf_dir) if f.endswith(".pdf")])
    if not pdf_files:
        print(f"ERROR: No PDF files found in {pdf_dir}")
        sys.exit(1)

    print(f"Found {len(pdf_files)} PDF files in {pdf_dir}\n")

    all_questions = []
    categories = []

    for pdf_file in pdf_files:
        filepath = os.path.join(pdf_dir, pdf_file)
        cat_id, cat_name = extract_category_info(pdf_file)

        if cat_id is None:
            print(f"WARNING: Could not extract category ID from {pdf_file}, skipping")
            continue

        print(f"Parsing: {pdf_file}")
        print(f"  Category {cat_id}: {cat_name}")

        raw_questions = parse_pdf(filepath)

        valid_questions = []
        warnings = []
        for q in raw_questions:
            q_text = "\n".join(q["question_lines"])
            options = [opt.strip() for opt in q["options"]]
            correct_idx = q.get("correct_index")

            if len(options) != 4:
                if len(options) > 4:
                    warnings.append(f"Q{q['number']} has {len(options)} options (truncating to 4)")
                    options = options[:4]
                else:
                    warnings.append(f"Q{q['number']} has {len(options)} options (skipping)")
                    continue

            if correct_idx is None:
                warnings.append(f"Q{q['number']} no correct answer detected (skipping)")
                continue

            if correct_idx >= len(options):
                warnings.append(f"Q{q['number']} correctIndex out of range (skipping)")
                continue

            question_dict = {
                "id": f"{cat_id}-{q['number']}",
                "categoryId": cat_id,
                "question": q_text,
                "options": options,
                "correctIndex": correct_idx,
            }

            # Detect image reference in question text
            image_match = IMAGE_REF_PATTERN.search(q_text)
            if image_match:
                question_dict["image"] = image_match.group(1) + ".jpg"

            valid_questions.append(question_dict)

        categories.append({
            "id": cat_id,
            "name": cat_name,
            "questionCount": len(valid_questions),
        })

        print(f"  Parsed: {len(valid_questions)} questions")
        for w in warnings:
            print(f"  ⚠ {w}")

        # Print first 3 for verification
        for vq in valid_questions[:3]:
            q_preview = vq["question"][:100].replace("\n", " | ")
            print(f"\n  [{vq['id']}] {q_preview}")
            for j, opt in enumerate(vq["options"]):
                marker = " ✓" if j == vq["correctIndex"] else ""
                opt_preview = opt[:80].replace("\n", " | ")
                print(f"    {j}) {opt_preview}{marker}")

        print(f"\n{'='*60}\n")
        all_questions.extend(valid_questions)

    categories.sort(key=lambda c: c["id"])
    output = {"categories": categories, "questions": all_questions}

    os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    print(f"Output written to: {OUTPUT_PATH}")
    print(f"Total categories: {len(categories)}")
    print(f"Total questions: {len(all_questions)}")

    print("\nSummary:")
    for cat in categories:
        print(f"  {cat['id']}. {cat['name']}: {cat['questionCount']} questions")


if __name__ == "__main__":
    main()
