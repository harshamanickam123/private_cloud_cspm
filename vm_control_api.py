from flask import Flask, jsonify
from flask_cors import CORS
import subprocess
import json
from pathlib import Path

app = Flask(__name__)
CORS(app)

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


@app.route("/api/test")
def test():
    return jsonify({
        "success": True,
        "message": "API connection working"
    })


@app.route("/api/vms")
def list_vms():
    result = run_command(["virsh", "list", "--all"])

    return jsonify(result)


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

    result = run_command([
        "virsh",
        "dominfo",
        vm_name
    ])

    return jsonify(result)

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

    result = run_command([
        "python3",
        str(BASE_DIR / "detect.py"),
        "--fix"
    ])

    return jsonify(result)


if __name__ == "__main__":
    app.run(
        host="0.0.0.0",
        port=5000,
        debug=True
    )
