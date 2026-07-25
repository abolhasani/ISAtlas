"""Create compact browser bundles from the Atlas collection JSON files.

Run this after completing a new collection or quarterly refresh:
    py -3 build_atlas_index.py
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
JOURNALS = {
    "mis_quarterly": "mis_quarterly_papers.json",
    "information_systems_research": "information_systems_research_papers.json",
    "journal_of_management_information_systems": "journal_of_management_information_systems_papers.json",
}


def names(items, field="name"):
    return [{"name": item.get(field)} for item in (items or []) if isinstance(item, dict) and item.get(field)]


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
        "authors": names(work.get("authors")), "institutions": names(work.get("institutions")),
        "primary_topic": {"name": primary.get("name")}, "topics": topics,
        "keywords": names(work.get("keywords"), "display_name"),
        "sustainable_development_goals": names(work.get("sustainable_development_goals"), "display_name"),
        "referenced_work_ids": work.get("referenced_work_ids") or [], "citing_work_ids": work.get("citing_work_ids") or [],
    }


def main():
    records, latest = [], []
    for journal, filename in JOURNALS.items():
        path = ROOT / filename
        if not path.exists():
            continue
        with path.open(encoding="utf-8") as handle:
            payload = json.load(handle)
        records.extend(compact_work(work, journal) for work in (payload.get("works") or {}).values())
        if payload.get("updated_at"):
            latest.append(payload["updated_at"])
    external_path = ROOT / "atlas_external_papers.json"
    with external_path.open(encoding="utf-8") as handle:
        external_payload = json.load(handle)
    external = []
    for work in (external_payload.get("works") or {}).values():
        external.append({"id": work.get("id"), "_journal": "external", "title": work.get("title"), "doi": work.get("doi"), "publication_year": work.get("publication_year"), "link_to_paper": work.get("link_to_paper")})
    latest.extend([value for value in [external_payload.get("updated_at")] if value])
    state_path = ROOT / "atlas_state.json"
    if state_path.exists():
        with state_path.open(encoding="utf-8") as handle:
            state = json.load(handle)
        latest.extend([value for value in [state.get("last_successful_quarterly_refresh"), state.get("updated_at")] if value])
    metadata = {"lastUpdated": max(latest) if latest else None, "generatedAt": datetime.now(timezone.utc).isoformat(), "recordCount": len(records), "externalCount": len(external)}
    (ROOT / "atlas_metadata.js").write_text("window.ATLAS_METADATA=" + json.dumps(metadata, ensure_ascii=False, separators=(",", ":")) + ";\n", encoding="utf-8")
    # Keep the initial bundle focused on focal papers; the larger external index is loaded only after a paper is opened.
    (ROOT / "atlas_external_index.js").write_text("window.ATLAS_EXTERNAL_INDEX=" + json.dumps(external, ensure_ascii=False, separators=(",", ":")) + ";\n", encoding="utf-8")
    bundle = {"metadata": metadata, "records": records}
    (ROOT / "atlas_index.js").write_text("window.ATLAS_DATA=" + json.dumps(bundle, ensure_ascii=False, separators=(",", ":")) + ";\n", encoding="utf-8")
    print(f"Wrote browser data index: {len(records):,} focal and {len(external):,} external records.")


if __name__ == "__main__":
    main()
