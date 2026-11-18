#!/usr/bin/env python3
"""Builds GymTrack's bundled generic food list from the UK government's Composition of Foods
Integrated Dataset (CoFID, McCance and Widdowson's, 2021), published under the Open Government
Licence v3.0:
  https://www.gov.uk/government/publications/composition-of-foods-integrated-dataset-cofid

Usage: python3 scripts/nutrition/build-cofid.py <CoFID 2021 .xlsx> [out.json]
Writes frontend/src/lib/food-data/cofid.json by default: one row per food,
  [code, name, kcal, protein, carbs, fat, sugars, fibre, satfat, salt]  all per 100 g (100 ml for
drinks CoFID measures that way), one decimal; "Tr" (trace) reads as 0, "N" (not measured) as null.
Salt is sodium x 2.5. Foods without an energy value are left out. Needs openpyxl.
"""
import json, sys
import openpyxl

src = sys.argv[1]
out = sys.argv[2] if len(sys.argv) > 2 else 'frontend/src/lib/food-data/cofid.json'
wb = openpyxl.load_workbook(src, read_only=True, data_only=True)

def num(v):
    if v is None: return None
    s = str(v).strip()
    if s in ('', 'N'): return None
    if s.lower() == 'tr': return 0
    try: return round(float(s), 1)
    except ValueError: return None

def table(name):
    ws = wb[name]
    rows = ws.iter_rows(values_only=True)
    head = [str(h).strip() if h else '' for h in next(rows)]
    out = {}
    for r in rows:
        if r and r[0] and str(r[0])[:1].isdigit(): out[str(r[0]).strip()] = dict(zip(head, r))
    return out

prox = table('1.3 Proximates')
inorg = table('1.4 Inorganics')
foods = []
for code, p in prox.items():
    kcal = num(p.get('Energy (kcal) (kcal)'))
    if kcal is None: continue
    fibre = num(p.get('AOAC fibre (g)'))
    if fibre is None: fibre = num(p.get('NSP (g)'))
    na = num((inorg.get(code) or {}).get('Sodium (mg)'))
    foods.append([code, str(p['Food Name']).strip(), kcal, num(p.get('Protein (g)')), num(p.get('Carbohydrate (g)')),
                  num(p.get('Fat (g)')), num(p.get('Total sugars (g)')), fibre, num(p.get('Satd FA /100g fd (g)')),
                  round(na * 2.5 / 1000, 2) if na is not None else None])
foods.sort(key=lambda f: f[1].lower())
with open(out, 'w', encoding='utf-8') as f:
    json.dump({'source': 'CoFID 2021, Public Health England / Food Standards Agency, Open Government Licence v3.0',
               'fields': ['code', 'name', 'kcal', 'protein', 'carbs', 'fat', 'sugars', 'fibre', 'satfat', 'salt'],
               'foods': foods}, f, ensure_ascii=False, separators=(',', ':'))
print(len(foods), 'foods ->', out)
