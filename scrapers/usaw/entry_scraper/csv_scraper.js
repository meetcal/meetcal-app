// Load environment variables from .env file
require('dotenv').config();

const { chromium } = require('playwright');
const fs = require('fs');
const https = require('https');

// Read Convex configuration from environment
const convexUrl = process.env.CONVEX_URL;
const scraperSecret = process.env.SCRAPER_SECRET;

if (!convexUrl || !scraperSecret) {
    console.warn('CONVEX_URL or SCRAPER_SECRET not provided. Database updates will be skipped.');
}

// Read the target URL from file
let targetUrl;
try {
    targetUrl = fs.readFileSync('target_url.txt', 'utf8').trim();
    console.log(`Target URL loaded from file: ${targetUrl}`);
} catch (error) {
    console.error('Error reading target URL file:', error);
    process.exit(1);
}

async function scrapeWeightliftingData() {
    console.log('Launching browser...');
    const browser = await chromium.launch({
        headless: true
    });

    const context = await browser.newContext({
        viewport: { width: 1920, height: 1080 },
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
    });

    const page = await context.newPage();
    
    try {
        console.log(`Navigating to page: ${targetUrl}`);
        await page.goto(targetUrl, {
            waitUntil: 'networkidle',
            timeout: 60000
        });

        console.log('Waiting for table to load...');
        // Wait for actual data to load (not the loading placeholder)
        await page.waitForFunction(() => {
            const firstCell = document.querySelector('table tbody tr td');
            return firstCell && !firstCell.textContent.includes('Loading');
        }, { timeout: 30000 });

        // Extract meet name from the page
        let meetName;
        try {
            meetName = await page.evaluate(() => {
                const titleElement = document.querySelector('h1');
                const eventInfoElement = document.querySelector('.event-info h2');
                
                if (titleElement) {
                    return titleElement.textContent.trim();
                } else if (eventInfoElement) {
                    return eventInfoElement.textContent.trim();
                } else {
                    // Try to find any heading that might contain the meet name
                    const headings = Array.from(document.querySelectorAll('h1, h2, h3'));
                    for (const heading of headings) {
                        if (heading.textContent.includes('Championship') || 
                            heading.textContent.includes('Meet') || 
                            heading.textContent.includes('Competition')) {
                            return heading.textContent.trim();
                        }
                    }
                    
                    // If we still can't find it, try to extract from the page title
                    const pageTitle = document.title;
                    if (pageTitle) {
                        return pageTitle.split('|')[0].trim();
                    }
                    
                    return null;
                }
            });
            
            // Remove " - Members" suffix if present
            if (meetName && meetName.endsWith(' - Members')) {
                meetName = meetName.replace(' - Members', '');
            }
            
            if (!meetName) {
                // If we couldn't extract the meet name, use the URL to generate one
                const url = page.url();
                const eventIdMatch = url.match(/events\/(\d+)/);
                if (eventIdMatch && eventIdMatch[1]) {
                    meetName = `Event ID ${eventIdMatch[1]}`;
                    console.warn(`Could not extract meet name from page, using fallback: ${meetName}`);
                } else {
                    meetName = `Weightlifting Event ${new Date().toISOString().split('T')[0]}`;
                    console.warn(`Could not extract meet name or event ID, using date-based fallback: ${meetName}`);
                }
            }
        } catch (error) {
            // If there's an error in the extraction, use a fallback with the current date
            meetName = `Weightlifting Event ${new Date().toISOString().split('T')[0]}`;
            console.error(`Error extracting meet name: ${error.message}. Using fallback: ${meetName}`);
        }
        
        console.log(`Meet name: ${meetName}`);

        let hasNextPage = true;
        let allEntries = [];
        let pageNum = 1;

        while (hasNextPage) {
            // Wait for table data to be fully loaded
            await page.waitForFunction(() => {
                const rows = document.querySelectorAll('table tbody tr');
                const firstCell = rows[0]?.querySelector('td');
                return firstCell && !firstCell.textContent.includes('Loading');
            }, { timeout: 10000 });
            
            console.log(`Scraping page ${pageNum}...`);
            
            // Extract data from current page
            const pageEntries = await page.evaluate((meetName) => {
                const rows = Array.from(document.querySelectorAll('table tbody tr'));
                return rows.map(row => {
                    const cells = Array.from(row.querySelectorAll('td'));
                    if (cells[0]?.textContent.includes('Loading')) {
                        return null;
                    }
                    const memberId = cells[0]?.textContent.trim();
                    const firstName = cells[1]?.textContent.trim();
                    const lastName = cells[2]?.textContent.trim().split(' ')[0];
                    const age = cells[5]?.textContent.trim();
                    const club = cells[6]?.textContent.trim();
                    const gender = cells[7]?.textContent.trim();
                    const weightClass = cells[9]?.textContent.trim();
                    const entryTotal = cells[10]?.textContent.trim();
                    
                    return {
                        member_id: memberId,
                        name: `${firstName} ${lastName}`,
                        age: parseInt(age),
                        club: club,
                        gender: gender,
                        weight_class: weightClass,
                        entry_total: parseInt(entryTotal),
                        session_number: null,
                        session_platform: null,
                        meet: meetName
                    };
                }).filter(entry => entry !== null);
            }, meetName);

            if (pageEntries.length === 0) {
                console.log('No valid entries found on current page, ending pagination');
                break;
            }

            allEntries = [...allEntries, ...pageEntries];
            console.log(`Found ${pageEntries.length} entries on page ${pageNum}`);

            // Check for next page
            const nextButton = await page.$('button[aria-label="Next page"]:not([disabled])');
            if (nextButton) {
                await nextButton.click();
                try {
                    await Promise.race([
                        page.waitForResponse(response => 
                            response.url().includes('entries') && response.status() === 200
                        ),
                        page.waitForTimeout(5000)
                    ]);
                } catch (error) {
                    console.log('Response wait timed out, continuing...');
                }
                await page.waitForTimeout(2000);
                pageNum++;
            } else {
                hasNextPage = false;
            }
        }

        // Sort the entries
        const sortedEntries = allEntries.sort((a, b) => {
            // Sort by gender first (Female before Male)
            if (a.gender !== b.gender) {
                return a.gender === 'Female' ? -1 : 1;
            }

            // Extract weight value and check for '+' prefix
            const getWeight = (str) => {
                const match = str.match(/(\+)?(\d+)/);
                if (!match) return { value: Infinity, hasPlus: false };
                return {
                    value: parseInt(match[2]),
                    hasPlus: match[1] === '+'
                };
            };
            
            const weightA = getWeight(a.weight_class);
            const weightB = getWeight(b.weight_class);
            
            if (weightA.value !== weightB.value) return weightA.value - weightB.value;
            if (weightA.hasPlus !== weightB.hasPlus) return weightA.hasPlus ? 1 : -1;
            
            return b.entry_total - a.entry_total;
        });

        // CSV output removed
        
        console.log(`Successfully scraped ${allEntries.length} total entries (${Math.ceil(allEntries.length / 20)} pages)`);
        
        // Update Convex and get the count of upserted rows
        const upsertStats = await updateConvex(sortedEntries);
        
        return { entries: allEntries, upsertStats };

    } catch (error) {
        console.error('Error during scraping:', error);
        throw error;
    } finally {
        await context.close();
        await browser.close();
    }
}

async function updateConvex(entries) {
    if (!convexUrl || !scraperSecret) {
        console.error('CONVEX_URL or SCRAPER_SECRET not configured. Skipping database update.');
        return;
    }

    if (entries.length === 0) {
        console.log('No entries to update in Convex');
        return;
    }

    const meetName = entries[0].meet;
    console.log(`Updating Convex with entries for meet: ${meetName}`);

    let processedCount = 0;
    let successCount = 0;
    let errorCount = 0;

    for (const entry of entries) {
        const memberId = (entry.member_id && entry.member_id.trim())
            ? entry.member_id.trim()
            : String(Math.floor(Math.random() * 900000000) + 100000000);

        try {
            const response = await fetch(`${convexUrl}/api/action`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    path: 'scraperIngestion:ingestAthlete',
                    args: {
                        scraperSecret: scraperSecret,
                        memberId: memberId,
                        name: entry.name,
                        age: entry.age,
                        club: entry.club,
                        gender: entry.gender,
                        weightClass: entry.weight_class,
                        entryTotal: entry.entry_total,
                        sessionNumber: entry.session_number ?? undefined,
                        sessionPlatform: entry.session_platform ?? undefined,
                        meet: entry.meet,
                        adaptive: false,
                    }
                })
            });

            if (!response.ok) {
                const errorText = await response.text();
                console.error(`Error ingesting athlete ${entry.name}: HTTP ${response.status} - ${errorText}`);
                errorCount++;
            } else {
                console.log(`Ingested athlete: ${entry.name} in meet: ${meetName}`);
                successCount++;
            }
        } catch (error) {
            console.error(`Error ingesting athlete ${entry.name}:`, error.message);
            errorCount++;
        }

        processedCount++;
    }

    console.log(`Successfully processed ${processedCount} entries for meet: ${meetName}`);
    console.log(`  - Succeeded: ${successCount}`);
    console.log(`  - Errors: ${errorCount}`);

    return {
        inserted: successCount,
        updated: 0,
        skipped: errorCount,
        total: processedCount
    };
}

async function sendSlackNotification(upsertStats, meetName) {
    const slackWebhookUrl = process.env.SLACK_WEBHOOK_URL;
    
    if (!slackWebhookUrl) {
        console.log('Slack webhook URL not configured. Skipping notification.');
        return;
    }
    
    // Get current timestamp in a readable format
    const currentTime = new Date().toLocaleString('en-US', {
        timeZone: 'America/New_York',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
    });
    
    // Calculate total upserted (inserted + updated)
    const upsertedCount = upsertStats.inserted + upsertStats.updated;
    
    // Create the message
    let message = `*Entry Scraper Update - ${meetName}*\n\n`;
    message += `${upsertedCount} Athlete${upsertedCount !== 1 ? 's' : ''} Upserted to Convex\n`;
    message += `• ${upsertStats.inserted} succeeded\n`;
    message += `• ${upsertStats.skipped} errors\n\n`;
    
    const payload = JSON.stringify({
        text: message
    });
    
    return new Promise((resolve, reject) => {
        const url = new URL(slackWebhookUrl);
        
        const options = {
            hostname: url.hostname,
            port: url.port || 443,
            path: url.pathname + url.search,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload)
            },
            timeout: 30000
        };
        
        const req = https.request(options, (res) => {
            let data = '';
            
            res.on('data', (chunk) => {
                data += chunk;
            });
            
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    console.log(`Slack notification sent successfully: ${message}`);
                    resolve(data);
                } else {
                    console.error(`Failed to send Slack notification: ${res.statusCode} ${res.statusMessage}`);
                    if (data) {
                        console.error(`Slack webhook response: ${data}`);
                    }
                    reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
                }
            });
        });
        
        req.on('error', (error) => {
            console.error(`Failed to send Slack notification:`, error.message);
            reject(error);
        });
        
        req.on('timeout', () => {
            req.destroy();
            const timeoutError = new Error('Slack webhook request timed out');
            console.error('Failed to send Slack notification:', timeoutError.message);
            reject(timeoutError);
        });
        
        req.write(payload);
        req.end();
    });
}

if (require.main === module) {
    console.log('Starting scraper...');
    scrapeWeightliftingData()
        .then(async (result) => {
            console.log('Scraping and database update completed successfully');
            
            // Send Slack notification
            if (result && result.entries && result.entries.length > 0) {
                const meetName = result.entries[0].meet;
                try {
                    await sendSlackNotification(result.upsertStats, meetName);
                } catch (slackError) {
                    console.error('Slack notification failed, but continuing:', slackError.message);
                }
            }
            
            process.exit(0);
        })
        .catch(error => {
            console.error('Scraping failed with error:', error);
            process.exit(1);
        });
}

module.exports = { scrapeWeightliftingData };
