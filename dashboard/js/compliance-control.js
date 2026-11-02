// ============================================
// REAL COMPLIANCE DATA
// Populates the rule-by-rule table from your
// actual scan_results, via the same API used
// by vm.html (vm_control_api.py).
// Filter/search logic (filterChecks) is
// unchanged from the original — it just reads
// whatever rows are in the DOM.
// ============================================

const API_BASE = "http://localhost:5000";
const API_TOKEN = "change-this-demo-token";

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

function severityClass(sev) {
    return (sev || "").toLowerCase();
}

function statusClass(status) {
    if (status === "PASS") return "pass";
    if (status === "FAIL") return "fail";
    if (status === "WARNING") return "warning";
    if (status === "ERROR") return "fail";
    return "info";
}

// ============================================
// LOAD REAL RULES INTO THE TABLE
// ============================================

async function loadComplianceData() {
    const tbody = document.getElementById("complianceTable");

    try {
        const report = await apiCall("/api/report");
        const summary = report.summary || {};

        const scoreEl = document.getElementById("complianceScore");
        if (scoreEl) scoreEl.innerText = Number(summary.compliance_score || 0).toFixed(0) + "%";

        const passEl = document.getElementById("passCount");
        if (passEl) passEl.innerText = summary.pass || 0;

        const infoEl = document.getElementById("infoCount");
        if (infoEl) infoEl.innerText = summary.info || 0;

        const failEl = document.getElementById("failCount");
        if (failEl) failEl.innerText = summary.fail || 0;

        tbody.innerHTML = "";

        report.rules.forEach((rule, i) => {
            const rowId = "rule" + i;
            const searchText = (
                rule.name + " " + rule.category + " " + rule.hostname
            ).toLowerCase();

            const row = document.createElement("tr");
            row.className = "rule-row";
            row.dataset.status = rule.status;
            row.dataset.severity = rule.severity;
            row.dataset.search = searchText;

            row.innerHTML =
                '<td><span class="rule-name">' + rule.name + ' (' + rule.hostname + ')</span>' +
                '<span class="rule-id">' + rule.rule_id + '</span></td>' +
                '<td>' + rule.category + '</td>' +
                '<td><span class="badge ' + statusClass(rule.status) + '">' + rule.status + '</span></td>' +
                '<td><span class="badge ' + severityClass(rule.severity) + '">' + rule.severity + '</span></td>' +
                '<td>' + rule.expected + '</td>' +
                '<td>' + rule.actual + '</td>' +
                '<td><button class="details-btn" onclick="toggleDetails(\'' + rowId + '\')">View</button></td>';

            const detailRow = document.createElement("tr");
            detailRow.id = rowId;
            detailRow.className = "rule-details";
            detailRow.innerHTML =
                '<td colspan="7"><div class="detail-box">' +
                '<div class="detail-item"><h4>Description</h4><p>' + rule.description + '</p></div>' +
                '<div class="detail-item"><h4>Evidence</h4><p>' + rule.evidence + '</p></div>' +
                '<div class="detail-item"><h4>Expected</h4><p>' + rule.expected + '</p></div>' +
                '<div class="detail-item"><h4>Remediation</h4><p>' + rule.remediation + '</p></div>' +
                '</div></td>';

            tbody.appendChild(row);
            tbody.appendChild(detailRow);
        });

        // re-apply whatever filter/search state is currently set
        filterChecks();

    } catch (error) {
        console.error("Failed to load compliance data:", error);
        tbody.innerHTML =
            '<tr><td colspan="7">Unable to reach VM control API at ' + API_BASE +
            '. Is vm_control_api.py running?</td></tr>';
    }
}

// ============================================
// TOGGLE RULE DETAILS (unchanged from original)
// ============================================

function toggleDetails(id) {
    const row = document.getElementById(id);
    row.classList.toggle("show");
}

// ============================================
// FILTER / SEARCH (unchanged from original)
// ============================================

function filterChecks() {
    const search = document.getElementById("searchInput").value.toLowerCase();
    const status = document.getElementById("statusFilter").value;
    const severity = document.getElementById("severityFilter").value;

    const rows = document.querySelectorAll(".rule-row");
    let visibleCount = 0;

    rows.forEach(row => {
        const rowStatus = row.dataset.status;
        const rowSeverity = row.dataset.severity;
        const rowSearch = row.dataset.search;

        const matchesSearch = rowSearch.includes(search);
        const matchesStatus = status === "all" || rowStatus === status;
        const matchesSeverity = severity === "all" || rowSeverity === severity;

        if (matchesSearch && matchesStatus && matchesSeverity) {
            row.style.display = "";
            visibleCount++;
        } else {
            row.style.display = "none";
        }

        const detailRow = row.nextElementSibling;
        if (detailRow && detailRow.classList.contains("rule-details")) {
            detailRow.style.display = "none";
            detailRow.classList.remove("show");
        }
    });

    const emptyState = document.getElementById("emptyState");
    if (emptyState) emptyState.style.display = visibleCount === 0 ? "block" : "none";
}

// ============================================
// REAL REFRESH / SCAN
// ============================================

function refreshCompliance() {
    showToast("Refreshing compliance results...");
    loadComplianceData();
}

async function runComplianceScan() {
    showToast("Running real CSPM scan (detect.py)...");
    try {
        const res = await apiCall("/api/scan", { method: "POST" });
        showToast("Scan completed (exit code " + res.returncode + "). Refreshing...");
        await loadComplianceData();
    } catch (error) {
        showToast("Scan failed: " + error.message);
    }
}

// ============================================
// TOAST (unchanged from original)
// ============================================

function showToast(message) {
    const toast = document.getElementById("toast");
    const messageBox = document.getElementById("toastMessage");
    if (!toast || !messageBox) return;
    messageBox.textContent = message;
    toast.classList.add("show");
    setTimeout(() => toast.classList.remove("show"), 3000);
}

// ============================================
// INIT
// ============================================

document.addEventListener("DOMContentLoaded", loadComplianceData);
setInterval(loadComplianceData, 30000);
