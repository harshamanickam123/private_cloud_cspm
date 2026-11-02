// ================================
// Compliance Pie Chart
// ================================

window.addEventListener("load", function () {

    const pie = document.getElementById("complianceChart");

    if (pie) {

        new Chart(pie, {

            type: "doughnut",

            data: {

                labels: ["PASS", "FAIL", "INFO"],

                datasets: [{

                    data: [1, 0, 2],

                    backgroundColor: [
                        "#22c55e",
                        "#ef4444",
                        "#3b82f6"
                    ],

                    borderWidth: 2

                }]

            },

            options: {

                responsive: true,

                plugins: {

                    legend: {

                        position: "bottom",

                        labels: {

                            color: "white"

                        }

                    }

                }

            }

        });

    }

});
