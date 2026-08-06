#!/usr/bin/env python3
"""
validate.py — repo consistency checks for MAINTAINERS, not learners.

    python3 scripts/maintainers/validate.py

Exits non-zero if anything is wrong, so it can gate a PR. Python 3 standard
library only, same constraint as bin/serve.

Every check here exists because something actually broke. See
docs/maintainers/build-log.md.
"""
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
MAIN_SAGAS = 5
MAIN_ARC_TOTAL = 9000

fails: list[str] = []
warns: list[str] = []


def fail(check: str, msg: str) -> None:
    fails.append(f"{check}: {msg}")


def warn(check: str, msg: str) -> None:
    warns.append(f"{check}: {msg}")


def manifest_rows():
    out = []
    for line in (ROOT / "capsules" / "MANIFEST").read_text().split("\n"):
        if not line.strip() or line.startswith("#"):
            continue
        parts = line.split("\t")
        if len(parts) != 4:
            fail("manifest", f"expected 4 tab-separated columns, got {len(parts)}: {line!r}")
            continue
        cid, saga, points, title = parts
        out.append((cid, int(saga), int(points), title))
    return out


def capsule_dir(cid: str) -> pathlib.Path | None:
    for base in (ROOT / "capsules", ROOT / "capsules" / "bonus"):
        for d in base.iterdir() if base.exists() else []:
            if d.is_dir() and d.name.split("-")[0] == cid:
                return d
    return None


# --- 1. MANIFEST is internally consistent, and matches what's on disk --------
rows = manifest_rows()
ids = [r[0] for r in rows]

if len(ids) != len(set(ids)):
    dupes = {i for i in ids if ids.count(i) > 1}
    fail("manifest", f"duplicate capsule ids: {sorted(dupes)}")

es_ids = []
for line in (ROOT / "capsules" / "MANIFEST.es").read_text().split("\n"):
    if line.strip() and not line.startswith("#"):
        es_ids.append(line.split("\t")[0])
if ids != es_ids:
    only_en, only_es = set(ids) - set(es_ids), set(es_ids) - set(ids)
    fail("manifest.es", f"ids differ from MANIFEST — only EN: {sorted(only_en)}, only ES: {sorted(only_es)}")

for cid, saga, points, title in rows:
    d = capsule_dir(cid)
    if d is None:
        fail("manifest", f"{cid} is in MANIFEST but has no directory")
        continue
    if not (d / "README.md").exists():
        fail("capsule", f"{d.relative_to(ROOT)} has no README.md")
    es = ROOT / "es" / d.relative_to(ROOT) / "README.md"
    if not es.exists():
        fail("translation", f"{cid} has no Spanish mirror at {es.relative_to(ROOT)}")
    is_bonus_dir = "bonus" in d.parts
    if is_bonus_dir != (saga > MAIN_SAGAS):
        fail("manifest", f"{cid} saga={saga} disagrees with its directory ({d.relative_to(ROOT)})")

# every capsule directory is in the MANIFEST
for base in (ROOT / "capsules", ROOT / "capsules" / "bonus"):
    for d in sorted(base.iterdir()) if base.exists() else []:
        if not d.is_dir() or d.name == "bonus":
            continue
        if d.name.split("-")[0] not in ids:
            fail("manifest", f"{d.relative_to(ROOT)} exists but is not in MANIFEST")

# --- 2. Power arithmetic ----------------------------------------------------
main_total = sum(p for _, s, p, _ in rows if s <= MAIN_SAGAS)
if main_total != MAIN_ARC_TOTAL:
    fail("power", f"main arc totals {main_total}, must be exactly {MAIN_ARC_TOTAL} "
                  f"(the README promises 'over 9000' only via bonus capsules)")

# --- 3. EN/ES structural parity ---------------------------------------------
FENCE = re.compile(r"^```", re.M)
for cid, *_ in rows:
    d = capsule_dir(cid)
    if d is None:
        continue
    en = d / "README.md"
    es = ROOT / "es" / d.relative_to(ROOT) / "README.md"
    if not (en.exists() and es.exists()):
        continue
    a, b = len(FENCE.findall(en.read_text())), len(FENCE.findall(es.read_text()))
    if a != b:
        fail("translation", f"{cid}: {a} code fences in EN, {b} in ES — code blocks must be identical")

# --- 4. No prose leaked into a code block, no unclosed fences ----------------
# Languages where a markdown blockquote/heading/table is unambiguously a bug.
# `bash` is deliberately excluded: heredocs and `> file` redirects give false
# positives. `markdown` is excluded because those blocks contain markdown.
CODE_LANGS = {"go", "javascript", "js", "sql", "yaml", "yml", "hcl", "makefile",
              "gitignore", "json", "dockerfile", "nginx", "ini", "java",
              "promql", "http", "powershell"}
for md in sorted(ROOT.glob("**/README.md")):
    if ".git" in md.parts:
        continue
    infence, lang, body, opened = False, None, [], 0
    for line in md.read_text().split("\n"):
        if line.startswith("```"):
            if not infence:
                infence, lang, body, opened = True, line[3:].strip(), [], opened + 1
            else:
                infence = False
                if lang in CODE_LANGS:
                    text = "\n".join(body)
                    for pat, why in ((r"^> ", "blockquote"), (r"^### ", "heading"),
                                     (r"^\|\s.*\|\s*$", "markdown table")):
                        m = re.search(pat, text, re.M)
                        if m:
                            fail("structure", f"{md.relative_to(ROOT)}: {why} inside a {lang} block "
                                              f"— {text[m.start():m.start()+50]!r}")
                            break
            continue
        if infence:
            body.append(line)
    if infence:
        fail("structure", f"{md.relative_to(ROOT)}: unclosed code fence")

# --- 5. Internal links resolve (ignoring anything inside code) --------------
LINK = re.compile(r"\[[^\]]*\]\((?!https?:|#|mailto:)([^)#]+)(?:#[^)]*)?\)")
for md in sorted(ROOT.glob("**/*.md")):
    if ".git" in md.parts:
        continue
    stripped, infence = [], False
    for line in md.read_text().split("\n"):
        if line.startswith("```"):
            infence = not infence
            stripped.append("")
            continue
        stripped.append("" if infence else line)
    for target in LINK.findall("\n".join(stripped)):
        t = target.strip()
        if not t:
            continue
        if not (md.parent / t).resolve().exists():
            fail("links", f"{md.relative_to(ROOT)} -> {t}")

# --- 6. Surfaces that must list every capsule -------------------------------
def row_ids(path: pathlib.Path, pattern: str):
    if not path.exists():
        return None
    return set(re.findall(pattern, path.read_text(), re.M))

bonus_ids = {c for c, s, _, _ in rows if s > MAIN_SAGAS}
for path, pat, label in (
    (ROOT / "README.md", r"^\| (B\d+) \|", "README bonus table"),
    (ROOT / "es" / "README.md", r"^\| (B\d+) \|", "es/README bonus table"),
    (ROOT / "docs" / "saga-map.md", r"^\| (B\d+) \|", "saga-map bonus rows"),
    (ROOT / "es" / "docs" / "saga-map.md", r"^\| (B\d+) \|", "es saga-map bonus rows"),
):
    got = row_ids(path, pat)
    if got is None:
        fail("surfaces", f"{label}: file missing")
    elif got != bonus_ids:
        fail("surfaces", f"{label} lists {sorted(got)}, MANIFEST has {sorted(bonus_ids)}")

# --- 7. bin/scouter's hardcoded ranges still match reality ------------------
scouter = (ROOT / "bin" / "scouter").read_text()
main_ids = sorted(c for c, s, _, _ in rows if s <= MAIN_SAGAS)
top_bonus = max(bonus_ids, key=lambda x: int(x[1:])) if bonus_ids else None
expect = f"main arc {main_ids[0]}-{main_ids[-1]}, Filler Arc B1-{top_bonus}"
if expect not in scouter:
    fail("scouter", f"the 'does not exist' message is stale — expected to contain {expect!r}")
if top_bonus and f"b1 … {top_bonus}" not in scouter:
    fail("scouter", f"usage text is stale — expected 'b1 … {top_bonus}'")

# --- 8. Time estimates present ---------------------------------------------
for cid, *_ in rows:
    d = capsule_dir(cid)
    if d and not re.search(r"\|\s*\d+\s*(?:[–-]\s*\d+\s*)?(min|h\b|hours|horas)", d.joinpath("README.md").read_text()):
        warn("meta", f"{cid} has no time estimate in its header table")

# --- report -----------------------------------------------------------------
print(f"  capsules: {len(rows)}  ({len(bonus_ids)} bonus)   main arc power: {main_total}")
for w in warns:
    print(f"  warn  {w}")
if fails:
    print(f"\n  {len(fails)} FAILURE(S):")
    for f in fails:
        print(f"    {f}")
    sys.exit(1)
print("  ✅ all checks passed")
