import re
import os

js_path = os.path.join('static', 'js', 'app.js')
html_path = 'app.html'

with open(js_path, 'r', encoding='utf-8') as f:
    js_code = f.read()

with open(html_path, 'r', encoding='utf-8') as f:
    html_code = f.read()

js_ids = set(re.findall(r'getElementById\([\'"]([^\'"]+)[\'"]\)', js_code))
html_ids = set(re.findall(r'id=[\'"]([^\'"]+)[\'"]', html_code))

print("=== JS IDs missing in app.html ===")
for jid in sorted(js_ids - html_ids):
    print("MISSING IN HTML:", jid)

print("\n=== HTML IDs missing in static/js/app.js ===")
for hid in sorted(html_ids - js_ids):
    print("NOT REFERENCED IN JS:", hid)
