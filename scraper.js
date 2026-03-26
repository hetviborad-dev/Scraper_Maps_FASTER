const { chromium } = require('playwright');
const fs = require('fs');

// ─── STRICT CATEGORY FILTER ───────────────────────────────────────────────────

// ✅ ALLOW only entries whose category OR name matches these keywords
const ALLOWED_CATEGORY_KEYWORDS = [
  'gym', 'fitness center', 'fitness club', 'fitness studio',
  'health club', 'weight training', 'crossfit', 'boxing gym', 'strength training',
  'personal training', 'powerlifting', 'bodybuilding', 'hiit', 'orangetheory',
  'anytime fitness', 'planet fitness', 'la fitness', 'equinox',
  'lifetime fitness', 'crunch fitness', 'f45', 'barry\'s',
];

// ❌ BLOCK entries whose category OR name contains these keywords
const BLOCKED_KEYWORDS = [
  'park', 'school', 'academy', 'university', 'college',
  'pilates', 'yoga', 'dance', 'ballet', 'gymnastics',
  'swimming', 'swim', 'pool', 'aquatic',
  'spa', 'salon', 'massage', 'therapy', 'chiropractic',
  'physical therapy', 'rehabilitation', 'rehab',
  'daycare', 'childcare', 'preschool', 'kindergarten',
  'church', 'temple', 'mosque', 'community center',
  'playground', 'stadium', 'arena', 'golf',
  'tennis', 'basketball court', 'baseball',
  'karate school', 'taekwondo school', 'judo school',
  'nutrition', 'supplement', 'pharmacy',
  'hospital', 'clinic', 'medical',
];

function isValidGym(name, category) {
  const nameLower  = (name     || '').toLowerCase();
  const catLower   = (category || '').toLowerCase();
  const combined   = `${nameLower} ${catLower}`;

  // 1️⃣ Hard block — if name/category contains a blocked keyword → reject
  for (const blocked of BLOCKED_KEYWORDS) {
    if (combined.includes(blocked)) {
      // Exception: "boxing gym", "mma gym" etc. are fine even if "school" appears
      const isGymException = ALLOWED_CATEGORY_KEYWORDS.some(k => combined.includes(k));
      if (!isGymException) {
        return false;
      }
    }
  }

  // 2️⃣ Must match at least one allowed keyword
  const isAllowed = ALLOWED_CATEGORY_KEYWORDS.some(k => combined.includes(k));
  return isAllowed;
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────
function today() {
  return new Date().toISOString().split('T')[0];
}
function safeFlat(arr, depth = 5) {
  try { return arr.flat(depth); } catch { return []; }
}
// ─── CLOSURE STATUS DETECTOR ──────────────────────────────────────────────────
function getClosureStatus(entry) {
  // Indices most likely to carry business_status / closure labels in Maps JSON
  const checkIndices = [88, 34, 4, 203, 97, 100, 111, 32, 99];

  for (const idx of checkIndices) {
    if (entry[idx] == null) continue;

    // Handle both array and plain string at the index
    const items = Array.isArray(entry[idx])
      ? safeFlat(entry[idx])
      : [entry[idx]];

    for (const item of items) {
      if (typeof item !== 'string') continue;
      const lower = item.toLowerCase();
      if (lower.includes('permanently closed'))  return 'permanently_closed';
      if (lower.includes('temporarily closed'))  return 'temporarily_closed';
    }
  }

  // Fallback: scan the entire entry shallowly for closure strings
  for (let i = 0; i < entry.length; i++) {
    if (typeof entry[i] === 'string') {
      const lower = entry[i].toLowerCase();
      if (lower.includes('permanently closed'))  return 'permanently_closed';
      if (lower.includes('temporarily closed'))  return 'temporarily_closed';
    }
  }

  return null; // Business is operational (or status unknown → keep it)
}


// ─── RESPONSE PARSER ──────────────────────────────────────────────────────────
function parseMapResponse(rawText) {
  let text = rawText.trim();

  if (text.startsWith('{')) {
    text = text.replace(/\/\*""\*\/$/, '').trim();
    try {
      const outer = JSON.parse(text);
      if (outer && typeof outer.d === 'string') {
        let inner = outer.d.trim();
        if (inner.startsWith(`)]}'`))   inner = inner.slice(4);
        if (inner.startsWith(')]}\\n')) inner = inner.slice(5);
        if (inner.startsWith(')]}'))    inner = inner.slice(3);
        return JSON.parse(inner);
      }
    } catch { /* fall through */ }
  }

  if (text.startsWith(`)]}'`))   text = text.slice(4);
  if (text.startsWith(')]}\\n')) text = text.slice(5);
  if (text.startsWith(')]}'))    text = text.slice(3);
  return JSON.parse(text);
}

// ─── BUSINESS EXTRACTOR ───────────────────────────────────────────────────────
function extractBusinessesFromJSON(json, query) {
  const results = [];

  function deepSearch(arr, depth = 0) {
    if (!Array.isArray(arr) || depth > 12) return;

    arr.forEach(entry => {
      if (!Array.isArray(entry)) return;

      try {
        const name = typeof entry[11] === 'string' && entry[11].length > 2 ? entry[11] : null;
        if (!name) { deepSearch(entry, depth + 1); return; }
        if (name.startsWith('gcid:') || name.length < 3) { deepSearch(entry, depth + 1); return; }

        let category = 'N/A';
        if (Array.isArray(entry[13]) && typeof entry[13][0] === 'string') category = entry[13][0];

        // ─── STRICT FILTER: skip anything that isn't a real gym ───────────────
        if (!isValidGym(name, category)) {
          console.log(`  ⛔ Skipped (not a gym): "${name}" [${category}]`);
          return;
        }

        // ─── STRICT FILTER: skip anything that isn't a real gym ───────────────
        if (!isValidGym(name, category)) {
          console.log(`  ⛔ Skipped (not a gym): "${name}" [${category}]`);
          return;
        }

        // ─── NEW: skip permanently / temporarily closed businesses ────────────
        const closureStatus = getClosureStatus(entry);
        if (closureStatus) {
          console.log(`  🚫 Skipped (${closureStatus.replace(/_/g, ' ')}): "${name}"`);
          return;
        }


        let placeId = 'N/A';
        if (typeof entry[78] === 'string') placeId = entry[78];
        else if (typeof entry[10] === 'string' && entry[10].includes('0x')) placeId = entry[10];

        let rating = null;
        if (Array.isArray(entry[4]) && entry[4][7] != null) rating = String(entry[4][7]);

        let reviewCount = null;
        if (Array.isArray(entry[4]) && entry[4][8] != null) reviewCount = String(entry[4][8]);

        let address = 'N/A';
        if (typeof entry[18] === 'string' && entry[18].length > 5) {
          address = entry[18];
          if (address.startsWith(name + ', ')) address = address.slice(name.length + 2);
        } else if (Array.isArray(entry[2])) {
          address = entry[2].filter(x => typeof x === 'string').join(', ');
        }

        let phone = 'Not Found';
        for (const idx of [178, 183, 182, 16, 35]) {
          if (phone !== 'Not Found') break;
          if (Array.isArray(entry[idx])) {
            const flat = safeFlat(entry[idx]);
            const found = flat.find(x =>
              typeof x === 'string' &&
              /^(\+91[\s-]?)?[0-9\s\-()]{7,15}$/.test(x.trim()) &&
              x.replace(/\D/g, '').length >= 7
            );
            if (found) phone = found.trim();
          }
        }

        let website = 'Not Found';
        if (Array.isArray(entry[7])) {
          const flat = safeFlat(entry[7]);
          const found = flat.find(x => typeof x === 'string' && x.startsWith('http'));
          if (found) website = found;
        }

        let social = null;
        const socialPatterns = ['instagram.com', 'facebook.com', 'twitter.com', 'linkedin.com'];
        if (website !== 'Not Found' && socialPatterns.some(p => website.includes(p))) {
          social = website;
          website = 'Not Found';
        }
        for (const idx of [7, 111, 112]) {
          if (social) break;
          if (Array.isArray(entry[idx])) {
            const flat = safeFlat(entry[idx]);
            const found = flat.find(x =>
              typeof x === 'string' && socialPatterns.some(p => x.includes(p))
            );
            if (found) social = found;
          }
        }

        let openingHours = null;
        let isOpenNow = null;
        for (const idx of [34, 77, 88, 203]) {
          if (openingHours) break;
          if (!Array.isArray(entry[idx])) continue;
          const flat = safeFlat(entry[idx]);
          if (isOpenNow === null) {
            const openStr = flat.find(x => typeof x === 'string' &&
              (x.toLowerCase().includes('open') || x.toLowerCase().includes('closed')));
            if (openStr) isOpenNow = openStr.toLowerCase().includes('open');
          }
          const days = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
          const hoursObj = {};
          let lastDay = null;
          flat.forEach(x => {
            if (typeof x !== 'string') return;
            const dayMatch = days.find(d => x.startsWith(d));
            if (dayMatch) { lastDay = dayMatch; return; }
            if (lastDay && /\d{1,2}:\d{2}/.test(x)) { hoursObj[lastDay] = x; lastDay = null; }
          });
          if (Object.keys(hoursObj).length > 0) openingHours = hoursObj;
        }

        let priceRange = null;
        for (const idx of [4, 94]) {
          if (priceRange) break;
          if (Array.isArray(entry[idx])) {
            const flat = safeFlat(entry[idx]);
            const found = flat.find(x => typeof x === 'string' && /^[₹$€£]{1,4}$/.test(x.trim()));
            if (found) priceRange = found.trim();
          }
        }

        let plusCode = null;
        for (const idx of [183, 58]) {
          if (plusCode) break;
          if (Array.isArray(entry[idx])) {
            const flat = safeFlat(entry[idx]);
            const found = flat.find(x => typeof x === 'string' && /^[A-Z0-9]{4}\+[A-Z0-9]{2}/.test(x));
            if (found) plusCode = found;
          }
        }

        let photoCount = null;
        if (Array.isArray(entry[171])) photoCount = String(entry[171].flat(3).filter(Array.isArray).length);

        let description = null;
        for (const idx of [32, 99, 111]) {
          if (description) break;
          if (typeof entry[idx] === 'string' && entry[idx].length > 20) description = entry[idx];
        }

        let mapsUrl = `https://www.google.com/maps/search/${encodeURIComponent(name)}`;
        if (placeId && placeId !== 'N/A') {
          mapsUrl = `https://www.google.com/maps/place/?q=place_id:${placeId}`;
        }

        results.push({
          placeId, name, category, phone, address, website, social, mapsUrl,
          rating, reviewCount, isOpenNow, openingHours, priceRange, plusCode,
          photoCount, description,
          hasMultipleBranches: false, branchCount: null, branchDetectSource: null,
          query, scrapedDate: today(),
          status: 'new', messageSent: false, replied: false, dealClosed: false,
          isLead: website !== 'Not Found' ? false : true,
          closureStatus: null,
        });

      } catch (e) {
        deepSearch(entry, depth + 1);
      }
    });
  }

  deepSearch(json);
  return results;
}

// ─── LOAD / SAVE LEADS ────────────────────────────────────────────────────────
function loadLeads() {
  if (fs.existsSync('leads.json')) {
    try { return JSON.parse(fs.readFileSync('leads.json', 'utf8')); }
    catch { return []; }
  }
  return [];
}
function saveLeads(leads) {
  fs.writeFileSync('leads.json', JSON.stringify(leads, null, 2), 'utf8');
  console.log(`💾 leads.json updated — ${leads.length} total leads`);
}

// ─── SCROLL HELPER ────────────────────────────────────────────────────────────
async function scrollAndWaitForMoreItems(page, itemCountBefore, timeout = 9000) {
  await page.evaluate(() => {
    const panel = document.querySelector('div[role="feed"]');
    if (!panel) return;
    const children = panel.querySelectorAll(':scope > div');
    if (children.length) {
      children[children.length - 1].scrollIntoView({ behavior: 'instant', block: 'end' });
    }
  });

  const start = Date.now();
  while (Date.now() - start < timeout) {
    await page.waitForTimeout(500);
    const currentCount = await page.evaluate(() => {
      const panel = document.querySelector('div[role="feed"]');
      return panel ? panel.querySelectorAll(':scope > div').length : 0;
    });
    if (currentCount > itemCountBefore) return currentCount;
    const ended = await page.evaluate(() => {
      const end = document.querySelector('p.fontBodyMedium > span');
      return end && end.textContent.includes("You've reached the end");
    });
    if (ended) return null;
  }
  return null;
}

// ─── SINGLE QUERY SCRAPER ─────────────────────────────────────────────────────
async function scrapeQuery(page, searchQuery, scrollCount, seenNames) {
  console.log(`\n🚀 Searching: "${searchQuery}"`);

  const newLeads       = [];
  let   activeResponses = 0;
  const closedNamesDOM = new Set(); // ← tracks DOM-detected closed businesses

  // ─── DOM SCANNER: reads the visible feed for closed labels ────────────────
  async function scanDOMForClosedBusinesses() {
    const names = await page.evaluate(() => {
      const closed = [];
      document.querySelectorAll('div[role="feed"] > div').forEach(item => {
        const txt = item.textContent || '';
        const isClosed =
          txt.includes('Temporarily closed') ||
          txt.includes('Permanently closed');
        if (!isClosed) return;

        // Try every reasonable selector to extract the business name
        const candidates = [
          item.querySelector('a[aria-label]')?.getAttribute('aria-label'),
          item.querySelector('[aria-label]')?.getAttribute('aria-label'),
          item.querySelector('h3')?.textContent,
          item.querySelector('[role="heading"]')?.textContent,
        ];
        for (const c of candidates) {
          if (!c) continue;
          const name = c.split('\n')[0].trim();
          if (name.length > 2) { closed.push(name); break; }
        }
      });
      return closed;
    }).catch(() => []);

    names.forEach(n => {
      if (!closedNamesDOM.has(n)) {
        console.log(`  🚫 DOM-closed detected: "${n}"`);
        closedNamesDOM.add(n);
      }
    });
  }
  // ──────────────────────────────────────────────────────────────────────────

  const onResponse = async (response) => {
    const url = response.url();
    const isTarget =
      url.includes('search?tbm=map') ||
      url.includes('/maps/search/') ||
      url.includes('maps/api/js/PlacesService') ||
      url.includes('preview/place') ||
      (url.includes('maps') && url.includes('pb='));

    if (!isTarget) return;

    activeResponses++;
    try {
      const rawText = await response.text();
      const json    = parseMapResponse(rawText);
      const found   = extractBusinessesFromJSON(json, searchQuery);

      found.forEach(b => {
        // ← check DOM-closed set first
        if (closedNamesDOM.has(b.name)) {
          console.log(`  🚫 Skipped (DOM-closed): "${b.name}"`);
          return;
        }
        if (!seenNames.has(b.name)) {
          seenNames.add(b.name);
          newLeads.push(b);
          console.log(`  ✅ [${newLeads.length}] ${b.name} | [${b.category}] | ⭐${b.rating} | 📞${b.phone}`);
        }
      });
    } catch (e) { /* skip unparseable */ }
    activeResponses--;
  };

  page.on('response', onResponse);

  await page.goto(
    `https://www.google.com/maps/search/${encodeURIComponent(searchQuery)}`,
    { waitUntil: 'domcontentloaded', timeout: 60000 }
  );

  await page.waitForSelector('div[role="feed"]', { timeout: 15000 })
    .catch(() => console.log('⚠️ Feed not found, continuing...'));

  await page.waitForTimeout(2000);
  await scanDOMForClosedBusinesses(); // ← initial scan before scrolling

  for (let i = 0; i < scrollCount; i++) {
    const itemsBefore = await page.evaluate(() => {
      const p = document.querySelector('div[role="feed"]');
      return p ? p.querySelectorAll(':scope > div').length : 0;
    });

    if (!itemsBefore) {
      console.log('⚠️ Feed panel gone, stopping.');
      break;
    }

    const newCount = await scrollAndWaitForMoreItems(page, itemsBefore);

    let waited = 0;
    while (activeResponses > 0 && waited < 5000) {
      await page.waitForTimeout(300);
      waited += 300;
    }

    await scanDOMForClosedBusinesses(); // ← scan after EVERY scroll

    process.stdout.write(`\r📜 Scroll ${i + 1}/${scrollCount} — ${newLeads.length} leads found    \n`);

    if (newCount === null) {
      console.log(`  ⚠️ No new items after scroll ${i + 1} — stopping early`);
      break;
    }
  }

  await page.waitForTimeout(500);
  page.off('response', onResponse);

  // ─── FINAL SAFETY PASS: purge any closed leads that slipped in before DOM scan
  const finalLeads = newLeads.filter(b => {
    if (closedNamesDOM.has(b.name)) {
      console.log(`  🧹 Post-filter removed (closed): "${b.name}"`);
      return false;
    }
    return true;
  });

  console.log('');
  return finalLeads;
}


// ─── SCRAPE MULTIPLE ──────────────────────────────────────────────────────────
async function scrapeMultiple(queries, scrollCount = 5) {
  console.log(`\n🎯 Area-wise Gym Scraper — Surat`);
  console.log(`📋 Total queries: ${queries.length}`);
  console.log(`📜 Max scrolls per query: ${scrollCount}`);
  console.log(`🔒 Strict category filter: ON\n`);

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
    locale: 'en-IN',
    timezoneId: 'Asia/Kolkata'
  });
  const page = await context.newPage();

  const existingLeads = loadLeads();
  const seenNames = new Set(existingLeads.map(l => l.name));
  let totalNew = 0;

  for (let i = 0; i < queries.length; i++) {
    console.log(`\n[${i + 1}/${queries.length}]`);
    const newLeads = await scrapeQuery(page, queries[i], scrollCount, seenNames);

    if (newLeads.length > 0) {
      const allLeads = loadLeads();
      saveLeads([...allLeads, ...newLeads]);
      totalNew += newLeads.length;
      console.log(`✅ +${newLeads.length} new leads (${totalNew} total)\n`);
    } else {
      console.log('⚠️  No new leads found.\n');
    }

    if (i < queries.length - 1) {
      console.log('⏳ Waiting 5s...');
      await new Promise(r => setTimeout(r, 5000));
    }
  }

  await browser.close();

  const leads = loadLeads();
  console.log('\n═══════════════════════════════════════════');
  console.log(`🎯 ALL DONE! Total: ${leads.length} gyms | New this run: ${totalNew}`);
  console.log('═══════════════════════════════════════════\n');
  console.table(leads.slice(0, 5).map(b => ({
    Name: b.name, Category: b.category,
    Area: b.query?.split('in ')[1]?.split(',')[0] || '',
    Rating: b.rating, Phone: b.phone
  })));
}

// ─── RUN ──────────────────────────────────────────────────────────────────────
const queries = [
  'gym in Highland Park, Dallas, Texas, US',
  'gym in University Park, Dallas, Texas, US',
  'gym in Preston Hollow, Dallas, Texas, US',
  'gym in Turtle Creek, Dallas, Texas, US',
  'gym in Southlake, Dallas, Texas, US',
  'gym in Westlake, Fort Worth, Texas, US',
  'gym in Starwood, Frisco, Texas, US',
  'gym in Frisco, Dallas, Texas, US',
  'gym in Plano, Dallas, Texas, US',
  'gym in Coppell, Dallas, Texas, US',
  'gym in River Oaks, Houston, Texas, US',
  'gym in Bellaire, Houston, Texas, US',
  'gym in West University Place, Houston, Texas, US',
  'gym in Memorial Park, Houston, Texas, US',
  'gym in The Woodlands, Houston, Texas, US',
  'gym in Sugar Land, Houston, Texas, US',
  'gym in Cinco Ranch, Houston, Texas, US',
  'gym in Westlake Hills, Austin, Texas, US',
  'gym in Barton Creek, Austin, Texas, US',
  'gym in Horseshoe Bay, Texas, US',
  'gym in Boerne, San Antonio, Texas, US',
  'gym in Cordillera Ranch, Boerne, Texas, US'
];

scrapeMultiple(queries, 20);