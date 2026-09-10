"""
Patch 2: Update _extract_bullets to capture leading prose before the first marker
(matching frontend's 'leadingText' behaviour) and prepend it to the bullet list.
"""
import re

FILE = "reports/pdf_services.py"

with open(FILE, "r", encoding="utf-8") as fh:
    src = fh.read()

OLD = (
    '    # Step 3 \u2013 walk lines, support bullet markers and continuation lines\n'
    r"    line_bullet_pattern = re.compile(r'^[-*\u2022]\s+(.+)$')" + '\n'
    r"    numbered_pattern    = re.compile(r'^\d+[.)]\s+(.+)$')" + '\n'
    '    bullets_from_lines: list[str] = []\n'
    '    current = ""\n'
    '    has_markers = False\n'
    '\n'
    '    for raw_line in raw_str.split("\\n"):\n'
    '        line = raw_line.strip()\n'
    '        if not line:\n'
    '            continue\n'
    '        m = line_bullet_pattern.match(line) or numbered_pattern.match(line)\n'
    '        if m:\n'
    '            has_markers = True\n'
    '            if current:\n'
    '                bullets_from_lines.append(current)\n'
    '            current = m.group(1).strip()\n'
    '        else:\n'
    '            if current:\n'
    '                current = f"{current} {line}".strip()\n'
    '\n'
    '    if current:\n'
    '        bullets_from_lines.append(current)\n'
    '\n'
    '    if has_markers and bullets_from_lines:\n'
    '        return bullets_from_lines[:max_items]\n'
)

NEW = (
    '    # Step 3 \u2013 walk lines, support bullet markers and continuation lines\n'
    '    # Also capture any leading prose that appears before the first marker\n'
    '    # (mirrors the frontend\'s "leadingText" behaviour).\n'
    r"    line_bullet_pattern = re.compile(r'^[-*\u2022]\s+(.+)$')" + '\n'
    r"    numbered_pattern    = re.compile(r'^\d+[.)]\s+(.+)$')" + '\n'
    '    bullets_from_lines: list[str] = []\n'
    '    leading_lines: list[str] = []\n'
    '    current = ""\n'
    '    has_markers = False\n'
    '\n'
    '    for raw_line in raw_str.split("\\n"):\n'
    '        line = raw_line.strip()\n'
    '        if not line:\n'
    '            continue\n'
    '        m = line_bullet_pattern.match(line) or numbered_pattern.match(line)\n'
    '        if m:\n'
    '            if not has_markers:\n'
    '                has_markers = True\n'
    '            if current:\n'
    '                bullets_from_lines.append(current)\n'
    '            current = m.group(1).strip()\n'
    '        else:\n'
    '            if current:\n'
    '                # continuation line \u2013 append to current bullet\n'
    '                current = f"{current} {line}".strip()\n'
    '            elif not has_markers:\n'
    '                # leading prose before any marker\n'
    '                leading_lines.append(line)\n'
    '\n'
    '    if current:\n'
    '        bullets_from_lines.append(current)\n'
    '\n'
    '    if has_markers and bullets_from_lines:\n'
    '        leading = " ".join(leading_lines).strip()\n'
    '        if leading:\n'
    '            return ([leading] + bullets_from_lines)[:max_items]\n'
    '        return bullets_from_lines[:max_items]\n'
)

if OLD in src:
    src = src.replace(OLD, NEW, 1)
    print("Patch 2 applied OK")
else:
    print("ERROR: anchor text not found")
    import sys; sys.exit(1)

with open(FILE, "w", encoding="utf-8") as fh:
    fh.write(src)

import py_compile, sys
try:
    py_compile.compile(FILE, doraise=True)
    print("Syntax OK")
except py_compile.PyCompileError as e:
    print(f"Syntax ERROR: {e}")
    sys.exit(1)
