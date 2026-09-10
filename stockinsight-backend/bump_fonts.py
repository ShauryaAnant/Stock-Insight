import re

file_path = 'reports/pdf_services.py'
with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

# Increase CSS font-size: Xpx
def add_two_css(match):
    val = float(match.group(1))
    new_val = val + 2
    if new_val.is_integer():
        new_val = int(new_val)
    return f'font-size: {new_val}px'

content = re.sub(r'font-size:\s*(\d+(?:\.\d+)?)px', add_two_css, content)

# Increase inline HTML/SVG font-size="X"
def add_two_svg(match):
    val = float(match.group(1))
    new_val = val + 2
    if new_val.is_integer():
        new_val = int(new_val)
    return f'font-size="{new_val}"'

content = re.sub(r'font-size="(\d+(?:\.\d+)?)"', add_two_svg, content)

with open(file_path, 'w', encoding='utf-8') as f:
    f.write(content)
