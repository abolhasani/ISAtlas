"""Create GitHub Pages-friendly browser bundles from the Atlas collection.

Run after a complete collection or quarterly refresh:
    py -3 build_atlas_index.py

Focal records ship in the initial bundle. External records are split into
small on-demand buckets so opening the graph does not download the entire
citation neighborhood universe.
"""
from __future__ import annotations

import json
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
BUCKET_COUNT = 256
JOURNALS = {
    "mis_quarterly": "mis_quarterly_papers.json",
    "information_systems_research": "information_systems_research_papers.json",
    "journal_of_management_information_systems": "journal_of_management_information_systems_papers.json",
}


def label(item, *keys):
    if isinstance(item, str):
        return item
    if not isinstance(item, dict):
        return None
    for key in keys:
        if item.get(key):
            return item[key]
    return None


def names(items, *keys):
    return [{"name": value} for item in (items or []) if (value := label(item, *keys))]


def bucket_for(work_id):
    digits = "".join(character for character in str(work_id or "") if character.isdigit())
    return int(digits) % BUCKET_COUNT if digits else 0


def compact_work(work, journal):
    topics = []
    for topic in work.get("topics") or []:
        if not isinstance(topic, dict):
            continue
        topics.append({
            "name": topic.get("name"),
            "score": topic.get("score"),
            "subfield": {"name": (topic.get("subfield") or {}).get("name")},
            "field": {"name": (topic.get("field") or {}).get("name")},
            "domain": {"name": (topic.get("domain") or {}).get("name")},
        })
    primary = work.get("primary_topic") or {}
    return {
        "id": work.get("id"), "_journal": journal, "title": work.get("title"), "doi": work.get("doi"),
        "publication_date": work.get("publication_date"), "publication_year": work.get("publication_year"),
        "type": work.get("type"), "language": work.get("language"), "cited_by_count": work.get("cited_by_count"),
        "fwci": work.get("fwci"), "link_to_paper": work.get("link_to_paper"), "abstract": work.get("abstract"),
        "has_abstract": work.get("has_abstract"), "open_access": work.get("open_access") or {},
        "authors": names(work.get("authors"), "name", "display_name"),
        "institutions": names(work.get("institutions"), "name", "display_name"),
        "primary_topic": {"name": primary.get("name")}, "topics": topics,
        "keywords": names(work.get("keywords"), "display_name", "name", "keyword"),
        "sustainable_development_goals": names(work.get("sustainable_development_goals"), "display_name", "name"),
        "referenced_work_ids": work.get("referenced_work_ids") or [],
        "citing_work_ids": work.get("citing_work_ids") or [],
    }


def write_js(path, variable, payload):
    path.write_text(f"window.{variable}=" + json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + ";\n", encoding="utf-8")


def main():
    records, latest, journal_summary = [], [], {}
    for journal, filename in JOURNALS.items():
        with (ROOT / filename).open(encoding="utf-8") as handle:
            payload = json.load(handle)
        works = [compact_work(work, journal) for work in (payload.get("works") or {}).values()]
        records.extend(works)
        # Use the same year bounds as the graph and search controls; OpenAlex
        # occasionally contains placeholder dates such as 1800.
        years = [work["publication_year"] for work in works if isinstance(work.get("publication_year"), int) and 1900 <= work["publication_year"] <= 2100]
        journal_summary[journal] = {"recordCount": len(works), "firstYear": min(years) if years else None, "lastYear": max(years) if years else None}
        if payload.get("updated_at"):
            latest.append(payload["updated_at"])

    with (ROOT / "atlas_external_papers.json").open(encoding="utf-8") as handle:
        external_payload = json.load(handle)
    buckets = defaultdict(list)
    for work in (external_payload.get("works") or {}).values():
        record = {"id": work.get("id"), "_journal": "external", "title": work.get("title"), "doi": work.get("doi"), "publication_year": work.get("publication_year"), "journal": work.get("journal"), "link_to_paper": work.get("link_to_paper")}
        if record["id"]:
            buckets[bucket_for(record["id"])].append(record)
    latest.extend(value for value in [external_payload.get("updated_at")] if value)

    state_path = ROOT / "atlas_state.json"
    if state_path.exists():
        with state_path.open(encoding="utf-8") as handle:
            state = json.load(handle)
        latest.extend(value for value in [state.get("last_successful_quarterly_refresh"), state.get("updated_at")] if value)

    metadata = {
        "lastUpdated": max(latest) if latest else None,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "recordCount": len(records),
        "externalCount": sum(len(bucket) for bucket in buckets.values()),
        "externalBucketCount": BUCKET_COUNT,
        "journals": journal_summary,
    }
    write_js(ROOT / "atlas_metadata.js", "ATLAS_METADATA", metadata)
    write_js(ROOT / "atlas_index.js", "ATLAS_DATA", {"metadata": metadata, "records": records})

    for index in range(BUCKET_COUNT):
        write_js(ROOT / f"atlas_external_{index:02d}.js", f"ATLAS_EXTERNAL_{index:02d}", buckets[index])
    print(f"Wrote browser data: {len(records):,} focal records and {metadata['externalCount']:,} external records in {BUCKET_COUNT} on-demand buckets.")


if __name__ == "__main__":
    main()
