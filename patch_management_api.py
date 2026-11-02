"""SENTINELFORGE Patch Management API."""
from flask import Blueprint, jsonify, request
from pathlib import Path
import json
import re
import subprocess
import tempfile

patch_api = Blueprint("patch_management", __name__, url_prefix="/api")
BASE_DIR = Path(__file__).resolve().parent
ALLOWED_TARGETS = {"vm1", "vm2", "all"}


def get_target():
    body = request.get_json(silent=True) or {}
    target = body.get("target")

    if target not in ALLOWED_TARGETS:
        return None, (
            jsonify(
                success=False,
                error="Choose vm1, vm2, or all."
            ),
            400
        )

    return target, None


def get_vm_states():
    """Get actual VM power states from the local libvirt hypervisor."""
    states = {}

    for vm_name in ("vm1", "vm2"):
        try:
            result = subprocess.run(
                [
                    "virsh",
                    "-c", "qemu:///system",
                    "domstate", vm_name
                ],
                capture_output=True,
                text=True,
                timeout=10
            )

            if result.returncode != 0:
                states[vm_name] = {
                    "status": "unknown",
                    "detail": result.stderr.strip()
                }
                continue

            raw_state = result.stdout.strip().lower()

            if raw_state in ("shut off", "shutoff"):
                status = "stopped"
            elif raw_state == "running":
                status = "running"
            elif raw_state:
                status = raw_state.replace(" ", "_")
            else:
                status = "unknown"

            states[vm_name] = {
                "status": status,
                "detail": None
            }

        except (subprocess.TimeoutExpired, OSError) as exc:
            states[vm_name] = {
                "status": "unknown",
                "detail": str(exc)
            }

    return states


def run_patch_playbook(playbook_name, target="all", timeout=360):
    """Execute an existing Ansible playbook and collect its JSON results."""
    inventory = BASE_DIR / "ansible" / "inventory.ini"
    playbook = BASE_DIR / "ansible" / playbook_name

    if not inventory.is_file() or not playbook.is_file():
        return None, (
            jsonify(
                success=False,
                error=f"Missing inventory or playbook: {playbook_name}"
            ),
            500
        )

    try:
        with tempfile.TemporaryDirectory(
            prefix="sentinelforge_patch_"
        ) as output_dir:
            command = [
                "ansible-playbook",
                "-i", str(inventory),
                str(playbook),
                "--limit", "vm1,vm2" if target == "all" else target,
                "-e", f"patch_output_dir={output_dir}"
            ]

            result = subprocess.run(
                command,
                cwd=str(BASE_DIR),
                capture_output=True,
                text=True,
                timeout=timeout
            )

            hosts = {}

            for result_file in Path(output_dir).glob("*.json"):
                try:
                    hosts[result_file.stem] = json.loads(
                        result_file.read_text(encoding="utf-8")
                    )
                except (OSError, json.JSONDecodeError):
                    continue

            payload = {
                "success": result.returncode == 0 and bool(hosts),
                "target": target,
                "hosts": hosts,
                "ansible_output": result.stdout[-12000:],
                "error_output": result.stderr[-6000:],
                "returncode": result.returncode
            }

            if not payload["success"]:
                return payload, (jsonify(payload), 502)

            return payload, None

    except subprocess.TimeoutExpired:
        return None, (
            jsonify(
                success=False,
                error=f"{playbook_name} timed out."
            ),
            504
        )

    except Exception as exc:
        return None, (
            jsonify(success=False, error=str(exc)),
            500
        )


@patch_api.get("/patch-status")
def patch_status():
    """Read installed packages and available updates."""
    # Check actual VM power states before attempting SSH connections.
    vm_states = get_vm_states()

    running_vms = [
        name for name, details in vm_states.items()
        if details["status"] == "running"
    ]

    stopped_vms = [
        name for name, details in vm_states.items()
        if details["status"] == "stopped"
    ]

    if not running_vms:
        all_stopped = (
            len(stopped_vms) == len(vm_states)
            and bool(vm_states)
        )

        if all_stopped:
            message = (
                "Patch management is currently unavailable because "
                "all managed virtual machines are stopped."
            )
            action = (
                "Start your virtual machines and run the patch scan again."
            )
            status = "vms_unavailable"
        else:
            message = (
                "The virtual machine states could not be fully verified. "
                "Patch information cannot currently be collected."
            )
            action = (
                "Check the libvirt service and virtual machine states, "
                "then try again."
            )
            status = "vm_state_unavailable"

        return jsonify(
            success=False,
            status=status,
            message=message,
            action_required=action,
            vm_states=vm_states
        ), 503

    # Scan only VMs confirmed as running.
    target = ",".join(running_vms)

    result, error = run_patch_playbook(
        "patch_status.yml",
        target=target,
        timeout=180
    )

    if error:
        return error

    hosts = {}
    all_packages = []

    for key, raw in result["hosts"].items():
        if not isinstance(raw, dict):
            continue

        if "installed_packages" not in raw:
            continue

        installed = {}

        for line in raw.get("installed_packages", []):
            parts = str(line).split("\t")

            if len(parts) >= 3 and parts[2].strip().startswith("ii"):
                installed[parts[0].strip()] = parts[1].strip()

        upgradable = {}

        for line in raw.get("upgradable_packages", []):
            line = str(line).strip()

            match = re.match(r"^(\S+)/\S+\s+(\S+)", line)
            old_version = re.search(
                r"\[upgradable from:\s*(.*?)\]",
                line
            )

            if not match:
                continue

            package_name = match.group(1)

            upgradable[package_name] = {
                "latest_version": match.group(2),
                "installed_version": (
                    old_version.group(1)
                    if old_version
                    else installed.get(package_name, "unknown")
                ),
                "security_update": bool(
                    re.search(r"/[^ ]*security", line, re.IGNORECASE)
                )
            }

        package_rows = []

        for package_name, installed_version in installed.items():
            update = upgradable.get(package_name.split(":", 1)[0])

            package = {
                "vm_name": raw.get("vm_name", key),
                "name": package_name,
                "installed_version": installed_version,
                "latest_version": (
                    update["latest_version"]
                    if update else installed_version
                ),
                "status": "pending" if update else "installed",
                "security_update": (
                    update["security_update"] if update else False
                )
            }

            package_rows.append(package)
            all_packages.append(package)

        vm_name = raw.get("vm_name", key)

        security_status_text = raw.get(
            "security_update_status", ""
        )
        security_match = re.search(
            r"(\d+)\s+of these updates?\s+(?:is|are)\s+(?:a\s+)?standard security updates?",
            security_status_text.replace("\\n", "\n"),
            re.IGNORECASE
        )
        security_update_count = (
            int(security_match.group(1))
            if security_match
            else None
        )
        hosts[vm_name] = {
            "hostname": raw.get("hostname", "unknown"),
            "operating_system": raw.get(
                "operating_system", "unknown"
            ),
            "ip_address": raw.get("ip_address", "unknown"),
            "installed_package_count": len(installed),
            "available_update_count": len(upgradable),
            "security_update_count": security_update_count,
            "reboot_required": bool(
                raw.get("reboot_required", False)
            ),
            "apt_query_succeeded": bool(
                raw.get("apt_query_succeeded", False)
            ),
            "packages": package_rows
        }

    if not hosts:
        return jsonify(
            success=False,
            status="patch_scan_failed",
            message=(
                "The virtual machines are running, but patch information "
                "could not be retrieved. Check SSH connectivity and "
                "Ansible execution."
            ),
            vm_states=vm_states,
            ansible_output=result["ansible_output"],
            error_output=result["error_output"]
        ), 502

    summary = {
        "vm_count": len(hosts),
        "installed_packages": sum(
            host["installed_package_count"]
            for host in hosts.values()
        ),
        "available_updates": sum(
            host["available_update_count"]
            for host in hosts.values()
        ),
        "security_updates": sum(
            host["security_update_count"] or 0
            for host in hosts.values()
        ),
        "reboot_required_vms": sum(
            1 for host in hosts.values()
            if host["reboot_required"]
        )
    }

    return jsonify({
        "success": True,
        "status": "partial" if stopped_vms else "available",
        "message": (
            "Patch information collected from available VMs."
            if stopped_vms
            else "Patch information collected successfully."
        ),
        "action_required": (
            "Start the stopped VMs to retrieve complete patch information."
            if stopped_vms
            else None
        ),
        "vm_states": vm_states,
        "source": "ansible_read_only_patch_status",
        "cache_note": (
            "Uses the existing APT cache. This status operation "
            "does not refresh repository metadata."
        ),
        "summary": summary,
        "hosts": hosts,
        "packages": all_packages,

        # CIS-related score is deliberately not fabricated.
        "cis_patch_effectiveness": {
            "name": "CIS-aligned update effectiveness",
            "formula": "(M2 + M4) / M1 * 100",
            "status": "insufficient_evidence",
            "score_percent": None,
            "metrics": {
                "M1": None,
                "M2": None,
                "M4": None
            },
            "explanation": (
                "The score requires verified asset and exception "
                "evidence. Package inventory alone cannot establish "
                "all formula inputs."
            )
        }
    })


@patch_api.post("/patch-preview")
def patch_preview():
    """Preview proposed package changes without installing them."""
    target, error = get_target()

    if error:
        return error

    result, error = run_patch_playbook(
        "patch_preview.yml",
        target=target,
        timeout=600
    )

    if error:
        return error

    previews = []

    for key, raw in result["hosts"].items():
        output = raw.get("preview_stdout", "")

        proposed = [
            line.strip()
            for line in output.splitlines()
            if re.match(r"^(Inst|Conf|Remv)\s", line.strip())
        ]

        previews.append({
            "vm_name": raw.get("vm_name", key),
            "preview_succeeded": (
                raw.get("preview_succeeded") is True
            ),
            "proposed_changes": proposed,
            "simulation_output": output[-10000:],
            "error": raw.get("preview_stderr", "")
        })

    success = (
        bool(previews)
        and all(p["preview_succeeded"] for p in previews)
    )

    return jsonify({
        "success": success,
        "operation": "simulation_only",
        "target": target,
        "note": (
            "Preview does not install packages. Check the playbook "
            "to determine whether it refreshes APT metadata."
        ),
        "previews": previews
    }), (200 if success else 502)


@patch_api.post("/patch-install")
def patch_install():
    """Install updates only after explicit user confirmation."""
    body = request.get_json(silent=True) or {}
    target, error = get_target()

    if error:
        return error

    if body.get("confirm") is not True:
        return jsonify({
            "success": False,
            "error": "Explicit confirm=true is required."
        }), 400

    result, error = run_patch_playbook(
        "patch_install.yml",
        target=target,
        timeout=900
    )

    if error:
        return error

    return jsonify({
        "success": True,
        "operation": "standard_upgrade",
        "target": target,
        "note": (
            "Review the playbook to verify its exact package actions "
            "and reboot behavior."
        ),
        "hosts": result["hosts"],
        "ansible_output": result["ansible_output"],
        "error_output": result["error_output"]
    })


@patch_api.post("/patch-reboot")
def patch_reboot():
    """Reboot exactly one selected VM after explicit confirmation."""
    body = request.get_json(silent=True) or {}
    target = body.get("target")

    # Reboot must always target exactly one VM.
    if target not in {"vm1", "vm2"}:
        return jsonify({
            "success": False,
            "error": "Reboot is allowed only for vm1 or vm2. Select one VM."
        }), 400

    if body.get("confirm") is not True:
        return jsonify({
            "success": False,
            "error": "Explicit confirm=true is required before reboot."
        }), 400

    result, error = run_patch_playbook(
        "patch_reboot.yml",
        target=target,
        timeout=900
    )

    if error:
        return error

    host_result = result["hosts"].get(target, {})

    return jsonify({
        "success": result["success"],
        "operation": "vm_reboot",
        "target": target,
        "reboot_succeeded": host_result.get("reboot_succeeded", False),
        "reboot_required": host_result.get("reboot_required"),
        "reboot_verified": host_result.get("reboot_verified", False),
        "hosts": result["hosts"],
        "ansible_output": result["ansible_output"],
        "error_output": result["error_output"]
    }), 200
