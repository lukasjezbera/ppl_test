#!/usr/bin/env python3
"""
Supplement merging is currently disabled — questions.json contains only
the originals parsed from the 9 source PDFs.

This script is kept as a stub so the supplement workflow can be restored
later by reviving the prior version from git history.
"""

import sys


def main():
    print(
        "merge-questions.py: supplement merging is disabled. "
        "questions.json is built from parse-pdfs.py alone.",
        file=sys.stderr,
    )


if __name__ == "__main__":
    main()
