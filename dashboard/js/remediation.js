const API_BASE = "http://100.121.211.97:5000";

let currentReport = null;


// ================================
// API REQUEST
// ================================

async function apiRequest(endpoint, options = {}) {

    const response = await fetch(`${API_BASE}${endpoint}`, {
        ...options,
        headers: {
            "Content-Type": "application/json",
            ...(options.headers || {})
        }
    });

    let data;

    try {
        data = await response.json();
    } catch {
        throw new Error("Invalid response from Flask API");
    }

    if (!response.ok) {
        throw new Error(
            data.error ||
            data.stderr ||
            "API request failed"
        );
    }

    return data;
}


// ================================
// LOAD CURRENT CSPM REPORT
// ================================

async function loadRemediationReport() {

    try {

        const report = await apiRequest("/api/report");

        currentReport = report;

        const total =
            Number(report.total_violations || 0);

        const hosts =
            report.hosts || {};

        const affectedVMs =
            Object.values(hosts)
                .filter(violations =>
                    Array.isArray(violations) &&
                    violations.length > 0
                )
                .length;

        updateCard(
            "totalViolations",
            total
        );

        updateCard(
            "affectedVMs",
            affectedVMs
        );

        updateCard(
            "fixesApplied",
            "—"
        );

        updateCard(
            "remediationStatus",
            total > 0
                ? "READY"
                : "NO ISSUES"
        );

        renderFindings(hosts);

    } catch (error) {

        console.error(
            "Unable to load CSPM report:",
            error
        );

        updateCard(
            "remediationStatus",
            "ERROR"
        );
    }
}


// ================================
// UPDATE SUMMARY CARD
// ================================

function updateCard(id, value) {

    const element =
        document.getElementById(id);

    if (element) {
        element.textContent = value;
    }
}


// ================================
// RENDER REAL FINDINGS
// ================================

function renderFindings(hosts) {

    const container =
        document.getElementById("realFindings");

    if (!container) {
        return;
    }

    container.innerHTML = "";

    const hostNames =
        Object.keys(hosts);

    if (hostNames.length === 0) {

        container.innerHTML = `
            <div class="approval-box">
                <strong>
                    <i class="fa-solid fa-circle-check"></i>
                    No violations detected
                </strong>

                <p>
                    The latest CSPM scan found no compliance violations.
                </p>
            </div>
        `;

        return;
    }


    hostNames.forEach(vm => {

        const violations =
            Array.isArray(hosts[vm])
                ? hosts[vm]
                : [];

        if (violations.length === 0) {
            return;
        }


        const section =
            document.createElement("div");

        section.className =
            "vm-finding-section";


        section.innerHTML = `
            <h3>
                <i class="fa-solid fa-server"></i>
                ${vm}
                <span class="badge info">
                    ${violations.length} violations
                </span>
            </h3>
        `;


        const list =
            document.createElement("div");

        list.className =
            "finding-list";


        violations.forEach(violation => {

            const row =
                document.createElement("div");

            row.className =
                "issue-row";

            row.innerHTML = `
                <strong>
                    <i class="fa-solid fa-triangle-exclamation"></i>
                    Violation
                </strong>

                <span>
                    ${escapeHTML(violation)}
                </span>
            `;

            list.appendChild(row);
        });


        section.appendChild(list);

        container.appendChild(section);

    });
}


// ================================
// AUTO REMEDIATE
// ================================

async function runRemediation() {

    const button =
        document.getElementById("remediateButton");

    if (button) {

        button.disabled = true;

        button.innerHTML = `
            <i class="fa-solid fa-spinner fa-spin"></i>
            Remediating...
        `;
    }


    updateCard(
        "remediationStatus",
        "RUNNING"
    );


    try {

        const result =
            await apiRequest(
                "/api/remediate",
                {
                    method: "POST"
                }
            );


        console.log(
            "Remediation result:",
            result
        );


        updateCard(
            "fixesApplied",
            result.fixes_applied ?? 0
        );


        updateCard(
            "remediationStatus",
            String(
                result.status || "UNKNOWN"
            ).toUpperCase()
        );


        renderRemediationResult(result);


        // Load the latest verified report.
        await loadRemediationReport();


        // Keep the actual remediation result visible.
        updateCard(
            "fixesApplied",
            result.fixes_applied ?? 0
        );

        updateCard(
            "remediationStatus",
            String(
                result.status || "UNKNOWN"
            ).toUpperCase()
        );


    } catch (error) {

        console.error(
            "Remediation failed:",
            error
        );

        updateCard(
            "remediationStatus",
            "FAILED"
        );

        alert(
            `Remediation failed:\n${error.message}`
        );

    } finally {

        if (button) {

            button.disabled = false;

            button.innerHTML = `
                <i class="fa-solid fa-screwdriver-wrench"></i>
                Auto Remediate
            `;
        }
    }
}


// ================================
// SHOW REMEDIATION RESULT
// ================================

function renderRemediationResult(result) {

    const container =
        document.getElementById(
            "remediationResult"
        );

    if (!container) {
        return;
    }


    const before =
        result.before || {};

    const after =
        result.after || {};


    container.innerHTML = `
        <div class="approval-box">

            <strong>
                <i class="fa-solid fa-circle-check"></i>
                Remediation ${result.status || "completed"}
            </strong>

            <p>
                Violations before:
                <strong>${before.total_violations ?? 0}</strong>
            </p>

            <p>
                Fixes applied:
                <strong>${result.fixes_applied ?? 0}</strong>
            </p>

            <p>
                Remaining violations:
                <strong>${after.total_violations ?? 0}</strong>
            </p>

            <p>
                Verification:
                <strong>
                    ${
                        result.verification
                            ? "PASSED"
                            : "FAILED"
                    }
                </strong>
            </p>

        </div>
    `;
}


// ================================
// HTML ESCAPE
// ================================

function escapeHTML(value) {

    const div =
        document.createElement("div");

    div.textContent =
        String(value);

    return div.innerHTML;
}


// ================================
// PAGE START
// ================================

document.addEventListener(
    "DOMContentLoaded",
    () => {

        loadRemediationReport();

        const button =
            document.getElementById(
                "remediateButton"
            );

        if (button) {

            button.addEventListener(
                "click",
                runRemediation
            );
        }

    }
);
