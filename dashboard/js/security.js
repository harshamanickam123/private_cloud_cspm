/* =========================================================
   Security page controller (real data, no hardcoded results)
   Data source: GET /api/report  (reports/report.json)
   Also uses:   GET /api/vm/<host>/status, POST /api/scan, POST /api/remediate
   ========================================================= */

const API_BASE = "http://localhost:5000";
const API_TOKEN = "change-this-demo-token";
const MONITOR_BASE = "http://127.0.0.1:5001";

// Severity weights for the risk score
const WEIGHTS = { CRITICAL: 10, HIGH: 7, MEDIUM: 4, LOW: 1 };
const SEV_ORDER = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
const STALE_HOURS = 24;

let REPORT = null;
let REPORT_TIME = null;

/* ---------- helpers ---------- */

function esc(v) {
    return String(v === undefined || v === null ? "" : v)
        .replace(/&/g, "&amp;").replace(/</g, "&lt;")
        .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function $(id) { return document.getElementById(id); }

async function apiCall(path, options) {
    const headers = Object.assign(
        { "X-API-Token": API_TOKEN, "Content-Type": "application/json" },
        (options && options.headers) || {}
    );
    const response = await fetch(API_BASE + path, Object.assign({}, options, { headers }));
    let data = null;
    try { data = await response.json(); } catch (e) { /* non-JSON */ }
    if (!response.ok) {
        throw new Error((data && (data.error || data.message)) || ("HTTP " + response.status));
    }
    return { data, response };
}

function showToast(title, message) {
    $("toastTitle").textContent = title;
    $("toastMessage").textContent = message;
    const t = $("toast");
    t.classList.add("show");
    setTimeout(() => t.classList.remove("show"), 3500);
}

/* ---------- risk maths ---------- */

function riskScore(rules) {
    let total = 0, failed = 0;
    rules.forEach(r => {
        const w = WEIGHTS[r.severity] || 1;
        total += w;
        if (r.status === "FAIL") failed += w;
    });
    return total ? Math.round((failed / total) * 1000) / 10 : 0;
}

function riskLevel(score) {
    if (score > 50) return "HIGH";
    if (score >= 20) return "MEDIUM";
    return "LOW";
}

function levelClass(level) {
    return level === "HIGH" ? "badge-fail" : level === "MEDIUM" ? "badge-warn" : "badge-pass";
}

function sevClass(sev) {
    return sev === "CRITICAL" || sev === "HIGH" ? "badge-fail"
        : sev === "MEDIUM" ? "badge-warn" : "badge-info";
}

function hostsOf(rules) {
    return Array.from(new Set(rules.map(r => r.hostname))).sort();
}

/* ---------- loading ---------- */

async function loadReport() {
    const { data, response } = await apiCall("/api/security");
    REPORT = data;

    const stamp = data.generated_at || data.timestamp || data.scan_time ||
        (data.scanner && (data.scanner.generated_at || data.scanner.timestamp)) ||
        response.headers.get("Last-Modified");
    const parsed = stamp ? new Date(stamp) : null;
    REPORT_TIME = parsed && !isNaN(parsed) ? parsed : null;
}


/* ---------- independent background monitor ---------- */
function formatMonitorTime(value) {
    if (!value) return "Not available";
    const date = new Date(value);
    return isNaN(date) ? "Not available" : date.toLocaleString();
}

async function refreshMonitorStatus() {
    const statusEl = $("backgroundMonitorStatus");
    try {
        const response = await fetch(
            MONITOR_BASE + "/monitor_status.json?t=" + Date.now(),
            { cache: "no-store" }
        );
        if (!response.ok) throw new Error("HTTP " + response.status);

        const status = await response.json();
        const updated = status.updated_at ? new Date(status.updated_at) : null;
        const stale = !updated || isNaN(updated) ||
            (Date.now() - updated.getTime() > 10 * 60 * 1000);

        statusEl.textContent = stale ? "Status stale" :
            (status.scan_state === "running" ? "Scan running" :
            (status.scan_state === "failed" || status.scan_state === "skipped_or_failed"
                ? "Check monitor" : "Active"));
        $("backgroundMonitorLastScan").textContent =
            formatMonitorTime(status.last_scan);
        $("backgroundMonitorHosts").textContent =
            status.hosts_scanned == null ? "—" : status.hosts_scanned;
        $("backgroundMonitorViolations").textContent =
            status.total_violations == null ? "—" : status.total_violations;
        $("backgroundMonitorMessage").textContent =
            (status.message || "No status message available.") +
            (stale ? " The status is older than expected; check the monitor service." : "");

        const reportName = status.report ? status.report.split("/").pop() : "";
        if (!reportName || !/^monitor_[\w-]+\.json$/.test(reportName)) {
            $("backgroundMonitorFindings").textContent =
                "No successful monitoring report is available yet.";
            return;
        }

        const reportResponse = await fetch(
            MONITOR_BASE + "/" + encodeURIComponent(reportName) + "?t=" + Date.now(),
            { cache: "no-store" }
        );
        if (!reportResponse.ok) throw new Error("Could not load the monitoring report.");

        const report = await reportResponse.json();
        const hosts = report.hosts || {};
        const findings = [];

        Object.entries(hosts).forEach(([host, violations]) => {
            (Array.isArray(violations) ? violations : []).forEach(item => {
                let description;
                if (typeof item === "string") {
                    description = item;
                } else if (item && typeof item === "object") {
                    description = item.msg || item.message || item.description ||
                        item.rule_id || JSON.stringify(item);
                } else {
                    description = String(item);
                }
                findings.push({ host, description });
            });
        });

        if (!findings.length) {
            $("backgroundMonitorFindings").textContent =
                "No policy violations were found in the latest successful background scan.";
        } else {
            $("backgroundMonitorFindings").innerHTML =
                "<strong>Latest findings</strong><ul>" +
                findings.map(f => "<li><strong>" + esc(f.host) +
                    ":</strong> " + esc(f.description) + "</li>").join("") +
                "</ul>";
        }
    } catch (error) {
        statusEl.textContent = "Unavailable";
        $("backgroundMonitorMessage").textContent =
            "Cannot read background monitoring data. Check that the local monitoring status service is running.";
        $("backgroundMonitorFindings").textContent =
            "Monitoring details unavailable: " + error.message;
    }
}

async function refreshSecurity(showMsg) {
    const btn = $("refreshBtn");
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Loading...';
    try {
        await loadReport();
        renderAll();
        if (showMsg) showToast("Report loaded", "Showing the latest saved report.");
    } catch (err) {
        renderError(err.message);
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-rotate"></i> Refresh';
    }
}

function renderError(message) {
    $("loadError").style.display = "block";
    $("loadError").innerHTML =
        "<strong>Unable to load security data.</strong> Could not reach the VM control API at " +
        esc(API_BASE) + " (" + esc(message) + "). Check that <code>python3 vm_control_api.py</code> " +
        "is running and that <code>reports/report.json</code> exists.";
}

/* ---------- rendering ---------- */

function renderAll() {
    $("loadError").style.display = "none";
    const rules = REPORT.rules || [];
    const hosts = hostsOf(rules);

    renderHeader(rules, hosts);
    renderCards(rules, hosts);
    renderHosts(rules, hosts);
    renderFindings(rules);
    renderDomains(rules);
    renderSSH(rules, hosts);
    renderRecommendations(rules);
}

function renderHeader() {
    const el = $("lastScanTime");
    const stale = $("staleWarning");
    if (!REPORT_TIME) {
        el.textContent = "Time not recorded in report";
        stale.style.display = "none";
        return;
    }
    el.textContent = REPORT_TIME.toLocaleString();
    const hours = (Date.now() - REPORT_TIME.getTime()) / 36e5;
    if (hours > STALE_HOURS) {
        stale.style.display = "inline-flex";
        stale.textContent = "Report is " + Math.floor(hours) + " hours old. Run a new scan.";
    } else {
        stale.style.display = "none";
    }
}

function renderCards(rules, hosts) {
    const score = riskScore(rules);
    const level = riskLevel(score);
    const failed = rules.filter(r => r.status === "FAIL");
    const crit = failed.filter(r => r.severity === "CRITICAL" || r.severity === "HIGH").length;
    const hostsAtRisk = hosts.filter(h => rules.some(r => r.hostname === h && r.status === "FAIL")).length;
    const unevaluated = rules.filter(r => r.status === "ERROR" || r.status === "WARNING").length;

    $("riskValue").textContent = score + "%";
    $("riskLevel").innerHTML = '<span class="security-badge ' + levelClass(level) + '">' + level + "</span>";
    $("riskNote").textContent = unevaluated
        ? unevaluated + " check(s) could not be evaluated and are not counted."
        : "Severity-weighted across " + rules.length + " checks.";

    $("openHigh").textContent = crit;
    $("openTotal").textContent = failed.length + " open finding(s) in total";

    $("hostsAtRisk").textContent = hostsAtRisk + " of " + hosts.length;

    const fw = rules.filter(r => r.rule_id === "CSPM-FW-001");
    const fwOk = fw.filter(r => r.status === "PASS").length;
    $("firewallValue").textContent = fw.length ? fwOk + " of " + fw.length : "No data";
    $("firewallNote").textContent = fw.length
        ? "hosts with the firewall active" : "Firewall check not found in report";
}

function renderHosts(rules, hosts) {
    const wrap = $("hostCards");
    wrap.innerHTML = "";
    hosts.forEach(h => {
        const mine = rules.filter(r => r.hostname === h);
        const failed = mine.filter(r => r.status === "FAIL");
        const score = riskScore(mine);
        const level = riskLevel(score);
        const fw = mine.find(r => r.rule_id === "CSPM-FW-001");
        const ssh = mine.filter(r => (r.rule_id || "").indexOf("CSPM-SSH") === 0);
        const sshOk = ssh.filter(r => r.status === "PASS").length;
        const count = sev => failed.filter(r => r.severity === sev).length;

        const card = document.createElement("div");
        card.className = "host-card";
        card.innerHTML =
            '<div class="host-top"><h3><i class="fa-solid fa-server"></i> ' + esc(h) + "</h3>" +
            '<span class="security-badge badge-info" id="power-' + esc(h) + '">checking...</span></div>' +
            '<div class="host-risk"><strong>' + score + '%</strong>' +
            '<span class="security-badge ' + levelClass(level) + '">' + level + " risk</span></div>" +
            '<dl class="host-facts">' +
            "<dt>Open findings</dt><dd>" + failed.length + " (High " + count("HIGH") +
            ", Medium " + count("MEDIUM") + ", Low " + count("LOW") + ")</dd>" +
            "<dt>Firewall</dt><dd>" + (fw ? esc(fw.status === "PASS" ? "Active" : "Not active") : "No data") + "</dd>" +
            "<dt>SSH hardening</dt><dd>" + sshOk + " of " + ssh.length + " checks passed</dd></dl>";
        wrap.appendChild(card);

        apiCall("/api/vm/" + encodeURIComponent(h) + "/status").then(res => {
            const d = res.data || {};
            const state = d.state || d.status || d.power || "unknown";
            const el = $("power-" + h);
            if (el) {
                el.textContent = String(state);
                el.className = "security-badge " + (/running/i.test(state) ? "badge-pass" : "badge-warn");
            }
        }).catch(() => {
            const el = $("power-" + h);
            if (el) { el.textContent = "unknown"; el.className = "security-badge badge-warn"; }
        });
    });
}

function renderFindings(rules) {
    const body = $("findingsBody");
    const failed = rules.filter(r => r.status === "FAIL").sort((a, b) =>
        (SEV_ORDER[a.severity] ?? 9) - (SEV_ORDER[b.severity] ?? 9) ||
        String(a.hostname).localeCompare(b.hostname));

    $("findingsCount").textContent = failed.length + " open";
    if (!failed.length) {
        body.innerHTML = '<tr><td colspan="6" class="empty-row">' +
            "No open findings. Every evaluated check passed on every host.</td></tr>";
        $("remediateBtn").disabled = true;
        return;
    }
    $("remediateBtn").disabled = false;
    body.innerHTML = failed.map(r =>
        "<tr><td><strong>" + esc(r.hostname) + "</strong></td>" +
        "<td>" + esc(r.name) + '<div class="sub">' + esc(r.rule_id) + "</div></td>" +
        '<td><span class="security-badge ' + sevClass(r.severity) + '">' + esc(r.severity) + "</span></td>" +
        "<td><code>" + esc(r.actual || "not reported") + '</code><div class="sub">expected: ' + esc(r.expected) + "</div></td>" +
        "<td>" + esc(r.remediation) + "</td>" +
        '<td><span class="security-badge badge-pass">Auto-fix</span></td></tr>'
    ).join("");
}

function renderDomains(rules) {
    const groups = {};
    rules.forEach(r => {
        const c = r.category || "Other";
        (groups[c] = groups[c] || []).push(r);
    });
    const names = Object.keys(groups).sort();
    $("domainList").innerHTML = names.map(c => {
        const list = groups[c];
        const total = list.reduce((s, r) => s + (WEIGHTS[r.severity] || 1), 0);
        const ok = list.filter(r => r.status === "PASS").reduce((s, r) => s + (WEIGHTS[r.severity] || 1), 0);
        const pct = total ? Math.round((ok / total) * 100) : 0;
        const fails = list.filter(r => r.status === "FAIL").length;
        const color = pct === 100 ? "#22c55e" : pct >= 70 ? "#f59e0b" : "#ef4444";
        return '<div class="domain-row"><span>' + esc(c) + "</span>" +
            '<div class="risk-bar"><div class="risk-bar-fill" style="width:' + pct + "%;background:" + color + '"></div></div>' +
            "<strong>" + pct + "%</strong>" +
            '<span class="sub">' + fails + " failing</span></div>";
    }).join("");
}

function renderSSH(rules, hosts) {
    const ssh = rules.filter(r => (r.rule_id || "").indexOf("CSPM-SSH") === 0);
    const ids = Array.from(new Set(ssh.map(r => r.rule_id))).sort();
    $("sshHead").innerHTML = "<tr><th>Setting</th><th>Expected</th>" +
        hosts.map(h => "<th>" + esc(h) + "</th>").join("") + "</tr>";
    $("sshBody").innerHTML = ids.map(id => {
        const sample = ssh.find(r => r.rule_id === id);
        const cells = hosts.map(h => {
            const r = ssh.find(x => x.rule_id === id && x.hostname === h);
            if (!r) return "<td>no data</td>";
            const cls = r.status === "PASS" ? "ok-text" : "bad-text";
            return '<td class="' + cls + '"><code>' + esc(r.actual || "not reported") + "</code></td>";
        }).join("");
        return "<tr><td>" + esc(sample.name) + "</td><td><code>" + esc(sample.expected) + "</code></td>" + cells + "</tr>";
    }).join("");
}

function renderRecommendations(rules) {
    const failed = rules.filter(r => r.status === "FAIL");
    const box = $("recommendationBox");
    if (!failed.length) {
        box.className = "recommendation good";
        box.innerHTML = "<h3>No action needed</h3><p>All evaluated checks pass. " +
            "Keep scanning on a schedule to catch configuration drift.</p>";
        return;
    }
    const byRule = {};
    failed.forEach(r => {
        const g = byRule[r.rule_id] = byRule[r.rule_id] ||
            { rule: r, hosts: [] };
        g.hosts.push(r.hostname);
    });
    const items = Object.values(byRule).sort((a, b) =>
        (SEV_ORDER[a.rule.severity] ?? 9) - (SEV_ORDER[b.rule.severity] ?? 9));
    box.className = "recommendation";
    box.innerHTML = "<h3>Fix these first</h3><ul class=\"recommendation-list\">" +
        items.map(g => "<li><strong>" + esc(g.rule.name) + "</strong> (" + esc(g.rule.severity) +
            ") on " + esc(g.hosts.join(", ")) + ": " + esc(g.rule.remediation) + "</li>").join("") +
        "</ul><p>Use Remediate now to apply the fixes, then run a new scan to confirm.</p>";
}

/* ---------- actions ---------- */

async function runSecurityScan() {
    const btn = $("scanBtn");
    const box = $("scanBox");
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Scanning...';
    box.classList.add("show");
    $("scanMessage").textContent = "Scanning vm1 and vm2. This can take a minute.";
    try {
        await apiCall("/api/scan", { method: "POST", body: "{}" });
        await loadReport();
        renderAll();
        $("scanMessage").textContent = "Scan finished. Showing the new results.";
        showToast("Scan finished", "Security data updated.");
    } catch (err) {
        $("scanMessage").textContent = "Scan failed: " + err.message;
        showToast("Scan failed", err.message);
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-magnifying-glass"></i> Run security scan';
    }
}

async function remediateNow() {
    if (!confirm("Apply fixes to all hosts with open findings?")) return;
    const btn = $("remediateBtn");
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Remediating...';
    try {
        await apiCall("/api/remediate", { method: "POST", body: "{}" });
        await loadReport();
        renderAll();
        showToast("Remediation finished", "Report reloaded with the latest results.");
    } catch (err) {
        showToast("Remediation failed", err.message);
    } finally {
        btn.innerHTML = '<i class="fa-solid fa-screwdriver-wrench"></i> Remediate now';
        renderFindings(REPORT ? REPORT.rules || [] : []);
    }
}

document.addEventListener("DOMContentLoaded", () => {
    refreshSecurity(false);
    refreshMonitorStatus();
    setInterval(refreshMonitorStatus, 30000);
});
