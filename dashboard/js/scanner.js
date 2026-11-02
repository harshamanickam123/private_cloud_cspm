
// CSPM Security Scanner UI
// ============================================

const scannerMessages = [
    "Connecting to CSPM scanner...",
    "Collecting security configuration...",
    "Checking CIS Benchmark...",
    "Calculating Risk Score...",
    "Generating Report..."
];

let messageIndex = 0;


// ============================================
// Scanner Status Element
// ============================================

function getScanStatusElement() {

    return document.getElementById("scanStatus");

}


// ============================================
// Show Temporary Scanner Activity
// ============================================

function showScannerActivity() {

    const element = getScanStatusElement();

    if (!element) {
        return;
    }

    element.innerText =
        scannerMessages[messageIndex];

    messageIndex++;

    if (messageIndex >= scannerMessages.length) {
        messageIndex = 0;
    }

}


// ============================================
// Load Report Status
// ============================================

async function updateScannerStatus() {

    const element = getScanStatusElement();

    if (!element) {
        return;
    }

    try {

        const report = await apiRequest("/api/report");

        if (!report.summary) {

            element.innerText =
                "Invalid CSPM report";

            return;
        }

        const summary = report.summary;

        const total =
            Number(summary.total_checks || 0);

        const pass =
            Number(summary.pass || 0);

        const fail =
            Number(summary.fail || 0);

        const compliance =
            Number(summary.compliance_score || 0);

        const risk =
            Number(summary.risk_score || 0);


        // ====================================
        // Final Scan Status
        // ====================================

        if (fail > 0) {

            element.innerText =
                `Scan completed — ${total} checks | ` +
                `${pass} passed | ${fail} failed | ` +
                `Compliance ${compliance.toFixed(0)}% | ` +
                `Risk ${risk.toFixed(0)}%`;

        } else {

            element.innerText =
                `Scan completed — ${total} checks | ` +
                `${pass} passed | ` +
                `Compliance ${compliance.toFixed(0)}% | ` +
                `Risk ${risk.toFixed(0)}%`;

        }

    }

    catch (error) {

        console.error(
            "CSPM scanner report error:",
            error
        );

        element.innerText =
            "Waiting for CSPM scan report...";

    }

}


// ============================================
// Initial Status
// ============================================

updateScannerStatus();


// ============================================
// Refresh Report Status
// ============================================

setInterval(
    updateScannerStatus,
    10000
);
