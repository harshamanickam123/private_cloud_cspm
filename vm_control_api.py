from flask import Flask, jsonify, send_from_directory, request
from flask_cors import CORS
import subprocess
import json
from pathlib import Path
import time
import platform
import tempfile
import re

app = Flask(__name__)
CORS(app)

from patch_management_api import patch_api
app.register_blueprint(patch_api)

from drift_detection_api import drift_api
app.register_blueprint(drift_api)

BASE_DIR = Path(__file__).resolve().parent
REPORT_FILE = BASE_DIR / "reports" / "report.json"

VM_NAMES = ["vm1", "vm2"]


def run_command(command):
    try:
        result = subprocess.run(
            command,
            capture_output=True,
            text=True,
            timeout=120
        )

        return {
            "success": result.returncode == 0,
            "stdout": result.stdout.strip(),
            "stderr": result.stderr.strip(),
            "returncode": result.returncode
        }

    except Exception as e:
        return {
            "success": False,
            "stdout": "",
            "stderr": str(e),
            "returncode": -1
        }


@app.route("/")
def home():
    return jsonify({
        "message": "SENTINELFORGE Flask API is running"
    })


@app.route("/dashboard/")
def dashboard_home():
    return send_from_directory(BASE_DIR / "dashboard", "index.html")


@app.route("/dashboard/<path:filename>")
def dashboard_files(filename):
    return send_from_directory(BASE_DIR / "dashboard", filename)


@app.route("/api/test")
def test():
    return jsonify({
        "success": True,
        "message": "API connection working"
    })

@app.route("/api/vms")
def list_vms():

    result = run_command([
        "virsh",
        "list",
        "--all",
        "--name"
    ])

    if not result["success"]:
        return jsonify(result), 500

    vm_names = [
        name.strip()
        for name in result["stdout"].splitlines()
        if name.strip()
    ]

    vms = []

    for vm_name in vm_names:

        state_result = run_command([
            "virsh",
            "domstate",
            vm_name
        ])

        state = (
            state_result["stdout"]
            if state_result["success"]
            else "unknown"
        )

        vms.append({
            "name": vm_name,
            "state": state
        })

    return jsonify({
        "success": True,
        "count": len(vms),
        "vms": vms
    })

@app.route("/api/vm/<vm_name>/status")
def vm_status(vm_name):

    if vm_name not in VM_NAMES:
        return jsonify({
            "success": False,
            "error": "Unknown VM"
        }), 404

    result = run_command([
        "virsh",
        "domstate",
        vm_name
    ])

    if not result["success"]:
        return jsonify(result), 500

    return jsonify({
        "success": True,
        "vm": vm_name,
        "status": result["stdout"]
    })


@app.route("/api/vm/<vm_name>/start", methods=["POST"])
def start_vm(vm_name):

    if vm_name not in VM_NAMES:
        return jsonify({
            "success": False,
            "error": "Unknown VM"
        }), 404

    result = run_command([
        "virsh",
        "start",
        vm_name
    ])

    return jsonify(result)


@app.route("/api/vm/<vm_name>/stop", methods=["POST"])
def stop_vm(vm_name):

    if vm_name not in VM_NAMES:
        return jsonify({
            "success": False,
            "error": "Unknown VM"
        }), 404

    result = run_command([
        "virsh",
        "shutdown",
        vm_name
    ])

    return jsonify(result)


@app.route("/api/vm/<vm_name>/restart", methods=["POST"])
def restart_vm(vm_name):

    if vm_name not in VM_NAMES:
        return jsonify({
            "success": False,
            "error": "Unknown VM"
        }), 404

    result = run_command([
        "virsh",
        "reboot",
        vm_name
    ])

    return jsonify(result)

@app.route("/api/vm/<vm_name>/stats")
def vm_stats(vm_name):

    if vm_name not in VM_NAMES:
        return jsonify({
            "success": False,
            "error": "Unknown VM"
        }), 404

    # ----------------------------------------
    # Get basic VM information
    # ----------------------------------------

    info_result = run_command([
        "virsh",
        "dominfo",
        vm_name
    ])

    if not info_result["success"]:
        return jsonify(info_result), 500

    info = {}

    for line in info_result["stdout"].splitlines():
        if ":" in line:
            key, value = line.split(":", 1)
            info[key.strip()] = value.strip()

    # ----------------------------------------
    # Get VM IP address
    # ----------------------------------------

    ip_result = run_command([
        "virsh",
        "domifaddr",
        vm_name,
        "--source",
        "lease"
    ])

    ip_address = None

    if ip_result["success"]:

        for line in ip_result["stdout"].splitlines():

            parts = line.split()

            if len(parts) >= 4 and parts[2] == "ipv4":
                ip_address = parts[3].split("/")[0]
                break

    # ----------------------------------------
    # CPU count
    # ----------------------------------------

    cpu_count = None

    if info.get("CPU(s)", "").isdigit():
        cpu_count = int(info["CPU(s)"])

    # ----------------------------------------
    # CPU usage
    # ----------------------------------------

    cpu_usage_percent = None

    if cpu_count and info.get("State") == "running":

        sample1 = run_command([
            "virsh",
            "domstats",
            vm_name,
            "--cpu-total"
        ])

        if sample1["success"]:

            cpu_time_1 = None

            for line in sample1["stdout"].splitlines():

                if line.strip().startswith("cpu.time="):
                    cpu_time_1 = int(
                        line.strip().split("=")[1]
                    )
                    break

            if cpu_time_1 is not None:

                time.sleep(1)

                sample2 = run_command([
                    "virsh",
                    "domstats",
                    vm_name,
                    "--cpu-total"
                ])

                if sample2["success"]:

                    cpu_time_2 = None

                    for line in sample2["stdout"].splitlines():

                        if line.strip().startswith("cpu.time="):
                            cpu_time_2 = int(
                                line.strip().split("=")[1]
                            )
                            break

                    if cpu_time_2 is not None:

                        cpu_time_delta = (
                            cpu_time_2 - cpu_time_1
                        )

                        # virsh cpu.time is nanoseconds
                        cpu_seconds = (
                            cpu_time_delta / 1_000_000_000
                        )

                        # One second of wall time ×
                        # number of vCPUs represents
                        # 100% total capacity.
                        cpu_usage_percent = round(
                            (
                                cpu_seconds /
                                (1 * cpu_count)
                            ) * 100,
                            2
                        )

                        # Keep the value between 0 and 100.
                        cpu_usage_percent = max(
                            0,
                            min(
                                100,
                                cpu_usage_percent
                            )
                        )

    # ----------------------------------------
    # Memory
    # ----------------------------------------

    memory_max_mb = None
    memory_used_mb = None
    memory_unused_mb = None
    memory_usable_mb = None
    memory_rss_mb = None

    try:

        if "Max memory" in info:
            memory_max_mb = round(
                int(
                    info["Max memory"].split()[0]
                ) / 1024,
                2
            )

        if "Used memory" in info:
            memory_used_mb = round(
                int(
                    info["Used memory"].split()[0]
                ) / 1024,
                2
            )

    except (ValueError, IndexError):
        pass

    # ----------------------------------------
    # Get detailed memory statistics
    # ----------------------------------------

    memory_result = run_command([
        "virsh",
        "domstats",
        vm_name,
        "--balloon"
    ])

    if memory_result["success"]:

        memory_values = {}

        for line in memory_result["stdout"].splitlines():

            line = line.strip()

            if "=" in line:

                key, value = line.split("=", 1)

                try:
                    memory_values[key] = int(value)
                except ValueError:
                    pass

        # Values are reported in KiB
        if "balloon.unused" in memory_values:
            memory_unused_mb = round(
                memory_values["balloon.unused"] / 1024,
                2
            )

        if "balloon.usable" in memory_values:
            memory_usable_mb = round(
                memory_values["balloon.usable"] / 1024,
                2
            )

        if "balloon.rss" in memory_values:
            memory_rss_mb = round(
                memory_values["balloon.rss"] / 1024,
                2
            )

    # ----------------------------------------
    # Return real VM statistics
    # ----------------------------------------

    return jsonify({

        "success": True,

        "vm": vm_name,

        "status": info.get(
            "State",
            "unknown"
        ),

        "ip_address": ip_address,

        "cpu_count": cpu_count,

        "cpu_usage_percent": cpu_usage_percent,

        "memory_max_mb": memory_max_mb,

        "memory_used_mb": memory_used_mb,

        "memory_unused_mb": memory_unused_mb,

        "memory_usable_mb": memory_usable_mb,

        "memory_rss_mb": memory_rss_mb,

        "persistent": info.get(
            "Persistent"
        ),

        "autostart": info.get(
            "Autostart"
        ),

        "security_model": info.get(
            "Security model"
        ),

        "raw": info_result["stdout"]
    })

@app.route("/api/report")
def get_report():

    report_files = sorted(
        (BASE_DIR / "reports").glob("report_*.json"),
        key=lambda file: file.stat().st_mtime,
        reverse=True
    )

    if not report_files:
        return jsonify({
            "success": False,
            "error": "No scan report found"
        }), 404

    latest_report = report_files[0]

    try:
        with open(latest_report, "r") as file:
            report = json.load(file)

        return jsonify(report)

    except Exception as e:
        return jsonify({
            "success": False,
            "error": str(e)
        }), 500

@app.route("/api/reports/library", methods=["GET"])
def get_report_library():
    """List actual saved JSON reports and PDFs without running a scan."""

    reports_dir = BASE_DIR / "reports"
    pdf_dir = reports_dir / "generated_pdfs"

    json_reports = []
    pdf_reports = []

    if reports_dir.exists():
        for file in reports_dir.glob("report_*.json"):
            try:
                json_reports.append({
                    "name": file.name,
                    "type": "JSON",
                    "modified": file.stat().st_mtime,
                    "size_bytes": file.stat().st_size
                })
            except OSError:
                continue

    if pdf_dir.exists():
        for file in pdf_dir.glob("*.pdf"):
            try:
                pdf_reports.append({
                    "name": file.name,
                    "type": "PDF",
                    "modified": file.stat().st_mtime,
                    "size_bytes": file.stat().st_size
                })
            except OSError:
                continue

    json_reports.sort(key=lambda item: item["modified"], reverse=True)
    pdf_reports.sort(key=lambda item: item["modified"], reverse=True)

    return jsonify({
        "success": True,
        "json_reports": json_reports,
        "pdf_reports": pdf_reports,
        "json_count": len(json_reports),
        "pdf_count": len(pdf_reports)
    })

@app.route("/api/reports/generate-pdf", methods=["POST"])
def generate_saved_pdf():
    """Generate and save a PDF from the latest existing scan report."""
    from datetime import datetime
    from xml.sax.saxutils import escape

    from reportlab.lib import colors
    from reportlab.lib.enums import TA_CENTER
    from reportlab.lib.pagesizes import A4, landscape
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.units import mm
    from reportlab.platypus import (
        SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
    )

    reports_dir = BASE_DIR / "reports"
    pdf_dir = reports_dir / "generated_pdfs"

    # Prefer the consolidated report with real summary and rule details.
    # This only reads saved files; it does not trigger a scan.
    candidate_files = []

    consolidated = reports_dir / "report.json"
    if consolidated.is_file():
        candidate_files.append(consolidated)

    candidate_files.extend(
        file for file in reports_dir.glob("report_*.json")
        if file.is_file()
    )
    candidate_files.extend(
        file for file in reports_dir.glob("report_vm*.json")
        if file.is_file()
    )

    structured_reports = []
    seen = set()

    for file in candidate_files:
        if file in seen:
            continue
        seen.add(file)

        try:
            with file.open("r", encoding="utf-8") as handle:
                payload = json.load(handle)

            if (
                isinstance(payload, dict)
                and isinstance(payload.get("summary"), dict)
                and isinstance(payload.get("rules"), list)
            ):
                structured_reports.append(file)

        except (OSError, json.JSONDecodeError):
            continue

    if not structured_reports:
        return jsonify({
            "success": False,
            "error": "No saved report with structured summary and rule details was found."
        }), 404

    # Use the consolidated multi-VM report when available.
    latest_report = next(
        (file for file in structured_reports if file.name == "report.json"),
        None
    )

    if latest_report is None:
        latest_report = max(
            structured_reports,
            key=lambda file: file.stat().st_mtime
        )

    try:
        with latest_report.open("r", encoding="utf-8") as file:
            data = json.load(file)

        summary = data.get("summary", {})
        rules = data.get("rules", [])

        if not isinstance(summary, dict):
            summary = {}
        if not isinstance(rules, list):
            rules = []

        pdf_dir.mkdir(parents=True, exist_ok=True)

        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"sentinelforge_report_{timestamp}.pdf"
        output_path = pdf_dir / filename

        styles = getSampleStyleSheet()
        title_style = ParagraphStyle(
            "SentinelForgeTitle",
            parent=styles["Title"],
            alignment=TA_CENTER,
            textColor=colors.HexColor("#17365D"),
            fontSize=18,
            spaceAfter=12
        )
        cell_style = ParagraphStyle(
            "ReportCell",
            parent=styles["BodyText"],
            fontSize=7,
            leading=9,
            wordWrap="CJK"
        )

        def cell(value):
            if value is None or value == "":
                value = "-"
            if isinstance(value, (dict, list)):
                value = json.dumps(value, ensure_ascii=False)
            return Paragraph(escape(str(value)), cell_style)

        total = summary.get("total_checks", len(rules))
        passed = summary.get("pass", summary.get("passed", 0))
        failed = summary.get("fail", summary.get("failed", 0))
        info = summary.get("info", 0)
        warnings = summary.get("warning", summary.get("warnings", 0))
        errors = summary.get("error", summary.get("errors", 0))

        story = [
            Paragraph("SENTINELFORGE Security Report", title_style),
            Paragraph(
                f"Generated: {datetime.now().strftime('%d %b %Y, %H:%M:%S')}",
                styles["Normal"]
            ),
            Paragraph(
                f"Source report: {escape(latest_report.name)}",
                styles["Normal"]
            ),
            Spacer(1, 6 * mm),
            Paragraph("Security Summary", styles["Heading2"]),
            Paragraph(
                f"Total checks: {total} &nbsp; | &nbsp; "
                f"Passed: {passed} &nbsp; | &nbsp; "
                f"Failed: {failed} &nbsp; | &nbsp; "
                f"Info: {info} &nbsp; | &nbsp; "
                f"Warnings: {warnings} &nbsp; | &nbsp; "
                f"Errors: {errors}",
                styles["Normal"]
            ),
            Spacer(1, 6 * mm),
            Paragraph("Scanner Rules", styles["Heading2"])
        ]

        headers = [
            "Host", "Rule", "Severity", "Status", "Expected", "Actual"
        ]
        table_data = [[cell(header) for header in headers]]

        for rule in rules:
            if not isinstance(rule, dict):
                continue

            table_data.append([
                cell(rule.get("hostname", rule.get("host", "-"))),
                cell(rule.get("name", rule.get("rule_id", rule.get("id", "-")))),
                cell(rule.get("severity", "-")),
                cell(rule.get("status", rule.get("result", "-"))),
                cell(rule.get("expected", "-")),
                cell(rule.get("actual", rule.get("observed", "-")))
            ])

        if len(table_data) == 1:
            table_data.append([cell("No rule details found")] + [cell("-")] * 5)

        table = Table(
            table_data,
            colWidths=[25 * mm, 48 * mm, 22 * mm, 22 * mm, 38 * mm, 38 * mm],
            repeatRows=1
        )

        table.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#17365D")),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#D1D5DB")),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 4),
            ("RIGHTPADDING", (0, 0), (-1, -1), 4),
            ("TOPPADDING", (0, 0), (-1, -1), 5),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [
                colors.white, colors.HexColor("#F3F6FA")
            ])
        ]))

        story.append(table)

        document = SimpleDocTemplate(
            str(output_path),
            pagesize=landscape(A4),
            rightMargin=12 * mm,
            leftMargin=12 * mm,
            topMargin=12 * mm,
            bottomMargin=12 * mm
        )
        document.build(story)

        return jsonify({
            "success": True,
            "message": "PDF generated and saved successfully.",
            "filename": filename,
            "url": f"/api/reports/pdf/{filename}"
        }), 201

    except Exception as error:
        app.logger.exception("PDF generation failed")
        return jsonify({
            "success": False,
            "error": str(error)
        }), 500


@app.route("/api/reports/json/<path:filename>", methods=["GET"])
def serve_saved_json(filename):
    """Open an existing saved scan report as JSON."""

    if (
        Path(filename).name != filename
        or not filename.startswith("report_")
        or not filename.endswith(".json")
    ):
        return jsonify({"error": "Invalid report filename"}), 400

    reports_dir = BASE_DIR / "reports"
    report_path = reports_dir / filename

    if not report_path.is_file():
        return jsonify({"error": "Saved JSON report not found"}), 404

    return send_from_directory(
        str(reports_dir),
        filename,
        mimetype="application/json",
        as_attachment=False
    )


@app.route("/api/reports/pdf/<path:filename>", methods=["GET"])
def serve_saved_pdf(filename):
    """Serve an existing PDF from the generated PDF directory."""

    if Path(filename).name != filename:
        return jsonify({"error": "Invalid filename"}), 400

    pdf_dir = BASE_DIR / "reports" / "generated_pdfs"

    if not pdf_dir.is_dir() or not (pdf_dir / filename).is_file():
        return jsonify({"error": "Saved PDF not found"}), 404

    return send_from_directory(
        str(pdf_dir),
        filename,
        mimetype="application/pdf",
        as_attachment=False
    )


def load_latest_report():
    report_files = sorted(
        (BASE_DIR / "reports").glob("report_*.json"),
        key=lambda file: file.stat().st_mtime,
        reverse=True
    )

    if not report_files:
        return None, None

    latest_report = report_files[0]

    with open(latest_report, "r") as file:
        report = json.load(file)

    return report, latest_report



@app.route("/api/security", methods=["GET"])
def get_security_data():
    """Read the latest collected VM settings without running a scan."""
    import re

    results_dir = BASE_DIR / "scan_results"
    specs = [
        ("permit_root_login", "CSPM-SSH-001", "Root login", "SSH", "HIGH", "no", "text",
         "Set PermitRootLogin no."),
        ("password_authentication", "CSPM-SSH-002", "Password authentication", "SSH", "HIGH", "no", "text",
         "Set PasswordAuthentication no and use approved SSH keys."),
        ("permit_empty_passwords", "CSPM-SSH-003", "Empty passwords", "SSH", "HIGH", "no", "text",
         "Set PermitEmptyPasswords no."),
        ("ignore_rhosts", "CSPM-SSH-004", "Ignore rhosts", "SSH", "MEDIUM", "yes", "text",
         "Set IgnoreRhosts yes."),
        ("x11_forwarding", "CSPM-SSH-005", "X11 forwarding", "SSH", "MEDIUM", "no", "text",
         "Set X11Forwarding no unless it is explicitly required."),
        ("log_level", "CSPM-SSH-006", "SSH logging level", "SSH", "LOW", "INFO", "text",
         "Set LogLevel INFO or a more detailed approved level."),
        ("login_grace_time", "CSPM-SSH-007", "Login grace time", "SSH", "MEDIUM", "60", "max",
         "Set LoginGraceTime to 60 seconds or less."),
        ("max_auth_tries", "CSPM-SSH-008", "Maximum authentication attempts", "SSH", "MEDIUM", "4", "max",
         "Set MaxAuthTries to 4 or less."),
        ("client_alive_interval", "CSPM-SSH-009", "Client alive interval", "SSH", "LOW", "300", "max",
         "Set ClientAliveInterval to 300 seconds or less."),
        ("pass_max_days", "CSPM-AUTH-001", "Maximum password age", "Password Policy", "MEDIUM", "90", "max",
         "Set the maximum password age to 90 days or less."),
        ("passwd_perms", "CSPM-FILE-001", "Password file permissions", "File Permissions", "HIGH", "644", "mode",
         "Review /etc/passwd permissions and apply the approved mode."),
        ("shadow_perms", "CSPM-FILE-002", "Shadow file permissions", "File Permissions", "HIGH", "640", "mode",
         "Review /etc/shadow permissions and restrict access."),
        ("suid_dumpable", "CSPM-KERNEL-001", "SUID dumpable", "Kernel", "HIGH", "0", "number",
         "Set fs.suid_dumpable to 0."),
        ("ufw_status", "CSPM-FW-001", "Host firewall", "Firewall", "HIGH", "active", "active",
         "Enable and configure UFW according to the approved firewall policy."),
        ("unattended_upgrades", "CSPM-UPD-001", "Automatic security updates", "Updates", "MEDIUM", "enabled", "enabled",
         "Enable unattended security updates."),
    ]

    rules = []
    if results_dir.exists():
        for file in sorted(results_dir.glob("*.json")):
            try:
                values = json.loads(file.read_text())
            except (OSError, json.JSONDecodeError):
                continue

            host = str(values.get("hostname") or file.stem)
            for key, rid, name, category, severity, expected, kind, fix in specs:
                raw = values.get(key)
                actual = "" if raw is None else str(raw).strip()
                status = "UNKNOWN"

                if raw is not None:
                    if kind == "text":
                        observed = actual.split()[-1].lower() if actual else ""
                        status = "PASS" if observed == expected.lower() else "FAIL"
                    elif kind in ("max", "number"):
                        match = re.search(r"-?\d+\s*$", actual)
                        if match:
                            number = int(match.group())
                            status = ("PASS" if number <= int(expected) else "FAIL") if kind == "max" else ("PASS" if number == int(expected) else "FAIL")
                    elif kind == "mode":
                        match = re.search(r"\b0?([0-7]{3,4})\s*$", actual)
                        if match:
                            status = "PASS" if match.group(1)[-3:] == expected else "FAIL"
                    elif kind == "active":
                        status = "PASS" if re.search(r"\bactive\b", actual, re.I) and not re.search(r"inactive|not active", actual, re.I) else "FAIL"
                    elif kind == "enabled":
                        status = "PASS" if re.search(r"\benabled\b", actual, re.I) else "FAIL"

                rules.append({
                    "hostname": host,
                    "rule_id": rid,
                    "name": name,
                    "category": category,
                    "severity": severity,
                    "expected": expected,
                    "actual": actual if actual else "not reported",
                    "status": status,
                    "remediation": fix,
                })

    timestamp = None
    reports_dir = BASE_DIR / "reports"
    if reports_dir.exists():
        reports = sorted(reports_dir.glob("report_*.json"), key=lambda p: p.stat().st_mtime)
        if reports:
            try:
                timestamp = json.loads(reports[-1].read_text()).get("timestamp")
            except (OSError, json.JSONDecodeError):
                pass
    return jsonify({
        "timestamp": timestamp,
        "rules": rules,
        "total_violations": sum(
            r["status"] == "FAIL" for r in rules
        ),
        "hosts": sorted(set(r["hostname"] for r in rules)),
        "source": "scan_results",
        "scanner": {
            "name": "SENTINELFORGE",
            "version": "Not configured"
        },
        "framework": (
            "CIS-aligned policy"
            if (BASE_DIR / "opa" / "cis.rego").is_file()
            else "Not configured"
        ),
        "controller": {
            "hostname": platform.node(),
            "operating_system": platform.system(),
            "os_release": platform.release()
        }
    })

@app.route("/api/compliance")
def compliance():
    try:
        # Get the newest scan report
        report, report_path = load_latest_report()

        if report is None:
            return jsonify({
                "success": False,
                "error": "No scan report found"
            }), 404

        # Get hosts from the report
        hosts = report.get("hosts", {})

        # Count the actual number of rules in cis.rego
        rule_file = BASE_DIR / "opa" / "cis.rego"

        rule_text = rule_file.read_text(encoding="utf-8")

        rules_per_vm = rule_text.count("deny contains msg if")

        # Number of VMs
        vm_count = len(hosts)

        # Total checks = rules × VMs
        total_checks = rules_per_vm * vm_count

        # Count failed checks
        fail_count = sum(
            len(violations)
            for violations in hosts.values()
        )

        # Remaining checks are passing
        pass_count = max(total_checks - fail_count, 0)

        # Current scanner does not have an INFO state
        info_count = 0

        # Calculate compliance percentage
        if total_checks > 0:
            compliance_score = round(
                (pass_count / total_checks) * 100,
                2
            )
        else:
            compliance_score = 0

        # Per-VM results
        host_summary = {}

        for vm, violations in hosts.items():

            failed = len(violations)

            passed = max(
                rules_per_vm - failed,
                0
            )

            if rules_per_vm > 0:
                vm_score = round(
                    (passed / rules_per_vm) * 100,
                    2
                )
            else:
                vm_score = 0

            host_summary[vm] = {
                "checks": rules_per_vm,
                "pass": passed,
                "fail": failed,
                "info": 0,
                "compliance_score": vm_score,
                "violations": violations
            }

        return jsonify({
            "success": True,

            "framework": "CIS-aligned",

            "target": "Linux",

            "timestamp": report.get("timestamp"),

            "summary": {
                "total_checks": total_checks,
                "pass": pass_count,
                "fail": fail_count,
                "info": info_count,
                "compliance_score": compliance_score
            },

            "hosts": host_summary
        })

    except Exception as e:

        return jsonify({
            "success": False,
            "error": str(e)
        }), 500


@app.route("/api/prepare-demo", methods=["POST"])
def prepare_demo():

    result = run_command([
        "ansible-playbook",
        "-i",
        str(BASE_DIR / "ansible" / "inventory.ini"),
        str(BASE_DIR / "ansible" / "misconfigure.yml")
    ])

    return jsonify(result)

@app.route("/api/scan", methods=["POST"])
def scan():

    # Step 1: Intentionally misconfigure the VMs for the demo
    prepare_result = run_command([
        "ansible-playbook",
        "-i",
        str(BASE_DIR / "ansible" / "inventory.ini"),
        str(BASE_DIR / "ansible" / "misconfigure.yml")
    ])

    if not prepare_result["success"]:
        return jsonify({
            "success": False,
            "stage": "prepare-demo",
            "error": prepare_result
        }), 500

    # Step 2: Run the real CSPM scan
    scan_result = run_command([
        "python3",
        str(BASE_DIR / "detect.py")
    ])

    return jsonify({
        "success": scan_result["success"],
        "prepare": prepare_result,
        "scan": scan_result
    })

@app.route("/api/remediate", methods=["POST"])
def remediate():

    reports_dir = BASE_DIR / "reports"
    reports_dir.mkdir(exist_ok=True)

    # Remember reports that already existed before this remediation run.
    existing_reports = {
        p.resolve()
        for p in reports_dir.glob("report_*.json")
    }

    # Run the real CSPM remediation engine.
    result = run_command([
        "python3",
        str(BASE_DIR / "detect.py"),
        "--fix"
    ])

    if not result["success"]:
        return jsonify({
            "success": False,
            "status": "failed",
            "error": result["stderr"] or result["stdout"],
            "stdout": result["stdout"],
            "stderr": result["stderr"],
            "returncode": result["returncode"]
        }), 500

    # Find reports created by THIS remediation execution.
    new_reports = sorted(
        [
            p for p in reports_dir.glob("report_*.json")
            if p.resolve() not in existing_reports
        ],
        key=lambda p: p.stat().st_mtime
    )

    # A normal --fix run with violations should create:
    #   1. BEFORE report
    #   2. AFTER verification report
    if len(new_reports) >= 2:

        before_path = new_reports[-2]
        after_path = new_reports[-1]

    elif len(new_reports) == 1:

        # No remediation was necessary, so detect.py only created
        # one report.
        before_path = new_reports[0]
        after_path = new_reports[0]

    else:
        return jsonify({
            "success": False,
            "status": "failed",
            "error": "No new CSPM report was generated."
        }), 500

    try:
        with open(before_path, "r") as f:
            before_report = json.load(f)

        with open(after_path, "r") as f:
            after_report = json.load(f)

    except (OSError, json.JSONDecodeError) as e:
        return jsonify({
            "success": False,
            "status": "failed",
            "error": f"Unable to read remediation reports: {e}"
        }), 500

    before_total = int(
        before_report.get("total_violations", 0)
    )

    after_total = int(
        after_report.get("total_violations", 0)
    )

    before_hosts = before_report.get("hosts", {})
    after_hosts = after_report.get("hosts", {})

    before_affected_vms = sum(
        1 for violations in before_hosts.values()
        if violations
    )

    after_affected_vms = sum(
        1 for violations in after_hosts.values()
        if violations
    )

    fixes_applied = max(
        before_total - after_total,
        0
    )

    verification = after_total == 0

    if verification:
        status = "completed"
    elif fixes_applied > 0:
        status = "partial"
    else:
        status = "failed"

    return jsonify({
        "success": True,
        "status": status,

        "before": {
            "total_violations": before_total,
            "affected_vms": before_affected_vms
        },

        "after": {
            "total_violations": after_total,
            "affected_vms": after_affected_vms
        },

        "fixes_applied": fixes_applied,
        "remaining_violations": after_total,
        "verification": verification,

        "before_report": str(before_path.name),
        "after_report": str(after_path.name),

        "stdout": result["stdout"],
        "stderr": result["stderr"]
    })

if __name__ == "__main__":
    app.run(
        host="0.0.0.0",
        port=5000,
        debug=True
    )
