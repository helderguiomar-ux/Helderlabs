const fs = require('fs');
const content = fs.readFileSync('C:/Users/helde/.gemini/antigravity/brain/382a971a-6aae-4908-8645-449a80343d7a/.system_generated/steps/160/content.md', 'utf8');

const htmlStart = content.indexOf('<!DOCTYPE html>');
let html = content.slice(htmlStart);

// Remove the line numbers that were injected by view_file tool if any. Wait, the read_url_content output was just pure markdown.
// Oh wait, I viewed the file, which added line numbers! But read_url_content saves the raw content. Let's make sure it doesn't have line numbers. 
// Ah, the read_url_content output does NOT have line numbers, only `view_file` displays them. So `content.md` has the clean HTML after the frontmatter!

const banner = `
<div style="background: #f59e0b; color: #000; text-align: center; padding: 0.5rem; font-weight: bold; font-family: monospace; z-index: 10000; position: relative;">
  HELDERLABS ERP | LOCAL DEVELOPMENT | Version: 0.1.0
</div>
`;

html = html.replace('<body>', '<body>\n' + banner);

// Ensure the local links work if needed, but for now we just dump it
fs.writeFileSync('backend/public/index.html', html);
console.log('index.html created successfully.');
