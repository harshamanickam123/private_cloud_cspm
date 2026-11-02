// ============================================
// REAL AUTO-REMEDIATION
// Shows actual detected violations and runs
// the real ansible/remediate.yml via detect.py
// --fix, through vm_control_api.py.
// ============================================

const API_BASE = "http://localhost:5000";
const API_TOKEN = "change-this-demo-token";

let currentRules = [];

async function apiCall(path, options = {}) {
    const headers = Object.assign(
        { "X-API-Token": API_TOKEN, "Content-Type": "application/json" },
        options.headers || {}
    );
    const response = await fetch(API_BASE + path, Object.assign({}, options, { headers }));
    if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || ("HTTP " + response.status));
    }
    return response.json();
}

// ============================================
// LOAD REAL DETECTED VIOLATIONS
// ============================================

async function loadRemediationData() {
    const tbody = document.getElementById("remediationTable");

    try {
        const report = await apiCall("/api/report");
        const summary = report.summary || {};
        currentRules = report.rules || [];

        const failEl = document.getElementById("remFailCount");
        if (failEl) failEl.innerText = summary.fail || 0;

        const passEl = document.getElementById("remPassCount");
        if (passEl) passEl.innerText = summary.pass || 0;

        const failingRules = currentRules.filter(r => r.status === "FAIL");

        tbody.innerHTML = "";

        if (failingRules.length === 0) {
            tbody.innerHTML =
                '<tr><td colspan="6">No violations detected. All rules compliant on all hosts.</td></tr>';
            return;
        }

        failingRules.forEach((rule, i) => {
            const row = document.createElement("tr");
            row.innerHTML =
                '<td>' + rule.name + ' (' + rule.hostname + ')</td>' +
                '<td>' + rule.rule_id + '</td>' +
                '<td>ansible/remediate.yml</td>' +
                '<td><span class="badge info">' + rule.severity + '</span></td>' +
                '<td><span class="badge fail">DETECTED</span></td>' +
                '<td><div class="action-buttons">' +
                '<button class="rem-btn btn-review" onclick="showIssue(' + i + ')">' +
                '<i class="fa-solid fa-eye"></i> Review</button>' +
                '</div></td>';
            tbody.appendChild(row);
        });

        window._failingRules = failingRules;

    } catch (error) {
        console.error("Failed to load remediation data:", error);
        tbody.innerHTML =
            '<tr><td colspan="6">Unable to reach VM control API at ' + API_BASE +
            '. Is vm_control_api.py running?</td></tr>';
    }
}

// ============================================
// SHOW REAL ISSUE DETAILS
// ============================================

function showIssue(index) {
    const rule = (window._failingRules || [])[index];
    if (!rule) return;

    document.getElementById("issueDetails").classList.add("show");
    document.getElementById("issueTitle").innerText = rule.name + " Remediation Details";
    document.getElementById("issueRuleId").innerText = rule.rule_id;
    document.getElementById("issueExpected").innerText = rule.expected;
    document.getElementById("issueDetected").innerText = rule.actual;
    document.getElementById("issueRemediation").innerText = rule.remediation;
    document.getElementById("issueHost").innerText = rule.hostname;
}

// ============================================
// RUN REAL REMEDIATION (detect.py --fix)
// ============================================

async function runFullRemediation() {
    const logEl = document.getElementById("remediationLog");
    const statusEl = document.getElementById("remLastStatus");

    logEl.innerText = "Running ansible/remediate.yml against vm1 and vm2, then re-scanning to verify...";
    if (statusEl) statusEl.innerText = "Running...";

    try {
        const res = await apiCall("/api/remediate", { method: "POST" });

        const output = (res.stdout || "").trim();
        logEl.innerText = output.length
            ? output
            : "Remediation finished with no output. Exit code: " + res.returncode;

        if (statusEl) {
            statusEl.innerText = res.returncode === 0 ? "SUCCESS" : "FAILED (exit " + res.returncode + ")";
        }

        await loadRemediationData();

    } catch (error) {
        logEl.innerText = "Remediation failed: " + error.message;
        if (statusEl) statusEl.innerText = "FAILED";
    }
}

// ============================================
// INIT
// ============================================

document.addEventListener("DOMContentLoaded", loadRemediationData);
setInterval(loadRemediationData, 30000);
