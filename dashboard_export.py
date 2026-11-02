"""
Converts your real Ansible/OPA scan_results/*.json into the JSON schema
your friend's dashboard (dashboard/js/*.js) expects at reports/report.json.

Reads config.yaml for paths, so it stays in sync with detect.py automatically.
Run standalone with: python3 dashboard_export.py
Or import and call dashboard_export.main() from detect.py after save_report().
"""

import json
import os
import yaml
from datetime import datetime

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CONFIG_FILE = os.path.join(BASE_DIR, "config.yaml")


def load_config():
    with open(CONFIG_FILE) as f:
        return yaml.safe_load(f)


def load_rules(rules_path):
    with open(rules_path) as f:
        data = json.load(f)
    return data["rules"]


def evaluate_rule(rule, scan_data):
    field = rule["field"]
    raw = str(scan_data.get(field, "")).strip()
    value = raw.split()[-1] if raw else ""
    value_lower = value.lower()

    status = "WARNING"
    if not value:
        status = "ERROR"
    elif "expected_contains" in rule:
        status = "PASS" if rule["expected_contains"] in value_lower else "FAIL"
    elif "expected_exact" in rule:
        status = "PASS" if value == rule["expected_exact"] else "FAIL"
    elif "expected_max" in rule:
        try:
            status = "PASS" if int(value) <= rule["expected_max"] else "FAIL"
        except ValueError:
            status = "WARNING"
    elif "expected_min" in rule:
        try:
            status = "PASS" if int(value) >= rule["expected_min"] else "FAIL"
        except ValueError:
            status = "WARNING"

    return {
        "rule_id": rule["rule_id"],
        "framework": "CIS",
        "name": rule["name"],
        "category": rule["category"],
        "severity": rule["severity"],
        "description": rule["description"],
        "expected": str(
            rule.get("expected_contains")
            or rule.get("expected_exact")
            or rule.get("expected_max")
            or rule.get("expected_min")
        ),
        "actual": raw or "Unknown",
        "status": status,
        "evidence": raw,
        "remediation": rule["remediation"],
        "hostname": scan_data.get("hostname", "unknown"),
    }


def build_report(rules_evaluated):
    pass_c = sum(1 for r in rules_evaluated if r["status"] == "PASS")
    fail_c = sum(1 for r in rules_evaluated if r["status"] == "FAIL")
    info_c = sum(1 for r in rules_evaluated if r["status"] == "INFO")
    warn_c = sum(1 for r in rules_evaluated if r["status"] == "WARNING")
    err_c = sum(1 for r in rules_evaluated if r["status"] == "ERROR")
    total = len(rules_evaluated)

    return {
        "scanner": {"name": "Auto-CSPM Multi-VM Scanner", "version": "1.0"},
        "frameworks": ["CIS"],
        "summary": {
            "total_checks": total,
            "pass": pass_c,
            "fail": fail_c,
            "info": info_c,
            "warning": warn_c,
            "error": err_c,
            "compliance_score": round((pass_c / total) * 100, 2) if total else 0,
            "risk_score": round((fail_c / total) * 100, 2) if total else 0,
        },
        "rules": rules_evaluated,
    }


def main():
    config = load_config()
    scan_results_dir = os.path.join(BASE_DIR, config["paths"]["scan_results_dir"])
    rules_path = os.path.join(BASE_DIR, config["dashboard"]["rules_catalog"])
    dashboard_reports_dir = os.path.join(BASE_DIR, config["dashboard"]["reports_dir"])

    rules = load_rules(rules_path)
    os.makedirs(dashboard_reports_dir, exist_ok=True)

    all_hosts_rules = []
    per_host_reports = {}
    hostnames = []

    for filename in sorted(os.listdir(scan_results_dir)):
        if not filename.endswith(".json"):
            continue
        hostname = filename.replace(".json", "")
        hostnames.append(hostname)
        with open(os.path.join(scan_results_dir, filename)) as f:
            scan_data = json.load(f)

        host_rules = [evaluate_rule(r, scan_data) for r in rules]
        per_host_reports[hostname] = build_report(host_rules)
        all_hosts_rules.extend(host_rules)

    combined = build_report(all_hosts_rules)
    combined["hosts"] = hostnames
    combined["generated_at"] = datetime.now().isoformat()

    # Fixed filename — this is exactly what dashboard.js / live.js / report.js fetch
    with open(os.path.join(dashboard_reports_dir, "report.json"), "w") as f:
        json.dump(combined, f, indent=2)

    for hostname, report in per_host_reports.items():
        with open(os.path.join(dashboard_reports_dir, f"report_{hostname}.json"), "w") as f:
            json.dump(report, f, indent=2)

    print(f"Dashboard report written for hosts: {hostnames}")
    print(f"Combined summary: {combined['summary']}")


if __name__ == "__main__":
    main()
