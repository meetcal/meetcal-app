require('dotenv').config();
const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');

// Initialize Supabase client
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase credentials. Please set SUPABASE_URL and SUPABASE_KEY environment variables.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Slack Configuration
const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;

// USA Weightlifting API URL
const API_URL = 'https://usaweightlifting.sport80.com/api/public/widget/data/new/1?p=0&i=20&s=WSO&l=&d=10&f=';

/**
 * Parse address string into components
 * @param {string} address - The full address string from the API
 * @returns {Object} Parsed address components
 */
function parseAddress(address) {
  try {
    // Various address formats we need to handle:
    // "7051 Commerce Circle, Pleasanton, California, United States of America, 94588"
    // "Fort Worth Convention Center, 1201 Houston Street, Fort Worth, Texas, United States of America, 76102"
    // "CrossFit Revamped, 9385 Washington Blvd., Suite B-C, Laurel, Maryland, United States of America, 20723"
    
    // Replace double commas if any (e.g. "8439 NE Columbia Ct,, Portland")
    address = address.replace(/,\s*,/g, ',');
    
    const parts = address.split(', ');
    let venueName = '';
    let street = '';
    let city = '';
    let state = '';
    let zip = '';
    
    if (parts.length >= 4) {
      // Extract the zip code from the last part
      zip = parts[parts.length - 1];
      
      // Extract the state from the second to last part or third to last if "United States" is included
      const stateIndex = parts.findIndex(part => part === "United States of America");
      state = stateIndex > 0 ? parts[stateIndex - 1] : parts[parts.length - 2];
      
      // Check if first part might be a venue name (doesn't start with a number)
      if (!parts[0].match(/^\d/)) {
        // Venue name is provided
        venueName = parts[0];
        
        // Handle complex street addresses that might include suite numbers
        if (parts.length >= 6) {
          // The street might span multiple parts with commas
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
        // No venue name in the address - starts with street
        venueName = ''; // Will be set to meet name
        street = parts[0];
        city = parts[1];
      }
    } else {
      console.error(`Could not parse address: ${address}`);
      // Return defaults for addresses that don't match expected format
      return {
        venueName: '',
        street: address,
        city: 'Unknown',
        state: 'Unknown',
        zip: 'Unknown'
      };
    }
    
    return { venueName, street, city, state, zip };
  } catch (error) {
    console.error(`Error parsing address: ${address}`, error);
    return {
      venueName: '',
      street: address,
      city: 'Unknown',
      state: 'Unknown',
      zip: 'Unknown'
    };
  }
}

/**
 * Parse date range string into start and end dates
 * @param {string} dateRange - Date range in format "MM/DD/YYYY - MM/DD/YYYY"
 * @returns {Object} Object with startDate and endDate
 */
function parseDateRange(dateRange) {
  try {
    // Handle escaped forward slashes in date format (e.g., "06\/08\/2025 - 06\/08\/2025")
    const cleanDateRange = dateRange.replace(/\\\//g, '/');
    const dates = cleanDateRange.split(' - ');
    
    // Parse dates as MM/DD/YYYY
    const startParts = dates[0].split('/');
    const endParts = dates[1] ? dates[1].split('/') : startParts;
    
    // Format as YYYY-MM-DD for SQL
    const startDate = `${startParts[2]}-${startParts[0]}-${startParts[1]}`;
    const endDate = `${endParts[2]}-${endParts[0]}-${endParts[1]}`;
    
    return { startDate, endDate };
  } catch (error) {
    console.error(`Error parsing date range: ${dateRange}`, error);
    return { startDate: null, endDate: null };
  }
}

/**
 * Map time zone based on state
 * @param {string} state - The state name
 * @returns {string} Time zone string
 */
function mapTimeZone(state) {
  // Simple mapping of states to time zones
  const timeZoneMap = {
    'Alabama': 'America/Chicago',
    'Alaska': 'America/Anchorage',
    'Arizona': 'America/Phoenix',
    'Arkansas': 'America/Chicago',
    'California': 'America/Los_Angeles',
    'Colorado': 'America/Denver',
    'Connecticut': 'America/New_York',
    'Delaware': 'America/New_York',
    'Florida': 'America/New_York',
    'Georgia': 'America/New_York',
    'Hawaii': 'Pacific/Honolulu',
    'Idaho': 'America/Denver',
    'Illinois': 'America/Chicago',
    'Indiana': 'America/New_York',
    'Iowa': 'America/Chicago',
    'Kansas': 'America/Chicago',
    'Kentucky': 'America/New_York',
    'Louisiana': 'America/Chicago',
    'Maine': 'America/New_York',
    'Maryland': 'America/New_York',
    'Massachusetts': 'America/New_York',
    'Michigan': 'America/New_York',
    'Minnesota': 'America/Chicago',
    'Mississippi': 'America/Chicago',
    'Missouri': 'America/Chicago',
    'Montana': 'America/Denver',
    'Nebraska': 'America/Chicago',
    'Nevada': 'America/Los_Angeles',
    'New Hampshire': 'America/New_York',
    'New Jersey': 'America/New_York',
    'New Mexico': 'America/Denver',
    'New York': 'America/New_York',
    'North Carolina': 'America/New_York',
    'North Dakota': 'America/Chicago',
    'Ohio': 'America/New_York',
    'Oklahoma': 'America/Chicago',
    'Oregon': 'America/Los_Angeles',
    'Pennsylvania': 'America/New_York',
    'Rhode Island': 'America/New_York',
    'South Carolina': 'America/New_York',
    'South Dakota': 'America/Chicago',
    'Tennessee': 'America/Chicago',
    'Texas': 'America/Chicago',
    'Utah': 'America/Denver',
    'Vermont': 'America/New_York',
    'Virginia': 'America/New_York',
    'Washington': 'America/Los_Angeles',
    'West Virginia': 'America/New_York',
    'Wisconsin': 'America/Chicago',
    'Wyoming': 'America/Denver',
    'District of Columbia': 'America/New_York'
  };
  
  return timeZoneMap[state] || 'America/New_York';
}

/**
 * Map state names to their two-letter abbreviations
 * @param {string} stateName - Full state name
 * @returns {string} Two-letter state abbreviation
 */
function getStateAbbreviation(stateName) {
  const stateMap = {
    'Alabama': 'AL',
    'Alaska': 'AK',
    'Arizona': 'AZ',
    'Arkansas': 'AR',
    'California': 'CA',
    'Colorado': 'CO',
    'Connecticut': 'CT',
    'Delaware': 'DE',
    'Florida': 'FL',
    'Georgia': 'GA',
    'Hawaii': 'HI',
    'Idaho': 'ID',
    'Illinois': 'IL',
    'Indiana': 'IN',
    'Iowa': 'IA',
    'Kansas': 'KS',
    'Kentucky': 'KY',
    'Louisiana': 'LA',
    'Maine': 'ME',
    'Maryland': 'MD',
    'Massachusetts': 'MA',
    'Michigan': 'MI',
    'Minnesota': 'MN',
    'Mississippi': 'MS',
    'Missouri': 'MO',
    'Montana': 'MT',
    'Nebraska': 'NE',
    'Nevada': 'NV',
    'New Hampshire': 'NH',
    'New Jersey': 'NJ',
    'New Mexico': 'NM',
    'New York': 'NY',
    'North Carolina': 'NC',
    'North Dakota': 'ND',
    'Ohio': 'OH',
    'Oklahoma': 'OK',
    'Oregon': 'OR',
    'Pennsylvania': 'PA',
    'Rhode Island': 'RI',
    'South Carolina': 'SC',
    'South Dakota': 'SD',
    'Tennessee': 'TN',
    'Texas': 'TX',
    'Utah': 'UT',
    'Vermont': 'VT',
    'Virginia': 'VA',
    'Washington': 'WA',
    'West Virginia': 'WV',
    'Wisconsin': 'WI',
    'Wyoming': 'WY',
    'District of Columbia': 'DC'
  };
  
  return stateMap[stateName] || stateName;
}

/**
 * Fetch meets data from the USA Weightlifting API
 */
async function fetchMeets() {
  try {
    console.log('Fetching meets data from the API...');
    const response = await axios.get(API_URL);
    
    if (response.status !== 200) {
      throw new Error(`API request failed with status ${response.status}`);
    }
    
    // Handle response if it's a string (with escaped characters)
    if (typeof response.data === 'string') {
      try {
        const parsedData = JSON.parse(response.data);
        return parsedData.data;
      } catch (parseError) {
        console.error('Error parsing JSON response:', parseError.message);
        return [];
      }
    }
    
    return response.data.data;
  } catch (error) {
    console.error('Error fetching meets data:', error.message);
    return [];
  }
}

/**
 * Transform API meet data to match Supabase schema
 * @param {Array} meetsData - Raw meets data from the API
 * @returns {Array} Transformed meets data
 */
function transformMeetsData(meetsData) {
  return meetsData.map(meet => {
    // Parse address
    const { venueName, street, city, state, zip } = parseAddress(meet.address);
    
    // Parse date range
    const { startDate, endDate } = parseDateRange(meet.subtitle);
    
    // Map time zone based on state
    const timeZone = mapTimeZone(state);
    
    // Convert state name to abbreviation
    const stateAbbreviation = getStateAbbreviation(state);
    
    // Use original venue name if found, otherwise use meet name as venue name
    const finalVenueName = venueName || meet.name;
    
    return {
      name: meet.name,
      venue_name: finalVenueName,
      venue_street: street,
      venue_city: city,
      venue_state: stateAbbreviation,  // Use the 2-letter abbreviation
      venue_zip: zip,
      time_zone: timeZone,
      start_date: startDate,
      end_date: endDate,
      status: 'upcoming',
      federation: 'USAW',
      external_id: meet.id // Store original ID for reference
    };
  }).filter(meet => meet.start_date && meet.end_date); // Filter out meets with invalid dates
}

/**
 * Check if meet already exists in Supabase
 * @param {Object} meet - Processed meet data
 * @returns {Promise<boolean>} Whether the meet already exists
 */
async function meetExists(meet) {
  // First try to check by name as that's the unique constraint in the database
  const { data: nameData, error: nameError } = await supabase
    .from('meets')
    .select('id')
    .eq('name', meet.name)
    .limit(1);
  
  if (nameError) {
    console.error('Error checking if meet exists by name:', nameError);
    return false;
  }
  
  if (nameData && nameData.length > 0) {
    return true;
  }
  
  // If we have metadata about the external_id, let's store it in a separate table
  // This is just logging for now, we're not implementing this feature yet
  console.log(`Meet "${meet.name}" with external ID ${meet.external_id} is new`);
  
  return false;
}

/**
 * Main function to run the sync process
 */
/**
 * Retry a function with exponential backoff
 * @param {Function} fn - Function to retry
 * @param {number} maxRetries - Maximum number of retries
 * @returns {Promise} Result of the function
 */
async function retry(fn, maxRetries = 3) {
  let retries = 0;
  
  while (retries < maxRetries) {
    try {
      return await fn();
    } catch (error) {
      retries++;
      if (retries >= maxRetries) {
        throw error;
      }
      
      const delay = Math.pow(2, retries) * 1000; // Exponential backoff
      console.log(`Retry ${retries}/${maxRetries} after ${delay}ms`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

/**
 * Send a Slack notification with the number of meets added and timestamp
 * @param {number} meetsAddedCount - Number of meets added to Supabase
 * @param {Array<string>} meetNames - Array of meet names that were added
 */
async function sendSlackNotification(meetsAddedCount, meetNames = []) {
  if (!SLACK_WEBHOOK_URL) {
    console.log('Slack webhook URL not configured. Skipping notification.');
    return;
  }

  // Get current timestamp in a readable format
  const currentTime = new Date().toISOString().replace('T', ' ').slice(0, -5) + ' UTC';
  
  // Create the message
  let message = `${meetsAddedCount} WSO meets added to Supabase`;
  
  // Add meet names if any were added
  if (meetNames.length > 0) {
    message += '\n\nMeets added:\n' + meetNames.map(name => `- ${name}`).join('\n');
  }
  
  const payload = {
    text: message
  };
  
  try {
    const response = await axios.post(SLACK_WEBHOOK_URL, payload, { timeout: 30000 });
    console.log(`Slack notification sent successfully: ${message}`);
  } catch (error) {
    console.error(`Failed to send Slack notification:`, error.message);
    if (error.response) {
      console.error(`Slack webhook response:`, error.response.data);
    }
  }
}

/**
 * Main function to run the sync process
 */
async function syncMeets() {
  try {
    // Fetch meets data from API with retry
    const meetsData = await retry(() => fetchMeets());
    
    if (!meetsData || meetsData.length === 0) {
      console.log('No meets data found or API request failed');
      return;
    }
    
    console.log(`Fetched ${meetsData.length} meets from the API`);
    
    // Transform meets data to match Supabase schema
    const transformedMeets = transformMeetsData(meetsData);
    
    console.log(`Processed ${transformedMeets.length} valid meets`);
    
    // Insert each meet if it doesn't already exist
    let insertCount = 0;
    let skippedCount = 0;
    const addedMeetNames = [];
    
    for (const meet of transformedMeets) {
      const exists = await meetExists(meet);
      
      if (exists) {
        console.log(`Meet "${meet.name}" already exists, skipping...`);
        skippedCount++;
        continue;
      }
      
      // Remove external_id as it's not in the schema
      const { external_id, ...meetData } = meet;
      
      const { data, error } = await supabase
        .from('meets')
        .insert([meetData]);
      
      if (error) {
        console.error(`Error inserting meet "${meet.name}":`, error);
      } else {
        console.log(`Successfully inserted meet "${meet.name}"`);
        insertCount++;
        addedMeetNames.push(meet.name);
      }
      
      // Add a small delay to avoid overwhelming the database
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    console.log(`Sync completed. Processed ${transformedMeets.length} meets. Inserted: ${insertCount}, Skipped: ${skippedCount}`);
    
    // Send Slack notification
    await sendSlackNotification(insertCount, addedMeetNames);
  } catch (error) {
    console.error('Error in syncMeets:', error);
    process.exit(1);
  }
}

// Run the sync process
syncMeets(); 