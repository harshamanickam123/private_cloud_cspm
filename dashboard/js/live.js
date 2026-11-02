// ============================================
// SENTINELFORGE - LIVE MAIN DASHBOARD
// Data sources: /api/vms, /api/compliance, /api/security
// ============================================

const DASHBOARD_WEIGHTS = {
    CRITICAL: 10,
    HIGH: 7,
    MEDIUM: 4,
    LOW: 1
};

function updateTime() {
    const scanTime = document.getElementById("scanTime");

    if (scanTime) {
        scanTime.textContent =
            "Last Dashboard Update: " + new Date().toLocaleString();
    }
}

// Same severity-weighted calculation as the Security page.
function calculateDashboardRisk(rules) {
    let totalWeight = 0;
    let failedWeight = 0;

    rules.forEach(rule => {
        const weight = DASHBOARD_WEIGHTS[rule.severity] || 1;

        totalWeight += weight;

        if (rule.status === "FAIL") {
            failedWeight += weight;
        }
    });

    return totalWeight
        ? Math.round((failedWeight / totalWeight) * 1000) / 10
        : null;
}

function setCard(id, value) {
    const element = document.getElementById(id);

    if (element) {
        element.textContent = value;
    }
}

async function loadDashboardCards() {
    const results = await Promise.allSettled([
        apiRequest("/api/vms"),
        apiRequest("/api/compliance"),
        apiRequest("/api/security")
    ]);

    // Total VMs
    if (results[0].status === "fulfilled") {
        const data = results[0].value;

        setCard(
            "vmCount",
            data.success === false || data.count === undefined
                ? "N/A"
                : data.count
        );
    } else {
        console.error("Unable to load VM count:", results[0].reason);
        setCard("vmCount", "N/A");
    }

    // Compliance score
    if (results[1].status === "fulfilled") {
        const data = results[1].value;
        const score = data.summary?.compliance_score;

        setCard(
            "compliance",
            data.success === false ||
            score === undefined ||
            score === null
                ? "N/A"
                : Number(score).toFixed(1) + "%"
        );
    } else {
        console.error("Unable to load compliance:", results[1].reason);
        setCard("compliance", "N/A");
    }

    // Risk score and active alerts
    if (results[2].status === "fulfilled") {
        const data = results[2].value;
        const rules = data.rules;

        if (Array.isArray(rules)) {
            const risk = calculateDashboardRisk(rules);

            setCard(
                "risk",
                risk === null ? "N/A" : risk.toFixed(1) + "%"
            );

            const activeAlerts = rules.filter(rule =>
                rule.status === "FAIL" ||
                rule.status === "WARNING"
            );

            setCard("alerts", activeAlerts.length);
        } else {
            setCard("risk", "N/A");
            setCard("alerts", "N/A");
        }
    } else {
        console.error("Unable to load security findings:", results[2].reason);
        setCard("risk", "N/A");
        setCard("alerts", "N/A");
    }

    updateTime();
}

// Initial load
loadDashboardCards();

// Refresh dashboard values every 10 seconds
setInterval(loadDashboardCards, 10000);
