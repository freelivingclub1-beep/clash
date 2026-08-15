import pytest

from treblo.costs import MODEL_PRICING, comparison_table, estimate


def test_offline_writer_costs_only_the_machine():
    est = estimate(500, model="template", vps_per_month=5.0)
    assert est.lyrics_per_month == 0
    assert est.total_per_month == 5.0


def test_two_songs_come_from_one_generation():
    assert estimate(100).generations_per_day == 50


def test_auto_lyrics_generations_dont_hit_the_api():
    """Every 3rd generation uses Treblo's own lyrics, so 2 in 3 cost money."""
    est = estimate(120)  # 60 generations
    assert est.lyric_calls_per_day == pytest.approx(40)


def test_disabling_auto_lyrics_means_every_generation_costs():
    est = estimate(120, auto_lyrics_every=0)
    assert est.lyric_calls_per_day == pytest.approx(60)


def test_cost_scales_linearly_with_volume():
    small = estimate(100, model="claude-opus-5")
    big = estimate(1000, model="claude-opus-5")
    assert big.lyrics_per_month == pytest.approx(small.lyrics_per_month * 10)


def test_cheaper_models_cost_less():
    opus = estimate(200, model="claude-opus-5").lyrics_per_month
    sonnet = estimate(200, model="claude-sonnet-5").lyrics_per_month
    haiku = estimate(200, model="claude-haiku-4-5").lyrics_per_month
    assert opus > sonnet > haiku > 0


def test_opus_matches_a_hand_calculation():
    # 100 songs = 50 generations, 2/3 use the API = 33.33 calls.
    # Each call: 1000 in @ $5/MTok + 1000 out @ $25/MTok = $0.03.
    est = estimate(100, model="claude-opus-5")
    assert est.lyrics_per_day == pytest.approx(33.333 * 0.03, rel=1e-3)
    assert est.lyrics_per_month == pytest.approx(est.lyrics_per_day * 30)


def test_unknown_model_is_rejected_rather_than_silently_priced_at_zero():
    with pytest.raises(ValueError, match="unknown model"):
        estimate(100, model="gpt-4")


def test_every_priced_model_appears_in_the_table():
    table = comparison_table(100)
    for model in MODEL_PRICING:
        assert model in table


def test_report_flags_the_treblo_bill_it_cannot_see():
    report = estimate(100).report()
    assert "Treblo" in report
