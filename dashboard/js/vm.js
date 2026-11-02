// ============================================================
// SENTINELFORGE - REAL VM MANAGEMENT
// ============================================================

// Friendly dashboard name -> real libvirt VM name
const VM_MAP = {
    "Ubuntu-Server-01": "vm1",
    "Ubuntu-Server-02": "vm2"
};

const DISPLAY_VM_MAP = {
    vm1: "Ubuntu-Server-01",
    vm2: "Ubuntu-Server-02"
};

let currentVM = null;
let latestReport = null;
let operationRunning = false;


// ============================================================
// PAGE LOAD
// ============================================================

document.addEventListener("DOMContentLoaded", async () => {

    console.log("VM dashboard loaded.");

    await refreshVM();

    // Check report separately.
    await loadLatestReport();

});


// ============================================================
// BASIC HELPERS
// ============================================================

function getBackendVM(displayName) {

    return VM_MAP[displayName] || null;

}


function getDisplayVM(backendName) {

    return DISPLAY_VM_MAP[backendName] || backendName;

}


function sleep(ms) {

    return new Promise(resolve => setTimeout(resolve, ms));

}


function formatNumber(value, decimals = 2) {

    if (
        value === null ||
        value === undefined ||
        Number.isNaN(Number(value))
    ) {
        return "Not available";
    }

    return Number(value).toFixed(decimals);

}


function formatDate(timestamp) {

    if (!timestamp) {
        return "Not available";
    }

    const date = new Date(timestamp);

    if (Number.isNaN(date.getTime())) {
        return timestamp;
    }

    return date.toLocaleString([], {
        dateStyle: "medium",
        timeStyle: "short"
    });

}


// ============================================================
// TOAST
// ============================================================

function showToast(message, type = "info") {

    let container =
        document.getElementById("toastContainer");

    if (!container) {

        container = document.createElement("div");

        container.id = "toastContainer";

        document.body.appendChild(container);

    }

    const toast =
        document.createElement("div");

    toast.className =
        `toast toast-${type}`;

    toast.textContent = message;

    container.appendChild(toast);

    setTimeout(() => {

        toast.classList.add("hide");

        setTimeout(() => {

            toast.remove();

        }, 300);

    }, 4000);

}


// ============================================================
// ACTIVITY LOG
// ============================================================

function addLog(message) {

    const log =
        document.getElementById("activityLog");

    if (!log) {
        return;
    }

    const empty =
        log.querySelector(".empty-log");

    if (empty) {
        empty.remove();
    }

    const row =
        document.createElement("div");

    row.className = "activity-item";

    const time =
        new Date().toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit"
        });

    row.innerHTML = `
        <span class="activity-time">${time}</span>
        <span class="activity-message">${escapeHtml(message)}</span>
    `;

    log.prepend(row);

}


function escapeHtml(value) {

    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");

}


// ============================================================
// STATUS HELPERS
// ============================================================

function normalizeStatus(status) {

    if (!status) {
        return "unknown";
    }

    const value =
        String(status)
            .trim()
            .toLowerCase();

    if (value === "running") {
        return "running";
    }

    if (
        value === "shut off" ||
        value === "shutoff" ||
        value === "off"
    ) {
        return "stopped";
    }

    return value;

}


function statusLabel(status) {

    const normalized =
        normalizeStatus(status);

    if (normalized === "running") {
        return "Running";
    }

    if (normalized === "stopped") {
        return "Stopped";
    }

    if (normalized === "unknown") {
        return "Unknown";
    }

    return status || "Unknown";

}


function statusHtml(status) {

    const normalized =
        normalizeStatus(status);

    if (normalized === "running") {

        return `
            <span class="status-badge running">
                <span class="status-dot"></span>
                Running
            </span>
        `;

    }

    if (normalized === "stopped") {

        return `
            <span class="status-badge stopped">
                <span class="status-dot"></span>
                Stopped
            </span>
        `;

    }

    return `
        <span class="status-badge unknown">
            <span class="status-dot"></span>
            Unknown
        </span>
    `;

}


// ============================================================
// VM LIST
// ============================================================

async function getAllVMs() {

    const result =
        await apiRequest("/api/vms");

    if (!result.success) {

        throw new Error(
            "Unable to get VM list"
        );

    }

    return result.vms || [];

}


// ============================================================
// LOAD VM STATUS
// ============================================================

async function loadVMStatus() {

    if (!currentVM) {
        return null;
    }

    const backendVM =
        getBackendVM(currentVM);

    if (!backendVM) {
        return null;
    }

    try {

        const result =
            await apiRequest(
                `/api/vm/${backendVM}/status`
            );

        if (!result.success) {

            throw new Error(
                result.error ||
                "Unable to get VM status"
            );

        }

        updateStatus(result.status);

        return result.status;

    } catch (error) {

        console.error(
            "VM status error:",
            error
        );

        updateStatus("Unknown");

        throw error;

    }

}


// ============================================================
// UPDATE DETAIL STATUS
// ============================================================

function updateStatus(status) {

    const element =
        document.getElementById("detailStatus");

    if (!element) {
        return;
    }

    element.innerHTML =
        statusHtml(status);

}


// ============================================================
// LOAD VM STATS
// ============================================================

async function loadVMStats() {

    if (!currentVM) {
        return null;
    }

    const backendVM =
        getBackendVM(currentVM);

    if (!backendVM) {
        return null;
    }

    try {

        const result =
            await apiRequest(
                `/api/vm/${backendVM}/stats`
            );

        if (!result.success) {

            throw new Error(
                result.error ||
                "Unable to get VM statistics"
            );

        }

        updateVMStats(result);

        return result;

    } catch (error) {

        console.error(
            "VM stats error:",
            error
        );

        return null;

    }

}


// ============================================================
// UPDATE VM STATS
// ============================================================

function updateVMStats(data) {

    if (!data) {
        return;
    }

    // --------------------------------------------------------
    // DETAIL PAGE
    // --------------------------------------------------------

    const status =
        document.getElementById("detailStatus");

    if (status) {
        status.innerHTML =
            statusHtml(data.status);
    }


    const ip =
        document.getElementById("detailIP");

    if (ip) {

        ip.textContent =
            data.ip_address ||
            "Not available";

    }


    const cpu =
        document.getElementById("detailCPU");

    if (cpu) {

        if (
            data.cpu_usage_percent !== null &&
            data.cpu_usage_percent !== undefined
        ) {

            cpu.textContent =
                `${formatNumber(
                    data.cpu_usage_percent,
                    2
                )}%`;

        } else {

            cpu.textContent =
                "Not available";

        }

    }


    const memory =
        document.getElementById("detailRAM");

    if (memory) {

        if (
            data.memory_rss_mb !== null &&
            data.memory_rss_mb !== undefined
        ) {

            memory.textContent =
                `${formatNumber(
                    data.memory_rss_mb,
                    2
                )} MB`;

        } else {

            memory.textContent =
                "Not available";

        }

    }


    const disk =
        document.getElementById("detailDisk");

    if (disk) {

        // Backend does not currently expose
        // disk usage.
        disk.textContent =
            "Not available";

    }


    // IMPORTANT:
    // security_model = AppArmor/libvirt security model.
    // It is NOT the CSPM security result.
    //
    // Therefore we intentionally do not put
    // data.security_model into detailSecurity.

}


// ============================================================
// OPEN VM DETAILS
// ============================================================

async function showVMDetails(displayName) {

    if (!VM_MAP[displayName]) {

        showToast(
            "Unknown VM selected.",
            "error"
        );

        return;

    }

    currentVM = displayName;

    const section =
        document.getElementById(
            "vmDetailsSection"
        );

    if (section) {
        section.classList.remove("hidden");
    }


    const title =
        document.getElementById(
            "selectedVMTitle"
        );

    if (title) {
        title.textContent =
            displayName;
    }


    const subtitle =
        document.getElementById(
            "selectedVMSubtitle"
        );

    if (subtitle) {

        subtitle.textContent =
            `Real libvirt VM: ${VM_MAP[displayName]}`;

    }


    // Reset temporary information
    const compliance =
        document.getElementById(
            "detailCompliance"
        );

    if (compliance) {
        compliance.textContent =
            "Not scanned";
    }


    const security =
        document.getElementById(
            "detailSecurity"
        );

    if (security) {
        security.textContent =
            "Not scanned";
    }


    const scan =
        document.getElementById(
            "detailScan"
        );

    if (scan) {
        scan.textContent =
            "Not scanned";
    }


    addLog(
        `${displayName} details opened.`
    );


    try {

        await loadVMStatus();
        await loadVMStats();

        updateSelectedVMFromReport();

    } catch (error) {

        console.error(
            "Unable to load VM details:",
            error
        );

        showToast(
            "Unable to load VM details.",
            "error"
        );

    }

}


// ============================================================
// CLOSE VM DETAILS
// ============================================================

function closeVMDetails() {

    const section =
        document.getElementById(
            "vmDetailsSection"
        );

    if (section) {
        section.classList.add("hidden");
    }

}


// ============================================================
// WAIT FOR VM STATE
// ============================================================

async function waitForVMState(
    displayName,
    expectedState,
    maxAttempts = 20
) {

    const backendVM =
        getBackendVM(displayName);

    if (!backendVM) {
        return false;
    }

    for (
        let attempt = 0;
        attempt < maxAttempts;
        attempt++
    ) {

        try {

            const result =
                await apiRequest(
                    `/api/vm/${backendVM}/status`
                );

            if (
                result.success &&
                normalizeStatus(result.status) ===
                expectedState
            ) {

                return true;

            }

        } catch (error) {

            console.warn(
                "Waiting for VM state:",
                error
            );

        }

        await sleep(1000);

    }

    return false;

}


// ============================================================
// START ALL VMS
// ============================================================

async function startAllVMs() {

    if (operationRunning) {
        return;
    }

    operationRunning = true;

    try {

        showToast(
            "Starting all VMs...",
            "info"
        );

        addLog(
            "Start-all operation started."
        );

        const vms =
            await getAllVMs();

        if (!vms.length) {

            throw new Error(
                "No VMs found."
            );

        }

        for (const vm of vms) {

            const name =
                vm.name;

            const state =
                normalizeStatus(vm.state);

            if (state === "running") {

                addLog(
                    `${name} is already running.`
                );

                continue;

            }

            addLog(
                `Starting ${name}...`
            );

            await apiRequest(
                `/api/vm/${name}/start`,
                {
                    method: "POST"
                }
            );

            const displayName =
                getDisplayVM(name);

            const started =
                await waitForVMState(
                    displayName,
                    "running"
                );

            if (started) {

                addLog(
                    `${name} is now running.`
                );

            } else {

                addLog(
                    `${name} did not reach running state within the wait period.`
                );

            }

        }

        await refreshVM();

        if (currentVM) {

            await loadVMStatus();
            await loadVMStats();

        }

        showToast(
            "Start-all operation completed.",
            "success"
        );

        addLog(
            "Start-all operation completed."
        );

    } catch (error) {

        console.error(
            "Start-all error:",
            error
        );

        showToast(
            `Failed to start VMs: ${error.message}`,
            "error"
        );

        addLog(
            `Start-all failed: ${error.message}`
        );

    } finally {

        operationRunning = false;

    }

}


// ============================================================
// STOP ALL VMS
// ============================================================

async function stopAllVMs() {

    if (operationRunning) {
        return;
    }

    operationRunning = true;

    try {

        showToast(
            "Stopping all VMs...",
            "info"
        );

        addLog(
            "Stop-all operation started."
        );

        const vms =
            await getAllVMs();

        if (!vms.length) {

            throw new Error(
                "No VMs found."
            );

        }

        for (const vm of vms) {

            const name =
                vm.name;

            const state =
                normalizeStatus(vm.state);

            if (state === "stopped") {

                addLog(
                    `${name} is already stopped.`
                );

                continue;

            }

            addLog(
                `Stopping ${name}...`
            );

            await apiRequest(
                `/api/vm/${name}/stop`,
                {
                    method: "POST"
                }
            );

            const displayName =
                getDisplayVM(name);

            const stopped =
                await waitForVMState(
                    displayName,
                    "stopped"
                );

            if (stopped) {

                addLog(
                    `${name} is now stopped.`
                );

            } else {

                addLog(
                    `${name} did not reach stopped state within the wait period.`
                );

            }

        }

        await refreshVM();

        if (currentVM) {

            await loadVMStatus();
            await loadVMStats();

        }

        showToast(
            "Stop-all operation completed.",
            "success"
        );

        addLog(
            "Stop-all operation completed."
        );

    } catch (error) {

        console.error(
            "Stop-all error:",
            error
        );

        showToast(
            `Failed to stop VMs: ${error.message}`,
            "error"
        );

        addLog(
            `Stop-all failed: ${error.message}`
        );

    } finally {

        operationRunning = false;

    }

}


// ============================================================
// RESTART ALL VMS
// ============================================================

async function restartAllVMs() {

    if (operationRunning) {
        return;
    }

    operationRunning = true;

    try {

        showToast(
            "Restarting all VMs...",
            "info"
        );

        addLog(
            "Restart-all operation started."
        );

        const vms =
            await getAllVMs();

        if (!vms.length) {

            throw new Error(
                "No VMs found."
            );

        }

        for (const vm of vms) {

            const name =
                vm.name;

            const state =
                normalizeStatus(vm.state);

            const displayName =
                getDisplayVM(name);

            if (state === "stopped") {

                addLog(
                    `${name} is stopped. Starting it...`
                );

                await apiRequest(
                    `/api/vm/${name}/start`,
                    {
                        method: "POST"
                    }
                );

            } else {

                addLog(
                    `Restarting ${name}...`
                );

                await apiRequest(
                    `/api/vm/${name}/restart`,
                    {
                        method: "POST"
                    }
                );

            }

            const running =
                await waitForVMState(
                    displayName,
                    "running"
                );

            if (running) {

                addLog(
                    `${name} is running after restart operation.`
                );

            } else {

                addLog(
                    `${name} did not reach running state within the wait period.`
                );

            }

        }

        await refreshVM();

        if (currentVM) {

            await loadVMStatus();
            await loadVMStats();

        }

        showToast(
            "Restart-all operation completed.",
            "success"
        );

        addLog(
            "Restart-all operation completed."
        );

    } catch (error) {

        console.error(
            "Restart-all error:",
            error
        );

        showToast(
            `Failed to restart VMs: ${error.message}`,
            "error"
        );

        addLog(
            `Restart-all failed: ${error.message}`
        );

    } finally {

        operationRunning = false;

    }

}


// ============================================================
// REAL CSPM SECURITY SCAN
// ============================================================

async function securityScan() {

    if (operationRunning) {
        return;
    }

    operationRunning = true;

    const button =
        document.getElementById(
            "securityScanButton"
        );

    if (button) {
        button.disabled = true;
        button.textContent =
            "Scanning...";
    }


    const compliance =
        document.getElementById(
            "detailCompliance"
        );

    const security =
        document.getElementById(
            "detailSecurity"
        );

    const scan =
        document.getElementById(
            "detailScan"
        );


    if (compliance) {
        compliance.textContent =
            "Scanning...";
    }

    if (security) {
        security.textContent =
            "Scanning...";
    }

    if (scan) {
        scan.textContent =
            "In progress";
    }


    try {

        showToast(
            "CSPM security scan started...",
            "info"
        );

        addLog(
            "CSPM security scan started."
        );


        // ----------------------------------------------------
        // REAL BACKEND SCAN
        // ----------------------------------------------------

        const result =
            await apiRequest(
                "/api/scan",
                {
                    method: "POST"
                }
            );

        console.log(
            "Security scan response:",
            result
        );


        if (!result.success) {

            let message =
                "CSPM scan failed";

            if (
                result.error &&
                typeof result.error === "object"
            ) {

                message =
                    result.error.stderr ||
                    result.error.stdout ||
                    message;

            } else if (
                typeof result.error === "string"
            ) {

                message =
                    result.error;

            }

            throw new Error(message);

        }


        // ----------------------------------------------------
        // GET REAL REPORT
        // ----------------------------------------------------

        const report =
            await apiRequest(
                "/api/report"
            );

        console.log(
            "Latest CSPM report:",
            report
        );


        if (!report) {

            throw new Error(
                "Empty CSPM report received."
            );

        }


        latestReport =
            report;


        const totalViolations =
            Number(
                report.total_violations || 0
            );


        console.log(
            "Total CSPM violations:",
            totalViolations
        );


        // ----------------------------------------------------
        // IMPORTANT:
        // Current API gives total violations.
        // It does NOT currently give enough data
        // to calculate a legitimate percentage here.
        // ----------------------------------------------------

        if (compliance) {

            if (totalViolations === 0) {

                compliance.textContent =
                    "0 issues";

            } else {

                compliance.textContent =
                    `${totalViolations} issues`;

            }

        }


        if (security) {

            if (totalViolations === 0) {

                security.textContent =
                    "No violations found";

            } else {

                security.textContent =
                    "Issues Found";

            }

        }


        if (scan) {

            scan.textContent =
                report.timestamp
                    ? formatDate(report.timestamp)
                    : "Completed";

        }


        addLog(
            `CSPM scan completed: ${totalViolations} violations found.`
        );


        showToast(
            totalViolations === 0
                ? "CSPM scan completed. No violations found."
                : `CSPM scan completed. ${totalViolations} violations found.`,
            totalViolations === 0
                ? "success"
                : "warning"
        );


        updateSelectedVMFromReport();

        await refreshVMTable();

    } catch (error) {

        console.error(
            "Security scan error:",
            error
        );


        if (compliance) {
            compliance.textContent =
                "Unavailable";
        }

        if (security) {
            security.textContent =
                "Scan Failed";
        }

        if (scan) {
            scan.textContent =
                "Failed";
        }


        showToast(
            `Security scan failed: ${error.message}`,
            "error"
        );

        addLog(
            `CSPM scan failed: ${error.message}`
        );

    } finally {

        operationRunning = false;

        if (button) {

            button.disabled = false;

            button.textContent =
                "🛡 Security Scan";

        }

    }

}


// ============================================================
// REPORT
// ============================================================

async function loadLatestReport() {

    try {

        const report =
            await apiRequest(
                "/api/report"
            );

        latestReport =
            report;

        console.log(
            "Latest CSPM report loaded:",
            report
        );

        updateSelectedVMFromReport();

    } catch (error) {

        console.log(
            "No CSPM report available yet."
        );

        latestReport = null;

    }

}


// ============================================================
// UPDATE SELECTED VM FROM REPORT
// ============================================================

function updateSelectedVMFromReport() {

    if (!currentVM || !latestReport) {
        return;
    }

    const compliance =
        document.getElementById(
            "detailCompliance"
        );

    const security =
        document.getElementById(
            "detailSecurity"
        );

    const scan =
        document.getElementById(
            "detailScan"
        );


    const totalViolations =
        Number(
            latestReport.total_violations || 0
        );


    // We can safely display the GLOBAL report count.
    // We do not pretend this is a per-VM percentage.

    if (compliance) {

        if (
            latestReport.timestamp
        ) {

            compliance.textContent =
                `${totalViolations} issues`;

        }

    }


    if (security) {

        security.textContent =
            totalViolations === 0
                ? "No violations found"
                : "Issues Found";

    }


    if (scan) {

        scan.textContent =
            latestReport.timestamp
                ? formatDate(
                    latestReport.timestamp
                )
                : "Not available";

    }

}


// ============================================================
// REFRESH ENTIRE PAGE
// ============================================================

async function refreshVM() {

    try {

        await refreshVMSummary();

        await refreshVMTable();

        if (currentVM) {

            await loadVMStatus();
            await loadVMStats();

        }

        await loadLatestReport();

    } catch (error) {

        console.error(
            "VM refresh error:",
            error
        );

        showToast(
            `Refresh failed: ${error.message}`,
            "error"
        );

    }

}


// ============================================================
// REFRESH VM TABLE
// ============================================================

async function refreshVMTable() {

    const tableBody =
        document.getElementById(
            "vmTableBody"
        );

    if (!tableBody) {
        return;
    }


    try {

        const vms =
            await getAllVMs();


        tableBody.innerHTML = "";


        if (!vms.length) {

            tableBody.innerHTML = `
                <tr>
                    <td colspan="6"
                        class="empty-state">
                        No virtual machines found.
                    </td>
                </tr>
            `;

            return;

        }


        for (const vm of vms) {

            const displayName =
                getDisplayVM(vm.name);

            let stats = null;

            try {

                stats =
                    await apiRequest(
                        `/api/vm/${vm.name}/stats`
                    );

            } catch (error) {

                console.warn(
                    `Unable to get stats for ${vm.name}`,
                    error
                );

            }


            const ip =
                stats?.ip_address ||
                "Not available";


            const row =
                document.createElement("tr");


            row.innerHTML = `
                <td>
                    <div class="vm-name-cell">
                        <span class="server-icon">▤</span>
                        <div>
                            <strong>${escapeHtml(displayName)}</strong>
                            <small>${escapeHtml(vm.name)}</small>
                        </div>
                    </div>
                </td>

                <td>Ubuntu</td>

                <td>
                    ${statusHtml(vm.state)}
                </td>

                <td>
                    ${escapeHtml(ip)}
                </td>

                <td class="compliance-cell">
                    ${
                        latestReport
                            ? (
                                Number(
                                    latestReport.total_violations || 0
                                ) === 0
                                    ? "0 issues"
                                    : `${Number(
                                        latestReport.total_violations || 0
                                      )} issues`
                              )
                            : "Not scanned"
                    }
                </td>

                <td>
                    <button
                        class="view-button"
                        onclick="showVMDetails('${escapeHtml(displayName)}')">
                        View
                    </button>
                </td>
            `;


            tableBody.appendChild(row);

        }

    } catch (error) {

        console.error(
            "VM table error:",
            error
        );

        tableBody.innerHTML = `
            <tr>
                <td colspan="6"
                    class="empty-state error-text">
                    Unable to load VM information.
                </td>
            </tr>
        `;

    }

}


// ============================================================
// REFRESH SUMMARY CARDS
// ============================================================

async function refreshVMSummary() {

    const totalElement =
        document.getElementById(
            "totalVM"
        );

    const runningElement =
        document.getElementById(
            "runningVM"
        );

    const cpuElement =
        document.getElementById(
            "cpuUsage"
        );

    const memoryElement =
        document.getElementById(
            "memoryUsage"
        );


    try {

        const vms =
            await getAllVMs();


        const total =
            vms.length;


        const running =
            vms.filter(
                vm =>
                    normalizeStatus(
                        vm.state
                    ) === "running"
            ).length;


        const stats =
            await Promise.all(
                vms.map(
                    async vm => {

                        try {

                            return await apiRequest(
                                `/api/vm/${vm.name}/stats`
                            );

                        } catch {

                            return null;

                        }

                    }
                )
            );


        const cpuValues =
            stats
                .map(
                    item =>
                        item?.cpu_usage_percent
                )
                .filter(
                    value =>
                        value !== null &&
                        value !== undefined
                );


        const memoryValues =
            stats
                .map(
                    item =>
                        item?.memory_rss_mb
                )
                .filter(
                    value =>
                        value !== null &&
                        value !== undefined
                );


        if (totalElement) {

            totalElement.textContent =
                total;

        }


        if (runningElement) {

            runningElement.textContent =
                running;

        }


        if (cpuElement) {

            if (cpuValues.length) {

                const averageCPU =
                    cpuValues.reduce(
                        (
                            totalValue,
                            value
                        ) =>
                            totalValue +
                            Number(value),
                        0
                    ) /
                    cpuValues.length;


                cpuElement.textContent =
                    `${averageCPU.toFixed(2)}%`;

            } else {

                cpuElement.textContent =
                    "Not available";

            }

        }


        if (memoryElement) {

            if (memoryValues.length) {

                const totalMemoryMB =
                    memoryValues.reduce(
                        (
                            totalValue,
                            value
                        ) =>
                            totalValue +
                            Number(value),
                        0
                    );


                const totalMemoryGB =
                    totalMemoryMB / 1024;


                memoryElement.textContent =
                    `${totalMemoryGB.toFixed(2)} GB`;

            } else {

                memoryElement.textContent =
                    "Not available";

            }

        }

    } catch (error) {

        console.error(
            "VM summary error:",
            error
        );

        if (totalElement) {
            totalElement.textContent = "—";
        }

        if (runningElement) {
            runningElement.textContent = "—";
        }

        if (cpuElement) {
            cpuElement.textContent = "—";
        }

        if (memoryElement) {
            memoryElement.textContent = "—";
        }

    }

}


// ============================================================
// EXPORT FUNCTIONS FOR HTML onclick
// ============================================================

window.showVMDetails =
    showVMDetails;

window.closeVMDetails =
    closeVMDetails;

window.startAllVMs =
    startAllVMs;

window.stopAllVMs =
    stopAllVMs;

window.restartAllVMs =
    restartAllVMs;

window.securityScan =
    securityScan;

window.refreshVM =
    refreshVM;
