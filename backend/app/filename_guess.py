"""Guess title / artist / track number from a filename, for files without tags
(typical for audio pulled from video sites). Only used when the file has no title tag.

Handles e.g.
    郁可唯《茶汤》百万豪装录音棚大声听        -> 茶汤 / 郁可唯
    【Hi-Res无损音质】｜《甲乙丙丁 (…)》- 李佳薇  -> 甲乙丙丁 / 李佳薇
    Adele - Someone Like You (Official Video)  -> Someone Like You / Adele
    03. Think of Me                            -> Think of Me, track 3
"""
import re
import unicodedata

# Upload decorations that are never part of a song title.
NOISE = re.compile(
    r"百万(?:豪装|级装备)?(?:录音棚)?(?:大声听|试听)?|录音棚大声听|大声听|装备试听|试听版?"
    r"|(?:超)?(?:高|无损|Hi-?Res)\s*(?:无损)?\s*音质|Hi-?Res|无损|高音质|杜比全景声"
    r"|官方(?:完整版|MV|版)?|动态歌词(?:版)?|歌词版|纯享版?|原声专辑"
    r"|\b(?:Official\s+(?:Music\s+)?(?:Video|Audio|MV)|Lyrics?\s+Video|Lyrics|Audio|MV|HD|HQ|4K)\b",
    re.IGNORECASE,
)
BRACKETS = re.compile(r"【[^】]*】|\[[^\]]*\]")
QUOTED = re.compile(r"[‘“「『][^’”」』]*(?:[’”」』]|$)")  # lyric snippets, incl. unclosed ones
EMPTY_PARENS = re.compile(r"[(（]\s*[)）]")
EDGE_SEPARATORS = " \t-–—_|｜·•:：,，~～"
SEPARATOR = re.compile(r"\s+[-–—_|｜]\s+")
TRACK_PREFIX = re.compile(r"^\s*(\d{1,3})\s*[-._、)\s]\s*(?=\S)")
CJK = re.compile(r"[぀-ヿ㐀-鿿]")


def _clean(text: str) -> str:
    text = NOISE.sub(" ", text)
    text = EMPTY_PARENS.sub(" ", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip(EDGE_SEPARATORS)


def _strip_alt_title(title: str) -> str:
    """《甲乙丙丁 (你我怎么两清)》: a trailing Chinese/Japanese parenthetical is usually a
    lyric line or alternate title. Keep English ones such as (Live) or (Reprise)."""
    m = re.match(r"^(.+?)\s*[(（]([^()（）]*)[)）]$", title)
    if m and CJK.search(m.group(2)) and not re.search(r"版|现场|live|remix", m.group(2), re.I):
        return m.group(1).strip()
    return title


def guess_from_filename(stem: str) -> tuple[str | None, str | None, int | None]:
    """Returns (title, artist, track_number); any part may be None."""
    # 𝐇𝐢-𝐑𝐞𝐬 -> Hi-Res; only the math-alphanumeric block, so ：《》 etc. stay as written
    s = "".join(unicodedata.normalize("NFKC", ch) if 0x1D400 <= ord(ch) <= 0x1D7FF else ch for ch in stem)
    s = BRACKETS.sub(" ", s)
    s = QUOTED.sub(" ", s)

    track = None
    m = TRACK_PREFIX.match(s)
    if m and not re.match(r"^\s*\d{4}", s):  # don't mistake a year for a track number
        track = int(m.group(1))
        s = s[m.end():]

    m = re.search(r"《([^》]+)》", s)
    if m:
        title = _clean(_strip_alt_title(m.group(1).strip()))
        artist = _clean(s[:m.start()]) or _clean(s[m.end():]) or None
        return title or None, artist, track

    s = _clean(s)
    parts = SEPARATOR.split(s, maxsplit=1)
    if len(parts) == 2 and len(parts[0]) >= 1 and len(_clean(parts[1])) >= 2:
        artist, title = parts[0].strip(), _clean(SEPARATOR.sub(" · ", parts[1]))
        return title, artist, track
    return s or None, None, track
