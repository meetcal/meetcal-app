require('dotenv').config();
const axios = require('axios');

const convexUrl = process.env.CONVEX_URL;
const scraperSecret = process.env.SCRAPER_SECRET;
const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;
const API_URL = 'https://usaweightlifting.sport80.com/api/public/widget/data/new/1?p=0&i=20&s=Virus%20Weightlifting&l=&d=10&f=';

if (!convexUrl || !scraperSecret) {
  console.error('Missing CONVEX_URL or SCRAPER_SECRET. Exiting.');
  process.exit(1);
}

function parseAddress(address) {
  try {
    address = address.replace(/,\s*,/g, ',');
    const parts = address.split(', ');
    let venueName = '';
    let street = '';
    let city = '';
    let state = '';
    let zip = '';
    if (parts.length >= 4) {
      zip = parts[parts.length - 1];
      const stateIndex = parts.findIndex(part => part === "United States of America");
      state = stateIndex > 0 ? parts[stateIndex - 1] : parts[parts.length - 2];
      if (!parts[0].match(/^\d/)) {
        venueName = parts[0];
        if (parts.length >= 6) {
          street = parts[1];
          if (parts[2].match(/Suite|Unit|Apt|#/i)) {
            street += ", " + parts[2];
            city = parts[3];
          } else {
            city = parts[2];
          }
        } else {
          street = parts[1];
          city = parts[2];
        }
      } else {
        street = parts[0];
        city = parts[1];
      }
    } else {
      return { venueName: '', street: address, city: 'Unknown', state: 'Unknown', zip: 'Unknown' };
    }
    return { venueName, street, city, state, zip };
  } catch (error) {
    return { venueName: '', street: address, city: 'Unknown', state: 'Unknown', zip: 'Unknown' };
  }
}

function parseDateRange(dateRange) {
  try {
    const cleanDateRange = dateRange.replace(/\\\//g, '/');
    const dates = cleanDateRange.split(' - ');
    const startParts = dates[0].split('/');
    const endParts = dates[1] ? dates[1].split('/') : startParts;
    const startDate = `${startParts[2]}-${startParts[0]}-${startParts[1]}`;
    const endDate = `${endParts[2]}-${endParts[0]}-${endParts[1]}`;
    return { startDate, endDate };
  } catch (error) {
    return { startDate: null, endDate: null };
  }
}

function mapTimeZone(state) {
  const timeZoneMap = {
    'Alabama': 'America/Chicago', 'Alaska': 'America/Anchorage', 'Arizona': 'America/Phoenix',
    'Arkansas': 'America/Chicago', 'California': 'America/Los_Angeles', 'Colorado': 'America/Denver',
    'Connecticut': 'America/New_York', 'Delaware': 'America/New_York', 'Florida': 'America/New_York',
    'Georgia': 'America/New_York', 'Hawaii': 'Pacific/Honolulu', 'Idaho': 'America/Denver',
    'Illinois': 'America/Chicago', 'Indiana': 'America/New_York', 'Iowa': 'America/Chicago',
    'Kansas': 'America/Chicago', 'Kentucky': 'America/New_York', 'Louisiana': 'America/Chicago',
    'Maine': 'America/New_York', 'Maryland': 'America/New_York', 'Massachusetts': 'America/New_York',
    'Michigan': 'America/New_York', 'Minnesota': 'America/Chicago', 'Mississippi': 'America/Chicago',
    'Missouri': 'America/Chicago', 'Montana': 'America/Denver', 'Nebraska': 'America/Chicago',
    'Nevada': 'America/Los_Angeles', 'New Hampshire': 'America/New_York', 'New Jersey': 'America/New_York',
    'New Mexico': 'America/Denver', 'New York': 'America/New_York', 'North Carolina': 'America/New_York',
    'North Dakota': 'America/Chicago', 'Ohio': 'America/New_York', 'Oklahoma': 'America/Chicago',
    'Oregon': 'America/Los_Angeles', 'Pennsylvania': 'America/New_York', 'Rhode Island': 'America/New_York',
    'South Carolina': 'America/New_York', 'South Dakota': 'America/Chicago', 'Tennessee': 'America/Chicago',
    'Texas': 'America/Chicago', 'Utah': 'America/Denver', 'Vermont': 'America/New_York',
    'Virginia': 'America/New_York', 'Washington': 'America/Los_Angeles', 'West Virginia': 'America/New_York',
    'Wisconsin': 'America/Chicago', 'Wyoming': 'America/Denver', 'District of Columbia': 'America/New_York'
  };
  return timeZoneMap[state] || 'America/New_York';
}

function getStateAbbreviation(stateName) {
  const stateMap = {
    'Alabama': 'AL', 'Alaska': 'AK', 'Arizona': 'AZ', 'Arkansas': 'AR', 'California': 'CA',
    'Colorado': 'CO', 'Connecticut': 'CT', 'Delaware': 'DE', 'Florida': 'FL', 'Georgia': 'GA',
    'Hawaii': 'HI', 'Idaho': 'ID', 'Illinois': 'IL', 'Indiana': 'IN', 'Iowa': 'IA', 'Kansas': 'KS',
    'Kentucky': 'KY', 'Louisiana': 'LA', 'Maine': 'ME', 'Maryland': 'MD', 'Massachusetts': 'MA',
    'Michigan': 'MI', 'Minnesota': 'MN', 'Mississippi': 'MS', 'Missouri': 'MO', 'Montana': 'MT',
    'Nebraska': 'NE', 'Nevada': 'NV', 'New Hampshire': 'NH', 'New Jersey': 'NJ', 'New Mexico': 'NM',
    'New York': 'NY', 'North Carolina': 'NC', 'North Dakota': 'ND', 'Ohio': 'OH', 'Oklahoma': 'OK',
    'Oregon': 'OR', 'Pennsylvania': 'PA', 'Rhode Island': 'RI', 'South Carolina': 'SC',
    'South Dakota': 'SD', 'Tennessee': 'TN', 'Texas': 'TX', 'Utah': 'UT', 'Vermont': 'VT',
    'Virginia': 'VA', 'Washington': 'WA', 'West Virginia': 'WV', 'Wisconsin': 'WI', 'Wyoming': 'WY',
    'District of Columbia': 'DC'
  };
  return stateMap[stateName] || stateName;
}

async function fetchMeets() {
  try {
    const response = await axios.get(API_URL);
    if (response.status !== 200) throw new Error(`API request failed with status ${response.status}`);
    if (typeof response.data === 'string') {
      try {
        return JSON.parse(response.data).data;
      } catch {
        return [];
      }
    }
    return response.data.data;
  } catch (error) {
    console.error('Error fetching meets:', error.message);
    return [];
  }
}

function transformMeetsData(meetsData) {
  return meetsData.map(meet => {
    const { venueName, street, city, state, zip } = parseAddress(meet.address);
    const { startDate, endDate } = parseDateRange(meet.subtitle);
    const timeZone = mapTimeZone(state);
    const stateAbbreviation = getStateAbbreviation(state);
    const finalVenueName = venueName || meet.name;
    return {
      name: meet.name,
      venueName: finalVenueName,
      venueStreet: street,
      venueCity: city,
      venueState: stateAbbreviation,
      venueZip: zip,
      timeZone,
      startDate,
      endDate,
      status: 'upcoming',
      federation: 'USAW',
    };
  }).filter(meet => meet.startDate && meet.endDate && !meet.name.toUpperCase().includes('ADAPTIVE'));
}

async function ingestMeetToConvex(meet) {
  const res = await fetch(`${convexUrl}/api/action`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      path: 'scraperIngestion:ingestMeet',
      args: {
        scraperSecret,
        name: meet.name,
        venueName: meet.venueName,
        venueStreet: meet.venueStreet,
        venueCity: meet.venueCity,
        venueState: meet.venueState,
        venueZip: meet.venueZip,
        timeZone: meet.timeZone,
        startDate: meet.startDate,
        endDate: meet.endDate,
        status: meet.status,
        federation: meet.federation,
      },
    }),
  });
  if (!res.ok) throw new Error(await res.text());
}

async function retry(fn, maxRetries = 3) {
  let retries = 0;
  while (retries < maxRetries) {
    try {
      return await fn();
    } catch (error) {
      retries++;
      if (retries >= maxRetries) throw error;
      await new Promise(r => setTimeout(r, Math.pow(2, retries) * 1000));
    }
  }
}

async function sendSlackNotification(insertCount, addedMeetNames) {
  if (!SLACK_WEBHOOK_URL) return;
  const message = insertCount === 0
    ? 'No new Virus Series meets added to Convex'
    : `${insertCount} Virus Series meets added to Convex\n\nMeets added:\n${addedMeetNames.map(n => `- ${n}`).join('\n')}`;
  try {
    await axios.post(SLACK_WEBHOOK_URL, { text: message }, { timeout: 30000 });
  } catch (error) {
    console.error('Slack notification failed:', error.message);
  }
}

async function syncMeets() {
  try {
    const meetsData = await retry(() => fetchMeets());
    if (!meetsData || meetsData.length === 0) {
      console.log('No meets data found');
      return;
    }
    const transformedMeets = transformMeetsData(meetsData);
    console.log(`Fetched ${meetsData.length} meets, ${transformedMeets.length} valid`);
    let insertCount = 0;
    const addedMeetNames = [];
    for (const meet of transformedMeets) {
      try {
        await ingestMeetToConvex(meet);
        insertCount++;
        addedMeetNames.push(meet.name);
        console.log(`Ingested: ${meet.name}`);
      } catch (error) {
        console.error(`Error ingesting "${meet.name}":`, error.message);
      }
      await new Promise(r => setTimeout(r, 200));
    }
    console.log(`Sync completed. Processed ${transformedMeets.length} meets. Ingested: ${insertCount}`);
    await sendSlackNotification(insertCount, addedMeetNames);
  } catch (error) {
    console.error('Error in syncMeets:', error);
    process.exit(1);
  }
}

syncMeets();
