/* =========================================================
   compliance.js
   Loads the REAL CSPM report from the Flask backend and
   renders the compliance page from it. No hardcoded results.

   Your OPA/Rego policies (opa/cis.rego) only return a plain
   text message per violation, e.g.:
     "vm1: SSH root login is enabled (CIS violation)"
   They do NOT include severity, category, rule id, or an
   "expected vs actual" value. Those don't exist in your
   backend today, so this file supplies that metadata by
   matching each violation message against the known text
   your 15 Rego rules produce. If you ever add/edit a rule in
   cis.rego, add/edit the matching entry in CIS_RULES below
   so the two stay in sync.

   Everything else (counts, pass/fail, score, categories,
   which hosts are affected) is computed live from
   GET /api/report — nothing is faked.
========================================================= */

const API_BASE = "http://100.121.211.97:5000";

// One entry per "deny contains msg if { ... }" block in opa/cis.rego
const CIS_RULES = [
    { id: "CSPM-SSH-001", name: "SSH Root Login",              category: "Authentication",   severity: "HIGH",   expected: "PermitRootLogin no",        match: "SSH root login is enabled" },
    { id: "CSPM-SSH-002", name: "SSH Password Authentication", category: "Authentication",   severity: "MEDIUM", expected: "PasswordAuthentication no", match: "SSH password authentication is enabled" },
    { id: "CSPM-FW-001",  name: "Host Firewall (ufw)",         category: "Network Security", severity: "HIGH",   expected: "ufw status: active",        match: "Firewall (ufw) is disabled" },
    { id: "CSPM-SSH-003", name: "SSH MaxAuthTries",            category: "Authentication",   severity: "MEDIUM", expected: "MaxAuthTries <= 4",         match: "SSH MaxAuthTries is too high" },
    { id: "CSPM-SSH-004", name: "SSH X11 Forwarding",          category: "Network Security", severity: "MEDIUM", expected: "X11Forwarding no",          match: "SSH X11Forwarding is enabled" },
    { id: "CSPM-SYS-001", name: "Automatic Security Updates",  category: "System Security",  severity: "HIGH",   expected: "unattended-upgrades enabled", match: "Automatic security updates are not enabled" },
    { id: "CSPM-SSH-005", name: "SSH Empty Passwords",         category: "Authentication",   severity: "HIGH",   expected: "PermitEmptyPasswords no",   match: "SSH PermitEmptyPasswords is enabled" },
    { id: "CSPM-SSH-006", name: "SSH IgnoreRhosts",            category: "Authentication",   severity: "MEDIUM", expected: "IgnoreRhosts yes",          match: "SSH IgnoreRhosts is disabled" },
    { id: "CSPM-SSH-007", name: "SSH ClientAliveInterval",     category: "Network Security", severity: "LOW",    expected: "ClientAliveInterval > 0",   match: "SSH ClientAliveInterval is not set" },
    { id: "CSPM-AUTH-001",name: "Password Max Age",            category: "Authentication",   severity: "MEDIUM", expected: "PASS_MAX_DAYS <= 90",       match: "Password max age exceeds 90 days" },
    { id: "CSPM-SSH-008", name: "SSH LoginGraceTime",          category: "Authentication",   severity: "LOW",    expected: "LoginGraceTime <= 60",      match: "SSH LoginGraceTime exceeds 60 seconds" },
    { id: "CSPM-SYS-002", name: "SSH LogLevel",                category: "System Security",  severity: "LOW",    expected: "LogLevel != QUIET",         match: "SSH LogLevel is set to QUIET" },
    { id: "CSPM-FS-001",  name: "/etc/passwd Permissions",     category: "File Security",    severity: "HIGH",   expected: "mode <= 644",               match: "/etc/passwd permissions are too permissive" },
    { id: "CSPM-FS-002",  name: "/etc/shadow Permissions",     category: "File Security",    severity: "HIGH",   expected: "mode <= 640",               match: "/etc/shadow permissions are too permissive" },
    { id: "CSPM-SYS-003", name: "Core Dump Restriction",       category: "System Security",  severity: "MEDIUM", expected: "fs.suid_dumpable = 0",      match: "Core dumps are not restricted" },
];

async function loadCompliance() {
    const tbody = document.getElementById("complianceTable");
    tbody.innerHTML = `<tr><td colspan="7" style="padding:20px;opacity:0.6;">Loading real report from backend...</td></tr>`;

    try {
        const res = await fetch(`${API_BASE}/api/report`);
        if (!res.ok) throw new Error(`Backend returned HTTP ${res.status}`);
        const report = await res.json();
        renderCompliance(report);
    } catch (err) {
        tbody.innerHTML = `<tr><td colspan="7" style="padding:20px;color:#ff5252;">
            Failed to load /api/report: ${err.message}. Is vm_control_api.py running?
        </td></tr>`;
        showToast("Failed to load compliance report");
    }
}

function renderCompliance(report) {
    const hosts = report.hosts || {};
    const hostNames = Object.keys(hosts);

    let passCount = 0;
    let failCount = 0;
    const categoryCounts = {};
    const evaluated = [];

    CIS_RULES.forEach((rule) => {
        const affectedHosts = hostNames.filter((h) =>
            (hosts[h] || []).some((msg) => msg.includes(rule.match))
        );
        const status = affectedHosts.length > 0 ? "FAIL" : "PASS";
        if (status === "PASS") passCount++; else failCount++;
        categoryCounts[rule.category] = (categoryCounts[rule.category] || 0) + 1;
        evaluated.push({ ...rule, status, affectedHosts });
    });

    const total = CIS_RULES.length;
    const score = total ? Number(((passCount / total) * 100).toFixed(2)) : 0;
    const riskScore = total ? Number(((failCount / total) * 100).toFixed(2)) : 0;

    renderSummaryCards(score, passCount, failCount, total);
    renderScoreCircle(score, riskScore, total);
    renderCategoryGrid(categoryCounts);
    renderTable(evaluated);
    renderScanInfo(total, score, riskScore, report.timestamp);
}

function renderSummaryCards(score, pass, fail, total) {
    document.getElementById("complianceScore").textContent = `${score}%`;
    document.getElementById("complianceScoreSub").textContent = `${pass} of ${total} checks passed`;
    document.getElementById("passCount").textContent = pass;
    document.getElementById("failCount").textContent = fail;
    // Your Rego policies only ever PASS or FAIL a check - there's no
    // real "needs review" state today, so INFO is genuinely 0 unless
    // you add that concept to cis.rego later.
    document.getElementById("infoCount").textContent = 0;
}

function renderScoreCircle(score, riskScore, total) {
    const deg = Math.round((score / 100) * 360);
    const circle = document.querySelector(".score-circle");
    if (circle) {
        circle.style.background = `conic-gradient(#20d47b 0deg, #20d47b ${deg}deg, rgba(255,255,255,0.08) ${deg}deg, rgba(255,255,255,0.08) 360deg)`;
    }
    const inner = document.querySelector(".score-inner h1");
    if (inner) inner.textContent = `${score}%`;

    document.getElementById("overallComplianceLabel").textContent = `${score}%`;
    document.getElementById("overallComplianceBar").style.width = `${score}%`;
    document.getElementById("riskScoreLabel").textContent = `${riskScore}%`;
    document.getElementById("riskScoreBar").style.width = `${riskScore}%`;
    document.getElementById("scoreDescription").textContent =
        `The current scan evaluated ${total} real CIS-aligned security controls from your OPA policies against both VMs.`;
}

function renderCategoryGrid(categoryCounts) {
    const grid = document.getElementById("categoryGrid");
    if (!grid) return;
    const icons = {
        "Authentication": "fa-key",
        "Network Security": "fa-network-wired",
        "File Security": "fa-file-shield",
        "System Security": "fa-server",
    };
    const descriptions = {
        "Authentication": "SSH and account security controls",
        "Network Security": "Firewall and network exposure",
        "File Security": "Sensitive and writable files",
        "System Security": "Services, updates and hardening",
    };
    grid.innerHTML = Object.entries(categoryCounts).map(([cat, count]) => `
        <div class="category-card">
            <h3><i class="fa-solid ${icons[cat] || 'fa-shield'}"></i> ${cat}</h3>
            <div class="category-count">${count}</div>
            <p>${descriptions[cat] || ""}</p>
        </div>
    `).join("");
}

function renderTable(rows) {
    const tbody = document.getElementById("complianceTable");
    if (rows.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" style="padding:20px;opacity:0.6;">No rules evaluated.</td></tr>`;
        return;
    }

    tbody.innerHTML = rows.map((r, i) => {
        const rid = `rule${i}`;
        const statusClass = r.status === "PASS" ? "pass" : "fail";
        const severityClass = r.severity.toLowerCase();
        const actual = r.status === "PASS"
            ? "Compliant on all hosts"
            : `Violation on: ${r.affectedHosts.join(", ")}`;
        const searchBlob = `${r.name} ${r.category} ${r.id}`.toLowerCase();

        return `
        <tr class="rule-row" data-status="${r.status}" data-severity="${r.severity}" data-search="${searchBlob}">
            <td><span class="rule-name">${r.name}</span><span class="rule-id">${r.id}</span></td>
            <td>${r.category}</td>
            <td><span class="badge ${statusClass}">${r.status}</span></td>
            <td><span class="badge ${severityClass}">${r.severity}</span></td>
            <td>${r.expected}</td>
            <td>${actual}</td>
            <td><button class="details-btn" onclick="toggleDetails('${rid}')">View</button></td>
        </tr>
        <tr id="${rid}" class="rule-details">
            <td colspan="7">
                <div class="detail-box">
                    <div class="detail-item"><h4>Rule</h4><p>${r.id} — ${r.name}</p></div>
                    <div class="detail-item"><h4>Expected</h4><p>${r.expected}</p></div>
                    <div class="detail-item"><h4>Status</h4><p>${r.status}${r.affectedHosts.length ? " on " + r.affectedHosts.join(", ") : " on all scanned hosts"}</p></div>
                    <div class="detail-item"><h4>Source</h4><p>OPA policy: opa/cis.rego</p></div>
                </div>
            </td>
        </tr>`;
    }).join("");

    // Detail rows must start hidden (CSS only hides .rule-details, JS toggles .show)
    filterChecks();
}

function renderScanInfo(total, score, riskScore, timestamp) {
    document.getElementById("scanTotalChecks").textContent = total;
    document.getElementById("scanComplianceScore").textContent = `${score}%`;
    document.getElementById("scanRiskScore").textContent = `${riskScore}%`;
    document.getElementById("checksSubtitle").textContent = `${total} configured security controls`;
    const tsEl = document.getElementById("scanTimestamp");
    if (tsEl) tsEl.textContent = timestamp ? new Date(timestamp).toLocaleString() : "—";
}

/* =========================================================
   Buttons — Refresh just re-reads the latest report (safe).
   Run Compliance Scan triggers your real backend scan first.
   NOTE: per your backend, POST /api/scan currently runs
   misconfigure.yml before scanning (your demo flow) - this
   button will do that too, same as the Security page does.
========================================================= */

async function refreshCompliance() {
    const button = document.querySelector(
        'button[onclick="refreshCompliance()"]'
    );

    const originalText = button ? button.textContent : "";

    if (button) {
        button.disabled = true;
        button.textContent = "Refreshing...";
    }

    showToast("Fetching latest compliance report...");

    try {
        const response = await fetch(`${API_BASE}/api/report`, {
            cache: "no-store"
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const report = await response.json();

        renderCompliance(report);

        showToast(
            `Report loaded successfully. Last report: ${
                report.timestamp || "timestamp unavailable"
            }`
        );
    } catch (error) {
        console.error("Refresh failed:", error);
        showToast(`Refresh failed: ${error.message}`);
    } finally {
        if (button) {
            button.disabled = false;
            button.textContent = originalText;
        }
    }
}

async function runComplianceScan() {
    showToast("Running CSPM scan...");
    try {
        const res = await fetch(`${API_BASE}/api/scan`, { method: "POST" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        await loadCompliance();
        showToast("Scan complete. Results updated from backend.");
    } catch (err) {
        showToast(`Scan failed: ${err.message}`);
    }
}

function showToast(message) {
    const toast = document.getElementById("toast");
    const messageBox = document.getElementById("toastMessage");
    messageBox.textContent = message;
    toast.classList.add("show");
    setTimeout(() => toast.classList.remove("show"), 3000);
}

document.addEventListener("DOMContentLoaded", loadCompliance);
