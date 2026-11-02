import json
from datetime import datetime
from pathlib import Path

from flask import Blueprint, jsonify, request

drift_api = Blueprint("drift_api", __name__)

BASE_DIR = Path(__file__).resolve().parent

VM_NAMES = ["vm1", "vm2"]

MONITOR_DATA_DIR = BASE_DIR / "monitor_data" / "scan_results"
MONITOR_STATUS_FILE = BASE_DIR / "reports" / "monitoring" / "monitor_status.json"

DRIFT_DATA_DIR = BASE_DIR / "drift_data"
BASELINE_DIR = DRIFT_DATA_DIR / "baselines"
SNAPSHOT_DIR = DRIFT_DATA_DIR / "snapshots"
HISTORY_DIR = DRIFT_DATA_DIR / "history"

CONFIG_FIELDS = {
    "permit_root_login",
    "password_authentication",
    "max_auth_tries",
    "x11_forwarding",
    "permit_empty_passwords",
    "ignore_rhosts",
    "client_alive_interval",
    "ufw_status",
    "unattended_upgrades",
    "pass_max_days",
    "login_grace_time",
    "log_level",
    "passwd_perms",
    "shadow_perms",
    "suid_dumpable",
}

def read_json_file(path):
    """Read and validate a JSON file."""
    try:
        with path.open("r", encoding="utf-8") as file:
            return json.load(file)
    except FileNotFoundError:
        return None
    except (json.JSONDecodeError, OSError):
        return None


def get_monitoring_status():
    """Read the background monitoring status."""
    return read_json_file(MONITOR_STATUS_FILE)


def get_current_configurations():
    """Read actual configuration data collected from both VMs."""
    configurations = {}

    for vm_name in VM_NAMES:
        file_path = MONITOR_DATA_DIR / f"{vm_name}.json"
        data = read_json_file(file_path)

        if not isinstance(data, dict):
            return None, f"Configuration unavailable for {vm_name}"

        if data.get("hostname") != vm_name:
            return None, f"Hostname validation failed for {vm_name}"

        missing_fields = CONFIG_FIELDS - data.keys()

        if missing_fields:
            return None, (
                f"Missing configuration fields for {vm_name}: "
                f"{', '.join(sorted(missing_fields))}"
            )

        configurations[vm_name] = data

    return configurations, None


def monitoring_is_fresh():
    """Check whether the latest monitoring scan succeeded recently."""
    status = get_monitoring_status()

    if not isinstance(status, dict):
        return False, "Monitoring status is unavailable"

    if status.get("scan_state") != "success":
        return False, "Latest monitoring scan was not successful"

    if status.get("hosts_scanned") != len(VM_NAMES):
        return False, "Monitoring did not successfully scan both VMs"

    last_scan = status.get("last_scan")

    if not last_scan:
        return False, "Last successful scan timestamp is missing"

    try:
        scan_time = datetime.fromisoformat(last_scan)
        age_seconds = (
            datetime.now(scan_time.tzinfo) - scan_time
        ).total_seconds()

        if age_seconds < 0 or age_seconds > 600:
            return False, "Monitoring data is stale"

    except (ValueError, TypeError):
        return False, "Invalid monitoring timestamp"

    return True, None
# ---------------------------------------------------------
# BASELINE PROPOSAL
# ---------------------------------------------------------

# Proposed secure configuration values for review.
# These are proposed targets, not automatically approved settings.
# Some values are stricter targets than the exact OPA policy conditions.

PROPOSED_BASELINE = {
    "permit_root_login": "permitrootlogin no",
    "password_authentication": "passwordauthentication no",
    "max_auth_tries": "maxauthtries 4",
    "x11_forwarding": "x11forwarding no",
    "permit_empty_passwords": "permitemptypasswords no",
    "ignore_rhosts": "ignorerhosts yes",
    "client_alive_interval": "clientaliveinterval 300",
    "ufw_status": "Status: active",
    "unattended_upgrades": "enabled",
    "pass_max_days": "90",
    "login_grace_time": "logingracetime 60",
    "log_level": "loglevel INFO",
    "passwd_perms": "644",
    "shadow_perms": "640",
    "suid_dumpable": "0",
}


@drift_api.route("/api/drift/baseline/proposal", methods=["GET"])
def get_baseline_proposal():
    """
    Return proposed baseline values for review.

    This endpoint does not save or apply any configuration.
    """

    proposed_vms = {}

    for vm_name in VM_NAMES:
        proposed_vms[vm_name] = {
            "hostname": vm_name,
            "configuration": PROPOSED_BASELINE.copy()
        }

    return jsonify({
        "success": True,
        "baseline_status": "proposal_only",
        "approved": False,
        "message": "Baseline proposal is ready for review. Nothing has been saved or applied.",
        "vms": proposed_vms,
        "total_configuration_checks": len(CONFIG_FIELDS),
        "note": (
            "Review these proposed values before approving a baseline. "
            "They are targets for comparison only and will not modify VM configurations."
        )
    }), 200
# ---------------------------------------------------------
# BASELINE STORAGE AND VALIDATION
# ---------------------------------------------------------

def validate_baseline(configuration):
    """
    Validate that a baseline contains exactly the required
    configuration fields and that every value is a string.
    """

    if not isinstance(configuration, dict):
        return False, "Baseline configuration must be a JSON object"

    missing_fields = CONFIG_FIELDS - configuration.keys()
    extra_fields = configuration.keys() - CONFIG_FIELDS

    if missing_fields:
        return False, (
            f"Missing fields: {', '.join(sorted(missing_fields))}"
        )

    if extra_fields:
        return False, (
            f"Unexpected fields: {', '.join(sorted(extra_fields))}"
        )

    for field, value in configuration.items():
        if not isinstance(value, str) or not value.strip():
            return False, f"Invalid value for {field}"

    return True, None


def read_approved_baseline(vm_name):
    """
    Read an approved baseline for a specific VM.
    """

    if vm_name not in VM_NAMES:
        return None

    baseline_file = BASELINE_DIR / f"{vm_name}_baseline.json"
    baseline = read_json_file(baseline_file)

    if not isinstance(baseline, dict):
        return None

    if baseline.get("hostname") != vm_name:
        return None

    if baseline.get("approved") is not True:
        return None

    configuration = baseline.get("configuration")
    valid, error = validate_baseline(configuration)

    if not valid:
        return None

    return baseline


def get_all_approved_baselines():
    """
    Read approved baselines for all configured VMs.
    """

    baselines = {}

    for vm_name in VM_NAMES:
        baseline = read_approved_baseline(vm_name)

        if baseline is not None:
            baselines[vm_name] = baseline

    return baselines
# ---------------------------------------------------------
# BASELINE APPROVAL API
# ---------------------------------------------------------

@drift_api.route("/api/drift/baseline/approve", methods=["POST"])
def approve_baseline():
    """
    Save approved baselines for both VMs.

    This endpoint only saves comparison reference values.
    It never changes VM configurations.
    """

    payload = request.get_json(silent=True)

    if not isinstance(payload, dict):
        return jsonify({
            "success": False,
            "error": "A valid JSON request body is required."
        }), 400

    if payload.get("approved") is not True:
        return jsonify({
            "success": False,
            "error": "Explicit approval is required."
        }), 400

    vm_baselines = payload.get("vms")

    if not isinstance(vm_baselines, dict):
        return jsonify({
            "success": False,
            "error": "The vms field must contain baseline configurations."
        }), 400

    if set(vm_baselines.keys()) != set(VM_NAMES):
        return jsonify({
            "success": False,
            "error": "Baseline data must be provided for both vm1 and vm2."
        }), 400

    # Validate both VM configurations before writing anything.
    validated_configs = {}

    for vm_name in VM_NAMES:
        vm_data = vm_baselines[vm_name]

        if not isinstance(vm_data, dict):
            return jsonify({
                "success": False,
                "error": f"Invalid baseline object for {vm_name}."
            }), 400

        if vm_data.get("hostname") != vm_name:
            return jsonify({
                "success": False,
                "error": f"Hostname mismatch for {vm_name}."
            }), 400

        configuration = vm_data.get("configuration")
        valid, error = validate_baseline(configuration)

        if not valid:
            return jsonify({
                "success": False,
                "error": f"Invalid baseline for {vm_name}: {error}"
            }), 400

        validated_configs[vm_name] = configuration

    # Prepare baseline records.
    approval_time = datetime.now().astimezone().isoformat()

    records = {}

    for vm_name in VM_NAMES:
        records[vm_name] = {
            "hostname": vm_name,
            "approved": True,
            "approved_at": approval_time,
            "configuration": validated_configs[vm_name]
        }

    # Create storage directory only after validation succeeds.
    BASELINE_DIR.mkdir(parents=True, exist_ok=True)

    # Preserve existing files so a failed write can be rolled back.
    previous_files = {}

    for vm_name in VM_NAMES:
        baseline_file = BASELINE_DIR / f"{vm_name}_baseline.json"

        if baseline_file.exists():
            previous_files[vm_name] = baseline_file.read_bytes()
        else:
            previous_files[vm_name] = None

    written_files = []

    try:
        for vm_name in VM_NAMES:
            baseline_file = BASELINE_DIR / f"{vm_name}_baseline.json"
            temporary_file = BASELINE_DIR / f".{vm_name}_baseline.tmp"

            temporary_file.write_text(
                json.dumps(records[vm_name], indent=2),
                encoding="utf-8"
            )

            temporary_file.replace(baseline_file)
            written_files.append(vm_name)

    except OSError as error:
        # Roll back files already written.
        for vm_name in written_files:
            baseline_file = BASELINE_DIR / f"{vm_name}_baseline.json"
            previous_content = previous_files[vm_name]

            if previous_content is None:
                baseline_file.unlink(missing_ok=True)
            else:
                baseline_file.write_bytes(previous_content)

        return jsonify({
            "success": False,
            "error": f"Could not save both baselines: {error}",
            "message": "Previous baseline files were restored where possible."
        }), 500

    return jsonify({
        "success": True,
        "baseline_status": "approved",
        "approved": True,
        "approved_at": approval_time,
        "saved_vms": VM_NAMES,
        "total_configuration_checks": len(CONFIG_FIELDS),
        "message": (
            "Approved baselines saved successfully. "
            "No VM configuration was changed."
        )
    }), 201



# ---------------------------------------------------------
# START NEW DEMO CYCLE
# ---------------------------------------------------------

@drift_api.route("/api/drift/baseline/new-cycle", methods=["POST"])
def start_new_demo_cycle():
    """
    Reset current baseline approval for a new demo cycle.

    This removes only the approved baseline reference files.
    It does not modify VMs or delete snapshots/history.
    """

    payload = request.get_json(silent=True)

    if not isinstance(payload, dict) or payload.get("confirm") is not True:
        return jsonify({
            "success": False,
            "error": "Explicit confirmation is required to start a new demo cycle."
        }), 400

    BASELINE_DIR.mkdir(parents=True, exist_ok=True)

    previous_files = {}

    for vm_name in VM_NAMES:
        baseline_file = BASELINE_DIR / f"{vm_name}_baseline.json"
        previous_files[vm_name] = (
            baseline_file.read_bytes() if baseline_file.exists() else None
        )

    try:
        for vm_name in VM_NAMES:
            baseline_file = BASELINE_DIR / f"{vm_name}_baseline.json"
            baseline_file.unlink(missing_ok=True)

    except OSError as error:
        # Restore both previous baseline files if reset fails.
        rollback_errors = []

        for vm_name, previous_content in previous_files.items():
            if previous_content is None:
                continue

            baseline_file = BASELINE_DIR / f"{vm_name}_baseline.json"
            temporary_file = BASELINE_DIR / f".{vm_name}_baseline.restore.tmp"

            try:
                temporary_file.write_bytes(previous_content)
                temporary_file.replace(baseline_file)
            except OSError as restore_error:
                rollback_errors.append(f"{vm_name}: {restore_error}")

        return jsonify({
            "success": False,
            "error": f"Could not reset the demo cycle: {error}",
            "rollback_errors": rollback_errors
        }), 500

    return jsonify({
        "success": True,
        "baseline_status": "approval_required",
        "message": (
            "A new demo cycle has started. Review and approve the proposed "
            "baselines for both VMs before running drift detection. "
            "Existing snapshots and history have been preserved."
        ),
        "reset_vms": VM_NAMES
    }), 200

# ---------------------------------------------------------
# DRIFT COMPARISON ENGINE
# ---------------------------------------------------------

def compare_vm_configuration(vm_name, current_config, baseline):
    """
    Compare current VM configuration with its approved baseline.

    Return all configuration comparisons and preserve drift_items
    for compatibility with existing API consumers.
    """

    baseline_config = baseline.get("configuration", {})

    drift_items = []
    configuration_comparison = []

    for field in sorted(CONFIG_FIELDS):
        baseline_value = baseline_config.get(field)
        current_value = current_config.get(field)

        if baseline_value == current_value:
            status = "match"
        else:
            status = "drift_detected"

            drift_items.append({
                "field": field,
                "baseline_value": baseline_value,
                "current_value": current_value,
                "status": status
            })

        configuration_comparison.append({
            "field": field,
            "baseline_value": baseline_value,
            "current_value": current_value,
            "status": status
        })

    return {
        "hostname": vm_name,
        "total_checks": len(CONFIG_FIELDS),
        "drift_count": len(drift_items),
        "matching_count": len(CONFIG_FIELDS) - len(drift_items),
        "drift_detected": len(drift_items) > 0,
        "drift_items": drift_items,
        "configuration_comparison": configuration_comparison
    }
def detect_vm_drift():
    """
    Detect configuration drift across all configured VMs.

    Requires fresh monitoring data and approved baselines.
    Does not modify VM configurations.
    """

    # Check monitoring freshness first.
    fresh, error = monitoring_is_fresh()

    if not fresh:
        return None, error

    # Load actual VM configurations.
    current_configs, error = get_current_configurations()

    if current_configs is None:
        return None, error

    # Load approved baselines.
    approved_baselines = get_all_approved_baselines()

    missing_baselines = [
        vm_name
        for vm_name in VM_NAMES
        if vm_name not in approved_baselines
    ]

    if missing_baselines:
        return None, (
            "Approved baseline missing for: "
            + ", ".join(missing_baselines)
        )

    results = {}

    for vm_name in VM_NAMES:
        results[vm_name] = compare_vm_configuration(
            vm_name,
            current_configs[vm_name],
            approved_baselines[vm_name]
        )

    total_checks = sum(
        result["total_checks"]
        for result in results.values()
    )

    total_drift = sum(
        result["drift_count"]
        for result in results.values()
    )

    return {
        "success": True,
        "baseline_status": "approved",
        "total_vms": len(VM_NAMES),
        "total_checks": total_checks,
        "total_drift": total_drift,
        "matching_checks": total_checks - total_drift,
        "drift_detected": total_drift > 0,
        "hosts": results
    }, None
# ---------------------------------------------------------
# DRIFT DETECTION API
# ---------------------------------------------------------

@drift_api.route("/api/drift/detect", methods=["GET"])
def run_drift_detection():

    """
    Return drift detection results using the latest monitoring data.

    This endpoint is read-only.
    It does not trigger a new VM scan or modify VM configurations.
    """

    result, error = detect_vm_drift()

    if error:
        return jsonify({
            "success": False,
            "error": error
        }), 400

    return jsonify(result), 200


# =========================================================
# SNAPSHOT STORAGE AND HISTORICAL COMPARISON
# =========================================================

def save_snapshot_record(record):
    """Persist a snapshot atomically."""
    SNAPSHOT_DIR.mkdir(parents=True, exist_ok=True)

    target = SNAPSHOT_DIR / f"{record['snapshot_id']}.json"
    temporary = SNAPSHOT_DIR / f".{record['snapshot_id']}.tmp"

    temporary.write_text(
        json.dumps(record, indent=2),
        encoding="utf-8"
    )
    temporary.replace(target)

    return target


def read_all_snapshots():
    """Return valid stored snapshot records, newest first."""
    if not SNAPSHOT_DIR.exists():
        return []

    records = []

    for path in SNAPSHOT_DIR.glob("snapshot_*.json"):
        record = read_json_file(path)

        if not isinstance(record, dict):
            continue

        if not isinstance(record.get("hosts"), dict):
            continue

        records.append(record)

    return sorted(
        records,
        key=lambda item: item.get("created_at", ""),
        reverse=True
    )


def find_snapshot(snapshot_id):
    """Find a snapshot by its exact stored ID."""
    if not isinstance(snapshot_id, str) or not snapshot_id.startswith("snapshot_"):
        return None

    path = SNAPSHOT_DIR / f"{snapshot_id}.json"

    if not path.is_file():
        return None

    record = read_json_file(path)

    if not isinstance(record, dict):
        return None

    if record.get("snapshot_id") != snapshot_id:
        return None

    return record


@drift_api.route("/api/drift/snapshots", methods=["POST"])
def create_drift_snapshot():
    """
    Capture the latest successful monitoring configuration.
    This does not start a scan or modify a VM.
    """
    fresh, error = monitoring_is_fresh()

    if not fresh:
        return jsonify({
            "success": False,
            "error": error
        }), 409

    configurations, error = get_current_configurations()

    if configurations is None:
        return jsonify({
            "success": False,
            "error": error
        }), 409

    monitor_status = get_monitoring_status()
    source_scan_at = monitor_status.get("last_scan")

    # Avoid saving duplicate snapshots from the same monitoring scan.
    for existing in read_all_snapshots():
        if existing.get("source_scan_at") == source_scan_at:
            return jsonify({
                "success": True,
                "duplicate": True,
                "snapshot": existing,
                "message": "A snapshot already exists for this monitoring scan."
            }), 200

    from uuid import uuid4

    created_at = datetime.now().astimezone().isoformat()
    snapshot_id = (
        "snapshot_"
        + datetime.now().strftime("%Y%m%d_%H%M%S")
        + "_"
        + uuid4().hex[:8]
    )

    record = {
        "snapshot_id": snapshot_id,
        "created_at": created_at,
        "source_scan_at": source_scan_at,
        "source": "SentinelForge background monitoring",
        "total_vms": len(VM_NAMES),
        "configuration_fields": len(CONFIG_FIELDS),
        "hosts": {
            vm_name: {
                "hostname": vm_name,
                "configuration": {
                    field: configurations[vm_name][field]
                    for field in sorted(CONFIG_FIELDS)
                }
            }
            for vm_name in VM_NAMES
        }
    }

    try:
        save_snapshot_record(record)
    except OSError as exc:
        return jsonify({
            "success": False,
            "error": f"Snapshot could not be saved: {exc}"
        }), 500

    return jsonify({
        "success": True,
        "duplicate": False,
        "snapshot": record,
        "message": "Snapshot saved successfully. No VM configuration was changed."
    }), 201


@drift_api.route("/api/drift/snapshots", methods=["GET"])
def list_drift_snapshots():
    """List stored snapshots, optionally filtered by VM."""
    vm_filter = request.args.get("vm")

    if vm_filter and vm_filter not in VM_NAMES:
        return jsonify({
            "success": False,
            "error": "Unknown VM filter."
        }), 400

    output = []

    for record in read_all_snapshots():
        for vm_name, host in record["hosts"].items():
            if vm_filter and vm_name != vm_filter:
                continue

            output.append({
                "snapshot_id": record.get("snapshot_id"),
                "created_at": record.get("created_at"),
                "source_scan_at": record.get("source_scan_at"),
                "hostname": vm_name,
                "configuration_fields": len(
                    host.get("configuration", {})
                )
            })

    return jsonify({
        "success": True,
        "total_snapshots": len(output),
        "snapshots": output
    }), 200


@drift_api.route("/api/drift/snapshots/<snapshot_id>", methods=["GET"])
def get_drift_snapshot(snapshot_id):
    """Return the full contents of a stored snapshot."""
    record = find_snapshot(snapshot_id)

    if record is None:
        return jsonify({
            "success": False,
            "error": "Snapshot not found."
        }), 404

    return jsonify({
        "success": True,
        "snapshot": record
    }), 200


@drift_api.route("/api/drift/snapshot-comparison", methods=["GET"])
def compare_drift_snapshots():
    """Compare two snapshots belonging to the same VM."""
    older_id = request.args.get("older")
    newer_id = request.args.get("newer")
    vm_name = request.args.get("vm")

    if vm_name not in VM_NAMES:
        return jsonify({
            "success": False,
            "error": "A valid vm parameter is required."
        }), 400

    older = find_snapshot(older_id)
    newer = find_snapshot(newer_id)

    if older is None or newer is None:
        return jsonify({
            "success": False,
            "error": "One or both snapshots were not found."
        }), 404

    older_host = older.get("hosts", {}).get(vm_name)
    newer_host = newer.get("hosts", {}).get(vm_name)

    if not isinstance(older_host, dict) or not isinstance(newer_host, dict):
        return jsonify({
            "success": False,
            "error": "Both snapshots must contain the selected VM."
        }), 400

    old_config = older_host.get("configuration", {})
    new_config = newer_host.get("configuration", {})

    changes = []

    for field in sorted(CONFIG_FIELDS):
        old_value = old_config.get(field)
        new_value = new_config.get(field)

        if old_value != new_value:
            changes.append({
                "field": field,
                "older_value": old_value,
                "newer_value": new_value,
                "status": "changed"
            })

    return jsonify({
        "success": True,
        "hostname": vm_name,
        "older_snapshot": {
            "snapshot_id": older_id,
            "created_at": older.get("created_at")
        },
        "newer_snapshot": {
            "snapshot_id": newer_id,
            "created_at": newer.get("created_at")
        },
        "total_checks": len(CONFIG_FIELDS),
        "changed_count": len(changes),
        "unchanged_count": len(CONFIG_FIELDS) - len(changes),
        "changes": changes,
        "message": (
            "No configuration changes between snapshots."
            if not changes
            else "Configuration changes were found between snapshots."
        )
    }), 200


@drift_api.route("/api/drift/history", methods=["GET"])
def get_drift_history():
    """Return snapshot history grouped by VM."""
    records = read_all_snapshots()
    history = {vm_name: [] for vm_name in VM_NAMES}

    for record in records:
        for vm_name in VM_NAMES:
            host = record.get("hosts", {}).get(vm_name)

            if not isinstance(host, dict):
                continue

            history[vm_name].append({
                "snapshot_id": record.get("snapshot_id"),
                "created_at": record.get("created_at"),
                "source_scan_at": record.get("source_scan_at"),
                "configuration_fields": len(
                    host.get("configuration", {})
                )
            })

    return jsonify({
        "success": True,
        "total_snapshots": sum(
            len(items) for items in history.values()
        ),
        "history": history
    }), 200



@drift_api.route("/api/drift/status", methods=["GET"])
def get_drift_page_status():
    """Return live monitoring, configuration and baseline availability."""
    fresh, freshness_error = monitoring_is_fresh()
    monitor_status = get_monitoring_status()
    configurations, config_error = get_current_configurations()
    baselines = get_all_approved_baselines()

    hosts = {}

    for vm_name in VM_NAMES:
        hosts[vm_name] = {
            "hostname": vm_name,
            "configuration_available": (
                configurations is not None
                and vm_name in configurations
            ),
            "baseline_approved": vm_name in baselines
        }

    return jsonify({
        "success": True,
        "monitoring_fresh": fresh,
        "monitoring_error": freshness_error,
        "configuration_available": configurations is not None,
        "configuration_error": config_error,
        "last_scan": (
            monitor_status.get("last_scan")
            if isinstance(monitor_status, dict)
            else None
        ),
        "hosts": hosts,
        "total_vms": len(VM_NAMES),
        "approved_baselines": len(baselines),
        "baseline_complete": len(baselines) == len(VM_NAMES)
    }), 200
