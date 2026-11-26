"""Deterministic Malaysian property cost & stamp-duty calculator.

Design rules (non-negotiable):
  * All arithmetic uses `decimal.Decimal` with an explicit context — never float,
    never LLM-generated numbers. Floats are rejected at the boundary.
  * Every line item carries the rule code that produced it, so the UI and audit
    log can show *why* a figure exists.
  * When a rule is uncertain, the engine errs towards HIGHER upfront cash
    (under-estimating cash needs is the failure mode that hurts buyers).
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import date
from decimal import ROUND_CEILING, ROUND_HALF_UP, Decimal, localcontext
from enum import Enum
from typing import Any

from .rules import ACTIVE_RULESET, Band, RuleSet, RuleStatus

CENT = Decimal("0.01")
MAX_PRICE = Decimal("1000000000")  # RM1bn sanity ceiling — rejects fat-finger / overflow input


class PropertyType(str, Enum):
    RESIDENTIAL_HOUSE = "RESIDENTIAL_HOUSE"
    VACANT_LAND = "VACANT_LAND"  # vacant residential/building lot
    AGRICULTURAL_LAND = "AGRICULTURAL_LAND"

    @property
    def is_residential_dwelling(self) -> bool:
        return self is PropertyType.RESIDENTIAL_HOUSE


class BuyerStatus(str, Enum):
    CITIZEN = "CITIZEN"
    PERMANENT_RESIDENT = "PERMANENT_RESIDENT"
    NON_CITIZEN = "NON_CITIZEN"


class Budget2027Mode(str, Enum):
    GAZETTED_ONLY = "GAZETTED_ONLY"
    SHOW_PROPOSED_SCENARIO = "SHOW_PROPOSED_SCENARIO"


class CalculationError(ValueError):
    """Raised for invalid input. Message is safe to show to the user."""


@dataclass(frozen=True)
class PurchaseInput:
    purchase_price: Decimal
    property_type: PropertyType
    buyer_status: BuyerStatus
    spa_date: date
    market_value: Decimal | None = None  # JPPH / bank valuation if known
    loan_amount: Decimal = Decimal("0")
    first_time_buyer: bool = False
    never_owned_residential: bool = False  # incl. inheritance, gift, joint ownership
    requires_state_consent: bool = False
    include_survey: bool = False
    deposit_rate: Decimal | None = None
    legal_fee_discount_rate: Decimal = Decimal("0")
    budget2027_mode: Budget2027Mode = Budget2027Mode.GAZETTED_ONLY
    estimate_overrides: dict[str, Decimal] = field(default_factory=dict)


@dataclass(frozen=True)
class LineItem:
    key: str
    label: str
    amount: Decimal
    rule_code: str
    rule_status: str
    payable_at: str  # SIGNING | COMPLETION | INFO
    note: str = ""


@dataclass
class CostBreakdown:
    ruleset_version: str
    assessed_value: Decimal
    lendable_value: Decimal
    valuation_gap: Decimal
    line_items: list[LineItem]
    cash_at_signing: Decimal
    total_cash_to_completion: Decimal
    mot_duty_before_relief: Decimal
    mot_duty: Decimal
    loan_duty: Decimal
    exemption_applied: str | None
    flags: list[dict[str, str]]
    proposed_scenario: dict[str, Any] | None = None

    def to_dict(self) -> dict[str, Any]:
        """JSON-safe dict. Decimals become strings so no precision is lost in transit."""

        def conv(v: Any) -> Any:
            if isinstance(v, Decimal):
                return format(v, "f")
            if isinstance(v, Enum):
                return v.value
            if isinstance(v, dict):
                return {k: conv(x) for k, x in v.items()}
            if isinstance(v, list):
                return [conv(x) for x in v]
            return v

        return conv(asdict(self))


# --------------------------------------------------------------------------- helpers


def to_money(value: Any, name: str) -> Decimal:
    """Strict coercion: accepts Decimal/int/str; rejects float, NaN, Inf, negatives."""
    if isinstance(value, bool) or isinstance(value, float):
        # floats are rejected so 0.1 + 0.2 style errors can never reach a duty figure
        raise CalculationError(f"{name} must be a string or integer, not float")
    try:
        d = Decimal(str(value).replace(",", "").strip())
    except Exception as exc:  # decimal.InvalidOperation and friends
        raise CalculationError(f"{name} is not a valid amount") from exc
    if not d.is_finite():
        raise CalculationError(f"{name} must be finite")
    if d < 0:
        raise CalculationError(f"{name} cannot be negative")
    if d > MAX_PRICE:
        raise CalculationError(f"{name} exceeds the supported maximum")
    return d.quantize(CENT, rounding=ROUND_HALF_UP)


def _round_up_to_block(value: Decimal, block: Decimal) -> Decimal:
    """Stamp Act charges 'for every RM100 (or RM1,000) or fractional part thereof'."""
    if value <= 0:
        return Decimal("0")
    return (value / block).to_integral_value(rounding=ROUND_CEILING) * block


def marginal(value: Decimal, bands: tuple[Band, ...]) -> Decimal:
    total = Decimal("0")
    lower = Decimal("0")
    for band in bands:
        upper = band.upper if band.upper is not None else value
        if value <= lower:
            break
        slice_ = min(value, upper) - lower
        if slice_ > 0:
            total += slice_ * band.rate
        lower = upper
    return total.quantize(CENT, rounding=ROUND_HALF_UP)


def mot_scale_duty(assessed_value: Decimal, rs: RuleSet = ACTIVE_RULESET) -> Decimal:
    return marginal(_round_up_to_block(assessed_value, rs.mot_rounding_block), rs.mot_bands)


def loan_duty(loan_amount: Decimal, rs: RuleSet = ACTIVE_RULESET) -> Decimal:
    blocked = _round_up_to_block(loan_amount, rs.loan_rounding_block)
    return (blocked * rs.loan_rate).quantize(CENT, rounding=ROUND_HALF_UP)


def sro_scale_fee(amount: Decimal, discount_rate: Decimal, rs: RuleSet = ACTIVE_RULESET) -> Decimal:
    if amount <= 0:
        return Decimal("0.00")
    if discount_rate < 0 or discount_rate > rs.sro_max_discount:
        raise CalculationError(
            f"Legal fee discount must be between 0 and {rs.sro_max_discount * 100}% under the configured SRO rule"
        )
    fee = marginal(amount, rs.sro_bands)
    fee = max(fee, rs.sro_minimum_fee)
    return (fee * (Decimal("1") - discount_rate)).quantize(CENT, rounding=ROUND_HALF_UP)


def _ftb_eligible(inp: PurchaseInput, assessed: Decimal, rs: RuleSet) -> bool:
    return (
        inp.buyer_status is BuyerStatus.CITIZEN
        and inp.first_time_buyer
        and inp.never_owned_residential
        and inp.property_type.is_residential_dwelling
        and rs.ftb_meta.in_force_on(inp.spa_date)
        and assessed <= rs.ftb_cap
    )


def _b2027_relief(inp: PurchaseInput, assessed: Decimal, rs: RuleSet) -> Decimal | None:
    """Return relief fraction under the PROPOSED Budget 2027 rule, or None if N/A."""
    base_ok = (
        inp.buyer_status is BuyerStatus.CITIZEN
        and inp.first_time_buyer
        and inp.never_owned_residential
        and inp.property_type.is_residential_dwelling
        and rs.b2027_meta.in_force_on(inp.spa_date)
    )
    if not base_ok:
        return None
    if assessed <= rs.b2027_full_cap:
        return Decimal("1")
    if assessed <= rs.b2027_partial_upper:
        return rs.b2027_partial_relief
    return None


# --------------------------------------------------------------------------- main


def calculate(inp: PurchaseInput, rs: RuleSet = ACTIVE_RULESET) -> CostBreakdown:
    with localcontext() as ctx:
        ctx.prec = 28  # ample for RM1bn with cents; explicit so global context can't leak in
        return _calculate(inp, rs)


def _calculate(inp: PurchaseInput, rs: RuleSet) -> CostBreakdown:
    price = to_money(inp.purchase_price, "purchase_price")
    if price <= 0:
        raise CalculationError("purchase_price must be greater than zero")
    mv = to_money(inp.market_value, "market_value") if inp.market_value is not None else None
    loan = to_money(inp.loan_amount, "loan_amount")
    deposit_rate = inp.deposit_rate if inp.deposit_rate is not None else rs.default_deposit_rate
    if not (Decimal("0") <= deposit_rate <= Decimal("1")):
        raise CalculationError("deposit_rate must be between 0 and 1")

    flags: list[dict[str, str]] = []
    assessed = max(price, mv) if mv is not None else price
    lendable = min(price, mv) if mv is not None else price
    valuation_gap = max(price - lendable, Decimal("0"))

    if loan > lendable:
        raise CalculationError("loan_amount exceeds the lower of price and valuation — banks lend on the lower figure")
    if mv is None:
        flags.append(
            _flag("NO_VALUATION", "WARN", "No valuation yet: duty may be re-assessed on a higher JPPH market value.")
        )
    if valuation_gap > 0:
        flags.append(
            _flag(
                "VALUATION_GAP",
                "WARN",
                f"Valuation is RM{valuation_gap:,.2f} below price. Banks lend on the lower "
                "figure, so this gap must be funded in cash.",
            )
        )
    if mv is not None and price < mv * Decimal("0.90"):
        flags.append(
            _flag(
                "UNDER_DECLARATION_RISK",
                "BLOCK",
                "Declared price is >10% below market value. Under-declaring on Borang 14A "
                "to cut stamp duty is unlawful; LHDN/JPPH assess duty on market value and "
                "may impose penalties. Declare the true consideration.",
            )
        )

    # ---------------- MOT duty
    scale = mot_scale_duty(assessed, rs)
    mot_rule = rs.mot_meta
    if inp.buyer_status is BuyerStatus.NON_CITIZEN:
        if inp.property_type.is_residential_dwelling and rs.noncitizen_residential_meta.in_force_on(inp.spa_date):
            mot_before = (assessed * rs.noncitizen_residential_rate).quantize(CENT, rounding=ROUND_HALF_UP)
            mot_rule = rs.noncitizen_residential_meta
        else:
            flat = (assessed * rs.noncitizen_nonresidential_rate).quantize(CENT, rounding=ROUND_HALF_UP)
            mot_before = max(scale, flat)
            mot_rule = rs.noncitizen_nonresidential_meta
            flags.append(
                _flag(
                    "NONCITIZEN_LAND",
                    "BLOCK",
                    "Non-citizen land purchase: State Authority consent is mandatory and "
                    "several states restrict foreign land ownership. Duty shown is a "
                    "conservative estimate — confirm with your lawyer before proceeding.",
                )
            )
    else:
        mot_before = scale

    loan_d_before = loan_duty(loan, rs)
    mot_d, loan_d = mot_before, loan_d_before
    exemption: str | None = None

    if _ftb_eligible(inp, assessed, rs):
        mot_d, loan_d = Decimal("0.00"), Decimal("0.00")
        exemption = rs.ftb_meta.code
    elif inp.first_time_buyer and not inp.property_type.is_residential_dwelling:
        flags.append(
            _flag(
                "FTB_NOT_LAND", "INFO", "First-time homebuyer exemption does not apply to vacant or agricultural land."
            )
        )
    elif inp.first_time_buyer and inp.buyer_status is BuyerStatus.CITIZEN and assessed > rs.ftb_cap:
        flags.append(
            _flag(
                "FTB_OVER_CAP", "INFO", f"Assessed value exceeds RM{rs.ftb_cap:,.0f}: current exemption does not apply."
            )
        )

    # ---------------- Proposed Budget 2027 scenario (never mixed into official totals)
    proposed: dict[str, Any] | None = None
    if inp.budget2027_mode is Budget2027Mode.SHOW_PROPOSED_SCENARIO:
        relief = _b2027_relief(inp, assessed, rs)
        if relief is not None:
            p_mot = (mot_before * (1 - relief)).quantize(CENT, rounding=ROUND_HALF_UP)
            p_loan = (loan_d_before * (1 - relief)).quantize(CENT, rounding=ROUND_HALF_UP)
            proposed = {
                "rule_code": rs.b2027_meta.code,
                "status": RuleStatus.PROPOSED_PENDING_GAZETTE.value,
                "relief_rate": relief,
                "mot_duty": p_mot,
                "loan_duty": p_loan,
                "saving_vs_official": (mot_d + loan_d) - (p_mot + p_loan),
                "warning": "PROPOSAL ONLY — not law until gazetted. Do not budget on this figure "
                "without written confirmation from your lawyer.",
            }
        else:
            proposed = {
                "rule_code": rs.b2027_meta.code,
                "status": RuleStatus.PROPOSED_PENDING_GAZETTE.value,
                "applicable": False,
                "warning": "Proposed Budget 2027 relief would not apply to these inputs.",
            }

    # ---------------- Legal fees, SST, disbursements
    discount = inp.legal_fee_discount_rate
    spa_fee = sro_scale_fee(price, discount, rs)
    loan_fee = sro_scale_fee(loan, discount, rs) if loan > 0 else Decimal("0.00")
    sst = ((spa_fee + loan_fee) * rs.sst_rate).quantize(CENT, rounding=ROUND_HALF_UP)

    est = dict(rs.estimates)
    for k, v in inp.estimate_overrides.items():
        if k not in est:
            raise CalculationError(f"Unknown estimate key: {k}")
        est[k] = to_money(v, k)

    deposit = (price * deposit_rate).quantize(CENT, rounding=ROUND_HALF_UP)
    balance_cash = price - deposit - loan
    if balance_cash < 0:
        raise CalculationError("deposit + loan exceed the purchase price — reduce the loan amount or deposit rate")
    est_meta = rs.estimates_meta
    if est_meta is None:  # explicit check (asserts are stripped under python -O)
        raise CalculationError("ruleset is missing estimate metadata")

    items: list[LineItem] = [
        LineItem(
            "deposit",
            "Deposit (paid to lawyer as stakeholder)",
            deposit,
            "DEPOSIT",
            RuleStatus.ESTIMATE.value,
            "SIGNING",
            "Never pay by hand or to a personal account without an SPA/stakeholder receipt.",
        ),
        LineItem(
            "official_title_search",
            "Official title search (Carian Rasmi)",
            est["official_title_search"],
            est_meta.code,
            est_meta.status.value,
            "SIGNING",
        ),
        LineItem(
            "bankruptcy_winding_up_search",
            "Bankruptcy / winding-up search on seller",
            est["bankruptcy_winding_up_search"],
            est_meta.code,
            est_meta.status.value,
            "SIGNING",
        ),
        LineItem(
            "valuation_fee", "Valuation report", est["valuation_fee"], est_meta.code, est_meta.status.value, "SIGNING"
        ),
        LineItem(
            "spa_legal_fee",
            "SPA legal fee (SRO 2023 scale)",
            spa_fee,
            rs.sro_meta.code,
            rs.sro_meta.status.value,
            "SIGNING",
        ),
        LineItem(
            "loan_legal_fee",
            "Loan agreement legal fee (SRO 2023 scale)",
            loan_fee,
            rs.sro_meta.code,
            rs.sro_meta.status.value,
            "SIGNING",
        ),
        LineItem("sst_legal", "SST 8% on legal fees", sst, rs.sst_meta.code, rs.sst_meta.status.value, "SIGNING"),
        LineItem(
            "mot_duty",
            "Stamp duty — MOT / Borang 14A",
            mot_d,
            mot_rule.code,
            mot_rule.status.value,
            "COMPLETION",
            f"Before relief: RM{mot_before:,.2f}" if exemption else "",
        ),
        LineItem(
            "loan_duty", "Stamp duty — loan agreement", loan_d, rs.loan_meta.code, rs.loan_meta.status.value, "SIGNING"
        ),
        LineItem(
            "land_office_registration",
            "Land office registration",
            est["land_office_registration"],
            est_meta.code,
            est_meta.status.value,
            "COMPLETION",
        ),
        LineItem(
            "disbursements_misc",
            "Misc. disbursements",
            est["disbursements_misc"],
            est_meta.code,
            est_meta.status.value,
            "COMPLETION",
        ),
        LineItem(
            "balance_cash",
            "Balance purchase price paid in cash (excl. loan)",
            balance_cash,
            "BALANCE",
            RuleStatus.ESTIMATE.value,
            "COMPLETION",
        ),
    ]
    if inp.requires_state_consent:
        items.append(
            LineItem(
                "state_consent_fee",
                "State Authority consent fee",
                est["state_consent_fee"],
                est_meta.code,
                est_meta.status.value,
                "SIGNING",
            )
        )
    if inp.include_survey:
        items.append(
            LineItem(
                "survey_fee_optional",
                "Boundary re-survey (licensed surveyor)",
                est["survey_fee_optional"],
                est_meta.code,
                est_meta.status.value,
                "SIGNING",
            )
        )

    retention = (price * rs.rpgt_retention_rate).quantize(CENT, rounding=ROUND_HALF_UP)
    items.append(
        LineItem(
            "rpgt_retention",
            "RPGT retention (held from price, remitted to LHDN)",
            retention,
            rs.rpgt_meta.code,
            rs.rpgt_meta.status.value,
            "INFO",
            rs.rpgt_meta.note,
        )
    )

    at_signing = sum((i.amount for i in items if i.payable_at == "SIGNING"), Decimal("0"))
    total = sum((i.amount for i in items if i.payable_at in ("SIGNING", "COMPLETION")), Decimal("0"))

    return CostBreakdown(
        ruleset_version=rs.version,
        assessed_value=assessed,
        lendable_value=lendable,
        valuation_gap=valuation_gap,
        line_items=items,
        cash_at_signing=at_signing.quantize(CENT),
        total_cash_to_completion=total.quantize(CENT),
        mot_duty_before_relief=mot_before,
        mot_duty=mot_d,
        loan_duty=loan_d,
        exemption_applied=exemption,
        flags=flags,
        proposed_scenario=proposed,
    )


_FLAG_TITLES: dict[str, tuple[str, str]] = {
    "NO_VALUATION": ("No valuation yet", "Belum dinilai"),
    "VALUATION_GAP": ("Valuation below price", "Nilai di bawah harga"),
    "UNDER_DECLARATION_RISK": ("Possible under-declaration", "Risiko pengisytiharan rendah"),
    "NONCITIZEN_LAND": ("Non-citizen land purchase", "Pembelian tanah bukan warganegara"),
    "FTB_NOT_LAND": ("First-home exemption: houses only", "Pengecualian rumah pertama: rumah sahaja"),
    "FTB_OVER_CAP": ("Above first-home exemption cap", "Melebihi had pengecualian rumah pertama"),
}


def _flag(code: str, severity: str, message: str) -> dict[str, str]:
    en, ms = _FLAG_TITLES.get(code, (code, code))
    return {"code": code, "severity": severity, "title_en": en, "title_ms": ms, "message": message}
