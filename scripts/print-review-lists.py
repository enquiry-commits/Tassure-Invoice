import json

with open('data/teamwork-api/diff-report.json', encoding='utf-8') as f:
    d = json.load(f)

out = []
out.append('=== BEST_EMAIL DIFFS (20) ===')
for x in d['best_email']:
    out.append(f"#{x['id']:<5} {x['company_name']:<60} current: {x['current'] or '(empty)':<40} teamwork: {x['tw']}")

out.append('')
out.append('=== REGISTRATION_NO DIFFS - both non-blank & different (needs human call) ===')
for x in d['registration_no']:
    cur = x['current'] or ''
    tw = x['tw'] or ''
    if cur.strip() and tw.strip() and cur.strip() != tw.strip():
        out.append(f"#{x['id']:<5} {x['company_name']:<60} current: {cur:<20} teamwork: {tw}")

with open('data/teamwork-api/review-lists.txt', 'w', encoding='utf-8') as f:
    f.write('\n'.join(out))

print('done')
