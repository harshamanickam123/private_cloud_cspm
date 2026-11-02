const API_BASE = "http://100.121.211.97:5000";

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
