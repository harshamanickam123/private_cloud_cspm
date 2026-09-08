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
- Host firewall must be active

## Status

The detection pipeline (scan → policy evaluation → report) is complete and tested. This is an evolving project — automated remediation, a persistent reporting dashboard, CI/CD, and infrastructure-as-code are planned as future work.
