// =====================================
// Advanced Private Cloud CSPM Dashboard
// =====================================

// Default Dashboard Statistics

const dashboardData = {

    totalVMs: 1,
    compliance: 0,
    risk: 0,
    alerts: 0

};


// =====================================
// Load Real CSPM Report
// =====================================

async function loadCSPMReport(){

    try{

        const response =
            await fetch("../reports/report.json?time=" + Date.now());

        if(!response.ok){

            throw new Error(
                "Unable to load report.json"
            );

        }

        const report =
            await response.json();


        // =================================
        // Read Summary
        // =================================

        const summary =
            report.summary || {};


        dashboardData.compliance =
            Number(
                summary.compliance_score || 0
            );


        dashboardData.risk =
            Number(
                summary.risk_score || 0
            );


        dashboardData.alerts =
            Number(
                summary.fail || 0
            );


        // =================================
        // Update Last Scan
        // =================================

        const scanTime =
            document.getElementById("scanTime");


        if(scanTime){

            const now =
                new Date();

            scanTime.innerHTML =
                "Last Scan: " +
                now.toLocaleString();

        }


        updateDashboard();

        updateProgress();


        console.log(
            "CSPM report loaded successfully:",
            report
        );

    }

    catch(error){

        console.error(
            "CSPM report loading failed:",
            error
        );

    }

}


// =====================================
// Update Dashboard Cards
// =====================================

function updateDashboard(){

    const vmCount =
        document.getElementById("vmCount");

    const compliance =
        document.getElementById("compliance");

    const risk =
        document.getElementById("risk");

    const alerts =
        document.getElementById("alerts");


    if(vmCount){

        vmCount.innerHTML =
            dashboardData.totalVMs;

    }


    if(compliance){

        compliance.innerHTML =
            dashboardData.compliance.toFixed(0) + "%";

    }


    if(risk){

        risk.innerHTML =
            dashboardData.risk.toFixed(0) + "%";

    }


    if(alerts){

        alerts.innerHTML =
            dashboardData.alerts;

    }

}


// =====================================
// Progress Circle
// =====================================

function updateProgress(){

    const progress =
        document.getElementById("progressValue");


    if(progress){

        progress.innerHTML =
            dashboardData.compliance.toFixed(0) + "%";

    }

}


// =====================================
// Clock
// =====================================

function updateClock(){

    const clock =
        document.getElementById("clock");


    if(clock){

        const now =
            new Date();

        clock.innerHTML =
            now.toLocaleString();

    }

}


// =====================================
// Auto Refresh Clock
// =====================================

setInterval(
    updateClock,
    1000
);


// =====================================
// Reload CSPM Report
// =====================================

setInterval(
    loadCSPMReport,
    30000
);


// =====================================
// Initial Dashboard Load
// =====================================

window.onload = function(){

    updateDashboard();

    updateProgress();

    updateClock();

    loadCSPMReport();

};
