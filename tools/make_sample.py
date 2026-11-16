#!/usr/bin/env python3
"""Generate a SYNTHETIC workbook with the same sheet and column names the app expects.

All numbers are made up (seeded random walk). Use it to try the app or for development:

    python3 tools/make_sample.py /tmp/money-quest-sample.xlsx

Write the output OUTSIDE the repo (*.xlsx is git-ignored anyway). Requires openpyxl.
"""
import math
import random
import sys
from datetime import date

from openpyxl import Workbook

random.seed(42)
OUT = sys.argv[1] if len(sys.argv) > 1 else "/tmp/money-quest-sample.xlsx"
N = int(sys.argv[2]) if len(sys.argv) > 2 else 18
START = (2025, 5)


def month(i):
    y, m = START
    idx = y * 12 + (m - 1) + i
    return date(idx // 12, idx % 12 + 1, 1)


ACCOUNTS = ["Santander", "Activo", "NI T212", "PayPal", "Vinted", "Stake", "Trading212", "Robinhood", "Vivo"]
TARGETS = {"Investments": 0.8, "Lifestyle": 0.05, "Fun Money": 0.05}
EMERG_MONTHS = 6
RATINGS = [("Reset Your Plan", 0), ("Needs Attention", 1), ("Building", 3), ("Strong", 5)]

wb = Workbook()
readme = wb.active
readme.title = "README"
readme["A1"] = "SYNTHETIC SAMPLE DATA - every number here is invented for testing Money Quest."

# ---- DESPESAS (spending by category) ----
cats = ["Supermercado", "Fora de casa", "Compras", "Golfe", "Subscrições", "Revolut", "Outros"]
base_spend = {"Supermercado": 150, "Fora de casa": 90, "Compras": 60, "Golfe": 25, "Subscrições": 12, "Revolut": 20, "Outros": 15}
spend = []
for i in range(N):
    row = {c: round(max(0, base_spend[c] * random.uniform(0.5, 1.6)), 2) for c in cats}
    spend.append(row)

# ---- BASE (income by source) ----
sources = ["Avô", "POD", "Vinted", "Rugby", "Outros", "Dividendos", "Prendas"]
income = []
for i in range(N):
    r = {
        "Avô": 100,
        "POD": round(random.uniform(0, 60), 2),
        "Vinted": round(random.uniform(0, 40), 2),
        "Rugby": random.choice([0, 0, 500, 700]),
        "Outros": round(random.uniform(0, 30), 2),
        "Dividendos": round(2 + i * 0.4, 2),
        "Prendas": random.choice([0, 0, 0, 50]),
    }
    income.append(r)

# ---- NW CF (balances) ----
bal = {"Santander": 400, "Activo": 20, "NI T212": 0, "PayPal": 30, "Vinted": 10, "Stake": 500, "Trading212": 2500, "Robinhood": 0, "Vivo": 100}
sp_returns = [round(random.uniform(-0.03, 0.04), 4) for _ in range(N)]
rows = []
prev_nw = None
for i in range(N):
    inv_ret = sp_returns[i] + random.uniform(-0.015, 0.02)
    for k in ("Stake", "Trading212", "Robinhood"):
        bal[k] = round(bal[k] * (1 + inv_ret), 2)
    tot_spend = sum(spend[i].values())
    tot_inc = sum(income[i].values())
    surplus = tot_inc - tot_spend
    bal["Trading212"] = round(bal["Trading212"] + max(0, surplus) * 0.6, 2)
    bal["NI T212"] = round(bal["NI T212"] + max(0, surplus) * 0.3, 2)
    bal["Santander"] = round(max(50, bal["Santander"] + surplus * 0.1 + random.uniform(-40, 40)), 2)
    bal["Activo"] = round(max(0, bal["Activo"] + random.uniform(-5, 10)), 2)
    if i == 8:
        bal["Robinhood"] = 300.0
    nw = round(sum(bal.values()), 2)
    rows.append((dict(bal), nw, tot_inc, tot_spend))

wb_nw = wb.create_sheet("NW CF")
hdr = ["Mês"] + ACCOUNTS + ["NW", "Me %", "S&P %", "Δ%", "CF", "Income", "Saved", "Spending", "Savings rate",
                            "Sav pts", "Emergency months", "Emerg pts", "Alloc pts", "Score", "Rating"]
wb_nw.append(hdr)
dash_rows = []
avg_spend = sum(sum(s.values()) for s in spend[-12:]) / min(12, N)
for i, (b, nw, inc, sp_) in enumerate(rows):
    inv = b["Stake"] + b["Trading212"] + b["Robinhood"]
    shares = {"inv": inv / nw, "em": b["NI T212"] / nw, "life": b["Santander"] / nw, "fun": b["Activo"] / nw}
    desvio = abs(shares["inv"] / (shares["inv"] + shares["em"] or 1) * 0.95 - 0.8) * 2 if shares["inv"] else 1
    dash_rows.append((month(i), shares, desvio))
    if i == 0:
        wb_nw.append([month(i)] + [b[a] for a in ACCOUNTS] + [nw] + [None] * 4 + [inc, None, None, None, None, 0, None, None, None, None])
        prev_nw = nw
        continue
    me = (nw - prev_nw) / nw
    spx = sp_returns[i]
    saved = nw - prev_nw
    sav_rate = max(-1, 1 - sp_ / inc) if inc else 0
    em_months = b["NI T212"] / avg_spend
    sav_pts = 2 if sav_rate >= 0.2 else 1 if sav_rate >= 0.1 else 0
    em_pts = 2 if em_months >= EMERG_MONTHS else 1 if em_months >= EMERG_MONTHS / 2 else 0
    al_pts = 2 if desvio <= 0.3 else 1 if desvio <= 0.45 else 0
    score = sav_pts + em_pts + al_pts
    rating = [r for r, mn in RATINGS if score >= mn][-1]
    wb_nw.append([month(i)] + [b[a] for a in ACCOUNTS] + [nw, me, spx, me - spx, round(random.uniform(-100, 300), 2), inc, saved, sp_,
                                                          sav_rate, sav_pts, em_months, em_pts, al_pts, score, rating])
    prev_nw = nw
for r in range(2, N + 2):
    wb_nw.cell(r, 1).number_format = "mmm/yy"

ws = wb.create_sheet("BASE")
ws.append(["Mês"] + sources[:3] + ["Rugby", "Outros", "Ventures", "Dividendos", "Prendas", "Entrada", "Recurrent", "Ano"])
for i, r in enumerate(income):
    tot = round(sum(r.values()), 2)
    ws.append([month(i), r["Avô"], r["POD"], r["Vinted"], r["Rugby"], r["Outros"], round(r["POD"] + r["Vinted"], 2), r["Dividendos"], r["Prendas"], tot, 4.99, None])
    ws.cell(i + 2, 1).number_format = "mmm/yy"
ws["P4"], ws["Q4"] = "Buffer (€):", 100
for j, h in enumerate(["Available €", "→ Invest", "→ Emergency", "Lifestyle", "→ Fun Money"]):
    ws.cell(6, 16 + j, h)
for i, (b, nw, inc, sp_) in enumerate(rows):
    avail = max(0, b["Santander"] - 100)
    em = min(avail, 300)
    rest = avail - em
    ws.cell(i + 2, 16, round(avail, 2)); ws.cell(i + 2, 17, round(rest * 0.9, 2)); ws.cell(i + 2, 18, round(em, 2))
    ws.cell(i + 2, 19, round(rest * 0.05, 2)); ws.cell(i + 2, 20, round(rest * 0.05, 2))

ws = wb.create_sheet("DESPESAS")
ws.append(["Mês"] + cats + ["Total despesa"])
for i, r in enumerate(spend):
    ws.append([month(i)] + [r[c] for c in cats] + [round(sum(r.values()), 2)])
    ws.cell(i + 2, 1).number_format = "mmm/yy"

ws = wb.create_sheet("DASHBOARD")
ws.append(["Mês", "Investments (80%)", "Emergency", "Lifestyle (5%)", "Fun Money (5%)", "Desvio", "Liquidity Ratio"])
for d, s, desvio in dash_rows:
    ws.append([d, s["inv"], s["em"], s["life"], s["fun"], desvio, 1 - s["inv"]])
last_b, last_nw = rows[-1][0], rows[-1][1]
em_target_eur = EMERG_MONTHS * avg_spend
em_share_t = em_target_eur / last_nw
ws["I3"], ws["J3"], ws["K3"] = "Current Allocation (synthetic)", "Actual", "Target"
for k, (name, key, tgt) in enumerate([("Investments", "inv", 0.8), ("Emergency", "em", em_share_t), ("Lifestyle", "life", 0.05), ("Fun Money", "fun", 0.05)]):
    ws.cell(4 + k, 9, name); ws.cell(4 + k, 10, dash_rows[-1][1][key]); ws.cell(4 + k, 11, tgt)
ws.cell(8, 9, "Liquidity"); ws.cell(8, 10, 1 - dash_rows[-1][1]["inv"]); ws.cell(8, 11, em_share_t + 0.1)
ws.cell(9, 9, "Desvio"); ws.cell(9, 10, dash_rows[-1][2]); ws.cell(9, 11, 0.3)

invested = last_b["Stake"] + last_b["Trading212"] + last_b["Robinhood"]
monthly, ret = 300, 0.08


def years_to(goal):
    r = ret / 12
    return math.log((goal + monthly / r) / (invested + monthly / r)) / math.log(1 + r) / 12


ws["N3"], ws["O3"], ws["P3"], ws["Q3"] = "Milestones", "Years", "Date", "Age"
today = date.today()
for k, g in enumerate([100000, 500000, 1000000]):
    y = years_to(g)
    mi = today.year * 12 + today.month - 1 + round(y * 12)
    d = date(mi // 12, mi % 12 + 1, 1)
    ws.cell(4 + k, 14, g); ws.cell(4 + k, 15, y); ws.cell(4 + k, 16, d); ws.cell(4 + k, 17, d.year - 2000)
ws["N16"], ws["O16"] = "Monthly spending", avg_spend
ws["N19"], ws["O19"] = "FIRE number", avg_spend * 12 / 0.04

ws = wb.create_sheet("SETTINGS")
ws["A1"], ws["F1"] = "Allocation Targets", "Projection Inputs"
ws["A3"], ws["B3"], ws["F3"], ws["G3"] = "Category", "Target", "Input", "Value"
for k, (a, b) in enumerate([("Investments", 0.8), ("Emergency", em_share_t), ("Lifestyle", 0.05), ("Fun Money", 0.05),
                            ("Emergency fund (months)", last_b["NI T212"] / avg_spend), ("Emergency target (€)", em_target_eur),
                            ("Emergency months (target)", EMERG_MONTHS)]):
    ws.cell(4 + k, 1, a); ws.cell(4 + k, 2, b)
for k, (a, b) in enumerate([("Invested today", invested), ("Monthly contribution", monthly), ("Annual return", ret),
                            ("Years (1–40)", 30), ("Goal", 100000), ("Birth date", date(2000, 1, 1))]):
    ws.cell(4 + k, 6, a); ws.cell(4 + k, 7, b)
ws["A14"], ws["B14"], ws["C14"] = "Rule", "2 pts if", "1 pt if"
ws["A15"], ws["B15"], ws["C15"] = "Savings rate (min)", 0.2, 0.1
ws["A16"], ws["B16"], ws["C16"] = "Emergency (min months)", 6, 3
ws["A17"], ws["B17"], ws["C17"] = "Desvio (max)", 0.3, 0.45
ws["A19"], ws["B19"] = "Lookback window (months)", 12
ws["A21"], ws["B21"] = "Rating", "Min score"
for k, (n, mn) in enumerate(RATINGS):
    ws.cell(22 + k, 1, n); ws.cell(22 + k, 2, mn)
ws["A31"], ws["B31"] = "Safe withdrawal rate", 0.04


def fv(years):
    r, n = ret / 12, round(12 * years)
    g = (1 + r) ** n
    return invested * g + monthly * (g - 1) / r


ws["F15"], ws["G15"], ws["H15"], ws["I15"] = "Cost of waiting", "Years invested", "Portfolio value", "Cost"
for k, dly in enumerate([0, 1, 5, 10]):
    ws.cell(16 + k, 6, dly); ws.cell(16 + k, 7, 30 - dly); ws.cell(16 + k, 8, fv(30 - dly)); ws.cell(16 + k, 9, fv(30) - fv(30 - dly))
ws["F21"], ws["G21"], ws["H21"], ws["I21"] = "Extra per month", "Contribution", "Years to goal", "Time saved"
for k, ex in enumerate([0, 100, 250, 500]):
    r = ret / 12
    c = monthly + ex
    y = math.log((100000 + c / r) / (invested + c / r)) / math.log(1 + r) / 12
    ws.cell(22 + k, 6, ex); ws.cell(22 + k, 7, c); ws.cell(22 + k, 8, y); ws.cell(22 + k, 9, years_to(100000) - y)
ws["F27"], ws["G27"] = "Return scenario", "Years to goal"
for k, rr in enumerate([0.05, 0.07, 0.1, 0.12]):
    r = rr / 12
    ws.cell(28 + k, 6, rr); ws.cell(28 + k, 7, math.log((100000 + monthly / r) / (invested + monthly / r)) / math.log(1 + r) / 12)

wb.save(OUT)
print("wrote synthetic workbook:", OUT)
