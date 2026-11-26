"""Calculator tests. Expected values are hand-derived from the statutory bands — never
copied from calculator output — so a regression in the engine cannot 'agree with itself'."""
from datetime import date
from decimal import Decimal as D

import pytest

from copilot_engine.calculator import (
    Budget2027Mode,
    BuyerStatus,
    CalculationError,
    PropertyType,
    PurchaseInput,
    calculate,
    loan_duty,
    mot_scale_duty,
    sro_scale_fee,
    to_money,
)

SPA_2026 = date(2026, 12, 1)


def inp(**kw):
    base = dict(purchase_price=D("500000"), property_type=PropertyType.RESIDENTIAL_HOUSE,
                buyer_status=BuyerStatus.CITIZEN, spa_date=SPA_2026)
    base.update(kw)
    return PurchaseInput(**base)


def item(res, key):
    return next(i for i in res.line_items if i.key == key)


@pytest.mark.parametrize("value,expected", [
    ("100000", "1000.00"),                     # 1% x 100k
    ("500000", "9000.00"),                     # 1,000 + 2% x 400k
    ("1000000", "24000.00"),                   # 9,000 + 3% x 500k
    ("1500000", "44000.00"),                   # 24,000 + 4% x 500k
    ("100050", "1002.00"),                     # fractional RM100 rounds UP to 100,100
    ("99999.99", "1000.00"),                   # rounds up to 100,000
    ("0", "0.00"),
])
def test_mot_scale(value, expected):
    assert mot_scale_duty(D(value)) == D(expected)


@pytest.mark.parametrize("loan,expected", [("450000", "2250.00"), ("450500", "2255.00"), ("1", "5.00"), ("0", "0.00")])
def test_loan_duty_per_rm1000_or_part(loan, expected):
    assert loan_duty(D(loan)) == D(expected)


@pytest.mark.parametrize("amount,expected", [
    ("500000", "6250.00"),        # 1.25% x 500k
    ("1000000", "11250.00"),      # 6,250 + 1% x 500k
    ("30000", "500.00"),          # 375 -> minimum RM500
    ("8000000", "81250.00"),      # 6,250 + 70,000 + 1% x 500k (cap above 7.5m)
])
def test_sro_2023_scale(amount, expected):
    assert sro_scale_fee(D(amount), D("0")) == D(expected)


def test_sro_discount_above_configured_cap_rejected():
    with pytest.raises(CalculationError):
        sro_scale_fee(D("500000"), D("0.25"))


def test_duty_on_higher_of_price_and_market_value():
    r = calculate(inp(purchase_price=D("400000"), market_value=D("450000")))
    assert r.assessed_value == D("450000.00")
    assert r.mot_duty == D("8000.00")  # 1,000 + 2% x 350k


def test_valuation_gap_and_bank_lends_on_lower():
    r = calculate(inp(market_value=D("480000"), loan_amount=D("430000")))
    assert r.valuation_gap == D("20000.00")
    assert any(f["code"] == "VALUATION_GAP" for f in r.flags)
    with pytest.raises(CalculationError):
        calculate(inp(market_value=D("480000"), loan_amount=D("490000")))


def test_under_declaration_is_blocking():
    r = calculate(inp(purchase_price=D("400000"), market_value=D("500000")))
    assert {"code": "UNDER_DECLARATION_RISK", "severity": "BLOCK"}.items() <= next(
        f for f in r.flags if f["code"] == "UNDER_DECLARATION_RISK").items()


def test_full_breakdown_and_totals_reconcile():
    r = calculate(inp(market_value=D("500000"), loan_amount=D("450000")))
    assert item(r, "deposit").amount == D("50000.00")
    assert item(r, "spa_legal_fee").amount == D("6250.00")
    assert item(r, "loan_legal_fee").amount == D("5625.00")  # 1.25% x 450k
    assert item(r, "sst_legal").amount == D("950.00")        # 8% x 11,875
    assert item(r, "loan_duty").amount == D("2250.00")
    assert item(r, "balance_cash").amount == D("0.00")
    signing = sum(i.amount for i in r.line_items if i.payable_at == "SIGNING")
    total = sum(i.amount for i in r.line_items if i.payable_at in ("SIGNING", "COMPLETION"))
    assert r.cash_at_signing == signing and r.total_cash_to_completion == total
    # RPGT retention is informational: it must NOT inflate cash totals.
    assert item(r, "rpgt_retention").payable_at == "INFO"


def test_first_time_buyer_full_exemption():
    r = calculate(inp(purchase_price=D("450000"), market_value=D("450000"), loan_amount=D("405000"),
                      first_time_buyer=True, never_owned_residential=True))
    assert r.mot_duty == D("0.00") and r.loan_duty == D("0.00")
    assert r.mot_duty_before_relief == D("8000.00")
    assert r.exemption_applied == "FTB_EXEMPTION_CURRENT"


@pytest.mark.parametrize("override", [
    dict(spa_date=date(2028, 1, 1)),                        # window ended 31 Dec 2027
    dict(property_type=PropertyType.VACANT_LAND),            # land excluded
    dict(purchase_price=D("520000")),                        # above cap
    dict(market_value=D("520000")),                          # cap tested on HIGHER value
    dict(buyer_status=BuyerStatus.PERMANENT_RESIDENT),       # citizens only
    dict(never_owned_residential=False),                     # inherited/joint ownership disqualifies
])
def test_first_time_buyer_ineligible(override):
    base = dict(purchase_price=D("450000"), first_time_buyer=True, never_owned_residential=True)
    base.update(override)
    r = calculate(inp(**base))
    assert r.exemption_applied is None and r.mot_duty > 0


def test_noncitizen_residential_flat_8pct():
    r = calculate(inp(purchase_price=D("1000000"), buyer_status=BuyerStatus.NON_CITIZEN))
    assert r.mot_duty == D("80000.00")
    assert item(r, "mot_duty").rule_code == "NONCITIZEN_RES_FLAT"


def test_pr_uses_citizen_scale():
    r = calculate(inp(purchase_price=D("1000000"), buyer_status=BuyerStatus.PERMANENT_RESIDENT))
    assert r.mot_duty == D("24000.00")


def test_noncitizen_land_conservative_and_blocked():
    r = calculate(inp(purchase_price=D("1000000"), buyer_status=BuyerStatus.NON_CITIZEN,
                      property_type=PropertyType.AGRICULTURAL_LAND))
    assert r.mot_duty == D("40000.00")  # max(24,000 scale, 4% flat)
    assert any(f["code"] == "NONCITIZEN_LAND" and f["severity"] == "BLOCK" for f in r.flags)


def test_budget2027_proposal_never_changes_official_totals():
    kw = dict(purchase_price=D("700000"), first_time_buyer=True, never_owned_residential=True,
              spa_date=date(2028, 3, 1))
    official = calculate(inp(**kw))
    shown = calculate(inp(**kw, budget2027_mode=Budget2027Mode.SHOW_PROPOSED_SCENARIO))
    assert official.mot_duty == shown.mot_duty == D("15000.00")  # 1,000 + 8,000 + 3% x 200k
    assert official.total_cash_to_completion == shown.total_cash_to_completion
    p = shown.proposed_scenario
    assert p["status"] == "PROPOSED_PENDING_GAZETTE"
    assert p["mot_duty"] == D("7500.00") and p["relief_rate"] == D("0.50")
    assert official.proposed_scenario is None


def test_budget2027_full_relief_band_and_out_of_range():
    r = calculate(inp(purchase_price=D("480000"), first_time_buyer=True, never_owned_residential=True,
                      spa_date=date(2029, 6, 1), budget2027_mode=Budget2027Mode.SHOW_PROPOSED_SCENARIO))
    assert r.proposed_scenario["mot_duty"] == D("0.00")
    r2 = calculate(inp(purchase_price=D("800000"), first_time_buyer=True, never_owned_residential=True,
                       spa_date=date(2029, 6, 1), budget2027_mode=Budget2027Mode.SHOW_PROPOSED_SCENARIO))
    assert r2.proposed_scenario["applicable"] is False


@pytest.mark.parametrize("bad", [0.1, -1, "abc", "NaN", "Infinity", True, "2000000000"])
def test_money_input_validation(bad):
    with pytest.raises(CalculationError):
        to_money(bad, "x")


def test_deposit_plus_loan_cannot_exceed_price():
    with pytest.raises(CalculationError):
        calculate(inp(loan_amount=D("475000")))  # 10% deposit + 95% loan


def test_unknown_estimate_override_rejected():
    with pytest.raises(CalculationError):
        calculate(inp(estimate_overrides={"bribe": D("1")}))


def test_to_dict_is_json_safe_strings():
    d = calculate(inp()).to_dict()
    assert d["mot_duty"] == "9000.00" and isinstance(d["line_items"][0]["amount"], str)
