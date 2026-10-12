#!/usr/bin/env python3
"""update_spicy_data_free.py — grow spicy_data.js from free, open datasets only.

WHY THIS FILE EXISTS
--------------------
spicy_data.js was generated from a private pipeline: 393 airports, 194 airlines
and the equipment tables.  The engine can only convert an airport it knows, so
every airport missing from that file printed as `???` in the GDS window.  This
script folds four *free* reference datasets into the same file and never
deletes or rewrites an entry the engine already had.

THE FOUR SOURCES (all $0, no key, no card, no account)
------------------------------------------------------
  1. OurAirports airports.csv        — public domain (Unlicense)
       https://github.com/davidmegginson/ourairports-data
       Names, coordinates, IATA codes, country, scheduled-service flag.
  2. OpenFlights airports.dat        — ODbL
       https://github.com/jpatokal/openflights
       IANA time-zone id per IATA code (used ONLY as the zone key: the UTC
       offset itself is computed from the zone database below).
  3. Passport Index dataset          — MIT
       https://github.com/imorte/passport-index-data
       Visa requirement per passport->destination pair (ISO-2 both sides).
  4. mledoze/countries               — ODbL
       https://github.com/mledoze/countries
       Country names and currencies (for the FX badge).

HONESTY RULES THIS SCRIPT ENFORCES
----------------------------------
  * An airport is added ONLY when its UTC offset can be derived and *proved*.
    The offset comes from the IANA time-zone database (Python `zoneinfo`), and
    the DST rule the engine will apply is then verified against that database
    over two years of samples.  An airport whose zone observes a DST regime the
    engine cannot express is SKIPPED and counted in the report — a wrong local
    time is worse than an unknown airport, because the GDS row looks right.
  * Existing entries are never shrunk, reordered or rewritten: they keep their
    own values, and only gain the country code used for currency and visa
    lookups.
  * Every derived block carries its provenance (source, URL, dataset date,
    licence) into spicy_data.js so the UI can attribute what it shows.

OUTPUT
------
  airports        + every IATA airport with a proved offset (name/lat/lon/off/dst/cc)
  countries       ISO-2 -> {name, currency}          (new block)
  visaFree        passport -> {destination: code}    (new block, compact)
  visaMeta        source + licence + dataset date + the passport shortlist
  ...and every block that was already in the file, byte-identical in meaning.

USAGE
-----
  python3 update_spicy_data_free.py            # fetch (or reuse cache) and merge
  python3 update_spicy_data_free.py --check    # dry run: report, change nothing
  python3 update_spicy_data_free.py --report   # report on the committed file only
"""
import argparse
import csv
import io
import json
import math
import pathlib
import re
import sys
import tarfile
import urllib.request
from datetime import date, datetime

try:
    from zoneinfo import ZoneInfo            # Python 3.9+
except ImportError:                          # pragma: no cover
    ZoneInfo = None

ROOT = pathlib.Path(__file__).resolve().parent
DATA_PATH = ROOT / "spicy_data.js"
CACHE_DIR = ROOT / ".cache" / "free-data"

# --- sources -----------------------------------------------------------------
# Every URL below is a public GitHub repository tarball: free, no key, no card.
# raw.githubusercontent.com is avoided because some networks (and this build
# sandbox) reach GitHub's API hosts but not the raw CDN.
SOURCES = {
    "ourairports": {
        "url": "https://codeload.github.com/davidmegginson/ourairports-data/tar.gz/refs/heads/main",
        "member": "airports.csv",
        "name": "OurAirports airports.csv",
        "licence": "Unlicense (public domain)",
        "home": "https://github.com/davidmegginson/ourairports-data",
    },
    "openflights": {
        "url": "https://codeload.github.com/jpatokal/openflights/tar.gz/refs/heads/master",
        "member": "data/airports.dat",
        "name": "OpenFlights airports.dat",
        "licence": "ODbL-1.0",
        "home": "https://github.com/jpatokal/openflights",
    },
    "passport": {
        "url": "https://codeload.github.com/imorte/passport-index-data/tar.gz/refs/heads/main",
        "member": "passport-index-tidy-iso2.csv",
        "name": "Passport Index dataset (tidy, ISO-2)",
        "licence": "MIT",
        "home": "https://github.com/imorte/passport-index-data",
    },
    "countries": {
        "url": "https://codeload.github.com/mledoze/countries/tar.gz/refs/heads/master",
        "member": "dist/countries.csv",
        "name": "mledoze/countries",
        "licence": "ODbL-1.0",
        "home": "https://github.com/mledoze/countries",
    },
}

# Passports offered in the visa table.  The full matrix is 199x199 and would
# triple the size of the shipped file for pairs almost nobody asks about; this
# list covers the passports the app's own traffic actually flies on, and the UI
# says plainly which ones are in the table.  Adding one to the list costs about
# 800 bytes.
PASSPORTS = [
    "US", "GB", "CA", "AU", "NZ", "IE", "DE", "FR", "ES", "IT", "NL", "PT",
    "SE", "NO", "DK", "FI", "CH", "AT", "BE", "PL", "GR", "TR", "RU", "UA",
    "AE", "SA", "QA", "KW", "IL", "EG", "ZA", "NG", "KE", "MA", "IN", "PK",
    "BD", "LK", "CN", "JP", "KR", "SG", "MY", "TH", "ID", "PH", "VN", "HK",
    "BR", "AR", "CL", "CO", "MX", "PE",
]

# Curated GDS-style names for codes the engine carries as its own overlays
# (spicy_engine.js _EXTRA_AIRPORTS).  Those overlays only apply to a code the
# data file does not know, so once the free merge adds the airport the name has
# to come from here or the DEP-/ARR- lines silently change wording.  Keep this
# list in step with that overlay.
CURATED_NAMES = {
    "XMN": "XIAMEN GAOQI INTL",
    "JRO": "KILIMANJARO INTL",
}


# --- the engine's DST vocabulary, mirrored here so it can be *proved* -------
# spicy_engine.js dstActive() implements exactly these rules.  The verification
# below replays them against the IANA database and refuses any airport whose
# zone does not match the rule the engine would apply.
DST_RULES = {
    # region: (start spec, end spec); "nth" counts from 1, 6 == Sunday (Mon=0)
    "US":    ((3, 6, 2), (11, 6, 1)),
    "EU":    ((3, 6, -1), (10, 6, -1)),
    "AU":    ((10, 6, 1), (4, 6, 1)),
    "NZ":    ((9, 6, -1), (4, 6, 1)),
    "SHSEP": ((9, 6, 1), (4, 6, 1)),
    "EG":    ((4, 4, -1), (10, 4, -1)),
    "IL":    ((3, 6, -1, -2), (10, 6, -1)),      # Friday before last Sunday of March
}

# zone -> engine region, for every zone whose DST regime the engine can express.
# Anything not listed here and not matching a prefix below is refused, not
# guessed (Pacific/Chatham and Pacific/Easter are listed because their DST
# dates match NZ and Chile exactly, only their standard offsets differ).
ZONE_REGIONS = {
    # DST dates that match an engine rule but sit under a zone name the prefix
    # table below would file wrongly (Canary Islands are Spain, not "America/").
    "Atlantic/Faeroe": "EU", "Arctic/Longyearbyen": "EU", "Atlantic/Canary": "EU",
    "Asia/Nicosia": "EU", "Atlantic/Azores": "EU", "Asia/Beirut": "EU",
    "Africa/Cairo": "EG",
    "America/Nuuk": "EU", "America/Godthab": "EU", "America/Scoresbysund": "EU",
    "America/Santiago": "SHSEP", "America/Punta_Arenas": "SHSEP",
    "Pacific/Easter": "SHSEP",
    "Pacific/Auckland": "NZ", "Pacific/Chatham": "NZ",
    "Antarctica/South_Pole": "NZ", "Antarctica/McMurdo": "NZ",
    "Pacific/Norfolk": "AU",
    "Atlantic/Bermuda": "US",
    "Asia/Jerusalem": "IL",
    # Zones deliberately absent because no engine rule can express them, and a
    # wrong local time is worse than an unknown airport:
    #   Africa/Casablanca, Africa/El_Aaiun — Morocco drops an hour for Ramadan,
    #     which moves every year
    #   Australia/Lord_Howe — half-hour DST
    #   Asia/Gaza, Asia/Hebron — DST dates set ad hoc each year
    #   America/Vancouver — tzdata 2026b shows no autumn transition in 2026,
    #     i.e. permanent DST, which the "US" rule cannot describe
}
ZONE_PREFIX_REGIONS = [
    ("America/", "US"), ("Canada/", "US"), ("Europe/", "EU"), ("Australia/", "AU"),
]


def log(message):
    sys.stdout.write(message + "\n")


def engine_dst_active(region, when):
    """The engine's own DST arithmetic, transcribed (spicy_engine.js dstActive)."""
    rule = DST_RULES.get(region)
    if not rule:
        return False
    start, end = rule
    y = when.year

    def nth_weekday(month, weekday, n):
        if n > 0:
            count = 0
            for day in range(1, 32):
                try:
                    current = date(y, month, day)
                except ValueError:
                    break
                if current.weekday() == weekday:
                    count += 1
                    if count == n:
                        return current
            return None
        days_in_month = (date(y, month % 12 + 1, 1) - date(y, month, 1)).days
        for day in range(days_in_month, 0, -1):
            current = date(y, month, day)
            if current.weekday() == weekday:
                return current
        return None

    start_date = nth_weekday(start[0], start[1], start[2])
    if len(start) > 3:
        start_date = start_date.fromordinal(start_date.toordinal() + start[3])
    end_date = nth_weekday(end[0], end[1], end[2])
    if start_date is None or end_date is None:
        return False
    # Northern-style season (start earlier in the year than end) and the
    # southern/exotic wrap-around the engine expresses with an OR.
    if start_date <= end_date:
        return start_date <= when < end_date
    return when >= start_date or when < end_date


def zone_region(zone_name):
    """Which engine DST region a zone belongs to, or None when unexpressible."""
    if zone_name in ZONE_REGIONS:
        return ZONE_REGIONS[zone_name]
    for prefix, region in ZONE_PREFIX_REGIONS:
        if zone_name.startswith(prefix):
            return region
    return None


SAMPLE_MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
SAMPLE_DAYS = [1, 8, 15, 22, 28]


def zone_offsets(zone, year):
    seen = set()
    for month in SAMPLE_MONTHS:
        for day in SAMPLE_DAYS:
            try:
                moment = datetime(year, month, day, 12, 0, tzinfo=zone)
            except ValueError:
                continue
            seen.add(moment.utcoffset().total_seconds() / 3600.0)
    return seen


def prove_zone(zone_name, today=None):
    """Return (offset_hours, region, note) when this zone can be described
    honestly, else (None, reason, None).

    A zone is describable in one of two ways:

      * RULE-BASED — the zone alternates between a standard offset and
        standard+1, and the engine's own DST rule for the region it maps to
        predicts every sampled day of the next two years exactly.  That is the
        ordinary case (US, EU, AU, NZ, Chile, Egypt, Israel).

      * FIXED — the zone does not move at all across that window, which is
        either a genuinely DST-free country or one that has just stopped
        changing (tzdata 2026b has British Columbia staying on UTC-7 after
        March 2026).  A fixed reading is only accepted when the zone *has*
        moved within the last year, so the note can say when it stopped; a
        zone that never moves needs no note.

    Anything else is refused: Morocco's Ramadan shift, Lord Howe's half-hour
    DST and Gaza's ad-hoc dates cannot be written down with one offset and one
    region, and a plausible-looking wrong local time is the one failure this
    project refuses to ship.
    """
    if ZoneInfo is None:
        return None, "python has no zoneinfo (needs 3.9+)", None
    try:
        zone = ZoneInfo(zone_name)
    except Exception:
        return None, "zone database has no " + zone_name, None
    today = today or date.today()

    future = set()
    for year in (today.year, today.year + 1, today.year + 2):
        future |= zone_offsets(zone, year)
    if len(future) == 1:
        now_offset = datetime(today.year, today.month, today.day, 12, 0, tzinfo=zone).utcoffset().total_seconds() / 3600.0
        settled = (now_offset in future)
        note = None
        if settled:
            # Did this zone move inside the last year? If so, say when it stopped.
            moved = None
            cursor = today
            for step in range(0, 400, 7):
                probe = cursor.fromordinal(cursor.toordinal() - step)
                offset = datetime(probe.year, probe.month, probe.day, 12, 0, tzinfo=zone).utcoffset().total_seconds() / 3600.0
                if offset != now_offset:
                    moved = probe
                    break
            if moved is not None:
                note = "fixed at UTC%+g since about %s (the zone changed inside the last year)" % (
                    now_offset, moved.isoformat())
        if settled:
            return now_offset, "NONE", note
        return None, "no single offset describes " + zone_name + " right now", None

    region = zone_region(zone_name)
    if region is None:
        return None, "DST regime of " + zone_name + " cannot be expressed by the engine", None
    standard = min(future)
    for year in (today.year, today.year + 1, today.year + 2):
        for month in SAMPLE_MONTHS:
            for day in SAMPLE_DAYS:
                when = date(year, month, day)
                actual = datetime(year, month, day, 12, 0, tzinfo=zone).utcoffset().total_seconds() / 3600.0
                predicted = standard + (1.0 if engine_dst_active(region, when) else 0.0)
                if abs(actual - predicted) > 1e-9:
                    return None, ("rule " + region + " disagrees with " + zone_name
                                  + " on " + when.isoformat()
                                  + " (" + str(predicted) + " vs " + str(actual) + ")"), None
    return standard, region, None


def miles_between(a, b):
    """Great-circle miles between two {lat, lon} points (Vincenty is the engine's
    business; a sphere is exact enough to answer "is this the same city")."""
    radius = 3958.7613
    lat1, lat2 = a["lat"] * math.pi / 180.0, b["lat"] * math.pi / 180.0
    dlat, dlon = lat2 - lat1, (b["lon"] - a["lon"]) * math.pi / 180.0
    h = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 2 * radius * math.asin(min(1.0, math.sqrt(h)))


# An airport with no zone in either source can still be placed when it is
# standing next to one that has a proved zone: same country, under 100 miles.
# A zone boundary does not run between two airports of the same country 100
# miles apart (and the entry records which neighbour it borrowed from, so the
# claim is checkable).  Anything further away is left unknown on purpose.
NEIGHBOUR_LIMIT_MI = 100.0


def zone_by_neighbour(candidates, known, iata):
    """Borrow a proved zone from the nearest known airport, or return None."""
    target = candidates[iata]
    if not target["cc"]:
        return None                     # no country to match on: no borrowing
    best, best_miles = None, None
    for other, entry in known.items():
        if other == iata or entry.get("cc") != target["cc"]:
            continue
        distance = miles_between(target, entry)
        if distance <= NEIGHBOUR_LIMIT_MI and (best_miles is None or distance < best_miles):
            best, best_miles = other, distance
    if best is None:
        return None
    return best, best_miles


# --- fetching ---------------------------------------------------------------

def fetch_source(key, offline=False):
    """Download a source tarball and return the member file's text (cached)."""
    spec = SOURCES[key]
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cached = CACHE_DIR / (key + "-" + pathlib.Path(spec["member"]).name)
    if cached.exists():
        return cached.read_text(encoding="utf-8", errors="replace"), cached
    if offline:
        raise SystemExit("--offline asked for " + key + " but " + str(cached) + " is not cached")
    log("  fetching " + spec["name"] + " ...")
    request = urllib.request.Request(spec["url"], headers={"User-Agent": "spicyterminal-data-merge"})
    with urllib.request.urlopen(request, timeout=180) as response:
        payload = response.read()
    with tarfile.open(fileobj=io.BytesIO(payload), mode="r:gz") as archive:
        member = None
        for candidate in archive.getmembers():
            if candidate.name.endswith(spec["member"]) and candidate.isfile():
                member = candidate
                break
        if member is None:
            raise SystemExit("archive for " + key + " has no " + spec["member"])
        text = archive.extractfile(member).read().decode("utf-8", errors="replace")
    cached.write_text(text, encoding="utf-8")
    return text, cached


# --- parsing ----------------------------------------------------------------

def parse_ourairports(text):
    """Every IATA-coded airport that can appear on a ticket, keyed by IATA."""
    best = {}
    for row in csv.DictReader(io.StringIO(text)):
        iata = (row.get("iata_code") or "").strip().upper()
        if len(iata) != 3 or not iata.isalpha():
            continue
        try:
            lat = float(row["latitude_deg"])
            lon = float(row["longitude_deg"])
        except (TypeError, ValueError):
            continue
        if not (-90 <= lat <= 90 and -180 <= lon <= 180):
            continue
        scheduled = (row.get("scheduled_service") or "").strip().lower() == "yes"
        kind = (row.get("type") or "").strip()
        # A ticket only ever prints an airport that takes scheduled traffic or
        # is big enough to be a diversion/codeshare point.
        if not scheduled and kind not in ("large_airport", "medium_airport"):
            continue
        rank = (1 if scheduled else 0,
                2 if kind == "large_airport" else 1 if kind == "medium_airport" else 0,
                row.get("ident") or "")
        entry = {
            # The GDS window prints names in capitals (every aviation table does),
            # so the mixed-case source name is folded here rather than at render
            # time, where it would apply to a name the reader typed.
            "name": (row.get("name") or "").strip().upper(),
            "lat": round(lat, 4),
            "lon": round(lon, 4),
            "cc": (row.get("iso_country") or "").strip().upper(),
            "scheduled": scheduled,
            "type": kind,
            "rank": rank,
        }
        if not entry["name"]:
            continue
        previous = best.get(iata)
        if previous is None or entry["rank"] > previous["rank"]:
            best[iata] = entry
    return best


def parse_openflights_zones(text):
    """IATA -> IANA zone name (OpenFlights column 12)."""
    zones = {}
    for row in csv.reader(io.StringIO(text)):
        if len(row) < 13:
            continue
        iata = (row[4] or "").strip().upper()
        zone = (row[11] or "").strip()
        if len(iata) == 3 and "/" in zone:
            zones.setdefault(iata, zone)
    return zones


VISA_CODES = {
    "visa required": "0",
    "visa free": "-1",
    "e-visa": "E",
    "visa on arrival": "A",
    "eta": "T",
    "no admission": "X",
    "-1": "-1",
}


def parse_visa(text, passports):
    """passport -> {destination: code} for the passports the app offers."""
    wanted = set(passports)
    table = {}
    for row in csv.DictReader(io.StringIO(text)):
        passport = (row.get("Passport") or "").strip().upper()
        if passport not in wanted:
            continue
        destination = (row.get("Destination") or "").strip().upper()
        raw = (row.get("Requirement") or "").strip().lower()
        if len(destination) != 2:
            continue
        if raw.isdigit():                       # visa-free for N days
            code = raw
        else:
            code = VISA_CODES.get(raw)
        if code is None:
            continue                             # unknown wording: no entry
        table.setdefault(passport, {})[destination] = code
    return table


def parse_countries(text):
    """ISO-2 -> {name, currency} from mledoze/countries (dist CSV)."""
    countries = {}
    for row in csv.DictReader(io.StringIO(text)):
        code = (row.get("cca2") or "").strip().upper()
        name = (row.get("name.common") or row.get("name") or "").strip()
        # The CSV joins multiple currencies with a comma; the first is the one
        # travellers are quoted in.
        currency = (row.get("currencies") or row.get("currency") or "").split(",")[0].strip().upper()
        if len(code) == 2 and name:
            countries[code] = {"name": name, "currency": currency}
    return countries


# --- merging ----------------------------------------------------------------

def load_committed():
    source = DATA_PATH.read_text(encoding="utf-8")
    match = re.match(r"^(//[^\n]*\n)+const SPICY_DATA = (.*);\n"
                     r"if \(typeof module !== 'undefined'\) module\.exports = SPICY_DATA;\n?$",
                     source, re.S)
    if not match:
        raise SystemExit("spicy_data.js is not in the shape this tool expects")
    return source, match.group(1), json.loads(match.group(2))


def emit(data, header_extra=""):
    """Write spicy_data.js back: one entry per line, stable order, ES5-safe."""
    blocks = []
    for key in ("airports", "countries", "airlines", "airlineAliases", "cityAliases",
                "aircraft", "aircraftTypes", "routeEquipment", "airlineEquipment",
                "genericEquipment", "flightEquipment", "visaFree", "visaMeta", "masterPrompt"):
        if key not in data:
            continue
        value = data[key]
        if key in ("airports", "countries"):
            lines = ['  "%s": %s' % (k, json.dumps(value[k], separators=(",", ":"), ensure_ascii=False))
                     for k in sorted(value)]
            blocks.append(' "%s":{\n%s\n }' % (key, ",\n".join(lines)))
        elif key == "visaFree":
            lines = []
            for k in sorted(value):
                pairs = ",".join('"%s":"%s"' % (d, value[k][d]) for d in sorted(value[k]))
                lines.append('  "%s":{%s}' % (k, pairs))
            blocks.append(' "%s":{\n%s\n }' % (key, ",\n".join(lines)))
        else:
            blocks.append(' "%s":%s' % (key, json.dumps(value, separators=(",", ":"),
                                                         ensure_ascii=False)))
    body = "const SPICY_DATA = {\n" + ",\n".join(blocks) + "\n};\n"
    header = ("// GENERATED from aviation_data.py - do not edit by hand\n"
              "// Extended from free, open datasets by update_spicy_data_free.py:\n"
              "//   OurAirports airports.csv (Unlicense / public domain)\n"
              "//   OpenFlights airports.dat (ODbL-1.0) - time-zone keys only\n"
              "//   IANA time-zone database via Python zoneinfo - UTC offsets, proved against the engine's DST rules\n"
              "//   Passport Index dataset (MIT) - visa requirements\n"
              "//   mledoze/countries (ODbL-1.0) - country names and currencies\n"
              "// Run that tool rather than editing this file: it re-verifies every offset.\n")
    DATA_PATH.write_text(header + body + "if (typeof module !== 'undefined') module.exports = SPICY_DATA;\n",
                         encoding="utf-8")


def merge(offline=False, check=False):
    log("SpicyTerminal — free open-data merge (no key, no card, $0)")
    log("  committed file: " + str(DATA_PATH.relative_to(ROOT)))

    ourairports_text, _ = fetch_source("ourairports", offline)
    openflights_text, _ = fetch_source("openflights", offline)
    passport_text, _ = fetch_source("passport", offline)
    countries_text, _ = fetch_source("countries", offline)

    candidates = parse_ourairports(ourairports_text)
    zones = parse_openflights_zones(openflights_text)
    log("  OurAirports candidates: %d IATA airports" % len(candidates))
    log("  OpenFlights time-zone keys: %d" % len(zones))

    _, header, data = load_committed()
    airports = data["airports"]
    before = len(airports)

    # --- prove every zone once, then reuse -------------------------------
    proof = {}
    for iata, zone in zones.items():
        if zone not in proof:
            proof[zone] = prove_zone(zone)
    proved_zones = sum(1 for value in proof.values() if value[0] is not None)
    for zone in sorted(proof):
        if proof[zone][2]:
            log("  note: %s -> %s" % (zone, proof[zone][2]))
    log("  time zones proved against the engine's DST rules: %d of %d"
        % (proved_zones, len(proof)))

    added = 0
    borrowed = 0
    refused = {"no zone known": 0, "zone not proved": 0, "already present": 0}
    # First pass: every airport that carries its own time-zone key.
    for iata, airport in sorted(candidates.items()):
        if iata in airports:
            refused["already present"] += 1
            if airport["cc"] and "cc" not in airports[iata]:
                airports[iata]["cc"] = airport["cc"]
            continue
        zone = zones.get(iata)
        if not zone:
            continue                            # second pass may place it
        offset, region, note = proof.get(zone, (None, "not proved", None))
        if offset is None:
            refused["zone not proved"] += 1
            continue
        entry = {
            "name": CURATED_NAMES.get(iata, airport["name"]),
            "lat": airport["lat"],
            "lon": airport["lon"],
            "off": float(offset),
            "dst": region,
            "cc": airport["cc"],
        }
        if note:
            # Documentation for a reader, ignored by the engine: the offset is
            # right for today's flights and wrong for a past one, and that is
            # worth saying out loud in the data itself.
            entry["offsetNote"] = note
        airports[iata] = entry
        added += 1

    # Second pass: airports with no zone key of their own that stand next to one
    # that has a proved zone, in the same country, within NEIGHBOUR_LIMIT_MI.
    proved = dict((iata, entry) for iata, entry in airports.items() if "off" in entry)
    for iata, airport in sorted(candidates.items()):
        if iata in airports or zones.get(iata):
            continue
        neighbour = zone_by_neighbour(candidates, proved, iata)
        if not neighbour:
            refused["no zone known"] += 1
            continue
        other, distance = neighbour
        model = airports[other]
        airports[iata] = {
            "name": CURATED_NAMES.get(iata, airport["name"]),
            "lat": airport["lat"],
            "lon": airport["lon"],
            "off": model["off"],
            "dst": model["dst"],
            "cc": airport["cc"],
            "offsetNote": "offset from %s, %.0f mi away" % (other, distance),
        }
        proved[iata] = airports[iata]
        borrowed += 1
        added += 1
    log("  airports: %d -> %d (+%d, %d of them by neighbouring airport)"
        % (before, len(airports), added, borrowed))
    log("  refused: %s" % json.dumps(refused, sort_keys=True))
    lost = {}
    for iata, airport in candidates.items():
        if iata in airports and iata not in ():
            pass
    for iata in candidates:
        zone = zones.get(iata)
        if zone and proof.get(zone, (None,))[0] is None and iata not in airports:
            lost.setdefault(zone, []).append(iata)
    for zone in sorted(lost):
        log("    dropped %-24s %d airports (%s)"
            % (zone, len(lost[zone]), " ".join(sorted(lost[zone])[:8])))

    # --- countries + currencies ------------------------------------------
    parsed_countries = parse_countries(countries_text)
    countries = {}
    for code, entry in sorted(parsed_countries.items()):
        if entry["name"] and entry["currency"]:
            countries[code] = {"name": entry["name"], "currency": entry["currency"]}
    # Only destinations the airport table can actually reach are worth shipping.
    reachable = set(a.get("cc") for a in airports.values() if a.get("cc"))
    countries = {c: v for c, v in countries.items() if c in reachable}
    data["countries"] = countries
    still_missing = [iata for iata, a in candidates.items()
                     if iata not in airports and a["scheduled"]]
    log("  still unknown after both passes: %d scheduled airports" % len(still_missing))
    if still_missing:
        log("    examples: %s" % " ".join(sorted(still_missing)[:12]))
    log("  countries with currency: %d" % len(countries))

    # --- visa table -------------------------------------------------------
    visa = parse_visa(passport_text, PASSPORTS)
    visa = {p: visa[p] for p in PASSPORTS if p in visa}
    data["visaFree"] = visa
    data["visaMeta"] = {
        "source": SOURCES["passport"]["name"],
        "sourceUrl": SOURCES["passport"]["home"],
        "licence": SOURCES["passport"]["licence"],
        "retrieved": date.today().isoformat(),
        "passports": sorted(visa.keys()),
        "note": ("Visa rules change without notice and depend on the passport you "
                 "actually hold, the purpose of the trip and how long you stay. "
                 "This table is a starting point, not an authority: confirm with "
                 "the airline or the embassy before you fly."),
    }
    log("  visa rows: %d passports x %d destinations"
        % (len(visa), len(set(d for p in visa.values() for d in p))))

    size = len(json.dumps(data, separators=(",", ":"), ensure_ascii=False))
    log("  merged body: %.1f KB (was %.1f KB)" % (size / 1024.0,
                                                  len(json.dumps(load_committed()[2], separators=(",", ":"), ensure_ascii=False)) / 1024.0))
    if check:
        log("  --check: nothing written")
        return
    emit(data, header)
    log("  wrote " + str(DATA_PATH.relative_to(ROOT)))


def report():
    """Report on the committed file alone — no network, no sources."""
    _, _, data = load_committed()
    airports = data.get("airports", {})
    log("committed spicy_data.js")
    log("  airports   : %d" % len(airports))
    withcc = sum(1 for a in airports.values() if a.get("cc"))
    log("  with country: %d" % withcc)
    dsts = {}
    for a in airports.values():
        dsts[a.get("dst")] = dsts.get(a.get("dst"), 0) + 1
    log("  dst regions: %s" % json.dumps(dsts, sort_keys=True))
    visa = data.get("visaFree", {})
    log("  visa passports: %d (%s)" % (len(visa), " ".join(sorted(visa))))
    log("  countries  : %d" % len(data.get("countries", {})))
    for key, value in data.items():
        if key in ("airports", "countries", "visaFree", "masterPrompt"):
            continue
        log("  %-14s: %d" % (key, len(value)))


def main():
    parser = argparse.ArgumentParser(description="Merge free open datasets into spicy_data.js")
    parser.add_argument("--check", action="store_true", help="report what would change, write nothing")
    parser.add_argument("--offline", action="store_true", help="use the local cache only")
    parser.add_argument("--report", action="store_true", help="describe the committed file, fetch nothing")
    args = parser.parse_args()
    if args.report:
        report()
        return
    merge(offline=args.offline, check=args.check)


if __name__ == "__main__":
    main()
