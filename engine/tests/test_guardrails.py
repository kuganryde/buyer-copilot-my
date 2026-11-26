from datetime import date
from decimal import Decimal as D

from copilot_engine.guardrails import ListingFacts, PaymentIntent, PaymentMethod, Tenure, evaluate, has_blocking

TODAY = date(2026, 11, 26)


def codes(flags, sev=None):
    return {f.code for f in flags if sev is None or f.severity == sev}


def clean(**kw):
    base = dict(official_title_search_done=True, title_search_date=TODAY, registered_owner_matches_seller=True,
                has_existing_charge=False, has_private_caveat=False, has_registrar_caveat=False,
                has_restriction_in_interest=False, is_malay_reserve=False, tenure=Tenure.FREEHOLD,
                has_legal_road_access=True, boundary_confirmed=True, has_unapproved_renovation=False)
    base.update(kw)
    return ListingFacts(**base)


def test_clean_listing_has_no_blocks():
    assert not has_blocking(evaluate(clean(), TODAY))


def test_cash_by_hand_blocks():
    f = clean(payments=[PaymentIntent(D("5000"), PaymentMethod.CASH_BY_HAND, False, False, False)])
    assert "CASH_BY_HAND" in codes(evaluate(f, TODAY), "BLOCK")


def test_personal_transfer_without_receipt_blocks_with_receipt_warns():
    bad = clean(payments=[PaymentIntent(D("5000"), PaymentMethod.TRANSFER_TO_SELLER_PERSONAL, False, False, False)])
    ok = clean(payments=[PaymentIntent(D("5000"), PaymentMethod.TRANSFER_TO_SELLER_PERSONAL, True, True, False)])
    assert "UNPROTECTED_PERSONAL_TRANSFER" in codes(evaluate(bad, TODAY), "BLOCK")
    assert "PERSONAL_TRANSFER" in codes(evaluate(ok, TODAY), "WARN")
    assert not has_blocking(evaluate(ok, TODAY))


def test_lawyer_stakeholder_payment_is_clean():
    f = clean(payments=[PaymentIntent(D("50000"), PaymentMethod.TRANSFER_TO_LAWYER_CLIENT_ACCOUNT, True, True, True)])
    assert codes(evaluate(f, TODAY)) == set()


def test_missing_title_search_and_owner_mismatch_block():
    assert "NO_OFFICIAL_SEARCH" in codes(evaluate(ListingFacts(), TODAY), "BLOCK")
    assert "OWNER_MISMATCH" in codes(evaluate(clean(registered_owner_matches_seller=False), TODAY), "BLOCK")


def test_stale_search_warns():
    assert "STALE_SEARCH" in codes(evaluate(clean(title_search_date=date(2026, 9, 1)), TODAY), "WARN")


def test_encumbrances():
    fl = evaluate(clean(has_existing_charge=True, has_private_caveat=True, has_registrar_caveat=True,
                        has_restriction_in_interest=True, restriction_text="Tidak boleh dipindah milik"), TODAY)
    assert {"EXISTING_CHARGE", "PRIVATE_CAVEAT", "RESTRICTION_IN_INTEREST"} <= codes(fl, "WARN")
    assert "REGISTRAR_CAVEAT" in codes(fl, "BLOCK")


def test_malay_reserve():
    assert "MALAY_RESERVE" in codes(evaluate(clean(is_malay_reserve=True), TODAY), "BLOCK")
    assert "MALAY_RESERVE" not in codes(evaluate(clean(is_malay_reserve=True, buyer_is_malay_as_defined=True), TODAY))


def test_short_leasehold_thresholds():
    lease = lambda y, pt="RESIDENTIAL_HOUSE": evaluate(  # noqa: E731
        clean(tenure=Tenure.LEASEHOLD, lease_expiry=date(2026 + y, 11, 26), property_type=pt), TODAY)
    assert "SHORT_LEASE" in codes(lease(25), "BLOCK")
    assert "SHORT_LEASE" in codes(lease(45), "WARN")
    assert "SHORT_LEASE" in codes(lease(45, "AGRICULTURAL_LAND"), "BLOCK")  # raw land stricter
    assert "SHORT_LEASE" not in codes(lease(80))


def test_access_land_use_and_renovation():
    fl = evaluate(clean(has_legal_road_access=False, land_use_category="Pertanian", intended_use="RESIDENTIAL",
                        has_unapproved_renovation=True), TODAY)
    assert {"NO_LEGAL_ACCESS", "LAND_USE_MISMATCH"} <= codes(fl, "BLOCK")
    assert "UNAPPROVED_RENOVATION" in codes(fl, "WARN")


def test_under_declaration():
    fl = evaluate(clean(declared_price=D("400000"), market_value=D("500000")), TODAY)
    assert "UNDER_DECLARATION_RISK" in codes(fl, "BLOCK")
    assert "UNDER_DECLARATION_RISK" not in codes(evaluate(clean(declared_price=D("460000"), market_value=D("500000")), TODAY))


def test_every_flag_is_bilingual_with_next_step():
    fl = evaluate(ListingFacts(has_legal_road_access=False, tenure=Tenure.UNKNOWN), TODAY)
    assert fl and all(f.title_en and f.title_ms and f.next_step for f in fl)
