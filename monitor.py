#!/usr/bin/env python3
import json
import logging
import os
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

import yaml

BASE_DIR = Path(__file__).resolve().parent
CONFIG = BASE_DIR / "config.yaml"
DATA_DIR = BASE_DIR / "monitor_data" / "scan_results"
REPORT_DIR = BASE_DIR / "reports" / "monitoring"
STATUS_FILE = REPORT_DIR / "monitor_status.json"
PLAYBOOK = BASE_DIR / "ansible" / "monitor_scan.yml"
INTERVAL = 300

DATA_DIR.mkdir(parents=True, exist_ok=True)
REPORT_DIR.mkdir(parents=True, exist_ok=True)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
    handlers=[
        logging.FileHandler(BASE_DIR / "logs" / "monitor.log"),
        logging.StreamHandler(sys.stdout),
    ],
)
(BASE_DIR / "logs").mkdir(exist_ok=True)


def write_status(**values):
    previous = {}
    if STATUS_FILE.exists():
        try:
            previous = json.loads(STATUS_FILE.read_text())
        except (OSError, json.JSONDecodeError):
            pass
    previous.update(values)
    previous["updated_at"] = datetime.now().astimezone().isoformat()
    temp = STATUS_FILE.with_suffix(".tmp")
    temp.write_text(json.dumps(previous, indent=2))
    temp.replace(STATUS_FILE)


def manual_operation_active():
    """Best-effort detection; no changes to the Flask API are required."""
    result = subprocess.run(
        ["ps", "-eo", "args="],
        capture_output=True,
        text=True,
        check=False,
    )
    for line in result.stdout.splitlines():
        if "ansible-playbook" in line and any(
            name in line for name in ("misconfigure.yml", "remediate.yml", "scan.yml")
        ):
            # The background playbook has a different filename.
            if "monitor_scan.yml" not in line:
                return True
        if "detect.py" in line and "--" not in line:
            return True
        if "detect.py" in line and "--fix" in line:
            return True
    return False


def run_ansible():
    cmd = [
        "ansible-playbook",
        "-i", "ansible/inventory.ini",
        "ansible/monitor_scan.yml",
    ]
    process = subprocess.Popen(
        cmd, cwd=BASE_DIR, stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT, text=True,
    )
    output_lines = []
    while process.poll() is None:
        if manual_operation_active():
            logging.warning("Manual demo/remediation detected; stopping monitoring scan.")
            process.terminate()
            try:
                output, _ = process.communicate(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                output, _ = process.communicate()
            if output:
                output_lines.append(output)
            return False, "\n".join(output_lines)
        time.sleep(1)

    output, _ = process.communicate()
    if output:
        output_lines.append(output)
    combined = "\n".join(output_lines)
    return process.returncode == 0, combined


def run_one_scan():
    if manual_operation_active():
        logging.info("Monitoring scan skipped: manual operation is active.")
        write_status(
            monitoring="active",
            scan_state="skipped_busy",
            message="Manual demo/remediation is active; this monitoring cycle was skipped.",
        )
        return

    # Recheck after a short pause to reduce the chance of a handoff overlap.
    time.sleep(3)
    if manual_operation_active():
        logging.info("Monitoring scan skipped after rechecking manual activity.")
        write_status(
            monitoring="active",
            scan_state="skipped_busy",
            message="Manual demo/remediation is active; this monitoring cycle was skipped.",
        )
        return

    logging.info("Starting read-only background scan.")
    write_status(
        monitoring="active",
        scan_state="running",
        message="Collecting real VM configuration and evaluating OPA policies.",
    )

    success, output = run_ansible()
    if not success:
        logging.error("Monitoring collection failed or was interrupted.")
        write_status(
            monitoring="active",
            scan_state="skipped_or_failed",
            message="Collection failed or was interrupted by manual activity. Check logs/monitor.log.",
        )
        return

    with CONFIG.open() as stream:
        config = yaml.safe_load(stream)

    all_results = {}
    for file_path in sorted(DATA_DIR.glob("*.json")):
        try:
            result = subprocess.run(
                [
                    "opa", "eval", "--format", "json",
                    "--data", config["opa"]["policy_file"],
                    "--input", str(file_path),
                    config["opa"]["policy_query"],
                ],
                cwd=BASE_DIR,
                capture_output=True,
                text=True,
                timeout=30,
                check=False,
            )
            if result.returncode != 0:
                raise RuntimeError(result.stderr.strip() or "OPA evaluation failed")
            parsed = json.loads(result.stdout)
            violations = parsed["result"][0]["expressions"][0]["value"]
            all_results[file_path.stem] = violations
        except Exception as exc:
            logging.error("Policy evaluation failed for %s: %s", file_path.name, exc)
            write_status(
                monitoring="active",
                scan_state="failed",
                message=f"Policy evaluation failed for {file_path.stem}: {exc}",
            )
            return

    total = sum(len(items) for items in all_results.values())
    timestamp = datetime.now().astimezone().isoformat()
    report = {
        "timestamp": timestamp,
        "total_violations": total,
        "hosts": all_results,
    }
    report_path = REPORT_DIR / f"monitor_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
    report_path.write_text(json.dumps(report, indent=2))

    logging.info(
        "Monitoring scan completed: %d host(s), %d violation(s).",
        len(all_results), total,
    )
    write_status(
        monitoring="active",
        scan_state="success",
        last_scan=timestamp,
        total_violations=total,
        hosts_scanned=len(all_results),
        report=str(report_path.relative_to(BASE_DIR)),
        message="Background scan completed. No remediation was performed.",
    )


def main():
    write_status(
        monitoring="starting",
        scan_state="waiting",
        message="Background monitor started; interval is five minutes.",
    )
    while True:
        try:
            run_one_scan()
        except Exception:
            logging.exception("Unexpected monitoring error.")
            write_status(
                monitoring="active",
                scan_state="failed",
                message="Unexpected error; check logs/monitor.log.",
            )
        time.sleep(INTERVAL)


if __name__ == "__main__":
    main()
