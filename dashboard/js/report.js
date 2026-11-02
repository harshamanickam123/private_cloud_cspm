/* =========================================================
   SENTINELFORGE - REPORT MANAGEMENT
   Uses real backend data and saved report files.
   Does not trigger scans or modify VMs.
   ========================================================= */

const API_BASE = "http://127.0.0.1:5000";

let reportData = null;
let securityData = null;
let libraryData = null;


/* =========================================================
   TOAST MESSAGES
   ========================================================= */

function showToast(message, type = "info") {
    let container = document.getElementById("toastContainer");

    if (!container) {
        container = document.createElement("div");
        container.id = "toastContainer";
        document.body.appendChild(container);
    }

    const toast = document.createElement("div");
    toast.className = "toast " + type;
    toast.textContent = message;

    container.appendChild(toast);

    setTimeout(() => toast.remove(), 3500);
}


/* =========================================================
   SAFE API REQUEST
   ========================================================= */

async function fetchJSON(endpoint) {
    const response = await fetch(`${API_BASE}${endpoint}`, {
        method: "GET",
        cache: "no-store"
    });

    if (!response.ok) {
        throw new Error(
            `${endpoint}: HTTP ${response.status}`
        );
    }

    return response.json();
}


/* =========================================================
   LOAD REPORT DATA
   ========================================================= */

async function loadReport() {
    const status = document.getElementById("resultsStatus");

    try {
        // Current security checks from collected VM settings.
        securityData = await fetchJSON("/api/security");

        // Latest timestamped scan report.
        try {
            reportData = await fetchJSON("/api/report");
        } catch (error) {
            console.warn(
                "Latest historical report unavailable:",
                error
            );

            reportData = null;
        }

        // Actual saved JSON reports and PDFs.
        try {
            libraryData = await fetchJSON("/api/reports/library");
        } catch (error) {
            console.warn(
                "Saved report library unavailable:",
                error
            );

            libraryData = null;
        }

        updateReportUI();
        renderReportHistory();

        if (status) {
            status.className = "status-box status-success";
            status.textContent =
                "Security data loaded from the SENTINELFORGE backend.";
        }

    } catch (error) {
        console.error("Unable to load report data:", error);

        if (status) {
            status.className = "status-box status-error";
            status.textContent =
                "Unable to load security data. Check whether the Flask API is running.";
        }

        showToast(
            "Could not load security report data.",
            "error"
        );
    }
}


/* =========================================================
   GET CURRENT SECURITY CHECKS
   ========================================================= */

function getRules() {
    if (
        !securityData ||
        !Array.isArray(securityData.rules)
    ) {
        return [];
    }

    return securityData.rules;
}


/* =========================================================
   CALCULATE SUMMARY
   ========================================================= */

function getSummary() {
    const rules = getRules();

    const passed = rules.filter(
        rule => rule.status === "PASS"
    ).length;

    const failed = rules.filter(
        rule => rule.status === "FAIL"
    ).length;

    const info = rules.filter(
        rule => rule.status === "INFO"
    ).length;

    const unknown = rules.filter(
        rule => !["PASS", "FAIL", "INFO"].includes(rule.status)
    ).length;

    const evaluated = passed + failed;

    return {
        total: rules.length,
        passed,
        failed,
        info,
        unknown,

        compliance: evaluated
            ? (passed / evaluated) * 100
            : 0,

        risk: evaluated
            ? (failed / evaluated) * 100
            : 0
    };
}


/* =========================================================
   FORMAT VALUES
   ========================================================= */

function formatPercent(value) {
    if (
        value === null ||
        value === undefined ||
        !Number.isFinite(value)
    ) {
        return "--";
    }

    return `${value.toFixed(1)}%`;
}


function formatDate(value) {
    if (!value) {
        return "Unavailable";
    }

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
        return "Unavailable";
    }

    return date.toLocaleString();
}


function formatFileSize(bytes) {
    if (!Number.isFinite(Number(bytes))) {
        return "Size unavailable";
    }

    const size = Number(bytes);

    if (size < 1024) {
        return `${size} B`;
    }

    if (size < 1024 * 1024) {
        return `${(size / 1024).toFixed(1)} KB`;
    }

    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}


function setText(id, value) {
    const element = document.getElementById(id);

    if (element) {
        element.textContent = value;
    }
}


function setBadge(id, text, className) {
    const element = document.getElementById(id);

    if (!element) {
        return;
    }

    element.textContent = text;
    element.className = `badge ${className}`;
}


/* =========================================================
   REPORT LIBRARY HELPERS
   ========================================================= */

function getJSONReports() {
    if (
        !libraryData ||
        !Array.isArray(libraryData.json_reports)
    ) {
        return [];
    }

    return libraryData.json_reports;
}


function getPDFReports() {
    if (
        !libraryData ||
        !Array.isArray(libraryData.pdf_reports)
    ) {
        return [];
    }

    return libraryData.pdf_reports;
}


function getLatestJSONReport() {
    return getJSONReports()[0] || null;
}


function getLatestPDFReport() {
    return getPDFReports()[0] || null;
}


/* =========================================================
   UPDATE REPORT PAGE
   ========================================================= */

function updateReportUI() {
    const summary = getSummary();
    const evaluated = summary.passed + summary.failed;

    const controller = securityData?.controller || {};

    const hosts = Array.isArray(securityData?.hosts)
        ? securityData.hosts
        : [];

    const jsonReports = getJSONReports();
    const pdfReports = getPDFReports();

    const jsonAvailable =
        !!libraryData &&
        jsonReports.length > 0;

    const pdfAvailable =
        !!libraryData &&
        pdfReports.length > 0;


    /* Scanner information */

    setText(
        "scannerName",
        securityData?.scanner?.name || "SENTINELFORGE"
    );

    setText(
        "scannerVersion",
        securityData?.scanner?.version || "Not configured"
    );

    setText(
        "framework",
        securityData?.framework || "Not configured"
    );


    /* Security summary */

    setText("totalChecks", summary.total);
    setText("passedChecks", summary.passed);
    setText("failedChecks", summary.failed);

    // The existing page has one information counter.
    // INFO and UNKNOWN remain separate in the JSON report.
    setText("infoChecks", summary.info + summary.unknown);

    const compliance = evaluated
        ? formatPercent(summary.compliance)
        : "--";

    const risk = evaluated
        ? formatPercent(summary.risk)
        : "--";

    setText("complianceScore", compliance);
    setText("riskScore", risk);
    setText("summaryCompliance", compliance);
    setText("summaryRisk", risk);


    /* Controller and target information */

    const controllerOS = [
        controller.operating_system,
        controller.os_release
    ].filter(Boolean).join(" ");

    setText(
        "controllerOS",
        controllerOS || "Controller information unavailable"
    );

    setText(
        "reportTarget",
        hosts.length
            ? hosts.join(", ")
            : "Host information unavailable"
    );


    /* Latest report timestamp */

    const latestTimestamp =
        reportData?.timestamp ||
        securityData?.timestamp ||
        null;

    setText(
        "latestReportTime",
        latestTimestamp
            ? formatDate(latestTimestamp)
            : "Timestamp unavailable"
    );


    /* Saved JSON report information */

    setText(
        "jsonCount",
        libraryData
            ? jsonReports.length
            : "Unavailable"
    );

    const latestJSON = getLatestJSONReport();

    setText(
        "jsonDate",
        latestJSON
            ? formatDate(latestJSON.modified * 1000)
            : "No saved JSON reports"
    );

    setBadge(
        "jsonStatus",
        jsonAvailable
            ? "Available"
            : libraryData
                ? "No saved reports"
                : "Unavailable",
        jsonAvailable ? "pass" : "info"
    );


    /* Saved PDF information */

    setText(
        "pdfCount",
        libraryData
            ? pdfReports.length
            : "Unavailable"
    );

    const latestPDF = getLatestPDFReport();

    setText(
        "pdfDate",
        latestPDF
            ? formatDate(latestPDF.modified * 1000)
            : "No saved PDFs"
    );

    setBadge(
        "pdfStatus",
        pdfAvailable
            ? "Available"
            : libraryData
                ? "No saved PDFs"
                : "Unavailable",
        pdfAvailable ? "pass" : "info"
    );


    /* Enable PDF viewing only when a real saved PDF exists */

    const viewButton = document.getElementById("viewPdfBtn");

    if (viewButton) {
        viewButton.disabled = !pdfAvailable;
    }


    /* Update the latest-report panel if it exists */

    const latestPanel = Array.from(
        document.querySelectorAll(".panel")
    ).find(panel =>
        panel.textContent.includes("Controller:") &&
        panel.textContent.includes("Target:")
    );

    if (latestPanel) {
        const heading = latestPanel.querySelector("h3");

        if (heading) {
            heading.textContent = "Latest Available Report";
        }

        latestPanel.querySelectorAll("p").forEach(paragraph => {
            const text = paragraph.textContent;

            if (text.includes("Controller:")) {
                paragraph.textContent =
                    `Controller: ${controllerOS || "Unavailable"}`;

            } else if (text.includes("Target:")) {
                paragraph.textContent =
                    `Target: ${hosts.length ? hosts.join(", ") : "Unavailable"}`;

            } else if (text.includes("Report Source:")) {
                paragraph.textContent =
                    `Report Source: ${securityData?.source || "Flask API"}`;
            }
        });
    }
}


/* =========================================================
   RENDER SAVED REPORTS IN THE EXISTING GENERATED REPORTS TABLE
   ========================================================= */

function renderReportHistory() {
    if (!libraryData) return;

    // Locate the Generated Reports panel without affecting other tables.
    const heading = Array.from(document.querySelectorAll("h2"))
        .find(item => item.textContent.includes("Generated Reports"));

    const panel = heading?.closest(".panel");
    const tbody = panel?.querySelector("table tbody");

    if (!tbody) {
        console.warn("Generated Reports table was not found.");
        return;
    }

    // Remove only previously rendered saved-report rows.
    tbody.querySelectorAll("tr[data-saved-report]").forEach(row => row.remove());

    const reports = [
        ...getPDFReports().map(report => ({ ...report, type: "PDF" })),
        ...getJSONReports().map(report => ({ ...report, type: "JSON" }))
    ].sort((a, b) => (b.modified || 0) - (a.modified || 0));

    reports.forEach(report => {
        const row = document.createElement("tr");
        row.dataset.savedReport = "true";

        const nameCell = document.createElement("td");
        nameCell.textContent = report.name;

        const typeCell = document.createElement("td");
        typeCell.textContent = report.type;

        const dateCell = document.createElement("td");
        dateCell.textContent = formatDate((report.modified || 0) * 1000);

        const statusCell = document.createElement("td");
        const badge = document.createElement("span");
        badge.className = "badge pass";
        badge.textContent = "Saved";
        statusCell.appendChild(badge);

        const actionCell = document.createElement("td");
        const link = document.createElement("a");
        link.className = "report-btn btn-view";
        link.textContent = report.type === "PDF" ? "View PDF" : "View JSON";
        link.target = "_blank";
        link.rel = "noopener noreferrer";

        const encodedName = encodeURIComponent(report.name);
        link.href = report.type === "PDF"
            ? `${API_BASE}/api/reports/pdf/${encodedName}`
            : `${API_BASE}/api/reports/json/${encodedName}`;

        actionCell.appendChild(link);
        row.append(nameCell, typeCell, dateCell, statusCell, actionCell);
        tbody.appendChild(row);
    });
}


/* =========================================================
   VIEW CURRENT SECURITY REPORT JSON
   ========================================================= */



async function viewScannerResults() {
    const panel = document.getElementById("scannerResults");
    const status = document.getElementById("resultsStatus");
    const viewer = document.getElementById("jsonViewer");

    if (!panel || !status || !viewer) {
        showToast("Report viewer elements are missing.", "error");
        return;
    }

    panel.classList.add("show");

    status.className = "status-box status-info";
    status.textContent = "Loading security report...";

    try {
        if (!securityData) {
            await loadReport();
        }

        if (!securityData) {
            throw new Error("Security data is unavailable.");
        }

        const summary = getSummary();

        const output = {
            report_name: "SENTINELFORGE Security Report",
            source: securityData.source || "SENTINELFORGE API",
            timestamp: securityData.timestamp || null,

            controller: securityData.controller || {},
            hosts: securityData.hosts || [],

            summary: {
                total_checks: summary.total,
                passed: summary.passed,
                failed: summary.failed,
                info: summary.info,
                unknown: summary.unknown,

                compliance_score: Number(
                    summary.compliance.toFixed(1)
                ),

                risk_score: Number(
                    summary.risk.toFixed(1)
                )
            },

            rules: getRules()
        };

        viewer.textContent = JSON.stringify(output, null, 2);

        status.className = "status-box status-success";
        status.textContent =
            "Current security report loaded successfully.";

        panel.scrollIntoView({ behavior: "smooth" });

    } catch (error) {
        console.error(error);

        status.className = "status-box status-error";
        status.textContent =
            "Unable to display the security report.";

        viewer.textContent = "";
    }
}


/* =========================================================
   DOWNLOAD CURRENT SECURITY REPORT AS JSON
   ========================================================= */

async function downloadJSON() {
    try {
        if (!securityData) {
            await loadReport();
        }

        if (!securityData) {
            throw new Error("Security data is unavailable.");
        }

        const summary = getSummary();

        const output = {
            report_name: "SENTINELFORGE Security Report",
            source: securityData.source || "SENTINELFORGE API",
            timestamp: securityData.timestamp || null,

            controller: securityData.controller || {},
            hosts: securityData.hosts || [],

            summary: {
                total_checks: summary.total,
                passed: summary.passed,
                failed: summary.failed,
                info: summary.info,
                unknown: summary.unknown,

                compliance_score: Number(
                    summary.compliance.toFixed(1)
                ),

                risk_score: Number(
                    summary.risk.toFixed(1)
                )
            },

            rules: getRules()
        };

        const blob = new Blob(
            [JSON.stringify(output, null, 2)],
            { type: "application/json" }
        );

        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");

        link.href = url;
        link.download = "sentinelforge-security-report.json";

        document.body.appendChild(link);
        link.click();
        link.remove();

        setTimeout(() => URL.revokeObjectURL(url), 1000);

        showToast(
            "JSON report downloaded successfully.",
            "success"
        );

    } catch (error) {
        console.error(error);

        showToast(
            "Unable to download the JSON report.",
            "error"
        );
    }
}


/* =========================================================
   GENERATE AND SAVE A PDF ON THE SERVER
   Uses an existing report; does not run a scan.
   ========================================================= */

async function generatePDF() {
    const button = document.querySelector(
        'button[onclick="generatePDF()"]'
    );

    if (button) {
        button.disabled = true;
        button.dataset.originalText = button.textContent.trim();
        button.textContent = "Generating PDF...";
    }

    try {
        const response = await fetch(
            `${API_BASE}/api/reports/generate-pdf`,
            { method: "POST" }
        );

        const result = await response.json();

        if (!response.ok || !result.success) {
            throw new Error(result.error || "PDF generation failed.");
        }

        showToast("PDF saved successfully: " + result.filename, "success");

        // Refresh the saved-file library and existing counters.
        libraryData = await fetchJSON("/api/reports/library");
        updateReportUI();
        renderReportHistory();

        // Open the newly saved PDF.
        window.open(
            `${API_BASE}/api/reports/pdf/${encodeURIComponent(result.filename)}`,
            "_blank",
            "noopener,noreferrer"
        );

    } catch (error) {
        console.error("PDF generation failed:", error);
        showToast(error.message || "Unable to generate PDF.", "error");
    } finally {
        if (button) {
            button.disabled = false;
            button.textContent = button.dataset.originalText || "Generate PDF";
        }
    }
}


/* =========================================================
   VIEW LATEST SAVED PDF
   ========================================================= */



function viewPDF() {
    const latestPDF = getLatestPDFReport();

    if (!latestPDF) {
        showToast(
            "No saved PDF is available on the server.",
            "info"
        );

        return;
    }

    const url =
        `${API_BASE}/api/reports/pdf/` +
        encodeURIComponent(latestPDF.name);

    window.open(url, "_blank", "noopener,noreferrer");
}


/* =========================================================
   ESCAPE HTML
   ========================================================= */

function escapeHTML(value) {
    if (value === null || value === undefined) {
        return "";
    }

    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}


/* =========================================================
   INITIALIZATION
   ========================================================= */

document.addEventListener("DOMContentLoaded", loadReport);
