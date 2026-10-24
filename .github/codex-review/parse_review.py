#!/usr/bin/env python3
"""把 Codex 审核输出收成一个 JSON 对象。

Codex 有时会在结果前后多写一段，json.load 会报 Extra data。
这里取最后一个带 merge_recommendation 的完整对象。
解析失败只报告字节数、行数、JSON 对象个数和缺少的字段，不回显原文。
"""

from __future__ import annotations

import json
import sys

NEEDED = {"merge_recommendation", "risk_level", "security_concerns", "key_issues_to_review"}
VERDICT_FIELD = "merge_recommendation"
ISSUE_KEYS = {"relevant_file", "issue_header", "issue_content"}


class ReviewParseError(Exception):
    pass


def iter_json_values(text: str):
    decoder = json.JSONDecoder()
    index = 0
    length = len(text)
    while index < length:
        while index < length and text[index] not in "{[":
            index += 1
        if index >= length:
            break
        try:
            value, end = decoder.raw_decode(text, index)
        except json.JSONDecodeError:
            index += 1
            continue
        yield value
        index = max(end, index + 1)


def consider(value, found: list) -> None:
    """记录带结论字段的对象。对象本身已有该字段时不再往下钻。"""
    if isinstance(value, dict):
        if VERDICT_FIELD in value:
            found.append(value)
            return
        for child in value.values():
            consider(child, found)
    elif isinstance(value, list):
        for child in value:
            consider(child, found)


def _line_count(raw: str) -> int:
    if raw == "":
        return 0
    return raw.count("\n") + (0 if raw.endswith("\n") else 1)


def _json_object_count(text: str) -> int:
    count = 0
    for value in iter_json_values(text):
        if isinstance(value, dict):
            count += 1
        elif isinstance(value, list):
            count += sum(isinstance(item, dict) for item in value)
    return count


def _fail(raw: str, missing: str, invalid: str = "") -> None:
    """只带安全元数据。调用方不得把原文写进日志、摘要或评论。"""
    text = raw.lstrip("\ufeff")
    detail = f"；非法字段={invalid}" if invalid else ""
    raise ReviewParseError(
        "审核结果无法解析。"
        f"字节数={len(raw.encode('utf-8'))}；"
        f"行数={_line_count(raw)}；"
        f"JSON对象数={_json_object_count(text)}；"
        f"缺少字段={missing}"
        f"{detail}"
    )


def select_review(raw: str) -> dict:
    found: list = []
    for value in iter_json_values(raw.lstrip("\ufeff")):
        consider(value, found)
    if not found:
        _fail(raw, VERDICT_FIELD)
    data = found[-1]
    if not isinstance(data, dict):
        _fail(raw, VERDICT_FIELD)
    missing = sorted(NEEDED - set(data))
    if missing or set(data) != NEEDED:
        _fail(raw, ",".join(missing) if missing else "无", "" if missing else "多余字段")
    if data["merge_recommendation"] not in {"safe_to_merge", "merge_with_caution", "changes_required"}:
        _fail(raw, "无", "merge_recommendation")
    if data["risk_level"] not in {"low", "medium", "high"}:
        _fail(raw, "无", "risk_level")
    if not isinstance(data["security_concerns"], str):
        _fail(raw, "无", "security_concerns")
    issues = data["key_issues_to_review"]
    if not isinstance(issues, list) or len(issues) > 3 or any(
        not isinstance(issue, dict) or set(issue) != ISSUE_KEYS or any(not isinstance(value, str) for value in issue.values())
        for issue in issues
    ):
        _fail(raw, "无", "key_issues_to_review")
    return data


def load_review(path: str) -> dict:
    try:
        with open(path, encoding="utf-8") as handle:
            raw = handle.read()
    except OSError as exc:
        raise ReviewParseError(f"无法读取审核产物（{exc.strerror or 'read error'}）") from exc
    return select_review(raw)


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print("用法: parse_review.py <review.json>", file=sys.stderr)
        return 1
    try:
        data = load_review(argv[1])
    except ReviewParseError as exc:
        print(str(exc), file=sys.stderr)
        return 1
    json.dump(data, sys.stdout, ensure_ascii=False)
    print()
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
