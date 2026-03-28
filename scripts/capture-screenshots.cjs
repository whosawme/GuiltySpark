#!/usr/bin/env node
// Captures dashboard screenshots for the README

const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

const BASE_URL = 'http://localhost:8788';
const DOCS_DIR = path.join(__dirname, '..', 'docs');

const pages = [
  { path: '/monitor', file: 'dashboard-monitor.png', name: 'Live Monitor' },
  { path: '/config', file: 'dashboard-config.png', name: 'Configuration' },
];

(async () => {
  fs.mkdirSync(DOCS_DIR, { recursive: true });

  const browser = await puppeteer.launch({
    headless: true,
    protocolTimeout: 120000,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  for (const { path: urlPath, file, name } of pages) {
    const url = `${BASE_URL}${urlPath}`;
    console.log(`Capturing ${name} from ${url}...`);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await new Promise(r => setTimeout(r, 1000)); // let any animations settle
    const outPath = path.join(DOCS_DIR, file);
    await page.screenshot({ path: outPath, fullPage: false });
    console.log(`  Saved → ${outPath}`);
  }

  await browser.close();
  console.log('Done.');
})();
