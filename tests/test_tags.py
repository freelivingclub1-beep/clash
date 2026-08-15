import pytest

from treblo.tags import TagError, TagSet, UnknownTag, validate


def test_yeat_must_be_first():
    with pytest.raises(TagError, match="must be the first tag"):
        validate(["trap", "yeat", "piano"])


def test_minimum_three_tags():
    with pytest.raises(TagError, match="at least 3 tags"):
        validate(["yeat", "trap"])


def test_maximum_six_tags():
    with pytest.raises(TagError, match="No more than 6"):
        validate(["yeat", "trap", "piano", "guitar", "bass", "drums", "rock"])


def test_unknown_tag_reports_didnt_find_it():
    with pytest.raises(UnknownTag, match="Didn't find a tag: 'pianoo'"):
        validate(["yeat", "trap", "pianoo"])


def test_unknown_tag_suggests_the_near_miss():
    with pytest.raises(UnknownTag) as excinfo:
        validate(["yeat", "trap", "pianoo"])
    assert "piano" in excinfo.value.suggestions


def test_tags_are_case_and_space_insensitive():
    assert validate(["  Yeat ", "TRAP", "Cloud   Rap"]) == ["yeat", "trap", "cloud rap"]


def test_duplicates_rejected():
    with pytest.raises(TagError, match="Duplicate tag"):
        validate(["yeat", "trap", "trap"])


def test_swap_leaves_anchor_alone():
    ts = TagSet(["yeat", "trap", "piano"])
    assert ts.swap("piano", "guitar").tags == ["yeat", "trap", "guitar"]


def test_anchor_cannot_be_swapped():
    ts = TagSet(["yeat", "trap", "piano"])
    with pytest.raises(TagError, match="locked"):
        ts.swap("yeat", "trap")


def test_anchor_cannot_be_removed():
    ts = TagSet(["yeat", "trap", "piano", "bass"])
    with pytest.raises(TagError, match="locked"):
        ts.remove("yeat")


def test_swapping_to_an_unknown_tag_fails_loudly():
    ts = TagSet(["yeat", "trap", "piano"])
    with pytest.raises(UnknownTag):
        ts.swap("piano", "not a real tag")


def test_removing_below_minimum_fails():
    ts = TagSet(["yeat", "trap", "piano"])
    with pytest.raises(TagError, match="at least 3"):
        ts.remove("piano")


def test_adding_beyond_six_fails():
    ts = TagSet(["yeat", "trap", "piano", "guitar", "bass", "drums"])
    with pytest.raises(TagError, match="No more than 6"):
        ts.add("rock")
