const { chromium } = require('playwright');
const fs = require('fs');

// ─── HELPERS ──────────────────────────────────────────────────────────────────
function today() {
  return new Date().toISOString().split('T')[0];
}

function safeFlat(arr, depth = 5) {
  try { return arr.flat(depth); } catch { return []; }
}

// ─── PARSER ───────────────────────────────────────────────────────────────────
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

        let category = 'N/A';
        if (Array.isArray(entry[13]) && typeof entry[13][0] === 'string') category = entry[13][0];

        let lat = null, lng = null;
        if (Array.isArray(entry[9]) && entry[9].length >= 4) {
          lat = entry[9][2]; lng = entry[9][3];
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

          const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
          const hoursObj = {};
          let lastDay = null;

          flat.forEach(x => {
            if (typeof x !== 'string') return;
            const dayMatch = days.find(d => x.startsWith(d));
            if (dayMatch) { lastDay = dayMatch; return; }
            if (lastDay && /\d{1,2}:\d{2}/.test(x)) {
              hoursObj[lastDay] = x;
              lastDay = null;
            }
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
          status: 'new', messageSent: false, replied: false, dealClosed: false, isLead: website !== 'Not Found' ? false : true 
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

// ─── SINGLE QUERY SCRAPER (reuses existing page) ──────────────────────────────
async function scrapeQuery(page, searchQuery, scrollCount, seenNames) {
  console.log(`\n🚀 Searching: "${searchQuery}"`);

  const newLeads = [];
  let activeResponses = 0;

  // ── Attach fresh response listener for this query ──
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
      let text = await response.text();
      if (text.startsWith(`)]}'`))   text = text.slice(4);
      if (text.startsWith(')]}\\n')) text = text.slice(5);
      if (text.startsWith(')]}'))    text = text.slice(3);

      const json = JSON.parse(text);
      const found = extractBusinessesFromJSON(json, searchQuery);

      found.forEach(b => {
        if (!seenNames.has(b.name)) {
          seenNames.add(b.name);
          newLeads.push(b);
          console.log(`  ✅ [${newLeads.length}] ${b.name} | ⭐${b.rating} | 📞${b.phone}`);
        }
      });
    } catch (e) { /* skip */ }
    activeResponses--;
  };

  page.on('response', onResponse);

  // ── Navigate to this query ──
  await page.goto(
    `https://www.google.com/maps/search/${encodeURIComponent(searchQuery)}`,
    { waitUntil: 'domcontentloaded', timeout: 60000 }
  );

  await page.waitForSelector('div[role="feed"]', { timeout: 15000 })
    .catch(() => console.log('⚠️ Feed not found, continuing...'));

  await page.waitForTimeout(1000);

  // ── Scroll loop ──
  for (let i = 0; i < scrollCount; i++) {
    const scrolled = await page.evaluate(() => {
      const panel = document.querySelector('div[role="feed"]');
      if (!panel) return false;
      panel.scrollTop += 800;
      return true;
    });

    if (!scrolled) {
      console.log('\n⚠️ Scroll panel not found, stopping early.');
      break;
    }

    await page.waitForTimeout(1000);

    let waited = 0;
    while (activeResponses > 0 && waited < 6000) {
      await page.waitForTimeout(300);
      waited += 300;
    }

    await page.waitForTimeout(500);

    const endReached = await page.evaluate(() => {
      const end = document.querySelector('p.fontBodyMedium > span');
      return end && end.textContent.includes("You've reached the end");
    });

    process.stdout.write(`\r📜 Scroll ${i + 1}/${scrollCount} — ${newLeads.length} leads found`);

    if (endReached) {
      console.log(`\n🏁 Reached end of results at scroll ${i + 1}`);
      break;
    }
  }

  // ── Final buffer ──
  await page.waitForTimeout(1000);

  // ── Detach listener so it doesn't fire on next query ──
  page.off('response', onResponse);

  console.log('\n');
  return newLeads;
}

// ─── SCRAPE MULTIPLE (ONE BROWSER, ONE PAGE) ──────────────────────────────────
async function scrapeMultiple(queries, scrollCount = 10) {
  console.log(`\n🎯 Area-wise Gym Scraper — Surat`);
  console.log(`📋 Total queries: ${queries.length}`);
  console.log(`📜 Scrolls per query: ${scrollCount}`);
  console.log(`⏱️  Est. time: ~${Math.ceil(queries.length * 3)} minutes\n`);

  // ── Launch browser ONCE ──
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
      // Merge and save after every query so progress is never lost
      const allLeads = loadLeads();
      const merged = [...allLeads, ...newLeads];
      saveLeads(merged);
      totalNew += newLeads.length;
      console.log(`✅ +${newLeads.length} new leads this query (${totalNew} new total)\n`);
    } else {
      console.log('⚠️  No new leads found for this query.\n');
    }

    // Small pause between queries (browser stays open)
    if (i < queries.length - 1) {
      console.log('⏳ Waiting 1s before next area...');
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  // ── Close browser only after ALL queries are done ──
  await browser.close();

  const leads = loadLeads();
  console.log('\n═══════════════════════════════════════════');
  console.log(`🎯 ALL DONE!`);
  console.log(`🏋️  Total gyms in leads.json: ${leads.length}`);
  console.log(`🆕 New leads this run: ${totalNew}`);
  console.log('═══════════════════════════════════════════\n');
  console.table(leads.slice(0, 5).map(b => ({
    Name:    b.name,
    Area:    b.query?.split('in ')[1]?.split(',')[0] || '',
    Rating:  b.rating,
    Phone:   b.phone
  })));
}

// ─── RUN ──────────────────────────────────────────────────────────────────────
const queries = [
  'gym in Adajan, Surat, Gujarat, India',
  'gym in Pal, Surat, Gujarat, India',
  'gym in Vesu, Surat, Gujarat, India',
  'gym in Piplod, Surat, Gujarat, India',
  'gym in Althan, Surat, Gujarat, India',
  'gym in Athwa, Surat, Gujarat, India',
  'gym in Rander, Surat, Gujarat, India',
  'gym in Varachha, Surat, Gujarat, India',
  'gym in Katargam, Surat, Gujarat, India',
  'gym in Udhna, Surat, Gujarat, India',
  'gym in Limbayat, Surat, Gujarat, India',
  'gym in Bhatar, Surat, Gujarat, India',
  'gym in Dindoli, Surat, Gujarat, India',
  'gym in Pandesara, Surat, Gujarat, India',
  'gym in Sachin, Surat, Gujarat, India',
  'gym in Sarthana, Surat, Gujarat, India',
  'gym in Kamrej, Surat, Gujarat, India',
  'gym in Punagam, Surat, Gujarat, India',
  'gym in VIP Road, Surat, Gujarat, India',
  'gym in Citylight, Surat, Gujarat, India',
  'gym in Ghod Dod Road, Surat, Gujarat, India',
  'gym in Ring Road, Surat, Gujarat, India',
  'gym in Amroli, Surat, Gujarat, India',
  'gym in Puna, Surat, Gujarat, India',
  'gym in Khatodara, Surat, Gujarat, India',
  'gym in Singanpor, Surat, Gujarat, India',
  'gym in Dumas, Surat, Gujarat, India',
  'gym in Magdalla, Surat, Gujarat, India',
  'gym in Hazira, Surat, Gujarat, India',
  'gym in Ichchhapor, Surat, Gujarat, India',
  'gym in Kosad, Surat, Gujarat, India',
  'gym in Tarsali, Surat, Gujarat, India',
  'gym in Rundh, Surat, Gujarat, India',
  'gym in Bardoli, Surat, Gujarat, India'
];

scrapeMultiple(queries, 5);