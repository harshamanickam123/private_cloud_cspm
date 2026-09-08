# Auto-Remediating CSPM for Private Cloud

A Cloud Security Posture Management (CSPM) tool for private KVM-based infrastructure. It scans virtual machines against CIS security benchmarks using policy-as-code, and reports compliance violations in a structured, auditable format.

## Architecture

- **Ansible** connects to each managed VM over SSH and collects the current state of security-relevant configuration.
- **Open Policy Agent (OPA)**, using policies written in **Rego**, evaluates those facts against CIS Benchmark–derived rules.
- **detect.py** orchestrates the pipeline end-to-end and produces a timestamped compliance report.

## Tech Stack

- Virtualization: KVM, QEMU, libvirt
- Guest OS: Ubuntu Server 24.04 LTS
- Configuration scanning: Ansible
- Policy engine: Open Policy Agent (Rego)
- Orchestration: Python 3

## Prerequisites

- Ubuntu host with KVM/QEMU/libvirt configured
- Ansible
- OPA (/usr/local/bin/opa)
- Python 3

## Installation

pip3 install -r requirements.txt

Configure target VMs in ansible/inventory.ini.

## Usage

Run a full scan and policy evaluation:

python3 detect.py

Produces a timestamped compliance report under reports/.

Run policy unit tests:

opa test opa/

## Policies

Current CIS-derived checks:

- SSH root login must be disabled
- SSH password authentication must be disabled
- SSH MaxAuthTries must not exceed 4
- SSH X11 forwarding must be disabled
- SSH PermitEmptyPasswords must be disabled
- SSH IgnoreRhosts must be enabled
- SSH ClientAliveInterval must be set (nonzero)
- Host firewall must be active
- Automatic security updates must be enabled
- Password maximum age must not exceed 90 days

## Status

The full detect-and-remediate loop is complete and tested: scan → policy evaluation → report → automated remediation → re-scan verification. This is an evolving project — a persistent reporting dashboard, CI/CD, and infrastructure-as-code are planned as future work.
