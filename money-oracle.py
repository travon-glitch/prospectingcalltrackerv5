#!/usr/bin/env python3
# GATE G6 item 7 — independent hand-calculation oracle for dealMath()
# (src/features/crm.js lines 38-50, byte-identical to docs/original-demo.html.ref
# lines 1487-1499).
#
# Run:  python3 tests/certification/money-oracle.py
# and paste the JSON it prints into tests/certification/money-math.test.js as
# the ORACLE fixture literal. This file uses Python's decimal module (prec=50,
# every operation here is exact) so the expectations are NOT derived with IEEE
# 754 floats — the JS under test is the only float arithmetic in the loop.
#
# Formula, transcribed by hand from the certified source (NOT imported):
#   gross      = price * clamp(commPct) / 100
#   referral   = gross * clamp(referralPct) / 100
#   afterRef   = gross - referral
#   brokerage  = afterRef * clamp(brokeragePct) / 100 + brokerageFee
#   afterBrok  = max(0, afterRef - brokerage)
#   net        = max(0, afterBrok - closingCosts)
#   teamShare  = net * clamp(teamSplitPct) / 100
#   agentShare = net - teamShare
#   weighted   = net * clamp(prob) / 100
# where clamp(x) = min(100, max(0, x)) applies ONLY to the four percent fields
# and the stage probability — price, brokerageFee and closingCosts are NOT
# clamped (num() passes negatives through).
#
# String-formatted inputs ("$425,000", "3%", "3,0", "", None) are parsed by
# num()/pct() on the JS side BEFORE the arithmetic. The equivalent parsed
# numeric value below was determined BY HAND from num()'s definition
# (strip every char not in [0-9.\-], parseFloat, NaN->0) and is written as a
# literal — this oracle never re-implements or calls the JS parser.

import json
from decimal import Decimal, getcontext

getcontext().prec = 50
D = Decimal
HUNDRED = D(100)
ZERO = D(0)

def clamp(x):
    return min(HUNDRED, max(ZERO, x))

def deal_math(price, comm, ref, brok_pct, fee, closing, split, prob):
    price, comm, ref, brok_pct, fee, closing, split, prob = map(D, (price, comm, ref, brok_pct, fee, closing, split, prob))
    gross = price * clamp(comm) / HUNDRED
    referral = gross * clamp(ref) / HUNDRED
    after_ref = gross - referral
    brokerage = after_ref * clamp(brok_pct) / HUNDRED + fee
    after_brok = max(ZERO, after_ref - brokerage)
    net = max(ZERO, after_brok - closing)
    team = net * clamp(split) / HUNDRED
    agent = net - team
    weighted = net * clamp(prob) / HUNDRED
    return dict(gross=gross, referral=referral, brokerage=brokerage, net=net,
                teamShare=team, agentShare=agent, weighted=weighted)

# 20 deals. "parsed" holds the hand-parsed numeric inputs the oracle computes
# from; the JS test feeds dealMath() the RAW values (strings and all) and must
# land on the same money, to the cent.
# Order: price, commPct, referralPct, brokeragePct, brokerageFee, closingCosts, teamSplitPct, prob
DEALS = [
    ("D01 round numbers 425000 @ 3%",                        ("425000", "3", "0", "0", "0", "0", "0", "80")),
    ("D02 cents price 123456.78 @ 2.75%",                    ("123456.78", "2.75", "0", "20", "0", "500", "50", "55")),
    ("D03 float-trap chain 100000 @ 2.9%",                   ("100000", "2.9", "10", "15", "299.99", "1234.56", "50", "35")),
    ("D04 no referral",                                      ("350000", "3", "0", "30", "495", "250", "20", "95")),
    ("D05 no brokerage",                                     ("275000", "2.5", "25", "0", "0", "0", "50", "65")),
    ("D06 everything zero",                                  ("0", "0", "0", "0", "0", "0", "0", "0")),
    ("D07 clamp: fee > afterRef -> afterBrok 0",             ("50000", "1", "0", "0", "2000", "100", "50", "100")),
    ("D08 clamp: closing > afterBrok -> net 0",              ("100000", "3", "0", "50", "0", "2000", "50", "95")),
    ("D09 teamSplit 0",                                      ("600000", "3", "10", "10", "0", "0", "0", "45")),
    ("D10 teamSplit 50",                                     ("600000", "3", "10", "10", "0", "0", "50", "45")),
    ("D11 teamSplit 100",                                    ("600000", "3", "10", "10", "0", "0", "100", "45")),
    ("D12 prob 0",                                           ("999999", "3.25", "5", "12.5", "199", "850", "35", "0")),
    ("D13 prob 35, cents everywhere",                        ("456789.01", "2.95", "7.5", "17.5", "349.5", "1111.11", "42.5", "35")),
    ("D14 prob 100",                                         ("825000", "3.5", "12.5", "22.5", "450", "975.25", "65", "100")),
    # D15 raw JS inputs: "$425,000", "3%", "10%", "15%", "$299.99", "$1,234.56", "50%" — hand-parsed per num():
    ("D15 formatted strings ($/,/% stripped by num())",      ("425000", "3", "10", "15", "299.99", "1234.56", "50", "35")),
    # D16 raw JS inputs: referralPct "", brokeragePct null, brokerageFee undefined, closingCosts "", teamSplitPct null -> all 0:
    ("D16 empty/null fields -> 0",                           ("300000", "3", "0", "0", "0", "0", "0", "20")),
    ("D17 negative price flows through, net clamps 0",       ("-250000", "6", "25", "20", "0", "500", "70", "80")),
    ("D18 very large price 99,999,999.99",                   ("99999999.99", "2.875", "5.5", "19.99", "1250.49", "9999.99", "33.33", "85")),
    # D19 raw JS commPct "3,0": num() strips the comma -> parseFloat("30") = 30 (NOT 3.0) — certified behavior:
    ("D19 comma-decimal '3,0' parses as 30",                 ("200000", "30", "0", "0", "0", "0", "0", "50")),
    ("D20 heavy float chain 333333.33 @ 2.9",                ("333333.33", "2.9", "3.3", "6.7", "0.01", "0.02", "33.3", "15")),
]

out = []
for name, inputs in DEALS:
    r = deal_math(*inputs)
    out.append({"name": name, "inputs": inputs,
                **{k: "{:f}".format(v.normalize()) for k, v in r.items()}})
print(json.dumps(out, indent=1))
