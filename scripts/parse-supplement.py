#!/usr/bin/env python3
"""
Parse PPL supplement PDF (PPL_Supplement_2026.pdf) into supplement_questions.json.

Format: each question is on its own page with structure:
    Otázka N · Předmět M
    <question text, may wrap multiple lines>
    A) <option text, may wrap>
    B) <option text>
    C) <option text>
    D) <option text>
    Správná odpověď: X) <full answer text, may wrap>
    Vysvětlení
    <explanation text, may wrap multiple lines>

Subject (Předmět) maps to existing categoryId by TOPIC NAME (not by number).
ID format: "{categoryId}-S{questionNumber}" (S = supplement).

Each output question carries: supplement=True, explanation=<text from PDF>.

Usage: python3 parse-supplement.py [path_to_pdf]
"""

import sys
import os
import json
import re
import fitz  # PyMuPDF

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DEFAULT_PDF = os.path.join(SCRIPT_DIR, "..", "..", "testy_pdf", "PPL_Supplement_2026.pdf")
OUTPUT_PATH = os.path.join(SCRIPT_DIR, "..", "data", "supplement_questions.json")

# Subject name (in PDF) -> existing categoryId in app
# Mapping by TOPIC NAME, not by raw subject number, because the existing app
# has cat 4 = Letové zásady and cat 5 = Komunikace (swapped vs PDF order).
SUBJECT_NAME_TO_CAT = {
    "Právní předpisy v oblasti letectví": 1,
    "Lidská výkonnost": 2,
    "Meteorologie": 3,
    "Komunikace": 5,
    "Letové zásady": 4,
    "Provozní postupy": 6,
    "Provedení a plánování letu": 7,
    "Obecné znalosti o letadle": 8,
    "Navigace": 9,
}

HEADER_RE = re.compile(r"^Otázka\s+(\d+)\s+·\s+Předmět\s+(\d+)\s*$")
OPTION_RE = re.compile(r"^([A-D])\)\s*(.*)$")
CORRECT_RE = re.compile(r"^Správná odpověď:\s*([A-D])\)\s*(.*)$")


def normalize_subject_name(raw: str) -> str:
    """Strip numbering / dashes from a section header line like
    'Předmět 1 – Právní předpisy v oblasti letectví'."""
    s = raw.strip()
    s = re.sub(r"^Předmět\s+\d+\s*[–\-]\s*", "", s)
    return s.strip()


def build_subject_map(doc):
    """Walk pages 0..N until we have all section headers; return {subject_num: subject_name}.

    The TOC page lists 'Předmět X – <Name>' lines; section divider pages have
    'Předmět X\\n<Name>\\nPočet otázek: M'."""
    mapping = {}

    # Try TOC page (page 2, index 1)
    toc_text = doc[1].get_text() if len(doc) > 1 else ""
    for m in re.finditer(r"Předmět\s+(\d+)\s*[–\-]\s*([^\n]+)", toc_text):
        num = int(m.group(1))
        name = m.group(2).strip()
        mapping[num] = name

    # Fallback: scan section divider pages
    if len(mapping) < 9:
        for i in range(min(len(doc), 30)):
            text = doc[i].get_text().strip()
            m = re.match(r"^Předmět\s+(\d+)\s*\n([^\n]+)\nPočet otázek", text)
            if m:
                num = int(m.group(1))
                name = m.group(2).strip()
                mapping.setdefault(num, name)

    return mapping


def parse_question_page(text: str):
    """Parse a single question page. Returns dict or None if not a question page."""
    # Normalize whitespace within lines but keep line breaks
    raw_lines = [ln.rstrip() for ln in text.split("\n")]
    # Strip leading/trailing blank lines
    while raw_lines and not raw_lines[0].strip():
        raw_lines.pop(0)
    while raw_lines and not raw_lines[-1].strip():
        raw_lines.pop()

    if not raw_lines:
        return None

    # First line must be the question header
    header_match = HEADER_RE.match(raw_lines[0].strip())
    if not header_match:
        return None

    q_num = int(header_match.group(1))
    subject_num = int(header_match.group(2))

    # Walk lines, tracking state
    state = "question"  # question -> options -> correct -> explanation
    question_lines = []
    options = {}  # letter -> [lines]
    current_opt = None
    correct_letter = None
    correct_lines = []
    explanation_lines = []
    saw_vysvetleni_marker = False

    for line in raw_lines[1:]:
        stripped = line.strip()
        if not stripped:
            # Blank line — flush continuation context but keep going
            continue

        # Check for "Vysvětlení" marker (own line)
        if stripped == "Vysvětlení":
            state = "explanation"
            saw_vysvetleni_marker = True
            continue

        # Check for "Správná odpověď: X) ..."
        m_correct = CORRECT_RE.match(stripped)
        if m_correct:
            correct_letter = m_correct.group(1)
            correct_lines = [m_correct.group(2).strip()]
            state = "correct"
            current_opt = None
            continue

        # Check for option start "A) ..." / "B) ..." etc. only while in question/options
        m_opt = OPTION_RE.match(stripped)
        if m_opt and state in ("question", "options"):
            letter = m_opt.group(1)
            text_part = m_opt.group(2).strip()
            options[letter] = [text_part] if text_part else []
            current_opt = letter
            state = "options"
            continue

        # Continuation depending on state
        if state == "question":
            question_lines.append(stripped)
        elif state == "options" and current_opt is not None:
            options[current_opt].append(stripped)
        elif state == "correct":
            correct_lines.append(stripped)
        elif state == "explanation":
            explanation_lines.append(stripped)

    # Validate we got 4 options
    if set(options.keys()) != {"A", "B", "C", "D"}:
        return {
            "_error": f"Otázka {q_num}: chybí některé z A/B/C/D ({sorted(options.keys())})",
            "number": q_num,
        }
    if not correct_letter:
        return {"_error": f"Otázka {q_num}: chybí 'Správná odpověď'", "number": q_num}
    if correct_letter not in options:
        return {"_error": f"Otázka {q_num}: správná {correct_letter} mimo A-D", "number": q_num}

    question_text = " ".join(question_lines).strip()
    options_text = {k: " ".join(v).strip() for k, v in options.items()}
    correct_index = "ABCD".index(correct_letter)
    explanation_text = " ".join(explanation_lines).strip()

    return {
        "number": q_num,
        "subject_num": subject_num,
        "question": question_text,
        "options": [options_text["A"], options_text["B"], options_text["C"], options_text["D"]],
        "correctIndex": correct_index,
        "explanation": explanation_text,
    }


def main():
    pdf_path = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_PDF
    pdf_path = os.path.abspath(pdf_path)
    if not os.path.isfile(pdf_path):
        print(f"ERROR: PDF not found: {pdf_path}", file=sys.stderr)
        sys.exit(1)

    doc = fitz.open(pdf_path)
    print(f"Opened: {pdf_path} ({len(doc)} pages)")

    subject_map = build_subject_map(doc)
    print(f"Detected subjects: {len(subject_map)}")
    for k in sorted(subject_map.keys()):
        cat_id = SUBJECT_NAME_TO_CAT.get(subject_map[k])
        print(f"  Předmět {k} = '{subject_map[k]}' -> categoryId {cat_id}")

    questions = []
    errors = []

    for page_num in range(len(doc)):
        text = doc[page_num].get_text()
        parsed = parse_question_page(text)
        if parsed is None:
            continue
        if "_error" in parsed:
            errors.append(parsed["_error"])
            continue

        subject_num = parsed["subject_num"]
        subject_name = subject_map.get(subject_num)
        if not subject_name:
            errors.append(f"Otázka {parsed['number']}: neznámý Předmět {subject_num}")
            continue

        cat_id = SUBJECT_NAME_TO_CAT.get(subject_name)
        if cat_id is None:
            errors.append(f"Otázka {parsed['number']}: neznámý subject name '{subject_name}'")
            continue

        questions.append({
            "id": f"{cat_id}-S{parsed['number']}",
            "categoryId": cat_id,
            "question": parsed["question"],
            "options": parsed["options"],
            "correctIndex": parsed["correctIndex"],
            "supplement": True,
            "explanation": parsed["explanation"],
        })

    doc.close()

    # Stats
    from collections import Counter
    per_cat = Counter(q["categoryId"] for q in questions)
    print(f"\nParsed {len(questions)} supplement questions")
    for cat in sorted(per_cat):
        print(f"  cat {cat}: {per_cat[cat]} otázek")

    if errors:
        print(f"\n{len(errors)} chyb:")
        for e in errors:
            print(f"  ⚠ {e}")

    if len(questions) != 214:
        print(f"\n⚠ POZOR: očekáváno 214, naparsováno {len(questions)}", file=sys.stderr)

    os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump({"questions": questions}, f, ensure_ascii=False, indent=2)

    print(f"\nWritten: {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
