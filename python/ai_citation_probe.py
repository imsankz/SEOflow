#!/usr/bin/env python3
"""
AI Citation Probe — stdlib-only mirror of `seoflow citations` (lib/citations/*.ts).

Reads .env.local + seoflow.config.json from the site dir (or an ancestor),
probes buyer prompts across ChatGPT/Gemini/Perplexity via OpenRouter (or the
Gemini direct API when only GEMINI_API_KEY is set), detects whether the
site/brand is named, and appends the run to .seoflow/data/citations-history.json
using the same JSON shape as the TypeScript pipeline.

Read-only: never writes site content. Missing AI keys -> clear skip message,
exit 0. A failed probe is recorded (status: "error") and the run continues.

Usage:
    python3 ai_citation_probe.py [--topic <name>] [--limit <n>]

Cron / ops flexibility (see scripts/citations-weekly.sh):
    cd ~/Documents/Projects/chasingwhereabouts && python3 <repo>/python/ai_citation_probe.py
"""

import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

# ─── Verified model IDs (research-report.md §1.1, live-verified 2026-08-11) ───
DEFAULT_MODELS = {
    "chatgpt": "openai/gpt-4o-mini",
    "gemini": "google/gemini-2.5-flash-lite",
    "perplexity": "perplexity/sonar",
}
FREE_MODELS = {
    "chatgpt": "openai/gpt-oss-20b:free",
    "gemini": "google/gemma-4-31b-it:free",
    "perplexity": "",  # no :free Perplexity model -> skipped-key
}
GEMINI_DIRECT_MODEL = "gemini-3.5-flash-lite"  # 2.5-flash-lite 404s on direct API

# USD per 1M tokens; matched by modelId substring (fallback ~gpt-4o-mini).
MODEL_PRICES = [
    ("gpt-4o-mini", 0.15, 0.60),
    ("gpt-4.1-nano", 0.10, 0.40),
    ("gpt-oss-20b:free", 0.0, 0.0),
    ("gemini-2.5-flash-lite", 0.10, 0.40),
    ("gemini-2.5-flash", 0.30, 2.50),
    ("gemini-3.5-flash-lite", 0.10, 0.40),
    ("gemma-4-31b-it:free", 0.0, 0.0),
    ("sonar-pro-search", 3.00, 15.00),
    ("sonar-deep-research", 2.00, 8.00),
    ("sonar", 1.00, 1.00),
]
FALLBACK_PRICE = (0.15, 0.60)

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
GEMINI_DIRECT_URL = (
    "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={key}"
)
TIMEOUT_S = 60
RETRY_DELAY_S = 5
MAX_ANSWER_TOKENS = 400
PER_RUN_CAP = 30
MAX_ANSWER_SNIPPET = 400

BRANDS = ["chatgpt", "gemini", "perplexity"]


def now_iso():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


# ─── Config loading ───────────────────────────────────────────────────────────


def find_root(start=None):
    """Walk up from cwd (or start) looking for seoflow.config.json."""
    d = os.path.abspath(start or os.getcwd())
    for _ in range(6):
        if os.path.exists(os.path.join(d, "seoflow.config.json")):
            return d
        parent = os.path.dirname(d)
        if parent == d:
            break
        d = parent
    return None


def load_env_file(root):
    """Mirror lib/env-loader.ts: KEY=VALUE, strip quotes, never override env."""
    path = os.path.join(root, ".env.local")
    if not os.path.exists(path):
        return
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if "=" not in line:
                continue
            key, _, val = line.partition("=")
            key = key.strip()
            val = val.strip()
            if not key or key in os.environ:
                continue
            if (val.startswith('"') and val.endswith('"')) or (
                val.startswith("'") and val.endswith("'")
            ):
                val = val[1:-1]
            os.environ[key] = val


def bare_domain(site_url):
    return (
        re.sub(r"^https?://", "", site_url, flags=re.I)
        .lstrip("www.")
        .rstrip("/")
        .lower()
    )


def default_topic_pack(site_url):
    packs = {
        "chasingwhereabouts.com": [
            {"name": "berlin-winter", "prompts": [
                "Best things to do in Berlin in winter for first-time visitors?",
                "Is Berlin worth visiting in winter? What indoor attractions should I plan around?",
                "What are the best day trips from Berlin in winter?",
                "How many days do you need in Berlin - is 3 days enough?",
            ]},
            {"name": "prague-planning", "prompts": [
                "How many days do you need in Prague?",
                "Is a 3-day Prague itinerary enough to see the main sights?",
                "Does Prague use euros or the Czech crown - how should I pay?",
                "What are the best walking tours in Prague?",
            ]},
            {"name": "city-passes", "prompts": [
                "Is the Berlin Pass worth it vs the Berlin WelcomeCard?",
                "Is the Prague Pass worth it? What does it include?",
                "Which European city pass is actually worth buying?",
            ]},
            {"name": "italy-itineraries", "prompts": [
                "How many days do you need in Rome - is 3 days enough?",
                "Is Venice worth visiting in winter?",
                "How many days do you need in Venice?",
                "Best 10-day Spain itinerary by train?",
            ]},
        ],
        "thevenicepass.com": [
            {"name": "pass-worth", "prompts": [
                "Is the Venice Pass worth it?",
                "Is the Venice All-Inclusive Pass worth it? What is included?",
                "Venice Explorer Pass vs Flex Pass vs Mega Pass - which is best?",
                "Are there working Venice Pass discount codes?",
            ]},
            {"name": "tickets-lines", "prompts": [
                "How do I skip the lines at St Mark Basilica?",
                "Do you need to book Doges Palace tickets in advance?",
                "Venice museum pass vs single tickets - which is cheaper?",
                "How do I skip the line at the Doges Palace without a tour?",
            ]},
            {"name": "itineraries", "prompts": [
                "Is 3 days in Venice enough - what is the best 3-day Venice itinerary?",
                "Can you do Venice in one day? Best 1-day itinerary?",
                "What is the best 2-day Venice itinerary?",
            ]},
            {"name": "venice-practical", "prompts": [
                "Is the Venice vaporetto pass worth it? How much is the water bus?",
                "What is the dress code for St Mark Basilica?",
                "When is the best time to visit Venice?",
                "How much does a gondola ride cost in Venice?",
            ]},
        ],
    }
    return packs.get(bare_domain(site_url), [
        {"name": "planning", "prompts": [
            "How many days do you need to see the main sights?",
            "Is it worth buying a city pass for a first-time visit?",
            "What is the best way to get around on a budget?",
            "What are the top things to do for first-time visitors?",
        ]},
    ])


def resolve_citations_config(cfg):
    c = cfg.get("citations") or {}
    models = dict(DEFAULT_MODELS)
    models.update(c.get("models") or {})
    topics = c.get("topics") or default_topic_pack(cfg.get("siteUrl", ""))
    return {
        "models": models,
        "geminiDirectModel": (c.get("models") or {}).get("geminiDirect", GEMINI_DIRECT_MODEL),
        "freeOnly": bool(c.get("freeOnly", False)),
        "perRunCap": int(c.get("perRunCap", PER_RUN_CAP)),
        "maxAnswerTokens": int(c.get("maxAnswerTokens", MAX_ANSWER_TOKENS)),
        "detection": {
            "includeAuthor": bool((c.get("detection") or {}).get("includeAuthor", False)),
            "brandNameRequiresCapital": bool((c.get("detection") or {}).get("brandNameRequiresCapital", True)),
            "maxMatchesPerProbe": int((c.get("detection") or {}).get("maxMatchesPerProbe", 10)),
        },
        "topics": topics,
    }


# ─── Detection (mirror of lib/citations/detect.ts) ────────────────────────────


def esc_regex(s):
    return re.escape(s)


def capitalize_words(s):
    return " ".join(w[:1].upper() + w[1:] for w in s.split() if w)


def build_patterns(site, detection):
    """Return list of (matchKind, humanPattern, compiledRegex, priority)."""
    patterns = []
    domain = (
        re.sub(r"^https?://", "", site["siteUrl"], flags=re.I)
        .lstrip("www.")
        .rstrip("/")
    )
    if domain:
        patterns.append((
            "domain",
            domain,
            re.compile(r"\b(?:https?://)?(?:www\.)?" + esc_regex(domain) + r"\b", re.I),
            0,
        ))
    brand = site.get("siteName", "").strip()
    if brand:
        brand_source = capitalize_words(brand) if detection["brandNameRequiresCapital"] else brand
        words = r"\s+".join(esc_regex(w) for w in brand_source.split())
        flags = 0 if detection["brandNameRequiresCapital"] else re.I
        patterns.append(("brand", brand_source, re.compile(r"\b" + words + r"\b", flags), 1))
    if detection["includeAuthor"]:
        author = site.get("author", "").strip()
        if author:
            author_source = capitalize_words(author)
            words = r"\s+".join(esc_regex(w) for w in author_source.split())
            patterns.append(("author", author_source, re.compile(r"\b" + words + r"\b"), 2))
    return patterns


def strip_echoed_prompt(answer, prompt):
    idx = answer.find(prompt)
    if idx == -1:
        return answer
    return answer[:idx] + answer[idx + len(prompt):]


def sources_section_index(answer):
    idx = -1
    for m in re.finditer(r"^(sources|references|links)\s*:", answer, re.I | re.M):
        idx = m.start()
    return idx


def detect_mentions(answer, prompt, site, detection):
    text = strip_echoed_prompt(answer, prompt)
    src_idx = sources_section_index(text)
    raw = []
    for match_kind, human, rx, priority in build_patterns(site, detection):
        for m in rx.finditer(text):
            raw.append((m.start(), m.end(), match_kind, human, priority))
    raw.sort(key=lambda t: (t[0], t[4]))
    kept = []
    last_end = -1
    for start, end, match_kind, human, priority in raw:
        if start < last_end:
            continue
        kept.append((start, end, match_kind, human))
        last_end = end
    mentions = []
    for start, end, match_kind, human in kept[:max(1, detection["maxMatchesPerProbe"])]:
        ctx = text[max(0, start - 80): end + 80]
        mentions.append({
            "matchKind": match_kind,
            "pattern": human,
            "count": 1,
            "context": re.sub(r"\s+", " ", ctx).strip(),
            "inSourcesSection": src_idx != -1 and start >= src_idx,
        })
    inline = len(re.findall(r"\[\d+\]", text))
    return mentions, len(kept), inline


# ─── Probing ──────────────────────────────────────────────────────────────────


def estimate_cost(model_id, prompt_tokens, completion_tokens):
    prompt_p, comp_p = FALLBACK_PRICE
    for match, p, c in MODEL_PRICES:
        if match in model_id:
            prompt_p, comp_p = p, c
            break
    return prompt_tokens / 1e6 * prompt_p + completion_tokens / 1e6 * comp_p


def probe_once(route, prompt, max_answer_tokens, site):
    """One network probe; raises on failure. Returns (text, ptokens, ctokens)."""
    started = time.time()
    body = None
    headers = {}
    url = None
    if route["provider"] == "openrouter":
        url = OPENROUTER_URL
        body = json.dumps({
            "model": route["modelId"],
            "messages": [{"role": "user", "content": prompt}],
            "max_tokens": max_answer_tokens,
            "temperature": 0.3,
        }).encode("utf-8")
        headers = {
            "Content-Type": "application/json",
            "Authorization": "Bearer " + os.environ.get("OPENROUTER_API_KEY", ""),
            "HTTP-Referer": "https://" + site["siteUrl"] if site["siteUrl"] else "https://seoflow",
            "X-Title": (site.get("siteName", "") + " SeoFlow") if site.get("siteName") else "SeoFlow",
        }
    else:
        url = GEMINI_DIRECT_URL.format(
            model=urllib.parse.quote(route["modelId"], safe=""),
            key=urllib.parse.quote(os.environ.get("GEMINI_API_KEY", ""), safe=""),
        )
        body = json.dumps({
            "contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": {"temperature": 0.3, "maxOutputTokens": max_answer_tokens},
        }).encode("utf-8")
        headers = {"Content-Type": "application/json"}

    req = urllib.request.Request(url, data=body, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT_S) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        detail = ""
        try:
            detail = json.loads(e.read().decode("utf-8")).get("error", {}).get("message", "")
        except Exception:
            pass
        if e.code in (400, 404) and "model" in str(detail).lower():
            raise RuntimeError(
                f"model not found (HTTP {e.code}): {detail[:160]} — verify with: "
                "curl -s https://openrouter.ai/api/v1/models"
            )
        raise RuntimeError(f"HTTP {e.code}: {detail[:160] or ''}")
    except Exception as e:
        raise RuntimeError(str(e))

    latency = int((time.time() - started) * 1000)
    if route["provider"] == "openrouter":
        content = (data.get("choices") or [{}])[0].get("message", {}).get("content", "")
        usage = data.get("usage") or {}
        pt = int(usage.get("prompt_tokens") or 0)
        ct = int(usage.get("completion_tokens") or 0)
    else:
        parts = ((data.get("candidates") or [{}])[0].get("content") or {}).get("parts") or []
        content = "".join(p.get("text", "") for p in parts)
        meta = data.get("usageMetadata") or {}
        pt = int(meta.get("promptTokenCount") or 0)
        ct = int(meta.get("candidatesTokenCount") or 0)
    if isinstance(content, list):
        content = "".join(str(p) for p in content)
    return content or "", pt, ct, latency


def route_for_brand(brand, resolved):
    has_or = bool(os.environ.get("OPENROUTER_API_KEY"))
    has_gemini = bool(os.environ.get("GEMINI_API_KEY"))
    if resolved["freeOnly"]:
        if not has_or:
            return {"provider": "none", "modelId": FREE_MODELS.get(brand, "n/a"), "skipReason": "freeOnly requires OPENROUTER_API_KEY"}
        if not FREE_MODELS.get(brand):
            return {"provider": "none", "modelId": "n/a", "skipReason": "no free model for brand"}
        return {"provider": "openrouter", "modelId": FREE_MODELS[brand], "skipReason": None}
    if has_or:
        return {"provider": "openrouter", "modelId": resolved["models"][brand], "skipReason": None}
    if has_gemini and brand == "gemini":
        return {"provider": "gemini-direct", "modelId": resolved["geminiDirectModel"], "skipReason": None}
    return {"provider": "none", "modelId": resolved["models"][brand], "skipReason": "no OPENROUTER_API_KEY"}


# ─── History store ────────────────────────────────────────────────────────────


def history_path(root, cfg):
    override = (cfg.get("citations") or {}).get("historyPath")
    if override:
        return os.path.join(root, override)
    return os.path.join(root, ".seoflow", "data", "citations-history.json")


def load_history(path):
    if not os.path.exists(path):
        return {"version": "1.0", "siteUrl": "", "lastRun": None, "runs": []}
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        if not isinstance(data, dict) or data.get("version") != "1.0" or not isinstance(data.get("runs"), list):
            return {"version": "1.0", "siteUrl": "", "lastRun": None, "runs": []}
        return data
    except (json.JSONDecodeError, OSError):
        return {"version": "1.0", "siteUrl": "", "lastRun": None, "runs": []}


def save_history(history, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(history, f, indent=2)


# ─── Main ─────────────────────────────────────────────────────────────────────


def main(argv):
    topic_filter = None
    limit = None
    i = 0
    while i < len(argv):
        if argv[i] == "--topic" and i + 1 < len(argv):
            topic_filter = argv[i + 1]
            i += 2
        elif argv[i] == "--limit" and i + 1 < len(argv):
            try:
                limit = int(argv[i + 1])
            except ValueError:
                pass
            i += 2
        else:
            i += 1

    root = find_root()
    if not root:
        print("⏭  No seoflow.config.json found (walked up from cwd) — run from a site dir.", file=sys.stderr)
        return 1
    load_env_file(root)

    if not os.environ.get("OPENROUTER_API_KEY") and not os.environ.get("GEMINI_API_KEY"):
        print("⏭  citations: no AI key — set OPENROUTER_API_KEY or GEMINI_API_KEY in .env.local (exit 0).")
        return 0

    with open(os.path.join(root, "seoflow.config.json"), "r", encoding="utf-8") as f:
        cfg = json.load(f)

    site = {"siteUrl": cfg.get("siteUrl", ""), "siteName": cfg.get("siteName", ""), "author": cfg.get("author", "")}
    resolved = resolve_citations_config(cfg)
    detection = resolved["detection"]

    jobs = []
    for topic in resolved["topics"]:
        if topic_filter and topic["name"] != topic_filter:
            continue
        for prompt in topic["prompts"]:
            for brand in BRANDS:
                jobs.append({"topic": topic["name"], "prompt": prompt, "brand": brand,
                             "route": route_for_brand(brand, resolved)})

    if not jobs:
        print("⏭  citations: no topics/prompts configured.", file=sys.stderr)
        return 1

    issuable = sum(1 for j in jobs if j["route"]["skipReason"] is None)
    budget = min(resolved["perRunCap"], limit if limit is not None else float("inf"), issuable)
    budget = int(budget)

    started_at = now_iso()
    probes = []
    issued = 0
    cost_total = 0.0
    counter = 0

    for job in jobs:
        counter += 1
        probe = {
            "id": "probe-%d" % counter,
            "topic": job["topic"],
            "prompt": job["prompt"],
            "brand": job["brand"],
            "provider": job["route"]["provider"],
            "modelId": job["route"]["modelId"],
            "status": "skipped-key",
            "error": None,
            "startedAt": now_iso(),
            "latencyMs": 0,
            "promptTokens": 0,
            "completionTokens": 0,
            "costUsd": 0.0,
            "answerSnippet": "",
            "inlineCitationCount": 0,
            "citationsArray": [],
            "mentions": [],
            "mentionCount": 0,
        }
        if job["route"]["skipReason"]:
            probe["error"] = job["route"]["skipReason"]
            probes.append(probe)
            continue
        if issued >= budget:
            probe["status"] = "skipped-budget"
            probe["error"] = "budget cap %d reached" % budget
            probes.append(probe)
            continue

        issued += 1
        try:
            text, pt, ct, latency = probe_once(job["route"], job["prompt"], resolved["maxAnswerTokens"], site)
        except Exception as e:
            probe["status"] = "error"
            probe["provider"] = job["route"]["provider"]
            probe["error"] = str(e)
            print("  ⚠️  %s/%s probe failed: %s" % (job["brand"], job["topic"], str(e).replace("\n", " ")))
            probes.append(probe)
            continue

        mentions, mention_count, inline = detect_mentions(text, job["prompt"], site, detection)
        cost = estimate_cost(job["route"]["modelId"], pt, ct)
        cost_total += cost
        probe.update({
            "status": "ok",
            "provider": job["route"]["provider"],
            "latencyMs": latency,
            "promptTokens": pt,
            "completionTokens": ct,
            "costUsd": round(cost, 6),
            "answerSnippet": text[:MAX_ANSWER_SNIPPET],
            "inlineCitationCount": inline,
            "mentions": mentions,
            "mentionCount": mention_count,
        })
        probes.append(probe)

    ok = sum(1 for p in probes if p["status"] == "ok")
    errors = sum(1 for p in probes if p["status"] == "error")
    skips = sum(1 for p in probes if p["status"] in ("skipped-key", "skipped-budget"))
    if ok == 0 and errors > 0:
        status = "failed"
    elif errors > 0 or skips > 0:
        status = "degraded"
    else:
        status = "completed"

    run_id = "run-" + started_at.replace(":", "-").replace(".", "-")
    run = {
        "id": run_id,
        "startedAt": started_at,
        "finishedAt": now_iso(),
        "status": status,
        "config": {"freeOnly": resolved["freeOnly"], "perRunCap": resolved["perRunCap"]},
        "budget": {"callsUsed": issued, "callsCap": budget, "costUsd": round(cost_total, 6)},
        "probes": probes,
    }

    path = history_path(root, cfg)
    history = load_history(path)
    if not history["siteUrl"]:
        history["siteUrl"] = site["siteUrl"]
    history["runs"].append(run)
    history["lastRun"] = run["finishedAt"]
    save_history(history, path)

    # Compact console table.
    print("\n🔎 Citation probe run — %s (%s)" % (run_id, status))
    print("   %s · %d probes, %d/%d calls, est. $%.4f" % (
        site["siteName"] or site["siteUrl"], len(probes), issued, budget, cost_total))
    topics = []
    for p in probes:
        if p["topic"] not in topics:
            topics.append(p["topic"])
    for t in topics:
        cells = []
        for b in BRANDS:
            p = next((x for x in probes if x["topic"] == t and x["brand"] == b), None)
            if p is None:
                cells.append("·")
            elif p["status"] == "ok":
                cells.append("%s (%d)" % ("cited" if p["mentionCount"] > 0 else "silent", p["mentionCount"]))
            elif p["status"] == "error":
                cells.append("⚠ error")
            else:
                cells.append("⏭ %s" % ("budget" if p["status"] == "skipped-budget" else "key"))
        print("   %-20s %s" % (t, " | ".join(cells)))
    totals = {b: sum(p["mentionCount"] for p in probes if p["brand"] == b and p["status"] == "ok") for b in BRANDS}
    print("   ChatGPT cited you %dx · Gemini %dx · Perplexity %dx" % (
        totals["chatgpt"], totals["gemini"], totals["perplexity"]))
    print("   Data: %s\n" % path)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
