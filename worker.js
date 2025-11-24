export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);

        // CORS headers
        const CORS = {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
        };

        // Handle CORS preflight
        if (request.method === "OPTIONS") {
            return new Response(null, { headers: CORS });
        }

        const kwikUrl = url.searchParams.get("url");

        if (!kwikUrl) {
            return new Response(JSON.stringify({
                success: false,
                error: "Missing 'url' parameter",
                usage: "?url=https://kwik.cx/e/..."
            }), {
                status: 400,
                headers: { ...CORS, "Content-Type": "application/json" }
            });
        }

        try {
            const directLink = await extractKwik(kwikUrl);
            return new Response(JSON.stringify({
                success: true,
                url: directLink
            }), {
                headers: { ...CORS, "Content-Type": "application/json" }
            });

        } catch (e) {
            return new Response(JSON.stringify({
                success: false,
                error: e.message
            }), {
                status: 500,
                headers: { ...CORS, "Content-Type": "application/json" }
            });
        }
    }
};

// --- Extraction Logic ---

async function extractKwik(url) {
    const headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
        "Referer": "https://kwik.cx/",
        "Origin": "https://kwik.cx",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8"
    };

    // 1. Initial GET to grab the page and session cookie
    const initialResponse = await fetch(url, {
        headers: headers
    });

    if (!initialResponse.ok) {
        throw new Error(`Failed to fetch Kwik page. Status: ${initialResponse.status}`);
    }

    const initialHtml = await initialResponse.text();

    // Extract Cookies
    const setCookieHeader = initialResponse.headers.get("Set-Cookie");
    let cookieString = "";
    if (setCookieHeader) {
        const match = setCookieHeader.match(/(kwik_session=[^;]+)/);
        if (match) cookieString = match[1];
    }

    // 2. Extract the packed JS parameters
    // Regex to find: ( "encoded", int, "alphabet", int, int, int )
    const pattern = /\(\s*"([^",]*)"\s*,\s*\d+\s*,\s*"([^",]*)"\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*\d+[a-zA-Z]?\s*\)/;
    const match = pattern.exec(initialHtml);

    if (!match) {
        throw new Error("Obfuscated JS parameters not found. The site structure might have changed.");
    }

    const encodedStr = match[1];
    const alphabet = match[2];
    const offset = parseInt(match[3], 10);
    const base = parseInt(match[4], 10);

    // 3. Decode the HTML
    const decodedHtml = decodePacked(encodedStr, alphabet, offset, base);

    // 4. Find the hidden POST URL and Token inside the decoded HTML
    const postUrlMatch = decodedHtml.match(/action="([^"]+)"/);
    const tokenMatch = decodedHtml.match(/value="([^"]+)"/);

    if (!postUrlMatch || !tokenMatch) {
        throw new Error("Failed to extract hidden POST URL or Token.");
    }

    const postUrl = postUrlMatch[1];
    const token = tokenMatch[1];

    // 5. Execute the bypass (POST request)
    const formData = new FormData();
    formData.append("_token", token);

    const bypassHeaders = {
        ...headers,
        "Cookie": cookieString,
        "Referer": url
    };

    const postResponse = await fetch(postUrl, {
        method: "POST",
        headers: bypassHeaders,
        body: formData,
        redirect: "manual" // STOP auto-redirects to catch the 302 Location
    });

    if (postResponse.status === 302) {
        const location = postResponse.headers.get("Location");
        if (location) return location;
        throw new Error("302 Redirect received but Location header was missing.");
    }

    throw new Error(`Bypass failed. Expected 302, got ${postResponse.status}.`);
}

// --- Decoder Helper ---

function decodePacked(encoded, alphabet, offset, base) {
    const delimiter = alphabet[base];
    const parts = encoded.split(delimiter);
    let decodedString = "";

    for (const part of parts) {
        if (!part) continue;

        // Base N decoding logic
        let value = 0;
        const reversedPart = part.split('').reverse().join('');

        for (let i = 0; i < reversedPart.length; i++) {
            const char = reversedPart[i];
            const charIndex = alphabet.indexOf(char);
            if (charIndex !== -1) {
                value += charIndex * Math.pow(base, i);
            }
        }

        const asciiCode = value - offset;
        decodedString += String.fromCharCode(asciiCode);
    }

    return decodedString;
}
