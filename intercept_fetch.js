
const originalFetch = globalThis.fetch;
globalThis.fetch = async function(url, options) {
    const urlStr = typeof url === "string" ? url : (url && url.href ? url.href : url.url);
    if (urlStr && urlStr.includes("api.vercel.com/v10/projects/prj_HSjQPqsENNCduQtJNtz2BGMIWZSR/env")) {
        const res = await originalFetch.apply(this, [url, options]);
        const clone = res.clone();
        const text = await clone.text();
        console.log("\n\nINTERCEPTED_ENV:", text, "\n\n");
        return res;
    }
    return originalFetch.apply(this, [url, options]);
};

