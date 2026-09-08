import subprocess
import json
import os
import sys
import logging
import yaml
import argparse
from datetime import datetime
BASE_DIR = os.path.dirname(os.path.abspath(__file__))


def load_config():
    """Load settings from config.yaml instead of hardcoding them."""
    config_path = os.path.join(BASE_DIR, "config.yaml")
    with open(config_path, "r") as f:
        return yaml.safe_load(f)


def setup_logging(config):
    """Configure logging to both file and console, instead of plain print()."""
    log_path = os.path.join(BASE_DIR, config["logging"]["log_file"])
    os.makedirs(os.path.dirname(log_path), exist_ok=True)

    level = getattr(logging, config["logging"]["level"])

    logging.basicConfig(
        level=level,
        format="%(asctime)s [%(levelname)s] %(message)s",
        handlers=[
            logging.FileHandler(log_path),
            logging.StreamHandler(sys.stdout)
        ]
    )


def run_scan(config):
    """Run the Ansible playbook to refresh scan_results/*.json."""
    logging.info("Starting Ansible scan...")
    try:
        result = subprocess.run(
            ["ansible-playbook", "-i", config["ansible"]["inventory"], config["ansible"]["playbook"]],
            cwd=BASE_DIR,
            capture_output=True,
            text=True,
            timeout=300
        )
    except subprocess.TimeoutExpired:
        logging.error("Ansible scan timed out after 300 seconds.")
        return False

    if result.returncode != 0:
        logging.error("Ansible scan failed (exit code %d):\nSTDOUT:\n%s\nSTDERR:\n%s",
                       result.returncode, result.stdout, result.stderr)
        return False

    logging.info("Ansible scan completed successfully.")
    return True

def run_remediation(config, limit_host=None):
    """Run the Ansible remediation playbook to fix detected violations."""
    logging.info("Starting remediation...")
    cmd = ["ansible-playbook", "-i", config["ansible"]["inventory"], "ansible/remediate.yml"]
    if limit_host:
        cmd += ["--limit", limit_host]

    try:
        result = subprocess.run(
            cmd,
            cwd=BASE_DIR,
            capture_output=True,
            text=True,
            timeout=300
        )
    except subprocess.TimeoutExpired:
        logging.error("Remediation timed out after 300 seconds.")
        return False

    if result.returncode != 0:
        logging.error("Remediation failed (exit code %d):\nSTDOUT:\n%s\nSTDERR:\n%s",
                       result.returncode, result.stdout, result.stderr)
        return False

    logging.info("Remediation completed successfully.")
    return True


def check_policy(config, json_file):
    """Run OPA against one VM's JSON file, return list of violations (or None on failure)."""
    try:
        result = subprocess.run(
            ["opa", "eval", "--format", "json",
             "--data", config["opa"]["policy_file"],
             "--input", json_file,
             config["opa"]["policy_query"]],
            cwd=BASE_DIR,
            capture_output=True,
            text=True,
            timeout=30
        )
    except subprocess.TimeoutExpired:
        logging.error("OPA evaluation timed out for %s", json_file)
        return None

    if result.returncode != 0:
        logging.error("OPA evaluation failed for %s:\n%s", json_file, result.stderr)
        return None

    try:
        output = json.loads(result.stdout)
        return output["result"][0]["expressions"][0]["value"]
    except (json.JSONDecodeError, KeyError, IndexError) as e:
        logging.error("Failed to parse OPA output for %s: %s", json_file, e)
        return None

def save_report(config, all_results, total_violations):
    """Write this run's results to its own timestamped JSON file."""
    reports_dir = os.path.join(BASE_DIR, config["paths"]["reports_dir"])
    os.makedirs(reports_dir, exist_ok=True)

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    report_path = os.path.join(reports_dir, f"report_{timestamp}.json")

    report = {
        "timestamp": datetime.now().isoformat(),
        "total_violations": total_violations,
        "hosts": all_results
    }

    with open(report_path, "w") as f:
        json.dump(report, f, indent=2)

    logging.info("Report saved to %s", report_path)

def main():
    parser = argparse.ArgumentParser(description="CSPM detection and remediation tool")
    parser.add_argument("--fix", action="store_true", help="Automatically remediate detected violations")
    args = parser.parse_args()

    config = load_config()
    setup_logging(config)

    logging.info("---- New scan run started ----")

    if not run_scan(config):
        logging.error("Aborting: scan step failed.")
        sys.exit(1)

    scan_dir = os.path.join(BASE_DIR, config["paths"]["scan_results_dir"])
    all_results = {}

    for filename in sorted(os.listdir(scan_dir)):
        if not filename.endswith(".json"):
            continue
        hostname = filename.replace(".json", "")
        filepath = os.path.join(scan_dir, filename)

        violations = check_policy(config, filepath)
        if violations is None:
            logging.warning("Skipping %s due to policy check failure.", hostname)
            continue

        all_results[hostname] = violations

    total_violations = sum(len(v) for v in all_results.values())

    for hostname, violations in all_results.items():
        if not violations:
            logging.info("%s: No violations found.", hostname)
        else:
            logging.info("%s: %d violation(s) found.", hostname, len(violations))

    logging.info("Scan complete. Total violations across all hosts: %d", total_violations)

    save_report(config, all_results, total_violations)

    if args.fix:
        if total_violations == 0:
            logging.info("No violations to remediate.")
        else:
            logging.info("--fix flag set: proceeding with remediation.")
            if run_remediation(config):
                logging.info("Re-scanning to verify remediation...")
                if run_scan(config):
                    post_fix_results = {}
                    for filename in sorted(os.listdir(scan_dir)):
                        if not filename.endswith(".json"):
                            continue
                        hostname = filename.replace(".json", "")
                        filepath = os.path.join(scan_dir, filename)
                        violations = check_policy(config, filepath)
                        post_fix_results[hostname] = violations or []

                    remaining = sum(len(v) for v in post_fix_results.values())
                    logging.info("Post-remediation violations remaining: %d", remaining)
                    save_report(config, post_fix_results, remaining)
    else:
        if total_violations > 0:
            logging.info("Run with --fix to automatically remediate these violations.")



if __name__ == "__main__":
    main()
