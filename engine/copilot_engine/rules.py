"""Versioned, data-only rule definitions for Malaysian property transaction costs.

WHY a separate module: every money rule carries metadata (legal basis, effective
window, verification status). The calculator never hard-codes a rate inline, so a
gazette change is a reviewed diff here + a failing/updated unit test — never a
silent edit buried in arithmetic.

IMPORTANT: These rules are a decision-support aid, NOT legal or tax advice. Every
figure must be confirmed by the buyer's conveyancing lawyer and LHDN (HASiL)
before any instrument is stamped.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal
from enum import Enum


class RuleStatus(str, Enum):
    GAZETTED = "GAZETTED"  # in force by Act / P.U.(A) order
    PROPOSED_PENDING_GAZETTE = "PROPOSED_PENDING_GAZETTE"  # Budget speech only
    ESTIMATE = "ESTIMATE"  # market-practice estimate, not a statutory figure


@dataclass(frozen=True)
class Band:
    """Marginal band: `rate` applies to the slice of value up to `upper` (None = no cap)."""

    upper: Decimal | None
    rate: Decimal


@dataclass(frozen=True)
class RuleMeta:
    code: str
    title: str
    status: RuleStatus
    legal_basis: str
    effective_from: date | None
    effective_to: date | None
    last_reviewed: date
    note: str = ""

    def in_force_on(self, on: date) -> bool:
        if self.effective_from and on < self.effective_from:
            return False
        if self.effective_to and on > self.effective_to:
            return False
        return True


@dataclass(frozen=True)
class RuleSet:
    version: str

    # --- Memorandum of Transfer (MOT / Borang 14A) — Stamp Act 1949, First Schedule item 32(a)
    mot_bands: tuple[Band, ...]
    mot_rounding_block: Decimal  # duty is levied "for every RM100 or fractional part thereof"
    mot_meta: RuleMeta

    # --- Non-citizen flat rate on residential transfers
    noncitizen_residential_rate: Decimal
    noncitizen_residential_meta: RuleMeta
    # Conservative fallback for non-citizen NON-residential (land) transfers.
    noncitizen_nonresidential_rate: Decimal
    noncitizen_nonresidential_meta: RuleMeta

    # --- Loan / financing agreement — item 27(a): RM5 per RM1,000 or part thereof
    loan_rate: Decimal
    loan_rounding_block: Decimal
    loan_meta: RuleMeta

    # --- First-time Malaysian citizen homebuyer exemption (current, gazetted)
    ftb_cap: Decimal
    ftb_meta: RuleMeta

    # --- Budget 2027 proposal (NOT law until gazetted)
    b2027_full_cap: Decimal
    b2027_partial_upper: Decimal
    b2027_partial_relief: Decimal
    b2027_meta: RuleMeta

    # --- Solicitors' Remuneration Order 2023 (scale fee, Third Schedule)
    sro_bands: tuple[Band, ...]
    sro_minimum_fee: Decimal
    sro_max_discount: Decimal
    sro_meta: RuleMeta

    # --- Service tax on professional (legal) services
    sst_rate: Decimal
    sst_meta: RuleMeta

    # --- RPGT retention by purchaser (RPGT Act 1976, s.21B) — cash-flow, not extra cost
    rpgt_retention_rate: Decimal
    rpgt_meta: RuleMeta

    # --- Market-practice estimates (editable per transaction)
    default_deposit_rate: Decimal
    estimates: dict[str, Decimal] = field(default_factory=dict)
    estimates_meta: RuleMeta | None = None


_REVIEWED = date(2026, 11, 26)

RULESET_2026_11 = RuleSet(
    version="MY-2026.11",
    mot_bands=(
        Band(Decimal("100000"), Decimal("0.01")),
        Band(Decimal("500000"), Decimal("0.02")),
        Band(Decimal("1000000"), Decimal("0.03")),
        Band(None, Decimal("0.04")),
    ),
    mot_rounding_block=Decimal("100"),
    mot_meta=RuleMeta(
        code="MOT_SCALE",
        title="MOT ad valorem stamp duty (citizens & permanent residents)",
        status=RuleStatus.GAZETTED,
        legal_basis="Stamp Act 1949, First Schedule item 32(a); 4% band from 1 Jan 2019",
        effective_from=date(2019, 1, 1),
        effective_to=None,
        last_reviewed=_REVIEWED,
        note="Assessed on the HIGHER of consideration or market value (s.12 Stamp Act / JPPH).",
    ),
    noncitizen_residential_rate=Decimal("0.08"),
    noncitizen_residential_meta=RuleMeta(
        code="NONCITIZEN_RES_FLAT",
        title="Non-citizen flat stamp duty on residential transfer",
        status=RuleStatus.GAZETTED,
        legal_basis="Budget 2026 / Finance Act — 8% flat for non-citizens & foreign companies",
        effective_from=date(2026, 1, 1),
        effective_to=None,
        last_reviewed=_REVIEWED,
        note="Excludes Malaysian permanent residents. Confirm instrument date with lawyer.",
    ),
    noncitizen_nonresidential_rate=Decimal("0.04"),
    noncitizen_nonresidential_meta=RuleMeta(
        code="NONCITIZEN_NONRES_FLAT",
        title="Non-citizen flat stamp duty on non-residential/land transfer (conservative)",
        status=RuleStatus.ESTIMATE,
        legal_basis="Finance Act 2023 4% flat (from 1 Jan 2024) — applicability to land must be confirmed",
        effective_from=date(2024, 1, 1),
        effective_to=None,
        last_reviewed=_REVIEWED,
        note="Engine uses max(scale, flat) so upfront cash is never under-estimated. "
        "Non-citizen land purchases also need State Authority consent.",
    ),
    loan_rate=Decimal("0.005"),
    loan_rounding_block=Decimal("1000"),
    loan_meta=RuleMeta(
        code="LOAN_FLAT",
        title="Loan / financing agreement stamp duty",
        status=RuleStatus.GAZETTED,
        legal_basis="Stamp Act 1949, First Schedule item 27(a)",
        effective_from=None,
        effective_to=None,
        last_reviewed=_REVIEWED,
    ),
    ftb_cap=Decimal("500000"),
    ftb_meta=RuleMeta(
        code="FTB_EXEMPTION_CURRENT",
        title="First-time Malaysian citizen homebuyer: 100% MOT & loan duty exemption",
        status=RuleStatus.GAZETTED,
        legal_basis="Stamp Duty (Exemption) Orders (i-Miliki successor), extended for SPAs to 31 Dec 2027",
        effective_from=date(2021, 1, 1),
        effective_to=date(2027, 12, 31),
        last_reviewed=_REVIEWED,
        note="Residential property only (not vacant/agricultural land). Buyer must never have "
        "owned residential property incl. by inheritance, gift or joint ownership.",
    ),
    b2027_full_cap=Decimal("500000"),
    b2027_partial_upper=Decimal("750000"),
    b2027_partial_relief=Decimal("0.50"),
    b2027_meta=RuleMeta(
        code="FTB_BUDGET2027_PROPOSED",
        title="Budget 2027 PROPOSED first-home relief",
        status=RuleStatus.PROPOSED_PENDING_GAZETTE,
        legal_basis="Budget 2027 speech — NOT LAW until a P.U.(A) exemption order is gazetted",
        effective_from=date(2027, 1, 1),
        effective_to=date(2030, 12, 31),
        last_reviewed=_REVIEWED,
        note="Interpreted as: 100% relief up to RM500k; 50% relief on the duty for property "
        "valued RM500,001–RM750,000. Interpretation must be confirmed against the gazette.",
    ),
    sro_bands=(
        Band(Decimal("500000"), Decimal("0.0125")),
        Band(Decimal("7500000"), Decimal("0.010")),
        Band(None, Decimal("0.010")),  # excess above RM7.5m: negotiable, NOT exceeding 1%
    ),
    sro_minimum_fee=Decimal("500"),
    sro_max_discount=Decimal("0"),
    sro_meta=RuleMeta(
        code="SRO_2023_SCALE",
        title="Solicitors' Remuneration Order 2023 — sale & purchase / loan scale fee",
        status=RuleStatus.GAZETTED,
        legal_basis="Solicitors' Remuneration (Amendment) Order 2023 (confirm commencement date)",
        effective_from=None,
        effective_to=None,
        last_reviewed=_REVIEWED,
        note="Above RM7.5m the fee is negotiable (cap 1%); engine uses the cap. Any discount "
        "must comply with the Bar Council's prevailing ruling — default 0%. Developer "
        "Table B fees are out of scope (owner-direct sub-sales only).",
    ),
    sst_rate=Decimal("0.08"),
    sst_meta=RuleMeta(
        code="SST_PROFESSIONAL",
        title="Service tax on legal fees",
        status=RuleStatus.GAZETTED,
        legal_basis="Service Tax Act 2018 — 8% rate from 1 Mar 2024",
        effective_from=date(2024, 3, 1),
        effective_to=None,
        last_reviewed=_REVIEWED,
    ),
    rpgt_retention_rate=Decimal("0.03"),
    rpgt_meta=RuleMeta(
        code="RPGT_RETENTION",
        title="RPGT retention by purchaser (remit to LHDN within 60 days)",
        status=RuleStatus.GAZETTED,
        legal_basis="Real Property Gains Tax Act 1976, s.21B",
        effective_from=None,
        effective_to=None,
        last_reviewed=_REVIEWED,
        note="Part of the price, not an extra cost. Rate may differ for non-citizen or "
        "company sellers — your lawyer must confirm.",
    ),
    default_deposit_rate=Decimal("0.10"),
    estimates={
        "valuation_fee": Decimal("1500"),
        "official_title_search": Decimal("60"),
        "bankruptcy_winding_up_search": Decimal("50"),
        "land_office_registration": Decimal("400"),
        "state_consent_fee": Decimal("300"),
        "disbursements_misc": Decimal("1000"),
        "survey_fee_optional": Decimal("2500"),
    },
    estimates_meta=RuleMeta(
        code="DISBURSEMENT_ESTIMATES",
        title="Typical disbursements & third-party fees (estimates)",
        status=RuleStatus.ESTIMATE,
        legal_basis="Market practice; varies by state land office and firm",
        effective_from=None,
        effective_to=None,
        last_reviewed=_REVIEWED,
        note="Replace with your lawyer's written quotation.",
    ),
)

ACTIVE_RULESET = RULESET_2026_11
