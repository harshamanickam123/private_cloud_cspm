// ============================================
// REAL VM CONTROL
// Talks to vm_control_api.py running on the
// laptop that hosts the KVM/libvirt VMs.
// ============================================

// IMPORTANT: point this at the LAN IP of the laptop running
// vm_control_api.py (the laptop with the actual VMs).
// If this dashboard is opened on the SAME laptop as the API,
// "http://localhost:5000" is correct as-is.
const API_BASE = "http://localhost:5000";

// Must match vm_control.api_token in that laptop's config.yaml
const API_TOKEN = "change-this-demo-token";

let currentHost = null;

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
// LOAD VM LIST — real hosts from your scan
// ============================================

async function loadVMTable() {
    const tbody = document.getElementById("vmTableBody");
    if (!tbody) return;

    try {
        const report = await apiCall("/api/report");
        const hosts = report.hosts || [];

        document.getElementById("totalVM").innerText = hosts.length;
        document.getElementById("cpuUsage").innerText =
            Number(report.summary.compliance_score || 0).toFixed(0) + "%";
        document.getElementById("ramUsage").innerText = report.summary.fail || 0;

        tbody.innerHTML = "";
        let runningCount = 0;

        for (const hostname of hosts) {
            const hostRules = report.rules.filter(r => r.hostname === hostname);
            const compliance = hostRules.length
                ? Math.round((hostRules.filter(r => r.status === "PASS").length / hostRules.length) * 100)
                : 0;

            let status = { state: "unknown", ip: "unknown" };
            try {
                status = await apiCall(`/api/vm/${hostname}/status`);
            } catch (e) {
                console.warn("Status check failed for " + hostname, e);
            }

            const running = status.state && status.state.includes("running");
            if (running) runningCount++;

            const row = document.createElement("tr");
            row.innerHTML =
                '<td><span class="vm-name" onclick="showVM(\'' + hostname + '\')">' +
                '<i class="fa-solid fa-server"></i> ' + hostname + '</span></td>' +
                '<td>Ubuntu (KVM)</td>' +
                '<td><span class="badge ' + (running ? "running" : "") + '">' +
                (running ? "Running" : (status.state || "Unknown")) + '</span></td>' +
                '<td>' + (status.ip || "unknown") + '</td>' +
                '<td><span class="badge ' + (compliance >= 80 ? "pass" : "fail") + '">' + compliance + '%</span></td>' +
                '<td><button class="quick-btn btn-scan" onclick="showVM(\'' + hostname + '\')">View</button></td>';
            tbody.appendChild(row);
        }

        document.getElementById("runningVM").innerText = runningCount;

    } catch (error) {
        console.error("Failed to load VM table:", error);
        tbody.innerHTML =
            '<tr><td colspan="6">Unable to reach VM control API at ' + API_BASE +
            '. Is vm_control_api.py running on your laptop?</td></tr>';
    }
}

// ============================================
// SHOW VM DETAILS — real per-host data
// ============================================

async function showVM(hostname) {
    currentHost = hostname;
    document.getElementById("vmDetails").classList.add("show");
    addLog("Opened details for " + hostname + ".");

    try {
        const [status, stats, hostReport] = await Promise.all([
            apiCall(`/api/vm/${hostname}/status`),
            apiCall(`/api/vm/${hostname}/stats`),
            apiCall(`/api/report/${hostname}`),
        ]);

        const running = status.state && status.state.includes("running");

        document.getElementById("vmDetailName").innerText = hostname;
        document.getElementById("vmDetailSubtitle").innerText =
            "Ubuntu (KVM) • " + status.ip;

        document.getElementById("vmStatusBadge").innerText = running ? "Running" : (status.state || "Unknown");
        document.getElementById("vmStatusBadge").className = "badge " + (running ? "running" : "");
        document.getElementById("detailStatus").innerText = running ? "Running" : (status.state || "Unknown");

        document.getElementById("detailCPU").innerText = stats.cpus + " vCPU(s)";
        document.getElementById("detailRAM").innerText =
            stats.actual_memory_kb !== "N/A"
                ? Math.round(stats.actual_memory_kb / 1024) + " MB"
                : "N/A";

        document.getElementById("detailIP").innerText = status.ip;

        const fwRule = hostReport.rules.find(r => r.rule_id === "CSPM-FW-001");
        document.getElementById("detailFirewall").innerText =
            fwRule ? (fwRule.status === "PASS" ? "Active" : "Inactive") : "Unknown";

        const sshRules = hostReport.rules.filter(r => r.rule_id.startsWith("CSPM-SSH"));
        const sshFails = sshRules.filter(r => r.status === "FAIL").length;
        document.getElementById("detailSSH").innerText =
            sshRules.length === 0 ? "Unknown"
            : sshFails === 0 ? "Hardened"
            : sshFails + " issue(s)";

        document.getElementById("detailCompliance").innerText =
            Number(hostReport.summary.compliance_score).toFixed(0) + "%";

    } catch (error) {
        console.error("Failed to load VM details:", error);
        showToast("Could not load live details for " + hostname, "warning");
    }
}

// ============================================
// REAL START / STOP / RESTART
// ============================================

async function startVM() {
    if (!currentHost) return;
    showToast("Starting " + currentHost + "...", "info");
    addLog("Start requested for " + currentHost + ".");
    try {
        const res = await apiCall(`/api/vm/${currentHost}/start`, { method: "POST" });
        showToast(currentHost + ": " + (res.status || "started"), "success");
        addLog(currentHost + " start result: " + (res.status || res.message));
        await showVM(currentHost);
        await loadVMTable();
    } catch (error) {
        showToast("Start failed: " + error.message, "warning");
    }
}

async function stopVM() {
    if (!currentHost) return;
    if (!confirm("Are you sure you want to stop " + currentHost + "?")) return;

    showToast("Stopping " + currentHost + "...", "warning");
    addLog("Stop requested for " + currentHost + ".");
    try {
        const res = await apiCall(`/api/vm/${currentHost}/stop`, { method: "POST" });
        showToast(currentHost + ": " + (res.status || "stopped"), "success");
        addLog(currentHost + " stop result: " + (res.status || res.message));
        await showVM(currentHost);
        await loadVMTable();
    } catch (error) {
        showToast("Stop failed: " + error.message, "warning");
    }
}

async function restartVM() {
    if (!currentHost) return;
    showToast("Restarting " + currentHost + "...", "info");
    addLog("Restart requested for " + currentHost + ".");
    try {
        const res = await apiCall(`/api/vm/${currentHost}/restart`, { method: "POST" });
        showToast(currentHost + ": " + (res.status || "restarting"), "success");
        addLog(currentHost + " restart result: " + (res.status || res.message));
        setTimeout(function () { showVM(currentHost); loadVMTable(); }, 3000);
    } catch (error) {
        showToast("Restart failed: " + error.message, "warning");
    }
}

// ============================================
// REAL SCAN / REMEDIATE — runs your detect.py
// ============================================

async function securityScan() {
    showToast("Running real CSPM scan (detect.py)...", "info");
    addLog("detect.py scan started.");
    try {
        const res = await apiCall("/api/scan", { method: "POST" });
        addLog("Scan finished (exit code " + res.returncode + ").");
        showToast("Scan completed. Refreshing data...", "success");
        await loadVMTable();
        if (currentHost) await showVM(currentHost);
    } catch (error) {
        showToast("Scan failed: " + error.message, "warning");
    }
}

async function remediateVM() {
    showToast("Running auto-remediation (detect.py --fix)...", "info");
    addLog("Remediation started.");
    try {
        const res = await apiCall("/api/remediate", { method: "POST" });
        addLog("Remediation finished (exit code " + res.returncode + ").");
        showToast("Remediation completed. Refreshing data...", "success");
        await loadVMTable();
        if (currentHost) await showVM(currentHost);
    } catch (error) {
        showToast("Remediation failed: " + error.message, "warning");
    }
}

function refreshVM() {
    showToast("Refreshing VM information...", "info");
    loadVMTable();
    if (currentHost) showVM(currentHost);
}

function closeVM() {
    document.getElementById("vmDetails").classList.remove("show");
}

function showResourceDetails() {
    if (currentHost) {
        showVM(currentHost);
    } else {
        showToast("Select a VM from the table first.", "info");
    }
}

// ============================================
// TOAST + ACTIVITY LOG
// ============================================

function showToast(message, type = "info") {
    const container = document.getElementById("toastContainer");
    if (!container) return;
    const toast = document.createElement("div");
    toast.className = "toast " + type;
    toast.innerHTML = message;
    container.appendChild(toast);
    setTimeout(function () { toast.remove(); }, 3500);
}

function addLog(message) {
    const log = document.getElementById("activityLog");
    if (!log) return;
    const item = document.createElement("div");
    item.className = "log-item";
    item.innerHTML =
        '<span class="log-time">' + new Date().toLocaleTimeString() + '</span>' + message;
    log.prepend(item);
}

// ============================================
// INIT
// ============================================

document.addEventListener("DOMContentLoaded", loadVMTable);
setInterval(loadVMTable, 20000);
